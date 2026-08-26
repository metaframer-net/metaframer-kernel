"""P18: a relay call that drains one batch to completion, not just claims it.

``claim_batch``/``release_claim``/``publish_claim`` are the substrate's claiming primitives; they
say nothing about *driving* a batch through delivery. A relay closes that gap: given a delivery
callback, it claims a batch, calls the callback per row, publishes every row whose delivery
succeeded, releases every row whose delivery failed (so it goes back into circulation for retry),
and returns an immutable summary of what happened. No consumer, retry policy or dead-letter queue
exists yet — this is the one relay call, run once, that those would be built on.

At the time these tests were written ``metaframer_kernel_db.outbox_relay`` does not exist at all.
Each test proves the database was reached and healthy first, then fails for exactly one reason:
that module cannot be imported. That is the RED this file freezes.

Three tests, three lifecycle shapes:

1. A clean drain: every row delivers successfully, the batch empties, and a second call against
   the now-empty queue returns nothing rather than erroring or reclaiming what was just published.
2. A partial failure: one row's delivery raises, the rest succeed. The successes must be published
   and the failure must be released — not left claimed — so the very same row id is claimable and
   deliverable again on a subsequent call, which is what makes the failure recoverable rather than
   a stuck row.
3. A zero-lease race: a stale claimant's token is still in hand when the relay reclaims the same
   row after its lease has already expired and successfully delivers and publishes it. The stale
   token arriving after that must be fenced — it affects zero rows — because the relay's own
   publish is a fenced claim-token mutation, the same guarantee the substrate already gives
   ``publish_claim``.
"""

from __future__ import annotations

import pytest
import sqlalchemy

from _harness._errors import MissingSubstrateCapability
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.outbox]

TENANT_A = "11111111-1111-1111-1111-111111111111"


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


def _run_outbox_relay_once(substrate):
    """The P18 capability under test, resolved by real import — never assumed present.

    Not a declared substrate contract capability: P18 has not shipped, so there is nothing for
    ``require_capability`` to resolve against yet. The failure mode this produces is exactly the
    one this suite exists to freeze: the database was reached and is healthy, and the *only*
    reason the test cannot proceed is that ``metaframer_kernel_db.outbox_relay`` does not exist.
    """
    try:
        import metaframer_kernel_db.outbox_relay as outbox_relay_module
    except ModuleNotFoundError as exc:
        raise MissingSubstrateCapability(
            "P18 capability 'outbox_relay.run_outbox_relay_once' is not implemented.\n"
            "  target      : metaframer_kernel_db.outbox_relay:run_outbox_relay_once\n"
            f"  resolution  : no module named {exc.name!r}\n"
            f"  database    : REACHED AND HEALTHY — {substrate.health_evidence()}\n"
            "  meaning     : this is a missing P18 outbox-relay capability, not a broken Docker "
            "daemon, dependency install, Python/uv toolchain or test harness."
        ) from exc

    if not hasattr(outbox_relay_module, "run_outbox_relay_once"):
        raise MissingSubstrateCapability(
            "P18 capability 'outbox_relay.run_outbox_relay_once' is not implemented.\n"
            "  target      : metaframer_kernel_db.outbox_relay:run_outbox_relay_once\n"
            "  resolution  : module 'metaframer_kernel_db.outbox_relay' imported but defines no "
            "attribute 'run_outbox_relay_once'\n"
            f"  database    : REACHED AND HEALTHY — {substrate.health_evidence()}\n"
            "  meaning     : this is a missing P18 outbox-relay capability, not a broken Docker "
            "daemon, dependency install, Python/uv toolchain or test harness."
        )
    return outbox_relay_module.run_outbox_relay_once


# =====================================================================================
# RED: P18 has no implementation yet. Each test fails only on the missing attribute above,
# always after prove_database_reached() has already succeeded against a real PostgreSQL 16.
# =====================================================================================


def test_a_clean_drain_publishes_every_row_and_a_second_call_finds_nothing_left(substrate):
    """Every delivery succeeds; the batch drains; the next call against the same tenant is empty."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        enqueued = {_enqueue(connection, names, TENANT_A, f"clean-{index}") for index in range(5)}

    delivered: list = []

    def deliver(row):
        delivered.append(row[names.id_column])
        return True

    run_outbox_relay_once = _run_outbox_relay_once(substrate)

    first = run_outbox_relay_once(url, TENANT_A, deliver, limit=10, lease_seconds=300)

    assert set(delivered) == enqueued, "every enqueued row must have been offered to delivery"
    assert set(first.published) == enqueued, "every successfully delivered row must be published"
    assert first.failed == (), "no delivery failed, so nothing should be reported as failed"

    with pytest.raises(AttributeError):
        first.published.append(None)  # the result must be immutable, not a plain mutable list

    with tenant_transaction(url, TENANT_A) as connection:
        unpublished = connection.execute(
            sqlalchemy.text(
                f'SELECT count(*) FROM "{names.outbox_table}" WHERE "published_at" IS NULL'
            )
        ).scalar_one()
    assert unpublished == 0, "the clean drain must leave nothing unpublished"

    delivered_again: list = []

    def deliver_again(row):
        delivered_again.append(row[names.id_column])
        return True

    second = run_outbox_relay_once(url, TENANT_A, deliver_again, limit=10, lease_seconds=300)

    assert delivered_again == [], "an already-published row must never be offered to delivery again"
    assert second.published == (), "a second call against an empty queue must publish nothing"
    assert second.failed == (), "a second call against an empty queue must fail nothing"


def test_a_failed_delivery_is_released_not_published_and_the_same_id_is_retryable(substrate):
    """Partial failure: successes publish, the failure releases, and the row id survives retry."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        good = {_enqueue(connection, names, TENANT_A, f"good-{index}") for index in range(3)}
        bad = _enqueue(connection, names, TENANT_A, "poison")

    def deliver_first_attempt(row):
        if row[names.id_column] == bad:
            raise RuntimeError("delivery blew up for the poisoned row")
        return True

    run_outbox_relay_once = _run_outbox_relay_once(substrate)

    first = run_outbox_relay_once(url, TENANT_A, deliver_first_attempt, limit=10, lease_seconds=300)

    assert set(first.published) == good, "every successful delivery must be published"
    assert first.failed == (bad,), "the raising delivery must be reported as failed, and only it"

    state = _row_state(tenant_transaction, url, names, TENANT_A, bad)
    assert state["published_at"] is None, "a failed delivery must not be published"
    assert state["claim_token"] is None, "a released row must carry no claim token"
    assert state["claimed_at"] is None, "a released row must not still be claimed"
    assert state["attempts"] == 1, "the failed attempt still counts as one attempt"

    # The same id is claimable and deliverable again — a released row, not a stuck one.
    def deliver_retry(row):
        return True

    second = run_outbox_relay_once(url, TENANT_A, deliver_retry, limit=10, lease_seconds=300)

    assert second.published == (bad,), "the retried row must publish under the same id"
    assert second.failed == ()

    state_after_retry = _row_state(tenant_transaction, url, names, TENANT_A, bad)
    assert state_after_retry["published_at"] is not None
    assert state_after_retry["attempts"] == 2, "the retry must count as a second attempt"


def test_a_stale_claimants_late_token_is_fenced_after_the_relay_reclaims_and_publishes(substrate):
    """Zero-lease race: the relay reclaims an already-expired claim, and the old token is fenced."""
    prove_database_reached(substrate)

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    claim_batch = require_capability("outbox.claim_batch", substrate=substrate)
    release_claim = require_capability("outbox.release_claim", substrate=substrate)
    publish_claim = require_capability("outbox.publish_claim", substrate=substrate)
    names = schema_names(substrate)

    _migrate(substrate, alembic_config)
    url = substrate.sqlalchemy_url(substrate.runtime)

    with tenant_transaction(url, TENANT_A) as connection:
        identifier = _enqueue(connection, names, TENANT_A, "raced-row")

    # A first claimant takes the row with a lease that expires immediately, and never comes back
    # to finish the job — it just keeps its now-stale token in hand.
    with tenant_transaction(url, TENANT_A) as connection:
        stale = claim_batch(connection, 1, lease_seconds=0)
    assert [row[names.id_column] for row in stale] == [identifier]
    stale_token = stale[0]["claim_token"]

    def deliver(row):
        assert row[names.id_column] == identifier
        return True

    run_outbox_relay_once = _run_outbox_relay_once(substrate)

    result = run_outbox_relay_once(url, TENANT_A, deliver, limit=10, lease_seconds=300)

    assert result.published == (identifier,), (
        "the relay must reclaim the expired row under a fresh token, deliver it and publish it"
    )

    published_state = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert published_state["published_at"] is not None
    assert published_state["claim_token"] != stale_token, (
        "the relay's own claim must have issued a token different from the stale one"
    )
    assert published_state["attempts"] == 2, "the reclaim must count as the row's second attempt"

    # The stale claimant now wakes up and tries to act on the token it has been holding since
    # before the reclaim. Both mutations must affect zero rows: the row is no longer its claim.
    with tenant_transaction(url, TENANT_A) as connection:
        late_release = release_claim(connection, [identifier], claim_token=stale_token)
    with tenant_transaction(url, TENANT_A) as connection:
        late_publish = publish_claim(connection, [identifier], claim_token=stale_token)

    assert late_release == [], "the stale claimant's late release must be fenced to zero rows"
    assert late_publish == [], "the stale claimant's late publish must be fenced to zero rows"

    final_state = _row_state(tenant_transaction, url, names, TENANT_A, identifier)
    assert final_state["published_at"] == published_state["published_at"], (
        "the relay's publish must survive the stale claimant's late, fenced arrival untouched"
    )
    assert final_state["claim_token"] == published_state["claim_token"]
