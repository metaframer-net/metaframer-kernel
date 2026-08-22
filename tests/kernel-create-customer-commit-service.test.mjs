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

test("ALLOW_COMMIT: commit is called exactly once with preparedChangeSet and tenantId, and result is COMMITTED", async () => {
  let callCount = 0;
  let receivedChangeSet;
  let receivedOptions;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async (preparedChangeSet, options) => {
      callCount += 1;
      receivedChangeSet = preparedChangeSet;
      receivedOptions = options;
      return FAKE_RECEIPT;
    },
  });

  const result = await service.handle(validActionSpec());

  assert.equal(callCount, 1);
  assert.equal(receivedChangeSet.persistenceState, "pending");
  assert.deepEqual(receivedOptions, { tenantId: TENANT });

  assert.equal(result.outcome, "COMMITTED");
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.error, null);
  assert.equal(result.preparedChangeSet, null);
  assert.equal(result.commitReceipt, FAKE_RECEIPT);
  assert.ok(Object.isFrozen(result));
});

test("service instance is frozen and carries a stable toStringTag", () => {
  const service = new CreateCustomerCommitService({ pipeline: pipelineOf(), commit: async () => FAKE_RECEIPT });
  assert.ok(Object.isFrozen(service));
  assert.equal(Object.prototype.toString.call(service), "[object CreateCustomerCommitService]");
});
