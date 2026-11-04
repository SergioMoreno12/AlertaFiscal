"""Per-connection PostgreSQL schema selection for pooled deployments.

The Supabase session pooler ignores the libpq ``options`` startup parameter,
so ``search_path`` cannot be selected through ``connect_args``. This module
applies ``DB_SCHEMA`` on every physical DBAPI connection instead, verifies
that the schema exists and is usable, and fails closed without falling back
to ``public``.
"""
from __future__ import annotations

import re
from typing import Any

from psycopg import sql
from sqlalchemy import event
from sqlalchemy.engine import Engine

SCHEMA_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


class SchemaConfigurationError(RuntimeError):
    """Raised when DB_SCHEMA is invalid, missing or not usable."""


def _validate_schema_name(schema: str) -> str:
    if not SCHEMA_NAME_PATTERN.fullmatch(schema):
        raise SchemaConfigurationError(
            "DB_SCHEMA must match ^[A-Za-z_][A-Za-z0-9_]{0,62}$"
        )
    return schema


def _apply_search_path(dbapi_connection: Any, schema: str) -> None:
    """Apply and verify search_path without leaking it into app transactions."""
    previous_autocommit = dbapi_connection.autocommit
    if not previous_autocommit:
        dbapi_connection.autocommit = True
    try:
        with dbapi_connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("SET SESSION search_path TO {}").format(sql.Identifier(schema))
            )
            cursor.execute(
                "SELECT 1 FROM pg_catalog.pg_namespace AS n "
                "WHERE n.nspname = %s "
                "AND pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE')",
                (schema,),
            )
            if cursor.fetchone() is None:
                raise SchemaConfigurationError(
                    f"DB_SCHEMA '{schema}' does not exist or the current role lacks USAGE"
                )
            cursor.execute("SELECT current_schema()")
            row = cursor.fetchone()
            if not row or row[0] != schema:
                raise SchemaConfigurationError(
                    f"DB_SCHEMA '{schema}' was not applied as the active schema"
                )
    finally:
        dbapi_connection.autocommit = previous_autocommit


def configure_schema_selection(engine: Engine, schema: str | None) -> None:
    """Attach a connect listener that applies DB_SCHEMA per physical connection."""
    if not schema:
        return
    if engine.dialect.name != "postgresql":
        return
    selected = _validate_schema_name(schema)

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_connection: Any, connection_record: Any) -> None:
        _apply_search_path(dbapi_connection, selected)
        # SQLAlchemy initializes the dialect before the connect event fires and
        # caches the server default schema. Keep reflection consistent with the
        # schema actually selected for this physical connection.
        engine.dialect.default_schema_name = selected
