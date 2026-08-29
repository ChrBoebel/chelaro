from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from finance_os_api.schemas import FinanceChangeProposalCreate


class FinanceAssistantTransaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    direction: Literal["income", "expense"]
    amount: Decimal
    currency: str
    booked_on: date
    counterparty: str
    category: str
    description: str | None
    receivable_id: UUID | None


class FinanceAssistantReceivable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    version: int
    debtor_name: str
    original_amount: Decimal
    received_amount: Decimal
    outstanding_amount: Decimal
    currency: str
    due_date: date | None
    description: str
    status: Literal["open", "partial", "paid", "overdue"]


class FinanceAssistantPayment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    amount: Decimal
    booked_on: date
    purpose: str
    payment_method: Literal["bank_transfer", "cash", "paypal", "card", "other"]
    note: str | None
    reversed_at: datetime | None


class FinanceAssistantReceivableEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["created", "details_updated", "payment_recorded", "payment_reversed"]
    created_at: datetime


class FinanceAssistantReceivableDetail(FinanceAssistantReceivable):
    payments: list[FinanceAssistantPayment]
    history: list[FinanceAssistantReceivableEvent]
    pending_proposals: int


class FinanceAssistantDashboardPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    start: date
    end: date


class FinanceAssistantDashboardSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    income: Decimal
    expenses: Decimal
    net: Decimal
    outstanding_receivables: Decimal
    overdue_receivables: int
    pending_finance_proposals: int
    currency: str


class FinanceAssistantCashflowPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    label: str
    income: Decimal
    expenses: Decimal
    net: Decimal


class FinanceAssistantDashboard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: FinanceAssistantDashboardPeriod
    summary: FinanceAssistantDashboardSummary
    cashflow: list[FinanceAssistantCashflowPoint]
    open_receivables: list[FinanceAssistantReceivable]
    recent_transactions: list[FinanceAssistantTransaction]


class FinanceAssistantDashboardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: FinanceAssistantDashboard


class FinanceAssistantTransactionListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[FinanceAssistantTransaction]


class FinanceAssistantReceivableListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[FinanceAssistantReceivable]


class FinanceAssistantReceivableDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: FinanceAssistantReceivableDetail


class FinanceAssistantProposalCreate(FinanceChangeProposalCreate):
    idempotency_key: UUID
    provider_thread_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    provider_turn_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    provider_call_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


class FinanceAssistantProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    action: Literal[
        "receivable_create", "receivable_update", "payment_record", "payment_reverse"
    ]
    receivable_id: UUID | None
    debtor_name: str
    expected_version: int | None
    current_version: int | None
    status: Literal["pending", "approved", "rejected"]


class FinanceAssistantProposalResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: FinanceAssistantProposal
