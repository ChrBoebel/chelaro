from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from finance_os_api.config import Settings, get_settings
from finance_os_api.database import Database
from finance_os_api.errors import register_exception_handlers
from finance_os_api.middleware import install_http_middleware
from finance_os_api.routes import (
    banking,
    documents,
    finance_assistant,
    personal_finance,
    system,
    workbooks,
)
from finance_os_api.services.document_storage import LocalDocumentStorage


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    database = Database(runtime_settings.database_url)
    document_storage = LocalDocumentStorage(
        document_root=runtime_settings.document_root,
        quarantine_root=runtime_settings.quarantine_root,
        max_bytes=runtime_settings.max_upload_bytes,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        document_storage.prepare_directories()
        await database.prepare_schema()
        yield
        await database.dispose()

    app = FastAPI(
        title=runtime_settings.api_title,
        version=runtime_settings.api_version,
        docs_url="/docs" if runtime_settings.env != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.database = database
    app.state.document_storage = document_storage

    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )
    install_http_middleware(app)
    register_exception_handlers(app)
    app.include_router(system.router)
    app.include_router(documents.router)
    app.include_router(workbooks.router)
    app.include_router(personal_finance.router)
    app.include_router(finance_assistant.router)
    app.include_router(banking.router)
    return app


app = create_app()
