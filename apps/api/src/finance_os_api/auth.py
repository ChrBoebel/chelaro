from dataclasses import dataclass
from hmac import compare_digest
from typing import Annotated, Literal

from fastapi import Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from finance_os_api.errors import ApiError

bearer_scheme = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[
    HTTPAuthorizationCredentials | None,
    Security(bearer_scheme),
]


@dataclass(frozen=True, slots=True)
class Actor:
    type: Literal["owner", "agent", "finance_assistant"]
    id: str


async def require_actor(
    request: Request,
    credentials: BearerCredentials,
) -> Actor:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise authentication_error("authentication_required", "A bearer token is required.")

    supplied = credentials.credentials
    settings = request.app.state.settings
    owner_matches = compare_digest(supplied, settings.api_token.get_secret_value())
    agent_value = (
        settings.agent_token.get_secret_value() if settings.agent_token is not None else ""
    )
    agent_matches = bool(agent_value) and compare_digest(supplied, agent_value)
    finance_assistant_value = (
        settings.finance_assistant_token.get_secret_value()
        if settings.finance_assistant_token is not None
        else ""
    )
    finance_assistant_matches = bool(finance_assistant_value) and compare_digest(
        supplied, finance_assistant_value
    )

    if owner_matches:
        return Actor(type="owner", id="owner")
    if agent_matches:
        return Actor(type="agent", id="local-agent")
    if finance_assistant_matches:
        return Actor(type="finance_assistant", id="finance-assistant")
    raise authentication_error("invalid_token", "The bearer token is invalid.")


async def require_owner(actor: Annotated[Actor, Security(require_actor)]) -> Actor:
    if actor.type != "owner":
        raise ApiError(
            status_code=403,
            code="owner_scope_required",
            message="This operation requires owner access.",
        )
    return actor


async def require_owner_or_agent(
    actor: Annotated[Actor, Security(require_actor)],
) -> Actor:
    if actor.type not in {"owner", "agent"}:
        raise ApiError(
            status_code=403,
            code="owner_or_agent_scope_required",
            message="This operation requires owner or agent access.",
        )
    return actor


async def require_agent(actor: Annotated[Actor, Security(require_actor)]) -> Actor:
    if actor.type != "agent":
        raise ApiError(
            status_code=403,
            code="agent_scope_required",
            message="This operation requires an agent token.",
        )
    return actor


async def require_finance_assistant(
    actor: Annotated[Actor, Security(require_actor)],
) -> Actor:
    if actor.type != "finance_assistant":
        raise ApiError(
            status_code=403,
            code="finance_assistant_scope_required",
            message="This operation requires finance assistant access.",
        )
    return actor


def authentication_error(code: str, message: str) -> ApiError:
    return ApiError(
        status_code=401,
        code=code,
        message=message,
        headers={"WWW-Authenticate": "Bearer"},
    )
