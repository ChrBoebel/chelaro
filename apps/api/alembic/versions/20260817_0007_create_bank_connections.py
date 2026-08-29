"""Create non-secret bank connection preparation records.

Revision ID: 20260817_0007
Revises: 20260813_0006
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260817_0007"
down_revision: str | None = "20260813_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bank_connections",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("provider", sa.Text(), server_default="fints", nullable=False),
        sa.Column("access_mode", sa.Text(), server_default="read_only", nullable=False),
        sa.Column("institution_name", sa.Text(), nullable=False),
        sa.Column("bank_code", sa.String(length=8), nullable=False),
        sa.Column("bic", sa.String(length=11), nullable=True),
        sa.Column("endpoint", sa.Text(), nullable=True),
        sa.Column("tan_method", sa.Text(), server_default="unknown", nullable=False),
        sa.Column("transaction_access_confirmed", sa.Boolean(), nullable=True),
        sa.Column("statement_access_confirmed", sa.Boolean(), nullable=True),
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
        sa.CheckConstraint("version > 0", name="ck_bank_connections_version_positive"),
        sa.CheckConstraint("provider IN ('fints')", name="ck_bank_connections_provider"),
        sa.CheckConstraint(
            "access_mode IN ('read_only')",
            name="ck_bank_connections_access_mode",
        ),
        sa.CheckConstraint(
            "bank_code ~ '^[0-9]{8}$'",
            name="ck_bank_connections_bank_code",
        ),
        sa.CheckConstraint(
            "bic IS NULL OR bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'",
            name="ck_bank_connections_bic",
        ),
        sa.CheckConstraint(
            "tan_method IN ('unknown', 'push_tan', 'chip_tan', 'other')",
            name="ck_bank_connections_tan_method",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint(
            "provider",
            "bank_code",
            name="uq_bank_connections_provider_bank",
        ),
    )
    op.create_table(
        "bank_connection_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("connection_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('created', 'updated')",
            name="ck_bank_connection_events_type",
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'system')",
            name="ck_bank_connection_events_actor_type",
        ),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["bank_connections.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_bank_connection_events_connection_created",
        "bank_connection_events",
        ["connection_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bank_connection_events_connection_created",
        table_name="bank_connection_events",
    )
    op.drop_table("bank_connection_events")
    op.drop_table("bank_connections")
