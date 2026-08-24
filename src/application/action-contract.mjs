// =====================================================================================
// ActionContract — a handler-free declarative IR
//
// One immutable value describing the shape of an action: its kind, its name@version
// coordinate, and three ordered identifier lists — the fields it carries, the outcomes it can
// answer with, and the fields its error envelope carries. It describes an action; it is never
// one. Command and Query in action-primitives.mjs remain the only effect boundary — they carry
// known runtime values, this describes shape for a machine reader such as P07.
//
// What is deliberately absent, and must stay absent: no handler, dispatcher, bus or router; no
// use-case contract, port, policy/PDP type or data, write envelope, persistence, renderer, CLI
// or SDK surface. Nothing here executes an action or renders code for one.
//
// The three identifier lists are the one place this module differs from a canonical-value
// rule sorted by key: order here is the caller's declaration and is part of the contract, so it
// is preserved exactly as constructed, never sorted.
// =====================================================================================

/** Exact-class test, matching action-primitives.mjs: prototype identity, not `instanceof`. */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/**
 * Require an ordinary `Object.prototype` data object carrying exactly the declared own
 * enumerable data properties, all present.
 *
 * The descriptor is read but never invoked: an accessor property is refused by inspecting
 * `"value" in descriptor` rather than by reading `options[key]`, so a getter with a side effect
 * never runs merely because this module is checking the shape of what it was handed. A custom
 * or null prototype, a symbol-keyed member, a non-enumerable member, or an unknown key is
 * refused the same way an unlisted top-level option is: silently accepting one would let a
 * caller believe it had set something this type does not have a field for.
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

const KIND_VALUES = new Set(["command", "query"]);

function kind(value, what) {
  if (typeof value !== "string" || !KIND_VALUES.has(value)) {
    throw new TypeError(`${what} kind must be exactly "command" or "query"`);
  }
  return value;
}

// Dotted, lowercase, at least two segments, each beginning with a letter — the same coordinate
// shape action-primitives.mjs gives a Command or Query, since a contract describes one of those.
const ACTION_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const ACTION_NAME_MAX = 128;

function actionName(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} needs a primitive string name`);
  }
  if (value.length > ACTION_NAME_MAX) {
    throw new RangeError(`${what} needs a name of at most ${ACTION_NAME_MAX} characters`);
  }
  if (!ACTION_NAME.test(value)) {
    throw new TypeError(`${what} needs a dotted lowercase name of at least two segments`);
  }
  return value;
}

function actionVersion(value, what) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${what} needs a safe integer version of at least 1`);
  }
  return value;
}

// Letters, digits and underscore, starting with a letter — safe as a field name, an outcome
// token or an object key on any consumer this contract's fields will ever be projected onto.
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const IDENTIFIER_MAX = 64;

// Refused by exact name, in addition to the IDENTIFIER grammar above: `constructor` and
// `prototype` already match that grammar and would pass it silently, so they need this explicit
// deny-list entry; `__proto__` fails the grammar too (it starts with `_`, not a letter) and is
// listed here only for defense in depth, alongside its two grammar-passing siblings. A list
// entry becomes an object key on whatever consumer projects this contract, and these are the
// keys a prototype-pollution attempt reaches for on that consumer — not on this module's own
// arrays, which hold only primitive strings and have no prototype chain for such a key to climb.
const REFUSED_IDENTIFIERS = new Set(["__proto__", "constructor", "prototype"]);

function identifier(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} admits only primitive string identifiers`);
  }
  if (value.length === 0 || value.length > IDENTIFIER_MAX) {
    throw new RangeError(`${what} needs an identifier of 1 to ${IDENTIFIER_MAX} characters`);
  }
  if (!IDENTIFIER.test(value)) {
    throw new TypeError(`${what} needs a safe identifier: letters, digits and underscore, starting with a letter`);
  }
  if (REFUSED_IDENTIFIERS.has(value)) {
    throw new TypeError(`${what} refuses the identifier ${value}: it is a key a consumer's prototype chain would honor`);
  }
  return value;
}

/**
 * An ordered list of unique safe identifiers, cloned and deeply frozen.
 *
 * Order is preserved rather than sorted: it is the caller's declaration, not incidental data,
 * so alphabetising it would silently change what the contract says. Only an ordinary dense
 * array is admitted — the same shape rule action-primitives.mjs applies to a payload array —
 * because a sparse hole, an extra own property or a foreign prototype is data this rendering
 * would drop or misrepresent without saying so.
 *
 * A cycle or a repeated reference cannot arise here at all: every accepted entry is validated
 * as a primitive string by `identifier`, so there is no container inside a list for a later
 * entry to point back into — the impossibility is structural, not a claim about traversal this
 * module happens not to make.
 */
function identifierList(value, what) {
  if (value === null || typeof value !== "object" || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${what} must be an ordinary array`);
  }
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
  const seen = new Set();
  const out = value.map((entry) => identifier(entry, what));
  for (const entry of out) {
    if (seen.has(entry)) throw new TypeError(`${what} admits no duplicate entry: ${entry}`);
    seen.add(entry);
  }
  return Object.freeze(out);
}

const OPTIONS = ["kind", "name", "version", "fields", "outcomes", "errorEnvelopeFields"];

export class ActionContract {
  #kind;
  #name;
  #version;
  #fields;
  #outcomes;
  #errorEnvelopeFields;

  constructor(options) {
    exactOptions(options, OPTIONS, "ActionContract");
    this.#kind = kind(options.kind, "ActionContract");
    this.#name = actionName(options.name, "ActionContract");
    this.#version = actionVersion(options.version, "ActionContract");
    this.#fields = identifierList(options.fields, "ActionContract fields");
    this.#outcomes = identifierList(options.outcomes, "ActionContract outcomes");
    this.#errorEnvelopeFields = identifierList(options.errorEnvelopeFields, "ActionContract errorEnvelopeFields");
    Object.freeze(this);
  }

  get kind() {
    return this.#kind;
  }

  get name() {
    return this.#name;
  }

  get version() {
    return this.#version;
  }

  get fields() {
    return this.#fields;
  }

  get outcomes() {
    return this.#outcomes;
  }

  get errorEnvelopeFields() {
    return this.#errorEnvelopeFields;
  }

  /** Fixed order, matching the declared option set: what it is, then its three lists. */
  toJSON() {
    return {
      kind: this.#kind,
      name: this.#name,
      version: this.#version,
      fields: this.#fields,
      outcomes: this.#outcomes,
      errorEnvelopeFields: this.#errorEnvelopeFields,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  /** Exact-class, structural equality over the deterministic rendering. */
  equals(other) {
    if (!isExactly(this, ActionContract) || !isExactly(other, ActionContract)) return false;
    if (!(#kind in this) || !(#kind in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "ActionContract";
  }
}
Object.freeze(ActionContract.prototype);
Object.freeze(ActionContract);
