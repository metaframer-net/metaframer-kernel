import { CommitReceipt } from "../application/commit-receipt.mjs";

// =====================================================================================
// createPostgresWrite
//
// Builds the `write(scope, preparedChangeSet)` collaborator WriteEnvelope
// (src/application/write-envelope.mjs) needs: given the transactional client UnitOfWork.begin
// already opened (`scope`), inserts all four intents of an ALLOW_COMMIT preparedChangeSet against
// the same S1 substrate PostgresCommitAdapter targets, and resolves to a canonical CommitReceipt.
// The SQL COMMIT/ROLLBACK itself stays with the UnitOfWork port; this collaborator only writes
// rows inside the scope it is handed. This module directly owns preparedChangeSet/tenantId
// validation and duplicate-fingerprint recognition; postgres-commit-adapter.mjs imports and
// re-exports these same names for its own transitional API.
// =====================================================================================

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

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`createPostgresWrite needs a ${label} string`);
  }
  return value;
}

export function createPostgresWrite({ requestId, idempotencyKey }) {
  nonEmptyString(requestId, "requestId");
  nonEmptyString(idempotencyKey, "idempotencyKey");

  return async function write(scope, preparedChangeSet) {
    const { customer, audit, transactionalOutbox, idempotency } = checkPreparedChangeSet(preparedChangeSet);
    const tenantId = checkTenantId(customer.tenantId);

    await scope.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantId]);

    try {
      const customerResult = await scope.query(
        "INSERT INTO customer_records (tenant_id, name, payload) VALUES ($1, $2, $3) RETURNING id, recorded_at",
        [tenantId, customer.payload.name, JSON.stringify(customer.payload)],
      );

      const auditResult = await scope.query(
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

      const outboxResult = await scope.query(
        "INSERT INTO transactional_outbox (tenant_id, event_type, correlation_id, dedup_key) " +
          "VALUES ($1, $2, $3, $4) RETURNING id",
        [tenantId, transactionalOutbox.eventName, transactionalOutbox.correlationId ?? null, idempotency.fingerprint],
      );

      const customerRow = customerResult.rows[0];
      return new CommitReceipt({
        requestId,
        tenantId,
        resourceId: String(customerRow.id),
        outcome: "COMMITTED",
        committedAt: customerRow.recorded_at.toISOString(),
        auditId: String(auditResult.rows[0].id),
        outboxEventIds: [String(outboxResult.rows[0].id)],
        idempotencyKey,
      });
    } catch (error) {
      if (isDuplicateIdempotencyFingerprintError(error)) {
        throw new IdempotencyConflictError(tenantId, idempotency.fingerprint);
      }
      throw error;
    }
  };
}
