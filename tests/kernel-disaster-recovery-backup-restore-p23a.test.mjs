import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPersistedDecisionLogRow } from "../src/adapters/postgres-decision-log-adapter.mjs";
import { queryAsSuperuser, readTrustedPrincipal, sendJsonRequest } from "./_harness/live-audited-write-probe.mjs";

// P23A — disaster recovery: one verified backup, one total loss of the database, one restore, and the
// proof that the audited truth came back and kept going. P22 closed with a real POST /customers
// committing over live HTTP inside the frozen deploy artifact, and with the database that carried it
// deleted at the end of the run: nothing had ever been taken out of that database and put back. This
// frozen test owns every fixed expectation for the package that closes that gap inside the SAME
// unchanged P22B1 environment — a credential-free custom-format dump of exactly the mfk database with
// a recomputable sha256, an owner-only mode and a real capture instant; the database container AND its
// data volume destroyed, so the loss is total and the still-running listener fails closed without
// leaking the credential it still holds; the dump restored into a fresh volume served by the SAME
// pinned image, bringing back the migration head, the exact four-table truth, the non-superuser roles,
// forced row-level security and the independently verifiable decision chain; and a second trusted
// write that commits and chains onto the restored genesis before the UNCHANGED P22B1 teardown leaves
// zero labelled resources behind. P23A adds ONE recovery seam beside the two P22 harnesses: it starts
// no environment, defines no image, publishes no port and puts no credential on a command line, and
// every HTTP request, verification read and trusted principal comes from the UNCHANGED P22B2 probe —
// the six sha256 below are the proof of that, checked against the working tree. This is not high
// availability, not a migration rollback, not point-in-time recovery, and it agrees no recovery
// objective: it is one backup, one loss and one restore, proven end to end. The manifest gates the run
// and never supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_TEST_PATH = "tests/kernel-disaster-recovery-backup-restore-p23a.test.mjs";
const PROBE_PATH = "tests/_harness/live-recovery-probe.mjs";
const MANIFEST_PATH = "planning/kernel-disaster-recovery-backup-restore-p23a.json";
const LIVE_HARNESS_PATH = "tests/_harness/live-http-postgres-environment.mjs";
const WRITE_PROBE_PATH = "tests/_harness/live-audited-write-probe.mjs";
const ALLOWED_FILES = Object.freeze([FROZEN_TEST_PATH, PROBE_PATH, MANIFEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P23A-1", "P23A-2", "P23A-3", "P23A-4", "P23A-5"]);
const [BASE_COMMIT, BASE_TREE] = ["aa15580462d6d261e693c0c617fcac15f75be593", "136dfe6c766630efbceffd5842b209c1ff0b24d8"];
// The canonical Actionplan change-package budget is the sole owner of every threshold; this test binds
// the manifest to that consumer at one exact pinned commit and duplicates no number of its own.
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The six surfaces P23A must leave byte-identical: both P22 harnesses it borrows whole, the frozen test
// that owns the write path it re-proves, the image, the P22A1 secret wrapper and the audited JS
// boundary runner every request here really travels through.
const PRESERVED = Object.freeze({
  [LIVE_HARNESS_PATH]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
  [WRITE_PROBE_PATH]: "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
  "tests/kernel-deploy-live-audited-write-p22b2.test.mjs": "0aee9deeb1fb6491e2a67b8026f5ff3ccce4a3e1808b933087ea3be0bf63a8e4",
  "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
  "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
  "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
});
const PROBE_API = Object.freeze(["RECOVERY_PROBE_CONTRACT", "captureBackup", "databaseReachable", "destroyDatabase", "restoreDatabase"]);
const [METHOD, ROUTE, DATABASE, SUPERUSER, ALIAS] = ["POST", "/customers", "mfk", "postgres", "db"];
const ROLES = Object.freeze({ migration: "mfk_migration", runtime: "mfk_runtime" });
const BUSINESS_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const DECISION_TABLE = "policy_decision_log";
const RUNTIME_TABLES = Object.freeze([...BUSINESS_TABLES, DECISION_TABLE].sort());
const [MIGRATION_HEAD, INSUFFICIENT_PRIVILEGE, BACKUP_MODE, DUMP_MAGIC] = ["0003_policy_decision_log", "42501", 0o600, "PGDMP"];
const TS_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const [UUID_FORM, DSN_FORM, HEX64] = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /postgres(?:ql)?:\/\//i, /^[0-9a-f]{64}$/];
// Unique per process, so one concurrent run can never sweep or adopt another run's resources.
const LABEL_VALUE = `p23a-${randomBytes(6).toString("hex")}`;
// One value that exists nowhere else in this repository; it is the real runtime-role password, and it
// is the credential the listener still holds while its database is gone.
const SENTINEL = "p23a-sentinel-B6nK4rV7xJ2wF9tQ-do-not-log";
const TRUE_FLAGS = Object.freeze(["runtimeImplementationStarted", "hostServerSelectedForDeployArtifact",
  "networkListenerStarted", "liveHttpAuditProven", "p22Complete", "backupRestoreProven"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p23Complete", "stagingEnvironmentExists",
  "stagingRunPerformed", "productionHostSelected", "registryPushed", "externalDeploymentPerformed",
  "highAvailabilityProven", "pointInTimeRecoveryProven", "migrationRollbackProven", "offsiteBackupExists",
  "automatedBackupScheduleExists", "recoveryObjectivesAgreed"]);
const UNTOUCHED = Object.freeze(["srcUntouched", "p22HarnessesUntouched", "hostDeployImageUntouched",
  "secretFileRunnerUntouched", "boundaryRunnerUntouched", "dbUntouched", "migrationsUntouched", "ciUntouched",
  "dependenciesUntouched", "roadmapUntouched"]);
const NON_GOALS = Object.freeze(["high availability", "failover", "migration rollback", "point-in-time", "wal", "rpo",
  "rto", "production", "staging", "registry", "deployment", "host port", "image", "roadmap", "schedule", "offsite"]);

/** Read one dotted path, so a binding table names the exact field it binds. */
const at = (node, dotted) => dotted.split(".").reduce((value, key) => value?.[key], node);
const harness = () => import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href);

/** The FIRST action of every scenario. A checkout without the probe fails HERE, naming the exact missing
 * allowed path, BEFORE Docker is touched: RED on the absent implementation, never on a daemon or a pull. */
const requireProbe = (scenario) =>
  import(pathToFileURL(path.join(root, PROBE_PATH)).href).catch((error) =>
    assert.fail(`[${scenario}] the allowed P23A probe ${PROBE_PATH} must exist before this scenario can run: ${error.message}`));

/** Load-bearing contract read: no P23A scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P23A manifest ${MANIFEST_PATH} must exist before this scenario can run: ${error.message}`)));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the five P23A scenario ids, in order`);
  return contract;
}

/** Exactly one ephemeral environment for the whole suite — the UNCHANGED P22B1 one, started through the
 * UNCHANGED P22B1 harness under this run's own unique label. P23A builds no environment. */
let live = null;
let backupDir = null;
const liveEnvironment = (scenario) => (live ??= requireProbe(scenario).then(harness)
  .then(async ({ LIVE_ENVIRONMENT_CONTRACT, startLiveEnvironment }) => {
    // Armed here and nowhere else — only now can a labelled resource exist, so on the absent-probe base
    // this suite issues no Docker command at all — and the sweep is scoped to THIS run's unique label.
    const label = { key: LIVE_ENVIRONMENT_CONTRACT.labelKey, value: LABEL_VALUE };
    process.on("exit", () => {
      const filter = ["--filter", `label=${label.key}=${label.value}`];
      const listed = spawnSync("docker", ["ps", "-aq", ...filter], { encoding: "utf8" })?.stdout ?? "";
      for (const id of listed.split("\n").filter(Boolean)) spawnSync("docker", ["rm", "--force", "--volumes", id], { stdio: "ignore" });
      for (const kind of ["network", "image", "volume"]) spawnSync("docker", [kind, "prune", "--force", ...filter], { stdio: "ignore" });
      if (backupDir) rmSync(backupDir, { recursive: true, force: true });
    });
    backupDir = await mkdtemp(path.join(tmpdir(), `${LABEL_VALUE}-backup-`));
    return startLiveEnvironment({ runtimePassword: SENTINEL, label });
  }));

/** Every business row, and every decision row, exactly as the server recorded them. */
const businessRows = async (env, table) => (await queryAsSuperuser(env,
  `SELECT id::text AS id, tenant_id::text AS tenant_id FROM ${table} ORDER BY recorded_at`)).rows;
const decisionRows = async (env) => (await queryAsSuperuser(env,
  `SELECT id, tenant_id::text AS tenant_id, entry_hash, prev_hash, payload FROM ${DECISION_TABLE} ORDER BY recorded_at`)).rows;
/** The three ids one receipt binds to the three business tables, in this file's fixed table order. */
const boundIds = (receipt) => [receipt.resourceId, receipt.auditId, receipt.outboxEventIds[0]];

/** One trusted POST /customers over live HTTP, answered by a COMMITTED receipt or by nothing at all. */
async function commitOne(scenario, env, principal) {
  const requestId = randomUUID();
  const response = await sendJsonRequest(env, {
    method: METHOD, route: ROUTE, body: { name: `Ada Lovelace ${requestId.slice(0, 8)}` },
    headers: { "content-type": "application/json", "x-request-id": requestId,
      "x-tenant-id": principal.tenantId, "x-actor-id": principal.actorId, "idempotency-key": randomUUID() },
  });
  const receipt = response.json?.commitReceipt;
  assert.deepEqual({ status: response.status, outcome: receipt?.outcome, requestId: receipt?.requestId, tenantId: receipt?.tenantId },
    { status: 201, outcome: "COMMITTED", requestId, tenantId: principal.tenantId }, `[${scenario}] the live listener must answer 201 with a CommitReceipt bound to this exact HTTP request; got ${JSON.stringify(response.json)}`);
  return { requestId, receipt };
}

// What P23A-2 wrote and backed up, and what P23A-4 must find again after the loss. It is captured from
// the server before the disaster and compared to the server after it, so the restore is judged against
// the truth that really existed and never against a shape this test declared twice.
const preLoss = { receipt: null, rows: null, genesis: null, backup: null, principal: null };

test("P23A-1 the recovery seam and its package contract exist, fix a credential-free custom dump and a pinned restore, bind the package, and preserve all six P22 surfaces byte-identical", async () => {
  const S = "P23A-1";
  const probe = await requireProbe(S);
  const contract = await requireContract(S);
  assert.deepEqual(Object.keys(probe).sort(), [...PROBE_API], `[${S}] ${PROBE_PATH} must export exactly this API and nothing more`);
  for (const name of PROBE_API.slice(1)) assert.equal(typeof probe[name], "function", `[${S}] ${name} must be callable`);
  const recovery = probe.RECOVERY_PROBE_CONTRACT;
  assert.ok(Object.isFrozen(recovery), `[${S}] RECOVERY_PROBE_CONTRACT must be frozen: a mutable recovery contract can be edited by the very run that must be judged against it`);
  for (const [field, want] of [["database", DATABASE], ["backupRole", SUPERUSER], ["backupFormat", "custom"],
    ["backupFileMode", BACKUP_MODE], ["credentialOnCommandLine", false], ["publishesHostPort", false],
    ["networkAlias", ALIAS], ["migrationRole", ROLES.migration], ["runtimeRole", ROLES.runtime]]) {
    assert.equal(at(recovery, field), want, `[${S}] the probe contract must fix ${field} to ${JSON.stringify(want)}: the one database that is dumped, the credential-free local role that dumps it, the custom archive format, the owner-only file mode, the promise that no credential is ever a command-line argument, the port that is never published, the alias the restored database must answer on and the two roles it must be reachable through are decided here and nowhere else`);
  }
  // Bounded, and never looser than the environment it borrows: an unbounded wait hangs a test run
  // instead of failing it, and a probe that outwaits its own environment reports nothing at all.
  const { LIVE_ENVIRONMENT_CONTRACT: live22b1 } = await harness();
  for (const [key, ceiling] of [["dockerCli", live22b1.timeouts.dockerCli], ["backup", live22b1.timeouts.ready],
    ["restore", live22b1.timeouts.ready], ["ready", live22b1.timeouts.ready]]) {
    const bound = recovery.timeouts?.[key]; assert.ok(Number.isFinite(bound) && bound > 0 && bound <= ceiling, `[${S}] timeouts.${key} must be a finite bound of at most the P22B1 environment's own ${ceiling}ms; got ${bound}`);
  }
  assert.deepEqual(Object.keys(recovery.preservedHashes ?? {}).sort(), Object.keys(PRESERVED).sort(), `[${S}] the probe contract must name exactly these six preserved surfaces`);
  for (const [file, digest] of Object.entries(PRESERVED)) {
    assert.equal(recovery.preservedHashes[file], digest, `[${S}] the probe contract must record ${file} as ${digest}`);
    assert.equal(createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"), digest, `[${S}] ${file} must still hash to ${digest} in this working tree: P23A adds one recovery seam beside the two P22 harnesses and changes no harness, probe, image, secret-wrapper or boundary-runner byte`);
  }
  const source = await readFile(path.join(root, PROBE_PATH), "utf8");
  for (const [forbidden, why] of [[/^\s*FROM\s/m, "define an image of its own"], [/--privileged/, "run anything privileged"],
    [/--publish/, "publish a host port"], [/PGPASSWORD/, "put a database password in an environment variable"],
    [/pg_dumpall/, "dump the whole cluster: a cluster dump carries every role's password hash, and this backup must carry none"],
    [/live-http-postgres-environment/, "hold an importable reference to the environment harness: it is handed one environment and must never be able to start or stop one"]]) {
    assert.doesNotMatch(source, forbidden, `[${S}] the recovery probe must never ${why}`);
  }
  // The package binding. Everything the writer is judged by is fixed here, before a container exists.
  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  for (const [field, want] of [["base", BASE_COMMIT], ["baseTree", BASE_TREE], ["actionplanPin", ACTIONPLAN_PIN],
    ["frozenTestPath", FROZEN_TEST_PATH], ["frozenTestSha256", digest], ["greenEvidence.targetedTest", TARGETED_TEST],
    ["splitEvidence.scopeSynthesisName", "P23A_SCOPE_SYNTHESIS_V1"], ["splitEvidence.thisPackage", "P23A"],
    ["splitEvidence.counter", "22/25"], ["environmentPins.migrationHead", MIGRATION_HEAD],
    ["provenance.singleWriter", true], ["provenance.reviewerMustBeSeparateSession", true],
    ["provenance.testAuthoring", "claude-only"], ["rollback.compensatingStepRequired", false]]) {
    assert.equal(at(contract, field), want, `[${S}] the manifest must record ${field} as ${JSON.stringify(want)}: the immutable base, the exact pinned Actionplan budget that owns every threshold this package is judged by, the reconciled scope name, the unmoved 22/25 counter with P23 still open, the migration head the restore must bring back, the single-writer provenance and the rollback are all bound here`);
  }
  // The scope hashes are evidence, so they are checked as evidence: the synthesis hash must really be
  // the digest of the scope text this package was written against, not a hex constant beside it.
  const scopeText = contract.splitEvidence?.scopeSynthesisText;
  assert.ok(typeof scopeText === "string" && scopeText.length > 80, `[${S}] the manifest must carry the scope synthesis this package was written against, in full`);
  assert.equal(contract.splitEvidence?.scopeSynthesisSha256, createHash("sha256").update(scopeText).digest("hex"), `[${S}] splitEvidence.scopeSynthesisSha256 must be the sha256 of splitEvidence.scopeSynthesisText itself`);
  const scopes = [contract.splitEvidence?.scopeSynthesisSha256, contract.splitEvidence?.parentScopeSha256, contract.splitEvidence?.blindScopeSha256];
  for (const hash of scopes) assert.match(String(hash), HEX64, `[${S}] every recorded scope hash must be a sha256; got ${hash}`);
  assert.equal(new Set(scopes).size, 3, `[${S}] the blind-frozen scope, the parent scope and the reconciled synthesis must be three distinct records`);
  assert.ok(String(contract.splitEvidence?.blindScopeDetermination ?? "").length > 40, `[${S}] the manifest must state how the blind scope was frozen before either side saw the other`);
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the three allowed P23A paths`);
  const remaining = contract.splitEvidence?.remaining ?? [];
  assert.ok(remaining.length > 0 && !remaining.includes("P23A"), `[${S}] P23 must record work still outstanding after this package, and P23A must not be among it: one proven restore is not a closed HA/DR phase`);
  assert.deepEqual(contract.preservedHashes, { ...PRESERVED }, `[${S}] the manifest must record the same six untouched surfaces the probe contract does`);
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
  for (const flag of TRUE_FLAGS) assert.equal(flags[flag], true, `[${S}] ${flag} must be true: this package really took a verified backup out of a live audited database, destroyed that database, restored it and wrote to it again, and denying evidence a package carries is as wrong as claiming evidence it does not`);
  for (const flag of FALSE_FLAGS) assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P23A is one backup, one loss and one restore inside an environment that deletes itself — not high availability, not point-in-time recovery, not a migration rollback, not a scheduled or offsite backup, not an agreed recovery objective, not a staging run, not a deployment and not a closed P23`);
  assert.equal(Object.keys(flags).length, TRUE_FLAGS.length + FALSE_FLAGS.length, `[${S}] no readiness flag beyond the declared set may be introduced`);
  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of NON_GOALS) assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  assert.match(String(contract.capabilityDelta ?? ""), /^VERIFIED_BACKUP_AND_RESTORE:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
});

test("P23A-2 one trusted write commits over live HTTP, and the environment yields a credential-free custom-format backup of exactly that database whose digest, owner-only mode and capture instant are all independently recomputable", async () => {
  const S = "P23A-2";
  const probe = await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  const principal = await readTrustedPrincipal(env);
  for (const table of RUNTIME_TABLES) assert.equal((await queryAsSuperuser(env, `SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n, 0, `[${S}] precondition: ${table} starts empty, exactly as P22B1 leaves it — every row this suite finds was written by this suite`);
  const { requestId, receipt } = await commitOne(S, env, principal);
  // The truth that must survive the disaster is read back from the server, not taken from the receipt.
  const rows = Object.fromEntries(await Promise.all(BUSINESS_TABLES.map(async (table) => [table, await businessRows(env, table)])));
  BUSINESS_TABLES.forEach((table, index) => assert.deepEqual(rows[table], [{ id: boundIds(receipt)[index], tenant_id: principal.tenantId }], `[${S}] ${table} must hold exactly one row in the whole database: the one the receipt names, filed under the trusted tenant`));
  const decisions = await decisionRows(env);
  assert.equal(decisions.length, 1, `[${S}] the audited allow must record exactly one decision`);
  const [genesis] = decisions;
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis),
    { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: principal.tenantId, entryHash: genesis.entry_hash, prevHash: null }, `[${S}] the genesis must verify independently, recomputed from its own persisted payload, as the head of this tenant's chain`);
  assert.equal(genesis.payload.traceId, requestId, `[${S}] the genesis must carry this request's own trace id`);
  Object.assign(preLoss, { receipt, rows, genesis, principal });
  const before = Date.now();
  const backup = await probe.captureBackup(env, { directory: backupDir });
  const after = Date.now();
  assert.ok(Object.isFrozen(backup), `[${S}] the backup descriptor must be frozen: a mutable descriptor could be edited to match whatever was restored`);
  for (const [field, want] of [["database", DATABASE], ["role", SUPERUSER], ["format", "custom"], ["mode", BACKUP_MODE]]) {
    assert.equal(backup[field], want, `[${S}] the backup must record ${field} as ${JSON.stringify(want)}: it is a custom-format archive of exactly the mfk database, taken by the credential-free local role, written for its owner alone`);
  }
  assert.equal(path.dirname(backup.path), backupDir, `[${S}] the backup must be written into the directory it was given and nowhere else; got ${backup.path}`);
  const [bytes, stats] = [await readFile(backup.path), await stat(backup.path)];
  assert.equal(stats.mode & 0o777, BACKUP_MODE, `[${S}] the backup file on disk must really be mode ${BACKUP_MODE.toString(8)}: a business database in a world-readable file is a second copy of the data with none of its protections; got ${(stats.mode & 0o777).toString(8)}`);
  assert.equal(backup.bytes, stats.size, `[${S}] the recorded size must be the file's real size`);
  assert.ok(stats.size > 0, `[${S}] an empty backup is not a backup`);
  assert.equal(backup.sha256, createHash("sha256").update(bytes).digest("hex"), `[${S}] the recorded sha256 must be the digest of the bytes really on disk, recomputed here rather than trusted: a backup nobody can verify is a backup nobody can rely on`);
  assert.equal(bytes.subarray(0, DUMP_MAGIC.length).toString("latin1"), DUMP_MAGIC, `[${S}] the file must really be a PostgreSQL custom-format archive, not a text file this probe wrote itself`);
  assert.ok(!bytes.includes(SENTINEL), `[${S}] the backup at rest must not carry the live runtime credential: a dump of one database is not a dump of the cluster's roles, and this is why it is never taken with pg_dumpall`);
  assert.match(backup.capturedAt, TS_FORM, `[${S}] capturedAt must be a canonical UTC millisecond instant; got ${JSON.stringify(backup.capturedAt)}`);
  const captured = Date.parse(backup.capturedAt);
  assert.ok(captured >= before && captured <= after, `[${S}] capturedAt must be the instant this backup was really taken, between ${new Date(before).toISOString()} and ${new Date(after).toISOString()}; got ${backup.capturedAt}`);
  preLoss.backup = backup;
});

test("P23A-3 destroying the database container AND its data volume is a total loss that the still-running listener fails closed on, without leaking the credential it still holds", async () => {
  const S = "P23A-3";
  const probe = await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  const { collectLabelledResources } = await harness();
  assert.ok(preLoss.backup, `[${S}] precondition: the P23A-2 backup must already exist before the database may be destroyed`);
  assert.equal(await probe.databaseReachable(env), true, `[${S}] precondition: the database must be reachable before the loss, or this scenario proves nothing`);
  const loss = await probe.destroyDatabase(env);
  assert.ok(Object.isFrozen(loss), `[${S}] the loss descriptor must be frozen`);
  assert.deepEqual({ container: loss.container, volume: loss.volume, removedContainer: loss.removedContainer, removedVolume: loss.removedVolume },
    { container: env.names.postgres, volume: env.names.volume, removedContainer: true, removedVolume: true }, `[${S}] the loss must name and really remove BOTH the database container and the data volume under it: a container removed while its volume survives is a restart, not a disaster`);
  assert.equal(await probe.databaseReachable(env), false, `[${S}] the database must be genuinely unreachable after the loss`);
  await assert.rejects(env.inspect("postgres"), `[${S}] the database container must be gone from the daemon, not merely stopped`);
  await assert.rejects(queryAsSuperuser(env, "SELECT 1 AS n"), `[${S}] no verification read may still succeed: the loss is real, never simulated`);
  assert.ok(!(await collectLabelledResources(env.label)).volumes.includes(env.names.volume), `[${S}] the data volume ${env.names.volume} must no longer exist: everything written before the backup is now only in the backup`);
  // The listener is untouched by the loss, still holds its mounted credential, and still fails closed.
  assert.equal((await env.inspect("app"))?.State?.Running, true, `[${S}] the application container must still be running: a lost database must not take the listener down with it`);
  assert.ok((await readFile(path.join(env.secretDir, "database-url.txt"), "utf8")).includes(SENTINEL), `[${S}] positive control: the credential the listener still holds must really be the live one, or a silent response below would prove nothing`);
  const response = await sendJsonRequest(env, {
    method: METHOD, route: ROUTE, body: { name: "Ada Lovelace" },
    headers: { "content-type": "application/json", "x-request-id": randomUUID(),
      "x-tenant-id": preLoss.principal.tenantId, "x-actor-id": preLoss.principal.actorId, "idempotency-key": randomUUID() },
  });
  // The exact 5xx code belongs to the unchanged host bridge and is deliberately not frozen a second time
  // here; what P23A owns is that the answer is a failure, carries no receipt, and claims nothing.
  assert.ok(response.status >= 500 && response.status < 600, `[${S}] a write with no database must fail closed with a server error; got ${response.status} ${response.body}`);
  assert.equal(response.json?.commitReceipt, undefined, `[${S}] a failed write must carry no CommitReceipt`);
  assert.doesNotMatch(response.body, /COMMITTED/, `[${S}] nothing in the answer may claim a commit that never happened; got ${response.body}`);
  assert.ok(!response.body.includes(SENTINEL), `[${S}] the runtime password must never reach an HTTP client, least of all through a failure it did not expect`);
  assert.doesNotMatch(response.body, DSN_FORM, `[${S}] no connection string may reach an HTTP client`);
});

test("P23A-4 restoring the backup into a fresh volume served by the SAME pinned image brings back the migration head, the exact four-table truth, the non-superuser roles with row-level security still forced, and a chain that still verifies", async () => {
  const S = "P23A-4";
  const probe = await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  assert.ok(preLoss.backup, `[${S}] precondition: the P23A-2 backup must exist`);
  const restored = await probe.restoreDatabase(env, preLoss.backup);
  assert.ok(Object.isFrozen(restored), `[${S}] the restore descriptor must be frozen`);
  assert.deepEqual({ image: restored.image, container: restored.container, database: restored.database },
    { image: env.postgres.image, container: env.names.postgres, database: DATABASE }, `[${S}] the restore must be served by exactly the pinned image the lost database really ran, under the same container name, so every existing read path reaches it unchanged and no second image is introduced by a recovery`);
  assert.notEqual(restored.volume, env.names.volume, `[${S}] the restore must land on a FRESH volume: reusing the name of a volume that was destroyed would prove nothing was destroyed`);
  assert.match(restored.restoredAt, TS_FORM, `[${S}] restoredAt must be a canonical UTC millisecond instant; got ${JSON.stringify(restored.restoredAt)}`);
  const container = await env.inspect("postgres");
  assert.equal(container?.Config?.Image, env.postgres.image, `[${S}] the running database must be the pinned image, not whatever a tag resolves to today`);
  assert.deepEqual(container?.HostConfig?.PortBindings ?? {}, {}, `[${S}] the restored database must publish no host port: not one port may be bound onto a host address by the recovery`);
  assert.deepEqual(Object.entries(container?.NetworkSettings?.Ports ?? {}).filter(([port, binding]) => port !== "5432/tcp" || binding !== null), [], `[${S}] the restored database must publish nothing to the host: an unmapped 5432/tcp is reported by some Docker daemons as an explicit null and by others as an absent entry, and both spellings mean the very same thing — no host mapping — so what P23A freezes is the invariant and not one daemon's wording: no port other than 5432/tcp may appear at all, and 5432/tcp may never carry a binding, because a restore that quietly answers on the host is a different exposure than the one that was lost; got ${JSON.stringify(container?.NetworkSettings?.Ports ?? {})}`);
  assert.deepEqual(Object.keys(container?.NetworkSettings?.Networks ?? {}), [env.network], `[${S}] the restored database must be attached to exactly the one internal network and never to the default bridge`);
  const inspected = JSON.stringify(container);
  assert.deepEqual((container?.Config?.Env ?? []).filter((entry) => entry.startsWith("POSTGRES_PASSWORD")), ["POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password"], `[${S}] the restored database must take its superuser password from a mounted secret file and never from an environment variable: Config.Env is written into the container's own record and \`docker inspect\` hands it back to anyone who can reach the daemon, for as long as the container exists, so a POSTGRES_PASSWORD= passed at restore time — through --env-file just as much as through --env, and long after that file is deleted from disk — is a cluster password left in plain sight by the very act of recovering; got ${JSON.stringify(container?.Config?.Env ?? [])}`);
  for (const [leak, why] of [[new RegExp(SENTINEL), "the runtime credential must never be handed to the restored container as an environment variable or an argument: it is restored as a role password over the container's own local socket and stays in the mounted file it already lived in"], [/POSTGRES_PASSWORD=/, "no superuser password may appear anywhere in the restored container's inspect output — not in its Env, its Cmd, its Args, its Entrypoint or its labels"], [DSN_FORM, "no connection string may appear in the restored container's inspect output"]]) assert.doesNotMatch(inspected, leak, `[${S}] ${why}`);
  assert.deepEqual((await env.sql("migration", "SELECT version_num FROM alembic_version")).rows.map((row) => row.version_num), [MIGRATION_HEAD], `[${S}] the restored database must stand at exactly the real migration head ${MIGRATION_HEAD}: a restore that lands on a different schema version is a different database`);
  for (const table of BUSINESS_TABLES) assert.deepEqual(await businessRows(env, table), preLoss.rows[table], `[${S}] ${table} must hold exactly the rows it held before the loss, with the same ids under the same tenant — no row missing, no row invented, and no ghost of the request that failed while the database was gone`);
  const decisions = await decisionRows(env);
  assert.equal(decisions.length, 1, `[${S}] the restored decision log must hold exactly the one genesis it held before the loss`);
  assert.deepEqual([decisions[0].id, decisions[0].entry_hash, decisions[0].prev_hash], [preLoss.genesis.id, preLoss.genesis.entry_hash, null], `[${S}] the restored genesis must be the same entry, with the same hash and still the head of the chain`);
  assert.deepEqual(verifyPersistedDecisionLogRow(decisions[0]), verifyPersistedDecisionLogRow(preLoss.genesis), `[${S}] the restored decision must still verify independently, recomputed from the payload that came back out of the archive: an audit trail that cannot be re-verified after a restore is not an audit trail`);
  const roles = (await queryAsSuperuser(env, `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname IN ('${ROLES.migration}', '${ROLES.runtime}') ORDER BY rolname`)).rows;
  assert.deepEqual(roles, [
    { rolname: ROLES.migration, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true },
    { rolname: ROLES.runtime, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true },
  ], `[${S}] both roles must come back exactly as the environment created them: a recovery that restores the data as a superuser, or as a role that may bypass row-level security, silently widens the blast radius of every later request`);
  const security = (await queryAsSuperuser(env, `SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced, (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = c.relname || '_tenant_isolation') AS isolation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('${RUNTIME_TABLES.join("', '")}') ORDER BY c.relname`)).rows;
  assert.deepEqual(security, RUNTIME_TABLES.map((table) => ({ table_name: table, enabled: true, forced: true, isolation: 1 })), `[${S}] every runtime table must come back with row-level security enabled AND forced and its tenant-isolation policy in place: tenant isolation that survives a restore only as a table definition is not tenant isolation`);
  await assert.rejects(env.sql("runtime", "CREATE TABLE p23a_forbidden (id integer)"), (error) => {
    assert.equal(error.code, INSUFFICIENT_PRIVILEGE, `[${S}] the restored runtime role must still be refused DDL by PostgreSQL itself with SQLSTATE ${INSUFFICIENT_PRIVILEGE}; got ${error.code}: ${error.message}`);
    return true;
  }, `[${S}] the restored runtime role must not be able to change the schema it serves`);
});

test("P23A-5 a second trusted write after the restore commits and chains onto the restored genesis, and the UNCHANGED P22B1 teardown leaves zero labelled resources and no backup on disk", async () => {
  const S = "P23A-5";
  await requireProbe(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  const { collectLabelledResources, stopLiveEnvironment } = await harness();
  try {
    assert.ok(preLoss.genesis, `[${S}] precondition: the pre-loss genesis must be on record`);
    // The listener was never restarted and never re-credentialed: it reaches the restored database
    // through the same mounted file, on the same alias, as if nothing had happened to it.
    const { receipt } = await commitOne(S, env, preLoss.principal);
    assert.match(receipt.resourceId, UUID_FORM, `[${S}] the post-restore receipt must name a canonical resource id`);
    assert.notEqual(receipt.resourceId, preLoss.receipt.resourceId, `[${S}] the post-restore write must be a second customer, not a replay of the restored one`);
    for (const [index, table] of BUSINESS_TABLES.entries()) assert.deepEqual(await businessRows(env, table), [...preLoss.rows[table], { id: boundIds(receipt)[index], tenant_id: preLoss.principal.tenantId }], `[${S}] ${table} must now hold the restored row AND the new one, in that order: the recovered history and the business that continues after it live in the same table`);
    const decisions = await decisionRows(env);
    assert.equal(decisions.length, 2, `[${S}] the restored genesis and exactly one new decision must be on record`);
    const successor = decisions[1];
    verifyPersistedDecisionLogRow(successor);
    assert.equal(successor.prev_hash, preLoss.genesis.entry_hash, `[${S}] the post-restore decision must chain onto the entry hash the genesis had BEFORE the disaster: the tamper-evident chain must survive the restore as one chain, not restart as a second one`);
    assert.equal(successor.payload.decision, "allow", `[${S}] the post-restore write must have been allowed by a recorded decision`);
  } finally {
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    await stopLiveEnvironment(env).catch(() => {});
  }
  const survivors = await collectLabelledResources(env.label);
  for (const kind of ["containers", "networks", "imageTags", "volumes", "secretDirs"]) {
    assert.deepEqual(survivors[kind], [], `[${S}] no labelled ${kind} may outlive this run — including the container and the volume the RESTORE created, which must carry the same label so the unchanged P22B1 teardown removes them; got ${JSON.stringify(survivors[kind])}`);
  }
  await assert.rejects(access(backupDir), `[${S}] the backup directory ${backupDir} must be removed from disk: a copy of a business database must not outlive the run that made it`);
});
