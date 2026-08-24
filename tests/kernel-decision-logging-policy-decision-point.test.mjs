import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { PolicyRequest, PolicyDecision } from "../src/application/policy-decision.mjs";
import { AuthorizationEvaluator } from "../src/application/authorization-evaluator.mjs";
import { DecisionLogEntry } from "../src/application/decision-log-entry.mjs";
import { DecisionLogPort } from "../src/application/decision-log-port.mjs";
import { Clock } from "../src/application/clock.mjs";

// =====================================================================================
// P04f — DecisionLoggingPolicyDecisionPoint: not yet implemented.
//
// Target API (this writer's synthesis, from the assignment): a frozen ordinary constructor
// {candidatesFor, decisionLog, idGenerator, clock, chainHead}; async decide(request);
// async decideAll(requests). One candidatesFor + one AuthorizationEvaluator decision per
// request; layer is derived from the already-fetched winning candidate after evaluator
// validation (v2 layer, exact legacy 3-key candidate means "tenant", default-deny null);
// a genuine DecisionLogEntry is built from idGenerator(), clock.now(), chainHead(tenantId),
// then genuinely appended through DecisionLogPort.append before decide() resolves with the
// exact PolicyDecision. decideAll fully preflights before touching any collaborator, is
// sequential/input-ordered, reads chainHead once per tenant per batch, chains later
// same-tenant entries from the prior successfully appended entryHash, and stops at the first
// error with no partial result ever observed.
//
// Written before src/application/decision-logging-policy-decision-point.mjs exists: every
// assertion below is a requirement on the not-yet-written module, and the dynamic import
// guard turns "the module does not exist yet" into one informative RED per test rather than
// a crash.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/decision-logging-policy-decision-point.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

function mod(scenario) {
  assert.ok(
    loaded !== null && typeof loaded.DecisionLoggingPolicyDecisionPoint === "function",
    `[${scenario}] ${modulePath} must exist, import cleanly and export DecisionLoggingPolicyDecisionPoint: `
      + `${loadError?.message ?? "DecisionLoggingPolicyDecisionPoint export missing"}`,
  );
  return loaded;
}

// -------------------------------------------------------------------------------------
// Shared genuine fixtures.
// -------------------------------------------------------------------------------------

const TENANT_A = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const TENANT_B = new TenantId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const ACTOR = new ActorId("svc-decision-log-worker");

const principalFor = (tenant) => new Principal(tenant, ACTOR);

const command = ({ tenant = TENANT_A, suffix, name = "billing.invoice.issue" } = {}) => new Command({
  name,
  version: 1,
  principal: principalFor(tenant),
  correlationId: new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
  causationId: null,
  idempotencyKey: new IdempotencyKey(`invoice-${suffix}-issue-1`),
  payload: { amount: 42 },
});

const request = (suffix, { tenant = TENANT_A, resource = { type: "invoice", id: `inv-${suffix}` } } = {}) =>
  new PolicyRequest({ action: command({ tenant, suffix }), resource, context: {} });

const v2Cand = (policyId, effect, applies, layer = "tenant", priority = 100) => ({
  policyId, effect, applies, priority, layer,
});
const legacyCand = (policyId, effect, applies) => ({ policyId, effect, applies });

const ULIDS = [
  "01ARZ3NDEKTSV4RRFFQ69G5FAA", "01ARZ3NDEKTSV4RRFFQ69G5FAB", "01ARZ3NDEKTSV4RRFFQ69G5FAC",
  "01ARZ3NDEKTSV4RRFFQ69G5FAD", "01ARZ3NDEKTSV4RRFFQ69G5FAE", "01ARZ3NDEKTSV4RRFFQ69G5FAF",
];
function idGeneratorOf(ids = ULIDS) {
  let i = 0;
  const calls = [];
  const fn = () => { calls.push(i); return ids[i++]; };
  fn.calls = calls;
  return fn;
}

function clockOf(startSeconds = 0) {
  let s = startSeconds;
  const calls = [];
  const clock = new Clock({
    now: async () => {
      calls.push(s);
      const ts = `2026-08-24T10:00:${String(s).padStart(2, "0")}.000Z`;
      s += 1;
      return ts;
    },
  });
  return { clock, calls };
}

function decisionLogOf(behavior) {
  const appended = [];
  const port = new DecisionLogPort({
    append: async (entry) => {
      appended.push(entry);
      if (typeof behavior === "function") return behavior(entry, appended.length);
      return { ok: true };
    },
  });
  return { port, appended };
}

function chainHeadOf(map = {}) {
  const calls = [];
  const fn = (tenantId) => {
    calls.push(tenantId);
    const key = tenantId.toString();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  };
  fn.calls = calls;
  return fn;
}

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// =====================================================================================
// 1. Single v2 matched happy path: exact decision, exact append-before-return, genuine entry.
// =====================================================================================

test("decide: single v2-matched happy path appends a genuine DecisionLogEntry before resolving with the exact PolicyDecision", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("1");

  const req = request("1");
  const candidates = [v2Cand("pol-allow", "allow", true, "platform", 200)];
  const order = [];

  const { clock, calls: clockCalls } = clockOf();
  const idGenerator = idGeneratorOf();
  const chainHead = chainHeadOf();
  const { port: decisionLog, appended } = decisionLogOf(async (entry) => {
    order.push("append-start");
    await Promise.resolve();
    order.push("append-end");
    return { stored: true, entry };
  });

  const dlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: (r) => { assert.equal(r, req); return candidates; },
    decisionLog, idGenerator, clock, chainHead,
  });

  const decision = await dlp.decide(req);
  order.push("decide-resolved");

  assert.deepEqual(order, ["append-start", "append-end", "decide-resolved"], "append must complete before decide() resolves");

  const expected = new AuthorizationEvaluator().decide({ request: req, candidates });
  assert.ok(isExactly(decision, PolicyDecision), "decide must resolve an exact genuine PolicyDecision");
  assert.ok(decision.equals(expected), "the returned decision must equal the direct AuthorizationEvaluator decision");

  assert.equal(appended.length, 1, "exactly one entry must be appended for one decide() call");
  const [entry] = appended;
  assert.ok(isExactly(entry, DecisionLogEntry), "an exact genuine DecisionLogEntry must be appended");
  assert.equal(entry.id, ULIDS[0], "entry id must come from idGenerator()");
  assert.equal(entry.request, req, "entry.request must be the exact request by identity");
  assert.ok(entry.decision.equals(decision), "entry.decision must equal the returned decision");
  assert.equal(entry.layerResolved, "platform", "layerResolved must come from the winning v2 candidate's layer");
  assert.equal(entry.prevHash, null, "prevHash must come from chainHead's answer for this tenant");
  assert.equal(idGenerator.calls.length, 1);
  assert.equal(clockCalls.length, 1);
  assert.equal(chainHead.calls.length, 1);
  assert.equal(chainHead.calls[0], req.tenantId);
});

// =====================================================================================
// 2. Default-deny -> null layer; legacy 3-key winning candidate -> "tenant" layer.
// =====================================================================================

test("decide: default-deny logs a null layer, and a legacy 3-key winning candidate logs the tenant layer", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("2");

  const denyReq = request("2a");
  const { port: denyLog, appended: denyAppended } = decisionLogOf();
  const denyDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => [],
    decisionLog: denyLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  const denyDecision = await denyDlp.decide(denyReq);
  assert.equal(denyDecision.effect, "deny");
  assert.equal(denyDecision.matchedPolicyId, null);
  assert.equal(denyAppended[0].layerResolved, null, "a default-deny decision must be logged with a null layer");

  const legacyReq = request("2b");
  const { port: legacyLog, appended: legacyAppended } = decisionLogOf();
  const legacyDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => [legacyCand("pol-legacy-allow", "allow", true)],
    decisionLog: legacyLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  const legacyDecision = await legacyDlp.decide(legacyReq);
  assert.equal(legacyDecision.effect, "allow");
  assert.equal(legacyDecision.matchedPolicyId, "pol-legacy-allow");
  assert.equal(legacyAppended[0].layerResolved, "tenant", "a winning legacy 3-key candidate must be logged as the tenant layer");
});

// =====================================================================================
// 3. Admission and failure propagation: no spurious decision, no spurious log entry.
// =====================================================================================

test("decide: rejects a non-genuine request before touching any collaborator, and an evaluation or append failure surfaces with no decision returned", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("3");

  assert.throws(() => new DecisionLoggingPolicyDecisionPoint({}), TypeError, "constructor must refuse missing options");
  assert.throws(() => new DecisionLoggingPolicyDecisionPoint(), TypeError, "constructor must refuse no argument");

  // A genuine DecisionLogPort and a genuine Clock must be required at construction: a frozen hollow
  // Object.create(prototype) impostor carries no private brand, must fail the required brand-aware
  // instanceof semantics, and the constructor must refuse it synchronously before any collaborator
  // (candidatesFor/idGenerator/chainHead/clock/append) ever runs.
  const hollowDecisionLog = Object.freeze(Object.create(DecisionLogPort.prototype));
  const hollowClock = Object.freeze(Object.create(Clock.prototype));
  assert.ok(!(hollowDecisionLog instanceof DecisionLogPort), "a hollow Object.create impostor must not satisfy brand-aware DecisionLogPort instanceof");
  assert.ok(!(hollowClock instanceof Clock), "a hollow Object.create impostor must not satisfy brand-aware Clock instanceof");

  let constructionTouched = false;
  const genuineDecisionLog = decisionLogOf(() => { constructionTouched = true; return {}; }).port;
  const { clock: genuineClock } = clockOf();
  assert.ok(genuineDecisionLog instanceof DecisionLogPort, "a genuine DecisionLogPort must satisfy brand-aware instanceof");
  assert.ok(genuineClock instanceof Clock, "a genuine Clock must satisfy brand-aware instanceof");

  assert.throws(
    () => new DecisionLoggingPolicyDecisionPoint({
      candidatesFor: () => { constructionTouched = true; return []; },
      decisionLog: hollowDecisionLog,
      idGenerator: () => { constructionTouched = true; return ULIDS[0]; },
      clock: genuineClock,
      chainHead: () => { constructionTouched = true; return null; },
    }),
    TypeError,
    "constructor must refuse a hollow decisionLog impostor",
  );
  assert.throws(
    () => new DecisionLoggingPolicyDecisionPoint({
      candidatesFor: () => { constructionTouched = true; return []; },
      decisionLog: genuineDecisionLog,
      idGenerator: () => { constructionTouched = true; return ULIDS[0]; },
      clock: hollowClock,
      chainHead: () => { constructionTouched = true; return null; },
    }),
    TypeError,
    "constructor must refuse a hollow clock impostor",
  );
  assert.equal(constructionTouched, false, "no collaborator may run when construction is refused for a non-genuine decisionLog or clock");

  let touched = false;
  const untouchable = () => { touched = true; return []; };
  const { port: untouchableLog } = decisionLogOf(() => { touched = true; return {}; });
  const guarded = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: untouchable,
    decisionLog: untouchableLog,
    idGenerator: () => { touched = true; return ULIDS[0]; },
    clock: clockOf().clock,
    chainHead: () => { touched = true; return null; },
  });
  const hollow = Object.create(PolicyRequest.prototype);
  for (const bad of [null, undefined, "req", {}, hollow]) {
    await assert.rejects(() => guarded.decide(bad), TypeError, "an invalid request must be refused before any collaborator runs");
  }
  assert.equal(touched, false, "no collaborator may run for an invalid request");

  const evalFailure = new Error("candidatesFor exploded");
  const { port: evalFailLog, appended: evalFailAppended } = decisionLogOf();
  const evalFailDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => { throw evalFailure; },
    decisionLog: evalFailLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  await assert.rejects(() => evalFailDlp.decide(request("3a")), (e) => e === evalFailure);
  assert.equal(evalFailAppended.length, 0, "an evaluation failure must never append a log entry");

  const appendFailure = new Error("append backend unavailable");
  const { port: appendFailLog } = decisionLogOf(() => Promise.reject(appendFailure));
  const appendFailDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => [v2Cand("pol-allow", "allow", true)],
    decisionLog: appendFailLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  await assert.rejects(() => appendFailDlp.decide(request("3b")), (e) => e === appendFailure, "an append failure must surface as decide's rejection, never a resolved decision");
});

// =====================================================================================
// 4. decideAll: empty input and full preflight before any collaborator is touched.
// =====================================================================================

test("decideAll: empty input answers an ordinary frozen [] with no collaborator call, and a bad batch is fully preflighted first", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("4");

  let touched = false;
  const { port: touchableLog } = decisionLogOf(() => { touched = true; return {}; });
  const dlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => { touched = true; return []; },
    decisionLog: touchableLog,
    idGenerator: () => { touched = true; return ULIDS[0]; },
    clock: clockOf().clock,
    chainHead: () => { touched = true; return null; },
  });

  const empty = await dlp.decideAll([]);
  assert.ok(Array.isArray(empty) && empty.length === 0);
  assert.equal(Object.getPrototypeOf(empty), Array.prototype);
  assert.ok(Object.isFrozen(empty));
  assert.equal(touched, false, "an empty batch must never touch any collaborator");

  const counterfeit = Object.create(PolicyRequest.prototype);
  await assert.rejects(() => dlp.decideAll([request("4a"), counterfeit]), TypeError, "a counterfeit request anywhere in the batch must reject the whole call");
  assert.equal(touched, false, "a failed preflight must reject before any collaborator is ever touched, even for a genuine earlier element");

  await assert.rejects(() => dlp.decideAll("not-an-array"), TypeError);
  assert.equal(touched, false);
});

// =====================================================================================
// 5. Sequential batch chain behavior: one chainHead read per tenant, same-tenant linking.
// =====================================================================================

test("decideAll: sequential input-ordered evaluation, one chainHead read per tenant per batch, and same-tenant entries chain from the prior appended entryHash", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("5");

  const reqA1 = request("5a1", { tenant: TENANT_A });
  const reqA2 = request("5a2", { tenant: TENANT_A });
  const reqB1 = request("5b1", { tenant: TENANT_B });

  const callOrder = [];
  const { port: decisionLog, appended } = decisionLogOf((entry) => { callOrder.push(entry.request); return {}; });
  const chainHead = chainHeadOf({ [TENANT_A.toString()]: "a".repeat(64), [TENANT_B.toString()]: null });

  const dlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: () => [v2Cand("pol-allow", "allow", true)],
    decisionLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead,
  });

  await dlp.decideAll([reqA1, reqA2, reqB1]);

  assert.deepEqual(callOrder, [reqA1, reqA2, reqB1], "append order must match exact input order");
  assert.equal(chainHead.calls.length, 2, "chainHead must be read exactly once per distinct tenant in the batch");
  assert.deepEqual(chainHead.calls.map((t) => t.toString()).sort(), [TENANT_A.toString(), TENANT_B.toString()].sort());

  const [entryA1, entryA2, entryB1] = appended;
  assert.equal(entryA1.prevHash, "a".repeat(64), "the first tenant-A entry must chain from chainHead's answer");
  assert.equal(entryA2.prevHash, entryA1.entryHash, "the second tenant-A entry must chain from the first entry's own appended entryHash");
  assert.equal(entryB1.prevHash, null, "tenant B's entry must chain independently from tenant A's chain");
});

// =====================================================================================
// 6. First failure stops all later requests; decideAll exposes no partial result.
// =====================================================================================

test("decideAll: an evaluation or append failure partway through stops all later requests and decideAll exposes no partial result", async () => {
  const { DecisionLoggingPolicyDecisionPoint } = mod("6");

  const requests = [request("6a"), request("6b"), request("6c")];
  const evalFailure = new Error("boom-mid-batch-eval");
  const evalCalls = [];
  const { port: evalFailLog, appended: evalFailAppended } = decisionLogOf();
  const evalFailDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: (r) => {
      evalCalls.push(r);
      if (r === requests[1]) throw evalFailure;
      return [v2Cand("pol-allow", "allow", true)];
    },
    decisionLog: evalFailLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  const outcome = evalFailDlp.decideAll(requests);
  assert.ok(outcome instanceof Promise);
  await assert.rejects(() => outcome, (e) => e === evalFailure);
  assert.deepEqual(evalCalls, [requests[0], requests[1]], "the third request must never be evaluated once the second one fails");
  assert.equal(evalFailAppended.length, 1, "only the first, already-succeeded request may have been logged");

  const appendFailure = new Error("boom-mid-batch-append");
  const appendCalls = [];
  const { port: appendFailLog } = decisionLogOf((entry) => {
    appendCalls.push(entry.request);
    if (entry.request === requests[1]) throw appendFailure;
    return {};
  });
  const appendCandCalls = [];
  const appendFailDlp = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: (r) => { appendCandCalls.push(r); return [v2Cand("pol-allow", "allow", true)]; },
    decisionLog: appendFailLog, idGenerator: idGeneratorOf(), clock: clockOf().clock, chainHead: chainHeadOf(),
  });
  await assert.rejects(() => appendFailDlp.decideAll(requests), (e) => e === appendFailure);
  assert.deepEqual(appendCandCalls, [requests[0], requests[1]], "the third request must never be evaluated once the second one's append fails");
  assert.deepEqual(appendCalls, [requests[0], requests[1]], "append must never be attempted for the third request once the second one's append fails");
});
