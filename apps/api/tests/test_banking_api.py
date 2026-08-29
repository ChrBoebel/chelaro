import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl, SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from finance_os_api.config import Settings
from finance_os_api.main import create_app

OWNER_TOKEN = "banking-owner-token"
AGENT_TOKEN = "banking-agent-token"
TEST_DATABASE_URL = os.getenv("FINANCE_OS_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="FINANCE_OS_TEST_DATABASE_URL is not configured",
)


@pytest.fixture(autouse=True)
async def clean_banking_tables() -> AsyncIterator[None]:
    assert TEST_DATABASE_URL is not None
    database_name = make_url(TEST_DATABASE_URL).database
    if database_name is None or not database_name.endswith("_test"):
        pytest.fail("Integration tests require a database name ending in _test")

    engine = create_async_engine(TEST_DATABASE_URL)
    truncate = text(
        "TRUNCATE TABLE bank_connection_events, bank_connections RESTART IDENTITY"
    )
    async with engine.begin() as connection:
        await connection.execute(truncate)
    yield
    async with engine.begin() as connection:
        await connection.execute(truncate)
    await engine.dispose()


@pytest.fixture
async def banking_clients(
    tmp_path: Path,
) -> AsyncIterator[tuple[AsyncClient, AsyncClient]]:
    assert TEST_DATABASE_URL is not None
    app = create_app(
        Settings(
            env="test",
            api_token=SecretStr(OWNER_TOKEN),
            agent_token=SecretStr(AGENT_TOKEN),
            database_url=TEST_DATABASE_URL,
            document_root=tmp_path / "documents",
            quarantine_root=tmp_path / "quarantine",
            web_origin=AnyHttpUrl("http://localhost:3000"),
        )
    )
    transport = ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {OWNER_TOKEN}"},
        ) as owner,
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {AGENT_TOKEN}"},
        ) as agent,
    ):
        yield owner, agent


async def test_owner_prepares_fints_connection_without_credentials(
    banking_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, agent = banking_clients

    empty = await owner.get("/api/v1/banking/readiness")
    assert empty.status_code == 200
    assert empty.json()["data"]["connection"] is None
    assert empty.json()["data"]["ready_for_live_sync"] is False

    forbidden = await agent.post(
        "/api/v1/banking/connections",
        json={
            "institution_name": "Kreissparkasse Göppingen",
            "bank_code": "61050000",
        },
    )
    assert forbidden.status_code == 403

    created = await owner.post(
        "/api/v1/banking/connections",
        json={
            "institution_name": "Kreissparkasse Göppingen",
            "bank_code": "61050000",
            "bic": "GOPSDE6GXXX",
            "tan_method": "push_tan",
        },
    )
    assert created.status_code == 201
    connection = created.json()["data"]
    assert connection["access_mode"] == "read_only"
    assert connection["version"] == 1
    assert "pin" not in connection
    assert "credentials" not in connection

    updated = await owner.patch(
        f"/api/v1/banking/connections/{connection['id']}",
        json={
            "expected_version": connection["version"],
            "endpoint": "https://banking.example.test/fints30",
            "transaction_access_confirmed": True,
            "statement_access_confirmed": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["version"] == 2

    readiness = await owner.get("/api/v1/banking/readiness")
    checks = {item["code"]: item for item in readiness.json()["data"]["checks"]}
    assert checks["institution"]["complete"] is True
    assert checks["endpoint"]["complete"] is True
    assert checks["transactions"]["complete"] is True
    assert checks["statements"]["complete"] is True
    assert checks["secure_credentials"]["complete"] is False
    assert checks["adapter"]["complete"] is False
    assert readiness.json()["data"]["ready_for_live_sync"] is False

    stale = await owner.patch(
        f"/api/v1/banking/connections/{connection['id']}",
        json={"expected_version": 1, "bic": "GOPSDE6GXXX"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_bank_connection_version"


async def test_bank_connection_mutations_emit_audit_events(
    banking_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, _agent = banking_clients
    created = await owner.post(
        "/api/v1/banking/connections",
        json={
            "institution_name": "Kreissparkasse Göppingen",
            "bank_code": "61050000",
        },
    )
    connection = created.json()["data"]
    await owner.patch(
        f"/api/v1/banking/connections/{connection['id']}",
        json={"expected_version": 1, "tan_method": "push_tan"},
    )

    assert TEST_DATABASE_URL is not None
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.connect() as database:
        events = (
            await database.execute(
                text(
                    "SELECT event_type, actor_type FROM bank_connection_events "
                    "ORDER BY id"
                )
            )
        ).all()
    await engine.dispose()
    assert events == [("created", "owner"), ("updated", "owner")]
