"""Explicit argv/CLI boundary over the existing host-runner selector.

Exposes parse_create_customer_host_args(argv) and main(argv=None): a thin
command-line boundary that requires an explicit ``--runner uvicorn`` or
``--runner hypercorn`` choice and an explicit ``--`` separator before the
application-side JS command, then forwards the parsed values to the
sibling run_create_customer_host selector. This module imports neither
uvicorn nor hypercorn directly, and it imports no FastAPI or Django
module; it only imports run_create_customer_host from the sibling
create_customer_host_runner module, which itself holds the uvicorn/
hypercorn imports lazily inside its own sibling runner functions. There is
no default runner: omitting --runner fails closed before any dispatch. An
empty or missing command (no ``--`` separator, or nothing after it) also
fails closed before runner dispatch. This is a CLI launch-selection
boundary only: it implements no product behavior, adds no default
framework base, and makes no production, deploy, or release claim.
"""

import argparse
import sys

from .create_customer_host_runner import run_create_customer_host

__all__ = ["parse_create_customer_host_args", "main"]


def parse_create_customer_host_args(argv):
    parser = argparse.ArgumentParser(
        prog="create_customer_host_cli",
        description=(
            "Explicit CLI boundary to launch the optional Uvicorn or Hypercorn "
            "ASGI host runner over an application-side JS command."
        ),
    )
    parser.add_argument(
        "--runner",
        required=True,
        choices=["uvicorn", "hypercorn"],
        help="Explicit host runner to dispatch to; there is no default.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--max-body-bytes", type=int, default=None)
    parser.add_argument("--log-level", default="info")
    parser.add_argument(
        "command",
        nargs="*",
        help=(
            "Application-side JS command, given after a literal -- separator, "
            "e.g. -- node create_customer_asgi_runner.mjs"
        ),
    )

    normalized_argv = sys.argv[1:] if argv is None else list(argv)

    args = parser.parse_args(normalized_argv)

    if "--" not in normalized_argv:
        parser.error("a -- separator followed by the command is required")

    if not args.command:
        parser.error("the command after -- must not be empty")

    return args


def main(argv=None):
    args = parse_create_customer_host_args(argv)

    run_create_customer_host(
        list(args.command),
        runner=args.runner,
        host=args.host,
        port=args.port,
        max_body_bytes=args.max_body_bytes,
        log_level=args.log_level,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
