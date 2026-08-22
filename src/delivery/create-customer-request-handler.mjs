import { CreateCustomerCommitService } from "../application/create-customer-commit-service.mjs";
import { buildCreateCustomerActionSpec } from "../sdk/create-customer.mjs";

// =====================================================================================
// CreateCustomerRequestHandler
//
// A framework-neutral Delivery-ring handler: it accepts an ordinary CreateCustomer@1 request
// object, builds the ActionSpec through the generated SDK, and runs it through exactly one
// injected CreateCustomerCommitService. It returns a frozen, generic delivery response object —
// a status code, the requestId, the outcome and a body — never an HTTP framework request or
// response, never a runtime handle.
//
// Framework-free and capability-free by construction: no framework import, dependency or
// runtime coupling of any kind — no HTTP/ASGI import, no Postgres import, no clock, no random
// value, no environment read, no network or file access. FastAPI, Django, Uvicorn and Hypercorn
// are named here only as non-goals: none of them is imported, depended on or coupled to a
// runtime handle anywhere in this module. This is a delivery-shaped adapter, not a server.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

const OPTIONS_KEYS = ["service"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("CreateCustomerRequestHandler needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`CreateCustomerRequestHandler options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { service } = options;
  if (!isExactly(service, CreateCustomerCommitService)) {
    throw new TypeError("CreateCustomerRequestHandler service must be an exact CreateCustomerCommitService instance");
  }
  return { service };
}

/** A best-effort, non-throwing raw requestId for an error response, even on a malformed request. */
function rawRequestIdOf(request) {
  if (isOrdinaryObject(request) && typeof request.requestId === "string") {
    return request.requestId;
  }
  return "";
}

// Duck-typed, not instanceof: this module stays Postgres-free by construction, and the commit
// port is injected, so the only safe way to recognize the one known duplicate-idempotency
// conflict is the frozen shape PostgresCommitAdapter's IdempotencyConflictError always carries —
// never a generic DB failure, which this handler must keep letting propagate unmasked.
function isIdempotencyConflictError(error) {
  return error != null
    && error.name === "IdempotencyConflictError"
    && error.code === "IDEMPOTENCY_CONFLICT";
}

function idempotencyConflictResponse(requestId) {
  return Object.freeze({
    status: 409,
    requestId,
    outcome: "IDEMPOTENCY_CONFLICT",
    body: Object.freeze({
      error: Object.freeze({
        code: "IDEMPOTENCY_CONFLICT",
        message: "a request with this idempotency fingerprint was already committed",
        requestId,
        retryable: false,
      }),
    }),
  });
}

function invalidActionSpecResponse(request) {
  const requestId = rawRequestIdOf(request);
  return Object.freeze({
    status: 400,
    requestId,
    outcome: "INVALID",
    body: Object.freeze({
      error: Object.freeze({
        code: "ACTION_SPEC_INVALID",
        message: "the request did not satisfy the CreateCustomer@1 delivery shape",
        requestId,
        retryable: false,
      }),
    }),
  });
}

export class CreateCustomerRequestHandler {
  #service;

  constructor(options) {
    const checked = checkOptions(options);
    this.#service = checked.service;
    Object.freeze(this);
  }

  async handle(request) {
    let actionSpec;
    try {
      actionSpec = buildCreateCustomerActionSpec(request);
    } catch {
      return invalidActionSpecResponse(request);
    }

    let result;
    try {
      result = await this.#service.handle(actionSpec);
    } catch (error) {
      if (isIdempotencyConflictError(error)) {
        return idempotencyConflictResponse(rawRequestIdOf(request));
      }
      throw error;
    }

    if (result.outcome === "COMMITTED") {
      return Object.freeze({
        status: 201,
        requestId: result.requestId,
        outcome: "COMMITTED",
        body: Object.freeze({ commitReceipt: result.commitReceipt }),
      });
    }

    if (result.outcome === "INVALID" || result.outcome === "DENY" || result.outcome === "CROSS_TENANT_DENY") {
      return Object.freeze({
        status: result.outcome === "INVALID" ? 400 : 403,
        requestId: result.requestId,
        outcome: result.outcome,
        body: Object.freeze({ error: result.error }),
      });
    }

    throw new TypeError(`CreateCustomerRequestHandler received an unknown service outcome: ${result.outcome}`);
  }

  get [Symbol.toStringTag]() {
    return "CreateCustomerRequestHandler";
  }
}
Object.freeze(CreateCustomerRequestHandler.prototype);
Object.freeze(CreateCustomerRequestHandler);
