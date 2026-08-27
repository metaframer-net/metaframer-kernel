import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P22B1 — one ephemeral live environment and the live HTTP proof that runs inside it, and nothing
// else. P22A1 fixed how a mounted credential reaches the existing audited runner; P22A2 froze the
// image that carries it, and neither started a listener or contacted a database. This frozen test
// owns every fixed expectation for the first package that does both: a real, digest-pinned
// PostgreSQL 16.15 on an isolated internal network at the real migration head under the real role
// split, and the UNCHANGED P22A2 image running its own installed Uvicorn behind an in-container
// HTTP client. It deliberately proves no audited write — every route exercised here is a refusal
// and the four runtime tables stay empty; the audit path is P22B2's. The environment is ephemeral
// by construction: it is stopped inside this suite, and its containers, network, image tag and
// temporary host secret directory are gone before it exits. Docker is a hard requirement, because
// `npm test` here already requires a working daemon. The manifest gates the run and never supplies
// an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN_TEST_PATH = "tests/kernel-deploy-ephemeral-environment-p22b1.test.mjs";
const HARNESS_PATH = "tests/_harness/live-http-postgres-environment.mjs";
const MANIFEST_PATH = "planning/kernel-deploy-ephemeral-environment-p22b1.json";
const DOCKERFILE_PATH = "host/deploy/Dockerfile";
const HOST_CLI_PATH = "host/python_asgi/create_customer_host_cli.py";
const WRAPPER_IN_IMAGE = "/app/host/deploy/secret_file_runner.mjs";
const SECRET_MOUNT_DIR = "/run/secrets";
const ALLOWED_FILES = Object.freeze([FROZEN_TEST_PATH, HARNESS_PATH, MANIFEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P22B1-1", "P22B1-2", "P22B1-3", "P22B1-4", "P22B1-5"]);
const [BASE_COMMIT, BASE_TREE] = ["29c9fac3f640743db1c75b1123ef2feb5afcfe85", "5fa161a7a5084eb62a1510bfc439df4d78906fe6"];
const SCOPE_V1 = "24e53a3f4231627d6fbba3378e1707c5a264db298753ed03686216c3f4991117";
const PARENT_SCOPE = "f7a1dd4042b9e65ed510389435b8632930f2374da6c35993f6d89ae2e0476efc";
const BLIND_SCOPE = "3f98f650575bc3c62354cb5deaf9653d4b7ad4e0c8a5e17dcd049d33376e784d";
const REJECTED_TEST = "a678ef233561337b58fd20ca377f7e8a3ab65995ad925cd6ef5af4b93530e3f0";
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The database is pinned to a frozen multiarch index digest for the same reason every P22A2 base
// is: a tag is a mutable pointer, and a moved tag silently changes what this proof ran against.
const POSTGRES_IMAGE = "postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const [SERVER_VERSION, MIGRATION_HEAD, INSUFFICIENT_PRIVILEGE] = ["16.15", "0003_policy_decision_log", "42501"];
const ROLES = Object.freeze({ migration: "mfk_migration", runtime: "mfk_runtime" });
const RUNTIME_TABLES = Object.freeze(["audit_log", "customer_records", "policy_decision_log", "transactional_outbox"]);
const [UVICORN_VERSION, APP_PORT] = ["0.40.0", 8000];
const [LABEL_KEY, LABEL_PREFIX] = ["com.metaframer.kernel.deploy", "p22b1"];
// Unique per process, so one concurrent run can never sweep or adopt another run's resources.
const LABEL_VALUE = `${LABEL_PREFIX}-${randomBytes(6).toString("hex")}`;
const HARNESS_API = Object.freeze(["LIVE_ENVIRONMENT_CONTRACT", "collectLabelledResources", "startLiveEnvironment", "stopLiveEnvironment"]);
const HARDENING = Object.freeze(["--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]);
const TIMEOUT_KEYS = Object.freeze(["dockerCli", "imagePull", "ready", "http", "stop"]);
const SILENT_SURFACES = Object.freeze(["argv", "env", "inspect", "logs", "image", "proc"]);
// One value that exists nowhere else in this repository; it is the real runtime-role password.
const SENTINEL = "p22b1-sentinel-Q4wZ8nT3pH6yR9kM-do-not-log";
const TRUE_FLAGS = Object.freeze(["runtimeImplementationStarted", "hostServerSelectedForDeployArtifact", "networkListenerStarted"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p22Complete", "stagingEnvironmentExists",
  "stagingRunPerformed", "productionHostSelected", "registryPushed", "externalDeploymentPerformed", "liveHttpAuditProven"]);

/** Read one dotted path, so a binding table names the exact field it binds. */
const at = (node, dotted) => dotted.split(".").reduce((value, key) => value?.[key], node);

/** The FIRST action of every scenario. A checkout without the harness fails HERE, naming the exact missing
 * allowed path, BEFORE Docker is touched: RED on the absent implementation, never on a daemon or a pull. */
const requireHarness = (scenario) =>
  import(pathToFileURL(path.join(root, HARNESS_PATH)).href).catch((error) =>
    assert.fail(`[${scenario}] the allowed P22B1 harness ${HARNESS_PATH} must exist before this scenario can run: ${error.message}`));

/** Load-bearing contract read: no P22B1 scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P22B1 manifest ${MANIFEST_PATH} must exist before this scenario can run: ${error.message}`)));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS],
    `[${scenario}] ${MANIFEST_PATH} must declare exactly the five P22B1 scenario ids, in order`);
  return contract;
}

/** Exactly one ephemeral environment for the whole suite; every later scenario awaits this promise. */
let live = null;
const liveEnvironment = (scenario) => (live ??= requireHarness(scenario).then(({ startLiveEnvironment }) => {
  // Armed here and nowhere else — only now can a labelled resource exist, so on the absent-harness base this suite
  // issues no Docker command at all — and the sweep is null-safe and scoped to THIS run's unique label alone.
  process.on("exit", () => {
    const filter = ["--filter", `label=${LABEL_KEY}=${LABEL_VALUE}`];
    const listed = spawnSync("docker", ["ps", "-aq", ...filter], { encoding: "utf8" })?.stdout ?? "";
    for (const id of listed.split("\n").filter(Boolean)) spawnSync("docker", ["rm", "--force", "--volumes", id], { stdio: "ignore" });
    for (const kind of ["network", "image"]) spawnSync("docker", [kind, "prune", "--force", ...filter], { stdio: "ignore" });
  });
  return startLiveEnvironment({ runtimePassword: SENTINEL, label: { key: LABEL_KEY, value: LABEL_VALUE } });
}));

test("P22B1-1 the harness declares a frozen contract that pins the database, targets the EXISTING image definition, console entry and P22A1 wrapper, and bounds every wait", async () => {
  const S = "P22B1-1";
  const harness = await requireHarness(S);
  await requireContract(S);
  assert.deepEqual(Object.keys(harness).sort(), [...HARNESS_API], `[${S}] ${HARNESS_PATH} must export exactly this API and nothing more`);
  for (const name of HARNESS_API.slice(1)) assert.equal(typeof harness[name], "function", `[${S}] ${name} must be callable`);
  const contract = harness.LIVE_ENVIRONMENT_CONTRACT;
  assert.ok(Object.isFrozen(contract), `[${S}] LIVE_ENVIRONMENT_CONTRACT must be frozen: a mutable environment contract can be edited by the very run that must be judged against it`);
  for (const [field, want] of [["postgresImage", POSTGRES_IMAGE], ["migrationRole", ROLES.migration],
    ["runtimeRole", ROLES.runtime], ["dockerfile", DOCKERFILE_PATH], ["hostCli", HOST_CLI_PATH], ["runner", "uvicorn"],
    ["wrapperInImage", WRAPPER_IN_IMAGE], ["secretMountDir", SECRET_MOUNT_DIR], ["appPort", APP_PORT],
    ["publishesHostPort", false], ["network.internal", true], ["labelKey", LABEL_KEY], ["labelValuePrefix", LABEL_PREFIX]]) {
    assert.equal(at(contract, field), want, `[${S}] the harness contract must fix ${field} to ${JSON.stringify(want)}: the database pin, the EXISTING image definition and console entry it launches, the EXISTING P22A1 wrapper it enters through, the port it never publishes and the label every created resource carries are all decided here and nowhere else`);
  }
  assert.deepEqual([...(contract.hardening ?? [])], [...HARDENING], `[${S}] the application container must run read-only, on a tmpfs /tmp, with every capability dropped and no-new-privileges`);
  assert.ok(!JSON.stringify(contract).includes("--privileged"), `[${S}] nothing in this environment may be privileged`);
  for (const key of TIMEOUT_KEYS) {
    const bound = contract.timeouts?.[key];
    assert.ok(Number.isFinite(bound) && bound > 0 && bound <= 900_000, `[${S}] timeouts.${key} must be a finite bound of at most 900000ms: an unbounded wait hangs a test run instead of failing it; got ${bound}`);
  }
  assert.ok(!/^\s*FROM\s/m.test(await readFile(path.join(root, HARNESS_PATH), "utf8")), `[${S}] the harness must define no image of its own: P22B1 runs the UNCHANGED P22A2 image and changes no image file`);
  const dockerfile = await readFile(path.join(root, DOCKERFILE_PATH), "utf8");
  assert.match(dockerfile, new RegExp(`ENTRYPOINT \\["node", "${WRAPPER_IN_IMAGE}"\\]`), `[${S}] precondition: ${DOCKERFILE_PATH} still enters through the existing P22A1 wrapper, untouched by this package`);
  assert.ok(dockerfile.includes(`"${SECRET_MOUNT_DIR}/database-url.txt"`), `[${S}] precondition: the existing image still takes its credential as a mounted file path`);
  await access(path.join(root, HOST_CLI_PATH));
});

test("P22B1-2 a real pinned PostgreSQL 16.15 comes up on an isolated internal network at the real migration head, and the runtime role cannot change the schema it serves", async () => {
  const S = "P22B1-2";
  await requireHarness(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  assert.equal(env.postgres.image, POSTGRES_IMAGE, `[${S}] the database must be the pinned image, not whatever the tag resolves to today`);
  assert.ok(String(env.postgres.serverVersion).startsWith(SERVER_VERSION), `[${S}] the server must really report ${SERVER_VERSION}; got ${env.postgres.serverVersion}`);
  assert.ok(env.postgres.serverVersionNum >= 160000 && env.postgres.serverVersionNum < 170000, `[${S}] server_version_num must sit inside the 16 series; got ${env.postgres.serverVersionNum}`);
  assert.equal(env.postgres.publishedHostPort, null, `[${S}] the database must publish no host port: it is reachable only from the isolated network`);
  assert.match(env.network, /^mfk-p22b1-/, `[${S}] the network must be uniquely named per run, so concurrent runs never adopt a stranger's environment; got ${env.network}`);
  for (const which of ["postgres", "app"]) {
    assert.deepEqual(Object.keys((await env.inspect(which))?.NetworkSettings?.Networks ?? {}), [env.network], `[${S}] the ${which} container must be attached to exactly the one internal network ${env.network} and never to the default bridge`);
  }
  const head = await env.sql("migration", "SELECT version_num FROM alembic_version");
  assert.deepEqual(head.rows.map((row) => row.version_num), [MIGRATION_HEAD], `[${S}] the ${ROLES.migration} role must have migrated the database to exactly the real head ${MIGRATION_HEAD}`);
  const tableList = async () => (await env.sql("migration",
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((row) => row.tablename);
  const before = await tableList();
  for (const table of RUNTIME_TABLES) assert.ok(before.includes(table), `[${S}] the migrated schema must carry ${table}; got ${before.join(", ")}`);

  for (const statement of ["CREATE TABLE p22b1_forbidden (id integer)",
    `ALTER TABLE ${RUNTIME_TABLES[1]} ADD COLUMN p22b1_forbidden integer`, `DROP TABLE ${RUNTIME_TABLES[0]}`]) {
    await assert.rejects(env.sql("runtime", statement), (error) => {
      assert.equal(error.code, INSUFFICIENT_PRIVILEGE, `[${S}] "${statement}" as ${ROLES.runtime} must be refused by PostgreSQL itself with SQLSTATE ${INSUFFICIENT_PRIVILEGE}, not by anything this repository wrote; got ${error.code}: ${error.message}`);
      return true;
    }, `[${S}] the runtime role must not be able to run: ${statement}`);
  }
  assert.deepEqual(await tableList(), before, `[${S}] the schema must be identical after all three refused statements: a refusal that still altered the catalogue would be no refusal at all`);
});

test("P22B1-3 the UNCHANGED P22A2 image serves live HTTP from its own installed Uvicorn under full hardening, answers every exercised route with a refusal, and writes nothing", async () => {
  const S = "P22B1-3";
  await requireHarness(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  const image = await env.inspect("image");
  assert.deepEqual(image.Config?.Entrypoint, ["node", WRAPPER_IN_IMAGE], `[${S}] the image itself is unchanged: its entrypoint is still the P22A1 wrapper, and Uvicorn is started by a run-time override rather than by editing the image`);
  assert.deepEqual(image.Config?.Cmd, ["--config-file", `${SECRET_MOUNT_DIR}/config.json`, "--database-url-file", `${SECRET_MOUNT_DIR}/database-url.txt`], `[${S}] the image's default command is still exactly the two mounted secret-file paths`);
  const app = await env.inspect("app");
  assert.match(String(app.Config?.User ?? ""), /^\d+(?::\d+)?$/, `[${S}] the running container must keep the image's NUMERIC user; got ${JSON.stringify(app.Config?.User)}`);
  assert.ok(Number(String(app.Config?.User).split(":")[0]) > 0, `[${S}] the listener must not run as uid 0`);
  assert.equal(app.HostConfig?.ReadonlyRootfs, true, `[${S}] the rootfs must stay read-only while serving`);
  assert.ok(Object.keys(app.HostConfig?.Tmpfs ?? {}).includes("/tmp"), `[${S}] /tmp must be a tmpfs, so a read-only rootfs still has exactly one writable path and nothing else`);
  assert.deepEqual(app.HostConfig?.CapDrop, ["ALL"], `[${S}] every Linux capability must be dropped`);
  assert.ok((app.HostConfig?.SecurityOpt ?? []).includes("no-new-privileges"), `[${S}] no-new-privileges must be set: without it a setuid binary inside the image could still escalate`);
  assert.deepEqual([app.HostConfig?.PortBindings ?? {}, app.NetworkSettings?.Ports ?? {}], [{}, {}], `[${S}] no application port may be published to the host: this listener is reachable only from inside the isolated network`);
  assert.equal(env.app.uvicornVersion, UVICORN_VERSION, `[${S}] the server must be exactly the uvicorn ${UVICORN_VERSION} the image hash-locks — no second server is installed and none is fetched at run time`);
  assert.match(await env.logs("app"), new RegExp(`Uvicorn running on http://[\\d.]+:${APP_PORT}`), `[${S}] the container's own log must show its installed Uvicorn really bound ${APP_PORT}`);

  for (const [method, route, status, code] of [["GET", "/healthz", 404, "ROUTE_NOT_FOUND"],
    ["POST", "/healthz", 404, "ROUTE_NOT_FOUND"], ["GET", "/customers", 405, "METHOD_NOT_SUPPORTED"]]) {
    const response = await env.request(method, route);
    assert.equal(response.status, status, `[${S}] ${method} ${route} must answer ${status} from inside the container; got ${response.status}`);
    assert.equal(response.json?.error?.code, code, `[${S}] ${method} ${route} must answer the real router's ${code} envelope, proving the request reached the audited JS boundary and not a stand-in; got ${JSON.stringify(response.json)}`);
    assert.equal(response.json?.error?.retryable, false, `[${S}] a routing refusal is never retryable`);
  }
  for (const table of RUNTIME_TABLES) {
    const counted = await env.sql("migration", `SELECT count(*)::int AS n FROM ${table}`);
    assert.equal(counted.rows[0]?.n, 0, `[${S}] ${table} must still be empty: every route exercised here is a refusal, so P22B1 proves live HTTP and deliberately proves no audited write — that is P22B2's`);
  }
});

test("P22B1-4 neither the deploy URL nor its password reaches any of the six observable surfaces, and stopping the environment is idempotent and complete", async () => {
  const S = "P22B1-4";
  const { collectLabelledResources, stopLiveEnvironment } = await requireHarness(S);
  await requireContract(S);
  const env = await liveEnvironment(S);
  const surfaces = await env.disclosure();
  assert.deepEqual(Object.keys(surfaces).sort(), [...SILENT_SURFACES, "mountedFile"].sort(), `[${S}] the harness must collect exactly these surfaces`);
  // The positive control comes first. Without it, six silent surfaces would prove only that no
  // credential existed. The claim here is narrow and exact: the credential IS real, IS mounted and
  // IS in use, and it is absent from these six surfaces. Nothing here claims it is unextractable
  // by a party who can already read the mount, the container filesystem or the database.
  assert.ok(surfaces.mountedFile.includes(SENTINEL), `[${S}] the mounted secret file must really carry the runtime credential this environment runs on; a silent surface list means nothing without this control`);
  for (const name of SILENT_SURFACES) {
    const surface = surfaces[name];
    assert.ok(typeof surface === "string" && surface.length > 0, `[${S}] the ${name} surface must really be collected; an empty string proves nothing`);
    assert.ok(!surface.includes(SENTINEL), `[${S}] the runtime password must never appear on the ${name} surface`);
    assert.doesNotMatch(surface, /postgres(?:ql)?:\/\//i, `[${S}] no connection string may appear on the ${name} surface`);
  }
  const [first, second] = [await stopLiveEnvironment(env), await stopLiveEnvironment(env)];
  assert.equal(first.stopped, true, `[${S}] the first stop must really tear the environment down`);
  assert.equal(second.stopped, true, `[${S}] a second stop must succeed rather than throw: teardown runs from a finally block and must never mask the failure that sent it there`);
  assert.equal(second.alreadyStopped, true, `[${S}] the second stop must report that it removed nothing`);
  const survivors = await collectLabelledResources({ key: LABEL_KEY, value: LABEL_VALUE });
  for (const kind of ["containers", "networks", "imageTags", "secretDirs"]) {
    assert.deepEqual(survivors[kind], [], `[${S}] no labelled ${kind} may outlive the environment; got ${JSON.stringify(survivors[kind])}`);
  }
  await assert.rejects(access(env.secretDir), `[${S}] the temporary host secret directory ${env.secretDir} must be removed from disk, not merely unmounted`);
});

test("P22B1-5 the planning manifest binds this package to its base, its blind-frozen scope, its three allowed files, its measured metrics, its rollback and its unchanged readiness", async () => {
  const S = "P22B1-5";
  const contract = await requireContract(S);
  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  for (const [field, want] of [["base", BASE_COMMIT], ["baseTree", BASE_TREE], ["actionplanPin", ACTIONPLAN_PIN],
    ["frozenTestPath", FROZEN_TEST_PATH], ["frozenTestSha256", digest], ["greenEvidence.targetedTest", TARGETED_TEST],
    ["splitEvidence.scopeSynthesisName", "P22B1_SCOPE_SYNTHESIS_V1"], ["splitEvidence.scopeSynthesisSha256", SCOPE_V1],
    ["splitEvidence.parentScopeSha256", PARENT_SCOPE], ["splitEvidence.blindScopeSha256", BLIND_SCOPE],
    ["splitEvidence.rejectedTestSha256", REJECTED_TEST], ["splitEvidence.thisPackage", "P22B1"],
    ["splitEvidence.counter", "21/25"], ["environmentPins.postgresImage", POSTGRES_IMAGE],
    ["environmentPins.migrationHead", MIGRATION_HEAD], ["provenance.singleWriter", true],
    ["provenance.reviewerMustBeSeparateSession", true], ["provenance.testAuthoring", "claude-only"],
    ["rollback.compensatingStepRequired", false]]) {
    assert.equal(at(contract, field), want, `[${S}] the manifest must record ${field} as ${JSON.stringify(want)}: the immutable base, the blind-frozen and reconciled scopes, the sha256 of the rejected earlier test so it can never be revived, the unmoved 21/25 counter, the pinned environment, the single-writer provenance and the rollback are all bound here`);
  }
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the three allowed P22B1 paths`);
  assert.deepEqual(contract.splitEvidence?.delivered, ["P22A1", "P22A2"], `[${S}] both halves of the P22A split are already delivered`);
  assert.deepEqual(contract.splitEvidence?.remaining, ["P22B2", "P22C"], `[${S}] P22B2 and P22C must remain outstanding; live HTTP alone does not close P22`);
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
  for (const untouched of ["srcUntouched", "hostDeployImageUntouched", "secretFileRunnerUntouched", "dbUntouched", "ciUntouched", "dependenciesUntouched"]) {
    assert.equal(contract.rollback?.[untouched], true, `[${S}] the manifest must record ${untouched}=true`);
  }
  const flags = contract.readinessFlags ?? {};
  for (const flag of TRUE_FLAGS) {
    assert.equal(flags[flag], true, `[${S}] ${flag} must be true: the image carries exactly one selected host server and this package really started it as a network listener against a real pinned database, and denying evidence a package carries is as wrong as claiming evidence it does not`);
  }
  for (const flag of FALSE_FLAGS) {
    assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P22B1 is one ephemeral environment that deletes itself — not a staging environment, not a staging run, not an audited business write (that is P22B2), not a registry push and not a deployment`);
  }
  assert.equal(Object.keys(flags).length, TRUE_FLAGS.length + FALSE_FLAGS.length, `[${S}] no readiness flag beyond the declared set may be introduced`);
  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of ["audited write", "persistent", "staging", "registry", "deployment", "host port", "image", "roadmap", "current-truth"]) {
    assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  }
  assert.match(String(contract.capabilityDelta ?? ""), /^EPHEMERAL_LIVE_HTTP_ENVIRONMENT:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
  }
});
