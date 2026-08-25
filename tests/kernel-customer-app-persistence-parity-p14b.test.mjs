import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P14b — targeted parity tests for the new app-owned consumers/customer-app-core/
// customer-persistence-adapter.mjs (createCustomerPersistenceAdapter,
// CustomerIdempotencyConflictError). Written pre-implementation; RED is honest: the module
// does not exist yet at the allowed path below.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTER_PATH = "consumers/customer-app-core/customer-persistence-adapter.mjs";

async function importAdapter() {
  return import(pathToFileURL(path.join(root, ADAPTER_PATH)).href);
}

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RECORD_ID = "22222222-2222-2222-2222-222222222222";

function baseRecord() {
  return {
    id: RECORD_ID,
    tenant_id: TENANT_ID,
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: "2026-08-24T00:00:00.000Z",
    recorded_at: "2026-08-25T00:00:00.000Z",
  };
}

function baseMetadata() {
  return {
    tenantId: TENANT_ID,
    audit: { action: "customer.created", correlationId: RECORD_ID },
    transactionalOutbox: { eventName: "customer.created", correlationId: RECORD_ID },
    idempotency: { fingerprint: RECORD_ID },
  };
}

test("fail-closed: missing/mismatched metadata rejects with zero query calls", async () => {
  const mod = await importAdapter();
  assert.equal(typeof mod.createCustomerPersistenceAdapter, "function");

  let calls = 0;
  const query = async () => {
    calls += 1;
    return { rows: [] };
  };
  const adapter = mod.createCustomerPersistenceAdapter({ query });

  await assert.rejects(() => adapter.insert(baseRecord(), {}));
  await assert.rejects(() => adapter.insert(baseRecord(), { tenantId: TENANT_ID }));
  await assert.rejects(() =>
    adapter.insert(baseRecord(), {
      tenantId: TENANT_ID,
      audit: { action: "customer.created" },
      transactionalOutbox: { eventName: "customer.created" },
      idempotency: { fingerprint: "" },
    })
  );
  await assert.rejects(() =>
    adapter.insert(baseRecord(), { ...baseMetadata(), tenantId: "99999999-9999-9999-9999-999999999999" })
  );

  assert.equal(calls, 0);
});

test("success: exact SQL/order/params for customer insert then audit_log then outbox, returns frozen canonical record", async () => {
  const mod = await importAdapter();
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO customer_records/i.test(sql)) {
      return { rows: [baseRecord()] };
    }
    if (/INSERT INTO audit_log/i.test(sql)) {
      return { rows: [{ id: "audit-1" }] };
    }
    if (/INSERT INTO transactional_outbox/i.test(sql)) {
      return { rows: [{ id: "outbox-1" }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const adapter = mod.createCustomerPersistenceAdapter({ query });

  const result = await adapter.insert(baseRecord(), baseMetadata());

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT INTO customer_records/i);
  assert.match(calls[1].sql, /INSERT INTO audit_log/i);
  assert.match(calls[2].sql, /INSERT INTO transactional_outbox/i);
  assert.ok(calls[2].params.includes(RECORD_ID), "outbox dedup_key must carry the idempotency fingerprint");

  assert.deepEqual(result, baseRecord());
  assert.equal(Object.isFrozen(result), true);
});

test("dedup mapping: pg 23505 on transactional_outbox_tenant_dedup_key maps to CustomerIdempotencyConflictError; other 23505 is not mapped", async () => {
  const mod = await importAdapter();

  const dedupError = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "transactional_outbox_tenant_dedup_key",
  });
  const dedupAdapter = mod.createCustomerPersistenceAdapter({
    query: async (sql) => {
      if (/INSERT INTO customer_records/i.test(sql)) return { rows: [baseRecord()] };
      if (/INSERT INTO audit_log/i.test(sql)) return { rows: [{ id: "audit-1" }] };
      throw dedupError;
    },
  });
  await assert.rejects(
    () => dedupAdapter.insert(baseRecord(), baseMetadata()),
    (err) => {
      assert.ok(err instanceof mod.CustomerIdempotencyConflictError);
      assert.equal(err.retryable, false);
      return true;
    }
  );

  const otherError = Object.assign(new Error("other unique violation"), {
    code: "23505",
    constraint: "customer_records_pkey",
  });
  const otherAdapter = mod.createCustomerPersistenceAdapter({
    query: async (sql) => {
      if (/INSERT INTO customer_records/i.test(sql)) return { rows: [baseRecord()] };
      if (/INSERT INTO audit_log/i.test(sql)) return { rows: [{ id: "audit-1" }] };
      throw otherError;
    },
  });
  await assert.rejects(
    () => otherAdapter.insert(baseRecord(), baseMetadata()),
    (err) => err === otherError
  );
});

test("P13 transaction integration: deterministic parity defaults use existing BEGIN/ROLLBACK and failure never falls back to legacy", async () => {
  const { createCustomerDataCutover } = await import(
    pathToFileURL(path.join(root, "consumers/customer-app-core/customer-data-cutover.mjs")).href
  );

  let legacyCalls = 0;
  const queryLog = [];
  const failingClient = {
    query: async (sql, params) => {
      queryLog.push({ sql, params });
      if (/INSERT INTO transactional_outbox/i.test(sql)) {
        throw new Error("outbox failure");
      }
      if (/INSERT INTO customer_records/i.test(sql)) return { rows: [baseRecord()] };
      if (/INSERT INTO audit_log/i.test(sql)) return { rows: [{ id: "audit-1" }] };
      return {};
    },
    release: () => {},
  };
  const pool = { connect: async () => failingClient, end: async () => {} };

  const cutover = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => {
      legacyCalls += 1;
      return { legacy: true };
    },
    verifyCompatibility: async () => true,
    poolFactory: () => pool,
  });
  await cutover.cutover();
  assert.equal(cutover.activeWriter, "application");

  await assert.rejects(() => cutover.insert(baseRecord(), { tenantId: TENANT_ID }));
  assert.ok(queryLog.some((c) => /BEGIN/i.test(c.sql)));
  assert.ok(queryLog.some((c) => /ROLLBACK/i.test(c.sql)));
  const auditCall = queryLog.find((c) => /INSERT INTO audit_log/i.test(c.sql));
  assert.ok(auditCall.params.includes("customer.created"));
  const outboxCall = queryLog.find((c) => /INSERT INTO transactional_outbox/i.test(c.sql));
  assert.ok(outboxCall.params.includes(RECORD_ID));

  assert.equal(legacyCalls, 0);
  assert.equal(cutover.activeWriter, "application");
});
