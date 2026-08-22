import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CreateCustomerHttpMessageAdapter } from "../src/delivery/create-customer-http-message-adapter.mjs";
import { CreateCustomerRequestHandler } from "../src/delivery/create-customer-request-handler.mjs";
import { CreateCustomerPipeline } from "../src/application/create-customer-pipeline.mjs";
import { CreateCustomerCommitService } from "../src/application/create-customer-commit-service.mjs";
import { Identity } from "../src/application/identity.mjs";
import { PolicyDecisionPoint } from "../src/application/policy-decision-point.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterPath = "src/delivery/create-customer-http-message-adapter.mjs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "actor-1";

const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
const DENY_CANDIDATE = Object.freeze({ policyId: "deny.everything", effect: "deny", applies: true });
const FAKE_RECEIPT = Object.freeze({
  receiptType: "CommitReceipt",
  committedIntents: Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]),
  deferredIntents: Object.freeze([]),
  customerRecordId: 1,
  auditLogId: 2,
  outboxId: 3,
});

function handlerOf({ candidates } = {}) {
  const pipeline = new CreateCustomerPipeline({
    identity: new Identity({ current: () => new Principal(new TenantId(TENANT), new ActorId(ACTOR)) }),
    policyDecisionPoint: new PolicyDecisionPoint({ candidatesFor: () => candidates ?? [ALLOW_CANDIDATE] }),
    evaluateInvariants: () => ({ ok: true }),
  });
  const service = new CreateCustomerCommitService({ pipeline, commit: async () => FAKE_RECEIPT });
  return new CreateCustomerRequestHandler({ service });
}

/** A handler proxy that counts `handle` calls and delegates to the real handler, spy identity preserved. */
function spyingHandlerOf(options) {
  const target = handlerOf(options);
  const counter = { calls: 0 };
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "handle") {
        return async (request) => { counter.calls += 1; return t.handle(request); };
      }
      return Reflect.get(t, prop, receiver);
    },
  });
  return { proxy, counter };
}

function validMessage(overrides = {}) {
  return {
    method: "POST",
    path: "/customers",
    headers: {
      "x-request-id": REQUEST_ID,
      "x-actor-id": ACTOR,
      "x-tenant-id": TENANT,
      "idempotency-key": "order-42",
    },
    body: { name: "Ada Lovelace" },
    ...overrides,
  };
}

test("the constructor refuses anything but an exact { handler } CreateCustomerRequestHandler instance", () => {
  assert.throws(() => new CreateCustomerHttpMessageAdapter({ handler: {} }), TypeError);
  assert.throws(() => new CreateCustomerHttpMessageAdapter({ handler: handlerOf(), extra: 1 }), TypeError);
  assert.throws(() => new CreateCustomerHttpMessageAdapter({}), TypeError);
  assert.throws(() => new CreateCustomerHttpMessageAdapter(), TypeError);
  assert.throws(() => new CreateCustomerHttpMessageAdapter(null), TypeError);
  assert.throws(() => new CreateCustomerHttpMessageAdapter("handler"), TypeError);

  class FakeHandler extends CreateCustomerRequestHandler {}
  const fake = Object.create(FakeHandler.prototype);
  assert.throws(() => new CreateCustomerHttpMessageAdapter({ handler: fake }), TypeError, "a subclass instance is not the exact prototype and must be refused");
});

test("adapter instance and class are frozen", () => {
  const adapter = new CreateCustomerHttpMessageAdapter({ handler: handlerOf() });
  assert.ok(Object.isFrozen(adapter));
  assert.ok(Object.isFrozen(CreateCustomerHttpMessageAdapter));
  assert.ok(Object.isFrozen(CreateCustomerHttpMessageAdapter.prototype));
  assert.equal(Object.prototype.toString.call(adapter), "[object CreateCustomerHttpMessageAdapter]");
});

test("a well-formed POST /customers message calls the handler exactly once and maps a 201", async () => {
  const { proxy, counter } = spyingHandlerOf();
  const adapter = new CreateCustomerHttpMessageAdapter({ handler: proxy });
  const response = await adapter.handle(validMessage());

  assert.equal(counter.calls, 1);
  assert.equal(response.status, 201);
  assert.equal(response.headers["content-type"], "application/json");
  assert.equal(response.headers["x-request-id"], REQUEST_ID);
  assert.equal(response.body.commitReceipt.customerRecordId, 1);
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.headers));
  assert.ok(Object.isFrozen(response.body));
});

test("headers are matched case-insensitively", async () => {
  const adapter = new CreateCustomerHttpMessageAdapter({ handler: handlerOf() });
  const response = await adapter.handle(validMessage({
    headers: { "X-Request-Id": REQUEST_ID, "X-Actor-Id": ACTOR, "X-Tenant-Id": TENANT, "Idempotency-Key": "order-42" },
  }));
  assert.equal(response.status, 201);
});

test("DENY maps to a frozen 403 through the adapter", async () => {
  const adapter = new CreateCustomerHttpMessageAdapter({ handler: handlerOf({ candidates: [DENY_CANDIDATE] }) });
  const response = await adapter.handle(validMessage());
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "POLICY_DENY");
  assert.ok(Object.isFrozen(response));
});

test("an invalid ActionSpec maps to a frozen 400 without calling the handler for a non-string field", async () => {
  const response = await new CreateCustomerHttpMessageAdapter({ handler: handlerOf() }).handle(validMessage({ body: null }));
  assert.equal(response.status, 400);
});

test("non-POST, an unknown path and a malformed message shape all short-circuit without ever calling the handler", async () => {
  const { proxy, counter } = spyingHandlerOf();
  const adapter = new CreateCustomerHttpMessageAdapter({ handler: proxy });

  const nonPost = await adapter.handle(validMessage({ method: "GET" }));
  assert.equal(nonPost.status, 405);
  assert.ok(Object.isFrozen(nonPost));

  const unknownPath = await adapter.handle(validMessage({ path: "/other" }));
  assert.equal(unknownPath.status, 404);

  for (const bad of [null, undefined, "POST /customers", 42, [], validMessage({ headers: "bad" })]) {
    const response = await adapter.handle(bad);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }

  assert.equal(counter.calls, 0);
});

test("the adapter module imports no ambient capability and no framework/runtime dependency", async () => {
  const source = await readFile(path.join(root, adapterPath), "utf8");
  assert.doesNotMatch(source, /from\s+["'](node:)?(fs|net|http|https)["']/i, `${adapterPath} must not import fs, net or http`);
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${adapterPath} must not call fetch`);
  assert.doesNotMatch(source, /process\.env/, `${adapterPath} must not read process.env`);
  assert.doesNotMatch(source, /Date\.now|Math\.random/, `${adapterPath} must not read an ambient clock or random source`);

  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
  assert.doesNotMatch(
    importLines,
    /(fastapi|django|uvicorn|hypercorn|asgi)/i,
    `${adapterPath} import lines must not depend on a framework or ASGI runtime package`,
  );
});
