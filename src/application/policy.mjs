import { Command, Query, Result } from "./action-primitives.mjs";

// =====================================================================================
// The Policy port
//
// One class, one collaborator, one question. A caller hands this port an action and receives back
// whatever its collaborator answered — or a rejection. There is no third outcome and there is
// nothing else here.
//
// The name is the most dangerous thing about this module, so what it is *not* is stated first and
// stated flatly. Nothing here decides anything. This module holds no rule, no condition, no
// subject, no resource, no action verb, no combining algorithm and no default. It does not
// evaluate, does not allow, does not deny, does not permit and does not enforce. It forwards a
// question to the one collaborator it was handed and returns the answer it was given, unopened.
//
// Three refusals follow from that, and each is a refusal to author something:
//
//   - It never authors an answer. A lookalike is refused, never repaired; a bare value is never
//     wrapped into an ok Result and a bare error is never wrapped into a failure one. A port that
//     assembled an answer out of parts would be a port that decided what its collaborator meant.
//   - It never reads the answer's branch. `Result.failure` is an ordinary Result: it resolves, it
//     travels back by identity, and it is never re-read as a refusal or converted into a rejection.
//     Treating one branch as "no" would be the first line of an authorization model, written in the
//     one module that promised not to have one.
//   - It never remembers. No cache, no memo, no single-flight, no queue and no imposed ordering, so
//     two calls on one instance meet nowhere and two instances share nothing. A remembered answer
//     would come partly from this port rather than wholly from its collaborator, and a decision
//     cache is a thing with an invalidation story and a staleness window that nothing here has.
//
// The frozen non-goals, listed so no reader has to infer them: no authentication, authorization,
// RBAC, ReBAC or ABAC; no decision point, enforcement point, rule, obligation, allow, deny or
// permit; no policy authoring, audit, outbox, row-level security, persistence, adapter, session,
// token, delegation, freshness, clock, environment or I/O. There is no PolicyRequest and no
// PolicyDecision either: a request type and a decision type are the two halves of a decision
// protocol, and naming either one would commit this kernel to the protocol between them. The action
// already has a type and the answer already has a type; this port needs no third.
//
// The one import is sideways within the Application ring, to the module that owns the three types
// this port recognises. They are imported to be probed, never to be republished, and the error type
// beside them is deliberately not taken: a port that could mint an error is one edit away from
// minting a refusal of its own.
// =====================================================================================

// -------------------------------------------------------------------------------------
// The three fixed refusals
//
// One message per rule, and each names only the rule that broke. None carries the candidate, a
// coordinate or a payload: a message composed from what it refused would tell a caller which of its
// near-misses it got wrong, and would carry a tenant or an actor straight into a log nobody
// redacted. None carries the vocabulary above either, because an error message is where a reader
// looks first to learn what a module is for.
// -------------------------------------------------------------------------------------

const OPTIONS_MESSAGE = "Policy needs an ordinary object holding exactly one own enumerable consult function";
const ACTION_MESSAGE = "Policy.consult needs an exact Command or Query instance";
const RESULT_MESSAGE = "Policy.consult needs a genuine Result instance from its collaborator";

// -------------------------------------------------------------------------------------
// The three brand probes, captured once
//
// Each is the getter installed on a frozen, non-configurable accessor of a frozen prototype, so
// capturing it at module evaluation is safe and re-reading it per call would be the opposite of
// safe: a probe fetched at call time is a probe somebody could have moved in between.
//
// They are captured because prototype identity alone is not enough. An object built straight on one
// of those prototypes passes an exact prototype comparison, carries the tag and renders like the
// real thing while holding no private field at all — nothing ever ran that constructor for it, so
// none of that constructor's invariants were ever checked, and its very first getter would throw on
// read. The brand alone is not enough either: a subclass instance had the real constructor run, so
// it carries the field, while its prototype is not the frozen one and it may carry state and
// overrides this ring never saw. Each impostor is admitted by exactly the half the other defeats,
// which is why both halves are required and neither is decoration.
// -------------------------------------------------------------------------------------

const COMMAND_BRAND = Object.getOwnPropertyDescriptor(Command.prototype, "name").get;
const QUERY_BRAND = Object.getOwnPropertyDescriptor(Query.prototype, "name").get;
const RESULT_BRAND = Object.getOwnPropertyDescriptor(Result.prototype, "isOk").get;

/**
 * Exact-class test: prototype identity, never `instanceof`.
 *
 * `instanceof` walks the chain, so it answers yes for a subclass carrying whatever that subclass
 * added, and this port would have no way to know.
 */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/**
 * Ask a captured probe whether a value carries the private field its owning constructor installs.
 *
 * A throw is the answer `false`, not an outcome to be propagated: this is an admission question
 * about a foreign value, and asking it must never itself become the failure.
 */
const carriesBrand = (brand, value) => {
  try {
    brand.call(value);
    return true;
  } catch {
    return false;
  }
};

/** Exactly one genuine Command or one genuine Query, by both halves of the rule. */
const isGenuineAction = (value) =>
  (isExactly(value, Command) && carriesBrand(COMMAND_BRAND, value))
  || (isExactly(value, Query) && carriesBrand(QUERY_BRAND, value));

/** Exactly one genuine Result, by both halves of the same rule. */
const isGenuineResult = (value) => isExactly(value, Result) && carriesBrand(RESULT_BRAND, value);

// =====================================================================================
// Policy
// =====================================================================================

export class Policy {
  #consult;

  /**
   * Take exactly one ordinary object holding exactly one own enumerable `consult` function.
   *
   * Ordinariness is settled before the key is looked at, so an exotic carrier is refused without its
   * `consult` ever being read — a carrier that could observe the read could hand a different
   * function to the reader than to the reviewer. The descriptor is then read rather than the value
   * fetched, so an accessor-defined option is refused without running caller code during
   * construction.
   *
   * Missing is refused rather than defaulted. There is no fail-open and no fail-closed here: a port
   * that supplied its own answer would answer without the collaborator, and the caller would never
   * learn it was never wired. An unknown key is refused rather than dropped, because silently
   * ignoring one lets a caller believe it configured something that nothing reads.
   *
   * The residual, stated rather than hidden: a transparent proxy over legal options answers every
   * question this constructor is able to ask exactly as its target does, and ECMAScript exposes no
   * standard way to ask whether an object is a proxy. Construction through one is admitted. This
   * port claims no proxy detection, because none exists to claim.
   */
  constructor(options) {
    if (options === null || typeof options !== "object") {
      throw new TypeError(OPTIONS_MESSAGE);
    }
    if (Object.getPrototypeOf(options) !== Object.prototype) {
      throw new TypeError(OPTIONS_MESSAGE);
    }
    const keys = Reflect.ownKeys(options);
    if (keys.length !== 1 || keys[0] !== "consult") {
      throw new TypeError(OPTIONS_MESSAGE);
    }
    const member = Object.getOwnPropertyDescriptor(options, "consult");
    if (!member || !("value" in member) || !member.enumerable || typeof member.value !== "function") {
      throw new TypeError(OPTIONS_MESSAGE);
    }
    this.#consult = member.value;
    Object.freeze(this);
  }

  /**
   * Forward one action to the collaborator and hand back exactly what it answered.
   *
   * Declared `async` so a caller that wrote `policy.consult(action).catch(...)` reaches its handler
   * on every path by construction rather than by discipline — including the input gate, which runs
   * first and would otherwise be the one refusal that escaped the promise.
   *
   * The order is the contract. The gate runs before the collaborator, so an unrecognised argument
   * never reaches the one party entitled to trust what this port hands it. The argument is
   * recognised, never awaited and never coerced: awaiting it would let an arbitrary `then` run
   * before anything had been admitted, and coercing it would mean the admitted value was not the
   * value handed over.
   *
   * The collaborator is lifted out of the field before being called, which is what makes the
   * undefined receiver true by construction: a collaborator that could reach this instance could
   * call it back, and one that received the options object could read a member the caller never
   * exposed. It is called once, with one argument, and the argument is the action itself — whole,
   * unopened and unprojected. Nothing here reads a coordinate off it, because a port that cared
   * which action it held would be starting to write a rule.
   *
   * The answer is awaited, admitted by both halves, and returned as the very object it already was.
   * Rebuilding a value-equal Result would satisfy every equality anyone might write and is refused
   * by identity. A throw or a rejection propagates unchanged: re-typing it would break a caller
   * matching on its own sentinel, and converting it into a failure Result would be authoring an
   * answer out of an outage.
   *
   * The residual on the answer side, unavoidable and therefore stated: `await` calls `then`, so a
   * hostile thenable answer gets to run arbitrary code inside this call. The input side is closed;
   * this door stays open by construction.
   */
  async consult(action) {
    if (!isGenuineAction(action)) {
      throw new TypeError(ACTION_MESSAGE);
    }
    const collaborator = this.#consult;
    const answer = await collaborator(action);
    if (!isGenuineResult(answer)) {
      throw new TypeError(RESULT_MESSAGE);
    }
    return answer;
  }

  get [Symbol.toStringTag]() {
    return "Policy";
  }
}
// Frozen in all three places, and honest about what that buys. It closes substitution on this class
// and this prototype; it says nothing about a derived prototype, which is a new object, and nothing
// about interposition, which is undetectable from the far side. A port cannot enforce itself, and a
// caller holding a reference is trusting whoever handed it over.
Object.freeze(Policy.prototype);
Object.freeze(Policy);
