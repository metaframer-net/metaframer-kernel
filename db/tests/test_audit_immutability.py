"""Append-only audit, enforced by the database rather than by a revoked grant.

Status: passing against a real PostgreSQL 16 instance. In Phase A these same tests, unchanged,
failed with ``MissingSubstrateCapability`` after proving the database was reached — that RED is
what makes them worth anything now. They still resolve their capabilities the same way, so a
regression that removed the implementation would return them to that failure rather than to a
green run against nothing.

Revoking UPDATE and DELETE from the runtime role is necessary but not sufficient: the table owner
keeps them, so an audit trail protected only by grants is mutable by whoever runs migrations. The
privileged invariant below is the test that tells a real append-only guarantee apart from a
convenient one.
"""

from __future__ import annotations

import psycopg
import pytest
import sqlalchemy

from _harness import guc
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.audit]

TENANT_A = "11111111-1111-1111-1111-111111111111"


def _migrate(substrate, alembic_config):
    from alembic import command

    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), "head")


def _append(connection, names, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{names.audit_table}" '
            f'("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def test_an_audit_row_can_be_appended_and_read_back(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        identifier = _append(connection, names, TENANT_A, "created")

    with tenant_transaction(url, TENANT_A) as connection:
        payload = connection.execute(
            sqlalchemy.text(
                f'SELECT "{names.payload_column}" FROM "{names.audit_table}" '
                f'WHERE "{names.id_column}" = :id'
            ),
            {"id": identifier},
        ).scalar_one()
    assert payload == "created"


def test_the_runtime_role_cannot_update_an_audit_row(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        identifier = _append(connection, names, TENANT_A, "original")

    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            connection.execute(
                sqlalchemy.text(
                    f'UPDATE "{names.audit_table}" SET "{names.payload_column}" = :payload '
                    f'WHERE "{names.id_column}" = :id'
                ),
                {"payload": "tampered", "id": identifier},
            )

    with tenant_transaction(url, TENANT_A) as connection:
        payload = connection.execute(
            sqlalchemy.text(
                f'SELECT "{names.payload_column}" FROM "{names.audit_table}" '
                f'WHERE "{names.id_column}" = :id'
            ),
            {"id": identifier},
        ).scalar_one()
    assert payload == "original"


def test_the_runtime_role_cannot_delete_an_audit_row(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        identifier = _append(connection, names, TENANT_A, "durable")

    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            connection.execute(
                sqlalchemy.text(
                    f'DELETE FROM "{names.audit_table}" WHERE "{names.id_column}" = :id'
                ),
                {"id": identifier},
            )

    with tenant_transaction(url, TENANT_A) as connection:
        still_there = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.audit_table}" WHERE "{names.id_column}" = :id'
            ),
            {"id": identifier},
        ).scalar_one()
    assert still_there == 1


def test_the_privileged_invariant_even_the_table_owner_cannot_mutate_an_audit_row(substrate):
    """Immutability must be enforced by the database, not by a grant the owner still holds."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)

    with tenant_transaction(substrate.sqlalchemy_url(substrate.runtime), TENANT_A) as connection:
        identifier = _append(connection, names, TENANT_A, "privileged-original")

    # The migration role owns the audit table and holds every table privilege on it. It must
    # still be unable to rewrite or erase history.
    for statement, params in (
        (
            f'UPDATE "{names.audit_table}" SET "{names.payload_column}" = %s WHERE "{names.id_column}" = %s',
            ("owner-tampered", identifier),
        ),
        (f'DELETE FROM "{names.audit_table}" WHERE "{names.id_column}" = %s', (identifier,)),
    ):
        with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
            guc.set_local(cursor, names.tenant_setting, TENANT_A)
            with pytest.raises(psycopg.Error):
                cursor.execute(statement, params)

    with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
        guc.set_local(cursor, names.tenant_setting, TENANT_A)
        cursor.execute(
            f'SELECT "{names.payload_column}" FROM "{names.audit_table}" '
            f'WHERE "{names.id_column}" = %s',
            (identifier,),
        )
        row = cursor.fetchone()
    assert row is not None, "the owner deleted an audit row"
    assert row[0] == "privileged-original", "the owner rewrote an audit row"


def test_an_append_only_violation_aborts_its_transaction(substrate):
    """The violation must abort the work around it rather than being silently swallowed."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        identifier = _append(connection, names, TENANT_A, "anchor")

    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            _append(connection, names, TENANT_A, "written-alongside-a-violation")
            connection.execute(
                sqlalchemy.text(
                    f'DELETE FROM "{names.audit_table}" WHERE "{names.id_column}" = :id'
                ),
                {"id": identifier},
            )

    with tenant_transaction(url, TENANT_A) as connection:
        companion = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.audit_table}" '
                f'WHERE "{names.payload_column}" = :payload'
            ),
            {"payload": "written-alongside-a-violation"},
        ).scalar_one()
    assert companion == 0, "the aborted transaction's other append must not have survived"
