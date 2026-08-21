import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayPath = "planning/kernel-cem01-repo-handshake.json";
const verifierPath = "tools/check-kernel-cem01-repo-handshake.mjs";

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

const ROOT_AUTHORIZED_CREATORS = ["codex-desktop-master"];
const RED_SET = [
  "self-declared-master",
  "child-lease-without-parent-envelope",
  "scope-base-allowed-files-expansion",
  "expired-nonce-or-lease",
  "create-submit-while-guardian-auth-policy-red",
  "second-active-writer",
  "delegation-depth-gt-1",
  "root-capability-mint-attempt",
  "worker-delegation-attempt",
  "reviewer-write-request",
];
const ACTIVATION_PREDICATES = [
  "artifact-present-on-kernel-main",
  "npm-test-passes-on-kernel-main",
  "npm-run-check-passes-on-kernel-main",
  "independent-reviewer-accept-recorded",
];

test("the CEM-01 repo handshake overlay and its verifier exist", () => {
  for (const relativePath of [overlayPath, verifierPath]) {
    assert.ok(existsSync(path.join(root, relativePath)), `cem01-handshake-package-missing: ${relativePath}`);
  }
});

test("importing the verifier has no side effects and exposes the pure evaluator", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  for (const name of ["evaluateOverlay", "evaluateActivation", "main"]) {
    assert.equal(typeof verifier[name], "function", `${name} must be exported as a pure helper`);
  }
});

test("the overlay satisfies every structural invariant", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  const { errors, ok } = verifier.evaluateOverlay({ overlay });
  assert.deepEqual(errors, [], "overlay must have no structural findings");
  assert.equal(ok, true);
});

test("CEM-01 stays passive: not active, no execution master allowance, root creators unchanged", async () => {
  const overlay = await readJson(overlayPath);
  assert.equal(overlay.packageState, "prepared-awaiting-main-activation");
  assert.equal(overlay.targetFields.cem01Prepared, true);
  assert.equal(overlay.targetFields.cem01Active, false);
  assert.equal(overlay.targetFields.cem01RepoHandshakePrepared, false);
  assert.equal(overlay.targetFields.paneClaudeExecutionMasterAllowed, false);
  assert.equal(overlay.targetFields.rootAuthorizedCreatorsUnchanged, true);
  assert.deepEqual(overlay.cem01.authorizedRootCreators, ROOT_AUTHORIZED_CREATORS);
  assert.equal(overlay.cem01.delegateCapabilityMintAllowed, false);
  assert.equal(overlay.cem01.directRunpaneByDelegateAllowed, false);
  assert.equal(overlay.cem01.selfDeclaredActorSufficient, false);
  assert.equal(overlay.cem01.rootContainment, false);
});

test("the mandatory RED set is complete and unabridged", async () => {
  const overlay = await readJson(overlayPath);
  assert.deepEqual(overlay.redSet, RED_SET);
});

test("activation is deterministic, external and unsatisfied on this branch", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  assert.deepEqual(overlay.activation.predicates.map((p) => p.id), ACTIVATION_PREDICATES);
  const { status } = verifier.evaluateActivation({ overlay, predicates: {} });
  assert.equal(status, "prepared-awaiting-main-activation");
  const all = Object.fromEntries(ACTIVATION_PREDICATES.map((id) => [id, true]));
  const effective = verifier.evaluateActivation({ overlay, predicates: all });
  assert.equal(effective.status, "effective");
});

test("the verifier rejects a branch that self-claims repo-handshake-prepared", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  const forged = structuredClone(overlay);
  forged.targetFields.cem01RepoHandshakePrepared = true;
  const { errors, ok } = verifier.evaluateOverlay({ overlay: forged });
  assert.equal(ok, false);
  assert.ok(errors.includes("repo-handshake-prepared-preclaimed"));
});

test("the verifier rejects a branch that claims CEM-01 active or execution-master allowed", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  for (const [field, code] of [
    ["cem01Active", "cem01-active-preclaimed"],
    ["paneClaudeExecutionMasterAllowed", "execution-master-preclaimed"],
  ]) {
    const forged = structuredClone(overlay);
    forged.targetFields[field] = true;
    const { errors, ok } = verifier.evaluateOverlay({ overlay: forged });
    assert.equal(ok, false, `${field}=true must be rejected`);
    assert.ok(errors.includes(code), `expected ${code}, got ${JSON.stringify(errors)}`);
  }
});

const CEM01_FIELD_ATTACKS = [
  ["cem01.rootAuthorizer", "someone-else", "root-authorizer-drift"],
  ["cem01.verifiedDelegate", "someone-else", "verified-delegate-drift"],
  ["cem01.delegateProvider", "codex", "delegate-provider-drift"],
  ["cem01.broker", "unbounded", "broker-drift"],
  ["cem01.delegateCapabilityMintAllowed", true, "delegate-capability-mint-allowed"],
  ["cem01.directRunpaneByDelegateAllowed", true, "direct-runpane-by-delegate-allowed"],
  ["cem01.selfDeclaredActorSufficient", true, "self-declared-actor-sufficient"],
  ["cem01.rootAuthorizationActorSeparation", false, "root-authorization-actor-separation-dropped"],
  ["cem01.delegateWorkerProviderSeparation", true, "delegate-worker-provider-separation-overclaimed"],
  ["cem01.independentReviewSessionSeparation", false, "independent-review-session-separation-dropped"],
  ["cem01.rootContainment", true, "root-containment-overclaimed"],
  ["activation.deterministic", false, "activation-not-deterministic"],
];

test("the verifier rejects a forged value for every CEM-01 schema field", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  for (const [dotted, forgedValue, expectedCode] of CEM01_FIELD_ATTACKS) {
    const forged = structuredClone(overlay);
    const parts = dotted.split(".");
    let cursor = forged;
    for (const part of parts.slice(0, -1)) cursor = cursor[part];
    cursor[parts.at(-1)] = forgedValue;
    const { errors, ok } = verifier.evaluateOverlay({ overlay: forged });
    assert.equal(ok, false, `${dotted}=${JSON.stringify(forgedValue)} must be rejected`);
    assert.ok(errors.includes(expectedCode), `${dotted}: expected ${expectedCode}, got ${JSON.stringify(errors)}`);
  }
});

test("the verifier rejects a widened root-authorized-creators set", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  const forged = structuredClone(overlay);
  forged.cem01.authorizedRootCreators = [...ROOT_AUTHORIZED_CREATORS, "pane-claude-execution-master"];
  const { errors, ok } = verifier.evaluateOverlay({ overlay: forged });
  assert.equal(ok, false);
  assert.ok(errors.includes("root-authorized-creators-widened"));
});

test("the verifier rejects a shortened RED set", async () => {
  const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
  const overlay = await readJson(overlayPath);
  const forged = structuredClone(overlay);
  forged.redSet = forged.redSet.slice(0, 3);
  const { errors, ok } = verifier.evaluateOverlay({ overlay: forged });
  assert.equal(ok, false);
  assert.ok(errors.includes("red-set-incomplete"));
});

test("the production CLI validates the checked-in overlay and exits zero", () => {
  const output = execFileSync(process.execPath, [path.join(root, verifierPath)], { encoding: "utf8", cwd: root });
  assert.match(output, /^OK kernel-cem01-repo-handshake:/m);
  assert.match(output, /cem01Active=false/);
  assert.match(output, /cem01RepoHandshakePrepared=false/);
  assert.match(output, /paneClaudeExecutionMasterAllowed=false/);
});

test("npm run check wires the verifier and npm test discovers this suite", async () => {
  const pkg = await readJson("package.json");
  assert.ok(pkg.scripts.check.includes(verifierPath), "npm run check must run the cem01-handshake verifier");
  assert.equal(pkg.scripts["check:cem01-handshake"], `node ${verifierPath}`);
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs");
});
