import assert from "node:assert/strict";
import test from "node:test";

import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "actor-1";
const OTHER_ACTOR = "actor-2";

function principalOf(tenant, actor) {
  return new Principal(new TenantId(tenant), new ActorId(actor));
}

function identityAnswering(principal) {
  return new Identity({ current: () => principal });
}

function pdpAnswering(candidates) {
  return new PolicyDecisionPoint({ candidatesFor: () => candidates });
}

const ALLOW_CANDIDATE = Object.freeze({
  policyId: "allow.everything",
  effect: "allow",
  applies: true,
});

const DENY_CANDIDATE = Object.freeze({
  policyId: "deny.everything",
  effect: "deny",
  applies: true,
});

function validActionSpec(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    actorId: ACTOR,
    tenantId: TENANT,
    payload: { name: "Ada Lovelace" },
    idempotencyKey: "order-42",
    ...overrides,
  };
}

function alwaysValidInvariants() {
  return { ok: true };
}

function pipelineOf({ principal, candidates, evaluateInvariants } = {}) {
  return new CreateCustomerPipeline({
    identity: identityAnswering(principal ?? principalOf(TENANT, ACTOR)),
    policyDecisionPoint: pdpAnswering(candidates ?? [ALLOW_CANDIDATE]),
    evaluateInvariants: evaluateInvariants ?? alwaysValidInvariants,
  });
}

test("ALLOW_COMMIT: closes with a frozen, pending PreparedChangeSet carrying exactly four intents", async () => {
  const pipeline = pipelineOf();
  const outcome = await pipeline.run(validActionSpec());

  assert.equal(outcome.outcome, "ALLOW_COMMIT");
  assert.equal(outcome.requestId, REQUEST_ID);
  assert.equal(outcome.error, null);
  assert.equal(outcome.preparedChangeSet.persistenceState, "pending");
  assert.deepEqual(
    Object.keys(outcome.preparedChangeSet.intents).sort(),
    ["audit", "customer", "idempotency", "transactionalOutbox"],
  );
  assert.ok(Object.isFrozen(outcome));
  assert.ok(Object.isFrozen(outcome.preparedChangeSet));
  assert.ok(Object.isFrozen(outcome.preparedChangeSet.intents));
});

test("ALLOW_COMMIT never carries a CommitReceipt-shaped field", async () => {
  const outcome = await pipelineOf().run(validActionSpec());
  assert.equal("commitReceipt" in outcome, false);
  assert.equal("commitReceipt" in outcome.preparedChangeSet, false);
});

test("same ActionSpec and same collaborator answers serialize byte-identically", async () => {
  const first = await pipelineOf().run(validActionSpec());
  const second = await pipelineOf().run(validActionSpec());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("INVALID: a malformed ActionSpec is refused before identity is ever consulted", async () => {
  let identityCalled = false;
  const pipeline = new CreateCustomerPipeline({
    identity: new Identity({ current: () => { identityCalled = true; return principalOf(TENANT, ACTOR); } }),
    policyDecisionPoint: pdpAnswering([ALLOW_CANDIDATE]),
    evaluateInvariants: alwaysValidInvariants,
  });

  const outcome = await pipeline.run(validActionSpec({ tenantId: "not-a-uuid" }));

  assert.equal(outcome.outcome, "INVALID");
  assert.equal(outcome.preparedChangeSet, null);
  assert.equal(outcome.error.code, "ACTION_SPEC_INVALID");
  assert.equal(outcome.error.requestId, REQUEST_ID);
  assert.equal(outcome.error.retryable, false);
  assert.equal(identityCalled, false);
});

test("INVALID: a missing ActionSpec field is refused", async () => {
  const outcome = await pipelineOf().run({
    requestId: REQUEST_ID, actorId: ACTOR, tenantId: TENANT, payload: {},
  });
  assert.equal(outcome.outcome, "INVALID");
  assert.equal(outcome.error.code, "ACTION_SPEC_INVALID");
});

test("CROSS_TENANT_DENY: the authenticated tenant does not match the claimed tenant, short-circuits before PDP", async () => {
  let pdpCalled = false;
  const pipeline = new CreateCustomerPipeline({
    identity: identityAnswering(principalOf(OTHER_TENANT, ACTOR)),
    policyDecisionPoint: new PolicyDecisionPoint({ candidatesFor: () => { pdpCalled = true; return [ALLOW_CANDIDATE]; } }),
    evaluateInvariants: alwaysValidInvariants,
  });

  const outcome = await pipeline.run(validActionSpec());

  assert.equal(outcome.outcome, "CROSS_TENANT_DENY");
  assert.equal(outcome.preparedChangeSet, null);
  assert.equal(outcome.error.code, "CROSS_TENANT_DENY");
  assert.equal(pdpCalled, false);
});

test("DENY: the authenticated actor does not match the claimed actor within the same tenant", async () => {
  const pipeline = pipelineOf({ principal: principalOf(TENANT, OTHER_ACTOR) });
  const outcome = await pipeline.run(validActionSpec());

  assert.equal(outcome.outcome, "DENY");
  assert.equal(outcome.error.code, "IDENTITY_MISMATCH");
  assert.equal(outcome.preparedChangeSet, null);
});

test("DENY: a policy deny short-circuits before the invariant collaborator is reached", async () => {
  let invariantsCalled = false;
  const pipeline = pipelineOf({
    candidates: [DENY_CANDIDATE],
    evaluateInvariants: () => { invariantsCalled = true; return { ok: true }; },
  });

  const outcome = await pipeline.run(validActionSpec());

  assert.equal(outcome.outcome, "DENY");
  assert.equal(outcome.error.code, "POLICY_DENY");
  assert.equal(outcome.preparedChangeSet, null);
  assert.equal(invariantsCalled, false);
});

test("INVALID: the injected invariant collaborator refuses the action", async () => {
  const pipeline = pipelineOf({ evaluateInvariants: () => ({ ok: false }) });
  const outcome = await pipeline.run(validActionSpec());

  assert.equal(outcome.outcome, "INVALID");
  assert.equal(outcome.error.code, "INVARIANT_VIOLATION");
  assert.equal(outcome.preparedChangeSet, null);
});

test("the constructor refuses anything but an exact Identity, an exact PolicyDecisionPoint and a function", () => {
  assert.throws(() => new CreateCustomerPipeline({
    identity: {}, policyDecisionPoint: pdpAnswering([ALLOW_CANDIDATE]), evaluateInvariants: alwaysValidInvariants,
  }), TypeError);
  assert.throws(() => new CreateCustomerPipeline({
    identity: identityAnswering(principalOf(TENANT, ACTOR)), policyDecisionPoint: {}, evaluateInvariants: alwaysValidInvariants,
  }), TypeError);
  assert.throws(() => new CreateCustomerPipeline({
    identity: identityAnswering(principalOf(TENANT, ACTOR)), policyDecisionPoint: pdpAnswering([ALLOW_CANDIDATE]), evaluateInvariants: null,
  }), TypeError);
});

test("the pipeline instance is frozen and carries a stable toStringTag", () => {
  const pipeline = pipelineOf();
  assert.ok(Object.isFrozen(pipeline));
  assert.equal(Object.prototype.toString.call(pipeline), "[object CreateCustomerPipeline]");
});
