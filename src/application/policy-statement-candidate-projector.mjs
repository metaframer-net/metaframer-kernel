// =====================================================================================
// PolicyStatementCandidateProjector
//
// A frozen, stateless, no-arg class with one synchronous, pure method: projectCandidate.
// It composes the existing PolicyStatementCoordinateMatcher exactly once and answers a
// genuine AuthorizationCandidate carrying statement.id as policyId, statement.effect as
// effect, and the coordinate matcher's boolean as applies. Nothing else reaches this module.
// =====================================================================================

import { PolicyStatementCoordinateMatcher } from "./policy-statement-coordinate-matcher.mjs";
import { AuthorizationCandidate } from "./authorization-candidate.mjs";

const coordinateMatcher = new PolicyStatementCoordinateMatcher();

function assertOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("projectCandidate needs an options object");
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("projectCandidate needs an ordinary object literal");
  }
  if (Reflect.ownKeys(options).length !== 3) {
    throw new TypeError("projectCandidate takes exactly statement, actionName and resourceType");
  }
  for (const field of ["statement", "actionName", "resourceType"]) {
    const member = Object.getOwnPropertyDescriptor(options, field);
    if (member === undefined) throw new TypeError(`projectCandidate needs a ${field} option`);
    if (!("value" in member)) throw new TypeError(`projectCandidate ${field} must be a data property`);
    if (!member.enumerable) throw new TypeError(`projectCandidate ${field} must be enumerable`);
  }
}

export class PolicyStatementCandidateProjector {
  constructor() {
    if (arguments.length > 0) {
      throw new TypeError("PolicyStatementCandidateProjector takes no constructor arguments");
    }
    Object.freeze(this);
  }

  projectCandidate(options) {
    assertOptions(options);
    const { statement, actionName, resourceType } = options;
    const applies = coordinateMatcher.matchesCoordinates({ statement, actionName, resourceType });
    return new AuthorizationCandidate({ policyId: statement.id, effect: statement.effect, applies });
  }
}
Object.freeze(PolicyStatementCandidateProjector.prototype);
Object.freeze(PolicyStatementCandidateProjector);
