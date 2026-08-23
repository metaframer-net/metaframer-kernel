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

const HEADER_NAME_TOKEN_PATTERN = /^[a-z0-9!#$%&'*+\-.^_`|~]+$/;

function isValidHeaderName(name) {
  return typeof name === "string" && HEADER_NAME_TOKEN_PATTERN.test(name);
}

function decodeHeaders(headers) {
  if (!Array.isArray(headers)) return undefined;
  const decoded = {};
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2) return undefined;
    const name = decodeHeaderPart(pair[0]);
    const value = decodeHeaderPart(pair[1]);
    if (name === undefined || value === undefined) return undefined;
    if (!isValidHeaderName(name)) return undefined;
    decoded[name] = value;
  }
  return Object.freeze(decoded);
}

const HTTP_TOKEN_PATTERN = /^[A-Z0-9!#$%&'*+\-.^_`|~]+$/;

function isValidHttpMethod(method) {
  return typeof method === "string" && HTTP_TOKEN_PATTERN.test(method);
}

function isValidScope(scope) {
  return isOrdinaryObject(scope)
    && scope.type === "http"
    && isValidHttpMethod(scope.method)
    && typeof scope.path === "string"
    && scope.path.length > 0
    && scope.path.startsWith("/")
    && Array.isArray(scope.headers);
}

function profileErrorEvents() {
  const start = Object.freeze({
    type: "http.response.start",
    status: 400,
    headers: Object.freeze([Object.freeze(["content-type", "application/json"])]),
  });
  const body = Object.freeze({
    type: "http.response.body",
    body: Object.freeze({ error: Object.freeze({ code: "PROFILE_SCOPE_INVALID", retryable: false }) }),
    more_body: false,
  });
  return Object.freeze([start, body]);
}

const HEADER_VALUE_PATTERN = /^[\x20-\x7E]*$/;

function isValidHeaderValue(value) {
  return typeof value === "string" && HEADER_VALUE_PATTERN.test(value);
}

function checkRouterResponse(response) {
  if (!isOrdinaryObject(response)) {
    throw new TypeError("AsgiCoreProfileAdapter router response must be an ordinary response object");
  }
  const keys = Reflect.ownKeys(response);
  if (keys.length !== 3 || !["status", "headers", "body"].every((key) => keys.includes(key))) {
    throw new TypeError("AsgiCoreProfileAdapter router response must carry exactly status, headers and body");
  }
  if (typeof response.status !== "number" || !Number.isInteger(response.status)
    || response.status < 100 || response.status > 599) {
    throw new TypeError("AsgiCoreProfileAdapter router response status must be an integer in range 100..599");
  }
  if (!isOrdinaryObject(response.headers)) {
    throw new TypeError("AsgiCoreProfileAdapter router response headers must be an ordinary object");
  }
  for (const name of Reflect.ownKeys(response.headers)) {
    if (typeof name !== "string" || !HEADER_NAME_TOKEN_PATTERN.test(name)) {
      throw new TypeError("AsgiCoreProfileAdapter router response header names must be valid lower-case HTTP tokens");
    }
    if (!isValidHeaderValue(response.headers[name])) {
      throw new TypeError("AsgiCoreProfileAdapter router response header values must be safe printable ASCII strings");
    }
  }
  return response;
}

function toResponseEvents(response) {
  const checked = checkRouterResponse(response);
  const headerPairs = Reflect.ownKeys(checked.headers)
    .filter((key) => typeof key === "string")
    .map((name) => [name.toLowerCase(), checked.headers[name]])
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

function checkEncodedBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`AsgiCoreProfileAdapter ${label} must return a Uint8Array`);
  }
  return value;
}

function encodeEvents(events, encodeResponseBody, encodeResponseHeader) {
  return Object.freeze(events.map((event) => {
    if (event.type === "http.response.body") {
      if (encodeResponseBody === undefined) return event;
      const body = checkEncodedBytes(encodeResponseBody(event.body), "encodeResponseBody");
      return Object.freeze({ type: event.type, body, more_body: event.more_body });
    }
    if (event.type === "http.response.start") {
      if (encodeResponseHeader === undefined) return event;
      const headers = event.headers.map(([name, value]) => Object.freeze([
        checkEncodedBytes(encodeResponseHeader(name), "encodeResponseHeader"),
        checkEncodedBytes(encodeResponseHeader(value), "encodeResponseHeader"),
      ]));
      return Object.freeze({ type: event.type, status: event.status, headers: Object.freeze(headers) });
    }
    return event;
  }));
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

  async call({ scope, body, send, encodeResponseBody, encodeResponseHeader } = {}) {
    if (typeof send !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter call needs a send function");
    }
    if (encodeResponseBody !== undefined && typeof encodeResponseBody !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter call encodeResponseBody must be a function when provided");
    }
    if (encodeResponseHeader !== undefined && typeof encodeResponseHeader !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter call encodeResponseHeader must be a function when provided");
    }
    const rawEvents = await this.handle({ scope, body });
    const events = encodeEvents(rawEvents, encodeResponseBody, encodeResponseHeader);
    for (const event of events) {
      await send(event);
    }
    return events;
  }

  async callFromReceive({
    scope, receive, send, decodeBody, encodeResponseBody, encodeResponseHeader, maxBodyBytes,
  } = {}) {
    if (typeof receive !== "function" || typeof send !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter callFromReceive needs receive and send functions");
    }
    if (decodeBody !== undefined && typeof decodeBody !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter callFromReceive decodeBody must be a function when provided");
    }
    if (encodeResponseBody !== undefined && typeof encodeResponseBody !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter callFromReceive encodeResponseBody must be a function when provided");
    }
    if (encodeResponseHeader !== undefined && typeof encodeResponseHeader !== "function") {
      throw new TypeError("AsgiCoreProfileAdapter callFromReceive encodeResponseHeader must be a function when provided");
    }
    if (maxBodyBytes !== undefined
      && (typeof maxBodyBytes !== "number" || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0)) {
      throw new TypeError("AsgiCoreProfileAdapter callFromReceive maxBodyBytes must be a non-negative safe integer when provided");
    }

    const sendErrorEvents = async () => {
      const events = encodeEvents(profileErrorEvents(), encodeResponseBody, encodeResponseHeader);
      for (const event of events) {
        await send(event);
      }
      return events;
    };

    if (!isValidScope(scope) || decodeHeaders(scope.headers) === undefined) {
      return sendErrorEvents();
    }

    const chunks = [];
    let receivedBytes = 0;
    for (;;) {
      const event = await receive();
      if (!isOrdinaryObject(event) || event.type !== "http.request") {
        return sendErrorEvents();
      }
      const chunk = event.body === undefined ? new Uint8Array() : event.body;
      if (!(chunk instanceof Uint8Array)) {
        return sendErrorEvents();
      }
      receivedBytes += chunk.length;
      if (maxBodyBytes !== undefined && receivedBytes > maxBodyBytes) {
        return sendErrorEvents();
      }
      if (Object.hasOwn(event, "more_body")
        && event.more_body !== true
        && event.more_body !== false) {
        return sendErrorEvents();
      }
      chunks.push(chunk);
      if (event.more_body !== true) break;
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    let body;
    if (decodeBody !== undefined) {
      try {
        body = decodeBody(merged);
      } catch {
        return sendErrorEvents();
      }
    } else {
      body = merged;
    }

    return this.call({ scope, body, send, encodeResponseBody, encodeResponseHeader });
  }

  get [Symbol.toStringTag]() {
    return "AsgiCoreProfileAdapter";
  }
}
Object.freeze(AsgiCoreProfileAdapter.prototype);
Object.freeze(AsgiCoreProfileAdapter);
