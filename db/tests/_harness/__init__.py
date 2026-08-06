"""Test harness for the MetaFramer Kernel runtime substrate.

Nothing here is production runtime code. It starts a real, deterministic PostgreSQL 16 instance,
proves that instance is healthy and correctly roled, and resolves the substrate's declared
capabilities by real import.

That last part is why the harness still matters now that the substrate exists. In Phase A the
capabilities were absent and every behavioural suite failed with a precise *missing production
capability* assertion, which is what made the RED attributable to the gap rather than to a broken
Docker daemon, dependency install or harness. The same machinery is still in place: if the
implementation regressed, the suites would return to that failure instead of passing against
nothing.
"""

from ._errors import (
    DockerUnavailable,
    MissingSubstrateCapability,
    PostgresNotReady,
    SubstrateHarnessError,
)

__all__ = [
    "DockerUnavailable",
    "MissingSubstrateCapability",
    "PostgresNotReady",
    "SubstrateHarnessError",
]
