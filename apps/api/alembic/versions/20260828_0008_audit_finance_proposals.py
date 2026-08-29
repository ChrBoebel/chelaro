"""Add idempotency and append-only audit events to finance proposals.

Revision ID: 20260828_0008
Revises: 20260817_0007
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260828_0008"
down_revision: str | None = "20260817_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_change_proposals",
        sa.Column("idempotency_key", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "finance_change_proposals",
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "finance_change_proposals",
        sa.Column("provider_thread_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "finance_change_proposals",
        sa.Column("provider_turn_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "finance_change_proposals",
        sa.Column("provider_call_id", sa.String(length=128), nullable=True),
    )
    op.create_unique_constraint(
        "uq_finance_change_proposals_idempotency_key",
        "finance_change_proposals",
        ["idempotency_key"],
    )

    op.create_table(
        "finance_proposal_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("proposal_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=True),
        sa.Column("provider_thread_id", sa.String(length=128), nullable=True),
        sa.Column("provider_turn_id", sa.String(length=128), nullable=True),
        sa.Column("provider_call_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('created', 'approved', 'rejected')",
            name="ck_finance_proposal_events_type",
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'agent', 'finance_assistant', 'system')",
            name="ck_finance_proposal_events_actor_type",
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"],
            ["finance_change_proposals.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_finance_proposal_events_proposal_created",
        "finance_proposal_events",
        ["proposal_id", "created_at"],
    )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            INSERT INTO finance_proposal_events
                (proposal_id, event_type, actor_type, actor_id, request_id, created_at)
            SELECT id, 'created', 'agent', agent_id, request_id, created_at
            FROM finance_change_proposals
            """
        )
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO finance_proposal_events
                (proposal_id, event_type, actor_type, actor_id, request_id, created_at)
            SELECT id, status, 'system', 'history-migration', request_id,
                   COALESCE(decided_at, created_at)
            FROM finance_change_proposals
            WHERE status IN ('approved', 'rejected')
            """
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_proposal_events_proposal_created",
        table_name="finance_proposal_events",
    )
    op.drop_table("finance_proposal_events")
    op.drop_constraint(
        "uq_finance_change_proposals_idempotency_key",
        "finance_change_proposals",
        type_="unique",
    )
    op.drop_column("finance_change_proposals", "provider_call_id")
    op.drop_column("finance_change_proposals", "provider_turn_id")
    op.drop_column("finance_change_proposals", "provider_thread_id")
    op.drop_column("finance_change_proposals", "request_fingerprint")
    op.drop_column("finance_change_proposals", "idempotency_key")
