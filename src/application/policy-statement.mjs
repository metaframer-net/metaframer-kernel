// =====================================================================================
// PolicyStatement
//
// An immutable exact typed value carrying one policy-as-data row, the complete canonical
// ten-field shape: id, effect, targetActor, targetAction, targetResourceType, condition,
// priority, layer, version, enabled. It states a rule's data and nothing else: it evaluates
// nothing, applies nothing, combines nothing, derives no candidate, and wires into no
// evaluation surface. Framework-free, capability-free, zero imports: it reads no clock,
// mints no random value, reaches no environment, opens no connection, and touches no file.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// -------------------------------------------------------------------------------------
// The canonical JSON-data object: validate, clone, sort, freeze. Used only by targetActor
// and condition. Narrower than what JSON.stringify would accept, refusing every shape it
// would accept and silently change: a hole, a non-enumerable member, an accessor, a value
// repeated by reference.
// -------------------------------------------------------------------------------------

const REFUSED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 16;

function canonicalValue(value, depth, seen, label) {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "boolean" || kind === "string") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${label} admits only finite numbers`);
    return value === 0 ? 0 : value;
  }
  if (kind !== "object") throw new TypeError(`${label} admits no ${kind}`);

  if (depth > MAX_DEPTH) throw new RangeError(`${label} nests at most ${MAX_DEPTH} containers deep`);
  if (seen.has(value)) throw new TypeError(`${label} admits no cycle and no value repeated by reference`);
  seen.add(value);

  const proto = Object.getPrototypeOf(value);

  if (Array.isArray(value)) {
    if (proto !== Array.prototype) throw new TypeError(`${label} admits only ordinary arrays`);
    for (let index = 0; index < value.length; index += 1) {
      const member = Object.getOwnPropertyDescriptor(value, index);
      if (member === undefined) throw new TypeError(`${label} admits no hole in an array`);
      if (!("value" in member) || !member.enumerable) {
        throw new TypeError(`${label} admits only enumerable data elements in an array`);
      }
    }
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError(`${label} admits no property on an array beside its elements`);
    }
    return Object.freeze(value.map((entry) => canonicalValue(entry, depth + 1, seen, label)));
  }

  if (proto !== Object.prototype) throw new TypeError(`${label} admits only ordinary object literals`);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key === "symbol") throw new TypeError(`${label} admits no symbol-keyed member`);
    if (REFUSED_KEYS.has(key)) throw new TypeError(`${label} refuses the key ${key} at any depth`);
    const member = Object.getOwnPropertyDescriptor(value, key);
    if (!("value" in member)) throw new TypeError(`${label} admits no accessor property`);
    if (!member.enumerable) throw new TypeError(`${label} admits no non-enumerable own property`);
  }

  const out = Object.create(null);
  for (const key of [...keys].sort()) out[key] = canonicalValue(value[key], depth + 1, seen, label);
  return Object.freeze(out);
}

function canonicalDataObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  return canonicalValue(value, 1, new Set(), label);
}

// -------------------------------------------------------------------------------------
// Scalar field rules.
// -------------------------------------------------------------------------------------

const ID_RULE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ID_MAX = 128;

function canonicalId(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} needs a primitive string`);
  if (value.length < 1 || value.length > ID_MAX) {
    throw new RangeError(`${label} needs a string of 1 to ${ID_MAX} characters`);
  }
  if (!ID_RULE.test(value)) throw new TypeError(`${label} needs a lowercase canonical id`);
  return value;
}

const EFFECT_VALUES = new Set(["allow", "deny"]);
function effectValue(value) {
  if (!EFFECT_VALUES.has(value)) throw new TypeError("effect must be exactly \"allow\" or \"deny\"");
  return value;
}

const ACTION_RULE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/;
const ACTION_MAX = 128;

function targetActionValue(value) {
  if (typeof value !== "string") throw new TypeError("targetAction needs a primitive string");
  if (value.length < 1 || value.length > ACTION_MAX) {
    throw new RangeError(`targetAction needs a string of 1 to ${ACTION_MAX} characters`);
  }
  if (!ACTION_RULE.test(value)) {
    throw new TypeError("targetAction needs one or more dotted lowercase identifier segments");
  }
  return value;
}

function priorityValue(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError("priority needs a safe integer");
  return value;
}

const LAYER_VALUES = new Set(["system", "platform", "tenant"]);
function layerValue(value) {
  if (!LAYER_VALUES.has(value)) throw new TypeError("layer must be exactly system, platform, or tenant");
  return value;
}

// SemVer 2.0.0 grammar, unmodified.
const SEMVER_RULE = new RegExp(
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)" +
  "(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?" +
  "(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
);

function versionValue(value) {
  if (typeof value !== "string" || value.length < 1) throw new TypeError("version needs a primitive string");
  if (!SEMVER_RULE.test(value)) throw new TypeError("version needs valid SemVer 2.0.0 syntax");
  return value;
}

function enabledValue(value) {
  if (typeof value !== "boolean") throw new TypeError("enabled needs a primitive boolean");
  return value;
}

// -------------------------------------------------------------------------------------
// Options admission: an ordinary object literal carrying exactly the ten declared keys,
// each an enumerable own data property. An accessor, a non-enumerable member, a foreign
// prototype, an unknown key, or a missing key is refused rather than tolerated.
// -------------------------------------------------------------------------------------

const FIELDS = [
  "id", "effect", "targetActor", "targetAction", "targetResourceType",
  "condition", "priority", "layer", "version", "enabled",
];

function ordinaryOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("PolicyStatement needs an options object");
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("PolicyStatement needs an ordinary object literal, not a foreign prototype");
  }
  if (Reflect.ownKeys(options).length !== FIELDS.length) {
    throw new TypeError(`PolicyStatement takes exactly these options: ${FIELDS.join(", ")}`);
  }
  for (const field of FIELDS) {
    const member = Object.getOwnPropertyDescriptor(options, field);
    if (member === undefined) throw new TypeError(`PolicyStatement needs a ${field} option`);
    if (!("value" in member)) throw new TypeError(`PolicyStatement ${field} must be a data property, not an accessor`);
    if (!member.enumerable) throw new TypeError(`PolicyStatement ${field} must be enumerable`);
  }
  return options;
}

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
    ordinaryOptions(options);
    this.#id = canonicalId(options.id, "id");
    this.#effect = effectValue(options.effect);
    this.#targetActor = canonicalDataObject(options.targetActor, "targetActor");
    this.#targetAction = targetActionValue(options.targetAction);
    this.#targetResourceType = canonicalId(options.targetResourceType, "targetResourceType");
    this.#condition = canonicalDataObject(options.condition, "condition");
    this.#priority = priorityValue(options.priority);
    this.#layer = layerValue(options.layer);
    this.#version = versionValue(options.version);
    this.#enabled = enabledValue(options.enabled);
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get effect() { return this.#effect; }
  get targetActor() { return this.#targetActor; }
  get targetAction() { return this.#targetAction; }
  get targetResourceType() { return this.#targetResourceType; }
  get condition() { return this.#condition; }
  get priority() { return this.#priority; }
  get layer() { return this.#layer; }
  get version() { return this.#version; }
  get enabled() { return this.#enabled; }

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
