"""Create receivable payment history and agent proposals.

Revision ID: 20260813_0005
Revises: 20260813_0004
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260813_0005"
down_revision: str | None = "20260813_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "receivables",
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
    )
    op.create_check_constraint(
        "ck_receivables_version_positive",
        "receivables",
        "version > 0",
    )

    op.create_table(
        "receivable_payments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("receivable_id", sa.BigInteger(), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("booked_on", sa.Date(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("payment_method", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("proposal_public_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_receivable_payments_amount_positive"),
        sa.CheckConstraint(
            "payment_method IN ('bank_transfer', 'cash', 'paypal', 'card', 'other')",
            name="ck_receivable_payments_method",
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')", name="ck_receivable_payments_actor_type"
        ),
        sa.ForeignKeyConstraint(["receivable_id"], ["receivables.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["financial_transactions.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("transaction_id"),
    )
    op.create_index(
        "ix_receivable_payments_receivable_created",
        "receivable_payments",
        ["receivable_id", "created_at"],
    )

    op.create_table(
        "receivable_payment_reversals",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("payment_id", sa.BigInteger(), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("proposal_public_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')",
            name="ck_receivable_payment_reversals_actor_type",
        ),
        sa.ForeignKeyConstraint(["payment_id"], ["receivable_payments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["financial_transactions.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("payment_id"),
        sa.UniqueConstraint("transaction_id"),
    )

    op.create_table(
        "receivable_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("receivable_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("proposal_public_id", sa.Uuid(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('created', 'details_updated', 'payment_recorded', 'payment_reversed')",
            name="ck_receivable_events_type",
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'agent', 'system')", name="ck_receivable_events_actor_type"
        ),
        sa.ForeignKeyConstraint(["receivable_id"], ["receivables.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_receivable_events_receivable_created",
        "receivable_events",
        ["receivable_id", "created_at"],
    )

    op.create_table(
        "finance_change_proposals",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("receivable_id", sa.BigInteger(), nullable=False),
        sa.Column("expected_version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "action IN ('receivable_update', 'payment_record', 'payment_reverse')",
            name="ck_finance_change_proposals_action",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_finance_change_proposals_status",
        ),
        sa.CheckConstraint(
            "expected_version > 0", name="ck_finance_change_proposals_version_positive"
        ),
        sa.ForeignKeyConstraint(["receivable_id"], ["receivables.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_finance_change_proposals_status_created",
        "finance_change_proposals",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_change_proposals_status_created", table_name="finance_change_proposals"
    )
    op.drop_table("finance_change_proposals")
    op.drop_index("ix_receivable_events_receivable_created", table_name="receivable_events")
    op.drop_table("receivable_events")
    op.drop_table("receivable_payment_reversals")
    op.drop_index("ix_receivable_payments_receivable_created", table_name="receivable_payments")
    op.drop_table("receivable_payments")
    op.drop_constraint("ck_receivables_version_positive", "receivables", type_="check")
    op.drop_column("receivables", "version")
