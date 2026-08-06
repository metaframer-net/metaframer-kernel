"""Claim fencing: a stale claimant must not be able to act on a row it no longer holds.

The scenario is ordinary at-least-once operation, not an exotic race. Claimant A takes a row and
stalls. A's lease expires. Claimant B reclaims the row and starts work. A now wakes up holding a
token that is no longer current, and calls release or publish. Under an identifier-only API those
calls would succeed: A's release would hand B's in-flight row back to the queue, or A's publish
would mark work finished that B is still doing and nobody ever will. Either way the row's state
would stop describing reality, and the audit trail would record something that did not happen.

That is exactly what this suite was written to catch, and at the time it caught it: these tests
first ran against ``release_batch`` and ``mark_published``, which took identifiers only, and five
of the six failed with ``MissingSubstrateCapability`` because no fenced entry point existed.

Both identifier-only paths are gone now. The package's only public mutations are ``release_claim``
and ``publish_claim``, each requiring a claim token, each comparing it against the one stored on the
row, and each refusing outright when no token is supplied. A stale token therefore affects zero
rows and leaves the current claim untouched, while the current token still works.

The first test needs no fenced capability and is the control: it establishes that expiry and
reclaiming really produce two distinct tokens for one row, so a fencing failure below cannot be
blamed on the claim path. Row-level security stays decisive throughout — another tenant's row is
never visible to the statement, so its token is never even compared.
"""

from __future__ import annotations

import pytest
import sqlalchemy

from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.outbox]

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"


def _migrate(substrate, alembic_config):
    from alembic import command

    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), "head")


def _enqueue(connection, names, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{names.outbox_table}" '
            f'("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def _row_state(tenant_transaction, url, names, tenant, identifier):
    """The claim-bearing columns, read back through the controlled API."""
    with tenant_transaction(url, tenant) as connection:
        row = (
            connection.execute(
                sqlalchemy.text(
                    f"SELECT claim_token, claimed_at, claim_expires_at, attempts, published_at "
                    f'FROM "{names.outbox_table}" WHERE "{names.id_column}" = :id'
                ),
                {"id": identifier},
            )
            .mappings()
            .one()
        )
    return dict(row)


def _hand_over(substrate, tenant_transaction, claim_batch, names, url, tenant=TENANT_A):
    """Drive one full hand-over: A claims with a lease that expires, B reclaims.

    Returns ``(identifier, stale_token, current_token)``.
    """
    with tenant_transaction(url, tenant) as connection:
        identifier = _enqueue(connection, names, tenant, "fenced-hand-over")

    with tenant_transaction(url, tenant) as connection:
        first = claim_batch(connection, 1, lease_seconds=0)
    assert [row[names.id_column] for row in first] == [identifier]

    with tenant_transaction(url, tenant) as connection:
        second = claim_batch(connection, 1)
    assert [row[names.id_column] for row in second] == [identifier], (
        "the expired row must be reclaimable, or the fencing scenario cannot arise at all"
    )
    return identifier, first[0]["claim_token"], second[0]["claim_token"]


# =====================================================================================
# Control: no new capability needed. These pass today.
# =====================================================================================


def test_an_expired_claim_is_taken_over_by_a_second_claimant_holding_a_different_token(substrate):
    """The precondition for every fencing test below: two live tokens for one row, in order."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    identifier, stale_token, current_token = _hand_over(
        substrate, tenant_transaction, claim_batch, names, url
    )

    assert stale_token is not None and current_token is not None
    assert stale_token != current_token, "the reclaim must issue a new token, not reuse the old one"

    state = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert state["claim_token"] == current_token, "the row must record the current claimant's token"
    assert state["claim_token"] != stale_token
    assert state["attempts"] == 2, "each claim of the row counts as an attempt"
    assert state["published_at"] is None


# =====================================================================================
# RED: fencing has no implementation yet.
# =====================================================================================


def test_a_stale_claimants_fenced_release_affects_no_rows_and_leaves_the_current_claim_intact(
    substrate,
):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    identifier, stale_token, current_token = _hand_over(
        substrate, tenant_transaction, claim_batch, names, url
    )
    before = _row_state(tenant_transaction, url, names, TENANT_A, identifier)

    release_claim = require_capability("outbox.release_claim", substrate=substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        released = release_claim(connection, [identifier], claim_token=stale_token)
    assert released == [], (
        "a stale claimant's release must affect no rows; releasing a row another claimant now "
        "holds would hand live work back to the queue while it is still being done"
    )

    after = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert after["claim_token"] == current_token, "the current claim must survive untouched"
    assert after["claimed_at"] == before["claimed_at"]
    assert after["claim_expires_at"] == before["claim_expires_at"]
    assert after["published_at"] is None


def test_a_stale_claimants_fenced_publish_affects_no_rows_and_leaves_the_current_claim_intact(
    substrate,
):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    identifier, stale_token, current_token = _hand_over(
        substrate, tenant_transaction, claim_batch, names, url
    )

    publish_claim = require_capability("outbox.publish_claim", substrate=substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        published = publish_claim(connection, [identifier], claim_token=stale_token)
    assert published == [], (
        "a stale claimant's publish must affect no rows; marking work finished that the current "
        "claimant is still doing records something that did not happen"
    )

    after = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert after["published_at"] is None, "the row must not be marked published by a stale claimant"
    assert after["claim_token"] == current_token, "the current claim must survive untouched"


def test_the_current_claim_token_can_release_its_own_claim(substrate):
    """Fencing must reject the stale caller without disabling the legitimate one."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    identifier, _stale_token, current_token = _hand_over(
        substrate, tenant_transaction, claim_batch, names, url
    )

    release_claim = require_capability("outbox.release_claim", substrate=substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        released = release_claim(connection, [identifier], claim_token=current_token)
    assert released == [identifier], "the current claimant must be able to release its own claim"

    after = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert after["claim_token"] is None
    assert after["claimed_at"] is None
    assert after["claim_expires_at"] is None
    assert after["published_at"] is None

    # ...and the released row goes back into circulation, as at-least-once requires.
    with tenant_transaction(url, TENANT_A) as connection:
        reclaimed = claim_batch(connection, 1)
    assert [row[names.id_column] for row in reclaimed] == [identifier]
    assert reclaimed[0]["claim_token"] != current_token


def test_the_current_claim_token_can_publish_its_own_claim(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)
    identifier, stale_token, current_token = _hand_over(
        substrate, tenant_transaction, claim_batch, names, url
    )

    publish_claim = require_capability("outbox.publish_claim", substrate=substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        published = publish_claim(connection, [identifier], claim_token=current_token)
    assert published == [identifier], "the current claimant must be able to publish its own claim"

    after = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert after["published_at"] is not None

    # A published row leaves circulation, and the stale claimant still cannot touch it.
    with tenant_transaction(url, TENANT_A) as connection:
        assert claim_batch(connection, 5, lease_seconds=0) == []
    release_claim = require_capability("outbox.release_claim", substrate=substrate)
    with tenant_transaction(url, TENANT_A) as connection:
        assert release_claim(connection, [identifier], claim_token=stale_token) == []
    assert (
        _row_state(tenant_transaction, url, names, TENANT_A, identifier)["published_at"] is not None
    )


def test_a_fenced_mutation_never_crosses_the_tenant_boundary(substrate):
    """Fencing is an addition to row-level security, never a way around it.

    Even a caller holding tenant B's genuine, current token must not be able to reach that row
    from a tenant A transaction: the policy denies it before the token is ever compared.
    """
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_B) as connection:
        foreign = _enqueue(connection, names, TENANT_B, "b-owned")
    with tenant_transaction(url, TENANT_B) as connection:
        foreign_claim = claim_batch(connection, 1)
    assert [row[names.id_column] for row in foreign_claim] == [foreign]
    foreign_token = foreign_claim[0]["claim_token"]

    release_claim = require_capability("outbox.release_claim", substrate=substrate)
    publish_claim = require_capability("outbox.publish_claim", substrate=substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        assert release_claim(connection, [foreign], claim_token=foreign_token) == [], (
            "tenant A released tenant B's row while holding B's own token"
        )
        assert publish_claim(connection, [foreign], claim_token=foreign_token) == [], (
            "tenant A published tenant B's row while holding B's own token"
        )

    state = _row_state(tenant_transaction, url, names, TENANT_B, foreign)
    assert state["claim_token"] == foreign_token, "tenant B's claim must be untouched"
    assert state["published_at"] is None
