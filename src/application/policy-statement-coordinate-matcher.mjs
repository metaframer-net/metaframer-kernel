// =====================================================================================
// PolicyStatementCoordinateMatcher
//
// A frozen, stateless, no-arg class with one synchronous, pure method: matchesCoordinates.
// It is an exact wrapper over the two existing exact-equality matchers: it evaluates
// PolicyStatementActionMatcher#matchesAction and PolicyStatementResourceTypeMatcher#matchesResourceType
// exactly once each, both unconditionally, then answers their boolean AND. Nothing else
// reaches this module.
// =====================================================================================

import { PolicyStatementActionMatcher } from "./policy-statement-action-matcher.mjs";
import { PolicyStatementResourceTypeMatcher } from "./policy-statement-resource-type-matcher.mjs";

const actionMatcher = new PolicyStatementActionMatcher();
const resourceTypeMatcher = new PolicyStatementResourceTypeMatcher();

function assertOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("matchesCoordinates needs an options object");
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("matchesCoordinates needs an ordinary object literal");
  }
  if (Reflect.ownKeys(options).length !== 3) {
    throw new TypeError("matchesCoordinates takes exactly statement, actionName and resourceType");
  }
  for (const field of ["statement", "actionName", "resourceType"]) {
    const member = Object.getOwnPropertyDescriptor(options, field);
    if (member === undefined) throw new TypeError(`matchesCoordinates needs a ${field} option`);
    if (!("value" in member)) throw new TypeError(`matchesCoordinates ${field} must be a data property`);
    if (!member.enumerable) throw new TypeError(`matchesCoordinates ${field} must be enumerable`);
  }
}

export class PolicyStatementCoordinateMatcher {
  constructor() {
    if (arguments.length > 0) {
      throw new TypeError("PolicyStatementCoordinateMatcher takes no constructor arguments");
    }
    Object.freeze(this);
  }

  matchesCoordinates(options) {
    assertOptions(options);
    const { statement, actionName, resourceType } = options;
    const actionMatches = actionMatcher.matchesAction({ statement, actionName });
    const resourceTypeMatches = resourceTypeMatcher.matchesResourceType({ statement, resourceType });
    return actionMatches && resourceTypeMatches;
  }
}
Object.freeze(PolicyStatementCoordinateMatcher.prototype);
Object.freeze(PolicyStatementCoordinateMatcher);
