import { PolicyStatement } from "./policy-statement.mjs";
import { PolicyRequest } from "./policy-decision.mjs";

// =====================================================================================
// PolicyCandidateResolver — turns a frozen set of genuine PolicyStatement rows into the
// ordinary v2 candidate array AuthorizationEvaluator/PolicyDecisionPoint already accept.
//
// Pure and synchronous: no I/O, no eval, no mutation of its inputs. Grammar violations and
// unsupported condition shapes fail closed to applies=false, never throw.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// The private #resource / #effect fields back these getters; a lookalike built on the real
// prototype but missing the private state throws before any own-property getter (like a
// hostile "action" or "id" override) is ever reached, so a brand check never invokes an
// untrusted getter. "effect" is used for PolicyStatement rather than "id" because the
// adversarial fixture overrides "id" specifically.
const RESOURCE_BRAND = Object.getOwnPropertyDescriptor(PolicyRequest.prototype, "resource").get;
const STATEMENT_BRAND = Object.getOwnPropertyDescriptor(PolicyStatement.prototype, "effect").get;

const carriesBrand = (brand, value) => {
  try {
    brand.call(value);
    return true;
  } catch {
    return false;
  }
};

const isGenuineRequest = (value) => isExactly(value, PolicyRequest) && carriesBrand(RESOURCE_BRAND, value);
const isGenuineStatement = (value) => isExactly(value, PolicyStatement) && carriesBrand(STATEMENT_BRAND, value);

// An ordinary dense Array.prototype array carrying only enumerable data elements, no hole and
// no property beside its indices — the same shape PolicyStatement's own canonicalValue enforces
// for an array-typed field, checked here without invoking any element's own getter.
function isDenseStatementsArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined) return false;
    if (!("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return Reflect.ownKeys(value).length === value.length + 1;
}

// PolicyStatement stores targetActor/condition through its own canonical-data hardening, which
// yields a frozen null-prototype object (not Object.prototype) — accept either shape here.
const isCanonicalObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const TARGET_ACTOR_KEYS = new Set(["tenantId", "actorId"]);

function targetActorMatches(targetActor, request) {
  if (!isCanonicalObject(targetActor)) return false;
  const keys = Reflect.ownKeys(targetActor);
  for (const key of keys) {
    if (typeof key !== "string" || !TARGET_ACTOR_KEYS.has(key)) return false;
  }
  if (keys.includes("tenantId") && targetActor.tenantId !== request.tenantId.toString()) return false;
  if (keys.includes("actorId") && targetActor.actorId !== request.actorId.toString()) return false;
  return true;
}

function conditionMatches(condition) {
  return isCanonicalObject(condition) && Reflect.ownKeys(condition).length === 0;
}

function candidateFor(statement, request) {
  const applies = statement.enabled
    && statement.targetAction === request.action.name
    && statement.targetResourceType === request.resource.type
    && targetActorMatches(statement.targetActor, request)
    && conditionMatches(statement.condition);

  return {
    policyId: statement.id,
    effect: statement.effect,
    applies,
    priority: statement.priority,
    layer: statement.layer,
  };
}

export class PolicyCandidateResolver {
  #statements;

  constructor({ statements }) {
    if (!isDenseStatementsArray(statements)) {
      throw new TypeError("PolicyCandidateResolver statements needs an ordinary dense array");
    }
    if (!statements.every(isGenuineStatement)) {
      throw new TypeError("PolicyCandidateResolver statements needs an array of genuine PolicyStatement instances");
    }
    this.#statements = statements.slice();
    Object.freeze(this);
  }

  candidatesFor(request) {
    if (!isGenuineRequest(request)) {
      throw new TypeError("PolicyCandidateResolver.candidatesFor needs a genuine PolicyRequest instance");
    }
    return this.#statements.map((statement) => candidateFor(statement, request));
  }

  get [Symbol.toStringTag]() {
    return "PolicyCandidateResolver";
  }
}
Object.freeze(PolicyCandidateResolver.prototype);
Object.freeze(PolicyCandidateResolver);
