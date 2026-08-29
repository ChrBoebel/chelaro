from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor
from finance_os_api.domain.models import (
    ChangeProposal,
    ChangeProposalItem,
    ChangeSet,
    ChangeSetItem,
    Document,
    InvoiceRecord,
)
from finance_os_api.errors import ApiError
from finance_os_api.schemas import (
    AgentChangeProposalRequest,
    ChangeProposalItemResource,
    ChangeProposalResource,
    InvoiceCellPatch,
    InvoiceWorkbookResource,
    InvoiceWorkbookRow,
    WorkbookChangeSetRequest,
    WorkbookChangeSetResource,
    WorkbookColumn,
)

INVOICE_COLUMNS = [
    WorkbookColumn(key="document", label="Beleg", data_type="document", editable=False, width=260),
    WorkbookColumn(key="vendor", label="Aussteller", data_type="text", editable=True, width=190),
    WorkbookColumn(
        key="invoice_number",
        label="Rechnungsnr.",
        data_type="text",
        editable=True,
        width=150,
    ),
    WorkbookColumn(key="invoice_date", label="Datum", data_type="date", editable=True, width=140),
    WorkbookColumn(key="gross_amount", label="Brutto", data_type="money", editable=True, width=140),
    WorkbookColumn(key="currency", label="Währung", data_type="currency", editable=True, width=110),
    WorkbookColumn(
        key="category",
        label="Kategorie",
        data_type="category",
        editable=True,
        width=160,
    ),
    WorkbookColumn(
        key="status",
        label="Status",
        data_type="status",
        editable=True,
        width=150,
        options=["unverified", "verified", "open", "paid", "archived"],
    ),
    WorkbookColumn(key="notes", label="Notiz", data_type="text", editable=True, width=240),
]


@dataclass(frozen=True, slots=True)
class InvoiceWithDocument:
    invoice: InvoiceRecord
    document: Document


@dataclass(frozen=True, slots=True)
class CellDiff:
    invoice: InvoiceRecord
    field: str
    before: object | None
    after: object | None


class WorkbookService:
    async def get_invoice_workbook(self, session: AsyncSession) -> InvoiceWorkbookResource:
        statement = (
            select(InvoiceRecord, Document)
            .join(Document, Document.id == InvoiceRecord.document_id)
            .order_by(InvoiceRecord.id.desc())
        )
        pairs = [
            InvoiceWithDocument(invoice=invoice, document=document)
            for invoice, document in (await session.execute(statement)).tuples()
        ]
        pending_proposals = await session.scalar(
            select(func.count())
            .select_from(ChangeProposal)
            .where(ChangeProposal.status == "pending")
        )
        return InvoiceWorkbookResource(
            columns=INVOICE_COLUMNS,
            rows=[as_workbook_row(pair) for pair in pairs],
            pending_proposals=pending_proposals or 0,
        )

    async def apply_owner_changes(
        self,
        *,
        session: AsyncSession,
        request: WorkbookChangeSetRequest,
        actor: Actor,
        request_id: UUID,
    ) -> WorkbookChangeSetResource:
        invoices = await self._lock_invoices(session, request)
        diffs = build_diffs(request, invoices)
        if not diffs:
            raise ApiError(
                status_code=422,
                code="no_effect",
                message="The change set does not alter any cells.",
            )

        change_set = ChangeSet(
            actor_type=actor.type,
            actor_id=actor.id,
            action="owner_edit",
            request_id=request_id,
        )
        session.add(change_set)
        await session.flush()
        apply_diffs(diffs)
        for diff in diffs:
            session.add(
                ChangeSetItem(
                    change_set_id=change_set.id,
                    invoice_record_id=diff.invoice.id,
                    field_name=diff.field,
                    before_value=jsonable_encoder(diff.before),
                    after_value=jsonable_encoder(diff.after),
                )
            )

        bump_changed_rows(diffs)
        await session.commit()
        documents = await self._documents_for_invoices(session, invoices.values())
        return WorkbookChangeSetResource(
            id=change_set.public_id,
            rows=[
                as_workbook_row(
                    InvoiceWithDocument(invoice, documents[invoice.document_id])
                )
                for invoice in invoices.values()
            ],
        )

    async def create_proposal(
        self,
        *,
        session: AsyncSession,
        request: AgentChangeProposalRequest,
        actor: Actor,
        request_id: UUID,
    ) -> ChangeProposalResource:
        invoices = await self._lock_invoices(session, request)
        diffs = build_diffs(request, invoices)
        if not diffs:
            raise ApiError(
                status_code=422,
                code="no_effect",
                message="The proposal does not alter any cells.",
            )

        proposal = ChangeProposal(
            agent_id=actor.id,
            rationale=request.rationale,
            status="pending",
            request_id=request_id,
        )
        session.add(proposal)
        await session.flush()
        for diff in diffs:
            session.add(
                ChangeProposalItem(
                    proposal_id=proposal.id,
                    invoice_record_id=diff.invoice.id,
                    field_name=diff.field,
                    before_value=jsonable_encoder(diff.before),
                    proposed_value=jsonable_encoder(diff.after),
                    expected_version=diff.invoice.version,
                )
            )
        await session.commit()
        await session.refresh(proposal)
        return proposal_resource(proposal, diffs)

    async def list_proposals(self, session: AsyncSession) -> list[ChangeProposalResource]:
        proposals = list(
            (
                await session.scalars(
                    select(ChangeProposal).order_by(ChangeProposal.created_at.desc()).limit(100)
                )
            ).all()
        )
        if not proposals:
            return []
        return [await self._load_proposal_resource(session, proposal) for proposal in proposals]

    async def approve_proposal(
        self,
        *,
        session: AsyncSession,
        proposal_id: UUID,
        actor: Actor,
        request_id: UUID,
    ) -> ChangeProposalResource:
        proposal = await self._lock_proposal(session, proposal_id)
        items = list(
            (
                await session.scalars(
                    select(ChangeProposalItem).where(
                        ChangeProposalItem.proposal_id == proposal.id
                    )
                )
            ).all()
        )
        invoice_ids = {item.invoice_record_id for item in items}
        invoices = {
            invoice.id: invoice
            for invoice in (
                await session.scalars(
                    select(InvoiceRecord)
                    .where(InvoiceRecord.id.in_(invoice_ids))
                    .with_for_update()
                )
            ).all()
        }

        diffs: list[CellDiff] = []
        for item in items:
            invoice = invoices[item.invoice_record_id]
            if invoice.version != item.expected_version:
                raise stale_version_error(invoice.public_id, item.expected_version, invoice.version)
            patch = InvoiceCellPatch.model_validate({item.field_name: item.proposed_value})
            typed_value = patch.model_dump(exclude_unset=True)[item.field_name]
            diffs.append(
                CellDiff(
                    invoice=invoice,
                    field=item.field_name,
                    before=getattr(invoice, item.field_name),
                    after=typed_value,
                )
            )

        change_set = ChangeSet(
            actor_type=actor.type,
            actor_id=actor.id,
            action="proposal_approved",
            proposal_public_id=proposal.public_id,
            request_id=request_id,
        )
        session.add(change_set)
        await session.flush()
        apply_diffs(diffs)
        for diff in diffs:
            session.add(
                ChangeSetItem(
                    change_set_id=change_set.id,
                    invoice_record_id=diff.invoice.id,
                    field_name=diff.field,
                    before_value=jsonable_encoder(diff.before),
                    after_value=jsonable_encoder(diff.after),
                )
            )
        bump_changed_rows(diffs)
        proposal.status = "approved"
        proposal.decided_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(proposal)
        return await self._load_proposal_resource(session, proposal)

    async def reject_proposal(
        self,
        *,
        session: AsyncSession,
        proposal_id: UUID,
    ) -> ChangeProposalResource:
        proposal = await self._lock_proposal(session, proposal_id)
        proposal.status = "rejected"
        proposal.decided_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(proposal)
        return await self._load_proposal_resource(session, proposal)

    async def _lock_invoices(
        self,
        session: AsyncSession,
        request: WorkbookChangeSetRequest,
    ) -> dict[UUID, InvoiceRecord]:
        requested = {change.row_id: change.expected_version for change in request.changes}
        invoices = {
            invoice.public_id: invoice
            for invoice in (
                await session.scalars(
                    select(InvoiceRecord)
                    .where(InvoiceRecord.public_id.in_(requested))
                    .with_for_update()
                )
            ).all()
        }
        missing = set(requested) - set(invoices)
        if missing:
            raise ApiError(
                status_code=404,
                code="workbook_row_not_found",
                message="One or more workbook rows were not found.",
            )
        for row_id, expected_version in requested.items():
            invoice = invoices[row_id]
            if invoice.version != expected_version:
                raise stale_version_error(row_id, expected_version, invoice.version)
        return invoices

    async def _lock_proposal(
        self,
        session: AsyncSession,
        proposal_id: UUID,
    ) -> ChangeProposal:
        proposal = await session.scalar(
            select(ChangeProposal)
            .where(ChangeProposal.public_id == proposal_id)
            .with_for_update()
        )
        if proposal is None:
            raise ApiError(
                status_code=404,
                code="change_proposal_not_found",
                message="Change proposal not found.",
            )
        if proposal.status != "pending":
            raise ApiError(
                status_code=409,
                code="change_proposal_decided",
                message="This change proposal has already been decided.",
            )
        return proposal

    async def _load_proposal_resource(
        self,
        session: AsyncSession,
        proposal: ChangeProposal,
    ) -> ChangeProposalResource:
        items = list(
            (
                await session.scalars(
                    select(ChangeProposalItem)
                    .where(ChangeProposalItem.proposal_id == proposal.id)
                    .order_by(ChangeProposalItem.id)
                )
            ).all()
        )
        invoice_ids = {item.invoice_record_id for item in items}
        invoices = {
            invoice.id: invoice
            for invoice in (
                await session.scalars(
                    select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
                )
            ).all()
        }
        return ChangeProposalResource(
            id=proposal.public_id,
            agent_id=proposal.agent_id,
            rationale=proposal.rationale,
            status=proposal.status,
            created_at=proposal.created_at,
            decided_at=proposal.decided_at,
            items=[
                ChangeProposalItemResource(
                    row_id=invoices[item.invoice_record_id].public_id,
                    field=item.field_name,
                    before=item.before_value,
                    proposed=item.proposed_value,
                    expected_version=item.expected_version,
                )
                for item in items
            ],
        )

    async def _documents_for_invoices(
        self,
        session: AsyncSession,
        invoices: Iterable[InvoiceRecord],
    ) -> dict[int, Document]:
        invoice_list = list(invoices)
        document_ids = {invoice.document_id for invoice in invoice_list}
        return {
            document.id: document
            for document in (
                await session.scalars(select(Document).where(Document.id.in_(document_ids)))
            ).all()
        }


def build_diffs(
    request: WorkbookChangeSetRequest,
    invoices: dict[UUID, InvoiceRecord],
) -> list[CellDiff]:
    diffs: list[CellDiff] = []
    for change in request.changes:
        invoice = invoices[change.row_id]
        for field, after in change.cells.model_dump(exclude_unset=True).items():
            before = getattr(invoice, field)
            if before != after:
                diffs.append(CellDiff(invoice=invoice, field=field, before=before, after=after))
    return diffs


def apply_diffs(diffs: list[CellDiff]) -> None:
    for diff in diffs:
        setattr(diff.invoice, diff.field, diff.after)


def bump_changed_rows(diffs: list[CellDiff]) -> None:
    invoices = {diff.invoice.id: diff.invoice for diff in diffs}.values()
    for invoice in invoices:
        invoice.version += 1
        invoice.updated_at = datetime.now(UTC)


def stale_version_error(row_id: UUID, expected: int, actual: int) -> ApiError:
    return ApiError(
        status_code=409,
        code="stale_workbook_version",
        message=f"Workbook row {row_id} changed from version {expected} to {actual}.",
    )


def as_workbook_row(pair: InvoiceWithDocument) -> InvoiceWorkbookRow:
    invoice = pair.invoice
    document = pair.document
    return InvoiceWorkbookRow(
        id=invoice.public_id,
        version=invoice.version,
        document_id=document.public_id,
        document_filename=document.original_filename,
        document_download_url=f"/api/v1/documents/{document.public_id}/content",
        vendor=invoice.vendor,
        invoice_number=invoice.invoice_number,
        invoice_date=invoice.invoice_date,
        gross_amount=invoice.gross_amount,
        currency=invoice.currency,
        category=invoice.category,
        status=invoice.status,
        notes=invoice.notes,
        updated_at=invoice.updated_at,
    )


def proposal_resource(proposal: ChangeProposal, diffs: list[CellDiff]) -> ChangeProposalResource:
    return ChangeProposalResource(
        id=proposal.public_id,
        agent_id=proposal.agent_id,
        rationale=proposal.rationale,
        status=proposal.status,
        created_at=proposal.created_at,
        decided_at=proposal.decided_at,
        items=[
            ChangeProposalItemResource(
                row_id=diff.invoice.public_id,
                field=diff.field,
                before=jsonable_encoder(diff.before),
                proposed=jsonable_encoder(diff.after),
                expected_version=diff.invoice.version,
            )
            for diff in diffs
        ],
    )
