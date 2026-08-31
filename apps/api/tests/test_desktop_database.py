from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl, SecretStr
from sqlalchemy import text

from finance_os_api.config import Settings
from finance_os_api.database import Database
from finance_os_api.domain.models import Base, FinancialTransaction
from finance_os_api.main import create_app


@pytest.mark.asyncio
async def test_desktop_database_bootstraps_once_and_stores_money_as_integer_cents(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "finance-os.sqlite3"
    database_url = f"sqlite+aiosqlite:///{database_path}"
    database = Database(database_url)

    await database.prepare_schema()
    await database.prepare_schema()

    async with database.session_factory.begin() as session:
        transaction = FinancialTransaction(
            direction="income",
            amount=Decimal("123456789.12"),
            currency="EUR",
            booked_on=date(2026, 8, 27),
            counterparty="Synthetic Fixture",
            category="Test",
            source="manual",
        )
        session.add(transaction)

    async with database.engine.connect() as connection:
        stored = (
            await connection.execute(
                text("SELECT amount, typeof(amount) FROM financial_transactions")
            )
        ).one()
        version = (
            await connection.execute(text("SELECT MAX(version) FROM desktop_schema_migrations"))
        ).scalar_one()

    async with database.session_factory() as session:
        loaded = await session.get(FinancialTransaction, transaction.id)

    assert stored == (12_345_678_912, "integer")
    assert loaded is not None
    assert loaded.amount == Decimal("123456789.12")
    assert version == 5
    await database.dispose()


@pytest.mark.asyncio
async def test_desktop_database_migrates_v1_proposals_without_data_loss(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "finance-os-v1.sqlite3"
    database = Database(f"sqlite+aiosqlite:///{database_path}")

    async with database.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        for table in (
            "assistant_conversation_events",
            "assistant_provider_runtime",
            "assistant_activities",
            "assistant_turns",
            "assistant_messages",
            "assistant_conversations",
        ):
            await connection.execute(text(f"DROP TABLE {table}"))  # noqa: S608
        await connection.execute(text("DROP TABLE finance_proposal_events"))
        await connection.execute(
            text("DROP INDEX ix_finance_change_proposals_status_created")
        )
        await connection.execute(text("DROP TABLE finance_change_proposals"))
        await connection.execute(
            text(
                """
                CREATE TABLE finance_change_proposals (
                    id INTEGER NOT NULL,
                    public_id CHAR(32) NOT NULL UNIQUE,
                    agent_id TEXT NOT NULL,
                    action TEXT NOT NULL CHECK (
                        action IN (
                            'receivable_update', 'payment_record', 'payment_reverse'
                        )
                    ),
                    receivable_id INTEGER NOT NULL,
                    expected_version INTEGER NOT NULL CHECK (expected_version > 0),
                    payload JSON NOT NULL,
                    rationale TEXT NOT NULL,
                    status TEXT DEFAULT 'pending' NOT NULL CHECK (
                        status IN ('pending', 'approved', 'rejected')
                    ),
                    request_id CHAR(32) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    decided_at DATETIME,
                    PRIMARY KEY (id),
                    FOREIGN KEY(receivable_id) REFERENCES receivables (id)
                        ON DELETE RESTRICT
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX ix_finance_change_proposals_status_created
                ON finance_change_proposals (status, created_at)
                """
            )
        )
        await connection.execute(
            text(
                """
                INSERT INTO receivables (
                    id, public_id, version, debtor_name, original_amount,
                    received_amount, currency, description, status
                ) VALUES (
                    1, '123e4567e89b42d3a456426614174000', 1,
                    'Synthetic Fixture', 10000, 0, 'EUR',
                    'Synthetic legacy receivable', 'open'
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                INSERT INTO finance_change_proposals (
                    id, public_id, agent_id, action, receivable_id,
                    expected_version, payload, rationale, status, request_id,
                    created_at, decided_at
                ) VALUES (
                    1, '223e4567e89b42d3a456426614174000', 'local-agent',
                    'receivable_update', 1, 1,
                    '{"description":"Synthetic migrated value"}',
                    'Synthetic migration fixture', 'approved',
                    '323e4567e89b42d3a456426614174000',
                    '2026-08-27 10:00:00', '2026-08-27 10:05:00'
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE desktop_schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                INSERT INTO desktop_schema_migrations (version, applied_at)
                VALUES (1, '2026-08-27T10:00:00+00:00')
                """
            )
        )

    await database.prepare_schema()
    await database.prepare_schema()

    async with database.engine.begin() as connection:
        versions = (
            await connection.execute(
                text("SELECT version FROM desktop_schema_migrations ORDER BY version")
            )
        ).scalars().all()
        proposal = (
            await connection.execute(
                text(
                    """
                    SELECT action, receivable_id, expected_version, payload,
                           idempotency_key, provider_call_id
                    FROM finance_change_proposals
                    WHERE id = 1
                    """
                )
            )
        ).one()
        events = (
            await connection.execute(
                text(
                    """
                    SELECT event_type, actor_type, actor_id
                    FROM finance_proposal_events
                    WHERE proposal_id = 1
                    ORDER BY created_at, id
                    """
                )
            )
        ).all()
        await connection.execute(
            text(
                """
                INSERT INTO finance_change_proposals (
                    public_id, agent_id, action, receivable_id,
                    expected_version, payload, rationale, status, request_id
                ) VALUES (
                    '423e4567e89b42d3a456426614174000', 'finance-assistant',
                    'receivable_create', NULL, NULL, :payload,
                    'Synthetic create fixture', 'pending',
                    '523e4567e89b42d3a456426614174000'
                )
                """
            ),
            {
                "payload": (
                    '{"debtor_name":"Synthetic New","original_amount":"10.00",'
                    '"currency":"EUR","description":"Synthetic"}'
                )
            },
        )
        foreign_key_violations = (
            await connection.execute(text("PRAGMA foreign_key_check"))
        ).all()

    assert versions == [1, 2, 3, 4, 5]
    assert proposal == (
        "receivable_update",
        1,
        1,
        '{"description":"Synthetic migrated value"}',
        None,
        None,
    )
    assert events == [
        ("created", "agent", "local-agent"),
        ("approved", "owner", "owner"),
    ]
    assert foreign_key_violations == []
    await database.dispose()


@pytest.mark.asyncio
async def test_desktop_database_migrates_v3_to_durable_assistant_history(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+aiosqlite:///{tmp_path / 'finance-os-v3.sqlite3'}")

    async with database.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        for table in (
            "assistant_conversation_events",
            "assistant_provider_runtime",
            "assistant_activities",
            "assistant_turns",
            "assistant_messages",
            "assistant_conversations",
        ):
            await connection.execute(text(f"DROP TABLE {table}"))  # noqa: S608
        await connection.execute(
            text(
                "CREATE TABLE desktop_schema_migrations ("
                "version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO desktop_schema_migrations (version, applied_at) "
                "VALUES (3, '2026-08-31T10:00:00+00:00')"
            )
        )

    await database.prepare_schema()

    async with database.engine.connect() as connection:
        version = (
            await connection.execute(text("SELECT MAX(version) FROM desktop_schema_migrations"))
        ).scalar_one()
        tables = {
            row[0]
            for row in (
                await connection.execute(
                    text("SELECT name FROM sqlite_master WHERE type = 'table'")
                )
            ).all()
        }

    assert version == 5
    assert {
        "assistant_activities",
        "assistant_conversation_events",
        "assistant_conversations",
        "assistant_messages",
        "assistant_provider_runtime",
        "assistant_turns",
    } <= tables
    await database.dispose()


@pytest.mark.asyncio
async def test_desktop_database_backfills_the_explicit_model_binding(tmp_path: Path) -> None:
    """An installation from before ADR 0014 keeps its threads and gains a configuration."""

    database = Database(f"sqlite+aiosqlite:///{tmp_path / 'finance-os-v4.sqlite3'}")

    async with database.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(text("DROP TABLE assistant_provider_runtime"))
        await connection.execute(
            text(
                "CREATE TABLE assistant_provider_runtime ("
                "conversation_id INTEGER NOT NULL, "
                "provider_name TEXT DEFAULT 'codex' NOT NULL, "
                "provider_thread_id VARCHAR(128) NOT NULL, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, "
                "PRIMARY KEY (conversation_id), "
                "CONSTRAINT ck_assistant_runtime_provider CHECK (provider_name IN ('codex')), "
                "FOREIGN KEY(conversation_id) REFERENCES assistant_conversations (id) "
                "ON DELETE RESTRICT, UNIQUE (provider_thread_id))"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO assistant_conversations "
                "(id, public_id, title, status, message_count, version, "
                "created_at, updated_at) VALUES "
                "(1, '11111111111111111111111111111111', 'Alte Unterhaltung', 'active', "
                "0, 1, '2026-08-31T10:00:00+00:00', '2026-08-31T10:00:00+00:00')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO assistant_provider_runtime "
                "(conversation_id, provider_name, provider_thread_id, updated_at) "
                "VALUES (1, 'codex', 'provider_thread_legacy', '2026-08-31T10:00:00+00:00')"
            )
        )
        await connection.execute(
            text(
                "CREATE TABLE desktop_schema_migrations ("
                "version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO desktop_schema_migrations (version, applied_at) "
                "VALUES (4, '2026-08-31T10:00:00+00:00')"
            )
        )

    await database.prepare_schema()

    async with database.engine.connect() as connection:
        version = (
            await connection.execute(text("SELECT MAX(version) FROM desktop_schema_migrations"))
        ).scalar_one()
        binding = (
            await connection.execute(
                text(
                    "SELECT conversation_id, provider_thread_id, provider_model, "
                    "provider_effort, provider_service_tier "
                    "FROM assistant_provider_runtime"
                )
            )
        ).all()
        violations = (await connection.execute(text("PRAGMA foreign_key_check"))).all()

    assert version == 5
    # The thread survives untouched; only the configuration is new.
    assert binding == [(1, "provider_thread_legacy", "gpt-5.5", "medium", "default")]
    assert violations == []
    await database.dispose()


@pytest.mark.asyncio
async def test_desktop_api_is_ready_without_postgres_or_docker(tmp_path: Path) -> None:
    token = "desktop-test-token"
    app = create_app(
        Settings(
            env="production",
            api_token=SecretStr(token),
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'finance-os.sqlite3'}",
            document_root=tmp_path / "documents",
            quarantine_root=tmp_path / "quarantine",
            web_origin=AnyHttpUrl("http://127.0.0.1:32123"),
        )
    )

    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {token}"},
        ) as client,
    ):
        ready = await client.get("/ready")
        receivable = await client.post(
            "/api/v1/finance/receivables",
            json={
                "debtor_name": "Synthetic Fixture",
                "original_amount": "19.99",
                "currency": "EUR",
                "description": "Local database verification",
            },
        )
        receivable_data = receivable.json()["data"]
        payment = await client.post(
            f"/api/v1/finance/receivables/{receivable_data['id']}/payments",
            json={
                "expected_version": receivable_data["version"],
                "amount": "7.25",
                "booked_on": "2026-08-28",
                "purpose": "Local payment verification",
                "payment_method": "bank_transfer",
            },
        )
        dashboard = await client.get("/api/v1/finance/dashboard?period=2026-08&currency=EUR")

    assert ready.status_code == 200
    assert receivable.status_code == 201
    assert payment.status_code == 201
    assert payment.json()["data"]["received_amount"] == "7.25"
    assert payment.json()["data"]["outstanding_amount"] == "12.74"
    assert dashboard.status_code == 200
    assert dashboard.json()["data"]["summary"]["outstanding_receivables"] == "12.74"
    assert (tmp_path / "finance-os.sqlite3").is_file()
    assert (tmp_path / "documents").is_dir()
