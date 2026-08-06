"""FORCE row-level security on every runtime table this package owns.

Status: passing against a real PostgreSQL 16 instance. In Phase A these same tests, unchanged,
failed with ``MissingSubstrateCapability`` after proving the database was reached — that RED is
what makes them worth anything now. They still resolve their capabilities the same way, so a
regression that removed the implementation would return them to that failure rather than to a
green run against nothing.

The subjects are the substrate's own tables — the outbox and the audit table. No domain or business
table is invented to stand in for them, because a substrate package has no domain.

A positive isolation test alone is weak: a table holding no other tenant's rows passes it. What
matters is what tenant A must *not* be able to do, what the runtime role sees when it presents no
usable context, and — the sharpest case — what happens when the runtime role writes the tenant
setting itself. A policy that trusts a raw GUC is defeated by one ``SET LOCAL``, so the assertion
below is on the resulting access, never on the SQL that was issued.
"""

from __future__ import annotations

import psycopg
import pytest
import sqlalchemy

from _harness import dbfacts, guc
from _harness.capability import (
    require_capability,
    schema_names,
    tenant_context_attestation,
)
from _harness.docker_postgres import RUNTIME_ROLE
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.rls]

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"


def _migrate(substrate, alembic_config):
    from alembic import command

    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), "head")


def _insert(connection, names, table, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{table}" ("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def _seed(tenant_transaction, url, names):
    """One outbox row and one audit row per tenant, each written through the controlled API."""
    seeded: dict[tuple[str, str], object] = {}
    for tenant, label in ((TENANT_A, "a"), (TENANT_B, "b")):
        with tenant_transaction(url, tenant) as connection:
            for table in names.runtime_tables:
                seeded[(tenant, table)] = _insert(
                    connection, names, table, tenant, f"{label}-{table}"
                )
    return seeded


def test_every_runtime_table_has_row_level_security_enabled_and_forced(substrate):
    """Enumerated over the declared runtime tables, not spot-checked on one of them."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)

    assert names.runtime_tables == (names.outbox_table, names.audit_table)
    for table in names.runtime_tables:
        enabled, forced = dbfacts.force_rls_enabled(substrate, table)
        assert enabled is True, f"row-level security must be enabled on {table}"
        assert forced is True, f"row-level security must be FORCED on {table}, not merely enabled"
    # The role the policy has to constrain can never opt out of it.
    assert dbfacts.role_attributes(substrate, RUNTIME_ROLE)["bypassrls"] is False


def test_a_tenant_reads_only_its_own_rows_in_every_runtime_table(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    _seed(tenant_transaction, url, names)

    with tenant_transaction(url, TENANT_A) as connection:
        for table in names.runtime_tables:
            # tenant_id is a uuid column, so the driver hands back uuid.UUID. Normalising to text
            # is what makes this comparison meaningful — comparing the two types directly would be
            # unequal for a reason that has nothing to do with tenancy.
            tenants = [
                str(value)
                for value in connection.execute(
                    sqlalchemy.text(f'SELECT DISTINCT "{names.tenant_column}" FROM "{table}"')
                )
                .scalars()
                .all()
            ]
            assert tenants == [TENANT_A], f"tenant A saw foreign rows in {table}: {tenants}"


def test_negative_proof_tenant_a_cannot_select_a_tenant_b_row_in_either_runtime_table(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    seeded = _seed(tenant_transaction, url, names)

    with tenant_transaction(url, TENANT_A) as connection:
        for table in names.runtime_tables:
            found = connection.execute(
                sqlalchemy.text(f'SELECT count(*) FROM "{table}" WHERE "{names.id_column}" = :id'),
                {"id": seeded[(TENANT_B, table)]},
            ).scalar_one()
            assert found == 0, f"tenant A selected tenant B's row from {table} by identifier"


def test_negative_proof_tenant_a_cannot_update_or_delete_a_tenant_b_outbox_row(substrate):
    """The outbox is the mutable runtime table; the audit table is immutable for everyone."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    seeded = _seed(tenant_transaction, url, names)
    victim = seeded[(TENANT_B, names.outbox_table)]

    with tenant_transaction(url, TENANT_A) as connection:
        updated = connection.execute(
            sqlalchemy.text(
                f'UPDATE "{names.outbox_table}" SET "{names.payload_column}" = :payload '
                f'WHERE "{names.id_column}" = :id'
            ),
            {"payload": "hijacked", "id": victim},
        ).rowcount
        deleted = connection.execute(
            sqlalchemy.text(f'DELETE FROM "{names.outbox_table}" WHERE "{names.id_column}" = :id'),
            {"id": victim},
        ).rowcount
    assert updated == 0, "tenant A updated tenant B's outbox row"
    assert deleted == 0, "tenant A deleted tenant B's outbox row"

    with tenant_transaction(url, TENANT_B) as connection:
        payload = connection.execute(
            sqlalchemy.text(
                f'SELECT "{names.payload_column}" FROM "{names.outbox_table}" '
                f'WHERE "{names.id_column}" = :id'
            ),
            {"id": victim},
        ).scalar_one()
    assert payload == f"b-{names.outbox_table}", "tenant B's row was altered"


def test_negative_proof_tenant_a_cannot_insert_a_row_carrying_tenant_bs_identifier(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    for table in names.runtime_tables:
        with pytest.raises(sqlalchemy.exc.DBAPIError):
            with tenant_transaction(url, TENANT_A) as connection:
                _insert(connection, names, table, TENANT_B, "smuggled")

    with tenant_transaction(url, TENANT_B) as connection:
        for table in names.runtime_tables:
            smuggled = connection.execute(
                sqlalchemy.text(
                    f'SELECT count(*) FROM "{table}" WHERE "{names.payload_column}" = :payload'
                ),
                {"payload": "smuggled"},
            ).scalar_one()
            assert smuggled == 0, f"a row was smuggled into {table} under tenant B"


def test_negative_proof_a_missing_tenant_context_denies_both_reads_and_writes(substrate):
    """No context must mean no access — neither read nor write — not full access."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    _seed(tenant_transaction, url, names)

    # 1. The controlled API refuses to open a transaction with no tenant identity at all.
    with pytest.raises(Exception) as refused:
        with tenant_transaction(url, None):
            pass
    assert not isinstance(refused.value, AssertionError), (
        "the refusal must be a real error, not an assert"
    )

    # 2. The database-level proof: a raw runtime connection that sets nothing is denied reads...
    for table in names.runtime_tables:
        with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
            cursor.execute(f'SELECT count(*) FROM "{table}"')
            assert cursor.fetchone()[0] == 0, f"a contextless connection read rows from {table}"
    # ...and writes.
    for table in names.runtime_tables:
        with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.Error):
                cursor.execute(
                    f'INSERT INTO "{table}" ("{names.tenant_column}", "{names.payload_column}") '
                    f"VALUES (%s, %s)",
                    (TENANT_A, "contextless-write"),
                )


def test_negative_proof_an_invalid_or_empty_tenant_context_denies_both_reads_and_writes(substrate):
    """An unusable context must fail exactly as closed as a missing one."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    _seed(tenant_transaction, url, names)

    for invalid in ("", "   ", "not-a-tenant-identifier"):
        for table in names.runtime_tables:
            with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
                cursor.execute("SELECT set_config(%s, %s, true)", (names.tenant_setting, invalid))
                cursor.execute(f'SELECT count(*) FROM "{table}"')
                assert cursor.fetchone()[0] == 0, (
                    f"an invalid context {invalid!r} read rows from {table}"
                )
            with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
                cursor.execute("SELECT set_config(%s, %s, true)", (names.tenant_setting, invalid))
                with pytest.raises(psycopg.Error):
                    cursor.execute(
                        f'INSERT INTO "{table}" ("{names.tenant_column}", "{names.payload_column}") '
                        f"VALUES (%s, %s)",
                        (TENANT_A, "invalid-context-write"),
                    )


def test_negative_proof_a_forged_tenant_context_grants_no_access(substrate):
    """The sharpest case: the runtime role writes the policy's own settings itself.

    The design may well allow that write to succeed — a GUC is not a security boundary. What must
    not happen is that the write produces *access*. The policy has to require an attestation the
    runtime role cannot mint outside the controlled transaction API.

    Every setting the policy consults is read from the declared attestation, so the proof cannot
    go stale by covering only the settings that existed when it was written. Both mechanisms a
    client has are exercised, and the assertion is on the resulting reads and writes, never on the
    SQL text that was issued.
    """
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)
    attestation = tenant_context_attestation(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    _seed(tenant_transaction, url, names)

    # The declared outcome property, and the setting list the forgery must cover.
    assert attestation["forgeable_by_runtime_role"] is False
    policy_settings = list(attestation["policy_settings"])
    assert policy_settings, "the attestation must declare the settings the policy consults"
    assert names.tenant_setting in policy_settings

    def forge(cursor, mechanism: str) -> None:
        """Claim to be tenant B by every means a client actually has."""
        for setting in policy_settings:
            if mechanism == "set_local":
                guc.set_local(cursor, setting, TENANT_B)
            elif mechanism == "set_session":
                guc.set_session(cursor, setting, TENANT_B)
            else:
                guc.set_config(cursor, setting, TENANT_B, local=False)

    for mechanism in ("set_local", "set_session", "set_config"):
        # Reads must yield nothing, on every runtime table.
        for table in names.runtime_tables:
            with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
                forge(cursor, mechanism)
                cursor.execute(f'SELECT count(*) FROM "{table}"')
                visible = cursor.fetchone()[0]
                assert visible == 0, (
                    f"a tenant context forged with {mechanism} exposed {visible} row(s) of "
                    f"{table}; the policy must fail closed without a controlled-API attestation"
                )
        # Writes must be refused too — a forged identity must not be able to append either.
        for table in names.runtime_tables:
            with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
                forge(cursor, mechanism)
                with pytest.raises(psycopg.Error):
                    cursor.execute(
                        f'INSERT INTO "{table}" ("{names.tenant_column}", "{names.payload_column}") '
                        f"VALUES (%s, %s)",
                        (TENANT_B, f"forged-{mechanism}"),
                    )

    # Nothing forged reached either table.
    with tenant_transaction(url, TENANT_B) as connection:
        for table in names.runtime_tables:
            forged_rows = connection.execute(
                sqlalchemy.text(
                    f'SELECT count(*) FROM "{table}" WHERE "{names.payload_column}" LIKE :pattern'
                ),
                {"pattern": "forged-%"},
            ).scalar_one()
            assert forged_rows == 0, f"a forged write landed in {table}"


def test_force_is_proven_behaviourally_the_table_owner_is_subject_to_the_policy(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    _seed(tenant_transaction, substrate.sqlalchemy_url(substrate.runtime), names)

    # The owning migration role, holding tenant A's context, must see only tenant A's rows.
    # Without FORCE it would see every tenant's.
    for table in names.runtime_tables:
        with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
            guc.set_local(cursor, names.tenant_setting, TENANT_A)
            cursor.execute(f'SELECT DISTINCT "{names.tenant_column}" FROM "{table}"')
            # Normalised to text for the same reason as above: without it a uuid would never
            # compare equal to the literal and the assertion would hold for the wrong reason.
            visible = sorted(str(row[0]) for row in cursor.fetchall())
        assert TENANT_B not in visible, (
            f"the owner bypassed the policy on {table} and saw {visible}"
        )
        assert visible == [TENANT_A], f"the owner saw {visible} rather than only tenant A's rows"
