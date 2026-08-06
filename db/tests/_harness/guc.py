"""Issuing real ``SET`` / ``SET LOCAL`` / ``set_config`` statements.

``SET`` is utility syntax, not a query: PostgreSQL will not accept a bind parameter for its value,
so ``cursor.execute("SET LOCAL x = %s", (v,))`` fails to parse before it can prove anything. These
helpers compose the statement with a quoted literal instead, so the suite exercises the genuine
statement a client would issue.

Setting names come from this package's own contract, never from a request, and values are quoted by
``psycopg.sql.Literal``.
"""

from __future__ import annotations

from typing import Any

from psycopg import sql


def set_local(cursor: Any, setting: str, value: str) -> None:
    """``SET LOCAL <setting> = '<value>'`` — transaction-scoped."""
    cursor.execute(sql.SQL("SET LOCAL {} = {}").format(sql.SQL(setting), sql.Literal(value)))


def set_session(cursor: Any, setting: str, value: str) -> None:
    """``SET <setting> = '<value>'`` — session-scoped."""
    cursor.execute(sql.SQL("SET {} = {}").format(sql.SQL(setting), sql.Literal(value)))


def set_config(cursor: Any, setting: str, value: str, *, local: bool) -> None:
    """``SELECT set_config(<setting>, <value>, <local>)`` — the function form.

    This one is an ordinary function call, so it takes bind parameters normally.
    """
    cursor.execute("SELECT set_config(%s, %s, %s)", (setting, value, local))
