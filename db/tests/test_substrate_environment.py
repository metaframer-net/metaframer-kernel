"""The instance is real, healthy and correctly roled.

This suite is the control for every other one. If these assertions hold, then a behavioural
failure cannot be blamed on Docker, on authentication, on the dependency install, on Python/uv or
on the harness. In Phase A that left the absent production capability as the only explanation for
the 29 failures; now it leaves a genuine regression as the only explanation for any failure at
all, and keeps a passing run from being a run against nothing.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import psycopg
import pytest
from psycopg import conninfo as pg_conninfo

from _harness import dbfacts
from _harness.docker_postgres import (
    CONTAINER_PREFIX,
    IMAGE,
    MIGRATION_ROLE,
    RUNTIME_ROLE,
    SERVER_VERSION_CEILING,
    SERVER_VERSION_FLOOR,
)

pytestmark = pytest.mark.substrate

HARNESS_DIR = Path(__file__).resolve().parent / "_harness"
PACKAGE_DIR = Path(__file__).resolve().parents[1]


def test_the_instance_is_a_real_uniquely_named_running_postgres_16_container(substrate):
    assert substrate.container.startswith(CONTAINER_PREFIX), substrate.container
    # A per-run suffix, so repeated or concurrent runs never collide or adopt each other.
    suffix = substrate.container[len(CONTAINER_PREFIX) :]
    assert len(suffix) == 16 and all(c in "0123456789abcdef" for c in suffix), suffix

    assert substrate.image == IMAGE
    assert substrate.image_digest, "the resolved image digest must be recorded as evidence"

    running = subprocess.run(
        [
            "docker",
            "inspect",
            "--format",
            "{{.State.Running}}{{.Config.Image}}",
            substrate.container,
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    ).stdout.strip()
    assert running == f"true{IMAGE}", running


def test_the_server_really_is_postgresql_16(substrate):
    assert SERVER_VERSION_FLOOR <= substrate.server_version_num < SERVER_VERSION_CEILING
    assert "PostgreSQL 16." in substrate.server_version, substrate.server_version
    # Read again from the live server rather than trusting what start-up recorded.
    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('server_version_num')::int")
        assert cursor.fetchone()[0] == substrate.server_version_num


@pytest.mark.parametrize("role_name", [MIGRATION_ROLE, RUNTIME_ROLE])
def test_both_roles_authenticate_over_tcp_with_a_real_hashed_credential(substrate, role_name):
    role = substrate.migration if role_name == MIGRATION_ROLE else substrate.runtime
    with substrate.connect(role) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT current_user, inet_server_addr() IS NOT NULL")
        current_user, over_tcp = cursor.fetchone()
    assert current_user == role_name
    assert over_tcp is True, "the connection must be TCP, not a local socket"
    assert dbfacts.password_verifier_prefix(substrate, role_name) == "SCRAM-SHA-256"


def test_authentication_is_enforced_rather_than_trusted(substrate):
    """A wrong password must be refused, or every other auth assertion would be vacuous."""
    wrong = pg_conninfo.make_conninfo(
        host=substrate.host,
        port=substrate.port,
        user=substrate.runtime.name,
        password="definitely-not-the-generated-password",
        dbname=substrate.database,
        connect_timeout=5,
        sslmode="disable",
    )
    with pytest.raises(psycopg.OperationalError):
        psycopg.connect(wrong).close()


def test_the_runtime_role_is_non_superuser_and_nobypassrls(substrate):
    """Without this, any later FORCE RLS proof would be vacuous."""
    attributes = dbfacts.role_attributes(substrate, RUNTIME_ROLE)
    assert attributes["superuser"] is False
    assert attributes["bypassrls"] is False
    assert attributes["createdb"] is False
    assert attributes["createrole"] is False
    assert attributes["replication"] is False
    assert attributes["canlogin"] is True


def test_the_runtime_role_owns_nothing_and_cannot_perform_ddl(substrate):
    assert dbfacts.database_owner(substrate) != RUNTIME_ROLE
    assert dbfacts.schema_owner(substrate) != RUNTIME_ROLE
    assert dbfacts.has_schema_privilege(substrate, RUNTIME_ROLE, "USAGE") is True
    assert dbfacts.has_schema_privilege(substrate, RUNTIME_ROLE, "CREATE") is False
    # Behavioural confirmation: the catalogue and the server must agree.
    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cursor.execute("CREATE TABLE runtime_should_not_be_able_to_do_this (id int)")


def test_the_migration_role_owns_the_database_and_the_schema_but_is_not_a_superuser(substrate):
    assert dbfacts.database_owner(substrate) == MIGRATION_ROLE
    assert dbfacts.schema_owner(substrate) == MIGRATION_ROLE
    attributes = dbfacts.role_attributes(substrate, MIGRATION_ROLE)
    assert attributes["superuser"] is False
    assert attributes["bypassrls"] is False
    assert attributes["canlogin"] is True


def test_the_two_roles_are_genuinely_separated(substrate):
    assert substrate.migration.name != substrate.runtime.name
    assert substrate.migration.password != substrate.runtime.password
    # The runtime role must not be able to become the migration role.
    with substrate.connect(substrate.runtime) as connection, connection.cursor() as cursor:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cursor.execute(f'SET ROLE "{MIGRATION_ROLE}"')


def test_the_harness_shells_out_to_no_psql_client(substrate):
    """All client SQL goes through psycopg; the only in-container binary invoked is pg_isready.

    Checked against the harness's own syntax tree rather than its prose, so a mention of psql in
    a docstring cannot mask an actual invocation, and an actual invocation cannot hide behind one.
    """
    invoked: set[str] = set()
    for source_file in sorted(HARNESS_DIR.glob("*.py")):
        tree = ast.parse(source_file.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                token = node.value
                if token == "psql" or token.endswith("/psql"):
                    invoked.add(f"{source_file.name}:{token}")
    assert invoked == set(), f"the harness invokes a psql client: {sorted(invoked)}"


def test_no_generated_secret_is_persisted_anywhere_in_the_package(substrate):
    """Passwords exist only in memory for the life of the run."""
    secrets = {
        substrate.superuser.password,
        substrate.migration.password,
        substrate.runtime.password,
    }
    skip = {".venv", "__pycache__", ".pytest_cache"}
    leaked: list[str] = []
    for candidate in PACKAGE_DIR.rglob("*"):
        if not candidate.is_file() or any(part in skip for part in candidate.parts):
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if any(secret in text for secret in secrets):
            leaked.append(str(candidate.relative_to(PACKAGE_DIR)))
    assert leaked == [], f"a generated secret was persisted to disk: {leaked}"


def test_the_instance_reports_reusable_health_evidence(substrate):
    """The evidence string every capability failure carries must actually name the live facts."""
    evidence = substrate.health_evidence()
    for token in (
        substrate.container,
        IMAGE,
        str(substrate.port),
        str(substrate.server_version_num),
        MIGRATION_ROLE,
        RUNTIME_ROLE,
    ):
        assert token in evidence, f"{token} missing from health evidence: {evidence}"
    # The evidence must never carry a credential.
    for secret in (
        substrate.superuser.password,
        substrate.migration.password,
        substrate.runtime.password,
    ):
        assert secret not in evidence
    assert substrate.runtime.password not in repr(substrate)
