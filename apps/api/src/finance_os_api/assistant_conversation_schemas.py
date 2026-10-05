from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from finance_os_api.schemas import FinanceChangeProposalResource

PUBLIC_ID_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class AssistantConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=120)


class AssistantConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["active", "archived"] | None = None

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if self.title is None and self.status is None:
            raise ValueError("At least one conversation field must change.")
        return self


class AssistantConversationResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    version: int
    title: str
    status: Literal["active", "archived"]
    message_count: int
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None


class AssistantConversationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: AssistantConversationResource


class AssistantConversationListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[AssistantConversationResource]


class AssistantMessageResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    turn_id: str
    sequence: int
    role: Literal["user", "assistant"]
    status: Literal["complete", "interrupted", "failed"]
    text: str
    created_at: datetime


class AssistantMessageListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[AssistantMessageResource]
    next_before_sequence: int | None


class AssistantProposalPayment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal
    booked_on: date
    purpose: str


class AssistantProposalResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal: FinanceChangeProposalResource
    turn_id: str | None
    currency: str
    payment: AssistantProposalPayment | None


class AssistantProposalListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[AssistantProposalResource]
    next_before_id: int | None


PROVIDER_MODEL_PATTERN = r"^[A-Za-z0-9._-]{1,128}$"
ProviderEffort = Literal["low", "medium", "high"]
ProviderServiceTier = Literal["default", "priority"]


class AssistantProviderRuntimeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_thread_id: str = Field(pattern=PUBLIC_ID_PATTERN)
    provider_model: str = Field(pattern=PROVIDER_MODEL_PATTERN)
    provider_effort: ProviderEffort
    provider_service_tier: ProviderServiceTier


class AssistantProviderRuntimeResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    provider_thread_id: str | None
    provider_model: str | None
    provider_effort: ProviderEffort | None
    provider_service_tier: ProviderServiceTier | None


class AssistantProviderRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: AssistantProviderRuntimeResource


class AssistantTurnReserve(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_id: str = Field(pattern=PUBLIC_ID_PATTERN)
    prompt: str = Field(min_length=1, max_length=16_000)


class AssistantTurnResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    turn_id: str
    status: Literal["reserved", "running", "completed", "interrupted", "failed"]


class AssistantTurnResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: AssistantTurnResource


class AssistantCompletedMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(pattern=PUBLIC_ID_PATTERN)
    sha256: str = Field(pattern=SHA256_PATTERN)
    text: str = Field(max_length=524_288)


class AssistantTurnComplete(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_turn_id: str = Field(pattern=PUBLIC_ID_PATTERN)
    messages: list[AssistantCompletedMessage] = Field(min_length=1, max_length=8)


class AssistantTurnFail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["interrupted", "failed"]
    error_code: str = Field(pattern=r"^[a-z_]{1,64}$")
