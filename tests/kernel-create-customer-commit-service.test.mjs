import assert from "node:assert/strict";
import test from "node:test";

import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { CreateCustomerCommitService } from "../src/application/create-customer-commit-service.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "actor-1";

function principalOf(tenant, actor) {
  return new Principal(new TenantId(tenant), new ActorId(actor));
}

function identityAnswering(principal) {
  return new Identity({ current: () => principal });
}

function pdpAnswering(candidates) {
  return new PolicyDecisionPoint({ candidatesFor: () => candidates });
}

const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
const DENY_CANDIDATE = Object.freeze({ policyId: "deny.everything", effect: "deny", applies: true });

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

const FAKE_RECEIPT = Object.freeze({
  receiptType: "CommitReceipt",
  committedIntents: Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]),
  deferredIntents: Object.freeze([]),
  customerRecordId: 1,
  auditLogId: 2,
  outboxId: 3,
});

test("the constructor refuses anything but an exact CreateCustomerPipeline instance and a function", () => {
  assert.throws(() => new CreateCustomerCommitService({ pipeline: {}, commit: async () => FAKE_RECEIPT }), TypeError);
  assert.throws(() => new CreateCustomerCommitService({ pipeline: pipelineOf(), commit: {} }), TypeError);
  assert.throws(() => new CreateCustomerCommitService({ pipeline: pipelineOf() }), TypeError);
  assert.throws(() => new CreateCustomerCommitService({ pipeline: pipelineOf(), commit: async () => FAKE_RECEIPT, extra: 1 }), TypeError);
});

test("non-allow outcome: DENY is returned frozen, preserved, with commitReceipt null, and commit is never called", async () => {
  let commitCalled = false;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf({ candidates: [DENY_CANDIDATE] }),
    commit: async () => { commitCalled = true; return FAKE_RECEIPT; },
  });

  const result = await service.handle(validActionSpec());

  assert.equal(result.outcome, "DENY");
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.error.code, "POLICY_DENY");
  assert.equal(result.commitReceipt, null);
  assert.equal(commitCalled, false);
  assert.ok(Object.isFrozen(result));
});

test("non-allow outcome: INVALID is returned frozen, preserved, with commitReceipt null, and commit is never called", async () => {
  let commitCalled = false;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { commitCalled = true; return FAKE_RECEIPT; },
  });

  const result = await service.handle(validActionSpec({ tenantId: "not-a-uuid" }));

  assert.equal(result.outcome, "INVALID");
  assert.equal(result.error.code, "ACTION_SPEC_INVALID");
  assert.equal(result.commitReceipt, null);
  assert.equal(commitCalled, false);
  assert.ok(Object.isFrozen(result));
});

test("ALLOW_COMMIT: commit is called exactly once with preparedChangeSet and a fresh frozen ordinary context carrying exactly requestId, tenantId, idempotencyKey", async () => {
  let callCount = 0;
  let receivedChangeSet;
  let receivedContext;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async (preparedChangeSet, context) => {
      callCount += 1;
      receivedChangeSet = preparedChangeSet;
      receivedContext = context;
      return FAKE_RECEIPT;
    },
  });

  const result = await service.handle(validActionSpec());

  assert.equal(callCount, 1);
  assert.equal(receivedChangeSet.persistenceState, "pending");
  assert.equal(Object.getPrototypeOf(receivedContext), Object.prototype);
  assert.ok(Object.isFrozen(receivedContext));
  assert.deepEqual(Object.keys(receivedContext).sort(), ["idempotencyKey", "requestId", "tenantId"]);
  assert.deepEqual(receivedContext, {
    requestId: REQUEST_ID,
    tenantId: TENANT,
    idempotencyKey: "order-42",
  });

  assert.equal(result.outcome, "COMMITTED");
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.error, null);
  assert.equal(result.preparedChangeSet, null);
  assert.equal(result.commitReceipt, FAKE_RECEIPT);
  assert.ok(Object.isFrozen(result));
});

test("ALLOW_COMMIT: two allowed requests do not share or leak context objects", async () => {
  const receivedContexts = [];
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async (preparedChangeSet, context) => {
      receivedContexts.push(context);
      return FAKE_RECEIPT;
    },
  });

  const REQUEST_ID_2 = "44444444-4444-4444-8444-444444444444";
  await service.handle(validActionSpec());
  await service.handle(validActionSpec({ requestId: REQUEST_ID_2, idempotencyKey: "order-43" }));

  assert.equal(receivedContexts.length, 2);
  assert.notEqual(receivedContexts[0], receivedContexts[1]);
  assert.equal(receivedContexts[0].requestId, REQUEST_ID);
  assert.equal(receivedContexts[0].idempotencyKey, "order-42");
  assert.equal(receivedContexts[1].requestId, REQUEST_ID_2);
  assert.equal(receivedContexts[1].idempotencyKey, "order-43");
});

test("ALLOW_COMMIT: exact receipt identity passes through unchanged and the public COMMITTED result shape stays unchanged", async () => {
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => FAKE_RECEIPT,
  });

  const result = await service.handle(validActionSpec());

  assert.equal(result.commitReceipt, FAKE_RECEIPT);
  assert.deepEqual(Object.keys(result).sort(), ["commitReceipt", "error", "outcome", "preparedChangeSet", "requestId"]);
});

test("service instance is frozen and carries a stable toStringTag", () => {
  const service = new CreateCustomerCommitService({ pipeline: pipelineOf(), commit: async () => FAKE_RECEIPT });
  assert.ok(Object.isFrozen(service));
  assert.equal(Object.prototype.toString.call(service), "[object CreateCustomerCommitService]");
});
