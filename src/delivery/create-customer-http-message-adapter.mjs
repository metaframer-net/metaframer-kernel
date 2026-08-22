import { CreateCustomerRequestHandler } from "./create-customer-request-handler.mjs";

// CreateCustomerHttpMessageAdapter: the smallest framework-neutral HTTP message boundary for
// CreateCustomer@1. Maps an ordinary { method, path, headers, body } message to the
// CreateCustomerRequestHandler request shape, calls exactly one injected handler instance, and
// returns a frozen { status, headers, body } response — never a Node http/fetch object, never a
// framework request or response. No HTTP/ASGI/FastAPI/Django/Uvicorn/Hypercorn import, no
// fs/net/http/fetch, no clock/random/env read, no network listener: a message-shaped adapter,
// not a server.

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

const OPTIONS_KEYS = ["handler"];
const MESSAGE_KEYS = ["method", "path", "headers", "body"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("CreateCustomerHttpMessageAdapter needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`CreateCustomerHttpMessageAdapter options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { handler } = options;
  if (!isExactly(handler, CreateCustomerRequestHandler)) {
    throw new TypeError("CreateCustomerHttpMessageAdapter handler must be an exact CreateCustomerRequestHandler instance");
  }
  return { handler };
}

function isValidMessageShape(message) {
  if (!isOrdinaryObject(message)) return false;
  const keys = Reflect.ownKeys(message);
  if (keys.length !== MESSAGE_KEYS.length || MESSAGE_KEYS.some((key) => !keys.includes(key))) return false;
  if (typeof message.method !== "string") return false;
  if (typeof message.path !== "string") return false;
  if (!isOrdinaryObject(message.headers)) return false;
  if (!isOrdinaryObject(message.body)) return false;
  return true;
}

function genericResponse(status, requestId) {
  return Object.freeze({
    status,
    headers: Object.freeze(
      requestId
        ? { "content-type": "application/json", "x-request-id": requestId }
        : { "content-type": "application/json" },
    ),
    body: Object.freeze({
      error: Object.freeze({
        code: status === 405 ? "METHOD_NOT_ALLOWED" : status === 404 ? "NOT_FOUND" : "MESSAGE_SHAPE_INVALID",
        message:
          status === 405
            ? "only POST is supported"
            : status === 404
              ? "only /customers is supported"
              : "the message did not satisfy the framework-neutral HTTP message shape",
        requestId,
        retryable: false,
      }),
    }),
  });
}

function headerValue(headers, name) {
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key === "string" && key.toLowerCase() === name && typeof headers[key] === "string") {
      return headers[key];
    }
  }
  return undefined;
}

function toDeliveryRequest(message) {
  return {
    requestId: headerValue(message.headers, "x-request-id"),
    actorId: headerValue(message.headers, "x-actor-id"),
    tenantId: headerValue(message.headers, "x-tenant-id"),
    payload: message.body,
    idempotencyKey: headerValue(message.headers, "idempotency-key"),
  };
}

function toHttpResponse(deliveryResponse) {
  const requestId = typeof deliveryResponse.requestId === "string" ? deliveryResponse.requestId : "";
  return Object.freeze({
    status: deliveryResponse.status,
    headers: Object.freeze({ "content-type": "application/json", "x-request-id": requestId }),
    body: deliveryResponse.body,
  });
}

export class CreateCustomerHttpMessageAdapter {
  #handler;

  constructor(options) {
    const checked = checkOptions(options);
    this.#handler = checked.handler;
    Object.freeze(this);
  }

  async handle(message) {
    if (!isValidMessageShape(message)) {
      return genericResponse(400, undefined);
    }
    if (message.method !== "POST") {
      return genericResponse(405, headerValue(message.headers, "x-request-id"));
    }
    if (message.path !== "/customers") {
      return genericResponse(404, headerValue(message.headers, "x-request-id"));
    }

    const deliveryResponse = await this.#handler.handle(toDeliveryRequest(message));
    return toHttpResponse(deliveryResponse);
  }

  get [Symbol.toStringTag]() {
    return "CreateCustomerHttpMessageAdapter";
  }
}
Object.freeze(CreateCustomerHttpMessageAdapter.prototype);
Object.freeze(CreateCustomerHttpMessageAdapter);
