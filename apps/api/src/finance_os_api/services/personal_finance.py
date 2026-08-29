from datetime import UTC, date, datetime
from decimal import Decimal
from hashlib import sha256
from json import dumps
from typing import Literal
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor
from finance_os_api.database_types import MonthBucket
from finance_os_api.domain.models import (
    FinanceChangeProposal,
    FinanceProposalEvent,
    FinancialTransaction,
    Receivable,
    ReceivableEvent,
    ReceivablePayment,
    ReceivablePaymentReversal,
)
from finance_os_api.errors import ApiError
from finance_os_api.finance_assistant_schemas import FinanceAssistantProposalCreate
from finance_os_api.schemas import (
    CashflowPoint,
    DashboardPeriod,
    DashboardSummary,
    FinanceChangeProposalCreate,
    FinanceChangeProposalResource,
    FinancialTransactionCreate,
    FinancialTransactionResource,
    PersonalFinanceDashboardResource,
    ReceivableCreate,
    ReceivableDetailResource,
    ReceivableEventResource,
    ReceivablePaymentCreate,
    ReceivablePaymentInput,
    ReceivablePaymentResource,
    ReceivablePaymentReversalCreate,
    ReceivablePaymentReversalResource,
    ReceivableResource,
    ReceivableUpdate,
)

ZERO = Decimal("0.00")
GERMAN_MONTHS = [
    "",
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
]


class PersonalFinanceService:
    async def create_transaction(
        self,
        session: AsyncSession,
        payload: FinancialTransactionCreate,
    ) -> FinancialTransactionResource:
        transaction = FinancialTransaction(**payload.model_dump(), source="manual")
        session.add(transaction)
        await session.commit()
        await session.refresh(transaction)
        return await transaction_resource(session, transaction)

    async def list_transactions(
        self,
        session: AsyncSession,
        *,
        limit: int = 100,
    ) -> list[FinancialTransactionResource]:
        transactions = list(
            (
                await session.scalars(
                    select(FinancialTransaction)
                    .order_by(
                        FinancialTransaction.booked_on.desc(),
                        FinancialTransaction.id.desc(),
                    )
                    .limit(limit)
                )
            ).all()
        )
        receivable_ids = await receivable_public_ids(session, transactions)
        return [as_transaction_resource(item, receivable_ids) for item in transactions]

    async def create_receivable(
        self,
        session: AsyncSession,
        payload: ReceivableCreate,
        actor: Actor,
    ) -> ReceivableResource:
        receivable = Receivable(**payload.model_dump())
        session.add(receivable)
        await session.flush()
        add_event(
            session,
            receivable=receivable,
            event_type="created",
            actor=actor,
            details=payload.model_dump(),
        )
        await session.commit()
        await session.refresh(receivable)
        return as_receivable_resource(receivable)

    async def list_receivables(
        self,
        session: AsyncSession,
        *,
        include_paid: bool = True,
    ) -> list[ReceivableResource]:
        statement = select(Receivable)
        if not include_paid:
            statement = statement.where(Receivable.status != "paid")
        statement = statement.order_by(
            case((Receivable.status == "paid", 1), else_=0),
            Receivable.due_date.asc().nullslast(),
            Receivable.id.desc(),
        )
        return [
            as_receivable_resource(item)
            for item in (await session.scalars(statement.limit(100))).all()
        ]

    async def get_receivable(
        self,
        session: AsyncSession,
        receivable_id: UUID,
    ) -> ReceivableDetailResource:
        receivable = await find_receivable(session, receivable_id)
        return await receivable_detail_resource(session, receivable)

    async def update_receivable(
        self,
        session: AsyncSession,
        *,
        receivable_id: UUID,
        payload: ReceivableUpdate,
        actor: Actor,
    ) -> ReceivableDetailResource:
        receivable = await lock_receivable(
            session,
            receivable_id,
            expected_version=payload.expected_version,
        )
        apply_receivable_update(
            session,
            receivable=receivable,
            payload=payload,
            actor=actor,
        )
        await session.commit()
        await session.refresh(receivable)
        return await receivable_detail_resource(session, receivable)

    async def record_receivable_payment(
        self,
        session: AsyncSession,
        *,
        receivable_id: UUID,
        payload: ReceivablePaymentCreate,
        actor: Actor,
    ) -> ReceivableDetailResource:
        receivable = await lock_receivable(
            session,
            receivable_id,
            expected_version=payload.expected_version,
        )
        await apply_payment(
            session,
            receivable=receivable,
            payload=payload,
            actor=actor,
        )
        await session.commit()
        await session.refresh(receivable)
        return await receivable_detail_resource(session, receivable)

    async def reverse_receivable_payment(
        self,
        session: AsyncSession,
        *,
        receivable_id: UUID,
        payment_id: UUID,
        payload: ReceivablePaymentReversalCreate,
        actor: Actor,
    ) -> ReceivableDetailResource:
        receivable = await lock_receivable(
            session,
            receivable_id,
            expected_version=payload.expected_version,
        )
        await apply_payment_reversal(
            session,
            receivable=receivable,
            payment_id=payment_id,
            reason=payload.reason,
            actor=actor,
        )
        await session.commit()
        await session.refresh(receivable)
        return await receivable_detail_resource(session, receivable)

    async def create_change_proposal(
        self,
        session: AsyncSession,
        *,
        payload: FinanceChangeProposalCreate,
        actor: Actor,
        request_id: UUID,
    ) -> FinanceChangeProposalResource:
        receivable = await proposal_target(session, payload)
        proposal_payload = proposal_payload_json(payload)
        proposal = FinanceChangeProposal(
            agent_id=actor.id,
            action=payload.action,
            receivable_id=receivable.id if receivable is not None else None,
            expected_version=payload.expected_version,
            payload_json=proposal_payload,
            rationale=payload.rationale,
            request_id=request_id,
        )
        session.add(proposal)
        await session.flush()
        add_proposal_event(
            session,
            proposal=proposal,
            event_type="created",
            actor=actor,
            request_id=request_id,
        )
        await session.commit()
        await session.refresh(proposal)
        return finance_proposal_resource(proposal, receivable)

    async def create_assistant_change_proposal(
        self,
        session: AsyncSession,
        *,
        payload: FinanceAssistantProposalCreate,
        actor: Actor,
        request_id: UUID,
    ) -> FinanceChangeProposalResource:
        fingerprint = assistant_proposal_fingerprint(payload)
        existing = await proposal_by_idempotency_key(session, payload.idempotency_key)
        if existing is not None:
            return await resolve_idempotent_proposal(session, existing, fingerprint)

        receivable = await proposal_target(session, payload)
        proposal_payload = proposal_payload_json(payload)
        proposal = FinanceChangeProposal(
            agent_id=actor.id,
            action=payload.action,
            receivable_id=receivable.id if receivable is not None else None,
            expected_version=payload.expected_version,
            payload_json=proposal_payload,
            rationale=payload.rationale,
            request_id=request_id,
            idempotency_key=payload.idempotency_key,
            request_fingerprint=fingerprint,
            provider_thread_id=payload.provider_thread_id,
            provider_turn_id=payload.provider_turn_id,
            provider_call_id=payload.provider_call_id,
        )
        session.add(proposal)
        try:
            await session.flush()
            add_proposal_event(
                session,
                proposal=proposal,
                event_type="created",
                actor=actor,
                request_id=request_id,
            )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raced = await proposal_by_idempotency_key(session, payload.idempotency_key)
            if raced is None:
                raise
            return await resolve_idempotent_proposal(session, raced, fingerprint)
        await session.refresh(proposal)
        return finance_proposal_resource(proposal, receivable)

    async def list_change_proposals(
        self,
        session: AsyncSession,
        *,
        pending_only: bool = False,
    ) -> list[FinanceChangeProposalResource]:
        statement = select(FinanceChangeProposal).order_by(FinanceChangeProposal.created_at.desc())
        if pending_only:
            statement = statement.where(FinanceChangeProposal.status == "pending")
        proposals = list((await session.scalars(statement.limit(100))).all())
        if not proposals:
            return []
        receivable_ids = {
            proposal.receivable_id
            for proposal in proposals
            if proposal.receivable_id is not None
        }
        receivables = {
            item.id: item
            for item in (
                await session.scalars(
                    select(Receivable).where(
                        Receivable.id.in_(receivable_ids)
                    )
                )
            ).all()
        }
        return [
            finance_proposal_resource(
                proposal,
                receivables.get(proposal.receivable_id)
                if proposal.receivable_id is not None
                else None,
            )
            for proposal in proposals
        ]

    async def approve_change_proposal(
        self,
        session: AsyncSession,
        *,
        proposal_id: UUID,
        owner: Actor,
        request_id: UUID,
    ) -> FinanceChangeProposalResource:
        proposal = await lock_proposal(session, proposal_id)
        agent = Actor(type="agent", id=proposal.agent_id)
        receivable: Receivable

        if proposal.action == "receivable_create":
            create = ReceivableCreate.model_validate(proposal.payload_json)
            receivable = Receivable(**create.model_dump())
            session.add(receivable)
            await session.flush()
            proposal.receivable_id = receivable.id
            add_event(
                session,
                receivable=receivable,
                event_type="created",
                actor=agent,
                details={**create.model_dump(), "approved_by": owner.id},
                proposal_id=proposal.public_id,
            )
        else:
            if proposal.receivable_id is None or proposal.expected_version is None:
                raise receivable_not_found_error()
            existing = await session.scalar(
                select(Receivable)
                .where(Receivable.id == proposal.receivable_id)
                .with_for_update()
            )
            if existing is None:
                raise receivable_not_found_error()
            receivable = existing
            ensure_version(receivable, proposal.expected_version)

        if proposal.action == "receivable_update":
            assert proposal.expected_version is not None
            update = ReceivableUpdate.model_validate(
                {"expected_version": proposal.expected_version, **proposal.payload_json}
            )
            apply_receivable_update(
                session,
                receivable=receivable,
                payload=update,
                actor=agent,
                proposal_id=proposal.public_id,
                approved_by=owner,
            )
        elif proposal.action == "payment_record":
            payment = ReceivablePaymentInput.model_validate(proposal.payload_json)
            await apply_payment(
                session,
                receivable=receivable,
                payload=payment,
                actor=agent,
                proposal_id=proposal.public_id,
                approved_by=owner,
            )
        elif proposal.action == "payment_reverse":
            await apply_payment_reversal(
                session,
                receivable=receivable,
                payment_id=UUID(str(proposal.payload_json["payment_id"])),
                reason=str(proposal.payload_json["reason"]),
                actor=agent,
                proposal_id=proposal.public_id,
                approved_by=owner,
            )

        proposal.status = "approved"
        proposal.decided_at = datetime.now(UTC)
        add_proposal_event(
            session,
            proposal=proposal,
            event_type="approved",
            actor=owner,
            request_id=request_id,
        )
        await session.commit()
        await session.refresh(proposal)
        await session.refresh(receivable)
        return finance_proposal_resource(proposal, receivable)

    async def reject_change_proposal(
        self,
        session: AsyncSession,
        *,
        proposal_id: UUID,
        owner: Actor,
        request_id: UUID,
    ) -> FinanceChangeProposalResource:
        proposal = await lock_proposal(session, proposal_id)
        proposal.status = "rejected"
        proposal.decided_at = datetime.now(UTC)
        add_proposal_event(
            session,
            proposal=proposal,
            event_type="rejected",
            actor=owner,
            request_id=request_id,
        )
        await session.commit()
        await session.refresh(proposal)
        receivable = (
            await session.get(Receivable, proposal.receivable_id)
            if proposal.receivable_id is not None
            else None
        )
        return finance_proposal_resource(proposal, receivable)

    async def get_dashboard(
        self,
        session: AsyncSession,
        *,
        period_key: str | None,
        currency: str,
    ) -> PersonalFinanceDashboardResource:
        period_start = parse_period(period_key)
        period_end = add_months(period_start, 1)
        income_expression = func.coalesce(
            func.sum(
                case(
                    (FinancialTransaction.direction == "income", FinancialTransaction.amount),
                    else_=ZERO,
                )
            ),
            ZERO,
        )
        expense_expression = func.coalesce(
            func.sum(
                case(
                    (FinancialTransaction.direction == "expense", FinancialTransaction.amount),
                    else_=ZERO,
                )
            ),
            ZERO,
        )
        income, expenses = (
            await session.execute(
                select(income_expression, expense_expression).where(
                    FinancialTransaction.booked_on >= period_start,
                    FinancialTransaction.booked_on < period_end,
                    FinancialTransaction.currency == currency,
                )
            )
        ).one()

        open_receivables = list(
            (
                await session.scalars(
                    select(Receivable)
                    .where(
                        Receivable.status != "paid",
                        Receivable.currency == currency,
                    )
                    .order_by(Receivable.due_date.asc().nullslast(), Receivable.id.desc())
                    .limit(5)
                )
            ).all()
        )
        today = date.today()
        outstanding, overdue_count = (
            await session.execute(
                select(
                    func.coalesce(
                        func.sum(Receivable.original_amount - Receivable.received_amount),
                        ZERO,
                    ),
                    func.count().filter(Receivable.due_date < today),
                ).where(
                    Receivable.status != "paid",
                    Receivable.currency == currency,
                )
            )
        ).one()
        pending_proposals = await session.scalar(
            select(func.count())
            .select_from(FinanceChangeProposal)
            .where(FinanceChangeProposal.status == "pending")
        )

        recent = list(
            (
                await session.scalars(
                    select(FinancialTransaction)
                    .where(FinancialTransaction.currency == currency)
                    .order_by(
                        FinancialTransaction.booked_on.desc(),
                        FinancialTransaction.id.desc(),
                    )
                    .limit(6)
                )
            ).all()
        )
        receivable_ids = await receivable_public_ids(session, recent)

        return PersonalFinanceDashboardResource(
            period=DashboardPeriod(
                key=period_start.strftime("%Y-%m"),
                label=f"{GERMAN_MONTHS[period_start.month]} {period_start.year}",
                start=period_start,
                end=period_end,
            ),
            summary=DashboardSummary(
                income=income,
                expenses=expenses,
                net=income - expenses,
                outstanding_receivables=outstanding,
                overdue_receivables=overdue_count,
                pending_finance_proposals=pending_proposals or 0,
                currency=currency,
            ),
            cashflow=await self._cashflow(
                session,
                through=period_start,
                currency=currency,
            ),
            open_receivables=[as_receivable_resource(item) for item in open_receivables],
            recent_transactions=[as_transaction_resource(item, receivable_ids) for item in recent],
        )

    async def _cashflow(
        self,
        session: AsyncSession,
        *,
        through: date,
        currency: str,
    ) -> list[CashflowPoint]:
        months = [add_months(through, offset) for offset in range(-5, 1)]
        start = months[0]
        end = add_months(through, 1)
        month_expression = MonthBucket(FinancialTransaction.booked_on)
        rows = (
            await session.execute(
                select(
                    month_expression.label("month"),
                    FinancialTransaction.direction,
                    func.sum(FinancialTransaction.amount),
                )
                .where(
                    FinancialTransaction.booked_on >= start,
                    FinancialTransaction.booked_on < end,
                    FinancialTransaction.currency == currency,
                )
                .group_by(month_expression, FinancialTransaction.direction)
            )
        ).all()
        totals: dict[tuple[str, str], Decimal] = {
            (row.month.strftime("%Y-%m"), row.direction): row[2] for row in rows
        }
        return [
            CashflowPoint(
                month=month.strftime("%Y-%m"),
                label=GERMAN_MONTHS[month.month][:3],
                income=totals.get((month.strftime("%Y-%m"), "income"), ZERO),
                expenses=totals.get((month.strftime("%Y-%m"), "expense"), ZERO),
                net=totals.get((month.strftime("%Y-%m"), "income"), ZERO)
                - totals.get((month.strftime("%Y-%m"), "expense"), ZERO),
            )
            for month in months
        ]


async def apply_payment(
    session: AsyncSession,
    *,
    receivable: Receivable,
    payload: ReceivablePaymentInput,
    actor: Actor,
    proposal_id: UUID | None = None,
    approved_by: Actor | None = None,
) -> None:
    outstanding = receivable.original_amount - receivable.received_amount
    if payload.amount > outstanding:
        raise ApiError(
            status_code=422,
            code="payment_exceeds_outstanding",
            message="Payment exceeds the outstanding amount.",
        )

    transaction = FinancialTransaction(
        direction="income",
        amount=payload.amount,
        currency=receivable.currency,
        booked_on=payload.booked_on,
        counterparty=receivable.debtor_name,
        category="Rückzahlung",
        description=payload.purpose,
        source="receivable",
        receivable_id=receivable.id,
    )
    session.add(transaction)
    await session.flush()
    payment = ReceivablePayment(
        receivable_id=receivable.id,
        transaction_id=transaction.id,
        amount=payload.amount,
        booked_on=payload.booked_on,
        purpose=payload.purpose,
        payment_method=payload.payment_method,
        note=payload.note,
        actor_type=actor.type,
        actor_id=actor.id,
        proposal_public_id=proposal_id,
    )
    session.add(payment)
    await session.flush()
    receivable.received_amount += payload.amount
    set_receivable_status(receivable)
    bump_receivable(receivable)
    details = {
        "payment_id": payment.public_id,
        "amount": payload.amount,
        "booked_on": payload.booked_on,
        "purpose": payload.purpose,
        "payment_method": payload.payment_method,
        "note": payload.note,
    }
    if approved_by is not None:
        details["approved_by"] = approved_by.id
    add_event(
        session,
        receivable=receivable,
        event_type="payment_recorded",
        actor=actor,
        details=details,
        proposal_id=proposal_id,
    )


async def apply_payment_reversal(
    session: AsyncSession,
    *,
    receivable: Receivable,
    payment_id: UUID,
    reason: str,
    actor: Actor,
    proposal_id: UUID | None = None,
    approved_by: Actor | None = None,
) -> None:
    payment = await session.scalar(
        select(ReceivablePayment)
        .where(
            ReceivablePayment.public_id == payment_id,
            ReceivablePayment.receivable_id == receivable.id,
        )
        .with_for_update()
    )
    if payment is None:
        raise ApiError(
            status_code=404,
            code="receivable_payment_not_found",
            message="Payment not found.",
        )
    existing_reversal = await session.scalar(
        select(ReceivablePaymentReversal.id).where(
            ReceivablePaymentReversal.payment_id == payment.id
        )
    )
    if existing_reversal is not None:
        raise ApiError(
            status_code=409,
            code="payment_already_reversed",
            message="Payment is already reversed.",
        )

    transaction = FinancialTransaction(
        direction="expense",
        amount=payment.amount,
        currency=receivable.currency,
        booked_on=date.today(),
        counterparty=receivable.debtor_name,
        category="Zahlungskorrektur",
        description=reason,
        source="receivable",
        receivable_id=receivable.id,
    )
    session.add(transaction)
    await session.flush()
    reversal = ReceivablePaymentReversal(
        payment_id=payment.id,
        transaction_id=transaction.id,
        reason=reason,
        actor_type=actor.type,
        actor_id=actor.id,
        proposal_public_id=proposal_id,
    )
    session.add(reversal)
    await session.flush()
    receivable.received_amount -= payment.amount
    set_receivable_status(receivable)
    bump_receivable(receivable)
    details = {
        "payment_id": payment.public_id,
        "reversal_id": reversal.public_id,
        "amount": payment.amount,
        "reason": reason,
    }
    if approved_by is not None:
        details["approved_by"] = approved_by.id
    add_event(
        session,
        receivable=receivable,
        event_type="payment_reversed",
        actor=actor,
        details=details,
        proposal_id=proposal_id,
    )


def apply_receivable_update(
    session: AsyncSession,
    *,
    receivable: Receivable,
    payload: ReceivableUpdate,
    actor: Actor,
    proposal_id: UUID | None = None,
    approved_by: Actor | None = None,
) -> None:
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    if "original_amount" in changes and changes["original_amount"] < receivable.received_amount:
        raise ApiError(
            status_code=422,
            code="amount_below_received",
            message="Original amount cannot be lower than the received amount.",
        )
    diff = {
        field: {"before": getattr(receivable, field), "after": value}
        for field, value in changes.items()
        if getattr(receivable, field) != value
    }
    if not diff:
        raise ApiError(
            status_code=422,
            code="no_effect",
            message="The change does not alter the receivable.",
        )
    for field, value in changes.items():
        setattr(receivable, field, value)
    set_receivable_status(receivable)
    bump_receivable(receivable)
    details: dict[str, object] = {"changes": diff}
    if approved_by is not None:
        details["approved_by"] = approved_by.id
    add_event(
        session,
        receivable=receivable,
        event_type="details_updated",
        actor=actor,
        details=details,
        proposal_id=proposal_id,
    )


def add_event(
    session: AsyncSession,
    *,
    receivable: Receivable,
    event_type: Literal["created", "details_updated", "payment_recorded", "payment_reversed"],
    actor: Actor,
    details: object,
    proposal_id: UUID | None = None,
) -> None:
    session.add(
        ReceivableEvent(
            receivable_id=receivable.id,
            event_type=event_type,
            actor_type=actor.type,
            actor_id=actor.id,
            proposal_public_id=proposal_id,
            details_json=jsonable_encoder(details),
        )
    )


async def receivable_detail_resource(
    session: AsyncSession,
    receivable: Receivable,
) -> ReceivableDetailResource:
    payments = list(
        (
            await session.scalars(
                select(ReceivablePayment)
                .where(ReceivablePayment.receivable_id == receivable.id)
                .order_by(ReceivablePayment.booked_on.desc(), ReceivablePayment.id.desc())
            )
        ).all()
    )
    payment_ids = {payment.id for payment in payments}
    reversals = (
        {
            reversal.payment_id: reversal
            for reversal in (
                await session.scalars(
                    select(ReceivablePaymentReversal).where(
                        ReceivablePaymentReversal.payment_id.in_(payment_ids)
                    )
                )
            ).all()
        }
        if payment_ids
        else {}
    )
    transaction_ids = {payment.transaction_id for payment in payments} | {
        reversal.transaction_id for reversal in reversals.values()
    }
    transaction_public_ids = (
        {
            transaction_id: public_id
            for transaction_id, public_id in (
                await session.execute(
                    select(FinancialTransaction.id, FinancialTransaction.public_id).where(
                        FinancialTransaction.id.in_(transaction_ids)
                    )
                )
            ).tuples()
        }
        if transaction_ids
        else {}
    )
    history = list(
        (
            await session.scalars(
                select(ReceivableEvent)
                .where(ReceivableEvent.receivable_id == receivable.id)
                .order_by(ReceivableEvent.created_at.desc(), ReceivableEvent.id.desc())
            )
        ).all()
    )
    pending = await session.scalar(
        select(func.count())
        .select_from(FinanceChangeProposal)
        .where(
            FinanceChangeProposal.receivable_id == receivable.id,
            FinanceChangeProposal.status == "pending",
        )
    )
    return ReceivableDetailResource(
        **as_receivable_resource(receivable).model_dump(),
        payments=[
            payment_resource(
                payment,
                reversal=reversals.get(payment.id),
                transaction_public_ids=transaction_public_ids,
            )
            for payment in payments
        ],
        history=[event_resource(event) for event in history],
        pending_proposals=pending or 0,
    )


def payment_resource(
    payment: ReceivablePayment,
    *,
    reversal: ReceivablePaymentReversal | None,
    transaction_public_ids: dict[int, UUID],
) -> ReceivablePaymentResource:
    reversal_resource = (
        ReceivablePaymentReversalResource(
            id=reversal.public_id,
            transaction_id=transaction_public_ids[reversal.transaction_id],
            reason=reversal.reason,
            actor_type=reversal.actor_type,
            actor_id=reversal.actor_id,
            proposal_id=reversal.proposal_public_id,
            created_at=reversal.created_at,
        )
        if reversal is not None
        else None
    )
    return ReceivablePaymentResource(
        id=payment.public_id,
        transaction_id=transaction_public_ids[payment.transaction_id],
        amount=payment.amount,
        booked_on=payment.booked_on,
        purpose=payment.purpose,
        payment_method=payment.payment_method,
        note=payment.note,
        actor_type=payment.actor_type,
        actor_id=payment.actor_id,
        proposal_id=payment.proposal_public_id,
        created_at=payment.created_at,
        reversal=reversal_resource,
    )


def event_resource(event: ReceivableEvent) -> ReceivableEventResource:
    return ReceivableEventResource(
        id=event.public_id,
        event_type=event.event_type,
        actor_type=event.actor_type,
        actor_id=event.actor_id,
        proposal_id=event.proposal_public_id,
        details=event.details_json,
        created_at=event.created_at,
    )


def proposal_payload_json(payload: FinanceChangeProposalCreate) -> dict[str, object]:
    if payload.action == "receivable_create" and payload.receivable is not None:
        raw = payload.receivable.model_dump()
    elif payload.action == "receivable_update" and payload.changes is not None:
        raw = payload.changes.model_dump(exclude_unset=True)
    elif payload.action == "payment_record" and payload.payment is not None:
        raw = payload.payment.model_dump()
    else:
        raw = {"payment_id": payload.payment_id, "reason": payload.reversal_reason}
    return jsonable_encoder(raw, custom_encoder={Decimal: str})


async def proposal_target(
    session: AsyncSession,
    payload: FinanceChangeProposalCreate,
) -> Receivable | None:
    if payload.action == "receivable_create":
        return None
    if payload.receivable_id is None or payload.expected_version is None:
        raise ApiError(
            status_code=422,
            code="invalid_finance_proposal",
            message="An existing receivable and version are required.",
        )
    receivable = await find_receivable(session, payload.receivable_id)
    ensure_version(receivable, payload.expected_version)
    return receivable


def assistant_proposal_fingerprint(payload: FinanceAssistantProposalCreate) -> str:
    canonical = dumps(
        jsonable_encoder(
            payload.model_dump(exclude={"idempotency_key"}),
            custom_encoder={Decimal: str},
        ),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


async def proposal_by_idempotency_key(
    session: AsyncSession,
    idempotency_key: UUID,
) -> FinanceChangeProposal | None:
    return await session.scalar(
        select(FinanceChangeProposal).where(
            FinanceChangeProposal.idempotency_key == idempotency_key
        )
    )


async def resolve_idempotent_proposal(
    session: AsyncSession,
    proposal: FinanceChangeProposal,
    fingerprint: str,
) -> FinanceChangeProposalResource:
    if proposal.request_fingerprint != fingerprint:
        raise ApiError(
            status_code=409,
            code="idempotency_conflict",
            message="The idempotency key was already used for a different proposal.",
        )
    receivable = (
        await session.get(Receivable, proposal.receivable_id)
        if proposal.receivable_id is not None
        else None
    )
    return finance_proposal_resource(proposal, receivable)


def add_proposal_event(
    session: AsyncSession,
    *,
    proposal: FinanceChangeProposal,
    event_type: Literal["created", "approved", "rejected"],
    actor: Actor,
    request_id: UUID,
) -> None:
    session.add(
        FinanceProposalEvent(
            proposal_id=proposal.id,
            event_type=event_type,
            actor_type=actor.type,
            actor_id=actor.id,
            request_id=request_id,
            idempotency_key=proposal.idempotency_key,
            provider_thread_id=proposal.provider_thread_id,
            provider_turn_id=proposal.provider_turn_id,
            provider_call_id=proposal.provider_call_id,
        )
    )


def finance_proposal_resource(
    proposal: FinanceChangeProposal,
    receivable: Receivable | None,
) -> FinanceChangeProposalResource:
    if receivable is None and proposal.action != "receivable_create":
        raise receivable_not_found_error()
    debtor_name = (
        receivable.debtor_name
        if receivable is not None
        else ReceivableCreate.model_validate(proposal.payload_json).debtor_name
    )
    return FinanceChangeProposalResource(
        id=proposal.public_id,
        agent_id=proposal.agent_id,
        action=proposal.action,
        receivable_id=receivable.public_id if receivable is not None else None,
        debtor_name=debtor_name,
        expected_version=proposal.expected_version,
        current_version=receivable.version if receivable is not None else None,
        payload=proposal.payload_json,
        rationale=proposal.rationale,
        status=proposal.status,
        created_at=proposal.created_at,
        decided_at=proposal.decided_at,
    )


async def lock_proposal(
    session: AsyncSession,
    proposal_id: UUID,
) -> FinanceChangeProposal:
    proposal = await session.scalar(
        select(FinanceChangeProposal)
        .where(FinanceChangeProposal.public_id == proposal_id)
        .with_for_update()
    )
    if proposal is None:
        raise ApiError(
            status_code=404,
            code="finance_change_proposal_not_found",
            message="Proposal not found.",
        )
    if proposal.status != "pending":
        raise ApiError(
            status_code=409,
            code="finance_change_proposal_decided",
            message="Proposal is already decided.",
        )
    return proposal


async def find_receivable(session: AsyncSession, receivable_id: UUID) -> Receivable:
    receivable = await session.scalar(
        select(Receivable).where(Receivable.public_id == receivable_id)
    )
    if receivable is None:
        raise receivable_not_found_error()
    return receivable


async def lock_receivable(
    session: AsyncSession,
    receivable_id: UUID,
    *,
    expected_version: int,
) -> Receivable:
    receivable = await session.scalar(
        select(Receivable).where(Receivable.public_id == receivable_id).with_for_update()
    )
    if receivable is None:
        raise receivable_not_found_error()
    ensure_version(receivable, expected_version)
    return receivable


def ensure_version(receivable: Receivable, expected_version: int) -> None:
    if receivable.version != expected_version:
        raise ApiError(
            status_code=409,
            code="stale_receivable_version",
            message="Receivable changed since it was loaded.",
        )


def receivable_not_found_error() -> ApiError:
    return ApiError(
        status_code=404,
        code="receivable_not_found",
        message="Receivable not found.",
    )


def bump_receivable(receivable: Receivable) -> None:
    receivable.version += 1
    receivable.updated_at = datetime.now(UTC)


def set_receivable_status(receivable: Receivable) -> None:
    if receivable.received_amount == receivable.original_amount:
        receivable.status = "paid"
    elif receivable.received_amount > ZERO:
        receivable.status = "partial"
    else:
        receivable.status = "open"


def parse_period(period_key: str | None) -> date:
    if period_key is None:
        today = date.today()
        return date(today.year, today.month, 1)
    try:
        parsed = datetime.strptime(period_key, "%Y-%m").date()
    except ValueError as error:
        raise ApiError(
            status_code=422,
            code="invalid_dashboard_period",
            message="Period must use the YYYY-MM format.",
        ) from error
    return parsed.replace(day=1)


def add_months(value: date, offset: int) -> date:
    month_index = value.year * 12 + value.month - 1 + offset
    year, month = divmod(month_index, 12)
    return date(year, month + 1, 1)


def as_receivable_resource(receivable: Receivable) -> ReceivableResource:
    outstanding = receivable.original_amount - receivable.received_amount
    status: Literal["open", "partial", "paid", "overdue"] = receivable.status
    if status != "paid" and receivable.due_date and receivable.due_date < date.today():
        status = "overdue"
    return ReceivableResource(
        id=receivable.public_id,
        version=receivable.version,
        debtor_name=receivable.debtor_name,
        original_amount=receivable.original_amount,
        received_amount=receivable.received_amount,
        outstanding_amount=outstanding,
        currency=receivable.currency,
        due_date=receivable.due_date,
        description=receivable.description,
        status=status,
        created_at=receivable.created_at,
        updated_at=receivable.updated_at,
    )


async def transaction_resource(
    session: AsyncSession,
    transaction: FinancialTransaction,
) -> FinancialTransactionResource:
    ids = await receivable_public_ids(session, [transaction])
    return as_transaction_resource(transaction, ids)


def as_transaction_resource(
    transaction: FinancialTransaction,
    receivable_ids: dict[int, UUID],
) -> FinancialTransactionResource:
    return FinancialTransactionResource(
        id=transaction.public_id,
        direction=transaction.direction,
        amount=transaction.amount,
        currency=transaction.currency,
        booked_on=transaction.booked_on,
        counterparty=transaction.counterparty,
        category=transaction.category,
        description=transaction.description,
        source=transaction.source,
        receivable_id=(
            receivable_ids.get(transaction.receivable_id)
            if transaction.receivable_id is not None
            else None
        ),
        created_at=transaction.created_at,
    )


async def receivable_public_ids(
    session: AsyncSession,
    transactions: list[FinancialTransaction],
) -> dict[int, UUID]:
    ids = {item.receivable_id for item in transactions if item.receivable_id is not None}
    if not ids:
        return {}
    return {
        internal_id: public_id
        for internal_id, public_id in (
            await session.execute(
                select(Receivable.id, Receivable.public_id).where(Receivable.id.in_(ids))
            )
        ).tuples()
    }
