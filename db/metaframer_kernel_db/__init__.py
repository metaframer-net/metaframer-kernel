"""MetaFramer Kernel PostgreSQL runtime substrate.

This package is the whole runtime substrate and nothing more: two tenant-owned tables under
FORCE row-level security, a controlled transaction boundary that carries an unforgeable tenant
attestation, an append-only audit trail, and a safe outbox claim.

There is deliberately no domain here, and no framework around it. No business table, no primitive,
no policy decision point, no SDK, no HTTP surface, no consumer, no retry or dead-letter machinery.
Those belong to later, separately authorised packages.

PostgreSQL 16 only.
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "0.1.0"
