"""Allow reviewable proposals for new receivables.

Revision ID: 20260828_0009
Revises: 20260828_0008
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260828_0009"
down_revision: str | None = "20260828_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_finance_change_proposals_action",
        "finance_change_proposals",
        type_="check",
    )
    op.drop_constraint(
        "ck_finance_change_proposals_version_positive",
        "finance_change_proposals",
        type_="check",
    )
    op.alter_column(
        "finance_change_proposals",
        "receivable_id",
        existing_type=sa.BigInteger(),
        nullable=True,
    )
    op.alter_column(
        "finance_change_proposals",
        "expected_version",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_finance_change_proposals_action",
        "finance_change_proposals",
        "action IN ('receivable_create', 'receivable_update', 'payment_record', 'payment_reverse')",
    )
    op.create_check_constraint(
        "ck_finance_change_proposals_version_binding",
        "finance_change_proposals",
        "(action = 'receivable_create' AND expected_version IS NULL) OR "
        "(action <> 'receivable_create' AND expected_version > 0)",
    )
    op.create_check_constraint(
        "ck_finance_change_proposals_receivable_binding",
        "finance_change_proposals",
        "action = 'receivable_create' OR receivable_id IS NOT NULL",
    )


def downgrade() -> None:
    connection = op.get_bind()
    create_proposals = connection.scalar(
        sa.text(
            "SELECT count(*) FROM finance_change_proposals "
            "WHERE action = 'receivable_create'"
        )
    )
    if create_proposals:
        raise RuntimeError(
            "Cannot downgrade while receivable_create proposals exist; "
            "preserve their audit history."
        )

    op.drop_constraint(
        "ck_finance_change_proposals_receivable_binding",
        "finance_change_proposals",
        type_="check",
    )
    op.drop_constraint(
        "ck_finance_change_proposals_version_binding",
        "finance_change_proposals",
        type_="check",
    )
    op.drop_constraint(
        "ck_finance_change_proposals_action",
        "finance_change_proposals",
        type_="check",
    )
    op.alter_column(
        "finance_change_proposals",
        "expected_version",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.alter_column(
        "finance_change_proposals",
        "receivable_id",
        existing_type=sa.BigInteger(),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_finance_change_proposals_action",
        "finance_change_proposals",
        "action IN ('receivable_update', 'payment_record', 'payment_reverse')",
    )
    op.create_check_constraint(
        "ck_finance_change_proposals_version_positive",
        "finance_change_proposals",
        "expected_version > 0",
    )
