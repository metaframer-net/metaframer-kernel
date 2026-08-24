"""``policy_decision_log``: 0003's own table, never a reuse of ``audit_log``. RED by design.

Preserves the P04d identity/hash-chain payload (``id``, ``tenant_id``, ``entry_hash``,
``prev_hash``, ``payload``, ``recorded_at``) behind the same guarantees S1 gives ``audit_log``:
FORCE row-level security keyed off ``mfk_current_tenant()``, a runtime role limited to
SELECT/INSERT, and a table-specific append-only trigger the owner cannot bypass.

Every test proves the database was reached before demanding anything from production code, and
resolves any missing production symbol *inside* the test body — never at import time — so a fresh
checkout without 0003 fails each scenario on its own terms, not the whole file at collection.
``entry_hash``/``prev_hash`` here are fresh opaque 64-hex strings, not a real SHA-256 over the
payload: canonical hash recomputation and verification is P04e2's job, not this table's DDL.
"""

from __future__ import annotations

import importlib
import secrets
from datetime import datetime, timezone

import psycopg
import pytest
import sqlalchemy

from _harness import guc
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.migration, pytest.mark.audit]

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"

# Not read from the production contract: the contract is itself part of what this package must
# still update, so the suite states the identifiers it demands rather than trusting a value that
# may not exist yet.
CUSTOMER_REVISION = "0002_customer_records"
P04E1_REVISION = "0003_policy_decision_log"

# Fixed physical names taken directly from the P04e1 contract, not read through schema.contract:
# declaring that mapping is itself part of the production work this suite is RED against.
TABLE = "policy_decision_log"
(
    ID_COLUMN,
    TENANT_COLUMN,
    ENTRY_HASH_COLUMN,
    PREV_HASH_COLUMN,
    PAYLOAD_COLUMN,
    RECORDED_AT_COLUMN,
) = ("id", "tenant_id", "entry_hash", "prev_hash", "payload", "recorded_at")
COLUMNS = (
    ID_COLUMN,
    TENANT_COLUMN,
    ENTRY_HASH_COLUMN,
    PREV_HASH_COLUMN,
    PAYLOAD_COLUMN,
    RECORDED_AT_COLUMN,
)

_ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32, canonical uppercase form


def _require_production_surface():
    """Fail with clear evidence, from inside a test body, when P04e1's table is undeclared."""
    module = importlib.import_module("metaframer_kernel_db.schema")
    if not hasattr(module, "POLICY_DECISION_LOG_TABLE"):
        pytest.fail(
            "P04e1 production capability missing: 'metaframer_kernel_db.schema' defines no "
            "attribute 'POLICY_DECISION_LOG_TABLE'",
            pytrace=False,
        )


def _ulid() -> str:
    """A syntactically valid canonical uppercase ULID; uniqueness is all this suite needs.

    The first character is restricted to 0-7 (the canonical ULID's 48-bit timestamp leaves the
    top 3 bits of its first base32 character always zero); the remaining 25 draw from the full
    Crockford alphabet.
    """
    first = secrets.choice("01234567")
    rest = "".join(secrets.choice(_ULID_ALPHABET) for _ in range(25))
    return first + rest


def _hex64() -> str:
    return secrets.token_hex(32)


def _payload(entry_id: str, tenant: str, prev_hash: str | None, note: str) -> dict:
    return {
        "id": entry_id,
        "prevHash": prev_hash,
        "requestActor": {"tenantId": tenant, "actorId": "11111111-2222-3333-4444-555555555555"},
        "note": note,
    }


def _row(tenant: str, predecessor: dict | None, note: str) -> dict:
    """A fresh, self-consistent candidate row: opaque entry_hash, and a payload that agrees with
    every column (id, prevHash, requestActor.tenantId) unless a test deliberately breaks that."""
    entry_id = _ulid()
    prev_hash = predecessor["entry_hash"] if predecessor else None
    return {
        "entry_id": entry_id,
        "tenant": tenant,
        "entry_hash": _hex64(),
        "prev_hash": prev_hash,
        "payload": _payload(entry_id, tenant, prev_hash, note),
    }


def _values(row: dict) -> tuple:
    import json

    return (
        row["entry_id"],
        row["tenant"],
        row["entry_hash"],
        row["prev_hash"],
        json.dumps(row["payload"]),
    )


def _migrate_to_head(substrate, alembic_config):
    from alembic import command

    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), P04E1_REVISION)


def _insert(connection, row: dict):
    entry_id, tenant, entry_hash, prev_hash, payload = _values(row)
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{TABLE}" ("{ID_COLUMN}", "{TENANT_COLUMN}", "{ENTRY_HASH_COLUMN}", '
            f'"{PREV_HASH_COLUMN}", "{PAYLOAD_COLUMN}", "{RECORDED_AT_COLUMN}") VALUES '
            f"(:id, :tenant, :entry_hash, :prev_hash, CAST(:payload AS jsonb), :recorded_at) "
            f'RETURNING "{ID_COLUMN}"'
        ),
        {
            "id": entry_id,
            "tenant": tenant,
            "entry_hash": entry_hash,
            "prev_hash": prev_hash,
            "payload": payload,
            "recorded_at": datetime.now(timezone.utc),
        },
    ).scalar_one()


def _raw_insert(cursor, row: dict):
    entry_id, tenant, entry_hash, prev_hash, payload = _values(row)
    cursor.execute(
        f'INSERT INTO "{TABLE}" ("{ID_COLUMN}", "{TENANT_COLUMN}", "{ENTRY_HASH_COLUMN}", '
        f'"{PREV_HASH_COLUMN}", "{PAYLOAD_COLUMN}", "{RECORDED_AT_COLUMN}") '
        f"VALUES (%s, %s, %s, %s, %s, now())",
        (entry_id, tenant, entry_hash, prev_hash, payload),
    )


# 1. Migration: upgrade to 0003, downgrade to 0002, re-upgrade
def test_0003_upgrades_the_schema_and_downgrade_returns_exactly_to_0002(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    _require_production_surface()

    from alembic import command
    from _harness import dbfacts

    config = alembic_config(substrate.sqlalchemy_url(substrate.migration))

    # 1. Upgrading to the new head creates the table with its declared shape.
    command.upgrade(config, P04E1_REVISION)
    assert dbfacts.current_alembic_revision(substrate) == P04E1_REVISION
    assert dbfacts.table_exists(substrate, TABLE), "policy_decision_log must exist at 0003"

    with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_name, is_nullable FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (TABLE,),
        )
        nullability = dict(cursor.fetchall())
    for column in COLUMNS:
        assert column in nullability, f"{TABLE} must declare column {column}"
    assert nullability[PREV_HASH_COLUMN] == "YES", "prev_hash must be nullable (genesis rows)"
    for column in (ID_COLUMN, TENANT_COLUMN, ENTRY_HASH_COLUMN):
        assert nullability[column] == "NO", f"{column} must be NOT NULL"

    # A unique index guarding (tenant_id, entry_hash), and FORCE row-level security matching the
    # rest of the S1 substrate.
    with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = %s",
            (TABLE,),
        )
        index_defs = "\n".join(row[0] for row in cursor.fetchall())
    assert (
        "UNIQUE" in index_defs and TENANT_COLUMN in index_defs and ENTRY_HASH_COLUMN in index_defs
    ), f"a unique (tenant_id, entry_hash) index must exist on {TABLE}"
    row_security, force_row_security = dbfacts.force_rls_enabled(substrate, TABLE)
    assert row_security is True
    assert force_row_security is True

    # 2. Downgrading to the previous head removes it and nothing else the S1/GJ-01 surface owns.
    command.downgrade(config, CUSTOMER_REVISION)
    assert dbfacts.current_alembic_revision(substrate) == CUSTOMER_REVISION
    assert not dbfacts.table_exists(substrate, TABLE), (
        "downgrade to 0002 must drop policy_decision_log"
    )
    for untouched in ("customer_records", "transactional_outbox", "audit_log"):
        assert dbfacts.table_exists(substrate, untouched), (
            f"downgrading 0003 must not touch {untouched}"
        )

    # 3. Re-upgrading is a genuine repeat, not a one-shot.
    command.upgrade(config, P04E1_REVISION)
    assert dbfacts.current_alembic_revision(substrate) == P04E1_REVISION
    assert dbfacts.table_exists(substrate, TABLE), "re-upgrade must recreate policy_decision_log"


# 2. Genesis rows, tenant isolation, and context denial
def test_genesis_rows_isolate_by_tenant_and_deny_a_missing_or_forged_context(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)
    _require_production_surface()

    _migrate_to_head(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    genesis_a = _row(TENANT_A, None, "genesis")
    genesis_b = _row(TENANT_B, None, "genesis")
    with tenant_transaction(url, TENANT_A) as connection:
        _insert(connection, genesis_a)
    with tenant_transaction(url, TENANT_B) as connection:
        _insert(connection, genesis_b)

    # Tenant isolation: each tenant sees only its own row.
    with tenant_transaction(url, TENANT_A) as connection:
        rows_a = (
            connection.execute(sqlalchemy.text(f'SELECT "{ID_COLUMN}" FROM "{TABLE}"'))
            .scalars()
            .all()
        )
    assert rows_a == [genesis_a["entry_id"]]

    with tenant_transaction(url, TENANT_B) as connection:
        rows_b = (
            connection.execute(sqlalchemy.text(f'SELECT "{ID_COLUMN}" FROM "{TABLE}"'))
            .scalars()
            .all()
        )
    assert rows_b == [genesis_b["entry_id"]]

    # WITH CHECK: an attested TENANT_A transaction cannot write a row naming TENANT_B, even with a
    # payload that agrees with that other tenant. No such row survives the rejected transaction.
    cross_tenant = _row(TENANT_B, None, "cross-tenant-attempt")
    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            _insert(connection, cross_tenant)
    with tenant_transaction(url, TENANT_B) as connection:
        found = connection.execute(
            sqlalchemy.text(f'SELECT count(*) FROM "{TABLE}" WHERE "{ID_COLUMN}" = :id'),
            {"id": cross_tenant["entry_id"]},
        ).scalar_one()
    assert found == 0, "a WITH CHECK violation must leave no row behind"

    # Missing context: no tenant context established at all denies both read and write.
    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        cursor.execute(f'SELECT count(*) FROM "{TABLE}"')
        assert cursor.fetchone()[0] == 0, "a connection with no tenant context must see nothing"
        with pytest.raises(psycopg.Error):
            _raw_insert(cursor, _row(TENANT_A, None, "no-context-attempt"))

    # Forged context: writing the raw tenant setting directly, without going through the attested
    # entry point, must not be honoured by the policy.
    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        guc.set_local(cursor, names.tenant_setting, TENANT_B)
        with pytest.raises(psycopg.Error):
            _raw_insert(cursor, _row(TENANT_B, None, "forged-context-attempt"))


# 3. Successor chain, and rejection of every way it can be broken
def test_the_successor_chain_holds_and_every_broken_link_and_mutation_is_rejected(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    _require_production_surface()

    _migrate_to_head(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    genesis = _row(TENANT_A, None, "genesis")
    successor = _row(TENANT_A, genesis, "successor")

    # A genuine two-link chain: genesis, then a successor pointing at its entry_hash.
    with tenant_transaction(url, TENANT_A) as connection:
        _insert(connection, genesis)
    with tenant_transaction(url, TENANT_A) as connection:
        _insert(connection, successor)

    with tenant_transaction(url, TENANT_A) as connection:
        stored_prev_hash = connection.execute(
            sqlalchemy.text(
                f'SELECT "{PREV_HASH_COLUMN}" FROM "{TABLE}" WHERE "{ID_COLUMN}" = :id'
            ),
            {"id": successor["entry_id"]},
        ).scalar_one()
    assert stored_prev_hash == genesis["entry_hash"]

    def _rejects(row: dict):
        with pytest.raises(sqlalchemy.exc.DBAPIError):
            with tenant_transaction(url, TENANT_A) as connection:
                _insert(connection, row)

    # Missing predecessor: prev_hash naming a hash that was never written.
    _rejects(_row(TENANT_A, {"entry_hash": _hex64()}, "orphan"))

    # Second genesis: a tenant may have at most one null-prev row.
    _rejects(_row(TENANT_A, None, "second-genesis"))

    # Fork: a second row also claiming the already-succeeded genesis as its predecessor.
    _rejects(_row(TENANT_A, genesis, "fork"))

    # Self-link: prev_hash equal to the row's own entry_hash, with a payload that agrees with both
    # columns — the payload's own prevHash is the same hash, not None — so only the
    # prev_hash != entry_hash invariant can reject it, never a payload/column mismatch.
    self_id, self_hash = _ulid(), _hex64()
    self_linked = {
        "entry_id": self_id,
        "tenant": TENANT_A,
        "entry_hash": self_hash,
        "prev_hash": self_hash,
        "payload": _payload(self_id, TENANT_A, self_hash, "self-link"),
    }
    _rejects(self_linked)

    # Malformed: entry_hash is not 64 lowercase hex characters.
    malformed = _row(TENANT_A, successor, "malformed")
    malformed["entry_hash"] = "not-a-hex-digest"
    _rejects(malformed)

    # Mismatched: the payload's own id disagrees with the row's id column.
    mismatched = _row(TENANT_A, successor, "mismatched")
    mismatched["payload"] = {**mismatched["payload"], "id": _ulid()}
    _rejects(mismatched)

    # Neither the runtime role nor the migration/owner role may UPDATE, DELETE or TRUNCATE —
    # mirroring audit_log's privileged invariant for this table specifically.
    target_id = genesis["entry_id"]

    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            connection.execute(
                sqlalchemy.text(
                    f'UPDATE "{TABLE}" SET "{PAYLOAD_COLUMN}" = :payload WHERE "{ID_COLUMN}" = :id'
                ),
                {"payload": '{"tampered": true}', "id": target_id},
            )
    with pytest.raises(sqlalchemy.exc.DBAPIError):
        with tenant_transaction(url, TENANT_A) as connection:
            connection.execute(
                sqlalchemy.text(f'DELETE FROM "{TABLE}" WHERE "{ID_COLUMN}" = :id'),
                {"id": target_id},
            )

    for statement, params in (
        (
            f'UPDATE "{TABLE}" SET "{PAYLOAD_COLUMN}" = %s WHERE "{ID_COLUMN}" = %s',
            ('{"tampered": true}', target_id),
        ),
        (f'DELETE FROM "{TABLE}" WHERE "{ID_COLUMN}" = %s', (target_id,)),
    ):
        with substrate.connect(substrate.migration) as connection, connection.cursor() as cursor:
            guc.set_local(cursor, "mfk.tenant_id", TENANT_A)
            with pytest.raises(psycopg.Error):
                cursor.execute(statement, params)

    for role in (substrate.migration, substrate.runtime):
        with substrate.connect(role) as connection, connection.cursor() as cursor:
            with pytest.raises(psycopg.Error):
                cursor.execute(f'TRUNCATE "{TABLE}"')
