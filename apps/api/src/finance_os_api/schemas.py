from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class ServiceStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "ready"]
    service: str
    version: str


class DocumentResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    status: Literal["stored"]
    created_at: datetime
    download_url: str


class DocumentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: DocumentResource


class DocumentListMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    has_next: bool
    next_cursor: str | None = None


class DocumentListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[DocumentResource]
    meta: DocumentListMeta


class WorkbookColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    data_type: Literal["text", "date", "money", "currency", "category", "status", "document"]
    editable: bool
    width: int
    options: list[str] | None = None


class InvoiceWorkbookRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    version: int
    document_id: UUID
    document_filename: str
    document_download_url: str
    vendor: str | None
    invoice_number: str | None
    invoice_date: date | None
    gross_amount: Decimal | None
    currency: str
    category: str | None
    status: Literal["unverified", "verified", "open", "paid", "archived"]
    notes: str | None
    updated_at: datetime


class InvoiceWorkbookResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["invoices"] = "invoices"
    name: str = "Rechnungen"
    version: int = 1
    columns: list[WorkbookColumn]
    rows: list[InvoiceWorkbookRow]
    pending_proposals: int


class InvoiceWorkbookResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: InvoiceWorkbookResource


class InvoiceCellPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor: str | None = Field(default=None, max_length=240)
    invoice_number: str | None = Field(default=None, max_length=120)
    invoice_date: date | None = None
    gross_amount: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    category: str | None = Field(default=None, max_length=120)
    status: Literal["unverified", "verified", "open", "paid", "archived"] = "unverified"
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def require_at_least_one_cell(self) -> "InvoiceCellPatch":
        if not (self.model_fields_set - {"expected_version"}):
            raise ValueError("At least one cell change is required")
        return self


class WorkbookRowChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_id: UUID
    expected_version: int = Field(ge=1)
    cells: InvoiceCellPatch


class WorkbookChangeSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: list[WorkbookRowChange] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def reject_duplicate_rows(self) -> "WorkbookChangeSetRequest":
        row_ids = [change.row_id for change in self.changes]
        if len(row_ids) != len(set(row_ids)):
            raise ValueError("A row may appear only once per change set")
        return self


class WorkbookChangeSetResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    rows: list[InvoiceWorkbookRow]


class WorkbookChangeSetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: WorkbookChangeSetResource


class AgentChangeProposalRequest(WorkbookChangeSetRequest):
    rationale: str = Field(min_length=1, max_length=2000)


class ChangeProposalItemResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_id: UUID
    field: str
    before: object | None
    proposed: object | None
    expected_version: int


class ChangeProposalResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    agent_id: str
    rationale: str
    status: Literal["pending", "approved", "rejected"]
    created_at: datetime
    decided_at: datetime | None
    items: list[ChangeProposalItemResource]


class ChangeProposalResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ChangeProposalResource


class ChangeProposalListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[ChangeProposalResource]


TanMethod = Literal["unknown", "push_tan", "chip_tan", "other"]


class BankConnectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["fints"] = "fints"
    access_mode: Literal["read_only"] = "read_only"
    institution_name: str = Field(min_length=1, max_length=240)
    bank_code: str = Field(pattern=r"^[0-9]{8}$")
    bic: str | None = Field(default=None, pattern=r"^[A-Z0-9]{8}([A-Z0-9]{3})?$")
    endpoint: HttpUrl | None = None
    tan_method: TanMethod = "unknown"
    transaction_access_confirmed: bool | None = None
    statement_access_confirmed: bool | None = None

    @field_validator("endpoint")
    @classmethod
    def require_https_endpoint(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("The FinTS endpoint must use HTTPS")
        return value


class BankConnectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    institution_name: str | None = Field(default=None, min_length=1, max_length=240)
    bank_code: str | None = Field(default=None, pattern=r"^[0-9]{8}$")
    bic: str | None = Field(default=None, pattern=r"^[A-Z0-9]{8}([A-Z0-9]{3})?$")
    endpoint: HttpUrl | None = None
    tan_method: TanMethod | None = None
    transaction_access_confirmed: bool | None = None
    statement_access_confirmed: bool | None = None

    @field_validator("endpoint")
    @classmethod
    def require_https_endpoint(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("The FinTS endpoint must use HTTPS")
        return value

    @model_validator(mode="after")
    def require_change(self) -> "BankConnectionUpdate":
        if not (self.model_fields_set - {"expected_version"}):
            raise ValueError("At least one bank connection change is required")
        for field in ("institution_name", "bank_code", "tan_method"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class BankConnectionResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    version: int
    provider: Literal["fints"]
    access_mode: Literal["read_only"]
    institution_name: str
    bank_code: str
    bic: str | None
    endpoint: str | None
    tan_method: TanMethod
    transaction_access_confirmed: bool | None
    statement_access_confirmed: bool | None
    created_at: datetime
    updated_at: datetime


class BankConnectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: BankConnectionResource


class BankingReadinessCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    label: str
    complete: bool
    detail: str


class BankingReadinessResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection: BankConnectionResource | None
    checks: list[BankingReadinessCheck]
    ready_for_live_sync: bool
    security_notice: str


class BankingReadinessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: BankingReadinessResource


class FinancialTransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    direction: Literal["income", "expense"]
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    booked_on: date
    counterparty: str = Field(min_length=1, max_length=240)
    category: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class FinancialTransactionResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    direction: Literal["income", "expense"]
    amount: Decimal
    currency: str
    booked_on: date
    counterparty: str
    category: str
    description: str | None
    source: Literal["manual", "receivable"]
    receivable_id: UUID | None
    created_at: datetime


class FinancialTransactionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: FinancialTransactionResource


class FinancialTransactionListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[FinancialTransactionResource]


class ReceivableCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    debtor_name: str = Field(min_length=1, max_length=240)
    original_amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    due_date: date | None = None
    description: str = Field(min_length=1, max_length=2000)


class ReceivableUpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    debtor_name: str | None = Field(default=None, min_length=1, max_length=240)
    original_amount: Decimal | None = Field(
        default=None,
        gt=0,
        max_digits=18,
        decimal_places=2,
    )
    due_date: date | None = None
    description: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def require_change(self) -> "ReceivableUpdateInput":
        if not self.model_fields_set:
            raise ValueError("At least one receivable change is required")
        return self


class ReceivableUpdate(ReceivableUpdateInput):
    expected_version: int = Field(ge=1)


class ReceivablePaymentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    booked_on: date
    purpose: str = Field(min_length=1, max_length=2000)
    payment_method: Literal["bank_transfer", "cash", "paypal", "card", "other"]
    note: str | None = Field(default=None, max_length=2000)


class ReceivablePaymentCreate(ReceivablePaymentInput):
    expected_version: int = Field(ge=1)


class ReceivablePaymentReversalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)


class ReceivableResource(BaseModel):
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
    created_at: datetime
    updated_at: datetime


class ReceivableResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ReceivableResource


class ReceivableListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[ReceivableResource]


class ReceivablePaymentReversalResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    transaction_id: UUID
    reason: str
    actor_type: Literal["owner", "agent", "system"]
    actor_id: str
    proposal_id: UUID | None
    created_at: datetime


class ReceivablePaymentResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    transaction_id: UUID
    amount: Decimal
    booked_on: date
    purpose: str
    payment_method: Literal["bank_transfer", "cash", "paypal", "card", "other"]
    note: str | None
    actor_type: Literal["owner", "agent", "system"]
    actor_id: str
    proposal_id: UUID | None
    created_at: datetime
    reversal: ReceivablePaymentReversalResource | None


class ReceivableEventResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    event_type: Literal["created", "details_updated", "payment_recorded", "payment_reversed"]
    actor_type: Literal["owner", "agent", "system"]
    actor_id: str
    proposal_id: UUID | None
    details: dict[str, object]
    created_at: datetime


class ReceivableDetailResource(ReceivableResource):
    payments: list[ReceivablePaymentResource]
    history: list[ReceivableEventResource]
    pending_proposals: int


class ReceivableDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ReceivableDetailResource


class FinanceChangeProposalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal[
        "receivable_create", "receivable_update", "payment_record", "payment_reverse"
    ]
    receivable_id: UUID | None = None
    expected_version: int | None = Field(default=None, ge=1)
    rationale: str = Field(min_length=1, max_length=2000)
    receivable: ReceivableCreate | None = None
    changes: ReceivableUpdateInput | None = None
    payment: ReceivablePaymentInput | None = None
    payment_id: UUID | None = None
    reversal_reason: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def require_action_payload(self) -> "FinanceChangeProposalCreate":
        if self.action == "receivable_create":
            if self.receivable is None:
                raise ValueError("receivable is required for receivable_create")
            if self.receivable_id is not None or self.expected_version is not None:
                raise ValueError("receivable_create cannot target an existing receivable")
            if self.changes is not None or self.payment is not None:
                raise ValueError("receivable_create accepts only receivable")
            if self.payment_id is not None or self.reversal_reason:
                raise ValueError("receivable_create accepts only receivable")
        elif self.action == "receivable_update":
            self.require_existing_receivable()
            if self.changes is None:
                raise ValueError("changes are required for receivable_update")
            if self.receivable is not None or self.payment is not None:
                raise ValueError("receivable_update accepts only changes")
            if self.payment_id is not None or self.reversal_reason:
                raise ValueError("receivable_update accepts only changes")
        elif self.action == "payment_record":
            self.require_existing_receivable()
            if self.payment is None:
                raise ValueError("payment is required for payment_record")
            if self.receivable is not None or self.changes is not None:
                raise ValueError("payment_record accepts only payment")
            if self.payment_id is not None or self.reversal_reason:
                raise ValueError("payment_record accepts only payment")
        else:
            self.require_existing_receivable()
            if self.payment_id is None or self.reversal_reason is None:
                raise ValueError("payment_id and reversal_reason are required for payment_reverse")
            if self.receivable is not None or self.changes is not None or self.payment is not None:
                raise ValueError("payment_reverse accepts only reversal fields")
        return self

    def require_existing_receivable(self) -> None:
        if self.receivable_id is None or self.expected_version is None:
            raise ValueError("receivable_id and expected_version are required")


class FinanceChangeProposalResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    agent_id: str
    action: Literal[
        "receivable_create", "receivable_update", "payment_record", "payment_reverse"
    ]
    receivable_id: UUID | None
    debtor_name: str
    expected_version: int | None
    current_version: int | None
    payload: dict[str, object]
    rationale: str
    status: Literal["pending", "approved", "rejected"]
    created_at: datetime
    decided_at: datetime | None


class FinanceChangeProposalResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: FinanceChangeProposalResource


class FinanceChangeProposalListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[FinanceChangeProposalResource]


class DashboardPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    start: date
    end: date


class DashboardSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    income: Decimal
    expenses: Decimal
    net: Decimal
    outstanding_receivables: Decimal
    overdue_receivables: int
    pending_finance_proposals: int
    currency: str


class CashflowPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    label: str
    income: Decimal
    expenses: Decimal
    net: Decimal


class PersonalFinanceDashboardResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: DashboardPeriod
    summary: DashboardSummary
    cashflow: list[CashflowPoint]
    open_receivables: list[ReceivableResource]
    recent_transactions: list[FinancialTransactionResource]


class PersonalFinanceDashboardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: PersonalFinanceDashboardResource
