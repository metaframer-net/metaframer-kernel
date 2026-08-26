"""P20A: pure, ambient-clock-free performance baseline summarizer for the observed relay pass.

No SLA, threshold, scheduler, retry, DLQ, exporter, dashboard, live host, optimizer, load
generator or dollar cost claim is made here. Only measured, deterministic summarization.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


def _validate_count(value, name):
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an exact int, non-bool value")
    if value < 0:
        raise ValueError(f"{name} must be nonnegative")


@dataclass(frozen=True)
class RelayPerformanceSample:
    tenant_id: str
    duration_seconds: float
    published_count: int
    failed_count: int

    def __post_init__(self):
        if not isinstance(self.tenant_id, str) or not self.tenant_id:
            raise ValueError("tenant_id must be a nonempty string")
        duration = self.duration_seconds
        if isinstance(duration, bool) or not isinstance(duration, (int, float)):
            raise TypeError("duration_seconds must be a numeric, non-bool value")
        if not math.isfinite(duration) or duration < 0:
            raise ValueError("duration_seconds must be finite and nonnegative")
        _validate_count(self.published_count, "published_count")
        _validate_count(self.failed_count, "failed_count")


@dataclass(frozen=True)
class TenantP95Row:
    tenant_id: str
    p95_duration_seconds: float


@dataclass(frozen=True)
class RelayPerformanceBaseline:
    p95_duration_seconds: float
    p99_duration_seconds: float
    published_total: int
    failed_total: int
    wall_clock_seconds: float
    seconds_per_published: float
    per_tenant_p95: tuple
    fairness_ratio: float


def _nearest_rank(sorted_values, quantile):
    n = len(sorted_values)
    rank = max(1, min(n, math.ceil(quantile * n)))
    return sorted_values[rank - 1]


def summarize_relay_performance(samples):
    if not isinstance(samples, (tuple, list)) or len(samples) == 0:
        raise ValueError("samples must be a nonempty sequence of RelayPerformanceSample")
    for sample in samples:
        if type(sample) is not RelayPerformanceSample:
            raise TypeError("samples must contain exact RelayPerformanceSample values")

    durations = sorted(sample.duration_seconds for sample in samples)
    p95 = _nearest_rank(durations, 0.95)
    p99 = _nearest_rank(durations, 0.99)

    published_total = sum(sample.published_count for sample in samples)
    failed_total = sum(sample.failed_count for sample in samples)
    wall_clock_seconds = sum(sample.duration_seconds for sample in samples)
    seconds_per_published = wall_clock_seconds / published_total if published_total > 0 else 0.0

    by_tenant = {}
    for sample in samples:
        by_tenant.setdefault(sample.tenant_id, []).append(sample.duration_seconds)

    per_tenant_p95 = tuple(
        TenantP95Row(
            tenant_id=tenant_id,
            p95_duration_seconds=_nearest_rank(sorted(durations_for_tenant), 0.95),
        )
        for tenant_id, durations_for_tenant in sorted(by_tenant.items())
    )

    tenant_p95_values = [row.p95_duration_seconds for row in per_tenant_p95]
    max_tenant_p95 = max(tenant_p95_values)
    fairness_ratio = 1.0 if max_tenant_p95 == 0.0 else min(tenant_p95_values) / max_tenant_p95

    return RelayPerformanceBaseline(
        p95_duration_seconds=p95,
        p99_duration_seconds=p99,
        published_total=published_total,
        failed_total=failed_total,
        wall_clock_seconds=wall_clock_seconds,
        seconds_per_published=seconds_per_published,
        per_tenant_p95=per_tenant_p95,
        fairness_ratio=fairness_ratio,
    )
