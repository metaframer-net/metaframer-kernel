import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { PolicyStatement } from "../src/application/policy-statement.mjs";
import { PolicyDecision, PolicyRequest } from "../src/application/policy-decision.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";

// =====================================================================================
// P04b2 — PolicyCandidateResolver: not yet implemented.
//
// Expected API (this writer's synthesis, to be delivered by the implementation writer):
//   export class PolicyCandidateResolver
//     constructor({ statements })            // statements: array of exact genuine PolicyStatement
//     candidatesFor(request)                 // exact genuine PolicyRequest -> array of v2 candidates
//       { policyId, effect, applies, priority, layer }  (exactly these 5 enumerable keys, in this
//       order not required but exactly this key set, matching AuthorizationEvaluator's V2 shape)
//
// Matching grammar (this writer's synthesis, derived from PolicyStatement's own contract):
//   - targetActor: an ordinary object admitting ONLY the optional string keys "tenantId" and
//     "actorId". Absent key = unconstrained on that axis. Present key must equal the request's
//     PolicyRequest#tenantId / #actorId (compared via .toString()). Any other key present in
//     targetActor is a malformed selector and fails closed: applies=false, never thrown.
//   - targetAction must equal request.action.name exactly.
//   - targetResourceType must equal request.resource.type exactly (resource.type is a plain
//     string field on the canonical resource object; a resource carrying no type never matches
//     anything beyond a statement with no targetResourceType, which cannot exist since
//     PolicyStatement requires one).
//   - condition: an empty object ({}) means unconditional — applies whenever actor/action/
//     resourceType matched. Any non-empty condition is unsupported in this package and fails
//     closed: applies=false, never thrown, never evaluated against resource/context.
//   - enabled: false means the statement's candidate carries applies=false unconditionally,
//     regardless of every other axis, and its own getters/condition/actor are never consulted
//     to flip that back to true.
//   - Purity: candidatesFor is synchronous, deterministic, and does not mutate its inputs, the
//     supplied statements array, or any PolicyStatement/PolicyRequest passed to it. Getters on a
//     hostile lookalike object are never invoked while establishing admission.
//
// This resolver produces exactly the candidate shape AuthorizationEvaluator and
// PolicyDecisionPoint already accept unchanged — proven below by feeding its output straight
// through a genuine PolicyDecisionPoint and observing allow / deny-overrides / default-deny.
//
// Written before src/application/policy-candidate-resolver.mjs exists: every assertion below is
// a requirement on the not-yet-written module, and the dynamic import guard below turns "the
// module does not exist yet" into an informative, per-scenario RED rather than a crash.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-candidate-resolver.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

function mod(scenario) {
  assert.ok(
    loaded !== null && typeof loaded.PolicyCandidateResolver === "function",
    `[${scenario}] ${modulePath} must exist, import cleanly and export PolicyCandidateResolver: `
      + `${loadError?.message ?? "PolicyCandidateResolver export missing"}`,
  );
  return loaded;
}

// -------------------------------------------------------------------------------------
// Shared genuine fixtures
// -------------------------------------------------------------------------------------

const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const OTHER_TENANT = new TenantId("7c9e6679-7425-40de-944b-e07fc1f90ae7");
const ACTOR = new ActorId("sales-rep-1");
const OTHER_ACTOR = new ActorId("sales-rep-2");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const IDEMPOTENCY = new IdempotencyKey("customer-77-update-1");

const command = (overrides = {}) => new Command({
  name: "customer.update",
  version: 1,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: null,
  idempotencyKey: IDEMPOTENCY,
  payload: { field: "phone" },
  ...overrides,
});

const request = (overrides = {}) => new PolicyRequest({
  action: command(),
  resource: { type: "customer", id: "cust-77" },
  context: {},
  ...overrides,
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
// 1. Real multi-PolicyStatement + genuine PolicyRequest + PolicyCandidateResolver +
//    existing PolicyDecisionPoint integration: allow, deny-overrides, default-deny.
// =====================================================================================

test("PolicyCandidateResolver output, fed through a genuine PolicyDecisionPoint, proves allow, deny-overrides and default-deny on mismatch", async () => {
  const { PolicyCandidateResolver } = mod("integration");

  // Allow path: exactly one enabled, matching, unconditional allow statement.
  const allowResolver = new PolicyCandidateResolver({
    statements: [statement({ id: "policy.allow-customer-update", effect: "allow" })],
  });
  const allowPdp = new PolicyDecisionPoint({ candidatesFor: (req) => allowResolver.candidatesFor(req) });
  const allowDecision = await allowPdp.decide(request());
  assert.ok(allowDecision instanceof PolicyDecision, "decide must answer with a genuine PolicyDecision");
  assert.equal(allowDecision.effect, "allow", "a single matching enabled allow statement must win");
  assert.equal(allowDecision.matchedPolicyId, "policy.allow-customer-update");

  // Deny-overrides: a lower-priority, higher-layer deny must still beat a higher-priority allow.
  const denyOverridesResolver = new PolicyCandidateResolver({
    statements: [
      statement({
        id: "policy.tenant-allow", effect: "allow", priority: 900, layer: "tenant",
      }),
      statement({
        id: "policy.system-deny", effect: "deny", priority: 1, layer: "system",
      }),
    ],
  });
  const denyPdp = new PolicyDecisionPoint({ candidatesFor: (req) => denyOverridesResolver.candidatesFor(req) });
  const denyDecision = await denyPdp.decide(request());
  assert.equal(denyDecision.effect, "deny", "deny-overrides must beat any allow regardless of priority/layer");
  assert.equal(denyDecision.matchedPolicyId, "policy.system-deny");

  // Default-deny: no statement matches this request's resource type at all.
  const noMatchResolver = new PolicyCandidateResolver({
    statements: [statement({ id: "policy.only-for-invoice", targetResourceType: "invoice" })],
  });
  const noMatchPdp = new PolicyDecisionPoint({ candidatesFor: (req) => noMatchResolver.candidatesFor(req) });
  const noMatchDecision = await noMatchPdp.decide(request());
  assert.equal(noMatchDecision.effect, "deny", "no applicable candidate must default-deny");
  assert.equal(noMatchDecision.matchedPolicyId, null, "a default-deny carries no matchedPolicyId");
});

// =====================================================================================
// 2. Grammar / adversarial behavior: exact genuine inputs, targetActor grammar (only optional
//    tenantId/actorId strings), resource.type exact, empty-condition unconditional, non-empty/
//    unsupported condition and malformed selectors fail closed, disabled never applies, and
//    getters on a hostile lookalike are never invoked while resolving.
// =====================================================================================

test("PolicyCandidateResolver grammar: targetActor tenantId/actorId, exact resource.type, empty-condition-only match, malformed input fails closed, disabled never applies, no getter execution", () => {
  const { PolicyCandidateResolver } = mod("grammar");

  const only = (statements, id) => {
    const resolver = new PolicyCandidateResolver({ statements });
    const candidates = resolver.candidatesFor(request());
    return candidates.find((c) => c.policyId === id);
  };

  // A counterfeit built straight on PolicyStatement's prototype, carrying no private brand
  // state, must be refused by construction before its own hostile `id` getter ever runs.
  let counterfeitIdGetterRan = false;
  const counterfeitStatement = Object.create(PolicyStatement.prototype);
  Object.defineProperty(counterfeitStatement, "id", {
    get() { counterfeitIdGetterRan = true; return "policy.counterfeit"; },
    enumerable: true,
  });
  assert.throws(
    () => new PolicyCandidateResolver({ statements: [counterfeitStatement] }),
    (e) => e instanceof TypeError,
    "a counterfeit PolicyStatement lacking private brand state must be refused with a TypeError",
  );
  assert.equal(counterfeitIdGetterRan, false, "no hostile getter on a counterfeit statement may run during admission");

  // A sparse statements array (a hole) must be refused by construction, never densified.
  const sparseStatements = [statement({ id: "s.sparse-a" })];
  sparseStatements[2] = statement({ id: "s.sparse-c" });
  assert.throws(
    () => new PolicyCandidateResolver({ statements: sparseStatements }),
    (e) => e instanceof TypeError,
    "a sparse statements array must be refused with a TypeError",
  );

  // targetActor {} is unconstrained -> applies.
  assert.equal(only([statement({ id: "s.actor-open", targetActor: {} })], "s.actor-open").applies, true);

  // targetActor tenantId matching the request's tenant -> applies.
  assert.equal(
    only([statement({ id: "s.actor-tenant-match", targetActor: { tenantId: TENANT.toString() } })], "s.actor-tenant-match").applies,
    true,
  );
  // targetActor tenantId NOT matching -> does not apply.
  assert.equal(
    only([statement({ id: "s.actor-tenant-miss", targetActor: { tenantId: OTHER_TENANT.toString() } })], "s.actor-tenant-miss").applies,
    false,
  );
  // targetActor actorId matching -> applies; not matching -> does not.
  assert.equal(
    only([statement({ id: "s.actor-actor-match", targetActor: { actorId: ACTOR.toString() } })], "s.actor-actor-match").applies,
    true,
  );
  assert.equal(
    only([statement({ id: "s.actor-actor-miss", targetActor: { actorId: OTHER_ACTOR.toString() } })], "s.actor-actor-miss").applies,
    false,
  );
  // targetActor carrying both, both matching -> applies.
  assert.equal(
    only(
      [statement({
        id: "s.actor-both-match", targetActor: { tenantId: TENANT.toString(), actorId: ACTOR.toString() },
      })],
      "s.actor-both-match",
    ).applies,
    true,
  );
  // targetActor with an unsupported key (grammar violation) -> fails closed, never applies.
  assert.equal(
    only([statement({ id: "s.actor-malformed", targetActor: { role: "sales-rep" } })], "s.actor-malformed").applies,
    false,
  );

  // targetResourceType must equal request.resource.type exactly.
  assert.equal(
    only([statement({ id: "s.resource-match", targetResourceType: "customer" })], "s.resource-match").applies,
    true,
  );
  assert.equal(
    only([statement({ id: "s.resource-miss", targetResourceType: "invoice" })], "s.resource-miss").applies,
    false,
  );

  // Empty condition {} is unconditional -> applies (given every other axis matches).
  assert.equal(
    only([statement({ id: "s.condition-empty", condition: {} })], "s.condition-empty").applies,
    true,
  );
  // A non-empty / unsupported condition fails closed -> never applies, never thrown.
  assert.doesNotThrow(() => only(
    [statement({ id: "s.condition-unsupported", condition: { field: "ownerId", equals: "actor.id" } })],
    "s.condition-unsupported",
  ));
  assert.equal(
    only(
      [statement({ id: "s.condition-unsupported", condition: { field: "ownerId", equals: "actor.id" } })],
      "s.condition-unsupported",
    ).applies,
    false,
  );

  // A disabled statement never applies, regardless of every other axis matching.
  assert.equal(
    only([statement({ id: "s.disabled", enabled: false })], "s.disabled").applies,
    false,
  );

  // Getters on a hostile lookalike PolicyRequest/statement-bearing object are never executed:
  // resolving against a non-genuine request must fail admission rather than read a coordinate
  // off it.
  const resolver = new PolicyCandidateResolver({ statements: [statement({ id: "s.hostile-guard" })] });
  let getterRan = false;
  const hostileRequest = Object.create(PolicyRequest.prototype);
  Object.defineProperty(hostileRequest, "action", { get() { getterRan = true; return command(); }, enumerable: true });
  assert.throws(
    () => resolver.candidatesFor(hostileRequest),
    (e) => e instanceof TypeError,
    "a non-genuine PolicyRequest must be refused before candidatesFor",
  );
  assert.equal(getterRan, false, "no coordinate getter on a hostile lookalike may ever execute during admission");
});

// =====================================================================================
// 3. Determinism / purity / order-independence / non-mutation and the exact ordinary
//    5-key candidate output for an unremarkable matching case.
// =====================================================================================

test("PolicyCandidateResolver is deterministic, pure, order-independent, non-mutating, and emits exactly the ordinary 5-key v2 candidate shape", () => {
  const { PolicyCandidateResolver } = mod("determinism");

  const s1 = statement({ id: "policy.a", priority: 10, layer: "platform" });
  const s2 = statement({ id: "policy.b", effect: "deny", priority: 5, layer: "system" });
  const statementsAsc = Object.freeze([s1, s2]);
  const statementsDesc = Object.freeze([s2, s1]);
  const req = request();

  const resolverAsc = new PolicyCandidateResolver({ statements: statementsAsc });
  const resolverDesc = new PolicyCandidateResolver({ statements: statementsDesc });

  const first = resolverAsc.candidatesFor(req);
  const again = resolverAsc.candidatesFor(req);
  const reordered = resolverDesc.candidatesFor(req);

  const byId = (list) => Object.fromEntries(list.map((c) => [c.policyId, c]));
  assert.deepEqual(byId(first), byId(again), "two calls on identical input must answer identically: deterministic");
  assert.deepEqual(byId(first), byId(reordered), "input statement order must not change the resolved candidate set");

  assert.ok(Array.isArray(first), "candidatesFor must answer with an ordinary array");
  assert.equal(Object.getPrototypeOf(first), Array.prototype, "the array must be an ordinary Array, not exotic");

  for (const candidate of first) {
    assert.equal(
      Object.getPrototypeOf(candidate), Object.prototype,
      "each candidate must be an ordinary object literal, not a class instance or null-prototype object",
    );
    const keys = Reflect.ownKeys(candidate);
    assert.deepEqual(
      keys.slice().sort(), ["applies", "effect", "layer", "policyId", "priority"],
      "each candidate must carry exactly the 5 v2 keys: policyId, effect, applies, priority, layer",
    );
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      assert.ok("value" in descriptor && descriptor.enumerable, `candidate.${key} must be a plain enumerable data property`);
    }
  }

  const allowCandidate = byId(first)["policy.a"];
  assert.deepEqual(
    allowCandidate,
    {
      policyId: "policy.a", effect: "allow", applies: true, priority: 10, layer: "platform",
    },
    "an unremarkable matching statement must resolve to exactly this ordinary candidate value",
  );
  const denyCandidate = byId(first)["policy.b"];
  assert.deepEqual(
    denyCandidate,
    {
      policyId: "policy.b", effect: "deny", applies: true, priority: 5, layer: "system",
    },
  );

  // Non-mutation: the frozen input statements array, its PolicyStatement members, and the
  // PolicyRequest passed in must all be untouched by resolving.
  assert.equal(statementsAsc.length, 2, "the input statements array must not be mutated");
  assert.ok(Object.isFrozen(s1), "a genuine PolicyStatement instance stays frozen after resolving");
  assert.equal(s1.id, "policy.a", "resolving must not mutate a PolicyStatement's own fields");
  assert.equal(req.resource.type, "customer", "resolving must not mutate the PolicyRequest resource type");
  assert.equal(req.resource.id, "cust-77", "resolving must not mutate the PolicyRequest resource id");
  assert.deepEqual(Object.keys(req.resource).sort(), ["id", "type"], "resolving must not add or drop a resource field");
});
