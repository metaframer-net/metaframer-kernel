import { Command, Query, Result } from "./action-primitives.mjs";

// =====================================================================================
// The UseCase contract
//
// One type, and one thing it says: this handler answers this action coordinate, and nothing else
// reaches it. A use case binds exactly one `name@version` in exactly one kind to exactly one
// function, and it holds the gate on both sides of the call — what may go in, and what may come
// back out.
//
// This is canonical M1 line 229 and nothing beyond it. It is not evidence that a kernel primitive
// is used inside a real use case, and it is not integration proof against a database. Saying what
// a use case must be is not the same as having built one, and nothing here may be read as the
// second claim.
//
// Framework-free and capability-free by construction. The one import is the action primitives of
// the same ring; there is nothing here that reads a clock, mints a random value, reaches the
// environment, opens a connection, speaks a query language or touches a file — because a contract
// whose behaviour could depend on any of those is a contract whose two executions over the same
// action are free to differ, and every guarantee below would then be a coincidence.
//
// What is deliberately absent, and must stay absent:
//
//   - no lookup of any kind. A use case knows one coordinate; choosing *between* use cases is a
//     whole concern with its own gate, and the moment this module could answer "which one handles
//     this name" it would be that concern wearing a smaller name.
//   - no port, unit of work, clock, policy, audit or outbox; no validation boundary; no wiring.
//   - no failure vocabulary. This module mints no error value and no error code. A refusal here is
//     a TypeError, which is what a broken contract has always been — and the failures a use case
//     actually models are the handler's to return, not this type's to invent.
//   - no equality and no rendering. A use case is behaviour, not a value: there is nothing to
//     compare it to, and a serialisation would put a live handler one step from a log line.
//
// Dependency direction, stated once: this module knows the action primitives, the action
// primitives know the domain identities, and neither knows this one. The arrow points inward and
// only inward.
// =====================================================================================

/**
 * Exact-class test, used for the action on the way in and the Result on the way out.
 *
 * Prototype identity, not `instanceof`: `instanceof` walks the chain, so a subclass would pass it
 * while carrying whatever the subclass added, and the use case would have no way to know. The
 * guards in front of it matter as much as the comparison — a primitive and a null must answer
 * `false` here rather than throw somewhere further along.
 */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/** The action type each kind admits. Two kinds, two types, and no third answer to reach for. */
const actionClassFor = (kind) => (kind === "command" ? Command : Query);

/**
 * The Result branch reader, lifted once from the frozen prototype.
 *
 * Reading it here rather than through the value is the whole point: invoked with a candidate as its
 * receiver, it touches the private state a real Result carries and nothing else can. If a later
 * version of the action primitives were to drop this member, this module would fail to load rather
 * than quietly fall back to a weaker gate — which is the correct direction to fail in.
 */
const readResultBranch = Object.getOwnPropertyDescriptor(Result.prototype, "isOk").get;

/**
 * Exact-class *and* branded: a real Result, not something wearing its prototype.
 *
 * Prototype identity alone is not enough on the way out, because two shapes answer `Result.prototype`
 * without being one. `Object.create(Result.prototype)` carries no branch at all; a proxy around a
 * genuine Result forwards its prototype but never carries private state, and every trap on it is a
 * place behaviour could be interposed on a value this contract has already vouched for. Both would
 * reach the caller as "a Result" and break somewhere further along, which is exactly the discovery
 * this gate exists to bring forward.
 *
 * So the brand is *proven* rather than inferred: the branch reader either completes or throws, and
 * completing is the proof. What it answers is deliberately ignored — a failure Result reads `false`
 * and is every bit as real as an ok one. The throw is turned into a plain `false` so the refusal
 * carries this module's own wording rather than an engine message about a private member.
 */
function isResult(value) {
  if (!isExactly(value, Result)) return false;
  try {
    readResultBranch.call(value);
  } catch {
    return false;
  }
  return true;
}

// -------------------------------------------------------------------------------------
// The declaration
//
// Four coordinates, all required. Nothing here has a defensible default: a use case that guessed
// its own kind would guess wrong in silence, and one that defaulted its version would run the
// wrong version of its own action while everything downstream looked like it worked.
// -------------------------------------------------------------------------------------

const DECLARATION_KEYS = ["kind", "name", "version", "handler"];

/**
 * Require exactly the four declaration keys, all present.
 *
 * An unknown key is refused rather than dropped, because silently ignoring one lets a caller
 * believe it declared something. `Reflect.ownKeys` rather than `Object.keys` so a symbol-keyed
 * member is counted too: a surface that never shows up in a key listing or a review that reads for
 * names is the natural place for a fifth coordinate to arrive unannounced.
 */
function declarationOf(declaration) {
  if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
    throw new TypeError("UseCase needs a declaration object");
  }
  const given = Reflect.ownKeys(declaration);
  const complete = DECLARATION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(declaration, key));
  if (!complete || given.length !== DECLARATION_KEYS.length) {
    throw new TypeError(`UseCase takes exactly these declaration keys: ${DECLARATION_KEYS.join(", ")}`);
  }
  return declaration;
}

/**
 * The kind, as one of exactly two primitive strings.
 *
 * These are the wire tokens the envelopes already render, so there is one vocabulary rather than
 * two. Strict equality is the whole rule, and it is what refuses a boxed string, a stringifiable
 * object and a look-alike wearing padding or a capital: a kind that arrived spelled differently is
 * a caller that believed something different, and normalising it would hide the disagreement.
 */
function declaredKind(value) {
  if (value !== "command" && value !== "query") {
    throw new TypeError('UseCase needs a kind of exactly "command" or "query"');
  }
  return value;
}

/**
 * The name, as a non-empty primitive string.
 *
 * Deliberately no form rule. The action carries its own already-validated name, and this
 * coordinate exists to be compared against that one — so a second, independent opinion about what
 * a name may look like could only ever disagree with the first. A name no action could carry makes
 * a use case unreachable, which is a dead declaration rather than an unsafe one.
 */
function declaredName(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("UseCase needs a non-empty primitive string name");
  }
  return value;
}

/** The version, on the same terms the action's own version coordinate is held to. */
function declaredVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("UseCase needs a safe integer version of at least 1");
  }
  return value;
}

/**
 * The handler, as a function and no narrower.
 *
 * A class is a function and stays admissible: refusing one would be a rule about how a caller
 * spelled its handler, which is not this contract's business. What the handler may *return* is
 * this contract's business, and that is checked where it happens.
 */
function declaredHandler(value) {
  if (typeof value !== "function") {
    throw new TypeError("UseCase needs a function handler");
  }
  return value;
}

// =====================================================================================
// UseCase
//
// The instance is the declaration and nothing else. It is frozen, it carries no own property, and
// it accumulates nothing by being used — so two executions of one use case differ only in what the
// handler does, and two use cases declared alike share nothing, because there is no module-level
// state for them to meet in.
//
// The handler is held privately and is never handed back. A getter would let any caller reach past
// `execute` and invoke it directly, which is exactly the gate this type exists to be.
// =====================================================================================

export class UseCase {
  #kind;
  #name;
  #version;
  #handler;

  constructor(declaration) {
    declarationOf(declaration);
    this.#kind = declaredKind(declaration.kind);
    this.#name = declaredName(declaration.name);
    this.#version = declaredVersion(declaration.version);
    this.#handler = declaredHandler(declaration.handler);
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

  /**
   * Run one action through this use case, and answer with the Result the handler produced.
   *
   * Always a Promise, on every path. A caller that wrote `useCase.execute(x).catch(...)` must reach
   * its handler whatever happened — including when the action was refused before the handler was
   * ever reached — so a refusal arrives as a rejection rather than as a synchronous throw. Async is
   * what makes that true by construction rather than by remembering.
   *
   * The gate, in order, and each step fail-closed:
   *
   *   1. the action is an exact instance of the type this kind admits. A Query handed to a
   *      state-changing use case would run a mutation carrying no idempotency key at all, since a
   *      Query has none to carry;
   *   2. its name and version are the declared ones. `name@version` is the action's identity, and a
   *      use case running the wrong version of its own action is the quietest possible failure:
   *      everything downstream would look like it worked;
   *   3. only then is the handler called — the gate is a gate, not an annotation, and a refused
   *      action never reaches it.
   *
   * The handler is lifted out of its field before being called, so it is invoked as a plain
   * function with an undefined `this`. Calling it in place would hand it this very use case, and a
   * handler holding its use case can re-enter the gate that just admitted it.
   *
   * What comes back must be a real Result — its prototype proves nothing on its own, so its brand
   * is read — and that same reference is what the caller receives, not a copy and not a rebuild, so
   * `result === theResultMyHandlerReturned` holds. Both branches pass through alike: a failure
   * Result is a modelled answer, not a broken handler.
   *
   * Nothing thrown or rejected is caught, re-typed or wrapped. It propagates by identity, because
   * what a handler threw is the one piece of evidence the caller's own error handling was written
   * against, and a contract that rewrote it would destroy exactly that.
   */
  async execute(action) {
    if (!isExactly(action, actionClassFor(this.#kind))) {
      throw new TypeError(`this UseCase admits only an exact ${this.#kind} action`);
    }
    if (action.name !== this.#name || action.version !== this.#version) {
      throw new TypeError(`this UseCase admits only ${this.#name}@${this.#version}`);
    }
    const handler = this.#handler;
    const result = await handler(action);
    if (!isResult(result)) {
      throw new TypeError("a UseCase handler must return a Result");
    }
    return result;
  }

  get [Symbol.toStringTag]() {
    return "UseCase";
  }
}
Object.freeze(UseCase.prototype);
Object.freeze(UseCase);
