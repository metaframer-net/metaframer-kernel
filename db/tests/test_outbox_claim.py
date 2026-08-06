"""Transactional outbox: written with its audit row, claimed safely, at-least-once.

Status: passing against a real PostgreSQL 16 instance. In Phase A these same tests, unchanged,
failed with ``MissingSubstrateCapability`` after proving the database was reached — that RED is
what makes them worth anything now. They still resolve their capabilities the same way, so a
regression that removed the implementation would return them to that failure rather than to a
green run against nothing.

The guarantee under test is **at-least-once**, and the tests are written not to overstate it. A
transactional outbox cannot promise a row is delivered only once: a consumer that crashes after
claiming, or a claim lease that expires before the work is acknowledged, legitimately puts the row
back in play. What *can* be proven, and is proven here, is that two claimers racing for the same
batch do not both receive the same row **within one claim attempt**, and that every row carries a
stable identifier so a Phase B consumer can deduplicate whatever redelivery it sees.

The concurrency tests also distinguish ``FOR UPDATE SKIP LOCKED`` from a plain ``FOR UPDATE``.
Both prevent an overlapping claim; only the former lets a second claimer make progress while the
first still holds its rows. A blocking claim is correctness-preserving but liveness-destroying, so
the difference is asserted rather than assumed.
"""

from __future__ import annotations

import threading
import time

import pytest
import sqlalchemy

from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.outbox]

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"

# A second claimer must return well inside this bound while the first holds its claim open.
NON_BLOCKING_BUDGET_SECONDS = 5.0


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


def _audit(connection, names, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{names.audit_table}" '
            f'("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def test_an_outbox_row_is_written_and_rolled_back_with_the_audit_row_it_accompanies(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    class Abort(RuntimeError):
        pass

    with pytest.raises(Abort):
        with tenant_transaction(url, TENANT_A) as connection:
            _audit(connection, names, TENANT_A, "audited-change")
            _enqueue(connection, names, TENANT_A, "event-for-audited-change")
            raise Abort("the boundary fails after both rows were written")

    with tenant_transaction(url, TENANT_A) as connection:
        audited = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.audit_table}" '
                f'WHERE "{names.payload_column}" = :payload'
            ),
            {"payload": "audited-change"},
        ).scalar_one()
        events = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.outbox_table}" '
                f'WHERE "{names.payload_column}" = :payload'
            ),
            {"payload": "event-for-audited-change"},
        ).scalar_one()
    assert audited == 0
    assert events == 0, "the outbox row must roll back with the audit row it accompanies"


def test_two_concurrent_claimers_do_not_receive_the_same_row_within_one_claim_attempt(substrate):
    """Non-overlap is scoped to a single claim attempt, which is what a lease can actually promise."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    enqueued = set()
    with tenant_transaction(url, TENANT_A) as connection:
        for index in range(20):
            enqueued.add(_enqueue(connection, names, TENANT_A, f"event-{index}"))

    start = threading.Barrier(2)
    claimed: list[list] = [[], []]
    errors: list[BaseException] = []

    def claimer(slot: int) -> None:
        try:
            with tenant_transaction(url, TENANT_A) as connection:
                start.wait(timeout=NON_BLOCKING_BUDGET_SECONDS)
                claimed[slot] = [row[names.id_column] for row in claim_batch(connection, 10)]
        except BaseException as exc:  # noqa: BLE001 - surfaced through the assertion below
            errors.append(exc)

    threads = [threading.Thread(target=claimer, args=(slot,)) for slot in (0, 1)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == [], f"a concurrent claimer failed: {errors}"
    first, second = (set(batch) for batch in claimed)
    assert first & second == set(), "two in-flight claimers overlapped on the same row"
    # No claim of exclusivity beyond the attempt: only that what was handed out came from the
    # rows actually enqueued, and that the two leases did not intersect.
    assert (first | second) <= enqueued


def test_a_second_claimer_makes_progress_while_the_first_holds_its_claim(substrate):
    """Proves FOR UPDATE SKIP LOCKED rather than a plain, blocking FOR UPDATE."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        for index in range(10):
            _enqueue(connection, names, TENANT_A, f"held-{index}")

    first_has_claimed = threading.Event()
    release_first = threading.Event()
    elapsed: list[float] = []
    errors: list[BaseException] = []

    def holder() -> None:
        try:
            with tenant_transaction(url, TENANT_A) as connection:
                claim_batch(connection, 5)
                first_has_claimed.set()
                # Hold the claim open, still inside the transaction.
                release_first.wait(timeout=NON_BLOCKING_BUDGET_SECONDS * 2)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
            first_has_claimed.set()

    thread = threading.Thread(target=holder)
    thread.start()
    try:
        assert first_has_claimed.wait(timeout=30), "the first claimer never claimed"
        began = time.monotonic()
        with tenant_transaction(url, TENANT_A) as connection:
            second = claim_batch(connection, 5)
        elapsed.append(time.monotonic() - began)
    finally:
        release_first.set()
        thread.join(timeout=30)

    assert errors == [], f"the holding claimer failed: {errors}"
    assert elapsed[0] < NON_BLOCKING_BUDGET_SECONDS, (
        f"the second claimer blocked for {elapsed[0]:.2f}s behind the first; "
        "the claim must use FOR UPDATE SKIP LOCKED"
    )
    assert len(second) == 5, "the second claimer must skip the locked rows and claim the rest"


def test_a_claimer_never_claims_another_tenants_outbox_row(substrate):
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_B) as connection:
        foreign = {_enqueue(connection, names, TENANT_B, f"b-event-{index}") for index in range(5)}
    with tenant_transaction(url, TENANT_A) as connection:
        own = {_enqueue(connection, names, TENANT_A, f"a-event-{index}") for index in range(5)}

    with tenant_transaction(url, TENANT_A) as connection:
        claimed = {row[names.id_column] for row in claim_batch(connection, 50)}

    assert claimed & foreign == set(), "a claimer crossed the tenant boundary"
    assert claimed == own, "a claimer must be handed its own tenant's rows"


def test_every_enqueued_row_is_eventually_claimed_under_at_least_once_semantics(substrate):
    """Completeness, not uniqueness: nothing may be stranded, and redelivery stays permitted."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    enqueued = set()
    with tenant_transaction(url, TENANT_A) as connection:
        for index in range(25):
            enqueued.add(_enqueue(connection, names, TENANT_A, f"drain-{index}"))

    seen: set = set()
    for _ in range(10):
        with tenant_transaction(url, TENANT_A) as connection:
            batch = [row[names.id_column] for row in claim_batch(connection, 7)]
        if not batch:
            break
        seen.update(batch)

    # The obligation is coverage. A row appearing in more than one batch would be a legitimate
    # at-least-once redelivery, so it is deliberately not asserted against.
    assert seen == enqueued, "an enqueued row was never handed to any claimer"

    with tenant_transaction(url, TENANT_A) as connection:
        unclaimed = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.outbox_table}" '
                f'WHERE "{names.claimed_column}" IS NULL'
            )
        ).scalar_one()
    assert unclaimed == 0, "a row was left permanently unclaimed"


def test_an_expired_claim_is_reclaimable_with_the_same_id_and_a_higher_attempt_count(substrate):
    """The at-least-once path, exercised rather than asserted.

    A consumer that claims a row and then dies never publishes it. If the lease it held is the end
    of that row's life, the outbox is at-most-once with extra steps — the row is stranded, claimed
    forever, delivered never. Redelivery after expiry is what makes the guarantee real, and it has
    to bring the same identifier so a consumer that *did* partially succeed can recognise it.
    """
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        enqueued = _enqueue(connection, names, TENANT_A, "lease-expires")

    # A lease that has already elapsed by the time the next transaction opens. No sleeping: the
    # expiry is a fact about the row, not about how long the test waited.
    with tenant_transaction(url, TENANT_A) as connection:
        first = claim_batch(connection, 5, lease_seconds=0)
    assert [row[names.id_column] for row in first] == [enqueued]
    assert first[0]["attempts"] == 1, "the first claim must count as one attempt"

    # The consumer died here: claimed, never published, lease now expired.
    with tenant_transaction(url, TENANT_A) as connection:
        second = claim_batch(connection, 5)
    assert [row[names.id_column] for row in second] == [enqueued], (
        "a row whose claim lease expired without being published must be claimable again, "
        "or the outbox strands it forever and the at-least-once guarantee is empty"
    )
    assert second[0][names.id_column] == enqueued, "the identifier must survive reclaiming"
    assert second[0]["attempts"] == 2, "reclaiming must increment the attempt count"
    assert second[0]["claim_token"] != first[0]["claim_token"], "a new lease must carry a new token"

    # A published row is never handed out again, expired lease or not.
    with tenant_transaction(url, TENANT_A) as connection:
        connection.execute(
            sqlalchemy.text(
                f'UPDATE "{names.outbox_table}" SET published_at = now() '
                f'WHERE "{names.id_column}" = :id'
            ),
            {"id": enqueued},
        )
    with tenant_transaction(url, TENANT_A) as connection:
        assert claim_batch(connection, 5, lease_seconds=0) == [], (
            "a published row must not be reclaimed once its work is done"
        )


def test_an_expired_claim_is_never_reclaimed_across_the_tenant_boundary(substrate):
    """Expiry must not become a hole in tenant isolation."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_B) as connection:
        foreign = _enqueue(connection, names, TENANT_B, "b-expiring")
    with tenant_transaction(url, TENANT_B) as connection:
        claim_batch(connection, 5, lease_seconds=0)

    with tenant_transaction(url, TENANT_A) as connection:
        own = _enqueue(connection, names, TENANT_A, "a-fresh")
    with tenant_transaction(url, TENANT_A) as connection:
        claimed = {row[names.id_column] for row in claim_batch(connection, 50)}

    assert foreign not in claimed, "an expired claim was reclaimed across the tenant boundary"
    assert claimed == {own}


def test_a_claimed_row_keeps_a_stable_identifier_for_downstream_deduplication(substrate):
    """At-least-once is only usable if the consumer can recognise a repeat."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        enqueued = [_enqueue(connection, names, TENANT_A, f"stable-{index}") for index in range(5)]

    with tenant_transaction(url, TENANT_A) as connection:
        claimed = claim_batch(connection, 5)

    identifiers = [row[names.id_column] for row in claimed]
    assert sorted(identifiers) == sorted(enqueued), "the claim changed the rows' identifiers"
    assert len(set(identifiers)) == len(identifiers), "identifiers must be unique per row"

    # The identifier a consumer would deduplicate on is the one still stored on the row.
    with tenant_transaction(url, TENANT_A) as connection:
        persisted = (
            connection.execute(
                sqlalchemy.text(
                    f'SELECT "{names.id_column}" FROM "{names.outbox_table}" '
                    f'WHERE "{names.id_column}" = ANY(:ids)'
                ),
                {"ids": identifiers},
            )
            .scalars()
            .all()
        )
    assert sorted(persisted) == sorted(identifiers), (
        "a claimed row's identifier must survive claiming so redelivery is recognisable"
    )
