import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(
  root,
  "consumers/customer-app-core/customer-records-adapter.mjs",
);

async function loadAdapterModule() {
  return import(modulePath);
}

function validRecord() {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: "2026-08-24T00:00:00.000Z",
    recorded_at: "2026-08-25T00:00:00.000Z",
  };
}

function oneRowResult(overrides = {}) {
  return {
    rows: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        tenant_id: "11111111-1111-1111-1111-111111111111",
        name: "Ada Lovelace",
        payload: { plan: "pro" },
        created_at: new Date("2026-08-24T00:00:00.000Z"),
        recorded_at: new Date("2026-08-25T00:00:00.000Z"),
        ...overrides,
      },
    ],
  };
}

test("factory rejects a missing/non-function query dependency and otherwise returns a frozen minimal adapter API", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();

  for (const bad of [undefined, null, "not-a-fn", 42, {}]) {
    assert.throws(() => createCustomerRecordsAdapter({ query: bad }));
  }
  assert.throws(() => createCustomerRecordsAdapter({}));

  const adapter = createCustomerRecordsAdapter({ query: async () => oneRowResult() });

  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(typeof adapter.insert, "function");
  assert.equal(adapter[Symbol.toStringTag], "CustomerRecordsAdapter");
  assert.deepEqual(
    Object.keys(adapter).sort(),
    ["insert"],
  );
});

test("insert canonicalizes the record, issues exactly one parameterized INSERT carrying all six fields, and returns the frozen canonical row", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return oneRowResult();
  };

  const adapter = createCustomerRecordsAdapter({ query });
  const record = validRecord();

  const result = await adapter.insert(record, { tenantId: record.tenant_id });

  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].sql, "string");
  assert.match(calls[0].sql, /INSERT INTO customer_records/i);
  assert.equal(calls[0].sql.includes("$1"), true);
  assert.equal(Array.isArray(calls[0].params), true);

  for (const field of ["id", "tenant_id", "name", "payload", "created_at", "recorded_at"]) {
    const serialized = JSON.stringify(record[field]);
    const found = calls[0].params.some((p) => JSON.stringify(p) === serialized);
    assert.ok(found, `params must carry canonical field ${field}`);
  }

  assert.deepEqual(Object.keys(result), [
    "id", "tenant_id", "name", "payload", "created_at", "recorded_at",
  ]);
  assert.equal(result.created_at, "2026-08-24T00:00:00.000Z");
  assert.equal(result.recorded_at, "2026-08-25T00:00:00.000Z");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.payload), true);
  assert.throws(() => { result.name = "mutated"; });
});

test("an invalid P11 record is rejected before any query call", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();

  let calls = 0;
  const adapter = createCustomerRecordsAdapter({ query: async () => { calls += 1; return oneRowResult(); } });

  const invalidCases = [
    { ...validRecord(), name: "" },
    { ...validRecord(), payload: "not-an-object" },
    { ...validRecord(), tenant_id: 12345 },
    (() => { const { id, ...rest } = validRecord(); return rest; })(),
    { ...validRecord(), extra_field: "unexpected" },
  ];

  for (const bad of invalidCases) {
    await assert.rejects(() => adapter.insert(bad, { tenantId: bad.tenant_id ?? validRecord().tenant_id }));
  }
  assert.equal(calls, 0);
});

test("a missing or mismatched tenantId is rejected before any query call", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();

  let calls = 0;
  const adapter = createCustomerRecordsAdapter({ query: async () => { calls += 1; return oneRowResult(); } });
  const record = validRecord();

  await assert.rejects(() => adapter.insert(record, {}));
  await assert.rejects(() => adapter.insert(record, { tenantId: undefined }));
  await assert.rejects(() => adapter.insert(record, { tenantId: "99999999-9999-9999-9999-999999999999" }));
  await assert.rejects(() => adapter.insert(record, { tenantId: 12345 }));

  assert.equal(calls, 0);
});

test("zero, multiple, or malformed returned rows are rejected", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();
  const record = validRecord();

  const zeroRows = createCustomerRecordsAdapter({ query: async () => ({ rows: [] }) });
  await assert.rejects(() => zeroRows.insert(record, { tenantId: record.tenant_id }));

  const twoRows = createCustomerRecordsAdapter({
    query: async () => ({ rows: [oneRowResult().rows[0], oneRowResult().rows[0]] }),
  });
  await assert.rejects(() => twoRows.insert(record, { tenantId: record.tenant_id }));

  const noRowsField = createCustomerRecordsAdapter({ query: async () => ({}) });
  await assert.rejects(() => noRowsField.insert(record, { tenantId: record.tenant_id }));

  const malformedRow = createCustomerRecordsAdapter({
    query: async () => ({ rows: [{ id: record.id }] }),
  });
  await assert.rejects(() => malformedRow.insert(record, { tenantId: record.tenant_id }));
});

test("query rejection propagates by identity, and the source respects the app-owned import boundary", async () => {
  const { createCustomerRecordsAdapter } = await loadAdapterModule();
  const record = validRecord();

  class MarkerError extends Error {}
  const marker = new MarkerError("boom");
  const adapter = createCustomerRecordsAdapter({ query: async () => { throw marker; } });

  await assert.rejects(() => adapter.insert(record, { tenantId: record.tenant_id }), (err) => err === marker);

  const source = await readFile(modulePath, "utf8");
  const importLines = source.split("\n").filter((l) => l.trim().startsWith("import "));

  let sawSchemaImport = false;
  for (const line of importLines) {
    const [, specifier] = line.match(/from\s+["']([^"']+)["']/) ?? [];
    assert.ok(specifier, "import must use a static specifier");
    assert.equal(specifier.startsWith("."), true, "adapter must only import relative specifiers");
    assert.equal(specifier.includes("src/kernel"), false);
    assert.equal(specifier.includes("src/db"), false);
    assert.equal(specifier.includes("src/host"), false);
    assert.equal(specifier.includes("src/adapters"), false);
    assert.equal(/(^|\/)pg($|\/)/.test(specifier), false);
    if (specifier.includes("customer-records-schema")) sawSchemaImport = true;
    assert.equal(path.dirname(specifier).replace(/^\.\/?/, ""), "", "import must resolve within the same directory");
  }
  assert.equal(sawSchemaImport, true, "adapter must import the same-directory P11 schema contract");
});
