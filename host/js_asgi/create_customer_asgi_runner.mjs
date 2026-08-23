import { createCustomerAsgiComposition } from "../../src/delivery/create-customer-asgi-composition.mjs";
import { ActorId, Principal, TenantId } from "../../src/domain/identity-primitives.mjs";

// =====================================================================================
// create_customer_asgi_runner.mjs
//
// The smallest Node standard-library-only boundary runner that lets the Python
// StdioJsAsgiBridge (host/python_asgi/metaframer_kernel_host_bridge.py) delegate one HTTP
// request to the real JS Kernel createCustomerAsgiComposition.app boundary. It reads exactly
// one JSON envelope { scope, bodyBase64 } from stdin (the shape V15D's bridge writes), replays
// it through the real composition's app(scope, receive, send), collects the ASGI response
// events, and writes them back to stdout as a JSON list with bodyBase64/headersBase64 fields —
// the shape V15D's bridge expects to decode.
//
// This runner always constructs the composition with a deterministic DENY policy candidate, so
// no database connection is ever touched: connectionString is a never-connected placeholder
// string, safe only because the DENY outcome short-circuits before any commit. This is a smoke
// runner for the DENY path only, not a general-purpose host bridge target.
//
// No env read, no network, no HTTP/ASGI server import, no host server selection.
// =====================================================================================

const NEVER_CONNECTED_CONNECTION_STRING = "postgres://user:pass@localhost:5432/never_connected";
const FALLBACK_TENANT = "22222222-2222-4222-8222-222222222222";
const FALLBACK_ACTOR = "js-boundary-runner";
const DENY_CANDIDATE = Object.freeze({ policyId: "deny.everything", effect: "deny", applies: true });

// Reads x-tenant-id/x-actor-id straight out of the scope headers (if present) so the runner's
// deterministic principal matches the request's own ActionSpec tenant/actor, instead of forcing
// every DENY smoke request onto one hardcoded identity.
function headerValue(headers, name) {
  if (!Array.isArray(headers)) return undefined;
  for (const pair of headers) {
    if (Array.isArray(pair) && pair.length === 2 && String(pair[0]).toLowerCase() === name) {
      return String(pair[1]);
    }
  }
  return undefined;
}

function fail(message) {
  process.stderr.write(`create_customer_asgi_runner: ${message}\n`);
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function checkEnvelope(envelope) {
  if (!isOrdinaryObject(envelope)) return "envelope must be a JSON object";
  if (!isOrdinaryObject(envelope.scope)) return "envelope.scope must be a JSON object";
  if (typeof envelope.bodyBase64 !== "string" || !BASE64_PATTERN.test(envelope.bodyBase64)) {
    return "envelope.bodyBase64 must be a base64 string";
  }
  return undefined;
}

// The Python bridge JSON-safe-encodes any bytes scope field as {__bytesBase64__: "..."}. This
// runner's app only needs strings, so bytes-wrapped values are decoded back to UTF-8 strings.
function unwrapJsonSafe(value) {
  if (Array.isArray(value)) return value.map(unwrapJsonSafe);
  if (isOrdinaryObject(value)) {
    if (typeof value.__bytesBase64__ === "string" && Object.keys(value).length === 1) {
      return Buffer.from(value.__bytesBase64__, "base64").toString("utf-8");
    }
    const unwrapped = {};
    for (const [key, inner] of Object.entries(value)) {
      unwrapped[key] = unwrapJsonSafe(inner);
    }
    return unwrapped;
  }
  return value;
}

function encodeEventsForStdout(events) {
  return events.map((event) => {
    if (event.type === "http.response.start") {
      const headersBase64 = event.headers.map(([name, value]) => [
        Buffer.from(name).toString("base64"),
        Buffer.from(value).toString("base64"),
      ]);
      return { type: event.type, status: event.status, headersBase64 };
    }
    if (event.type === "http.response.body") {
      return {
        type: event.type,
        bodyBase64: Buffer.from(event.body).toString("base64"),
        more_body: event.more_body,
      };
    }
    return event;
  });
}

async function main() {
  const raw = await readStdin();

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    fail(`malformed JSON envelope on stdin: ${error.message}`);
    return;
  }

  const problem = checkEnvelope(envelope);
  if (problem !== undefined) {
    fail(problem);
    return;
  }

  const scope = unwrapJsonSafe(envelope.scope);
  const body = Buffer.from(envelope.bodyBase64, "base64");

  const tenant = headerValue(scope.headers, "x-tenant-id") || FALLBACK_TENANT;
  const actor = headerValue(scope.headers, "x-actor-id") || FALLBACK_ACTOR;

  const composition = createCustomerAsgiComposition({
    connectionString: NEVER_CONNECTED_CONNECTION_STRING,
    current: async () => new Principal(new TenantId(tenant), new ActorId(actor)),
    candidatesFor: async () => [DENY_CANDIDATE],
    evaluateInvariants: async () => ({ ok: true }),
  });

  try {
    let bodyDelivered = false;
    const receive = async () => {
      if (bodyDelivered) {
        return { type: "http.request", body: new Uint8Array(), more_body: false };
      }
      bodyDelivered = true;
      return { type: "http.request", body: new Uint8Array(body), more_body: false };
    };

    const sentEvents = [];
    const send = async (event) => {
      sentEvents.push(event);
    };

    await composition.app(scope, receive, send);

    process.stdout.write(JSON.stringify(encodeEventsForStdout(sentEvents)));
  } finally {
    await composition.close();
  }
}

main().catch((error) => {
  fail(`unhandled runner error: ${error && error.stack ? error.stack : error}`);
});
