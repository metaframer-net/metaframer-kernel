import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CreateCustomerRequestHandler } from "../src/delivery/create-customer-request-handler.mjs";
import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { CreateCustomerCommitService } from "../src/application/create-customer-commit-service.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handlerPath = "src/delivery/create-customer-request-handler.mjs";

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

function serviceOf({ candidates, commit } = {}) {
  return new CreateCustomerCommitService({
    pipeline: pipelineOf({ candidates }),
    commit: commit ?? (async () => FAKE_RECEIPT),
  });
}

function validRequest(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    actorId: ACTOR,
    tenantId: TENANT,
    payload: { name: "Ada Lovelace" },
    idempotencyKey: "order-42",
    ...overrides,
  };
}

test("the constructor refuses anything but an exact { service } CreateCustomerCommitService instance", () => {
  assert.throws(() => new CreateCustomerRequestHandler({ service: {} }), TypeError);
  assert.throws(() => new CreateCustomerRequestHandler({ service: serviceOf(), extra: 1 }), TypeError);
  assert.throws(() => new CreateCustomerRequestHandler({}), TypeError);
  assert.throws(() => new CreateCustomerRequestHandler(), TypeError);
  assert.throws(() => new CreateCustomerRequestHandler(null), TypeError);
  assert.throws(() => new CreateCustomerRequestHandler("service"), TypeError);
});

test("handler instance and class are frozen, and the prototype identity check is not instanceof", () => {
  const handler = new CreateCustomerRequestHandler({ service: serviceOf() });
  assert.ok(Object.isFrozen(handler));
  assert.ok(Object.isFrozen(CreateCustomerRequestHandler));
  assert.ok(Object.isFrozen(CreateCustomerRequestHandler.prototype));
  assert.equal(Object.prototype.toString.call(handler), "[object CreateCustomerRequestHandler]");

  class FakeService extends CreateCustomerCommitService {}
  const fake = Object.create(FakeService.prototype);
  assert.throws(() => new CreateCustomerRequestHandler({ service: fake }), TypeError, "a subclass instance is not the exact prototype and must be refused");
});

test("an invalid request maps to a frozen 400 without ever calling the service", async () => {
  let called = 0;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { called += 1; return FAKE_RECEIPT; },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  const response = await handler.handle(validRequest({ tenantId: 123 }));

  assert.equal(response.status, 400);
  assert.equal(response.outcome, "INVALID");
  assert.equal(response.requestId, REQUEST_ID);
  assert.equal(response.body.error.code, "ACTION_SPEC_INVALID");
  assert.equal(response.body.error.requestId, REQUEST_ID);
  assert.equal(response.body.error.retryable, false);
  assert.equal(called, 0, "the service must never be called for a request that fails ActionSpec construction");
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.body));
  assert.ok(Object.isFrozen(response.body.error));
});

test("an invalid request with a non-string requestId maps to 400 with requestId \"\"", async () => {
  const handler = new CreateCustomerRequestHandler({ service: serviceOf() });
  const response = await handler.handle(validRequest({ requestId: 42 }));
  assert.equal(response.status, 400);
  assert.equal(response.requestId, "");
  assert.equal(response.body.error.requestId, "");
});

test("a request carrying the wrong key set maps to 400 without calling the service", async () => {
  let called = 0;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { called += 1; return FAKE_RECEIPT; },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  const response = await handler.handle({ ...validRequest(), extra: true });

  assert.equal(response.status, 400);
  assert.equal(response.outcome, "INVALID");
  assert.equal(called, 0);
});

test("COMMITTED maps to a frozen 201 and calls the service exactly once with a frozen ActionSpec", async () => {
  let callCount = 0;
  let receivedActionSpec;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => FAKE_RECEIPT,
  });
  const spyingService = new Proxy(service, {
    get(target, prop, receiver) {
      if (prop === "handle") {
        return async (actionSpec) => {
          callCount += 1;
          receivedActionSpec = actionSpec;
          return target.handle(actionSpec);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const handler = new CreateCustomerRequestHandler({ service: spyingService });
  const response = await handler.handle(validRequest());

  assert.equal(callCount, 1);
  assert.ok(Object.isFrozen(receivedActionSpec));
  assert.equal(receivedActionSpec.requestId, REQUEST_ID);

  assert.equal(response.status, 201);
  assert.equal(response.outcome, "COMMITTED");
  assert.equal(response.requestId, REQUEST_ID);
  assert.equal(response.body.commitReceipt, FAKE_RECEIPT);
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.body));
});

test("DENY maps to a frozen 403", async () => {
  const handler = new CreateCustomerRequestHandler({ service: serviceOf({ candidates: [DENY_CANDIDATE] }) });
  const response = await handler.handle(validRequest());

  assert.equal(response.status, 403);
  assert.equal(response.outcome, "DENY");
  assert.equal(response.requestId, REQUEST_ID);
  assert.equal(response.body.error.code, "POLICY_DENY");
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.body));
});

test("CROSS_TENANT_DENY maps to a frozen 403", async () => {
  const handler = new CreateCustomerRequestHandler({
    service: serviceOf(),
  });
  const response = await handler.handle(validRequest({ tenantId: "22222222-2222-4222-8222-222222222222" }));

  assert.equal(response.status, 403);
  assert.equal(response.outcome, "CROSS_TENANT_DENY");
  assert.equal(response.body.error.code, "CROSS_TENANT_DENY");
  assert.ok(Object.isFrozen(response));
});

test("an unknown service outcome throws TypeError", async () => {
  const fakeService = new Proxy(serviceOf(), {
    get(target, prop, receiver) {
      if (prop === "handle") {
        return async () => ({ outcome: "SOMETHING_ELSE", requestId: REQUEST_ID, error: null, commitReceipt: null });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const handler = new CreateCustomerRequestHandler({ service: fakeService });

  await assert.rejects(() => handler.handle(validRequest()), TypeError);
});

test("a duplicate-idempotency commit failure maps to a frozen 409 IDEMPOTENCY_CONFLICT, not a leaked raw error", async () => {
  class IdempotencyConflictError extends Error {
    code = "IDEMPOTENCY_CONFLICT";
    retryable = false;
    constructor() {
      super("duplicate idempotency fingerprint for tenant");
      this.name = "IdempotencyConflictError";
    }
  }
  let called = 0;
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { called += 1; throw new IdempotencyConflictError(); },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  const response = await handler.handle(validRequest());

  assert.equal(called, 1);
  assert.equal(response.status, 409);
  assert.equal(response.outcome, "IDEMPOTENCY_CONFLICT");
  assert.equal(response.requestId, REQUEST_ID);
  assert.equal(response.body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(response.body.error.requestId, REQUEST_ID);
  assert.equal(response.body.error.retryable, false);
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.body));
  assert.ok(Object.isFrozen(response.body.error));
});

test("a generic commit failure (not the known idempotency conflict) propagates unmasked", async () => {
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { throw new Error("connection reset"); },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  await assert.rejects(() => handler.handle(validRequest()), /connection reset/);
});

test("an error with the IDEMPOTENCY_CONFLICT code but the wrong name still propagates unmasked", async () => {
  class SomeOtherError extends Error {
    code = "IDEMPOTENCY_CONFLICT";
  }
  const service = new CreateCustomerCommitService({
    pipeline: pipelineOf(),
    commit: async () => { throw new SomeOtherError("not the real thing"); },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  await assert.rejects(() => handler.handle(validRequest()), SomeOtherError);
});

test("the handler module imports no ambient capability and no framework/runtime dependency", async () => {
  const source = await readFile(path.join(root, handlerPath), "utf8");
  const forbiddenImports = /from\s+["'](node:)?(fs|net|http|https)["']/i;
  assert.doesNotMatch(source, forbiddenImports, `${handlerPath} must not import fs, net or http`);
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${handlerPath} must not call fetch`);
  assert.doesNotMatch(source, /process\.env/, `${handlerPath} must not read process.env`);
  assert.doesNotMatch(source, /Date\.now|Math\.random/, `${handlerPath} must not read an ambient clock or random source`);

  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line))
    .join("\n");
  assert.doesNotMatch(importLines, /postgres/i, `${handlerPath} must not import Postgres`);
  const forbiddenFrameworkImport = /(fastapi|django|uvicorn|hypercorn|asgi)/i;
  assert.doesNotMatch(
    importLines,
    forbiddenFrameworkImport,
    `${handlerPath} import lines must not depend on a framework or ASGI runtime package`,
  );
});
