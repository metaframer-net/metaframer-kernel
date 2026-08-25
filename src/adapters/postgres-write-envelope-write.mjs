import { CommitReceipt } from "../application/commit-receipt.mjs";
import {
  IdempotencyConflictError,
  checkPreparedChangeSet,
  checkTenantId,
  isDuplicateIdempotencyFingerprintError,
} from "./postgres-commit-adapter.mjs";

// =====================================================================================
// createPostgresWrite
//
// Builds the `write(scope, preparedChangeSet)` collaborator WriteEnvelope
// (src/application/write-envelope.mjs) needs: given the transactional client UnitOfWork.begin
// already opened (`scope`), inserts all four intents of an ALLOW_COMMIT preparedChangeSet against
// the same S1 substrate PostgresCommitAdapter targets, and resolves to a canonical CommitReceipt.
// The SQL COMMIT/ROLLBACK itself stays with the UnitOfWork port; this collaborator only writes
// rows inside the scope it is handed. Validation and duplicate-fingerprint recognition are the
// exact PostgresCommitAdapter helpers, imported rather than duplicated.
// =====================================================================================

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
