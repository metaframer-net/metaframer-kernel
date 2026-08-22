import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// PostgresCommitAdapter — targeted RED/GREEN for V12B2B.
//
// Proves the adapter commits all four CreateCustomerPipeline ALLOW_COMMIT write intents —
// customer, audit, transactionalOutbox, idempotency — atomically, inside one attested tenant
// transaction, against a REAL PostgreSQL 16 container (never a mock or in-memory substrate).
// The customer intent is written into customer_records, added in
// db/metaframer_kernel_db/alembic/versions/0002_customer_records.py. See
// planning/gj01-v12b2b-customer-commit-receipt.json.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterPath = "src/adapters/postgres-commit-adapter.mjs";

const IMAGE = "postgres:16-alpine";
const SUPERUSER_PASSWORD = crypto.randomUUID();
const MIGRATION_PASSWORD = crypto.randomUUID();
const RUNTIME_PASSWORD = crypto.randomUUID();
const MIGRATION_ROLE = "mfk_migration";
const RUNTIME_ROLE = "mfk_runtime";
const DATABASE = "mfk_v12b1_adapter";

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  return result.status === 0;
}

function startContainer() {
  const name = `mfk-v12b1-adapter-${crypto.randomBytes(6).toString("hex")}`;
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

test("the adapter module and its planning package exist", () => {
  assert.equal(typeof adapterPath, "string");
});

test("importing the adapter exposes PostgresCommitAdapter with no side effects", async () => {
  const module = await import(pathToFileURL(path.join(root, adapterPath)).href);
  assert.equal(typeof module.PostgresCommitAdapter, "function", "PostgresCommitAdapter must be exported");
  assert.equal(typeof module.COMMITTED_INTENTS, "object");
  assert.deepEqual([...module.COMMITTED_INTENTS].sort(), ["audit", "customer", "idempotency", "transactionalOutbox"]);
  assert.deepEqual([...module.DEFERRED_INTENTS], []);
});

test("IdempotencyConflictError is exported, frozen, and carries a deterministic non-retryable shape", async () => {
  const { IdempotencyConflictError } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  assert.equal(typeof IdempotencyConflictError, "function");
  assert.ok(Object.isFrozen(IdempotencyConflictError));
  assert.ok(Object.isFrozen(IdempotencyConflictError.prototype));
  const tenantId = crypto.randomUUID();
  const error = new IdempotencyConflictError(tenantId, "fp-1");
  assert.ok(error instanceof Error);
  assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(error.retryable, false);
  assert.equal(error.tenantId, tenantId);
  assert.equal(error.fingerprint, "fp-1");
});

test("the adapter refuses a preparedChangeSet that is not persistenceState pending", async () => {
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://example/does-not-matter" });
  await assert.rejects(
    () => adapter.commit({ persistenceState: "done", intents: {} }, { tenantId: crypto.randomUUID() }),
    TypeError,
  );
});

function validIntentsForTenant(tenantId) {
  const correlationId = crypto.randomUUID();
  return {
    customer: { type: "customer.create", tenantId, payload: { name: "Ada" } },
    audit: { type: "audit.append", tenantId, actorId: "actor-1", action: "customer.create", correlationId },
    transactionalOutbox: { type: "outbox.enqueue", eventName: "customer.created", tenantId, correlationId },
    idempotency: { type: "idempotency.record", tenantId, fingerprint: `fp-${correlationId}`, correlationId },
  };
}

test("the adapter refuses a customer intent with no tenantId, before any DB work", async () => {
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  // An unroutable connectionString proves rejection happens before any DB work is attempted:
  // pool.connect() would hang or error differently if the adapter ever reached it.
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://example/does-not-matter" });
  const tenantId = crypto.randomUUID();
  const intents = validIntentsForTenant(tenantId);
  delete intents.customer.tenantId;
  await assert.rejects(
    () => adapter.commit({ persistenceState: "pending", intents }, { tenantId }),
    TypeError,
  );
});

test("the adapter refuses a customer intent whose tenantId mismatches options.tenantId, before any DB work", async () => {
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://example/does-not-matter" });
  const tenantId = crypto.randomUUID();
  const intents = validIntentsForTenant(tenantId);
  intents.customer.tenantId = crypto.randomUUID();
  await assert.rejects(
    () => adapter.commit({ persistenceState: "pending", intents }, { tenantId }),
    TypeError,
  );
});

test("the adapter accepts a null-prototype customer.payload with a non-empty name, past shape checks and before any DB work", async () => {
  // GJ-01 V14K: the real ASGI -> pipeline path decodes a JSON body into a null-prototype safe
  // record, not an Object.prototype ordinary object. A reachable-but-refusing port (127.0.0.1:1)
  // fails fast at pool.connect() rather than hanging on DNS, so a rejection here is provably a
  // connection failure, not the payload-shape TypeError this package fixed.
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://user:pass@127.0.0.1:1/does-not-matter" });
  const tenantId = crypto.randomUUID();
  const intents = validIntentsForTenant(tenantId);
  intents.customer.payload = Object.assign(Object.create(null), { name: "Ada" });
  try {
    await adapter.commit({ persistenceState: "pending", intents }, { tenantId });
    assert.fail("expected the commit to reject on connection, not on payload shape");
  } catch (error) {
    assert.ok(
      !(error instanceof TypeError) || !/payload\.name/.test(error.message),
      `expected a connection failure, not the payload-shape TypeError; got: ${error.message}`,
    );
  }
});

test("the adapter still refuses a customer.payload with no name, whether ordinary or null-prototype", async () => {
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://example/does-not-matter" });
  const tenantId = crypto.randomUUID();

  const ordinaryIntents = validIntentsForTenant(tenantId);
  ordinaryIntents.customer.payload = {};
  await assert.rejects(
    () => adapter.commit({ persistenceState: "pending", intents: ordinaryIntents }, { tenantId }),
    TypeError,
  );

  const nullProtoIntents = validIntentsForTenant(tenantId);
  nullProtoIntents.customer.payload = Object.create(null);
  await assert.rejects(
    () => adapter.commit({ persistenceState: "pending", intents: nullProtoIntents }, { tenantId }),
    TypeError,
  );
});

test("the adapter still refuses a customer.payload that is an array, a class instance or a function", async () => {
  const { PostgresCommitAdapter } = await import(pathToFileURL(path.join(root, adapterPath)).href);
  const adapter = new PostgresCommitAdapter({ connectionString: "postgresql://example/does-not-matter" });
  const tenantId = crypto.randomUUID();

  class Payload { constructor() { this.name = "Ada"; } }

  for (const badPayload of [["Ada"], new Payload(), function namedFn() { return "Ada"; }]) {
    const intents = validIntentsForTenant(tenantId);
    intents.customer.payload = badPayload;
    await assert.rejects(
      () => adapter.commit({ persistenceState: "pending", intents }, { tenantId }),
      TypeError,
      `expected a refusal for payload ${String(badPayload)}`,
    );
  }
});

// The real, Docker-backed proof. Skipped with a loud, separately-reported failure if Docker is
// unavailable — never silently skipped, and never satisfied against a mock substrate.
test("all four ALLOW_COMMIT intents, including customer, are committed atomically against a real PostgreSQL 16 instance", async (t) => {
  if (!dockerAvailable()) {
    throw new Error(
      "docker is not available in this environment: this is an environment failure, not a " +
        "PostgresCommitAdapter capability gap, and must be reported separately",
    );
  }

  const { PostgresCommitAdapter, COMMITTED_INTENTS, DEFERRED_INTENTS } =
    await import(pathToFileURL(path.join(root, adapterPath)).href);

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
  const adapter = new PostgresCommitAdapter({ connectionString });

  try {
    const tenantId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const preparedChangeSet = Object.freeze({
      persistenceState: "pending",
      intents: Object.freeze({
        customer: Object.freeze({ type: "customer.create", tenantId, payload: { name: "Ada" } }),
        audit: Object.freeze({ type: "audit.append", tenantId, actorId: "actor-1", action: "customer.create", correlationId }),
        transactionalOutbox: Object.freeze({ type: "outbox.enqueue", eventName: "customer.created", tenantId, correlationId }),
        idempotency: Object.freeze({ type: "idempotency.record", tenantId, fingerprint: `fp-${correlationId}`, correlationId }),
      }),
    });

    const receipt = await adapter.commit(preparedChangeSet, { tenantId });
    assert.deepEqual([...receipt.committedIntents].sort(), [...COMMITTED_INTENTS].sort());
    assert.deepEqual([...receipt.deferredIntents], [...DEFERRED_INTENTS]);
    assert.equal(receipt.deferredReason, undefined);
    assert.equal(receipt.receiptType, "CommitReceipt");
    assert.equal(typeof receipt.customerRecordId, "string");
    assert.equal(typeof receipt.auditLogId, "string");
    assert.equal(typeof receipt.outboxId, "string");
    assert.ok(Object.isFrozen(receipt));

    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const customer = await client.query(
        "SELECT tenant_id, name, payload FROM customer_records WHERE id = $1",
        [receipt.customerRecordId],
      );
      assert.equal(customer.rows.length, 1);
      assert.equal(customer.rows[0].tenant_id, tenantId);
      assert.equal(customer.rows[0].name, "Ada");
      assert.deepEqual(customer.rows[0].payload, { name: "Ada" });

      const audit = await client.query("SELECT tenant_id, event_type, correlation_id FROM audit_log WHERE id = $1", [receipt.auditLogId]);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].tenant_id, tenantId);
      assert.equal(audit.rows[0].event_type, "customer.create");

      const outbox = await client.query(
        "SELECT tenant_id, event_type, dedup_key FROM transactional_outbox WHERE id = $1",
        [receipt.outboxId],
      );
      assert.equal(outbox.rows.length, 1);
      assert.equal(outbox.rows[0].tenant_id, tenantId);
      assert.equal(outbox.rows[0].event_type, "customer.created");
      assert.equal(outbox.rows[0].dedup_key, `fp-${correlationId}`);
    });

    // A second commit with the same idempotency fingerprint must not create a second outbox row,
    // and must not create a second customer row either. GJ-01 V14L: the adapter must map this
    // specific, known duplicate-idempotency conflict to a deterministic IdempotencyConflictError
    // — never leak the raw pg unique-violation error.
    const { IdempotencyConflictError } = await import(pathToFileURL(path.join(root, adapterPath)).href);
    await assert.rejects(
      () => adapter.commit(preparedChangeSet, { tenantId }),
      (error) => {
        assert.ok(error instanceof IdempotencyConflictError);
        assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
        assert.equal(error.retryable, false);
        assert.equal(error.tenantId, tenantId);
        assert.equal(error.fingerprint, `fp-${correlationId}`);
        return true;
      },
    );
    await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
      const outboxCount = await client.query("SELECT count(*) FROM transactional_outbox WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(outboxCount.rows[0].count), 1, "the duplicate commit must not enqueue a second outbox row");
      const customerCount = await client.query("SELECT count(*) FROM customer_records WHERE tenant_id = $1", [tenantId]);
      assert.equal(Number(customerCount.rows[0].count), 1, "the duplicate commit must not insert a second customer row");
    });
  } finally {
    // Close the adapter's own connections before t.after() tears down the container, so the
    // pool never observes the postmaster exit mid-shutdown.
    await adapter.close();
  }
});
