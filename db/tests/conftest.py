"""Session fixtures for the substrate suite.

One real PostgreSQL 16 container is started per pytest session and removed in the fixture
finaliser, which runs whether the session passed, failed or was interrupted.

Capability resolution deliberately does NOT happen in a fixture. If it did, a missing production
capability would surface as a pytest *error* during setup; resolving it inside each test body
makes it a *failure* attributed to the test that needed it. That is what made the Phase A RED
readable as a capability gap rather than a broken harness, and it is what would make a future
regression readable the same way.
"""

from __future__ import annotations

import pytest

from _harness.docker_postgres import CONTAINER_PREFIX, start_postgres
from _harness.reset import reset_database


@pytest.fixture(scope="session")
def substrate():
    """A real, healthy, correctly roled PostgreSQL 16 instance, removed on the way out."""
    instance, stop = start_postgres()
    try:
        yield instance
    finally:
        # Cleaned even when the session failed or was interrupted.
        stop()


@pytest.fixture(autouse=True)
def _empty_database(request):
    """Start every test from an empty database.

    Harness plumbing, not test semantics. The suites assert over whole tables — "tenant B sees no
    rows", "nothing is left unclaimed" — which is only meaningful when the database holds nothing
    but what the test itself wrote. Tests that never touch the database skip the reset.
    """
    if "substrate" not in request.fixturenames:
        yield
        return
    reset_database(request.getfixturevalue("substrate"))
    yield


def pytest_report_header(config) -> list[str]:
    """Make the lifecycle visible in the run header, so the evidence is in the output itself."""
    return [
        "metaframer-kernel runtime substrate S1 — Phase B (GREEN)",
        f"container prefix: {CONTAINER_PREFIX}<per-run-unique>",
        "production substrate: metaframer_kernel_db at revision 0001_runtime_substrate; "
        "a MissingSubstrateCapability failure here would mean it regressed",
    ]
