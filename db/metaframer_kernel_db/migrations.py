"""Alembic entry point for the substrate.

The configuration is built in code rather than read from an ``alembic.ini``, so a caller supplies
a URL and gets a ``Config`` that is already pointed at this package's revision tree. There is no
ambient configuration file to drift out of sync with the code.

Migrations run as the migration/admin role — the owner of the objects — and never as a superuser.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from alembic.config import Config

#: The current head of the revision tree. 0001 creates the runtime substrate; 0002 adds the first
#: tenant-owned domain table, GJ-01's customer records.
HEAD_REVISION: Final = "0002_customer_records"

#: The role the migration grants runtime privileges to. Configurable, because the substrate does
#: not get to decide what an operator calls their application role.
DEFAULT_RUNTIME_ROLE: Final = "mfk_runtime"
RUNTIME_ROLE_ENV: Final = "MFK_RUNTIME_ROLE"

SCRIPT_LOCATION: Final = Path(__file__).resolve().parent / "alembic"


def resolve_runtime_role(runtime_role: str | None = None) -> str:
    return runtime_role or os.environ.get(RUNTIME_ROLE_ENV) or DEFAULT_RUNTIME_ROLE


def alembic_config(sqlalchemy_url: str, *, runtime_role: str | None = None) -> Config:
    """A ``Config`` bound to this package's revisions and the given database.

    The URL travels in ``attributes`` rather than through the ini section, so no value is ever
    subjected to config-file interpolation — a password containing a percent sign would otherwise
    be silently mangled.
    """
    config = Config()
    config.set_main_option("script_location", str(SCRIPT_LOCATION))
    config.attributes["connection_url"] = sqlalchemy_url
    config.attributes["runtime_role"] = resolve_runtime_role(runtime_role)
    return config
