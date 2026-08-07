// =====================================================================================
// The UnitOfWork port
//
// One type, and one thing it says: three functions are called in one order — begin, then the body,
// then commit — and if the body fails, rollback is called instead of commit. That is the whole
// contract. What those three functions actually do is the business of whatever satisfies this
// port later, and this module is deliberately incapable of having an opinion about it.
//
// This is P-M1-04 and nothing beyond it. A port is the shape a boundary must have; it is not a
// boundary, it is not proof that a transactional store has been reached, and it is not evidence
// that any database work exists or works. It closes no M1 exit criterion, and nothing here may be
// read as a readiness, integration or release claim of any kind.
//
// Framework-free and capability-free by construction, and import-free besides. This module imports
// nothing at all — not even from its own ring — because a port that named one concrete collaborator
// would be a contract about that collaborator rather than about a boundary, and the thing arriving
// later would be satisfying something narrower than what was specified. There is nothing here that
// reads a clock, mints a random value, reaches the environment, opens anything, speaks a query
// language or touches a file.
//
// What is deliberately absent, and must stay absent:
//
//   - no idempotency, no caching, no retry, no savepoints, no isolation level. Every one of those
//     is a policy about *how* a boundary behaves; this port only says *when* its three functions
//     are called, and a policy smuggled in here would be inherited by everything that ever
//     satisfies it;
//   - no repositories, no outbox, no audit trail, no clock, no policy decision point;
//   - no inspection of what the body returned. A returned failure value is the body succeeding at
//     saying no, and this module does not look at it — reading it would be this port inventing the
//     validation rule it was told not to have;
//   - no database, connection, pool or query language of any kind;
//   - no validation boundary, no composition root, no wiring, no schema, no SDK, no app work.
//
// Two residuals are accepted here, on the record rather than by accident:
//
//   1. Rollback observability. When the body fails and the rollback fails too, the body's failure
//      is what propagates and the rollback's failure is dropped. That is a real loss of
//      information, and it is the lesser loss: the caller's error handling was written against
//      what its own body threw, and replacing that with a collaborator's failure would destroy the
//      only evidence it has. Reporting a failed rollback needs somewhere to report it *to*, which
//      is a concern this package does not have and must not invent. It is delegated to the later
//      adapter that actually owns a boundary.
//   2. Same-instance concurrency. A second run on one instance while the first is in flight is
//      refused, not queued. Queueing would mean deciding what a waiting caller's boundary relates
//      to, which is the same policy question the port exists to stay out of. Concurrency across
//      *separate* instances is unaffected — there is no module-level state for two of them to meet
//      in — so the refusal costs a caller one construction, and the alternative would have cost it
//      an ordering nobody declared.
// =====================================================================================

// -------------------------------------------------------------------------------------
// The port object
//
// Three collaborators, all required. Nothing here has a defensible default: a unit of work that
// supplied its own do-nothing rollback would swallow every failure it was handed and commit
// nothing, and the caller would never learn that half its boundary was never wired.
// -------------------------------------------------------------------------------------

const PORT_KEYS = ["begin", "commit", "rollback"];

/**
 * Require exactly the three port keys, all present.
 *
 * An unknown key is refused rather than dropped, because silently ignoring one lets a caller
 * believe it configured something. `Reflect.ownKeys` rather than `Object.keys` so a symbol-keyed
 * member is counted too: a surface that shows up in no key listing and in no review that reads for
 * names is the natural place for a fourth collaborator to arrive unannounced.
 */
function portOf(port) {
  if (port === null || typeof port !== "object" || Array.isArray(port)) {
    throw new TypeError("UnitOfWork needs a port object");
  }
  const given = Reflect.ownKeys(port);
  const complete = PORT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(port, key));
  if (!complete || given.length !== PORT_KEYS.length) {
    throw new TypeError(`UnitOfWork takes exactly these port keys: ${PORT_KEYS.join(", ")}`);
  }
  return port;
}

/**
 * A collaborator, as a function and no narrower.
 *
 * A class is a function and stays admissible: refusing one would be a rule about how a caller
 * spelled its collaborator, which is not this port's business. What a collaborator returns is not
 * this port's business either — it is awaited and otherwise untouched.
 */
function declaredFunction(value, key) {
  if (typeof value !== "function") {
    throw new TypeError(`UnitOfWork needs a function ${key}`);
  }
  return value;
}

// =====================================================================================
// UnitOfWork
//
// The instance is the three collaborators and one private flag, and nothing else. It is frozen, it
// carries no own property, and it accumulates nothing across runs — so two runs of one instance
// differ only in what the body does, and two instances share nothing at all.
//
// The collaborators are held privately and are never handed back. A getter would let any caller
// reach past `run` and call `commit` without ever having called `begin`, which is precisely the
// ordering this type exists to hold.
// =====================================================================================

export class UnitOfWork {
  #begin;
  #commit;
  #rollback;
  #inFlight = false;

  constructor(port) {
    portOf(port);
    this.#begin = declaredFunction(port.begin, "begin");
    this.#commit = declaredFunction(port.commit, "commit");
    this.#rollback = declaredFunction(port.rollback, "rollback");
    Object.freeze(this);
  }

  /**
   * Run one body inside one scope, and answer with whatever the body produced.
   *
   * Always a Promise, on every path. A caller that wrote `unitOfWork.run(body).catch(...)` must
   * reach its handler whatever happened — including when the body was refused before anything
   * began — so a refusal arrives as a rejection rather than as a synchronous throw. Async is what
   * makes that true by construction rather than by remembering.
   *
   * The order, and why each step sits where it does:
   *
   *   1. the body is a function. This is checked before anything else, because beginning something
   *      no body will ever run is the worst available ordering: the boundary would be opened, and
   *      the only thing that could close it never existed;
   *   2. no run is already in flight on this instance. The flag is raised here, before the first
   *      await, so a second call made from the same synchronous turn — or from inside the body
   *      itself — meets it. Both checks stand outside the try, so a refused call can never clear
   *      the flag belonging to the run it was refused by;
   *   3. begin, with no arguments, and whatever it resolves to is the scope;
   *   4. the body, with that scope;
   *   5. commit with the same scope, awaited, so a caller that has been answered knows the
   *      boundary closed rather than merely that it was asked to.
   *
   * Each of the four is lifted out of its field before being called, so each is invoked as a plain
   * function with an undefined `this`. Calling one in place would hand it this very unit of work,
   * and a collaborator holding its unit of work can re-enter the run that is holding it.
   *
   * The scope is opaque. It is carried from begin to the body to commit by identity and is never
   * read, rendered, enumerated or stored: what it is belongs to whatever produced it, and a single
   * property read here would become a rule about what every future implementation may be.
   *
   * Nothing thrown or rejected is caught for the caller's benefit, re-typed or wrapped. It
   * propagates by identity, because what a collaborator threw is the one piece of evidence the
   * caller's own error handling was written against. A body failure is the only path that runs
   * anything afterwards, and the rollback's own failure is suppressed there so the body's failure
   * survives — the accepted residual recorded at the top of this file.
   */
  async run(body) {
    if (typeof body !== "function") {
      throw new TypeError("UnitOfWork.run needs a function body");
    }
    if (this.#inFlight) {
      throw new TypeError("UnitOfWork.run is already in flight on this unit of work");
    }
    this.#inFlight = true;
    try {
      const begin = this.#begin;
      const scope = await begin();
      let value;
      try {
        value = await body(scope);
      } catch (failure) {
        const rollback = this.#rollback;
        try {
          await rollback(scope);
        } catch {
          // Suppressed on purpose, and this is the residual. The body's failure is what the caller
          // needs to see; a failed rollback replacing it would leave the caller reasoning about a
          // collaborator it never called. Observing this belongs to the adapter that owns a real
          // boundary and has somewhere to report it to.
        }
        throw failure;
      }
      const commit = this.#commit;
      await commit(scope);
      return value;
    } finally {
      // In a finally, so all four failure paths leave the instance usable. Cleared only on success,
      // one failed run would make a permanently dead unit of work, and nothing would tell the next
      // caller which run poisoned it.
      this.#inFlight = false;
    }
  }

  get [Symbol.toStringTag]() {
    return "UnitOfWork";
  }
}
Object.freeze(UnitOfWork.prototype);
Object.freeze(UnitOfWork);
