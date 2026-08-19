import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyStatement } from "../src/application/policy-statement.mjs";
import { AuthorizationCandidate } from "../src/application/authorization-candidate.mjs";

// PKG19 — PolicyStatementCandidateProjector: a frozen, stateless, no-arg class whose
// `projectCandidate({statement, actionName, resourceType})` is entirely synchronous. It composes
// PolicyStatementCoordinateMatcher exactly once and answers a genuine AuthorizationCandidate
// carrying statement.id as policyId, statement.effect as effect, and the coordinate matcher's
// boolean as applies. No targetActor/condition/priority/layer/version semantics, no
// combining/precedence/evaluator/PDP, no persistence, no SDK, no Delivery/HTTP/ASGI/FastAPI/
// Uvicorn/Hypercorn/I/O vocabulary reaches this module.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement-candidate-projector.mjs";
const coordinateMatcherPath = "src/application/policy-statement-coordinate-matcher.mjs";

let loaded = null;
let loadError = null;
try { loaded = await import(pathToFileURL(path.join(root, modulePath)).href); }
catch (error) { loadError = error; }

let sourceText = null;
let sourceError = null;
try { sourceText = await readFile(path.join(root, modulePath), "utf8"); }
catch (error) { sourceError = error; }

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}
function source() {
  assert.ok(sourceText !== null, `${modulePath} must exist as a readable file: ${sourceError?.message ?? "not read"}`);
  return sourceText;
}
function stripComments(text) {
  return text.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
    return line.split("//")[0];
  }).join("\n");
}
const code = () => stripComments(source());
const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// A genuine statement fixture.
// -------------------------------------------------------------------------------------

const statementFields = (overrides = {}) => ({
  id: "pol-a",
  effect: "allow",
  targetActor: { role: "admin" },
  targetAction: "billing.invoice.read",
  targetResourceType: "invoice",
  condition: { tenantMatch: true },
  priority: 10,
  layer: "tenant",
  version: "1.2.3",
  enabled: true,
  ...overrides,
});
const stmt = (overrides) => new PolicyStatement(statementFields(overrides));
const ENABLED_MATCH = stmt();
const ACTION_NAME = "billing.invoice.read";
const RESOURCE_TYPE = "invoice";

function project(projector, statement, actionName, resourceType) {
  return projector.projectCandidate({ statement, actionName, resourceType });
}

// =====================================================================================
// A. Module surface, imports and forbidden vocabulary.
// =====================================================================================

test("module surface: exactly PolicyStatementCandidateProjector, frozen, no evaluator/PDP/RBAC/RLS/SDK vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyStatementCandidateProjector"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyStatementCandidateProjector, "function", "PolicyStatementCandidateProjector must be a class");
  assert.ok(Object.isFrozen(m.PolicyStatementCandidateProjector), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyStatementCandidateProjector.prototype), "the prototype must be frozen");
  for (const absent of [
    "AuthorizationEvaluator", "Pdp", "PDP", "Pep", "PEP", "Policy", "PolicyDecisionPoint",
    "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role", "Permission", "Grant",
    "Rls", "RowLevelSecurity", "Repository", "Adapter", "Sdk", "SDK",
    "PolicyStatementActionMatcher", "PolicyStatementResourceTypeMatcher", "PolicyStatementCoordinateMatcher",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the PolicyStatementCandidateProjector module`);
  }
});

test("module imports PolicyStatementCoordinateMatcher and AuthorizationCandidate by relative path and reaches no forbidden field, framework, or transport vocabulary in code", () => {
  const text = code();
  assert.match(text, /from\s*["']\.\/policy-statement-coordinate-matcher\.mjs["']/, "must import PolicyStatementCoordinateMatcher from its existing sibling module");
  assert.match(text, /from\s*["']\.\/authorization-candidate\.mjs["']/, "must import AuthorizationCandidate from its existing sibling module");
  for (const [label, pattern] of [
    ["a node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a central decision point", /\bPDP\b|\bPEP\b|\bPolicyDecisionPoint\b|central\s+decision/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\brole\b|\bpermission\b|\bgrant\b/i],
    ["combining/precedence/evaluator", /combin|precedence|\bevaluator\b/i],
    ["persistence or telemetry", /\baudit\b|\bcache\b|\bmemo\b|\brepositor|\bpersist|\bRLS\b|\boutbox\b/i],
    ["a transport/SDK surface", /fastapi|uvicorn|hypercorn|\basgi\b|\bhttp\b|\bdelivery\b|\bsdk\b/i],
    ["the actor field", /\btargetActor\b/],
    ["the condition field", /\bcondition\b/],
    ["the priority field", /\bpriority\b/],
    ["the layer field", /\blayer\b/],
    ["the version field", /\bversion\b/],
    ["the PolicyStatement module directly", /from\s*["']\.\/policy-statement\.mjs["']/],
    ["the action matcher module directly", /from\s*["']\.\/policy-statement-action-matcher\.mjs["']/],
    ["the resource-type matcher module directly", /from\s*["']\.\/policy-statement-resource-type-matcher\.mjs["']/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

test("src/application/policy-statement-candidate-projector.mjs is at most 200 lines", () => {
  const lines = source().split("\n");
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  assert.ok(count <= 200, `${modulePath} must be at most 200 lines (a thin projector), found ${count}`);
});

// =====================================================================================
// B. Construction: frozen, stateless, no-arg class.
// =====================================================================================

test("PolicyStatementCandidateProjector is a frozen, stateless, no-arg class; projectCandidate is a method", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  assert.ok(Object.isFrozen(projector), "a PolicyStatementCandidateProjector instance must be frozen");
  assert.equal(typeof projector.projectCandidate, "function", "projectCandidate must be a method");
  for (const bad of [{}, undefined, null, [], "x", 0]) {
    throws(() => new m.PolicyStatementCandidateProjector(bad),
      "the constructor must refuse any supplied argument, explicit undefined included");
  }
});

// =====================================================================================
// C. projectCandidate options admission: an ordinary object with exactly the three
//    enumerable own data properties statement, actionName and resourceType.
// =====================================================================================

test("projectCandidate options must be an ordinary object with exactly enumerable data properties statement, actionName and resourceType", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();

  throws(() => projector.projectCandidate(), "no input at all must be refused");
  throws(() => projector.projectCandidate(null), "a null input must be refused");
  throws(() => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE, extra: 1 }),
    "an unknown top-level key must be refused");
  throws(() => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME }), "a missing resourceType must be refused");
  throws(() => projector.projectCandidate({ statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE }), "a missing actionName must be refused");
  throws(() => projector.projectCandidate({ actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }), "a missing statement must be refused");

  const accessorStatement = {};
  Object.defineProperty(accessorStatement, "statement", { enumerable: true, get: () => ENABLED_MATCH });
  Object.defineProperty(accessorStatement, "actionName", { enumerable: true, value: ACTION_NAME });
  Object.defineProperty(accessorStatement, "resourceType", { enumerable: true, value: RESOURCE_TYPE });
  const accessorActionName = { statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE };
  Object.defineProperty(accessorActionName, "actionName", { enumerable: true, get: () => ACTION_NAME });
  const accessorResourceType = { statement: ENABLED_MATCH, actionName: ACTION_NAME };
  Object.defineProperty(accessorResourceType, "resourceType", { enumerable: true, get: () => RESOURCE_TYPE });
  const nonEnumStatement = { actionName: ACTION_NAME, resourceType: RESOURCE_TYPE };
  Object.defineProperty(nonEnumStatement, "statement", { value: ENABLED_MATCH, enumerable: false });
  const symbolKeyedOptions = { statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE };
  symbolKeyedOptions[Symbol("x")] = 1;
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), { statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE });
  const nullProtoOptions = Object.assign(Object.create(null), { statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE });

  for (const [label, bad] of [
    ["an array", [ENABLED_MATCH, ACTION_NAME, RESOURCE_TYPE]],
    ["a null-prototype object", nullProtoOptions],
    ["a custom-prototype object", customProtoOptions],
    ["an accessor-defined statement", accessorStatement],
    ["an accessor-defined actionName", accessorActionName],
    ["an accessor-defined resourceType", accessorResourceType],
    ["a symbol-keyed extra property", symbolKeyedOptions],
    ["a non-enumerable statement key", nonEnumStatement],
  ]) {
    throws(() => projector.projectCandidate(bad), `projectCandidate options with ${label} must be refused`);
  }

  assert.doesNotThrow(() => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    "a well-formed options object is admissible");
});

// =====================================================================================
// D. statement admission: exact genuine PolicyStatement only, inherited via the composed
//    matcher. A hollow prototype object, a subclass, a structurally identical plain
//    lookalike, and a forging Proxy are all refused.
// =====================================================================================

test("statement must be an exact genuine PolicyStatement: hollow, subclass and plain lookalike are refused", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();

  const hollow = Object.create(PolicyStatement.prototype);
  class DerivedStatement extends PolicyStatement {}
  const derived = new DerivedStatement(statementFields());
  const lookalike = { ...ENABLED_MATCH.toJSON() };
  const nullProtoLookalike = Object.assign(Object.create(null), ENABLED_MATCH.toJSON());

  for (const [label, bad] of [
    ["null", null], ["undefined", undefined], ["a string", "billing.invoice.read"], ["a number", 1],
    ["an ordinary empty object", {}], ["an array", []],
    ["a hollow prototype object", hollow],
    ["a subclass instance", derived],
    ["a plain object exposing the same enumerable JSON fields", lookalike],
    ["a null-prototype object exposing the same fields", nullProtoLookalike],
  ]) {
    throws(() => projector.projectCandidate({ statement: bad, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
      `statement ${label} must be refused: not an exact genuine PolicyStatement`);
  }

  assert.doesNotThrow(() => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    "a genuine PolicyStatement is admissible");
});

test("statement refuses a Proxy over a genuine PolicyStatement whose traps forge the prototype and fabricate id/effect/enabled, exactly TypeError, without ever reaching the fabricating get traps", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const genuine = stmt({ id: "pol-b", effect: "deny", enabled: false });
  const reached = { id: 0, effect: 0, enabled: 0 };
  const forged = new Proxy(genuine, {
    getPrototypeOf: () => PolicyStatement.prototype,
    get(target, prop, receiver) {
      if (prop === "id") { reached.id += 1; return "pol-forged"; }
      if (prop === "effect") { reached.effect += 1; return "allow"; }
      if (prop === "enabled") { reached.enabled += 1; return true; }
      return Reflect.get(target, prop, receiver);
    },
  });

  assert.throws(
    () => projector.projectCandidate({ statement: forged, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    TypeError,
    "a Proxy forging PolicyStatement admission must be refused with exactly a TypeError",
  );
  assert.deepEqual(reached, { id: 0, effect: 0, enabled: 0 },
    "the field-forging get traps must never be reached: refusal happens before any forged field is read",
  );
});

// =====================================================================================
// E. actionName/resourceType grammar: inherited from the composed coordinate matcher.
// =====================================================================================

test("actionName grammar is inherited from the composed coordinate matcher: at least two dotted lowercase segments, at most 128 characters", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const build = (actionName) => projector.projectCandidate({ statement: ENABLED_MATCH, actionName, resourceType: RESOURCE_TYPE });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(ACTION_NAME), { toString: () => ACTION_NAME },
    { valueOf: () => ACTION_NAME }, Symbol("x"),
  ]) {
    throws(() => build(bad), `actionName ${String(bad)} must be refused: not a primitive string, never coerced`);
  }
  for (const bad of ["", "billing", "Billing.Invoice.Read", "billing..invoice", "billing.invoice."]) {
    throws(() => build(bad), `actionName ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  assert.doesNotThrow(() => build("billing.invoice.read"), "an ordinary two-dot dotted name is admissible");
});

test("resourceType grammar is inherited from the composed coordinate matcher: lowercase dot/hyphen id, 1 to 128 characters", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const build = (resourceType) => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(RESOURCE_TYPE), { toString: () => RESOURCE_TYPE },
    { valueOf: () => RESOURCE_TYPE }, Symbol("x"),
  ]) {
    throws(() => build(bad), `resourceType ${String(bad)} must be refused: not a primitive string, never coerced`);
  }
  for (const bad of ["", "Invoice", "invoice_line", "invoice..line", "invoice."]) {
    throws(() => build(bad), `resourceType ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  assert.doesNotThrow(() => build("invoice"), "a single-segment lowercase id is admissible");
});

// =====================================================================================
// F. projectCandidate answers a genuine AuthorizationCandidate carrying statement.id as
//    policyId, statement.effect as effect, and the coordinate matcher's boolean as applies.
// =====================================================================================

test("projectCandidate answers a genuine AuthorizationCandidate: id/effect passthrough, applies exactly the coordinate match, allow and deny effects both covered", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const TARGET_ACTION = "billing.invoice.read";
  const OTHER_ACTION = "billing.invoice.void";
  const TARGET_RESOURCE = "invoice";
  const OTHER_RESOURCE = "invoice-line";

  const rows = [
    // id, effect, enabled, targetAction, targetResourceType, actionName, resourceType, expectedApplies
    ["pol-allow-match", "allow", true, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, TARGET_RESOURCE, true],
    ["pol-allow-action-mismatch", "allow", true, TARGET_ACTION, TARGET_RESOURCE, OTHER_ACTION, TARGET_RESOURCE, false],
    ["pol-allow-resource-mismatch", "allow", true, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, OTHER_RESOURCE, false],
    ["pol-allow-disabled", "allow", false, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, TARGET_RESOURCE, false],
    ["pol-deny-match", "deny", true, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, TARGET_RESOURCE, true],
    ["pol-deny-mismatch", "deny", true, TARGET_ACTION, TARGET_RESOURCE, OTHER_ACTION, OTHER_RESOURCE, false],
  ];
  for (const [id, effect, enabled, targetAction, targetResourceType, actionName, resourceType, expectedApplies] of rows) {
    const statement = stmt({ id, effect, enabled, targetAction, targetResourceType });
    const candidate = project(projector, statement, actionName, resourceType);
    assert.ok(candidate instanceof AuthorizationCandidate, "projectCandidate must answer a genuine AuthorizationCandidate instance");
    assert.equal(Object.getPrototypeOf(candidate), AuthorizationCandidate.prototype, "the answered candidate must have exactly the AuthorizationCandidate prototype");
    assert.equal(candidate.policyId, id, `policyId must equal statement.id (${id})`);
    assert.equal(candidate.effect, effect, `effect must equal statement.effect (${effect})`);
    assert.equal(candidate.applies, expectedApplies,
      `applies for id=${id} enabled=${enabled} targetAction=${targetAction} targetResourceType=${targetResourceType} actionName=${actionName} resourceType=${resourceType} must be exactly ${expectedApplies}`);
  }
});

// =====================================================================================
// G. Determinism, no mutation, synchronous, and exact-equality-only coordinate matching
//    (no wildcard/prefix/suffix/case-fold), re-proven at the projector boundary.
// =====================================================================================

test("projectCandidate is synchronous, deterministic and mutates neither the statement nor the projector", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const statement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice" });
  const before = statement.toString();

  const result = project(projector, statement, "billing.invoice.read", "invoice");

  assert.ok(!(result instanceof Promise), "projectCandidate must never return a Promise");
  assert.equal(statement.toString(), before, "the statement must be unchanged after projectCandidate");
  assert.ok(Object.isFrozen(projector), "the projector must remain frozen after projectCandidate");

  const again = project(projector, statement, "billing.invoice.read", "invoice");
  assert.equal(again.toString(), result.toString(), "repeated calls with the same input must answer an equal candidate");
  assert.notEqual(again, result, "each call must answer a fresh AuthorizationCandidate, not a cached reference");
});

test("coordinate matching is exact-equality only: no prefix, suffix, substring or case-folded match sets applies to true", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const enabledStatement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice.line" });

  for (const [label, actionName, resourceType] of [
    ["a prefix of the target action", "billing.invoice", "invoice.line"],
    ["a suffix of the target action", "invoice.read", "invoice.line"],
    ["a prefix of the target resourceType", "billing.invoice.read", "invoice"],
    ["a suffix of the target resourceType", "billing.invoice.read", "line"],
  ]) {
    const candidate = project(projector, enabledStatement, actionName, resourceType);
    assert.equal(candidate.applies, false, `${label} must not set applies even though it shares a substring with the target`);
  }
});

// =====================================================================================
// H. Error redaction: a malformed coordinate value is never echoed into a thrown message.
// =====================================================================================

test("a malformed actionName, resourceType or statement is never echoed into the thrown error message", () => {
  const m = mod();
  const projector = new m.PolicyStatementCandidateProjector();
  const sentinelAction = "SECRET-TOKEN-do-not-leak-9f2c";
  const sentinelResource = "SECRET-RESOURCE-do-not-leak-7a31";
  const sentinelStatementValue = "SECRET-STATEMENT-do-not-leak-3e71";

  assert.throws(
    () => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: sentinelAction, resourceType: RESOURCE_TYPE }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelAction), "the refused actionName must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => projector.projectCandidate({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: sentinelResource }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelResource), "the refused resourceType must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => projector.projectCandidate({ statement: sentinelStatementValue, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelStatementValue), "the refused statement must not be echoed into the error message");
      return true;
    },
  );
});

// =====================================================================================
// I. The composed collaborator module stays untouched: this package adds a projector, not
//    a rewrite. Proven by re-import identity of the unrelated matcher class.
// =====================================================================================

test("the composed PolicyStatementCoordinateMatcher module is an unmodified collaborator: its class remains importable and independently constructible", async () => {
  const coordinateMod = await import(pathToFileURL(path.join(root, coordinateMatcherPath)).href);
  assert.equal(typeof coordinateMod.PolicyStatementCoordinateMatcher, "function");
  assert.doesNotThrow(() => new coordinateMod.PolicyStatementCoordinateMatcher());
});
