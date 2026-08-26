import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { Clock } from "../src/application/clock.mjs";
import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { DecisionLogPort } from "../src/application/decision-log-port.mjs";
import { DecisionLoggingPolicyDecisionPoint } from "../src/application/decision-logging-policy-decision-point.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

// P21C — boundary decision audit. Against one real migrated PostgreSQL 16 substrate every boundary
// authorization decision must reach policy_decision_log before any business write, and a decision that
// cannot be logged must stop the request rather than commit unaudited. Every fixed security expectation
// is owned here; the manifest gates the run and never supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-boundary-decision-audit-p21c.json";
const FROZEN_TEST_PATH = "tests/kernel-boundary-decision-audit-p21c.test.mjs";
const COMPOSITION_PATH = "src/delivery/create-customer-composition.mjs";
const PIPELINE_PATH = "src/application/create-customer-pipeline.mjs";
const SCENARIO_IDS = Object.freeze(["P21C-1", "P21C-2", "P21C-3"]);
const WRITE_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);

/** Load-bearing contract read: no P21C scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const text = await readFile(path.join(root, MANIFEST_PATH), "utf8")
    .catch((error) => assert.fail(`[${scenario}] ${MANIFEST_PATH} must exist before the P21C scenarios may run: ${error.message}`));
  const contract = JSON.parse(text);
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the three P21C scenario ids, in order`);
  return contract;
}

// Resolved dynamically: a checkout without the composition is deterministically RED here, scenario by
// scenario, with no production module mutated to make collection succeed.
const loaded = await import(pathToFileURL(path.join(root, COMPOSITION_PATH)).href).catch((error) => error);
function auditedFactory(scenario) {
  assert.ok(!(loaded instanceof Error), `[${scenario}] ${COMPOSITION_PATH} must exist and import cleanly: ${loaded?.message}`);
  assert.equal(typeof loaded.createAuditedCustomerComposition, "function", `[${scenario}] ${COMPOSITION_PATH} must additively export createAuditedCustomerComposition`);
  return loaded.createAuditedCustomerComposition;
}

const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ACTOR = "actor-p21c";
const PRINCIPAL = new Principal(new TenantId(TENANT), new ActorId(ACTOR));
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** One shared deterministic ULID/instant source, so every logged entry stays unique and ordered. */
function sequencedIdsAndClock() {
  let seq = 0;
  return {
    idGenerator: async () => `01ARZ3NDEKTSV4RRFFQ69G5FA${ULID_CHARS[seq++ % ULID_CHARS.length]}`,
    now: async () => `2026-08-26T10:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  };
}
const allowCandidate = () => ({ policyId: "policy.allow-customer-create", effect: "allow", applies: true, priority: 100, layer: "tenant" });
const requestOf = (requestId) => ({ requestId, actorId: ACTOR, tenantId: TENANT, payload: { name: "Ada Lovelace" }, idempotencyKey: `idem-${requestId}` });

const IMAGE = "postgres:16-alpine";
const [MIGRATION_ROLE, RUNTIME_ROLE, DATABASE] = ["mfk_migration", "mfk_runtime", "mfk_p21c_decision_audit"];
const ROLE_FLAGS = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";
async function withPg(host, port, user, password, database, fn) {
  const client = new pg.Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

/** One compact migrated real PostgreSQL 16 lifecycle, shared by all three scenarios. */
async function bringUpSubstrate(t) {
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status !== 0) {
    throw new Error("docker is not available in this environment: this is an environment failure, not a boundary decision-audit capability gap, and must be reported separately");
  }
  const [superuser, migrationPassword, runtimePassword] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const name = `mfk-p21c-${crypto.randomBytes(6).toString("hex")}`;
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
  const connectionString = `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(runtimePassword)}@${host}:${port}/${DATABASE}`;
  return { asSuperuser: (fn) => withPg(host, port, "postgres", superuser, DATABASE, fn), connectionString };
}

/** Whole-database counts over the three business write tables — no tenant filter, nothing can hide. */
const businessRowCounts = (asSuperuser) => asSuperuser(async (client) => Object.fromEntries(await Promise.all(
  WRITE_TABLES.map(async (table) => [table, (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count]))));
const eachTable = (rows) => Object.fromEntries(WRITE_TABLES.map((table) => [table, rows]));
const decisionRows = (asSuperuser) => asSuperuser(async (client) => (await client.query('SELECT "id", "tenant_id", "entry_hash", "prev_hash", "payload" FROM "policy_decision_log" ORDER BY "recorded_at"')).rows);
const auditedShape = (row) => ({ effect: row.payload.decision, matchedPolicyId: row.payload.matchedPolicyId, layerResolved: row.payload.layerResolved, traceId: row.payload.traceId });

test("P21C-1/P21C-2/P21C-3: the audited boundary logs a verified deny genesis, refuses to write when its decision cannot be logged, and releases both runtime pools on close", async (t) => {
  await requireContract("P21C-1");
  const createAuditedCustomerComposition = auditedFactory("P21C-1");
  const { asSuperuser, connectionString } = await bringUpSubstrate(t);
  const sequenced = sequencedIdsAndClock();
  const current = async () => PRINCIPAL;
  // P21C-1 — the explicit closed default deny: no statement at all, so no candidate applies.
  const denyRequestId = crypto.randomUUID();
  const denied = createAuditedCustomerComposition({
    connectionString, current, candidatesFor: async () => [], idGenerator: sequenced.idGenerator, now: sequenced.now,
    evaluateInvariants: async () => { throw new Error("P21C-1: a denied request must never reach the invariant stage"); },
  });
  assert.deepEqual(Reflect.ownKeys(denied).sort(), ["close", "handler"], "the audited composition hands back exactly { handler, close }");
  const denyResponse = await denied.handler.handle(requestOf(denyRequestId)).finally(() => denied.close());
  assert.deepEqual({ status: denyResponse.status, outcome: denyResponse.outcome, code: denyResponse.body.error.code }, { status: 403, outcome: "DENY", code: "POLICY_DENY" }, "P21C-1: the closed default must refuse on the policy deny path");
  const afterDeny = await decisionRows(asSuperuser);
  assert.equal(afterDeny.length, 1, "P21C-1: the default deny must log exactly one decision");
  const genesis = afterDeny[0];
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis), { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: TENANT, entryHash: genesis.entry_hash, prevHash: null }, "P21C-1: the genesis row must verify independently, recomputed from its own persisted payload");
  assert.deepEqual(auditedShape(genesis), { effect: "deny", matchedPolicyId: null, layerResolved: null, traceId: denyRequestId }, "P21C-1: a default-deny genesis matches no policy, resolves no layer, and traces the boundary request id");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21C-1: a denied request writes no business row");
  // P21C-2 — with an applicable ALLOW candidate, take away only the decision log's INSERT grant.
  const allowOptions = (evaluateInvariants) => ({ connectionString, current, candidatesFor: async () => [allowCandidate()], idGenerator: sequenced.idGenerator, now: sequenced.now, evaluateInvariants });
  await asSuperuser((client) => client.query(`REVOKE INSERT ON TABLE policy_decision_log FROM ${RUNTIME_ROLE}`));
  const blocked = createAuditedCustomerComposition(allowOptions(async () => { throw new Error("P21C-2: an unlogged decision must never reach the invariant stage"); }));
  await assert.rejects(async () => blocked.handler.handle(requestOf(crypto.randomUUID())), "P21C-2: a decision that cannot be logged must reject, never commit unaudited").finally(() => blocked.close());
  assert.equal((await decisionRows(asSuperuser)).length, 1, "P21C-2: the blocked attempt must leave no decision row");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21C-2: the blocked attempt must write no business row");
  await asSuperuser((client) => client.query(`GRANT INSERT ON TABLE policy_decision_log TO ${RUNTIME_ROLE}`));
  const requestId = crypto.randomUUID();
  const allowed = createAuditedCustomerComposition(allowOptions(async () => ({ ok: true })));
  const committed = await allowed.handler.handle(requestOf(requestId));
  assert.deepEqual({ status: committed.status, outcome: committed.outcome, receiptRequestId: committed.body.commitReceipt.requestId, receiptOutcome: committed.body.commitReceipt.outcome }, { status: 201, outcome: "COMMITTED", receiptRequestId: requestId, receiptOutcome: "COMMITTED" }, "P21C-2: with the grant restored the same flow returns the normal success CommitReceipt");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(1), "P21C-2: the restored allow writes exactly one row per business table");
  const chain = await decisionRows(asSuperuser);
  assert.equal(chain.length, 2, "P21C-2: the allow decision is the deny genesis's single successor");
  const successor = chain[1];
  verifyPersistedDecisionLogRow(successor);
  assert.equal(successor.prev_hash, genesis.entry_hash, "P21C-2: the allow decision must chain to the P21C-1 genesis");
  assert.deepEqual(auditedShape(successor), { effect: "allow", matchedPolicyId: "policy.allow-customer-create", layerResolved: "tenant", traceId: requestId }, "P21C-2: the successor must record the matched allow policy, its layer and the boundary request id");
  // P21C-3 — close releases both mfk_runtime pools: the decision log's and the unit of work's.
  const runtimeBackends = () => asSuperuser(async (client) =>
    (await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = $1 AND datname = $2", [RUNTIME_ROLE, DATABASE])).rows[0].count);
  assert.ok(await runtimeBackends() >= 2, "P21C-3: this composition logged and committed, so both runtime pools hold a live backend");
  await allowed.close();
  let remaining = await runtimeBackends();
  for (let attempt = 0; attempt < 60 && remaining > 0; attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    remaining = await runtimeBackends();
  }
  assert.equal(remaining, 0, "P21C-3: close must release every mfk_runtime backend both pools opened");
});

test("P21C-3: the pipeline admits exactly the two genuine decision points, and the audited factory admits exactly its six data options", async () => {
  await requireContract("P21C-3");
  const createAuditedCustomerComposition = auditedFactory("P21C-3");
  const identity = new Identity({ current: async () => PRINCIPAL });
  const evaluateInvariants = async () => ({ ok: true });
  const sequenced = sequencedIdsAndClock();
  const loggingOptions = () => ({ candidatesFor: async () => [], decisionLog: new DecisionLogPort({ append: async () => {} }),
    idGenerator: sequenced.idGenerator, clock: new Clock({ now: sequenced.now }), chainHead: async () => null });
  class SubPoint extends PolicyDecisionPoint {}
  class SubLoggingPoint extends DecisionLoggingPolicyDecisionPoint {}
  for (const admitted of [new PolicyDecisionPoint({ candidatesFor: async () => [] }), new DecisionLoggingPolicyDecisionPoint(loggingOptions())]) {
    assert.ok(new CreateCustomerPipeline({ identity, policyDecisionPoint: admitted, evaluateInvariants }), `${PIPELINE_PATH} must admit an exact genuine ${admitted[Symbol.toStringTag]}`);
  }
  for (const refused of [
    new SubPoint({ candidatesFor: async () => [] }), new SubLoggingPoint(loggingOptions()),
    Object.create(DecisionLoggingPolicyDecisionPoint.prototype),
    Object.freeze({ decide: async () => ({ effect: "allow" }), decideAll: async () => [] }), {}, null, undefined,
  ]) {
    assert.throws(() => new CreateCustomerPipeline({ identity, policyDecisionPoint: refused, evaluateInvariants }), TypeError, "a subclass, hollow impostor, plain facade or ordinary object is never a decision point");
  }
  const valid = { connectionString: "postgres://user:pass@localhost:5432/never_connected", current: async () => PRINCIPAL,
    candidatesFor: async () => [], evaluateInvariants, idGenerator: sequenced.idGenerator, now: sequenced.now };
  for (const bad of [
    undefined, null, "connectionString", {}, [], { ...valid, extra: 1 },
    (() => { const { candidatesFor, ...rest } = valid; return rest; })(),
    (() => { const { now, ...rest } = valid; return rest; })(),
    { ...valid, connectionString: "" }, { ...valid, connectionString: 1 }, { ...valid, current: "not a function" },
    { ...valid, candidatesFor: "not a function" }, { ...valid, candidatesFor: null },
    { ...valid, idGenerator: null }, { ...valid, now: null }, { ...valid, evaluateInvariants: null },
    Object.defineProperty({ ...valid }, "connectionString", { get: () => "accessor", enumerable: true, configurable: true }),
  ]) {
    assert.throws(() => createAuditedCustomerComposition(bad), TypeError, `createAuditedCustomerComposition must refuse ${JSON.stringify(bad)} synchronously, before any I/O`);
  }
});

test("P21C planning manifest binds this package, this base, this frozen test and its four allowed files", async () => {
  const contract = await requireContract("P21C-bind");
  assert.equal(contract.package, "P21C-boundary-decision-audit");
  assert.equal(contract.base, "f11669da4d6fe6deec6a89e4e2c696df6722ab17");
  assert.equal(contract.baseTree, "12fdf61bdd4800ee56d15ff7b9f5f44fa81a361f");
  assert.equal(contract.provenance.scopeSynthesisSha256, "6aa154ef368bf3f65706b07fff31f30e6a8223c042220b19b9f52be658d2139d");
  assert.equal(contract.frozenTestPath, FROZEN_TEST_PATH);
  assert.equal(contract.frozenTestSha256, crypto.createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex"), "frozenTestSha256 must be the content hash of this exact test file");
  assert.deepEqual([...contract.allowedFiles].sort(), [MANIFEST_PATH, FROZEN_TEST_PATH, COMPOSITION_PATH, PIPELINE_PATH].sort(), "P21C may touch only its manifest, this frozen test and its two named source files");
  for (const flag of ["kernelReady", "releaseAllowed", "productionAllowed", "runnableProduct", "p21Complete"]) {
    assert.equal(contract.readinessFlags[flag], false, `readinessFlags.${flag} must stay false`);
  }
  const nonGoals = contract.nonGoals.join(" | ").toLowerCase();
  for (const required of [/no hosted/, /no release, deploy/, /no new dependency/, /no schema, migration/]) {
    assert.match(nonGoals, required, `nonGoals must state: ${required}`);
  }
});
