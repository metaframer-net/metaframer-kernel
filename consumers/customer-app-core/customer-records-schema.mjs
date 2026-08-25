function isJsonPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonScalar(value) {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  throw new TypeError("payload must contain only JSON-compatible finite scalar values");
}

function deepFreezeClone(value, seen) {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("payload must not contain circular references");
    seen.add(value);
    const clone = value.map((item) => cloneJsonValue(item, seen));
    seen.delete(value);
    return Object.freeze(clone);
  }
  if (isJsonPlainObject(value)) {
    if (seen.has(value)) throw new TypeError("payload must not contain circular references");
    seen.add(value);
    const clone = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(clone, key, {
        value: cloneJsonValue(value[key], seen),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    seen.delete(value);
    return Object.freeze(clone);
  }
  throw new TypeError("payload must contain only plain objects, arrays, and JSON-compatible scalars");
}

function cloneJsonValue(value, seen) {
  if (Array.isArray(value) || isJsonPlainObject(value)) return deepFreezeClone(value, seen);
  assertJsonScalar(value);
  return value;
}

const FIELDS = [
  { name: "id", type: "uuid", required: true, primaryKey: true, default: "gen_random_uuid()" },
  { name: "tenant_id", type: "uuid", required: true },
  { name: "name", type: "text", required: true, constraint: "nonblank" },
  { name: "payload", type: "jsonb", required: true, default: "object", constraint: "object-only" },
  { name: "created_at", type: "timestamptz", required: true, default: "now()" },
  { name: "recorded_at", type: "timestamptz", required: true, default: "clock_timestamp()" },
].map((field) => Object.freeze(field));

export const CUSTOMER_RECORDS_SCHEMA = Object.freeze({
  table: "customer_records",
  ownerApp: "customer",
  ownerModule: "customer-core",
  schemaVersion: 1,
  entity: "customer-record",
  phase: "P11",
  fields: Object.freeze(FIELDS),
  targetOwner: "application",
  retirementPath: "P11-P14",
  sourceMigration: "0002_customer_records.py",
  index: Object.freeze({
    columns: Object.freeze(["tenant_id", "recorded_at"]),
    order: "DESC",
  }),
  rowLevelSecurity: Object.freeze({
    enabled: true,
    force: true,
    default: "deny",
    using: "tenant_id = mfk_current_tenant()",
    withCheck: "tenant_id = mfk_current_tenant()",
  }),
  runtimeGrants: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
});

const CANONICAL_KEYS = ["id", "tenant_id", "name", "payload", "created_at", "recorded_at"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value) {
  return isJsonPlainObject(value);
}

function assertUuid(value, key) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${key} must be a uuid string`);
  }
}

function assertTimestamp(value, key) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${key} must be an ISO timestamp string`);
  }
}

export function canonicalizeCustomerRecord(record) {
  if (!isPlainObject(record)) {
    throw new TypeError("record must be a plain object");
  }

  const keys = Object.keys(record);
  if (keys.length !== CANONICAL_KEYS.length || !CANONICAL_KEYS.every((key) => keys.includes(key))) {
    throw new TypeError("record must have exactly the six canonical keys");
  }

  assertUuid(record.id, "id");
  assertUuid(record.tenant_id, "tenant_id");

  if (typeof record.name !== "string" || record.name.trim() === "") {
    throw new TypeError("name must be a non-blank string");
  }

  if (!isPlainObject(record.payload)) {
    throw new TypeError("payload must be a plain object");
  }

  assertTimestamp(record.created_at, "created_at");
  assertTimestamp(record.recorded_at, "recorded_at");

  const canonical = {
    id: record.id,
    tenant_id: record.tenant_id,
    name: record.name.trim(),
    payload: deepFreezeClone(record.payload, new Set()),
    created_at: record.created_at,
    recorded_at: record.recorded_at,
  };

  return Object.freeze(canonical);
}
