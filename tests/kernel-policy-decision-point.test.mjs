import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import { AuthorizationEvaluator } from "../src/application/authorization-evaluator.mjs";
import { PolicyDecision, PolicyRequest } from "../src/application/policy-decision.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";

// PKG13 — PolicyDecisionPoint: a central Application-ring orchestration boundary, and nothing
// else. A frozen `{candidatesFor}` collaborator seam; `decide(request)` is async — it rejects a
// non-exact/non-genuine PolicyRequest before ever touching the collaborator, calls
// `candidatesFor` exactly once with an undefined receiver and the request by identity, and
// passes whatever it resolves to, unchanged, into one internal frozen AuthorizationEvaluator,
// answering with its exact PolicyDecision. No rule/candidate derivation, no RBAC/ABAC/ReBAC, no
// RLS/DB/adapter, no enforcement, no Policy-port change, no SDK, no mutation/cache/retry/timeout.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-decision-point.mjs";

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
const rejectsWith = (fn, pred, label) => assert.rejects(fn, pred, label);

const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-pdp-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const IDEMPOTENCY = new IdempotencyKey("order-9902-retry-1");
const COMMAND = new Command({
  name: "billing.invoice.issue", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, idempotencyKey: IDEMPOTENCY, payload: { amount: 42 },
});
const REQUEST = new PolicyRequest({ action: COMMAND, resource: { id: "inv-1" }, context: {} });

const cand = (policyId, effect, applies) => ({ policyId, effect, applies });

function spyOn(impl) {
  const calls = [];
  function candidatesFor(...args) {
    calls.push({ receiver: this, args });
    return impl(...args);
  }
  candidatesFor.calls = calls;
  return candidatesFor;
}

// A. Module surface, imports and forbidden vocabulary.
test("module surface: exactly PolicyDecisionPoint, frozen, no rule/RBAC/RLS/SDK/enforcement vocabulary", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyDecisionPoint"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyDecisionPoint, "function", "PolicyDecisionPoint must be a class");
  assert.ok(Object.isFrozen(m.PolicyDecisionPoint), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyDecisionPoint.prototype), "the prototype must be frozen");
  for (const absent of [
    "Statement", "PolicyStatement", "Rule", "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC",
    "Role", "Permission", "Grant", "Rls", "RowLevelSecurity", "Audit", "Cache", "Repository",
    "Adapter", "Sdk", "SDK", "Enforcer", "Pep", "PEP",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the PolicyDecisionPoint`);
  }
});

test("module imports only its two collaborators, reaches no forbidden vocabulary, no default export", () => {
  const text = code();
  const specifiers = [...text.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["./authorization-evaluator.mjs", "./policy-decision.mjs"].sort(),
    "policy-decision-point.mjs must import only from ./policy-decision.mjs and ./authorization-evaluator.mjs",
  );
  assert.ok(!/import\s*\*\s*as/.test(text), "must not take a namespace import");
  assert.ok(!/\brequire\s*\(/.test(text), "must not use require");
  assert.ok(!/export\s+default/.test(text), "must not carry a default export");
  for (const [label, pattern] of [
    ["a node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a policy statement or rule schema", /\bstatement\b|\brule\s*match|\bschema\b/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b/i],
    ["persistence or telemetry", /\brls\b|\btransaction\b|\baudit\b|\boutbox\b/i],
    ["enforcement", /\benforce/i],
    ["the Policy port", /["'`][^"'`]*\/policy\.mjs["'`]/],
    ["an SDK or delivery surface", /\bsdk\b|\bdelivery\b|\barchetype\b/i],
    ["a release/readiness/deploy claim", /\brelease\b|\breadiness\b|\bdeploy/i],
    ["retry/timeout/queue/fallback/cache", /\bretry\b|\btimeout\b|\bqueue\b|\bfallback\b|\bcache\b|\bmemo/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
});

// B. Construction: exact ordinary {candidatesFor} data object, function-valued, nothing exotic.
test("PolicyDecisionPoint constructor requires exactly one ordinary enumerable data property candidatesFor holding a function", () => {
  const m = mod();
  const impl = () => [];
  assert.doesNotThrow(() => new m.PolicyDecisionPoint({ candidatesFor: impl }), "a plain function collaborator must be admitted");
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: impl });
  assert.ok(Object.isFrozen(pdp), "a PolicyDecisionPoint instance must be frozen");
  assert.equal(typeof pdp.decide, "function", "decide must be a method");

  for (const bad of [undefined, null, "x", 0, [], () => {}]) {
    assert.throws(() => new m.PolicyDecisionPoint(bad), TypeError, "the constructor must refuse a non-ordinary-object argument");
  }
  assert.throws(() => new m.PolicyDecisionPoint(), TypeError, "the constructor must refuse no argument");

  let accessorGetterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, "candidatesFor", {
    enumerable: true,
    configurable: true,
    get() { accessorGetterCalled = true; return impl; },
  });
  assert.throws(() => new m.PolicyDecisionPoint(accessor), TypeError, "an accessor-defined candidatesFor must be refused");
  assert.equal(accessorGetterCalled, false, "an accessor-defined candidatesFor must be refused without ever invoking the getter");

  const nonEnum = {};
  Object.defineProperty(nonEnum, "candidatesFor", { value: impl, enumerable: false });
  const symbolKeyed = { candidatesFor: impl }; symbolKeyed[Symbol("x")] = 1;
  const extraKey = { candidatesFor: impl, extra: 1 };
  const missingKey = {};
  const wrongValue = { candidatesFor: "not-a-function" };
  const wrongValue2 = { candidatesFor: { call: impl } };
  class CustomOptions {}
  const customProto = Object.assign(new CustomOptions(), { candidatesFor: impl });
  const nullProto = Object.assign(Object.create(null), { candidatesFor: impl });

  for (const [label, bad] of [
    ["a non-enumerable candidatesFor", nonEnum],
    ["a symbol-keyed extra property", symbolKeyed],
    ["an extra enumerable key", extraKey],
    ["a missing candidatesFor", missingKey],
    ["a string candidatesFor", wrongValue],
    ["a non-function object candidatesFor", wrongValue2],
    ["a custom-prototype options object", customProto],
    ["a null-prototype options object", nullProto],
  ]) {
    assert.throws(() => new m.PolicyDecisionPoint(bad), TypeError, `options with ${label} must be refused`);
  }
});

// C. decide(request): exact genuine PolicyRequest admission, refused before touching the collaborator.
test("decide always returns a Promise and rejects a non-exact/non-genuine PolicyRequest before calling candidatesFor", async () => {
  const m = mod();
  const untouchable = spyOn(() => { throw new Error("candidatesFor must never be reached for an invalid request"); });
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: untouchable });

  const hollow = Object.create(PolicyRequest.prototype);
  class DerivedRequest extends PolicyRequest {}
  const derived = new DerivedRequest({ action: COMMAND, resource: {}, context: {} });

  for (const [label, bad] of [
    ["null", null], ["undefined", undefined], ["a string", "req"], ["a number", 1],
    ["a plain object", {}], ["an array", []], ["hollow-prototype", hollow], ["a subclass instance", derived],
    ["the action instead of the request", COMMAND],
  ]) {
    const outcome = pdp.decide(bad);
    assert.ok(outcome instanceof Promise, `decide(${label}) must synchronously return a Promise, never throw`);
    await rejectsWith(outcome, TypeError, `decide must reject ${label}: not an exact genuine PolicyRequest`);
  }
  assert.equal(untouchable.calls.length, 0, "candidatesFor must never be invoked for any invalid request");

  await rejectsWith(() => pdp.decide(), TypeError, "decide with no argument at all must reject");
});

// D. Collaborator call contract: receiver, count, argument identity, and error propagation.
test("candidatesFor is called exactly once with an undefined receiver and the request by identity", async () => {
  const m = mod();
  const spy = spyOn((req) => { assert.equal(req, REQUEST); return [cand("pol-a", "allow", true)]; });
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spy });
  await pdp.decide(REQUEST);
  assert.equal(spy.calls.length, 1, "candidatesFor must be called exactly once");
  assert.equal(spy.calls[0].receiver, undefined, "candidatesFor must be called with an undefined receiver, never bound to the options object");
  assert.equal(spy.calls[0].args.length, 1, "candidatesFor must be called with exactly one argument");
  assert.equal(spy.calls[0].args[0], REQUEST, "candidatesFor must receive the exact request instance by identity");
});

test("a synchronous throw from candidatesFor propagates by identity as decide's rejection", async () => {
  const m = mod();
  const boom = new Error("candidatesFor exploded synchronously");
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => { throw boom; }) });
  await rejectsWith(() => pdp.decide(REQUEST), (e) => e === boom, "the same thrown Error instance must surface, by identity");
});

test("an asynchronous rejection from candidatesFor propagates by identity as decide's rejection", async () => {
  const m = mod();
  const boom = new Error("candidatesFor rejected asynchronously");
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => Promise.reject(boom)) });
  await rejectsWith(() => pdp.decide(REQUEST), (e) => e === boom, "the same rejection reason must surface, by identity");
});

test("a hostile thenable resolved by candidatesFor is unwrapped by ordinary await, not specially caught", async () => {
  const m = mod();
  const value = [cand("pol-hostile", "allow", true)];
  let thenCalls = 0;
  const thenable = {
    then(resolve) { thenCalls += 1; resolve(value); },
  };
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => thenable) });
  const decision = await pdp.decide(REQUEST);
  assert.equal(thenCalls, 1, "the thenable must be settled exactly once by ordinary await semantics");
  assert.equal(decision.effect, "allow");
  assert.equal(decision.matchedPolicyId, "pol-hostile");

  const throwingThenable = { then() { throw new Error("thenable threw during then"); } };
  const pdpThrow = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => throwingThenable) });
  await rejectsWith(() => pdpThrow.decide(REQUEST), Error, "a thenable that throws during then must surface as a rejection");
});

test("an invalid resolved candidate collection surfaces through the public async contract as a rejection", async () => {
  const m = mod();
  for (const bad of [
    null, "x", 1, {}, [{ policyId: "pol-a", effect: "permit", applies: true }],
    [cand("pol-a", "allow", true), cand("pol-a", "deny", false)],
  ]) {
    const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => bad) });
    await rejectsWith(() => pdp.decide(REQUEST), Error, `an invalid resolved candidate collection must reject decide`);
  }
});

// E. Delegation semantics: unchanged pass-through into one internal AuthorizationEvaluator.
test("decide answers with the exact PolicyDecision the same request/candidates would yield from AuthorizationEvaluator directly", async () => {
  const m = mod();
  const evaluator = new AuthorizationEvaluator();
  const scenarios = [
    [],
    [cand("pol-a", "allow", false)],
    [cand("pol-zulu", "allow", true), cand("pol-inapplicable", "deny", false)],
    [cand("pol-alpha", "allow", true), cand("pol-beta", "deny", true), cand("pol-gamma", "allow", true)],
  ];
  for (const candidates of scenarios) {
    const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => candidates) });
    const decision = await pdp.decide(REQUEST);
    const expected = evaluator.decide({ request: REQUEST, candidates });
    assert.ok(isExactly(decision, PolicyDecision), "decide must resolve an exact genuine PolicyDecision");
    assert.equal(decision.effect, expected.effect);
    assert.equal(decision.matchedPolicyId, expected.matchedPolicyId);
    assert.ok(decision.equals(expected), "the delegated decision must equal the directly-evaluated decision value-for-value");
    assert.equal(decision.traceId, REQUEST.action.correlationId, "traceId must remain request.action.correlationId by identity");
  }
});

test("decide never mutates the request or the candidates it received", async () => {
  const m = mod();
  const candidates = Object.freeze([Object.freeze(cand("pol-a", "allow", true))]);
  const before = JSON.stringify(candidates);
  const requestBefore = REQUEST.toString();
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spyOn(() => candidates) });
  await pdp.decide(REQUEST);
  assert.equal(JSON.stringify(candidates), before, "candidates must be unchanged after decide");
  assert.equal(REQUEST.toString(), requestBefore, "the request must be unchanged after decide");
});

test("no cache, no retry and no default candidate: repeated decide calls re-invoke the collaborator with no memory across calls", async () => {
  const m = mod();
  let call = 0;
  const spy = spyOn(() => {
    call += 1;
    return call === 1 ? [cand("pol-a", "allow", true)] : [];
  });
  const pdp = new m.PolicyDecisionPoint({ candidatesFor: spy });
  const first = await pdp.decide(REQUEST);
  const second = await pdp.decide(REQUEST);
  assert.equal(spy.calls.length, 2, "each decide call must re-invoke candidatesFor; nothing is cached");
  assert.equal(first.effect, "allow");
  assert.equal(second.effect, "deny", "no default/fallback candidate is substituted; an empty resolution yields the evaluator's own default deny");
});

// F. The PKG13 change-gate contract itself (RED until planning/kernel-policy-decision-point-pkg13.json exists).
const CONTRACT_PATH = "planning/kernel-policy-decision-point-pkg13.json";
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

test("PKG13 change-gate contract: frozen identity, authority, budget, allowed files, non-goals, QA and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg13-central-policy-decision-point", "packageId must be frozen exactly");
  assert.equal(c.baseCommit, "d895593a615aba0ace9161b2c392366a24bceed5");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.equal(c.authority?.sequenceId, "kernel-primitives-typed-action-pdp");
  assert.equal(c.authority?.sequenceOrder, 4);
  assert.equal(c.authority?.subset, "central-policy-decision-point-orchestration");
  assert.equal(c.status, "implementation-complete-external-evidence-pending",
    "status must never be flipped in-repo after QA; completion is recorded externally");
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800, "maxNet must equal the canonical security-test-conformance conditional ceiling");
  assert.equal(c.budget?.maxChangedFiles, 20, "maxChangedFiles must equal the canonical security-test-conformance conditional ceiling");
  assert.equal(c.budget?.fullQaBudget, 2);
  assert.deepEqual(c.budget?.requirements, [
    "single-narrow-problem", "bounded-file-set", "no-redundant-repetition", "no-quality-tradeoff",
    "full-green", "fresh-reviewer-accept", "explicit-rollback",
  ], "budget.requirements must be exactly these seven canonical conditional requirements");
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-policy-decision-point-pkg13.json",
    "src/application/policy-decision-point.mjs", "tests/kernel-policy-decision-point.test.mjs",
    "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths");
  assert.equal(c.evidencePolicy?.location, "external");
  assert.equal(c.evidencePolicy?.inRepoStatusFlipAfterQa, false);
  assert.equal(c.evidencePolicy?.snapshotMutationRequired, false);
  assert.deepEqual([...c.evidencePolicy?.required ?? []].sort(), ["fresh-independent-review", "qa1", "qa2"].sort(),
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  for (const re of [
    /statement|rule|schema/i, /candidate.*(derivation|matching)|deriv.*candidate/i,
    /rbac|abac|rebac/i, /rls|db|transaction|audit|outbox|adapter/i, /enforce/i,
    /sdk|app\b|module\b|archetype|delivery/i, /policy.?port|use.?case.?port/i,
    /release|deploy|production|readiness/i, /pkg11|pkg12/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands, /node --test tests\/kernel-policy-decision-point\.test\.mjs/, "red.commands");
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
