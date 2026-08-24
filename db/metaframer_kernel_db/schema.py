"""Logical-to-physical names for the substrate's objects.

Callers and tests address the schema through this mapping rather than by hard-coding physical
names, so a rename is a one-line change here instead of a sweep through every query.

Exactly two S1 runtime tables exist (``RUNTIME_TABLES``), and both are tenant-owned; a substrate
has no domain, so transaction and policy behaviour is exercised against the tables the substrate
itself owns. ``CUSTOMER_TABLE`` is separate: it is GJ-01's first tenant-owned business/domain
table, added by 0002_customer_records on top of the S1 substrate rather than as part of it, and is
not counted in ``RUNTIME_TABLES``.
"""

from __future__ import annotations

from typing import Final, Mapping

#: The transaction-local setting carrying the tenant identity.
TENANT_SETTING: Final = "mfk.tenant_id"
#: The transaction-local setting carrying the attestation that makes that identity trustworthy.
ATTESTATION_SETTING: Final = "mfk.tenant_attestation"

OUTBOX_TABLE: Final = "transactional_outbox"
AUDIT_TABLE: Final = "audit_log"
#: Holds the per-database signing secret. Owned by the migration role, granted to no one else.
CONTEXT_KEY_TABLE: Final = "mfk_context_key"
#: GJ-01's first tenant-owned domain table, added by 0002_customer_records.
CUSTOMER_TABLE: Final = "customer_records"
#: P04e1's dedicated hash-chain decision log, added by 0003_policy_decision_log. Kept separate
#: from RUNTIME_TABLES and never a reuse of AUDIT_TABLE.
POLICY_DECISION_LOG_TABLE: Final = "policy_decision_log"

#: Every table this package owns, in the order the package contract enumerates them.
RUNTIME_TABLES: Final = (OUTBOX_TABLE, AUDIT_TABLE)

SCHEMA_CONTRACT: Final[Mapping[str, str]] = {
    "tenant_setting": TENANT_SETTING,
    "attestation_setting": ATTESTATION_SETTING,
    "outbox_table": OUTBOX_TABLE,
    "audit_table": AUDIT_TABLE,
    "customer_table": CUSTOMER_TABLE,
    "policy_decision_log_table": POLICY_DECISION_LOG_TABLE,
    # Columns present, under the same name, in both runtime tables.
    "tenant_column": "tenant_id",
    "id_column": "id",
    "payload_column": "event_type",
    "claimed_column": "claimed_at",
}
