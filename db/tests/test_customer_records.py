"""GJ-01's first tenant-owned domain table: ``customer_records``, added by 0002_customer_records.

Exercised the same way the substrate suites exercise 0001: a real PostgreSQL 16 instance, the
controlled ``tenant_transaction`` API, and negative proofs on top of the positive one. This suite
imports ``metaframer_kernel_db.schema`` and ``metaframer_kernel_db.migrations`` directly rather
than through the capability contract — 0002 is a domain table outside the S1 runtime-substrate
contract that ``kernel-runtime-substrate-s1.json`` declares, and this package does not touch that
contract.
"""

from __future__ import annotations

import psycopg
import pytest
import sqlalchemy
from alembic import command

from _harness import dbfacts
from _harness.docker_postgres import RUNTIME_ROLE
from _harness.probe import prove_database_reached
from metaframer_kernel_db import migrations, schema
from metaframer_kernel_db.session import tenant_transaction

pytestmark = [pytest.mark.substrate, pytest.mark.rls]

TENANT_A = "33333333-3333-3333-3333-333333333333"
TENANT_B = "44444444-4444-4444-4444-444444444444"


def _migrate(substrate):
    config = migrations.alembic_config(substrate.sqlalchemy_url(substrate.migration))
    command.upgrade(config, "head")
    return config


def _insert(connection, tenant, name):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{schema.CUSTOMER_TABLE}" (tenant_id, name) '
            "VALUES (:tenant, :name) RETURNING id"
        ),
        {"tenant": tenant, "name": name},
    ).scalar_one()


def test_migration_creates_a_tenant_owned_customer_table_under_forced_rls(substrate):
    prove_database_reached(substrate)

    _migrate(substrate)

    assert dbfacts.table_exists(substrate, schema.CUSTOMER_TABLE)
    enabled, forced = dbfacts.force_rls_enabled(substrate, schema.CUSTOMER_TABLE)
    assert enabled is True
    assert forced is True
    assert dbfacts.role_attributes(substrate, RUNTIME_ROLE)["bypassrls"] is False


def test_a_tenant_reads_only_its_own_customer_rows(substrate):
    prove_database_reached(substrate)

    _migrate(substrate)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        _insert(connection, TENANT_A, "customer-a")
    with tenant_transaction(url, TENANT_B) as connection:
        _insert(connection, TENANT_B, "customer-b")

    with tenant_transaction(url, TENANT_A) as connection:
        names = (
            connection.execute(sqlalchemy.text(f'SELECT name FROM "{schema.CUSTOMER_TABLE}"'))
            .scalars()
            .all()
        )
        assert names == ["customer-a"], f"tenant A saw foreign customer rows: {names}"


def test_negative_proof_a_missing_tenant_context_denies_customer_reads_and_writes(substrate):
    prove_database_reached(substrate)

    _migrate(substrate)
    url = substrate.sqlalchemy_url(substrate.runtime)
    with tenant_transaction(url, TENANT_A) as connection:
        _insert(connection, TENANT_A, "customer-a")

    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        cursor.execute(f'SELECT count(*) FROM "{schema.CUSTOMER_TABLE}"')
        assert cursor.fetchone()[0] == 0, "a contextless connection read customer rows"

    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        with pytest.raises(psycopg.Error):
            cursor.execute(
                f'INSERT INTO "{schema.CUSTOMER_TABLE}" (tenant_id, name) VALUES (%s, %s)',
                (TENANT_A, "contextless-write"),
            )


def test_downgrade_removes_only_the_customer_table(substrate):
    prove_database_reached(substrate)

    config = _migrate(substrate)
    assert dbfacts.current_alembic_revision(substrate) == migrations.HEAD_REVISION
    assert dbfacts.table_exists(substrate, schema.CUSTOMER_TABLE)
    for table in schema.RUNTIME_TABLES:
        assert dbfacts.table_exists(substrate, table)

    command.downgrade(config, "0001_runtime_substrate")

    assert not dbfacts.table_exists(substrate, schema.CUSTOMER_TABLE), (
        "downgrade to 0001 must remove the customer table"
    )
    for table in schema.RUNTIME_TABLES:
        assert dbfacts.table_exists(substrate, table), (
            f"downgrade to 0001 must not remove {table}, which 0001 owns"
        )

    command.downgrade(config, "base")
    assert dbfacts.current_alembic_revision(substrate) is None
    for table in (schema.CUSTOMER_TABLE, *schema.RUNTIME_TABLES):
        assert not dbfacts.table_exists(substrate, table)
