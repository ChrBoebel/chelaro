from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from finance_os_api.database_types import DATABASE_ID, MoneyAmount, postgresql_check


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="ck_documents_size_positive"),
        postgresql_check(
            "sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_documents_sha256_format",
        ),
        CheckConstraint("status IN ('stored')", name="ck_documents_status"),
        Index("ix_documents_created_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    status: Mapped[Literal["stored"]] = mapped_column(Text, nullable=False, default="stored")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class InvoiceRecord(Base):
    __tablename__ = "invoice_records"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_invoice_records_version_positive"),
        CheckConstraint("gross_amount >= 0", name="ck_invoice_records_amount_non_negative"),
        postgresql_check(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_invoice_records_currency_format",
        ),
        CheckConstraint(
            "status IN ('unverified', 'verified', 'open', 'paid', 'archived')",
            name="ck_invoice_records_status",
        ),
        Index("ix_invoice_records_updated_id", "updated_at", "id"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    vendor: Mapped[str | None] = mapped_column(Text)
    invoice_number: Mapped[str | None] = mapped_column(Text)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    gross_amount: Mapped[Decimal | None] = mapped_column(MoneyAmount())
    currency: Mapped[str] = mapped_column(
        String(3),
        nullable=False,
        default="EUR",
        server_default="EUR",
    )
    category: Mapped[str | None] = mapped_column(Text)
    status: Mapped[Literal["unverified", "verified", "open", "paid", "archived"]] = mapped_column(
        Text, nullable=False, default="unverified", server_default="unverified"
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ChangeSet(Base):
    __tablename__ = "change_sets"
    __table_args__ = (
        CheckConstraint("actor_type IN ('owner', 'agent')", name="ck_change_sets_actor_type"),
        CheckConstraint(
            "action IN ('owner_edit', 'proposal_approved')",
            name="ck_change_sets_action",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    actor_type: Mapped[Literal["owner", "agent"]] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[Literal["owner_edit", "proposal_approved"]] = mapped_column(
        Text,
        nullable=False,
    )
    proposal_public_id: Mapped[UUID | None] = mapped_column()
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ChangeSetItem(Base):
    __tablename__ = "change_set_items"

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    change_set_id: Mapped[int] = mapped_column(
        ForeignKey("change_sets.id", ondelete="RESTRICT"),
        nullable=False,
    )
    invoice_record_id: Mapped[int] = mapped_column(
        ForeignKey("invoice_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    field_name: Mapped[str] = mapped_column(Text, nullable=False)
    before_value: Mapped[object | None] = mapped_column(JSON)
    after_value: Mapped[object | None] = mapped_column(JSON)


class ChangeProposal(Base):
    __tablename__ = "change_proposals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_change_proposals_status",
        ),
        Index("ix_change_proposals_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[Literal["pending", "approved", "rejected"]] = mapped_column(
        Text,
        nullable=False,
        default="pending",
        server_default="pending",
    )
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChangeProposalItem(Base):
    __tablename__ = "change_proposal_items"
    __table_args__ = (
        Index(
            "uq_change_proposal_items_cell",
            "proposal_id",
            "invoice_record_id",
            "field_name",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    proposal_id: Mapped[int] = mapped_column(
        ForeignKey("change_proposals.id", ondelete="RESTRICT"),
        nullable=False,
    )
    invoice_record_id: Mapped[int] = mapped_column(
        ForeignKey("invoice_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    field_name: Mapped[str] = mapped_column(Text, nullable=False)
    before_value: Mapped[object | None] = mapped_column(JSON)
    proposed_value: Mapped[object | None] = mapped_column(JSON)
    expected_version: Mapped[int] = mapped_column(Integer, nullable=False)


class Receivable(Base):
    __tablename__ = "receivables"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_receivables_version_positive"),
        CheckConstraint("original_amount > 0", name="ck_receivables_amount_positive"),
        CheckConstraint("received_amount >= 0", name="ck_receivables_received_non_negative"),
        CheckConstraint(
            "received_amount <= original_amount",
            name="ck_receivables_received_within_total",
        ),
        postgresql_check(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_receivables_currency_format",
        ),
        CheckConstraint(
            "status IN ('open', 'partial', 'paid')",
            name="ck_receivables_status",
        ),
        Index("ix_receivables_status_due_date", "status", "due_date"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    debtor_name: Mapped[str] = mapped_column(Text, nullable=False)
    original_amount: Mapped[Decimal] = mapped_column(MoneyAmount(), nullable=False)
    received_amount: Mapped[Decimal] = mapped_column(
        MoneyAmount(),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    currency: Mapped[str] = mapped_column(
        String(3),
        nullable=False,
        default="EUR",
        server_default="EUR",
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[Literal["open", "partial", "paid"]] = mapped_column(
        Text,
        nullable=False,
        default="open",
        server_default="open",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class BankConnection(Base):
    __tablename__ = "bank_connections"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_bank_connections_version_positive"),
        CheckConstraint("provider IN ('fints')", name="ck_bank_connections_provider"),
        CheckConstraint("access_mode IN ('read_only')", name="ck_bank_connections_access_mode"),
        postgresql_check(
            "bank_code ~ '^[0-9]{8}$'",
            name="ck_bank_connections_bank_code",
        ),
        postgresql_check(
            "bic IS NULL OR bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'",
            name="ck_bank_connections_bic",
        ),
        CheckConstraint(
            "tan_method IN ('unknown', 'push_tan', 'chip_tan', 'other')",
            name="ck_bank_connections_tan_method",
        ),
        UniqueConstraint("provider", "bank_code", name="uq_bank_connections_provider_bank"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    provider: Mapped[Literal["fints"]] = mapped_column(
        Text,
        nullable=False,
        default="fints",
        server_default="fints",
    )
    access_mode: Mapped[Literal["read_only"]] = mapped_column(
        Text,
        nullable=False,
        default="read_only",
        server_default="read_only",
    )
    institution_name: Mapped[str] = mapped_column(Text, nullable=False)
    bank_code: Mapped[str] = mapped_column(String(8), nullable=False)
    bic: Mapped[str | None] = mapped_column(String(11))
    endpoint: Mapped[str | None] = mapped_column(Text)
    tan_method: Mapped[Literal["unknown", "push_tan", "chip_tan", "other"]] = mapped_column(
        Text,
        nullable=False,
        default="unknown",
        server_default="unknown",
    )
    transaction_access_confirmed: Mapped[bool | None] = mapped_column(Boolean)
    statement_access_confirmed: Mapped[bool | None] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class BankConnectionEvent(Base):
    __tablename__ = "bank_connection_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('created', 'updated')",
            name="ck_bank_connection_events_type",
        ),
        CheckConstraint(
            "actor_type IN ('owner', 'system')",
            name="ck_bank_connection_events_actor_type",
        ),
        Index("ix_bank_connection_events_connection_created", "connection_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("bank_connections.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[Literal["created", "updated"]] = mapped_column(Text, nullable=False)
    actor_type: Mapped[Literal["owner", "system"]] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    details_json: Mapped[dict[str, object]] = mapped_column("details", JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class FinancialTransaction(Base):
    __tablename__ = "financial_transactions"
    __table_args__ = (
        CheckConstraint("direction IN ('income', 'expense')", name="ck_transactions_direction"),
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        postgresql_check(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_transactions_currency_format",
        ),
        CheckConstraint("source IN ('manual', 'receivable')", name="ck_transactions_source"),
        Index("ix_transactions_booked_id", "booked_on", "id"),
        Index("ix_transactions_direction_booked", "direction", "booked_on"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    direction: Mapped[Literal["income", "expense"]] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MoneyAmount(), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3),
        nullable=False,
        default="EUR",
        server_default="EUR",
    )
    booked_on: Mapped[date] = mapped_column(Date, nullable=False)
    counterparty: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source: Mapped[Literal["manual", "receivable"]] = mapped_column(
        Text,
        nullable=False,
        default="manual",
        server_default="manual",
    )
    receivable_id: Mapped[int | None] = mapped_column(
        ForeignKey("receivables.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ReceivablePayment(Base):
    __tablename__ = "receivable_payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_receivable_payments_amount_positive"),
        CheckConstraint(
            "payment_method IN ('bank_transfer', 'cash', 'paypal', 'card', 'other')",
            name="ck_receivable_payments_method",
        ),
        CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')",
            name="ck_receivable_payments_actor_type",
        ),
        Index("ix_receivable_payments_receivable_created", "receivable_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    receivable_id: Mapped[int] = mapped_column(
        ForeignKey("receivables.id", ondelete="RESTRICT"),
        nullable=False,
    )
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("financial_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    amount: Mapped[Decimal] = mapped_column(MoneyAmount(), nullable=False)
    booked_on: Mapped[date] = mapped_column(Date, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    payment_method: Mapped[Literal["bank_transfer", "cash", "paypal", "card", "other"]] = (
        mapped_column(Text, nullable=False)
    )
    note: Mapped[str | None] = mapped_column(Text)
    actor_type: Mapped[Literal["owner", "agent", "system"]] = mapped_column(
        Text,
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    proposal_public_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ReceivablePaymentReversal(Base):
    __tablename__ = "receivable_payment_reversals"
    __table_args__ = (
        CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')",
            name="ck_receivable_payment_reversals_actor_type",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    payment_id: Mapped[int] = mapped_column(
        ForeignKey("receivable_payments.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("financial_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_type: Mapped[Literal["owner", "agent", "system"]] = mapped_column(
        Text,
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    proposal_public_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ReceivableEvent(Base):
    __tablename__ = "receivable_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('created', 'details_updated', 'payment_recorded', 'payment_reversed')",
            name="ck_receivable_events_type",
        ),
        CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')",
            name="ck_receivable_events_actor_type",
        ),
        Index("ix_receivable_events_receivable_created", "receivable_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    receivable_id: Mapped[int] = mapped_column(
        ForeignKey("receivables.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[
        Literal["created", "details_updated", "payment_recorded", "payment_reversed"]
    ] = mapped_column(Text, nullable=False)
    actor_type: Mapped[Literal["owner", "agent", "system"]] = mapped_column(
        Text,
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    proposal_public_id: Mapped[UUID | None] = mapped_column()
    details_json: Mapped[dict[str, object]] = mapped_column("details", JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class FinanceChangeProposal(Base):
    __tablename__ = "finance_change_proposals"
    __table_args__ = (
        CheckConstraint(
            "action IN ('receivable_create', 'receivable_update', "
            "'payment_record', 'payment_reverse')",
            name="ck_finance_change_proposals_action",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_finance_change_proposals_status",
        ),
        CheckConstraint(
            "(action = 'receivable_create' AND expected_version IS NULL) OR "
            "(action <> 'receivable_create' AND expected_version > 0)",
            name="ck_finance_change_proposals_version_binding",
        ),
        CheckConstraint(
            "action = 'receivable_create' OR receivable_id IS NOT NULL",
            name="ck_finance_change_proposals_receivable_binding",
        ),
        UniqueConstraint(
            "idempotency_key",
            name="uq_finance_change_proposals_idempotency_key",
        ),
        Index("ix_finance_change_proposals_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(
        default=uuid4,
        nullable=False,
        unique=True,
    )
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[
        Literal["receivable_create", "receivable_update", "payment_record", "payment_reverse"]
    ] = mapped_column(Text, nullable=False)
    receivable_id: Mapped[int | None] = mapped_column(
        ForeignKey("receivables.id", ondelete="RESTRICT"),
        nullable=True,
    )
    expected_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[dict[str, object]] = mapped_column("payload", JSON, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[Literal["pending", "approved", "rejected"]] = mapped_column(
        Text,
        nullable=False,
        default="pending",
        server_default="pending",
    )
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    idempotency_key: Mapped[UUID | None] = mapped_column()
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    provider_thread_id: Mapped[str | None] = mapped_column(String(128))
    provider_turn_id: Mapped[str | None] = mapped_column(String(128))
    provider_call_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FinanceProposalEvent(Base):
    __tablename__ = "finance_proposal_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('created', 'approved', 'rejected')",
            name="ck_finance_proposal_events_type",
        ),
        CheckConstraint(
            "actor_type IN ('owner', 'agent', 'finance_assistant', 'system')",
            name="ck_finance_proposal_events_actor_type",
        ),
        Index("ix_finance_proposal_events_proposal_created", "proposal_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(default=uuid4, nullable=False, unique=True)
    proposal_id: Mapped[int] = mapped_column(
        ForeignKey("finance_change_proposals.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[Literal["created", "approved", "rejected"]] = mapped_column(
        Text,
        nullable=False,
    )
    actor_type: Mapped[Literal["owner", "agent", "finance_assistant", "system"]] = mapped_column(
        Text, nullable=False
    )
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    idempotency_key: Mapped[UUID | None] = mapped_column()
    provider_thread_id: Mapped[str | None] = mapped_column(String(128))
    provider_turn_id: Mapped[str | None] = mapped_column(String(128))
    provider_call_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_assistant_conversations_version_positive"),
        CheckConstraint(
            "status IN ('active', 'archived', 'deleted')",
            name="ck_assistant_conversations_status",
        ),
        CheckConstraint(
            "message_count >= 0",
            name="ck_assistant_conversations_message_count_non_negative",
        ),
        Index(
            "ix_assistant_conversations_status_activity",
            "status",
            "last_message_at",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(default=uuid4, nullable=False, unique=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[Literal["active", "archived", "deleted"]] = mapped_column(
        Text,
        nullable=False,
        default="active",
        server_default="active",
    )
    message_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        CheckConstraint("sequence > 0", name="ck_assistant_messages_sequence_positive"),
        CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_assistant_messages_role",
        ),
        CheckConstraint(
            "status IN ('complete', 'interrupted', 'failed')",
            name="ck_assistant_messages_status",
        ),
        postgresql_check(
            "sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_assistant_messages_sha256_format",
        ),
        UniqueConstraint(
            "conversation_id",
            "sequence",
            name="uq_assistant_messages_conversation_sequence",
        ),
        UniqueConstraint(
            "conversation_id",
            "turn_id",
            "provider_message_id",
            name="uq_assistant_messages_provider_message",
        ),
        Index(
            "ix_assistant_messages_conversation_sequence",
            "conversation_id",
            "sequence",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(default=uuid4, nullable=False, unique=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    turn_id: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(128))
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[Literal["user", "assistant"]] = mapped_column(Text, nullable=False)
    status: Mapped[Literal["complete", "interrupted", "failed"]] = mapped_column(
        Text,
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AssistantTurn(Base):
    __tablename__ = "assistant_turns"
    __table_args__ = (
        CheckConstraint(
            "status IN ('reserved', 'running', 'completed', 'interrupted', 'failed')",
            name="ck_assistant_turns_status",
        ),
        postgresql_check(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_assistant_turns_fingerprint_format",
        ),
        UniqueConstraint("public_id", name="uq_assistant_turns_public_id"),
        Index(
            "ix_assistant_turns_conversation_created",
            "conversation_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[str] = mapped_column(String(128), nullable=False)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_message_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_messages.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[Literal["reserved", "running", "completed", "interrupted", "failed"]] = (
        mapped_column(Text, nullable=False)
    )
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_turn_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssistantActivity(Base):
    __tablename__ = "assistant_activities"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('proposal_created', 'turn_interrupted', 'turn_failed')",
            name="ck_assistant_activities_kind",
        ),
        Index(
            "ix_assistant_activities_conversation_created",
            "conversation_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(default=uuid4, nullable=False, unique=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    turn_id: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[Literal["proposal_created", "turn_interrupted", "turn_failed"]] = mapped_column(
        Text, nullable=False
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    reference_public_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AssistantProviderRuntime(Base):
    __tablename__ = "assistant_provider_runtime"
    __table_args__ = (
        CheckConstraint("provider_name IN ('codex')", name="ck_assistant_runtime_provider"),
    )

    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    provider_name: Mapped[Literal["codex"]] = mapped_column(
        Text,
        nullable=False,
        default="codex",
        server_default="codex",
    )
    provider_thread_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AssistantConversationEvent(Base):
    __tablename__ = "assistant_conversation_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ("
            "'created', 'renamed', 'archived', 'restored', 'deleted', "
            "'provider_bound', 'turn_reserved', 'turn_completed', "
            "'turn_interrupted', 'turn_failed'"
            ")",
            name="ck_assistant_conversation_events_type",
        ),
        CheckConstraint(
            "actor_type IN ('owner', 'finance_assistant', 'system')",
            name="ck_assistant_conversation_events_actor_type",
        ),
        Index(
            "ix_assistant_conversation_events_conversation_created",
            "conversation_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(DATABASE_ID, Identity(), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(default=uuid4, nullable=False, unique=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[
        Literal[
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
        ]
    ] = mapped_column(Text, nullable=False)
    actor_type: Mapped[Literal["owner", "finance_assistant", "system"]] = mapped_column(
        Text,
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    turn_id: Mapped[str | None] = mapped_column(String(128))
    details_json: Mapped[dict[str, object]] = mapped_column("details", JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
