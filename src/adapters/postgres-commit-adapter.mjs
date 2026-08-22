import pg from "pg";

// =====================================================================================
// PostgresCommitAdapter
//
// The Application-owned persistence port that commits a CreateCustomerPipeline ALLOW_COMMIT
// `preparedChangeSet` against the PostgreSQL S1 substrate (db/metaframer_kernel_db), inside one
// real, attested tenant transaction (`mfk_begin_tenant_context`), never against a mock or
// in-memory database.
//
// The S1 substrate owns exactly two runtime tables — `transactional_outbox` and `audit_log` —
// and no customer-owning table. This adapter therefore commits three of the pipeline's four
// write intents for real:
//
//   - `audit`               -> one row in `audit_log`
//   - `transactionalOutbox` -> one row in `transactional_outbox`
//   - `idempotency`         -> realized as that outbox row's `dedup_key`, which the substrate's
//                              own per-tenant unique index already enforces; a repeated commit
//                              with the same fingerprint is refused by the database itself
//
// The fourth intent, `customer`, has no backing table in this substrate and is left deferred.
// Materializing a customer-owning table is a separate, out-of-scope decision — see
// planning/gj01-v12b1-postgres-adapter.json — so this adapter mints no CommitReceipt claiming a
// customer was persisted. It is a bounded, honest commit contract, not the full B2 commit.
// =====================================================================================

export const COMMITTED_INTENTS = Object.freeze(["audit", "transactionalOutbox", "idempotency"]);
export const DEFERRED_INTENTS = Object.freeze(["customer"]);
export const DEFERRED_REASON =
  "no customer-owning runtime table exists in the S1 substrate (transactional_outbox, audit_log " +
  "only); materializing one is a separate, out-of-scope decision";

const INTENT_KEYS = Object.freeze(["customer", "audit", "transactionalOutbox", "idempotency"]);

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function checkPreparedChangeSet(preparedChangeSet) {
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
  const { audit, transactionalOutbox, idempotency } = intents;
  for (const [name, intent] of [["audit", audit], ["transactionalOutbox", transactionalOutbox], ["idempotency", idempotency]]) {
    if (!isOrdinaryObject(intent)) {
      throw new TypeError(`preparedChangeSet.intents.${name} must be an ordinary object`);
    }
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
  return { audit, transactionalOutbox, idempotency };
}

function checkTenantId(tenantId) {
  if (typeof tenantId !== "string" || !tenantId) {
    throw new TypeError("commit needs an options.tenantId string");
  }
  return tenantId;
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
   * Commit the audit, transactionalOutbox and idempotency intents of one ALLOW_COMMIT
   * preparedChangeSet atomically, inside one attested tenant transaction. Rolls back and rejects
   * on any failure, including a repeated idempotency fingerprint for the same tenant.
   */
  async commit(preparedChangeSet, options) {
    const { audit, transactionalOutbox, idempotency } = checkPreparedChangeSet(preparedChangeSet);
    const tenantId = checkTenantId(isOrdinaryObject(options) ? options.tenantId : undefined);

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantId]);

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
        committedIntents: COMMITTED_INTENTS,
        deferredIntents: DEFERRED_INTENTS,
        deferredReason: DEFERRED_REASON,
        auditLogId: auditResult.rows[0].id,
        outboxId: outboxResult.rows[0].id,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
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
