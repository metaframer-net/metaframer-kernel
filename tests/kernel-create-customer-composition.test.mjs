import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCustomerComposition } from "../src/delivery/create-customer-composition.mjs";
import { CreateCustomerRequestHandler } from "../src/delivery/create-customer-request-handler.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compositionPath = "src/delivery/create-customer-composition.mjs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "actor-1";

function principalOf(tenant, actor) {
  return new Principal(new TenantId(tenant), new ActorId(actor));
}

const DENY_CANDIDATE = Object.freeze({ policyId: "deny.everything", effect: "deny", applies: true });

function validOptions(overrides = {}) {
  return {
    connectionString: "postgres://user:pass@localhost:5432/never_connected",
    current: async () => principalOf(TENANT, ACTOR),
    candidatesFor: async () => [DENY_CANDIDATE],
    evaluateInvariants: async () => ({ ok: true }),
    ...overrides,
  };
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

test("the factory refuses anything but exactly the four-key options object", () => {
  for (const bad of [
    undefined,
    null,
    "connectionString",
    {},
    { ...validOptions(), extra: 1 },
    (() => { const { connectionString, ...rest } = validOptions(); return rest; })(),
    { ...validOptions(), connectionString: "" },
    { ...validOptions(), connectionString: 1 },
    { ...validOptions(), current: "not a function" },
    { ...validOptions(), candidatesFor: "not a function" },
    { ...validOptions(), evaluateInvariants: "not a function" },
  ]) {
    assert.throws(() => createCustomerComposition(bad), TypeError, `expected a refusal for ${JSON.stringify(bad)}`);
  }
});

test("the result is frozen and carries exactly { handler, close }", async () => {
  const composition = createCustomerComposition(validOptions());
  try {
    assert.ok(Object.isFrozen(composition));
    assert.deepEqual(Reflect.ownKeys(composition).sort(), ["close", "handler"]);
    assert.ok(Object.getPrototypeOf(composition.handler) === CreateCustomerRequestHandler.prototype);
    assert.equal(typeof composition.close, "function");
  } finally {
    await composition.close();
  }
});

test("a DENY outcome maps to 403 without ever touching the database, and close tears the adapter down", async () => {
  const composition = createCustomerComposition(validOptions());
  const response = await composition.handler.handle(validRequest());

  assert.equal(response.status, 403);
  assert.equal(response.outcome, "DENY");
  assert.equal(response.body.error.code, "POLICY_DENY");

  await composition.close();
});

test("the composition module imports no ambient capability and no framework/server/runtime dependency", async () => {
  const source = await readFile(path.join(root, compositionPath), "utf8");
  const forbiddenImports = /from\s+["'](node:)?(fs|net|http|https)["']/i;
  assert.doesNotMatch(source, forbiddenImports, `${compositionPath} must not import fs, net or http`);
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${compositionPath} must not call fetch`);
  assert.doesNotMatch(source, /process\.env/, `${compositionPath} must not read process.env`);
  assert.doesNotMatch(source, /Date\.now|Math\.random/, `${compositionPath} must not read an ambient clock or random source`);

  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line))
    .join("\n");
  const forbiddenFrameworkImport = /(fastapi|django|uvicorn|hypercorn|asgi|express|koa)/i;
  assert.doesNotMatch(
    importLines,
    forbiddenFrameworkImport,
    `${compositionPath} import lines must not depend on a framework or ASGI/server runtime package`,
  );
});
