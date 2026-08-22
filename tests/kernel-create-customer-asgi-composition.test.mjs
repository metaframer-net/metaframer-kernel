import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCustomerAsgiComposition } from "../src/delivery/create-customer-asgi-composition.mjs";
import { AsgiCoreProfileAdapter } from "../src/delivery/asgi-core-profile.mjs";
import { StandardRouter } from "../src/delivery/standard-router.mjs";
import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compositionPath = "src/delivery/create-customer-asgi-composition.mjs";

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

function scopeOf(method, path, extraHeaders = []) {
  return {
    type: "http",
    method,
    path,
    headers: [
      ["content-type", "application/json"],
      ["x-request-id", REQUEST_ID],
      ["x-actor-id", ACTOR],
      ["x-tenant-id", TENANT],
      ["idempotency-key", "order-42"],
      ...extraHeaders,
    ],
  };
}

function collectingSend() {
  const events = [];
  const send = async (event) => {
    events.push(event);
  };
  return { events, send };
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
    assert.throws(
      () => createCustomerAsgiComposition(bad),
      TypeError,
      `expected a refusal for ${JSON.stringify(bad)}`,
    );
  }
});

test("the result is frozen and carries exactly { asgi, router, app, close }", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    assert.ok(Object.isFrozen(composition));
    assert.deepEqual(Reflect.ownKeys(composition).sort(), ["app", "asgi", "close", "router"]);
    assert.ok(Object.getPrototypeOf(composition.asgi) === AsgiCoreProfileAdapter.prototype);
    assert.ok(Object.getPrototypeOf(composition.router) === StandardRouter.prototype);
    assert.equal(typeof composition.app, "function");
    assert.equal(typeof composition.close, "function");
  } finally {
    await composition.close();
  }
});

function receiveOnce(body) {
  let called = false;
  return async () => {
    if (called) throw new Error("receive should only be called once for a single-chunk body");
    called = true;
    return { type: "http.request", body, more_body: false };
  };
}

test("app(scope, receive, send) decodes a JSON body and delivers it to the invariant stage of the application pipeline", async () => {
  const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
  let capturedName;
  const composition = createCustomerAsgiComposition(
    validOptions({
      candidatesFor: async () => [ALLOW_CANDIDATE],
      evaluateInvariants: async (command) => {
        capturedName = command.payload.name;
        assert.equal(command.payload.name, "Ada Lovelace");
        return { ok: false };
      },
    }),
  );
  try {
    const { events, send } = collectingSend();
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ name: "Ada Lovelace" }));
    const result = await composition.app(scopeOf("POST", "/customers"), receiveOnce(jsonBytes), send);

    assert.equal(capturedName, "Ada Lovelace");
    assert.equal(events.length, 2);
    const [start, responseBody] = events;
    assert.equal(start.type, "http.response.start");
    assert.equal(start.status, 400);
    assert.ok(responseBody.body instanceof Uint8Array);
    const decoded = JSON.parse(new TextDecoder().decode(responseBody.body));
    assert.equal(decoded.error.code, "INVARIANT_VIOLATION");
    assert.deepEqual(result, events);
  } finally {
    await composition.close();
  }
});

test("app treats an empty body as the accepted empty-body shape", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    const { events, send } = collectingSend();
    await composition.app(scopeOf("POST", "/customers"), receiveOnce(new Uint8Array()), send);
    assert.equal(events[0].status, 403);
    assert.equal(events[0].type, "http.response.start");
  } finally {
    await composition.close();
  }
});

test("app(scope, receive, send) response start headers are Uint8Array pairs decoding to content-type", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    const { events, send } = collectingSend();
    await composition.app(scopeOf("POST", "/customers"), receiveOnce(new Uint8Array()), send);
    const [start] = events;
    assert.equal(start.type, "http.response.start");
    for (const [name, value] of start.headers) {
      assert.ok(name instanceof Uint8Array);
      assert.ok(value instanceof Uint8Array);
    }
    const decoded = start.headers.map(([n, v]) => [new TextDecoder().decode(n), new TextDecoder().decode(v)]);
    assert.deepEqual(decoded.find(([name]) => name === "content-type"), ["content-type", "application/json"]);
  } finally {
    await composition.close();
  }
});

test("app returns the deterministic 400 profile response for invalid JSON without calling the pipeline", async () => {
  const composition = createCustomerAsgiComposition(
    validOptions({
      current: async () => {
        throw new Error("the application pipeline must not be reached for invalid JSON");
      },
    }),
  );
  try {
    const { events, send } = collectingSend();
    const badBytes = new TextEncoder().encode("{not json");
    const result = await composition.app(scopeOf("POST", "/customers"), receiveOnce(badBytes), send);

    assert.equal(events.length, 2);
    assert.equal(events[0].type, "http.response.start");
    assert.equal(events[0].status, 400);
    for (const [name, value] of events[0].headers) {
      assert.ok(name instanceof Uint8Array);
      assert.ok(value instanceof Uint8Array);
    }
    assert.ok(events[1].body instanceof Uint8Array);
    const decoded = JSON.parse(new TextDecoder().decode(events[1].body));
    assert.equal(decoded.error.code, "PROFILE_SCOPE_INVALID");
    assert.deepEqual(result, events);
  } finally {
    await composition.close();
  }
});

test("a DENY outcome traverses POST /customers through asgi.call without touching the database", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    const { events, send } = collectingSend();
    const body = { name: "Ada Lovelace" };
    const result = await composition.asgi.call({ scope: scopeOf("POST", "/customers"), body, send });

    assert.equal(events.length, 2);
    const [start, responseBody] = events;
    assert.equal(start.type, "http.response.start");
    assert.equal(start.status, 403);
    assert.equal(responseBody.type, "http.response.body");
    assert.equal(responseBody.body.error.code, "POLICY_DENY");
    assert.deepEqual(result, events);
  } finally {
    await composition.close();
  }
});

test("a wrong method or path short-circuits before the handler ever runs", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    const wrongMethod = collectingSend();
    await composition.asgi.call({ scope: scopeOf("GET", "/customers"), body: {}, send: wrongMethod.send });
    assert.equal(wrongMethod.events[0].status, 405);

    const wrongPath = collectingSend();
    await composition.asgi.call({ scope: scopeOf("POST", "/nope"), body: {}, send: wrongPath.send });
    assert.equal(wrongPath.events[0].status, 404);
  } finally {
    await composition.close();
  }
});

test("close delegates to the composed PostgresCommitAdapter close", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  await assert.doesNotReject(() => composition.close());
});

test("the ASGI composition module imports no ambient capability and no framework/server/runtime dependency", async () => {
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
  const forbiddenFrameworkImport = /(fastapi|django|uvicorn|hypercorn|express|koa)/i;
  assert.doesNotMatch(
    importLines,
    forbiddenFrameworkImport,
    `${compositionPath} import lines must not depend on a framework or server runtime package`,
  );
  const bareSpecifiers = [...importLines.matchAll(/from\s+["']([^"'.][^"']*)["']/g)].map((m) => m[1]);
  const nonNodeBareSpecifiers = bareSpecifiers.filter((specifier) => !specifier.startsWith("node:"));
  assert.deepEqual(
    nonNodeBareSpecifiers,
    [],
    `${compositionPath} must import only relative modules and node: builtins`,
  );
});
