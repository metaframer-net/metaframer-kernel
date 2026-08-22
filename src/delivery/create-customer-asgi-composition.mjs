import { createCustomerComposition } from "./create-customer-composition.mjs";
import { CreateCustomerHttpMessageAdapter } from "./create-customer-http-message-adapter.mjs";
import { StandardRouter } from "./standard-router.mjs";
import { AsgiCoreProfileAdapter } from "./asgi-core-profile.mjs";

// =====================================================================================
// createCustomerAsgiComposition
//
// The smallest framework-neutral composition root that wires a real createCustomerComposition
// handler to a real CreateCustomerHttpMessageAdapter, a real StandardRouter (exactly one route:
// POST /customers) and a real AsgiCoreProfileAdapter. It constructs all four from exactly the
// same caller-supplied collaborators createCustomerComposition already accepts, and hands back
// exactly one frozen { asgi, router, app, close } object — never the handler, the http message
// adapter, or the underlying PostgresCommitAdapter. `app` is the smallest framework-neutral ASGI
// callable entrypoint: an async (scope, receive, send) function a host adapter (Uvicorn,
// Hypercorn, ...) can call directly, delegating to asgi.callFromReceive with a default JSON body
// decoder. This is not a Python ASGI app and not a framework/server integration.
//
// Framework-free and capability-free by construction: no HTTP/ASGI server import, no FastAPI, no
// Django, no Uvicorn, no Hypercorn, no fetch, no fs/net/http import, no clock, no random value,
// no environment read, no network listener. This is a composition root, not a server.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

// Default JSON body decoder for the ASGI callable entrypoint: empty bytes decode to an empty
// ordinary object (the http message adapter's accepted empty-body shape); non-empty bytes must
// decode as UTF-8 JSON to an ordinary object, or decoding throws and callFromReceive turns that
// into the existing deterministic ASGI 400 profile response.
function decodeJsonBody(bytes) {
  if (bytes.length === 0) {
    return {};
  }
  const parsed = JSON.parse(utf8Decoder.decode(bytes));
  if (!isOrdinaryObject(parsed)) {
    throw new TypeError("decoded JSON body must be an ordinary object");
  }
  return parsed;
}

// Default JSON response body encoder for the ASGI callable entrypoint: an ordinary JS response
// body is JSON-stringified and encoded as UTF-8 bytes, so a host adapter (Uvicorn, Hypercorn,
// ...) receives the Uint8Array chunk an ASGI `http.response.body` event carries.
function encodeJsonBody(body) {
  return utf8Encoder.encode(JSON.stringify(body));
}

const OPTIONS_KEYS = ["connectionString", "current", "candidatesFor", "evaluateInvariants"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createCustomerAsgiComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`createCustomerAsgiComposition options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { connectionString, current, candidatesFor, evaluateInvariants } = options;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new TypeError("createCustomerAsgiComposition connectionString must be a non-empty string");
  }
  if (typeof current !== "function") {
    throw new TypeError("createCustomerAsgiComposition current must be a function");
  }
  if (typeof candidatesFor !== "function") {
    throw new TypeError("createCustomerAsgiComposition candidatesFor must be a function");
  }
  if (typeof evaluateInvariants !== "function") {
    throw new TypeError("createCustomerAsgiComposition evaluateInvariants must be a function");
  }
  return { connectionString, current, candidatesFor, evaluateInvariants };
}

/**
 * Wire one real createCustomerComposition handler to a real CreateCustomerHttpMessageAdapter, a
 * real StandardRouter (exactly one route: POST /customers) and a real AsgiCoreProfileAdapter,
 * from exactly the four caller-supplied collaborators. Returns a frozen
 * `{ asgi, router, app, close }` object; `app` is an async (scope, receive, send) ASGI callable
 * entrypoint, and `close` closes the composed PostgresCommitAdapter.
 */
export function createCustomerAsgiComposition(options) {
  const checked = checkOptions(options);

  const base = createCustomerComposition(checked);
  const httpMessageAdapter = new CreateCustomerHttpMessageAdapter({ handler: base.handler });
  const router = new StandardRouter({
    routes: [{ method: "POST", path: "/customers", handler: httpMessageAdapter }],
  });
  const asgi = new AsgiCoreProfileAdapter({ router });

  const app = async (scope, receive, send) =>
    asgi.callFromReceive({ scope, receive, send, decodeBody: decodeJsonBody, encodeResponseBody: encodeJsonBody });

  return Object.freeze({
    asgi,
    router,
    app,
    close: base.close,
  });
}
Object.freeze(createCustomerAsgiComposition);
