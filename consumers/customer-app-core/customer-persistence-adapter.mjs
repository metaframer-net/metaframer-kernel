// P14b — app-owned persistence adapter for consumers/customer-app-core/. Wraps the unchanged
// createCustomerRecordsAdapter customer insert with Kernel-parity audit_log and
// transactional_outbox writes through the same caller-supplied query function, so the P13
// cutover branch gets full parity without any Kernel import.

import { createCustomerRecordsAdapter } from "./customer-records-adapter.mjs";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const DEDUP_KEY_CONSTRAINT = "transactional_outbox_tenant_dedup_key";

export class CustomerIdempotencyConflictError extends Error {
  code = "IDEMPOTENCY_CONFLICT";
  retryable = false;
  tenantId;
  fingerprint;

  constructor(tenantId, fingerprint) {
    super(`Idempotency conflict for tenant ${tenantId} fingerprint ${fingerprint}`);
    this.name = "CustomerIdempotencyConflictError";
    this.tenantId = tenantId;
    this.fingerprint = fingerprint;
  }
}

function isDedupViolation(error) {
  return (
    error != null &&
    error.code === POSTGRES_UNIQUE_VIOLATION &&
    error.constraint === DEDUP_KEY_CONSTRAINT
  );
}

function nonEmptyString(value) {
  return typeof value === "string" && value !== "";
}

function checkAudit(audit) {
  if (typeof audit !== "object" || audit === null) {
    throw new TypeError("options.audit must be an object");
  }
  if (!nonEmptyString(audit.action) || !nonEmptyString(audit.correlationId)) {
    throw new TypeError("options.audit must carry non-empty action and correlationId");
  }
  return audit;
}

function checkOutbox(transactionalOutbox) {
  if (typeof transactionalOutbox !== "object" || transactionalOutbox === null) {
    throw new TypeError("options.transactionalOutbox must be an object");
  }
  if (!nonEmptyString(transactionalOutbox.eventName) || !nonEmptyString(transactionalOutbox.correlationId)) {
    throw new TypeError("options.transactionalOutbox must carry non-empty eventName and correlationId");
  }
  return transactionalOutbox;
}

function checkIdempotency(idempotency) {
  if (typeof idempotency !== "object" || idempotency === null) {
    throw new TypeError("options.idempotency must be an object");
  }
  if (!nonEmptyString(idempotency.fingerprint)) {
    throw new TypeError("options.idempotency must carry a non-empty fingerprint");
  }
  return idempotency;
}

export function createCustomerPersistenceAdapter({ query } = {}) {
  if (typeof query !== "function") {
    throw new TypeError("query must be a function");
  }

  const recordsAdapter = createCustomerRecordsAdapter({ query });

  async function insert(record, options) {
    const tenantId = options?.tenantId;
    if (!nonEmptyString(tenantId) || tenantId !== record?.tenant_id) {
      throw new TypeError("options.tenantId must be a non-empty string matching the record's tenant_id");
    }

    const audit = checkAudit(options?.audit);
    const transactionalOutbox = checkOutbox(options?.transactionalOutbox);
    const idempotency = checkIdempotency(options?.idempotency);

    const canonical = await recordsAdapter.insert(record, options);

    await query(
      "INSERT INTO audit_log (tenant_id, event_type, actor_id, correlation_id, details) " +
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [
        tenantId,
        audit.action,
        audit.actorId ?? null,
        audit.correlationId,
        JSON.stringify({ intentType: audit.type ?? null }),
      ]
    );

    try {
      await query(
        "INSERT INTO transactional_outbox (tenant_id, event_type, correlation_id, dedup_key) " +
          "VALUES ($1, $2, $3, $4) RETURNING id",
        [tenantId, transactionalOutbox.eventName, transactionalOutbox.correlationId, idempotency.fingerprint]
      );
    } catch (error) {
      if (isDedupViolation(error)) {
        throw new CustomerIdempotencyConflictError(tenantId, idempotency.fingerprint);
      }
      throw error;
    }

    return canonical;
  }

  return Object.freeze({
    insert,
    [Symbol.toStringTag]: "CustomerPersistenceAdapter",
  });
}
