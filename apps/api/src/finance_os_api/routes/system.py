from fastapi import APIRouter, Request

from finance_os_api.errors import ApiError
from finance_os_api.schemas import ServiceStatusResponse

router = APIRouter(tags=["system"])


@router.get("/health", response_model=ServiceStatusResponse)
async def health(request: Request) -> ServiceStatusResponse:
    settings = request.app.state.settings
    return ServiceStatusResponse(
        status="ok",
        service=settings.api_title,
        version=settings.api_version,
    )


@router.get("/ready", response_model=ServiceStatusResponse)
async def ready(request: Request) -> ServiceStatusResponse:
    settings = request.app.state.settings
    try:
        await request.app.state.database.ping()
    except Exception as exc:
        raise ApiError(
            status_code=503,
            code="database_unavailable",
            message="The database is unavailable.",
        ) from exc
    return ServiceStatusResponse(
        status="ready",
        service=settings.api_title,
        version=settings.api_version,
    )
