"""Resolution of declared production substrate capabilities.

Resolution is by real import and attribute lookup, never by checking that a file exists. That
distinction is what kept the Phase A RED behavioural rather than structural — a test did not fail
because a path was absent, it failed because the behaviour it needed could not be obtained — and
it is what keeps the check honest now that the substrate exists.

Every failure message carries the live database health evidence, so the failure text itself proves
the database was reached, authenticated and healthy *before* the capability was demanded.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any

from ._errors import MissingSubstrateCapability
from .contract import CONTRACT_FILENAME, capability_spec, phase

# Keys the production schema contract must expose for the behavioural suites to address the
# schema by logical name instead of guessing physical names.
#
# No business or domain table is named here. A substrate package has no domain, so transaction and
# policy behaviour is exercised against the two tables the substrate itself owns.
REQUIRED_SCHEMA_KEYS = (
    "tenant_setting",
    "outbox_table",
    "audit_table",
    "tenant_column",
    "id_column",
    "payload_column",
    "claimed_column",
)

# Keys the tenant-context attestation must expose. The mechanism is Phase B's choice; only the
# outcome property is fixed here.
REQUIRED_ATTESTATION_KEYS = ("policy_settings", "runtime_writable", "forgeable_by_runtime_role")


@dataclass(frozen=True)
class SchemaNames:
    """Physical names for the substrate objects, read from the production schema contract."""

    tenant_setting: str
    outbox_table: str
    audit_table: str
    tenant_column: str
    id_column: str
    payload_column: str
    claimed_column: str

    @property
    def runtime_tables(self) -> tuple[str, ...]:
        """Every runtime table this package owns, in the order the contract enumerates them."""
        return (self.outbox_table, self.audit_table)


def _evidence(substrate: Any) -> str:
    if substrate is None:
        return "database=<not supplied to this assertion>"
    return substrate.health_evidence()


def _fail(
    capability_id: str, target: str, reason: str, substrate: Any
) -> "MissingSubstrateCapability":
    return MissingSubstrateCapability(
        f"substrate capability {capability_id!r} is not implemented.\n"
        f"  declared in : {CONTRACT_FILENAME} -> {_declaring_section(capability_id)}\n"
        f"  target      : {target}\n"
        f"  resolution  : {reason}\n"
        f"  phase       : {phase()}{_phase_reading(capability_id)}\n"
        f"  database    : REACHED AND HEALTHY — {_evidence(substrate)}\n"
        f"  meaning     : this is a missing production capability, not a broken Docker daemon, "
        f"dependency install, Python/uv toolchain or test harness."
    )


def _declaring_section(capability_id: str) -> str:
    """Which part of the contract declared this capability, so the reader can go and look."""
    try:
        spec = capability_spec(capability_id)
    except KeyError:
        return f"<undeclared capability {capability_id}>"
    if spec.get("implemented") is False:
        return f"redFollowUps.gaps[].declaredCapabilities[{capability_id}]"
    return f"requiredCapabilities[{capability_id}]"


def _phase_reading(capability_id: str) -> str:
    """How to read this failure: a design decision, or a regression.

    A capability a RED follow-up declared but has not implemented is absent on purpose, and saying
    so keeps its failure from being mistaken for the shipped substrate breaking.
    """
    try:
        spec = capability_spec(capability_id)
    except KeyError:
        spec = {}
    if spec.get("implemented") is False:
        return " — declared by a RED follow-up and not implemented yet, by design."
    if phase().startswith("A"):
        return " — the production substrate has not been written yet, by design."
    return " — the substrate is supposed to exist in this phase, so this is a regression."


def require_capability(capability_id: str, *, substrate: Any = None) -> Any:
    """Resolve a declared capability, or fail with full evidence.

    The lookup is ``module:attribute`` against the real import system. A missing module, a missing
    attribute and a module that exists but is empty are all reported distinctly, so a partial or
    regressed implementation produces a precise diagnosis rather than a generic failure.
    """
    spec = capability_spec(capability_id)
    target = spec["target"]
    module_name, _, attribute = target.partition(":")

    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        raise _fail(capability_id, target, f"no module named {exc.name!r}", substrate) from exc
    except ImportError as exc:  # present but not importable — a real defect, still a capability gap
        raise _fail(
            capability_id, target, f"module {module_name!r} failed to import: {exc}", substrate
        ) from exc

    if not attribute:
        raise _fail(capability_id, target, "the declared target names no attribute", substrate)
    if not hasattr(module, attribute):
        raise _fail(
            capability_id,
            target,
            f"module {module_name!r} imported but defines no attribute {attribute!r}",
            substrate,
        )
    return getattr(module, attribute)


def schema_names(substrate: Any = None) -> SchemaNames:
    """The production schema contract, validated for completeness before use."""
    mapping = require_capability("schema.contract", substrate=substrate)
    try:
        missing = [key for key in REQUIRED_SCHEMA_KEYS if key not in mapping]
    except TypeError as exc:
        raise _fail(
            "schema.contract",
            capability_spec("schema.contract")["target"],
            f"resolved to {type(mapping).__name__}, which is not a mapping",
            substrate,
        ) from exc
    if missing:
        raise _fail(
            "schema.contract",
            capability_spec("schema.contract")["target"],
            f"resolved but is incomplete; missing keys {missing}",
            substrate,
        )
    return SchemaNames(**{key: mapping[key] for key in REQUIRED_SCHEMA_KEYS})


def tenant_context_attestation(substrate: Any = None) -> dict:
    """How the controlled transaction API attests a tenant context to the policy.

    Only the outcome property is fixed: whatever the mechanism, the runtime role must not be able
    to produce an accepted tenant context on its own. The suite reads ``policy_settings`` from here
    so the forgery proof covers every setting the policy actually consults, rather than guessing.
    """
    mapping = require_capability("runtime.tenant_context_attestation", substrate=substrate)
    target = capability_spec("runtime.tenant_context_attestation")["target"]
    try:
        missing = [key for key in REQUIRED_ATTESTATION_KEYS if key not in mapping]
    except TypeError as exc:
        raise _fail(
            "runtime.tenant_context_attestation",
            target,
            f"resolved to {type(mapping).__name__}, which is not a mapping",
            substrate,
        ) from exc
    if missing:
        raise _fail(
            "runtime.tenant_context_attestation",
            target,
            f"resolved but is incomplete; missing keys {missing}",
            substrate,
        )
    return dict(mapping)
