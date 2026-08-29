from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, Date, Integer, Numeric
from sqlalchemy.engine import Dialect
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.sql.type_api import TypeEngine
from sqlalchemy.types import TypeDecorator

DATABASE_ID = BigInteger().with_variant(Integer(), "sqlite")
MONEY_QUANTUM = Decimal("0.01")


class MonthBucket(FunctionElement[date]):
    type = Date()
    inherit_cache = True


@compiles(MonthBucket, "postgresql")
def compile_postgresql_month_bucket(element: MonthBucket, compiler: Any, **kwargs: Any) -> str:
    argument = compiler.process(list(element.clauses)[0], **kwargs)
    return f"date_trunc('month', {argument})"


@compiles(MonthBucket, "sqlite")
def compile_sqlite_month_bucket(element: MonthBucket, compiler: Any, **kwargs: Any) -> str:
    argument = compiler.process(list(element.clauses)[0], **kwargs)
    return f"date({argument}, 'start of month')"


class MoneyAmount(TypeDecorator[Decimal]):
    """Persist money exactly as NUMERIC on PostgreSQL and integer cents on SQLite."""

    impl = Numeric(18, 2)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "sqlite":
            return dialect.type_descriptor(Integer())
        return dialect.type_descriptor(Numeric(18, 2))

    def process_bind_param(self, value: Decimal | None, dialect: Dialect) -> Decimal | int | None:
        if value is None:
            return None
        try:
            decimal_value = Decimal(value)
            normalized = decimal_value.quantize(MONEY_QUANTUM)
        except (InvalidOperation, ValueError) as error:
            raise ValueError("Money values must have at most two decimal places") from error
        if decimal_value != normalized:
            raise ValueError("Money values must have at most two decimal places")
        if dialect.name == "sqlite":
            return int(normalized * 100)
        return normalized

    def process_result_value(self, value: Decimal | int | None, dialect: Dialect) -> Decimal | None:
        if value is None:
            return None
        if dialect.name == "sqlite":
            return (Decimal(value) / 100).quantize(MONEY_QUANTUM)
        return Decimal(value).quantize(MONEY_QUANTUM)


def postgresql_check(expression: str, *, name: str) -> CheckConstraint:
    """Keep PostgreSQL regex checks without emitting unsupported SQLite syntax."""

    return CheckConstraint(expression, name=name).ddl_if(dialect="postgresql")
