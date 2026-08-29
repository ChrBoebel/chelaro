from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


class Database:
    def __init__(self, database_url: str) -> None:
        self.is_desktop_database = database_url.startswith("sqlite+")
        self.engine: AsyncEngine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_recycle=900,
        )
        if self.is_desktop_database:
            event.listen(self.engine.sync_engine, "connect", configure_sqlite_connection)
        self.session_factory = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    async def ping(self) -> None:
        async with self.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

    async def prepare_schema(self) -> None:
        if not self.is_desktop_database:
            return
        from finance_os_api.desktop_schema import prepare_desktop_schema

        async with self.engine.begin() as connection:
            await connection.run_sync(prepare_desktop_schema)

    async def dispose(self) -> None:
        await self.engine.dispose()


def configure_sqlite_connection(dbapi_connection: object, _connection_record: object) -> None:
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA synchronous = FULL")
        cursor.execute("PRAGMA busy_timeout = 5000")
    finally:
        cursor.close()
