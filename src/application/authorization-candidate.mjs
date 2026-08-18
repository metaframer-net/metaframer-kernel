// =====================================================================================
// AuthorizationCandidate: an immutable exact typed value for the existing
// {policyId, effect, applies} candidate-outcome shape, and nothing else.
//
// It changes no decision: AuthorizationEvaluator's deny-overrides/default-deny/winner/trace
// behavior is unchanged by this value existing. Admission is identical to the plain-record
// validation AuthorizationEvaluator already applies to a candidate.
//
// Frozen non-goals: no PolicyStatement, no action-coordinate wildcard, no rule or condition
// schema, no deriveCandidate, no candidate matching/scoping, no RBAC/ABAC/ReBAC engine, no
// PolicyRequest/PDP/Policy port, no RLS/DB/SDK/Delivery/HTTP vocabulary.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

function isOrdinaryDataObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactEnumerableDataKeys(value, expected) {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  for (const key of expected) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return keys.every((key) => expected.includes(key));
}

const CANDIDATE_OPTIONS = ["policyId", "effect", "applies"];
const EFFECTS = new Set(["allow", "deny"]);
const POLICY_ID_MAX = 128;
const POLICY_ID_FORM = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

function checkOptions(options) {
  if (!isOrdinaryDataObject(options) || !hasExactEnumerableDataKeys(options, CANDIDATE_OPTIONS)) {
    throw new TypeError(`AuthorizationCandidate takes exactly these options: ${CANDIDATE_OPTIONS.join(", ")}`);
  }
  const { policyId, effect, applies } = options;
  if (typeof policyId !== "string" || policyId.length === 0 || policyId.length > POLICY_ID_MAX
    || !POLICY_ID_FORM.test(policyId)) {
    throw new TypeError("AuthorizationCandidate policyId needs a lowercase canonical id of letters, digits, dot or hyphen");
  }
  if (typeof effect !== "string" || !EFFECTS.has(effect)) {
    throw new TypeError('AuthorizationCandidate effect needs exactly "allow" or "deny"');
  }
  if (typeof applies !== "boolean") {
    throw new TypeError("AuthorizationCandidate applies needs a primitive boolean");
  }
  return { policyId, effect, applies };
}

export class AuthorizationCandidate {
  #policyId;
  #effect;
  #applies;

  constructor(options) {
    const checked = checkOptions(options);
    this.#policyId = checked.policyId;
    this.#effect = checked.effect;
    this.#applies = checked.applies;
    Object.freeze(this);
  }

  get policyId() {
    return this.#policyId;
  }

  get effect() {
    return this.#effect;
  }

  get applies() {
    return this.#applies;
  }

  /** Fixed order: the policy identified, the effect it carries, then whether it applies. */
  toJSON() {
    return { policyId: this.#policyId, effect: this.#effect, applies: this.#applies };
  }

  toString() {
    return JSON.stringify(this.toJSON());
  }

  equals(other) {
    if (!isExactly(this, AuthorizationCandidate) || !isExactly(other, AuthorizationCandidate)) return false;
    if (!(#policyId in this) || !(#policyId in other)) return false;
    return other.toString() === this.toString();
  }

  get [Symbol.toStringTag]() {
    return "AuthorizationCandidate";
  }
}
Object.freeze(AuthorizationCandidate.prototype);
Object.freeze(AuthorizationCandidate);
