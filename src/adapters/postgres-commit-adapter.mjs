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

export const COMMITTED_INTENTS = Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]);
export const DEFERRED_INTENTS = Object.freeze([]);

// The substrate's own per-tenant unique index name, from
// db/metaframer_kernel_db/alembic/versions/0001_runtime_substrate.py — the one and only
// constraint a duplicate idempotency fingerprint can violate.
const DEDUP_KEY_CONSTRAINT = "transactional_outbox_tenant_dedup_key";
const POSTGRES_UNIQUE_VIOLATION = "23505";

// Thrown in place of the raw pg unique-violation error, for exactly the one known conflict this
// adapter can distinguish deterministically: a repeated tenant-scoped idempotency fingerprint.
// Every other database failure (connection loss, constraint violations elsewhere, syntax
// errors, ...) is left as the original pg error and must keep propagating unmasked.
export class IdempotencyConflictError extends Error {
  code = "IDEMPOTENCY_CONFLICT";
  retryable = false;
  tenantId;
  fingerprint;

  constructor(tenantId, fingerprint) {
    super(`duplicate idempotency fingerprint for tenant ${tenantId}`);
    this.name = "IdempotencyConflictError";
    this.tenantId = tenantId;
    this.fingerprint = fingerprint;
  }
}
Object.freeze(IdempotencyConflictError.prototype);
Object.freeze(IdempotencyConflictError);

/** True only for the exact, known duplicate-idempotency-fingerprint unique violation. */
export function isDuplicateIdempotencyFingerprintError(error) {
  return error != null
    && error.code === POSTGRES_UNIQUE_VIOLATION
    && error.constraint === DEDUP_KEY_CONSTRAINT;
}

const INTENT_KEYS = Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]);

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

// A customer.payload may legitimately arrive as either an ordinary Object.prototype record or a
// null-prototype safe record (e.g. Object.create(null)) — both shapes the real ASGI/pipeline path
// produces for a decoded JSON body — but never an array, class instance, function or exotic/proxy
// object. Used only for customer.payload; every other intent/option strictness is unchanged.
const isSafePlainRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function checkPreparedChangeSet(preparedChangeSet) {
  if (!isOrdinaryObject(preparedChangeSet)) {
    throw new TypeError("PostgresCommitAdapter.commit needs an ordinary preparedChangeSet object");
  }
  if (preparedChangeSet.persistenceState !== "pending") {
    throw new TypeError('PostgresCommitAdapter.commit needs persistenceState "pending"');
  }
  const intents = preparedChangeSet.intents;
  if (!isOrdinaryObject(intents)) {
    throw new TypeError("preparedChangeSet.intents must be an ordinary object");
  }
  const keys = Reflect.ownKeys(intents);
  if (keys.length !== INTENT_KEYS.length || INTENT_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`preparedChangeSet.intents must carry exactly these keys: ${INTENT_KEYS.join(", ")}`);
  }
  const { customer, audit, transactionalOutbox, idempotency } = intents;
  for (const [name, intent] of [["customer", customer], ["audit", audit], ["transactionalOutbox", transactionalOutbox], ["idempotency", idempotency]]) {
    if (!isOrdinaryObject(intent)) {
      throw new TypeError(`preparedChangeSet.intents.${name} must be an ordinary object`);
    }
  }
  if (!isSafePlainRecord(customer.payload) || typeof customer.payload.name !== "string" || !customer.payload.name) {
    throw new TypeError("intents.customer.payload.name must be a non-empty string");
  }
  if (typeof audit.action !== "string" || !audit.action) {
    throw new TypeError("intents.audit.action must be a non-empty string");
  }
  if (typeof transactionalOutbox.eventName !== "string" || !transactionalOutbox.eventName) {
    throw new TypeError("intents.transactionalOutbox.eventName must be a non-empty string");
  }
  if (typeof idempotency.fingerprint !== "string" || !idempotency.fingerprint) {
    throw new TypeError("intents.idempotency.fingerprint must be a non-empty string");
  }
  return { customer, audit, transactionalOutbox, idempotency };
}

export function checkTenantId(tenantId) {
  if (typeof tenantId !== "string" || !tenantId) {
    throw new TypeError("commit needs an options.tenantId string");
  }
  return tenantId;
}

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
