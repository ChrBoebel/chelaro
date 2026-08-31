"""Bind the assistant provider runtime to an explicit model configuration.

Chelaro previously sent no model, effort, or service tier to Codex, so the
finance assistant inherited whatever the owner's personal ``~/.codex`` config
declared. The configuration is now chosen explicitly per conversation and must
survive a restart, so it is stored next to the provider thread.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260901_0011"
down_revision: str | None = "20260831_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Existing rows predate explicit selection. They ran on whatever the owner's
# Codex configuration resolved to, which is not recoverable, so they adopt the
# current Chelaro default and are re-bound on the next resume.
_BACKFILL_MODEL = "gpt-5.5"
_BACKFILL_EFFORT = "medium"
_BACKFILL_SERVICE_TIER = "default"


def upgrade() -> None:
    op.add_column(
        "assistant_provider_runtime",
        sa.Column("provider_model", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "assistant_provider_runtime",
        sa.Column("provider_effort", sa.Text(), nullable=True),
    )
    op.add_column(
        "assistant_provider_runtime",
        sa.Column("provider_service_tier", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE assistant_provider_runtime SET"
            " provider_model = :model,"
            " provider_effort = :effort,"
            " provider_service_tier = :service_tier"
            " WHERE provider_model IS NULL"
        ).bindparams(
            model=_BACKFILL_MODEL,
            effort=_BACKFILL_EFFORT,
            service_tier=_BACKFILL_SERVICE_TIER,
        )
    )
    op.alter_column("assistant_provider_runtime", "provider_model", nullable=False)
    op.alter_column("assistant_provider_runtime", "provider_effort", nullable=False)
    op.alter_column("assistant_provider_runtime", "provider_service_tier", nullable=False)
    op.create_check_constraint(
        "ck_assistant_runtime_effort",
        "assistant_provider_runtime",
        "provider_effort IN ('low', 'medium', 'high')",
    )
    op.create_check_constraint(
        "ck_assistant_runtime_service_tier",
        "assistant_provider_runtime",
        "provider_service_tier IN ('default', 'priority')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_assistant_runtime_service_tier",
        "assistant_provider_runtime",
        type_="check",
    )
    op.drop_constraint(
        "ck_assistant_runtime_effort",
        "assistant_provider_runtime",
        type_="check",
    )
    op.drop_column("assistant_provider_runtime", "provider_service_tier")
    op.drop_column("assistant_provider_runtime", "provider_effort")
    op.drop_column("assistant_provider_runtime", "provider_model")
