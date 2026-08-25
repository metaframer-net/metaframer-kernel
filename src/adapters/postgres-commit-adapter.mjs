import pg from "pg";

// =====================================================================================
// PostgresCommitAdapter
//
// The Application-owned persistence port that commits a CreateCustomerPipeline ALLOW_COMMIT
// `preparedChangeSet` against the PostgreSQL S1 substrate (db/metaframer_kernel_db), inside one
// real, attested tenant transaction (`mfk_begin_tenant_context`), never against a mock or
// in-memory database.
//
// The S1 substrate owns the two runtime tables `transactional_outbox` and `audit_log`; the
// tenant-owned domain table `customer_records` was added in
// db/metaframer_kernel_db/alembic/versions/0002_customer_records.py. This adapter commits all
// four of the pipeline's write intents for real, in one transaction:
//
//   - `customer`            -> one row in `customer_records`
//   - `audit`               -> one row in `audit_log`
//   - `transactionalOutbox` -> one row in `transactional_outbox`
//   - `idempotency`         -> realized as that outbox row's `dedup_key`, which the substrate's
//                              own per-tenant unique index already enforces; a repeated commit
//                              with the same fingerprint is refused by the database itself, and
//                              rolls back the customer insert along with everything else
//
// The mint receipt is a frozen CommitReceipt-shaped object covering all four intents, with no
// deferred intent and no deferredReason.
// =====================================================================================

import {
  IdempotencyConflictError,
  checkPreparedChangeSet,
  checkTenantId,
  isDuplicateIdempotencyFingerprintError,
} from "./postgres-write-envelope-write.mjs";

export const COMMITTED_INTENTS = Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]);
export const DEFERRED_INTENTS = Object.freeze([]);

// These four names are owned by postgres-write-envelope-write.mjs; re-exported here unchanged
// so this transitional adapter and its existing tests keep the same public API/identity.
export { IdempotencyConflictError, checkPreparedChangeSet, checkTenantId, isDuplicateIdempotencyFingerprintError };

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function checkCustomerTenant(customer, tenantId) {
  if (typeof customer.tenantId !== "string" || !customer.tenantId) {
    throw new TypeError("intents.customer.tenantId must be a non-empty string");
  }
  if (customer.tenantId !== tenantId) {
    throw new TypeError("intents.customer.tenantId must exactly match options.tenantId");
  }
}

export class PostgresCommitAdapter {
  #pool;

  constructor({ connectionString }) {
    if (typeof connectionString !== "string" || !connectionString) {
      throw new TypeError("PostgresCommitAdapter needs a connectionString string");
    }
    this.#pool = new pg.Pool({ connectionString });
  }

  /**
   * Commit the customer, audit, transactionalOutbox and idempotency intents of one
   * ALLOW_COMMIT preparedChangeSet atomically, inside one attested tenant transaction. Rolls
   * back and rejects on any failure, including a repeated idempotency fingerprint for the same
   * tenant.
   */
  async commit(preparedChangeSet, options) {
    const { customer, audit, transactionalOutbox, idempotency } = checkPreparedChangeSet(preparedChangeSet);
    const tenantId = checkTenantId(isOrdinaryObject(options) ? options.tenantId : undefined);
    checkCustomerTenant(customer, tenantId);

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantId]);

      const customerResult = await client.query(
        "INSERT INTO customer_records (tenant_id, name, payload) VALUES ($1, $2, $3) RETURNING id",
        [tenantId, customer.payload.name, JSON.stringify(customer.payload)],
      );

      const auditResult = await client.query(
        "INSERT INTO audit_log (tenant_id, event_type, actor_id, correlation_id, details) " +
          "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [
          tenantId,
          audit.action,
          audit.actorId ?? null,
          audit.correlationId ?? null,
          JSON.stringify({ intentType: audit.type ?? null }),
        ],
      );

      const outboxResult = await client.query(
        "INSERT INTO transactional_outbox (tenant_id, event_type, correlation_id, dedup_key) " +
          "VALUES ($1, $2, $3, $4) RETURNING id",
        [tenantId, transactionalOutbox.eventName, transactionalOutbox.correlationId ?? null, idempotency.fingerprint],
      );

      await client.query("COMMIT");
      return Object.freeze({
        receiptType: "CommitReceipt",
        committedIntents: COMMITTED_INTENTS,
        deferredIntents: DEFERRED_INTENTS,
        customerRecordId: customerResult.rows[0].id,
        auditLogId: auditResult.rows[0].id,
        outboxId: outboxResult.rows[0].id,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (isDuplicateIdempotencyFingerprintError(error)) {
        throw new IdempotencyConflictError(tenantId, idempotency.fingerprint);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.#pool.end();
  }

  get [Symbol.toStringTag]() {
    return "PostgresCommitAdapter";
  }
}
Object.freeze(PostgresCommitAdapter.prototype);
Object.freeze(PostgresCommitAdapter);
