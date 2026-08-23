"""Standard-library-only Python host app factory for StdioJsAsgiBridge.

Exposes create_customer_app: a factory that validates an explicit,
non-empty subprocess command sequence and returns a StdioJsAsgiBridge ASGI
callable. This is an interop convenience only: it selects no host server
and implements no real product behavior.
"""

from .metaframer_kernel_host_bridge import StdioJsAsgiBridge

__all__ = ["create_customer_app"]


def create_customer_app(command, max_body_bytes=None):
    if command is None:
        raise ValueError("command must be an explicit non-empty sequence of strings")

    if isinstance(command, (str, bytes)):
        raise ValueError("command must be a sequence of strings, not a single string or bytes")

    try:
        command_list = list(command)
    except TypeError as error:
        raise ValueError("command must be an explicit non-empty sequence of strings") from error

    if not command_list:
        raise ValueError("command must be an explicit non-empty sequence of strings")

    for part in command_list:
        if not isinstance(part, str):
            raise ValueError("every command element must be a string")

    if max_body_bytes is not None:
        if isinstance(max_body_bytes, bool) or not isinstance(max_body_bytes, int):
            raise ValueError("max_body_bytes must be an int or None")
        if max_body_bytes < 0:
            raise ValueError("max_body_bytes must be a non-negative int or None")

    return StdioJsAsgiBridge(command_list, max_body_bytes=max_body_bytes)
