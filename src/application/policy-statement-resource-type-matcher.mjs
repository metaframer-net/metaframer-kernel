// =====================================================================================
// PolicyStatementResourceTypeMatcher
//
// A frozen, stateless, no-arg class with one synchronous, pure method: matchesResourceType.
// It answers exactly statement.enabled === true && statement.targetResourceType === resourceType,
// using string identity only. Nothing else reaches this module.
// =====================================================================================

import { PolicyStatement } from "./policy-statement.mjs";

const RESOURCE_TYPE_RULE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RESOURCE_TYPE_MAX = 128;

const enabledGetter = Object.getOwnPropertyDescriptor(PolicyStatement.prototype, "enabled").get;
const targetResourceTypeGetter = Object.getOwnPropertyDescriptor(PolicyStatement.prototype, "targetResourceType").get;

function assertOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("matchesResourceType needs an options object");
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("matchesResourceType needs an ordinary object literal");
  }
  if (Reflect.ownKeys(options).length !== 2) {
    throw new TypeError("matchesResourceType takes exactly statement and resourceType");
  }
  for (const field of ["statement", "resourceType"]) {
    const member = Object.getOwnPropertyDescriptor(options, field);
    if (member === undefined) throw new TypeError(`matchesResourceType needs a ${field} option`);
    if (!("value" in member)) throw new TypeError(`matchesResourceType ${field} must be a data property`);
    if (!member.enumerable) throw new TypeError(`matchesResourceType ${field} must be enumerable`);
  }
}

// The exact prototype check refuses every lookalike, hollow object and subclass instance.
// Calling the real getters by reference then reads the private fields directly: a private
// field access is never dispatched through a Proxy trap, so a forging Proxy is refused
// with a TypeError before any fabricated field is ever read.
function assertGenuineStatement(value) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== PolicyStatement.prototype) {
    throw new TypeError("matchesResourceType needs a genuine PolicyStatement");
  }
  try {
    return { enabled: enabledGetter.call(value), targetResourceType: targetResourceTypeGetter.call(value) };
  } catch {
    throw new TypeError("matchesResourceType needs a genuine PolicyStatement");
  }
}

function assertResourceType(value) {
  if (typeof value !== "string") {
    throw new TypeError("matchesResourceType needs a primitive resourceType string");
  }
  if (value.length < 1 || value.length > RESOURCE_TYPE_MAX) {
    throw new RangeError(`matchesResourceType resourceType needs a string of 1 to ${RESOURCE_TYPE_MAX} characters`);
  }
  if (!RESOURCE_TYPE_RULE.test(value)) {
    throw new TypeError("matchesResourceType resourceType needs a lowercase dot/hyphen separated identifier");
  }
  return value;
}

export class PolicyStatementResourceTypeMatcher {
  constructor() {
    if (arguments.length > 0) {
      throw new TypeError("PolicyStatementResourceTypeMatcher takes no constructor arguments");
    }
    Object.freeze(this);
  }

  matchesResourceType(options) {
    assertOptions(options);
    const { enabled, targetResourceType } = assertGenuineStatement(options.statement);
    const resourceType = assertResourceType(options.resourceType);
    return enabled === true && targetResourceType === resourceType;
  }
}
Object.freeze(PolicyStatementResourceTypeMatcher.prototype);
Object.freeze(PolicyStatementResourceTypeMatcher);
