import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import { PolicyRequest, PolicyDecision } from "../src/application/policy-decision.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";

// PKG12 — AuthorizationEvaluator: candidate-outcome combining, and nothing else. A frozen,
// stateless, no-arg class whose `decide({request, candidates})` is entirely synchronous and
// pure — never a Promise. `request` must be an exact genuine PolicyRequest; `candidates` are
// already-scoped outcomes, each an exact ordinary {policyId, effect, applies} data object. No
// RBAC/ABAC/ReBAC, cache/I/O/audit/RLS, adapter, Policy-port change, SDK or central PDP. Output
// is an exact genuine PolicyDecision carrying request.action.correlationId as traceId.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/authorization-evaluator.mjs";

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

const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-authz-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const IDEMPOTENCY = new IdempotencyKey("order-9902-retry-1");
const COMMAND = new Command({
  name: "billing.invoice.issue", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, idempotencyKey: IDEMPOTENCY, payload: { amount: 42 },
});
const REQUEST = new PolicyRequest({ action: COMMAND, resource: { id: "inv-1" }, context: {} });

const cand = (policyId, effect, applies) => ({ policyId, effect, applies });

function decisionOf(evaluator, request, candidates) {
  return evaluator.decide({ request, candidates });
}

// A. Module surface, imports and forbidden vocabulary.
test("module surface: exactly AuthorizationEvaluator, frozen, no decision-engine vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["AuthorizationEvaluator"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.AuthorizationEvaluator, "function", "AuthorizationEvaluator must be a class");
  assert.ok(Object.isFrozen(m.AuthorizationEvaluator), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.AuthorizationEvaluator.prototype), "the prototype must be frozen");
  for (const absent of [
    "Pdp", "PDP", "Pep", "PEP", "Pip", "Pap", "Enforcer",
    "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role", "Permission", "Grant",
    "Rls", "RowLevelSecurity", "AuditLog", "Audit", "Cache", "Repository", "Adapter",
    "Sdk", "SDK", "Policy",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the AuthorizationEvaluator`);
  }
});

test("module reaches no forbidden import and carries no PDP/RBAC/cache/audit vocabulary in code", () => {
  const text = code();
  for (const [label, pattern] of [
    ["a node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["the Policy port", /["'`][^"'`]*\/policy\.mjs["'`]/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a central decision point", /\bPDP\b|\bPEP\b|central\s+decision/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\brule\s*match/i],
    ["persistence or telemetry", /\baudit\b|\bcache\b|\bmemo\b|\brepositor|\bpersist|\bRLS\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

// B. Construction and input admission.
test("AuthorizationEvaluator is a frozen, stateless, no-arg class; decide takes exactly {request, candidates}", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  assert.ok(Object.isFrozen(evaluator), "an AuthorizationEvaluator instance must be frozen");
  assert.equal(typeof evaluator.decide, "function", "decide must be a method");
  for (const bad of [{}, undefined, null, [], "x", 0]) {
    throws(() => new m.AuthorizationEvaluator(bad), "the constructor must refuse any supplied argument, explicit undefined included");
  }
  const hollow = Object.create(PolicyRequest.prototype);
  class DerivedRequest extends PolicyRequest {}
  const derived = new DerivedRequest({ action: COMMAND, resource: {}, context: {} });

  for (const [label, bad] of [
    ["null", null], ["undefined", undefined], ["req", "req"], ["1", 1], ["{}", {}], ["[]", []],
    ["hollow", hollow], ["derived", derived], ["COMMAND", COMMAND],
  ]) {
    throws(() => evaluator.decide({ request: bad, candidates: [] }),
      `request ${label} must be refused: not an exact genuine PolicyRequest`);
  }
  throws(() => evaluator.decide({ request: REQUEST, candidates: [], extra: 1 }), "an unknown top-level key must be refused");
  throws(() => evaluator.decide({ request: REQUEST }), "a missing candidates must be refused");
  throws(() => evaluator.decide({ candidates: [] }), "a missing request must be refused");
  throws(() => evaluator.decide(), "no input at all must be refused");
  throws(() => evaluator.decide(null), "a null input must be refused");
  assert.doesNotThrow(() => evaluator.decide({ request: REQUEST, candidates: [] }),
    "a genuine PolicyRequest with an empty candidate list is admissible");
});

test("decide options must be an ordinary object with exactly enumerable data properties request and candidates", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, "request", { enumerable: true, get: () => REQUEST });
  Object.defineProperty(accessorRequest, "candidates", { enumerable: true, value: [] });
  const accessorCandidates = { request: REQUEST };
  Object.defineProperty(accessorCandidates, "candidates", { enumerable: true, get: () => [] });
  const nonEnumRequest = { candidates: [] };
  Object.defineProperty(nonEnumRequest, "request", { value: REQUEST, enumerable: false });
  const symbolKeyedOptions = { request: REQUEST, candidates: [] };
  symbolKeyedOptions[Symbol("x")] = 1;
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), { request: REQUEST, candidates: [] });
  const nullProtoOptions = Object.assign(Object.create(null), { request: REQUEST, candidates: [] });

  for (const [label, bad] of [
    ["an array", [REQUEST, []]],
    ["a null-prototype object", nullProtoOptions],
    ["a custom-prototype object", customProtoOptions],
    ["an accessor-defined request", accessorRequest],
    ["an accessor-defined candidates", accessorCandidates],
    ["a symbol-keyed extra property", symbolKeyedOptions],
    ["a non-enumerable request key", nonEnumRequest],
  ]) {
    throws(() => evaluator.decide(bad), `decide options with ${label} must be refused`);
  }
});

// C. Candidate shape admission.
test("candidates must be an ordinary array of exact {policyId, effect, applies} data objects", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const build = (candidates) => evaluator.decide({ request: REQUEST, candidates });

  for (const bad of [null, undefined, "x", 1, {}, new Set()]) {
    throws(() => build(bad), `candidates ${String(bad)} must be refused: not an array`);
  }

  const accessorCandidate = {};
  Object.defineProperty(accessorCandidate, "policyId", { enumerable: true, get: () => "pol-a" });
  Object.defineProperty(accessorCandidate, "effect", { enumerable: true, value: "allow" });
  Object.defineProperty(accessorCandidate, "applies", { enumerable: true, value: true });
  const sparse = []; sparse[1] = cand("pol-a", "allow", true);
  const protoInjected = JSON.parse('{"policyId":"pol-a","effect":"allow","applies":true,"__proto__":{}}');
  const symbolKeyed = cand("pol-a", "allow", true); symbolKeyed[Symbol("x")] = 1;
  const exotic = [cand("pol-a", "allow", true)]; exotic.extra = "surprise";

  for (const [label, bad] of [
    ["a sparse array", sparse],
    ["a null entry", null], ["a string entry", "pol-a"], ["an array entry", [1, 2]],
    ["a hollow-prototype entry", Object.create({ policyId: "pol-a", effect: "allow", applies: true })],
    ["a null-prototype entry", Object.assign(Object.create(null), cand("pol-a", "allow", true))],
    ["an extra-key entry", { policyId: "pol-a", effect: "allow", applies: true, extra: 1 }],
    ["a missing-key entry", { policyId: "pol-a", effect: "allow" }],
    ["a symbol-keyed entry", symbolKeyed],
    ["a __proto__-injected entry", protoInjected],
    ["an accessor-defined entry", accessorCandidate],
    ["a non-canonical policyId", { policyId: "Pol-A", effect: "allow", applies: true }],
    ["an empty policyId", { policyId: "", effect: "allow", applies: true }],
    ["a malformed policyId", { policyId: "pol_a!", effect: "allow", applies: true }],
    ["a too-long policyId", { policyId: "p".repeat(200), effect: "allow", applies: true }],
    ["an invalid effect", { policyId: "pol-a", effect: "permit", applies: true }],
    ["a non-boolean applies", { policyId: "pol-a", effect: "allow", applies: "true" }],
  ]) {
    throws(() => build([bad]), `candidate with ${label} must be refused`);
  }

  throws(() => build([cand("pol-a", "allow", true), cand("pol-a", "deny", false)]),
    "duplicate policyId across candidates must be refused, whatever the duplicate's own fields say");
  throws(() => build(exotic), "a candidates array carrying a property beside its elements must be refused");
  assert.doesNotThrow(() => build([cand("pol.a", "allow", true)]), "one well-formed candidate is admissible");
  throws(() => build([cand("pol-a", "allow", true), { policyId: "pol-b", effect: "allow" }]),
    "a valid applicable allow followed by an invalid candidate must throw, never short-circuit to that allow");
});

// D. Decision semantics: default deny, deny-overrides, lexicographic determinism, no mutation.
test("empty or wholly non-applicable candidates default to deny with a null matchedPolicyId", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  for (const candidates of [
    [], [cand("pol-a", "allow", false)], [cand("pol-a", "deny", false), cand("pol-b", "allow", false)],
  ]) {
    const decision = decisionOf(evaluator, REQUEST, candidates);
    assert.ok(isExactly(decision, PolicyDecision), "decide must return an exact genuine PolicyDecision");
    assert.equal(decision.effect, "deny");
    assert.equal(decision.matchedPolicyId, null, "no applicable candidate must leave matchedPolicyId null");
  }
});

test("a single applicable allow, with no applicable deny, yields allow with that policyId as the match", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const decision = decisionOf(evaluator, REQUEST, [
    cand("pol-zulu", "allow", true), cand("pol-inapplicable", "deny", false),
  ]);
  assert.equal(decision.effect, "allow");
  assert.equal(decision.matchedPolicyId, "pol-zulu");
});

test("an applicable deny overrides every applicable allow, regardless of array order", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const winner = [cand("pol-alpha", "allow", true), cand("pol-beta", "deny", true), cand("pol-gamma", "allow", true)];
  for (const candidates of [winner, [...winner].reverse(), [winner[2], winner[0], winner[1]]]) {
    const decision = decisionOf(evaluator, REQUEST, candidates);
    assert.equal(decision.effect, "deny", "deny overrides allow whatever order the candidates arrive in");
    assert.equal(decision.matchedPolicyId, "pol-beta");
  }
});

test("the winner is the lexicographically smallest applicable policyId within the winning effect, independent of order", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();

  const allowSet = [cand("pol-zulu", "allow", true), cand("pol-alpha", "allow", true), cand("pol-mike", "allow", true)];
  for (const candidates of [allowSet, [...allowSet].reverse(), [allowSet[1], allowSet[2], allowSet[0]]]) {
    const decision = decisionOf(evaluator, REQUEST, candidates);
    assert.equal(decision.effect, "allow");
    assert.equal(decision.matchedPolicyId, "pol-alpha", "smallest applicable allow policyId wins, order-independent");
  }

  const denySet = [
    cand("pol-zulu", "deny", true), cand("pol-alpha", "deny", true),
    cand("pol-echo-smaller-allow", "allow", true),
  ];
  for (const candidates of [denySet, [...denySet].reverse()]) {
    const decision = decisionOf(evaluator, REQUEST, candidates);
    assert.equal(decision.effect, "deny");
    assert.equal(decision.matchedPolicyId, "pol-alpha",
      "smallest applicable deny wins; a lexicographically smaller allow never crosses effect groups");
  }
});

test("decide never mutates the request, the candidates array or any candidate object, and returns synchronously", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const candidates = Object.freeze([
    Object.freeze(cand("pol-a", "allow", true)),
    Object.freeze(cand("pol-b", "deny", true)),
  ]);
  const before = JSON.stringify(candidates);
  const requestBefore = REQUEST.toString();

  const decision = evaluator.decide({ request: REQUEST, candidates });

  assert.ok(!(decision instanceof Promise), "decide must never return a Promise");
  assert.equal(JSON.stringify(candidates), before, "candidates must be unchanged after decide");
  assert.equal(REQUEST.toString(), requestBefore, "the request must be unchanged after decide");
});

test("the returned PolicyDecision carries request.action.correlationId as traceId, by identity", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const decision = decisionOf(evaluator, REQUEST, [cand("pol-a", "allow", true)]);
  assert.equal(decision.traceId, REQUEST.action.correlationId, "traceId must be exactly request.action.correlationId");
  assert.ok(isExactly(decision.traceId, CorrelationId), "traceId must remain an exact genuine CorrelationId");
});

test("decide is deterministic: the same request and candidate set, differently ordered, always answers alike", () => {
  const m = mod();
  const evaluator = new m.AuthorizationEvaluator();
  const base = [cand("pol-c", "allow", true), cand("pol-a", "allow", true), cand("pol-b", "deny", false)];
  const shuffled = [base[2], base[0], base[1]];
  const first = decisionOf(evaluator, REQUEST, base);
  const second = decisionOf(evaluator, REQUEST, shuffled);
  assert.equal(first.effect, second.effect);
  assert.equal(first.matchedPolicyId, second.matchedPolicyId);
});

// E. The PKG12 change-gate contract itself (RED until planning/kernel-authorization-evaluator-pkg12.json exists).
const CONTRACT_PATH = "planning/kernel-authorization-evaluator-pkg12.json";
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

test("PKG12 change-gate contract: identity, authority, budget, allowed files, non-goals, QA and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg12-authorization-decision");
  assert.equal(c.baseCommit, "8c6dd899da7ace4cec0e8760038d5741837092e8");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.match(String(c.authority?.subset ?? ""), /authoriz|evaluat|decision/i);
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800, "maxNet must equal the canonical security-test-conformance conditional ceiling");
  assert.equal(c.budget?.maxChangedFiles, 20, "maxChangedFiles must equal the canonical security-test-conformance conditional ceiling");
  assert.equal(c.budget?.fullQaBudget, 2);
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-authorization-evaluator-pkg12.json",
    "src/application/authorization-evaluator.mjs", "tests/kernel-authorization-evaluator.test.mjs",
    "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths");
  assert.deepEqual(c.evidencePolicy?.required, ["qa1", "qa2", "fresh-independent-review"],
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  for (const re of [
    /rbac|abac|rebac/i, /cache|audit|rls/i, /adapter/i, /sdk/i, /central.*pdp|\bpdp\b/i,
    /policy\s*port/i, /release|deploy|production|readiness/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands, /node --test tests\/kernel-authorization-evaluator\.test\.mjs/, "red.commands");
  hasMatch(c.green?.requirements, /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements, /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements, /fresh independent review/i, "green.requirements (fresh independent review)");
  hasMatch(
    c.green?.requirements,
    /qa2.*required ci.*when configured.*otherwise.*second local full qa/is,
    "green.requirements (QA2 truthfully uses required CI when configured, otherwise a second local full QA)",
  );
  assert.match(String(c.rollback), /revert(s|ed)?.*five.file.*shard/i, "rollback must revert this five-file shard");
  for (const re of [
    /allowed.?file parity/i, /\bqa\s*1\b/i,
    /qa2.*required ci.*when configured.*otherwise.*second local full qa/is,
    /fresh.*review/i, /no readiness.*claim|no release claim/i,
    /source.*(<=|at most|no more than).*300/i, /net.*(<=|at most|no more than).*800/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});
