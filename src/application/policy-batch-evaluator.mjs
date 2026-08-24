import { PolicyDecisionPoint } from "./policy-decision-point.mjs";
import { PolicyRequest } from "./policy-decision.mjs";

// =====================================================================================
// PolicyBatchEvaluator: sequential batch orchestration over one internal
// PolicyDecisionPoint, and nothing else.
//
// Constructor delegates exact {candidatesFor} validation to one internal
// PolicyDecisionPoint. decideAll(requests) preflights an ordinary dense Array of exact
// genuine PolicyRequest values before any collaborator call, admits an empty array,
// then sequentially awaits one PDP decision per request (stopping and rejecting on the
// first failure), and answers with a new ordinary frozen decision array in exact input
// order. No duplicate candidate/combining logic, no mutation.
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

function checkRequests(requests) {
  if (!Array.isArray(requests) || Object.getPrototypeOf(requests) !== Array.prototype) {
    throw new TypeError("PolicyBatchEvaluator.decideAll requests must be an ordinary Array");
  }
  const { length } = requests;
  const ownKeys = Reflect.ownKeys(requests);
  if (ownKeys.length !== length + 1) {
    throw new TypeError("PolicyBatchEvaluator.decideAll requests must carry no own property beyond its dense indices and length");
  }
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
      throw new TypeError("PolicyBatchEvaluator.decideAll requests must carry no own property beyond its dense indices and length");
    }
  }

  const snapshot = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(requests, i);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("PolicyBatchEvaluator.decideAll requests must be a dense array of own enumerable data properties");
    }
    if (!isGenuinePolicyRequest(descriptor.value)) {
      throw new TypeError(`PolicyBatchEvaluator.decideAll requests[${i}] must be an exact genuine PolicyRequest`);
    }
    snapshot[i] = descriptor.value;
  }
  return snapshot;
}

export class PolicyBatchEvaluator {
  #pdp;

  constructor(options) {
    this.#pdp = new PolicyDecisionPoint(options);
    Object.freeze(this);
  }

  async decideAll(requests) {
    const snapshot = checkRequests(requests);
    const pdp = this.#pdp;
    const decisions = [];
    for (let i = 0; i < snapshot.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      decisions.push(await pdp.decide(snapshot[i]));
    }
    return Object.freeze(decisions);
  }
}
Object.freeze(PolicyBatchEvaluator.prototype);
Object.freeze(PolicyBatchEvaluator);
