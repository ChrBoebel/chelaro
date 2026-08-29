from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor, require_owner
from finance_os_api.dependencies import get_database_session
from finance_os_api.schemas import (
    BankConnectionCreate,
    BankConnectionResponse,
    BankConnectionUpdate,
    BankingReadinessResponse,
)
from finance_os_api.services.banking import BankingService

router = APIRouter(prefix="/api/v1/banking", tags=["banking"])

DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
OwnerActor = Annotated[Actor, Depends(require_owner)]


@router.get("/readiness", response_model=BankingReadinessResponse)
async def get_banking_readiness(
    session: DatabaseSession,
    _actor: OwnerActor,
) -> BankingReadinessResponse:
    data = await BankingService().get_readiness(session)
    return BankingReadinessResponse(data=data)


@router.post(
    "/connections",
    response_model=BankConnectionResponse,
    status_code=201,
)
async def create_bank_connection(
    payload: BankConnectionCreate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> BankConnectionResponse:
    data = await BankingService().create_connection(session, payload=payload, actor=actor)
    return BankConnectionResponse(data=data)


@router.patch(
    "/connections/{connection_id}",
    response_model=BankConnectionResponse,
)
async def update_bank_connection(
    connection_id: UUID,
    payload: BankConnectionUpdate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> BankConnectionResponse:
    data = await BankingService().update_connection(
        session,
        connection_id=connection_id,
        payload=payload,
        actor=actor,
    )
    return BankConnectionResponse(data=data)
