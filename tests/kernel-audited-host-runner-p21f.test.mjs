import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";

// P21F — the audited host runner. P21C/P21D/P21E made every boundary decision durably auditable
// in JS, but the one path a real Python ASGI host actually drives — host/js_asgi/
// create_customer_asgi_runner.mjs — still composes the *unaudited* createCustomerAsgiComposition,
// so a request that arrives the way it will really arrive (Python StdioJsAsgiBridge -> a separate
// node runner process -> real PostgreSQL) commits with no decision on record. This frozen test
// owns every fixed expectation for one additive, explicit, value-bearing `--audit on|off` runner
// argument whose default is off, and which — only as `--audit on`, and only in explicit
// `--policy allow` mode — swaps in createAuditedCustomerAsgiComposition with host-minted ULIDs
// and a host-minted UTC-millisecond clock. An omitted `--audit` and an explicit `--audit off` are
// the same runner: the default, `--policy deny` and unaudited `--policy allow` behaviour are
// asserted byte-identical under both. The manifest gates the run and never supplies an expected
// value back to an assertion.

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-audited-host-runner-p21f.json";
const FROZEN_TEST_PATH = "tests/kernel-audited-host-runner-p21f.test.mjs";
const RUNNER_PATH_REL = "host/js_asgi/create_customer_asgi_runner.mjs";
const RUNNER = path.join(root, RUNNER_PATH_REL);
const PACKAGE_ROOT = path.join(root, "host/python_asgi");
const SCENARIO_IDS = Object.freeze(["P21F-1", "P21F-2", "P21F-3", "P21F-4", "P21F-5"]);
const WRITE_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const DECISION_TABLE = "policy_decision_log";
const AUDIT_FLAG = "--audit";
const [AUDIT_ON, AUDIT_OFF] = ["on", "off"];

// The trusted identity this runner process is launched with, and the two attacker-claimed header
// values. FOREIGN_* are well formed, so they reach the pipeline's identity guard rather than a
// shape check, and are never true of the runner's trusted principal.
const TRUSTED_TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3399";
const TRUSTED_ACTOR = "actor-p21f-trusted-host-runner";
const FOREIGN_TENANT = "9c858901-8a57-4791-81fe-4c455b099bd7";
const FOREIGN_ACTOR = "actor-p21f-attacker";
const FOREIGN_VALUES = Object.freeze([FOREIGN_TENANT, FOREIGN_ACTOR]);
const PAYLOAD = Object.freeze({ name: "Ada Lovelace" });
const UNREACHABLE = "postgresql://mfk_runtime:unused@127.0.0.1:1/never_connected";
// Any trace of an actual PostgreSQL contact attempt; a fail-closed args rejection must show none.
const DB_CONTACT = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|password authentication|pg_hba|SASL/i;

/**
 * Consulted FIRST in both runtime scenarios, and deliberately I/O-free: the runner is asked to
 * admit `--audit on` in a form that must still fail on a *different*, already-existing missing
 * argument. A checkout whose runner does not yet know the argument answers "unrecognized
 * argument: --audit" and is deterministically RED on exactly that absence — before any manifest
 * read, any container start, any Python process and any database contact — so the missing runner
 * seam can never be confused with a missing manifest or a missing Docker daemon.
 */
function requireAuditValueSeam(scenario) {
  const probe = spawnSync("node", [RUNNER, "--policy", "allow", AUDIT_FLAG, AUDIT_ON], { input: "", encoding: "utf-8" });
  assert.notEqual(probe.status, 0, `[${scenario}] ${RUNNER_PATH_REL} must still refuse --policy allow without a connection string`);
  assert.doesNotMatch(probe.stderr, /unrecognized argument: --audit/,
    `[${scenario}] ${RUNNER_PATH_REL} must admit the explicit value-bearing ${AUDIT_FLAG} ${AUDIT_ON}|${AUDIT_OFF} argument alongside its existing --policy/--connection-string/--trusted-* arguments, so an allow that reaches a real database can be audited`);
  assert.doesNotMatch(probe.stderr, DB_CONTACT, `[${scenario}] an args refusal must never contact PostgreSQL`);
}

/** Load-bearing contract read: no P21F scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const text = await readFile(path.join(root, MANIFEST_PATH), "utf8")
    .catch((error) => assert.fail(`[${scenario}] ${MANIFEST_PATH} must exist before the P21F scenarios may run: ${error.message}`));
  const contract = JSON.parse(text);
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS],
    `[${scenario}] ${MANIFEST_PATH} must declare exactly the five P21F scenario ids, in order`);
  return contract;
}

// ---------------------------------------------------------------------------------------------
// The real interop path: a real Python StdioJsAsgiBridge, one separate node runner process per
// request. Nothing here is mocked, and no Python file is changed by this package.
// ---------------------------------------------------------------------------------------------

const scopeOf = (requestId, tenantId, actorId) => ({
  type: "http", method: "POST", path: "/customers",
  headers: [["content-type", "application/json"], ["x-request-id", requestId],
    ["x-actor-id", actorId], ["x-tenant-id", tenantId], ["idempotency-key", `idem-${requestId}`]],
});

/**
 * One Python driver over N bridge invocations, each spawning its own runner process, answering a
 * JSON list of { events, status, payload }. The specs cross the boundary as data, so the driver
 * itself is fixed and nothing about a scenario is expressed in Python source this test generates.
 */
async function runBridge(specs) {
  const script = `
import asyncio, json, sys
sys.path.insert(0, ${JSON.stringify(PACKAGE_ROOT)})
sys.path.insert(0, ${JSON.stringify(path.dirname(PACKAGE_ROOT))})
from python_asgi import StdioJsAsgiBridge

SPECS = json.loads(${JSON.stringify(JSON.stringify(specs))})

async def main():
    out = []
    for spec in SPECS:
        bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER)}] + spec["args"])
        body = json.dumps(spec["body"]).encode("utf-8")

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        sent = []

        async def send(event):
            sent.append(event)

        await bridge(spec["scope"], receive, send)
        out.append({
            "events": len(sent),
            "status": sent[0]["status"],
            "payload": json.loads(sent[1]["body"]),
        })
    print("RESULT_START")
    print(json.dumps(out))
    print("RESULT_END")

asyncio.run(main())
`;
  const dir = await mkdtemp(path.join(tmpdir(), "p21f-audited-host-runner-"));
  try {
    await writeFile(path.join(dir, "run.py"), script, "utf-8");
    const { stdout } = await execFileAsync("python3", [path.join(dir, "run.py")]);
    const match = stdout.match(/RESULT_START\n([\s\S]*?)\nRESULT_END/);
    assert.ok(match, `the Python bridge driver must answer a result block, got: ${stdout}`);
    return JSON.parse(match[1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The same drive, bracketed by the host's own wall clock around the whole invocation window. */
async function timedBridge(specs) {
  const before = Date.now();
  const results = await runBridge(specs);
  return { results, before, after: Date.now() };
}

/** `audit` is the explicit on/off value, or null for an omitted --audit — the default-off runner. */
const allowArgs = (connectionString, audit) => [
  "--policy", "allow", "--connection-string", connectionString,
  "--trusted-tenant-id", TRUSTED_TENANT, "--trusted-actor-id", TRUSTED_ACTOR,
  ...(audit === null ? [] : [AUDIT_FLAG, audit]),
];
const requestOf = (args, requestId, tenantId = TRUSTED_TENANT, actorId = TRUSTED_ACTOR) =>
  ({ args, scope: scopeOf(requestId, tenantId, actorId), body: { ...PAYLOAD } });

// ---------------------------------------------------------------------------------------------
// One compact migrated real PostgreSQL 16 lifecycle, shared by P21F-1 through P21F-4.
// ---------------------------------------------------------------------------------------------

const IMAGE = "postgres:16-alpine";
const [MIGRATION_ROLE, RUNTIME_ROLE, DATABASE] = ["mfk_migration", "mfk_runtime", "mfk_p21f_audited_host_runner"];
const ROLE_FLAGS = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";

async function withPg(host, port, user, password, database, fn) {
  const client = new pg.Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function bringUpSubstrate(t) {
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status !== 0) {
    throw new Error("docker is not available in this environment: this is an environment failure, not an audited-host-runner capability gap, and must be reported separately");
  }
  const [superuser, migrationPassword, runtimePassword] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const name = `mfk-p21f-${crypto.randomBytes(6).toString("hex")}`;
  execFileSync("docker", ["run", "-d", "--rm", "--name", name, "-e", `POSTGRES_PASSWORD=${superuser}`, "-p", "127.0.0.1::5432", IMAGE], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" }));
  const readyDeadline = Date.now() + 60000;
  while (spawnSync("docker", ["exec", name, "pg_isready", "--quiet", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres"], { timeout: 5000 }).status !== 0) {
    if (Date.now() > readyDeadline) throw new Error(`${name} did not become ready in time`);
  }
  const host = "127.0.0.1";
  const mapping = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim();
  const port = Number(mapping.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("[")).split(":").at(-1));
  const run = (database, statements) => withPg(host, port, "postgres", superuser, database, async (client) => { for (const statement of statements) await client.query(statement); });
  await run("postgres", [
    `CREATE ROLE ${MIGRATION_ROLE} WITH ${ROLE_FLAGS} INHERIT LOGIN PASSWORD '${migrationPassword}'`,
    `CREATE ROLE ${RUNTIME_ROLE} WITH ${ROLE_FLAGS} NOINHERIT LOGIN PASSWORD '${runtimePassword}'`,
    `CREATE DATABASE ${DATABASE} OWNER ${MIGRATION_ROLE}`, `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`, `GRANT CONNECT ON DATABASE ${DATABASE} TO ${RUNTIME_ROLE}`,
  ]);
  await run(DATABASE, [`ALTER SCHEMA public OWNER TO ${MIGRATION_ROLE}`, "REVOKE ALL ON SCHEMA public FROM PUBLIC",
    `GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`, `REVOKE CREATE ON SCHEMA public FROM ${RUNTIME_ROLE}`]);
  const url = `postgresql+psycopg://${MIGRATION_ROLE}:${migrationPassword}@${host}:${port}/${DATABASE}`;
  const migration = spawnSync("uv", ["run", "--frozen", "python", "-c", [
    "from metaframer_kernel_db.migrations import alembic_config", "from alembic import command",
    `command.upgrade(alembic_config(${JSON.stringify(url)}, runtime_role=${JSON.stringify(RUNTIME_ROLE)}), 'head')`,
  ].join("\n")], { cwd: path.join(root, "db"), encoding: "utf8" });
  if (migration.status !== 0) throw new Error(`alembic upgrade failed:\n${migration.stdout}\n${migration.stderr}`);
  return {
    asSuperuser: (fn) => withPg(host, port, "postgres", superuser, DATABASE, fn),
    connectionString: `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(runtimePassword)}@${host}:${port}/${DATABASE}`,
  };
}

/** Whole-database counts over the three business write tables — no tenant filter, nothing hides. */
const businessRowCounts = (asSuperuser) => asSuperuser(async (client) => Object.fromEntries(await Promise.all(
  WRITE_TABLES.map(async (table) => [table, (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count]))));
const eachTable = (rows) => Object.fromEntries(WRITE_TABLES.map((table) => [table, rows]));
const decisionRows = (asSuperuser) => asSuperuser(async (client) => (await client.query(`SELECT "id", "tenant_id", "entry_hash", "prev_hash", "payload" FROM "${DECISION_TABLE}" ORDER BY "recorded_at"`)).rows);
const auditedShape = (row) => ({ effect: row.payload.decision, matchedPolicyId: row.payload.matchedPolicyId, layerResolved: row.payload.layerResolved, traceId: row.payload.traceId });

/**
 * The non-leak sweep, run against the server rather than against a value this test happens to
 * hold: every column of every row of all four tables is projected to text through `to_jsonb`, so
 * an attacker-claimed tenant or actor cannot survive anywhere this test never thought to read.
 */
const rowsMentioning = (asSuperuser, needle) => asSuperuser(async (client) => Object.fromEntries(await Promise.all(
  [DECISION_TABLE, ...WRITE_TABLES].map(async (table) => [table,
    (await client.query(`SELECT count(*)::int AS count FROM "${table}" t WHERE to_jsonb(t)::text LIKE $1`, [`%${needle}%`])).rows[0].count]))));
const noTableMentions = () => Object.fromEntries([DECISION_TABLE, ...WRITE_TABLES].map((table) => [table, 0]));

// Canonical ULID and canonical UTC-millisecond instant, as the domain's own primitives define
// them. The ULID's leading 10 characters are its 48-bit millisecond timestamp, so a genuine
// host-minted id brackets around the invocation exactly as the row's own `ts` does.
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_FORM = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TS_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ulidMillis = (id) => [...id.slice(0, 10)].reduce((total, character) => total * 32 + ULID_CHARS.indexOf(character), 0);

function assertHostMinted(rows, bracket, scenario) {
  for (const row of rows) {
    assert.match(row.payload.id, ULID_FORM, `${scenario}: the runner must mint a canonical uppercase 26-character ULID, not an arbitrary id`);
    const minted = ulidMillis(row.payload.id);
    assert.ok(minted >= bracket.before && minted <= bracket.after,
      `${scenario}: the ULID's own millisecond prefix (${minted}) must fall inside the invocation bracket [${bracket.before}, ${bracket.after}] — a genuine host-minted ULID, not a constant`);
    assert.match(row.payload.ts, TS_FORM, `${scenario}: the runner's clock must answer a canonical UTC millisecond ISO instant`);
    const stamped = Date.parse(row.payload.ts);
    assert.ok(stamped >= bracket.before && stamped <= bracket.after,
      `${scenario}: the recorded instant ${row.payload.ts} must fall inside the invocation bracket, so the host clock is real`);
  }
}

// =============================================================================================
// P21F-1 — admission. `--audit` is an explicit value-bearing choice defaulting to off, and
// everything that is not an explicit `--audit on` stays exactly as it was.
// =============================================================================================

test("P21F-1: --audit takes an explicit on|off value, is refused outside --policy allow, defaults to off, and leaves the default and --policy deny admission paths unchanged", async () => {
  requireAuditValueSeam("P21F-1");
  await requireContract("P21F-1");

  // The value is mandatory and closed: a missing value and any value that is not on or off are
  // fail-closed args errors, refused before stdin is read and long before any database exists.
  for (const [name, args, expected] of [
    ["a bare --audit with no value at all", ["--policy", "allow", AUDIT_FLAG], /malformed CLI args: --audit requires a value/],
    ["a --audit whose value is the next flag", [AUDIT_FLAG, "--policy", "allow"], /malformed CLI args: --audit must be "on" or "off"/],
    ["an unknown --audit value", ["--policy", "allow", AUDIT_FLAG, "true"], /malformed CLI args: --audit must be "on" or "off"/],
    ["a case-shifted --audit value", ["--policy", "allow", AUDIT_FLAG, "ON"], /malformed CLI args: --audit must be "on" or "off"/],
  ]) {
    const refused = spawnSync("node", [RUNNER, ...args], { input: "", encoding: "utf-8" });
    assert.notEqual(refused.status, 0, `P21F-1: ${name} must exit non-zero`);
    assert.match(refused.stderr, expected, `P21F-1: ${name} must name the exact malformed input`);
    assert.equal(refused.stdout, "", `P21F-1: ${name} may write no ASGI response events`);
    assert.doesNotMatch(refused.stderr, DB_CONTACT, `P21F-1: ${name} must fail closed before contacting PostgreSQL`);
  }

  // Auditing is not admissible outside allow mode: deny mode never reaches a database, so there
  // is no decision worth a durable record and asking for one is a fail-closed args error. Turning
  // it explicitly off there is not an error, because that is what the runner already was.
  for (const [name, args] of [
    ["the implicit no-policy default", [AUDIT_FLAG, AUDIT_ON]],
    ["an explicit --policy deny", ["--policy", "deny", AUDIT_FLAG, AUDIT_ON]],
  ]) {
    const refused = spawnSync("node", [RUNNER, ...args], { input: "", encoding: "utf-8" });
    assert.notEqual(refused.status, 0, `P21F-1: ${name} plus ${AUDIT_FLAG} ${AUDIT_ON} must exit non-zero`);
    assert.match(refused.stderr, /malformed CLI args: --audit on requires --policy allow/,
      `P21F-1: ${name} plus ${AUDIT_FLAG} ${AUDIT_ON} must name the exact reason it was refused`);
    assert.equal(refused.stdout, "", `P21F-1: ${name} plus ${AUDIT_FLAG} ${AUDIT_ON} may write no ASGI response events`);
    assert.doesNotMatch(refused.stderr, DB_CONTACT, `P21F-1: ${name} plus ${AUDIT_FLAG} ${AUDIT_ON} must fail closed before contacting PostgreSQL`);
  }

  // Allow mode's existing connection-string and trusted-identity requirements are not relaxed by
  // either value: every refusal must still arrive, deterministically, before any composition.
  for (const [name, args, expected] of [
    ["an audited allow without a connection string", ["--policy", "allow", AUDIT_FLAG, AUDIT_ON], /--policy allow requires --connection-string/],
    ["an audited allow without a trusted tenant", ["--policy", "allow", "--connection-string", UNREACHABLE, AUDIT_FLAG, AUDIT_ON], /--policy allow requires --trusted-tenant-id/],
    ["an audited allow without a trusted actor", ["--policy", "allow", "--connection-string", UNREACHABLE, "--trusted-tenant-id", TRUSTED_TENANT, AUDIT_FLAG, AUDIT_ON], /--policy allow requires --trusted-actor-id/],
    ["an explicitly unaudited allow without a trusted actor", ["--policy", "allow", "--connection-string", UNREACHABLE, "--trusted-tenant-id", TRUSTED_TENANT, AUDIT_FLAG, AUDIT_OFF], /--policy allow requires --trusted-actor-id/],
  ]) {
    const refused = spawnSync("node", [RUNNER, ...args], { input: "", encoding: "utf-8" });
    assert.notEqual(refused.status, 0, `P21F-1: ${name} must exit non-zero`);
    assert.match(refused.stderr, expected, `P21F-1: ${name} must name the exact malformed input`);
    assert.equal(refused.stdout, "", `P21F-1: ${name} may write no ASGI response events`);
    assert.doesNotMatch(refused.stderr, DB_CONTACT, `P21F-1: ${name} must fail closed before contacting PostgreSQL`);
  }

  // The paths that never needed a database keep answering exactly what they answered before,
  // through the real Python bridge and a real separate runner process — and an explicit
  // `--audit off` is the same runner as an omitted one, which is what "default off" has to mean.
  const denyRequestId = crypto.randomUUID();
  const denyResults = await runBridge([
    requestOf([], denyRequestId),
    requestOf(["--policy", "deny"], crypto.randomUUID()),
    requestOf(["--policy", "deny", AUDIT_FLAG, AUDIT_OFF], crypto.randomUUID()),
    requestOf([AUDIT_FLAG, AUDIT_OFF], crypto.randomUUID()),
  ]);
  for (const [index, name] of [[0, "the no-args default"], [1, "an explicit --policy deny"],
    [2, `an explicit --policy deny with ${AUDIT_FLAG} ${AUDIT_OFF}`], [3, `${AUDIT_FLAG} ${AUDIT_OFF} with no --policy at all`]]) {
    assert.deepEqual({ events: denyResults[index].events, status: denyResults[index].status, code: denyResults[index].payload.error.code },
      { events: 2, status: 403, code: "POLICY_DENY" }, `P21F-1: ${name} still answers the unchanged two-event 403 POLICY_DENY`);
  }
  assert.equal(denyResults[0].payload.error.requestId, denyRequestId, "P21F-1: the unaudited deny still traces the boundary request id");
});

// =============================================================================================
// P21F-2/P21F-3/P21F-4 — one real migrated PostgreSQL 16 substrate, driven only through the real
// Python StdioJsAsgiBridge into separate JS runner processes. P21F-1's unaudited-allow
// non-regression rides the same substrate, because only a real database can prove it records
// nothing.
// =============================================================================================

test("P21F-2/P21F-3/P21F-4: against one real PostgreSQL 16 substrate the audited runner commits with a verifiable decision genesis, audits every identity-guard refusal, mints its own ULIDs and instants, and fails closed when it cannot record", async (t) => {
  requireAuditValueSeam("P21F-2/P21F-3/P21F-4");
  await requireContract("P21F-2");
  const { asSuperuser, connectionString } = await bringUpSubstrate(t);
  const omitted = allowArgs(connectionString, null);
  const explicitlyOff = allowArgs(connectionString, AUDIT_OFF);
  const audited = allowArgs(connectionString, AUDIT_ON);

  // P21F-1 non-regression — an allow with `--audit` omitted and an allow with an explicit
  // `--audit off` are the same runner it always was: both commit through the unaudited
  // composition and both leave the decision log completely empty. Only a real database can prove
  // that second half, which is why this rides the same substrate as everything below.
  const legacyRequestIds = [crypto.randomUUID(), crypto.randomUUID()];
  const legacyResults = await runBridge([
    requestOf(omitted, legacyRequestIds[0]),
    requestOf(explicitlyOff, legacyRequestIds[1]),
  ]);
  for (const [index, name] of [[0, "an allow with --audit omitted"], [1, `an allow with an explicit ${AUDIT_FLAG} ${AUDIT_OFF}`]]) {
    const legacy = legacyResults[index];
    assert.deepEqual({ events: legacy.events, status: legacy.status, outcome: legacy.payload.commitReceipt.outcome, requestId: legacy.payload.commitReceipt.requestId },
      { events: 2, status: 201, outcome: "COMMITTED", requestId: legacyRequestIds[index] }, `P21F-1: ${name} still commits exactly as it did before`);
  }
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(2), "P21F-1: each unaudited allow writes its own one row per business table");
  assert.equal((await decisionRows(asSuperuser)).length, 0, `P21F-1: neither the omitted default nor an explicit ${AUDIT_FLAG} ${AUDIT_OFF} records any decision — the audit is opt-in, never switched on behind the caller`);

  // P21F-2 — the same request with `--audit on`. The commit is unchanged, and the decision that
  // authorized it is now the verifiable genesis of this tenant's hash-chained log.
  const allowRequestId = crypto.randomUUID();
  const allow = await timedBridge([requestOf(audited, allowRequestId)]);
  const receipt = allow.results[0].payload.commitReceipt;
  assert.deepEqual({ events: allow.results[0].events, status: allow.results[0].status, outcome: receipt.outcome, requestId: receipt.requestId, tenantId: receipt.tenantId, idempotencyKey: receipt.idempotencyKey, outboxCount: receipt.outboxEventIds.length },
    { events: 2, status: 201, outcome: "COMMITTED", requestId: allowRequestId, tenantId: TRUSTED_TENANT, idempotencyKey: `idem-${allowRequestId}`, outboxCount: 1 },
    "P21F-2: the audited allow returns the same CommitReceipt shape, bound to this exact HTTP request");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(3), "P21F-2: the audited allow writes exactly one further row per business table");
  const afterAllow = await decisionRows(asSuperuser);
  assert.equal(afterAllow.length, 1, "P21F-2: the audited allow records exactly one decision");
  const genesis = afterAllow[0];
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis),
    { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: TRUSTED_TENANT, entryHash: genesis.entry_hash, prevHash: null },
    "P21F-2: the genesis row must verify independently, recomputed from its own persisted payload, and be filed under the runner's trusted tenant");
  assert.deepEqual(auditedShape(genesis), { effect: "allow", matchedPolicyId: "allow.everything", layerResolved: "tenant", traceId: allowRequestId },
    "P21F-2: the genesis records the runner's matched allow policy, its resolved layer and the boundary request id");
  assert.deepEqual(genesis.payload.requestActor, { tenantId: TRUSTED_TENANT, actorId: TRUSTED_ACTOR }, "P21F-2: the decision is filed under the process's trusted identity");
  assert.equal(genesis.payload.requestAction, "customer.create", "P21F-2: the audited action is the one the boundary was asked for");
  assertHostMinted([genesis], allow, "P21F-2");

  // P21F-3 — the two reaches a client can attempt through headers the bridge forwards verbatim.
  // Both are refused 403 by the identity guard that already existed, and both are now the
  // genesis's successors in the same chain, under the trusted identity and never the claimed one.
  const crossTenantRequestId = crypto.randomUUID();
  const actorRequestId = crypto.randomUUID();
  const denies = await timedBridge([
    requestOf(audited, crossTenantRequestId, FOREIGN_TENANT, TRUSTED_ACTOR),
    requestOf(audited, actorRequestId, TRUSTED_TENANT, FOREIGN_ACTOR),
  ]);
  assert.deepEqual(denies.results.map((result) => ({ events: result.events, status: result.status, code: result.payload.error.code, retryable: result.payload.error.retryable, receipt: result.payload.commitReceipt })),
    [{ events: 2, status: 403, code: "CROSS_TENANT_DENY", retryable: false, receipt: undefined },
      { events: 2, status: 403, code: "IDENTITY_MISMATCH", retryable: false, receipt: undefined }],
    "P21F-3: a claimed foreign tenant and a claimed foreign actor keep their exact existing refusals, with no receipt");
  const afterDenies = await decisionRows(asSuperuser);
  assert.equal(afterDenies.length, 3, "P21F-3: each identity-guard refusal appends exactly one decision row");
  const [crossTenantRow, actorRow] = [afterDenies[1], afterDenies[2]];
  for (const [row, requestId, name] of [[crossTenantRow, crossTenantRequestId, "cross-tenant"], [actorRow, actorRequestId, "actor-mismatch"]]) {
    verifyPersistedDecisionLogRow(row);
    assert.deepEqual(auditedShape(row), { effect: "deny", matchedPolicyId: null, layerResolved: null, traceId: requestId },
      `P21F-3: the ${name} refusal matches no policy, resolves no layer and traces its own request id`);
    assert.deepEqual(row.payload.requestActor, { tenantId: TRUSTED_TENANT, actorId: TRUSTED_ACTOR },
      `P21F-3: the ${name} refusal is filed under the trusted identity, never the identity the request claimed`);
    assert.ok(typeof row.payload.reason === "string" && row.payload.reason.trim().length > 0, `P21F-3: the ${name} refusal carries a non-empty reason`);
  }
  assert.equal(crossTenantRow.prev_hash, genesis.entry_hash, "P21F-3: the cross-tenant refusal chains onto the P21F-2 allow genesis");
  assert.equal(actorRow.prev_hash, crossTenantRow.entry_hash, "P21F-3: the actor-mismatch refusal chains onto the cross-tenant refusal — commits and refusals share one chain, in the order they happened");
  assert.notEqual(actorRow.payload.reason, crossTenantRow.payload.reason, "P21F-3: the two refusals stay distinguishable in the log, not collapsed into one reason");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(3), "P21F-3: neither refused request writes a business row");
  for (const foreign of FOREIGN_VALUES) {
    assert.deepEqual(await rowsMentioning(asSuperuser, foreign), noTableMentions(),
      `P21F-3: no persisted row in any of the four tables may carry the attacker-claimed value ${foreign} — not in a payload, a reason, a resource or a context`);
  }

  // P21F-4 — the ids and instants are the host's own, per process. Three separate runner
  // processes have now written three rows; every id is a distinct canonical ULID whose own
  // millisecond prefix, and whose row instant, fall inside the bracket around their invocation.
  assertHostMinted([crossTenantRow, actorRow], denies, "P21F-4");
  const mintedIds = afterDenies.map((row) => row.payload.id);
  assert.equal(new Set(mintedIds).size, mintedIds.length, "P21F-4: every ULID minted by every separate runner process is distinct");
  assert.deepEqual(afterDenies.map((row) => row.id), mintedIds, "P21F-4: each row's id column binds to the id inside its own hashed payload");

  // P21F-4 — take away only the decision log's INSERT grant and send a fresh audited allow. A
  // decision that cannot be recorded must stop the request: the runner process fails, the bridge
  // answers its own 502, and no 2xx, no business row and no decision row may appear anywhere.
  await asSuperuser((client) => client.query(`REVOKE INSERT ON TABLE ${DECISION_TABLE} FROM ${RUNTIME_ROLE}`));
  const [blocked] = await runBridge([requestOf(audited, crypto.randomUUID())]);
  assert.equal(blocked.status, 502, "P21F-4: an unrecordable decision must surface as the bridge's own subprocess failure");
  assert.ok(blocked.status < 200 || blocked.status >= 300, "P21F-4: an unrecordable decision must never produce a 2xx at the host boundary");
  assert.equal(blocked.payload.error, "subprocess_failed", "P21F-4: the failure is the runner refusing to answer, not a business outcome");
  assert.equal(blocked.payload.commitReceipt, undefined, "P21F-4: an unrecordable decision may never hand back a CommitReceipt");
  assert.equal((await decisionRows(asSuperuser)).length, 3, "P21F-4: the blocked attempt must leave no decision row");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(3), "P21F-4: the blocked attempt must write no business row");

  // P21F-4 recovery — restore the grant and prove the audited runner still works, so the refusal
  // above is load-bearing rather than a harness that had simply stopped being able to write.
  await asSuperuser((client) => client.query(`GRANT INSERT ON TABLE ${DECISION_TABLE} TO ${RUNTIME_ROLE}`));
  const recoveredRequestId = crypto.randomUUID();
  const recovered = await timedBridge([requestOf(audited, recoveredRequestId)]);
  assert.deepEqual({ status: recovered.results[0].status, outcome: recovered.results[0].payload.commitReceipt.outcome },
    { status: 201, outcome: "COMMITTED" }, "P21F-4: with the grant restored the audited runner commits again");
  const afterRecovery = await decisionRows(asSuperuser);
  assert.equal(afterRecovery.length, 4, "P21F-4: recovery appends exactly one further decision row");
  verifyPersistedDecisionLogRow(afterRecovery[3]);
  assert.equal(afterRecovery[3].prev_hash, actorRow.entry_hash, "P21F-4: the recovered decision chains onto the P21F-3 actor-mismatch refusal, so the revoked window left no gap in the chain");
  assert.equal(afterRecovery[3].payload.traceId, recoveredRequestId, "P21F-4: the recovered decision traces its own request id");
  assertHostMinted([afterRecovery[3]], recovered, "P21F-4");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(4), "P21F-4: recovery adds exactly one further row per business table");
  for (const foreign of FOREIGN_VALUES) {
    assert.deepEqual(await rowsMentioning(asSuperuser, foreign), noTableMentions(),
      `P21F-4: after every scenario, no persisted row in any of the four tables carries the attacker-claimed value ${foreign}`);
  }
});

// =============================================================================================
// P21F-5 — the manifest binds this package, this base, this frozen test and its three allowed
// files, and claims no hosted readiness.
// =============================================================================================

test("P21F-5: the planning manifest binds this package, this base, this frozen test and its three allowed files", async () => {
  const contract = await requireContract("P21F-5");
  requireAuditValueSeam("P21F-5");
  assert.equal(contract.package, "P21F-audited-host-runner");
  assert.equal(contract.base, "d8055e33980de6c0b5a5170ed3d88a1fbdd161ef");
  assert.equal(contract.baseTree, "c8c184f34bf70ec497ae3b8601dec0b884a8a3d7");
  assert.equal(contract.provenance.scopeSynthesisSha256, "c798c7f514781ec5c75ba75f6c0aa2fc45a71fc0609048967045fadcd7db8610");
  assert.equal(contract.provenance.singleWriter, true);
  assert.equal(contract.provenance.reviewerMustBeSeparateSession, true);
  assert.equal(contract.actionplanPin, "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget");
  assert.equal(contract.frozenTestPath, FROZEN_TEST_PATH);
  assert.equal(contract.frozenTestSha256, crypto.createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex"),
    "frozenTestSha256 must be the content hash of this exact test file");
  assert.deepEqual([...contract.allowedFiles].sort(), [MANIFEST_PATH, FROZEN_TEST_PATH, RUNNER_PATH_REL].sort(),
    "P21F may touch only its manifest, this frozen test and the JS host runner");
  assert.deepEqual([...contract.writeTables], [...WRITE_TABLES]);
  assert.match(contract.capabilityDelta, /^AUDITED_HOST_RUNNER_IS_OPT_IN:/);
  for (const scenario of contract.acceptanceScenarios) {
    for (const key of ["name", "given", "then"]) {
      assert.ok(typeof scenario[key] === "string" && scenario[key].length > 0, `${scenario.id} needs a ${key}`);
    }
  }
  for (const flag of ["kernelReady", "releaseAllowed", "productionAllowed", "runnableProduct", "hostSelected", "p21Complete"]) {
    assert.equal(contract.readinessFlags[flag], false, `readinessFlags.${flag} must stay false`);
  }
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(typeof contract.userJourney[key] === "string" && contract.userJourney[key].length > 0, `userJourney.${key} must be a non-empty string`);
  }
  const nonGoals = contract.nonGoals.join(" | ").toLowerCase();
  for (const required of [/no src\/\*\* change/, /no python host/, /no new dependency/, /no schema, migration/, /no release, deploy/, /no hosted/]) {
    assert.match(nonGoals, required, `nonGoals must state: ${required}`);
  }
});
