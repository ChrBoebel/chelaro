from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.services.document_storage import LocalDocumentStorage


async def get_database_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.database.session_factory() as session:
        yield session


def get_document_storage(request: Request) -> LocalDocumentStorage:
    return request.app.state.document_storage
