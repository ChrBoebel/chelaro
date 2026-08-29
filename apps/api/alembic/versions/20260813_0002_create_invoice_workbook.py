"""Create typed invoice workbook and atomic change ledger.

Revision ID: 20260813_0002
Revises: 20260813_0001
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260813_0002"
down_revision: str | None = "20260813_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invoice_records",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("document_id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("vendor", sa.Text()),
        sa.Column("invoice_number", sa.Text()),
        sa.Column("invoice_date", sa.Date()),
        sa.Column("gross_amount", sa.Numeric(precision=18, scale=2)),
        sa.Column("currency", sa.String(length=3), server_default="EUR", nullable=False),
        sa.Column("category", sa.Text()),
        sa.Column("status", sa.Text(), server_default="unverified", nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("version > 0", name="ck_invoice_records_version_positive"),
        sa.CheckConstraint(
            "gross_amount >= 0",
            name="ck_invoice_records_amount_non_negative",
        ),
        sa.CheckConstraint(
            "currency ~ '^[A-Z]{3}$'",
            name="ck_invoice_records_currency_format",
        ),
        sa.CheckConstraint(
            "status IN ('unverified', 'verified', 'open', 'paid', 'archived')",
            name="ck_invoice_records_status",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_invoice_records_document_id_documents",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_invoice_records"),
        sa.UniqueConstraint("document_id", name="uq_invoice_records_document_id"),
        sa.UniqueConstraint("public_id", name="uq_invoice_records_public_id"),
    )
    op.create_index(
        "ix_invoice_records_updated_id",
        "invoice_records",
        ["updated_at", "id"],
    )

    op.create_table(
        "change_proposals",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_change_proposals_status",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_change_proposals"),
        sa.UniqueConstraint("public_id", name="uq_change_proposals_public_id"),
    )
    op.create_index(
        "ix_change_proposals_status_created",
        "change_proposals",
        ["status", "created_at"],
    )

    op.create_table(
        "change_sets",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("proposal_public_id", sa.Uuid()),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'agent')",
            name="ck_change_sets_actor_type",
        ),
        sa.CheckConstraint(
            "action IN ('owner_edit', 'proposal_approved')",
            name="ck_change_sets_action",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_change_sets"),
        sa.UniqueConstraint("public_id", name="uq_change_sets_public_id"),
    )

    op.create_table(
        "change_proposal_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("proposal_id", sa.BigInteger(), nullable=False),
        sa.Column("invoice_record_id", sa.BigInteger(), nullable=False),
        sa.Column("field_name", sa.Text(), nullable=False),
        sa.Column("before_value", sa.JSON()),
        sa.Column("proposed_value", sa.JSON()),
        sa.Column("expected_version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["invoice_record_id"],
            ["invoice_records.id"],
            name="fk_change_proposal_items_invoice_record_id_invoice_records",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"],
            ["change_proposals.id"],
            name="fk_change_proposal_items_proposal_id_change_proposals",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_change_proposal_items"),
    )
    op.create_index(
        "uq_change_proposal_items_cell",
        "change_proposal_items",
        ["proposal_id", "invoice_record_id", "field_name"],
        unique=True,
    )

    op.create_table(
        "change_set_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("change_set_id", sa.BigInteger(), nullable=False),
        sa.Column("invoice_record_id", sa.BigInteger(), nullable=False),
        sa.Column("field_name", sa.Text(), nullable=False),
        sa.Column("before_value", sa.JSON()),
        sa.Column("after_value", sa.JSON()),
        sa.ForeignKeyConstraint(
            ["change_set_id"],
            ["change_sets.id"],
            name="fk_change_set_items_change_set_id_change_sets",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["invoice_record_id"],
            ["invoice_records.id"],
            name="fk_change_set_items_invoice_record_id_invoice_records",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_change_set_items"),
    )


def downgrade() -> None:
    op.drop_table("change_set_items")
    op.drop_index("uq_change_proposal_items_cell", table_name="change_proposal_items")
    op.drop_table("change_proposal_items")
    op.drop_table("change_sets")
    op.drop_index("ix_change_proposals_status_created", table_name="change_proposals")
    op.drop_table("change_proposals")
    op.drop_index("ix_invoice_records_updated_id", table_name="invoice_records")
    op.drop_table("invoice_records")
