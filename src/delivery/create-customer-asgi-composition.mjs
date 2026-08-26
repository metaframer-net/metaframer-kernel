import { createCustomerComposition, createAuditedCustomerComposition } from "./create-customer-composition.mjs";
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
// matches what a real ASGI server process invokes), but this package is JavaScript, not Python,
// and no Python ASGI server can call it directly — actually hosting it under one requires a
// separate Python host bridge/shim outside this package, which is not implemented here. This is
// not a Python ASGI app and not a framework/server integration.
//
// Framework-free and capability-free by construction: no HTTP/ASGI server import, no web
// framework, no Python ASGI server, no fetch, no fs/net/http import, no clock, no random value,
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
// ASGI `http.response.body` event carries; forwarding that chunk to a real Python ASGI server
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

// The one protocol-boundary wiring both factories below share: a base { handler, close } pair is
// wrapped in a real CreateCustomerHttpMessageAdapter, a real one-route StandardRouter and a real
// AsgiCoreProfileAdapter, and handed back as the frozen { asgi, router, app, close } result with a
// frozen ASGI-shaped (scope, receive, send) callable. It decides nothing and validates nothing:
// admission stays with each factory's own option gate, and `close` is the base's own close, passed
// through unchanged, so neither factory's lifecycle contract is reinterpreted here.
function composeAsgiOver(base, maxBodyBytes) {
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
 * callable, host-adapter-ready at the protocol boundary but not directly callable by a Python
 * ASGI server without a separate Python host bridge/shim outside this package, and `close` closes
 * the composed UnitOfWork-backed commit resource.
 */
export function createCustomerAsgiComposition(options) {
  const { connectionString, current, candidatesFor, evaluateInvariants, maxBodyBytes } = checkOptions(options);

  const base = createCustomerComposition({ connectionString, current, candidatesFor, evaluateInvariants });

  return composeAsgiOver(base, maxBodyBytes);
}
Object.freeze(createCustomerAsgiComposition);

// =====================================================================================
// createAuditedCustomerAsgiComposition
//
// The same protocol-boundary composition root over the audited handler. P21C made the boundary's
// authorization decision durably auditable, but only at the handler seam: the factory above still
// wires the unaudited createCustomerComposition, so a request that actually arrives through the
// ASGI callable reached the pipeline with an unrecorded decision. This factory is purely additive
// — it changes nothing above it — and closes exactly that gap by wiring createAuditedCustomerComposition
// through the very same http message adapter, one-route router and ASGI core profile adapter, so
// every decision an ASGI request reaches is appended to the append-only, hash-chained
// policy_decision_log before the invariant stage or any commit, and a decision that cannot be
// logged stops the request instead of answering 2xx unaudited.
//
// It admits exactly the six data collaborators createAuditedCustomerComposition admits, plus the
// same optional maxBodyBytes the factory above accepts, and hands back the same frozen
// { asgi, router, app, close } shape. `close` is the audited base's own close, passed through
// unchanged, so the two pools that composition owns stay its to release.
//
// Framework-free and capability-free exactly as above: `idGenerator` and `now` are collaborators,
// not capabilities — this module still mints no id, reads no ambient clock, environment value or
// random value of its own, imports no host or framework surface, and selects no host.
// =====================================================================================

const AUDITED_REQUIRED_OPTIONS_KEYS = [
  "connectionString", "current", "candidatesFor", "evaluateInvariants", "idGenerator", "now",
];

const AUDITED_FUNCTION_OPTIONS_KEYS = ["current", "candidatesFor", "evaluateInvariants", "idGenerator", "now"];

const AUDITED_KEYS_REFUSAL = `createAuditedCustomerAsgiComposition options must carry exactly these six own enumerable data keys: ${AUDITED_REQUIRED_OPTIONS_KEYS.join(", ")}, and may optionally carry the own enumerable data key: ${OPTIONAL_OPTIONS_KEYS.join(", ")}`;

/**
 * Take the six audited collaborators, and the optional maxBodyBytes, out of the one options
 * object — or refuse, synchronously and in full, before the base factory runs and therefore before
 * a single pool, adapter or connection exists: a refused option set leaves nothing behind to close.
 *
 * Keys are counted with `Reflect.ownKeys`, so a symbol-keyed member counts as an extra key rather
 * than arriving unannounced, and each admitted key is read through its own property descriptor
 * rather than by property access, so an accessor-backed or non-enumerable member is refused rather
 * than invoked. Reading an option may not run caller code.
 */
function checkAuditedOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createAuditedCustomerAsgiComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  const carriesMaxBodyBytes = keys.includes("maxBodyBytes");
  const admitted = carriesMaxBodyBytes
    ? [...AUDITED_REQUIRED_OPTIONS_KEYS, "maxBodyBytes"]
    : AUDITED_REQUIRED_OPTIONS_KEYS;
  if (keys.length !== admitted.length) {
    throw new TypeError(AUDITED_KEYS_REFUSAL);
  }
  const checked = {};
  for (const key of admitted) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(AUDITED_KEYS_REFUSAL);
    }
    checked[key] = descriptor.value;
  }
  if (typeof checked.connectionString !== "string" || !checked.connectionString) {
    throw new TypeError("createAuditedCustomerAsgiComposition connectionString must be a non-empty string");
  }
  for (const key of AUDITED_FUNCTION_OPTIONS_KEYS) {
    if (typeof checked[key] !== "function") {
      throw new TypeError(`createAuditedCustomerAsgiComposition ${key} must be a function`);
    }
  }
  if (carriesMaxBodyBytes
    && (typeof checked.maxBodyBytes !== "number" || !Number.isSafeInteger(checked.maxBodyBytes) || checked.maxBodyBytes < 0)) {
    throw new TypeError("createAuditedCustomerAsgiComposition maxBodyBytes must be a non-negative safe integer when provided");
  }
  return {
    audited: {
      connectionString: checked.connectionString,
      current: checked.current,
      candidatesFor: checked.candidatesFor,
      evaluateInvariants: checked.evaluateInvariants,
      idGenerator: checked.idGenerator,
      now: checked.now,
    },
    maxBodyBytes: carriesMaxBodyBytes ? checked.maxBodyBytes : undefined,
  };
}

/**
 * Wire one real createAuditedCustomerComposition handler to a real CreateCustomerHttpMessageAdapter,
 * a real StandardRouter (exactly one route: POST /customers) and a real AsgiCoreProfileAdapter,
 * from exactly the six caller-supplied collaborators plus the optional maxBodyBytes. Returns a
 * frozen `{ asgi, router, app, close }` object whose `app` carries the boundary's decision audit
 * all the way to the protocol boundary; `close` is the audited composition's own close, which
 * releases both pools that composition owns.
 */
export function createAuditedCustomerAsgiComposition(options) {
  const { audited, maxBodyBytes } = checkAuditedOptions(options);

  const base = createAuditedCustomerComposition(audited);

  return composeAsgiOver(base, maxBodyBytes);
}
Object.freeze(createAuditedCustomerAsgiComposition);
