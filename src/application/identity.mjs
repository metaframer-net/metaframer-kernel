// =====================================================================================
// The Identity port
//
// One type, and one thing it says: ask this object who is acting and it asks its single
// collaborator exactly once, awaits whatever came back, and either hands that value on completely
// unchanged — when it is a genuine `Principal` — or refuses. There is no third outcome, and there is
// nothing else in this module.
//
// This is P-M1-06 and nothing beyond it. A port is the shape a boundary must have; it is not a
// boundary, and it is not evidence that anything behind one has been built. Nothing here may be read
// as a claim that this kernel can establish who is calling it, that any caller has been
// authenticated, that a session, token or directory has been reached, or that any exit criterion has
// been closed.
//
// What is deliberately promised, stated plainly so nobody has to infer it:
//
//   - the collaborator is called once per question, with zero arguments and an undefined receiver;
//   - the value it produced is awaited, and returned as the very same object it already was;
//   - a value that is not a genuine `Principal` is refused, never repaired and never echoed.
//
// And what is just as deliberately *not* promised, because an identity port is the single easiest
// place in a kernel to accidentally claim more than was built:
//
//   - not that the principal is *true*. Nothing here compares the collaborator against anything, so
//     a conforming collaborator may hand back a principal for a tenant that closed last year and
//     this port will pass it straight through. The Domain brand proves that a `Principal` was
//     *constructed* through its own constructor, and therefore that its invariants were checked on
//     the way in. It proves nothing whatsoever about whether that principal is currently, actually,
//     the caller.
//   - not that the caller may do anything. There is no authentication, authorization, session,
//     token, role, scope, permission, policy, tenant-membership truth or freshness here, and none
//     belongs here. A port that answered "who" and "may they" at once would make every caller that
//     needs the first depend on a model of the second. That refusal is the reason this module is
//     small, and it is worth saying out loud rather than leaving to be noticed as an absence.
//   - not that answers are cached, stable, repeatable or ordered. Two calls may answer with two
//     different principals, and the second may settle before the first. Both are admitted, because
//     noticing either would mean remembering the previous answer, and a port that remembered would
//     be answering partly from itself rather than wholly from its collaborator.
//
// There is therefore no held principal, no held promise, no flag and no queue in this file: two
// calls on one instance meet nowhere, and two instances share nothing, because there is nothing for
// them to share. That is not an omission to be filled in later — it is the whole reason the list
// above can be honest.
//
// Framework-free and capability-free by construction. The one import is inward, to the Domain ring,
// and is taken for exactly one purpose: the brand this port probes lives on `Principal.prototype`.
// The type is probed and never republished, never rebuilt, and never taken apart. Nothing here reads
// ambient time, mints a random value, reaches the surrounding shell, opens a file, speaks a query
// language or touches persistence, and nothing here knows anything whatsoever about why it was
// asked.
//
// Three residuals are accepted on the record rather than by accident:
//
//   1. The `then` lookup. Awaiting an arbitrary value is what makes this port asynchronous, and the
//      language reads `then` off that value on our behalf before we ever see it. That single read is
//      unavoidable while the method remains async, and together with the prototype read the
//      admission rule must make, it is the whole of what this module ever does to a value it has not
//      yet accepted.
//   2. Assimilation. A value carrying a callable `then` is therefore absorbed by the await itself,
//      and its body runs inside this call — it may resolve, refuse, or take its time first. Nothing
//      here prevents that. What it cannot do is widen what counts as a principal: whatever it
//      resolves with meets exactly the same rule as any other value.
//   3. Interposition. Freezing the class and its prototype protects the properties they were given;
//      it does not stop a derived class from replacing this method, and it cannot make a forwarding
//      proxy visible from the far side. A caller holding a reference is trusting whoever handed it
//      over, and this module does not pretend otherwise. The same limit runs the other way: a
//      transparent proxy over a genuine principal is refused here, because a private field is looked
//      up on the proxy rather than on its target.
// =====================================================================================

import { Principal } from "../domain/identity-primitives.mjs";

/**
 * The private-brand probe, captured once.
 *
 * It is the accessor the Domain installed for a principal's tenant part, and it is read here for one
 * reason: invoked with a candidate as its receiver, it succeeds for an object the Domain constructor
 * actually ran for, and throws for everything else. That is the only question asked of it. The value
 * it hands back is never read, never rendered and never taken apart — this port recognises a value,
 * it does not inspect one.
 *
 * Capturing once is safe because the accessor is non-configurable on a frozen prototype belonging to
 * a frozen class, so there is nothing to swap out from under the capture. It is also, for exactly
 * that reason, unobservable from outside: no experiment can tell a once-captured probe from a
 * re-read one.
 */
const BRAND = Object.getOwnPropertyDescriptor(Principal.prototype, "tenantId").get;

/**
 * The refusals, fixed in full.
 *
 * Neither one names what it was handed. A principal names a real tenant and a real person or
 * service, and a message is the one place a value walks straight into a log nobody redacted — so the
 * refused candidate is not rendered, not quoted and not summarised. One message covers every
 * refusal, so the refusal itself cannot become a side channel telling a caller which of its several
 * near-misses it got wrong.
 */
const REFUSED_OPTIONS = "Identity needs an ordinary object holding exactly one own enumerable current function";
const REFUSED_PRINCIPAL = "Identity.current needs a genuine Principal instance from its collaborator";

/**
 * Whether a candidate is a genuine `Principal`, by both halves of the rule.
 *
 * Neither half is sufficient, and each admits precisely what the other refuses. Prototype identity
 * alone admits an object built straight on the frozen prototype: it answers `instanceof`, it wears
 * the class-name tag, it renders identically, and the Domain constructor never ran for it, so none
 * of that constructor's invariants were ever checked. The brand alone admits a subclass instance:
 * the constructor really did run, so the private field is installed, and the object may still carry
 * behaviour, state and overrides the Domain never saw.
 *
 * Prototype identity rather than `instanceof`, for the same reason: `instanceof` walks the chain and
 * so cannot tell a base instance from a derived one.
 *
 * The candidate is not coerced, not unwrapped and not repaired. A port that read the parts off a
 * lookalike and assembled a principal from them would be deciding what its collaborator meant, and
 * the next collaborator to arrive would be calibrated against a repair rather than against the
 * contract.
 */
function isGenuinePrincipal(candidate) {
  if (candidate === null || typeof candidate !== "object") return false;
  if (Object.getPrototypeOf(candidate) !== Principal.prototype) return false;
  try {
    BRAND.call(candidate);
  } catch {
    return false;
  }
  return true;
}

/**
 * Take the one collaborator out of the one options object, or refuse.
 *
 * Every rule below exists to stop a caller believing it configured something this module will never
 * read. Ordinariness is checked before the key is: an exotic object could answer the questions that
 * follow with code of its own, and could hand a different function to the reader than to the
 * reviewer. The key set is checked with `Reflect.ownKeys` rather than `Object.keys`, so a
 * symbol-keyed member counts too — a member that shows up in no name listing and in no review that
 * reads for names is the natural place for a second option to arrive unannounced. The descriptor is
 * read before the value, so an accessor is refused rather than invoked: reading an option may not
 * run caller code.
 *
 * Missing is refused rather than defaulted. There is no fallback principal, no anonymous, no system
 * and no root: a port that supplied its own answer would answer without the collaborator, and the
 * caller would never learn its identity port was never wired.
 *
 * One thing this cannot refuse, said plainly: a transparent proxy over a legal options object
 * answers all of it exactly as its target does, and the language offers no way to ask whether an
 * object is a proxy. Such an object is therefore admitted, and no detection is claimed here.
 */
function collaboratorOf(options) {
  if (options === null || typeof options !== "object" || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError(REFUSED_OPTIONS);
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== 1 || keys[0] !== "current") {
    throw new TypeError(REFUSED_OPTIONS);
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, "current");
  if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) {
    throw new TypeError(REFUSED_OPTIONS);
  }
  // A function and no narrower. A class is a function and stays admissible: refusing one would be a
  // rule about how a caller spelled its collaborator, which is not this port's business. A
  // ready-made principal is refused by exactly this line — handing the value instead of the
  // capability would make this a holder rather than a port, and a holder answers the same thing
  // forever.
  if (typeof descriptor.value !== "function") {
    throw new TypeError(REFUSED_OPTIONS);
  }
  return descriptor.value;
}

// =====================================================================================
// Identity
//
// The instance is one collaborator and nothing else. It is frozen, it carries no own property, and
// it accumulates nothing between calls — so the hundredth answer is produced by exactly the same
// steps as the first, and the ninety-ninth is not among them.
//
// The collaborator is held privately and is never handed back. A getter, a static lookup or a
// `toJSON` would each put a live collaborator one hop from a caller that could then call it
// directly, and a caller calling it directly has walked straight around the only thing this port
// does. The private field is also the only honest proof of what an instance is: `instanceof` is
// satisfied by a prototype and the tag is inherited, so both can be worn by an object holding no
// collaborator at all, and such an object must not be able to answer.
//
// There is no equality and no rendering on this type, because an Identity is behaviour rather than a
// value, and nothing to construct it with but its constructor.
// =====================================================================================

export class Identity {
  #ask;

  constructor(options) {
    this.#ask = collaboratorOf(options);
    Object.freeze(this);
  }

  /**
   * Ask who is acting.
   *
   * Always a Promise, on every path. A caller that wrote `identity.current().catch(...)` must reach
   * its handler whatever happened — including when the answer was refused — so a refusal arrives as
   * a rejection rather than as a synchronous throw. Declaring the method async is what makes that
   * true by construction rather than by remembering.
   *
   * Zero arguments, because there is nothing a caller may pass to a question about who is already
   * acting. Surplus arguments are ignored rather than refused: arity is what this method promises,
   * not a rule about how the caller spelled the call site, and it is emphatically not a hint that
   * the answer may be narrowed or parameterised.
   *
   * The collaborator is lifted out of its field before being called, so it is invoked as a plain
   * function with an undefined receiver. Calling it in place would hand it this very port, and a
   * collaborator holding its port can call the port that is holding it — and could reach an option
   * the caller never exposed.
   *
   * Called once, and once only. A second call would be this port consulting its source and then
   * consulting it again to check, on behalf of arbitrary code with arbitrary costs; and a refused
   * answer is not asked again in the hope of a better one.
   *
   * Nothing the collaborator throws or refuses with is caught, re-typed or wrapped. It travels out
   * as the very value it was, whether or not it is an error, because what a collaborator threw is
   * the one piece of evidence the caller's own handling was written against.
   *
   * A value that passes is returned exactly as it arrived, the very object the collaborator
   * produced — this port hands the principal on, it does not rebuild it. A rebuild would be
   * value-equal to the original and would satisfy every equality-based check anyone might write,
   * which is precisely why the guarantee is stated as sameness rather than as equality.
   */
  async current() {
    const ask = this.#ask;
    const candidate = await ask();
    if (!isGenuinePrincipal(candidate)) {
      throw new TypeError(REFUSED_PRINCIPAL);
    }
    return candidate;
  }

  get [Symbol.toStringTag]() {
    return "Identity";
  }
}
Object.freeze(Identity.prototype);
Object.freeze(Identity);
