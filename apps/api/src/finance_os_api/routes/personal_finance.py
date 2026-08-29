from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor, require_agent, require_owner, require_owner_or_agent
from finance_os_api.dependencies import get_database_session
from finance_os_api.schemas import (
    FinanceChangeProposalCreate,
    FinanceChangeProposalListResponse,
    FinanceChangeProposalResponse,
    FinancialTransactionCreate,
    FinancialTransactionListResponse,
    FinancialTransactionResponse,
    PersonalFinanceDashboardResponse,
    ReceivableCreate,
    ReceivableDetailResponse,
    ReceivableListResponse,
    ReceivablePaymentCreate,
    ReceivablePaymentReversalCreate,
    ReceivableResponse,
    ReceivableUpdate,
)
from finance_os_api.services.personal_finance import PersonalFinanceService

router = APIRouter(prefix="/api/v1/finance", tags=["personal-finance"])

DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
AuthenticatedActor = Annotated[Actor, Depends(require_owner_or_agent)]
OwnerActor = Annotated[Actor, Depends(require_owner)]
AgentActor = Annotated[Actor, Depends(require_agent)]


@router.get("/dashboard", response_model=PersonalFinanceDashboardResponse)
async def get_dashboard(
    session: DatabaseSession,
    _actor: AuthenticatedActor,
    period: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    currency: Annotated[str, Query(pattern=r"^[A-Z]{3}$")] = "EUR",
) -> PersonalFinanceDashboardResponse:
    dashboard = await PersonalFinanceService().get_dashboard(
        session,
        period_key=period,
        currency=currency,
    )
    return PersonalFinanceDashboardResponse(data=dashboard)


@router.get("/transactions", response_model=FinancialTransactionListResponse)
async def list_transactions(
    session: DatabaseSession,
    _actor: AuthenticatedActor,
) -> FinancialTransactionListResponse:
    data = await PersonalFinanceService().list_transactions(session)
    return FinancialTransactionListResponse(data=data)


@router.post(
    "/transactions",
    response_model=FinancialTransactionResponse,
    status_code=201,
)
async def create_transaction(
    payload: FinancialTransactionCreate,
    session: DatabaseSession,
    _actor: OwnerActor,
) -> FinancialTransactionResponse:
    data = await PersonalFinanceService().create_transaction(session, payload)
    return FinancialTransactionResponse(data=data)


@router.get("/receivables", response_model=ReceivableListResponse)
async def list_receivables(
    session: DatabaseSession,
    _actor: AuthenticatedActor,
    include_paid: bool = True,
) -> ReceivableListResponse:
    data = await PersonalFinanceService().list_receivables(
        session,
        include_paid=include_paid,
    )
    return ReceivableListResponse(data=data)


@router.post("/receivables", response_model=ReceivableResponse, status_code=201)
async def create_receivable(
    payload: ReceivableCreate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> ReceivableResponse:
    data = await PersonalFinanceService().create_receivable(session, payload, actor)
    return ReceivableResponse(data=data)


@router.get("/receivables/{receivable_id}", response_model=ReceivableDetailResponse)
async def get_receivable(
    receivable_id: UUID,
    session: DatabaseSession,
    _actor: AuthenticatedActor,
) -> ReceivableDetailResponse:
    data = await PersonalFinanceService().get_receivable(session, receivable_id)
    return ReceivableDetailResponse(data=data)


@router.patch("/receivables/{receivable_id}", response_model=ReceivableDetailResponse)
async def update_receivable(
    receivable_id: UUID,
    payload: ReceivableUpdate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> ReceivableDetailResponse:
    data = await PersonalFinanceService().update_receivable(
        session,
        receivable_id=receivable_id,
        payload=payload,
        actor=actor,
    )
    return ReceivableDetailResponse(data=data)


@router.post(
    "/receivables/{receivable_id}/payments",
    response_model=ReceivableDetailResponse,
    status_code=201,
)
async def record_receivable_payment(
    receivable_id: UUID,
    payload: ReceivablePaymentCreate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> ReceivableDetailResponse:
    data = await PersonalFinanceService().record_receivable_payment(
        session,
        receivable_id=receivable_id,
        payload=payload,
        actor=actor,
    )
    return ReceivableDetailResponse(data=data)


@router.post(
    "/receivables/{receivable_id}/payments/{payment_id}/reverse",
    response_model=ReceivableDetailResponse,
)
async def reverse_receivable_payment(
    receivable_id: UUID,
    payment_id: UUID,
    payload: ReceivablePaymentReversalCreate,
    session: DatabaseSession,
    actor: OwnerActor,
) -> ReceivableDetailResponse:
    data = await PersonalFinanceService().reverse_receivable_payment(
        session,
        receivable_id=receivable_id,
        payment_id=payment_id,
        payload=payload,
        actor=actor,
    )
    return ReceivableDetailResponse(data=data)


@router.post(
    "/change-proposals",
    response_model=FinanceChangeProposalResponse,
    status_code=201,
)
async def create_finance_change_proposal(
    payload: FinanceChangeProposalCreate,
    request: Request,
    session: DatabaseSession,
    actor: AgentActor,
) -> FinanceChangeProposalResponse:
    data = await PersonalFinanceService().create_change_proposal(
        session,
        payload=payload,
        actor=actor,
        request_id=UUID(request.state.request_id),
    )
    return FinanceChangeProposalResponse(data=data)


@router.get(
    "/change-proposals",
    response_model=FinanceChangeProposalListResponse,
)
async def list_finance_change_proposals(
    session: DatabaseSession,
    _actor: OwnerActor,
    pending_only: bool = False,
) -> FinanceChangeProposalListResponse:
    data = await PersonalFinanceService().list_change_proposals(
        session,
        pending_only=pending_only,
    )
    return FinanceChangeProposalListResponse(data=data)


@router.post(
    "/change-proposals/{proposal_id}/approve",
    response_model=FinanceChangeProposalResponse,
)
async def approve_finance_change_proposal(
    proposal_id: UUID,
    request: Request,
    session: DatabaseSession,
    actor: OwnerActor,
) -> FinanceChangeProposalResponse:
    data = await PersonalFinanceService().approve_change_proposal(
        session,
        proposal_id=proposal_id,
        owner=actor,
        request_id=UUID(request.state.request_id),
    )
    return FinanceChangeProposalResponse(data=data)


@router.post(
    "/change-proposals/{proposal_id}/reject",
    response_model=FinanceChangeProposalResponse,
)
async def reject_finance_change_proposal(
    proposal_id: UUID,
    request: Request,
    session: DatabaseSession,
    actor: OwnerActor,
) -> FinanceChangeProposalResponse:
    data = await PersonalFinanceService().reject_change_proposal(
        session,
        proposal_id=proposal_id,
        owner=actor,
        request_id=UUID(request.state.request_id),
    )
    return FinanceChangeProposalResponse(data=data)
