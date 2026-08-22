import { StandardRouter } from "./standard-router.mjs";

// Framework-neutral ASGI-shaped profile boundary around StandardRouter. Not a Python ASGI app,
// not a server. Extra scope keys (asgi, http_version, scheme, client, ...) are accepted and
// ignored; only type/method/path/headers are read.

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

const OPTIONS_KEYS = ["router"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("AsgiCoreProfileAdapter needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`AsgiCoreProfileAdapter options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { router } = options;
  if (!isExactly(router, StandardRouter)) {
    throw new TypeError("AsgiCoreProfileAdapter router must be an exact StandardRouter instance");
  }
  return { router };
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

function decodeHeaderPart(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return utf8Decoder.decode(value);
  return undefined;
}

function decodeHeaders(headers) {
  if (!Array.isArray(headers)) return undefined;
  const decoded = {};
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2) return undefined;
    const name = decodeHeaderPart(pair[0]);
    const value = decodeHeaderPart(pair[1]);
    if (name === undefined || value === undefined) return undefined;
    decoded[name.toLowerCase()] = value;
  }
  return Object.freeze(decoded);
}

function isValidScope(scope) {
  return isOrdinaryObject(scope)
    && scope.type === "http"
    && typeof scope.method === "string"
    && typeof scope.path === "string"
    && Array.isArray(scope.headers);
}

function profileErrorEvents() {
  const start = Object.freeze({
    type: "http.response.start",
    status: 400,
    headers: Object.freeze([["content-type", "application/json"]]),
  });
  const body = Object.freeze({
    type: "http.response.body",
    body: Object.freeze({ error: Object.freeze({ code: "PROFILE_SCOPE_INVALID", retryable: false }) }),
    more_body: false,
  });
  return Object.freeze([start, body]);
}

function checkRouterResponse(response) {
  if (!isOrdinaryObject(response)) {
    throw new TypeError("AsgiCoreProfileAdapter router response must be an ordinary response object");
  }
  const keys = Reflect.ownKeys(response);
  if (keys.length !== 3 || !["status", "headers", "body"].every((key) => keys.includes(key))) {
    throw new TypeError("AsgiCoreProfileAdapter router response must carry exactly status, headers and body");
  }
  if (typeof response.status !== "number") {
    throw new TypeError("AsgiCoreProfileAdapter router response status must be a number");
  }
  if (!isOrdinaryObject(response.headers)) {
    throw new TypeError("AsgiCoreProfileAdapter router response headers must be an ordinary object");
  }
  return response;
}

function toResponseEvents(response) {
  const checked = checkRouterResponse(response);
  const headerPairs = Reflect.ownKeys(checked.headers)
    .filter((key) => typeof key === "string")
    .map((name) => [name.toLowerCase(), String(checked.headers[name])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const start = Object.freeze({
    type: "http.response.start",
    status: checked.status,
    headers: Object.freeze(headerPairs.map((pair) => Object.freeze(pair))),
  });
  const body = Object.freeze({
    type: "http.response.body",
    body: checked.body,
    more_body: false,
  });
  return Object.freeze([start, body]);
}

export class AsgiCoreProfileAdapter {
  #router;

  constructor(options) {
    const checked = checkOptions(options);
    this.#router = checked.router;
    Object.freeze(this);
  }

  async handle({ scope, body } = {}) {
    if (!isValidScope(scope)) {
      return profileErrorEvents();
    }
    const headers = decodeHeaders(scope.headers);
    if (headers === undefined) {
      return profileErrorEvents();
    }

    const message = Object.freeze({
      method: scope.method,
      path: scope.path,
      headers,
      body,
    });
    const response = await this.#router.handle(message);
    return toResponseEvents(response);
  }

  async call({ scope, body, send } = {}) {
    if (typeof send !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter call needs a send function");
    }
    const events = await this.handle({ scope, body });
    for (const event of events) {
      await send(event);
    }
    return events;
  }

  get [Symbol.toStringTag]() {
    return "AsgiCoreProfileAdapter";
  }
}
Object.freeze(AsgiCoreProfileAdapter.prototype);
Object.freeze(AsgiCoreProfileAdapter);
