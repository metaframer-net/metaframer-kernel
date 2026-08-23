import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
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

test("the factory refuses anything but the four required options keys plus the known optional maxBodyBytes key", () => {
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

test("the factory accepts the four required keys plus a valid maxBodyBytes of 0", async () => {
  const composition = createCustomerAsgiComposition(validOptions({ maxBodyBytes: 0 }));
  try {
    assert.ok(Object.isFrozen(composition));
    assert.equal(typeof composition.app, "function");
    assert.equal(typeof composition.close, "function");
  } finally {
    await assert.doesNotReject(() => composition.close());
  }
});

test("the factory refuses an invalid maxBodyBytes at composition creation", () => {
  for (const bad of [-1, 1.5, "10", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, {}]) {
    assert.throws(
      () => createCustomerAsgiComposition(validOptions({ maxBodyBytes: bad })),
      TypeError,
      `expected a refusal for maxBodyBytes ${JSON.stringify(bad)}`,
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

test("composition.app is itself frozen and carries no own enumerable mutation surface", async () => {
  const composition = createCustomerAsgiComposition(validOptions());
  try {
    assert.ok(Object.isFrozen(composition.app), "composition.app must be frozen");
    assert.throws(() => {
      "use strict";
      composition.app.mutated = true;
    }, TypeError);
    assert.equal(composition.app.mutated, undefined);
    assert.deepEqual(
      Object.keys(composition.app),
      [],
      "composition.app must carry no own enumerable keys",
    );
    assert.throws(() => Object.defineProperty(composition.app, "extra", { value: 1 }), TypeError);
    assert.throws(() => Object.setPrototypeOf(composition.app, null), TypeError);
    assert.equal(Reflect.deleteProperty(composition.app, "length"), false);
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

test("app rejects an over-limit body with the existing deterministic 400 profile response and never reaches the commit path", async () => {
  const composition = createCustomerAsgiComposition(
    validOptions({
      maxBodyBytes: 5,
      current: async () => {
        throw new Error("the application pipeline must not be reached for an over-limit body");
      },
    }),
  );
  try {
    const { events, send } = collectingSend();
    const overLimitBytes = new TextEncoder().encode(JSON.stringify({ name: "Ada Lovelace" }));
    assert.ok(overLimitBytes.length > 5, "fixture body must exceed the 5-byte limit");
    const result = await composition.app(scopeOf("POST", "/customers"), receiveOnce(overLimitBytes), send);

    assert.equal(events.length, 2);
    assert.equal(events[0].type, "http.response.start");
    assert.equal(events[0].status, 400);
    const decoded = JSON.parse(new TextDecoder().decode(events[1].body));
    assert.equal(decoded.error.code, "PROFILE_SCOPE_INVALID");
    assert.deepEqual(result, events);
  } finally {
    await composition.close();
  }
});

test("app still routes an exact-boundary body through the normal route path", async () => {
  const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
  let capturedName;
  const boundaryBytes = new TextEncoder().encode(JSON.stringify({ name: "Ada" }));
  const composition = createCustomerAsgiComposition(
    validOptions({
      maxBodyBytes: boundaryBytes.length,
      candidatesFor: async () => [ALLOW_CANDIDATE],
      evaluateInvariants: async (command) => {
        capturedName = command.payload.name;
        return { ok: false };
      },
    }),
  );
  try {
    const { events, send } = collectingSend();
    await composition.app(scopeOf("POST", "/customers"), receiveOnce(boundaryBytes), send);

    assert.equal(capturedName, "Ada");
    assert.equal(events[0].status, 400);
    const decoded = JSON.parse(new TextDecoder().decode(events[1].body));
    assert.equal(decoded.error.code, "INVARIANT_VIOLATION");
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

// =====================================================================================
// GJ-01 V14K — real PostgreSQL slice through the ASGI callable.
//
// Proves createCustomerAsgiComposition.app(scope, receive, send) carries an ALLOW_CANDIDATE +
// invariants-ok POST /customers request all the way to a real PostgreSQL 16 container: 201,
// a frozen CommitReceipt with all four intents committed, and rows actually persisted in
// customer_records, audit_log and transactional_outbox for the same tenant. Reuses the
// Docker/Postgres/migration helper shape from tests/postgres-commit-adapter.test.mjs. No
// server, no HTTP framework — only the existing framework-neutral ASGI callable.
// =====================================================================================

const IMAGE = "postgres:16-alpine";
const SUPERUSER_PASSWORD = crypto.randomUUID();
const MIGRATION_PASSWORD = crypto.randomUUID();
const RUNTIME_PASSWORD = crypto.randomUUID();
const MIGRATION_ROLE = "mfk_migration";
const RUNTIME_ROLE = "mfk_runtime";
const DATABASE = "mfk_v14k_asgi_slice";

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  return result.status === 0;
}

function startContainer() {
  const name = `mfk-v14k-asgi-slice-${crypto.randomBytes(6).toString("hex")}`;
  execFileSync("docker", [
    "run", "-d", "--rm",
    "--name", name,
    "-e", `POSTGRES_PASSWORD=${SUPERUSER_PASSWORD}`,
    "-p", "127.0.0.1::5432",
    IMAGE,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return name;
}

function publishedPort(name) {
  const mapping = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim();
  const line = mapping.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("["));
  return Number(line.split(":").at(-1));
}

function waitReady(name, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const result = spawnSync("docker", [
      "exec", name, "pg_isready", "--quiet", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres",
    ], { timeout: 5000 });
    if (result.status === 0) return;
  }
  throw new Error(`${name} did not become ready in time`);
}

function stopContainer(name) {
  spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" });
}

async function withPg(host, port, user, password, database, fn) {
  const pgModule = await import("pg");
  const { Client } = pgModule.default ?? pgModule;
  const client = new Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function runMigration(host, port) {
  const url = `postgresql+psycopg://${MIGRATION_ROLE}:${MIGRATION_PASSWORD}@${host}:${port}/${DATABASE}`;
  const code = [
    "from metaframer_kernel_db.migrations import alembic_config",
    "from alembic import command",
    `command.upgrade(alembic_config(${JSON.stringify(url)}, runtime_role=${JSON.stringify(RUNTIME_ROLE)}), 'head')`,
  ].join("\n");
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", code], {
    cwd: path.join(root, "db"),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`alembic upgrade failed:\n${result.stdout}\n${result.stderr}`);
  }
}

test("createCustomerAsgiComposition.app carries an ALLOW+invariants-ok POST /customers request to a real PostgreSQL 16 commit", async (t) => {
  if (!dockerAvailable()) {
    throw new Error(
      "docker is not available in this environment: this is an environment failure, not an " +
        "ASGI composition capability gap, and must be reported separately",
    );
  }

  const container = startContainer();
  t.after(() => stopContainer(container));
  waitReady(container, 60000);
  const port = publishedPort(container);
  const host = "127.0.0.1";

  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, "postgres", async (client) => {
    await client.query(
      `CREATE ROLE ${MIGRATION_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN PASSWORD '${MIGRATION_PASSWORD}'`,
    );
    await client.query(
      `CREATE ROLE ${RUNTIME_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT LOGIN PASSWORD '${RUNTIME_PASSWORD}'`,
    );
    await client.query(`CREATE DATABASE ${DATABASE} OWNER ${MIGRATION_ROLE}`);
    await client.query(`REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${RUNTIME_ROLE}`);
  });
  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
    await client.query(`ALTER SCHEMA public OWNER TO ${MIGRATION_ROLE}`);
    await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await client.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${RUNTIME_ROLE}`);
  });

  runMigration(host, port);

  const connectionString = `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(RUNTIME_PASSWORD)}@${host}:${port}/${DATABASE}`;
  const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
  const tenantId = crypto.randomUUID();
  const actorId = "actor-real-pg";
  const requestId = crypto.randomUUID();

  const composition = createCustomerAsgiComposition({
    connectionString,
    current: async () => principalOf(tenantId, actorId),
    candidatesFor: async () => [ALLOW_CANDIDATE],
    evaluateInvariants: async () => ({ ok: true }),
  });

  try {
    const { events, send } = collectingSend();
    const scope = {
      type: "http",
      method: "POST",
      path: "/customers",
      headers: [
        ["content-type", "application/json"],
        ["x-request-id", requestId],
        ["x-actor-id", actorId],
        ["x-tenant-id", tenantId],
        ["idempotency-key", `idem-${requestId}`],
      ],
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ name: "Ada Lovelace" }));
    const result = await composition.app(scope, receiveOnce(jsonBytes), send);

    assert.equal(events.length, 2);
    const [start, responseBody] = events;
    assert.equal(start.type, "http.response.start");
    assert.equal(start.status, 201);
    for (const [name, value] of start.headers) {
      assert.ok(name instanceof Uint8Array);
      assert.ok(value instanceof Uint8Array);
    }
    assert.ok(responseBody.body instanceof Uint8Array);

    const decoded = JSON.parse(new TextDecoder().decode(responseBody.body));
    const receipt = decoded.commitReceipt;
    assert.equal(receipt.receiptType, "CommitReceipt");
    assert.deepEqual([...receipt.committedIntents].sort(), ["audit", "customer", "idempotency", "transactionalOutbox"]);
    assert.deepEqual(receipt.deferredIntents, []);
    assert.equal(typeof receipt.customerRecordId, "string");
    assert.equal(typeof receipt.auditLogId, "string");
    assert.equal(typeof receipt.outboxId, "string");
    assert.deepEqual(result, events);

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customer = await client.query(
        "SELECT tenant_id, name FROM customer_records WHERE id = $1",
        [receipt.customerRecordId],
      );
      assert.equal(customer.rows.length, 1);
      assert.equal(customer.rows[0].tenant_id, tenantId);
      assert.equal(customer.rows[0].name, "Ada Lovelace");

      const audit = await client.query(
        "SELECT tenant_id, event_type FROM audit_log WHERE id = $1",
        [receipt.auditLogId],
      );
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].tenant_id, tenantId);
      assert.equal(audit.rows[0].event_type, "customer.create");

      const outbox = await client.query(
        "SELECT tenant_id, event_type FROM transactional_outbox WHERE id = $1",
        [receipt.outboxId],
      );
      assert.equal(outbox.rows.length, 1);
      assert.equal(outbox.rows[0].tenant_id, tenantId);
      assert.equal(outbox.rows[0].event_type, "customer.created");
    });

    // GJ-01 V14L: a second, identical request (same tenant, same idempotency fingerprint) must
    // surface as a deterministic delivery 409 IDEMPOTENCY_CONFLICT — never a leaked raw
    // PostgreSQL error, and never a second customer/audit/outbox row.
    const { events: retryEvents, send: retrySend } = collectingSend();
    const retryResult = await composition.app(scope, receiveOnce(jsonBytes), retrySend);

    assert.equal(retryEvents.length, 2);
    const [retryStart, retryBody] = retryEvents;
    assert.equal(retryStart.type, "http.response.start");
    assert.equal(retryStart.status, 409);
    const retryDecoded = JSON.parse(new TextDecoder().decode(retryBody.body));
    assert.equal(retryDecoded.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(retryDecoded.error.requestId, requestId);
    assert.equal(retryDecoded.error.retryable, false);
    assert.deepEqual(retryResult, retryEvents);

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customerCount = await client.query("SELECT count(*) FROM customer_records WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(customerCount.rows[0].count), 1, "the duplicate request must not insert a second customer row");
      const auditCount = await client.query("SELECT count(*) FROM audit_log WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(auditCount.rows[0].count), 1, "the duplicate request must not insert a second audit row");
      const outboxCount = await client.query("SELECT count(*) FROM transactional_outbox WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(outboxCount.rows[0].count), 1, "the duplicate request must not enqueue a second outbox row");
    });
  } finally {
    await composition.close();
  }
});
