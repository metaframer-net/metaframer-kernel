import { AuthorizationEvaluator } from "./authorization-evaluator.mjs";
import { PolicyRequest } from "./policy-decision.mjs";

// =====================================================================================
// PolicyDecisionPoint: a central Application-ring orchestration boundary, and nothing else.
//
// A frozen `{candidatesFor}` collaborator seam. `decide(request)` is async: it rejects a
// non-exact/non-genuine PolicyRequest before ever touching the collaborator, calls
// `candidatesFor` exactly once with an undefined receiver and the request by identity, awaits
// its ordinary resolution once, and passes whatever it resolved unchanged, with the exact
// request, into one internal frozen AuthorizationEvaluator, answering with its exact
// PolicyDecision.
//
// Frozen non-goals: no candidate derivation, no RBAC/ABAC/ReBAC, no row-level access story, no
// adapter or persistence, no enforcement point, no SDK or generated client, no mutation, no
// second evaluation, and no default/queue/backoff substituted for whatever the collaborator
// returns.
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

const OPTIONS_KEY = "candidatesFor";

function checkOptions(options) {
  if (!isOrdinaryDataObject(options)) {
    throw new TypeError("PolicyDecisionPoint needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== 1 || keys[0] !== OPTIONS_KEY) {
    throw new TypeError(`PolicyDecisionPoint options must carry exactly one key: ${OPTIONS_KEY}`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, OPTIONS_KEY);
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`PolicyDecisionPoint ${OPTIONS_KEY} must be an enumerable data property`);
  }
  if (typeof descriptor.value !== "function") {
    throw new TypeError(`PolicyDecisionPoint ${OPTIONS_KEY} must hold a function`);
  }
  return descriptor.value;
}

export class PolicyDecisionPoint {
  #candidatesFor;
  #evaluator;

  constructor(options) {
    this.#candidatesFor = checkOptions(options);
    this.#evaluator = new AuthorizationEvaluator();
    Object.freeze(this);
  }

  async decide(request) {
    if (!isGenuinePolicyRequest(request)) {
      throw new TypeError("PolicyDecisionPoint.decide request needs an exact genuine PolicyRequest instance");
    }
    const candidatesFor = this.#candidatesFor;
    const candidates = await candidatesFor(request);
    return this.#evaluator.decide({ request, candidates });
  }
}
Object.freeze(PolicyDecisionPoint.prototype);
Object.freeze(PolicyDecisionPoint);
