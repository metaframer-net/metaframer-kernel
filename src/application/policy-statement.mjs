// =====================================================================================
// PolicyStatement — an immutable policy-as-data row
//
// One inert value carrying exactly the ten fields of one declarative policy row: `id`,
// `effect`, `targetActor`, `targetAction`, `targetResourceType`, `condition`, `priority`,
// `layer`, `version`, `enabled`. It describes one rule; it never matches one, combines one,
// derives a candidate from one, batches one or logs one.
//
// What is deliberately absent, and must stay absent: no matching, wildcard, condition
// evaluation, record set, candidate derivation, resolver, combining, deny-overrides execution,
// batch, decision-log, audit/outbox/cache, persistence, migration, RLS, PEP, HTTP/UI. The
// existing Policy, PolicyRequest, PolicyDecision, AuthorizationEvaluator and
// PolicyDecisionPoint are untouched and unimported — this module imports nothing at all.
// =====================================================================================

/** Exact-class test: prototype identity, never `instanceof`, so a subclass is never admitted. */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/**
 * Require an ordinary `Object.prototype` data object carrying exactly the declared own
 * enumerable data properties, all present.
 *
 * The descriptor is read but never invoked: an accessor property is refused by inspecting
 * `"value" in descriptor` rather than by reading `options[key]`, so a getter with a side effect
 * never runs merely because this module is checking the shape of what it was handed.
 */
function exactOptions(options, expected, what) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${what} needs an ordinary options object`);
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError(`${what} needs an ordinary object literal, not a custom or null-prototype object`);
  }
  const keys = Reflect.ownKeys(options);
  for (const key of keys) {
    if (typeof key === "symbol") throw new TypeError(`${what} admits no symbol-keyed option`);
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!("value" in descriptor)) throw new TypeError(`${what} admits no accessor option`);
    if (!descriptor.enumerable) throw new TypeError(`${what} admits no non-enumerable option`);
  }
  const complete = expected.every((key) => keys.includes(key));
  if (!complete || keys.length !== expected.length) {
    throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
  }
  return options;
}

// -------------------------------------------------------------------------------------
// Bounded canonical scalars
// -------------------------------------------------------------------------------------

const EFFECT_VALUES = new Set(["allow", "deny"]);
const LAYER_VALUES = new Set(["system", "platform", "tenant"]);

function effectValue(value, what) {
  if (typeof value !== "string" || !EFFECT_VALUES.has(value)) {
    throw new TypeError(`${what} effect must be exactly "allow" or "deny"`);
  }
  return value;
}

function layerValue(value, what) {
  if (typeof value !== "string" || !LAYER_VALUES.has(value)) {
    throw new TypeError(`${what} layer must be exactly "system", "platform" or "tenant"`);
  }
  return value;
}

function priorityValue(value, what) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${what} priority needs a safe integer`);
  }
  return value;
}

function enabledValue(value, what) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${what} enabled needs a primitive boolean`);
  }
  return value;
}

// SemVer 2.0.0, retained exactly as given: no normalization, no defaulting.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function semverValue(value, what) {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    throw new TypeError(`${what} version needs an exact SemVer 2.0.0 string`);
  }
  return value;
}

// Bounded lowercase canonical id: letters, digits, dot or hyphen, dot/hyphen never leading,
// trailing or doubled — matches the existing PolicyDecision.matchedPolicyId convention.
const CANONICAL_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const CANONICAL_ID_MAX = 128;

function canonicalId(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} needs a primitive string`);
  }
  if (value.length === 0 || value.length > CANONICAL_ID_MAX) {
    throw new RangeError(`${what} is bounded to 1 to ${CANONICAL_ID_MAX} characters`);
  }
  if (!CANONICAL_ID.test(value)) {
    throw new TypeError(`${what} needs a lowercase canonical id of letters, digits, dot or hyphen`);
  }
  return value;
}

// Dotted lowercase action coordinate, at least two segments — matches the coordinate shape used
// elsewhere in this ring for a dotted action name.
const DOTTED_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const DOTTED_NAME_MAX = 128;

function targetActionValue(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} needs a primitive string`);
  }
  if (value.length > DOTTED_NAME_MAX) {
    throw new RangeError(`${what} needs a name of at most ${DOTTED_NAME_MAX} characters`);
  }
  if (!DOTTED_NAME.test(value)) {
    throw new TypeError(`${what} needs a dotted lowercase name of at least two segments`);
  }
  return value;
}

// Dotted lowercase resource-type token, one or more segments.
const RESOURCE_TYPE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
const RESOURCE_TYPE_MAX = 128;

function targetResourceTypeValue(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} needs a primitive string`);
  }
  if (value.length === 0 || value.length > RESOURCE_TYPE_MAX) {
    throw new RangeError(`${what} is bounded to 1 to ${RESOURCE_TYPE_MAX} characters`);
  }
  if (!RESOURCE_TYPE.test(value)) {
    throw new TypeError(`${what} needs a dotted lowercase resource-type token`);
  }
  return value;
}

// -------------------------------------------------------------------------------------
// Defensive, deterministic, deeply frozen JSON-data canonicalization for targetActor and
// condition. Cycles, shared references, holes, accessors, symbols, hostile keys, non-finite
// numbers and exotic prototypes fail closed.
// -------------------------------------------------------------------------------------

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

// -------------------------------------------------------------------------------------
// PolicyStatement
// -------------------------------------------------------------------------------------

const OPTIONS = [
  "id", "effect", "targetActor", "targetAction", "targetResourceType",
  "condition", "priority", "layer", "version", "enabled",
];

export class PolicyStatement {
  #id;
  #effect;
  #targetActor;
  #targetAction;
  #targetResourceType;
  #condition;
  #priority;
  #layer;
  #version;
  #enabled;

  constructor(options) {
    exactOptions(options, OPTIONS, "PolicyStatement");
    this.#id = canonicalId(options.id, "PolicyStatement id");
    this.#effect = effectValue(options.effect, "PolicyStatement");
    this.#targetActor = canonicalRoot(options.targetActor, "PolicyStatement targetActor");
    this.#targetAction = targetActionValue(options.targetAction, "PolicyStatement targetAction");
    this.#targetResourceType = targetResourceTypeValue(options.targetResourceType, "PolicyStatement targetResourceType");
    this.#condition = canonicalRoot(options.condition, "PolicyStatement condition");
    this.#priority = priorityValue(options.priority, "PolicyStatement");
    this.#layer = layerValue(options.layer, "PolicyStatement");
    this.#version = semverValue(options.version, "PolicyStatement");
    this.#enabled = enabledValue(options.enabled, "PolicyStatement");
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get effect() {
    return this.#effect;
  }

  get targetActor() {
    return this.#targetActor;
  }

  get targetAction() {
    return this.#targetAction;
  }

  get targetResourceType() {
    return this.#targetResourceType;
  }

  get condition() {
    return this.#condition;
  }

  get priority() {
    return this.#priority;
  }

  get layer() {
    return this.#layer;
  }

  get version() {
    return this.#version;
  }

  get enabled() {
    return this.#enabled;
  }

  /** Fixed order, matching the declared option set. */
  toJSON() {
    return {
      id: this.#id,
      effect: this.#effect,
      targetActor: this.#targetActor,
      targetAction: this.#targetAction,
      targetResourceType: this.#targetResourceType,
      condition: this.#condition,
      priority: this.#priority,
      layer: this.#layer,
      version: this.#version,
      enabled: this.#enabled,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  /** Exact-class, structural equality over the deterministic rendering. */
  equals(other) {
    if (!isExactly(this, PolicyStatement) || !isExactly(other, PolicyStatement)) return false;
    if (!(#id in this) || !(#id in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "PolicyStatement";
  }
}
Object.freeze(PolicyStatement.prototype);
Object.freeze(PolicyStatement);
