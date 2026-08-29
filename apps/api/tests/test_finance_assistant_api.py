import os
from collections.abc import AsyncIterator
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl, SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from finance_os_api.config import Settings
from finance_os_api.main import create_app

OWNER_TOKEN = "assistant-test-owner-token"
AGENT_TOKEN = "assistant-test-legacy-agent-token"
ASSISTANT_TOKEN = "assistant-test-finance-token"
TEST_DATABASE_URL = os.getenv("FINANCE_OS_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="FINANCE_OS_TEST_DATABASE_URL is not configured",
)


@pytest.fixture(autouse=True)
async def clean_finance_tables() -> AsyncIterator[None]:
    assert TEST_DATABASE_URL is not None
    database_name = make_url(TEST_DATABASE_URL).database
    if database_name is None or not database_name.endswith("_test"):
        pytest.fail("Integration tests require a database name ending in _test")

    engine = create_async_engine(TEST_DATABASE_URL)
    truncate = text(
        "TRUNCATE TABLE finance_proposal_events, finance_change_proposals, receivable_events, "
        "receivable_payment_reversals, receivable_payments, financial_transactions, "
        "receivables, change_set_items, change_proposal_items, change_sets, "
        "change_proposals, invoice_records, documents RESTART IDENTITY"
    )
    async with engine.begin() as connection:
        await connection.execute(truncate)
    yield
    async with engine.begin() as connection:
        await connection.execute(truncate)
    await engine.dispose()


@pytest.fixture
async def clients(
    tmp_path: Path,
) -> AsyncIterator[tuple[AsyncClient, AsyncClient, AsyncClient]]:
    assert TEST_DATABASE_URL is not None
    app = create_app(
        Settings(
            env="test",
            api_token=SecretStr(OWNER_TOKEN),
            agent_token=SecretStr(AGENT_TOKEN),
            finance_assistant_token=SecretStr(ASSISTANT_TOKEN),
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
        AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {ASSISTANT_TOKEN}"},
        ) as assistant,
    ):
        yield owner, agent, assistant


async def test_finance_assistant_reads_only_minimal_finance_projections(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, agent, assistant = clients
    transaction = await owner.post(
        "/api/v1/finance/transactions",
        json={
            "direction": "expense",
            "amount": "19.90",
            "booked_on": date.today().isoformat(),
            "counterparty": "Beispielmarkt",
            "category": "Lebensmittel",
            "description": "Synthetischer Testeinkauf",
        },
    )
    assert transaction.status_code == 201
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Beispielperson",
            "original_amount": "40.00",
            "description": "Synthetische Auslage",
        },
    )
    assert created.status_code == 201
    receivable = created.json()["data"]
    payment = await owner.post(
        f"/api/v1/finance/receivables/{receivable['id']}/payments",
        json={
            "expected_version": receivable["version"],
            "amount": "10.00",
            "booked_on": date.today().isoformat(),
            "purpose": "Synthetische Teilzahlung",
            "payment_method": "bank_transfer",
        },
    )
    assert payment.status_code == 201

    overview = await assistant.get("/api/v1/finance-assistant/overview")
    transactions = await assistant.get("/api/v1/finance-assistant/transactions?limit=1")
    receivables = await assistant.get(
        "/api/v1/finance-assistant/receivables?include_paid=false&limit=1"
    )
    detail = await assistant.get(
        f"/api/v1/finance-assistant/receivables/{receivable['id']}"
    )

    assert overview.status_code == 200
    assert transactions.status_code == 200
    assert receivables.status_code == 200
    assert detail.status_code == 200
    assert set(transactions.json()["data"][0]) == {
        "id",
        "direction",
        "amount",
        "currency",
        "booked_on",
        "counterparty",
        "category",
        "description",
        "receivable_id",
    }
    detail_data = detail.json()["data"]
    assert "created_at" not in detail_data
    assert "updated_at" not in detail_data
    assert set(detail_data["payments"][0]) == {
        "id",
        "amount",
        "booked_on",
        "purpose",
        "payment_method",
        "note",
        "reversed_at",
    }
    assert set(detail_data["history"][0]) == {"event_type", "created_at"}

    assert (await owner.get("/api/v1/finance-assistant/overview")).status_code == 403
    assert (await agent.get("/api/v1/finance-assistant/overview")).status_code == 403


async def test_finance_assistant_token_is_rejected_outside_dedicated_routes(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, _agent, assistant = clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Scope-Testperson",
            "original_amount": "25.00",
            "description": "Synthetischer Scope-Test",
        },
    )
    receivable = created.json()["data"]

    requests = [
        await assistant.get("/api/v1/finance/dashboard"),
        await assistant.get("/api/v1/workbooks/invoices"),
        await assistant.get("/api/v1/documents"),
        await assistant.get("/api/v1/banking/readiness"),
        await assistant.post(
            "/api/v1/finance/transactions",
            json={
                "direction": "income",
                "amount": "1.00",
                "booked_on": date.today().isoformat(),
                "counterparty": "Scope-Test",
                "category": "Test",
            },
        ),
        await assistant.post(
            "/api/v1/finance/receivables",
            json={
                "debtor_name": "Nicht direkt erlaubt",
                "original_amount": "1.00",
                "description": "Nur über einen prüfbaren Vorschlag",
            },
        ),
        await assistant.post(
            "/api/v1/finance/change-proposals",
            json={
                "action": "receivable_update",
                "receivable_id": receivable["id"],
                "expected_version": receivable["version"],
                "rationale": "Muss über den dedizierten Assistenten-Endpunkt laufen.",
                "changes": {"description": "Nicht erlaubt"},
            },
        ),
    ]

    assert all(response.status_code == 403 for response in requests)


async def test_assistant_receivable_create_is_idempotent_and_owner_approved(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, _agent, assistant = clients
    idempotency_key = str(uuid4())
    payload = {
        "action": "receivable_create",
        "rationale": "Eine synthetische private Auslage soll prüfbar erfasst werden.",
        "receivable": {
            "debtor_name": "Synthetische Testperson",
            "original_amount": "3000.00",
            "currency": "EUR",
            "due_date": None,
            "description": "Synthetisches Privatdarlehen",
        },
        "idempotency_key": idempotency_key,
        "provider_thread_id": "thread_create_1",
        "provider_turn_id": "turn_create_1",
        "provider_call_id": "call_create_1",
    }

    proposed = await assistant.post("/api/v1/finance-assistant/proposals", json=payload)
    duplicate = await assistant.post("/api/v1/finance-assistant/proposals", json=payload)
    before_approval = await owner.get("/api/v1/finance/receivables")
    pending_proposals = await owner.get(
        "/api/v1/finance/change-proposals?pending_only=true"
    )

    assert proposed.status_code == 201
    assert duplicate.status_code == 201
    assert duplicate.json() == proposed.json()
    proposal = proposed.json()["data"]
    assert proposal == {
        "id": proposal["id"],
        "action": "receivable_create",
        "receivable_id": None,
        "debtor_name": "Synthetische Testperson",
        "expected_version": None,
        "current_version": None,
        "status": "pending",
    }
    assert before_approval.json()["data"] == []
    assert pending_proposals.status_code == 200
    assert pending_proposals.json()["data"][0]["payload"]["original_amount"] == (
        "3000.00"
    )

    approved = await owner.post(
        f"/api/v1/finance/change-proposals/{proposal['id']}/approve"
    )
    assert approved.status_code == 200
    approved_data = approved.json()["data"]
    assert approved_data["status"] == "approved"
    assert approved_data["receivable_id"] is not None
    assert approved_data["expected_version"] is None
    assert approved_data["current_version"] == 1

    detail = await owner.get(
        f"/api/v1/finance/receivables/{approved_data['receivable_id']}"
    )
    assert detail.status_code == 200
    receivable = detail.json()["data"]
    assert receivable["debtor_name"] == "Synthetische Testperson"
    assert receivable["original_amount"] == "3000.00"
    assert receivable["currency"] == "EUR"
    assert receivable["description"] == "Synthetisches Privatdarlehen"
    assert receivable["history"][0]["event_type"] == "created"
    assert receivable["history"][0]["actor_type"] == "agent"
    assert receivable["history"][0]["proposal_id"] == proposal["id"]
    assert receivable["history"][0]["details"]["approved_by"] == "owner"

    assert TEST_DATABASE_URL is not None
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.connect() as connection:
        proposal_events = (
            await connection.execute(
                text(
                    "SELECT event_type, actor_type FROM finance_proposal_events "
                    "ORDER BY id"
                )
            )
        ).tuples().all()
    await engine.dispose()
    assert proposal_events == [
        ("created", "finance_assistant"),
        ("approved", "owner"),
    ]


async def test_rejected_receivable_create_never_creates_canonical_data(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, _agent, assistant = clients
    proposed = await assistant.post(
        "/api/v1/finance-assistant/proposals",
        json={
            "action": "receivable_create",
            "rationale": "Dieser synthetische Vorschlag wird abgelehnt.",
            "receivable": {
                "debtor_name": "Abgelehnte Testperson",
                "original_amount": "10.00",
                "currency": "EUR",
                "description": "Darf nicht kanonisch werden",
            },
            "idempotency_key": str(uuid4()),
            "provider_thread_id": "thread_create_reject",
            "provider_turn_id": "turn_create_reject",
            "provider_call_id": "call_create_reject",
        },
    )
    proposal_id = proposed.json()["data"]["id"]

    rejected = await owner.post(
        f"/api/v1/finance/change-proposals/{proposal_id}/reject"
    )
    receivables = await owner.get("/api/v1/finance/receivables")

    assert rejected.status_code == 200
    assert rejected.json()["data"]["status"] == "rejected"
    assert rejected.json()["data"]["receivable_id"] is None
    assert receivables.json()["data"] == []


async def test_assistant_proposal_is_idempotent_and_lifecycle_is_audited(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, agent, assistant = clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Audit-Testperson",
            "original_amount": "60.00",
            "description": "Synthetischer Audit-Test",
        },
    )
    receivable = created.json()["data"]
    idempotency_key = str(uuid4())
    proposal_payload = {
        "action": "receivable_update",
        "receivable_id": receivable["id"],
        "expected_version": receivable["version"],
        "rationale": "Die synthetische Beschreibung soll präzisiert werden.",
        "changes": {"description": "Präzisierter synthetischer Audit-Test"},
        "idempotency_key": idempotency_key,
        "provider_thread_id": "thread_test_1",
        "provider_turn_id": "turn_test_1",
        "provider_call_id": "call_test_1",
    }

    first = await assistant.post(
        "/api/v1/finance-assistant/proposals",
        json=proposal_payload,
    )
    duplicate = await assistant.post(
        "/api/v1/finance-assistant/proposals",
        json=proposal_payload,
    )
    conflicting = await assistant.post(
        "/api/v1/finance-assistant/proposals",
        json={
            **proposal_payload,
            "changes": {"description": "Anderer Inhalt mit demselben Schlüssel"},
        },
    )

    assert first.status_code == 201
    assert duplicate.status_code == 201
    assert duplicate.json() == first.json()
    assert first.json()["data"]["status"] == "pending"
    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "idempotency_conflict"

    proposal_id = first.json()["data"]["id"]
    approved = await owner.post(f"/api/v1/finance/change-proposals/{proposal_id}/approve")
    assert approved.status_code == 200

    assert TEST_DATABASE_URL is not None
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.connect() as connection:
        rows = (
            await connection.execute(
                text(
                    "SELECT event_type, actor_type, provider_thread_id, provider_turn_id, "
                    "provider_call_id FROM finance_proposal_events ORDER BY id"
                )
            )
        ).tuples().all()
    await engine.dispose()
    assert rows == [
        ("created", "finance_assistant", "thread_test_1", "turn_test_1", "call_test_1"),
        ("approved", "owner", "thread_test_1", "turn_test_1", "call_test_1"),
    ]

    owner_denied = await owner.post(
        "/api/v1/finance-assistant/proposals",
        json={**proposal_payload, "idempotency_key": str(uuid4())},
    )
    agent_denied = await agent.post(
        "/api/v1/finance-assistant/proposals",
        json={**proposal_payload, "idempotency_key": str(uuid4())},
    )
    assert owner_denied.status_code == 403
    assert agent_denied.status_code == 403


async def test_rejected_proposal_records_owner_event_without_changing_receivable(
    clients: tuple[AsyncClient, AsyncClient, AsyncClient],
) -> None:
    owner, _agent, assistant = clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Reject-Testperson",
            "original_amount": "22.00",
            "description": "Unveränderte synthetische Forderung",
        },
    )
    receivable = created.json()["data"]
    proposed = await assistant.post(
        "/api/v1/finance-assistant/proposals",
        json={
            "action": "receivable_update",
            "receivable_id": receivable["id"],
            "expected_version": receivable["version"],
            "rationale": "Nur für einen Ablehnungstest.",
            "changes": {"description": "Darf nicht kanonisch werden"},
            "idempotency_key": str(uuid4()),
            "provider_thread_id": "thread_reject",
            "provider_turn_id": "turn_reject",
            "provider_call_id": "call_reject",
        },
    )
    proposal_id = proposed.json()["data"]["id"]
    rejected = await owner.post(f"/api/v1/finance/change-proposals/{proposal_id}/reject")
    detail = await owner.get(f"/api/v1/finance/receivables/{receivable['id']}")

    assert rejected.status_code == 200
    assert rejected.json()["data"]["status"] == "rejected"
    assert detail.json()["data"]["description"] == "Unveränderte synthetische Forderung"

    assert TEST_DATABASE_URL is not None
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.connect() as connection:
        events = (
            await connection.execute(
                text("SELECT event_type, actor_type FROM finance_proposal_events ORDER BY id")
            )
        ).tuples().all()
    await engine.dispose()
    assert events == [("created", "finance_assistant"), ("rejected", "owner")]
