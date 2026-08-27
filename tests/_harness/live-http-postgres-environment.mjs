import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================================
// tests/_harness/live-http-postgres-environment.mjs — P22B1, one ephemeral live environment.
//
// P22A1 fixed how a mounted credential reaches the existing audited runner; P22A2 froze the image
// that carries it. Neither started a listener or contacted a database. This harness builds exactly
// one environment that does both, and then deletes it: a digest-pinned PostgreSQL 16.15 on a
// unique internal network, migrated by the REAL alembic revisions to the real head under the real
// mfk_migration/mfk_runtime split, and the UNCHANGED P22A2 image serving HTTP from its own
// installed Uvicorn, started by a run-time entrypoint override rather than by editing any image.
//
// The database publishes NO host port, so nothing outside the isolated network can reach it —
// which also means this host cannot run alembic against it. The migration therefore runs in a
// bootstrap phase: the same named volume is first served by a throwaway container on the default
// bridge, where the real `uv run --frozen` alembic upgrade reaches it exactly as the existing P21F
// substrate test does, and is then re-served by the container this suite judges, on the internal
// network and publishing nothing. Reimplementing the DDL over `docker exec` would have proven a
// schema this repository wrote twice, not the real migration head. Every later read goes back in
// the same way: SQL through the database's own psql over its local trusted socket, HTTP through
// the application container's own node against 127.0.0.1, and no credential is an argument of
// either. Nothing here defines an image, edits one, pushes one, or writes a business row: every
// route the suite exercises is a refusal, and the audited write is P22B2's.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATABASE = "mfk";
// Role flags identical to the ones the existing substrate tests create: neither role is a
// superuser, neither may bypass row-level security, and neither may create a role or a database.
const ROLE_FLAGS = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";

/**
 * The one frozen decision record for this environment. It is frozen because a mutable environment
 * contract could be edited by the very run that has to be judged against it.
 */
export const LIVE_ENVIRONMENT_CONTRACT = Object.freeze({
  // A tag is a mutable pointer; only the multiarch index digest keeps this proof pinned to the
  // exact PostgreSQL release it was reviewed against.
  postgresImage: "postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685",
  migrationRole: "mfk_migration",
  runtimeRole: "mfk_runtime",
  database: DATABASE, migrationHead: "0003_policy_decision_log",
  dockerfile: "host/deploy/Dockerfile",
  hostCli: "host/python_asgi/create_customer_host_cli.py",
  consoleEntry: "metaframer-kernel-customer-host",
  runner: "uvicorn",
  wrapperInImage: "/app/host/deploy/secret_file_runner.mjs",
  secretMountDir: "/run/secrets",
  appPort: 8000, publishesHostPort: false,
  network: Object.freeze({ internal: true, alias: "db", namePrefix: "mfk-p22b1-" }),
  labelKey: "com.metaframer.kernel.deploy",
  labelValuePrefix: "p22b1",
  // The exact `docker run` flags the application container is started with, and the only ones.
  hardening: Object.freeze(["--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]),
  // Every wait in this file is bounded by one of these: an unbounded wait hangs a test run instead
  // of failing it, and a hung run reports nothing at all.
  timeouts: Object.freeze({ dockerCli: 120_000, imagePull: 900_000, ready: 300_000, http: 60_000, stop: 120_000 }),
});

const C = LIVE_ENVIRONMENT_CONTRACT;

/** One bounded child process. A timeout is a killed child and a non-zero status, never a hang. */
function run(command, args, { timeout, input = "", cwd = root } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, DOCKER_BUILDKIT: "1" } });
    let [stdout, stderr, expired] = ["", "", false];
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: expired ? 124 : code, stdout, stderr: expired ? `${stderr}\ntimed out after ${timeout}ms` : stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const docker = (args, options = {}) => run("docker", args, { timeout: C.timeouts.dockerCli, ...options });

/** The same call, but a non-zero status is an error naming what was attempted. */
async function dockerOrThrow(what, args, options = {}) {
  const result = await docker(args, options);
  if (result.status !== 0) throw new Error(`${what} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result;
}

const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const inspectOne = async (args) => JSON.parse((await dockerOrThrow(`docker ${args[0]} inspect`, args)).stdout)[0];

/** Poll until true or until the bound is spent; the bound is always one of the contract's. */
async function waitUntil(what, probe, bound) {
  const deadline = Date.now() + bound;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not become ready within ${bound}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// One reader, run by the application image's own node inside the running container, for the three
// surfaces that only exist in that container: its pid-1 OS command line, its pid-1 environment and
// every command line in its process table.
const SURFACE_READER = [
  "const fs = require('node:fs');",
  "const flat = (file) => { try { return fs.readFileSync(file, 'utf8').split('\\u0000').filter(Boolean).join(' '); } catch { return ''; } };",
  "const pids = fs.readdirSync('/proc').filter((entry) => /^[0-9]+$/.test(entry));",
  "process.stdout.write(JSON.stringify({ argv: flat('/proc/1/cmdline'), env: flat('/proc/1/environ'),",
  " proc: pids.map((pid) => pid + ' ' + flat('/proc/' + pid + '/cmdline')).join('\\n') }));",
].join("");

// One HTTP client, run by that same node against 127.0.0.1 inside the container, because no
// application port is published and the listener is reachable from nowhere else.
const HTTP_CLIENT = [
  "const [method, route, port] = JSON.parse(process.argv[process.argv.length - 1]);",
  "fetch('http://127.0.0.1:' + port + route, { method })",
  " .then(async (response) => process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() })));",
].join("");

// The real migration, run by the real alembic revisions this repository already owns. The URL
// arrives on stdin so no password is ever an argument of this process either.
const MIGRATION = [
  "import json, sys",
  "from alembic import command",
  "from metaframer_kernel_db.migrations import alembic_config",
  "url, role = json.load(sys.stdin)",
  "command.upgrade(alembic_config(url, runtime_role=role), 'head')",
].join("\n");

const quoted = (secret) => `'${String(secret).replaceAll("'", "''")}'`;

/**
 * Everything this run created, found by ITS OWN label and by nothing else, so a concurrent run can
 * never be swept or adopted. The temporary host secret directory carries no Docker label, so it is
 * found by the same unique label value in its name.
 */
export async function collectLabelledResources(label) {
  const filter = ["--filter", `label=${label.key}=${label.value}`];
  const [containers, networks, images, volumes] = await Promise.all([
    docker(["ps", "-aq", ...filter]), docker(["network", "ls", "-q", ...filter]),
    docker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}", ...filter]), docker(["volume", "ls", "-q", ...filter]),
  ]);
  const entries = await readdir(tmpdir()).catch(() => []);
  return {
    containers: lines(containers.stdout),
    networks: lines(networks.stdout),
    imageTags: lines(images.stdout).filter((tag) => !tag.endsWith(":<none>")),
    volumes: lines(volumes.stdout),
    secretDirs: entries.filter((entry) => entry.startsWith(`${label.value}-secrets-`)).map((entry) => path.join(tmpdir(), entry)),
  };
}

/**
 * Remove exactly what this label names, in dependency order. It is written to be correct on a
 * PARTIALLY started environment: it discovers what exists rather than assuming what was created,
 * so a failure between any two startup steps still leaves nothing behind.
 */
async function sweep(label) {
  const found = await collectLabelledResources(label);
  const stop = { timeout: C.timeouts.stop };
  for (const id of found.containers) await docker(["rm", "--force", "--volumes", id], stop);
  for (const id of found.networks) await docker(["network", "rm", id], stop);
  for (const tag of found.imageTags) await docker(["image", "rm", "--force", tag], stop);
  for (const id of found.volumes) await docker(["volume", "rm", "--force", id], stop);
  for (const dir of found.secretDirs) await rm(dir, { recursive: true, force: true });
  return found;
}

/** Start the one ephemeral environment: pinned database, real migration, unchanged image, live HTTP. */
export async function startLiveEnvironment({ runtimePassword, label }) {
  const names = {
    network: `mfk-${label.value}`, postgres: `mfk-${label.value}-db`, bootstrap: `mfk-${label.value}-boot`,
    volume: `mfk-${label.value}-data`, app: `mfk-${label.value}-app`, tag: `mfk-${label.value}:test`,
  };
  const labelled = ["--label", `${label.key}=${label.value}`];
  const environment = { label, secretDir: null, names, stopped: false };
  try {
    if ((await docker(["version", "--format", "{{.Server.Version}}"])).status !== 0) {
      throw new Error("docker is not available in this environment: npm test in this repository already requires a working daemon, so this is an environment failure and never a P22B1 capability gap");
    }
    const pull = { timeout: C.timeouts.imagePull };
    await dockerOrThrow("pulling the pinned database image", ["pull", "--quiet", C.postgresImage], pull);
    await dockerOrThrow("building the UNCHANGED P22A2 image", ["build", "--file", C.dockerfile, "--tag", names.tag, ...labelled, "."], pull);
    await dockerOrThrow("creating the isolated network", ["network", "create", "--internal", ...labelled, names.network]);
    await dockerOrThrow("creating the database volume", ["volume", "create", ...labelled, names.volume]);

    // Bootstrap phase: the same volume, briefly reachable from this host, so the REAL alembic
    // revisions run against it. Nothing from this phase survives into the environment under test.
    const [superuser, migrationPassword] = [randomUUID(), randomUUID()];
    const dataVolume = ["--volume", `${names.volume}:/var/lib/postgresql/data`];
    await dockerOrThrow("starting the bootstrap database", ["run", "--detach", "--name", names.bootstrap, ...labelled,
      "--env", `POSTGRES_PASSWORD=${superuser}`, "--publish", "127.0.0.1::5432", ...dataVolume, C.postgresImage]);
    await waitUntil(`the bootstrap database ${names.bootstrap}`, async () =>
      (await docker(["exec", names.bootstrap, "pg_isready", "--quiet", "--host", "127.0.0.1", "--username", "postgres"])).status === 0, C.timeouts.ready);
    const psqlAsSuperuser = (database, statements) => dockerOrThrow(`bootstrapping ${database}`,
      ["exec", "--interactive", names.bootstrap, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database],
      { input: `${statements.join(";\n")};\n` });
    await psqlAsSuperuser("postgres", [
      `CREATE ROLE ${C.migrationRole} WITH ${ROLE_FLAGS} INHERIT LOGIN PASSWORD ${quoted(migrationPassword)}`,
      `CREATE ROLE ${C.runtimeRole} WITH ${ROLE_FLAGS} NOINHERIT LOGIN PASSWORD ${quoted(runtimePassword)}`,
      `CREATE DATABASE ${DATABASE} OWNER ${C.migrationRole}`,
      `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`, `GRANT CONNECT ON DATABASE ${DATABASE} TO ${C.runtimeRole}`,
    ]);
    await psqlAsSuperuser(DATABASE, [`ALTER SCHEMA public OWNER TO ${C.migrationRole}`, "REVOKE ALL ON SCHEMA public FROM PUBLIC",
      `GRANT USAGE ON SCHEMA public TO ${C.runtimeRole}`, `REVOKE CREATE ON SCHEMA public FROM ${C.runtimeRole}`]);
    const mapped = lines((await dockerOrThrow("reading the bootstrap port", ["port", names.bootstrap, "5432/tcp"])).stdout)
      .find((line) => !line.startsWith("["));
    const migrationUrl = `postgresql+psycopg://${C.migrationRole}:${encodeURIComponent(migrationPassword)}@127.0.0.1:${mapped.split(":").at(-1)}/${DATABASE}`;
    const migrated = await run("uv", ["run", "--frozen", "python", "-c", MIGRATION],
      { cwd: path.join(root, "db"), timeout: C.timeouts.ready, input: JSON.stringify([migrationUrl, C.runtimeRole]) });
    if (migrated.status !== 0) throw new Error(`the real alembic upgrade to head failed:\n${migrated.stdout}\n${migrated.stderr}`);
    await dockerOrThrow("removing the bootstrap database", ["rm", "--force", "--volumes", names.bootstrap], { timeout: C.timeouts.stop });

    // The environment under test: the migrated cluster, now on the internal network and publishing
    // nothing, plus the unchanged image serving HTTP from its own installed Uvicorn.
    await dockerOrThrow("starting the isolated database", ["run", "--detach", "--name", names.postgres, ...labelled,
      "--network", names.network, "--network-alias", C.network.alias, ...dataVolume, C.postgresImage]);
    await waitUntil(`the isolated database ${names.postgres}`, async () =>
      (await docker(["exec", names.postgres, "pg_isready", "--quiet", "--host", "127.0.0.1", "--username", "postgres"])).status === 0, C.timeouts.ready);

    environment.secretDir = await mkdtemp(path.join(tmpdir(), `${label.value}-secrets-`));
    await chmod(environment.secretDir, 0o755);
    await writeFile(path.join(environment.secretDir, "config.json"), `${JSON.stringify({
      policy: "allow", audit: "on", trustedTenantId: "3f2504e0-4f89-11d3-9a0c-0305e82c3399", trustedActorId: "actor-p22b1-live-http",
    })}\n`, { mode: 0o644 });
    await writeFile(path.join(environment.secretDir, "database-url.txt"),
      `postgresql://${C.runtimeRole}:${encodeURIComponent(runtimePassword)}@${C.network.alias}:5432/${DATABASE}\n`, { mode: 0o644 });

    // The image is entered through an entrypoint OVERRIDE, so its own entrypoint and command stay
    // exactly what P22A2 froze: this package starts the existing console entry and edits no image.
    await dockerOrThrow("starting the application listener", ["run", "--detach", "--name", names.app, ...labelled,
      "--network", names.network, ...C.hardening, "--volume", `${environment.secretDir}:${C.secretMountDir}:ro`,
      "--entrypoint", C.consoleEntry, names.tag, "--runner", C.runner, "--host", "0.0.0.0", "--port", String(C.appPort),
      "--", "node", C.wrapperInImage, "--config-file", `${C.secretMountDir}/config.json`, "--database-url-file", `${C.secretMountDir}/database-url.txt`]);
    const bound = new RegExp(`Uvicorn running on http://[\\d.]+:${C.appPort}`);
    await waitUntil(`the installed Uvicorn in ${names.app}`, async () =>
      bound.test((await docker(["logs", names.app])).stdout + (await docker(["logs", names.app])).stderr), C.timeouts.ready);

    Object.assign(environment, buildInterface(environment));
    const version = await environment.sql("migration", "SELECT current_setting('server_version') AS v, current_setting('server_version_num')::int AS n");
    const container = await environment.inspect("postgres");
    const uvicorn = await dockerOrThrow("reading the installed Uvicorn version",
      ["exec", names.app, "python3", "-c", "import uvicorn; print(uvicorn.__version__)"]);
    environment.network = names.network;
    environment.postgres = Object.freeze({
      image: container.Config?.Image,
      serverVersion: version.rows[0]?.v,
      serverVersionNum: version.rows[0]?.n,
      publishedHostPort: Object.keys(container.HostConfig?.PortBindings ?? {}).length === 0 ? null : container.HostConfig.PortBindings,
    });
    environment.app = Object.freeze({ uvicornVersion: uvicorn.stdout.trim() });
    return environment;
  } catch (error) {
    // Safe on partial startup: whatever this run had already labelled is removed before the
    // failure is re-thrown, so a broken start never leaves a container, network, volume or
    // secret directory behind for the next run to trip over.
    await sweep(label).catch(() => {});
    throw error;
  }
}

/** The read-only surface the frozen test drives; every call is one bounded `docker exec`. */
function buildInterface({ names, secretDir }) {
  const sql = async (role, statement) => {
    const user = role === "migration" ? C.migrationRole : C.runtimeRole;
    // Row-returning statements are projected one JSON object per line, in the server's own order.
    // Everything else is executed verbatim, so a refusal is PostgreSQL's refusal and not a shape
    // this harness invented; psql's verbose form carries the SQLSTATE the frozen test asserts on.
    const text = /^\s*select\b/i.test(statement) ? `SELECT row_to_json(t) FROM (${statement}) AS t` : statement;
    const result = await docker(["exec", names.postgres, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
      "-v", "VERBOSITY=verbose", "-U", user, "-d", DATABASE, "-c", text]);
    if (result.status !== 0) {
      const matched = /^ERROR:\s+(\w{5}):\s*(.*)$/m.exec(result.stderr);
      throw Object.assign(new Error(matched ? matched[2] : result.stderr.trim()), { code: matched?.[1] });
    }
    return { rows: lines(result.stdout).map((line) => JSON.parse(line)) };
  };
  const target = (which) => (which === "postgres" ? names.postgres : which === "app" ? names.app : names.tag);
  return {
    sql,
    secretDir,
    inspect: (which) => inspectOne(which === "image" ? ["image", "inspect", names.tag] : ["container", "inspect", target(which)]),
    logs: async (which) => {
      const result = await dockerOrThrow("reading container logs", ["logs", target(which)]);
      return `${result.stdout}${result.stderr}`;
    },
    request: async (method, route) => {
      const result = await dockerOrThrow(`${method} ${route} inside the container`,
        ["exec", names.app, "node", "-e", HTTP_CLIENT, JSON.stringify([method, route, C.appPort])], { timeout: C.timeouts.http });
      const { status, body } = JSON.parse(result.stdout);
      let json;
      try { json = JSON.parse(body); } catch { json = undefined; }
      return { status, body, json };
    },
    disclosure: async () => {
      const reader = await dockerOrThrow("collecting the in-container surfaces", ["exec", names.app, "node", "-e", SURFACE_READER]);
      const mounted = await dockerOrThrow("reading the mounted credential", ["exec", names.app, "cat", `${C.secretMountDir}/database-url.txt`]);
      const [container, image, logs] = await Promise.all([inspectOne(["container", "inspect", names.app]),
        inspectOne(["image", "inspect", names.tag]), docker(["logs", names.app])]);
      return {
        ...JSON.parse(reader.stdout),
        inspect: JSON.stringify(container),
        image: JSON.stringify(image),
        logs: `${logs.stdout}${logs.stderr}`,
        mountedFile: mounted.stdout,
      };
    },
  };
}

/**
 * Tear the environment down. Idempotent by construction: it removes what the label currently
 * names, so a second call finds nothing and says so rather than throwing — teardown runs from a
 * finally block, and a throwing teardown would mask the failure that sent it there.
 */
export async function stopLiveEnvironment(environment) {
  if (environment.stopped) return Object.freeze({ stopped: true, alreadyStopped: true, removed: 0 });
  const found = await sweep(environment.label);
  environment.stopped = true;
  return Object.freeze({
    stopped: true,
    alreadyStopped: false,
    removed: found.containers.length + found.networks.length + found.imageTags.length + found.volumes.length + found.secretDirs.length,
  });
}
