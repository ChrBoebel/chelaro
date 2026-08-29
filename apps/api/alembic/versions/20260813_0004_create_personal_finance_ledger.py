"""Create personal cashflow and receivables ledger.

Revision ID: 20260813_0004
Revises: 20260813_0003
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260813_0004"
down_revision: str | None = "20260813_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "receivables",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("debtor_name", sa.Text(), nullable=False),
        sa.Column("original_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column(
            "received_amount",
            sa.Numeric(precision=18, scale=2),
            server_default="0.00",
            nullable=False,
        ),
        sa.Column("currency", sa.String(length=3), server_default="EUR", nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="open", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("original_amount > 0", name="ck_receivables_amount_positive"),
        sa.CheckConstraint(
            "received_amount >= 0",
            name="ck_receivables_received_non_negative",
        ),
        sa.CheckConstraint(
            "received_amount <= original_amount",
            name="ck_receivables_received_within_total",
        ),
        sa.CheckConstraint(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_receivables_currency_format",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'partial', 'paid')",
            name="ck_receivables_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_receivables_status_due_date",
        "receivables",
        ["status", "due_date"],
        unique=False,
    )

    op.create_table(
        "financial_transactions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("direction", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="EUR", nullable=False),
        sa.Column("booked_on", sa.Date(), nullable=False),
        sa.Column("counterparty", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), server_default="manual", nullable=False),
        sa.Column("receivable_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "direction IN ('income', 'expense')",
            name="ck_transactions_direction",
        ),
        sa.CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        sa.CheckConstraint(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_transactions_currency_format",
        ),
        sa.CheckConstraint(
            "source IN ('manual', 'receivable')",
            name="ck_transactions_source",
        ),
        sa.ForeignKeyConstraint(
            ["receivable_id"],
            ["receivables.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_transactions_booked_id",
        "financial_transactions",
        ["booked_on", "id"],
        unique=False,
    )
    op.create_index(
        "ix_transactions_direction_booked",
        "financial_transactions",
        ["direction", "booked_on"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_direction_booked", table_name="financial_transactions")
    op.drop_index("ix_transactions_booked_id", table_name="financial_transactions")
    op.drop_table("financial_transactions")
    op.drop_index("ix_receivables_status_due_date", table_name="receivables")
    op.drop_table("receivables")
