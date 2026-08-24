import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { PolicyStatement } from "../src/application/policy-statement.mjs";
import { PolicyRequest } from "../src/application/policy-decision.mjs";
import { PolicyCandidateResolver } from "../src/application/policy-candidate-resolver.mjs";

// =====================================================================================
// P04c — PolicyBatchEvaluator: not yet implemented.
//
// Expected API (this writer's synthesis, to be delivered by the implementation writer):
//   export class PolicyBatchEvaluator
//     constructor({ candidatesFor })          // exact seam matching PolicyDecisionPoint's own
//     async decideAll(requests)                // ordinary dense array of genuine PolicyRequest
//                                               // -> ordinary frozen array of PolicyDecision, one
//                                               // per request, in exact input order.
//
// Contract (this writer's synthesis, derived from PolicyDecisionPoint's own contract):
//   - Full-array preflight: every element of `requests` must be an exact genuine PolicyRequest
//     before any collaborator is ever called. A non-ordinary/sparse/counterfeit array is refused
//     with a TypeError before even the FIRST element's coordinates are read.
//   - An empty array is ordinary input, not a preflight failure: decideAll([]) resolves to an
//     ordinary, frozen, empty array without ever calling the collaborator.
//   - Sequential, one-call-per-request evaluation, exactly matching input order: element i is
//     resolved before element i+1's collaborator call begins.
//   - The first candidatesFor throw/rejection stops evaluation of every later request and the
//     call rejects with that same error — no partial result array is ever produced or observed.
//   - Deterministic, non-mutating: the same input resolved twice answers with equal decisions,
//     and neither the input array nor any PolicyRequest inside it is altered by decideAll.
//
// Written before src/application/policy-batch-evaluator.mjs exists: every assertion below is a
// requirement on the not-yet-written module, and the dynamic import guard below turns "the module
// does not exist yet" into an informative, per-scenario RED rather than a crash.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-batch-evaluator.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

function mod(scenario) {
  assert.ok(
    loaded !== null && typeof loaded.PolicyBatchEvaluator === "function",
    `[${scenario}] ${modulePath} must exist, import cleanly and export PolicyBatchEvaluator: `
      + `${loadError?.message ?? "PolicyBatchEvaluator export missing"}`,
  );
  return loaded;
}

// -------------------------------------------------------------------------------------
// Shared genuine fixtures
// -------------------------------------------------------------------------------------

const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("sales-rep-1");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");

const command = (overrides = {}) => new Command({
  name: "customer.update",
  version: 1,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: null,
  idempotencyKey: new IdempotencyKey(`customer-${overrides.suffix ?? "77"}-update-1`),
  payload: { field: "phone" },
  ...(overrides.suffix !== undefined ? {} : {}),
});

const request = (resourceId, resourceType = "customer") => new PolicyRequest({
  action: command({ suffix: resourceId }),
  resource: { type: resourceType, id: `res-${resourceId}` },
  context: {},
});

const statementOptions = (overrides = {}) => ({
  id: "policy.sales-own-customer",
  effect: "allow",
  targetActor: {},
  targetAction: "customer.update",
  targetResourceType: "customer",
  condition: {},
  priority: 100,
  layer: "tenant",
  version: "1.0.0",
  enabled: true,
  ...overrides,
});

const statement = (overrides = {}) => new PolicyStatement(statementOptions(overrides));

// =====================================================================================
// 1. Real PolicyStatement + PolicyCandidateResolver + PolicyBatchEvaluator integration
//    over three genuine requests: allow, deny, default-deny, and exact input-order.
// =====================================================================================

test("PolicyBatchEvaluator decideAll, driven by a genuine PolicyCandidateResolver, resolves allow, deny and default-deny in exact input order", async () => {
  const { PolicyBatchEvaluator } = mod("integration");

  const resolver = new PolicyCandidateResolver({
    statements: [
      statement({ id: "policy.allow-customer-update", effect: "allow" }),
      statement({
        id: "policy.system-deny-invoice", effect: "deny", targetResourceType: "invoice", priority: 1, layer: "system",
      }),
    ],
  });

  const calls = [];
  const evaluator = new PolicyBatchEvaluator({
    candidatesFor: (req) => {
      calls.push(req);
      return resolver.candidatesFor(req);
    },
  });

  const allowRequest = request("1", "customer");
  const denyRequest = request("2", "invoice");
  const defaultDenyRequest = request("3", "unmapped-type");

  const decisions = await evaluator.decideAll([allowRequest, denyRequest, defaultDenyRequest]);

  assert.equal(decisions.length, 3, "one decision per request");
  assert.equal(decisions[0].effect, "allow");
  assert.equal(decisions[0].matchedPolicyId, "policy.allow-customer-update");
  assert.equal(decisions[1].effect, "deny");
  assert.equal(decisions[1].matchedPolicyId, "policy.system-deny-invoice");
  assert.equal(decisions[2].effect, "deny");
  assert.equal(decisions[2].matchedPolicyId, null, "no applicable candidate must default-deny");

  assert.equal(calls.length, 3, "candidatesFor must be called exactly once per request");
  assert.equal(calls[0], allowRequest, "call order must match input order exactly");
  assert.equal(calls[1], denyRequest);
  assert.equal(calls[2], defaultDenyRequest);
});

// =====================================================================================
// 2. Constructor option gates and full-array preflight reject malformed input before any
//    hostile getter or collaborator call; empty input answers with an ordinary frozen [].
// =====================================================================================

test("PolicyBatchEvaluator gates its options and preflights the full requests array before any hostile getter or collaborator call, while empty input answers ordinary frozen []", async () => {
  const { PolicyBatchEvaluator } = mod("preflight");

  assert.throws(
    () => new PolicyBatchEvaluator({}),
    (e) => e instanceof TypeError,
    "missing candidatesFor must be refused with a TypeError",
  );
  assert.throws(
    () => new PolicyBatchEvaluator({ candidatesFor: "not-a-function" }),
    (e) => e instanceof TypeError,
    "a non-function candidatesFor must be refused with a TypeError",
  );

  const resolver = new PolicyCandidateResolver({ statements: [statement()] });
  let collaboratorCalled = false;
  const evaluator = new PolicyBatchEvaluator({
    candidatesFor: (req) => {
      collaboratorCalled = true;
      return resolver.candidatesFor(req);
    },
  });

  // Empty array is ordinary input: no preflight failure, no collaborator call.
  const empty = await evaluator.decideAll([]);
  assert.ok(Array.isArray(empty) && empty.length === 0, "empty input answers an ordinary empty array");
  assert.equal(Object.getPrototypeOf(empty), Array.prototype, "the empty result must be an ordinary Array");
  assert.ok(Object.isFrozen(empty), "the empty result array must be frozen");
  assert.equal(collaboratorCalled, false, "empty input must never call the collaborator");

  // Non-array requests.
  await assert.rejects(
    () => evaluator.decideAll("not-an-array"),
    (e) => e instanceof TypeError,
    "a non-array requests value must be refused with a TypeError",
  );
  assert.equal(collaboratorCalled, false);

  // Sparse array (a hole).
  const sparse = [request("10")];
  sparse[2] = request("12");
  await assert.rejects(
    () => evaluator.decideAll(sparse),
    (e) => e instanceof TypeError,
    "a sparse requests array must be refused with a TypeError",
  );
  assert.equal(collaboratorCalled, false, "a sparse array must never reach the collaborator");

  // A counterfeit PolicyRequest, built on the real prototype but lacking private brand state,
  // must be refused before its own hostile "action" getter ever runs, and before the genuine
  // request preceding it in the array is ever handed to the collaborator.
  let hostileGetterRan = false;
  const counterfeitRequest = Object.create(PolicyRequest.prototype);
  Object.defineProperty(counterfeitRequest, "action", {
    get() { hostileGetterRan = true; return command({ suffix: "counterfeit" }); },
    enumerable: true,
  });
  await assert.rejects(
    () => evaluator.decideAll([request("20"), counterfeitRequest]),
    (e) => e instanceof TypeError,
    "a counterfeit PolicyRequest anywhere in the array must be refused with a TypeError",
  );
  assert.equal(hostileGetterRan, false, "no hostile getter on a counterfeit request may run during preflight");
  assert.equal(collaboratorCalled, false, "preflight must reject the whole batch before any collaborator call, even for a genuine request earlier in the array");

  // An accessor array element (not an own data property) must be refused before its getter is
  // ever invoked, and before the collaborator sees anything.
  let accessorElementGetterRan = false;
  const accessorRequests = [request("40")];
  Object.defineProperty(accessorRequests, 1, {
    get() { accessorElementGetterRan = true; return request("41"); },
    enumerable: true,
    configurable: true,
  });
  await assert.rejects(
    () => evaluator.decideAll(accessorRequests),
    (e) => e instanceof TypeError,
    "an accessor element in the requests array must be refused with a TypeError",
  );
  assert.equal(accessorElementGetterRan, false, "an accessor array element's getter must never run during preflight");
  assert.equal(collaboratorCalled, false, "an accessor element anywhere must reject the whole batch before any collaborator call");

  // An extra own property on the requests array beyond its dense indices/length must be
  // refused, never silently ignored.
  const taggedRequests = [request("50"), request("51")];
  taggedRequests.extra = "unexpected";
  await assert.rejects(
    () => evaluator.decideAll(taggedRequests),
    (e) => e instanceof TypeError,
    "an extra own property on the requests array must be refused with a TypeError",
  );
  assert.equal(collaboratorCalled, false, "an extra own property on the requests array must reject before any collaborator call");
});

// =====================================================================================
// 3. Sequential one-call-per-request ordering, deterministic non-mutating frozen output,
//    and first throw/rejection stops later calls with no partial result.
// =====================================================================================

test("PolicyBatchEvaluator evaluates sequentially in order, is deterministic and non-mutating, and a mid-batch collaborator failure stops later calls with no partial result", async () => {
  const { PolicyBatchEvaluator } = mod("sequencing");

  const resolver = new PolicyCandidateResolver({ statements: [statement()] });
  const requests = Object.freeze([request("30"), request("31"), request("32")]);

  const orderLog = [];
  let inFlight = 0;
  const sequentialEvaluator = new PolicyBatchEvaluator({
    candidatesFor: async (req) => {
      inFlight += 1;
      assert.equal(inFlight, 1, "no second candidatesFor call may begin before the previous one settles");
      orderLog.push(req.resource.id);
      const candidates = resolver.candidatesFor(req);
      inFlight -= 1;
      return candidates;
    },
  });

  const first = await sequentialEvaluator.decideAll(requests);
  const again = await sequentialEvaluator.decideAll(requests);

  assert.deepEqual(orderLog, ["res-30", "res-31", "res-32", "res-30", "res-31", "res-32"], "requests must be evaluated one at a time in exact input order");
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.map((d) => d.matchedPolicyId),
    again.map((d) => d.matchedPolicyId),
    "two calls on identical input must answer identically: deterministic",
  );
  assert.ok(Object.isFrozen(first), "the resolved decisions array must be frozen");
  assert.equal(requests.length, 3, "the input requests array must not be mutated");
  assert.equal(requests[0].resource.id, "res-30", "resolving must not mutate a PolicyRequest's own fields");

  // First failure stops all later calls; the batch rejects with that same error and produces
  // no partial result.
  const failure = new Error("boom-mid-batch");
  const callsBeforeFailure = [];
  const failingEvaluator = new PolicyBatchEvaluator({
    candidatesFor: (req) => {
      callsBeforeFailure.push(req.resource.id);
      if (req.resource.id === "res-31") throw failure;
      return resolver.candidatesFor(req);
    },
  });

  await assert.rejects(
    () => failingEvaluator.decideAll(requests),
    (e) => e === failure,
    "decideAll must reject with the exact error the collaborator threw",
  );
  assert.deepEqual(callsBeforeFailure, ["res-30", "res-31"], "evaluation must stop at the first failing request, never reaching res-32");

  // Snapshot integrity: once the full array has been preflight-validated, a collaborator-driven
  // mutation of the caller-owned array at a later index must never change what decideAll
  // evaluates at that index — it must evaluate the original validated request identity, never
  // the replacement swapped in mid-batch.
  const mutable = [request("60"), request("61"), request("62")];
  const originalAtTwo = mutable[2];
  const replacement = request("99");
  const seenAtIndexTwo = [];
  const snapshotEvaluator = new PolicyBatchEvaluator({
    candidatesFor: (req) => {
      if (req.resource.id === "res-60") mutable[2] = replacement;
      if (req === originalAtTwo || req === replacement) seenAtIndexTwo.push(req);
      return resolver.candidatesFor(req);
    },
  });
  await snapshotEvaluator.decideAll(mutable);
  assert.equal(seenAtIndexTwo.length, 1, "index 2 must be evaluated exactly once");
  assert.equal(
    seenAtIndexTwo[0], originalAtTwo,
    "decideAll must evaluate the original validated request at each index even if the caller mutates the array mid-batch, never a request swapped in afterward",
  );
});
