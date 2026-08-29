import base64
import binascii
from dataclasses import dataclass
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.domain.models import Document, InvoiceRecord
from finance_os_api.errors import ApiError
from finance_os_api.services.document_storage import LocalDocumentStorage


@dataclass(frozen=True, slots=True)
class StoredDocument:
    document: Document
    created: bool


class DocumentService:
    def __init__(self, storage: LocalDocumentStorage) -> None:
        self.storage = storage

    async def store(self, *, upload: UploadFile, session: AsyncSession) -> StoredDocument:
        staged = await self.storage.stage(upload)
        existing = await self._by_sha256(session, staged.sha256)
        if existing is not None:
            await self.storage.discard(staged)
            return StoredDocument(document=existing, created=False)

        storage_key = await self.storage.commit(staged)
        document = Document(
            sha256=staged.sha256,
            original_filename=staged.filename,
            content_type=staged.content_type,
            size_bytes=staged.size_bytes,
            storage_key=storage_key,
            status="stored",
        )
        session.add(document)
        try:
            await session.flush()
            session.add(InvoiceRecord(document_id=document.id))
            await session.commit()
        except IntegrityError:
            await session.rollback()
            duplicate = await self._by_sha256(session, staged.sha256)
            if duplicate is None:
                raise
            return StoredDocument(document=duplicate, created=False)
        await session.refresh(document)
        return StoredDocument(document=document, created=True)

    async def list(
        self,
        *,
        session: AsyncSession,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[Document], str | None]:
        cursor_id = decode_cursor(cursor) if cursor is not None else None
        statement = select(Document).order_by(Document.id.desc()).limit(limit + 1)
        if cursor_id is not None:
            statement = statement.where(Document.id < cursor_id)
        documents = list((await session.scalars(statement)).all())
        has_next = len(documents) > limit
        page = documents[:limit]
        next_cursor = encode_cursor(page[-1].id) if has_next and page else None
        return page, next_cursor

    async def get(self, *, session: AsyncSession, public_id: UUID) -> Document:
        document = await session.scalar(select(Document).where(Document.public_id == public_id))
        if document is None:
            raise ApiError(
                status_code=404,
                code="document_not_found",
                message="Document not found.",
            )
        return document

    async def _by_sha256(self, session: AsyncSession, sha256: str) -> Document | None:
        return await session.scalar(select(Document).where(Document.sha256 == sha256))


def encode_cursor(document_id: int) -> str:
    return base64.urlsafe_b64encode(str(document_id).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> int:
    try:
        padding = "=" * (-len(cursor) % 4)
        value = base64.urlsafe_b64decode(f"{cursor}{padding}").decode()
        document_id = int(value)
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise ApiError(
            status_code=422,
            code="invalid_cursor",
            message="The pagination cursor is invalid.",
        ) from exc
    if document_id < 1:
        raise ApiError(
            status_code=422,
            code="invalid_cursor",
            message="The pagination cursor is invalid.",
        )
    return document_id
