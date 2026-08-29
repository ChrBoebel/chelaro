"""Backfill receivable events and existing linked payments.

Revision ID: 20260813_0006
Revises: 20260813_0005
Create Date: 2026-08-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260813_0006"
down_revision: str | None = "20260813_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO receivable_events (
            receivable_id, event_type, actor_type, actor_id, details, created_at
        )
        SELECT
            id,
            'created',
            'system',
            'history-backfill',
            json_build_object(
                'debtor_name', debtor_name,
                'original_amount', original_amount::text,
                'currency', currency,
                'due_date', due_date,
                'description', description
            ),
            created_at
        FROM receivables
        """
    )
    op.execute(
        """
        INSERT INTO receivable_payments (
            receivable_id,
            transaction_id,
            amount,
            booked_on,
            purpose,
            payment_method,
            note,
            actor_type,
            actor_id,
            created_at
        )
        SELECT
            transaction.receivable_id,
            transaction.id,
            transaction.amount,
            transaction.booked_on,
            COALESCE(transaction.description, receivable.description),
            'other',
            'Aus bestehender Buchung übernommen',
            'system',
            'history-backfill',
            transaction.created_at
        FROM financial_transactions AS transaction
        JOIN receivables AS receivable ON receivable.id = transaction.receivable_id
        WHERE transaction.source = 'receivable'
          AND transaction.direction = 'income'
        """
    )
    op.execute(
        """
        INSERT INTO receivable_events (
            receivable_id, event_type, actor_type, actor_id, details, created_at
        )
        SELECT
            payment.receivable_id,
            'payment_recorded',
            payment.actor_type,
            payment.actor_id,
            json_build_object(
                'payment_id', payment.public_id,
                'amount', payment.amount::text,
                'booked_on', payment.booked_on,
                'purpose', payment.purpose,
                'payment_method', payment.payment_method
            ),
            payment.created_at
        FROM receivable_payments AS payment
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM receivable_events WHERE actor_id = 'history-backfill'")
    op.execute("DELETE FROM receivable_payments WHERE actor_id = 'history-backfill'")
