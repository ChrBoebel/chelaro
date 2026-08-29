from collections.abc import AsyncIterator
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import AnyHttpUrl

from finance_os_api.config import Settings
from finance_os_api.main import create_app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app = create_app(
        Settings(
            env="test",
            api_title="Chelaro Test API",
            api_version="test",
            database_url="postgresql+asyncpg://test:test@127.0.0.1:1/test",
            web_origin=AnyHttpUrl("http://localhost:3000"),
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        yield test_client


async def test_health_status(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Chelaro Test API",
        "version": "test",
    }
    UUID(response.headers["x-request-id"])
    assert response.headers["cache-control"] == "no-store"


async def test_ready_reports_unavailable_database(client: AsyncClient) -> None:
    response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "database_unavailable",
            "message": "The database is unavailable.",
        }
    }


async def test_unknown_route_uses_stable_error_envelope(client: AsyncClient) -> None:
    response = await client.get("/missing")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "Resource not found."}
    }
    assert "x-request-id" in response.headers


async def test_cors_only_allows_configured_origin(client: AsyncClient) -> None:
    response = await client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
