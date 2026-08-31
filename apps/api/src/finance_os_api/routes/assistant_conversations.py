from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.assistant_conversation_schemas import (
    AssistantConversationCreate,
    AssistantConversationListResponse,
    AssistantConversationResponse,
    AssistantConversationUpdate,
    AssistantMessageListResponse,
)
from finance_os_api.auth import Actor, require_owner
from finance_os_api.dependencies import get_database_session
from finance_os_api.services.assistant_conversations import AssistantConversationService

router = APIRouter(prefix="/api/v1/assistant/conversations", tags=["assistant-conversations"])

DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
OwnerActor = Annotated[Actor, Depends(require_owner)]


@router.get("", response_model=AssistantConversationListResponse)
async def list_conversations(
    session: DatabaseSession,
    _actor: OwnerActor,
    status: Literal["active", "archived"] = "active",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AssistantConversationListResponse:
    data = await AssistantConversationService().list_conversations(
        session,
        status=status,
        limit=limit,
    )
    return AssistantConversationListResponse(data=data)


@router.post("", response_model=AssistantConversationResponse, status_code=201)
async def create_conversation(
    payload: AssistantConversationCreate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> AssistantConversationResponse:
    data = await AssistantConversationService().create(session, payload=payload, actor=actor)
    return AssistantConversationResponse(data=data)


@router.get("/{conversation_id}", response_model=AssistantConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    session: DatabaseSession,
    _actor: OwnerActor,
) -> AssistantConversationResponse:
    data = await AssistantConversationService().get(session, conversation_id)
    return AssistantConversationResponse(data=data)


@router.patch("/{conversation_id}", response_model=AssistantConversationResponse)
async def update_conversation(
    conversation_id: UUID,
    payload: AssistantConversationUpdate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> AssistantConversationResponse:
    data = await AssistantConversationService().update(
        session,
        conversation_id=conversation_id,
        payload=payload,
        actor=actor,
    )
    return AssistantConversationResponse(data=data)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: UUID,
    session: DatabaseSession,
    actor: OwnerActor,
) -> Response:
    await AssistantConversationService().delete_local_content(
        session,
        conversation_id=conversation_id,
        actor=actor,
    )
    return Response(status_code=204)


@router.get(
    "/{conversation_id}/messages",
    response_model=AssistantMessageListResponse,
)
async def list_conversation_messages(
    conversation_id: UUID,
    session: DatabaseSession,
    _actor: OwnerActor,
    before_sequence: Annotated[int | None, Query(ge=2)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> AssistantMessageListResponse:
    data, next_cursor = await AssistantConversationService().list_messages(
        session,
        conversation_id=conversation_id,
        before_sequence=before_sequence,
        limit=limit,
    )
    return AssistantMessageListResponse(data=data, next_before_sequence=next_cursor)
