import os
from collections.abc import AsyncIterator
from datetime import date, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl, SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from finance_os_api.config import Settings
from finance_os_api.main import create_app

OWNER_TOKEN = "finance-owner-token"
AGENT_TOKEN = "finance-agent-token"
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
        "receivables, change_set_items, "
        "change_proposal_items, change_sets, change_proposals, invoice_records, "
        "documents RESTART IDENTITY"
    )
    async with engine.begin() as connection:
        await connection.execute(truncate)
    yield
    async with engine.begin() as connection:
        await connection.execute(truncate)
    await engine.dispose()


@pytest.fixture
async def finance_clients(
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


async def test_dashboard_separates_booked_cashflow_from_outstanding_money(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, _agent = finance_clients
    today = date.today()
    period = today.strftime("%Y-%m")

    income = await owner.post(
        "/api/v1/finance/transactions",
        json={
            "direction": "income",
            "amount": "3200.00",
            "booked_on": today.isoformat(),
            "counterparty": "Arbeitgeber",
            "category": "Gehalt",
            "description": "Monatsgehalt",
        },
    )
    expense = await owner.post(
        "/api/v1/finance/transactions",
        json={
            "direction": "expense",
            "amount": "950.00",
            "booked_on": today.isoformat(),
            "counterparty": "Vermieter",
            "category": "Wohnen",
        },
    )
    assert income.status_code == 201
    assert expense.status_code == 201

    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Max Mustermann",
            "original_amount": "300.00",
            "due_date": (today + timedelta(days=7)).isoformat(),
            "description": "Gemeinsame Reisekosten",
        },
    )
    assert created.status_code == 201
    receivable = created.json()["data"]
    assert receivable["outstanding_amount"] == "300.00"
    assert receivable["status"] == "open"

    payment = await owner.post(
        f"/api/v1/finance/receivables/{receivable['id']}/payments",
        json={
            "expected_version": 1,
            "amount": "100.00",
            "booked_on": today.isoformat(),
            "purpose": "Erste Teilzahlung der Reisekosten",
            "payment_method": "bank_transfer",
            "note": "100 Euro wie vereinbart",
        },
    )
    assert payment.status_code == 201
    assert payment.json()["data"]["received_amount"] == "100.00"
    assert payment.json()["data"]["outstanding_amount"] == "200.00"
    assert payment.json()["data"]["status"] == "partial"

    dashboard = await owner.get(f"/api/v1/finance/dashboard?period={period}")
    assert dashboard.status_code == 200
    data = dashboard.json()["data"]
    assert data["summary"] == {
        "income": "3300.00",
        "expenses": "950.00",
        "net": "2350.00",
        "outstanding_receivables": "200.00",
        "overdue_receivables": 0,
        "pending_finance_proposals": 0,
        "currency": "EUR",
    }
    assert data["open_receivables"][0]["status"] == "partial"
    assert data["recent_transactions"][0]["source"] == "receivable"
    assert len(data["cashflow"]) == 6


async def test_overpayment_is_rejected_without_changing_the_receivable(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, _agent = finance_clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Lisa Beispiel",
            "original_amount": "80.00",
            "description": "Konzertkarten",
        },
    )
    receivable_id = created.json()["data"]["id"]

    rejected = await owner.post(
        f"/api/v1/finance/receivables/{receivable_id}/payments",
        json={
            "expected_version": 1,
            "amount": "81.00",
            "booked_on": date.today().isoformat(),
            "purpose": "Konzertkarten",
            "payment_method": "paypal",
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "payment_exceeds_outstanding"

    listed = await owner.get("/api/v1/finance/receivables")
    assert listed.json()["data"][0]["outstanding_amount"] == "80.00"


async def test_agent_can_read_finances_but_cannot_create_bookings(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    _owner, agent = finance_clients

    dashboard = await agent.get("/api/v1/finance/dashboard")
    mutation = await agent.post(
        "/api/v1/finance/transactions",
        json={
            "direction": "income",
            "amount": "20.00",
            "booked_on": date.today().isoformat(),
            "counterparty": "Test",
            "category": "Test",
        },
    )

    assert dashboard.status_code == 200
    assert mutation.status_code == 403
    assert mutation.json()["error"]["code"] == "owner_scope_required"


async def test_payment_history_and_reversal_remain_visible(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, _agent = finance_clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Mara Beispiel",
            "original_amount": "120.00",
            "description": "Geteilte Unterkunft",
        },
    )
    receivable = created.json()["data"]

    paid = await owner.post(
        f"/api/v1/finance/receivables/{receivable['id']}/payments",
        json={
            "expected_version": receivable["version"],
            "amount": "40.00",
            "booked_on": date.today().isoformat(),
            "purpose": "Erste Rate für die Unterkunft",
            "payment_method": "bank_transfer",
            "note": "Überweisung geprüft",
        },
    )
    assert paid.status_code == 201
    detail = paid.json()["data"]
    assert detail["version"] == 2
    assert detail["payments"][0]["purpose"] == "Erste Rate für die Unterkunft"
    assert detail["payments"][0]["reversal"] is None
    assert [event["event_type"] for event in detail["history"]] == [
        "payment_recorded",
        "created",
    ]

    reversed_payment = await owner.post(
        f"/api/v1/finance/receivables/{receivable['id']}/payments/"
        f"{detail['payments'][0]['id']}/reverse",
        json={
            "expected_version": detail["version"],
            "reason": "Zahlung wurde dem falschen offenen Betrag zugeordnet",
        },
    )
    assert reversed_payment.status_code == 200
    corrected = reversed_payment.json()["data"]
    assert corrected["received_amount"] == "0.00"
    assert corrected["outstanding_amount"] == "120.00"
    assert corrected["payments"][0]["reversal"]["reason"].startswith("Zahlung wurde")
    assert corrected["history"][0]["event_type"] == "payment_reversed"


async def test_agent_proposes_payment_and_owner_approves_it(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, agent = finance_clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Noah Beispiel",
            "original_amount": "75.00",
            "description": "Gemeinsamer Einkauf",
        },
    )
    receivable = created.json()["data"]

    direct_payment = await agent.post(
        f"/api/v1/finance/receivables/{receivable['id']}/payments",
        json={
            "expected_version": receivable["version"],
            "amount": "25.00",
            "booked_on": date.today().isoformat(),
            "purpose": "Teilzahlung Einkauf",
            "payment_method": "cash",
        },
    )
    assert direct_payment.status_code == 403

    malformed = await agent.post(
        "/api/v1/finance/change-proposals",
        json={
            "action": "payment_record",
            "receivable_id": receivable["id"],
            "expected_version": receivable["version"],
            "rationale": "Gemischte Aktionen dürfen nicht akzeptiert werden.",
            "changes": {"description": "Nicht gleichzeitig ändern"},
            "payment": {
                "amount": "25.00",
                "booked_on": date.today().isoformat(),
                "purpose": "Teilzahlung Einkauf",
                "payment_method": "cash",
            },
        },
    )
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "validation_error"

    proposed = await agent.post(
        "/api/v1/finance/change-proposals",
        json={
            "action": "payment_record",
            "receivable_id": receivable["id"],
            "expected_version": receivable["version"],
            "rationale": "Eine Barzahlung über 25 Euro wurde bestätigt.",
            "payment": {
                "amount": "25.00",
                "booked_on": date.today().isoformat(),
                "purpose": "Teilzahlung Einkauf",
                "payment_method": "cash",
                "note": "Vom Agenten zur Prüfung vorgeschlagen",
            },
        },
    )
    assert proposed.status_code == 201
    proposal = proposed.json()["data"]
    assert proposal["status"] == "pending"

    listed = await owner.get("/api/v1/finance/change-proposals?pending_only=true")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["id"] == proposal["id"]

    approved = await owner.post(f"/api/v1/finance/change-proposals/{proposal['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["data"]["status"] == "approved"

    detail = await agent.get(f"/api/v1/finance/receivables/{receivable['id']}")
    assert detail.status_code == 200
    data = detail.json()["data"]
    assert data["received_amount"] == "25.00"
    assert data["payments"][0]["actor_type"] == "agent"
    assert data["payments"][0]["proposal_id"] == proposal["id"]
    assert data["history"][0]["details"]["approved_by"] == "owner"


async def test_stale_agent_proposal_cannot_overwrite_newer_owner_change(
    finance_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, agent = finance_clients
    created = await owner.post(
        "/api/v1/finance/receivables",
        json={
            "debtor_name": "Kim Beispiel",
            "original_amount": "50.00",
            "description": "Taxi",
        },
    )
    receivable = created.json()["data"]
    proposed = await agent.post(
        "/api/v1/finance/change-proposals",
        json={
            "action": "receivable_update",
            "receivable_id": receivable["id"],
            "expected_version": 1,
            "rationale": "Der Zweck kann genauer beschrieben werden.",
            "changes": {
                "description": "Taxi zum Bahnhof",
            },
        },
    )
    assert proposed.status_code == 201

    owner_change = await owner.patch(
        f"/api/v1/finance/receivables/{receivable['id']}",
        json={"expected_version": 1, "due_date": date.today().isoformat()},
    )
    assert owner_change.status_code == 200

    approval = await owner.post(
        f"/api/v1/finance/change-proposals/{proposed.json()['data']['id']}/approve"
    )
    assert approval.status_code == 409
    assert approval.json()["error"]["code"] == "stale_receivable_version"
