"""Read-only catalogue queries used by the behavioural suites.

These read the live server's own catalogue rather than trusting anything the harness believes.
They are queries, not production code: nothing here creates, alters or owns a substrate object.
"""

from __future__ import annotations

from typing import Any, Mapping

import psycopg


def _scalar(substrate: Any, role: Any, sql: str, params: tuple = ()) -> Any:
    with substrate.connect(role) as connection, connection.cursor() as cursor:
        cursor.execute(sql, params)
        row = cursor.fetchone()
    return None if row is None else row[0]


def role_attributes(substrate: Any, role_name: str) -> Mapping[str, bool]:
    """The catalogue's own view of a role's privilege attributes."""
    with substrate.connect(substrate.superuser) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin "
            "FROM pg_roles WHERE rolname = %s",
            (role_name,),
        )
        row = cursor.fetchone()
    if row is None:
        raise AssertionError(f"role {role_name!r} does not exist on the live server")
    keys = ("superuser", "bypassrls", "createdb", "createrole", "replication", "canlogin")
    return dict(zip(keys, row))


def password_verifier_prefix(substrate: Any, role_name: str) -> str:
    """The stored password verifier's algorithm prefix, e.g. ``SCRAM-SHA-256``.

    Read as superuser from ``pg_authid``. This is the direct proof that the role authenticates
    with a real hashed credential rather than through trust.
    """
    value = _scalar(
        substrate,
        substrate.superuser,
        "SELECT rolpassword FROM pg_authid WHERE rolname = %s",
        (role_name,),
    )
    if not value:
        raise AssertionError(f"role {role_name!r} has no stored password verifier")
    return str(value).split("$", 1)[0]


def database_owner(substrate: Any) -> str:
    return _scalar(
        substrate,
        substrate.superuser,
        "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()",
    )


def schema_owner(substrate: Any, schema: str = "public") -> str:
    return _scalar(
        substrate,
        substrate.superuser,
        "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = %s",
        (schema,),
    )


def has_schema_privilege(
    substrate: Any, role_name: str, privilege: str, schema: str = "public"
) -> bool:
    return bool(
        _scalar(
            substrate,
            substrate.superuser,
            "SELECT has_schema_privilege(%s, %s, %s)",
            (role_name, schema, privilege),
        )
    )


def table_exists(substrate: Any, table: str, schema: str = "public") -> bool:
    return bool(
        _scalar(
            substrate,
            substrate.migration,
            "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = %s AND tablename = %s)",
            (schema, table),
        )
    )


def force_rls_enabled(substrate: Any, table: str, schema: str = "public") -> tuple[bool, bool]:
    """``(rowsecurity, forcerowsecurity)`` for a table, straight from ``pg_class``."""
    with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT c.relrowsecurity, c.relforcerowsecurity "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = %s AND c.relname = %s",
            (schema, table),
        )
        row = cursor.fetchone()
    if row is None:
        raise AssertionError(f"table {schema}.{table} does not exist on the live server")
    return bool(row[0]), bool(row[1])


def current_alembic_revision(substrate: Any) -> str | None:
    """The revision recorded in ``alembic_version``, or ``None`` when the schema is at base."""
    try:
        with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename = 'alembic_version')"
            )
            if not cursor.fetchone()[0]:
                return None
            cursor.execute("SELECT version_num FROM alembic_version")
            row = cursor.fetchone()
    except psycopg.Error as exc:
        raise AssertionError(f"could not read alembic_version: {exc}") from exc
    return None if row is None else row[0]
