"""Per-test database reset.

The behavioural suites each migrate the schema themselves and then assert over the whole table —
"tenant B sees no rows", "no row is left unclaimed". Those assertions are only meaningful against a
database that holds nothing but what the test itself put there, so every test starts from an empty
database.

This is harness plumbing, not test semantics: it changes what a test *starts* with, never what it
asserts. Without it the suites would silently depend on their own alphabetical order.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg import sql

from ._errors import SubstrateHarnessError


def reset_database(instance: Any) -> None:
    """Return the database to a freshly provisioned, empty state.

    Runs as the superuser because it rebuilds the schema itself. The grants re-applied here are
    exactly the ones the initial provisioning applies, so the role properties the environment
    suite asserts hold identically before every test.
    """
    # Pooled SQLAlchemy connections would otherwise keep cached plans for tables that are about to
    # be dropped and recreated.
    try:
        from metaframer_kernel_db.session import dispose_engines

        dispose_engines()
    except ImportError:
        pass

    try:
        with instance.connect(instance.superuser, autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
                cursor.execute("CREATE SCHEMA public")
                cursor.execute(
                    sql.SQL("ALTER SCHEMA public OWNER TO {}").format(
                        sql.Identifier(instance.migration.name)
                    )
                )
                cursor.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
                cursor.execute(
                    sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(
                        sql.Identifier(instance.runtime.name)
                    )
                )
                cursor.execute(
                    sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(
                        sql.Identifier(instance.runtime.name)
                    )
                )
    except psycopg.Error as exc:
        raise SubstrateHarnessError(f"database reset failed: {exc}") from exc
