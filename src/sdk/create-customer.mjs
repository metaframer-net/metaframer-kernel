// Generated SDK artifact for CreateCustomer@1.
//
// Byte-derived from the frozen protocol contract in
// planning/gj01-generated-sdk-protocol-readiness.json, which itself pins the ActionSpec fields,
// outcomes and error envelope fields already closed by src/application/create-customer-pipeline.mjs.
// This module imports nothing — not the application runtime, not a framework, not a delivery
// package — and performs no capability access: no network, no environment read, no clock, no
// random value, no file I/O. It is a generated data/behavior artifact only, not a runtime.

export const ACTION_NAME = "customer.create";
export const ACTION_VERSION = 1;

export const ACTION_SPEC_FIELDS = Object.freeze([
  "requestId",
  "actorId",
  "tenantId",
  "payload",
  "idempotencyKey",
]);

export const OUTCOMES = Object.freeze(["ALLOW_COMMIT", "DENY", "INVALID", "CROSS_TENANT_DENY"]);

export const ERROR_ENVELOPE_FIELDS = Object.freeze(["code", "message", "requestId", "retryable"]);

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Build a CreateCustomer@1 ActionSpec carrying exactly the pinned fields, or throw on the first
 * missing or extra one. Pure: no defaulting and no coercion beyond the exact-shape check itself.
 */
export function buildCreateCustomerActionSpec(input) {
  if (!isOrdinaryObject(input)) {
    throw new TypeError("CreateCustomer@1 ActionSpec needs an ordinary object");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== ACTION_SPEC_FIELDS.length || ACTION_SPEC_FIELDS.some((key) => !keys.includes(key))) {
    throw new TypeError(`CreateCustomer@1 ActionSpec must carry exactly these keys: ${ACTION_SPEC_FIELDS.join(", ")}`);
  }
  return Object.freeze({
    requestId: input.requestId,
    actorId: input.actorId,
    tenantId: input.tenantId,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  });
}

/** True only for one of the four pinned CreateCustomer@1 outcomes. */
export function isCreateCustomerOutcome(value) {
  return typeof value === "string" && OUTCOMES.includes(value);
}

/** True only for an ordinary object carrying exactly the pinned error-envelope fields. */
export function isCreateCustomerErrorEnvelope(value) {
  if (!isOrdinaryObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === ERROR_ENVELOPE_FIELDS.length
    && ERROR_ENVELOPE_FIELDS.every((field) => keys.includes(field));
}

Object.freeze(buildCreateCustomerActionSpec);
Object.freeze(isCreateCustomerOutcome);
Object.freeze(isCreateCustomerErrorEnvelope);
