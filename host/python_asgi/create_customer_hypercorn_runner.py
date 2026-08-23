"""Optional Hypercorn host-runner boundary around create_customer_app.

Exposes run_create_customer_hypercorn: a thin, explicitly-invoked launch
boundary that builds the existing StdioJsAsgiBridge ASGI callable via
create_customer_app and hands it to Hypercorn's asyncio serve() entrypoint.
This module imports Hypercorn lazily, only inside the runner function, so
importing this module never requires Hypercorn to be installed and never
has any side effect. Hypercorn is selected here only as a second optional
ASGI host runner, analogous to the existing Uvicorn runner; the Kernel
remains framework-independent. This is a host adapter/runner boundary
only: it implements no product behavior and makes no production, deploy, or
release claim.
"""

import asyncio

from .create_customer_app import create_customer_app

__all__ = ["run_create_customer_hypercorn"]


def run_create_customer_hypercorn(
    command,
    host="127.0.0.1",
    port=8000,
    max_body_bytes=None,
    log_level="info",
):
    app = create_customer_app(command, max_body_bytes=max_body_bytes)

    try:
        from hypercorn.asyncio import serve
        from hypercorn.config import Config
    except ImportError as error:
        raise RuntimeError(
            "hypercorn is not installed; run_create_customer_hypercorn requires "
            "the optional hypercorn package and performs no fallback host"
        ) from error

    config = Config()
    config.bind = [f"{host}:{port}"]
    config.loglevel = log_level

    asyncio.run(serve(app, config))
