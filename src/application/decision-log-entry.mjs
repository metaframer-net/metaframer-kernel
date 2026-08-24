import { createHash } from "node:crypto";

import { PolicyRequest, PolicyDecision } from "./policy-decision.mjs";

// =====================================================================================
// DecisionLogEntry
//
// One append-only, hash-chained record of a single policy decision. Every covered field is
// fixed at construction into a canonical JSON payload, and `entryHash` is the SHA-256 of that
// exact payload — no ambient clock, id, random or I/O. Non-goals: no persisted-row verifier,
// no DB/RLS/WORM, no PDP/batch wiring, no read/update/delete API, no retry/queue/cache.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// Genuine-instance admission, captured once: prototype identity alone admits an object built
// straight on the prototype with no private field, so a captured getter off each frozen
// prototype is the other half — reading it throws unless the receiver carries the private
// state the real constructor installed. This is proof, not an accidental side effect of some
// later read: the probe is invoked deliberately, right here, as part of admission itself.
const REQUEST_BRAND = Object.getOwnPropertyDescriptor(PolicyRequest.prototype, "action").get;
const DECISION_BRAND = Object.getOwnPropertyDescriptor(PolicyDecision.prototype, "effect").get;

const carriesBrand = (brand, value) => {
  try {
    brand.call(value);
    return true;
  } catch {
    return false;
  }
};

// Ordinary-object admission gate, matching Clock and Identity: exotic and null-prototype
// objects are refused before any key is inspected, so an object answering with code of its
// own can never shape what this module reads.
function exactOptions(options, expected, what) {
  if (options === null || typeof options !== "object" || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError(`${what} needs an ordinary options object`);
  }
  const given = Reflect.ownKeys(options);
  if (given.length !== expected.length) {
    throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
    }
  }
  return options;
}

const ULID_FORM = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TS_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const HEX64_FORM = /^[0-9a-f]{64}$/;
const LAYERS = new Set(["system", "platform", "tenant"]);
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function ulidValue(value) {
  if (typeof value !== "string" || !ULID_FORM.test(value)) {
    throw new TypeError("DecisionLogEntry id needs a canonical uppercase 26-character ULID");
  }
  return value;
}

// The Gregorian rule, written out: every fourth year, except centuries, except every fourth one.
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lengthOfMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

// Arithmetic validation, matching the repository Clock contract exactly: no host Date parsing
// anywhere, because a host parser rolls an impossible day into the following month rather than
// refusing it. Year 0000 is refused as below the floor; the shape regexp already bounds every
// field's digit count, so no field can exceed its ceiling by width alone.
function timestampValue(value) {
  if (typeof value !== "string") throw new TypeError("DecisionLogEntry ts needs a primitive string");
  const match = TS_FORM.exec(value);
  if (!match) throw new TypeError("DecisionLogEntry ts needs a canonical UTC millisecond ISO instant");
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);
  if (year < 1) throw new RangeError("DecisionLogEntry ts year 0000 is below the floor");
  if (month < 1 || month > 12) throw new RangeError("DecisionLogEntry ts month must be 01 to 12");
  if (day < 1 || day > lengthOfMonth(year, month)) throw new RangeError("DecisionLogEntry ts day must name a real calendar day");
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError("DecisionLogEntry ts time of day must be a real time");
  return value;
}

function prevHashValue(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !HEX64_FORM.test(value)) {
    throw new TypeError("DecisionLogEntry prevHash needs null or a lowercase 64-hex string");
  }
  return value;
}

function requestValue(value) {
  if (!isExactly(value, PolicyRequest) || !carriesBrand(REQUEST_BRAND, value)) {
    throw new TypeError("DecisionLogEntry request needs an exact genuine PolicyRequest instance");
  }
  return value;
}

function decisionValue(value) {
  if (!isExactly(value, PolicyDecision) || !carriesBrand(DECISION_BRAND, value)) {
    throw new TypeError("DecisionLogEntry decision needs an exact genuine PolicyDecision instance");
  }
  return value;
}

function layerResolvedValue(value, decision) {
  const defaultDeny = decision.matchedPolicyId === null;
  if (defaultDeny) {
    if (value !== null) throw new TypeError("DecisionLogEntry layerResolved must be null for a default-deny decision");
    return null;
  }
  if (typeof value !== "string" || !LAYERS.has(value)) {
    throw new TypeError('DecisionLogEntry layerResolved needs "system", "platform" or "tenant" when matchedPolicyId is non-null');
  }
  return value;
}

const DECISION_LOG_ENTRY_OPTIONS = ["id", "request", "decision", "layerResolved", "ts", "prevHash"];

function sha256Of(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

// PolicyRequest freezes resource/context with every object's keys sorted ascending; this
// entry's fixed hash payload must not silently inherit that convention as its own, so it
// applies an independent, general rule instead: at every level of the value — the root and
// every object nested inside it, to any depth — own enumerable keys are re-emitted in
// descending lexicographic order. An array is walked in its existing element order (an array
// has no keys to reorder) with the same rule applied recursively to each element; a primitive
// is returned unchanged. The result is a fresh plain structure, never the frozen PolicyRequest
// data itself, so nothing downstream can observe or mutate the canonical value through it.
function descendingKeyOrder(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => descendingKeyOrder(entry));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort().reverse()) out[key] = descendingKeyOrder(value[key]);
    return out;
  }
  return value;
}

function plainPayloadOf(entry) {
  return {
    id: entry.id,
    requestActor: { tenantId: entry.request.tenantId.toString(), actorId: entry.request.actorId.toString() },
    requestAction: entry.request.action.name,
    requestResource: descendingKeyOrder(entry.request.resource),
    requestContext: descendingKeyOrder(entry.request.context),
    decision: entry.decision.effect,
    reason: entry.decision.reason,
    matchedPolicyId: entry.decision.matchedPolicyId,
    layerResolved: entry.layerResolved,
    traceId: entry.decision.traceId.toString(),
    ts: entry.ts,
    prevHash: entry.prevHash,
  };
}

export class DecisionLogEntry {
  #id;
  #request;
  #decision;
  #layerResolved;
  #ts;
  #prevHash;
  #entryHash;

  constructor(options) {
    exactOptions(options, DECISION_LOG_ENTRY_OPTIONS, "DecisionLogEntry");
    this.#id = ulidValue(options.id);
    this.#request = requestValue(options.request);
    this.#decision = decisionValue(options.decision);
    if (this.#decision.traceId !== this.#request.action.correlationId) {
      throw new TypeError("DecisionLogEntry decision.traceId must be the exact same CorrelationId instance as request.action.correlationId");
    }
    this.#layerResolved = layerResolvedValue(options.layerResolved, this.#decision);
    this.#ts = timestampValue(options.ts);
    this.#prevHash = prevHashValue(options.prevHash);

    const payload = plainPayloadOf(this);
    this.#entryHash = sha256Of(payload);
    Object.freeze(this);
  }

  get id() { return this.#id; }

  get request() { return this.#request; }

  get decision() { return this.#decision; }

  get layerResolved() { return this.#layerResolved; }

  get ts() { return this.#ts; }

  get prevHash() { return this.#prevHash; }

  get entryHash() { return this.#entryHash; }

  toJSON() {
    return { ...plainPayloadOf(this), entryHash: this.#entryHash };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, DecisionLogEntry) || !isExactly(other, DecisionLogEntry)) return false;
    if (!(#id in this) || !(#id in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "DecisionLogEntry";
  }
}
Object.freeze(DecisionLogEntry.prototype);
Object.freeze(DecisionLogEntry);
