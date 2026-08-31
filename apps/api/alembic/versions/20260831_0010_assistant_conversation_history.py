"""Persist complete local assistant conversations and Codex resume bindings.

Revision ID: 20260831_0010
Revises: 20260828_0009
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260831_0010"
down_revision: str | None = "20260828_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("public_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column("message_count", sa.Integer(), server_default="0", nullable=False),
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
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "message_count >= 0",
            name="ck_assistant_conversations_message_count_non_negative",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived', 'deleted')",
            name="ck_assistant_conversations_status",
        ),
        sa.CheckConstraint(
            "version > 0",
            name="ck_assistant_conversations_version_positive",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_assistant_conversations_status_activity",
        "assistant_conversations",
        ["status", "last_message_at", "created_at"],
    )

    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("public_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("turn_id", sa.String(length=128), nullable=False),
        sa.Column("provider_message_id", sa.String(length=128), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_assistant_messages_role",
        ),
        sa.CheckConstraint(
            "sequence > 0",
            name="ck_assistant_messages_sequence_positive",
        ),
        sa.CheckConstraint(
            "sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_assistant_messages_sha256_format",
        ),
        sa.CheckConstraint(
            "status IN ('complete', 'interrupted', 'failed')",
            name="ck_assistant_messages_status",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint(
            "conversation_id",
            "sequence",
            name="uq_assistant_messages_conversation_sequence",
        ),
        sa.UniqueConstraint(
            "conversation_id",
            "turn_id",
            "provider_message_id",
            name="uq_assistant_messages_provider_message",
        ),
    )
    op.create_index(
        "ix_assistant_messages_conversation_sequence",
        "assistant_messages",
        ["conversation_id", "sequence"],
    )

    op.create_table(
        "assistant_turns",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("public_id", sa.String(length=128), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("user_message_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("provider_turn_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_assistant_turns_fingerprint_format",
        ),
        sa.CheckConstraint(
            "status IN ('reserved', 'running', 'completed', 'interrupted', 'failed')",
            name="ck_assistant_turns_status",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_message_id"],
            ["assistant_messages.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id", name="uq_assistant_turns_public_id"),
    )
    op.create_index(
        "ix_assistant_turns_conversation_created",
        "assistant_turns",
        ["conversation_id", "created_at"],
    )

    op.create_table(
        "assistant_activities",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("public_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("turn_id", sa.String(length=128), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("reference_public_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('proposal_created', 'turn_interrupted', 'turn_failed')",
            name="ck_assistant_activities_kind",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_assistant_activities_conversation_created",
        "assistant_activities",
        ["conversation_id", "created_at"],
    )

    op.create_table(
        "assistant_provider_runtime",
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_name", sa.Text(), server_default="codex", nullable=False),
        sa.Column("provider_thread_id", sa.String(length=128), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "provider_name IN ('codex')",
            name="ck_assistant_runtime_provider",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("conversation_id"),
        sa.UniqueConstraint("provider_thread_id"),
    )

    op.create_table(
        "assistant_conversation_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("public_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=False),
        sa.Column("turn_id", sa.String(length=128), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type IN ('owner', 'finance_assistant', 'system')",
            name="ck_assistant_conversation_events_actor_type",
        ),
        sa.CheckConstraint(
            "event_type IN ('created', 'renamed', 'archived', 'restored', 'deleted', "
            "'provider_bound', 'turn_reserved', 'turn_completed', "
            "'turn_interrupted', 'turn_failed')",
            name="ck_assistant_conversation_events_type",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["assistant_conversations.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(
        "ix_assistant_conversation_events_conversation_created",
        "assistant_conversation_events",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM assistant_conversations")):
        raise RuntimeError(
            "Cannot downgrade while local assistant conversations exist; "
            "export or delete them first."
        )
    op.drop_index(
        "ix_assistant_conversation_events_conversation_created",
        table_name="assistant_conversation_events",
    )
    op.drop_table("assistant_conversation_events")
    op.drop_table("assistant_provider_runtime")
    op.drop_index(
        "ix_assistant_activities_conversation_created",
        table_name="assistant_activities",
    )
    op.drop_table("assistant_activities")
    op.drop_index(
        "ix_assistant_turns_conversation_created",
        table_name="assistant_turns",
    )
    op.drop_table("assistant_turns")
    op.drop_index(
        "ix_assistant_messages_conversation_sequence",
        table_name="assistant_messages",
    )
    op.drop_table("assistant_messages")
    op.drop_index(
        "ix_assistant_conversations_status_activity",
        table_name="assistant_conversations",
    )
    op.drop_table("assistant_conversations")
