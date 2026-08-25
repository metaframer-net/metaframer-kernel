import { CUSTOMER_RECORDS_SCHEMA, canonicalizeCustomerRecord } from "./customer-records-schema.mjs";

const FIELD_NAMES = CUSTOMER_RECORDS_SCHEMA.fields.map((field) => field.name);

function buildInsertSql() {
  const columns = FIELD_NAMES.join(", ");
  const placeholders = FIELD_NAMES.map((_, index) => `$${index + 1}`).join(", ");
  return `INSERT INTO ${CUSTOMER_RECORDS_SCHEMA.table} (${columns}) VALUES (${placeholders}) RETURNING ${columns}`;
}

const INSERT_SQL = buildInsertSql();

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export function createCustomerRecordsAdapter({ query } = {}) {
  if (typeof query !== "function") {
    throw new TypeError("query must be a function");
  }

  async function insert(record, options) {
    const canonical = canonicalizeCustomerRecord(record);

    const tenantId = options?.tenantId;
    if (
      typeof tenantId !== "string" &&
      typeof tenantId !== "number" &&
      typeof tenantId !== "boolean"
    ) {
      throw new TypeError("options.tenantId must be a non-empty primitive");
    }
    if (tenantId === "" || tenantId !== canonical.tenant_id) {
      throw new TypeError("options.tenantId must match the record's canonical tenant_id");
    }

    const params = FIELD_NAMES.map((name) => canonical[name]);
    const result = await query(INSERT_SQL, params);

    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new TypeError("query must return exactly one row");
    }

    const [row] = result.rows;
    const normalized = {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      payload: row.payload,
      created_at: normalizeTimestamp(row.created_at),
      recorded_at: normalizeTimestamp(row.recorded_at),
    };

    return canonicalizeCustomerRecord(normalized);
  }

  return Object.freeze({
    insert,
    [Symbol.toStringTag]: "CustomerRecordsAdapter",
  });
}
