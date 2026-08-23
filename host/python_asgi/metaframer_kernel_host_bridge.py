"""Standard-library-only Python ASGI host bridge envelope primitive.

Exposes StdioJsAsgiBridge: an ASGI-callable (scope, receive, send) object that
collects an HTTP request body, serializes scope + body into a JSON envelope,
invokes an injected subprocess command over stdin/stdout, decodes the JSON
list of ASGI response events the command writes to stdout, and replays them
through `send`. This is an interop primitive only: it selects no host server
and implements no real product behavior.
"""

import base64
import json
import subprocess

__all__ = ["StdioJsAsgiBridge"]

_ERROR_STATUS_MALFORMED_MORE_BODY = 500
_ERROR_STATUS_BODY_TOO_LARGE = 413
_ERROR_STATUS_SUBPROCESS_FAILED = 502

_ERROR_HEADERS = [[b"content-type", b"application/json"]]


def _error_events(code, message):
    body = json.dumps({"error": code, "message": message}).encode("utf-8")
    status = {
        "malformed_more_body": _ERROR_STATUS_MALFORMED_MORE_BODY,
        "body_too_large": _ERROR_STATUS_BODY_TOO_LARGE,
        "subprocess_failed": _ERROR_STATUS_SUBPROCESS_FAILED,
    }[code]
    return [
        {"type": "http.response.start", "status": status, "headers": _ERROR_HEADERS},
        {"type": "http.response.body", "body": body, "more_body": False},
    ]


class StdioJsAsgiBridge:
    """ASGI-callable bridge that delegates to a subprocess JS command via a JSON stdio envelope."""

    def __init__(self, command, max_body_bytes=None):
        self._command = list(command)
        self._max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        body_chunks = []
        total_bytes = 0
        while True:
            message = await receive()
            chunk = message.get("body", b"")
            more_body = message.get("more_body", False)

            if not isinstance(more_body, bool):
                await self._send_events(send, _error_events("malformed_more_body", "more_body must be a bool"))
                return

            if chunk:
                total_bytes += len(chunk)
                if self._max_body_bytes is not None and total_bytes > self._max_body_bytes:
                    await self._send_events(send, _error_events("body_too_large", "request body exceeds max_body_bytes"))
                    return
                body_chunks.append(chunk)

            if not more_body:
                break

        body = b"".join(body_chunks)
        envelope = {
            "scope": _json_safe_scope(scope),
            "bodyBase64": base64.b64encode(body).decode("ascii"),
        }

        try:
            events = self._invoke_subprocess(envelope)
        except _SubprocessError as error:
            await self._send_events(send, _error_events("subprocess_failed", str(error)))
            return

        await self._send_events(send, events)

    def _invoke_subprocess(self, envelope):
        try:
            completed = subprocess.run(
                self._command,
                input=json.dumps(envelope).encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as error:
            raise _SubprocessError(f"failed to launch subprocess command: {error}") from error

        if completed.returncode != 0:
            raise _SubprocessError(
                f"subprocess command exited with code {completed.returncode}: "
                f"{completed.stderr.decode('utf-8', errors='replace')}"
            )

        try:
            raw_events = json.loads(completed.stdout.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise _SubprocessError(f"malformed JSON stdout from subprocess command: {error}") from error

        if not isinstance(raw_events, list):
            raise _SubprocessError("subprocess stdout JSON must be a list of ASGI events")

        return [_decode_event(event) for event in raw_events]

    @staticmethod
    async def _send_events(send, events):
        for event in events:
            await send(event)


class _SubprocessError(Exception):
    pass


def _json_safe_scope(scope):
    safe = {}
    for key, value in scope.items():
        safe[key] = _json_safe_value(value)
    return safe


def _json_safe_value(value):
    if isinstance(value, bytes):
        return {"__bytesBase64__": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {k: _json_safe_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe_value(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _decode_event(event):
    if not isinstance(event, dict):
        raise _SubprocessError("each ASGI response event must be a JSON object")
    decoded = dict(event)
    if "bodyBase64" in decoded:
        decoded["body"] = base64.b64decode(decoded.pop("bodyBase64"))
    if "headersBase64" in decoded:
        decoded["headers"] = [
            [base64.b64decode(name), base64.b64decode(value)]
            for name, value in decoded.pop("headersBase64")
        ]
    return decoded
