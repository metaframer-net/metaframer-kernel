"""Claiming outbox rows safely.

``FOR UPDATE SKIP LOCKED`` is the whole trick: a claimer locks the rows it takes and steps over
rows another claimer is already holding, so two workers racing for the same batch never overlap
and never queue behind each other.

The guarantee is **at-least-once**, and this module does not pretend otherwise. A claimer that
crashes after claiming, or one whose lease expires before it publishes, leaves rows that must be
handed out again — that is correct behaviour, not a defect. Each row therefore keeps a stable
``id`` across claiming so a consumer can recognise a repeat and drop it.

There is no consumer, no retry policy, no dead-letter queue and no event bus here. Claiming is the
substrate's job; deciding what to do with a claimed row is not.
"""

from __future__ import annotations

from typing import Any, Final

from sqlalchemy import Connection, text

from .schema import OUTBOX_TABLE

#: How long a claim is held before the row becomes claimable again. A lease, not a lock: the
#: claimer's transaction ends long before this expires under normal operation.
DEFAULT_LEASE_SECONDS: Final = 300

# The inner SELECT takes the lock and skips rows already locked by a live claimer; the outer
# UPDATE stamps the lease. Both run inside the caller's transaction and under the caller's tenant
# context, so row-level security scopes the claim to one tenant without a WHERE clause saying so.
#
# A row is claimable when it has not been published and either was never claimed or its lease has
# expired. That second arm is what makes at-least-once true rather than aspirational: a consumer
# that claims a row and then dies would otherwise strand it, claimed forever and delivered never.
# Reclaiming keeps the row's id and increments `attempts`, so a consumer that partially succeeded
# can recognise the repeat and count how often it has been tried.
_CLAIM_SQL = text(
    f"""
    WITH claimable AS (
        SELECT id
        FROM {OUTBOX_TABLE}
        WHERE published_at IS NULL
          AND available_at <= now()
          AND (claimed_at IS NULL OR claim_expires_at <= now())
        ORDER BY available_at, recorded_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT :limit
    )
    UPDATE {OUTBOX_TABLE} AS o
    SET claimed_at = now(),
        claim_token = gen_random_uuid(),
        claim_expires_at = now() + make_interval(secs => :lease_seconds),
        attempts = o.attempts + 1
    FROM claimable AS c
    WHERE o.id = c.id
    RETURNING o.id, o.tenant_id, o.event_type, o.event_version, o.payload, o.dedup_key,
              o.correlation_id, o.causation_id, o.actor_id,
              o.occurred_at, o.recorded_at, o.available_at,
              o.claim_token, o.claimed_at, o.claim_expires_at, o.attempts, o.published_at
    """
)

# Both mutations are fenced on the claim token as well as the identifier. The token is what makes
# the caller the *current* claimant rather than merely a previous one: after a lease expires and
# another worker reclaims the row, the first worker still holds an identifier that looks valid and
# a token that no longer is. Comparing only identifiers would let it release live work back to the
# queue, or record work finished that somebody else is still doing.
#
# Row-level security remains decisive and is checked first by PostgreSQL: a row belonging to another
# tenant is not visible to the statement at all, so the token is never even compared for it.
_RELEASE_SQL = text(
    f"""
    UPDATE {OUTBOX_TABLE}
    SET claimed_at = NULL, claim_token = NULL, claim_expires_at = NULL
    WHERE id = ANY(:ids)
      AND claim_token = CAST(:claim_token AS uuid)
      AND published_at IS NULL
    RETURNING id
    """
)

_PUBLISH_SQL = text(
    f"""
    UPDATE {OUTBOX_TABLE}
    SET published_at = now()
    WHERE id = ANY(:ids)
      AND claim_token = CAST(:claim_token AS uuid)
      AND claimed_at IS NOT NULL
      AND published_at IS NULL
    RETURNING id
    """
)


def claim_batch(
    connection: Connection,
    limit: int,
    *,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
) -> list[dict[str, Any]]:
    """Claim up to ``limit`` unclaimed rows for the transaction's tenant.

    Runs inside the caller's transaction: if that transaction rolls back, so does the claim, and
    the rows are immediately claimable again.
    """
    if limit <= 0:
        raise ValueError(f"limit must be positive, got {limit!r}")
    rows = (
        connection.execute(_CLAIM_SQL, {"limit": limit, "lease_seconds": lease_seconds})
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _fenced(connection: Connection, statement, ids: list[Any], claim_token: Any) -> list[Any]:
    """Run a claim-fenced mutation. No token, no mutation — there is no unfenced path."""
    if claim_token is None:
        raise ValueError(
            "a claim token is required: a mutation identified only by row id cannot tell the "
            "current claimant from a previous one"
        )
    if not ids:
        return []
    return list(
        connection.execute(statement, {"ids": list(ids), "claim_token": str(claim_token)})
        .scalars()
        .all()
    )


def release_claim(connection: Connection, ids: list[Any], *, claim_token: Any) -> list[Any]:
    """Hand rows this caller still holds back for reclaiming.

    Returns the identifiers actually released — empty when the token is stale, when the row belongs
    to another tenant, or when the row has already been published.
    """
    return _fenced(connection, _RELEASE_SQL, ids, claim_token)


def publish_claim(connection: Connection, ids: list[Any], *, claim_token: Any) -> list[Any]:
    """Record that rows this caller still holds were published.

    Returns the identifiers actually marked — empty when the token is stale or the row is not the
    caller's. Publishing itself is not this package's concern; recording it accurately is.
    """
    return _fenced(connection, _PUBLISH_SQL, ids, claim_token)
