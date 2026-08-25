import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(root, "consumers/customer-app-core/customer-data-cutover.mjs");
const loadModule = () => import(modulePath);

const validRecord = () => ({
  id: "22222222-2222-2222-2222-222222222222",
  tenant_id: "11111111-1111-1111-1111-111111111111",
  name: "Ada Lovelace",
  payload: { plan: "pro" },
  created_at: "2026-08-24T00:00:00.000Z",
  recorded_at: "2026-08-25T00:00:00.000Z",
});

const oneRowResult = () => ({
  rows: [{
    id: "22222222-2222-2222-2222-222222222222",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: new Date("2026-08-24T00:00:00.000Z"),
    recorded_at: new Date("2026-08-25T00:00:00.000Z"),
  }],
});

function makeFakeClient(queryImpl) {
  const calls = [];
  let released = 0;
  const client = {
    query: async (sql, params) => { calls.push({ sql, params }); return queryImpl(sql, params); },
    release: () => { released += 1; },
  };
  return { client, calls, releasedCount: () => released };
}

function makeFakePoolFactory(client) {
  let connects = 0;
  let ended = 0;
  const pool = { connect: async () => { connects += 1; return client; }, end: async () => { ended += 1; } };
  return { poolFactory: () => pool, connectCalls: () => connects, endedCount: () => ended };
}

test("factory validates options, returns a frozen controller, and never touches the pool until cutover", async () => {
  const { createCustomerDataCutover } = await loadModule();

  for (const bad of [undefined, null, "x", 42, {}]) assert.throws(() => createCustomerDataCutover(bad));
  assert.throws(() => createCustomerDataCutover({ legacyInsert: async () => {}, verifyCompatibility: async () => true }));
  assert.throws(() => createCustomerDataCutover({ connectionString: "postgres://x", verifyCompatibility: async () => true }));
  assert.throws(() => createCustomerDataCutover({ connectionString: "postgres://x", legacyInsert: async () => {} }));

  let poolFactoryCalls = 0;
  const controller = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => {},
    verifyCompatibility: async () => true,
    poolFactory: () => { poolFactoryCalls += 1; return {}; },
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.equal(controller.activeWriter, "legacy");
  for (const fn of [controller.insert, controller.cutover, controller.rollback, controller.close]) assert.equal(typeof fn, "function");
  assert.equal(poolFactoryCalls, 0);
});

test("default behavior is legacy-exclusive: insert delegates to legacyInsert exactly once without opening the pool", async () => {
  const { createCustomerDataCutover } = await loadModule();
  const record = validRecord();
  let legacyCalls = 0, poolFactoryCalls = 0;
  const controller = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async (r) => { legacyCalls += 1; assert.deepEqual(r, record); return { legacy: true }; },
    verifyCompatibility: async () => true,
    poolFactory: () => { poolFactoryCalls += 1; return {}; },
  });

  const result = await controller.insert(record, { tenantId: record.tenant_id });

  assert.equal(legacyCalls, 1);
  assert.equal(poolFactoryCalls, 0);
  assert.equal(controller.activeWriter, "legacy");
  assert.deepEqual(result, { legacy: true });
});

test("cutover with denied or throwing compatibility leaves activeWriter=legacy, releases the client, and performs no insert", async () => {
  const { createCustomerDataCutover } = await loadModule();

  const { client: c1, releasedCount: r1 } = makeFakeClient(async () => oneRowResult());
  let legacyCalls = 0;
  const controller1 = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => { legacyCalls += 1; },
    verifyCompatibility: async () => false,
    poolFactory: makeFakePoolFactory(c1).poolFactory,
  });
  await controller1.cutover();
  assert.equal(controller1.activeWriter, "legacy");
  assert.equal(r1(), 1);
  await controller1.insert(validRecord(), { tenantId: validRecord().tenant_id });
  assert.equal(legacyCalls, 1);

  const { client: c2, releasedCount: r2 } = makeFakeClient(async () => oneRowResult());
  const controller2 = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => {},
    verifyCompatibility: async () => { throw new Error("incompatible"); },
    poolFactory: makeFakePoolFactory(c2).poolFactory,
  });
  await assert.rejects(() => controller2.cutover());
  assert.equal(controller2.activeWriter, "legacy");
  assert.equal(r2(), 1);
});

test("successful cutover routes insert through one attested application transaction, delegates to the P12 adapter, commits, and never calls legacy", async () => {
  const { createCustomerDataCutover } = await loadModule();
  const record = validRecord();
  const { client, calls, releasedCount } = makeFakeClient(async (sql) => {
    if (/^BEGIN$/i.test(sql) || /^COMMIT$/i.test(sql) || /mfk_begin_tenant_context/i.test(sql)) return {};
    if (/INSERT INTO customer_records/i.test(sql)) return oneRowResult();
    return {};
  });
  const { poolFactory, connectCalls } = makeFakePoolFactory(client);
  let legacyCalls = 0, verifyCalls = 0;
  const controller = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => { legacyCalls += 1; },
    verifyCompatibility: async (descriptor) => {
      verifyCalls += 1;
      assert.equal(descriptor?.table, "customer_records");
      assert.equal(typeof descriptor?.query, "function");
      return true;
    },
    poolFactory,
  });

  await controller.cutover();
  assert.equal(controller.activeWriter, "application");
  assert.equal(verifyCalls, 1);
  assert.equal(connectCalls(), 1);

  const result = await controller.insert(record, { tenantId: record.tenant_id });

  assert.equal(legacyCalls, 0);
  assert.equal(connectCalls(), 2);
  assert.equal(releasedCount(), 2);
  assert.match(calls[0].sql, /^BEGIN$/i);
  assert.match(calls[1].sql, /mfk_begin_tenant_context/i);
  assert.deepEqual(calls[1].params, [record.tenant_id]);
  assert.match(calls[2].sql, /INSERT INTO customer_records/i);
  assert.match(calls[calls.length - 1].sql, /^COMMIT$/i);
  assert.deepEqual(Object.keys(result).sort(), ["created_at", "id", "name", "payload", "recorded_at", "tenant_id"]);
  assert.equal(Object.isFrozen(result), true);
});

test("application insert failure rolls back once, releases the client, and preserves the original error without falling back to legacy", async () => {
  const { createCustomerDataCutover } = await loadModule();
  const record = validRecord();
  class MarkerError extends Error {}
  const marker = new MarkerError("insert failed");
  const { client, calls, releasedCount } = makeFakeClient(async (sql) => {
    if (/^BEGIN$/i.test(sql) || /^ROLLBACK$/i.test(sql) || /mfk_begin_tenant_context/i.test(sql)) return {};
    if (/INSERT INTO customer_records/i.test(sql)) throw marker;
    return {};
  });
  let legacyCalls = 0;
  const controller = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => { legacyCalls += 1; },
    verifyCompatibility: async () => true,
    poolFactory: makeFakePoolFactory(client).poolFactory,
  });

  await controller.cutover();
  await assert.rejects(() => controller.insert(record, { tenantId: record.tenant_id }), (err) => err === marker);

  assert.equal(legacyCalls, 0);
  assert.equal(calls.filter((c) => /^ROLLBACK$/i.test(c.sql)).length, 1);
  assert.equal(releasedCount(), 2);
});

test("rollback() routes future inserts back to legacy without DB mutation, close() ends only an initialized pool, and the module exposes no delete/copy/backfill surface", async () => {
  const { createCustomerDataCutover } = await loadModule();
  const record = validRecord();
  const { client } = makeFakeClient(async (sql) => (/INSERT INTO customer_records/i.test(sql) ? oneRowResult() : {}));
  const { poolFactory, endedCount } = makeFakePoolFactory(client);
  let legacyCalls = 0;
  const controller = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => { legacyCalls += 1; },
    verifyCompatibility: async () => true,
    poolFactory,
  });

  await controller.cutover();
  assert.equal(controller.activeWriter, "application");
  controller.rollback();
  assert.equal(controller.activeWriter, "legacy");
  await controller.insert(record, { tenantId: record.tenant_id });
  assert.equal(legacyCalls, 1);
  await controller.close();
  assert.equal(endedCount(), 1);

  const noPoolController = createCustomerDataCutover({
    connectionString: "postgres://x",
    legacyInsert: async () => {},
    verifyCompatibility: async () => true,
    poolFactory: () => { throw new Error("must not be called"); },
  });
  await noPoolController.close();

  const source = await readFile(modulePath, "utf8");
  for (const forbidden of [/DELETE\s+FROM/i, /DROP\s+TABLE/i, /TRUNCATE/i, /backfill/i, /\bcopy\b/i]) {
    assert.equal(forbidden.test(source), false, `module must not contain ${forbidden}`);
  }
});
