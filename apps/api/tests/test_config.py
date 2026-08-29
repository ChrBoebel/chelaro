import pytest
from pydantic import SecretStr, ValidationError

from finance_os_api.config import Settings


def test_finance_assistant_token_must_be_distinct() -> None:
    with pytest.raises(ValidationError, match="must differ from the owner token"):
        Settings(
            env="test",
            api_token=SecretStr("same-token"),
            finance_assistant_token=SecretStr("same-token"),
        )

    with pytest.raises(ValidationError, match="must differ from the agent token"):
        Settings(
            env="test",
            api_token=SecretStr("owner-token"),
            agent_token=SecretStr("same-agent-token"),
            finance_assistant_token=SecretStr("same-agent-token"),
        )


def test_finance_assistant_token_rejects_empty_and_production_placeholder() -> None:
    with pytest.raises(ValidationError, match="must not be empty"):
        Settings(env="test", finance_assistant_token=SecretStr(""))

    with pytest.raises(ValidationError, match="must be replaced in production"):
        Settings(
            env="production",
            api_token=SecretStr("owner-production-token"),
            database_url="sqlite+aiosqlite:///finance.sqlite3",
            finance_assistant_token=SecretStr("replace-with-random"),
        )
