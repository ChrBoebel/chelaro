import uvicorn

from finance_os_api.config import get_settings
from finance_os_api.main import create_app


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.api_host,
        port=settings.api_port,
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
