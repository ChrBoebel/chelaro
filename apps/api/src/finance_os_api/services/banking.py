from typing import Literal
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from finance_os_api.auth import Actor
from finance_os_api.domain.models import BankConnection, BankConnectionEvent
from finance_os_api.errors import ApiError
from finance_os_api.schemas import (
    BankConnectionCreate,
    BankConnectionResource,
    BankConnectionUpdate,
    BankingReadinessCheck,
    BankingReadinessResource,
)

UPDATABLE_FIELDS = (
    "institution_name",
    "bank_code",
    "bic",
    "endpoint",
    "tan_method",
    "transaction_access_confirmed",
    "statement_access_confirmed",
)


class BankingService:
    async def get_readiness(self, session: AsyncSession) -> BankingReadinessResource:
        connection = await session.scalar(
            select(BankConnection).order_by(BankConnection.created_at.desc()).limit(1)
        )
        resource = as_bank_connection_resource(connection) if connection is not None else None
        checks = readiness_checks(connection)
        return BankingReadinessResource(
            connection=resource,
            checks=checks,
            ready_for_live_sync=all(item.complete for item in checks),
            security_notice=(
                "PIN und TAN werden nicht in Chelaro gespeichert. Der spätere FinTS-Adapter "
                "muss Zugangsdaten aus einer sicheren lokalen Ablage beziehen."
            ),
        )

    async def create_connection(
        self,
        session: AsyncSession,
        *,
        payload: BankConnectionCreate,
        actor: Actor,
    ) -> BankConnectionResource:
        connection = BankConnection(
            provider=payload.provider,
            access_mode=payload.access_mode,
            institution_name=payload.institution_name,
            bank_code=payload.bank_code,
            bic=payload.bic,
            endpoint=str(payload.endpoint) if payload.endpoint is not None else None,
            tan_method=payload.tan_method,
            transaction_access_confirmed=payload.transaction_access_confirmed,
            statement_access_confirmed=payload.statement_access_confirmed,
        )
        session.add(connection)
        try:
            await session.flush()
            add_connection_event(
                session,
                connection=connection,
                event_type="created",
                actor=actor,
                details={"configuration": public_configuration(connection)},
            )
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise ApiError(
                status_code=409,
                code="bank_connection_exists",
                message="A connection for this provider and bank already exists.",
            ) from exc
        await session.refresh(connection)
        return as_bank_connection_resource(connection)

    async def update_connection(
        self,
        session: AsyncSession,
        *,
        connection_id: UUID,
        payload: BankConnectionUpdate,
        actor: Actor,
    ) -> BankConnectionResource:
        connection = await session.scalar(
            select(BankConnection)
            .where(BankConnection.public_id == connection_id)
            .with_for_update()
        )
        if connection is None:
            raise ApiError(
                status_code=404,
                code="bank_connection_not_found",
                message="Bank connection not found.",
            )
        if connection.version != payload.expected_version:
            raise ApiError(
                status_code=409,
                code="stale_bank_connection_version",
                message="The bank connection changed since it was loaded.",
            )

        requested = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
        if "endpoint" in requested and requested["endpoint"] is not None:
            requested["endpoint"] = str(requested["endpoint"])
        changes = {
            field: {"before": getattr(connection, field), "after": value}
            for field, value in requested.items()
            if field in UPDATABLE_FIELDS and getattr(connection, field) != value
        }
        if not changes:
            raise ApiError(
                status_code=422,
                code="no_effect",
                message="The change does not alter the bank connection.",
            )
        for field, change in changes.items():
            setattr(connection, field, change["after"])
        connection.version += 1
        add_connection_event(
            session,
            connection=connection,
            event_type="updated",
            actor=actor,
            details={"changes": changes},
        )
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise ApiError(
                status_code=409,
                code="bank_connection_conflict",
                message="The updated bank connection conflicts with an existing connection.",
            ) from exc
        await session.refresh(connection)
        return as_bank_connection_resource(connection)


def readiness_checks(connection: BankConnection | None) -> list[BankingReadinessCheck]:
    return [
        BankingReadinessCheck(
            code="institution",
            label="Bankdaten hinterlegt",
            complete=connection is not None,
            detail="Institut, BLZ und BIC werden ohne Zugangsdaten gespeichert.",
        ),
        BankingReadinessCheck(
            code="endpoint",
            label="FinTS-Adresse bestätigt",
            complete=connection is not None and connection.endpoint is not None,
            detail="Die Kommunikationsadresse muss von der Sparkasse bestätigt werden.",
        ),
        BankingReadinessCheck(
            code="transactions",
            label="Umsatzabruf freigeschaltet",
            complete=(
                connection is not None and connection.transaction_access_confirmed is True
            ),
            detail="Die Bank muss den lesenden Abruf von Kontoumsätzen freigeben.",
        ),
        BankingReadinessCheck(
            code="statements",
            label="PDF-Kontoauszüge geklärt",
            complete=connection is not None and connection.statement_access_confirmed is not None,
            detail=(
                "PDF-Auszüge sind eine getrennte FinTS-Funktion und können nicht verfügbar sein."
            ),
        ),
        BankingReadinessCheck(
            code="secure_credentials",
            label="Sichere Zugangsdatenablage",
            complete=False,
            detail="Wird zusammen mit dem FinTS-Adapter über den lokalen Schlüsselbund ergänzt.",
        ),
        BankingReadinessCheck(
            code="adapter",
            label="FinTS-Adapter installiert",
            complete=False,
            detail="Der Live-Abruf wird erst nach Bestätigung der Bankdaten implementiert.",
        ),
    ]


def as_bank_connection_resource(connection: BankConnection) -> BankConnectionResource:
    return BankConnectionResource(
        id=connection.public_id,
        version=connection.version,
        provider=connection.provider,
        access_mode=connection.access_mode,
        institution_name=connection.institution_name,
        bank_code=connection.bank_code,
        bic=connection.bic,
        endpoint=connection.endpoint,
        tan_method=connection.tan_method,
        transaction_access_confirmed=connection.transaction_access_confirmed,
        statement_access_confirmed=connection.statement_access_confirmed,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


def public_configuration(connection: BankConnection) -> dict[str, object]:
    return {
        "provider": connection.provider,
        "access_mode": connection.access_mode,
        "institution_name": connection.institution_name,
        "bank_code": connection.bank_code,
        "bic": connection.bic,
        "endpoint": connection.endpoint,
        "tan_method": connection.tan_method,
        "transaction_access_confirmed": connection.transaction_access_confirmed,
        "statement_access_confirmed": connection.statement_access_confirmed,
    }


def add_connection_event(
    session: AsyncSession,
    *,
    connection: BankConnection,
    event_type: Literal["created", "updated"],
    actor: Actor,
    details: object,
) -> None:
    session.add(
        BankConnectionEvent(
            connection_id=connection.id,
            event_type=event_type,
            actor_type="owner",
            actor_id=actor.id,
            details_json=jsonable_encoder(details),
        )
    )
