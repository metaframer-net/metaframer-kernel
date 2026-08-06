"""The controlled transaction boundary and its tenant context.

One explicit SQLAlchemy 2.0 transaction per call, with the tenant identity established through a
database function rather than by writing a setting. Committing on success and rolling back on any
exception is the whole contract: audit and outbox writes made inside one boundary live or die
together.

Why the context is not simply ``SET LOCAL``
-------------------------------------------
A ``SET LOCAL mfk.tenant_id = '<other tenant>'`` costs a client one statement. If the policy read
that setting directly, tenant isolation would be advisory — any code holding the runtime
connection could rename itself. So the policy does not trust the raw setting. It trusts a short
HMAC over ``(tenant, transaction id)``, keyed by a secret generated per database inside the
migration and readable only by the migration role. ``mfk_begin_tenant_context()`` is a
``SECURITY DEFINER`` function that mints that attestation and installs both settings
transaction-locally; the policy recomputes it and refuses anything that does not match.

Binding to the transaction id does double duty: an attestation cannot be replayed in a later
transaction, so the context is transaction-local by construction and not merely by convention.

Honest limits of the mechanism, stated rather than implied:

* The runtime role can still *call* ``mfk_begin_tenant_context`` for any tenant, because it is one
  database role and that function is its entry point. What the attestation removes is the ability
  to assume a tenant by writing a setting; it raises the bar from "any statement" to "the audited
  entry point". Per-request authorisation of *which* tenant a caller may ask for belongs to the
  policy decision point in a later package, not to the substrate.
* The migration role — the owner of these objects, which can drop them outright — is accepted
  without an attestation. Requiring one from an already-total privilege would buy no security and
  would break legitimate administrative access. It remains fully subject to the tenant filter
  under FORCE row-level security.
"""

from __future__ import annotations

import threading
import uuid
from contextlib import contextmanager
from typing import Any, Final, Iterator, Mapping

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

from .schema import ATTESTATION_SETTING, TENANT_SETTING

#: What the policy consults, and what a caller can and cannot forge. Read by conformance tests.
TENANT_CONTEXT_ATTESTATION: Final[Mapping[str, Any]] = {
    # Every setting the row-level-security policy looks at when deciding a tenant identity.
    "policy_settings": (TENANT_SETTING, ATTESTATION_SETTING),
    # Both are ordinary settings, so the runtime role can write them. That is deliberate: the
    # design does not depend on preventing the write, only on the write being worthless.
    "runtime_writable": {TENANT_SETTING: True, ATTESTATION_SETTING: True},
    # The property that matters. No sequence of SET, SET LOCAL or set_config available to the
    # runtime role produces an accepted tenant context.
    "forgeable_by_runtime_role": False,
    "established_by": "mfk_begin_tenant_context(uuid)",
    "verified_by": "mfk_current_tenant()",
    "binding": "hmac-sha256 over (tenant, transaction id), keyed per database",
}

_BEGIN_CONTEXT = text("SELECT mfk_begin_tenant_context(CAST(:tenant AS uuid))")

_engines: dict[str, Engine] = {}
_engines_lock = threading.Lock()


def _engine(sqlalchemy_url: str) -> Engine:
    """One pooled engine per URL, so connection reuse is real rather than incidental."""
    with _engines_lock:
        engine = _engines.get(sqlalchemy_url)
        if engine is None:
            engine = create_engine(sqlalchemy_url, pool_pre_ping=True, future=True)
            _engines[sqlalchemy_url] = engine
        return engine


def dispose_engines() -> None:
    """Drop every pooled connection. Used when the schema underneath them has been rebuilt."""
    with _engines_lock:
        for engine in _engines.values():
            engine.dispose()
        _engines.clear()


def _require_tenant(tenant_id: Any) -> uuid.UUID:
    """Fail closed on anything that is not a usable tenant identity."""
    if tenant_id is None:
        raise ValueError(
            "a tenant identity is required: the substrate has no ambient or default tenant, "
            "and a transaction without one would be denied by the policy anyway"
        )
    if isinstance(tenant_id, uuid.UUID):
        return tenant_id
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError(f"tenant identity must be a UUID, got {tenant_id!r}")
    try:
        return uuid.UUID(tenant_id)
    except ValueError as exc:
        raise ValueError(f"tenant identity must be a UUID, got {tenant_id!r}") from exc


@contextmanager
def tenant_transaction(sqlalchemy_url: str, tenant_id: Any) -> Iterator[Connection]:
    """Open one explicit transaction with an attested tenant context.

    Commits when the block completes, rolls back if it raises. The yielded connection is a plain
    SQLAlchemy 2.0 ``Connection``; nothing about it is proprietary.
    """
    tenant = _require_tenant(tenant_id)
    with _engine(sqlalchemy_url).connect() as connection:
        with connection.begin():
            connection.execute(_BEGIN_CONTEXT, {"tenant": str(tenant)})
            yield connection


def current_tenant(connection: Connection) -> uuid.UUID | None:
    """The tenant the database currently accepts, or ``None`` when the context is not trusted."""
    return connection.execute(text("SELECT mfk_current_tenant()")).scalar_one_or_none()
