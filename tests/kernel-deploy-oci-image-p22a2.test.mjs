import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P22A2 — the OCI image for the deploy artifact, and nothing else. P22A1 fixed how a mounted
// credential reaches the existing audited runner without becoming an OS argument, and deliberately
// built no container. This frozen test owns every fixed expectation for that container: one
// host/deploy/Dockerfile whose bases are pinned to frozen multiarch INDEX digests, a deny-first
// host/deploy/Dockerfile.dockerignore context fence, a hash-locked host/deploy/requirements-uvicorn.txt
// and one additive blocking audit step in the existing .github/workflows/security.yml. The image is
// really built once, really inspected and really run under a read-only, capability-dropped,
// network-isolated runtime — but it starts no listener, serves no HTTP and contacts no database:
// that is P22B's proof, and roadmap current-truth closure is P22C's. Docker is a hard requirement
// because `npm test` here already requires a working daemon. The manifest gates the run and never
// supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-deploy-oci-image-p22a2.json";
const FROZEN_TEST_PATH = "tests/kernel-deploy-oci-image-p22a2.test.mjs";
const DOCKERFILE_PATH = "host/deploy/Dockerfile";
const IGNORE_PATH = "host/deploy/Dockerfile.dockerignore";
const REQUIREMENTS_PATH = "host/deploy/requirements-uvicorn.txt";
const WORKFLOW_PATH = ".github/workflows/security.yml";
const ALLOWED_FILES = Object.freeze([MANIFEST_PATH, FROZEN_TEST_PATH, DOCKERFILE_PATH, IGNORE_PATH, REQUIREMENTS_PATH, WORKFLOW_PATH]);
const SCENARIO_IDS = Object.freeze(["P22A2-1", "P22A2-2", "P22A2-3", "P22A2-4"]);
const BASE_COMMIT = "034d369557a3f9cf4b56bac518a475c6a293d67b";
const BASE_TREE = "205c6855e7ac00f3b07495f58d7de676995853d8";
const SCOPE_V2 = "f0e05139eb60e04d739b62bab3dcaa43c8b5922fae6e56e4d4365fa4dee6325e";
const PARENT_SCOPE = "adf916088d6e44f83045fe78f33fa7444c1cd407855d65d38785be226699e033";
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
// The three frozen multiarch INDEX digests. A tag alone is mutable; only the index digest makes the
// same build reproducible on every architecture that pulls it.
const PINS = Object.freeze({
  node: { name: "node", version: "22.23.2", digest: "sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5" },
  python: { name: "python", version: "3.12.14", digest: "sha256:0f5b26b9518d002b6173fd61daad821fa340635ebfec5bba471013f9ca114579" },
  uv: { name: "uv", version: "0.11.1", digest: "sha256:fc93e9ecd7218e9ec8fba117af89348eef8fd2463c50c13347478769aaedd0ce" },
});
const NODE_VERSION = "v22.23.2";
const UVICORN_VERSION = "0.40.0";
const SECRET_DIR = "/run/secrets";
const CMD = Object.freeze(["--config-file", `${SECRET_DIR}/config.json`, "--database-url-file", `${SECRET_DIR}/database-url.txt`]);
const WRAPPER_IN_IMAGE = "/app/host/deploy/secret_file_runner.mjs";
const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3399";
const ACTOR = "actor-p22a2-oci-image";
// One value that exists nowhere else in this repository. Every non-disclosure assertion is written
// against exactly this string.
const SENTINEL = "p22a2-sentinel-K7vR2mQ9xB4tL6sD-do-not-log";
const DB_URL = `postgresql://mfk_runtime:${SENTINEL}@127.0.0.1:5432/mfk`;
const TAG = `mfk-p22a2-${randomBytes(6).toString("hex")}:test`;
const HARDENED = Object.freeze(["--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none"]);
const DB_CONTACT = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|password authentication|pg_hba|SASL/i;
const LISTENER = /Uvicorn running|Hypercorn|listening on|Started server|0\.0\.0\.0:\d+/i;
const ABSENT_MODULES = Object.freeze(["hypercorn", "fastapi", "django", "metaframer_kernel_db"]);
const ABSENT_PATHS = Object.freeze(["/app/tests", "/app/planning", "/app/db", "/app/.git", "/app/.github"]);
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p22Complete",
  "stagingEnvironmentExists", "stagingRunPerformed", "networkListenerStarted", "productionHostSelected", "registryPushed", "externalDeploymentPerformed"]);
// One probe run, one shell, every image fact this package fixes.
const PROBE = [
  'echo "node=$(node --version)"',
  `node -p "'pg=' + require('/app/node_modules/pg/package.json').version"`,
  `python3 -c "import uvicorn, python_asgi; print('uvicorn=' + uvicorn.__version__); print('hostwheel=' + python_asgi.__file__)"`,
  `for m in ${ABSENT_MODULES.join(" ")}; do python3 -c "import $m" 2>/dev/null && echo "module-present=$m" || echo "module-absent=$m"; done`,
  `for p in ${ABSENT_PATHS.join(" ")}; do [ -e "$p" ] && echo "path-present=$p" || echo "path-absent=$p"; done`,
].join("\n");

const containers = new Set();
/** Task-scoped teardown: every container this suite named, then the task-scoped image tag. */
const cleanup = () => {
  for (const name of containers) spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" });
  containers.clear();
  spawnSync("docker", ["image", "rm", "--force", TAG], { stdio: "ignore" });
};
process.on("exit", cleanup);

/**
 * The single load-bearing read for every allowed implementation surface. A checkout that does not
 * yet carry the file fails HERE, naming the exact missing allowed path, so this suite is
 * deterministically RED on the absent implementation and never on a syntax or unrelated defect.
 */
async function readAllowed(rel, scenario) {
  return readFile(path.join(root, rel), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P22A2 implementation surface ${rel} must exist before this scenario can run: ${error.message}`));
}

/** The first RED seam of every scenario: no image definition, no P22A2 — before any other read. */
const requireDockerfile = (scenario) => readAllowed(DOCKERFILE_PATH, scenario);

/** Load-bearing contract read: no P22A2 scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readAllowed(MANIFEST_PATH, scenario));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS], `[${scenario}] ${MANIFEST_PATH} must declare exactly the four P22A2 scenario ids, in order`);
  return contract;
}

/** Exactly one real build for the whole suite; every later scenario awaits this same promise. */
let built = null;
function buildImage(scenario) {
  built ??= (async () => {
    if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status !== 0) {
      throw new Error(`[${scenario}] docker is not available in this environment: npm test in this repository already requires a working daemon, so this is an environment failure and never a P22A2 capability gap`);
    }
    const build = spawnSync("docker", ["build", "--file", DOCKERFILE_PATH, "--tag", TAG, "--progress", "plain", "."],
      { cwd: root, encoding: "utf8", timeout: 1_800_000, env: { ...process.env, DOCKER_BUILDKIT: "1" } });
    assert.equal(build.status, 0, `[${scenario}] the pinned deploy image must build from ${DOCKERFILE_PATH} with the repository root as its build context:\n${build.stdout}\n${build.stderr}`);
    return `${build.stdout}${build.stderr}`;
  })();
  return built;
}

/** One hardened, uniquely named, always-removed container run of the built image. */
function runImage(args, { dir, input = "", extraRun = [] } = {}) {
  const name = `mfk-p22a2-${randomBytes(6).toString("hex")}`;
  containers.add(name);
  const mount = dir ? ["--volume", `${dir}:${SECRET_DIR}:ro`] : [];
  try {
    return spawnSync("docker", ["run", "--rm", "--name", name, "--interactive", ...HARDENED, ...mount, ...extraRun, TAG, ...args],
      { input, encoding: "utf8", timeout: 300_000 });
  } finally {
    spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" });
    containers.delete(name);
  }
}

const completeConfig = () => ({ policy: "allow", audit: "on", trustedTenantId: TENANT, trustedActorId: ACTOR });

/** A task-scoped secret mount, world-traversable so the image's own non-root uid can read it. */
async function withSecrets(fn, { config = completeConfig(), dbUrl = `${DB_URL}\n`, omit = [] } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "p22a2-secrets-"));
  try {
    await chmod(dir, 0o755);
    if (!omit.includes("config")) await writeFile(path.join(dir, "config.json"), typeof config === "string" ? config : `${JSON.stringify(config)}\n`, { mode: 0o644 });
    if (!omit.includes("db")) await writeFile(path.join(dir, "database-url.txt"), dbUrl, { mode: 0o644 });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("P22A2-1 the image definition pins every base by frozen multiarch digest, installs only from locks, fences the build context deny-first and extends the blocking security audit", async () => {
  const S = "P22A2-1";
  const dockerfile = await requireDockerfile(S);
  const [ignore, requirements, workflow] = await Promise.all([IGNORE_PATH, REQUIREMENTS_PATH, WORKFLOW_PATH].map((rel) => readAllowed(rel, S)));
  await requireContract(S);

  for (const [key, pin] of Object.entries(PINS)) {
    assert.match(dockerfile, new RegExp(`${pin.name}:${pin.version.replace(/\./g, "\\.")}[\\w.-]*@${pin.digest}\\b`), `[${S}] ${DOCKERFILE_PATH} must pin ${key} to ${pin.name}:${pin.version} at the frozen multiarch index digest ${pin.digest}`);
  }
  const externalFroms = (dockerfile.match(/^\s*FROM\s+.*$/gm) ?? []).filter((line) => line.includes("/") || line.includes(":"));
  assert.ok(externalFroms.length >= 2, `[${S}] the build must be multi-stage: a single stage ships its own toolchain into the runtime image`);
  for (const from of externalFroms) assert.match(from, /@sha256:[0-9a-f]{64}/, `[${S}] a floating tag is not a reproducible base: ${from.trim()}`);
  assert.ok(!/^\s*ADD\s+https?:/mi.test(dockerfile) && !/curl[^\n]*\|\s*(?:sh|bash)/.test(dockerfile), `[${S}] nothing may be fetched unverified from the network at build time: an unpinned download defeats every digest above it`);
  assert.match(dockerfile, /npm ci\b/, `[${S}] the JS runtime dependency must be installed with npm ci, which refuses to resolve outside package-lock.json`);
  assert.ok(!/npm\s+install\b/.test(dockerfile), `[${S}] npm install may resolve a version the lock never recorded and must not appear`);
  for (const needle of ["--omit=dev", "package-lock.json", "--require-hashes", "requirements-uvicorn.txt", "pyproject.toml"]) {
    assert.ok(dockerfile.includes(needle), `[${S}] ${DOCKERFILE_PATH} must install from ${needle}: every install in this image is locked, hashed and reproducible`);
  }
  assert.match(requirements, new RegExp(`^uvicorn==${UVICORN_VERSION.replace(/\./g, "\\.")}\\b`, "m"), `[${S}] ${REQUIREMENTS_PATH} must pin uvicorn to exactly ${UVICORN_VERSION}`);
  assert.ok((requirements.match(/--hash=sha256:[0-9a-f]{64}/g) ?? []).length >= 2, `[${S}] every distribution in ${REQUIREMENTS_PATH}, uvicorn's own transitive set included, must carry a sha256 hash`);
  const unpinned = requirements.split("\n").filter((line) => /^[A-Za-z0-9]/.test(line) && !line.includes("=="));
  assert.deepEqual(unpinned, [], `[${S}] ${REQUIREMENTS_PATH} must pin every requirement exactly; a range is not a lock`);
  assert.match(await readFile(path.join(root, "host/pyproject.toml"), "utf8"), /^dependencies = \[\]$/m, `[${S}] precondition: host/pyproject.toml still declares no dependencies — uvicorn is a hash-locked IMAGE requirement here and is never added to the host distribution or its lock`);

  const rules = ignore.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const reincluded = rules.filter((line) => line.startsWith("!")).map((line) => line.slice(1).replace(/^\//, ""));
  const covers = (needle) => reincluded.some((rule) => rule === needle || rule.startsWith(`${needle}/`));
  assert.equal(rules[0], "*", `[${S}] ${IGNORE_PATH} must deny the whole build context first; an exclusion list silently admits every file added to this repository later`);
  for (const needed of ["package.json", "package-lock.json", "src", "host/pyproject.toml", "host/python_asgi", "host/js_asgi",
    "host/deploy/secret_file_runner.mjs", "host/deploy/requirements-uvicorn.txt"]) {
    assert.ok(covers(needed), `[${S}] ${IGNORE_PATH} must re-include ${needed}: the P22A1 wrapper delegates to host/js_asgi, which imports the real src/ boundary`);
  }
  for (const forbidden of ["tests", "planning", "db", "docs", "consumers", ".git", ".github", "node_modules"]) {
    assert.ok(!covers(forbidden), `[${S}] ${IGNORE_PATH} must never re-include ${forbidden} into the build context`);
  }

  const audit = workflow.split(/^\s*-\s+name:/m).slice(1).find((step) => step.includes("requirements-uvicorn.txt"));
  assert.ok(audit, `[${S}] ${WORKFLOW_PATH} must gain exactly one step that audits ${REQUIREMENTS_PATH}: a hash-locked requirement nobody scans is still an unscanned dependency`);
  for (const needle of ["set -euo pipefail", "pip-audit==2.10.1", "--require-hashes", "--disable-pip"]) {
    assert.ok(audit.includes(needle), `[${S}] the uvicorn audit step must use ${needle}, exactly as the existing db audit already does`);
  }
  assert.ok(!/\|\|\s*true|continue-on-error|--ignore-vuln/.test(audit), `[${S}] the new audit step must stay blocking: an excused finding turns a gate into a report nobody reads`);
  for (const preserved of ["npm audit --omit=dev --audit-level=high", "uv export --project db", "trufflesecurity/trufflehog@sha256:"]) {
    assert.ok(workflow.includes(preserved), `[${S}] the P22A2 change to ${WORKFLOW_PATH} is additive only: the existing gate ${preserved} must survive untouched`);
  }
});

test("P22A2-2 one real build yields an image that runs as a numeric non-root user, execs the existing P22A1 wrapper on a fixed secret-file command, and carries the locked runtime and nothing else", async () => {
  const S = "P22A2-2";
  await requireDockerfile(S);
  await requireContract(S);
  await buildImage(S);

  const config = JSON.parse(execFileSync("docker", ["image", "inspect", TAG, "--format", "{{json .Config}}"], { encoding: "utf8" }));
  assert.match(String(config.User ?? ""), /^\d+(?::\d+)?$/, `[${S}] the image must declare a NUMERIC user, so no /etc/passwd lookup inside the image decides who it runs as; got ${JSON.stringify(config.User)}`);
  assert.ok(Number(String(config.User).split(":")[0]) > 0, `[${S}] the image must not run as uid 0`);
  assert.equal((config.Entrypoint ?? [])[0], "node", `[${S}] the entrypoint must be exec-form node: a shell wrapper would sit between the supervisor's signal and the process; got ${JSON.stringify(config.Entrypoint)}`);
  assert.ok((config.Entrypoint ?? []).includes(WRAPPER_IN_IMAGE), `[${S}] the entrypoint must be the EXISTING P22A1 wrapper ${WRAPPER_IN_IMAGE}, which this package does not modify; got ${JSON.stringify(config.Entrypoint)}`);
  assert.deepEqual(config.Cmd, [...CMD], `[${S}] the default command must be the fixed mounted secret-file paths and nothing else`);
  for (const entry of config.Env ?? []) {
    assert.doesNotMatch(entry, /(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|DATABASE_URL|PG(?:PASS|USER|HOST))/i, `[${S}] no credential-shaped environment variable may be baked into an image layer: ${entry}`);
    assert.doesNotMatch(entry, /postgres(?:ql)?:\/\//i, `[${S}] no connection string may be baked into an image layer: ${entry}`);
  }

  const probe = runImage(["-c", PROBE], { extraRun: ["--entrypoint", "sh"] });
  assert.equal(probe.status, 0, `[${S}] the image probe must run:\n${probe.stdout}\n${probe.stderr}`);
  const out = probe.stdout;
  const pgLocked = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")).packages["node_modules/pg"].version;
  for (const [fact, why] of [[`node=${NODE_VERSION}`, `exactly Node ${NODE_VERSION} from the pinned base`],
    [`uvicorn=${UVICORN_VERSION}`, `exactly uvicorn ${UVICORN_VERSION}, the version ${REQUIREMENTS_PATH} hash-locks`],
    [`pg=${pgLocked}`, `exactly the pg version package-lock.json resolves (${pgLocked}), proving npm ci installed from the lock and resolved nothing`]]) {
    assert.ok(out.includes(fact), `[${S}] the image must carry ${why}; got:\n${out}`);
  }
  assert.match(out, /hostwheel=\/[^\n]*site-packages\/python_asgi\//, `[${S}] the host ASGI distribution must be INSTALLED as a built wheel into site-packages, not copied in as loose source; got:\n${out}`);
  for (const module of ABSENT_MODULES) {
    assert.ok(out.includes(`module-absent=${module}`), `[${S}] ${module} must not be installed: the image serves the audited boundary and owns no second server and no migration authority; got:\n${out}`);
  }
  for (const dir of ABSENT_PATHS) {
    assert.ok(out.includes(`path-absent=${dir}`), `[${S}] ${dir} must never reach the image: the deny-first context fence, not luck, keeps it out; got:\n${out}`);
  }
});

test("P22A2-3 under a read-only, capability-dropped, network-isolated runtime every bad mount fails closed without disclosing the credential and a valid pair reaches the existing runner and stops there", async () => {
  const S = "P22A2-3";
  await requireDockerfile(S);
  await requireContract(S);
  await buildImage(S);

  const closed = (label, result) => {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.notEqual(result.status, 0, `[${S}] ${label} must fail the container closed and exit non-zero; got status ${result.status} and:\n${output}`);
    assert.ok(!output.includes(SENTINEL), `[${S}] ${label} must never disclose the mounted credential`);
    assert.doesNotMatch(output, DB_CONTACT, `[${S}] ${label} must fail before any PostgreSQL contact is attempted`);
    assert.doesNotMatch(output, LISTENER, `[${S}] ${label} must never start a network listener`);
    return output;
  };

  assert.match(await withSecrets((dir) => closed("an absent mounted config file", runImage([], { dir })), { omit: ["config"] }),
    /config\.json/, `[${S}] the refusal must name the missing mounted path`);
  await withSecrets((dir) => closed("an absent mounted database-url file", runImage([], { dir })), { omit: ["db"] });
  await withSecrets((dir) => closed("an empty mounted database-url file", runImage([], { dir })), { dbUrl: "" });
  await withSecrets((dir) => closed("a malformed mounted config file", runImage([], { dir })), { config: "{ not json" });
  await withSecrets(async (dir) => {
    await chmod(path.join(dir, "database-url.txt"), 0o000);
    closed("an unreadable mounted database-url file", runImage([], { dir }));
  });
  // An inline credential must not even be an accepted argument shape for the container.
  await withSecrets((dir) => closed("an inline credential argument offered to the container", runImage(["--connection-string", DB_URL, ...CMD], { dir })));

  await withSecrets((dir) => {
    const output = closed("a malformed stdin envelope delivered through a valid pair of mounts", runImage([], { dir, input: "{ not a valid envelope" }));
    assert.match(output, /create_customer_asgi_runner: malformed JSON envelope on stdin/, `[${S}] a valid pair of mounts must reach the EXISTING audited runner and fail on ITS own refusal, proving the image starts that boundary and nothing else, on a read-only rootfs with every capability dropped and no network; got:\n${output}`);
    assert.doesNotMatch(output, /malformed CLI args|unrecognized argument/, `[${S}] the existing runner must never see malformed CLI args: the P22A1 wrapper builds its argv from the mounted files`);
  });
});

test("P22A2-4 the planning manifest binds this package to its base, its frozen scope, its six allowed files, its measured metrics, its rollback and its unchanged readiness", async () => {
  const S = "P22A2-4";
  await requireDockerfile(S);
  const contract = await requireContract(S);

  const digest = createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex");
  const split = contract.splitEvidence ?? {};
  for (const [label, got, want] of [
    ["the immutable base commit", contract.base, BASE_COMMIT],
    ["the immutable base tree", contract.baseTree, BASE_TREE],
    ["the canonical Actionplan change-package budget pin", contract.actionplanPin, ACTIONPLAN_PIN],
    ["this frozen test path", contract.frozenTestPath, FROZEN_TEST_PATH],
    ["the recomputed sha256 of the unedited frozen test", contract.frozenTestSha256, digest],
    ["the exact targeted command", contract.greenEvidence?.targetedTest, TARGETED_TEST],
    ["the frozen scope synthesis name", split.scopeSynthesisName, "P22A2_SCOPE_SYNTHESIS_V2"],
    ["the frozen P22A2_SCOPE_SYNTHESIS_V2 hash", split.scopeSynthesisSha256, SCOPE_V2],
    ["the parent P22 synthesis hash", split.parentScopeSha256, PARENT_SCOPE],
    ["that this package is P22A2", split.thisPackage, "P22A2"],
    ["the already delivered sibling half of the P22A split", split.siblingPackage, "P22A1"],
    ["that the counter stays 21/25 with P22 active", split.counter, "21/25"],
    ["the frozen node index digest", contract.imagePins?.nodeDigest, PINS.node.digest],
    ["the frozen python index digest", contract.imagePins?.pythonDigest, PINS.python.digest],
    ["the frozen uv index digest", contract.imagePins?.uvDigest, PINS.uv.digest],
    ["one writer per change package", contract.provenance?.singleWriter, true],
    ["that the reviewer must be a separate read-only session", contract.provenance?.reviewerMustBeSeparateSession, true],
    ["that test authoring is claude-only", contract.provenance?.testAuthoring, "claude-only"],
    ["that an image built only locally needs no compensating step", contract.rollback?.compensatingStepRequired, false],
    ["that the only CI change is additive", contract.rollback?.ciChangeIsAdditiveOnly, true],
  ]) {
    assert.equal(got, want, `[${S}] the manifest must record ${label}`);
  }
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(), `[${S}] the manifest must declare exactly the six allowed P22A2 paths`);
  assert.deepEqual(split.remaining, ["P22B", "P22C"], `[${S}] P22B and P22C must remain outstanding; an image alone does not close P22`);

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
  for (const untouched of ["srcUntouched", "existingHostModulesUntouched", "hostPyprojectUntouched", "hostLockUntouched",
    "secretFileRunnerUntouched", "dbUntouched", "dependenciesUntouched"]) {
    assert.equal(contract.rollback?.[untouched], true, `[${S}] the manifest must record ${untouched}=true`);
  }

  const flags = contract.readinessFlags ?? {};
  assert.equal(flags.runtimeImplementationStarted, true, `[${S}] runtimeImplementationStarted is unchanged and stays true`);
  assert.equal(flags.hostServerSelectedForDeployArtifact, true, `[${S}] the image pins and contains exactly one server, uvicorn ${UVICORN_VERSION}, so the host server IS selected for the deploy artifact; false would deny evidence this package really carries`);
  for (const flag of FALSE_FLAGS) {
    assert.equal(flags[flag], false, `[${S}] ${flag} must remain false: P22A2 is a reproducible image, not readiness, not a listener, not a registry push and not a deployment`);
  }
  assert.equal(Object.keys(flags).length, FALSE_FLAGS.length + 2, `[${S}] no readiness flag beyond the declared set may be introduced`);

  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of ["registry", "listener", "deployment", "database connection", "migration", "host pyproject", "roadmap", "current-truth"]) {
    assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  }
  assert.match(String(contract.capabilityDelta ?? ""), /^DEPLOY_OCI_IMAGE:/, `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(String(contract.userJourney?.[field] ?? "").length > 40, `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
  }
});
