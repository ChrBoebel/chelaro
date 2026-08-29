from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import require_owner
from finance_os_api.dependencies import get_database_session, get_document_storage
from finance_os_api.domain.models import Document
from finance_os_api.errors import ApiError
from finance_os_api.schemas import (
    DocumentListMeta,
    DocumentListResponse,
    DocumentResource,
    DocumentResponse,
)
from finance_os_api.services.document_storage import LocalDocumentStorage
from finance_os_api.services.documents import DocumentService

router = APIRouter(
    prefix="/api/v1/documents",
    tags=["documents"],
    dependencies=[Depends(require_owner)],
)

DocumentUpload = Annotated[UploadFile, File()]
DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
DocumentStorage = Annotated[LocalDocumentStorage, Depends(get_document_storage)]
CursorQuery = Annotated[str | None, Query()]
LimitQuery = Annotated[int, Query(ge=1, le=100)]


@router.post("", response_model=DocumentResponse, status_code=201)
async def upload_document(
    response: Response,
    file: DocumentUpload,
    session: DatabaseSession,
    storage: DocumentStorage,
) -> DocumentResponse:
    try:
        result = await DocumentService(storage).store(upload=file, session=session)
    finally:
        await file.close()

    if not result.created:
        response.status_code = 200
    response.headers["Location"] = f"/api/v1/documents/{result.document.public_id}"
    return DocumentResponse(data=as_resource(result.document))


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    session: DatabaseSession,
    storage: DocumentStorage,
    cursor: CursorQuery = None,
    limit: LimitQuery = 20,
) -> DocumentListResponse:
    documents, next_cursor = await DocumentService(storage).list(
        session=session,
        cursor=cursor,
        limit=limit,
    )
    return DocumentListResponse(
        data=[as_resource(document) for document in documents],
        meta=DocumentListMeta(
            has_next=next_cursor is not None,
            next_cursor=next_cursor,
        ),
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: UUID,
    session: DatabaseSession,
    storage: DocumentStorage,
) -> DocumentResponse:
    document = await DocumentService(storage).get(session=session, public_id=document_id)
    return DocumentResponse(data=as_resource(document))


@router.get("/{document_id}/content", response_class=FileResponse)
async def download_document(
    document_id: UUID,
    session: DatabaseSession,
    storage: DocumentStorage,
) -> FileResponse:
    document = await DocumentService(storage).get(session=session, public_id=document_id)
    path = storage.resolve(document.storage_key)
    if not path.is_file():
        raise ApiError(
            status_code=503,
            code="document_content_unavailable",
            message="Document content is temporarily unavailable.",
        )
    return FileResponse(
        path,
        media_type=document.content_type,
        filename=document.original_filename,
        content_disposition_type="attachment",
    )


def as_resource(document: Document) -> DocumentResource:
    return DocumentResource(
        id=document.public_id,
        filename=document.original_filename,
        content_type=document.content_type,
        size_bytes=document.size_bytes,
        sha256=document.sha256,
        status=document.status,
        created_at=document.created_at,
        download_url=f"/api/v1/documents/{document.public_id}/content",
    )
