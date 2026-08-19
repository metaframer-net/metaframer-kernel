// =====================================================================================
// PolicyStatementActionMatcher
//
// A frozen, stateless, no-arg class with one synchronous, pure method: matchesAction.
// It answers exactly statement.enabled === true && statement.targetAction === actionName,
// using string identity only. Nothing else reaches this module.
// =====================================================================================

import { PolicyStatement } from "./policy-statement.mjs";

const ACTION_NAME_RULE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const ACTION_NAME_MAX = 128;

const enabledGetter = Object.getOwnPropertyDescriptor(PolicyStatement.prototype, "enabled").get;
const targetActionGetter = Object.getOwnPropertyDescriptor(PolicyStatement.prototype, "targetAction").get;

function assertOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("matchesAction needs an options object");
  }
  if (Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("matchesAction needs an ordinary object literal");
  }
  if (Reflect.ownKeys(options).length !== 2) {
    throw new TypeError("matchesAction takes exactly statement and actionName");
  }
  for (const field of ["statement", "actionName"]) {
    const member = Object.getOwnPropertyDescriptor(options, field);
    if (member === undefined) throw new TypeError(`matchesAction needs a ${field} option`);
    if (!("value" in member)) throw new TypeError(`matchesAction ${field} must be a data property`);
    if (!member.enumerable) throw new TypeError(`matchesAction ${field} must be enumerable`);
  }
}

// The exact prototype check refuses every lookalike, hollow object and subclass instance.
// Calling the real getters by reference then reads the private fields directly: a private
// field access is never dispatched through a Proxy trap, so a forging Proxy is refused
// with a TypeError before any fabricated field is ever read.
function assertGenuineStatement(value) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== PolicyStatement.prototype) {
    throw new TypeError("matchesAction needs a genuine PolicyStatement");
  }
  try {
    return { enabled: enabledGetter.call(value), targetAction: targetActionGetter.call(value) };
  } catch {
    throw new TypeError("matchesAction needs a genuine PolicyStatement");
  }
}

function assertActionName(value) {
  if (typeof value !== "string") {
    throw new TypeError("matchesAction needs a primitive actionName string");
  }
  if (value.length < 1 || value.length > ACTION_NAME_MAX) {
    throw new RangeError(`matchesAction actionName needs a string of 1 to ${ACTION_NAME_MAX} characters`);
  }
  if (!ACTION_NAME_RULE.test(value)) {
    throw new TypeError("matchesAction actionName needs two or more dotted lowercase identifier segments");
  }
  return value;
}

export class PolicyStatementActionMatcher {
  constructor() {
    if (arguments.length > 0) {
      throw new TypeError("PolicyStatementActionMatcher takes no constructor arguments");
    }
    Object.freeze(this);
  }

  matchesAction(options) {
    assertOptions(options);
    const { enabled, targetAction } = assertGenuineStatement(options.statement);
    const actionName = assertActionName(options.actionName);
    return enabled === true && targetAction === actionName;
  }
}
Object.freeze(PolicyStatementActionMatcher.prototype);
Object.freeze(PolicyStatementActionMatcher);
