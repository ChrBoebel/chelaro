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

PDF_BYTES = b"%PDF-1.4\n% synthetic finance os integration fixture\n%%EOF\n"
API_TOKEN = "integration-test-token"
TEST_DATABASE_URL = os.getenv("FINANCE_OS_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="FINANCE_OS_TEST_DATABASE_URL is not configured",
)


@pytest.fixture(autouse=True)
async def clean_documents() -> AsyncIterator[None]:
    assert TEST_DATABASE_URL is not None
    database_name = make_url(TEST_DATABASE_URL).database
    if database_name is None or not database_name.endswith("_test"):
        pytest.fail("Integration tests require a database name ending in _test")

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE TABLE finance_proposal_events, finance_change_proposals, "
                "receivable_events, "
                "receivable_payment_reversals, receivable_payments, financial_transactions, "
                "receivables, change_set_items, "
                "change_proposal_items, change_sets, change_proposals, invoice_records, "
                "documents RESTART IDENTITY"
            )
        )
    yield
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE TABLE finance_proposal_events, finance_change_proposals, "
                "receivable_events, "
                "receivable_payment_reversals, receivable_payments, financial_transactions, "
                "receivables, change_set_items, "
                "change_proposal_items, change_sets, change_proposals, invoice_records, "
                "documents RESTART IDENTITY"
            )
        )
    await engine.dispose()


@pytest.fixture
async def document_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    assert TEST_DATABASE_URL is not None
    app = create_app(
        Settings(
            env="test",
            api_title="Chelaro Test API",
            api_version="test",
            api_token=SecretStr(API_TOKEN),
            database_url=TEST_DATABASE_URL,
            document_root=tmp_path / "documents",
            quarantine_root=tmp_path / "quarantine",
            web_origin=AnyHttpUrl("http://localhost:3000"),
        )
    )
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {API_TOKEN}"},
        ) as client,
    ):
        yield client


async def test_document_end_to_end(document_client: AsyncClient) -> None:
    created = await document_client.post(
        "/api/v1/documents",
        files={"file": ("../../invoice.pdf", PDF_BYTES, "application/octet-stream")},
    )

    assert created.status_code == 201
    resource = created.json()["data"]
    assert resource["filename"] == "invoice.pdf"
    assert resource["content_type"] == "application/pdf"
    assert resource["status"] == "stored"
    assert created.headers["location"] == f"/api/v1/documents/{resource['id']}"

    duplicate = await document_client.post(
        "/api/v1/documents",
        files={"file": ("renamed.pdf", PDF_BYTES, "application/pdf")},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["data"]["id"] == resource["id"]

    listing = await document_client.get("/api/v1/documents")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()["data"]] == [resource["id"]]
    assert listing.json()["meta"] == {"has_next": False, "next_cursor": None}

    downloaded = await document_client.get(resource["download_url"])
    assert downloaded.status_code == 200
    assert downloaded.content == PDF_BYTES
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert downloaded.headers["cache-control"] == "no-store"


async def test_document_api_requires_valid_bearer_token(
    document_client: AsyncClient,
) -> None:
    response = await document_client.get(
        "/api/v1/documents",
        headers={"Authorization": "Bearer wrong-token"},
    )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "invalid_token"


async def test_rejects_spoofed_document_type(document_client: AsyncClient) -> None:
    response = await document_client.post(
        "/api/v1/documents",
        files={"file": ("invoice.pdf", b"plain text", "application/pdf")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_document_type"


async def test_rejects_invalid_pagination_cursor(document_client: AsyncClient) -> None:
    response = await document_client.get("/api/v1/documents?cursor=not-a-cursor")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_cursor"
