import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================================
// tests/_harness/live-migration-rollback-probe.mjs — P23C, one migration seam and nothing else.
//
// P23A proved this system can lose its whole database and get the truth back out of an archive;
// P23B proved it can lose the node and carry on over a promoted copy. Neither answers the failure a
// team meets far more often: the SCHEMA CHANGE ITSELF was wrong and has to come back out while the
// listener is running. This file adds exactly the four reads and moves that close that gap, BESIDE
// the two P22 harnesses, the P23A recovery seam and the P23B failover seam, changing no byte of any
// of them. It runs the REPOSITORY'S OWN alembic revisions, in both directions, through the SAME
// locked `uv run --frozen` toolchain the P22B1 environment already migrates with, and writes no
// schema statement of its own: a seam able to build or remove the very objects under test would be
// proving a schema this repository wrote twice. It starts no environment, defines no image and holds
// no environment of its own — it is handed the ONE P22B1 environment and reads the container names,
// the network, the volume, the run's unique label and the pinned image out of it.
//
// The isolated database publishes nothing, so this host cannot reach it to migrate it. Each
// migration therefore happens in a MAINTENANCE WINDOW, exactly as the P22B1 bootstrap already does
// it: the served container is shut down cleanly and removed while its named volume is left alone,
// the SAME volume is briefly re-served by a throwaway container bound to 127.0.0.1 and nothing else,
// the owning role is given a fresh one-shot password over the database's own trusted local socket
// with the statement on STDIN, the revisions run with the URL on STDIN, and the throwaway container
// is removed before the same volume is re-served under the original name, network and alias,
// publishing no host port. No credential is ever a command-line argument or an environment VALUE,
// and the application container is never stopped, restarted or re-credentialed here.
//
// Honest limit, stated rather than implied: this is ONE operator-driven, single-node, ephemeral
// drill with the listener refused for the whole window. Nothing here keeps a schema backward
// compatible, migrates data, avoids downtime, detects a bad revision or recovers a row the
// revision's own reverse step destroys — the audited decision history in the rolled-back table is
// really gone, and going forward again brings the structure back and none of those rows.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The three seams this file must never reach are composed from their parts, so it can NAME the
// surfaces it must not disturb while holding no importable reference to any of them: it is handed
// an environment and can neither start one, restore one, nor fail one over.
const P22B1_HARNESS = `tests/_harness/${["live", "http", "postgres", "environment"].join("-")}.mjs`;
const P23A_PROBE = `tests/_harness/${["live", "recovery", "probe"].join("-")}.mjs`;
const P23B_PROBE = `tests/_harness/${["live", "standby", "failover", "probe"].join("-")}.mjs`;
const REVISIONS = "db/metaframer_kernel_db/alembic/versions";

/** The one frozen decision record for this probe, frozen because a mutable migration contract could
 * be edited by the very run judged against it: the one database migrated, the credential-free local
 * superuser that is NOT allowed to run the migration, the owning role that is, the runtime role
 * whose privileges the head revision grants, the alias the untouched listener reaches its database
 * by, and the exact pair of revisions this package moves between. */
export const MIGRATION_PROBE_CONTRACT = Object.freeze({
  database: "mfk",
  superuserRole: "postgres",
  migrationRole: "mfk_migration",
  runtimeRole: "mfk_runtime",
  networkAlias: "db",
  head: "0003_policy_decision_log",
  rollbackTarget: "0002_customer_records",
  dataDirectory: "/var/lib/postgresql/data",
  // The maintenance window's only exposure, and the only one it may ever have: the whole business
  // database is briefly reachable through it, so it is bound to this host and to nothing wider.
  maintenanceBindAddress: "127.0.0.1",
  publishesHostPort: false,
  credentialOnCommandLine: false,
  credentialInEnvironmentValue: false,
  // The migration is run by the owning role, never by a superuser: a rollback proven under a role
  // that cannot be refused anything has proven nothing about the role that really owns the schema.
  migrationsRunAsSuperuser: false,
  restartsApplicationContainer: false,
  revisionsAreRepositoryOwned: true,
  // Every wait here is bounded by one of these, and none is looser than the corresponding bound of
  // the environment this probe borrows: an unbounded wait hangs a test run instead of failing it.
  timeouts: Object.freeze({ dockerCli: 120_000, migration: 300_000, ready: 300_000 }),
  preservedHashes: Object.freeze({
    [P22B1_HARNESS]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
    "tests/_harness/live-audited-write-probe.mjs": "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
    [P23A_PROBE]: "e13a0e5be9fc4066c74fb8dbc11279c1e72a2359287195865db1f08ee834c63b",
    [P23B_PROBE]: "3bef68f7e35c530404025678c48fc47ec3c29a501a6f66ea231d833b5d26cf23",
    "db/metaframer_kernel_db/migrations.py": "38b8ffa6dfc4365728aa0482604778ec8e7bcf39ef6f3aeb1f10e88418d3f3ca",
    "db/metaframer_kernel_db/alembic/env.py": "a2ecd03ef7183920894a8e2fd38e30d9f18f4c1e25ded9ffe014b0fe5da31239",
    [`${REVISIONS}/0001_runtime_substrate.py`]: "4640ba1d5ff2e9dc008b98afdb6850328204e1c7b437ddc954a9a334d1611b7b",
    [`${REVISIONS}/0002_customer_records.py`]: "1016fa121c6a147b4dc03a7f4eaefb37e6beb33d09005ab3048656fcbe7b03c8",
    [`${REVISIONS}/0003_policy_decision_log.py`]: "012598c6907f8c9c2de1869c585aa6177f19b7fc4e324fb279c5ce89141f212d",
    "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
    "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
    "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
  }),
});

const C = MIGRATION_PROBE_CONTRACT;

// A credential can only be redacted by something that knows it, so every one-shot password this
// seam mints is remembered HERE and stripped out of every failure it raises: an alembic or psql
// error carrying a connection string would put the migration password into a test report, a CI log
// and a shell history in one step.
const SECRETS = new Set();
const redact = (text) => [...SECRETS].reduce((carried, secret) => carried.replaceAll(secret, "[redacted]"), String(text));

/** One bounded child process. A timeout is a killed child and a non-zero status, never a hang. */
function run(command, args, { timeout, input = "", cwd = root } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let [stdout, stderr, expired] = ["", "", false];
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: expired ? 124 : code, stdout, stderr: expired ? `${stderr}\ntimed out after ${timeout}ms` : stderr }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const docker = (args, options = {}) => run("docker", args, { timeout: C.timeouts.dockerCli, ...options });
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const stamp = () => new Date().toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");

/** The same call, but a non-zero status is a REDACTED error naming what was attempted. */
async function dockerOrThrow(what, args, options = {}) {
  const result = await docker(args, options);
  if (result.status !== 0) throw new Error(redact(`${what} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`));
  return result;
}

/** Poll until true or until the bound is spent; the bound is always one of the contract's. */
async function waitUntil(what, probe, bound) {
  const deadline = Date.now() + bound;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not become ready within ${bound}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Names, network, volume, label and pinned image all come from the environment this probe was
 * HANDED: a seam that could guess a container name could migrate a database nobody gave it. */
function borrowed(environment) {
  const { names, label, network } = environment ?? {};
  for (const key of ["postgres", "volume"]) {
    if (typeof names?.[key] !== "string" || names[key].length === 0) {
      throw new TypeError(`this probe must be handed a started environment carrying its own ${key} name`);
    }
  }
  const image = environment?.postgres?.image;
  if (typeof network !== "string" || typeof label?.key !== "string" || typeof image !== "string") {
    throw new TypeError("this probe must be handed a started environment carrying its own network, unique label and pinned database image");
  }
  return { names, label, network, image, maintenance: `mfk-${label.value}-migrate` };
}

/** Wait for the database in a container to answer its own readiness check over its local socket. */
const ready = (container) => waitUntil(`the database ${container}`, async () =>
  (await docker(["exec", container, "pg_isready", "--quiet", "--host", C.maintenanceBindAddress, "--username", C.superuserRole])).status === 0, C.timeouts.ready);

/** Shut a container down cleanly first, so the cluster on the shared volume is never killed mid-write. */
async function retire(what, container) {
  await docker(["stop", container]);
  await dockerOrThrow(what, ["rm", "--force", container]);
}

/** Re-serve the SAME volume under the environment's own name, network and alias, publishing nothing. */
async function serve({ names, label, network, image }) {
  await dockerOrThrow("re-serving the migrated database", ["run", "--detach", "--name", names.postgres,
    "--label", `${label.key}=${label.value}`, "--network", network, "--network-alias", C.networkAlias,
    "--volume", `${names.volume}:${C.dataDirectory}`, image]);
  await ready(names.postgres);
}

/** One read through the database's OWN psql over its local trusted socket, as a named role: no
 * credential is an argument here, no port is published for one to travel to, and rows come back one
 * JSON object per line in the server's own order. */
async function psql(environment, role, statement) {
  const { names } = borrowed(environment);
  const text = `SELECT row_to_json(t) FROM (${statement}) AS t`;
  const result = await docker(["exec", names.postgres, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-U", role, "-d", C.database, "-c", text]);
  if (result.status !== 0) {
    const matched = /^ERROR:\s+(\w{5}):\s*(.*)$/m.exec(result.stderr);
    throw Object.assign(new Error(redact(matched ? matched[2] : result.stderr.trim())), { code: matched?.[1] });
  }
  return lines(result.stdout).map((line) => JSON.parse(line));
}

// The real migration, run by the real alembic revisions this repository already owns, in whichever
// direction it is asked for. The URL arrives on stdin, so no password is ever an argument of this
// process either, and the config is the repository's own — this seam supplies no revision path,
// no ini file and no schema statement of its own.
const MIGRATION = [
  "import json, sys",
  "from alembic import command",
  "from metaframer_kernel_db.migrations import alembic_config",
  "url, role, direction, target = json.load(sys.stdin)",
  "config = alembic_config(url, runtime_role=role)",
  "getattr(command, direction)(config, target)",
].join("\n");

/** ONE maintenance window, used identically in both directions: the served database is shut down
 * cleanly and removed while its named volume is left completely alone, the same volume is re-served
 * by a throwaway container reachable only from this host, the owning role is given a fresh one-shot
 * password over the trusted local socket with the statement on stdin, the repository's own revisions
 * run through the locked toolchain with the URL on stdin, and the throwaway container is removed
 * before the original name is re-served. It fails closed: a migration that does not succeed is an
 * exception, never a descriptor. */
async function migrationWindow(environment, { direction, from, to, target }) {
  const context = borrowed(environment);
  const { names, label, maintenance, image } = context;
  const startedAt = stamp();
  const password = randomUUID();
  SECRETS.add(password);
  try {
    await retire("removing the served database for the maintenance window", names.postgres);
    await dockerOrThrow("opening the maintenance window", ["run", "--detach", "--name", maintenance,
      "--label", `${label.key}=${label.value}`, "--publish", `${C.maintenanceBindAddress}::5432`,
      "--volume", `${names.volume}:${C.dataDirectory}`, image]);
    await ready(maintenance);
    await dockerOrThrow("issuing the one-shot maintenance credential",
      ["exec", "--interactive", maintenance, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", C.superuserRole, "-d", C.superuserRole],
      { input: `ALTER ROLE ${C.migrationRole} PASSWORD '${password.replaceAll("'", "''")}';\n` });
    const mapped = lines((await dockerOrThrow("reading the maintenance port", ["port", maintenance, "5432/tcp"])).stdout)
      .find((line) => !line.startsWith("["));
    const url = `postgresql+psycopg://${C.migrationRole}:${encodeURIComponent(password)}@${C.maintenanceBindAddress}:${mapped.split(":").at(-1)}/${C.database}`;
    SECRETS.add(url);
    const migrated = await run("uv", ["run", "--frozen", "python", "-c", MIGRATION],
      { cwd: path.join(root, "db"), timeout: C.timeouts.migration, input: JSON.stringify([url, C.runtimeRole, direction, target]) });
    if (migrated.status !== 0) throw new Error(redact(`the real alembic ${direction} from ${from} to ${to} failed:\n${migrated.stdout}\n${migrated.stderr}`));
  } finally {
    // The window closes even on failure: a throwaway container able to reach the whole business
    // database over a published port is not something a drill may leave standing.
    await docker(["stop", maintenance]);
    await docker(["rm", "--force", maintenance]);
    await serve(context).catch(() => {});
    SECRETS.delete(password);
  }
  const remaining = lines((await dockerOrThrow("confirming the maintenance window is closed",
    ["ps", "--all", "--quiet", "--filter", `name=^${maintenance}$`])).stdout);
  return Object.freeze({
    direction, from, to,
    servedContainer: names.postgres,
    volume: names.volume,
    publishedOn: C.maintenanceBindAddress,
    maintenanceRemoved: remaining.length === 0,
    startedAt, completedAt: stamp(),
  });
}

/** The revision the DATABASE ITSELF reports, read out of alembic's own version table as the owning
 * migration role — never taken from a descriptor this seam wrote. */
export async function currentRevision(environment) {
  const rows = await psql(environment, C.migrationRole, "SELECT version_num::text AS revision FROM alembic_version");
  return Object.freeze({ revision: rows[0]?.revision ?? null, readAs: C.migrationRole });
}

// Five catalogue reads, each ordered by the server so the same schema always yields the same
// record: what a rollback destroyed and what a re-upgrade restored are decided by comparing two of
// these, and an unordered yardstick would make every comparison a coin toss.
const FACTS = Object.freeze({
  tables: "SELECT c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1",
  triggers: "SELECT t.tgname::text AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1",
  functions: "SELECT p.proname::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1",
  policies: "SELECT q.polname::text AS name FROM pg_policy q JOIN pg_class c ON c.oid = q.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' ORDER BY 1",
  grants: "SELECT c.relname::text AS name, a.privilege_type::text AS privilege FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'mfk_runtime' ORDER BY 1, 2",
});

/** The structure AND the security shape of the live schema, read from PostgreSQL's own catalogues:
 * the tables that stand, the triggers, functions and policies on them, whether row-level security is
 * enabled and forced, and exactly which privileges the runtime role holds table by table. An object
 * that no longer exists carries no entry at all, so a privilege or a policy outliving its own table
 * shows up here rather than quietly surviving into a re-created one. */
export async function schemaFacts(environment) {
  const read = async (key) => psql(environment, C.superuserRole, FACTS[key]);
  const [tables, triggers, functions, policies, grants] = await Promise.all(Object.keys(FACTS).map(read));
  const rowSecurity = {};
  for (const row of tables) rowSecurity[row.name] = { enabled: row.enabled, forced: row.forced };
  const runtimeGrants = {};
  for (const row of grants) (runtimeGrants[row.name] ??= []).push(row.privilege);
  return Object.freeze({
    tables: tables.map((row) => row.name),
    triggers: triggers.map((row) => row.name),
    functions: functions.map((row) => row.name),
    policies: policies.map((row) => row.name),
    rowSecurity, runtimeGrants,
  });
}

/** Run the repository's OWN head revision backwards, against the live database, to exactly `revision`. */
export async function downgradeTo(environment, revision) {
  const from = (await currentRevision(environment)).revision;
  return migrationWindow(environment, { direction: "downgrade", from, to: revision, target: revision });
}

/** Run it forwards again to the real head — restoring structure, and never a row it destroyed. */
export async function upgradeToHead(environment) {
  const from = (await currentRevision(environment)).revision;
  return migrationWindow(environment, { direction: "upgrade", from, to: C.head, target: "head" });
}
