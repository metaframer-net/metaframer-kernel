import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// P22A1 — the secret-file argv boundary, and nothing else. A deploy artifact must reach its
// database credential without ever putting that credential on a command line, in an environment
// variable or in an image layer. This frozen test owns every fixed expectation for one small
// wrapper, host/deploy/secret_file_runner.mjs, that accepts two mounted FILE PATHS, validates
// what it reads, rewrites only its own in-process JS process.argv and then dynamically imports
// the EXISTING host/js_asgi runner. No container is built, no listener is started, no registry is
// touched and no database is contacted here: P22A2 owns the OCI image, P22B the ephemeral PG16
// plus live HTTP/audit proof and P22C current-truth closure. The manifest gates the run and never
// supplies an expected value back to an assertion.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "planning/kernel-deploy-secret-boundary-p22a1.json";
const FROZEN_TEST_PATH = "tests/kernel-deploy-secret-boundary-p22a1.test.mjs";
const WRAPPER_PATH = "host/deploy/secret_file_runner.mjs";
const WRAPPER = path.join(root, WRAPPER_PATH);
const ALLOWED_FILES = Object.freeze([MANIFEST_PATH, FROZEN_TEST_PATH, WRAPPER_PATH]);
const SCENARIO_IDS = Object.freeze(["P22A1-1", "P22A1-2", "P22A1-3"]);
const BASE_COMMIT = "b9d5b85df2646e36b60830fcd33a63609da79edc";
const BASE_TREE = "b3af22aa0b606fad3fad0e2267176e8d00ba13df";
const SCOPE_V2 = "152cadf500f7e0f15380b220d0314aca0d32b9215e0a142c20dbc82cb124476f";
const PARENT_SCOPE = "adf916088d6e44f83045fe78f33fa7444c1cd407855d65d38785be226699e033";
const REJECTED_TEST_SHA = "e054c75d0b5f72716d2050e5103cdf61f88c3442a0fdd23c62e5a0e2101a75df";
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";
const TARGETED_TEST = `node --test ${FROZEN_TEST_PATH}`;
const EXISTING_RUNNER = "../js_asgi/create_customer_asgi_runner.mjs";
const [FLAG_CONFIG, FLAG_DB] = ["--config-file", "--database-url-file"];
const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3399";
const NIL_TENANT = "00000000-0000-0000-0000-000000000000";
const ACTOR = "actor-p22a1-secret-boundary";
// One value that exists nowhere else in this repository. Every non-disclosure assertion is
// written against exactly this string.
const SENTINEL = "p22a1-sentinel-Z4hN8qW6tD1yG3jV-do-not-log";
const DB_URL = `postgresql://mfk_runtime:${SENTINEL}@127.0.0.1:5432/mfk`;
const FALSE_FLAGS = Object.freeze(["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed", "oneGoldenSliceReady", "runnableProduct", "p22Complete",
  "stagingEnvironmentExists", "stagingRunPerformed", "networkListenerStarted", "productionHostSelected",
  "registryPushed", "externalDeploymentPerformed", "hostServerSelectedForDeployArtifact"]);
// Any trace of an actual PostgreSQL contact attempt; nothing in P22A1 may show one.
const DB_CONTACT = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|password authentication|pg_hba|SASL/i;

/**
 * The single load-bearing read for every allowed implementation surface. A checkout that does not
 * yet carry the file fails HERE, naming the exact missing allowed path, so this suite is
 * deterministically RED on the absent implementation and never on a syntax or unrelated defect.
 */
async function readAllowed(rel, scenario) {
  return readFile(path.join(root, rel), "utf8").catch((error) =>
    assert.fail(`[${scenario}] the allowed P22A1 implementation surface ${rel} must exist before this scenario can run: ${error.message}`));
}

/** Load-bearing contract read: no P22A1 scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const contract = JSON.parse(await readAllowed(MANIFEST_PATH, scenario));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS],
    `[${scenario}] ${MANIFEST_PATH} must declare exactly the three P22A1 scenario ids, in order`);
  return contract;
}

const noSentinel = (haystack, where, scenario) => assert.ok(!String(haystack).includes(SENTINEL),
  `[${scenario}] the mounted database credential must never be disclosed through ${where}`);

const completeConfig = () => ({ policy: "allow", audit: "on", trustedTenantId: TENANT, trustedActorId: ACTOR });

/** A mounted secret directory: one config file and one database-url file, as a deployer mounts them. */
async function withFixture(fn, { config = completeConfig(), dbUrl = `${DB_URL}\n` } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "p22a1-secrets-"));
  const cfg = path.join(dir, "config.json");
  const db = path.join(dir, "database-url.txt");
  try {
    await writeFile(cfg, typeof config === "string" ? config : `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await writeFile(db, dbUrl, "utf8");
    return await fn({ dir, cfg, db });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const runWrapper = (argv, input = "") =>
  spawnSync(process.execPath, [WRAPPER, ...argv], { input, encoding: "utf8", timeout: 30_000 });

test("P22A1-1 the wrapper takes only mounted file paths, reads no environment, shells out to nothing, validates the fixed identity contract and delegates to the existing runner", async () => {
  const S = "P22A1-1";
  await requireContract(S);
  const src = await readAllowed(WRAPPER_PATH, S);

  for (const flag of [FLAG_CONFIG, FLAG_DB]) {
    assert.ok(src.includes(`"${flag}"`) || src.includes(`'${flag}'`),
      `[${S}] ${WRAPPER_PATH} must accept the mounted path argument ${flag}`);
  }
  assert.ok(!/process\.env/.test(src),
    `[${S}] ${WRAPPER_PATH} must read no environment variable: an env fallback is a second, unaudited credential path`);
  assert.ok(!/child_process|execSync|execFileSync|spawnSync|\bspawn\s*\(/.test(src),
    `[${S}] ${WRAPPER_PATH} must shell out to nothing: a shell fallback would put the credential on another command line`);
  assert.ok(!/create-customer-asgi-composition|createCustomerAsgiComposition|createAuditedCustomerAsgiComposition/.test(src),
    `[${S}] ${WRAPPER_PATH} must not reimplement the boundary by composing it directly; it delegates to the existing runner`);
  assert.ok(src.includes(EXISTING_RUNNER),
    `[${S}] ${WRAPPER_PATH} must dynamically import the EXISTING ${EXISTING_RUNNER}, which this package does not modify`);
  assert.match(src, /import\s*\(/, `[${S}] the delegation must be a dynamic import, performed only after the mounted files validate`);
  assert.match(src, /process\.argv/,
    `[${S}] ${WRAPPER_PATH} must hand the validated values to the existing runner through its own in-process process.argv and through nothing else`);

  for (const [needle, why] of [["allow", "policy=allow"], ["on", "audit=on"],
    ["trustedTenantId", "the canonical non-nil trusted tenant"], ["trustedActorId", "the visible-ASCII trusted actor"]]) {
    assert.ok(src.includes(needle), `[${S}] ${WRAPPER_PATH} must validate ${why} from the mounted config before it delegates`);
  }
  const existing = await readFile(path.join(root, "host/js_asgi/create_customer_asgi_runner.mjs"), "utf8");
  assert.ok(existing.includes("--connection-string") && existing.includes("--trusted-tenant-id"),
    `[${S}] precondition: the existing runner still owns the --connection-string/--trusted-* argument contract this wrapper builds onto process.argv`);
});

test("P22A1-2 an absent, unreadable, empty or malformed mounted file fails closed without disclosing the credential, and a complete pair reaches the existing runner's own malformed-envelope failure", async () => {
  const S = "P22A1-2";
  await requireContract(S);
  await readAllowed(WRAPPER_PATH, S);

  await withFixture(async ({ dir, cfg, db }) => {
    const closed = async (label, argv, prepare) => {
      if (prepare) await prepare();
      const r = runWrapper(argv);
      const output = `${r.stdout}${r.stderr}`;
      assert.notEqual(r.status, 0, `[${S}] ${label} must fail the wrapper closed, exit non-zero`);
      noSentinel(output, `the fail-closed output of ${label}`, S);
      assert.doesNotMatch(output, DB_CONTACT, `[${S}] ${label} must fail before any PostgreSQL contact`);
      return output;
    };

    assert.match(await closed("an absent config file", [FLAG_CONFIG, path.join(dir, "absent.json"), FLAG_DB, db]),
      /absent\.json/, `[${S}] the refusal must name the missing path`);
    await closed("an absent database-url file", [FLAG_CONFIG, cfg, FLAG_DB, path.join(dir, "absent.txt")]);
    await closed("an empty database-url file", [FLAG_CONFIG, cfg, FLAG_DB, path.join(dir, "empty.txt")],
      () => writeFile(path.join(dir, "empty.txt"), "", "utf8"));
    await closed("an unreadable database-url file", [FLAG_CONFIG, cfg, FLAG_DB, path.join(dir, "locked.txt")],
      async () => { await writeFile(path.join(dir, "locked.txt"), DB_URL, "utf8"); await chmod(path.join(dir, "locked.txt"), 0o000); });
    await closed("a malformed (non-JSON) config file", [FLAG_CONFIG, path.join(dir, "bad.json"), FLAG_DB, db],
      () => writeFile(path.join(dir, "bad.json"), "{ not json", "utf8"));
    // An inline secret must not even be offered as an argument shape.
    await closed("an inline credential argument", ["--connection-string", DB_URL, FLAG_CONFIG, cfg, FLAG_DB, db]);

    for (const [label, bad] of [["policy that is not allow", { ...completeConfig(), policy: "deny" }],
      ["audit that is not on", { ...completeConfig(), audit: "off" }],
      ["a nil trusted tenant", { ...completeConfig(), trustedTenantId: NIL_TENANT }],
      ["a non-visible-ASCII trusted actor", { ...completeConfig(), trustedActorId: "aktör" }]]) {
      const p = path.join(dir, "invalid.json");
      await writeFile(p, `${JSON.stringify(bad)}\n`, "utf8");
      await closed(`a config carrying ${label}`, [FLAG_CONFIG, p, FLAG_DB, db]);
    }
  });

  // The live child, observed from the OS with portable ps while it blocks on an open stdin.
  // host/deploy/secret_file_runner.mjs rewrites only its own in-process JS process.argv; that
  // mutation does not and cannot rewrite the kernel's command line for this process. The proof
  // asserted here is the narrower, true one: the credential VALUE is never an OS-visible argument.
  await withFixture(async ({ cfg, db }) => {
    const child = spawn(process.execPath, [WRAPPER, FLAG_CONFIG, cfg, FLAG_DB, db], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    try {
      await sleep(2000);
      assert.equal(child.exitCode, null,
        `[${S}] with both mounted files complete the wrapper must reach the existing runner and block on stdin, not exit; got exit ${child.exitCode} and output: ${out}`);
      const ps = spawnSync("ps", ["-o", "args=", "-p", String(child.pid)], { encoding: "utf8" });
      assert.equal(ps.status, 0, `[${S}] portable ps must be able to report the live child's arguments`);
      assert.ok(ps.stdout.includes(cfg) && ps.stdout.includes(db),
        `[${S}] the live child's OS argv must carry the mounted FILE PATHS, proving the value itself was never passed there: ${ps.stdout.trim()}`);
      noSentinel(ps.stdout, "the live child's OS-visible argv as ps reports it", S);
      const psEnv = spawnSync("ps", ["-Eww", "-o", "command=", "-p", String(child.pid)], { encoding: "utf8" });
      noSentinel(`${psEnv.stdout}${psEnv.stderr}`, "the live child's process environment as ps reports it", S);
      noSentinel(JSON.stringify(process.env), "an environment variable inherited by the child", S);
      noSentinel(out, "the live child's stdout and stderr", S);

      // Malformed JSON on stdin must be refused by the EXISTING runner, proving delegation
      // actually happened — not by a wrapper CLI or config error, and never by contacting a DB.
      child.stdin.end("{ not a valid envelope");
      const code = await new Promise((resolve) => child.on("close", resolve));
      assert.notEqual(code, 0, `[${S}] a malformed stdin envelope must fail non-zero`);
      assert.match(out, /create_customer_asgi_runner: malformed JSON envelope on stdin/,
        `[${S}] the failure must be the EXISTING runner's own malformed-envelope refusal, proving the wrapper delegated to it; got: ${out}`);
      assert.doesNotMatch(out, /malformed CLI args|unrecognized argument/,
        `[${S}] the existing runner must never see malformed CLI args: the wrapper builds its argv`);
      assert.doesNotMatch(out, DB_CONTACT, `[${S}] no PostgreSQL connection may be attempted anywhere in P22A1`);
      noSentinel(out, "the combined output of the delegated run", S);
    } finally {
      child.kill("SIGKILL");
    }
  });
});

test("P22A1-3 the planning manifest binds this package to its base, its three allowed paths, its split evidence, its rollback and its unchanged readiness", async () => {
  const S = "P22A1-3";
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
    ["the frozen P22A1_SCOPE_SYNTHESIS_V2 hash", split.scopeSynthesisSha256, SCOPE_V2],
    ["the parent P22 synthesis hash", split.parentScopeSha256, PARENT_SCOPE],
    ["the rejected combined test hash", split.rejectedTestSha256, REJECTED_TEST_SHA],
    ["why the combined P22A package was rejected before freeze", split.rejectedReason, "406+413=819 exceeds 800"],
    ["that this package is P22A1", split.thisPackage, "P22A1"],
    ["that the counter stays 21/25 with P22 active", split.counter, "21/25"],
    ["one writer per change package", contract.provenance?.singleWriter, true],
    ["that the reviewer must be a separate read-only session", contract.provenance?.reviewerMustBeSeparateSession, true],
    ["that test authoring is claude-only", contract.provenance?.testAuthoring, "claude-only"],
    ["that a wrapper which was never deployed needs no compensating step", contract.rollback?.compensatingStepRequired, false],
  ]) {
    assert.equal(got, want, `[${S}] the manifest must record ${label}`);
  }
  assert.deepEqual([...(contract.allowedFiles ?? [])].sort(), [...ALLOWED_FILES].sort(),
    `[${S}] the manifest must declare exactly the three allowed P22A1 paths`);
  assert.deepEqual(split.remaining, ["P22A2", "P22B", "P22C"],
    `[${S}] P22A2, P22B and P22C must remain outstanding; P22A1 alone does not close P22`);

  const actual = contract.budget?.actual ?? {};
  for (const key of ["grossAdditions", "grossDeletions", "net", "changedFiles"]) {
    assert.equal(typeof actual[key], "number", `[${S}] budget.actual.${key} must be measured and recorded`);
  }
  assert.equal(actual.changedFiles, ALLOWED_FILES.length, `[${S}] exactly ${ALLOWED_FILES.length} files change in this package`);
  assert.ok(actual.net <= 800 && actual.grossAdditions <= 800,
    `[${S}] the package must stay inside the class ceiling; measured net ${actual.net}, gross additions ${actual.grossAdditions}`);
  if (actual.net > 400) {
    assert.equal(contract.budget?.band, "conditional", `[${S}] a package above net 400 must draw the conditional band explicitly`);
    assert.deepEqual((contract.budget?.conditionalDeliveryGates ?? []).map((g) => g?.gate),
      ["single-narrow-problem", "bounded-file-set", "no-redundant-repetition", "no-quality-tradeoff",
        "full-green", "fresh-reviewer-accept", "explicit-rollback"],
      `[${S}] all seven canonical conditional-band gates must be recorded, in order`);
  }
  assert.ok(!JSON.stringify(contract.budget ?? {}).toLowerCase().includes("waiver"),
    `[${S}] no waiver may be claimed for this package`);

  assert.ok(contract.rollback?.mechanism && contract.rollback?.blastRadius, `[${S}] the rollback mechanism and blast radius must be stated`);
  for (const untouched of ["srcUntouched", "existingHostModulesUntouched", "dbUntouched", "dependenciesUntouched", "ciUntouched"]) {
    assert.equal(contract.rollback?.[untouched], true, `[${S}] the manifest must record ${untouched}=true`);
  }

  const flags = contract.readinessFlags ?? {};
  assert.equal(flags.runtimeImplementationStarted, true, `[${S}] runtimeImplementationStarted is unchanged and stays true`);
  for (const flag of FALSE_FLAGS) {
    assert.equal(flags[flag], false,
      `[${S}] ${flag} must remain false: P22A1 is an argv boundary, not readiness, not an image, not a listener and not a deployment`);
  }
  assert.equal(Object.keys(flags).length, FALSE_FLAGS.length + 1, `[${S}] no readiness flag beyond the declared set may be introduced`);

  const nonGoals = (contract.nonGoals ?? []).join("\n").toLowerCase();
  for (const required of ["container", "listener", "deployment", "database connection", "registry", "roadmap", "current-truth"]) {
    assert.ok(nonGoals.includes(required), `[${S}] the manifest must declare "${required}" a non-goal`);
  }
  assert.match(String(contract.capabilityDelta ?? ""), /^SECRET_FILE_ARGV_BOUNDARY:/,
    `[${S}] the capability delta must be recorded under its fixed prefix`);
  assert.ok(contract.productClaim?.runnable && contract.productClaim?.notRunnable, `[${S}] both product claims must be stated`);
  for (const field of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(String(contract.userJourney?.[field] ?? "").length > 40,
      `[${S}] the Turkish owner-facing field ${field} must be present and substantive`);
  }
});
