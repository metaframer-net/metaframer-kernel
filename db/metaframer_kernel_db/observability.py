"""P19A: observe one P18 outbox relay pass against an SLO, without leaking row data.

Wraps ``run_outbox_relay_once`` to measure duration and failure rate, evaluate them against a
``RelaySlo``, and emit exactly one compact single-line JSON batch-summary event through an
injected sink. No per-row logging, exporter, metrics backend, dashboard or alert transport is
built here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from .outbox_relay import OutboxRelayResult, run_outbox_relay_once


@dataclass(frozen=True)
class RelaySlo:
    """The ceilings one relay pass is judged against."""

    max_duration_seconds: float
    max_failure_rate: float


@dataclass(frozen=True)
class RelaySloVerdict:
    """The measured outcome of one relay pass against its ``RelaySlo``."""

    duration_seconds: float
    failure_rate: float
    latency_met: bool
    failure_rate_met: bool
    within_slo: bool


@dataclass(frozen=True)
class ObservedOutboxRelayResult:
    """The untouched P18 result paired with its SLO verdict."""

    relay: OutboxRelayResult
    slo: RelaySloVerdict


def run_observed_outbox_relay_once(
    sqlalchemy_url: str,
    tenant_id: Any,
    deliver: Callable[[dict[str, Any]], bool],
    *,
    limit: int,
    lease_seconds: int,
    slo: RelaySlo,
    sink: Callable[[str], None],
    clock: Callable[[], float],
    timestamp: str,
    service: str,
    env: str,
    correlation_id: str,
) -> ObservedOutboxRelayResult:
    """Run one P18 relay pass, measure it against ``slo``, and emit one JSON summary line."""
    started = clock()
    relay = run_outbox_relay_once(
        sqlalchemy_url, tenant_id, deliver, limit=limit, lease_seconds=lease_seconds
    )
    duration_seconds = clock() - started

    published_count = len(relay.published)
    failed_count = len(relay.failed)
    total = published_count + failed_count
    failure_rate = (failed_count / total) if total else 0.0

    latency_met = duration_seconds <= slo.max_duration_seconds
    failure_rate_met = failure_rate <= slo.max_failure_rate
    within_slo = latency_met and failure_rate_met

    verdict = RelaySloVerdict(
        duration_seconds=duration_seconds,
        failure_rate=failure_rate,
        latency_met=latency_met,
        failure_rate_met=failure_rate_met,
        within_slo=within_slo,
    )

    event = {
        "event": "outbox_relay.batch_completed",
        "service": service,
        "env": env,
        "timestamp": timestamp,
        "tenant_id": str(tenant_id),
        "correlation_id": correlation_id,
        "published_count": published_count,
        "failed_count": failed_count,
        "duration_seconds": duration_seconds,
        "failure_rate": failure_rate,
        "latency_met": latency_met,
        "failure_rate_met": failure_rate_met,
        "within_slo": within_slo,
    }
    line = json.dumps(event, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    sink(line)

    return ObservedOutboxRelayResult(relay=relay, slo=verdict)
