import { createHash } from "node:crypto";

// =====================================================================================
// Identity primitives
//
// The smallest value types the domain needs to say which tenant something belongs to, who
// acted, how one message caused another, and which idempotency fingerprint a retry carries.
//
// Framework-free by construction. node:crypto is the only dependency, and there is nothing
// here that reaches a database, speaks SQL, calls a service, reads configuration or touches
// a file. There is no command, query, use-case, port, repository or composition concern
// either: every export is a value type, and the surface of each one is a constructor, an
// exact-class `equals`, a canonical `toString`/`toJSON`, and a class-name tag.
//
// Each type is closed the same way:
//
//   - the constructor takes one primitive string and validates it before anything else, so
//     an instance that exists is an instance that is already canonical;
//   - the canonical value lives in a private field, so an instance carries no own property
//     to read, enumerate, mutate or serialise around;
//   - the instance, the class and the prototype are all frozen;
//   - equality is exact-class in both directions. A subclass instance is never equal to a
//     base instance, and no value of another type ever is, however alike it looks.
//
// There is deliberately no shared base class, public or otherwise. Six closed types repeat
// four short methods, which is the cost of the guarantee: a base would let a later member of
// this family silently inherit a validator that was never written for it, and the repetition
// is what keeps each validator readable beside the type it defends.
// =====================================================================================

/**
 * Exact-class test used by every `equals` and by Principal's constructor.
 *
 * Prototype identity, not `instanceof`: `instanceof` walks the chain, so a subclass would pass
 * it and two values that are not the same type would compare equal.
 */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

/**
 * The canonical string, or a plain-object rendering when the receiver is not an instance.
 *
 * A prototype is reachable as an ordinary object — `Object.prototype`'s `__proto__` getter hands
 * it out — and calling `toString` on it must not throw and must not invent a value. Rendering it
 * the way a plain object renders is the honest answer for something that holds no identity.
 */
const notAnInstance = (receiver) => Object.prototype.toString.call(receiver);

// -------------------------------------------------------------------------------------
// UUID-form identities
//
// Canonical form only: lowercase hexadecimal in 8-4-4-4-12 groups. Uppercase, unhyphenated,
// braced, URN-prefixed and whitespace-padded spellings are all refused rather than normalised,
// because normalising means two different strings become one identity and the caller never
// learns which one it sent.
//
// No version or variant restriction is imposed: which UUID version a deployment mints is the
// caller's decision, and this module has no basis for overruling it. The one excluded value is
// the nil UUID, which names no entity and so is never an identity.
// -------------------------------------------------------------------------------------

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function canonicalUuid(value, type) {
  if (typeof value !== "string") {
    throw new TypeError(`${type} needs a primitive string, not ${value === null ? "null" : typeof value}`);
  }
  if (!UUID_FORM.test(value)) {
    throw new TypeError(`${type} needs a canonical lowercase hyphenated UUID in 8-4-4-4-12 form`);
  }
  if (value === NIL_UUID) throw new RangeError(`${type} must not be the nil UUID`);
  return value;
}

export class TenantId {
  #value;

  constructor(value) {
    this.#value = canonicalUuid(value, "TenantId");
    Object.freeze(this);
  }

  equals(other) {
    return isExactly(this, TenantId) && isExactly(other, TenantId) && other.#value === this.#value;
  }

  toString() {
    return #value in this ? this.#value : notAnInstance(this);
  }

  toJSON() {
    return this.toString();
  }

  get [Symbol.toStringTag]() {
    return "TenantId";
  }
}
Object.freeze(TenantId.prototype);
Object.freeze(TenantId);

export class CorrelationId {
  #value;

  constructor(value) {
    this.#value = canonicalUuid(value, "CorrelationId");
    Object.freeze(this);
  }

  equals(other) {
    return isExactly(this, CorrelationId) && isExactly(other, CorrelationId) && other.#value === this.#value;
  }

  toString() {
    return #value in this ? this.#value : notAnInstance(this);
  }

  toJSON() {
    return this.toString();
  }

  get [Symbol.toStringTag]() {
    return "CorrelationId";
  }
}
Object.freeze(CorrelationId.prototype);
Object.freeze(CorrelationId);

export class CausationId {
  #value;

  constructor(value) {
    this.#value = canonicalUuid(value, "CausationId");
    Object.freeze(this);
  }

  equals(other) {
    return isExactly(this, CausationId) && isExactly(other, CausationId) && other.#value === this.#value;
  }

  toString() {
    return #value in this ? this.#value : notAnInstance(this);
  }

  toJSON() {
    return this.toString();
  }

  get [Symbol.toStringTag]() {
    return "CausationId";
  }
}
Object.freeze(CausationId.prototype);
Object.freeze(CausationId);

// -------------------------------------------------------------------------------------
// ActorId
//
// Deliberately opaque, and deliberately narrower than the PostgreSQL text columns actors are
// already stored in: visible ASCII only, 1 to 128 characters, case preserved exactly. Opaque
// because an actor identifier arrives from whatever issued it — a subject claim, a service
// account name, an operator login — and this module has no standing to parse it. Bounded and
// visible-only because an identifier carrying whitespace, a control character or an invisible
// codepoint is one that reads differently in a log, a header and a query result.
//
// Case is preserved rather than folded for the same reason the UUID forms are not normalised:
// folding would merge two identifiers the caller kept distinct.
// -------------------------------------------------------------------------------------

const ACTOR_FORM = /^[\x21-\x7e]{1,128}$/;

function canonicalActor(value) {
  if (typeof value !== "string") {
    throw new TypeError(`ActorId needs a primitive string, not ${value === null ? "null" : typeof value}`);
  }
  if (!ACTOR_FORM.test(value)) {
    throw new TypeError("ActorId needs 1 to 128 visible ASCII characters (0x21 through 0x7e)");
  }
  return value;
}

export class ActorId {
  #value;

  constructor(value) {
    this.#value = canonicalActor(value);
    Object.freeze(this);
  }

  equals(other) {
    return isExactly(this, ActorId) && isExactly(other, ActorId) && other.#value === this.#value;
  }

  toString() {
    return #value in this ? this.#value : notAnInstance(this);
  }

  toJSON() {
    return this.toString();
  }

  get [Symbol.toStringTag]() {
    return "ActorId";
  }
}
Object.freeze(ActorId.prototype);
Object.freeze(ActorId);

// -------------------------------------------------------------------------------------
// Principal
//
// The one public composite: a tenant and an actor, together, as a single value. It requires
// the two instances themselves rather than their strings, so a caller cannot assemble a
// principal out of two loose strings it has not validated, and cannot pass them in the wrong
// order without being told.
//
// It says who is acting and on whose behalf. It says nothing about what they may do: there is
// no authentication, authorization, role, permission, scope or policy behaviour here, and none
// belongs here. A type that answered "who" and "may they" at once would make every caller that
// needs the first depend on a model of the second.
// -------------------------------------------------------------------------------------

export class Principal {
  #tenantId;
  #actorId;

  constructor(tenantId, actorId) {
    if (!isExactly(tenantId, TenantId)) throw new TypeError("Principal needs a TenantId instance as its first argument");
    if (!isExactly(actorId, ActorId)) throw new TypeError("Principal needs an ActorId instance as its second argument");
    this.#tenantId = tenantId;
    this.#actorId = actorId;
    Object.freeze(this);
  }

  get tenantId() {
    return this.#tenantId;
  }

  get actorId() {
    return this.#actorId;
  }

  equals(other) {
    return (
      isExactly(this, Principal) &&
      isExactly(other, Principal) &&
      other.#tenantId.equals(this.#tenantId) &&
      other.#actorId.equals(this.#actorId)
    );
  }

  /** A stable shape: tenant first, actor second, both as their canonical strings. */
  toJSON() {
    return { tenantId: this.#tenantId.toString(), actorId: this.#actorId.toString() };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  get [Symbol.toStringTag]() {
    return "Principal";
  }
}
Object.freeze(Principal.prototype);
Object.freeze(Principal);

// -------------------------------------------------------------------------------------
// IdempotencyKey
//
// The raw string is held only long enough to validate and hash it. What the instance keeps is
// a lowercase SHA-256 fingerprint and nothing else, so there is no own property, getter, JSON
// form, string form, inspection form or rejection message from which the raw input can be read
// back. That is the whole point of the type: a caller-supplied idempotency string may carry an
// order reference, an external identifier or a customer-visible token, and none of that should
// end up in a log line because something stringified a key.
//
// Bounds, and why each one is here:
//
//   - 1 to 1024 UTF-8 bytes. Bytes rather than characters, because the limit exists so callers
//     cannot hand over an unbounded string to hash, and a character count says nothing about
//     how large that string actually is.
//   - No leading or trailing whitespace. Two raw inputs differing only in padding are the same
//     intent with two different fingerprints, which is exactly the retry that would not dedupe.
//   - No C0 or DEL control characters anywhere, for the same reason ActorId excludes them.
//
// What is deliberately absent: no key material, no keyed digest, no generation of raw inputs,
// no storage, and no way to rehydrate a key from a serialised fingerprint. Feeding a fingerprint
// back into the constructor simply hashes that hex string; it does not reconstruct the key, and
// reconstruction is not something this package offers.
//
// Residual risk, stated rather than left implicit: SHA-256 is unkeyed, so a fingerprint over a
// low-entropy raw input — a short counter, a sequential order number, a predictable slug — can
// be recovered offline by guessing candidate inputs and hashing them until one matches. Nothing
// here defends against that, and nothing here should be read as doing so. Defending against it
// would need a keyed digest over a secret this package has no place holding, so the mitigation
// belongs to the caller: keep raw idempotency inputs high-entropy, and treat a fingerprint as a
// correlation value rather than as a confidentiality boundary.
// -------------------------------------------------------------------------------------

const RAW_MIN_BYTES = 1;
const RAW_MAX_BYTES = 1024;
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;
const utf8 = new TextEncoder();

/** Validate the raw input and return its fingerprint. The raw string is never retained. */
function fingerprintOf(raw) {
  if (typeof raw !== "string") {
    throw new TypeError(`IdempotencyKey needs a primitive string, not ${raw === null ? "null" : typeof raw}`);
  }
  // Every message below describes the rule that was broken and never quotes the raw input.
  if (raw.trim() !== raw) {
    throw new RangeError("IdempotencyKey raw input must carry no leading or trailing whitespace");
  }
  if (CONTROL_CHARACTER.test(raw)) {
    throw new RangeError("IdempotencyKey raw input must carry no C0 or DEL control character");
  }
  const bytes = utf8.encode(raw).length;
  if (bytes < RAW_MIN_BYTES || bytes > RAW_MAX_BYTES) {
    throw new RangeError(
      `IdempotencyKey raw input must be ${RAW_MIN_BYTES} to ${RAW_MAX_BYTES} UTF-8 bytes, and this one is ${bytes}`,
    );
  }
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export class IdempotencyKey {
  #fingerprint;

  constructor(raw) {
    this.#fingerprint = fingerprintOf(raw);
    Object.freeze(this);
  }

  get fingerprint() {
    return this.#fingerprint;
  }

  equals(other) {
    return (
      isExactly(this, IdempotencyKey) &&
      isExactly(other, IdempotencyKey) &&
      other.#fingerprint === this.#fingerprint
    );
  }

  toString() {
    return #fingerprint in this ? this.#fingerprint : notAnInstance(this);
  }

  toJSON() {
    return this.toString();
  }

  get [Symbol.toStringTag]() {
    return "IdempotencyKey";
  }
}
Object.freeze(IdempotencyKey.prototype);
Object.freeze(IdempotencyKey);
