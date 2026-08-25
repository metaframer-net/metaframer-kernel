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
// adapter, or the underlying UnitOfWork-backed commit resource. `app` is the smallest framework-neutral
// ASGI-shaped async (scope, receive, send) callable, delegating to asgi.callFromReceive with a
// default JSON body decoder: it is host-adapter-ready at the protocol boundary (its call shape
// matches what ASGI servers such as Uvicorn or Hypercorn invoke), but this package is JavaScript,
// not Python, and neither Uvicorn nor Hypercorn can call it directly — actually hosting it under
// either requires a separate Python host bridge/shim outside this package, which is not implemented
// here. This is not a Python ASGI app and not a framework/server integration.
//
// Framework-free and capability-free by construction: no HTTP/ASGI server import, no FastAPI, no
// Django, no Uvicorn, no Hypercorn, no fetch, no fs/net/http import, no clock, no random value,
// no environment read, no network listener. This is a composition root, not a server, and does
// not select or implement a host.
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

// Default JSON response body encoder for the ASGI-shaped callable entrypoint: an ordinary JS
// response body is JSON-stringified and encoded as UTF-8 bytes, matching the Uint8Array chunk an
// ASGI `http.response.body` event carries; forwarding that chunk to a real Uvicorn/Hypercorn
// process still needs a separate Python host bridge/shim outside this package.
function encodeJsonBody(body) {
  return utf8Encoder.encode(JSON.stringify(body));
}

// Default response header encoder for the ASGI-shaped callable entrypoint: an ASGI response
// header name or value (already a string in the internal profile events) is encoded as UTF-8
// bytes, matching the Uint8Array pairs an ASGI `http.response.start` event carries.
function encodeUtf8HeaderPart(part) {
  return utf8Encoder.encode(part);
}

const REQUIRED_OPTIONS_KEYS = ["connectionString", "current", "candidatesFor", "evaluateInvariants"];
const OPTIONAL_OPTIONS_KEYS = ["maxBodyBytes"];
const OPTIONS_KEYS = [...REQUIRED_OPTIONS_KEYS, ...OPTIONAL_OPTIONS_KEYS];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createCustomerAsgiComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  const hasOnlyKnownKeys = keys.every((key) => OPTIONS_KEYS.includes(key));
  const hasAllRequiredKeys = REQUIRED_OPTIONS_KEYS.every((key) => keys.includes(key));
  if (!hasOnlyKnownKeys || !hasAllRequiredKeys) {
    throw new TypeError(`createCustomerAsgiComposition options must carry these required keys: ${REQUIRED_OPTIONS_KEYS.join(", ")}, and may optionally carry: ${OPTIONAL_OPTIONS_KEYS.join(", ")}`);
  }
  const { connectionString, current, candidatesFor, evaluateInvariants, maxBodyBytes } = options;
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
  if (keys.includes("maxBodyBytes")
    && (typeof maxBodyBytes !== "number" || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0)) {
    throw new TypeError("createCustomerAsgiComposition maxBodyBytes must be a non-negative safe integer when provided");
  }
  return {
    connectionString, current, candidatesFor, evaluateInvariants,
    maxBodyBytes: keys.includes("maxBodyBytes") ? maxBodyBytes : undefined,
  };
}

/**
 * Wire one real createCustomerComposition handler to a real CreateCustomerHttpMessageAdapter, a
 * real StandardRouter (exactly one route: POST /customers) and a real AsgiCoreProfileAdapter,
 * from exactly the four caller-supplied collaborators. Returns a frozen
 * `{ asgi, router, app, close }` object; `app` is an async (scope, receive, send) ASGI-shaped
 * callable, host-adapter-ready at the protocol boundary but not directly callable by Uvicorn or
 * Hypercorn without a separate Python host bridge/shim outside this package, and `close` closes
 * the composed UnitOfWork-backed commit resource.
 */
export function createCustomerAsgiComposition(options) {
  const { connectionString, current, candidatesFor, evaluateInvariants, maxBodyBytes } = checkOptions(options);

  const base = createCustomerComposition({ connectionString, current, candidatesFor, evaluateInvariants });
  const httpMessageAdapter = new CreateCustomerHttpMessageAdapter({ handler: base.handler });
  const router = new StandardRouter({
    routes: [{ method: "POST", path: "/customers", handler: httpMessageAdapter }],
  });
  const asgi = new AsgiCoreProfileAdapter({ router });

  const app = async (scope, receive, send) =>
    asgi.callFromReceive({
      scope,
      receive,
      send,
      decodeBody: decodeJsonBody,
      encodeResponseBody: encodeJsonBody,
      encodeResponseHeader: encodeUtf8HeaderPart,
      maxBodyBytes,
    });

  Object.freeze(app);

  return Object.freeze({
    asgi,
    router,
    app,
    close: base.close,
  });
}
Object.freeze(createCustomerAsgiComposition);
