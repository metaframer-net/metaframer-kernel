import { PolicyRequest, PolicyDecision } from "./policy-decision.mjs";

// =====================================================================================
// AuthorizationEvaluator: candidate-outcome combining, and nothing else.
//
// A frozen, stateless, no-arg class. `decide({request, candidates})` is synchronous and pure:
// it takes an exact genuine `PolicyRequest` and an already-scoped list of candidate outcomes,
// combines them by a fixed deny-overrides rule, and answers with an exact genuine
// `PolicyDecision`. It reads no coordinate off the request beyond the correlation id it must
// carry forward, looks up no role, permission or grant, and consults nothing outside its input.
//
// Frozen non-goals: no evaluation of a rule or condition against `resource`/`context`, no
// role/permission/grant model, no row-level access story, no record of a decision once made,
// no lookup, no I/O, and no generated client or delivery surface.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

const REQUEST_ACTION_GETTER = Object.getOwnPropertyDescriptor(PolicyRequest.prototype, "action").get;

function isGenuinePolicyRequest(value) {
  if (!isExactly(value, PolicyRequest)) return false;
  try {
    REQUEST_ACTION_GETTER.call(value);
    return true;
  } catch {
    return false;
  }
}

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

const DECIDE_OPTIONS = ["request", "candidates"];

function checkDecideOptions(options) {
  if (!isOrdinaryDataObject(options) || !hasExactEnumerableDataKeys(options, DECIDE_OPTIONS)) {
    throw new TypeError(`AuthorizationEvaluator.decide takes exactly these options: ${DECIDE_OPTIONS.join(", ")}`);
  }
  return options;
}

function isOrdinaryDenseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return Reflect.ownKeys(value).length === value.length + 1;
}

const CANDIDATE_KEYS = ["policyId", "effect", "applies"];
const EFFECTS = new Set(["allow", "deny"]);
const POLICY_ID_MAX = 128;
const POLICY_ID_FORM = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

function checkCandidate(candidate) {
  if (!isOrdinaryDataObject(candidate) || !hasExactEnumerableDataKeys(candidate, CANDIDATE_KEYS)) {
    throw new TypeError(`an authorization candidate takes exactly these keys: ${CANDIDATE_KEYS.join(", ")}`);
  }
  const { policyId, effect, applies } = candidate;
  if (typeof policyId !== "string" || policyId.length === 0 || policyId.length > POLICY_ID_MAX
    || !POLICY_ID_FORM.test(policyId)) {
    throw new TypeError("an authorization candidate policyId needs a lowercase canonical id of letters, digits, dot or hyphen");
  }
  if (typeof effect !== "string" || !EFFECTS.has(effect)) {
    throw new TypeError('an authorization candidate effect needs exactly "allow" or "deny"');
  }
  if (typeof applies !== "boolean") {
    throw new TypeError("an authorization candidate applies needs a primitive boolean");
  }
  return { policyId, effect, applies };
}

function checkCandidates(candidates) {
  if (!isOrdinaryDenseArray(candidates)) {
    throw new TypeError("authorization candidates needs an ordinary array carrying only its elements");
  }
  const seen = new Set();
  const checked = [];
  for (const entry of candidates) {
    const candidate = checkCandidate(entry);
    if (seen.has(candidate.policyId)) {
      throw new TypeError(`authorization candidate policyId ${candidate.policyId} is duplicated`);
    }
    seen.add(candidate.policyId);
    checked.push(candidate);
  }
  return checked;
}

const REASON = "authorization decision combined from the given candidate outcomes";

function smallestPolicyId(entries) {
  return entries.map((entry) => entry.policyId).sort()[0];
}

export class AuthorizationEvaluator {
  constructor(...args) {
    if (args.length !== 0) {
      throw new TypeError("AuthorizationEvaluator takes no constructor argument");
    }
    Object.freeze(this);
  }

  decide(options) {
    checkDecideOptions(options);
    const { request, candidates } = options;
    if (!isGenuinePolicyRequest(request)) {
      throw new TypeError("AuthorizationEvaluator.decide request needs an exact genuine PolicyRequest instance");
    }
    const checked = checkCandidates(candidates);
    const applicable = checked.filter((candidate) => candidate.applies === true);
    const applicableDenies = applicable.filter((candidate) => candidate.effect === "deny");
    const applicableAllows = applicable.filter((candidate) => candidate.effect === "allow");

    const traceId = request.action.correlationId;

    if (applicableDenies.length > 0) {
      return new PolicyDecision({
        effect: "deny", reason: REASON, matchedPolicyId: smallestPolicyId(applicableDenies), traceId,
      });
    }
    if (applicableAllows.length > 0) {
      return new PolicyDecision({
        effect: "allow", reason: REASON, matchedPolicyId: smallestPolicyId(applicableAllows), traceId,
      });
    }
    return new PolicyDecision({
      effect: "deny", reason: REASON, matchedPolicyId: null, traceId,
    });
  }
}
Object.freeze(AuthorizationEvaluator.prototype);
Object.freeze(AuthorizationEvaluator);
