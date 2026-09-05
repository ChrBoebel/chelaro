from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from typing import Literal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.assistant_conversation_schemas import (
    AssistantCompletedMessage,
    AssistantConversationCreate,
    AssistantConversationResource,
    AssistantConversationUpdate,
    AssistantMessageResource,
    AssistantProposalPayment,
    AssistantProposalResource,
    AssistantProviderRuntimeResource,
    AssistantTurnResource,
)
from finance_os_api.auth import Actor
from finance_os_api.domain.models import (
    AssistantActivity,
    AssistantConversation,
    AssistantConversationEvent,
    AssistantMessage,
    AssistantProviderRuntime,
    AssistantTurn,
    FinanceChangeProposal,
    Receivable,
    ReceivablePayment,
)
from finance_os_api.errors import ApiError
from finance_os_api.services.personal_finance import finance_proposal_resource

DEFAULT_TITLE = "Neue Unterhaltung"
MAX_ASSISTANT_MESSAGE_BYTES = 512 * 1024
MAX_ASSISTANT_TURN_BYTES = 1024 * 1024


class AssistantConversationService:
    async def list_proposals(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        before_id: int | None,
        limit: int,
    ) -> tuple[list[AssistantProposalResource], int | None]:
        conversation = await find_conversation(session, conversation_id)
        # Correlation comes from persisted host bindings, never model-written IDs.
        statement = (
            select(FinanceChangeProposal, Receivable, AssistantTurn.public_id)
            .join(
                AssistantProviderRuntime,
                AssistantProviderRuntime.provider_thread_id
                == FinanceChangeProposal.provider_thread_id,
            )
            .outerjoin(Receivable, Receivable.id == FinanceChangeProposal.receivable_id)
            .outerjoin(
                AssistantTurn,
                (AssistantTurn.conversation_id == conversation.id)
                & (AssistantTurn.provider_turn_id == FinanceChangeProposal.provider_turn_id),
            )
            .where(AssistantProviderRuntime.conversation_id == conversation.id)
            .order_by(FinanceChangeProposal.id.desc())
            .limit(limit + 1)
        )
        if before_id is not None:
            statement = statement.where(FinanceChangeProposal.id < before_id)
        rows = (await session.execute(statement)).all()
        payment_ids = {
            UUID(str(proposal.payload_json["payment_id"]))
            for proposal, _, _ in rows[:limit]
            if proposal.action == "payment_reverse"
        }
        payments = {
            (payment.receivable_id, str(payment.public_id)): AssistantProposalPayment(
                amount=payment.amount, booked_on=payment.booked_on, purpose=payment.purpose,
            )
            for payment in (
                await session.scalars(
                    select(ReceivablePayment).where(ReceivablePayment.public_id.in_(payment_ids))
                )
            ).all()
        } if payment_ids else {}
        return [
            AssistantProposalResource(
                proposal=finance_proposal_resource(proposal, receivable),
                turn_id=turn_id,
                currency=(
                    receivable.currency if receivable else str(proposal.payload_json["currency"])
                ),
                payment=payments.get((
                    proposal.receivable_id, str(proposal.payload_json.get("payment_id")),
                )),
            )
            for proposal, receivable, turn_id in rows[:limit]
        ], rows[limit - 1][0].id if len(rows) > limit else None

    async def create(
        self,
        session: AsyncSession,
        *,
        payload: AssistantConversationCreate,
        actor: Actor,
    ) -> AssistantConversationResource:
        conversation = AssistantConversation(
            title=normalized_title(payload.title) if payload.title is not None else DEFAULT_TITLE,
        )
        session.add(conversation)
        await session.flush()
        add_event(session, conversation, "created", actor)
        await session.commit()
        await session.refresh(conversation)
        return conversation_resource(conversation)

    async def list_conversations(
        self,
        session: AsyncSession,
        *,
        status: Literal["active", "archived"],
        limit: int,
    ) -> list[AssistantConversationResource]:
        items = (
            await session.scalars(
                select(AssistantConversation)
                .where(AssistantConversation.status == status)
                .order_by(
                    AssistantConversation.last_message_at.desc().nullslast(),
                    AssistantConversation.created_at.desc(),
                    AssistantConversation.id.desc(),
                )
                .limit(limit)
            )
        ).all()
        return [conversation_resource(item) for item in items]

    async def get(
        self,
        session: AsyncSession,
        conversation_id: UUID,
    ) -> AssistantConversationResource:
        return conversation_resource(await find_conversation(session, conversation_id))

    async def update(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        payload: AssistantConversationUpdate,
        actor: Actor,
    ) -> AssistantConversationResource:
        conversation = await lock_conversation(session, conversation_id)
        if conversation.version != payload.expected_version:
            raise ApiError(
                status_code=409,
                code="stale_conversation",
                message="The conversation changed since it was loaded.",
            )
        event_type: Literal["renamed", "archived", "restored"] | None = None
        details: dict[str, object] = {}
        if payload.title is not None:
            title = normalized_title(payload.title)
            if title != conversation.title:
                conversation.title = title
                event_type = "renamed"
        if payload.status is not None and payload.status != conversation.status:
            details["status"] = payload.status
            conversation.status = payload.status
            event_type = "archived" if payload.status == "archived" else "restored"
        if event_type is None:
            return conversation_resource(conversation)
        conversation.version += 1
        conversation.updated_at = now_utc()
        add_event(session, conversation, event_type, actor, details=details)
        await session.commit()
        await session.refresh(conversation)
        return conversation_resource(conversation)

    async def delete_local_content(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        actor: Actor,
    ) -> None:
        conversation = await lock_conversation(session, conversation_id)
        await session.execute(
            delete(AssistantActivity).where(AssistantActivity.conversation_id == conversation.id)
        )
        await session.execute(
            delete(AssistantTurn).where(AssistantTurn.conversation_id == conversation.id)
        )
        await session.execute(
            delete(AssistantMessage).where(AssistantMessage.conversation_id == conversation.id)
        )
        await session.execute(
            delete(AssistantProviderRuntime).where(
                AssistantProviderRuntime.conversation_id == conversation.id
            )
        )
        conversation.title = "Gelöschte Unterhaltung"
        conversation.status = "deleted"
        conversation.message_count = 0
        conversation.version += 1
        conversation.updated_at = now_utc()
        conversation.last_message_at = None
        conversation.deleted_at = conversation.updated_at
        add_event(session, conversation, "deleted", actor)
        await session.commit()

    async def list_messages(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        before_sequence: int | None,
        limit: int,
    ) -> tuple[list[AssistantMessageResource], int | None]:
        conversation = await find_conversation(session, conversation_id)
        statement = select(AssistantMessage).where(
            AssistantMessage.conversation_id == conversation.id
        )
        if before_sequence is not None:
            statement = statement.where(AssistantMessage.sequence < before_sequence)
        rows = list(
            (
                await session.scalars(
                    statement.order_by(AssistantMessage.sequence.desc()).limit(limit + 1)
                )
            ).all()
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        page.reverse()
        next_cursor = page[0].sequence if has_more and page else None
        return [message_resource(item) for item in page], next_cursor

    async def get_runtime(
        self,
        session: AsyncSession,
        conversation_id: UUID,
    ) -> AssistantProviderRuntimeResource:
        conversation = await find_conversation(session, conversation_id)
        runtime = await session.get(AssistantProviderRuntime, conversation.id)
        return _runtime_resource(conversation.public_id, runtime)

    async def bind_runtime(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        provider_thread_id: str,
        provider_model: str,
        provider_effort: str,
        provider_service_tier: str,
        actor: Actor,
    ) -> AssistantProviderRuntimeResource:
        conversation = await lock_conversation(session, conversation_id)
        runtime = await session.get(AssistantProviderRuntime, conversation.id)
        if runtime is None:
            existing_binding = await session.scalar(
                select(AssistantProviderRuntime).where(
                    AssistantProviderRuntime.provider_thread_id == provider_thread_id
                )
            )
            if existing_binding is not None:
                raise provider_binding_conflict()
            runtime = AssistantProviderRuntime(
                conversation_id=conversation.id,
                provider_thread_id=provider_thread_id,
                provider_model=provider_model,
                provider_effort=provider_effort,
                provider_service_tier=provider_service_tier,
            )
            session.add(runtime)
        elif runtime.provider_thread_id != provider_thread_id:
            raise provider_binding_conflict()
        else:
            # A resume may re-bind the same thread to a different verified
            # configuration; the audit records the change.
            runtime.provider_model = provider_model
            runtime.provider_effort = provider_effort
            runtime.provider_service_tier = provider_service_tier
        add_event(
            session,
            conversation,
            "provider_bound",
            actor,
            details={
                "provider": "codex",
                "model": provider_model,
                "effort": provider_effort,
                "service_tier": provider_service_tier,
            },
        )
        try:
            await session.commit()
        except IntegrityError as error:
            await session.rollback()
            raise provider_binding_conflict() from error
        return AssistantProviderRuntimeResource(
            conversation_id=conversation.public_id,
            provider_thread_id=provider_thread_id,
            provider_model=provider_model,
            provider_effort=provider_effort,  # type: ignore[arg-type]
            provider_service_tier=provider_service_tier,  # type: ignore[arg-type]
        )

    async def reserve_turn(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        turn_id: str,
        prompt: str,
        actor: Actor,
    ) -> tuple[AssistantTurnResource, bool]:
        fingerprint = sha256(prompt.encode("utf-8")).hexdigest()
        existing = await session.scalar(
            select(AssistantTurn).where(AssistantTurn.public_id == turn_id)
        )
        if existing is not None:
            conversation = await find_conversation(session, conversation_id)
            if (
                existing.conversation_id != conversation.id
                or existing.request_fingerprint != fingerprint
            ):
                raise idempotency_conflict()
            return turn_resource(conversation, existing), True

        conversation = await lock_conversation(session, conversation_id)
        if conversation.status != "active":
            raise ApiError(
                status_code=409,
                code="conversation_not_active",
                message="The conversation must be active before starting a turn.",
            )
        created_at = now_utc()
        sequence = conversation.message_count + 1
        user_message = AssistantMessage(
            conversation_id=conversation.id,
            turn_id=turn_id,
            sequence=sequence,
            role="user",
            status="complete",
            text=prompt,
            sha256=fingerprint,
            created_at=created_at,
        )
        session.add(user_message)
        await session.flush()
        turn = AssistantTurn(
            public_id=turn_id,
            conversation_id=conversation.id,
            user_message_id=user_message.id,
            status="reserved",
            request_fingerprint=fingerprint,
            created_at=created_at,
        )
        session.add(turn)
        conversation.message_count = sequence
        conversation.last_message_at = created_at
        conversation.updated_at = created_at
        conversation.version += 1
        if conversation.title == DEFAULT_TITLE:
            conversation.title = title_from_prompt(prompt)
        add_event(session, conversation, "turn_reserved", actor, turn_id=turn_id)
        await session.commit()
        return turn_resource(conversation, turn), False

    async def complete_turn(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        turn_id: str,
        provider_turn_id: str,
        messages: list[AssistantCompletedMessage],
        actor: Actor,
    ) -> AssistantTurnResource:
        conversation = await lock_conversation(session, conversation_id)
        turn = await lock_turn(session, conversation, turn_id)
        if turn.status == "completed":
            stored = list(
                (
                    await session.scalars(
                        select(AssistantMessage)
                        .where(
                            AssistantMessage.conversation_id == conversation.id,
                            AssistantMessage.turn_id == turn_id,
                            AssistantMessage.role == "assistant",
                        )
                        .order_by(AssistantMessage.sequence)
                    )
                ).all()
            )
            expected = [
                (message.message_id, message.sha256, message.text) for message in messages
            ]
            actual = [
                (message.provider_message_id, message.sha256, message.text)
                for message in stored
            ]
            if turn.provider_turn_id != provider_turn_id or actual != expected:
                raise idempotency_conflict()
            return turn_resource(conversation, turn)
        if turn.status not in {"reserved", "running"}:
            raise ApiError(
                status_code=409,
                code="turn_terminal",
                message="The conversation turn is already terminal.",
            )
        total_bytes = 0
        for message in messages:
            encoded = message.text.encode("utf-8")
            total_bytes += len(encoded)
            if len(encoded) > MAX_ASSISTANT_MESSAGE_BYTES or total_bytes > MAX_ASSISTANT_TURN_BYTES:
                raise ApiError(
                    status_code=413,
                    code="assistant_message_too_large",
                    message="The assistant response exceeds the local history limit.",
                )
            if sha256(encoded).hexdigest() != message.sha256:
                raise ApiError(
                    status_code=422,
                    code="assistant_message_digest_mismatch",
                    message="The assistant response digest does not match its text.",
                )
        created_at = now_utc()
        sequence = conversation.message_count
        for message in messages:
            sequence += 1
            session.add(
                AssistantMessage(
                    conversation_id=conversation.id,
                    turn_id=turn_id,
                    provider_message_id=message.message_id,
                    sequence=sequence,
                    role="assistant",
                    status="complete",
                    text=message.text,
                    sha256=message.sha256,
                    created_at=created_at,
                )
            )
        turn.status = "completed"
        turn.provider_turn_id = provider_turn_id
        turn.completed_at = created_at
        conversation.message_count = sequence
        conversation.last_message_at = created_at
        conversation.updated_at = created_at
        conversation.version += 1
        add_event(
            session,
            conversation,
            "turn_completed",
            actor,
            turn_id=turn_id,
            details={"assistant_message_count": len(messages)},
        )
        await session.commit()
        return turn_resource(conversation, turn)

    async def fail_turn(
        self,
        session: AsyncSession,
        *,
        conversation_id: UUID,
        turn_id: str,
        status: Literal["interrupted", "failed"],
        error_code: str,
        actor: Actor,
    ) -> AssistantTurnResource:
        conversation = await lock_conversation(session, conversation_id)
        turn = await lock_turn(session, conversation, turn_id)
        if turn.status in {"completed", "interrupted", "failed"}:
            return turn_resource(conversation, turn)
        turn.status = status
        turn.completed_at = now_utc()
        conversation.updated_at = turn.completed_at
        conversation.version += 1
        add_event(
            session,
            conversation,
            "turn_interrupted" if status == "interrupted" else "turn_failed",
            actor,
            turn_id=turn_id,
            details={"error_code": error_code},
        )
        await session.commit()
        return turn_resource(conversation, turn)


async def find_conversation(
    session: AsyncSession,
    conversation_id: UUID,
) -> AssistantConversation:
    conversation = await session.scalar(
        select(AssistantConversation).where(
            AssistantConversation.public_id == conversation_id,
            AssistantConversation.status != "deleted",
        )
    )
    if conversation is None:
        raise ApiError(
            status_code=404,
            code="conversation_not_found",
            message="The assistant conversation was not found.",
        )
    return conversation


async def lock_conversation(
    session: AsyncSession,
    conversation_id: UUID,
) -> AssistantConversation:
    conversation = await session.scalar(
        select(AssistantConversation)
        .where(
            AssistantConversation.public_id == conversation_id,
            AssistantConversation.status != "deleted",
        )
        .with_for_update()
    )
    if conversation is None:
        raise ApiError(
            status_code=404,
            code="conversation_not_found",
            message="The assistant conversation was not found.",
        )
    return conversation


async def lock_turn(
    session: AsyncSession,
    conversation: AssistantConversation,
    turn_id: str,
) -> AssistantTurn:
    turn = await session.scalar(
        select(AssistantTurn)
        .where(
            AssistantTurn.public_id == turn_id,
            AssistantTurn.conversation_id == conversation.id,
        )
        .with_for_update()
    )
    if turn is None:
        raise ApiError(
            status_code=404,
            code="turn_not_found",
            message="The assistant turn was not found.",
        )
    return turn


def conversation_resource(conversation: AssistantConversation) -> AssistantConversationResource:
    if conversation.status == "deleted":
        raise ApiError(
            status_code=404,
            code="conversation_not_found",
            message="The assistant conversation was not found.",
        )
    return AssistantConversationResource(
        id=conversation.public_id,
        version=conversation.version,
        title=conversation.title,
        status=conversation.status,
        message_count=conversation.message_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        last_message_at=conversation.last_message_at,
    )


def message_resource(message: AssistantMessage) -> AssistantMessageResource:
    return AssistantMessageResource(
        id=message.public_id,
        turn_id=message.turn_id,
        sequence=message.sequence,
        role=message.role,
        status=message.status,
        text=message.text,
        created_at=message.created_at,
    )


def turn_resource(
    conversation: AssistantConversation,
    turn: AssistantTurn,
) -> AssistantTurnResource:
    return AssistantTurnResource(
        conversation_id=conversation.public_id,
        turn_id=turn.public_id,
        status=turn.status,
    )


def add_event(
    session: AsyncSession,
    conversation: AssistantConversation,
    event_type: Literal[
        "created",
        "renamed",
        "archived",
        "restored",
        "deleted",
        "provider_bound",
        "turn_reserved",
        "turn_completed",
        "turn_interrupted",
        "turn_failed",
    ],
    actor: Actor,
    *,
    turn_id: str | None = None,
    details: dict[str, object] | None = None,
) -> None:
    session.add(
        AssistantConversationEvent(
            conversation_id=conversation.id,
            event_type=event_type,
            actor_type=actor.type,
            actor_id=actor.id,
            turn_id=turn_id,
            details_json=details or {},
        )
    )


def normalized_title(value: str) -> str:
    title = " ".join(value.split()).strip()
    if not title:
        raise ApiError(
            status_code=422,
            code="invalid_conversation_title",
            message="The conversation title must not be empty.",
        )
    return title[:120]


def title_from_prompt(prompt: str) -> str:
    normalized = " ".join(prompt.split()).strip()
    return normalized[:72] + ("…" if len(normalized) > 72 else "")


def now_utc() -> datetime:
    return datetime.now(UTC)


def idempotency_conflict() -> ApiError:
    return ApiError(
        status_code=409,
        code="idempotency_conflict",
        message="The turn identifier was already used for different content.",
    )


def provider_binding_conflict() -> ApiError:
    return ApiError(
        status_code=409,
        code="provider_thread_conflict",
        message="The provider thread is already bound to a conversation.",
    )


def _runtime_resource(
    conversation_public_id: UUID,
    runtime: AssistantProviderRuntime | None,
) -> AssistantProviderRuntimeResource:
    return AssistantProviderRuntimeResource(
        conversation_id=conversation_public_id,
        provider_thread_id=runtime.provider_thread_id if runtime else None,
        provider_model=runtime.provider_model if runtime else None,
        provider_effort=runtime.provider_effort if runtime else None,  # type: ignore[arg-type]
        provider_service_tier=(
            runtime.provider_service_tier if runtime else None  # type: ignore[arg-type]
        ),
    )
