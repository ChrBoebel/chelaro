from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor, require_agent, require_owner, require_owner_or_agent
from finance_os_api.dependencies import get_database_session
from finance_os_api.schemas import (
    AgentChangeProposalRequest,
    ChangeProposalListResponse,
    ChangeProposalResponse,
    InvoiceWorkbookResponse,
    WorkbookChangeSetRequest,
    WorkbookChangeSetResponse,
)
from finance_os_api.services.workbooks import WorkbookService

router = APIRouter(prefix="/api/v1", tags=["workbooks"])

DatabaseSession = Annotated[AsyncSession, Depends(get_database_session)]
AuthenticatedActor = Annotated[Actor, Depends(require_owner_or_agent)]
OwnerActor = Annotated[Actor, Depends(require_owner)]
AgentActor = Annotated[Actor, Depends(require_agent)]


@router.get("/workbooks/invoices", response_model=InvoiceWorkbookResponse)
async def get_invoice_workbook(
    session: DatabaseSession,
    _actor: AuthenticatedActor,
) -> InvoiceWorkbookResponse:
    workbook = await WorkbookService().get_invoice_workbook(session)
    return InvoiceWorkbookResponse(data=workbook)


@router.post(
    "/workbooks/invoices/change-sets",
    response_model=WorkbookChangeSetResponse,
    status_code=201,
)
async def apply_invoice_changes(
    payload: WorkbookChangeSetRequest,
    request: Request,
    session: DatabaseSession,
    actor: OwnerActor,
) -> WorkbookChangeSetResponse:
    change_set = await WorkbookService().apply_owner_changes(
        session=session,
        request=payload,
        actor=actor,
        request_id=UUID(request.state.request_id),
    )
    return WorkbookChangeSetResponse(data=change_set)


@router.post(
    "/workbooks/invoices/change-proposals",
    response_model=ChangeProposalResponse,
    status_code=201,
)
async def propose_invoice_changes(
    payload: AgentChangeProposalRequest,
    request: Request,
    session: DatabaseSession,
    actor: AgentActor,
) -> ChangeProposalResponse:
    proposal = await WorkbookService().create_proposal(
        session=session,
        request=payload,
        actor=actor,
        request_id=UUID(request.state.request_id),
    )
    return ChangeProposalResponse(data=proposal)


@router.get("/change-proposals", response_model=ChangeProposalListResponse)
async def list_change_proposals(
    session: DatabaseSession,
    _actor: OwnerActor,
) -> ChangeProposalListResponse:
    proposals = await WorkbookService().list_proposals(session)
    return ChangeProposalListResponse(data=proposals)


@router.post(
    "/change-proposals/{proposal_id}/approve",
    response_model=ChangeProposalResponse,
)
async def approve_change_proposal(
    proposal_id: UUID,
    request: Request,
    session: DatabaseSession,
    actor: OwnerActor,
) -> ChangeProposalResponse:
    proposal = await WorkbookService().approve_proposal(
        session=session,
        proposal_id=proposal_id,
        actor=actor,
        request_id=UUID(request.state.request_id),
    )
    return ChangeProposalResponse(data=proposal)


@router.post(
    "/change-proposals/{proposal_id}/reject",
    response_model=ChangeProposalResponse,
)
async def reject_change_proposal(
    proposal_id: UUID,
    session: DatabaseSession,
    _actor: OwnerActor,
) -> ChangeProposalResponse:
    proposal = await WorkbookService().reject_proposal(
        session=session,
        proposal_id=proposal_id,
    )
    return ChangeProposalResponse(data=proposal)
