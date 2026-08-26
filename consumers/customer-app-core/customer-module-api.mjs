// P15 — typed customer-module-api consumer boundary.
// Reuses createCustomerAppCoreWithPersistence (P14a) for identity/capability/persistence wiring
// and sdk.buildActionSpec (P08 public SDK) for actionSpec validation before any persistence call.
// Excludes Surface/host/relay/DB/readiness: this module never touches poolFactory/cutover.

import { createCustomerAppCoreWithPersistence } from "./customer-app-core.mjs";
import { canonicalizeCustomerRecord } from "./customer-records-schema.mjs";

const ACTION_COORDINATE = "customer.create@1";
const OPERATIONS = Object.freeze(["recordCustomer"]);
const RECORD_CUSTOMER_KEYS = Object.freeze(["actionSpec", "record", "insertOptions"]);

export const CUSTOMER_MODULE_API_MANIFEST = Object.freeze({
  appSlug: "customer",
  moduleSlug: "customer-core",
  requiredCapabilities: Object.freeze(["customer:core"]),
  defaultDeny: true,
  actionCoordinate: ACTION_COORDINATE,
  operations: OPERATIONS,
});

function isOrdinaryObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function createCustomerModuleApi({ sdk, coordinate, grantedCapabilities, cutoverOptions } = {}) {
  const appCore = createCustomerAppCoreWithPersistence({ sdk, coordinate, grantedCapabilities, cutoverOptions });

  if (sdk?.ACTION_NAME !== "customer.create" || sdk?.ACTION_VERSION !== 1) {
    throw new Error("createCustomerModuleApi requires the sdk to be customer.create@1");
  }

  async function recordCustomer(args) {
    if (!isOrdinaryObject(args)) {
      throw new TypeError("recordCustomer requires an ordinary options object");
    }
    const keys = Reflect.ownKeys(args);
    if (keys.length !== RECORD_CUSTOMER_KEYS.length || !RECORD_CUSTOMER_KEYS.every((key) => keys.includes(key))) {
      throw new TypeError("recordCustomer requires exactly {actionSpec, record, insertOptions}");
    }
    const { actionSpec, record, insertOptions } = args;

    if (!isOrdinaryObject(insertOptions)) {
      throw new TypeError("recordCustomer requires an insertOptions object");
    }
    if (!isOrdinaryObject(insertOptions.audit)) {
      throw new TypeError("recordCustomer requires an ordinary insertOptions.audit object");
    }
    if (!isOrdinaryObject(insertOptions.transactionalOutbox)) {
      throw new TypeError("recordCustomer requires an ordinary insertOptions.transactionalOutbox object");
    }
    if (!isOrdinaryObject(insertOptions.idempotency)) {
      throw new TypeError("recordCustomer requires an ordinary insertOptions.idempotency object");
    }

    const built = sdk.buildActionSpec(actionSpec);
    const canonical = canonicalizeCustomerRecord(record);

    if (built.tenantId !== canonical.tenant_id || built.tenantId !== insertOptions.tenantId) {
      throw new Error("recordCustomer requires the built tenantId to match the canonical record and insertOptions");
    }

    const { action: auditAction, correlationId: auditCorrelationId } = insertOptions.audit;
    const { eventName, correlationId: outboxCorrelationId } = insertOptions.transactionalOutbox;
    const { fingerprint } = insertOptions.idempotency;
    if (typeof auditAction !== "string" || auditAction === "") {
      throw new Error("recordCustomer requires a non-empty insertOptions.audit.action");
    }
    if (typeof auditCorrelationId !== "string" || auditCorrelationId === "") {
      throw new Error("recordCustomer requires a non-empty insertOptions.audit.correlationId");
    }
    if (typeof eventName !== "string" || eventName === "") {
      throw new Error("recordCustomer requires a non-empty insertOptions.transactionalOutbox.eventName");
    }
    if (typeof outboxCorrelationId !== "string" || outboxCorrelationId === "") {
      throw new Error("recordCustomer requires a non-empty insertOptions.transactionalOutbox.correlationId");
    }
    if (typeof fingerprint !== "string" || fingerprint === "") {
      throw new Error("recordCustomer requires a non-empty insertOptions.idempotency.fingerprint");
    }
    if (auditCorrelationId !== outboxCorrelationId) {
      throw new Error("recordCustomer requires audit.correlationId to match transactionalOutbox.correlationId");
    }

    const insertResult = await appCore.persistence.insert(canonical, insertOptions);
    void insertResult;
    return Object.freeze({ ok: true, record: canonical });
  }

  return Object.freeze({
    sdkCoordinate: appCore.sdkCoordinate,
    status: appCore.status,
    manifest: CUSTOMER_MODULE_API_MANIFEST,
    recordCustomer,
  });
}
