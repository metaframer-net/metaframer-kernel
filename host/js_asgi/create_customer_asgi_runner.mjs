import { randomBytes } from "node:crypto";
import {
  createAuditedCustomerAsgiComposition,
  createCustomerAsgiComposition,
} from "../../src/delivery/create-customer-asgi-composition.mjs";
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
// V15E added a deterministic DENY-only mode (no CLI args, hardcoded deny candidate, a
// never-connected placeholder connection string). V15F extends this with an explicit CLI-args
// policy switch:
//   --policy deny                  (default): identical to V15E's always-DENY, never-connected
//                                   behavior; no CLI args at all also selects this default.
//   --policy allow --connection-string <postgres-url>: candidatesFor returns a deterministic
//                                   ALLOW candidate and the composition connects to the real
//                                   PostgreSQL database at the given connection string. allow
//                                   requires --connection-string; omitting it is a malformed-args
//                                   failure.
//
// P21A adds the trusted-identity boundary. Allow mode is the only mode that can reach a real
// database, so it additionally requires --trusted-tenant-id and --trusted-actor-id, and builds
// its authenticated Principal from those two explicit trusted inputs of this process and from
// nothing else. The request's own x-tenant-id / x-actor-id headers stay exactly as sent and stay
// claims: the composition compares them against the trusted Principal and answers
// CROSS_TENANT_DENY or IDENTITY_MISMATCH before any write. A missing or malformed trusted input
// is a deterministic malformed-CLI-args exit before the composition exists, so nothing reaches
// stdout and no database is contacted. Deny mode and the no-args default are untouched and keep
// deriving their deterministic principal from the request headers. This is a test-runner
// identity-injection contract only: not production authentication, no session, no credential
// check, no token, no hosted-readiness claim.
//
// P21F adds the audited host runner. P21C/P21D/P21E made every boundary decision durably
// auditable in JS, but this runner — the one path a real Python ASGI host actually drives — still
// composed the unaudited createCustomerAsgiComposition, so a request that arrives the way it will
// really arrive committed with no decision on record. One additive, explicit, value-bearing
// argument closes exactly that gap:
//   --audit on|off  (default off): the value is mandatory and closed; a missing value, a value
//                                  that is the next flag, and any value that is not exactly "on"
//                                  or "off" are deterministic malformed-CLI-args exits before
//                                  stdin is read and before any database is contacted.
//   --audit on                     is admissible only together with --policy allow: deny mode
//                                  never reaches a database, so there is no decision worth a
//                                  durable record and asking for one there fails closed.
//   --audit on --policy allow      selects createAuditedCustomerAsgiComposition, so every policy
//                                  decision and every identity-guard refusal this process reaches
//                                  is appended to the append-only, hash-chained policy_decision_log
//                                  before the invariant stage or any commit, and a decision that
//                                  cannot be recorded stops the request: the runner exits non-zero
//                                  with nothing on stdout rather than answering an unaudited 2xx.
// An omitted --audit and an explicit --audit off are the same runner: the no-args default,
// --policy deny and unaudited --policy allow keep composing createCustomerAsgiComposition from
// exactly the collaborators they composed it from before. The audit is opt-in and is never
// switched on behind the caller.
//
// The audited composition's `idGenerator` and `now` are collaborators it does not own, so the host
// supplies them here — this is the ring where a capability belongs. Both are dependency-free and
// built from the Node standard library alone: canonical Crockford-base32 ULIDs whose 48-bit
// millisecond prefix is this process's own reading of the clock and whose 80 random bits come from
// node:crypto, and a real UTC-millisecond instant. Neither the id nor the instant can be injected
// through a CLI argument: a host that let a caller name the time or the id of its own audit row
// would be recording the caller's claim rather than what happened.
//
// No env read: the connection string and both trusted identity inputs come only from explicit
// CLI args, never from process.env. No network listener, no HTTP/ASGI server import, no host
// server selection.
// =====================================================================================

const NEVER_CONNECTED_CONNECTION_STRING = "postgres://user:pass@localhost:5432/never_connected";
const FALLBACK_TENANT = "22222222-2222-4222-8222-222222222222";
const FALLBACK_ACTOR = "js-boundary-runner";
const DENY_CANDIDATE = Object.freeze({ policyId: "deny.everything", effect: "deny", applies: true });
const ALLOW_CANDIDATE = Object.freeze({ policyId: "allow.everything", effect: "allow", applies: true });
const [AUDIT_ON, AUDIT_OFF] = ["on", "off"];

// -------------------------------------------------------------------------------------
// The host's two audit collaborators
//
// The audited composition mints no id and reads no clock of its own, on purpose: those are
// capabilities, and a composition root is the wrong ring to hold one. This runner is a host
// process, so it is the right ring, and it builds both from the Node standard library alone —
// no ULID package, no date library, no new dependency.
// -------------------------------------------------------------------------------------

// Crockford base32, the alphabet a canonical ULID is spelled in: ten digits and twenty-two
// letters, with I, L, O and U left out so a transcribed id cannot be misread.
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LENGTH = 10;
const ULID_RANDOM_LENGTH = 16;

/**
 * One canonical uppercase 26-character ULID: ten characters carrying this reading of the clock as
 * a 48-bit big-endian millisecond count, then sixteen characters of randomness.
 *
 * Each random character takes the low five bits of its own byte from node:crypto. That is exactly
 * uniform rather than merely close to it, because 256 is a whole multiple of 32, so no value of
 * the alphabet is reached more often than any other and no rejection loop is needed.
 */
function mintUlid() {
  let remaining = Date.now();
  let time = "";
  for (let position = 0; position < ULID_TIME_LENGTH; position += 1) {
    time = CROCKFORD_BASE32[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  let random = "";
  for (const byte of randomBytes(ULID_RANDOM_LENGTH)) {
    random += CROCKFORD_BASE32[byte % 32];
  }
  return time + random;
}

/** This process's own reading of the wall clock, in the canonical UTC millisecond form the Clock
 * port admits — the same instant the ULID above carries, spelled the way the log stores it. */
function utcMillisecondInstant() {
  return new Date().toISOString();
}

// Reads x-tenant-id/x-actor-id straight out of the scope headers (if present) so the runner's
// deterministic principal matches the request's own ActionSpec tenant/actor, instead of forcing
// every smoke request onto one hardcoded identity.
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

// The same canonical forms the domain's own identity primitives enforce (TenantId/ActorId),
// checked here so a malformed trusted input is refused as a CLI-args failure before the
// composition is constructed, rather than as a constructor throw once a database is already
// reachable.
const TRUSTED_UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TRUSTED_ACTOR_FORM = /^[\x21-\x7e]{1,128}$/;

function checkTrustedTenantId(value) {
  if (!TRUSTED_UUID_FORM.test(value)) {
    return "--trusted-tenant-id must be a canonical lowercase hyphenated UUID in 8-4-4-4-12 form";
  }
  if (value === NIL_UUID) return "--trusted-tenant-id must not be the nil UUID";
  return undefined;
}

function checkTrustedActorId(value) {
  if (value.length === 0) return "--trusted-actor-id must not be empty";
  if (!TRUSTED_ACTOR_FORM.test(value)) {
    return "--trusted-actor-id must be 1-128 visible ASCII characters";
  }
  return undefined;
}

function parseArgs(argv) {
  const args = {
    policy: "deny", connectionString: undefined, trustedTenantId: undefined, trustedActorId: undefined,
    audit: AUDIT_OFF,
  };
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag === "--policy") {
      const value = argv[i + 1];
      if (value === undefined) return { error: "--policy requires a value" };
      if (value !== "deny" && value !== "allow") return { error: `--policy must be "deny" or "allow", got ${JSON.stringify(value)}` };
      args.policy = value;
      i += 2;
      continue;
    }
    if (flag === "--connection-string") {
      const value = argv[i + 1];
      if (value === undefined) return { error: "--connection-string requires a value" };
      if (value.length === 0) return { error: "--connection-string must not be empty" };
      args.connectionString = value;
      i += 2;
      continue;
    }
    if (flag === "--trusted-tenant-id") {
      const value = argv[i + 1];
      if (value === undefined) return { error: "--trusted-tenant-id requires a value" };
      const problem = checkTrustedTenantId(value);
      if (problem !== undefined) return { error: problem };
      args.trustedTenantId = value;
      i += 2;
      continue;
    }
    if (flag === "--trusted-actor-id") {
      const value = argv[i + 1];
      if (value === undefined) return { error: "--trusted-actor-id requires a value" };
      const problem = checkTrustedActorId(value);
      if (problem !== undefined) return { error: problem };
      args.trustedActorId = value;
      i += 2;
      continue;
    }
    if (flag === "--audit") {
      // The value is mandatory and closed. It is read positionally, so a following flag is taken
      // as the value and refused as one rather than silently turning the audit on.
      const value = argv[i + 1];
      if (value === undefined) return { error: "--audit requires a value" };
      if (value !== AUDIT_ON && value !== AUDIT_OFF) {
        return { error: `--audit must be "${AUDIT_ON}" or "${AUDIT_OFF}", got ${JSON.stringify(value)}` };
      }
      args.audit = value;
      i += 2;
      continue;
    }
    return { error: `unrecognized argument: ${flag}` };
  }
  // Deny mode and the no-args default never reach a database, so there is no decision worth a
  // durable record: asking to audit one is refused here, before the composition exists. Turning
  // the audit explicitly off is never an error, because that is what this runner already was.
  if (args.audit === AUDIT_ON && args.policy !== "allow") {
    return { error: `--audit ${AUDIT_ON} requires --policy allow` };
  }
  if (args.policy === "allow") {
    if (args.connectionString === undefined) {
      return { error: "--policy allow requires --connection-string" };
    }
    if (args.trustedTenantId === undefined) {
      return { error: "--policy allow requires --trusted-tenant-id" };
    }
    if (args.trustedActorId === undefined) {
      return { error: "--policy allow requires --trusted-actor-id" };
    }
  }
  return { args };
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
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    fail(`malformed CLI args: ${parsed.error}`);
    return;
  }
  const { policy, connectionString, trustedTenantId, trustedActorId, audit } = parsed.args;

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

  // Allow mode takes its authenticated identity only from the trusted CLI inputs, so the request's
  // own headers stay claims for the composition to check. Deny mode keeps the V15E behavior.
  const tenant = policy === "allow"
    ? trustedTenantId
    : headerValue(scope.headers, "x-tenant-id") || FALLBACK_TENANT;
  const actor = policy === "allow"
    ? trustedActorId
    : headerValue(scope.headers, "x-actor-id") || FALLBACK_ACTOR;

  // The only difference an audited run makes to the four collaborators below is that two more
  // join them: the same connection string, the same trusted principal, the same candidate and the
  // same invariant stage reach the audited factory, so what the boundary decides does not change —
  // only whether the decision is written down before it is acted on.
  const composition = policy === "allow" && audit === AUDIT_ON
    ? createAuditedCustomerAsgiComposition({
      connectionString,
      current: async () => new Principal(new TenantId(tenant), new ActorId(actor)),
      candidatesFor: async () => [ALLOW_CANDIDATE],
      evaluateInvariants: async () => ({ ok: true }),
      idGenerator: async () => mintUlid(),
      now: async () => utcMillisecondInstant(),
    })
    : createCustomerAsgiComposition({
      connectionString: policy === "allow" ? connectionString : NEVER_CONNECTED_CONNECTION_STRING,
      current: async () => new Principal(new TenantId(tenant), new ActorId(actor)),
      candidatesFor: async () => [policy === "allow" ? ALLOW_CANDIDATE : DENY_CANDIDATE],
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
