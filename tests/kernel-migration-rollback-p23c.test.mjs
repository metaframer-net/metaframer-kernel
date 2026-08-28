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

// P23C — one REAL alembic downgrade of the head revision, taken against a live database that already
// holds committed audited business, and one real re-upgrade back to head. P23A proved this system can
// lose its whole database and get the truth back out of an archive; P23B proved it can lose the node
// and carry on over a promoted copy. Both answer "the infrastructure failed". Neither answers the
// failure every team actually meets more often: the SCHEMA CHANGE ITSELF was wrong and has to come
// back out while the listener is running. This frozen test owns every fixed expectation for the
// package that closes that gap inside the SAME unchanged P22B1 environment — the repository's OWN
// alembic revisions run in both directions through the SAME locked `uv run --frozen` toolchain the
// environment already migrates with, never a line of DDL this package wrote for itself; the three
// business tables and their committed rows surviving the rollback untouched while the head revision's
// own table, trigger, function, policy and grant are really GONE, taking the audited decision history
// with them; the never-restarted listener meeting that older schema and failing closed WITHOUT leaking
// the credential it holds and WITHOUT leaving a customer row behind that no decision ever authorised;
// the re-upgrade restoring the structure AND every security property of it exactly while restoring
// none of the destroyed rows; and the business resuming on a NEW chain genesis, which is the honest
// cost this package exists to make visible rather than to hide. P23C adds ONE migration seam beside
// the three P22/P23A/P23B ones: it starts no environment, defines no image, writes no DDL, publishes
// no port on the served database and puts no credential on a command line, and every HTTP request,
// verification read and trusted principal comes from the UNCHANGED P22B2 probe — the twelve sha256
// below are the proof, checked against the working tree. This is a MANUAL, single-node, ephemeral
// rollback drill: not a zero-downtime migration, not an expand-and-contract rollout, not a
// backward-compatible schema change, not a data migration, not point-in-time recovery, not automatic
// detection, and it agrees no recovery objective. The manifest gates the run and never supplies an
// expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_TEST_PATH = "tests/kernel-migration-rollback-p23c.test.mjs";
const PROBE_PATH = "tests/_harness/live-migration-rollback-probe.mjs";
const MANIFEST_PATH = "planning/kernel-migration-rollback-p23c.json";
const [LIVE_HARNESS_PATH, WRITE_PROBE_PATH] = ["tests/_harness/live-http-postgres-environment.mjs", "tests/_harness/live-audited-write-probe.mjs"];
const ALLOWED_FILES = Object.freeze([FROZEN_TEST_PATH, PROBE_PATH, MANIFEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P23C-1", "P23C-2", "P23C-3", "P23C-4", "P23C-5", "P23C-6"]);
const [BASE_COMMIT, BASE_TREE] = ["8cf90a6ec7cef16e0b65050bed8199c1b56049c6", "8fa76b8bfe07f80126beb65912d8785f37079d8c"];
// The canonical Actionplan change-package budget owns every threshold; this test binds the manifest to that consumer at one exact pinned commit and duplicates no number of its own.
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The twelve surfaces P23C must leave byte-identical: the four live seams it runs beside and borrows
// whole, the FIVE real migration surfaces it rolls back — a package that may edit the revisions it
// claims to reverse has proven a schema it wrote twice, and the alembic environment decides how those
// revisions are allowed to run at all — and the image, the P22A1 secret wrapper and the audited JS
// boundary runner every request in this file really travels through.
const MIGRATION_SURFACES = Object.freeze({
  "db/metaframer_kernel_db/migrations.py": "38b8ffa6dfc4365728aa0482604778ec8e7bcf39ef6f3aeb1f10e88418d3f3ca",
  "db/metaframer_kernel_db/alembic/env.py": "a2ecd03ef7183920894a8e2fd38e30d9f18f4c1e25ded9ffe014b0fe5da31239",
  "db/metaframer_kernel_db/alembic/versions/0001_runtime_substrate.py": "4640ba1d5ff2e9dc008b98afdb6850328204e1c7b437ddc954a9a334d1611b7b",
  "db/metaframer_kernel_db/alembic/versions/0002_customer_records.py": "1016fa121c6a147b4dc03a7f4eaefb37e6beb33d09005ab3048656fcbe7b03c8",
  "db/metaframer_kernel_db/alembic/versions/0003_policy_decision_log.py": "012598c6907f8c9c2de1869c585aa6177f19b7fc4e324fb279c5ce89141f212d",
});
const PRESERVED = Object.freeze({
  [LIVE_HARNESS_PATH]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
  [WRITE_PROBE_PATH]: "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
  "tests/_harness/live-recovery-probe.mjs": "e13a0e5be9fc4066c74fb8dbc11279c1e72a2359287195865db1f08ee834c63b",
  "tests/_harness/live-standby-failover-probe.mjs": "3bef68f7e35c530404025678c48fc47ec3c29a501a6f66ea231d833b5d26cf23",
  ...MIGRATION_SURFACES,
  "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
  "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
  "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
});
const PROBE_API = Object.freeze(["MIGRATION_PROBE_CONTRACT", "currentRevision", "downgradeTo", "schemaFacts", "upgradeToHead"]);
const [METHOD, ROUTE, DATABASE, SUPERUSER, ALIAS] = ["POST", "/customers", "mfk", "postgres", "db"];
const [MIGRATION_ROLE, RUNTIME_ROLE] = ["mfk_migration", "mfk_runtime"];
const [HEAD, ROLLBACK_TARGET] = ["0003_policy_decision_log", "0002_customer_records"];
const DECISION_TABLE = "policy_decision_log";
const [DECISION_TRIGGER, DECISION_FUNCTION, DECISION_POLICY] = [`${DECISION_TABLE}_append_only`, `mfk_${DECISION_TABLE}_append_only`, `${DECISION_TABLE}_tenant_isolation`];
const BUSINESS_TABLES = Object.freeze(["customer_records", "audit_log", "transactional_outbox"]);
const RUNTIME_TABLES = Object.freeze([...BUSINESS_TABLES, DECISION_TABLE].sort());
// The head revision grants the runtime role exactly these two privileges on its table, and a rollback that comes back granting a third one has restored a weaker database than the one it replaced.
const DECISION_GRANTS = Object.freeze(["INSERT", "SELECT"]);
const TS_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const [UUID_FORM, DSN_FORM, HEX64] = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /postgres(?:ql)?:\/\//i, /^[0-9a-f]{64}$/];
// The three scope records MASTER froze for this package, bound by their published prefixes so the writer is never judged against a scope reconciled after the fact.
const [SYNTHESIS_PIN, PARENT_PIN, BLIND_PIN] = ["adc3db6a", "a74967a3", "aef6a510"];
// Unique per process, so one concurrent run can never sweep or adopt another run's resources.
const LABEL_VALUE = `p23c-${randomBytes(6).toString("hex")}`;
// One value that exists nowhere else in this repository: the real runtime-role password the listener holds unchanged across both migration windows.
const SENTINEL = "p23c-sentinel-T7bH2qE5mV8xR4dL-do-not-log";
const TRUE_FLAGS = Object.freeze(["runtimeImplementationStarted", "hostServerSelectedForDeployArtifact", "networkListenerStarted",
  "liveHttpAuditProven", "p22Complete", "backupRestoreProven", "streamingStandbyProven", "manualFailoverProven", "migrationRollbackProven"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed", "productionAllowed",
  "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p23Complete", "stagingEnvironmentExists", "stagingRunPerformed",
  "productionHostSelected", "registryPushed", "externalDeploymentPerformed", "highAvailabilityProven", "automaticFailoverProven",
  "splitBrainProtectionProven", "synchronousReplicationProven", "pointInTimeRecoveryProven", "zeroDowntimeMigrationProven",
  "backwardCompatibleMigrationProven", "dataMigrationRollbackProven", "offsiteBackupExists", "automatedBackupScheduleExists", "recoveryObjectivesAgreed"]);
const UNTOUCHED = Object.freeze(["srcUntouched", "p22HarnessesUntouched", "p23aRecoverySeamUntouched", "p23bFailoverSeamUntouched",
  "hostDeployImageUntouched", "secretFileRunnerUntouched", "boundaryRunnerUntouched", "dbUntouched", "migrationsUntouched",
  "alembicRevisionsUntouched", "ciUntouched", "dependenciesUntouched", "roadmapUntouched"]);
const NON_GOALS = Object.freeze(["zero downtime", "expand and contract", "backward compatible", "data migration", "automatic",
  "point-in-time", "high availability", "rpo", "rto", "production", "staging", "registry", "deployment", "host port", "image", "roadmap"]);

/** Read one dotted path, so a binding table names the exact field it binds. */
const at = (node, dotted) => dotted.split(".").reduce((value, key) => value?.[key], node);
const harness = () => import(pathToFileURL(path.join(root, LIVE_HARNESS_PATH)).href);

/** The FIRST action of every scenario. A checkout without the probe fails HERE, naming the exact missing allowed path, BEFORE Docker is touched: RED on the absent implementation, never on a daemon or a pull. */
const requireProbe = (scenario) => import(pathToFileURL(path.join(root, PROBE_PATH)).href).catch((error) =>
  assert.fail(`[${scenario}] the allowed P23C probe ${PROBE_PATH} must exist before this scenario can run: ${error.message}`));

/** Load-bearing contract read: no P23C scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P23C manifest ${MANIFEST_PATH} must exist before this scenario can run: ${error.message}`)));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the six P23C scenario ids, in order`);
  return contract;
}

/** Exactly one ephemeral environment for the whole suite — the UNCHANGED P22B1 one, started through the UNCHANGED P22B1 harness under this run's own unique label. P23C builds no environment. */
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

/** Every business row, and every decision row, exactly as the server recorded them. */
const db = (env) => (statement) => queryAsSuperuser(env, statement);
const businessRows = async (query, table) => (await query(`SELECT id::text AS id, tenant_id::text AS tenant_id FROM ${table} ORDER BY recorded_at`)).rows;
const decisionRows = async (query) => (await query(`SELECT id, tenant_id::text AS tenant_id, entry_hash, prev_hash, payload FROM ${DECISION_TABLE} ORDER BY recorded_at`)).rows;
/** The three ids one receipt binds to the three business tables, in this file's fixed table order. */
const boundIds = (receipt) => [receipt.resourceId, receipt.auditId, receipt.outboxEventIds[0]];
const single = async (query, expression) => Object.values((await query(`SELECT ${expression}`)).rows[0] ?? {})[0];
const allBusinessRows = async (query) => Object.fromEntries(await Promise.all(BUSINESS_TABLES.map(async (table) => [table, await businessRows(query, table)])));

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

/** One migration window, judged the same way in both directions before any schema claim is read off it. */
function assertWindow(S, descriptor, env, { direction, from, to }) {
  assert.ok(Object.isFrozen(descriptor), `[${S}] the migration descriptor must be frozen: a mutable record of what was migrated could be edited by the very run that must be judged against it`);
  assert.deepEqual({ direction: descriptor.direction, from: descriptor.from, to: descriptor.to, served: descriptor.servedContainer, volume: descriptor.volume, maintenanceRemoved: descriptor.maintenanceRemoved },
    { direction, from, to, served: env.names.postgres, volume: env.names.volume, maintenanceRemoved: true }, `[${S}] the window must record a real ${direction} from ${from} to ${to}, performed against THIS environment's own data volume and re-served under THIS environment's own database container name, with the temporary maintenance container removed again: a migration run against some other volume proves nothing about the database the listener is talking to, and a maintenance container left behind is a second door into the whole business database`);
  assert.equal(descriptor.publishedOn, "127.0.0.1", `[${S}] the maintenance window's only exposure must be bound to loopback: the isolated database publishes nothing, so the repository's own alembic can only reach it while the same volume is briefly re-served to this host, and that window must never be reachable from off the machine`);
  for (const field of ["startedAt", "completedAt"]) assert.match(descriptor[field], TS_FORM, `[${S}] ${field} must be a canonical UTC millisecond instant; got ${JSON.stringify(descriptor[field])}`);
  assert.doesNotMatch(JSON.stringify(descriptor), new RegExp(`${SENTINEL}|${DSN_FORM.source}`, "i"), `[${S}] the descriptor must carry no credential and no connection string: it is read by a test, printed by a failure and kept in a log`);
}

/** The served database, after either window: same cluster, same alias, still publishing nothing to the host. */
async function assertServedDatabase(S, env, expectedIdentifier) {
  const container = await env.inspect("postgres");
  assert.equal(container?.State?.Running, true, `[${S}] the migrated database must be running again and serving the environment`);
  assert.equal(container?.Config?.Image, env.postgres.image, `[${S}] the re-served database must be exactly the pinned image the environment was built on, not whatever a tag resolves to today`);
  assert.deepEqual(container?.HostConfig?.PortBindings ?? {}, {}, `[${S}] the re-served database must publish NO host port: a maintenance window is the easiest moment in a system's life for an exposure to be introduced and then never noticed again`);
  assert.deepEqual(Object.keys(container?.NetworkSettings?.Networks ?? {}), [env.network], `[${S}] the re-served database must be attached to exactly the one internal network and never to the default bridge`);
  assert.ok((container?.NetworkSettings?.Networks?.[env.network]?.Aliases ?? []).includes(ALIAS), `[${S}] the daemon itself must report the ${ALIAS} alias on the re-served database, read back rather than inferred from an exit status: the never-restarted listener holds a credential naming that host and reaches its database by no other name`);
  assert.doesNotMatch(JSON.stringify(container), new RegExp(`${SENTINEL}|POSTGRES_PASSWORD=|${DSN_FORM.source}`, "i"), `[${S}] no credential and no connection string may have been written into the database container's record by the migration window`);
  assert.equal(await single(db(env), "system_identifier::text AS v FROM pg_control_system()"), expectedIdentifier, `[${S}] the migrated database must carry the SAME cluster identifier ${expectedIdentifier} it had before the window: a rollback that quietly lands on a freshly initialised cluster loaded with data is not a rollback of anything, and every survival claim below would be a claim about a different database`);
}

// What the live head really held, captured from the SERVER before anything was rolled back.
const preRollback = { receipt: null, rows: null, genesis: null, principal: null, facts: null, identifier: null, app: null };
const appIdentity = (container) => ({ running: container?.State?.Running, startedAt: container?.State?.StartedAt, pid: container?.State?.Pid, restartCount: container?.RestartCount });

test("P23C-1 the migration seam and its package contract exist, fix a loopback-only maintenance window and an owner-run migration, bind the package to MASTER's frozen scope, and preserve all twelve live, migration and deploy surfaces byte-identical", async () => {
  const S = "P23C-1";
  const [probe, contract] = [await requireProbe(S), await requireContract(S)];
  assert.deepEqual(Object.keys(probe).sort(), [...PROBE_API], `[${S}] ${PROBE_PATH} must export exactly this API and nothing more`);
  for (const name of PROBE_API.slice(1)) assert.equal(typeof probe[name], "function", `[${S}] ${name} must be callable`);
  const mp = probe.MIGRATION_PROBE_CONTRACT;
  assert.ok(Object.isFrozen(mp), `[${S}] MIGRATION_PROBE_CONTRACT must be frozen: a mutable migration contract can be edited by the very run that must be judged against it`);
  for (const [field, want] of [["database", DATABASE], ["superuserRole", SUPERUSER], ["migrationRole", MIGRATION_ROLE],
    ["runtimeRole", RUNTIME_ROLE], ["networkAlias", ALIAS], ["head", HEAD], ["rollbackTarget", ROLLBACK_TARGET],
    ["dataDirectory", "/var/lib/postgresql/data"], ["maintenanceBindAddress", "127.0.0.1"], ["publishesHostPort", false],
    ["credentialOnCommandLine", false], ["credentialInEnvironmentValue", false], ["migrationsRunAsSuperuser", false],
    ["restartsApplicationContainer", false], ["revisionsAreRepositoryOwned", true]])
    assert.equal(at(mp, field), want, `[${S}] the probe contract must fix ${field} to ${JSON.stringify(want)}: the one database that is migrated, the credential-free local superuser that is NOT allowed to run the migration, the owning migration role that is, the runtime role whose privileges the head revision grants and a rollback must restore, the alias the listener reaches its database by, the real head and the exact revision this package rolls back to, the data directory the same cluster is re-served from, the loopback address the maintenance window is bound to, the port that is never published on the served database, the promise that no credential is ever a command-line argument OR an environment VALUE, the listener that is never restarted, and the fact that the revisions run are the repository's own are decided here and nowhere else`);
  // Bounded, and never looser than the environment it borrows: an unbounded wait hangs a test run instead of failing it, and a probe that outwaits its own environment reports nothing at all.
  const { LIVE_ENVIRONMENT_CONTRACT: live22b1 } = await harness();
  for (const [key, ceiling] of [["dockerCli", live22b1.timeouts.dockerCli], ["migration", live22b1.timeouts.ready], ["ready", live22b1.timeouts.ready]])
    assert.ok(Number.isFinite(mp.timeouts?.[key]) && mp.timeouts[key] > 0 && mp.timeouts[key] <= ceiling, `[${S}] timeouts.${key} must be a finite bound of at most the P22B1 environment's own ${ceiling}ms; got ${mp.timeouts?.[key]}`);
  assert.deepEqual(Object.keys(mp.preservedHashes ?? {}).sort(), Object.keys(PRESERVED).sort(), `[${S}] the probe contract must name exactly these twelve preserved surfaces`);
  for (const [file, digest] of Object.entries(PRESERVED)) {
    assert.equal(mp.preservedHashes[file], digest, `[${S}] the probe contract must record ${file} as ${digest}`);
    assert.equal(createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"), digest, `[${S}] ${file} must still hash to ${digest} in this working tree: P23C adds one migration seam beside the three existing ones and changes no harness, probe, migration module, alembic environment, revision, image, secret-wrapper or boundary-runner byte`);
  }
  const source = await readFile(path.join(root, PROBE_PATH), "utf8");
  for (const [required, why] of [[/alembic/, "run the repository's OWN alembic revision tree"],
    [/--frozen/, "run those revisions through the same LOCKED toolchain the environment already migrates with: a rollback proven by a differently resolved alembic is a rollback of a different program"],
    [/127\.0\.0\.1/, "bind its maintenance window to loopback"]])
    assert.match(source, required, `[${S}] the migration probe must ${why}`);
  for (const [forbidden, why] of [[/\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|TRIGGER|FUNCTION|POLICY)\b/i, "write a line of schema DDL of its own: the whole claim of this package is that the REPOSITORY'S revisions reverse and re-apply themselves, and a probe that can create or drop the objects under test is proving a schema written twice"],
    [/^\s*FROM\s/m, "define an image of its own"], [/--privileged/, "run anything privileged"],
    [/0\.0\.0\.0/, "bind its maintenance window to every interface: the whole business database is briefly reachable through it"],
    [/PGPASSWORD/, "put a database password in an environment variable"],
    [/POSTGRES_HOST_AUTH_METHOD/, "reach for the image's authentication override: a maintenance window is not the moment to widen how a database decides who is talking to it"],
    [/live-http-postgres-environment/, "hold an importable reference to the environment harness: it is handed one environment and must never be able to start or stop one"],
    [/live-recovery-probe|live-standby-failover-probe/, "reach into the P23A or P23B seam: this package migrates, it neither restores nor fails over"]])
    assert.doesNotMatch(source, forbidden, `[${S}] the migration probe must never ${why}`);
  // The package binding. Everything the writer is judged by is fixed here, before a container exists.
  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  for (const [field, want] of [["base", BASE_COMMIT], ["baseTree", BASE_TREE], ["actionplanPin", ACTIONPLAN_PIN],
    ["frozenTestPath", FROZEN_TEST_PATH], ["frozenTestSha256", digest], ["greenEvidence.targetedTest", TARGETED_TEST],
    ["environmentPins.migrationHead", HEAD], ["environmentPins.rollbackTarget", ROLLBACK_TARGET],
    ["splitEvidence.scopeSynthesisName", "P23C_SCOPE_SYNTHESIS_V1"], ["splitEvidence.thisPackage", "P23C"],
    ["splitEvidence.counter", "22/25"], ["provenance.singleWriter", true], ["provenance.reviewerMustBeSeparateSession", true],
    ["provenance.testAuthoring", "claude-only"], ["rollback.compensatingStepRequired", false]])
    assert.equal(at(contract, field), want, `[${S}] the manifest must record ${field} as ${JSON.stringify(want)}: the immutable base, the exact pinned Actionplan budget that owns every threshold this package is judged by, the real head and the revision it is rolled back to, the reconciled scope name, the unmoved 22/25 counter with P23 still open, the single-writer provenance and the rollback are all bound here`);
  // The scope hashes are evidence, so they are checked as evidence: the synthesis hash must really be the digest of the scope text this package was written against, and all three must be the records MASTER published BEFORE any of this was written.
  const scopeText = contract.splitEvidence?.scopeSynthesisText;
  assert.ok(typeof scopeText === "string" && scopeText.length > 80, `[${S}] the manifest must carry the scope synthesis this package was written against, in full`);
  assert.equal(contract.splitEvidence?.scopeSynthesisSha256, createHash("sha256").update(scopeText).digest("hex"), `[${S}] splitEvidence.scopeSynthesisSha256 must be the sha256 of splitEvidence.scopeSynthesisText itself`);
  const scopes = [["scopeSynthesisSha256", SYNTHESIS_PIN], ["parentScopeSha256", PARENT_PIN], ["blindScopeSha256", BLIND_PIN]];
  for (const [field, pin] of scopes) assert.ok(HEX64.test(String(contract.splitEvidence?.[field])) && String(contract.splitEvidence[field]).startsWith(pin), `[${S}] splitEvidence.${field} must be a sha256 and must be the record MASTER froze at ${pin}…, so this package is judged against the scope fixed before it was written and never against one reconciled afterwards; got ${contract.splitEvidence?.[field]}`);
  assert.equal(new Set(scopes.map(([field]) => contract.splitEvidence?.[field])).size, 3, `[${S}] the blind-frozen scope, the parent scope and the reconciled synthesis must be three distinct records`);
  assert.ok(String(contract.splitEvidence?.blindScopeDetermination ?? "").length > 40, `[${S}] the manifest must state how the blind scope was frozen before either side saw the other`);
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the three allowed P23C paths`);
  const remaining = contract.splitEvidence?.remaining ?? [];
  assert.ok(remaining.length > 0 && !remaining.includes("P23C"), `[${S}] P23 must record work still outstanding after this package, and P23C must not be among it: one proven schema rollback is not a closed HA/DR phase`);
  assert.deepEqual(contract.preservedHashes, { ...PRESERVED }, `[${S}] the manifest must record the same twelve untouched surfaces the probe contract does`);
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
  for (const flag of TRUE_FLAGS) assert.equal(flags[flag], true, `[${S}] ${flag} must be true: this package really ran the repository's own head revision backwards against a live database holding committed audited business and then re-applied it, and denying evidence a package carries is as wrong as claiming evidence it does not`);
  for (const flag of FALSE_FLAGS) assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P23C is ONE operator-driven schema rollback inside an environment that deletes itself — the listener is refused for the whole window, the rolled-back revision destroys its own table's rows and the re-upgrade brings none of them back, and nothing here migrates data, keeps a schema backward compatible, avoids downtime, detects a bad migration or agrees an objective, so this is not a zero-downtime migration, not expand-and-contract, not a data-migration rollback, not high availability, not point-in-time recovery, not a deployment and not a closed P23`);
  assert.equal(Object.keys(flags).length, TRUE_FLAGS.length + FALSE_FLAGS.length, `[${S}] no readiness flag beyond the declared set may be introduced`);
  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of NON_GOALS) assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  assert.match(String(contract.capabilityDelta ?? ""), /^REAL_MIGRATION_ROLLBACK_AND_REUPGRADE:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  assert.ok(String(contract.productClaim?.notRunnable ?? "").toLowerCase().includes("audit"), `[${S}] the not-runnable claim must say plainly that this rollback destroys audited decision history and the re-upgrade does not bring it back: that is the finding of this package, and a product claim that omits it sells the rollback as free`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
});

test("P23C-2 the live environment really stands at the real head, and one trusted write commits there — four tables, one verified genesis decision, and the head revision's full security shape recorded from the server itself", async () => {
  const S = "P23C-2";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);  const query = db(env);
  const revision = await probe.currentRevision(env);
  assert.ok(Object.isFrozen(revision), `[${S}] the revision descriptor must be frozen`);
  assert.deepEqual({ revision: revision.revision, readAs: revision.readAs }, { revision: HEAD, readAs: MIGRATION_ROLE }, `[${S}] the environment must stand at exactly the real head ${HEAD}, read as the owning ${MIGRATION_ROLE} role from the database's own alembic_version table: the version this package rolls back must be the version the environment really migrated to, never one this test declared`);
  for (const table of RUNTIME_TABLES) assert.equal(await single(query, `count(*)::int AS n FROM ${table}`), 0, `[${S}] precondition: ${table} starts empty, exactly as P22B1 leaves it — every row this suite finds was written by this suite`);
  const facts = await probe.schemaFacts(env);
  assert.ok(Object.isFrozen(facts), `[${S}] the schema facts must be frozen: they are the yardstick the re-upgrade is measured against, and a mutable yardstick measures nothing`);
  for (const [kind, want] of [["tables", DECISION_TABLE], ["triggers", DECISION_TRIGGER], ["functions", DECISION_FUNCTION], ["policies", DECISION_POLICY]])
    assert.ok((facts[kind] ?? []).includes(want), `[${S}] at head the schema must carry the ${kind.replace(/s$/, "")} ${want}: the head revision's table, its append-only trigger, the function behind that trigger and its tenant-isolation policy are four separate objects, and a rollback that removes some of them and leaves others is the worst outcome of all; got ${JSON.stringify(facts[kind])}`);
  assert.deepEqual(facts.rowSecurity?.[DECISION_TABLE], { enabled: true, forced: true }, `[${S}] row-level security on ${DECISION_TABLE} must be both ENABLED and FORCED at head, so even the owning role is subject to tenant isolation`);
  assert.deepEqual(facts.runtimeGrants?.[DECISION_TABLE], [...DECISION_GRANTS], `[${S}] at head the ${RUNTIME_ROLE} role must hold exactly ${DECISION_GRANTS.join(" and ")} on ${DECISION_TABLE} and nothing else`);
  const principal = await readTrustedPrincipal(env);  const { requestId, receipt } = await commitOne(S, env, principal);
  const rows = await allBusinessRows(query);
  BUSINESS_TABLES.forEach((table, index) => assert.deepEqual(rows[table], [{ id: boundIds(receipt)[index], tenant_id: principal.tenantId }], `[${S}] ${table} must hold exactly one row: the one the receipt names, filed under the trusted tenant`));
  const decisions = await decisionRows(query);
  assert.equal(decisions.length, 1, `[${S}] the audited allow must record exactly one decision`);  const [genesis] = decisions;
  assert.deepEqual(verifyPersistedDecisionLogRow(genesis), { receiptType: "DecisionLogAppendReceipt", entryId: genesis.id, tenantId: principal.tenantId, entryHash: genesis.entry_hash, prevHash: null }, `[${S}] the genesis must verify independently, recomputed from its own persisted payload, as the head of this tenant's chain`);
  assert.equal(genesis.payload.traceId, requestId, `[${S}] the genesis must carry this request's own trace id`);
  Object.assign(preRollback, { receipt, rows, genesis, principal, facts,
    identifier: await single(query, "system_identifier::text AS v FROM pg_control_system()"), app: appIdentity(await env.inspect("app")) });
  assert.ok(preRollback.identifier && preRollback.app.startedAt && preRollback.app.pid > 0, `[${S}] the cluster identity and the running listener's start instant and pid must be readable, so both can be compared against after the migration windows`);
});

test("P23C-3 the repository's OWN head revision really runs backwards against that live database — the three business tables and their committed rows survive untouched, while the rolled-back revision's table, trigger, function, policy and grant are gone and take the audited decision history with them", async () => {
  const S = "P23C-3";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  assert.ok(preRollback.genesis, `[${S}] precondition: the head truth must already be on record`);
  const window = await probe.downgradeTo(env, ROLLBACK_TARGET);
  assertWindow(S, window, env, { direction: "downgrade", from: HEAD, to: ROLLBACK_TARGET });
  await assertServedDatabase(S, env, preRollback.identifier);
  const query = db(env);
  assert.deepEqual({ revision: (await probe.currentRevision(env)).revision }, { revision: ROLLBACK_TARGET }, `[${S}] the database itself must now report ${ROLLBACK_TARGET} in its own alembic_version table, asked of the server rather than taken from the descriptor: a rollback is only real when the database agrees it happened`);
  const facts = await probe.schemaFacts(env);
  for (const [kind, gone] of [["tables", DECISION_TABLE], ["triggers", DECISION_TRIGGER], ["functions", DECISION_FUNCTION], ["policies", DECISION_POLICY]])
    assert.ok(!(facts[kind] ?? []).includes(gone), `[${S}] the rolled-back revision's ${kind.replace(/s$/, "")} ${gone} must really be GONE: an alembic_version row that moved while the objects it names are still standing is a version marker, not a rollback; got ${JSON.stringify(facts[kind])}`);
  assert.equal(facts.rowSecurity?.[DECISION_TABLE], undefined, `[${S}] no row-security record may survive for a table that no longer exists`);
  assert.equal(facts.runtimeGrants?.[DECISION_TABLE], undefined, `[${S}] no ${RUNTIME_ROLE} grant may survive for a table that no longer exists: a privilege outliving its object is how a re-created table quietly comes back wider than it was`);
  // What the rollback was allowed to touch, and what it was not.
  for (const table of BUSINESS_TABLES) assert.ok((facts.tables ?? []).includes(table), `[${S}] ${table} must still exist: the head revision owns one table, and a downgrade that reaches past its own revision is not a rollback but an outage`);
  for (const key of ["rowSecurity", "runtimeGrants"]) assert.deepEqual(Object.fromEntries(BUSINESS_TABLES.map((table) => [table, facts[key]?.[table]])), Object.fromEntries(BUSINESS_TABLES.map((table) => [table, preRollback.facts[key]?.[table]])), `[${S}] the three business tables' ${key} must be exactly what they were before the rollback: the security shape of the tables a revision does not own is not a revision's to change on the way past`);
  assert.deepEqual(await allBusinessRows(query), preRollback.rows, `[${S}] every committed business row must have SURVIVED the rollback, with the same ids under the same tenant: the customer this business already accepted, the audit entry that recorded it and the outbox event that will be published for it do not disappear because a later schema change was withdrawn`);
  // And the honest cost, asserted rather than glossed: the head revision's own downgrade drops its table, so the audited history in it is destroyed.
  await assert.rejects(decisionRows(query), (error) => {
    assert.equal(error.code, "42P01", `[${S}] the decision table must be reported ABSENT by PostgreSQL itself with SQLSTATE 42P01, not by a guard this test or this probe invented; got ${error.code}: ${error.message}`);
    return true;
  }, `[${S}] the audited decision this system committed at head must be UNREADABLE after the rollback, because the revision's own downgrade drops the table that held it: this is the real, destructive cost of rolling back this revision, and a test that quietly skipped it would leave an operator believing an audit trail survives a schema rollback`);
});

test("P23C-4 the never-restarted listener meets the older schema and fails closed — no receipt, no committed claim, no credential or connection string in the answer, and NOT ONE business row left behind that no decision ever authorised", async () => {
  const S = "P23C-4";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);  const query = db(env);
  assert.deepEqual(appIdentity(await env.inspect("app")), preRollback.app, `[${S}] the application container must be the SAME process it was before the rollback — same start instant, same pid, restart count unmoved: if the listener had to be restarted to survive a schema rollback, what happened was a redeploy with an outage in the middle, and nothing below would be a statement about this system's behaviour`);
  assert.ok((await readFile(path.join(env.secretDir, "database-url.txt"), "utf8")).includes(SENTINEL), `[${S}] positive control: the credential the listener still holds must really be the live one, or a silent response below would prove nothing`);
  const response = await sendJsonRequest(env, { method: METHOD, route: ROUTE, body: { name: "Ada Lovelace" },
    headers: { "content-type": "application/json", "x-request-id": randomUUID(), "x-tenant-id": preRollback.principal.tenantId, "x-actor-id": preRollback.principal.actorId, "idempotency-key": randomUUID() } });
  // The exact 5xx code belongs to the unchanged host bridge and is deliberately not frozen a second time here; what P23C owns is that the answer is a failure, carries no receipt, claims nothing and leaks nothing.
  assert.ok(response.status >= 500 && response.status < 600, `[${S}] a trusted write sent against a schema the running boundary no longer matches must fail closed with a server error; got ${response.status} ${response.body}`);
  assert.equal(response.json?.commitReceipt, undefined, `[${S}] a failed write must carry no CommitReceipt`);
  assert.doesNotMatch(response.body, /COMMITTED/, `[${S}] nothing in the answer may claim a commit that never happened; got ${response.body}`);
  assert.ok(!response.body.includes(SENTINEL), `[${S}] the runtime password must never reach an HTTP client, least of all through a failure it did not expect`);
  assert.doesNotMatch(response.body, DSN_FORM, `[${S}] no connection string may reach an HTTP client`);
  // The one claim that decides whether this failure was safe: the write did not get half-way in.
  assert.deepEqual(await allBusinessRows(query), preRollback.rows, `[${S}] the refused write must have left NO business row behind: the boundary appends its decision before it commits anything, so a schema that cannot record the decision must produce no customer, no audit entry and no outbox event — a customer row that exists with no decision authorising it is unauditable forever, and no later re-upgrade can repair it`);
  assert.equal((await probe.currentRevision(env)).revision, ROLLBACK_TARGET, `[${S}] the refused write must not have moved the schema: nothing in a failing request path may migrate a database`);
});

test("P23C-5 the same revision re-applied brings the structure and EVERY security property of it back exactly as they were — and brings back none of the destroyed rows", async () => {
  const S = "P23C-5";
  const probe = await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  const window = await probe.upgradeToHead(env);
  assertWindow(S, window, env, { direction: "upgrade", from: ROLLBACK_TARGET, to: HEAD });
  await assertServedDatabase(S, env, preRollback.identifier);
  const query = db(env);
  assert.equal((await probe.currentRevision(env)).revision, HEAD, `[${S}] the database itself must stand at the real head ${HEAD} again`);
  assert.deepEqual(await probe.schemaFacts(env), preRollback.facts, `[${S}] the re-applied schema must be IDENTICAL to the one recorded at head before the rollback — the same tables, the same triggers, the same functions, the same policies, the same enabled-and-forced row security and the same ${RUNTIME_ROLE} grants, table by table: a rollback is only reversible if going forward again lands on the very database that was left, and a schema that comes back one grant wider or one policy short has quietly turned an incident into a permanent weakening nobody will ever diff`);
  assert.deepEqual(await allBusinessRows(query), preRollback.rows, `[${S}] the committed business rows must STILL be the ones that survived the rollback: a re-upgrade adds a table, it does not get to touch the data of the tables it never owned`);
  assert.deepEqual(await decisionRows(query), [], `[${S}] the re-created decision table must be EMPTY: re-applying a migration restores structure, never the rows its own downgrade destroyed, and the audited decision this system really made at head is gone for good — this assertion is the whole point of the package, and it is the reason a schema rollback over an audit table is an operational decision and not a routine one`);
  await assert.rejects(query(`DELETE FROM ${DECISION_TABLE}`), (error) => {
    assert.ok(error.code, `[${S}] the refusal must carry a SQLSTATE from PostgreSQL itself; got ${error.message}`);
    return true;
  }, `[${S}] the re-created table must be append-only again even to the superuser: the append-only trigger is the invariant most easily lost when an object is dropped and re-created, and a re-upgrade that restores the table without it would leave an audit log that can be edited`);
});

test("P23C-6 the audited business resumes on the re-applied schema through the never-restarted listener — as a NEW chain genesis beside the rows that survived — and teardown leaves zero labelled resources and no secret on disk", async () => {
  const S = "P23C-6";
  await requireProbe(S);  await requireContract(S);
  const env = await liveEnvironment(S);
  const { collectLabelledResources, stopLiveEnvironment } = await harness();  const query = db(env);
  try {
    assert.equal((await collectLabelledResources(env.label)).containers.length, 2, `[${S}] exactly two labelled containers may exist at this point — the re-served database and the untouched listener: both maintenance containers this package started must already be gone from the daemon, because a container able to reach the whole business database over a published port is not something a drill leaves running`);
    assert.deepEqual(appIdentity(await env.inspect("app")), preRollback.app, `[${S}] the listener that now accepts a write must be the same never-restarted process that was refused in P23C-4: the rollback, the outage and the recovery were all lived through by one running application`);
    const { receipt } = await commitOne(S, env, preRollback.principal);
    assert.match(receipt.resourceId, UUID_FORM, `[${S}] the post-rollback receipt must name a canonical resource id`);
    assert.notEqual(receipt.resourceId, preRollback.receipt.resourceId, `[${S}] the post-rollback write must be a second customer, not a replay of the one that survived`);
    for (const [index, table] of BUSINESS_TABLES.entries()) assert.deepEqual(await businessRows(query, table), [...preRollback.rows[table], { id: boundIds(receipt)[index], tenant_id: preRollback.principal.tenantId }], `[${S}] ${table} must now hold the row that survived the rollback AND the new one, in that order: the business that existed before the bad schema change and the business that continued after it live in the same table`);
    const decisions = await decisionRows(query);
    assert.equal(decisions.length, 1, `[${S}] exactly one decision may stand on the re-applied schema: the one this write just made`);
    const [resumed] = decisions;
    assert.deepEqual(verifyPersistedDecisionLogRow(resumed), { receiptType: "DecisionLogAppendReceipt", entryId: resumed.id, tenantId: preRollback.principal.tenantId, entryHash: resumed.entry_hash, prevHash: null }, `[${S}] the resumed decision must verify independently from its own persisted payload`);
    assert.equal(resumed.prev_hash, null, `[${S}] the resumed decision must be a NEW GENESIS, and this package says so plainly rather than implying continuity: the chain that recorded ${preRollback.genesis.entry_hash} was destroyed with its table, nothing can link to a hash that no longer exists, and an audit trail that RESTARTS after a schema rollback cannot prove what the system decided before it — the tamper-evidence is intact going forward and the history behind it is gone, which is exactly the trade an operator must be told about before they approve a rollback like this one`);
    assert.notEqual(resumed.entry_hash, preRollback.genesis.entry_hash, `[${S}] the resumed genesis must be its own entry and not a re-creation of the destroyed one`);
    assert.equal(resumed.payload.decision, "allow", `[${S}] the resumed write must have been allowed by a recorded decision`);
  } finally {
    await stopLiveEnvironment(env).catch(() => {});
  }
  const survivors = await collectLabelledResources(env.label);
  for (const kind of ["containers", "networks", "imageTags", "volumes", "secretDirs"]) assert.deepEqual(survivors[kind], [], `[${S}] no labelled ${kind} may outlive this run — including anything the migration seam created, which must carry the same label so the unchanged P22B1 teardown removes it; got ${JSON.stringify(survivors[kind])}`);
  const leftovers = (await readdir(tmpdir()).catch(() => [])).filter((entry) => entry.startsWith(LABEL_VALUE));
  assert.deepEqual(leftovers, [], `[${S}] no directory or file this run created may be left in ${tmpdir()}: the migration credential crossed as a file on this host, and the P22B1 teardown only knows the secret directory IT made — anything the migration seam wrote for itself is the migration seam's to remove; got ${JSON.stringify(leftovers)}`);
});
