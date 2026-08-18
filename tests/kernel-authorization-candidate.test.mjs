import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// PKG14 — AuthorizationCandidate: an immutable exact typed value for the existing
// {policyId, effect, applies} candidate-outcome shape, and nothing else. It changes no
// decision: AuthorizationEvaluator's deny-overrides/default-deny/winner/trace behavior stays
// exactly as PKG12 left it. No PolicyStatement, no action-coordinate wildcard, no rule or
// condition schema, no derivesCandidate, no candidate matching/scoping, no RBAC/ABAC/ReBAC
// engine, no PolicyRequest/PDP/Policy port change, no RLS/DB/SDK/Delivery/HTTP vocabulary.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/authorization-candidate.mjs";

let loaded = null;
let loadError = null;
try { loaded = await import(pathToFileURL(path.join(root, modulePath)).href); }
catch (error) { loadError = error; }

let sourceText = null;
let sourceError = null;
try { sourceText = await readFile(path.join(root, modulePath), "utf8"); }
catch (error) { sourceError = error; }

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}
function source() {
  assert.ok(sourceText !== null, `${modulePath} must exist as a readable file: ${sourceError?.message ?? "not read"}`);
  return sourceText;
}
function stripComments(text) {
  return text.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
    return line.split("//")[0];
  }).join("\n");
}
const code = () => stripComments(source());
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;
const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

const build = (policyId = "pol-a", effect = "allow", applies = true) => {
  const m = mod();
  return new m.AuthorizationCandidate({ policyId, effect, applies });
};

// A. Module surface, imports and forbidden vocabulary.
test("module surface: exactly AuthorizationCandidate, frozen, no rule/derivation/decision-engine vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["AuthorizationCandidate"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.AuthorizationCandidate, "function", "AuthorizationCandidate must be a class");
  assert.ok(Object.isFrozen(m.AuthorizationCandidate), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.AuthorizationCandidate.prototype), "the prototype must be frozen");
  for (const absent of [
    "PolicyStatement", "PolicyRequest", "PolicyDecision", "AuthorizationEvaluator",
    "Pdp", "PDP", "Pep", "PEP", "Pip", "Pap", "Enforcer",
    "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role", "Permission", "Grant",
    "Rls", "RowLevelSecurity", "AuditLog", "Audit", "Cache", "Repository", "Adapter",
    "Sdk", "SDK", "Policy", "Rule", "Condition", "Wildcard", "ActionCoordinate",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to AuthorizationCandidate`);
  }
});

test("module reaches no forbidden import and carries no PolicyStatement/wildcard/rule/RLS/SDK/Delivery vocabulary in code", () => {
  const text = code();
  for (const [label, pattern] of [
    ["a node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["the Policy port", /["'`][^"'`]*\/policy\.mjs["'`]/],
    ["the PolicyDecision protocol module", /["'`][^"'`]*\/policy-decision\.mjs["'`]/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a central decision point", /\bPDP\b|\bPEP\b|central\s+decision/i],
    ["a policy statement or rule model", /policystatement|action.?coordinate|wildcard|\brule\b|\bcondition\b|derives?candidate/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\brule\s*match/i],
    ["persistence or telemetry", /\baudit\b|\bcache\b|\bmemo\b|\brepositor|\bpersist|\bRLS\b/i],
    ["a future production-target transport/SDK vocabulary", /fastapi|uvicorn|hypercorn|\basgi\b|\bhttp\b|\bdelivery\b|\bsdk\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

// B. Construction and admission — the same canonical rule the evaluator already applies.
test("AuthorizationCandidate is constructed from exactly {policyId, effect, applies}, nothing else admitted", () => {
  const m = mod();
  for (const bad of [undefined, null, "x", 0, [], {}]) {
    throws(() => new m.AuthorizationCandidate(bad), "the constructor must refuse a non-genuine options object");
  }
  throws(() => new m.AuthorizationCandidate({ policyId: "pol-a", effect: "allow", applies: true, extra: 1 }),
    "an unknown key must be refused");
  throws(() => new m.AuthorizationCandidate({ policyId: "pol-a", effect: "allow" }), "a missing applies must be refused");
  throws(() => new m.AuthorizationCandidate({ policyId: "pol-a", applies: true }), "a missing effect must be refused");
  throws(() => new m.AuthorizationCandidate({ effect: "allow", applies: true }), "a missing policyId must be refused");

  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "policyId", { enumerable: true, get: () => "pol-a" });
  Object.defineProperty(accessorOptions, "effect", { enumerable: true, value: "allow" });
  Object.defineProperty(accessorOptions, "applies", { enumerable: true, value: true });
  const nonEnumOptions = { effect: "allow", applies: true };
  Object.defineProperty(nonEnumOptions, "policyId", { value: "pol-a", enumerable: false });
  const nullProtoOptions = Object.assign(Object.create(null), { policyId: "pol-a", effect: "allow", applies: true });
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), { policyId: "pol-a", effect: "allow", applies: true });

  for (const [label, bad] of [
    ["an accessor-defined key", accessorOptions],
    ["a non-enumerable key", nonEnumOptions],
    ["a null-prototype options object", nullProtoOptions],
    ["a custom-prototype options object", customProtoOptions],
  ]) {
    throws(() => new m.AuthorizationCandidate(bad), `options with ${label} must be refused`);
  }

  assert.doesNotThrow(() => new m.AuthorizationCandidate({ policyId: "pol-a", effect: "allow", applies: true }),
    "a well-formed options object is admissible");
});

test("policyId, effect and applies are validated exactly as AuthorizationEvaluator already validates a plain candidate", () => {
  for (const [label, bad] of [
    ["a non-canonical policyId", { policyId: "Pol-A", effect: "allow", applies: true }],
    ["an empty policyId", { policyId: "", effect: "allow", applies: true }],
    ["a malformed policyId", { policyId: "pol_a!", effect: "allow", applies: true }],
    ["a too-long policyId", { policyId: "p".repeat(200), effect: "allow", applies: true }],
    ["a non-string policyId", { policyId: 1, effect: "allow", applies: true }],
    ["an invalid effect", { policyId: "pol-a", effect: "permit", applies: true }],
    ["a non-string effect", { policyId: "pol-a", effect: 1, applies: true }],
    ["a non-boolean applies", { policyId: "pol-a", effect: "allow", applies: "true" }],
    ["a null applies", { policyId: "pol-a", effect: "allow", applies: null }],
  ]) {
    const m = mod();
    throws(() => new m.AuthorizationCandidate(bad), `${label} must be refused`);
  }
  assert.doesNotThrow(() => build("pol.a-1", "deny", false), "a canonical dotted/hyphenated policyId and deny/false are admissible");
});

// C. Frozen exact value: immutable getters, exact-class identity.
test("a constructed AuthorizationCandidate is frozen, its getters are read-only, and it carries exactly policyId/effect/applies", () => {
  const candidate = build("pol-a", "allow", true);
  assert.ok(Object.isFrozen(candidate), "the instance must be frozen");
  assert.equal(candidate.policyId, "pol-a");
  assert.equal(candidate.effect, "allow");
  assert.equal(candidate.applies, true);
  assert.throws(() => { candidate.policyId = "pol-b"; }, TypeError, "a frozen getter-only property must refuse reassignment");
  assert.throws(() => { candidate.extra = 1; }, TypeError, "a frozen instance must refuse a new own property");
});

test("AuthorizationCandidate is exact-class identified, never by instanceof: a subclass and a hollow object are refused", () => {
  const m = mod();
  const genuine = build();
  assert.ok(isExactly(genuine, m.AuthorizationCandidate), "a genuine instance must be exact-class identified");

  class DerivedCandidate extends m.AuthorizationCandidate {}
  const derived = new DerivedCandidate({ policyId: "pol-a", effect: "allow", applies: true });
  assert.ok(derived instanceof m.AuthorizationCandidate, "a subclass instance is still instanceof its base");
  assert.ok(!isExactly(derived, m.AuthorizationCandidate), "a subclass instance must never be exact-class identified");

  const hollow = Object.create(m.AuthorizationCandidate.prototype);
  assert.ok(hollow instanceof m.AuthorizationCandidate, "a hollow object built on the prototype is still instanceof");
  assert.ok(!genuine.equals(hollow), "a hollow prototype-only object must never equal a genuine instance");
  assert.ok(!genuine.equals(derived), "a subclass instance must never equal a genuine exact instance");
});

// D. Stable toJSON/toString and exact-class equality.
test("toJSON is a plain {policyId, effect, applies} object in that fixed order, and toString is its JSON rendering", () => {
  const candidate = build("pol-zulu", "deny", false);
  assert.deepEqual(candidate.toJSON(), { policyId: "pol-zulu", effect: "deny", applies: false });
  assert.deepEqual(Object.keys(candidate.toJSON()), ["policyId", "effect", "applies"], "toJSON key order is fixed");
  assert.equal(candidate.toString(), JSON.stringify({ policyId: "pol-zulu", effect: "deny", applies: false }));
  assert.equal(JSON.stringify(candidate), candidate.toString(), "JSON.stringify must defer to toJSON/toString");
});

test("equals is true only for another exact genuine AuthorizationCandidate carrying the identical value", () => {
  const a = build("pol-a", "allow", true);
  const sameValue = build("pol-a", "allow", true);
  const differentPolicyId = build("pol-b", "allow", true);
  const differentEffect = build("pol-a", "deny", true);
  const differentApplies = build("pol-a", "allow", false);
  const plainLookalike = { policyId: "pol-a", effect: "allow", applies: true };

  assert.ok(a.equals(sameValue), "two instances carrying the identical value must be equal");
  assert.equal(a.equals(a), true, "an instance must equal itself");
  assert.ok(!a.equals(differentPolicyId));
  assert.ok(!a.equals(differentEffect));
  assert.ok(!a.equals(differentApplies));
  assert.ok(!a.equals(plainLookalike), "a plain data object with the identical shape must never equal a typed instance");
  for (const bad of [null, undefined, "pol-a", 1, [], {}]) {
    assert.equal(a.equals(bad), false, `equals must answer false, never throw, for ${String(bad)}`);
  }
});

// E. The PKG14 change-gate contract itself (RED until planning/kernel-authorization-candidate-pkg14.json exists).
const CONTRACT_PATH = "planning/kernel-authorization-candidate-pkg14.json";
async function contract() {
  let text;
  try { text = await readFile(path.join(root, CONTRACT_PATH), "utf8"); }
  catch (error) { assert.fail(`${CONTRACT_PATH} must exist and be readable: ${error.message}`); }
  return JSON.parse(text);
}
const hasMatch = (arr, re, label) => {
  assert.ok(Array.isArray(arr) && arr.length > 0, `${label} must be a nonempty array`);
  assert.ok(arr.some((s) => re.test(String(s))), `${label} must include an entry matching ${re}`);
};

test("PKG14 change-gate contract: identity, authority, budget, allowed files, non-goals, exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg14-authorization-candidate-contract");
  assert.equal(c.baseCommit, "60568e88eb8236ec347c5b9bd392a2494d3d676c");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.match(String(c.authority?.subset ?? ""), /authoriz|candidate/i);
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800);
  assert.equal(c.budget?.maxChangedFiles, 20);
  assert.equal(c.budget?.fullQaBudget, 2);
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md",
    "planning/kernel-authorization-candidate-pkg14.json",
    "src/application/authorization-candidate.mjs",
    "src/application/authorization-evaluator.mjs",
    "tests/kernel-authorization-candidate.test.mjs",
    "tests/kernel-authorization-evaluator.test.mjs",
    "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these seven paths");
  assert.deepEqual(c.evidencePolicy?.required, ["qa1", "qa2", "fresh-independent-review"],
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  for (const re of [
    /policystatement/i, /action.?coordinate|wildcard/i, /rule|condition/i, /derives?candidate/i,
    /rbac|abac|rebac/i, /rls|\brow.level/i, /\bdb\b|\bsdk\b|delivery/i, /pdp|central.*decision/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands, /node --test tests\/kernel-authorization-candidate\.test\.mjs/, "red.commands");
  hasMatch(c.green?.requirements, /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements, /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements, /fresh independent review/i, "green.requirements (fresh independent review)");
  assert.match(String(c.rollback), /revert(s|ed)?.*seven.file/i, "rollback must revert this seven-file shard");
  for (const re of [
    /allowed.?file parity/i, /\bqa\s*1\b/i, /fresh.*review/i,
    /source.*(<=|at most|no more than).*300/i, /net.*(<=|at most|no more than).*800/i,
    /legacy.*compat|plain.*record/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});

// F. The standards matrix the contract must carry: one row per required standard, each row
// carrying exactly standardId/applies/reason/canonicalSource/consumer/test/evidence/waiver, and
// no row for a required standard missing.
const REQUIRED_STANDARD_IDS = [
  "architecture", "coding-standards", "short-code", "authz-rbac-abac", "testing-strategy",
  "quality-gates", "kernel-delivery-boundary", "release-versioning",
  "sso", "oidc", "mfa", "identity-data",
];
const MATRIX_ROW_KEYS = [
  "standardId", "applies", "reason", "canonicalSource", "consumer", "test", "evidence", "waiver",
];

test("PKG14 change-gate contract: standardsMatrix carries exactly the required rows, each with the exact fixed field set", async () => {
  const c = await contract();
  assert.ok(Array.isArray(c.standardsMatrix), "standardsMatrix must be an array");
  assert.ok(c.standardsMatrix.length > 0, "standardsMatrix must not be empty");

  const seenIds = c.standardsMatrix.map((row) => row.standardId);
  assert.equal(new Set(seenIds).size, seenIds.length, "standardsMatrix must carry no duplicate standardId");
  assert.deepEqual([...seenIds].sort(), [...REQUIRED_STANDARD_IDS].sort(),
    "standardsMatrix must carry exactly the 12 required standard IDs, no extra and none missing");

  const PLACEHOLDER_REASON = /^\s*(n\/?a|not applicable)\s*$/i;
  for (const row of c.standardsMatrix) {
    assert.deepEqual(Object.keys(row).sort(), [...MATRIX_ROW_KEYS].sort(),
      `standardsMatrix row ${row.standardId} must carry exactly ${MATRIX_ROW_KEYS.join(", ")}`);
    assert.equal(typeof row.standardId, "string");
    assert.equal(typeof row.applies, "boolean", `standardsMatrix row ${row.standardId} applies must be a primitive boolean`);
    assert.equal(typeof row.reason, "string");
    assert.ok(row.reason.trim().length > 0, `standardsMatrix row ${row.standardId} reason must not be empty`);
    assert.ok(!PLACEHOLDER_REASON.test(row.reason),
      `standardsMatrix row ${row.standardId} reason must not be a bare N/A, NA or not applicable placeholder`);
    if (row.applies === false) {
      assert.ok(row.reason.trim().length > 0, `standardsMatrix row ${row.standardId} applies=false must carry a concrete reason`);
    }
    assert.match(String(row.canonicalSource), /fc3bcda411bb36a93c228544b285ce4e869589af/,
      `standardsMatrix row ${row.standardId} canonicalSource must cite the pinned Actionplan commit`);
    assert.equal(typeof row.consumer, "string");
    assert.ok(row.consumer.trim().length > 0, `standardsMatrix row ${row.standardId} consumer must not be empty`);
    assert.equal(typeof row.test, "string");
    assert.ok(row.test.trim().length > 0, `standardsMatrix row ${row.standardId} test must not be empty`);
    assert.equal(typeof row.evidence, "string");
    assert.ok(row.evidence.trim().length > 0, `standardsMatrix row ${row.standardId} evidence must not be empty`);
    assert.equal(row.waiver, null,
      `standardsMatrix row ${row.standardId} waiver must be exactly null: this scope carries no waiver`);
  }
});
