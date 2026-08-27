import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";

// P22B2 — the audited business write over live HTTP, and the durable decision record it leaves
// behind. P22B1 built one ephemeral live environment and deliberately proved NO write: every
// route it exercised was a refusal and all four runtime tables stayed empty. This frozen test owns
// every fixed expectation for the package that closes that gap inside the SAME environment,
// unchanged: one trusted POST /customers really commits through the real audited boundary against
// the real pinned database, its receipt binds to exactly one customer, audit and outbox row, and
// the decision that authorized it is the independently verifiable genesis of this tenant's
// hash-chained log; then one sequential request claiming a foreign tenant is refused 403 by the
// identity guard that already existed, writes no business row, and lands in the same chain as the
// genesis's successor under the TRUSTED identity — with the claimed tenant absent from every
// column of every row of all four tables. P22B2 adds ONE read-only probe seam beside the P22B1
// harness; it starts no second environment, defines no image, and changes no P22B1, image, wrapper
// or runner file — the six sha256 below are the proof of that, checked against the working tree.
// The manifest gates the run and never supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_TEST_PATH = "tests/kernel-deploy-live-audited-write-p22b2.test.mjs";
const PROBE_PATH = "tests/_harness/live-audited-write-probe.mjs";
const MANIFEST_PATH = "planning/kernel-deploy-live-audited-write-p22b2.json";
const LIVE_HARNESS_PATH = "tests/_harness/live-http-postgres-environment.mjs";
const ALLOWED_FILES = Object.freeze([FROZEN_TEST_PATH, PROBE_PATH, MANIFEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P22B2-1", "P22B2-2", "P22B2-3", "P22B2-4"]);
const [BASE_COMMIT, BASE_TREE] = ["0587a4e8971c9ff191b7d83051075c351c87a7d9", "a652a1d03f873ce27bcfb9a177654755f8e46cb6"];
const SCOPE_V1 = "b52a7b0ef3b4f338200102e1a226a5805fb125fffc02391e521b47d57fc653bb";
const PARENT_SCOPE = "e5dd2e1d99dea2c4f676f4314733572a46d0377b8865cffab1642b84604cda1";
const BLIND_SCOPE = "d7a1e659421eb264976a1c9f102abb6ba4926aeb69954b29ad1e61b18abb8cb2";
// The canonical Actionplan change-package budget is the sole owner of every threshold; this test
// binds the manifest to that consumer at one exact pinned commit and duplicates no number of its own.
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The six surfaces P22B2 must leave byte-identical: the whole P22B1 package, the image definition,
// the P22A1 secret wrapper and the audited JS boundary runner this write really travels through.
const PRESERVED = Object.freeze({
  [LIVE_HARNESS_PATH]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
  "tests/kernel-deploy-ephemeral-environment-p22b1.test.mjs": "aef0f0ca2eb34147f75725f8ef302d2c60ec61da2e8ca9921c8075fac69873e9",
  "planning/kernel-deploy-ephemeral-environment-p22b1.json": "272f957aeaf4f54c1883beea4be70b1b43bcce63b58064f6829c06a59c796afa",
  "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
  "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
  "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
});
const PROBE_API = Object.freeze(["AUDITED_WRITE_PROBE_CONTRACT", "queryAsSuperuser", "readTrustedPrincipal", "sendJsonRequest"]);
const [METHOD, ROUTE, APP_PORT, DATABASE, SUPERUSER] = ["POST", "/customers", 8000, "mfk", "postgres"];
const BUSINESS_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const DECISION_TABLE = "policy_decision_log";
const CUSTOMER_NAME = "Ada Lovelace";
const [ALLOW_POLICY, LAYER, ACTION, OUTBOX_EVENT] = ["allow.everything", "tenant", "customer.create", "customer.created"];
// The canonical eight-field CommitReceipt contract, and the instant form it is spelled in.
const RECEIPT_KEYS = Object.freeze(["auditId", "committedAt", "idempotencyKey", "outboxEventIds", "outcome", "requestId", "resourceId", "tenantId"]);
const TS_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GUARD_STAGE = "identityTenantGuard";
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_PREFIX = "p22b2";
// Unique per process, so one concurrent run can never sweep or adopt another run's resources.
const LABEL_VALUE = `${LABEL_PREFIX}-${randomBytes(6).toString("hex")}`;
const SENTINEL = "p22b2-sentinel-J7bV2xQ9mD4tL8sN-do-not-log";
const TRUE_FLAGS = Object.freeze(["runtimeImplementationStarted", "hostServerSelectedForDeployArtifact",
  "networkListenerStarted", "liveHttpAuditProven"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p22Complete", "stagingEnvironmentExists",
  "stagingRunPerformed", "productionHostSelected", "registryPushed", "externalDeploymentPerformed"]);

/** Read one dotted path, so a binding table names the exact field it binds. */
const at = (node, dotted) => dotted.split(".").reduce((value, key) => value?.[key], node);

/** The FIRST action of every scenario. A checkout without the probe fails HERE, naming the exact missing
 * allowed path, BEFORE Docker is touched: RED on the absent implementation, never on a daemon or a pull. */
const requireProbe = (scenario) =>
  import(pathToFileURL(path.join(root, PROBE_PATH)).href).catch((error) =>
    assert.fail(`[${scenario}] the allowed P22B2 probe ${PROBE_PATH} must exist before this scenario can run: ${error.message}`));

/** Load-bearing contract read: no P22B2 scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P22B2 manifest ${MANIFEST_PATH} must exist before this scenario can run: ${error.message}`)));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS],
    `[${scenario}] ${MANIFEST_PATH} must declare exactly the four P22B2 scenario ids, in order`);
  return contract;
}

/** Exactly one ephemeral environment for the whole suite — the UNCHANGED P22B1 one, started through
 * the UNCHANGED P22B1 harness under this run's own unique label. P22B2 builds no environment. */
let live = null;
const liveEnvironment = (scenario) => (live ??= requireProbe(scenario)
  .then(() => import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href))
  .then(({ LIVE_ENVIRONMENT_CONTRACT, startLiveEnvironment }) => {
    // Armed here and nowhere else — only now can a labelled resource exist, so on the absent-probe base
    // this suite issues no Docker command at all — and the sweep is scoped to THIS run's unique label.
    const label = { key: LIVE_ENVIRONMENT_CONTRACT.labelKey, value: LABEL_VALUE };
    process.on("exit", () => {
      const filter = ["--filter", `label=${label.key}=${label.value}`];
      const listed = spawnSync("docker", ["ps", "-aq", ...filter], { encoding: "utf8" })?.stdout ?? "";
      for (const id of listed.split("\n").filter(Boolean)) spawnSync("docker", ["rm", "--force", "--volumes", id], { stdio: "ignore" });
      for (const kind of ["network", "image", "volume"]) spawnSync("docker", [kind, "prune", "--force", ...filter], { stdio: "ignore" });
    });
    return startLiveEnvironment({ runtimePassword: SENTINEL, label });
  }));

/** Every column of every row of all four tables, ordered as the server recorded them. */
const decisionRows = async (probe, env) => (await probe.queryAsSuperuser(env,
  `SELECT id, tenant_id::text AS tenant_id, entry_hash, prev_hash, payload FROM ${DECISION_TABLE} ORDER BY recorded_at`)).rows;
const tableRows = async (probe, env, table) => (await probe.queryAsSuperuser(env,
  `SELECT id::text AS id, tenant_id::text AS tenant_id FROM ${table} ORDER BY recorded_at`)).rows;
const decisionShape = (row) => ({ decision: row.payload.decision, matchedPolicyId: row.payload.matchedPolicyId, layerResolved: row.payload.layerResolved, traceId: row.payload.traceId });

test("P22B2-1 the read-only probe seam exists beside the P22B1 harness, exports exactly its four members, fixes the audited-write target with bounded waits, and preserves all six untouched surfaces", async () => {
  const S = "P22B2-1";
  const probe = await requireProbe(S);
  await requireContract(S);
  assert.deepEqual(Object.keys(probe).sort(), [...PROBE_API], `[${S}] ${PROBE_PATH} must export exactly this API and nothing more`);
  for (const name of PROBE_API.slice(1)) assert.equal(typeof probe[name], "function", `[${S}] ${name} must be callable`);
  const contract = probe.AUDITED_WRITE_PROBE_CONTRACT;
  assert.ok(Object.isFrozen(contract), `[${S}] AUDITED_WRITE_PROBE_CONTRACT must be frozen: a mutable probe contract can be edited by the very run that must be judged against it`);
  for (const [field, want] of [["method", METHOD], ["route", ROUTE], ["appPort", APP_PORT],
    ["database", DATABASE], ["superuserRole", SUPERUSER]]) {
    assert.equal(at(contract, field), want, `[${S}] the probe contract must fix ${field} to ${JSON.stringify(want)}: the one audited write this package proves, the port it is sent to, and the database and role every verification read goes through are decided here and nowhere else`);
  }
  // Bounded, and never looser than the environment it borrows: an unbounded wait hangs a test run
  // instead of failing it, and a probe that outwaits its own environment reports nothing at all.
  const { LIVE_ENVIRONMENT_CONTRACT: live22b1 } = await import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href);
  for (const [key, ceiling] of [["http", live22b1.timeouts.http], ["psql", live22b1.timeouts.dockerCli]]) {
    const bound = contract.timeouts?.[key];
    assert.ok(Number.isFinite(bound) && bound > 0 && bound <= ceiling, `[${S}] timeouts.${key} must be a finite bound of at most the P22B1 environment's own ${ceiling}ms; got ${bound}`);
  }
  assert.deepEqual(Object.keys(contract.preservedHashes ?? {}).sort(), Object.keys(PRESERVED).sort(), `[${S}] the probe contract must name exactly these six preserved surfaces`);
  for (const [file, digest] of Object.entries(PRESERVED)) {
    assert.equal(contract.preservedHashes[file], digest, `[${S}] the probe contract must record ${file} as ${digest}`);
    assert.equal(createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"), digest,
      `[${S}] ${file} must still hash to ${digest} in this working tree: P22B2 adds one probe beside the P22B1 harness and changes no P22B1, image, secret-wrapper or boundary-runner byte`);
  }
  const source = await readFile(path.join(root, PROBE_PATH), "utf8");
  assert.ok(!/^\s*FROM\s/m.test(source), `[${S}] the probe must define no image of its own`);
  assert.ok(!source.includes("--privileged"), `[${S}] nothing this probe runs may be privileged`);
  assert.ok(!source.includes("live-http-postgres-environment"), `[${S}] the probe must never start or stop an environment: it is handed the ONE P22B1 environment and only reads from it`);
});

test("P22B2-2 one trusted POST /customers really commits over live HTTP: a COMMITTED receipt whose ids bind to exactly one customer, audit and outbox row, authorized by an independently verifiable decision genesis", async () => {
  const S = "P22B2-2";
  const probe = await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  // The trusted principal is the environment's own, read from the credential it really runs on —
  // never a value this test asserts into existence.
  const principal = await probe.readTrustedPrincipal(env);
  assert.match(principal.tenantId, UUID_FORM, `[${S}] the environment's trusted tenant must be a canonical UUID; got ${principal.tenantId}`);
  assert.ok(typeof principal.actorId === "string" && principal.actorId.trim().length > 0, `[${S}] the environment's trusted actor must be a non-empty string`);
  for (const table of [DECISION_TABLE, ...BUSINESS_TABLES]) {
    assert.equal((await probe.queryAsSuperuser(env, `SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n, 0,
      `[${S}] precondition: ${table} starts empty, exactly as P22B1 left it — every row this scenario finds was written by this scenario`);
  }

  const [requestId, idempotencyKey] = [randomUUID(), randomUUID()];
  const response = await probe.sendJsonRequest(env, {
    method: METHOD, route: ROUTE, body: { name: CUSTOMER_NAME },
    headers: { "content-type": "application/json", "x-request-id": requestId,
      "x-tenant-id": principal.tenantId, "x-actor-id": principal.actorId, "idempotency-key": idempotencyKey },
  });
  const receipt = response.json?.commitReceipt;
  assert.deepEqual({ status: response.status, outcome: receipt?.outcome, requestId: receipt?.requestId,
    tenantId: receipt?.tenantId, idempotencyKey: receipt?.idempotencyKey, outboxCount: receipt?.outboxEventIds?.length },
  { status: 201, outcome: "COMMITTED", requestId, tenantId: principal.tenantId, idempotencyKey, outboxCount: 1 },
  `[${S}] the live listener must answer 201 with a CommitReceipt bound to this exact HTTP request; got ${JSON.stringify(response.json)}`);
  assert.deepEqual(Object.keys(receipt).sort(), [...RECEIPT_KEYS],
    `[${S}] the receipt crossing real HTTP must carry exactly the canonical eight CommitReceipt fields and nothing more: a receipt that grew or lost a field on the way out is a different contract from the one the Application ring froze`);
  assert.match(receipt.committedAt, TS_FORM, `[${S}] committedAt must be the canonical UTC millisecond instant the committing row was really stamped with; got ${JSON.stringify(receipt.committedAt)}`);

  // The receipt is not the proof; the rows are. Each business table holds exactly one row in the
  // whole database, it is the one this receipt names, under the trusted tenant — and it carries the
  // business this request actually asked for, not merely an id that happens to match.
  for (const [table, id, columns, business] of [
    [BUSINESS_TABLES[0], receipt.resourceId, "name", { name: CUSTOMER_NAME }],
    [BUSINESS_TABLES[1], receipt.auditId, "event_type, actor_id, correlation_id::text AS correlation_id",
      { event_type: ACTION, actor_id: principal.actorId, correlation_id: requestId }],
    [BUSINESS_TABLES[2], receipt.outboxEventIds[0], "event_type, correlation_id::text AS correlation_id",
      { event_type: OUTBOX_EVENT, correlation_id: requestId }],
  ]) {
    assert.match(id, UUID_FORM, `[${S}] the receipt id this package binds to ${table} must be a canonical UUID; got ${id}`);
    const rows = (await probe.queryAsSuperuser(env, `SELECT id::text AS id, tenant_id::text AS tenant_id, ${columns} FROM ${table}`)).rows;
    assert.deepEqual(rows, [{ id, tenant_id: principal.tenantId, ...business }],
      `[${S}] ${table} must hold exactly one row in the whole database: the one the receipt names, filed under the trusted tenant, carrying ${JSON.stringify(business)} — a receipt naming a row that is not there, a second row nobody asked for, or a row whose name, event type, actor or correlation is not this request's own, is not a durable audited write`);
  }

  const rows = await decisionRows(probe, env);
  assert.equal(rows.length, 1, `[${S}] the audited allow must record exactly one decision`);
  const [genesis] = rows;
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis),
    { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: principal.tenantId, entryHash: genesis.entry_hash, prevHash: null },
    `[${S}] the genesis must verify independently, recomputed from its own persisted payload rather than trusted because this test wrote it, and be filed under the environment's trusted tenant as the head of a new chain`);
  assert.deepEqual(decisionShape(genesis), { decision: "allow", matchedPolicyId: ALLOW_POLICY, layerResolved: LAYER, traceId: requestId },
    `[${S}] the genesis must record the matched allow policy, its resolved layer and this request's own id`);
  assert.deepEqual(genesis.payload.requestActor, { tenantId: principal.tenantId, actorId: principal.actorId },
    `[${S}] the decision must be filed under the identity the container was trusted with`);
  assert.equal(genesis.payload.requestAction, ACTION, `[${S}] the audited action must be the one the boundary was asked for`);
});

test("P22B2-3 a sequential request claiming a foreign tenant is refused 403 over the same live HTTP, writes no business row, and chains onto the genesis as an audited deny that never carries the claimed tenant", async () => {
  const S = "P22B2-3";
  const probe = await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  try {
    const principal = await probe.readTrustedPrincipal(env);
    const [genesis] = await decisionRows(probe, env);
    assert.ok(genesis, `[${S}] precondition: the P22B2-2 allow genesis must already be on record`);
    // Well formed, so it reaches the identity guard rather than a shape check, and never true of
    // the principal the container was trusted with.
    const [requestId, foreignTenant] = [randomUUID(), randomUUID()];
    assert.notEqual(foreignTenant, principal.tenantId, `[${S}] the claimed tenant must really be foreign`);
    const response = await probe.sendJsonRequest(env, {
      method: METHOD, route: ROUTE, body: { name: CUSTOMER_NAME },
      headers: { "content-type": "application/json", "x-request-id": requestId,
        "x-tenant-id": foreignTenant, "x-actor-id": principal.actorId, "idempotency-key": randomUUID() },
    });
    assert.deepEqual({ status: response.status, code: response.json?.error?.code, retryable: response.json?.error?.retryable,
      requestId: response.json?.error?.requestId, receipt: response.json?.commitReceipt },
    { status: 403, code: "CROSS_TENANT_DENY", retryable: false, requestId, receipt: undefined },
    `[${S}] the reach must keep its exact existing refusal, traced to its own request id and carrying no receipt; got ${JSON.stringify(response.json)}`);

    for (const table of BUSINESS_TABLES) {
      const rows = await tableRows(probe, env, table);
      assert.equal(rows.length, 1, `[${S}] ${table} must still hold exactly the one row the P22B2-2 allow committed: a refusal that still wrote a business row would be no refusal at all`);
      assert.equal(rows[0].tenant_id, principal.tenantId, `[${S}] the surviving ${table} row must still belong to the trusted tenant`);
    }

    const rows = await decisionRows(probe, env);
    assert.equal(rows.length, 2, `[${S}] the refused request must append exactly one further decision — the class of request most worth a record is the one that used to leave none`);
    const successor = rows[1];
    verifyPersistedDecisionLogRow(successor);
    assert.deepEqual(decisionShape(successor), { decision: "deny", matchedPolicyId: null, layerResolved: null, traceId: requestId },
      `[${S}] the refusal must match no policy and resolve no layer: it was refused at the system layer before any policy was consulted`);
    assert.deepEqual(successor.payload.requestActor, { tenantId: principal.tenantId, actorId: principal.actorId },
      `[${S}] the refusal must be filed under the trusted identity, never the identity the request claimed`);
    assert.deepEqual(successor.payload.requestContext, { stage: GUARD_STAGE, guard: "CROSS_TENANT_DENY" },
      `[${S}] the record must name the guard that refused it and the stage it was refused at`);
    assert.ok(typeof successor.payload.reason === "string" && successor.payload.reason.trim().length > 0, `[${S}] the refusal must carry a non-empty reason`);
    assert.equal(successor.prev_hash, genesis.entry_hash,
      `[${S}] the refusal must chain onto the P22B2-2 allow genesis: commits and refusals share one tamper-evident chain, in the order they really happened`);

    // The sweep runs against the server, not against a value this test happens to hold: every
    // column of every row of all four tables is projected to text, so the claimed tenant cannot
    // survive anywhere this test never thought to read.
    for (const table of [DECISION_TABLE, ...BUSINESS_TABLES]) {
      const found = (await probe.queryAsSuperuser(env,
        `SELECT count(*)::int AS n FROM "${table}" t WHERE to_jsonb(t)::text LIKE '%${foreignTenant}%'`)).rows[0]?.n;
      assert.equal(found, 0, `[${S}] no persisted row in ${table} may carry the claimed tenant ${foreignTenant} — not in a payload, a reason, a resource or a context`);
    }
  } finally {
    const { stopLiveEnvironment } = await import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href);
    await stopLiveEnvironment(env).catch(() => {});
  }
});

test("P22B2-4 the planning manifest binds this package to its base, its blind-frozen scope, its three allowed files, its measured metrics, its rollback and the one readiness flag this package really moves", async () => {
  const S = "P22B2-4";
  const contract = await requireContract(S);
  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  for (const [field, want] of [["base", BASE_COMMIT], ["baseTree", BASE_TREE], ["actionplanPin", ACTIONPLAN_PIN],
    ["frozenTestPath", FROZEN_TEST_PATH], ["frozenTestSha256", digest], ["greenEvidence.targetedTest", TARGETED_TEST],
    ["splitEvidence.scopeSynthesisName", "P22B2_SCOPE_SYNTHESIS_V1"], ["splitEvidence.scopeSynthesisSha256", SCOPE_V1],
    ["splitEvidence.parentScopeSha256", PARENT_SCOPE], ["splitEvidence.blindScopeSha256", BLIND_SCOPE],
    ["splitEvidence.thisPackage", "P22B2"], ["splitEvidence.counter", "21/25"],
    ["provenance.singleWriter", true], ["provenance.reviewerMustBeSeparateSession", true],
    ["provenance.testAuthoring", "claude-only"], ["rollback.compensatingStepRequired", false]]) {
    assert.equal(at(contract, field), want, `[${S}] the manifest must record ${field} as ${JSON.stringify(want)}: the immutable base, the exact pinned Actionplan budget that owns every threshold this package is judged by, the blind-frozen and reconciled scopes, the unmoved 21/25 counter, the single-writer provenance and the rollback are all bound here`);
  }
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the three allowed P22B2 paths`);
  assert.deepEqual(contract.splitEvidence?.delivered, ["P22A1", "P22A2", "P22B1"], `[${S}] all three earlier P22 packages are already delivered`);
  assert.deepEqual(contract.splitEvidence?.remaining, ["P22C"], `[${S}] P22C must remain outstanding: an audited write is not a closed roadmap truth`);
  assert.deepEqual(contract.preservedHashes, { ...PRESERVED }, `[${S}] the manifest must record the same six untouched surfaces the probe contract does`);
  const actual = contract.budget?.actual ?? {};
  for (const key of ["grossAdditions", "grossDeletions", "net", "changedFiles"]) {
    assert.equal(typeof actual[key], "number", `[${S}] budget.actual.${key} must be measured and recorded`);
  }
  assert.equal(actual.changedFiles, ALLOWED_FILES.length, `[${S}] exactly ${ALLOWED_FILES.length} files change in this package`);
  assert.ok(actual.net <= 800 && actual.grossAdditions <= 800, `[${S}] the package must stay inside the class ceiling; measured net ${actual.net}, gross additions ${actual.grossAdditions}`);
  if (actual.net > 400) {
    assert.equal(contract.budget?.band, "conditional", `[${S}] a package above net 400 must draw the conditional band explicitly`);
    assert.deepEqual((contract.budget?.conditionalDeliveryGates ?? []).map((gate) => gate?.gate), ["single-narrow-problem", "bounded-file-set", "no-redundant-repetition", "no-quality-tradeoff", "full-green", "fresh-reviewer-accept", "explicit-rollback"], `[${S}] all seven canonical conditional-band gates must be recorded, in order`);
  }
  assert.ok(!JSON.stringify(contract.budget ?? {}).toLowerCase().includes("waiver"), `[${S}] no waiver may be claimed for this package`);
  assert.ok(contract.rollback?.mechanism && contract.rollback?.blastRadius, `[${S}] the rollback mechanism and blast radius must be stated`);
  for (const untouched of ["srcUntouched", "p22b1Untouched", "hostDeployImageUntouched", "secretFileRunnerUntouched",
    "boundaryRunnerUntouched", "dbUntouched", "ciUntouched", "dependenciesUntouched", "roadmapUntouched"]) {
    assert.equal(contract.rollback?.[untouched], true, `[${S}] the manifest must record ${untouched}=true`);
  }
  const flags = contract.readinessFlags ?? {};
  for (const flag of TRUE_FLAGS) {
    assert.equal(flags[flag], true, `[${S}] ${flag} must be true: this package really committed one audited business write over live HTTP against a real pinned database and left a verifiable durable record of the decision, and denying evidence a package carries is as wrong as claiming evidence it does not`);
  }
  for (const flag of FALSE_FLAGS) {
    assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P22B2 is one audited write inside an environment that deletes itself — not a staging environment, not a staging run, not a registry push, not a deployment and not a closed P22`);
  }
  assert.equal(Object.keys(flags).length, TRUE_FLAGS.length + FALSE_FLAGS.length, `[${S}] no readiness flag beyond the declared set may be introduced`);
  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of ["persistent", "staging", "registry", "deployment", "host port", "image", "roadmap", "current-truth", "p22b1"]) {
    assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  }
  assert.match(String(contract.capabilityDelta ?? ""), /^LIVE_AUDITED_BUSINESS_WRITE:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
  }
});
