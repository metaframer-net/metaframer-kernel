"""Transaction boundary, and a tenant context that is transaction-local rather than sticky.

Status: passing against a real PostgreSQL 16 instance. In Phase A these same tests, unchanged,
failed with ``MissingSubstrateCapability`` after proving the database was reached — that RED is
what makes them worth anything now. They still resolve their capabilities the same way, so a
regression that removed the implementation would return them to that failure rather than to a
green run against nothing.

Atomicity is exercised over the two tables this package owns. One transaction boundary appends an
audit row and an outbox row together — which is exactly the pairing the substrate exists to make
atomic — and both must survive or perish as one. No domain table is invented to play the part of a
"business change".

A tenant context applied with ``SET`` instead of ``SET LOCAL`` looks identical inside the
transaction and is a tenant-isolation hole outside it: the next checkout of a pooled connection
inherits the previous tenant's identity. These tests are written to tell those two apart.
"""

from __future__ import annotations

import pytest
import sqlalchemy

from _harness import guc
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.transaction]

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"


class _DeliberateFailure(RuntimeError):
    """Raised inside a transaction to force a rollback."""


def _migrate(substrate, alembic_config):
    from alembic import command

    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), "head")


def _append(connection, names, table, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{table}" ("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def _count(connection, names, table, payload):
    return connection.execute(
        sqlalchemy.text(
            f'SELECT count(*) FROM "{table}" WHERE "{names.payload_column}" = :payload'
        ),
        {"payload": payload},
    ).scalar_one()


def test_an_audit_and_an_outbox_write_in_one_boundary_are_rolled_back_together(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    marker = "rolled-back-pair"

    with pytest.raises(_DeliberateFailure):
        with tenant_transaction(url, TENANT_A) as connection:
            _append(connection, names, names.audit_table, TENANT_A, marker)
            _append(connection, names, names.outbox_table, TENANT_A, marker)
            raise _DeliberateFailure("abort after both writes")

    with tenant_transaction(url, TENANT_A) as connection:
        for table in names.runtime_tables:
            assert _count(connection, names, table, marker) == 0, (
                f"an aborted transaction left a row behind in {table}"
            )


def test_an_audit_and_an_outbox_write_in_one_boundary_are_persisted_together(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    marker = "committed-pair"

    with tenant_transaction(url, TENANT_A) as connection:
        _append(connection, names, names.audit_table, TENANT_A, marker)
        _append(connection, names, names.outbox_table, TENANT_A, marker)

    with tenant_transaction(url, TENANT_A) as connection:
        for table in names.runtime_tables:
            assert _count(connection, names, table, marker) == 1, (
                f"a committed transaction did not persist its row in {table}"
            )


def test_a_later_failure_in_the_boundary_undoes_an_earlier_success(substrate):
    """Partial success is not a state the boundary may leave behind."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with pytest.raises(_DeliberateFailure):
        with tenant_transaction(url, TENANT_A) as connection:
            _append(connection, names, names.audit_table, TENANT_A, "early-success")
            _append(connection, names, names.outbox_table, TENANT_A, "early-success")
            _append(connection, names, names.audit_table, TENANT_A, "late-work")
            raise _DeliberateFailure("abort after the early writes already succeeded")

    with tenant_transaction(url, TENANT_A) as connection:
        for payload in ("early-success", "late-work"):
            for table in names.runtime_tables:
                assert _count(connection, names, table, payload) == 0


def test_the_tenant_context_is_in_force_inside_the_transaction(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        in_force = connection.execute(
            sqlalchemy.text("SELECT current_setting(:setting, true)"),
            {"setting": names.tenant_setting},
        ).scalar_one()
    assert in_force == TENANT_A


def test_non_leakage_the_setting_does_not_survive_its_transaction_on_the_same_backend(substrate):
    """The decisive mechanism check, on one physical connection we control end to end.

    ``SET LOCAL`` must not survive the commit. Had the substrate used a session-scoped ``SET``,
    the second transaction below would still observe tenant A.
    """
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)

    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        guc.set_local(cursor, names.tenant_setting, TENANT_A)
        cursor.execute("SELECT current_setting(%s, true)", (names.tenant_setting,))
        assert cursor.fetchone()[0] == TENANT_A
        cursor.execute("SELECT pg_backend_pid()")
        backend_pid = cursor.fetchone()[0]
        connection.commit()

        # Same physical backend, next transaction: the context must be gone.
        cursor.execute(
            "SELECT pg_backend_pid(), current_setting(%s, true)", (names.tenant_setting,)
        )
        same_pid, leaked = cursor.fetchone()
    assert same_pid == backend_pid, "the non-leakage check must run on the same backend"
    assert leaked in (None, ""), f"the tenant context leaked past its transaction: {leaked!r}"


def test_non_leakage_a_later_transaction_never_inherits_the_previous_tenant(substrate):
    """Production-bound counterpart: consecutive transactions must not bleed into each other."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        _append(connection, names, names.audit_table, TENANT_A, "belongs-to-a")

    # A pooled connection is very likely reused here; tenant B must still see only tenant B.
    with tenant_transaction(url, TENANT_B) as connection:
        observed = connection.execute(
            sqlalchemy.text("SELECT current_setting(:setting, true)"),
            {"setting": names.tenant_setting},
        ).scalar_one()
        visible = connection.execute(
            sqlalchemy.text(f'SELECT count(*) FROM "{names.audit_table}"')
        ).scalar_one()
    assert observed == TENANT_B, "the second transaction inherited the first tenant's context"
    assert visible == 0, "tenant B saw tenant A's row through an inherited context"
