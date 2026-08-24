import { PolicyRequest } from "./policy-decision.mjs";
import { AuthorizationEvaluator } from "./authorization-evaluator.mjs";
import { DecisionLogEntry } from "./decision-log-entry.mjs";
import { DecisionLogPort } from "./decision-log-port.mjs";
import { Clock } from "./clock.mjs";

// =====================================================================================
// DecisionLoggingPolicyDecisionPoint
//
// Wires AuthorizationEvaluator to DecisionLogPort: one candidatesFor call, one evaluator
// decision, one appended DecisionLogEntry, per request. Non-goals: concurrent-call locking,
// a concrete chain-head reader, retry/queue/cache/replay/PEP/HTTP/SDK/UI/simulation.
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

const CONSTRUCTOR_OPTIONS = ["candidatesFor", "decisionLog", "idGenerator", "clock", "chainHead"];

function exactOptions(options, expected, what) {
  if (options === null || typeof options !== "object" || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError(`${what} needs an ordinary options object`);
  }
  const given = Reflect.ownKeys(options);
  if (given.length !== expected.length) {
    throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
    }
  }
  return options;
}

function functionOf(value, what) {
  if (typeof value !== "function") throw new TypeError(`${what} needs a function collaborator`);
  return value;
}

function requireRequest(value) {
  if (!isGenuinePolicyRequest(value)) {
    throw new TypeError("DecisionLoggingPolicyDecisionPoint needs an exact genuine PolicyRequest instance");
  }
  return value;
}

function requireRequestArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("DecisionLoggingPolicyDecisionPoint.decideAll needs an ordinary array of requests");
  }
  const { length } = value;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) {
    throw new TypeError("DecisionLoggingPolicyDecisionPoint.decideAll requests must carry no own property beyond its dense indices and length");
  }
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
      throw new TypeError("DecisionLoggingPolicyDecisionPoint.decideAll requests must carry no own property beyond its dense indices and length");
    }
  }

  const snapshot = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("DecisionLoggingPolicyDecisionPoint.decideAll requests must be a dense array of own enumerable data properties");
    }
    requireRequest(descriptor.value);
    snapshot[i] = descriptor.value;
  }
  return snapshot;
}

function layerOf(candidates, matchedPolicyId) {
  if (matchedPolicyId === null) return null;
  const winner = candidates.find((candidate) => candidate.policyId === matchedPolicyId);
  return Object.prototype.hasOwnProperty.call(winner, "layer") ? winner.layer : "tenant";
}

const EVALUATOR = new AuthorizationEvaluator();

export class DecisionLoggingPolicyDecisionPoint {
  #candidatesFor;
  #decisionLog;
  #idGenerator;
  #clock;
  #chainHead;

  constructor(options) {
    exactOptions(options, CONSTRUCTOR_OPTIONS, "DecisionLoggingPolicyDecisionPoint");
    this.#candidatesFor = functionOf(options.candidatesFor, "DecisionLoggingPolicyDecisionPoint candidatesFor");
    if (!isExactly(options.decisionLog, DecisionLogPort) || !(options.decisionLog instanceof DecisionLogPort)) {
      throw new TypeError("DecisionLoggingPolicyDecisionPoint decisionLog needs an exact genuine DecisionLogPort instance");
    }
    this.#decisionLog = options.decisionLog;
    this.#idGenerator = functionOf(options.idGenerator, "DecisionLoggingPolicyDecisionPoint idGenerator");
    if (!isExactly(options.clock, Clock) || !(options.clock instanceof Clock)) {
      throw new TypeError("DecisionLoggingPolicyDecisionPoint clock needs an exact genuine Clock instance");
    }
    this.#clock = options.clock;
    this.#chainHead = functionOf(options.chainHead, "DecisionLoggingPolicyDecisionPoint chainHead");
    Object.freeze(this);
  }

  async #logOne(request, resolvePrevHash) {
    const candidatesFor = this.#candidatesFor;
    const idGenerator = this.#idGenerator;
    const clock = this.#clock;
    const decisionLog = this.#decisionLog;

    const candidates = await candidatesFor(request);
    const decision = EVALUATOR.decide({ request, candidates });
    const layerResolved = layerOf(candidates, decision.matchedPolicyId);

    const prevHash = await resolvePrevHash();
    const id = await idGenerator();
    const ts = await clock.now();
    const entry = new DecisionLogEntry({ id, request, decision, layerResolved, ts, prevHash });
    await decisionLog.append(entry);
    return { decision, entry };
  }

  async decide(request) {
    requireRequest(request);
    const chainHead = this.#chainHead;
    const { decision } = await this.#logOne(request, async () => chainHead(request.tenantId));
    return decision;
  }

  async decideAll(requests) {
    const snapshot = requireRequestArray(requests);
    if (snapshot.length === 0) return Object.freeze([]);

    const chainHead = this.#chainHead;
    const heads = new Map();
    const decisions = [];
    for (const request of snapshot) {
      const tenantKey = request.tenantId.toString();
      const resolvePrevHash = async () => (heads.has(tenantKey) ? heads.get(tenantKey) : chainHead(request.tenantId));
      // eslint-disable-next-line no-await-in-loop
      const { decision, entry } = await this.#logOne(request, resolvePrevHash);
      heads.set(tenantKey, entry.entryHash);
      decisions.push(decision);
    }
    return Object.freeze(decisions);
  }

  get [Symbol.toStringTag]() {
    return "DecisionLoggingPolicyDecisionPoint";
  }
}
Object.freeze(DecisionLoggingPolicyDecisionPoint.prototype);
Object.freeze(DecisionLoggingPolicyDecisionPoint);
