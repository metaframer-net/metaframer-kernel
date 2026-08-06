"""Per-test liveness proof.

Every behavioural test calls this before it demands a production capability. The point is
evidentiary: each test establishes, inside its own body, that it really did reach an
authenticated PostgreSQL 16 server as the non-owner runtime role. In Phase A that is what made
the RED attributable to the absent capability rather than to the environment; now it is what
keeps a green run from being green against a database nobody reached. If this step fails, the
failure is a harness/environment failure and is reported as one.
"""

from __future__ import annotations

from typing import Any

import psycopg

from ._errors import SubstrateHarnessError
from .docker_postgres import SERVER_VERSION_CEILING, SERVER_VERSION_FLOOR


def prove_database_reached(substrate: Any) -> None:
    """Assert a live, authenticated PostgreSQL 16 connection as the runtime role."""
    try:
        with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_user, current_database(), "
                "current_setting('server_version_num')::int"
            )
            user, database, version_num = cursor.fetchone()
    except psycopg.Error as exc:
        raise SubstrateHarnessError(
            f"the runtime role could not reach the database: {exc}; {substrate.health_evidence()}"
        ) from exc

    if user != substrate.runtime.name:
        raise SubstrateHarnessError(f"connected as {user!r}, expected {substrate.runtime.name!r}")
    if database != substrate.database:
        raise SubstrateHarnessError(f"connected to {database!r}, expected {substrate.database!r}")
    if not SERVER_VERSION_FLOOR <= version_num < SERVER_VERSION_CEILING:
        raise SubstrateHarnessError(
            f"server_version_num={version_num} is outside the PostgreSQL 16 range"
        )
