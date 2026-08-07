import { CausationId, CorrelationId, IdempotencyKey, Principal } from "../domain/identity-primitives.mjs";

// =====================================================================================
// Action primitives
//
// The four types the Application ring needs to say what is being asked of the system: a typed
// Command, a typed Query, one canonical error and a two-branch Result. Domain owns the identity
// values these compose; this module composes them and owns nothing else.
//
// Framework-free by construction, and capability-free by construction. The one import is the
// domain identity module. There is nothing here that reads a clock, mints a random value, reaches
// the environment, opens a connection, speaks a query language or touches a file — because a value
// type that could do any of those is a value type whose two constructions from the same input are
// free to differ, and every determinism guarantee below would then be a coincidence.
//
// What is deliberately absent, and must stay absent: no use-case contract, no handler, dispatcher,
// bus or router; no port, unit of work, clock, policy, audit or outbox; no validation boundary and
// no composition root. An action is a value. The thing that executes one is a later package.
//
// Two orderings live here and they are not the same rule:
//
//   - The *envelope* — what a Command, Query, KernelError or Result renders as — has a fixed,
//     hand-chosen key order. It is a discovery contract: a reader meets the kind first, then the
//     action's name and version, then who acted, then how the message was caused, and only then
//     the data. Alphabetising it would put the least useful key first.
//   - The *canonical value* — a payload, an error's details, a Result's value — sorts its keys,
//     because it is data whose byte form must not depend on how a caller happened to type it.
//
// There is deliberately no shared base class. Four closed types repeat a short validator and a
// short equality, which is the cost of the guarantee: a base would let one of them silently
// inherit a rule written for another, and each rule is what keeps its type honest.
// =====================================================================================

/**
 * Exact-class test used by every validator and every `equals`.
 *
 * Prototype identity, not `instanceof`: `instanceof` walks the chain, so a subclass would pass it
 * while carrying whatever the subclass added, and the receiving type would have no way to know.
 */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/** Require an exact instance of one of the domain identity types. */
function exactly(value, type, typeName, what) {
  if (!isExactly(value, type)) {
    throw new TypeError(`${what} needs an exact ${typeName} instance, already validated by the domain ring`);
  }
  return value;
}

// -------------------------------------------------------------------------------------
// The canonical JSON value
//
// One rule, used by every surface that accepts data: a command payload, a query payload, an
// error's details and a result's value. Four copies of a rule are four things to drift, so there
// is one, and each surface calls it.
//
// The rule is deliberately narrower than "whatever JSON.stringify would accept". Everything it
// refuses is something JSON.stringify would have accepted *and silently changed*: a Date becomes a
// string, a class instance becomes whatever its toJSON says, a non-enumerable member disappears, a
// hole becomes null, an accessor is invoked. A value that arrives smaller or different than it left
// is worse than one that was refused, because nothing anywhere records that it changed.
// -------------------------------------------------------------------------------------

/**
 * Keys refused everywhere, at every depth.
 *
 * On a null-prototype object these are inert, and the canonical form is null-prototype — but the
 * value does not stay here. It is read, re-serialised and merged by consumers whose targets do
 * inherit from the base object prototype, and the boundary is the only place a rule can hold for
 * all of them at once.
 */
const REFUSED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Containers may nest sixteen deep. The root container is level one. */
const MAX_DEPTH = 16;

/**
 * Canonicalise one value: validate it, clone it, sort it, and freeze what comes back.
 *
 * `seen` holds every container already visited and is never cleared, so a value repeated by
 * reference is refused alongside a true cycle. A repeat is acyclic and a cycle detector alone
 * would accept it — and one input object would then have become two frozen clones that no longer
 * share anything, which is a change the caller never asked for and cannot observe.
 */
function canonicalValue(value, depth, seen, what) {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "boolean" || kind === "string") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${what} admits only finite numbers, and this one has no JSON form`);
    }
    // Normalising negative zero: it is indistinguishable from zero through JSON and through
    // equality, but not through Object.is, so keeping it would make two values that must be
    // identical distinguishable by one observer and not another.
    return value === 0 ? 0 : value;
  }
  if (kind !== "object") throw new TypeError(`${what} admits no ${kind}`);

  if (depth > MAX_DEPTH) {
    throw new RangeError(`${what} nests at most ${MAX_DEPTH} containers deep`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${what} admits no cycle and no value repeated by reference`);
  }
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
    // Indices plus `length`, and nothing else: a property hung on an array is data the JSON form
    // would drop without saying so.
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError(`${what} admits no property on an array beside its elements`);
    }
    return Object.freeze(value.map((entry) => canonicalValue(entry, depth + 1, seen, what)));
  }

  // Ordinary object literals only. This is what refuses a null-prototype object, an object with a
  // custom prototype, and every class instance in one rule — a Map, a Date, a typed array, an
  // Error, a domain identity value. The hardened null-prototype form is minted here, from an
  // ordinary object; one arriving ready-made is a container this module did not build.
  if (proto !== Object.prototype) {
    throw new TypeError(`${what} admits only ordinary object literals`);
  }
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

/** A canonical value of any shape, including a bare scalar. */
const canonicalAnything = (value, what) => canonicalValue(value, 1, new Set(), what);

/** A canonical value that must be an object at its root: a payload and a detail set name fields. */
function canonicalObject(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${what} must be an ordinary object`);
  }
  return canonicalValue(value, 1, new Set(), what);
}

/**
 * Require exactly the declared options, all present.
 *
 * An unknown option is refused rather than dropped, because silently ignoring one lets a caller
 * believe it set something. A missing one is refused even where `null` is legal, because an
 * omitted key and a deliberate `null` are different statements and a constructor that treats them
 * alike cannot tell a decision from a typo.
 */
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

// -------------------------------------------------------------------------------------
// The action coordinates
//
// A name and a version together are the action's identity: `name@version`. There is no module
// level version constant, because that would be a second answer to "which version is this" and the
// two would be free to disagree the moment one action is versioned independently of another.
// -------------------------------------------------------------------------------------

// Dotted, lowercase, at least two segments, each beginning with a letter. Bounded at 128 so a
// name stays readable in a log line, a metric label and a stack of nested envelopes.
const ACTION_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const ACTION_NAME_MAX = 128;

function actionName(value, what) {
  if (typeof value !== "string") {
    throw new TypeError(`${what} needs a primitive string name, not ${value === null ? "null" : typeof value}`);
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

/** The one action coordinate with a legal null: a root action has nothing that caused it. */
function optionalCausation(value, what) {
  if (value === null) return null;
  return exactly(value, CausationId, "CausationId", `${what} causationId`);
}

// =====================================================================================
// Command
//
// An act that changes state. It carries an idempotency key, required and exact, because "this
// retry is the same act as that one" is not an optional thing to know about a state change — a
// nullable key would make the un-deduplicated command the easiest one to write.
//
// The identity coordinates arrive already immutable and already validated, so they are kept by
// reference rather than rebuilt. Re-wrapping them would re-run a domain rule in this ring — a
// second copy of a validator — and would make `command.principal === principal` false for a caller
// holding the very value it just handed over. The payload is the opposite case: it arrives open,
// so it is hardened into something new.
// =====================================================================================

const COMMAND_OPTIONS = [
  "name", "version", "principal", "correlationId", "causationId", "idempotencyKey", "payload",
];

export class Command {
  #name;
  #version;
  #principal;
  #correlationId;
  #causationId;
  #idempotencyKey;
  #payload;

  constructor(options) {
    exactOptions(options, COMMAND_OPTIONS, "Command");
    this.#name = actionName(options.name, "Command");
    this.#version = actionVersion(options.version, "Command");
    this.#principal = exactly(options.principal, Principal, "Principal", "Command principal");
    this.#correlationId = exactly(options.correlationId, CorrelationId, "CorrelationId", "Command correlationId");
    this.#causationId = optionalCausation(options.causationId, "Command");
    this.#idempotencyKey = exactly(options.idempotencyKey, IdempotencyKey, "IdempotencyKey", "Command idempotencyKey");
    this.#payload = canonicalObject(options.payload, "a Command payload");
    Object.freeze(this);
  }

  get name() {
    return this.#name;
  }

  get version() {
    return this.#version;
  }

  get principal() {
    return this.#principal;
  }

  get correlationId() {
    return this.#correlationId;
  }

  get causationId() {
    return this.#causationId;
  }

  get idempotencyKey() {
    return this.#idempotencyKey;
  }

  get payload() {
    return this.#payload;
  }

  /**
   * The discovery envelope, in its fixed order.
   *
   * The kind is a lowercase wire token rather than the class name: what a reader on the far side
   * receives is a message, not a JavaScript class, and spelling it as one would invite the two to
   * be treated as the same thing. The idempotency key renders as its fingerprint, which is all the
   * domain value holds — the raw input was hashed and dropped before this type ever saw it.
   */
  toJSON() {
    return {
      kind: "command",
      name: this.#name,
      version: this.#version,
      principal: this.#principal.toJSON(),
      correlationId: this.#correlationId.toString(),
      causationId: this.#causationId === null ? null : this.#causationId.toString(),
      idempotencyKey: this.#idempotencyKey.fingerprint,
      payload: this.#payload,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  /**
   * Exact-class, structural equality.
   *
   * The brand check is not redundant beside the prototype check: an object built directly on this
   * prototype passes the prototype test while holding no field at all, and reading one would throw
   * where the honest answer is `false`. `equals` answers a question about a foreign value; it does
   * not assume one.
   *
   * The comparison is over the canonical rendering, which is exactly what makes it sound: the
   * rendering is deterministic by contract, so two values render alike if and only if every
   * coordinate agrees.
   */
  equals(other) {
    if (!isExactly(this, Command) || !isExactly(other, Command)) return false;
    if (!(#name in this) || !(#name in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "Command";
  }
}
Object.freeze(Command.prototype);
Object.freeze(Command);

// =====================================================================================
// Query
//
// A read. It changes nothing, so it retries freely and has no idempotency key to carry — and the
// option is refused outright rather than ignored, because a caller that passed one believed it
// meant something.
//
// A Command and a Query never compare equal, however identical their shared coordinates are. They
// are different kinds of act, and the kind is the first thing their renderings disagree about.
// =====================================================================================

const QUERY_OPTIONS = ["name", "version", "principal", "correlationId", "causationId", "payload"];

export class Query {
  #name;
  #version;
  #principal;
  #correlationId;
  #causationId;
  #payload;

  constructor(options) {
    exactOptions(options, QUERY_OPTIONS, "Query");
    this.#name = actionName(options.name, "Query");
    this.#version = actionVersion(options.version, "Query");
    this.#principal = exactly(options.principal, Principal, "Principal", "Query principal");
    this.#correlationId = exactly(options.correlationId, CorrelationId, "CorrelationId", "Query correlationId");
    this.#causationId = optionalCausation(options.causationId, "Query");
    this.#payload = canonicalObject(options.payload, "a Query payload");
    Object.freeze(this);
  }

  get name() {
    return this.#name;
  }

  get version() {
    return this.#version;
  }

  get principal() {
    return this.#principal;
  }

  get correlationId() {
    return this.#correlationId;
  }

  get causationId() {
    return this.#causationId;
  }

  get payload() {
    return this.#payload;
  }

  toJSON() {
    return {
      kind: "query",
      name: this.#name,
      version: this.#version,
      principal: this.#principal.toJSON(),
      correlationId: this.#correlationId.toString(),
      causationId: this.#causationId === null ? null : this.#causationId.toString(),
      payload: this.#payload,
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, Query) || !isExactly(other, Query)) return false;
    if (!(#name in this) || !(#name in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "Query";
  }
}
Object.freeze(Query.prototype);
Object.freeze(Query);

// =====================================================================================
// KernelError
//
// A failure as a value, not as a thrown thing. It deliberately does not extend the native error
// type and deliberately carries no message and no stack:
//
//   - A message is prose written for one audience, and it is where untranslatable, unversioned and
//     occasionally secret text ends up. The code is the contract; a caller that wants a sentence
//     renders one from the code in the ring that knows who is reading.
//   - A stack is a snapshot of one moment in one process. It is not part of a value, and a value
//     carrying one is no longer equal to an identical value produced elsewhere.
//
// The cause chain is bounded at eight. A chain is a diagnosis, and a diagnosis nobody will read
// past the eighth layer is one that has stopped explaining and started accumulating.
// =====================================================================================

const ERROR_OPTIONS = ["code", "details", "cause"];
// Shouted, underscore-separated, bounded. This is the machine-readable identity of a failure, and
// bounding it keeps it usable as a metric label and a lookup key rather than as a sentence.
const ERROR_CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const ERROR_CODE_MAX = 64;
const MAX_CAUSE_DEPTH = 8;

export class KernelError {
  #code;
  #details;
  #cause;
  #depth;

  constructor(options) {
    exactOptions(options, ERROR_OPTIONS, "KernelError");

    const { code, details, cause } = options;
    if (typeof code !== "string") {
      throw new TypeError(`KernelError needs a primitive string code, not ${code === null ? "null" : typeof code}`);
    }
    if (code.length > ERROR_CODE_MAX) {
      throw new RangeError(`KernelError needs a code of at most ${ERROR_CODE_MAX} characters`);
    }
    if (!ERROR_CODE.test(code)) {
      throw new TypeError("KernelError needs an uppercase underscore-separated code");
    }
    this.#code = code;

    this.#details = details === null ? null : canonicalObject(details, "KernelError details");

    if (cause === null) {
      this.#cause = null;
      this.#depth = 1;
    } else {
      exactly(cause, KernelError, "KernelError", "KernelError cause");
      if (cause.#depth >= MAX_CAUSE_DEPTH) {
        throw new RangeError(`a KernelError cause chain is at most ${MAX_CAUSE_DEPTH} deep`);
      }
      this.#cause = cause;
      this.#depth = cause.#depth + 1;
    }
    Object.freeze(this);
  }

  get code() {
    return this.#code;
  }

  get details() {
    return this.#details;
  }

  get cause() {
    return this.#cause;
  }

  /** Fixed order: what failed, what it was about, what it came from. */
  toJSON() {
    return {
      code: this.#code,
      details: this.#details,
      cause: this.#cause === null ? null : this.#cause.toJSON(),
    };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, KernelError) || !isExactly(other, KernelError)) return false;
    if (!(#code in this) || !(#code in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "KernelError";
  }
}
Object.freeze(KernelError.prototype);
Object.freeze(KernelError);

// =====================================================================================
// Result
//
// Two branches and one way to ask which. There is no `isFailure`: a second predicate spelling the
// negation is a second thing to keep true, and the first caller to read it on a value that
// answered both would never learn which one was authoritative.
//
// Reading the branch that is not there throws rather than answering undefined, because an
// undefined is a value a caller can carry three frames before noticing, and a throw is noticed
// here. There is no public constructor: a Result built by hand could be neither branch or both,
// and every getter would then be answering about nothing.
//
// There are no combinators — no map, no unwrap, no fold. They are how a result type grows a
// control-flow vocabulary, and control flow belongs to the use-case package that has not been
// authorized yet.
// =====================================================================================

/**
 * The token that makes the constructor private.
 *
 * The factories name the class directly rather than `new this(...)`, so reaching them through a
 * subclass still mints an exact Result — otherwise a subclass would inherit a key to the door the
 * constructor just locked.
 */
const RESULT_ADMISSION = Symbol("Result admission");

export class Result {
  #ok;
  #value;
  #error;

  constructor(admission, ok, value, error) {
    if (admission !== RESULT_ADMISSION) {
      throw new TypeError("Result has no public constructor: use Result.ok or Result.failure");
    }
    this.#ok = ok;
    this.#value = value;
    this.#error = error;
    Object.freeze(this);
  }

  static ok(value) {
    return new Result(RESULT_ADMISSION, true, canonicalAnything(value, "a Result value"), null);
  }

  static failure(error) {
    exactly(error, KernelError, "KernelError", "Result.failure");
    return new Result(RESULT_ADMISSION, false, null, error);
  }

  get isOk() {
    return this.#ok;
  }

  get value() {
    if (!this.#ok) throw new TypeError("this Result is a failure and carries no value");
    return this.#value;
  }

  get error() {
    if (this.#ok) throw new TypeError("this Result is ok and carries no error");
    return this.#error;
  }

  /** Fixed order per branch: the discriminator first, then exactly the branch that exists. */
  toJSON() {
    return this.#ok
      ? { ok: true, value: this.#value }
      : { ok: false, error: this.#error.toJSON() };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, Result) || !isExactly(other, Result)) return false;
    if (!(#ok in this) || !(#ok in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "Result";
  }
}
Object.freeze(Result.prototype);
Object.freeze(Result);
