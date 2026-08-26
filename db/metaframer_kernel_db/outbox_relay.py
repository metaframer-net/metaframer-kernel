"""P18: drain one outbox batch to completion, not just claim it.

``claim_batch``/``release_claim``/``publish_claim`` are the substrate's claiming primitives; they
say nothing about *driving* a batch through delivery. ``run_outbox_relay_once`` closes that gap:
it claims a batch in its own transaction, calls a delivery callback per row, and then — in a
second, fresh transaction per outcome — publishes every row whose delivery succeeded and releases
every row whose delivery failed. Both of those mutations are the same fenced claim-token
mutations ``publish_claim``/``release_claim`` already provide, so a stale claimant's late arrival
is fenced to zero rows exactly as it already is for a lone caller of those primitives.

No consumer loop, retry policy or dead-letter queue exists here — this is the one relay call, run
once, that those would be built on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .outbox import claim_batch, publish_claim, release_claim
from .session import tenant_transaction


@dataclass(frozen=True)
class OutboxRelayResult:
    """An immutable summary of one relay pass: which ids published, which failed."""

    published: tuple[Any, ...]
    failed: tuple[Any, ...]


def run_outbox_relay_once(
    sqlalchemy_url: str,
    tenant_id: Any,
    deliver: Callable[[dict[str, Any]], bool],
    *,
    limit: int,
    lease_seconds: int,
) -> OutboxRelayResult:
    """Claim up to ``limit`` rows and drive each through ``deliver`` to completion.

    The claim runs and commits in its own transaction. Each row is then offered to ``deliver``:
    a return value of ``True`` publishes it, and anything else — a falsy return or a raised
    exception — releases it back for reclaiming. Publish and release each run in their own fresh
    transaction, fenced on the claim token the batch was claimed under, so a lease that expired
    mid-delivery is never acknowledged by a now-stale token.
    """
    with tenant_transaction(sqlalchemy_url, tenant_id) as connection:
        rows = claim_batch(connection, limit, lease_seconds=lease_seconds)

    published: list[Any] = []
    failed: list[Any] = []

    for row in rows:
        identifier = row["id"]
        claim_token = row["claim_token"]
        try:
            delivered = deliver(row) is True
        except Exception:
            delivered = False

        if delivered:
            with tenant_transaction(sqlalchemy_url, tenant_id) as connection:
                if publish_claim(connection, [identifier], claim_token=claim_token):
                    published.append(identifier)
                else:
                    failed.append(identifier)
        else:
            with tenant_transaction(sqlalchemy_url, tenant_id) as connection:
                release_claim(connection, [identifier], claim_token=claim_token)
            failed.append(identifier)

    return OutboxRelayResult(published=tuple(published), failed=tuple(failed))
