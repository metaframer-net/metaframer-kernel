import { Command, Query } from "./action-primitives.mjs";
import { CorrelationId } from "../domain/identity-primitives.mjs";

// =====================================================================================
// The PolicyDecision protocol values
//
// Two value types, and nothing that asks or answers a question with them. A `PolicyRequest`
// names an act, the thing it targets, and the situation it arrives in; a `PolicyDecision`
// carries an outcome someone else reached. This module holds no rule, no condition, no
// combining algorithm and no default, and does not evaluate, allow, deny, permit or enforce.
//
// The frozen non-goals: no decision point, no enforcement point, no rule matching, no combining
// algorithm, no role/permission/grant model, no row-level access story, no record of a decision
// once made, no persistence layer, no generated client and no delivery surface.
// =====================================================================================

/** Exact-class test: prototype identity, never `instanceof`, so a subclass is never admitted. */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/** Require exactly the declared options, all present. An unknown or missing key is refused. */
function exactOptions(options, expected, what) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${what} needs an options object`);
  }
  const given = Reflect.ownKeys(options);
  const complete = expected.every((key) => Object.prototype.hasOwnProperty.call(options, key));
  if (!complete || given.length !== expected.length) {
    throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
  }
  return options;
}

// Genuine-action admission, captured once: prototype identity alone admits an object built
// straight on the prototype with no private field, so a captured getter is the other half —
// reading it throws unless the receiver carries the private state the real constructor installs.
const COMMAND_BRAND = Object.getOwnPropertyDescriptor(Command.prototype, "name").get;
const QUERY_BRAND = Object.getOwnPropertyDescriptor(Query.prototype, "name").get;

const carriesBrand = (brand, value) => {
  try {
    brand.call(value);
    return true;
  } catch {
    return false;
  }
};

const isGenuineAction = (value) =>
  (isExactly(value, Command) && carriesBrand(COMMAND_BRAND, value))
  || (isExactly(value, Query) && carriesBrand(QUERY_BRAND, value));

// A genuine CorrelationId has no plain getter to capture, so its own `toString` is captured
// instead: it renders the canonical UUID for a real instance, a placeholder otherwise, never
// throwing — so genuineness is read off the shape of the result, not off whether the call survived.
const CORRELATION_TO_STRING = CorrelationId.prototype.toString;
const CORRELATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isGenuineCorrelationId = (value) =>
  isExactly(value, CorrelationId) && CORRELATION_UUID.test(CORRELATION_TO_STRING.call(value));

// Canonical JSON data for `resource` and `context`: the same rule `Command` and `Query` apply to
// a payload — sorted keys, deep freeze, and a refusal for everything JSON.stringify would have
// accepted and silently changed. `seen` is never cleared, so a value repeated by reference is
// refused alongside a true cycle even though it is acyclic.
const REFUSED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 16;

function canonicalValue(value, depth, seen, what) {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "boolean" || kind === "string") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${what} admits only finite numbers`);
    return value === 0 ? 0 : value;
  }
  if (kind !== "object") throw new TypeError(`${what} admits no ${kind}`);

  if (depth > MAX_DEPTH) throw new RangeError(`${what} nests at most ${MAX_DEPTH} containers deep`);
  if (seen.has(value)) throw new TypeError(`${what} admits no cycle and no value repeated by reference`);
  seen.add(value);

  const proto = Object.getPrototypeOf(value);

  if (Array.isArray(value)) {
    if (proto !== Array.prototype) throw new TypeError(`${what} admits only ordinary arrays`);
    for (let index = 0; index < value.length; index += 1) {
      const member = Object.getOwnPropertyDescriptor(value, index);
      if (member === undefined) throw new TypeError(`${what} admits no hole in an array`);
      if (!("value" in member) || !member.enumerable) {
        throw new TypeError(`${what} admits only enumerable data elements in an array`);
      }
    }
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError(`${what} admits no property on an array beside its elements`);
    }
    return Object.freeze(value.map((entry) => canonicalValue(entry, depth + 1, seen, what)));
  }

  if (proto !== Object.prototype) throw new TypeError(`${what} admits only ordinary object literals`);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key === "symbol") throw new TypeError(`${what} admits no symbol-keyed member`);
    if (REFUSED_KEYS.has(key)) throw new TypeError(`${what} refuses the key ${key} at any depth`);
    const member = Object.getOwnPropertyDescriptor(value, key);
    if (!("value" in member)) throw new TypeError(`${what} admits no accessor property`);
    if (!member.enumerable) throw new TypeError(`${what} admits no non-enumerable own property`);
  }

  const out = Object.create(null);
  for (const key of [...keys].sort()) out[key] = canonicalValue(value[key], depth + 1, seen, what);
  return Object.freeze(out);
}

/** A canonical value whose root must itself be an ordinary object, never an array or scalar. */
function canonicalRoot(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${what} must be an ordinary object`);
  }
  return canonicalValue(value, 1, new Set(), what);
}

// PolicyRequest: what is asked, what it targets, and the situation it arrives in. `action` is
// kept by reference; `resource` and `context` arrive open and are hardened into canonical data.
// `tenantId` / `actorId` are not stored fields — they are read off `action.principal` on every
// access, so they can never drift from the action that carries them.
const POLICY_REQUEST_OPTIONS = ["action", "resource", "context"];

export class PolicyRequest {
  #action;
  #resource;
  #context;

  constructor(options) {
    exactOptions(options, POLICY_REQUEST_OPTIONS, "PolicyRequest");
    if (!isGenuineAction(options.action)) {
      throw new TypeError("PolicyRequest action needs an exact genuine Command or Query instance");
    }
    this.#action = options.action;
    this.#resource = canonicalRoot(options.resource, "a PolicyRequest resource");
    this.#context = canonicalRoot(options.context, "a PolicyRequest context");
    Object.freeze(this);
  }

  get action() {
    return this.#action;
  }

  get resource() {
    return this.#resource;
  }

  get context() {
    return this.#context;
  }

  get tenantId() {
    return this.#action.principal.tenantId;
  }

  get actorId() {
    return this.#action.principal.actorId;
  }

  /** Fixed order: the act, who carried it, then the data it was asked about and arrived with. */
  toJSON() {
    return {
      action: this.#action.toJSON(),
      tenantId: this.tenantId.toString(),
      actorId: this.actorId.toString(),
      resource: this.#resource,
      context: this.#context,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, PolicyRequest) || !isExactly(other, PolicyRequest)) return false;
    if (!(#action in this) || !(#action in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "PolicyRequest";
  }
}
Object.freeze(PolicyRequest.prototype);
Object.freeze(PolicyRequest);

// PolicyDecision: an outcome carried as a value. `effect` is exactly "allow" or "deny";
// `matchedPolicyId` is `null` only where a deny stands for no match found, otherwise a bounded
// canonical identifier, required and non-null once `effect` is "allow". `reason` is bounded,
// safe prose text; a refusal never echoes the value that broke a rule, only the rule itself.
const POLICY_DECISION_OPTIONS = ["effect", "reason", "matchedPolicyId", "traceId"];
const EFFECTS = new Set(["allow", "deny"]);
const REASON_MAX = 512;
const REASON_CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const POLICY_ID_MAX = 128;
const POLICY_ID_FORM = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

function effectValue(value) {
  if (typeof value !== "string" || !EFFECTS.has(value)) {
    throw new TypeError('PolicyDecision effect needs exactly "allow" or "deny"');
  }
  return value;
}

function reasonValue(value) {
  if (typeof value !== "string") throw new TypeError("PolicyDecision reason needs a primitive string");
  if (value.length > REASON_MAX) throw new RangeError(`PolicyDecision reason is bounded to ${REASON_MAX} characters`);
  if (value.trim().length === 0) throw new RangeError("PolicyDecision reason must not be empty once trimmed");
  if (value.trim() !== value) throw new TypeError("PolicyDecision reason must carry no leading or trailing whitespace");
  if (REASON_CONTROL.test(value)) throw new RangeError("PolicyDecision reason admits no C0 or C1 control character");
  return value;
}

function matchedPolicyIdValue(value, effect) {
  if (value === null) {
    if (effect !== "deny") throw new TypeError("PolicyDecision matchedPolicyId may be null only when effect is deny");
    return null;
  }
  if (typeof value !== "string") throw new TypeError("PolicyDecision matchedPolicyId needs a primitive string or null");
  if (value.length === 0 || value.length > POLICY_ID_MAX) {
    throw new RangeError(`PolicyDecision matchedPolicyId is bounded to 1 to ${POLICY_ID_MAX} characters`);
  }
  if (!POLICY_ID_FORM.test(value)) {
    throw new TypeError("PolicyDecision matchedPolicyId needs a lowercase canonical id of letters, digits, dot or hyphen");
  }
  return value;
}

export class PolicyDecision {
  #effect;
  #reason;
  #matchedPolicyId;
  #traceId;

  constructor(options) {
    exactOptions(options, POLICY_DECISION_OPTIONS, "PolicyDecision");
    this.#effect = effectValue(options.effect);
    this.#reason = reasonValue(options.reason);
    this.#matchedPolicyId = matchedPolicyIdValue(options.matchedPolicyId, this.#effect);
    if (!isGenuineCorrelationId(options.traceId)) {
      throw new TypeError("PolicyDecision traceId needs an exact genuine CorrelationId instance");
    }
    this.#traceId = options.traceId;
    Object.freeze(this);
  }

  get effect() {
    return this.#effect;
  }

  get reason() {
    return this.#reason;
  }

  get matchedPolicyId() {
    return this.#matchedPolicyId;
  }

  get traceId() {
    return this.#traceId;
  }

  /** Fixed order: the outcome first, why, what matched, then the trace it can be found under. */
  toJSON() {
    return {
      effect: this.#effect,
      reason: this.#reason,
      matchedPolicyId: this.#matchedPolicyId,
      traceId: this.#traceId.toString(),
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, PolicyDecision) || !isExactly(other, PolicyDecision)) return false;
    if (!(#effect in this) || !(#effect in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "PolicyDecision";
  }
}
Object.freeze(PolicyDecision.prototype);
Object.freeze(PolicyDecision);
