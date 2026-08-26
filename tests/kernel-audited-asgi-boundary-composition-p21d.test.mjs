import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

// P21D — audited ASGI boundary composition. P21C made the boundary's authorization decision durably
// auditable, but only at the handler seam: createCustomerAsgiComposition.app still wires the legacy
// unaudited factory, so every request that actually arrives through the ASGI callable reaches the
// pipeline with an unrecorded decision. This frozen test owns every fixed expectation for an
// additive createAuditedCustomerAsgiComposition whose `app` carries the audit all the way to the
// protocol boundary; the manifest gates the run and never supplies an expected value back to an
// assertion, and the legacy factory's behaviour is asserted unchanged.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-audited-asgi-boundary-composition-p21d.json";
const FROZEN_TEST_PATH = "tests/kernel-audited-asgi-boundary-composition-p21d.test.mjs";
const ASGI_PATH = "src/delivery/create-customer-asgi-composition.mjs";
const SCENARIO_IDS = Object.freeze(["P21D-1", "P21D-2", "P21D-3", "P21D-4", "P21D-5"]);
const WRITE_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);

// Resolved dynamically, and consulted FIRST in every scenario: a checkout without the additive
// audited ASGI factory is deterministically RED on exactly that absence, ahead of any manifest read
// or container start, and no production module is mutated to make collection succeed.
const loaded = await import(pathToFileURL(path.join(root, ASGI_PATH)).href).catch((error) => error);
function asgiModule(scenario) {
  assert.ok(!(loaded instanceof Error), `[${scenario}] ${ASGI_PATH} must exist and import cleanly: ${loaded?.message}`);
  assert.equal(typeof loaded.createAuditedCustomerAsgiComposition, "function", `[${scenario}] ${ASGI_PATH} must additively export createAuditedCustomerAsgiComposition`);
  assert.equal(typeof loaded.createCustomerAsgiComposition, "function", `[${scenario}] ${ASGI_PATH} must keep exporting the legacy createCustomerAsgiComposition unchanged`);
  return loaded;
}

/** Load-bearing contract read: no P21D scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const text = await readFile(path.join(root, MANIFEST_PATH), "utf8")
    .catch((error) => assert.fail(`[${scenario}] ${MANIFEST_PATH} must exist before the P21D scenarios may run: ${error.message}`));
  const contract = JSON.parse(text);
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the five P21D scenario ids, in order`);
  return contract;
}

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** One shared deterministic ULID/instant source, so every logged entry stays unique and ordered. */
function sequencedIdsAndClock() {
  let seq = 0;
  return {
    idGenerator: async () => `01ARZ3NDEKTSV4RRFFQ69G5FA${ULID_CHARS[seq++ % ULID_CHARS.length]}`,
    now: async () => `2026-08-26T11:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  };
}
const ALLOW_CANDIDATE = Object.freeze({ policyId: "policy.allow-customer-create", effect: "allow", applies: true, priority: 100, layer: "tenant" });
const principalOf = (tenant, actor) => new Principal(new TenantId(tenant), new ActorId(actor));

/** The one POST /customers ASGI scope shape this test sends — deny, allow and unloggable alike. */
const scopeOf = (tenant, actor, request) => ({
  type: "http", method: "POST", path: "/customers",
  headers: [["content-type", "application/json"], ["x-request-id", request], ["x-actor-id", actor], ["x-tenant-id", tenant], ["idempotency-key", `idem-${request}`]],
});
const BODY_BYTES = new TextEncoder().encode(JSON.stringify({ name: "Ada Lovelace" }));
function receiveOnce(body) {
  let called = false;
  return async () => {
    if (called) throw new Error("receive must be called once for a single-chunk body");
    called = true;
    return { type: "http.request", body, more_body: false };
  };
}
function collectingSend() {
  const events = [];
  return { events, send: async (event) => { events.push(event); } };
}
const decodedBody = (event) => JSON.parse(new TextDecoder().decode(event.body));
const invariantsMustNotRun = (scenario) => async () => { throw new Error(`${scenario}: this request must never reach the invariant stage`); };

const IMAGE = "postgres:16-alpine";
const [MIGRATION_ROLE, RUNTIME_ROLE, DATABASE] = ["mfk_migration", "mfk_runtime", "mfk_p21d_audited_asgi"];
const ROLE_FLAGS = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";
async function withPg(host, port, user, password, database, fn) {
  const client = new pg.Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

/** One compact migrated real PostgreSQL 16 lifecycle, shared by P21D-1, P21D-2 and P21D-3. */
async function bringUpSubstrate(t) {
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status !== 0) {
    throw new Error("docker is not available in this environment: this is an environment failure, not an audited ASGI boundary capability gap, and must be reported separately");
  }
  const [superuser, migrationPassword, runtimePassword] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const name = `mfk-p21d-${crypto.randomBytes(6).toString("hex")}`;
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

test("P21D-1/P21D-2/P21D-3: the audited ASGI callable logs a verified deny genesis, chains its allow commit onto it, and cannot answer 2xx when the decision cannot be logged", async (t) => {
  const { createAuditedCustomerAsgiComposition } = asgiModule("P21D-1");
  await requireContract("P21D-1");
  const { asSuperuser, connectionString } = await bringUpSubstrate(t);
  const sequenced = sequencedIdsAndClock();
  const tenantId = crypto.randomUUID();
  const actorId = "actor-p21d";
  const auditedOptions = (candidates, evaluateInvariants) => ({
    connectionString, current: async () => principalOf(tenantId, actorId), candidatesFor: async () => [...candidates],
    evaluateInvariants, idGenerator: sequenced.idGenerator, now: sequenced.now,
  });

  // P21D-1 — the explicit closed default deny, driven through app(scope, receive, send): no
  // candidate applies, so the decision is a deny and must still be audited before anything else.
  const denyRequestId = crypto.randomUUID();
  const denied = createAuditedCustomerAsgiComposition(auditedOptions([], invariantsMustNotRun("P21D-1")));
  const denyCollector = collectingSend();
  try {
    const result = await denied.app(scopeOf(tenantId, actorId, denyRequestId), receiveOnce(BODY_BYTES), denyCollector.send);
    assert.deepEqual(result, denyCollector.events, "P21D-1: app must return exactly the ASGI events it sent");
  } finally { await denied.close(); }
  assert.equal(denyCollector.events.length, 2, "P21D-1: a denied request must answer exactly two ASGI events");
  assert.equal(denyCollector.events[0].type, "http.response.start");
  assert.equal(denyCollector.events[0].status, 403, "P21D-1: a non-allow decision must be refused at the protocol boundary");
  const denyBody = decodedBody(denyCollector.events[1]);
  assert.deepEqual({ code: denyBody.error.code, requestId: denyBody.error.requestId, retryable: denyBody.error.retryable, receipt: denyBody.commitReceipt },
    { code: "POLICY_DENY", requestId: denyRequestId, retryable: false, receipt: undefined }, "P21D-1: the fixed policy-deny response carries the boundary request id, is not retryable and carries no receipt");
  const afterDeny = await decisionRows(asSuperuser);
  assert.equal(afterDeny.length, 1, "P21D-1: the default deny reached through ASGI must log exactly one decision");
  const genesis = afterDeny[0];
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis), { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId, entryHash: genesis.entry_hash, prevHash: null },
    "P21D-1: the genesis row must verify independently, recomputed from its own persisted payload");
  assert.deepEqual(auditedShape(genesis), { effect: "deny", matchedPolicyId: null, layerResolved: null, traceId: denyRequestId },
    "P21D-1: a default-deny genesis matches no policy, resolves no layer, and traces the HTTP request id");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21D-1: a denied ASGI request writes no business row anywhere in the database");

  // P21D-2 — one applicable ALLOW through the same callable: the normal 201 CommitReceipt, exactly
  // one business row per table, and a verified successor chained onto the P21D-1 genesis.
  const allowRequestId = crypto.randomUUID();
  const allowed = createAuditedCustomerAsgiComposition(auditedOptions([ALLOW_CANDIDATE], async () => ({ ok: true })));
  const allowCollector = collectingSend();
  try {
    await allowed.app(scopeOf(tenantId, actorId, allowRequestId), receiveOnce(BODY_BYTES), allowCollector.send);
  } finally { await allowed.close(); }
  assert.equal(allowCollector.events.length, 2);
  assert.equal(allowCollector.events[0].status, 201, "P21D-2: an audited ALLOW must still commit through the ASGI callable");
  const receipt = decodedBody(allowCollector.events[1]).commitReceipt;
  assert.deepEqual(Object.keys(receipt).sort(), ["auditId", "committedAt", "idempotencyKey", "outboxEventIds", "outcome", "requestId", "resourceId", "tenantId"].sort(),
    "P21D-2: the committed body's commitReceipt must carry exactly the canonical eight CommitReceipt keys");
  assert.deepEqual({ requestId: receipt.requestId, tenantId: receipt.tenantId, idempotencyKey: receipt.idempotencyKey, outcome: receipt.outcome, outboxCount: receipt.outboxEventIds.length },
    { requestId: allowRequestId, tenantId, idempotencyKey: `idem-${allowRequestId}`, outcome: "COMMITTED", outboxCount: 1 }, "P21D-2: the receipt is bound to this exact HTTP request");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(1), "P21D-2: the audited ALLOW writes exactly one row per business table, and only it");
  const afterAllow = await decisionRows(asSuperuser);
  assert.equal(afterAllow.length, 2, "P21D-2: the allow decision is the deny genesis's single successor");
  const successor = afterAllow[1];
  verifyPersistedDecisionLogRow(successor);
  assert.equal(successor.prev_hash, genesis.entry_hash, "P21D-2: the allow decision must chain to the P21D-1 genesis");
  assert.deepEqual(auditedShape(successor), { effect: "allow", matchedPolicyId: "policy.allow-customer-create", layerResolved: "tenant", traceId: allowRequestId },
    "P21D-2: the successor records the matched allow policy, its layer and the HTTP request id");

  // P21D-3 — take away only the decision log's INSERT grant and send the same shaped ASGI request
  // (a fresh request id, so nothing here can be mistaken for the idempotency-conflict path). The
  // adapter propagates the refusal out of app rather than inventing an error response, so this
  // asserts what is contractually true either way: no 2xx may be produced, and nothing may persist.
  await asSuperuser((client) => client.query(`REVOKE INSERT ON TABLE policy_decision_log FROM ${RUNTIME_ROLE}`));
  const blocked = createAuditedCustomerAsgiComposition(auditedOptions([ALLOW_CANDIDATE], invariantsMustNotRun("P21D-3")));
  const blockedCollector = collectingSend();
  let propagated;
  try {
    propagated = await blocked.app(scopeOf(tenantId, actorId, crypto.randomUUID()), receiveOnce(BODY_BYTES), blockedCollector.send).then(() => null, (error) => error);
  } finally { await blocked.close(); }
  const blockedStatuses = blockedCollector.events.filter((event) => event.type === "http.response.start").map((event) => event.status);
  assert.ok(propagated !== null || blockedStatuses.length > 0, "P21D-3: an unloggable decision must either propagate out of app or answer the boundary — never pass silently");
  assert.deepEqual(blockedStatuses.filter((status) => status >= 200 && status < 300), [], "P21D-3: an unloggable decision must never produce a 2xx at the ASGI boundary");
  assert.equal((await decisionRows(asSuperuser)).length, 2, "P21D-3: the blocked attempt must leave no decision row");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(1), "P21D-3: the blocked attempt must write no business row");

  // P21D-3 recovery — restore the grant and prove the flow itself still works, so the two proofs
  // above are load-bearing rather than a harness that had simply stopped being able to write.
  await asSuperuser((client) => client.query(`GRANT INSERT ON TABLE policy_decision_log TO ${RUNTIME_ROLE}`));
  const recoveredRequestId = crypto.randomUUID();
  const recovered = createAuditedCustomerAsgiComposition(auditedOptions([ALLOW_CANDIDATE], async () => ({ ok: true })));
  const recoveredCollector = collectingSend();
  // Counted while the composition is still open: one audited ASGI request drives BOTH mfk_runtime
  // pools — the decision log's and the unit of work's — so both must hold a live backend right here.
  const runtimeBackends = () => asSuperuser(async (client) =>
    (await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = $1 AND datname = $2", [RUNTIME_ROLE, DATABASE])).rows[0].count);
  let backendsBeforeClose = 0;
  try {
    await recovered.app(scopeOf(tenantId, actorId, recoveredRequestId), receiveOnce(BODY_BYTES), recoveredCollector.send);
    backendsBeforeClose = await runtimeBackends();
  } finally { await recovered.close(); }
  assert.equal(recoveredCollector.events[0].status, 201, "P21D-3: with the grant restored the same ASGI flow must commit again");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(2), "P21D-3: recovery adds exactly one further row per business table");
  const afterRecovery = await decisionRows(asSuperuser);
  assert.equal(afterRecovery.length, 3, "P21D-3: recovery appends exactly one further decision row");
  verifyPersistedDecisionLogRow(afterRecovery[2]);
  assert.equal(afterRecovery[2].prev_hash, successor.entry_hash, "P21D-3: the recovered decision chains onto the P21D-2 successor, so the revoked window left no gap in the chain");
  assert.equal(afterRecovery[2].payload.traceId, recoveredRequestId, "P21D-3: the recovered decision traces its own HTTP request id");
  // Pool composition, proven against the server rather than assumed from the wiring: two live
  // mfk_runtime backends before close, and none left afterwards from any composition this test built.
  assert.ok(backendsBeforeClose >= 2, "P21D-1/2/3: an audited ASGI request that logged a decision and committed holds a live backend in both mfk_runtime pools");
  let remaining = await runtimeBackends();
  for (let attempt = 0; attempt < 60 && remaining > 0; attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    remaining = await runtimeBackends();
  }
  assert.equal(remaining, 0, "P21D-1/2/3: the composition's single close must release every mfk_runtime backend both pools opened");
});

test("P21D-4: the audited ASGI factory admits exactly its six data options plus the optional maxBodyBytes, hands back the frozen four-key composition, and leaves the legacy factory's contract untouched", async () => {
  const { createAuditedCustomerAsgiComposition, createCustomerAsgiComposition } = asgiModule("P21D-4");
  await requireContract("P21D-4");
  const sequenced = sequencedIdsAndClock();
  const valid = {
    connectionString: "postgres://user:pass@localhost:5432/never_connected", current: async () => principalOf("11111111-1111-4111-8111-111111111111", "actor-p21d-4"),
    candidatesFor: async () => [], evaluateInvariants: async () => ({ ok: true }), idGenerator: sequenced.idGenerator, now: sequenced.now,
  };
  for (const admitted of [{ ...valid }, { ...valid, maxBodyBytes: 0 }, { ...valid, maxBodyBytes: 4096 }]) {
    const composition = createAuditedCustomerAsgiComposition(admitted);
    try {
      assert.ok(Object.isFrozen(composition), "the audited ASGI composition must be frozen");
      assert.deepEqual(Reflect.ownKeys(composition).sort(), ["app", "asgi", "close", "router"], "the audited ASGI composition hands back exactly { asgi, router, app, close }");
      assert.ok(Object.isFrozen(composition.app), "the audited ASGI callable must itself be frozen");
      assert.equal(composition.app.length, 3, "the audited ASGI callable must take exactly (scope, receive, send)");
    } finally { await assert.doesNotReject(() => composition.close(), "closing a composition that never connected must not reject"); }
  }
  for (const bad of [
    undefined, null, "connectionString", {}, [], { ...valid, extra: 1 },
    (() => { const { candidatesFor, ...rest } = valid; return rest; })(),
    (() => { const { idGenerator, ...rest } = valid; return rest; })(),
    (() => { const { now, ...rest } = valid; return rest; })(),
    { ...valid, connectionString: "" }, { ...valid, connectionString: 1 }, { ...valid, current: "not a function" },
    { ...valid, candidatesFor: null }, { ...valid, evaluateInvariants: null }, { ...valid, idGenerator: null }, { ...valid, now: null },
    { ...valid, maxBodyBytes: -1 }, { ...valid, maxBodyBytes: 1.5 }, { ...valid, maxBodyBytes: "10" },
  ]) {
    assert.throws(() => createAuditedCustomerAsgiComposition(bad), TypeError, `createAuditedCustomerAsgiComposition must refuse ${JSON.stringify(bad)} synchronously, before any I/O`);
  }
  // Malformed shapes no plain value above can express. The guard must read own keys including
  // symbols, require every option to be an own ENUMERABLE DATA property, and reach its verdict from
  // property descriptors alone — never invoking a caller-supplied accessor, and still before any I/O.
  const symbolKeyed = { ...valid, [Symbol("extra")]: 1 };
  assert.throws(() => createAuditedCustomerAsgiComposition(symbolKeyed), TypeError, "P21D-4: an own symbol-keyed extra property is an unknown option and must be refused");
  let accessorReads = 0;
  const accessorBacked = { ...valid };
  Object.defineProperty(accessorBacked, "now", { enumerable: true, configurable: true, get() { accessorReads += 1; return sequenced.now; } });
  assert.throws(() => createAuditedCustomerAsgiComposition(accessorBacked), TypeError, "P21D-4: a required option backed by an accessor is not admissible option data and must be refused");
  assert.equal(accessorReads, 0, "P21D-4: the factory must decide from property descriptors alone, never invoking a caller-supplied getter");
  const nonEnumerable = { ...valid };
  Object.defineProperty(nonEnumerable, "candidatesFor", { enumerable: false, configurable: true, writable: true, value: valid.candidatesFor });
  assert.throws(() => createAuditedCustomerAsgiComposition(nonEnumerable), TypeError, "P21D-4: a non-enumerable required option does not satisfy that option and must be refused");
  // The legacy factory is additive-untouched: it still accepts exactly its own four required keys
  // and still refuses the two audit collaborators as unknown, so no existing caller changes shape.
  const { idGenerator, now, ...legacyValid } = valid;
  const legacy = createCustomerAsgiComposition(legacyValid);
  try { assert.deepEqual(Reflect.ownKeys(legacy).sort(), ["app", "asgi", "close", "router"], "the legacy ASGI composition keeps its exact four-key result"); }
  finally { await legacy.close(); }
  assert.throws(() => createCustomerAsgiComposition(valid), TypeError, "the legacy ASGI factory must still refuse idGenerator and now as unknown options");
  // The audited wiring stays framework-free and capability-free: this is still a composition root.
  const source = await readFile(path.join(root, ASGI_PATH), "utf8");
  for (const forbidden of [/from\s+["'](node:)?(fs|net|http|https)["']/i, /\bfetch\s*\(/, /process\.env/, /Date\.now|Math\.random/, /(fastapi|django|uvicorn|hypercorn|express|koa)/i]) {
    assert.doesNotMatch(source, forbidden, `${ASGI_PATH} must not take on ${forbidden}`);
  }
});

test("P21D-5: the planning manifest binds this package, this base, this frozen test and its three allowed files", async () => {
  asgiModule("P21D-5");
  const contract = await requireContract("P21D-5");
  assert.equal(contract.package, "P21D-audited-asgi-boundary-composition");
  assert.equal(contract.base, "da8ed64ac8765d6e77f9abbc762097f671c34564");
  assert.equal(contract.baseTree, "0425f6826bb3c36e29665f50b976fd140ab715df");
  assert.equal(contract.provenance.scopeSynthesisSha256, "4662e343f895f058ba96824b9cfd8bd47962ff5dd20949db2833fa94a7068038");
  assert.equal(contract.provenance.singleWriter, true);
  assert.equal(contract.provenance.reviewerMustBeSeparateSession, true);
  assert.equal(contract.frozenTestPath, FROZEN_TEST_PATH);
  assert.equal(contract.frozenTestSha256, crypto.createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex"), "frozenTestSha256 must be the content hash of this exact test file");
  assert.deepEqual([...contract.allowedFiles].sort(), [MANIFEST_PATH, FROZEN_TEST_PATH, ASGI_PATH].sort(), "P21D may touch only its manifest, this frozen test and the one ASGI composition module");
  assert.deepEqual([...contract.writeTables], [...WRITE_TABLES]);
  assert.match(contract.capabilityDelta, /^AUDITED_BOUNDARY_REACHES_THE_ASGI_CALLABLE:/);
  for (const scenario of contract.acceptanceScenarios) {
    for (const key of ["name", "given", "then"]) {
      assert.ok(typeof scenario[key] === "string" && scenario[key].length > 0, `${scenario.id} needs a ${key}`);
    }
  }
  for (const flag of ["kernelReady", "releaseAllowed", "productionAllowed", "runnableProduct", "p21Complete"]) {
    assert.equal(contract.readinessFlags[flag], false, `readinessFlags.${flag} must stay false`);
  }
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(typeof contract.userJourney[key] === "string" && contract.userJourney[key].length > 0, `userJourney.${key} must be a non-empty string`);
  }
  const nonGoals = contract.nonGoals.join(" | ").toLowerCase();
  for (const required of [/no hosted/, /no release, deploy/, /no new dependency/, /no schema, migration/, /no change to createcustomerasgicomposition/]) {
    assert.match(nonGoals, required, `nonGoals must state: ${required}`);
  }
});
