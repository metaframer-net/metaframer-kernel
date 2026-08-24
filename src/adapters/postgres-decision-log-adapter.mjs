import { createHash } from "node:crypto";

import pg from "pg";

import { DecisionLogEntry } from "../application/decision-log-entry.mjs";

// =====================================================================================
// PostgresDecisionLogAdapter — P04e2
//
// Persists one DecisionLogEntry into the tenant-isolated, append-only `policy_decision_log`
// table (db/metaframer_kernel_db/alembic/versions/0003_policy_decision_log.py) inside one real
// attested tenant transaction. `append(entry)` is the whole surface: tenant is derived from
// `entry.request.tenantId`, never a caller-supplied option, so `new DecisionLogPort({ append:
// adapter.append })` hands off a bare, bound-safe function with no receiver dependency.
//
// `verifyPersistedDecisionLogRow` is a pure, independent oracle: given the row this adapter's own
// INSERT ... RETURNING produces, it recomputes P04d's canonical hash from the payload alone,
// after undoing whatever key order a JSONB round-trip left it in, and binds the row's id/tenant_id/
// prev_hash columns to the payload. It never trusts `entry.entryHash` as an oracle.
// =====================================================================================

const ULID_FORM = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_FORM = /^[0-9a-f]{64}$/;
const TS_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class DecisionLogIntegrityError extends Error {
  code = "DECISION_LOG_INTEGRITY_VIOLATION";

  constructor(message) {
    super(message);
    this.name = "DecisionLogIntegrityError";
    Object.freeze(this);
  }
}
Object.freeze(DecisionLogIntegrityError.prototype);
Object.freeze(DecisionLogIntegrityError);

export class DecisionLogChainConflictError extends Error {
  code = "DECISION_LOG_CHAIN_CONFLICT";
  retryable = false;
  tenantId;
  entryId;
  prevHash;

  constructor(tenantId, entryId, prevHash) {
    super(`decision log chain conflict for tenant ${tenantId}, entry ${entryId}`);
    this.name = "DecisionLogChainConflictError";
    this.tenantId = tenantId;
    this.entryId = entryId;
    this.prevHash = prevHash;
    Object.freeze(this);
  }
}
Object.freeze(DecisionLogChainConflictError.prototype);
Object.freeze(DecisionLogChainConflictError);

function demand(condition, message) {
  if (!condition) throw new DecisionLogIntegrityError(message);
}

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function exactKeys(value, keys, what) {
  demand(isOrdinaryObject(value), `${what} must be an ordinary object`);
  const given = Object.keys(value);
  demand(given.length === keys.length && keys.every((k) => given.includes(k)), `${what} must carry exactly these keys: ${keys.join(", ")}`);
}

// Recursively admits only JSON-native primitive/null/array/ordinary-object shapes -- the closed
// set a JSONB round-trip can ever hand back -- refusing anything exotic (a function, a Date, a
// class instance, a Map) that would prove this value never genuinely came from the database.
function demandJsonShape(value, what) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const entry of value) demandJsonShape(entry, what);
    return;
  }
  demand(isOrdinaryObject(value), `${what} must be a JSON-native primitive, null, array or ordinary object`);
  for (const key of Object.keys(value)) demandJsonShape(value[key], what);
}

// The same recursive descending-key-order rule decision-log-entry.mjs applies before hashing,
// reimplemented independently here as the oracle a JSONB round-trip must still satisfy however
// Postgres reordered the stored keys.
function descendingKeyOrder(value) {
  if (Array.isArray(value)) return value.map((entry) => descendingKeyOrder(entry));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort().reverse()) out[key] = descendingKeyOrder(value[key]);
    return out;
  }
  return value;
}

function sha256Of(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

const PAYLOAD_KEYS = [
  "id", "requestActor", "requestAction", "requestResource", "requestContext",
  "decision", "reason", "matchedPolicyId", "layerResolved", "traceId", "ts", "prevHash",
];

function demandString(value, what) {
  demand(typeof value === "string", `${what} must be a string`);
  return value;
}

function demandNullableHex64(value, what) {
  demand(value === null || (typeof value === "string" && HEX64_FORM.test(value)), `${what} must be null or a lowercase 64-hex string`);
  return value;
}

function demandNullableString(value, what) {
  demand(value === null || typeof value === "string", `${what} must be null or a string`);
  return value;
}

/**
 * Verifies one row shaped exactly as this adapter's own INSERT ... RETURNING produces --
 * `{ id, tenant_id, entry_hash, prev_hash, payload }` -- independently of the database. Recomputes
 * P04d's canonical SHA-256 from the payload alone (never trusting `entry_hash` as an oracle),
 * binds the row's id/tenant_id/prev_hash columns to the payload, and rejects hash mismatch,
 * binding drift, or any missing/extra/mistyped payload field with a frozen
 * DecisionLogIntegrityError. Returns the frozen receipt on success.
 */
export function verifyPersistedDecisionLogRow(row) {
  exactKeys(row, ["id", "tenant_id", "entry_hash", "prev_hash", "payload"], "row");
  demand(typeof row.id === "string" && ULID_FORM.test(row.id), "row.id must be a canonical ULID");
  demand(typeof row.tenant_id === "string" && UUID_FORM.test(row.tenant_id), "row.tenant_id must be a canonical UUID");
  demand(typeof row.entry_hash === "string" && HEX64_FORM.test(row.entry_hash), "row.entry_hash must be a lowercase 64-hex string");
  demandNullableHex64(row.prev_hash, "row.prev_hash");
  demandJsonShape(row.payload, "row.payload");

  exactKeys(row.payload, PAYLOAD_KEYS, "row.payload");
  const payload = row.payload;

  demand(typeof payload.id === "string" && ULID_FORM.test(payload.id), "row.payload.id must be a canonical ULID");
  exactKeys(payload.requestActor, ["tenantId", "actorId"], "row.payload.requestActor");
  demand(typeof payload.requestActor.tenantId === "string" && UUID_FORM.test(payload.requestActor.tenantId), "row.payload.requestActor.tenantId must be a canonical UUID");
  demandString(payload.requestActor.actorId, "row.payload.requestActor.actorId");
  demandString(payload.requestAction, "row.payload.requestAction");
  demandJsonShape(payload.requestResource, "row.payload.requestResource");
  demandJsonShape(payload.requestContext, "row.payload.requestContext");
  demandString(payload.decision, "row.payload.decision");
  demandString(payload.reason, "row.payload.reason");
  demandNullableString(payload.matchedPolicyId, "row.payload.matchedPolicyId");
  demandNullableString(payload.layerResolved, "row.payload.layerResolved");
  demand(typeof payload.traceId === "string" && UUID_FORM.test(payload.traceId), "row.payload.traceId must be a canonical UUID");
  demand(typeof payload.ts === "string" && TS_FORM.test(payload.ts), "row.payload.ts must be a canonical UTC millisecond ISO instant");
  demandNullableHex64(payload.prevHash, "row.payload.prevHash");

  // Binding: the row's own id/tenant_id/prev_hash columns must agree with the payload they claim
  // to carry -- never merely with each other.
  demand(payload.id === row.id, "row.payload.id must bind to row.id");
  demand(payload.requestActor.tenantId === row.tenant_id, "row.payload.requestActor.tenantId must bind to row.tenant_id");
  demand(payload.prevHash === row.prev_hash, "row.payload.prevHash must bind to row.prev_hash");

  const canonical = {
    id: payload.id,
    requestActor: { tenantId: payload.requestActor.tenantId, actorId: payload.requestActor.actorId },
    requestAction: payload.requestAction,
    requestResource: descendingKeyOrder(payload.requestResource),
    requestContext: descendingKeyOrder(payload.requestContext),
    decision: payload.decision,
    reason: payload.reason,
    matchedPolicyId: payload.matchedPolicyId,
    layerResolved: payload.layerResolved,
    traceId: payload.traceId,
    ts: payload.ts,
    prevHash: payload.prevHash,
  };
  const recomputed = sha256Of(canonical);
  demand(recomputed === row.entry_hash, "recomputed hash does not match row.entry_hash");

  return Object.freeze({
    receiptType: "DecisionLogAppendReceipt",
    entryId: row.id,
    tenantId: row.tenant_id,
    entryHash: row.entry_hash,
    prevHash: row.prev_hash,
  });
}

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// A hollow instance built directly on the prototype (Object.create(DecisionLogEntry.prototype))
// passes isExactly but carries no private field, so the entryHash getter is captured once and
// used as a brand check: it throws for anything but a genuine DecisionLogEntry.
const ENTRY_HASH_BRAND = Object.getOwnPropertyDescriptor(DecisionLogEntry.prototype, "entryHash").get;
function isGenuineEntry(value) {
  if (!isExactly(value, DecisionLogEntry)) return false;
  try {
    ENTRY_HASH_BRAND.call(value);
    return true;
  } catch {
    return false;
  }
}

// The exact SQLSTATE/constraint pairs the 0003_policy_decision_log migration installs -- the
// only three shapes a chain-integrity violation can take at this table. A constraint name paired
// with the wrong SQLSTATE (or any other pair) is not one of these and must stay raw.
const CHAIN_CONFLICT_PAIRS = new Set([
  "23505:policy_decision_log_one_genesis_per_tenant",
  "23505:policy_decision_log_one_successor_per_predecessor",
  "23503:policy_decision_log_prev_hash_same_tenant_fk",
]);

function isChainConflictError(error) {
  return error != null && CHAIN_CONFLICT_PAIRS.has(`${error.code}:${error.constraint}`);
}

export class PostgresDecisionLogAdapter {
  #pool;

  constructor({ connectionString }) {
    if (typeof connectionString !== "string" || !connectionString) {
      throw new TypeError("PostgresDecisionLogAdapter needs a connectionString string");
    }
    this.#pool = new pg.Pool({ connectionString });
    // A bound-safe class field: `adapter.append` is a real, self-contained function, so
    // `new DecisionLogPort({ append: adapter.append })` never needs `.bind(adapter)`.
    this.append = async (entry) => {
      if (!isGenuineEntry(entry)) {
        throw new TypeError("PostgresDecisionLogAdapter.append needs an exact genuine DecisionLogEntry instance");
      }

      const tenantId = entry.request.tenantId.toString();
      const { entryHash, ...payload } = entry.toJSON();

      const client = await this.#pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantId]);

        const result = await client.query(
          "INSERT INTO policy_decision_log (id, tenant_id, entry_hash, prev_hash, payload) " +
            "VALUES ($1, $2, $3, $4, $5) " +
            'RETURNING "id", "tenant_id", "entry_hash", "prev_hash", "payload"',
          [entry.id, tenantId, entryHash, entry.prevHash, JSON.stringify(payload)],
        );
        const row = result.rows[0];
        const receipt = verifyPersistedDecisionLogRow(row);

        await client.query("COMMIT");
        return receipt;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (isChainConflictError(error)) {
          throw new DecisionLogChainConflictError(tenantId, entry.id, entry.prevHash);
        }
        throw error;
      } finally {
        client.release();
      }
    };
    Object.freeze(this.append);
  }

  async close() {
    await this.#pool.end();
  }

  get [Symbol.toStringTag]() {
    return "PostgresDecisionLogAdapter";
  }
}
Object.freeze(PostgresDecisionLogAdapter.prototype);
Object.freeze(PostgresDecisionLogAdapter);
