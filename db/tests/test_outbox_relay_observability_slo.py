"""P19A: an observed relay pass that reports its SLO, without leaking anything into the log.

``metaframer_kernel_db.observability`` wraps one P18 ``run_outbox_relay_once`` pass: it measures
the pass against a ``RelaySlo(max_duration_seconds, max_failure_rate)`` using an injected clock,
emits exactly one line of structured JSON through an injected sink, and returns both the untouched
P18 result (``.relay``) and the SLO verdict (``.slo``: duration_seconds, failure_rate,
latency_met, failure_rate_met, within_slo).

The emitted line is one batch-summary event (``outbox_relay.batch_completed``) carrying service,
env, timestamp, tenant_id and correlation_id verbatim. Per-row logging, exporters, a metrics
backend, dashboards and alert transport are non-goals of this P19A slice.

At the time these tests were written the module does not exist. Each test proves the database was
reached and healthy first, then fails for exactly one reason: the module or its API is missing.
"""

from __future__ import annotations

import json
from collections import namedtuple

import pytest
import sqlalchemy

from _harness._errors import MissingSubstrateCapability
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.outbox]

TENANT_A = "11111111-1111-1111-1111-111111111111"

# Must never appear in the emitted JSON line: tenant payload, actor/claim internals, exceptions.
_PAYLOAD_MARKERS = ("poison", "clean-", "good-", "slow-", "claim_token")
_LEAK_MARKERS = ("delivery blew up", "RuntimeError", "Traceback")
FORBIDDEN = _PAYLOAD_MARKERS + _LEAK_MARKERS

_Moment = namedtuple("_Moment", "readings timestamp correlation_id")


def _setup(substrate):
    """Migrate, resolve capabilities/schema names, and return (url, tenant_transaction, names)."""
    from alembic import command

    alembic_config = require_capability("migration.alembic_config", substrate=substrate)
    tenant_transaction = require_capability("runtime.tenant_transaction", substrate=substrate)
    names = schema_names(substrate)
    command.upgrade(alembic_config(substrate.sqlalchemy_url(substrate.migration)), "head")
    return substrate.sqlalchemy_url(substrate.runtime), tenant_transaction, names


def _enqueue(connection, names, tenant, payload):
    return connection.execute(
        sqlalchemy.text(
            f'INSERT INTO "{names.outbox_table}" ("{names.tenant_column}", "{names.payload_column}") '
            f'VALUES (:tenant, :payload) RETURNING "{names.id_column}"'
        ),
        {"tenant": tenant, "payload": payload},
    ).scalar_one()


def _observability(substrate):
    """The P19A capability under test, resolved by real import — never assumed present."""
    try:
        import metaframer_kernel_db.observability as module
    except ModuleNotFoundError as exc:
        raise MissingSubstrateCapability(
            "P19A capability 'observability' is not implemented.\n"
            "  target      : metaframer_kernel_db.observability\n"
            f"  resolution  : no module named {exc.name!r}\n"
            f"  database    : REACHED AND HEALTHY — {substrate.health_evidence()}\n"
            "  meaning     : missing P19A observability capability, not a broken Docker daemon, "
            "dependency install, Python/uv toolchain or test harness."
        ) from exc
    for attribute in ("RelaySlo", "run_observed_outbox_relay_once"):
        if not hasattr(module, attribute):
            raise MissingSubstrateCapability(
                f"P19A capability 'observability.{attribute}' is not implemented.\n"
                f"  target      : metaframer_kernel_db.observability:{attribute}\n"
                "  resolution  : module imported but defines no such attribute\n"
                f"  database    : REACHED AND HEALTHY — {substrate.health_evidence()}\n"
                "  meaning     : missing P19A observability capability, not a broken Docker daemon, "
                "dependency install, Python/uv toolchain or test harness."
            )
    return module


class _FakeClock:
    """Hands out pre-scripted monotonic readings, in order."""

    def __init__(self, readings):
        self._readings = list(readings)

    def __call__(self):
        return self._readings.pop(0)


class _RecordingSink:
    def __init__(self):
        self.lines: list[str] = []

    def __call__(self, line):
        self.lines.append(line)


def _verdict(x):
    return (x.latency_met, x.failure_rate_met, x.within_slo)


def _run(observability, url, tenant, deliver, slo, moment):
    sink = _RecordingSink()
    result = observability.run_observed_outbox_relay_once(
        url,
        tenant,
        deliver,
        limit=10,
        lease_seconds=300,
        slo=slo,
        sink=sink,
        clock=_FakeClock(moment.readings),
        timestamp=moment.timestamp,
        service="metaframer-kernel-db",
        env="test",
        correlation_id=moment.correlation_id,
    )
    assert len(sink.lines) == 1, "exactly one structured JSON line must be emitted per pass"
    line = sink.lines[0]
    assert "\n" not in line, "the emitted line must be single-line JSON"
    for forbidden in FORBIDDEN:
        assert forbidden not in line, f"emitted log line must never contain {forbidden!r}"
    assert '"event":"outbox_relay.batch_completed"' in line, "event field not escaped"
    assert json.dumps(moment.correlation_id) in line, "correlation_id field not escaped"
    payload = json.loads(line)
    assert payload["event"] == "outbox_relay.batch_completed"
    assert payload["service"] == "metaframer-kernel-db"
    assert payload["env"] == "test"
    assert payload["timestamp"] == moment.timestamp
    assert payload["tenant_id"] == tenant
    assert payload["correlation_id"] == moment.correlation_id
    return result, payload


def test_a_clean_drain_and_a_second_empty_pass_are_both_slo_green(substrate):
    prove_database_reached(substrate)
    url, tenant_transaction, names = _setup(substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        enqueued = {_enqueue(connection, names, TENANT_A, f"clean-{i}") for i in range(5)}

    delivered: list = []

    def deliver(row):
        delivered.append(row[names.id_column])
        return True

    observability = _observability(substrate)
    slo = observability.RelaySlo(max_duration_seconds=5.0, max_failure_rate=0.0)

    moment = _Moment([100.0, 100.25], "2026-08-26T00:00:00Z", "corr-001")
    first, payload = _run(observability, url, TENANT_A, deliver, slo, moment)

    assert set(delivered) == enqueued
    assert set(first.relay.published) == enqueued
    assert first.relay.failed == ()
    with pytest.raises(AttributeError):
        first.relay.published.append(None)  # the wrapped P18 result must still be immutable

    assert first.slo.duration_seconds == pytest.approx(0.25)
    assert first.slo.failure_rate == pytest.approx(0.0)
    assert _verdict(first.slo) == (True, True, True)
    assert payload["published_count"] == len(enqueued)
    assert payload["failed_count"] == 0
    assert payload["within_slo"] is True

    delivered_again: list = []

    def deliver_again(row):
        delivered_again.append(row[names.id_column])
        return True

    moment = _Moment([200.0, 200.1], "2026-08-26T00:05:00Z", "corr-002")
    second, second_payload = _run(observability, url, TENANT_A, deliver_again, slo, moment)

    assert delivered_again == [], "an already-published row must never be re-delivered"
    assert (second.relay.published, second.relay.failed) == ((), ())
    assert _verdict(second.slo) == (True, True, True)
    assert (second_payload["published_count"], second_payload["failed_count"]) == (0, 0)


def test_a_partial_failure_preserves_p18_outcomes_and_goes_failure_rate_red_without_leaking(
    substrate,
):
    prove_database_reached(substrate)
    url, tenant_transaction, names = _setup(substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        good = {_enqueue(connection, names, TENANT_A, f"good-{i}") for i in range(3)}
        bad = _enqueue(connection, names, TENANT_A, "poison")

    def deliver(row):
        if row[names.id_column] == bad:
            raise RuntimeError("delivery blew up for the poisoned row")
        return True

    observability = _observability(substrate)
    slo = observability.RelaySlo(max_duration_seconds=5.0, max_failure_rate=0.1)

    moment = _Moment([500.0, 500.1], "2026-08-26T00:10:00Z", "corr-003")
    result, payload = _run(observability, url, TENANT_A, deliver, slo, moment)

    assert set(result.relay.published) == good
    assert result.relay.failed == (bad,)
    assert result.slo.failure_rate == pytest.approx(0.25)
    assert _verdict(result.slo) == (True, False, False)
    assert (payload["published_count"], payload["failed_count"]) == (len(good), 1)
    assert payload["failure_rate"] == pytest.approx(0.25)
    assert payload["within_slo"] is False
    assert str(bad) not in json.dumps(payload), "row identifiers must never be logged"


def test_a_deterministically_slow_but_fully_successful_drain_is_only_latency_red(substrate):
    prove_database_reached(substrate)
    url, tenant_transaction, names = _setup(substrate)

    with tenant_transaction(url, TENANT_A) as connection:
        enqueued = {_enqueue(connection, names, TENANT_A, f"slow-{i}") for i in range(2)}

    observability = _observability(substrate)
    slo = observability.RelaySlo(max_duration_seconds=1.0, max_failure_rate=0.0)

    # a scripted 10-second pass, well past the 1s ceiling
    moment = _Moment([1000.0, 1010.0], "2026-08-26T00:20:00Z", "corr-004")
    result, payload = _run(observability, url, TENANT_A, lambda row: True, slo, moment)

    assert set(result.relay.published) == enqueued
    assert result.relay.failed == ()
    assert result.slo.duration_seconds == pytest.approx(10.0)
    assert _verdict(result.slo) == (False, True, False)
    assert payload["duration_seconds"] == pytest.approx(10.0)
    assert payload["within_slo"] is False
