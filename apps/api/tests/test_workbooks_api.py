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

PDF_BYTES = b"%PDF-1.4\n% synthetic workbook integration fixture\n%%EOF\n"
OWNER_TOKEN = "workbook-owner-token"
AGENT_TOKEN = "workbook-agent-token"
TEST_DATABASE_URL = os.getenv("FINANCE_OS_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="FINANCE_OS_TEST_DATABASE_URL is not configured",
)


@pytest.fixture(autouse=True)
async def clean_workbook_tables() -> AsyncIterator[None]:
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
async def workbook_clients(
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


async def test_owner_edits_and_agent_proposals_are_versioned_and_atomic(
    workbook_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, agent = workbook_clients
    uploaded = await owner.post(
        "/api/v1/documents",
        files={"file": ("invoice.pdf", PDF_BYTES, "application/pdf")},
    )
    document = uploaded.json()["data"]

    workbook_response = await agent.get("/api/v1/workbooks/invoices")
    assert workbook_response.status_code == 200
    row = workbook_response.json()["data"]["rows"][0]
    assert row["document_id"] == document["id"]
    assert row["version"] == 1
    assert row["status"] == "unverified"

    changed = await owner.post(
        "/api/v1/workbooks/invoices/change-sets",
        json={
            "changes": [
                {
                    "row_id": row["id"],
                    "expected_version": 1,
                    "cells": {
                        "vendor": "Stadtwerke",
                        "gross_amount": "84.20",
                        "invoice_date": "2026-08-01",
                    },
                }
            ]
        },
    )
    assert changed.status_code == 201
    changed_row = changed.json()["data"]["rows"][0]
    assert changed_row["version"] == 2
    assert changed_row["gross_amount"] == "84.20"

    stale = await owner.post(
        "/api/v1/workbooks/invoices/change-sets",
        json={
            "changes": [
                {
                    "row_id": row["id"],
                    "expected_version": 1,
                    "cells": {"category": "Wohnen"},
                }
            ]
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_workbook_version"

    proposed = await agent.post(
        "/api/v1/workbooks/invoices/change-proposals",
        json={
            "rationale": "Der Beleg ist als bezahlt markiert.",
            "changes": [
                {
                    "row_id": row["id"],
                    "expected_version": 2,
                    "cells": {"status": "paid", "category": "Wohnen"},
                }
            ],
        },
    )
    assert proposed.status_code == 201
    proposal = proposed.json()["data"]
    assert proposal["status"] == "pending"
    assert len(proposal["items"]) == 2

    unchanged = await owner.get("/api/v1/workbooks/invoices")
    unchanged_row = unchanged.json()["data"]["rows"][0]
    assert unchanged_row["status"] == "unverified"
    assert unchanged.json()["data"]["pending_proposals"] == 1

    approved = await owner.post(f"/api/v1/change-proposals/{proposal['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["data"]["status"] == "approved"

    final_workbook = await owner.get("/api/v1/workbooks/invoices")
    final_row = final_workbook.json()["data"]["rows"][0]
    assert final_row["version"] == 3
    assert final_row["status"] == "paid"
    assert final_row["category"] == "Wohnen"

    downloaded = await owner.get(document["download_url"])
    assert downloaded.content == PDF_BYTES
    assert document["sha256"] == uploaded.json()["data"]["sha256"]


async def test_agent_cannot_mutate_directly_or_read_original_documents(
    workbook_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    _owner, agent = workbook_clients

    direct_edit = await agent.post(
        "/api/v1/workbooks/invoices/change-sets",
        json={"changes": []},
    )
    documents = await agent.get("/api/v1/documents")

    assert direct_edit.status_code == 403
    assert direct_edit.json()["error"]["code"] == "owner_scope_required"
    assert documents.status_code == 403
    assert documents.json()["error"]["code"] == "owner_scope_required"


async def test_stale_agent_proposal_cannot_overwrite_owner_edit(
    workbook_clients: tuple[AsyncClient, AsyncClient],
) -> None:
    owner, agent = workbook_clients
    uploaded = await owner.post(
        "/api/v1/documents",
        files={"file": ("invoice.pdf", PDF_BYTES, "application/pdf")},
    )
    assert uploaded.status_code == 201
    row = (await owner.get("/api/v1/workbooks/invoices")).json()["data"]["rows"][0]

    proposed = await agent.post(
        "/api/v1/workbooks/invoices/change-proposals",
        json={
            "rationale": "Vermutete Kategorie",
            "changes": [
                {
                    "row_id": row["id"],
                    "expected_version": 1,
                    "cells": {"category": "Arbeit"},
                }
            ],
        },
    )
    proposal_id = proposed.json()["data"]["id"]

    owner_change = await owner.post(
        "/api/v1/workbooks/invoices/change-sets",
        json={
            "changes": [
                {
                    "row_id": row["id"],
                    "expected_version": 1,
                    "cells": {"category": "Privat"},
                }
            ]
        },
    )
    assert owner_change.status_code == 201

    approval = await owner.post(f"/api/v1/change-proposals/{proposal_id}/approve")
    assert approval.status_code == 409
    assert approval.json()["error"]["code"] == "stale_workbook_version"

    current = (await owner.get("/api/v1/workbooks/invoices")).json()["data"]["rows"][0]
    assert current["category"] == "Privat"
    assert current["version"] == 2
