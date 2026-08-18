import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command, Query } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";

// =====================================================================================
// PKG11 — the PolicyDecision protocol values, frozen as a public surface, plus (section D)
// the machine-readable PKG11 change-gate contract that authorizes this package's own diff.
//
// Scope: two protocol value types (PolicyRequest {action, resource, context} with a genuine
// Command/Query action and defensively canonicalized resource/context; PolicyDecision
// {effect, reason, matchedPolicyId, traceId}, immutable and exact-class) and nothing else —
// no evaluator, no PDP/PEP, no rule matching, no RBAC/ABAC/ReBAC, no RLS/DB, no audit/cache,
// no SDK/app/module/surface/release/deploy. Checked directly in code below.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-decision.mjs";

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
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      return line.split("//")[0];
    })
    .join("\n");
}

const code = () => stripComments(source());
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;
const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// Non-invoking inspect label: never calls toString/valueOf, so a hollow class instance can be named safely.
function inspectLabel(value) {
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  if (typeof value !== "object") return JSON.stringify(value);
  const proto = Object.getPrototypeOf(value);
  const name = proto && proto.constructor && proto.constructor.name ? proto.constructor.name : "object";
  return `<${name}>`;
}

// Fixtures, built through the constructors that own each type.
const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-billing-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const TRACE = new CorrelationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const IDEMPOTENCY = new IdempotencyKey("order-7731-retry-2");

const COMMAND = new Command({
  name: "billing.invoice.issue", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, idempotencyKey: IDEMPOTENCY, payload: { amount: 100 },
});
const QUERY = new Query({
  name: "billing.invoice.read", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, payload: { invoice: "7731" },
});

const hollowCommand = Object.create(Command.prototype);
class DerivedCommand extends Command {}
const derivedCommand = new DerivedCommand({
  name: "billing.invoice.issue", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, idempotencyKey: IDEMPOTENCY, payload: { amount: 100 },
});

// A. Module surface, imports and forbidden vocabulary.
test("module surface: exactly PolicyRequest and PolicyDecision, no decision-engine vocabulary beside them", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyDecision", "PolicyRequest"], "export set is frozen at exactly these two names");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyRequest, "function", "PolicyRequest must be a class");
  assert.equal(typeof m.PolicyDecision, "function", "PolicyDecision must be a class");
  for (const absent of [
    "Evaluator", "Pdp", "PDP", "Pep", "PEP", "Pip", "Pap", "Enforcer", "Enforcement",
    "Rule", "RuleSet", "RuleMatcher", "Combiner", "DenyOverrides", "AllowOverrides",
    "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role", "Permission", "Grant",
    "Rls", "RowLevelSecurity", "AuditLog", "Audit", "Cache", "Repository",
    "Sdk", "SDK", "App", "Application", "Module", "Surface", "Release", "Deploy",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the PolicyDecision protocol values`);
  }
});

test("module reaches no forbidden import and carries no PDP/evaluator vocabulary in code", () => {
  const text = code();
  for (const [label, pattern] of [
    ["a node builtin beside crypto", /["']node:(?!crypto)/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["a sibling port", /policy\.mjs|use-case\.mjs|unit-of-work\.mjs|clock\.mjs|identity\.mjs/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a decision engine", /\bevaluat|\bPDP\b|\bPEP\b|\brule\s*match|\bdeny[- ]?overrides\b/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b/i],
    ["persistence", /\baudit\b|\bcache\b|\bmemo\b|\brepositor|\bpersist/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

// B. PolicyRequest.
test("PolicyRequest takes exactly {action, resource, context}, and action must be an exact genuine Command or Query", () => {
  const m = mod();
  const build = (overrides = {}) => new m.PolicyRequest({ action: COMMAND, resource: { id: "r1" }, context: { ip: "10.0.0.1" }, ...overrides });
  assert.doesNotThrow(() => build(), "a genuine Command is admissible as action");
  assert.doesNotThrow(() => build({ action: QUERY }), "a genuine Query is admissible as action");
  for (const bad of [null, undefined, "cmd", 1, {}, [], hollowCommand, derivedCommand, Object.create(Query.prototype)]) {
    throws(() => build({ action: bad }), `action ${inspectLabel(bad)} must be refused: it is not an exact genuine Command or Query`);
  }
  throws(() => new m.PolicyRequest({ action: COMMAND, resource: {}, context: {}, extra: true }), "an unknown option key must be refused");
  throws(() => new m.PolicyRequest({ action: COMMAND, resource: {} }), "a missing context must be refused rather than defaulted");
  throws(() => new m.PolicyRequest({ action: COMMAND, context: {} }), "a missing resource must be refused rather than defaulted");
  throws(() => new m.PolicyRequest({ resource: {}, context: {} }), "a missing action must be refused");
  throws(() => new m.PolicyRequest(), "construction with no options at all must be refused");
});

test("PolicyRequest derives actor and tenant from action.principal", () => {
  const m = mod();
  const request = new m.PolicyRequest({ action: COMMAND, resource: {}, context: {} });
  assert.equal(request.action, COMMAND, "action must be exactly the instance passed in");
  assert.equal(request.tenantId, PRINCIPAL.tenantId, "tenantId must be exactly action.principal.tenantId");
  assert.equal(request.actorId, PRINCIPAL.actorId, "actorId must be exactly action.principal.actorId");
});

test("PolicyRequest defensively canonicalizes resource and context: sorted keys, deep freeze, unsafe input refused", () => {
  const m = mod();
  const build = (resource, context) => new m.PolicyRequest({ action: COMMAND, resource, context });

  const request = build({ b: 1, a: 2 }, { z: 1, y: { d: 1, c: 2 } });
  assert.deepEqual(Object.keys(request.resource), ["a", "b"], "resource keys must be sorted");
  assert.deepEqual(Object.keys(request.context.y), ["c", "d"], "context keys must be sorted at every depth");
  assert.ok(Object.isFrozen(request.resource), "resource must be deeply frozen");
  assert.ok(Object.isFrozen(request.context.y), "context must be deeply frozen at every depth");

  const original = { a: 1 };
  const built = build(original, {});
  assert.notEqual(built.resource, original, "a defensive clone must be made, not the caller's own object retained");

  for (const [label, bad] of [
    ["a __proto__ key", { __proto__: { polluted: true } }],
    ["a constructor key", JSON.parse('{"constructor":1}')],
    ["a prototype key", { prototype: 1 }],
    ["a symbol key", { [Symbol("x")]: 1 }],
    ["a non-finite number", { n: Infinity }],
    ["NaN", { n: NaN }],
    ["a null-prototype object", Object.create(null)],
    ["an accessor property", (() => { const o = {}; Object.defineProperty(o, "g", { enumerable: true, get: () => 1 }); return o; })()],
  ]) {
    throws(() => build(bad, {}), `resource with ${label} must be refused`);
    throws(() => build({}, bad), `context with ${label} must be refused`);
  }

  const cyclic = {};
  cyclic.self = cyclic;
  throws(() => build(cyclic, {}), "a cyclic resource must be refused");

  const shared = { x: 1 };
  throws(() => build({ a: shared, b: shared }, {}), "a value repeated by reference must be refused, not merely a true cycle");
});

// C. PolicyDecision.
test("PolicyDecision takes exactly {effect, reason, matchedPolicyId, traceId}, with effect allow|deny and a bounded nonempty reason", () => {
  const m = mod();
  const build = (overrides = {}) => new m.PolicyDecision({ effect: "deny", reason: "no matching policy", matchedPolicyId: null, traceId: TRACE, ...overrides });
  assert.doesNotThrow(() => build(), "a default-deny decision with a null matchedPolicyId is admissible");
  assert.doesNotThrow(() => build({ effect: "allow", matchedPolicyId: "pol-billing-001" }), "an allow decision with a matchedPolicyId is admissible");
  throws(() => build({ effect: "allow", matchedPolicyId: null }), "an allow decision with a null matchedPolicyId must be refused");

  for (const bad of ["ALLOW", "Deny", "permit", "forbid", 1, null, undefined, ""]) {
    throws(() => build({ effect: bad }), `effect ${inspectLabel(bad)} must be refused: only exactly "allow" or "deny"`);
  }
  for (const bad of [
    "", "   ", 1, null, undefined, "x".repeat(100000),
    " leading space", "trailing space ", "\treason", "reason\n",
    "control\x01char", "\x7fdel", "c1\x9fcontrol",
  ]) {
    throws(() => build({ reason: bad }), `reason ${inspectLabel(bad)} must be refused: bounded nonempty safe text with no control character or edge whitespace`);
  }
  throws(() => build({ matchedPolicyId: "" }), "an empty matchedPolicyId must be refused rather than treated as null");
  throws(() => build({ matchedPolicyId: 1 }), "a non-string matchedPolicyId must be refused");
  throws(() => build({ matchedPolicyId: "x".repeat(100000) }), "an unbounded matchedPolicyId must be refused");
  throws(() => build({ traceId: "not-a-correlation-id" }), "traceId must be an exact genuine CorrelationId, never a bare string");
  throws(() => build({ traceId: Object.create(CorrelationId.prototype) }), "a hollow CorrelationId lookalike must be refused");
  throws(() => new m.PolicyDecision({ effect: "deny", reason: "x", matchedPolicyId: null, traceId: TRACE, extra: 1 }), "an unknown option key must be refused");
  throws(() => new m.PolicyDecision({ effect: "deny", reason: "x", traceId: TRACE }), "a missing matchedPolicyId must be refused rather than defaulted to null implicitly");
  throws(() => new m.PolicyDecision(), "construction with no options at all must be refused");
});

test("PolicyDecision and PolicyRequest are immutable, exact-class values with stable JSON/string forms and admit no subclass or lookalike", () => {
  const m = mod();
  const decision = new m.PolicyDecision({ effect: "allow", reason: "matched", matchedPolicyId: "pol-1", traceId: TRACE });
  const request = new m.PolicyRequest({ action: COMMAND, resource: { a: 1 }, context: {} });

  for (const value of [decision, request]) {
    assert.ok(Object.isFrozen(value), "the instance must be frozen");
    assert.equal(typeof value.toJSON, "function", "must expose toJSON");
    assert.equal(typeof value.toString, "function", "must expose toString");
    assert.equal(value.toString(), JSON.stringify(value.toJSON()), "toString must render exactly JSON.stringify(toJSON())");
    assert.deepEqual(value.toJSON(), value.toJSON(), "repeated toJSON serializations must be equal");
    assert.equal(JSON.stringify(value.toJSON()), JSON.stringify(value.toJSON()), "repeated toJSON serializations must stringify identically");
  }

  class FakeDecision extends m.PolicyDecision {}
  const fakeDecision = new FakeDecision({ effect: "allow", reason: "matched", matchedPolicyId: "pol-1", traceId: TRACE });
  const hollowDecision = Object.create(m.PolicyDecision.prototype);
  if (typeof m.PolicyDecision.prototype.equals === "function") {
    assert.equal(decision.equals(fakeDecision), false, "a subclass instance must not be admitted as equal by exact-class comparison");
    assert.equal(decision.equals(hollowDecision), false, "a hollow prototype lookalike must not be admitted as equal");
  } else {
    assert.equal(isExactly(fakeDecision, m.PolicyDecision), false, "a subclass instance is not an exact PolicyDecision by prototype identity");
  }

  assert.throws(() => { decision.effect = "deny"; }, TypeError, "a frozen PolicyDecision must refuse reassignment");
  assert.throws(() => { request.resource.mutated = true; }, TypeError, "a frozen PolicyRequest's resource must refuse mutation");
});

// D. The PKG11 change-gate contract itself (RED until planning/kernel-policy-decision-protocol-pkg11.json exists).
const CONTRACT_PATH = "planning/kernel-policy-decision-protocol-pkg11.json";
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

test("PKG11 change-gate contract: identity, authority, budget, allowed files, non-goals, commands, QA and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg11-policy-decision-protocol");
  assert.equal(c.baseCommit, "a62ab8411946e05f9279b64456bc784f3d337622");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.equal(c.authority?.sequenceId, "kernel-primitives-typed-action-pdp");
  assert.equal(c.authority?.sequenceOrder, 2);
  assert.equal(c.authority?.subset, "policy-request-decision-protocol-values");
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800);
  assert.equal(c.budget?.maxChangedFiles, 20);
  assert.equal(c.budget?.fullQaBudget, 2);
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-policy-decision-protocol-pkg11.json",
    "src/application/policy-decision.mjs", "tests/kernel-policy-decision.test.mjs",
    "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths");
  assert.deepEqual(c.evidencePolicy?.required, ["qa1", "qa2", "fresh-independent-review"],
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review — never a bare required-ci-qa2 token");
  for (const re of [
    /evaluator|pdp execution/i, /rls|db adapter/i, /rbac|abac|rebac/i,
    /audit|cache|pep/i, /sdk|app|module|surface/i, /release|deploy|production/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands, /node --test tests\/kernel-policy-decision\.test\.mjs/, "red.commands");
  hasMatch(c.red?.evidence, /7\s*\/\s*7/, "red.evidence (prior missing-module 7/7 fail)");
  hasMatch(c.green?.requirements, /8\s*\/\s*8/, "green.requirements (targeted 8/8)");
  hasMatch(c.green?.requirements, /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements, /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements, /fresh independent review/i, "green.requirements (fresh independent review)");
  hasMatch(
    c.green?.requirements,
    /qa2.*required ci.*when configured.*otherwise.*second local full qa/is,
    "green.requirements (QA2 truthfully uses required CI when configured, otherwise a second local full QA)",
  );
  assert.match(String(c.rollback), /revert(s|ed)?.*five.file.*shard/i, "rollback must revert this five-file shard");
  assert.match(String(c.rollback), /s1 substrate.*untouched/i, "rollback must leave the S1 substrate untouched");
  for (const re of [
    /allowed.?file parity/i, /source.*(<=|≤)\s*300/i, /net.*(<=|≤)\s*800/i,
    /targeted.*green/i, /\bqa\s*1\b/i,
    /qa2.*required ci.*when configured.*otherwise.*second local full qa/is,
    /fresh.*review/i, /no readiness.*claim|no release claim/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});
