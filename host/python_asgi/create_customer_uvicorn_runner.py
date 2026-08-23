"""Optional Uvicorn host-runner boundary around create_customer_app.

Exposes run_create_customer_uvicorn: a thin, explicitly-invoked launch
boundary that builds the existing StdioJsAsgiBridge ASGI callable via
create_customer_app and hands it to Uvicorn's own run() entrypoint. This
module imports Uvicorn lazily, only inside the runner function, so importing
this module never requires Uvicorn to be installed and never has any side
effect. Uvicorn is selected here only as the first optional ASGI host
runner; the Kernel remains framework-independent and Hypercorn remains a
separate, compatible candidate. This is a host adapter/runner boundary
only: it implements no product behavior and makes no production, deploy, or
release claim.
"""

from .create_customer_app import create_customer_app

__all__ = ["run_create_customer_uvicorn"]


def run_create_customer_uvicorn(
    command,
    host="127.0.0.1",
    port=8000,
    max_body_bytes=None,
    log_level="info",
    lifespan="auto",
):
    app = create_customer_app(command, max_body_bytes=max_body_bytes)

    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError(
            "uvicorn is not installed; run_create_customer_uvicorn requires the "
            "optional uvicorn package and performs no fallback host"
        ) from error

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level=log_level,
        lifespan=lifespan,
    )
