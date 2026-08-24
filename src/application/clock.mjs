// =====================================================================================
// The Clock port
//
// One type, and one thing it says: ask this object for the time and it asks its single collaborator
// exactly once, awaits whatever came back, and either hands that value on completely unchanged or
// refuses. There is no third outcome, and there is nothing else in this module.
//
// This is P-M1-05 and nothing beyond it. A port is the shape a boundary must have; it is not a
// boundary, and it is not evidence that anything behind one has been built. Nothing here may be read
// as a claim that this kernel can tell the time, that a host clock has been reached, or that any
// exit criterion has been closed.
//
// What is deliberately promised, stated plainly so nobody has to infer it:
//
//   - the collaborator is called once per reading, with zero arguments and an undefined receiver;
//   - the value it produced is awaited, and returned as the very same primitive it already was;
//   - a value that is not a canonical UTC instant is refused, never repaired and never echoed.
//
// And what is just as deliberately *not* promised, because a clock is the easiest place in a kernel
// to accidentally claim more than was built:
//
//   - not that the reading is true. Nothing here compares the collaborator against anything, so a
//     conforming reading may be wrong by a century and it will still pass straight through;
//   - not that readings are unique, repeatable, ordered or ever-increasing. Two calls may answer
//     with one instant, and the second may name an earlier one than the first. Both are admitted,
//     because noticing either would mean remembering the previous reading, and a port that
//     remembered would be answering partly from itself rather than wholly from its collaborator;
//   - not that reading is cheap or safe. The collaborator is arbitrary code and is treated as such.
//
// There is therefore no stored reading, no held promise, no flag and no queue in this file: two
// calls on one instance meet nowhere, and two instances share nothing, because there is nothing for
// them to share. That is not an omission to be filled in later — it is the whole reason the list
// above can be honest.
//
// Validity is arithmetic this module performs, and it delegates to no host parser. The obvious
// delegate is lenient in exactly the places a clock is dangerous: it rolls the twenty-ninth of a
// non-leap February forward into March, turns impossible days into the following month, and reads
// hour twenty-four as midnight the next morning. A port built on that would admit instants that do
// not exist and hand them on as if they did, so the year, month, day and time-of-day ranges below
// are computed and can be read. The other candidate parser is correct and is still refused: a port
// that leaned on a host object would depend on which host it happened to be running in.
//
// Framework-free, capability-free and import-free by construction. This module imports nothing at
// all — not even from its own ring — because a port that named one concrete collaborator would be a
// contract about that collaborator rather than about a boundary. Nothing here reads ambient time,
// mints a random value, reaches the surrounding shell, opens a file, speaks a query language or
// touches a store, and nothing here knows anything whatsoever about who is asking.
//
// Three residuals are accepted on the record rather than by accident:
//
//   1. The `then` lookup. Awaiting an arbitrary value is what makes this port asynchronous, and the
//      language reads `then` off that value on our behalf before we ever see it. That single read
//      is unavoidable while `now` remains async, and it is the only thing this module ever does to
//      a reading it did not accept.
//   2. Assimilation. A value carrying a callable `then` is therefore absorbed by the await itself,
//      and its body runs inside this call — it may resolve, refuse, or take its time first. Nothing
//      here can prevent that. What it cannot do is widen what counts as a reading: whatever it
//      resolves with meets exactly the same rule as any other value.
//   3. Interposition. Freezing the class and its prototype protects the properties they were given;
//      it does not stop a derived class from replacing this method, and it cannot make a forwarding
//      proxy visible from the far side. A caller holding a reference is trusting whoever handed it
//      over, and this module does not pretend otherwise.
// =====================================================================================

// -------------------------------------------------------------------------------------
// The one accepted spelling
//
// Twenty-four characters, ASCII digits only, in exactly one arrangement. The length is asserted
// beside the shape rather than left to it, so a reading that merely looks right at both ends cannot
// slip past on the strength of a pattern alone.
// -------------------------------------------------------------------------------------

const READING_LENGTH = 24;

const READING_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** How long each month is outside February's exception, in order, January first. */
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/**
 * The refusals, fixed in full.
 *
 * Neither one names what it was handed. A reading is the value an offset, a skew or a session
 * window is later computed from, and a message is the one place a value walks straight into a log
 * nobody redacted — so the refused candidate is not rendered, not quoted, and not summarised.
 */
const REFUSED_OPTIONS = "Clock needs an ordinary object holding exactly one own enumerable now function";
const REFUSED_READING = "Clock.now needs a canonical UTC instant spelled YYYY-MM-DDTHH:MM:SS.sssZ";

/** The Gregorian rule, written out: every fourth year, except centuries, except every fourth one. */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lengthOfMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

/**
 * Whether a string primitive names an instant that is both spelled canonically and real.
 *
 * The two halves are separate on purpose. The shape answers "is this the one spelling this port
 * accepts", which refuses a real instant written any other way rather than repairing it. The
 * arithmetic answers "does this instant exist", which is a different question entirely: every
 * candidate that reaches it already looks like a timestamp, and several of them name a day that
 * has never occurred.
 */
function namesARealInstant(candidate) {
  if (candidate.length !== READING_LENGTH || !READING_SHAPE.test(candidate)) return false;
  const year = Number(candidate.slice(0, 4));
  const month = Number(candidate.slice(5, 7));
  const day = Number(candidate.slice(8, 10));
  const hour = Number(candidate.slice(11, 13));
  const minute = Number(candidate.slice(14, 16));
  const second = Number(candidate.slice(17, 19));
  // Year 0000 is below the floor; 9999 is the ceiling and needs no check, because four digits
  // cannot spell more. The three digits of the fractional part are bounded the same way.
  if (year < 1) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > lengthOfMonth(year, month)) return false;
  // A time of day, not a duration: hour twenty-four is tomorrow written as today, and the sixtieth
  // second of a minute is a reading this port carries no table to interpret.
  if (hour > 23 || minute > 59 || second > 59) return false;
  return true;
}

/**
 * Take the one collaborator out of the one options object, or refuse.
 *
 * Every rule below exists to stop a caller believing it configured something this module will never
 * read. Ordinariness is checked before the key is: an exotic object could answer the questions that
 * follow with code of its own. The key set is checked with `Reflect.ownKeys` rather than
 * `Object.keys`, so a symbol-keyed member counts too — a member that shows up in no name listing
 * and in no review that reads for names is the natural place for a second option to arrive
 * unannounced. The descriptor is read before the value, so an accessor is refused rather than
 * invoked: reading an option may not run caller code.
 *
 * Missing is refused rather than defaulted. A clock that supplied its own reading would answer
 * without the collaborator, and the caller would never learn its clock was never wired.
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
  if (keys.length !== 1 || keys[0] !== "now") {
    throw new TypeError(REFUSED_OPTIONS);
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, "now");
  if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) {
    throw new TypeError(REFUSED_OPTIONS);
  }
  // A function and no narrower. A class is a function and stays admissible: refusing one would be a
  // rule about how a caller spelled its collaborator, which is not this port's business.
  if (typeof descriptor.value !== "function") {
    throw new TypeError(REFUSED_OPTIONS);
  }
  return descriptor.value;
}

// =====================================================================================
// Clock
//
// The instance is one collaborator and nothing else. It is frozen, it carries no own property, and
// it accumulates nothing between calls — so the hundredth reading is produced by exactly the same
// steps as the first, and the ninety-ninth is not among them.
//
// The collaborator is held privately and is never handed back. A getter, a static lookup or a
// `toJSON` would each put a live collaborator one hop from a caller that could then call it
// directly, and a caller calling it directly has walked straight around the only thing this port
// does. The prototype and the `Symbol.toStringTag` can each be worn by an object holding no
// collaborator at all, so neither proves anything by itself; the brand-aware `Symbol.hasInstance`
// below checks for the private field itself, which cannot be imitated the same way.
// =====================================================================================

export class Clock {
  #read;

  constructor(options) {
    this.#read = collaboratorOf(options);
    Object.freeze(this);
  }

  /**
   * Ask for one reading.
   *
   * Always a Promise, on every path. A caller that wrote `clock.now().catch(...)` must reach its
   * handler whatever happened — including when the reading was refused — so a refusal arrives as a
   * rejection rather than as a synchronous throw. Declaring the method async is what makes that
   * true by construction rather than by remembering.
   *
   * The collaborator is lifted out of its field before being called, so it is invoked as a plain
   * function with an undefined receiver. Calling it in place would hand it this very clock, and a
   * collaborator holding its clock can call the clock that is holding it.
   *
   * Called once, and once only. A second call would be this port consulting its source and then
   * consulting it again to check, on behalf of arbitrary code with arbitrary costs; and a refused
   * reading is not asked again in the hope of a better answer.
   *
   * Nothing the collaborator throws or refuses with is caught, re-typed or wrapped. It travels out
   * as the very value it was, whether or not it is an error, because what a collaborator threw is
   * the one piece of evidence the caller's own handling was written against.
   *
   * What comes back is examined with `typeof` and then read as a string, and in no other way. A
   * boxed string, an object with a `toString`, and anything else that would happily present itself
   * as an instant are all refused as they stand: a port that converted would be validating a value
   * other than the one it was handed. A value that passes is returned exactly as it arrived — this
   * port hands on the reading, it does not rebuild it.
   */
  async now() {
    const read = this.#read;
    const reading = await read();
    if (typeof reading !== "string" || !namesARealInstant(reading)) {
      throw new TypeError(REFUSED_READING);
    }
    return reading;
  }

  get [Symbol.toStringTag]() {
    return "Clock";
  }

  // Brand-aware, so a hollow Object.create(Clock.prototype) impostor answers false: the check is
  // the private field's own presence, never the collaborator, and it is never invoked here.
  static [Symbol.hasInstance](candidate) {
    return typeof candidate === "object" && candidate !== null && #read in candidate;
  }
}
Object.freeze(Clock.prototype);
Object.freeze(Clock);
