"""P20A: an honest, ambient-clock-free performance baseline for the P19 observed relay pass.

``metaframer_kernel_db.performance`` summarizes ``RelayPerformanceSample`` readings into a
frozen ``RelayPerformanceBaseline``: deterministic nearest-rank p95/p99, published/failed
totals, finite nonnegative wall_clock_seconds/seconds_per_published, sorted per_tenant_p95,
and a measured fairness_ratio only — no SLA, scheduler, retry, DLQ, dashboard or cost claim.

At write time the module does not exist. Tests 2 and 3 prove the database was reached first,
then fail for exactly one reason: the module or its API is missing.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy

from _harness._errors import MissingSubstrateCapability
from _harness.capability import require_capability, schema_names
from _harness.probe import prove_database_reached

pytestmark = [pytest.mark.substrate, pytest.mark.outbox]
TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"


def _performance():
    """The P20A capability under test, resolved by real import — never assumed present."""
    try:
        import metaframer_kernel_db.performance as module
    except ModuleNotFoundError as exc:
        raise MissingSubstrateCapability(
            f"P20A capability 'performance' is not implemented: no module named {exc.name!r}"
        ) from exc
    for attribute in (
        "RelayPerformanceSample",
        "RelayPerformanceBaseline",
        "summarize_relay_performance",
    ):
        if not hasattr(module, attribute):
            raise MissingSubstrateCapability(
                f"P20A capability 'performance.{attribute}' is not implemented: module imported "
                "but defines no such attribute"
            )
    return module


def _setup(substrate):
    """Migrate, resolve capabilities, and return (url, tenant_transaction, names)."""
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


def _observe(
    observability, performance, url, tenant, slo, correlation_id, limit=10, allowed_ids=None
):
    """One timed observed-relay pass. ``allowed_ids``, when given, bounds every id this call
    actually publishes — a tenant-scoped pass must never publish another tenant's row."""
    started = time.perf_counter()
    result = observability.run_observed_outbox_relay_once(
        url,
        tenant,
        lambda row: True,
        limit=limit,
        lease_seconds=300,
        slo=slo,
        sink=lambda line: None,
        clock=time.perf_counter,
        timestamp="2026-08-26T00:00:00Z",
        service="metaframer-kernel-db",
        env="test",
        correlation_id=correlation_id,
    )
    wall = time.perf_counter() - started
    published_ids = set(result.relay.published)
    if allowed_ids is not None:
        assert published_ids <= allowed_ids, (
            f"tenant {tenant} published outside its set: {published_ids - allowed_ids}"
        )
    return performance.RelayPerformanceSample(
        tenant_id=tenant,
        duration_seconds=wall,
        published_count=len(result.relay.published),
        failed_count=len(result.relay.failed),
    )


def test_pure_percentile_and_validation_contract():
    """Hostile pure summary: nearest-rank p95/p99, validation, stable ordering, no mutation."""
    performance = _performance()
    Sample = performance.RelayPerformanceSample

    samples = tuple(
        Sample(tenant_id=TENANT_A, duration_seconds=float(i), published_count=1, failed_count=0)
        for i in range(1, 21)
    )
    frozen_copy = tuple(samples)
    baseline = performance.summarize_relay_performance(samples)

    assert samples == frozen_copy, "input sequence must never be mutated"
    assert baseline.p95_duration_seconds == pytest.approx(19.0)
    assert baseline.p99_duration_seconds == pytest.approx(20.0)
    assert baseline.published_total == 20
    assert baseline.failed_total == 0
    assert 0.0 <= baseline.wall_clock_seconds == baseline.wall_clock_seconds  # finite, not NaN
    assert baseline.seconds_per_published >= 0.0

    bad_kwargs = [
        dict(tenant_id="", duration_seconds=1.0, published_count=1, failed_count=0),
        dict(tenant_id=TENANT_A, duration_seconds=-1.0, published_count=1, failed_count=0),
        dict(tenant_id=TENANT_A, duration_seconds=float("inf"), published_count=1, failed_count=0),
        dict(tenant_id=TENANT_A, duration_seconds=1.0, published_count=-1, failed_count=0),
        dict(tenant_id=TENANT_A, duration_seconds=1.0, published_count=1, failed_count=-1),
    ]
    for kwargs in bad_kwargs:
        with pytest.raises((TypeError, ValueError, AttributeError)):
            Sample(**kwargs)

    with pytest.raises((TypeError, ValueError)):
        performance.summarize_relay_performance(())

    mixed = (
        Sample(tenant_id=TENANT_B, duration_seconds=2.0, published_count=1, failed_count=0),
        Sample(tenant_id=TENANT_A, duration_seconds=1.0, published_count=1, failed_count=0),
    )
    tenant_ids = [
        row.tenant_id for row in performance.summarize_relay_performance(mixed).per_tenant_p95
    ]
    assert tenant_ids == sorted(tenant_ids), "per-tenant rows must be stably sorted by tenant_id"

    with pytest.raises(AttributeError):
        baseline.per_tenant_p95.append(None)  # frozen result


def test_clean_and_empty_observed_passes_yield_honest_measured_aggregates(substrate):
    prove_database_reached(substrate)
    url, tenant_transaction, names = _setup(substrate)
    import metaframer_kernel_db.observability as observability

    with tenant_transaction(url, TENANT_A) as connection:
        for i in range(5):
            _enqueue(connection, names, TENANT_A, f"clean-{i}")

    performance = _performance()
    slo = observability.RelaySlo(max_duration_seconds=3600.0, max_failure_rate=1.0)

    samples = [
        _observe(observability, performance, url, TENANT_A, slo, f"corr-perf-clean-{i}")
        for i in range(3)
    ]
    assert [sample.published_count for sample in samples] == [5, 0, 0], (
        "the clean pass drains all five rows, then the next two passes see an empty outbox"
    )
    baseline = performance.summarize_relay_performance(tuple(samples))

    assert baseline.published_total == 5
    assert baseline.failed_total == 0
    assert 0.0 < baseline.wall_clock_seconds < 3600.0
    assert baseline.seconds_per_published >= 0.0
    assert baseline.p99_duration_seconds >= baseline.p95_duration_seconds >= 0.0


def test_interleaved_two_tenant_work_proves_isolation_and_reports_fairness(substrate):
    prove_database_reached(substrate)
    url, tenant_transaction, names = _setup(substrate)
    import metaframer_kernel_db.observability as observability

    with tenant_transaction(url, TENANT_A) as connection:
        a_ids = {_enqueue(connection, names, TENANT_A, f"a-{i}") for i in range(6)}
    with tenant_transaction(url, TENANT_B) as connection:
        b_ids = {_enqueue(connection, names, TENANT_B, f"b-{i}") for i in range(6)}

    performance = _performance()
    slo = observability.RelaySlo(max_duration_seconds=3600.0, max_failure_rate=1.0)

    def observe(tenant, correlation_id, allowed_ids):
        return _observe(
            observability,
            performance,
            url,
            tenant,
            slo,
            correlation_id,
            limit=3,
            allowed_ids=allowed_ids,
        )

    samples = []
    for i in range(2):
        samples.append(observe(TENANT_A, f"corr-fair-a-{i}", a_ids))
        samples.append(observe(TENANT_B, f"corr-fair-b-{i}", b_ids))
    assert [sample.published_count for sample in samples] == [3, 3, 3, 3], (
        "each interleaved pass publishes its own tenant's 3-row limit — neither tenant starves"
    )
    baseline = performance.summarize_relay_performance(tuple(samples))

    assert baseline.published_total == 12
    assert baseline.failed_total == 0

    per_tenant = {row.tenant_id: row for row in baseline.per_tenant_p95}
    assert set(per_tenant) == {TENANT_A, TENANT_B}, "neither tenant starved the other"
    assert all(row.p95_duration_seconds >= 0.0 for row in per_tenant.values())

    assert 0.0 <= baseline.fairness_ratio == baseline.fairness_ratio  # measured only, finite
