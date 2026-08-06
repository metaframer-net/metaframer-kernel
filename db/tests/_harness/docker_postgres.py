"""Deterministic PostgreSQL 16 lifecycle over the Docker CLI.

Properties this module guarantees, each of which the environment suite asserts:

* **Real.** A ``postgres:16-alpine`` container, not an in-memory or SQLite stand-in.
* **Uniquely named.** Every run gets a fresh container name, so concurrent or repeated runs
  never collide and never adopt a stranger's container.
* **Readiness-polled.** Liveness is polled — never slept for — through the container's own
  ``pg_isready`` over TCP *and* a real authenticated client connection from the host.
* **Bounded.** Every Docker CLI call, the image pull and the readiness poll all carry deadlines.
  Nothing here can hang a test run.
* **Cleaned even on failure.** Removal is registered before the container can possibly be
  leaked, runs in ``finally``, and is repeated by an ``atexit`` safety net.
* **No host psql.** The host needs only the Docker CLI. Server-side tooling is executed inside
  the container; client work goes through psycopg from the locked dependency set.
* **No committed secrets.** Every password is generated per run with ``secrets``. The superuser
  password is handed to Docker through the process environment rather than argv, so it never
  appears in a process listing, and no password is ever written to disk.
"""

from __future__ import annotations

import atexit
import os
import secrets
import subprocess
import time
import uuid
from dataclasses import dataclass, field

import psycopg
from psycopg import conninfo as pg_conninfo

from ._errors import DockerUnavailable, PostgresNotReady, SubstrateHarnessError

# --- pinned lifecycle constants -------------------------------------------------------------
IMAGE = "postgres:16-alpine"
MAJOR_VERSION = 16
SERVER_VERSION_FLOOR = 160000
SERVER_VERSION_CEILING = 170000

LABEL_KEY = "com.metaframer.kernel.substrate"
LABEL_VALUE = "s1"
CONTAINER_PREFIX = "mfk-substrate-s1-"

# Every bound below is a hard deadline; none of them is a sleep.
DOCKER_CLI_TIMEOUT = 60.0
IMAGE_PULL_TIMEOUT = 600.0
CONTAINER_START_TIMEOUT = 120.0
READY_TIMEOUT = 120.0
POLL_INTERVAL = 0.25
CONNECT_TIMEOUT = 5

SUPERUSER = "postgres"
BOOTSTRAP_DATABASE = "postgres"
DATABASE = "mfk_substrate"
MIGRATION_ROLE = "mfk_migration"
RUNTIME_ROLE = "mfk_runtime"

_LEAKED: set[str] = set()


def _remove_container(name: str) -> None:
    """Force-remove a container and its anonymous volumes. Never raises."""
    try:
        subprocess.run(
            ["docker", "rm", "--force", "--volumes", name],
            capture_output=True,
            timeout=DOCKER_CLI_TIMEOUT,
            check=False,
        )
    except Exception:  # noqa: BLE001 - cleanup must never mask the original failure
        pass
    _LEAKED.discard(name)


@atexit.register
def _sweep_leaked() -> None:
    """Last-resort net: anything still registered when the process dies is removed."""
    for name in list(_LEAKED):
        _remove_container(name)


def _docker(
    *args: str, timeout: float = DOCKER_CLI_TIMEOUT, env: dict[str, str] | None = None
) -> str:
    """Run one bounded Docker CLI call and return stdout, or raise with both streams attached."""
    try:
        result = subprocess.run(
            ["docker", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env,
        )
    except FileNotFoundError as exc:
        raise DockerUnavailable("the docker CLI is not on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise DockerUnavailable(f"`docker {' '.join(args)}` exceeded its {timeout}s bound") from exc
    if result.returncode != 0:
        raise DockerUnavailable(
            f"`docker {' '.join(args)}` failed with exit {result.returncode}\n"
            f"stdout: {result.stdout.strip()}\nstderr: {result.stderr.strip()}"
        )
    return result.stdout.strip()


def _docker_status(*args: str, timeout: float = DOCKER_CLI_TIMEOUT) -> tuple[int, str, str]:
    """Run a Docker CLI call whose non-zero exit is expected and meaningful (e.g. pg_isready)."""
    try:
        result = subprocess.run(
            ["docker", *args], capture_output=True, text=True, timeout=timeout, check=False
        )
    except FileNotFoundError as exc:
        raise DockerUnavailable("the docker CLI is not on PATH") from exc
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    return result.returncode, result.stdout.strip(), result.stderr.strip()


@dataclass(frozen=True)
class RoleCredential:
    """A login role. The password is per-run, generated in memory, and never persisted."""

    name: str
    password: str = field(repr=False)


@dataclass(frozen=True)
class PostgresInstance:
    """A live, healthy, correctly roled PostgreSQL 16 instance.

    Passwords are excluded from ``repr`` so a pytest failure representation of this object can
    never leak a credential into a log or a report.
    """

    container: str
    image: str
    image_digest: str
    host: str
    port: int
    database: str
    superuser: RoleCredential
    migration: RoleCredential
    runtime: RoleCredential
    server_version: str
    server_version_num: int

    def conninfo(self, role: RoleCredential, dbname: str | None = None) -> str:
        """A psycopg connection string for ``role``. Held in memory only."""
        return pg_conninfo.make_conninfo(
            host=self.host,
            port=self.port,
            user=role.name,
            password=role.password,
            dbname=dbname or self.database,
            connect_timeout=CONNECT_TIMEOUT,
            sslmode="disable",
        )

    def sqlalchemy_url(self, role: RoleCredential, dbname: str | None = None) -> str:
        """A SQLAlchemy 2.0 URL for ``role``, using the locked psycopg 3 driver."""
        from urllib.parse import quote

        return (
            f"postgresql+psycopg://{quote(role.name, safe='')}:{quote(role.password, safe='')}"
            f"@{self.host}:{self.port}/{dbname or self.database}"
        )

    def connect(self, role: RoleCredential, dbname: str | None = None, *, autocommit: bool = False):
        """Open a real psycopg connection as ``role``. Also serves as the auth proof."""
        connection = psycopg.connect(self.conninfo(role, dbname))
        connection.autocommit = autocommit
        return connection

    def health_evidence(self) -> str:
        """One line of evidence that the database was genuinely reached, for failure messages."""
        return (
            f"container={self.container} image={self.image} digest={self.image_digest} "
            f"endpoint={self.host}:{self.port}/{self.database} "
            f"server_version_num={self.server_version_num} "
            f"migration_role={self.migration.name} runtime_role={self.runtime.name}"
        )


def _require_docker() -> None:
    _docker("version", "--format", "{{.Server.Version}}")


def _ensure_image() -> str:
    """Ensure the pinned image is present and return its repo digest (or local image id)."""
    code, out, _ = _docker_status("image", "inspect", IMAGE, "--format", "{{.Id}}")
    if code != 0:
        _docker("pull", IMAGE, timeout=IMAGE_PULL_TIMEOUT)
    digests = _docker("image", "inspect", IMAGE, "--format", '{{join .RepoDigests ","}}')
    if digests:
        return digests.split(",")[0]
    return _docker("image", "inspect", IMAGE, "--format", "{{.Id}}")


def _sweep_stale_containers() -> None:
    """Remove containers this harness left behind in earlier runs.

    Only containers carrying this harness's label *and* already stopped are touched, so a
    concurrently running instance is never killed.
    """
    code, out, _ = _docker_status(
        "ps",
        "--all",
        "--quiet",
        "--filter",
        f"label={LABEL_KEY}={LABEL_VALUE}",
        "--filter",
        "status=exited",
        "--filter",
        "status=created",
        "--filter",
        "status=dead",
    )
    if code != 0 or not out:
        return
    for container_id in out.split():
        _remove_container(container_id)


def _container_running(name: str) -> bool:
    code, out, _ = _docker_status("inspect", "--format", "{{.State.Running}}", name)
    return code == 0 and out == "true"


def _container_logs(name: str, tail: int = 40) -> str:
    code, out, err = _docker_status("logs", "--tail", str(tail), name)
    if code != 0:
        return "<container logs unavailable>"
    return "\n".join(filter(None, [out, err])) or "<empty>"


def _published_port(name: str) -> int:
    mapping = _docker("port", name, "5432/tcp")
    # e.g. "127.0.0.1:54321" or a multi-line list; take the first IPv4 mapping.
    for line in mapping.splitlines():
        line = line.strip()
        if not line or line.startswith("["):  # skip IPv6 forms
            continue
        return int(line.rsplit(":", 1)[1])
    raise PostgresNotReady(f"no IPv4 published port for {name}: {mapping!r}")


def _wait_until_ready(
    name: str, superuser: RoleCredential, host: str, port: int
) -> tuple[str, int]:
    """Poll until PostgreSQL accepts an authenticated TCP connection, or fail with evidence.

    Two independent signals must agree. ``pg_isready`` is run *inside* the container against
    127.0.0.1 rather than the local socket, because the official entrypoint runs a temporary
    socket-only server while it initialises the cluster — a socket-based probe would report
    ready too early. The authoritative signal is a real authenticated connection from the host,
    which cannot succeed until the real server is listening and the password is in place.
    """
    deadline = time.monotonic() + READY_TIMEOUT
    last_error = "readiness was never attempted"
    while time.monotonic() < deadline:
        if not _container_running(name):
            raise PostgresNotReady(
                f"container {name} exited before becoming ready\n--- logs ---\n{_container_logs(name)}"
            )
        code, _, err = _docker_status(
            "exec",
            name,
            "pg_isready",
            "--quiet",
            "--host",
            "127.0.0.1",
            "--port",
            "5432",
            "--username",
            SUPERUSER,
            timeout=15.0,
        )
        if code == 0:
            try:
                conninfo = pg_conninfo.make_conninfo(
                    host=host,
                    port=port,
                    user=superuser.name,
                    password=superuser.password,
                    dbname=BOOTSTRAP_DATABASE,
                    connect_timeout=CONNECT_TIMEOUT,
                    sslmode="disable",
                )
                with psycopg.connect(conninfo) as connection, connection.cursor() as cursor:
                    cursor.execute("SELECT version(), current_setting('server_version_num')::int")
                    version, version_num = cursor.fetchone()
                return version, int(version_num)
            except psycopg.Error as exc:  # server up, not yet accepting this client
                last_error = f"psycopg: {exc}"
        else:
            last_error = f"pg_isready exit {code}: {err or '<no stderr>'}"
        time.sleep(POLL_INTERVAL)
    raise PostgresNotReady(
        f"{name} did not become a healthy, authenticating PostgreSQL server within "
        f"{READY_TIMEOUT}s; last signal: {last_error}\n--- logs ---\n{_container_logs(name)}"
    )


def _provision_roles(
    instance_host: str,
    instance_port: int,
    superuser: RoleCredential,
    migration: RoleCredential,
    runtime: RoleCredential,
) -> None:
    """Create the separated migration/admin and non-owner runtime roles.

    ``mfk_migration`` owns the database and the schema and performs DDL. ``mfk_runtime`` is the
    role the application uses: it is NOSUPERUSER and NOBYPASSRLS, it owns nothing, and it holds
    no CREATE on the schema. That separation is what makes a later FORCE RLS proof meaningful —
    an owner would silently bypass unqualified RLS, and a BYPASSRLS role would bypass even FORCE.
    """

    def connect(dbname: str):
        conninfo = pg_conninfo.make_conninfo(
            host=instance_host,
            port=instance_port,
            user=superuser.name,
            password=superuser.password,
            dbname=dbname,
            connect_timeout=CONNECT_TIMEOUT,
            sslmode="disable",
        )
        connection = psycopg.connect(conninfo)
        connection.autocommit = True
        return connection

    try:
        with connect(BOOTSTRAP_DATABASE) as connection, connection.cursor() as cursor:
            # psycopg.sql keeps identifiers and the generated passwords out of string formatting.
            from psycopg import sql

            for role, options in (
                (
                    migration,
                    "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN",
                ),
                (
                    runtime,
                    "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT LOGIN",
                ),
            ):
                cursor.execute(
                    sql.SQL("CREATE ROLE {} WITH " + options + " PASSWORD {}").format(
                        sql.Identifier(role.name), sql.Literal(role.password)
                    )
                )
            cursor.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(DATABASE), sql.Identifier(migration.name)
                )
            )
            cursor.execute(
                sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(DATABASE))
            )
            cursor.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(DATABASE), sql.Identifier(runtime.name)
                )
            )

        with connect(DATABASE) as connection, connection.cursor() as cursor:
            from psycopg import sql

            cursor.execute(
                sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(migration.name))
            )
            cursor.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
            cursor.execute(
                sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(runtime.name))
            )
            # The runtime role may read and write rows, but may never create or alter objects:
            # DDL is the migration role's alone.
            cursor.execute(
                sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(
                    sql.Identifier(runtime.name)
                )
            )
    except psycopg.Error as exc:
        raise SubstrateHarnessError(f"role provisioning failed: {exc}") from exc


def start_postgres() -> tuple[PostgresInstance, "callable"]:
    """Start a real PostgreSQL 16 instance and return it with its idempotent stop function.

    The caller is responsible for invoking the returned stop function in a ``finally``; the
    ``atexit`` net and the registration in ``_LEAKED`` cover the cases where it cannot.
    """
    _require_docker()
    _sweep_stale_containers()
    image_digest = _ensure_image()

    name = f"{CONTAINER_PREFIX}{uuid.uuid4().hex[:16]}"
    superuser = RoleCredential(SUPERUSER, secrets.token_urlsafe(32))
    migration = RoleCredential(MIGRATION_ROLE, secrets.token_urlsafe(32))
    runtime = RoleCredential(RUNTIME_ROLE, secrets.token_urlsafe(32))

    # Registered before `docker run` so a crash between spawn and return still gets swept.
    _LEAKED.add(name)

    def stop() -> None:
        _remove_container(name)

    try:
        # The superuser password is passed by name only: `-e POSTGRES_PASSWORD` makes Docker read
        # the value from this process's environment, so it never lands in argv or `ps` output.
        env = {**os.environ, "POSTGRES_PASSWORD": superuser.password}
        _docker(
            "run",
            "--detach",
            "--name",
            name,
            "--label",
            f"{LABEL_KEY}={LABEL_VALUE}",
            "--env",
            "POSTGRES_PASSWORD",
            "--env",
            f"POSTGRES_USER={SUPERUSER}",
            "--env",
            f"POSTGRES_DB={BOOTSTRAP_DATABASE}",
            # Password authentication over TCP is required, so a successful connection is a real
            # authentication proof rather than a trust-mode no-op.
            "--env",
            "POSTGRES_HOST_AUTH_METHOD=scram-sha-256",
            "--env",
            "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256",
            # An ephemeral loopback-only port: never reachable off-host, never collides.
            "--publish",
            "127.0.0.1::5432",
            IMAGE,
            timeout=CONTAINER_START_TIMEOUT,
            env=env,
        )
        host = "127.0.0.1"
        port = _published_port(name)
        server_version, server_version_num = _wait_until_ready(name, superuser, host, port)
        if not SERVER_VERSION_FLOOR <= server_version_num < SERVER_VERSION_CEILING:
            raise PostgresNotReady(
                f"expected PostgreSQL {MAJOR_VERSION}.x, got server_version_num="
                f"{server_version_num} ({server_version})"
            )
        _provision_roles(host, port, superuser, migration, runtime)
        return (
            PostgresInstance(
                container=name,
                image=IMAGE,
                image_digest=image_digest,
                host=host,
                port=port,
                database=DATABASE,
                superuser=superuser,
                migration=migration,
                runtime=runtime,
                server_version=server_version,
                server_version_num=server_version_num,
            ),
            stop,
        )
    except BaseException:
        # Cleaned even on failure — including KeyboardInterrupt and SystemExit.
        stop()
        raise
