"""Error taxonomy for the Phase A harness.

The single most important property of the RED run is that a reader can tell, from the exception
type alone, whether the failure means "the production substrate is absent" or "the harness/
environment is broken". Those two are deliberately different branches of the hierarchy and never
share a base class other than ``Exception``.

* ``SubstrateHarnessError`` and its subclasses  -> the environment failed. NOT a meaningful RED.
* ``MissingSubstrateCapability``                -> the production capability is absent. The RED.
"""

from __future__ import annotations


class SubstrateHarnessError(RuntimeError):
    """The harness or its environment failed.

    Raised when Docker is unavailable, the image cannot be pulled, PostgreSQL never became
    healthy, or role provisioning failed. A test run that ends here proves nothing about the
    production substrate and must not be reported as a capability RED.
    """


class DockerUnavailable(SubstrateHarnessError):
    """The Docker CLI or daemon is not usable."""


class PostgresNotReady(SubstrateHarnessError):
    """The container never reached a healthy, authenticating PostgreSQL 16 server in time."""


class MissingSubstrateCapability(AssertionError):
    """A declared production substrate capability is not implemented.

    This was the Phase A RED, raised 29 times against a healthy database to prove the substrate
    was genuinely absent. It remains in force as a regression guard: if the implementation were
    removed or broken, the behavioural suites would raise this again rather than pass against
    nothing.

    It is an ``AssertionError`` so pytest reports it as a test failure rather than an internal
    error, and it carries the live database health evidence so the failure text itself proves the
    database was reached before the capability was demanded.
    """
