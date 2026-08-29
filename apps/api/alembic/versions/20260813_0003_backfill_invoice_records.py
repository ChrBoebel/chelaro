"""Backfill invoice rows for existing documents.

Revision ID: 20260813_0003
Revises: 20260813_0002
Create Date: 2026-08-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260813_0003"
down_revision: str | None = "20260813_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO invoice_records (document_id, version, currency, status)
        SELECT documents.id, 1, 'EUR', 'unverified'
        FROM documents
        WHERE NOT EXISTS (
            SELECT 1
            FROM invoice_records
            WHERE invoice_records.document_id = documents.id
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM invoice_records
        WHERE vendor IS NULL
          AND invoice_number IS NULL
          AND invoice_date IS NULL
          AND gross_amount IS NULL
          AND currency = 'EUR'
          AND category IS NULL
          AND status = 'unverified'
          AND notes IS NULL
          AND version = 1
        """
    )
