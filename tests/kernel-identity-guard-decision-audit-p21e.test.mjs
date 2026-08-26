import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { createCustomerComposition, createAuditedCustomerComposition } from "../src/delivery/create-customer-composition.mjs";
import { createAuditedCustomerAsgiComposition } from "../src/delivery/create-customer-asgi-composition.mjs";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";
import { ActorId, CorrelationId, IdempotencyKey, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

// P21E — identity-guard decision audit. P21C/P21D made the boundary's *policy* decision durably
// auditable, but the pipeline's identityTenantGuard short-circuits before the policy decision point
// is ever consulted: a request claiming a foreign tenant or a foreign actor is refused with nothing
// written anywhere, so the one class of request most worth having a record of — an attempted
// cross-tenant reach — is exactly the class that leaves no record. This frozen test owns every fixed
// expectation for an additive, optional, strictly validated `auditIdentityGuard` collaborator on
// CreateCustomerPipeline, injected only by createAuditedCustomerComposition; the manifest gates the
// run and never supplies an expected value back to an assertion, and the collaborator-free pipeline
// and the legacy unaudited composition are asserted unchanged.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-identity-guard-decision-audit-p21e.json";
const FROZEN_TEST_PATH = "tests/kernel-identity-guard-decision-audit-p21e.test.mjs";
const PIPELINE_PATH = "src/application/create-customer-pipeline.mjs";
const COMPOSITION_PATH = "src/delivery/create-customer-composition.mjs";
const SCENARIO_IDS = Object.freeze(["P21E-1", "P21E-2", "P21E-3", "P21E-4", "P21E-5"]);
const WRITE_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const DECISION_TABLE = "policy_decision_log";

// The two identities this whole file turns on. AUTHENTICATED is what `current()` answers — the only
// identity any audit row may ever be filed under. FOREIGN_* are attacker-claimed ActionSpec fields:
// well-formed, so they reach the guard rather than the shape check, and never true of the caller.
const AUTH_TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const AUTH_ACTOR = "actor-p21e-authenticated";
const FOREIGN_TENANT = "9c858901-8a57-4791-81fe-4c455b099bc9";
const FOREIGN_ACTOR = "actor-p21e-attacker";
const AUTHENTICATED = new Principal(new TenantId(AUTH_TENANT), new ActorId(AUTH_ACTOR));
const FOREIGN_VALUES = Object.freeze([FOREIGN_TENANT, FOREIGN_ACTOR]);

const GUARD_OPTION = "auditIdentityGuard";
const GUARD_ARGUMENT_KEYS = Object.freeze(["code", "principal", "correlationId", "idempotencyKey"]);
const identityAnswering = (principal) => new Identity({ current: async () => principal });
const pointOver = (candidatesFor) => new PolicyDecisionPoint({ candidatesFor });
const alwaysValid = async () => ({ ok: true });

/**
 * Consulted FIRST in every scenario, and deliberately pure: a checkout whose pipeline does not yet
 * admit the optional identity-guard auditor is deterministically RED on exactly that absence —
 * before any manifest read, any container start and any I/O at all — so the missing seam can never
 * be confused with a missing manifest or a missing Docker daemon.
 */
function requireGuardAuditSeam(scenario) {
  try {
    const pipeline = new CreateCustomerPipeline({
      identity: identityAnswering(AUTHENTICATED),
      policyDecisionPoint: pointOver(async () => []),
      evaluateInvariants: alwaysValid,
      [GUARD_OPTION]: async () => {},
    });
    assert.ok(Object.isFrozen(pipeline), `[${scenario}] a pipeline built with ${GUARD_OPTION} must still be frozen`);
  } catch (error) {
    assert.fail(`[${scenario}] ${PIPELINE_PATH} must admit the optional ${GUARD_OPTION} collaborator alongside its three required options, so an identity-guard deny can be audited: ${error.message}`);
  }
}

/** Load-bearing contract read: no P21E scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const text = await readFile(path.join(root, MANIFEST_PATH), "utf8")
    .catch((error) => assert.fail(`[${scenario}] ${MANIFEST_PATH} must exist before the P21E scenarios may run: ${error.message}`));
  const contract = JSON.parse(text);
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the five P21E scenario ids, in order`);
  return contract;
}

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** One shared deterministic ULID/instant source, so every logged entry stays unique and ordered. */
function sequencedIdsAndClock() {
  let seq = 0;
  return {
    idGenerator: async () => `01ARZ3NDEKTSV4RRFFQ69G5FA${ULID_CHARS[seq++ % ULID_CHARS.length]}`,
    now: async () => `2026-08-27T12:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  };
}
const ALLOW_CANDIDATE = Object.freeze({ policyId: "policy.allow-customer-create", effect: "allow", applies: true, priority: 100, layer: "tenant" });
const PAYLOAD = Object.freeze({ name: "Ada Lovelace" });
/** One delivery request, claiming whatever identity the caller names — truthfully or not. */
const requestOf = (requestId, tenantId = AUTH_TENANT, actorId = AUTH_ACTOR) =>
  ({ requestId, actorId, tenantId, payload: { ...PAYLOAD }, idempotencyKey: `idem-${requestId}` });
const actionSpecOf = requestOf;
const mustNotRun = (what, scenario) => async () => { throw new Error(`${scenario}: ${what} must never be reached on an identity-guard deny`); };

const IMAGE = "postgres:16-alpine";
const [MIGRATION_ROLE, RUNTIME_ROLE, DATABASE] = ["mfk_migration", "mfk_runtime", "mfk_p21e_identity_guard"];
const ROLE_FLAGS = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";
async function withPg(host, port, user, password, database, fn) {
  const client = new pg.Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

/** One compact migrated real PostgreSQL 16 lifecycle, shared by P21E-1 through P21E-4. */
async function bringUpSubstrate(t) {
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status !== 0) {
    throw new Error("docker is not available in this environment: this is an environment failure, not an identity-guard audit capability gap, and must be reported separately");
  }
  const [superuser, migrationPassword, runtimePassword] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const name = `mfk-p21e-${crypto.randomBytes(6).toString("hex")}`;
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
const decisionRows = (asSuperuser) => asSuperuser(async (client) => (await client.query(`SELECT "id", "tenant_id", "entry_hash", "prev_hash", "payload" FROM "${DECISION_TABLE}" ORDER BY "recorded_at"`)).rows);
const auditedShape = (row) => ({ effect: row.payload.decision, matchedPolicyId: row.payload.matchedPolicyId, layerResolved: row.payload.layerResolved, traceId: row.payload.traceId });

/**
 * The non-leak sweep, run against the server rather than against a value this test happens to hold.
 * Every column of every row of all four tables is projected to text through `to_jsonb`, so an
 * attacker-claimed tenant or actor cannot survive anywhere — not in a payload, a reason, a resource,
 * a context or a column this test never thought to read.
 */
const rowsMentioning = (asSuperuser, needle) => asSuperuser(async (client) => Object.fromEntries(await Promise.all(
  [DECISION_TABLE, ...WRITE_TABLES].map(async (table) => [table,
    (await client.query(`SELECT count(*)::int AS count FROM "${table}" t WHERE to_jsonb(t)::text LIKE $1`, [`%${needle}%`])).rows[0].count]))));
const noTableMentions = () => Object.fromEntries([DECISION_TABLE, ...WRITE_TABLES].map((table) => [table, 0]));

/** The one POST /customers ASGI scope shape this test sends, claiming whatever identity it is given. */
const scopeOf = (request, tenantId, actorId) => ({
  type: "http", method: "POST", path: "/customers",
  headers: [["content-type", "application/json"], ["x-request-id", request], ["x-actor-id", actorId], ["x-tenant-id", tenantId], ["idempotency-key", `idem-${request}`]],
});
const BODY_BYTES = new TextEncoder().encode(JSON.stringify(PAYLOAD));
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

test("P21E-1/P21E-2/P21E-3/P21E-4: against one real PostgreSQL 16 substrate the audited boundary records every identity-guard deny under the authenticated identity, fails closed when it cannot, and leaves the unaudited composition writing nothing", async (t) => {
  requireGuardAuditSeam("P21E-1/P21E-2/P21E-3/P21E-4");
  await requireContract("P21E-1");
  const { asSuperuser, connectionString } = await bringUpSubstrate(t);
  const sequenced = sequencedIdsAndClock();
  const auditedOptions = (candidatesFor, evaluateInvariants) => ({
    connectionString, current: async () => AUTHENTICATED, candidatesFor, evaluateInvariants,
    idGenerator: sequenced.idGenerator, now: sequenced.now,
  });

  // P21E-1 — the cross-tenant reach: a well-formed ActionSpec claiming a tenant the authenticated
  // principal does not hold. It is refused at the identity guard, so neither the policy decision
  // point nor the invariant stage may be consulted — and precisely because no policy decision is
  // ever taken, the guard's own refusal is what has to reach the log, as this chain's genesis.
  let candidateCalls = 0;
  const crossTenantRequestId = crypto.randomUUID();
  const crossTenant = createAuditedCustomerComposition(auditedOptions(
    async () => { candidateCalls += 1; return []; }, mustNotRun("the invariant stage", "P21E-1")));
  const crossTenantResponse = await crossTenant.handler
    .handle(requestOf(crossTenantRequestId, FOREIGN_TENANT, AUTH_ACTOR)).finally(() => crossTenant.close());
  assert.deepEqual({ status: crossTenantResponse.status, outcome: crossTenantResponse.outcome, code: crossTenantResponse.body.error.code, retryable: crossTenantResponse.body.error.retryable, requestId: crossTenantResponse.requestId },
    { status: 403, outcome: "CROSS_TENANT_DENY", code: "CROSS_TENANT_DENY", retryable: false, requestId: crossTenantRequestId },
    "P21E-1: a cross-tenant claim is refused at the guard with the existing outcome, code and retryability, unchanged by being audited");
  assert.equal(candidateCalls, 0, "P21E-1: an identity-guard deny must never reach the policy decision point's candidate evaluation");
  const afterCrossTenant = await decisionRows(asSuperuser);
  assert.equal(afterCrossTenant.length, 1, "P21E-1: the cross-tenant deny must log exactly one decision — the class of request most worth a record is no longer the one that leaves none");
  const genesis = afterCrossTenant[0];
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis), { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: AUTH_TENANT, entryHash: genesis.entry_hash, prevHash: null },
    "P21E-1: the guard genesis row must verify independently, recomputed from its own persisted payload, and be filed under the AUTHENTICATED tenant");
  assert.deepEqual(genesis.payload.requestActor, { tenantId: AUTH_TENANT, actorId: AUTH_ACTOR },
    "P21E-1: the audit records who was actually authenticated, never the identity the request claimed");
  assert.deepEqual(auditedShape(genesis), { effect: "deny", matchedPolicyId: null, layerResolved: null, traceId: crossTenantRequestId },
    "P21E-1: a guard deny matches no policy and resolves no layer, and traces the boundary request id");
  assert.equal(genesis.payload.requestAction, "customer.create", "P21E-1: the audited action is the one the boundary was asked for");
  assert.ok(typeof genesis.payload.reason === "string" && genesis.payload.reason.trim().length > 0, "P21E-1: the guard deny must carry a non-empty reason");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21E-1: a cross-tenant claim writes no business row anywhere in the database");
  for (const foreign of FOREIGN_VALUES) {
    assert.deepEqual(await rowsMentioning(asSuperuser, foreign), noTableMentions(),
      `P21E-1: no persisted row anywhere may carry the attacker-claimed value ${foreign} — not in a payload, a reason, a resource or a context`);
  }

  // P21E-2 — the actor reach inside the right tenant, and then both claims wrong at once. The
  // second proves the guard's fixed precedence is preserved in the audit as well as in the outcome:
  // a tenant mismatch decides first, so a double mismatch is recorded as the cross-tenant refusal.
  const actorRequestId = crypto.randomUUID();
  const actorMismatch = createAuditedCustomerComposition(auditedOptions(
    mustNotRun("candidate resolution", "P21E-2"), mustNotRun("the invariant stage", "P21E-2")));
  const actorResponse = await actorMismatch.handler
    .handle(requestOf(actorRequestId, AUTH_TENANT, FOREIGN_ACTOR)).finally(() => actorMismatch.close());
  assert.deepEqual({ status: actorResponse.status, outcome: actorResponse.outcome, code: actorResponse.body.error.code },
    { status: 403, outcome: "DENY", code: "IDENTITY_MISMATCH" }, "P21E-2: an actor mismatch inside the authenticated tenant keeps its own existing outcome and code");
  const afterActor = await decisionRows(asSuperuser);
  assert.equal(afterActor.length, 2, "P21E-2: the actor-mismatch deny is the guard genesis's single successor");
  const actorRow = afterActor[1];
  verifyPersistedDecisionLogRow(actorRow);
  assert.equal(actorRow.prev_hash, genesis.entry_hash, "P21E-2: the actor-mismatch audit chains onto the P21E-1 cross-tenant genesis");
  assert.deepEqual(actorRow.payload.requestActor, { tenantId: AUTH_TENANT, actorId: AUTH_ACTOR }, "P21E-2: the audit still names the authenticated actor, never the claimed one");
  assert.deepEqual(auditedShape(actorRow), { effect: "deny", matchedPolicyId: null, layerResolved: null, traceId: actorRequestId }, "P21E-2: the actor-mismatch deny traces its own request id");
  assert.notEqual(actorRow.payload.reason, genesis.payload.reason, "P21E-2: the two guard refusals must be distinguishable in the log, not collapsed into one reason");

  const doubleRequestId = crypto.randomUUID();
  const doubleMismatch = createAuditedCustomerComposition(auditedOptions(
    mustNotRun("candidate resolution", "P21E-2"), mustNotRun("the invariant stage", "P21E-2")));
  const doubleResponse = await doubleMismatch.handler
    .handle(requestOf(doubleRequestId, FOREIGN_TENANT, FOREIGN_ACTOR)).finally(() => doubleMismatch.close());
  assert.deepEqual({ status: doubleResponse.status, outcome: doubleResponse.outcome, code: doubleResponse.body.error.code },
    { status: 403, outcome: "CROSS_TENANT_DENY", code: "CROSS_TENANT_DENY" }, "P21E-2: when both claims are wrong the tenant guard decides first, exactly as it did before");
  const afterDouble = await decisionRows(asSuperuser);
  assert.equal(afterDouble.length, 3, "P21E-2: the double mismatch appends exactly one further decision");
  const doubleRow = afterDouble[2];
  verifyPersistedDecisionLogRow(doubleRow);
  assert.equal(doubleRow.prev_hash, actorRow.entry_hash, "P21E-2: the double-mismatch audit chains onto the actor-mismatch row");
  assert.equal(doubleRow.payload.reason, genesis.payload.reason, "P21E-2: a double mismatch is recorded as the cross-tenant refusal, so the guard's precedence is visible in the log");
  assert.deepEqual(doubleRow.payload.requestActor, { tenantId: AUTH_TENANT, actorId: AUTH_ACTOR }, "P21E-2: neither wrong claim reaches the record");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21E-2: neither identity-guard deny writes a business row");

  // P21E-3 — take away only the decision log's INSERT grant and send the same cross-tenant claim.
  // A guard deny that cannot be recorded must fail closed: refusing the attacker with an unrecorded
  // 403 is exactly the silence this package exists to remove, so no deny envelope may come back.
  await asSuperuser((client) => client.query(`REVOKE INSERT ON TABLE ${DECISION_TABLE} FROM ${RUNTIME_ROLE}`));
  const unloggable = createAuditedCustomerComposition(auditedOptions(
    mustNotRun("candidate resolution", "P21E-3"), mustNotRun("the invariant stage", "P21E-3")));
  await assert.rejects(async () => unloggable.handler.handle(requestOf(crypto.randomUUID(), FOREIGN_TENANT, AUTH_ACTOR)),
    "P21E-3: an identity-guard deny that cannot be logged must reject, never answer an unrecorded refusal").finally(() => unloggable.close());
  assert.equal((await decisionRows(asSuperuser)).length, 3, "P21E-3: the blocked attempt must leave no decision row");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(0), "P21E-3: the blocked attempt must write no business row");

  // P21E-3 recovery — restore the grant and prove the guard audit still works, so the refusal above
  // is load-bearing rather than a harness that had simply stopped being able to write.
  await asSuperuser((client) => client.query(`GRANT INSERT ON TABLE ${DECISION_TABLE} TO ${RUNTIME_ROLE}`));
  const recoveredRequestId = crypto.randomUUID();
  const recovered = createAuditedCustomerComposition(auditedOptions(
    mustNotRun("candidate resolution", "P21E-3"), mustNotRun("the invariant stage", "P21E-3")));
  const recoveredResponse = await recovered.handler
    .handle(requestOf(recoveredRequestId, FOREIGN_TENANT, AUTH_ACTOR)).finally(() => recovered.close());
  assert.equal(recoveredResponse.outcome, "CROSS_TENANT_DENY", "P21E-3: with the grant restored the same cross-tenant claim is refused again");
  const afterRecovery = await decisionRows(asSuperuser);
  assert.equal(afterRecovery.length, 4, "P21E-3: recovery appends exactly one further decision row");
  verifyPersistedDecisionLogRow(afterRecovery[3]);
  assert.equal(afterRecovery[3].prev_hash, doubleRow.entry_hash, "P21E-3: the recovered guard audit chains onto the P21E-2 double-mismatch row, so the revoked window left no gap in the chain");
  assert.equal(afterRecovery[3].payload.traceId, recoveredRequestId, "P21E-3: the recovered guard audit traces its own request id");

  // P21E-3 positive control — one honest request, allowed. The identity guard passes, so the seam
  // must stay out of the way entirely: the ordinary policy decision is taken and logged as before,
  // the invariant stage runs, and the commit lands exactly as it did without the guard auditor.
  const allowRequestId = crypto.randomUUID();
  const allowed = createAuditedCustomerComposition(auditedOptions(async () => [ALLOW_CANDIDATE], alwaysValid));
  const allowResponse = await allowed.handler.handle(requestOf(allowRequestId)).finally(() => allowed.close());
  assert.deepEqual({ status: allowResponse.status, outcome: allowResponse.outcome, receiptRequestId: allowResponse.body.commitReceipt.requestId, receiptOutcome: allowResponse.body.commitReceipt.outcome },
    { status: 201, outcome: "COMMITTED", receiptRequestId: allowRequestId, receiptOutcome: "COMMITTED" },
    "P21E-3: a request whose identity is what it claims still commits and still returns the normal CommitReceipt");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(1), "P21E-3: the allowed request writes exactly one row per business table, and only it");
  const afterAllow = await decisionRows(asSuperuser);
  assert.equal(afterAllow.length, 5, "P21E-3: the allowed request appends its own policy decision to the same chain");
  verifyPersistedDecisionLogRow(afterAllow[4]);
  assert.equal(afterAllow[4].prev_hash, afterRecovery[3].entry_hash, "P21E-3: guard denials and policy decisions share one chain, in the order they happened");
  assert.deepEqual(auditedShape(afterAllow[4]), { effect: "allow", matchedPolicyId: "policy.allow-customer-create", layerResolved: "tenant", traceId: allowRequestId },
    "P21E-3: the allow decision still records its matched policy, its layer and the boundary request id");

  // P21E-4 — the same guard audit, reached through the protocol boundary: the ASGI callable takes
  // its claimed tenant straight off an attacker-controlled header, which is the shape this actually
  // arrives in. Nothing new is wired here; it must already follow from the audited composition.
  const asgiRequestId = crypto.randomUUID();
  const asgiComposition = createAuditedCustomerAsgiComposition(auditedOptions(
    mustNotRun("candidate resolution", "P21E-4"), mustNotRun("the invariant stage", "P21E-4")));
  const asgiCollector = collectingSend();
  try {
    await asgiComposition.app(scopeOf(asgiRequestId, FOREIGN_TENANT, AUTH_ACTOR), receiveOnce(BODY_BYTES), asgiCollector.send);
  } finally { await asgiComposition.close(); }
  assert.equal(asgiCollector.events.length, 2, "P21E-4: a refused ASGI request answers exactly two ASGI events");
  assert.equal(asgiCollector.events[0].status, 403, "P21E-4: the cross-tenant claim is refused at the protocol boundary");
  const asgiBody = decodedBody(asgiCollector.events[1]);
  assert.deepEqual({ code: asgiBody.error.code, requestId: asgiBody.error.requestId, receipt: asgiBody.commitReceipt },
    { code: "CROSS_TENANT_DENY", requestId: asgiRequestId, receipt: undefined }, "P21E-4: the ASGI refusal carries the boundary request id and no receipt");
  const afterAsgi = await decisionRows(asSuperuser);
  assert.equal(afterAsgi.length, 6, "P21E-4: a cross-tenant claim arriving through the ASGI callable is audited too");
  verifyPersistedDecisionLogRow(afterAsgi[5]);
  assert.equal(afterAsgi[5].prev_hash, afterAllow[4].entry_hash, "P21E-4: the ASGI guard audit chains onto the P21E-3 allow decision");
  assert.deepEqual(afterAsgi[5].payload.requestActor, { tenantId: AUTH_TENANT, actorId: AUTH_ACTOR }, "P21E-4: a header-claimed tenant never becomes the tenant a row is filed under");
  assert.equal(afterAsgi[5].payload.traceId, asgiRequestId, "P21E-4: the ASGI guard audit traces the HTTP request id taken from the boundary");

  // P21E-4 non-regression — the legacy, unaudited composition takes no guard auditor at all. Its
  // behaviour is unchanged and it still records nothing, which is exactly why the audited factory
  // and not the pipeline is where the collaborator is injected.
  const legacyRequestId = crypto.randomUUID();
  const legacy = createCustomerComposition({
    connectionString, current: async () => AUTHENTICATED,
    candidatesFor: mustNotRun("candidate resolution", "P21E-4"), evaluateInvariants: mustNotRun("the invariant stage", "P21E-4"),
  });
  const legacyResponse = await legacy.handler
    .handle(requestOf(legacyRequestId, FOREIGN_TENANT, AUTH_ACTOR)).finally(() => legacy.close());
  assert.deepEqual({ status: legacyResponse.status, outcome: legacyResponse.outcome, code: legacyResponse.body.error.code },
    { status: 403, outcome: "CROSS_TENANT_DENY", code: "CROSS_TENANT_DENY" }, "P21E-4: the unaudited composition keeps its exact existing refusal");
  assert.equal((await decisionRows(asSuperuser)).length, 6, "P21E-4: the unaudited composition wires no guard auditor and must still record nothing");
  assert.deepEqual(await businessRowCounts(asSuperuser), eachTable(1), "P21E-4: nothing after the one allowed request wrote a further business row");
  for (const foreign of FOREIGN_VALUES) {
    assert.deepEqual(await rowsMentioning(asSuperuser, foreign), noTableMentions(),
      `P21E-4: after every scenario, no persisted row in any of the four tables carries the attacker-claimed value ${foreign}`);
  }
});

test("P21E-4: the optional identity-guard auditor is strictly validated, is handed only the authenticated identity, is awaited before the refusal, and changes nothing for a pipeline built without it", async () => {
  requireGuardAuditSeam("P21E-4");
  await requireContract("P21E-4");
  const identity = identityAnswering(AUTHENTICATED);
  /** One pipeline per case, so a call counter can never be read across two of them. */
  const pipelineOf = (options = {}) => {
    const counters = { candidates: 0, invariants: 0, audits: [] };
    const built = new CreateCustomerPipeline({
      identity,
      policyDecisionPoint: pointOver(async () => { counters.candidates += 1; return options.candidates ?? []; }),
      evaluateInvariants: async () => { counters.invariants += 1; return { ok: true }; },
      ...(options.auditor ? { [GUARD_OPTION]: async (...args) => { counters.audits.push(args); return options.auditor(...args); } } : {}),
    });
    return { pipeline: built, counters };
  };

  // The collaborator-free pipeline: same three options, same three outcomes, byte for byte.
  const bare = pipelineOf();
  const bareCrossTenant = await bare.pipeline.run(actionSpecOf(crypto.randomUUID(), FOREIGN_TENANT, AUTH_ACTOR));
  const bareActor = await bare.pipeline.run(actionSpecOf(crypto.randomUUID(), AUTH_TENANT, FOREIGN_ACTOR));
  assert.deepEqual({ outcome: bareCrossTenant.outcome, code: bareCrossTenant.error.code, prepared: bareCrossTenant.preparedChangeSet },
    { outcome: "CROSS_TENANT_DENY", code: "CROSS_TENANT_DENY", prepared: null }, "P21E-4: a pipeline built without the auditor keeps its exact cross-tenant outcome");
  assert.deepEqual({ outcome: bareActor.outcome, code: bareActor.error.code, prepared: bareActor.preparedChangeSet },
    { outcome: "DENY", code: "IDENTITY_MISMATCH", prepared: null }, "P21E-4: a pipeline built without the auditor keeps its exact actor-mismatch outcome");
  const bareAllow = await pipelineOf({ candidates: [ALLOW_CANDIDATE] }).pipeline.run(actionSpecOf(crypto.randomUUID()));
  assert.equal(bareAllow.outcome, "ALLOW_COMMIT", "P21E-4: a pipeline built without the auditor still allows what it allowed before");
  assert.deepEqual(Object.keys(bareAllow.preparedChangeSet.intents).sort(), ["audit", "customer", "idempotency", "transactionalOutbox"], "P21E-4: the four write intents are untouched");

  // With the auditor: exactly one call, exactly one argument, and an argument carrying nothing the
  // request claimed. The seam cannot leak a foreign identity because it is never handed one.
  for (const [code, claimedTenant, claimedActor, outcome, errorCode] of [
    ["CROSS_TENANT_DENY", FOREIGN_TENANT, AUTH_ACTOR, "CROSS_TENANT_DENY", "CROSS_TENANT_DENY"],
    ["IDENTITY_MISMATCH", AUTH_TENANT, FOREIGN_ACTOR, "DENY", "IDENTITY_MISMATCH"],
    ["CROSS_TENANT_DENY", FOREIGN_TENANT, FOREIGN_ACTOR, "CROSS_TENANT_DENY", "CROSS_TENANT_DENY"],
  ]) {
    const requestId = crypto.randomUUID();
    const { pipeline, counters } = pipelineOf({ auditor: async () => {}, candidates: [ALLOW_CANDIDATE] });
    const result = await pipeline.run(actionSpecOf(requestId, claimedTenant, claimedActor));
    assert.deepEqual({ outcome: result.outcome, code: result.error.code }, { outcome, code: errorCode }, `${code}: the audited guard keeps the outcome the guard already produced`);
    assert.equal(counters.audits.length, 1, `${code}: the identity-guard auditor is called exactly once`);
    assert.equal(counters.audits[0].length, 1, `${code}: the identity-guard auditor takes exactly one argument`);
    const [context] = counters.audits[0];
    assert.equal(Object.getPrototypeOf(context), Object.prototype, `${code}: the auditor is handed an ordinary object`);
    assert.ok(Object.isFrozen(context), `${code}: the auditor is handed a frozen object it cannot influence`);
    assert.deepEqual(Reflect.ownKeys(context).sort(), [...GUARD_ARGUMENT_KEYS].sort(), `${code}: the auditor is handed exactly ${GUARD_ARGUMENT_KEYS.join(", ")} and nothing else`);
    assert.equal(context.code, code, `${code}: the auditor learns which guard refused, and the tenant guard decides first`);
    assert.equal(context.principal, AUTHENTICATED, `${code}: the auditor is handed the exact authenticated Principal, never the claimed identity`);
    assert.ok(Object.getPrototypeOf(context.correlationId) === CorrelationId.prototype && context.correlationId.toString() === requestId, `${code}: the auditor is handed the exact CorrelationId of this request`);
    assert.equal(Object.getPrototypeOf(context.idempotencyKey), IdempotencyKey.prototype, `${code}: the auditor is handed the request's IdempotencyKey value`);
    for (const foreign of FOREIGN_VALUES) {
      assert.ok(!JSON.stringify(context).includes(foreign), `${code}: nothing the request claimed may reach the auditor — ${foreign} must be absent by construction`);
    }
    assert.deepEqual({ candidates: counters.candidates, invariants: counters.invariants }, { candidates: 0, invariants: 0 }, `${code}: an identity-guard deny reaches neither candidate evaluation nor the invariant stage`);
  }

  // The seam is never reached on any path the guard did not refuse.
  for (const [name, candidates, spec] of [
    ["a shape-invalid ActionSpec", [], { requestId: crypto.randomUUID(), actorId: AUTH_ACTOR }],
    ["a policy deny", [], actionSpecOf(crypto.randomUUID())],
    ["an allow", [ALLOW_CANDIDATE], actionSpecOf(crypto.randomUUID())],
  ]) {
    const { pipeline, counters } = pipelineOf({ auditor: async () => {}, candidates });
    await pipeline.run(spec);
    assert.equal(counters.audits.length, 0, `P21E-4: the identity-guard auditor must not run for ${name}`);
  }

  // Awaited, not merely called: the refusal may not be handed back before the audit has settled.
  const gated = (() => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; })();
  const { pipeline: gatedPipeline, counters: gatedCounters } = pipelineOf({ auditor: () => gated.promise });
  let settled = false;
  const running = gatedPipeline.run(actionSpecOf(crypto.randomUUID(), FOREIGN_TENANT, AUTH_ACTOR)).then((value) => { settled = true; return value; });
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(gatedCounters.audits.length, 1, "P21E-4: the auditor is called before the refusal is projected");
  assert.equal(settled, false, "P21E-4: run must not resolve while the identity-guard audit is still outstanding");
  gated.release();
  assert.equal((await running).outcome, "CROSS_TENANT_DENY", "P21E-4: once the audit settles the guard's own refusal is returned unchanged");

  // Fail-closed at the pipeline itself: an audit that refuses may not become a silent 403.
  const refusal = new Error("the identity-guard audit could not be recorded");
  const { pipeline: failing } = pipelineOf({ auditor: async () => { throw refusal; } });
  await assert.rejects(() => failing.run(actionSpecOf(crypto.randomUUID(), FOREIGN_TENANT, AUTH_ACTOR)), (error) => error === refusal,
    "P21E-4: a refused identity-guard audit propagates unchanged instead of returning an unrecorded deny envelope");

  // Strict admission of the option itself, alongside the three that were always required.
  const required = { identity, policyDecisionPoint: pointOver(async () => []), evaluateInvariants: alwaysValid };
  for (const bad of [null, undefined, 0, false, "auditIdentityGuard", {}, [], Symbol("guard")]) {
    assert.throws(() => new CreateCustomerPipeline({ ...required, [GUARD_OPTION]: bad }), TypeError,
      `P21E-4: ${GUARD_OPTION} is optional, but a present ${String(bad)} is not a collaborator and must be refused`);
  }
  assert.throws(() => new CreateCustomerPipeline({ ...required, [GUARD_OPTION]: async () => {}, extra: 1 }), TypeError, "P21E-4: an unknown fifth option is still refused");
  assert.throws(() => new CreateCustomerPipeline({ ...required, [GUARD_OPTION]: async () => {}, [Symbol("extra")]: 1 }), TypeError, "P21E-4: an own symbol-keyed extra is an unknown option and must be refused");
  let accessorReads = 0;
  const accessorBacked = { ...required };
  Object.defineProperty(accessorBacked, GUARD_OPTION, { enumerable: true, configurable: true, get() { accessorReads += 1; return async () => {}; } });
  assert.throws(() => new CreateCustomerPipeline(accessorBacked), TypeError, `P21E-4: an accessor-backed ${GUARD_OPTION} is not admissible option data and must be refused`);
  assert.equal(accessorReads, 0, "P21E-4: the pipeline must decide from the property descriptor alone, never invoking a caller-supplied getter");
  const nonEnumerable = { ...required };
  Object.defineProperty(nonEnumerable, GUARD_OPTION, { enumerable: false, configurable: true, writable: true, value: async () => {} });
  assert.throws(() => new CreateCustomerPipeline(nonEnumerable), TypeError, `P21E-4: a non-enumerable ${GUARD_OPTION} does not satisfy that option and must be refused`);
  for (const missing of ["identity", "policyDecisionPoint", "evaluateInvariants"]) {
    const { [missing]: _dropped, ...rest } = required;
    assert.throws(() => new CreateCustomerPipeline({ ...rest, [GUARD_OPTION]: async () => {} }), TypeError, `P21E-4: ${missing} stays required even when the auditor is supplied`);
  }
  // The pipeline stays a pure Application-ring value: the seam brings in no capability of its own.
  const source = await readFile(path.join(root, PIPELINE_PATH), "utf8");
  for (const forbidden of [/from\s+["'](node:)?(fs|net|http|https|crypto)["']/i, /\bfetch\s*\(/, /process\.env/, /Date\.now|Math\.random/]) {
    assert.doesNotMatch(source, forbidden, `${PIPELINE_PATH} must not take on ${forbidden}`);
  }
});

test("P21E-5: the planning manifest binds this package, this base, this frozen test and its four allowed files", async () => {
  const contract = await requireContract("P21E-5");
  requireGuardAuditSeam("P21E-5");
  assert.equal(contract.package, "P21E-identity-guard-decision-audit");
  assert.equal(contract.base, "ea384dcb3684c0f616e733d2fe1fcf44a0e01b4a");
  assert.equal(contract.baseTree, "23341d6e051a674f536b8c9466405c60cce20cec");
  assert.equal(contract.provenance.scopeSynthesisSha256, "7c0748fbf1bc46f607d74e6677e597e519e998f24b2987a4cbb0919f3a89d13a");
  assert.equal(contract.provenance.singleWriter, true);
  assert.equal(contract.provenance.reviewerMustBeSeparateSession, true);
  assert.equal(contract.frozenTestPath, FROZEN_TEST_PATH);
  assert.equal(contract.frozenTestSha256, crypto.createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex"), "frozenTestSha256 must be the content hash of this exact test file");
  assert.deepEqual([...contract.allowedFiles].sort(), [MANIFEST_PATH, FROZEN_TEST_PATH, PIPELINE_PATH, COMPOSITION_PATH].sort(), "P21E may touch only its manifest, this frozen test, the pipeline and the composition root");
  assert.deepEqual([...contract.writeTables], [...WRITE_TABLES]);
  assert.match(contract.capabilityDelta, /^IDENTITY_GUARD_DENIALS_ARE_AUDITED:/);
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
  for (const required of [/no hosted/, /no release, deploy/, /no new dependency/, /no schema, migration/, /no change to createcustomercomposition/]) {
    assert.match(nonGoals, required, `nonGoals must state: ${required}`);
  }
});
