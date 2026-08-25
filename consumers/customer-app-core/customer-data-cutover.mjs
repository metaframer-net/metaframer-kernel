import pg from "pg";
import { createCustomerRecordsAdapter } from "./customer-records-adapter.mjs";

const CUSTOMER_RECORDS_TABLE = "customer_records";

export function createCustomerDataCutover(options) {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("options must be an object");
  }
  const { connectionString, legacyInsert, verifyCompatibility, poolFactory } = options;
  if (typeof connectionString !== "string" || connectionString === "") {
    throw new TypeError("options.connectionString must be a non-empty string");
  }
  if (typeof legacyInsert !== "function") {
    throw new TypeError("options.legacyInsert must be a function");
  }
  if (typeof verifyCompatibility !== "function") {
    throw new TypeError("options.verifyCompatibility must be a function");
  }
  if (poolFactory !== undefined && typeof poolFactory !== "function") {
    throw new TypeError("options.poolFactory must be a function when provided");
  }

  const buildPool = poolFactory ?? (() => new pg.Pool({ connectionString }));
  let pool;
  function getPool() {
    if (!pool) pool = buildPool();
    return pool;
  }

  let activeWriter = "legacy";

  async function insert(record, insertOptions) {
    if (activeWriter === "legacy") {
      return legacyInsert(record, insertOptions);
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT mfk_begin_tenant_context($1::uuid)", [insertOptions?.tenantId]);
      const adapter = createCustomerRecordsAdapter({ query: (sql, params) => client.query(sql, params) });
      const result = await adapter.insert(record, insertOptions);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // preserve original error below
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function cutover() {
    const client = await getPool().connect();
    try {
      const boundary = Object.freeze({
        table: CUSTOMER_RECORDS_TABLE,
        query: (sql, params) => client.query(sql, params),
      });
      const compatible = await verifyCompatibility(boundary);
      if (compatible === true) {
        activeWriter = "application";
      }
    } finally {
      client.release();
    }
  }

  function rollback() {
    activeWriter = "legacy";
  }

  async function close() {
    if (pool) {
      await pool.end();
    }
  }

  return Object.freeze({
    get activeWriter() {
      return activeWriter;
    },
    insert,
    cutover,
    rollback,
    close,
  });
}
