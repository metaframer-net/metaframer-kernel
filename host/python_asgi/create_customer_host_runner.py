"""Explicit host-runner selector boundary over the optional Uvicorn/Hypercorn runners.

Exposes run_create_customer_host: a thin dispatch boundary that requires an
explicit runner="uvicorn" or runner="hypercorn" choice and forwards to the
matching sibling runner module (create_customer_uvicorn_runner or
create_customer_hypercorn_runner). This module imports neither uvicorn nor
hypercorn directly; it only imports the sibling runner functions, which
themselves hold their package imports lazily inside their own functions. An
unknown runner value fails closed with a ValueError listing the allowed
values. This is a launch-selection boundary only: it implements no product
behavior, adds no default framework base, and makes no production, deploy,
or release claim.
"""

from .create_customer_hypercorn_runner import run_create_customer_hypercorn
from .create_customer_uvicorn_runner import run_create_customer_uvicorn

__all__ = ["run_create_customer_host"]

_RUNNERS = {
    "uvicorn": run_create_customer_uvicorn,
    "hypercorn": run_create_customer_hypercorn,
}


def run_create_customer_host(command, runner="uvicorn", **kwargs):
    try:
        selected = _RUNNERS[runner]
    except KeyError:
        allowed = ", ".join(sorted(_RUNNERS))
        raise ValueError(
            f"unknown runner {runner!r}; allowed values are: {allowed}"
        ) from None

    return selected(command, **kwargs)
