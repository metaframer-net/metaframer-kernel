import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// PostgresUnitOfWork + PostgresWrite (WriteEnvelope composition) — targeted RED/GREEN for P05c.
//
// Proves createPostgresUnitOfWork() yields a lazy, frozen {port, close} resource whose port is
// accepted by fresh application UnitOfWork instances, and that composing createPostgresWrite()
// with a real UnitOfWork inside a WriteEnvelope commits all four intents atomically against a
// REAL PostgreSQL 16 container, never a mock or in-memory substrate. One container is reused
// across the DB-backed scenarios below.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uowPath = "src/adapters/postgres-unit-of-work.mjs";
const writePath = "src/adapters/postgres-write-envelope-write.mjs";
const uowModulePath = "src/application/unit-of-work.mjs";
const writeEnvelopeModulePath = "src/application/write-envelope.mjs";
const commitReceiptModulePath = "src/application/commit-receipt.mjs";

const IMAGE = "postgres:16-alpine";
const SUPERUSER_PASSWORD = crypto.randomUUID();
const MIGRATION_PASSWORD = crypto.randomUUID();
const RUNTIME_PASSWORD = crypto.randomUUID();
const MIGRATION_ROLE = "mfk_migration";
const RUNTIME_ROLE = "mfk_runtime";
const DATABASE = "mfk_p05c_uow";

function dockerAvailable() {
  return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
}

function startContainer() {
  const name = `mfk-p05c-uow-${crypto.randomBytes(6).toString("hex")}`;
  execFileSync("docker", [
    "run", "-d", "--rm", "--name", name,
    "-e", `POSTGRES_PASSWORD=${SUPERUSER_PASSWORD}`,
    "-p", "127.0.0.1::5432", IMAGE,
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
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", code], { cwd: path.join(root, "db"), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`alembic upgrade failed:\n${result.stdout}\n${result.stderr}`);
}

function validIntentsForTenant(tenantId) {
  const correlationId = crypto.randomUUID();
  return {
    customer: { type: "customer.create", tenantId, payload: { name: "Ada" } },
    audit: { type: "audit.append", tenantId, actorId: "actor-1", action: "customer.create", correlationId },
    transactionalOutbox: { type: "outbox.enqueue", eventName: "customer.created", tenantId, correlationId },
    idempotency: { type: "idempotency.record", tenantId, fingerprint: `fp-${correlationId}`, correlationId },
  };
}

// Shared substrate: one Docker PostgreSQL 16 container, migrated once, reused by every
// DB-backed scenario in this file via node:test's before/after hooks.
let container;
let host;
let port;
let connectionString;

test.before(async () => {
  if (!dockerAvailable()) throw new Error("docker is not available in this environment: environment failure, not a capability gap");
  container = startContainer();
  waitReady(container, 60000);
  port = publishedPort(container);
  host = "127.0.0.1";

  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, "postgres", async (client) => {
    await client.query(`CREATE ROLE ${MIGRATION_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN PASSWORD '${MIGRATION_PASSWORD}'`);
    await client.query(`CREATE ROLE ${RUNTIME_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT LOGIN PASSWORD '${RUNTIME_PASSWORD}'`);
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
  connectionString = `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(RUNTIME_PASSWORD)}@${host}:${port}/${DATABASE}`;
});

test.after(() => {
  if (container) stopContainer(container);
});

test("createPostgresUnitOfWork is lazy and its port drives fresh, concurrently usable UnitOfWork instances", async () => {
  const { createPostgresUnitOfWork } = await import(pathToFileURL(path.join(root, uowPath)).href);
  const { UnitOfWork } = await import(pathToFileURL(path.join(root, uowModulePath)).href);

  const resource = createPostgresUnitOfWork({ connectionString });
  assert.ok(Object.isFrozen(resource));
  assert.deepEqual(Reflect.ownKeys(resource).sort(), ["close", "port"]);
  assert.equal(typeof resource.close, "function");
  const p = resource.port;
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(p).sort(), ["begin", "commit", "rollback"]);

  const uowA = new UnitOfWork(resource.port);
  const uowB = new UnitOfWork(resource.port);
  const [resultA, resultB] = await Promise.all([
    uowA.run(async () => "A-done"),
    uowB.run(async () => "B-done"),
  ]);
  assert.equal(resultA, "A-done");
  assert.equal(resultB, "B-done");

  await resource.close();
});

test("WriteEnvelope composed with createPostgresWrite over a real UnitOfWork commits all four intents in one tenant transaction and returns a canonical CommitReceipt", async () => {
  const { createPostgresUnitOfWork } = await import(pathToFileURL(path.join(root, uowPath)).href);
  const { createPostgresWrite } = await import(pathToFileURL(path.join(root, writePath)).href);
  const { UnitOfWork } = await import(pathToFileURL(path.join(root, uowModulePath)).href);
  const { WriteEnvelope } = await import(pathToFileURL(path.join(root, writeEnvelopeModulePath)).href);
  const { CommitReceipt } = await import(pathToFileURL(path.join(root, commitReceiptModulePath)).href);

  const resource = createPostgresUnitOfWork({ connectionString });
  try {
    const tenantId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const preparedChangeSet = Object.freeze({ persistenceState: "pending", intents: Object.freeze(validIntentsForTenant(tenantId)) });

    const write = createPostgresWrite({ requestId, idempotencyKey });
    const envelope = new WriteEnvelope({ unitOfWork: new UnitOfWork(resource.port), write });
    const receipt = await envelope.commit(preparedChangeSet);

    assert.equal(Object.getPrototypeOf(receipt), CommitReceipt.prototype);
    assert.ok(Object.isFrozen(receipt));
    assert.equal(receipt.requestId, requestId);
    assert.equal(receipt.tenantId, tenantId);
    assert.equal(typeof receipt.resourceId, "string");
    assert.equal(receipt.outcome, "COMMITTED");
    assert.match(receipt.committedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(typeof receipt.auditId, "string");
    assert.equal(receipt.outboxEventIds.length, 1);
    assert.equal(receipt.idempotencyKey, idempotencyKey);

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customer = await client.query("SELECT tenant_id, recorded_at FROM customer_records WHERE id = $1", [receipt.resourceId]);
      assert.equal(customer.rows.length, 1);
      assert.equal(customer.rows[0].tenant_id, tenantId);
      assert.equal(receipt.committedAt, customer.rows[0].recorded_at.toISOString());
      const audit = await client.query("SELECT tenant_id FROM audit_log WHERE id = $1", [receipt.auditId]);
      assert.equal(audit.rows.length, 1);
      const outbox = await client.query("SELECT tenant_id FROM transactional_outbox WHERE id = $1", [receipt.outboxEventIds[0]]);
      assert.equal(outbox.rows.length, 1);
    });
  } finally {
    await resource.close();
  }
});

test("a write/body failure inside the real UnitOfWork rolls back, preserves the thrown object by identity, and leaves no partial rows", async () => {
  const { createPostgresUnitOfWork } = await import(pathToFileURL(path.join(root, uowPath)).href);
  const { UnitOfWork } = await import(pathToFileURL(path.join(root, uowModulePath)).href);

  const resource = createPostgresUnitOfWork({ connectionString });
  try {
    const tenantId = crypto.randomUUID();
    const uow = new UnitOfWork(resource.port);
    const marker = new Error("body failure marker");

    await assert.rejects(
      () => uow.run(async (scope) => {
        await scope.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantId]);
        await scope.query(
          "INSERT INTO customer_records (tenant_id, name, payload) VALUES ($1, $2, $3)",
          [tenantId, "Ada", JSON.stringify({ name: "Ada" })],
        );
        throw marker;
      }),
      (error) => {
        assert.equal(error, marker);
        return true;
      },
    );

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customer = await client.query("SELECT count(*) FROM customer_records WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(customer.rows[0].count), 0, "the rolled-back insert must leave no row");
    });
  } finally {
    await resource.close();
  }
});

test("a repeated preparedChangeSet fingerprint through WriteEnvelope rejects with IdempotencyConflictError and leaves exactly one row per table", async () => {
  const { createPostgresUnitOfWork } = await import(pathToFileURL(path.join(root, uowPath)).href);
  const { createPostgresWrite, IdempotencyConflictError } = await import(pathToFileURL(path.join(root, writePath)).href);
  const { UnitOfWork } = await import(pathToFileURL(path.join(root, uowModulePath)).href);
  const { WriteEnvelope } = await import(pathToFileURL(path.join(root, writeEnvelopeModulePath)).href);

  const resource = createPostgresUnitOfWork({ connectionString });
  try {
    const tenantId = crypto.randomUUID();
    const preparedChangeSet = Object.freeze({ persistenceState: "pending", intents: Object.freeze(validIntentsForTenant(tenantId)) });
    const write = createPostgresWrite({ requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });

    const firstEnvelope = new WriteEnvelope({ unitOfWork: new UnitOfWork(resource.port), write });
    await firstEnvelope.commit(preparedChangeSet);

    const secondEnvelope = new WriteEnvelope({ unitOfWork: new UnitOfWork(resource.port), write });
    await assert.rejects(
      () => secondEnvelope.commit(preparedChangeSet),
      (error) => {
        assert.ok(error instanceof IdempotencyConflictError);
        assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
        assert.equal(error.tenantId, tenantId);
        return true;
      },
    );

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customer = await client.query("SELECT count(*) FROM customer_records WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(customer.rows[0].count), 1, "no duplicate customer row");
      const audit = await client.query("SELECT count(*) FROM audit_log WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(audit.rows[0].count), 1, "no duplicate audit row");
      const outbox = await client.query("SELECT count(*) FROM transactional_outbox WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(outbox.rows[0].count), 1, "no duplicate outbox row");
    });
  } finally {
    await resource.close();
  }
});

test("postgres-write-envelope-write.mjs directly exports IdempotencyConflictError, checkPreparedChangeSet, checkTenantId and isDuplicateIdempotencyFingerprintError with the deterministic, unchanged shape", async () => {
  const mod = await import(pathToFileURL(path.join(root, writePath)).href);
  const { IdempotencyConflictError, checkPreparedChangeSet, checkTenantId, isDuplicateIdempotencyFingerprintError } = mod;

  assert.equal(typeof IdempotencyConflictError, "function");
  assert.equal(typeof checkPreparedChangeSet, "function");
  assert.equal(typeof checkTenantId, "function");
  assert.equal(typeof isDuplicateIdempotencyFingerprintError, "function");

  assert.ok(Object.isFrozen(IdempotencyConflictError));
  assert.ok(Object.isFrozen(IdempotencyConflictError.prototype));

  const tenantId = crypto.randomUUID();
  const fingerprint = `fp-${crypto.randomUUID()}`;
  const error = new IdempotencyConflictError(tenantId, fingerprint);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "IdempotencyConflictError");
  assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(error.retryable, false);
  assert.equal(error.tenantId, tenantId);
  assert.equal(error.fingerprint, fingerprint);
  assert.equal(error.message, `duplicate idempotency fingerprint for tenant ${tenantId}`);

  assert.equal(checkTenantId(tenantId), tenantId);
  assert.throws(() => checkTenantId(""), TypeError);
  assert.throws(() => checkTenantId(undefined), TypeError);

  const validPreparedChangeSet = Object.freeze({
    persistenceState: "pending",
    intents: Object.freeze(validIntentsForTenant(tenantId)),
  });
  const checked = checkPreparedChangeSet(validPreparedChangeSet);
  assert.deepEqual(Reflect.ownKeys(checked).sort(), ["audit", "customer", "idempotency", "transactionalOutbox"]);
  assert.throws(() => checkPreparedChangeSet({ persistenceState: "pending", intents: {} }), TypeError);
  assert.throws(() => checkPreparedChangeSet(null), TypeError);

  assert.equal(isDuplicateIdempotencyFingerprintError(null), false);
  assert.equal(
    isDuplicateIdempotencyFingerprintError({ code: "23505", constraint: "transactional_outbox_tenant_dedup_key" }),
    true,
  );
  assert.equal(isDuplicateIdempotencyFingerprintError({ code: "23505", constraint: "some_other_constraint" }), false);
});

test("postgres-write-envelope-write.mjs no longer imports from postgres-commit-adapter.mjs", () => {
  const source = readFileSync(path.join(root, writePath), "utf8");
  assert.ok(
    !source.includes("./postgres-commit-adapter.mjs"),
    "postgres-write-envelope-write.mjs must not import the old commit-adapter module",
  );
});

test("the legacy tests/postgres-commit-adapter.test.mjs file must be absent", () => {
  assert.throws(
    () => readFileSync(path.join(root, "tests/postgres-commit-adapter.test.mjs")),
    { code: "ENOENT" },
    "tests/postgres-commit-adapter.test.mjs must have been retired",
  );
});

test("createPostgresWrite rejects a preparedChangeSet with a missing customer tenantId before ever calling scope.query", async () => {
  const { createPostgresWrite } = await import(pathToFileURL(path.join(root, writePath)).href);

  const scope = {
    query: () => {
      throw new Error("scope.query must not be called when the customer tenantId is missing");
    },
  };

  const intents = validIntentsForTenant(crypto.randomUUID());
  delete intents.customer.tenantId;
  const preparedChangeSet = Object.freeze({ persistenceState: "pending", intents: Object.freeze(intents) });

  const write = createPostgresWrite({ requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });

  await assert.rejects(() => write(scope, preparedChangeSet), TypeError);
});

test("checkPreparedChangeSet accepts a null-prototype safe customer.payload and rejects array/class-instance/function payload shapes", () => {
  // checkPreparedChangeSet lives in postgres-write-envelope-write.mjs; this test is a pure,
  // synchronous unit test of its payload-shape validation and does not touch scope/Docker.
  const tenantId = crypto.randomUUID();

  const nullProtoIntents = validIntentsForTenant(tenantId);
  const nullProtoPayload = Object.create(null);
  nullProtoPayload.name = "Ada";
  nullProtoIntents.customer = { ...nullProtoIntents.customer, payload: nullProtoPayload };
  const nullProtoChangeSet = Object.freeze({ persistenceState: "pending", intents: Object.freeze(nullProtoIntents) });

  const checkNullProto = async () => {
    const { checkPreparedChangeSet } = await import(pathToFileURL(path.join(root, writePath)).href);
    const checked = checkPreparedChangeSet(nullProtoChangeSet);
    assert.equal(checked.customer.payload.name, "Ada");
  };

  class NamePayload {
    constructor(name) {
      this.name = name;
    }
  }

  const rejectedShapes = [
    ["array", ["Ada"]],
    ["class instance", new NamePayload("Ada")],
    ["function", (() => { const f = () => {}; f.customName = "Ada"; return f; })()],
  ];

  const checkRejected = async () => {
    const { checkPreparedChangeSet } = await import(pathToFileURL(path.join(root, writePath)).href);
    for (const [label, payload] of rejectedShapes) {
      const intents = validIntentsForTenant(tenantId);
      intents.customer = { ...intents.customer, payload };
      const preparedChangeSet = Object.freeze({ persistenceState: "pending", intents: Object.freeze(intents) });
      assert.throws(() => checkPreparedChangeSet(preparedChangeSet), TypeError, `${label} payload must be rejected`);
    }
  };

  return Promise.all([checkNullProto(), checkRejected()]);
});

// =====================================================================================
// P14e — createCustomerAppCoreWithPersistence composed with a freshly rendered generated
// public SDK and the real P13 cutover controller, driven end to end against the same
// migrated PostgreSQL 16 container/roles established above. No mocked adapter, no in-memory
// substrate: every assertion below reads back the real customer_records/audit_log/
// transactional_outbox rows.
// =====================================================================================

const appCorePath = "consumers/customer-app-core/customer-app-core.mjs";
const persistenceAdapterPath = "consumers/customer-app-core/customer-persistence-adapter.mjs";
const actionContractModulePath = "src/application/action-contract.mjs";
const sdkGeneratorModulePath = "tools/generate-versioned-action-sdk-distribution.mjs";

async function buildFreshGeneratedSdk() {
  const { ActionContract } = await import(pathToFileURL(path.join(root, actionContractModulePath)).href);
  const { renderVersionedActionSdkDistribution } = await import(
    pathToFileURL(path.join(root, sdkGeneratorModulePath)).href
  );
  const contract = new ActionContract({
    kind: "command",
    name: "customer.core.ping",
    version: 1,
    fields: Object.freeze(["id"]),
    outcomes: Object.freeze(["ok", "rejected"]),
    errorEnvelopeFields: Object.freeze(["code", "message"]),
  });
  const payload = renderVersionedActionSdkDistribution(contract, "1.0.0.0");
  const moduleSource = payload.files[payload.modulePath];
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
  const sdkModule = await import(dataUrl);
  return { sdkModule, coordinate: payload.coordinate };
}

function freshCustomerRecord(tenantId) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: now.toISOString(),
    recorded_at: now.toISOString(),
  };
}

async function countRow(table, tenantId) {
  return withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
    const result = await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    return Number(result.rows[0].count);
  });
}

test("createCustomerAppCoreWithPersistence: legacy default touches no database, then a real cutover and an application insert with no explicit parity metadata commits one row per table with a frozen canonical record", async () => {
  const { sdkModule, coordinate } = await buildFreshGeneratedSdk();
  const { createCustomerAppCoreWithPersistence } = await import(pathToFileURL(path.join(root, appCorePath)).href);

  const tenantId = crypto.randomUUID();
  let legacyCalls = 0;

  const appCore = createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: {
      connectionString,
      legacyInsert: async (record) => {
        legacyCalls += 1;
        return { legacy: true, id: record.id };
      },
      verifyCompatibility: async (boundary) => {
        const probe = await boundary.query("SELECT 1 FROM customer_records LIMIT 0");
        return Array.isArray(probe.rows);
      },
    },
  });

  assert.equal(appCore.persistence.activeWriter, "legacy");
  const legacyRecord = freshCustomerRecord(tenantId);
  const legacyResult = await appCore.persistence.insert(legacyRecord, { tenantId });
  assert.equal(legacyCalls, 1);
  assert.deepEqual(legacyResult, { legacy: true, id: legacyRecord.id });
  assert.equal(await countRow("customer_records", tenantId), 0, "legacy default must never touch the real database");

  await appCore.persistence.cutover();
  assert.equal(appCore.persistence.activeWriter, "application");

  const record = freshCustomerRecord(tenantId);
  const inserted = await appCore.persistence.insert(record, { tenantId });

  assert.equal(Object.isFrozen(inserted), true);
  assert.equal(inserted.id, record.id);
  assert.equal(inserted.tenant_id, tenantId);

  assert.equal(await countRow("customer_records", tenantId), 1);
  assert.equal(await countRow("audit_log", tenantId), 1);
  assert.equal(await countRow("transactional_outbox", tenantId), 1);

  await appCore.persistence.close();
});

test("createCustomerAppCoreWithPersistence: repeating the default idempotency fingerprint after a real application insert rejects with CustomerIdempotencyConflictError and rolls back to exactly one row per table", async () => {
  const { sdkModule, coordinate } = await buildFreshGeneratedSdk();
  const { createCustomerAppCoreWithPersistence } = await import(pathToFileURL(path.join(root, appCorePath)).href);
  const { CustomerIdempotencyConflictError } = await import(
    pathToFileURL(path.join(root, persistenceAdapterPath)).href
  );

  const tenantId = crypto.randomUUID();

  const appCore = createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: {
      connectionString,
      legacyInsert: async () => {
        throw new Error("legacy must not be reached after cutover");
      },
      verifyCompatibility: async (boundary) => {
        const probe = await boundary.query("SELECT 1 FROM customer_records LIMIT 0");
        return Array.isArray(probe.rows);
      },
    },
  });

  await appCore.persistence.cutover();
  assert.equal(appCore.persistence.activeWriter, "application");

  const firstRecord = freshCustomerRecord(tenantId);
  await appCore.persistence.insert(firstRecord, { tenantId });
  const defaultFingerprint = firstRecord.id;

  const secondRecord = freshCustomerRecord(tenantId);
  await assert.rejects(
    () =>
      appCore.persistence.insert(secondRecord, {
        tenantId,
        audit: { action: "customer.created", correlationId: secondRecord.id },
        transactionalOutbox: { eventName: "customer.created", correlationId: secondRecord.id },
        idempotency: { fingerprint: defaultFingerprint },
      }),
    (error) => {
      assert.ok(error instanceof CustomerIdempotencyConflictError);
      assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
      assert.equal(error.tenantId, tenantId);
      return true;
    },
  );

  assert.equal(await countRow("customer_records", tenantId), 1, "the rolled-back second insert must leave no extra customer row");
  assert.equal(await countRow("audit_log", tenantId), 1, "the rolled-back second insert must leave no extra audit row");
  assert.equal(await countRow("transactional_outbox", tenantId), 1, "the rolled-back second insert must leave no extra outbox row");

  await appCore.persistence.close();
});

test("createCustomerAppCoreWithPersistence: a partial explicit parity metadata set is fail-closed rejected with TypeError and leaves zero rows in every table (frozen P14b all-or-nothing rule)", async () => {
  const { sdkModule, coordinate } = await buildFreshGeneratedSdk();
  const { createCustomerAppCoreWithPersistence } = await import(pathToFileURL(path.join(root, appCorePath)).href);

  const tenantId = crypto.randomUUID();

  const appCore = createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: {
      connectionString,
      legacyInsert: async () => {
        throw new Error("legacy must not be reached after cutover");
      },
      verifyCompatibility: async (boundary) => {
        const probe = await boundary.query("SELECT 1 FROM customer_records LIMIT 0");
        return Array.isArray(probe.rows);
      },
    },
  });

  try {
    await appCore.persistence.cutover();
    assert.equal(appCore.persistence.activeWriter, "application");

    const record = freshCustomerRecord(tenantId);
    // Only `audit` is supplied explicitly; transactionalOutbox and idempotency are withheld.
    // The frozen P14b rule synthesizes all three defaults only when NO parity metadata object
    // is supplied at all — once any one of the three is explicit, the explicit set must pass
    // unchanged and an incomplete set must be rejected fail-closed, never silently backfilled.
    await assert.rejects(
      () =>
        appCore.persistence.insert(record, {
          tenantId,
          audit: { action: "customer.created", correlationId: record.id },
        }),
      TypeError,
    );

    assert.equal(await countRow("customer_records", tenantId), 0, "a fail-closed rejection must leave no customer row");
    assert.equal(await countRow("audit_log", tenantId), 0, "a fail-closed rejection must leave no audit row");
    assert.equal(await countRow("transactional_outbox", tenantId), 0, "a fail-closed rejection must leave no outbox row");
  } finally {
    await appCore.persistence.close();
  }
});
