import { PolicyCandidateResolver } from "../application/policy-candidate-resolver.mjs";
import { Clock } from "../application/clock.mjs";
import { DecisionLogPort } from "../application/decision-log-port.mjs";
import { DecisionLoggingPolicyDecisionPoint } from "../application/decision-logging-policy-decision-point.mjs";
import { PostgresDecisionLogAdapter } from "../adapters/postgres-decision-log-adapter.mjs";

// =====================================================================================
// policyDecisionLogComposition — P04g
//
// The smallest framework-neutral composition root wiring a real PostgresDecisionLogAdapter to a
// real DecisionLoggingPolicyDecisionPoint via a real PolicyCandidateResolver, DecisionLogPort and
// Clock. Admits exactly the ordinary own-enumerable data options {connectionString, statements,
// idGenerator, now}; construction is synchronous and performs no I/O -- it never calls
// idGenerator or now -- and hands back exactly one frozen bound-safe {decide, decideAll, close}
// facade, never the adapter, resolver, port, clock or decision point.
//
// Non-goals: policy store, migration, HTTP/UI/SDK/PEP/product caller, retry/queue/cache,
// concurrency locking, no new dependency, and no readiness or release claim is made here.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const OPTIONS_KEYS = ["connectionString", "statements", "idGenerator", "now"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("policyDecisionLogComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`policyDecisionLogComposition options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("policyDecisionLogComposition admits only ordinary own-enumerable data options");
    }
  }
  const { connectionString, statements, idGenerator, now } = options;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new TypeError("policyDecisionLogComposition connectionString must be a non-empty string");
  }
  if (!Array.isArray(statements) || Object.getPrototypeOf(statements) !== Array.prototype) {
    throw new TypeError("policyDecisionLogComposition statements must be an ordinary array");
  }
  if (typeof idGenerator !== "function") {
    throw new TypeError("policyDecisionLogComposition idGenerator must be a function");
  }
  if (typeof now !== "function") {
    throw new TypeError("policyDecisionLogComposition now must be a function");
  }
  return { connectionString, statements, idGenerator, now };
}

/**
 * Wire one real DecisionLoggingPolicyDecisionPoint to a real PostgresDecisionLogAdapter and a
 * real PolicyCandidateResolver, from exactly the four caller-supplied collaborators. Returns a
 * frozen `{ decide, decideAll, close }` facade; `close` closes the composed adapter.
 */
export function policyDecisionLogComposition(options) {
  const checked = checkOptions(options);

  // PolicyCandidateResolver validates its own `statements` shape at construction; a malformed
  // element (e.g. `[{ id: "not-genuine" }]`) throws here, before any I/O.
  const resolver = new PolicyCandidateResolver({ statements: checked.statements });
  const clock = new Clock({ now: checked.now });
  const adapter = new PostgresDecisionLogAdapter({ connectionString: checked.connectionString });
  const decisionLog = new DecisionLogPort({ append: adapter.append });
  const point = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: (request) => resolver.candidatesFor(request),
    decisionLog,
    idGenerator: checked.idGenerator,
    clock,
    chainHead: (tenantId) => adapter.chainHead(tenantId),
  });

  return Object.freeze({
    decide: (request) => point.decide(request),
    decideAll: (requests) => point.decideAll(requests),
    close: () => adapter.close(),
  });
}
Object.freeze(policyDecisionLogComposition);
