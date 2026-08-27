import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";
import { queryAsSuperuser, readTrustedPrincipal, sendJsonRequest } from "./_harness/live-audited-write-probe.mjs";

// P23B — one real streaming standby, one total loss of the primary, one promotion, and the audited business that carried on
// over the SAME never-restarted listener. P23A proved this system can lose its database and get the truth back OUT OF AN
// ARCHIVE, with a window of loss and an operator in the middle; it proved nothing about a second copy already current, so
// "the node died" still meant "stop and restore". This frozen test owns every fixed expectation for the package that closes
// that gap inside the SAME unchanged P22B1 environment — a standby built by a REAL pg_basebackup, carrying the primary's own
// system identifier and streaming from it, publishing no host port and reached only through a credential named by PATH; a
// trusted committed write replayed onto it and proven by LSN and by all four tables, with the standby refusing a write of its
// own through PostgreSQL's own SQLSTATE 25006; the primary container AND its volume destroyed, with the daemon asked and the
// standby proven still UNPROMOTED while the untouched listener fails closed without leaking the credential it holds; the
// promotion, the timeline advance and the rebinding of the db alias, with the application container never restarted; and a
// second trusted write that commits on the promoted node and chains onto the entry hash the chain had BEFORE the failover,
// before teardown leaves zero labelled resources and no secret on disk. P23B adds ONE failover seam beside the three P22/P23A
// ones: it starts no environment, defines no image, publishes no port and puts no credential on a command line, and every HTTP
// request, verification read and trusted principal on the primary comes from the UNCHANGED P22B2 probe — the nine sha256 below
// are the proof, checked against the working tree. This is a MANUAL failover drill: not automatic failover, not split-brain
// protection, not synchronous replication, not point-in-time recovery, not a migration rollback, and it agrees no recovery
// objective. The manifest gates the run and never supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_TEST_PATH = "tests/kernel-high-availability-standby-failover-p23b.test.mjs";
const PROBE_PATH = "tests/_harness/live-standby-failover-probe.mjs";
const MANIFEST_PATH = "planning/kernel-high-availability-standby-failover-p23b.json";
const [LIVE_HARNESS_PATH, WRITE_PROBE_PATH] = ["tests/_harness/live-http-postgres-environment.mjs", "tests/_harness/live-audited-write-probe.mjs"];
const ALLOWED_FILES = Object.freeze([FROZEN_TEST_PATH, PROBE_PATH, MANIFEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P23B-1", "P23B-2", "P23B-3", "P23B-4", "P23B-5", "P23B-6"]);
const [BASE_COMMIT, BASE_TREE] = ["738a42511ff62481e5a92e9a6e4ed2a78b666d34", "dbbb35de3eb5640761757b9d6a0b053a2c9b6bad"];
// The canonical Actionplan change-package budget owns every threshold; this test binds the manifest to that consumer at one exact pinned commit and duplicates no number of its own.
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The nine surfaces P23B must leave byte-identical: the two P22 harnesses and the P23A recovery seam it runs beside, the
// two frozen tests and the manifest whose proofs it re-uses rather than re-proves, and the image, the P22A1 secret wrapper
// and the audited JS boundary runner every request really travels through. A failover package that quietly edits the
// environment it fails over is proving its own fixture.
const PRESERVED = Object.freeze({
  [LIVE_HARNESS_PATH]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
  [WRITE_PROBE_PATH]: "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
  "tests/_harness/live-recovery-probe.mjs": "e13a0e5be9fc4066c74fb8dbc11279c1e72a2359287195865db1f08ee834c63b",
  "tests/kernel-deploy-live-audited-write-p22b2.test.mjs": "0aee9deeb1fb6491e2a67b8026f5ff3ccce4a3e1808b933087ea3be0bf63a8e4",
  "tests/kernel-disaster-recovery-backup-restore-p23a.test.mjs": "b59540ee938eac8fc18e2acd25fe98a000c231525351f73814ef347436d51d43",
  "planning/kernel-disaster-recovery-backup-restore-p23a.json": "a0cfdd49894d694b033f7537481ae178a0c879a1817851757fe491fc8a2db7e1",
  "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
  "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981", "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
});
const PROBE_API = Object.freeze(["HA_PROBE_CONTRACT", "awaitReplay", "destroyPrimary", "inspectStandby", "promoteStandby", "queryStandby", "rebindPrimaryAlias", "startStandby"]);
const [METHOD, ROUTE, DATABASE, SUPERUSER, ALIAS] = ["POST", "/customers", "mfk", "postgres", "db"];
const [REPLICATION_ROLE, READ_ONLY_SQL, DECISION_TABLE] = ["mfk_replication", "25006", "policy_decision_log"];
const BUSINESS_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const RUNTIME_TABLES = Object.freeze([...BUSINESS_TABLES, DECISION_TABLE].sort());
const [TS_FORM, LSN_FORM] = [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/];
const [UUID_FORM, DSN_FORM, HEX64] = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /postgres(?:ql)?:\/\//i, /^[0-9a-f]{64}$/];
// The three scope records MASTER froze for this package, bound by their published prefixes so the writer is never judged against a scope reconciled after the fact.
const [SYNTHESIS_PIN, PARENT_PIN, BLIND_PIN] = ["dc6c89ce", "84390b3a", "a4e6b419"];
// Unique per process, so one concurrent run can never sweep or adopt another run's resources.
const LABEL_VALUE = `p23b-${randomBytes(6).toString("hex")}`;
// Two values that exist nowhere else in this repository: the real runtime-role password the listener holds across the failover, and the real replication password the standby streams on.
const [SENTINEL, REPLICATION_SENTINEL] = ["p23b-sentinel-Q4mR8xW2kT7vL5nZ-do-not-log", "p23b-replication-H9jY3cB6pN1dS8gX-do-not-log"];
const TRUE_FLAGS = Object.freeze(["runtimeImplementationStarted", "hostServerSelectedForDeployArtifact", "networkListenerStarted",
  "liveHttpAuditProven", "p22Complete", "backupRestoreProven", "streamingStandbyProven", "manualFailoverProven"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed", "productionAllowed",
  "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p23Complete", "stagingEnvironmentExists", "stagingRunPerformed",
  "productionHostSelected", "registryPushed", "externalDeploymentPerformed", "highAvailabilityProven", "automaticFailoverProven",
  "splitBrainProtectionProven", "synchronousReplicationProven", "pointInTimeRecoveryProven", "migrationRollbackProven",
  "offsiteBackupExists", "automatedBackupScheduleExists", "recoveryObjectivesAgreed"]);
const UNTOUCHED = Object.freeze(["srcUntouched", "p22HarnessesUntouched", "p23aRecoverySeamUntouched", "hostDeployImageUntouched",
  "secretFileRunnerUntouched", "boundaryRunnerUntouched", "dbUntouched", "migrationsUntouched", "ciUntouched", "dependenciesUntouched", "roadmapUntouched"]);
const NON_GOALS = Object.freeze(["automatic failover", "split brain", "quorum", "synchronous replication", "connection pooler",
  "point-in-time", "wal archiv", "migration rollback", "rpo", "rto", "production", "staging", "registry", "deployment", "host port", "image", "roadmap"]);

/** Read one dotted path, so a binding table names the exact field it binds. */
const at = (node, dotted) => dotted.split(".").reduce((value, key) => value?.[key], node);
const harness = () => import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href);

/** The FIRST action of every scenario. A checkout without the probe fails HERE, naming the exact missing allowed path, BEFORE Docker is touched: RED on the absent implementation, never on a daemon or a pull. */
const requireProbe = (scenario) => import(pathToFileURL(path.join(root, PROBE_PATH)).href).catch((error) =>
  assert.fail(`[${scenario}] the allowed P23B probe ${PROBE_PATH} must exist before this scenario can run: ${error.message}`));

/** Load-bearing contract read: no P23B scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P23B manifest ${MANIFEST_PATH} must exist before this scenario can run: ${error.message}`)));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the six P23B scenario ids, in order`);
  return contract;
}

/** Exactly one ephemeral environment for the whole suite — the UNCHANGED P22B1 one, started through the UNCHANGED P22B1 harness under this run's own unique label. P23B builds no environment. */
let live = null;
const liveEnvironment = (scenario) => (live ??= requireProbe(scenario).then(harness)
  .then(async ({ LIVE_ENVIRONMENT_CONTRACT, startLiveEnvironment }) => {
    // Armed here and nowhere else — only now can a labelled resource exist, so on the absent-probe base this suite issues no Docker command at all — and the sweep is scoped to THIS run's unique label.
    const label = { key: LIVE_ENVIRONMENT_CONTRACT.labelKey, value: LABEL_VALUE };
    process.on("exit", () => {
      const filter = ["--filter", `label=${label.key}=${label.value}`];
      const listed = spawnSync("docker", ["ps", "-aq", ...filter], { encoding: "utf8" })?.stdout ?? "";
      for (const id of listed.split("\n").filter(Boolean)) spawnSync("docker", ["rm", "--force", "--volumes", id], { stdio: "ignore" });
      for (const kind of ["network", "image", "volume"]) spawnSync("docker", [kind, "prune", "--force", ...filter], { stdio: "ignore" });
    });
    return startLiveEnvironment({ runtimePassword: SENTINEL, label });
  }));

/** Every business row, and every decision row, exactly as the node being asked recorded them. The reader is a parameter because after the failover the node that answers is a DIFFERENT container. */
const businessRows = async (query, table) => (await query(`SELECT id::text AS id, tenant_id::text AS tenant_id FROM ${table} ORDER BY recorded_at`)).rows;
const decisionRows = async (query) => (await query(`SELECT id, tenant_id::text AS tenant_id, entry_hash, prev_hash, payload FROM ${DECISION_TABLE} ORDER BY recorded_at`)).rows;
/** The three ids one receipt binds to the three business tables, in this file's fixed table order. */
const boundIds = (receipt) => [receipt.resourceId, receipt.auditId, receipt.outboxEventIds[0]];
const onPrimary = (env) => (statement) => queryAsSuperuser(env, statement);
const onStandby = (probe, env) => (statement) => probe.queryStandby(env, statement);
const single = async (query, expression) => Object.values((await query(`SELECT ${expression}`)).rows[0] ?? {})[0];

/** One trusted POST /customers over live HTTP, answered by a COMMITTED receipt or by nothing at all. */
async function commitOne(scenario, env, principal) {
  const requestId = randomUUID();
  const response = await sendJsonRequest(env, { method: METHOD, route: ROUTE, body: { name: `Ada Lovelace ${requestId.slice(0, 8)}` },
    headers: { "content-type": "application/json", "x-request-id": requestId, "x-tenant-id": principal.tenantId, "x-actor-id": principal.actorId, "idempotency-key": randomUUID() } });
  const receipt = response.json?.commitReceipt;
  assert.deepEqual({ status: response.status, outcome: receipt?.outcome, requestId: receipt?.requestId, tenantId: receipt?.tenantId },
    { status: 201, outcome: "COMMITTED", requestId, tenantId: principal.tenantId }, `[${scenario}] the live listener must answer 201 with a CommitReceipt bound to this exact HTTP request; got ${JSON.stringify(response.json)}`);
  return { requestId, receipt };
}

// What the primary held and how it was reached before the failover, captured from the SERVER and never declared twice, so the promoted node is judged against the truth that really existed.
const preFailover = { receipt: null, rows: null, genesis: null, principal: null, standby: null, app: null };

test("P23B-1 the failover seam and its package contract exist, fix a path-only replication credential and a port-free standby, bind the package to MASTER's frozen scope, and preserve all nine P22/P23A surfaces byte-identical", async () => {
  const S = "P23B-1";
  const [probe, contract] = [await requireProbe(S), await requireContract(S)];
  assert.deepEqual(Object.keys(probe).sort(), [...PROBE_API], `[${S}] ${PROBE_PATH} must export exactly this API and nothing more`);
  for (const name of PROBE_API.slice(1)) assert.equal(typeof probe[name], "function", `[${S}] ${name} must be callable`);
  const ha = probe.HA_PROBE_CONTRACT;
  assert.ok(Object.isFrozen(ha), `[${S}] HA_PROBE_CONTRACT must be frozen: a mutable failover contract can be edited by the very run that must be judged against it`);
  for (const [field, want] of [["database", DATABASE], ["superuserRole", SUPERUSER], ["replicationRole", REPLICATION_ROLE],
    ["networkAlias", ALIAS], ["walMethod", "stream"], ["hostAuthMethod", "scram-sha-256"], ["credentialOnCommandLine", false],
    ["credentialInEnvironmentValue", false], ["publishesHostPort", false], ["dataDirectory", "/var/lib/postgresql/data"]])
    assert.equal(at(ha, field), want, `[${S}] the probe contract must fix ${field} to ${JSON.stringify(want)}: the one database that is replicated, the credential-free local superuser, the dedicated replication role, the alias the promoted node must answer on so the untouched listener reaches it, the real WAL streaming method, the challenge-response authentication the replication connection must use rather than any widened trust, the promise that no credential is ever a command-line argument OR an environment VALUE, the port that is never published and the data directory a real base backup lands in are decided here and nowhere else`);
  assert.match(String(ha.replicationPassfileMount ?? ""), /^\/run\/secrets\/[\w.-]+$/, `[${S}] the replication credential must reach both containers as a mounted path under /run/secrets, named by path and never by value; got ${JSON.stringify(ha.replicationPassfileMount)}`);
  // Bounded, and never looser than the environment it borrows: an unbounded wait hangs a test run instead of failing it, and a probe that outwaits its own environment reports nothing at all.
  const { LIVE_ENVIRONMENT_CONTRACT: live22b1 } = await harness();
  for (const [key, ceiling] of [["dockerCli", live22b1.timeouts.dockerCli], ["baseBackup", live22b1.timeouts.ready],
    ["promote", live22b1.timeouts.ready], ["replay", live22b1.timeouts.ready], ["ready", live22b1.timeouts.ready]])
    assert.ok(Number.isFinite(ha.timeouts?.[key]) && ha.timeouts[key] > 0 && ha.timeouts[key] <= ceiling, `[${S}] timeouts.${key} must be a finite bound of at most the P22B1 environment's own ${ceiling}ms; got ${ha.timeouts?.[key]}`);
  assert.deepEqual(Object.keys(ha.preservedHashes ?? {}).sort(), Object.keys(PRESERVED).sort(), `[${S}] the probe contract must name exactly these nine preserved surfaces`);
  for (const [file, digest] of Object.entries(PRESERVED)) {
    assert.equal(ha.preservedHashes[file], digest, `[${S}] the probe contract must record ${file} as ${digest}`);
    assert.equal(createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"), digest, `[${S}] ${file} must still hash to ${digest} in this working tree: P23B adds one failover seam beside the three existing ones and changes no harness, probe, frozen test, manifest, image, secret-wrapper or boundary-runner byte`);
  }
  const source = await readFile(path.join(root, PROBE_PATH), "utf8");
  for (const [required, why] of [[/pg_basebackup/, "take a REAL physical base backup: a standby loaded from a logical dump is a second database that merely looks alike, and it carries neither the primary's system identifier nor its WAL position"],
    [/scram-sha-256/, "authenticate the replication connection by challenge-response"]])
    assert.match(source, required, `[${S}] the failover probe must ${why}`);
  for (const [forbidden, why] of [[/^\s*FROM\s/m, "define an image of its own"], [/--privileged/, "run anything privileged"],
    [/--publish/, "publish a host port"], [/PGPASSWORD/, "put a database password in an environment variable: only PGPASSFILE, a PATH, may cross"],
    [/POSTGRES_HOST_AUTH_METHOD/, "reach for the image's authentication override"],
    [/replication[^\n]*\btrust\b/i, "widen pg_hba to trust for replication: a standby that streams without authenticating is reachable by anything that lands on that network"],
    [/live-http-postgres-environment/, "hold an importable reference to the environment harness: it is handed one environment and must never be able to start or stop one"],
    [/live-recovery-probe/, "reach into the P23A recovery seam: this package fails over, it does not restore"]])
    assert.doesNotMatch(source, forbidden, `[${S}] the failover probe must never ${why}`);
  // The package binding. Everything the writer is judged by is fixed here, before a container exists.
  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  for (const [field, want] of [["base", BASE_COMMIT], ["baseTree", BASE_TREE], ["actionplanPin", ACTIONPLAN_PIN],
    ["frozenTestPath", FROZEN_TEST_PATH], ["frozenTestSha256", digest], ["greenEvidence.targetedTest", TARGETED_TEST],
    ["splitEvidence.scopeSynthesisName", "P23B_SCOPE_SYNTHESIS_V1"], ["splitEvidence.thisPackage", "P23B"],
    ["splitEvidence.counter", "22/25"], ["provenance.singleWriter", true], ["provenance.reviewerMustBeSeparateSession", true],
    ["provenance.testAuthoring", "claude-only"], ["rollback.compensatingStepRequired", false]])
    assert.equal(at(contract, field), want, `[${S}] the manifest must record ${field} as ${JSON.stringify(want)}: the immutable base, the exact pinned Actionplan budget that owns every threshold this package is judged by, the reconciled scope name, the unmoved 22/25 counter with P23 still open, the single-writer provenance and the rollback are all bound here`);
  // The scope hashes are evidence, so they are checked as evidence: the synthesis hash must really be the digest of the scope
  // text this package was written against, and all three must be the records MASTER published BEFORE any of this was written.
  const scopeText = contract.splitEvidence?.scopeSynthesisText;
  assert.ok(typeof scopeText === "string" && scopeText.length > 80, `[${S}] the manifest must carry the scope synthesis this package was written against, in full`);
  assert.equal(contract.splitEvidence?.scopeSynthesisSha256, createHash("sha256").update(scopeText).digest("hex"), `[${S}] splitEvidence.scopeSynthesisSha256 must be the sha256 of splitEvidence.scopeSynthesisText itself`);
  const scopes = [["scopeSynthesisSha256", SYNTHESIS_PIN], ["parentScopeSha256", PARENT_PIN], ["blindScopeSha256", BLIND_PIN]];
  for (const [field, pin] of scopes) assert.ok(HEX64.test(String(contract.splitEvidence?.[field])) && String(contract.splitEvidence[field]).startsWith(pin), `[${S}] splitEvidence.${field} must be a sha256 and must be the record MASTER froze at ${pin}…, so this package is judged against the scope fixed before it was written and never against one reconciled afterwards; got ${contract.splitEvidence?.[field]}`);
  assert.equal(new Set(scopes.map(([field]) => contract.splitEvidence?.[field])).size, 3, `[${S}] the blind-frozen scope, the parent scope and the reconciled synthesis must be three distinct records`);
  assert.ok(String(contract.splitEvidence?.blindScopeDetermination ?? "").length > 40, `[${S}] the manifest must state how the blind scope was frozen before either side saw the other`);
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the three allowed P23B paths`);
  const remaining = contract.splitEvidence?.remaining ?? [];
  assert.ok(remaining.length > 0 && !remaining.includes("P23B"), `[${S}] P23 must record work still outstanding after this package, and P23B must not be among it: one proven manual failover is not a closed HA/DR phase`);
  assert.deepEqual(contract.preservedHashes, { ...PRESERVED }, `[${S}] the manifest must record the same nine untouched surfaces the probe contract does`);
  const actual = contract.budget?.actual ?? {};
  for (const key of ["grossAdditions", "grossDeletions", "net", "changedFiles"]) assert.equal(typeof actual[key], "number", `[${S}] budget.actual.${key} must be measured and recorded`);
  assert.equal(actual.changedFiles, ALLOWED_FILES.length, `[${S}] exactly ${ALLOWED_FILES.length} files change in this package`);
  assert.ok(actual.net <= 800 && actual.grossAdditions <= 800, `[${S}] the package must stay inside the class ceiling; measured net ${actual.net}, gross additions ${actual.grossAdditions}`);
  if (actual.net > 400) {
    assert.equal(contract.budget?.band, "conditional", `[${S}] a package above net 400 must draw the conditional band explicitly`);
    assert.deepEqual((contract.budget?.conditionalDeliveryGates ?? []).map((gate) => gate?.gate), ["single-narrow-problem", "bounded-file-set", "no-redundant-repetition", "no-quality-tradeoff", "full-green", "fresh-reviewer-accept", "explicit-rollback"], `[${S}] all seven canonical conditional-band gates must be recorded, in order`);
  }
  assert.ok(!JSON.stringify(contract.budget ?? {}).toLowerCase().includes("waiver"), `[${S}] no waiver may be claimed for this package`);
  assert.ok(contract.rollback?.mechanism && contract.rollback?.blastRadius, `[${S}] the rollback mechanism and blast radius must be stated`);
  for (const untouched of UNTOUCHED) assert.equal(contract.rollback?.[untouched], true, `[${S}] the manifest must record ${untouched}=true`);
  const flags = contract.readinessFlags ?? {};
  for (const flag of TRUE_FLAGS) assert.equal(flags[flag], true, `[${S}] ${flag} must be true: this package really streamed a second live copy off the primary, destroyed the primary, promoted that copy and kept the audited business running on it, and denying evidence a package carries is as wrong as claiming evidence it does not`);
  for (const flag of FALSE_FLAGS) assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P23B is ONE operator-driven failover drill inside an environment that deletes itself — nothing here detects a failure, elects a leader, fences the old primary, waits for a second copy before acknowledging a commit or reconnects a client on its own, so it is not high availability, not automatic failover, not split-brain protection, not synchronous replication, not point-in-time recovery, not a migration rollback, not an agreed recovery objective, not a deployment and not a closed P23`);
  assert.equal(Object.keys(flags).length, TRUE_FLAGS.length + FALSE_FLAGS.length, `[${S}] no readiness flag beyond the declared set may be introduced`);
  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of NON_GOALS) assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  assert.match(String(contract.capabilityDelta ?? ""), /^STREAMING_STANDBY_AND_MANUAL_FAILOVER:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
});

test("P23B-2 a REAL pg_basebackup standby of the running primary carries the primary's own system identifier, streams from it through a dedicated replication role, publishes no host port, and is reached by a credential named only by path", async () => {
  const S = "P23B-2";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);  const primary = onPrimary(env);
  for (const table of RUNTIME_TABLES) assert.equal(await single(primary, `count(*)::int AS n FROM ${table}`), 0, `[${S}] precondition: ${table} starts empty, exactly as P22B1 leaves it — every row this suite finds was written by this suite`);
  const standby = await probe.startStandby(env, { replicationPassword: REPLICATION_SENTINEL });
  assert.ok(Object.isFrozen(standby), `[${S}] the standby descriptor must be frozen: a mutable descriptor could be edited to match whatever was later promoted`);
  assert.deepEqual({ image: standby.image, database: standby.database, walMethod: standby.walMethod, role: standby.replicationRole },
    { image: env.postgres.image, database: DATABASE, walMethod: "stream", role: REPLICATION_ROLE }, `[${S}] the standby must be served by exactly the pinned image the primary really runs, replicating the one business database by real WAL streaming through the dedicated replication role: a second image or a second method would mean the thing promoted later is not the thing that was lost`);
  assert.notEqual(standby.container, env.names.postgres, `[${S}] the standby must be its own container`);
  assert.notEqual(standby.volume, env.names.volume, `[${S}] the standby must own its own data volume: a second copy that shares the primary's volume is not a second copy`);
  assert.match(standby.startedAt, TS_FORM, `[${S}] startedAt must be a canonical UTC millisecond instant; got ${JSON.stringify(standby.startedAt)}`);
  assert.ok(typeof standby.slot === "string" && standby.slot.length > 0, `[${S}] the standby must hold a named replication slot, so the primary keeps the WAL this copy has not consumed yet`);
  const query = onStandby(probe, env);  // The one fact a logical copy can never fake: a physical base backup inherits the cluster's identity.
  const [primaryId, standbyId] = [await single(primary, "system_identifier::text AS v FROM pg_control_system()"), await single(query, "system_identifier::text AS v FROM pg_control_system()")];
  assert.equal(standbyId, primaryId, `[${S}] the standby must carry the PRIMARY'S OWN system identifier ${primaryId}: a cluster with an identifier of its own was initialised fresh and merely loaded with data, and it can never replay the primary's WAL or take over its timeline; got ${standbyId}`);
  assert.equal(await single(query, "pg_is_in_recovery() AS v"), true, `[${S}] the standby must be IN RECOVERY: a second writable node beside the primary is a split brain, not a standby`);
  assert.equal(await single(query, "status AS v FROM pg_stat_wal_receiver"), "streaming", `[${S}] the standby's WAL receiver must really be streaming from the primary, not merely started`);
  assert.deepEqual((await primary(`SELECT state, sync_state, usename FROM pg_stat_replication WHERE usename = '${REPLICATION_ROLE}'`)).rows, [{ state: "streaming", sync_state: "async", usename: REPLICATION_ROLE }], `[${S}] the PRIMARY must itself report exactly one streaming replica connected as ${REPLICATION_ROLE}, asynchronously: the connection is asserted from both ends because a receiver that thinks it is streaming and a sender that has never heard of it is exactly the failure this scenario exists to catch, and the async sync_state is stated rather than assumed — nothing here waits for the standby before acknowledging a commit`);
  assert.deepEqual((await primary(`SELECT slot_name, slot_type, active FROM pg_replication_slots WHERE slot_name = '${standby.slot}'`)).rows, [{ slot_name: standby.slot, slot_type: "physical", active: true }], `[${S}] the primary must hold the standby's physical slot ACTIVE: without it the primary may recycle WAL this copy has not consumed, and the copy silently stops being a copy`);
  const container = await probe.inspectStandby(env);
  assert.equal(container?.Config?.Image, env.postgres.image, `[${S}] the running standby must be the pinned image, not whatever a tag resolves to today`);
  assert.deepEqual(container?.HostConfig?.PortBindings ?? {}, {}, `[${S}] the standby must publish no host port: a second copy of the whole business database quietly answering on the host is a second exposure nobody reviewed`);
  assert.deepEqual(Object.entries(container?.NetworkSettings?.Ports ?? {}).filter(([port, binding]) => port !== "5432/tcp" || binding !== null), [], `[${S}] the standby must publish nothing to the host: an unmapped 5432/tcp is reported by some Docker daemons as an explicit null and by others as an absent entry, and both spellings mean the very same thing — no host mapping — so what P23B freezes is the invariant and not one daemon's wording; got ${JSON.stringify(container?.NetworkSettings?.Ports ?? {})}`);
  assert.deepEqual(Object.keys(container?.NetworkSettings?.Networks ?? {}), [env.network], `[${S}] the standby must be attached to exactly the one internal network and never to the default bridge`);
  assert.ok(!(container?.NetworkSettings?.Networks?.[env.network]?.Aliases ?? []).includes(ALIAS), `[${S}] the standby must NOT answer on the ${ALIAS} alias while the primary is alive: two containers behind the name the listener writes to is a split brain waiting for a DNS answer`);
  const inspected = JSON.stringify(container);
  for (const [leak, why] of [[new RegExp(REPLICATION_SENTINEL), "the replication password must never be handed to the standby as an environment value or an argument: it reaches both ends as a mounted file named by path, and an inspect output is readable by anyone who can reach the daemon for as long as the container exists"],
    [new RegExp(SENTINEL), "the runtime credential the listener holds must never appear in the standby's record"],
    [/POSTGRES_PASSWORD=/, "no superuser password may appear anywhere in the standby's inspect output — not in its Env, its Cmd, its Args, its Entrypoint or its labels"],
    [DSN_FORM, "no connection string may appear in the standby's inspect output"]]) assert.doesNotMatch(inspected, leak, `[${S}] ${why}`);
  for (const entry of (container?.Config?.Env ?? []).filter((value) => /PASS/i.test(value))) assert.match(entry, /^(?:PGPASSFILE|[A-Z_]+_FILE)=\/run\/secrets\/[\w.-]+$/, `[${S}] every credential-bearing variable on the standby must carry a PATH under the read-only secret mount and never a value; got ${entry}`);
  preFailover.standby = standby;
});

test("P23B-3 one trusted write committed on the primary really arrives on the standby — proven by replayed LSN and by all four tables — while the standby refuses a write of its own with PostgreSQL's own SQLSTATE 25006", async () => {
  const S = "P23B-3";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  assert.ok(preFailover.standby, `[${S}] precondition: the P23B-2 standby must already be streaming`);
  const [primary, query] = [onPrimary(env), onStandby(probe, env)];
  const principal = await readTrustedPrincipal(env);  const { requestId, receipt } = await commitOne(S, env, principal);
  const commitLsn = await single(primary, "pg_current_wal_lsn()::text AS v");
  assert.match(commitLsn, LSN_FORM, `[${S}] the primary must report a real WAL position for the committed write; got ${commitLsn}`);
  const replayed = await probe.awaitReplay(env, commitLsn);
  assert.ok(Object.isFrozen(replayed), `[${S}] the replay descriptor must be frozen`);
  assert.equal(replayed.targetLsn, commitLsn, `[${S}] the replay must have been waited for against the primary's own commit position`);
  assert.equal(await single(query, `(pg_last_wal_replay_lsn() >= '${commitLsn}'::pg_lsn) AS v`), true, `[${S}] the standby must have replayed AT LEAST the primary's position at commit time, asked of the standby here rather than taken from the descriptor: a copy that is merely connected is not a copy that is current, and every table comparison below would otherwise be a race`);
  // The truth that must survive the failover is read from BOTH servers, and never from the receipt.
  const rows = Object.fromEntries(await Promise.all(BUSINESS_TABLES.map(async (table) => [table, await businessRows(primary, table)])));
  BUSINESS_TABLES.forEach((table, index) => assert.deepEqual(rows[table], [{ id: boundIds(receipt)[index], tenant_id: principal.tenantId }], `[${S}] ${table} must hold exactly one row on the primary: the one the receipt names, filed under the trusted tenant`));
  for (const table of BUSINESS_TABLES) assert.deepEqual(await businessRows(query, table), rows[table], `[${S}] ${table} on the STANDBY must hold exactly the rows the primary holds, with the same ids under the same tenant — no row missing and no row invented`);
  const decisions = await decisionRows(primary);
  assert.equal(decisions.length, 1, `[${S}] the audited allow must record exactly one decision`);  const [genesis] = decisions;
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis), { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: principal.tenantId, entryHash: genesis.entry_hash, prevHash: null }, `[${S}] the genesis must verify independently, recomputed from its own persisted payload, as the head of this tenant's chain`);
  assert.equal(genesis.payload.traceId, requestId, `[${S}] the genesis must carry this request's own trace id`);
  const replica = await decisionRows(query);
  assert.deepEqual(replica.map((row) => [row.id, row.entry_hash, row.prev_hash]), [[genesis.id, genesis.entry_hash, null]], `[${S}] the standby's decision log must be the same one entry with the same hash and still the head of the chain: an audit trail that does not stream is an audit trail that a failover loses`);
  assert.deepEqual(verifyPersistedDecisionLogRow(replica[0]), verifyPersistedDecisionLogRow(genesis), `[${S}] the replicated decision must still verify independently, recomputed from the payload that really arrived on the standby`);
  await assert.rejects(query(`DELETE FROM ${DECISION_TABLE}`), (error) => {
    assert.equal(error.code, READ_ONLY_SQL, `[${S}] the standby must be refused the write by PostgreSQL ITSELF with SQLSTATE ${READ_ONLY_SQL}, not by a guard this test or this probe invented; got ${error.code}: ${error.message}`);
    return true;
  }, `[${S}] nothing may delete an audited decision on the standby: while the primary is alive the second copy accepts no write at all, and the audit trail is the write it must refuse most`);
  // The listener's identity BEFORE the failover, so P23B-5 can prove it was never restarted.
  const app = await env.inspect("app");  Object.assign(preFailover, { receipt, rows, genesis, principal, app: { startedAt: app?.State?.StartedAt, pid: app?.State?.Pid, restartCount: app?.RestartCount } });
  assert.ok(preFailover.app.startedAt && preFailover.app.pid > 0, `[${S}] the running listener must have a readable start instant and pid to compare against after the failover`);
});

test("P23B-4 destroying the primary container AND its volume is a total loss that leaves the standby still UNPROMOTED and the untouched listener failing closed, without leaking the credential it still holds", async () => {
  const S = "P23B-4";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  const { collectLabelledResources } = await harness();
  assert.ok(preFailover.genesis, `[${S}] precondition: the pre-failover truth must already be on record`);
  const loss = await probe.destroyPrimary(env);
  assert.ok(Object.isFrozen(loss), `[${S}] the loss descriptor must be frozen`);
  assert.deepEqual({ container: loss.container, volume: loss.volume, removedContainer: loss.removedContainer, removedVolume: loss.removedVolume },
    { container: env.names.postgres, volume: env.names.volume, removedContainer: true, removedVolume: true }, `[${S}] the loss must name and really remove BOTH the primary container and the data volume under it: a container removed while its volume survives is a restart, and a failover drill that could be undone by starting the old node again proves nothing`);
  await assert.rejects(env.inspect("postgres"), `[${S}] the primary must be gone from the DAEMON, not merely stopped: the daemon is asked because an exit status only says a command ran`);
  await assert.rejects(queryAsSuperuser(env, "SELECT 1 AS n"), `[${S}] no read may still reach the primary: the loss is real, never simulated`);
  assert.ok(!(await collectLabelledResources(env.label)).volumes.includes(env.names.volume), `[${S}] the primary's data volume ${env.names.volume} must no longer exist: everything written before the loss now lives only on the standby`);
  const query = onStandby(probe, env);  // Nothing has promoted anything yet: this is the whole point of asking now rather than after.
  assert.equal(await single(query, "pg_is_in_recovery() AS v"), true, `[${S}] the standby must still be IN RECOVERY after the primary is destroyed: nothing in this system detects a failure or elects a leader, the promotion is an operator's deliberate act in P23B-5, and a standby that promoted itself here would be the automatic failover this package explicitly does not claim`);
  assert.deepEqual(await businessRows(query, BUSINESS_TABLES[0]), preFailover.rows[BUSINESS_TABLES[0]], `[${S}] the standby must still hold the pre-loss truth while it waits, unpromoted`);
  // The listener is untouched by the loss, still holds its mounted credential, and still fails closed.
  assert.equal((await env.inspect("app"))?.State?.Running, true, `[${S}] the application container must still be running: a lost database must not take the listener down with it`);
  assert.ok((await readFile(path.join(env.secretDir, "database-url.txt"), "utf8")).includes(SENTINEL), `[${S}] positive control: the credential the listener still holds must really be the live one, or a silent response below would prove nothing`);
  const response = await sendJsonRequest(env, { method: METHOD, route: ROUTE, body: { name: "Ada Lovelace" },
    headers: { "content-type": "application/json", "x-request-id": randomUUID(), "x-tenant-id": preFailover.principal.tenantId, "x-actor-id": preFailover.principal.actorId, "idempotency-key": randomUUID() } });
  // The exact 5xx code belongs to the unchanged host bridge and is deliberately not frozen a second time here;
  // what P23B owns is that the answer is a failure, carries no receipt, and claims nothing.
  assert.ok(response.status >= 500 && response.status < 600, `[${S}] a write sent while the ${ALIAS} name still points at a destroyed primary must fail closed with a server error; got ${response.status} ${response.body}`);
  assert.equal(response.json?.commitReceipt, undefined, `[${S}] a failed write must carry no CommitReceipt`);
  assert.doesNotMatch(response.body, /COMMITTED/, `[${S}] nothing in the answer may claim a commit that never happened; got ${response.body}`);
  for (const [leak, why] of [[SENTINEL, "the runtime password"], [REPLICATION_SENTINEL, "the replication password"]]) assert.ok(!response.body.includes(leak), `[${S}] ${why} must never reach an HTTP client, least of all through a failure it did not expect`);
  assert.doesNotMatch(response.body, DSN_FORM, `[${S}] no connection string may reach an HTTP client`);
  assert.equal((await decisionRows(query)).length, 1, `[${S}] the failed write must have left no ghost decision on the surviving copy`);
});

test("P23B-5 promoting the standby ends recovery, advances the timeline, and rebinds the db alias onto the promoted node — with the application container never restarted", async () => {
  const S = "P23B-5";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  const query = onStandby(probe, env);  const timelineBefore = await single(query, "timeline_id AS v FROM pg_control_checkpoint()");
  const promotion = await probe.promoteStandby(env);
  assert.ok(Object.isFrozen(promotion), `[${S}] the promotion descriptor must be frozen`);
  assert.deepEqual({ container: promotion.container, inRecovery: promotion.inRecovery }, { container: preFailover.standby.container, inRecovery: false }, `[${S}] the promotion must name the very container that was streaming and report recovery ended`);
  assert.match(promotion.promotedAt, TS_FORM, `[${S}] promotedAt must be a canonical UTC millisecond instant; got ${JSON.stringify(promotion.promotedAt)}`);
  assert.equal(await single(query, "pg_is_in_recovery() AS v"), false, `[${S}] the promoted node must report recovery ENDED when asked itself, not merely in a descriptor: a node still in recovery accepts no write, and the business does not continue on it`);
  const timelineAfter = await single(query, "timeline_id AS v FROM pg_control_checkpoint()");
  assert.equal(timelineBefore, promotion.timelineBefore, `[${S}] the promotion must have been taken from the timeline the standby really stood on`);
  assert.ok(Number.isInteger(timelineAfter) && timelineAfter > timelineBefore, `[${S}] the promoted node must stand on a NEW timeline, greater than the ${timelineBefore} it replayed: the timeline is what makes the old primary's WAL and the new one's divergent histories rather than one history, and it is the only durable record that a promotion — and not a restart — happened here; got ${timelineAfter}`);
  const rebound = await probe.rebindPrimaryAlias(env);
  assert.ok(Object.isFrozen(rebound), `[${S}] the rebinding descriptor must be frozen`);
  assert.deepEqual({ alias: rebound.alias, container: rebound.container, network: rebound.network }, { alias: ALIAS, container: preFailover.standby.container, network: env.network }, `[${S}] the ${ALIAS} name the untouched listener writes to must now resolve to the promoted node on the one internal network: the listener holds a credential naming a HOST, and moving the name is what lets a running application follow a failover without being re-credentialed or re-deployed`);
  assert.match(rebound.reboundAt, TS_FORM, `[${S}] reboundAt must be a canonical UTC millisecond instant; got ${JSON.stringify(rebound.reboundAt)}`);
  const container = await probe.inspectStandby(env);
  assert.ok((container?.NetworkSettings?.Networks?.[env.network]?.Aliases ?? []).includes(ALIAS), `[${S}] the daemon itself must report the ${ALIAS} alias on the promoted container, read back rather than inferred from an exit status`);
  assert.deepEqual(container?.HostConfig?.PortBindings ?? {}, {}, `[${S}] the promoted node must STILL publish no host port: a failover is not the moment a database quietly becomes reachable from the host`);
  assert.doesNotMatch(JSON.stringify(container), new RegExp(`${REPLICATION_SENTINEL}|${SENTINEL}`), `[${S}] no credential may have been written into the promoted container's record by the promotion`);
  // The one claim that distinguishes a failover from a redeploy: the application never went away.
  const app = await env.inspect("app");
  assert.deepEqual({ running: app?.State?.Running, startedAt: app?.State?.StartedAt, pid: app?.State?.Pid, restartCount: app?.RestartCount },
    { running: true, startedAt: preFailover.app.startedAt, pid: preFailover.app.pid, restartCount: preFailover.app.restartCount }, `[${S}] the application container must be the SAME process it was before the primary died — same start instant, same pid, restart count unmoved: if the listener had to be restarted, or a supervisor restarted it, then what happened was a redeploy with an outage in the middle and not a failover, and the whole claim of this package would be about the operator's speed rather than the system's behaviour`);
});

test("P23B-6 a second trusted write commits on the promoted node through the never-restarted listener and chains onto the entry hash the chain had BEFORE the failover, and teardown leaves zero labelled resources and no secret on disk", async () => {
  const S = "P23B-6";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  const { collectLabelledResources, stopLiveEnvironment } = await harness();  const query = onStandby(probe, env);
  try {
    assert.ok(preFailover.genesis, `[${S}] precondition: the pre-failover genesis must be on record`);
    const { receipt } = await commitOne(S, env, preFailover.principal);
    assert.match(receipt.resourceId, UUID_FORM, `[${S}] the post-failover receipt must name a canonical resource id`);
    assert.notEqual(receipt.resourceId, preFailover.receipt.resourceId, `[${S}] the post-failover write must be a second customer, not a replay of the one that survived`);
    for (const [index, table] of BUSINESS_TABLES.entries()) assert.deepEqual(await businessRows(query, table), [...preFailover.rows[table], { id: boundIds(receipt)[index], tenant_id: preFailover.principal.tenantId }], `[${S}] ${table} must now hold the streamed row AND the new one, in that order: the history that survived the lost node and the business that continued after it live in the same table on the promoted node`);
    const decisions = await decisionRows(query);
    assert.equal(decisions.length, 2, `[${S}] the streamed genesis and exactly one new decision must be on record`);
    const successor = decisions[1];  verifyPersistedDecisionLogRow(successor);
    assert.equal(successor.prev_hash, preFailover.genesis.entry_hash, `[${S}] the post-failover decision must chain onto the entry hash the genesis had BEFORE the primary was destroyed: the tamper-evident chain must survive a failover as ONE chain, because a chain that restarts on the new node cannot prove what the old node had already decided`);
    assert.equal(successor.payload.decision, "allow", `[${S}] the post-failover write must have been allowed by a recorded decision`);
    assert.equal(await single(query, "pg_is_in_recovery() AS v"), false, `[${S}] the node that accepted this write must be the promoted one, still out of recovery`);
  } finally {
    await stopLiveEnvironment(env).catch(() => {});
  }
  const survivors = await collectLabelledResources(env.label);
  for (const kind of ["containers", "networks", "imageTags", "volumes", "secretDirs"]) assert.deepEqual(survivors[kind], [], `[${S}] no labelled ${kind} may outlive this run — including the container and the volume the STANDBY created, which must carry the same label so the unchanged P22B1 teardown removes them; got ${JSON.stringify(survivors[kind])}`);
  const leftovers = (await readdir(tmpdir()).catch(() => [])).filter((entry) => entry.startsWith(LABEL_VALUE));
  assert.deepEqual(leftovers, [], `[${S}] no directory or file this run created may be left in ${tmpdir()}: the replication credential crossed as a file on this host, and the P22B1 teardown only knows the secret directory IT made — anything the failover seam wrote for itself is the failover seam's to remove; got ${JSON.stringify(leftovers)}`);
});
