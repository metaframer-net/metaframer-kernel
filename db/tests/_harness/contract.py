"""Loader for the package-local machine-readable substrate contract.

The tests never hard-code the capability set. They read it from the same artifact the Node
verifier validates, so the RED expectation and the governance contract cannot drift apart: adding
a capability to the contract without a test, or testing a capability the contract never declared,
both surface immediately.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

CONTRACT_FILENAME = "kernel-runtime-substrate-s1.json"
# _harness -> tests -> db
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = PACKAGE_ROOT / CONTRACT_FILENAME


@lru_cache(maxsize=1)
def contract() -> Mapping[str, Any]:
    """The parsed substrate contract. Missing or malformed is a hard error, never a default."""
    if not CONTRACT_PATH.is_file():
        raise FileNotFoundError(
            f"the substrate contract is missing at {CONTRACT_PATH.relative_to(PACKAGE_ROOT.parent)}"
        )
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _capability_index() -> Mapping[str, Mapping[str, Any]]:
    """Shipped capabilities, plus those a RED follow-up has declared but not yet implemented.

    Both live in the same index so a follow-up test resolves its capability exactly as a shipped
    one does, and fails with the same evidence-bearing error when it is absent.
    """
    index = {entry["id"]: entry for entry in contract()["requiredCapabilities"]}
    for gap in contract().get("redFollowUps", {}).get("gaps", []):
        for entry in gap.get("declaredCapabilities", []):
            index[entry["id"]] = entry
    return index


def capability_spec(capability_id: str) -> Mapping[str, Any]:
    """The declared spec for one capability, or a hard error naming the declared set."""
    index = _capability_index()
    if capability_id not in index:
        raise KeyError(
            f"{capability_id!r} is not declared in {CONTRACT_FILENAME}; "
            f"declared capabilities are {sorted(index)}"
        )
    return index[capability_id]


def declared_capability_ids() -> tuple[str, ...]:
    return tuple(_capability_index())


def phase() -> str:
    return contract()["phase"]
