from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor, require_finance_assistant
from finance_os_api.dependencies import get_database_session
from finance_os_api.finance_assistant_schemas import (
    FinanceAssistantCashflowPoint,
    FinanceAssistantDashboard,
    FinanceAssistantDashboardPeriod,
    FinanceAssistantDashboardResponse,
    FinanceAssistantDashboardSummary,
    FinanceAssistantPayment,
    FinanceAssistantProposal,
    FinanceAssistantProposalCreate,
    FinanceAssistantProposalResponse,
    FinanceAssistantReceivable,
    FinanceAssistantReceivableDetail,
    FinanceAssistantReceivableDetailResponse,
    FinanceAssistantReceivableEvent,
    FinanceAssistantReceivableListResponse,
    FinanceAssistantTransaction,
    FinanceAssistantTransactionListResponse,
)
from finance_os_api.schemas import (
    FinancialTransactionResource,
    ReceivableDetailResource,
    ReceivableResource,
)
from finance_os_api.services.personal_finance import PersonalFinanceService

router = APIRouter(
    prefix="/api/v1/finance-assistant",
    tags=["finance-assistant"],
)

DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
FinanceAssistantActor = Annotated[Actor, Depends(require_finance_assistant)]


@router.get("/overview", response_model=FinanceAssistantDashboardResponse)
async def get_overview(
    session: DatabaseSession,
    _actor: FinanceAssistantActor,
    period: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    currency: Annotated[str, Query(pattern=r"^[A-Z]{3}$")] = "EUR",
) -> FinanceAssistantDashboardResponse:
    dashboard = await PersonalFinanceService().get_dashboard(
        session,
        period_key=period,
        currency=currency,
    )
    return FinanceAssistantDashboardResponse(
        data=FinanceAssistantDashboard(
            period=FinanceAssistantDashboardPeriod.model_validate(dashboard.period.model_dump()),
            summary=FinanceAssistantDashboardSummary.model_validate(
                dashboard.summary.model_dump()
            ),
            cashflow=[
                FinanceAssistantCashflowPoint.model_validate(item.model_dump())
                for item in dashboard.cashflow[:12]
            ],
            open_receivables=[as_receivable(item) for item in dashboard.open_receivables[:20]],
            recent_transactions=[
                as_transaction(item) for item in dashboard.recent_transactions[:10]
            ],
        )
    )


@router.get("/transactions", response_model=FinanceAssistantTransactionListResponse)
async def list_transactions(
    session: DatabaseSession,
    _actor: FinanceAssistantActor,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
) -> FinanceAssistantTransactionListResponse:
    transactions = await PersonalFinanceService().list_transactions(session, limit=limit)
    return FinanceAssistantTransactionListResponse(
        data=[as_transaction(item) for item in transactions]
    )


@router.get("/receivables", response_model=FinanceAssistantReceivableListResponse)
async def list_receivables(
    session: DatabaseSession,
    _actor: FinanceAssistantActor,
    include_paid: bool = True,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
) -> FinanceAssistantReceivableListResponse:
    receivables = await PersonalFinanceService().list_receivables(
        session,
        include_paid=include_paid,
    )
    return FinanceAssistantReceivableListResponse(
        data=[as_receivable(item) for item in receivables[:limit]]
    )


@router.get(
    "/receivables/{receivable_id}",
    response_model=FinanceAssistantReceivableDetailResponse,
)
async def get_receivable(
    receivable_id: UUID,
    session: DatabaseSession,
    _actor: FinanceAssistantActor,
) -> FinanceAssistantReceivableDetailResponse:
    detail = await PersonalFinanceService().get_receivable(session, receivable_id)
    return FinanceAssistantReceivableDetailResponse(data=as_receivable_detail(detail))


@router.post("/proposals", response_model=FinanceAssistantProposalResponse, status_code=201)
async def create_proposal(
    payload: FinanceAssistantProposalCreate,
    request: Request,
    session: DatabaseSession,
    actor: FinanceAssistantActor,
) -> FinanceAssistantProposalResponse:
    proposal = await PersonalFinanceService().create_assistant_change_proposal(
        session,
        payload=payload,
        actor=actor,
        request_id=UUID(request.state.request_id),
    )
    return FinanceAssistantProposalResponse(
        data=FinanceAssistantProposal(
            id=proposal.id,
            action=proposal.action,
            receivable_id=proposal.receivable_id,
            debtor_name=proposal.debtor_name,
            expected_version=proposal.expected_version,
            current_version=proposal.current_version,
            status=proposal.status,
        )
    )


def as_transaction(item: FinancialTransactionResource) -> FinanceAssistantTransaction:
    return FinanceAssistantTransaction(
        id=item.id,
        direction=item.direction,
        amount=item.amount,
        currency=item.currency,
        booked_on=item.booked_on,
        counterparty=item.counterparty,
        category=item.category,
        description=item.description,
        receivable_id=item.receivable_id,
    )


def as_receivable(item: ReceivableResource) -> FinanceAssistantReceivable:
    return FinanceAssistantReceivable(
        id=item.id,
        version=item.version,
        debtor_name=item.debtor_name,
        original_amount=item.original_amount,
        received_amount=item.received_amount,
        outstanding_amount=item.outstanding_amount,
        currency=item.currency,
        due_date=item.due_date,
        description=item.description,
        status=item.status,
    )


def as_receivable_detail(item: ReceivableDetailResource) -> FinanceAssistantReceivableDetail:
    return FinanceAssistantReceivableDetail(
        **as_receivable(item).model_dump(),
        payments=[
            FinanceAssistantPayment(
                id=payment.id,
                amount=payment.amount,
                booked_on=payment.booked_on,
                purpose=payment.purpose,
                payment_method=payment.payment_method,
                note=payment.note,
                reversed_at=payment.reversal.created_at if payment.reversal else None,
            )
            for payment in item.payments[:50]
        ],
        history=[
            FinanceAssistantReceivableEvent(
                event_type=event.event_type,
                created_at=event.created_at,
            )
            for event in item.history[:50]
        ],
        pending_proposals=item.pending_proposals,
    )
