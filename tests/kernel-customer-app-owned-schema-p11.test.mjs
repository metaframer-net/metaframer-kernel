import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(
  root,
  "consumers/customer-app-core/customer-records-schema.mjs",
);

async function loadSchemaModule() {
  return import(modulePath);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const EXPECTED_FIELDS = [
  { name: "id", type: "uuid", required: true, primaryKey: true, default: "gen_random_uuid()" },
  { name: "tenant_id", type: "uuid", required: true },
  { name: "name", type: "text", required: true, constraint: "nonblank" },
  { name: "payload", type: "jsonb", required: true, default: "object", constraint: "object-only" },
  { name: "created_at", type: "timestamptz", required: true, default: "now()" },
  { name: "recorded_at", type: "timestamptz", required: true, default: "clock_timestamp()" },
];

test("P11 customer/customer-core schema identity is immutable and describes exactly six physical fields", async () => {
  const { CUSTOMER_RECORDS_SCHEMA } = await loadSchemaModule();

  assert.equal(CUSTOMER_RECORDS_SCHEMA.table, "customer_records");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.ownerApp, "customer");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.ownerModule, "customer-core");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.schemaVersion, 1);
  assert.equal(CUSTOMER_RECORDS_SCHEMA.entity, "customer-record");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.phase, "P11");

  assert.equal(Object.isFrozen(CUSTOMER_RECORDS_SCHEMA), true);
  assert.equal(Object.isFrozen(CUSTOMER_RECORDS_SCHEMA.fields), true);
  assert.equal(CUSTOMER_RECORDS_SCHEMA.fields.length, 6);

  for (const [index, expected] of EXPECTED_FIELDS.entries()) {
    const field = CUSTOMER_RECORDS_SCHEMA.fields[index];
    assert.deepEqual(field, expected, `field ${index} (${expected.name}) must match exactly`);
    assert.equal(Object.isFrozen(field), true);
  }

  assert.throws(() => {
    CUSTOMER_RECORDS_SCHEMA.table = "mutated";
  });
});

test("a valid exact-key record canonicalizes deterministically to canonical key order and is deeply frozen", async () => {
  const { canonicalizeCustomerRecord } = await loadSchemaModule();

  const input = {
    payload: { plan: "pro" },
    name: "  Ada Lovelace  ".trim(),
    recorded_at: "2026-08-25T00:00:00.000Z",
    created_at: "2026-08-24T00:00:00.000Z",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    id: "22222222-2222-2222-2222-222222222222",
  };

  const canonical = canonicalizeCustomerRecord(input);

  assert.deepEqual(Object.keys(canonical), [
    "id", "tenant_id", "name", "payload", "created_at", "recorded_at",
  ]);
  assert.equal(canonical.id, input.id);
  assert.equal(canonical.tenant_id, input.tenant_id);
  assert.equal(canonical.name, "Ada Lovelace");
  assert.deepEqual(canonical.payload, { plan: "pro" });
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(canonical.payload), true);

  const reordered = { ...input };
  assert.deepEqual(canonicalizeCustomerRecord(reordered), canonical);

  assert.throws(() => { canonical.name = "mutated"; });
  assert.throws(() => { canonical.payload.plan = "mutated"; });
});

test("missing/extra/wrong-type/blank-name/non-object payloads fail closed", async () => {
  const { canonicalizeCustomerRecord } = await loadSchemaModule();

  const valid = {
    id: "22222222-2222-2222-2222-222222222222",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    name: "Ada Lovelace",
    payload: {},
    created_at: "2026-08-24T00:00:00.000Z",
    recorded_at: "2026-08-25T00:00:00.000Z",
  };

  for (const bad of [null, undefined, "not-an-object", 42, []]) {
    assert.throws(() => canonicalizeCustomerRecord(bad));
  }

  const { id, ...missingId } = valid;
  assert.throws(() => canonicalizeCustomerRecord(missingId));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, extra_field: "unexpected" }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, tenant_id: 12345 }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, payload: "not-an-object" }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, payload: null }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, created_at: 20260824 }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, name: "" }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, name: "   " }));
  assert.throws(() => canonicalizeCustomerRecord({ ...valid, name: 42 }));
});

test("descriptor agrees with the persistence-ownership record and the historical application-owned 0002_customer_records shape", async () => {
  const { CUSTOMER_RECORDS_SCHEMA } = await loadSchemaModule();
  const ownership = await readJson("planning/kernel-persistence-ownership.json");

  const historical = ownership.applicationOwnedHistoricalMigrations.find((e) => e.table === "customer_records");
  assert.ok(historical, "applicationOwnedHistoricalMigrations must list customer_records");
  assert.equal(historical.status, "historical-application-migration");
  assert.equal(historical.targetOwner, "application");
  assert.equal(historical.preserveInPlace, true);
  assert.equal(historical.requiredByRevision, "0003_policy_decision_log.py");
  assert.equal(historical.migrationFile, "0002_customer_records.py");

  assert.equal(CUSTOMER_RECORDS_SCHEMA.targetOwner, "application");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.retirementPath, "P11-P14");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.sourceMigration, "0002_customer_records.py");

  const migrationSource = await readFile(
    path.join(root, "db/metaframer_kernel_db/alembic/versions/0002_customer_records.py"),
    "utf8",
  );

  for (const field of CUSTOMER_RECORDS_SCHEMA.fields) {
    assert.ok(migrationSource.includes(field.name), `migration must define column ${field.name}`);
  }
  assert.ok(migrationSource.includes("name text NOT NULL"));
  assert.ok(migrationSource.includes("btrim(name) <> ''"));
  assert.ok(migrationSource.includes("jsonb_typeof(payload) = 'object'"));
});

test("descriptor states explicit tenant_id+recorded_at DESC index, FORCE RLS default deny, tenant-scoped USING/WITH CHECK and CRUD-only runtime grants with no DDL/control-plane grants", async () => {
  const { CUSTOMER_RECORDS_SCHEMA } = await loadSchemaModule();

  assert.deepEqual(CUSTOMER_RECORDS_SCHEMA.index, {
    columns: ["tenant_id", "recorded_at"],
    order: "DESC",
  });

  assert.equal(CUSTOMER_RECORDS_SCHEMA.rowLevelSecurity.enabled, true);
  assert.equal(CUSTOMER_RECORDS_SCHEMA.rowLevelSecurity.force, true);
  assert.equal(CUSTOMER_RECORDS_SCHEMA.rowLevelSecurity.default, "deny");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.rowLevelSecurity.using, "tenant_id = mfk_current_tenant()");
  assert.equal(CUSTOMER_RECORDS_SCHEMA.rowLevelSecurity.withCheck, "tenant_id = mfk_current_tenant()");

  assert.deepEqual(
    [...CUSTOMER_RECORDS_SCHEMA.runtimeGrants].sort(),
    ["DELETE", "INSERT", "SELECT", "UPDATE"].sort(),
  );
  for (const grant of ["CREATE", "ALTER", "DROP", "GRANT", "TRUNCATE", "EXECUTE"]) {
    assert.equal(CUSTOMER_RECORDS_SCHEMA.runtimeGrants.includes(grant), false);
  }
  assert.equal(Object.isFrozen(CUSTOMER_RECORDS_SCHEMA.runtimeGrants), true);
});

test("source/import boundary: zero Kernel imports and no SQL/migration/adapter/CRUD/cutover behavior, importing has no side effect", async () => {
  const source = await readFile(modulePath, "utf8");

  const forbiddenTokens = [
    "src/kernel", "src/adapters", "alembic", "postgres-commit-adapter",
    "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "INSERT INTO", "SELECT ",
    "UPDATE ", "DELETE FROM", "cutover", "cleanup", "readiness", "pg", "Pool", "Client",
  ];
  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `module source must not reference "${token}"`);
  }

  const importLines = source.split("\n").filter((l) => l.trim().startsWith("import "));
  for (const line of importLines) {
    const [, specifier] = line.match(/from\s+["']([^"']+)["']/) ?? [];
    assert.ok(specifier, "import must use a static specifier");
    assert.equal(specifier.includes("kernel"), false);
    assert.equal(specifier.includes("adapters"), false);
  }

  const globalKeysBefore = new Set(Object.keys(globalThis));
  await loadSchemaModule();
  assert.deepEqual([...Object.keys(globalThis)], [...globalKeysBefore]);
});
