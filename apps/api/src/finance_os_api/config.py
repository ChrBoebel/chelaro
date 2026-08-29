from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime settings loaded from FINANCE_OS_* variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="FINANCE_OS_",
        extra="ignore",
    )

    env: Literal["development", "test", "production"] = "development"
    api_title: str = "Chelaro API"
    api_version: str = "0.1.0"
    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1, le=65535)
    web_origin: AnyHttpUrl = AnyHttpUrl("http://localhost:3000")
    api_token: SecretStr = SecretStr("development-only-change-me")
    agent_token: SecretStr | None = None
    finance_assistant_token: SecretStr | None = None
    database_url: str = (
        "postgresql+asyncpg://finance_os:replace-with-a-local-random-value"
        "@localhost:5432/finance_os"
    )
    storage_driver: Literal["filesystem"] = "filesystem"
    document_root: Path = Path("data/documents")
    quarantine_root: Path = Path("data/quarantine")
    max_upload_bytes: int = Field(default=25 * 1024 * 1024, ge=1, le=200 * 1024 * 1024)

    @model_validator(mode="after")
    def reject_production_placeholders(self) -> "Settings":
        token = self.api_token.get_secret_value()
        if self.env == "production" and (
            token == "development-only-change-me" or "replace-with" in token
        ):
            raise ValueError("FINANCE_OS_API_TOKEN must be replaced in production")
        if self.agent_token is not None:
            agent_token = self.agent_token.get_secret_value()
            if compare_secret_values(token, agent_token):
                raise ValueError("FINANCE_OS_AGENT_TOKEN must differ from the owner token")
            if self.env == "production" and "replace-with" in agent_token:
                raise ValueError("FINANCE_OS_AGENT_TOKEN must be replaced in production")
        if self.finance_assistant_token is not None:
            finance_assistant_token = self.finance_assistant_token.get_secret_value()
            if not finance_assistant_token:
                raise ValueError("FINANCE_OS_FINANCE_ASSISTANT_TOKEN must not be empty")
            if compare_secret_values(token, finance_assistant_token):
                raise ValueError(
                    "FINANCE_OS_FINANCE_ASSISTANT_TOKEN must differ from the owner token"
                )
            if self.agent_token is not None and compare_secret_values(
                self.agent_token.get_secret_value(), finance_assistant_token
            ):
                raise ValueError(
                    "FINANCE_OS_FINANCE_ASSISTANT_TOKEN must differ from the agent token"
                )
            if self.env == "production" and "replace-with" in finance_assistant_token:
                raise ValueError(
                    "FINANCE_OS_FINANCE_ASSISTANT_TOKEN must be replaced in production"
                )
        if self.env == "production" and "replace-with" in self.database_url:
            raise ValueError("FINANCE_OS_DATABASE_URL must be replaced in production")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [str(self.web_origin).rstrip("/")]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def compare_secret_values(first: str, second: str) -> bool:
    return first == second
