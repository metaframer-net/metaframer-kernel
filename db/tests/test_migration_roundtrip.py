"""Alembic upgrade -> downgrade -> re-upgrade against a real PostgreSQL 16 server.

Status: passing against a real PostgreSQL 16 instance. In Phase A these same tests, unchanged,
failed with ``MissingSubstrateCapability`` after proving the database was reached — that RED is
what makes them worth anything now. They still resolve their capabilities the same way, so a
regression that removed the implementation would return them to that failure rather than to a
green run against nothing. The scenario below the capability call is the GREEN contract — it is the
behaviour Phase B must satisfy without the test being rewritten to accommodate it.
"""

from __future__ import annotations

import pytest

from _harness import dbfacts
from _harness.capability import require_capability, schema_names
from _harness.docker_postgres import MIGRATION_ROLE
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.migration]


def test_upgrade_downgrade_reupgrade_is_a_real_round_trip(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    head_revision = require_capability("migration.head_revision", substrate=substrate)
    names = schema_names(substrate)

    from alembic import command

    config = alembic_config(substrate.sqlalchemy_url(substrate.migration))
    # Exactly the runtime tables this package owns: the outbox and the audit table.
    tables = names.runtime_tables
    assert tables == (names.outbox_table, names.audit_table)

    # 1. Upgrade to head creates the declared substrate objects.
    command.upgrade(config, "head")
    assert dbfacts.current_alembic_revision(substrate) == head_revision
    for table in tables:
        assert dbfacts.table_exists(substrate, table), f"{table} must exist at head"

    # 2. Downgrade to base removes them. A downgrade that leaves the objects behind is a stub,
    #    and would make the re-upgrade below meaningless.
    command.downgrade(config, "base")
    assert dbfacts.current_alembic_revision(substrate) is None
    for table in tables:
        assert not dbfacts.table_exists(substrate, table), (
            f"{table} must be removed by a real downgrade"
        )

    # 3. Re-upgrade returns to the same head, so the cycle is genuinely repeatable.
    command.upgrade(config, "head")
    assert dbfacts.current_alembic_revision(substrate) == head_revision
    for table in tables:
        assert dbfacts.table_exists(substrate, table), (
            f"{table} must be recreated by the re-upgrade"
        )


def test_the_round_trip_runs_as_the_migration_role_never_as_a_superuser(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)

    attributes = dbfacts.role_attributes(substrate, MIGRATION_ROLE)
    assert attributes["superuser"] is False
    assert attributes["bypassrls"] is False

    url = substrate.sqlalchemy_url(substrate.migration)
    config = alembic_config(url)

    from alembic import command
    from sqlalchemy import create_engine, text

    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT current_user")).scalar_one() == MIGRATION_ROLE
    finally:
        engine.dispose()
    command.downgrade(config, "base")


def test_re_upgrading_an_already_current_schema_is_a_no_op(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    head_revision = require_capability("migration.head_revision", substrate=substrate)

    from alembic import command

    config = alembic_config(substrate.sqlalchemy_url(substrate.migration))
    command.upgrade(config, "head")
    assert dbfacts.current_alembic_revision(substrate) == head_revision
    # Running upgrade again must neither fail nor move the recorded revision.
    command.upgrade(config, "head")
    assert dbfacts.current_alembic_revision(substrate) == head_revision
    command.downgrade(config, "base")
