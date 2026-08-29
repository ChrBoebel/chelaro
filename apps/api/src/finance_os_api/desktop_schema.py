from datetime import UTC, datetime

from sqlalchemy import Connection, inspect, text

from finance_os_api.domain.models import Base

DESKTOP_SCHEMA_VERSION = 3
SCHEMA_TABLE = "desktop_schema_migrations"

V1_PROPOSAL_COLUMNS = {
    "action",
    "agent_id",
    "created_at",
    "decided_at",
    "expected_version",
    "id",
    "payload",
    "public_id",
    "rationale",
    "receivable_id",
    "request_id",
    "status",
}


def prepare_desktop_schema(connection: Connection) -> None:
    """Create or migrate the local schema atomically through immutable versions."""

    tables = set(inspect(connection).get_table_names())
    if SCHEMA_TABLE not in tables:
        if tables:
            raise RuntimeError("The local database has tables but no Chelaro migration ledger.")
        Base.metadata.create_all(connection)
        connection.exec_driver_sql(
            f"CREATE TABLE {SCHEMA_TABLE} ("  # noqa: S608
            "version INTEGER PRIMARY KEY NOT NULL, "
            "applied_at TEXT NOT NULL)"
        )
        record_version(connection, DESKTOP_SCHEMA_VERSION)
        return

    version = connection.execute(
        text(f"SELECT MAX(version) FROM {SCHEMA_TABLE}")  # noqa: S608
    ).scalar_one_or_none()
    if not isinstance(version, int) or version < 1 or version > DESKTOP_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported desktop schema version {version}; "
            f"expected 1 through {DESKTOP_SCHEMA_VERSION}."
        )

    while version < DESKTOP_SCHEMA_VERSION:
        if version == 1:
            migrate_v1_to_v2(connection)
        elif version == 2:
            migrate_v2_to_v3(connection)
        else:  # pragma: no cover - guarded by the supported range above
            raise RuntimeError(f"Missing desktop migration after version {version}.")
        version += 1
        record_version(connection, version)

    Base.metadata.create_all(connection)


def migrate_v1_to_v2(connection: Connection) -> None:
    """Expand finance proposals for idempotent assistant-created receivables."""

    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    if "finance_change_proposals" not in tables or "finance_proposal_events" in tables:
        raise RuntimeError("Desktop schema version 1 has an unexpected proposal layout.")
    columns = {column["name"] for column in inspector.get_columns("finance_change_proposals")}
    if columns != V1_PROPOSAL_COLUMNS:
        raise RuntimeError("Desktop schema version 1 proposal columns do not match the baseline.")

    connection.exec_driver_sql(
        "DROP INDEX IF EXISTS ix_finance_change_proposals_status_created"
    )
    connection.exec_driver_sql(
        "ALTER TABLE finance_change_proposals RENAME TO finance_change_proposals_v1"
    )
    connection.exec_driver_sql(
        """
        CREATE TABLE finance_change_proposals (
            id INTEGER NOT NULL,
            public_id CHAR(32) NOT NULL,
            agent_id TEXT NOT NULL,
            action TEXT NOT NULL,
            receivable_id INTEGER,
            expected_version INTEGER,
            payload JSON NOT NULL,
            rationale TEXT NOT NULL,
            status TEXT DEFAULT 'pending' NOT NULL,
            request_id CHAR(32) NOT NULL,
            idempotency_key CHAR(32),
            request_fingerprint VARCHAR(64),
            provider_thread_id VARCHAR(128),
            provider_turn_id VARCHAR(128),
            provider_call_id VARCHAR(128),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            decided_at DATETIME,
            PRIMARY KEY (id),
            CONSTRAINT ck_finance_change_proposals_action CHECK (
                action IN (
                    'receivable_create', 'receivable_update',
                    'payment_record', 'payment_reverse'
                )
            ),
            CONSTRAINT ck_finance_change_proposals_status CHECK (
                status IN ('pending', 'approved', 'rejected')
            ),
            CONSTRAINT ck_finance_change_proposals_version_binding CHECK (
                (action = 'receivable_create' AND expected_version IS NULL) OR
                (action <> 'receivable_create' AND expected_version > 0)
            ),
            CONSTRAINT ck_finance_change_proposals_receivable_binding CHECK (
                action = 'receivable_create' OR receivable_id IS NOT NULL
            ),
            CONSTRAINT uq_finance_change_proposals_idempotency_key UNIQUE (
                idempotency_key
            ),
            UNIQUE (public_id),
            FOREIGN KEY(receivable_id) REFERENCES receivables (id) ON DELETE RESTRICT
        )
        """
    )
    connection.exec_driver_sql(
        """
        INSERT INTO finance_change_proposals (
            id, public_id, agent_id, action, receivable_id, expected_version,
            payload, rationale, status, request_id, created_at, decided_at
        )
        SELECT
            id, public_id, agent_id, action, receivable_id, expected_version,
            payload, rationale, status, request_id, created_at, decided_at
        FROM finance_change_proposals_v1
        """
    )
    connection.exec_driver_sql("DROP TABLE finance_change_proposals_v1")
    connection.exec_driver_sql(
        """
        CREATE INDEX ix_finance_change_proposals_status_created
        ON finance_change_proposals (status, created_at)
        """
    )
    connection.exec_driver_sql(
        """
        CREATE TABLE finance_proposal_events (
            id INTEGER NOT NULL,
            public_id CHAR(32) NOT NULL,
            proposal_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            request_id CHAR(32) NOT NULL,
            idempotency_key CHAR(32),
            provider_thread_id VARCHAR(128),
            provider_turn_id VARCHAR(128),
            provider_call_id VARCHAR(128),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_finance_proposal_events_type CHECK (
                event_type IN ('created', 'approved', 'rejected')
            ),
            CONSTRAINT ck_finance_proposal_events_actor_type CHECK (
                actor_type IN ('owner', 'agent', 'finance_assistant', 'system')
            ),
            UNIQUE (public_id),
            FOREIGN KEY(proposal_id) REFERENCES finance_change_proposals (id)
                ON DELETE RESTRICT
        )
        """
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX ix_finance_proposal_events_proposal_created
        ON finance_proposal_events (proposal_id, created_at)
        """
    )


def migrate_v2_to_v3(connection: Connection) -> None:
    """Backfill the append-only lifecycle audit for pre-assistant proposals."""

    connection.exec_driver_sql(
        """
        INSERT INTO finance_proposal_events (
            public_id, proposal_id, event_type, actor_type, actor_id,
            request_id, created_at
        )
        SELECT
            lower(hex(randomblob(16))), proposal.id, 'created',
            CASE
                WHEN proposal.agent_id = 'finance-assistant' THEN 'finance_assistant'
                ELSE 'agent'
            END,
            proposal.agent_id, proposal.request_id, proposal.created_at
        FROM finance_change_proposals AS proposal
        WHERE NOT EXISTS (
            SELECT 1
            FROM finance_proposal_events AS event
            WHERE event.proposal_id = proposal.id AND event.event_type = 'created'
        )
        """
    )
    connection.exec_driver_sql(
        """
        INSERT INTO finance_proposal_events (
            public_id, proposal_id, event_type, actor_type, actor_id,
            request_id, created_at
        )
        SELECT
            lower(hex(randomblob(16))), proposal.id, proposal.status,
            'owner', 'owner', proposal.request_id,
            coalesce(proposal.decided_at, proposal.created_at)
        FROM finance_change_proposals AS proposal
        WHERE proposal.status IN ('approved', 'rejected')
          AND NOT EXISTS (
              SELECT 1
              FROM finance_proposal_events AS event
              WHERE event.proposal_id = proposal.id
                AND event.event_type = proposal.status
          )
        """
    )


def record_version(connection: Connection, version: int) -> None:
    connection.execute(
        text(
            f"INSERT INTO {SCHEMA_TABLE} (version, applied_at) "  # noqa: S608
            "VALUES (:version, :applied_at)"
        ),
        {"version": version, "applied_at": datetime.now(UTC).isoformat()},
    )
