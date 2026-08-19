import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyStatement } from "../src/application/policy-statement.mjs";

// PKG16 — PolicyStatementActionMatcher: exact-equality action matching, and nothing else. A
// frozen, stateless, no-arg class whose `matchesAction({statement, actionName})` is entirely
// synchronous and pure — never a Promise. `statement` must be an exact genuine PolicyStatement;
// `actionName` is a primitive canonical Command/Query action name. The answer is exactly
// `statement.enabled === true && statement.targetAction === actionName` — string identity only,
// never a prefix, a wildcard, a case-fold or a coercion. No targetActor/resourceType/condition
// /priority/layer/version semantics reach this module; no candidate derivation, no Evaluator, no
// PDP, no Policy port, no RBAC/ABAC/ReBAC, no RLS/DB/SDK/Delivery/HTTP vocabulary.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement-action-matcher.mjs";

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
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;
const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// A genuine statement, and the one field this matcher may ever read besides `enabled`.
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

function matches(matcher, statement, actionName) {
  return matcher.matchesAction({ statement, actionName });
}

// =====================================================================================
// A. Module surface, imports and forbidden vocabulary.
// =====================================================================================

test("module surface: exactly PolicyStatementActionMatcher, frozen, no matching/candidate/RBAC/RLS/SDK vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyStatementActionMatcher"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyStatementActionMatcher, "function", "PolicyStatementActionMatcher must be a class");
  assert.ok(Object.isFrozen(m.PolicyStatementActionMatcher), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyStatementActionMatcher.prototype), "the prototype must be frozen");
  for (const absent of [
    "deriveCandidate", "AuthorizationCandidate", "AuthorizationEvaluator", "Pdp", "PDP", "Pep", "PEP",
    "Policy", "PolicyDecisionPoint", "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role",
    "Permission", "Grant", "Rls", "RowLevelSecurity", "Repository", "Adapter", "Sdk", "SDK",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the PolicyStatementActionMatcher module`);
  }
});

test("module reaches no forbidden import, targetActor/resourceType/condition/priority/layer/version field, or PDP/RBAC/RLS/SDK/Delivery/HTTP vocabulary in code", () => {
  const text = code();
  for (const [label, pattern] of [
    ["a node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
    ["a central decision point", /\bPDP\b|\bPEP\b|\bPolicyDecisionPoint\b|central\s+decision/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\brole\b|\bpermission\b|\bgrant\b/i],
    ["candidate derivation", /derivecandidate|\bcandidate\b/i],
    ["persistence or telemetry", /\baudit\b|\bcache\b|\bmemo\b|\brepositor|\bpersist|\bRLS\b|\boutbox\b/i],
    ["a transport/SDK surface", /fastapi|uvicorn|hypercorn|\basgi\b|\bhttp\b|\bdelivery\b|\bsdk\b/i],
    ["a wildcard/prefix/case-fold matching strategy", /wildcard|\bprefix\b|startswith|tolowercase|tolocalelowercase|toupperCase/i],
    ["the targetActor field", /\btargetActor\b/],
    ["the targetResourceType field", /\btargetResourceType\b/],
    ["the condition field", /\bcondition\b/],
    ["the priority field", /\bpriority\b/],
    ["the layer field", /\blayer\b/],
    ["the version field", /\bversion\b/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

test("src/application/policy-statement-action-matcher.mjs is at most 300 lines", () => {
  const lines = source().split("\n");
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  assert.ok(count <= 300, `${modulePath} must be at most 300 lines, found ${count}`);
});

// =====================================================================================
// B. Construction: frozen, stateless, no-arg class.
// =====================================================================================

test("PolicyStatementActionMatcher is a frozen, stateless, no-arg class; matchesAction is a method", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  assert.ok(Object.isFrozen(matcher), "a PolicyStatementActionMatcher instance must be frozen");
  assert.equal(typeof matcher.matchesAction, "function", "matchesAction must be a method");
  for (const bad of [{}, undefined, null, [], "x", 0]) {
    throws(() => new m.PolicyStatementActionMatcher(bad),
      "the constructor must refuse any supplied argument, explicit undefined included");
  }
});

// =====================================================================================
// C. matchesAction options admission: an ordinary object with exactly the two enumerable
//    own data properties `statement` and `actionName`.
// =====================================================================================

test("matchesAction options must be an ordinary object with exactly enumerable data properties statement and actionName", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();

  throws(() => matcher.matchesAction(), "no input at all must be refused");
  throws(() => matcher.matchesAction(null), "a null input must be refused");
  throws(() => matcher.matchesAction({ statement: ENABLED_MATCH, actionName: ACTION_NAME, extra: 1 }),
    "an unknown top-level key must be refused");
  throws(() => matcher.matchesAction({ statement: ENABLED_MATCH }), "a missing actionName must be refused");
  throws(() => matcher.matchesAction({ actionName: ACTION_NAME }), "a missing statement must be refused");

  const accessorStatement = {};
  Object.defineProperty(accessorStatement, "statement", { enumerable: true, get: () => ENABLED_MATCH });
  Object.defineProperty(accessorStatement, "actionName", { enumerable: true, value: ACTION_NAME });
  const accessorActionName = { statement: ENABLED_MATCH };
  Object.defineProperty(accessorActionName, "actionName", { enumerable: true, get: () => ACTION_NAME });
  const nonEnumStatement = { actionName: ACTION_NAME };
  Object.defineProperty(nonEnumStatement, "statement", { value: ENABLED_MATCH, enumerable: false });
  const symbolKeyedOptions = { statement: ENABLED_MATCH, actionName: ACTION_NAME };
  symbolKeyedOptions[Symbol("x")] = 1;
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), { statement: ENABLED_MATCH, actionName: ACTION_NAME });
  const nullProtoOptions = Object.assign(Object.create(null), { statement: ENABLED_MATCH, actionName: ACTION_NAME });

  for (const [label, bad] of [
    ["an array", [ENABLED_MATCH, ACTION_NAME]],
    ["a null-prototype object", nullProtoOptions],
    ["a custom-prototype object", customProtoOptions],
    ["an accessor-defined statement", accessorStatement],
    ["an accessor-defined actionName", accessorActionName],
    ["a symbol-keyed extra property", symbolKeyedOptions],
    ["a non-enumerable statement key", nonEnumStatement],
  ]) {
    throws(() => matcher.matchesAction(bad), `matchesAction options with ${label} must be refused`);
  }

  assert.doesNotThrow(() => matcher.matchesAction({ statement: ENABLED_MATCH, actionName: ACTION_NAME }),
    "a well-formed options object is admissible");
});

// =====================================================================================
// D. statement admission: exact genuine PolicyStatement only. A hollow prototype object, a
//    subclass, a structurally identical plain lookalike, and a forging Proxy are all refused.
// =====================================================================================

test("statement must be an exact genuine PolicyStatement: hollow, subclass and plain lookalike are refused", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();

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
    throws(() => matcher.matchesAction({ statement: bad, actionName: ACTION_NAME }),
      `statement ${label} must be refused: not an exact genuine PolicyStatement`);
  }

  assert.doesNotThrow(() => matcher.matchesAction({ statement: ENABLED_MATCH, actionName: ACTION_NAME }),
    "a genuine PolicyStatement is admissible");
});

test("statement refuses a Proxy over a genuine PolicyStatement whose traps forge the prototype and fabricate enabled/targetAction, exactly TypeError, without ever reaching the fabricating get traps", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const genuine = stmt({ enabled: false, targetAction: "billing.invoice.void" });
  const reached = { enabled: 0, targetAction: 0 };
  const forged = new Proxy(genuine, {
    getPrototypeOf: () => PolicyStatement.prototype,
    get(target, prop, receiver) {
      if (prop === "enabled") { reached.enabled += 1; return true; }
      if (prop === "targetAction") { reached.targetAction += 1; return ACTION_NAME; }
      return Reflect.get(target, prop, receiver);
    },
  });

  assert.throws(
    () => matcher.matchesAction({ statement: forged, actionName: ACTION_NAME }),
    TypeError,
    "a Proxy forging PolicyStatement admission must be refused with exactly a TypeError",
  );
  assert.deepEqual(reached, { enabled: 0, targetAction: 0 },
    "the field-forging get traps must never be reached: refusal happens before any forged field is read");
});

// =====================================================================================
// E. actionName grammar: a primitive Command/Query-style dotted lowercase identifier of at
//    least two segments, at most 128 characters. Note this is narrower than PolicyStatement's
//    own targetAction grammar, which admits a single undotted segment — a single-segment name
//    valid as a targetAction is nonetheless refused here as an actionName.
// =====================================================================================

test("actionName must be a primitive string of at least two dotted lowercase identifier segments, at most 128 characters", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const build = (actionName) => matcher.matchesAction({ statement: ENABLED_MATCH, actionName });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(ACTION_NAME), { toString: () => ACTION_NAME },
    { valueOf: () => ACTION_NAME }, Symbol("x"),
  ]) {
    throws(() => build(bad), `actionName ${String(bad)} must be refused: not a primitive string, never coerced`);
  }

  for (const bad of [
    "", "billing", "Billing.Invoice.Read", "billing.Invoice.read", "1billing.invoice", "billing.1invoice",
    "billing..invoice", "billing.invoice.", ".billing.invoice", "billing.invoice.read!", "billing_invoice.read",
    "billing invoice.read", "billing.invoice.read*", "*.invoice.read", "billing.*.read",
  ]) {
    throws(() => build(bad), `actionName ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  // Single-segment names are valid PolicyStatement targetAction values, and are refused here anyway.
  throws(() => build("billing"), "a single dotless segment must be refused as an actionName even though it is a valid targetAction");

  const at128 = `a.${"b".repeat(126)}`;
  assert.equal(at128.length, 128, "fixture sanity: the boundary fixture must be exactly 128 characters");
  assert.doesNotThrow(() => build(at128), "a 128-character actionName is admissible");
  const at129 = `${at128}b`;
  throws(() => build(at129), "a 129-character actionName must be refused");

  assert.doesNotThrow(() => build("billing.invoice.read"), "an ordinary two-dot Command/Query-shaped name is admissible");
  assert.doesNotThrow(() => build("billing.read"), "a two-segment name is admissible");
});

// =====================================================================================
// F. The truth table: exactly statement.enabled === true && statement.targetAction === actionName.
// =====================================================================================

test("matchesAction answers exactly statement.enabled===true && statement.targetAction===actionName across the full truth table", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const TARGET = "billing.invoice.read";
  const OTHER = "billing.invoice.void";

  const rows = [
    [true, TARGET, TARGET, true],
    [true, TARGET, OTHER, false],
    [false, TARGET, TARGET, false],
    [false, TARGET, OTHER, false],
  ];
  for (const [enabled, targetAction, actionName, expected] of rows) {
    const statement = stmt({ enabled, targetAction });
    const result = matches(matcher, statement, actionName);
    assert.equal(result, expected,
      `enabled=${enabled} targetAction=${targetAction} actionName=${actionName} must answer exactly ${expected}`);
    assert.equal(typeof result, "boolean", "matchesAction must answer a primitive boolean, never a truthy/falsy non-boolean");
  }
});

// =====================================================================================
// G. Exact equality only: no wildcard, no prefix, no suffix, no substring, no case-fold.
// =====================================================================================

test("matching is exact-equality only: no prefix, suffix, substring or case-folded match, even when enabled", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const enabledStatement = stmt({ enabled: true, targetAction: "billing.invoice.read" });

  for (const [label, actionName] of [
    ["a prefix of the target", "billing.invoice"],
    ["a suffix of the target", "invoice.read"],
    ["the target with a trailing segment", "billing.invoice.read.extra"],
    ["the target with a leading segment", "acme.billing.invoice.read"],
  ]) {
    assert.equal(matches(matcher, enabledStatement, actionName), false,
      `${label} must not match even though it shares a substring with the target action`);
  }

  const upperStatement = stmt({ enabled: true, targetAction: "billing.invoice.read" });
  throws(() => matches(matcher, upperStatement, "BILLING.INVOICE.READ"),
    "an uppercase actionName is grammatically refused rather than case-folded into a match");
});

// =====================================================================================
// H. Determinism, no mutation, synchronous.
// =====================================================================================

test("matchesAction is synchronous, deterministic and mutates neither the statement nor the matcher", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const statement = stmt({ enabled: true, targetAction: "billing.invoice.read" });
  const before = statement.toString();

  const result = matcher.matchesAction({ statement, actionName: "billing.invoice.read" });

  assert.ok(!(result instanceof Promise), "matchesAction must never return a Promise");
  assert.equal(statement.toString(), before, "the statement must be unchanged after matchesAction");
  assert.ok(Object.isFrozen(matcher), "the matcher must remain frozen after matchesAction");

  const again = matcher.matchesAction({ statement, actionName: "billing.invoice.read" });
  assert.equal(again, result, "repeated calls with the same input must answer identically");
});

// =====================================================================================
// I. Error redaction: a malformed candidate value is never echoed into a thrown message.
// =====================================================================================

test("a malformed actionName or statement is never echoed into the thrown error message", () => {
  const m = mod();
  const matcher = new m.PolicyStatementActionMatcher();
  const sentinelAction = "SECRET-TOKEN-do-not-leak-9f2c";
  const sentinelStatementValue = "SECRET-STATEMENT-do-not-leak-3e71";

  assert.throws(
    () => matcher.matchesAction({ statement: ENABLED_MATCH, actionName: sentinelAction }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelAction), "the refused actionName must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => matcher.matchesAction({ statement: sentinelStatementValue, actionName: ACTION_NAME }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelStatementValue), "the refused statement must not be echoed into the error message");
      return true;
    },
  );
});

// =====================================================================================
// J. The PKG16 change-gate contract itself (RED until planning/kernel-policy-statement-action-matcher-pkg16.json exists).
// =====================================================================================

const CONTRACT_PATH = "planning/kernel-policy-statement-action-matcher-pkg16.json";
async function contract() {
  let text;
  try { text = await readFile(path.join(root, CONTRACT_PATH), "utf8"); }
  catch (error) { assert.fail(`${CONTRACT_PATH} must exist and be readable: ${error.message}`); }
  return JSON.parse(text);
}
const hasMatch = (arr, re, label) => {
  assert.ok(Array.isArray(arr) && arr.length > 0, `${label} must be a nonempty array`);
  assert.ok(arr.some((s) => re.test(String(s))), `${label} must include an entry matching ${re}`);
};

test("PKG16 change-gate contract: identity, base, scope hash, exact allowed files, budget, non-goals, QA, rollback and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg16-policy-statement-action-matcher");
  assert.equal(c.baseCommit, "5740f693c609e76a4849652e7579992cc35345eb", "baseCommit must be the immutable PKG16 base");
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.match(String(c.authority?.subset ?? ""), /action.?matcher|policy.?statement/i);
  assert.equal(
    c.scope?.sha256,
    "44b870f3f3d6c7a347ce7cd72f68d26783d0fe9a216aff9faad24fe44c125b68",
    "scope.sha256 must equal the final scope hash this package was authored against",
  );
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800, "the package net ceiling must equal the canonical conditional-band ceiling");
  assert.equal(c.budget?.fullQaBudget, 2, "the full QA budget must be exactly 2");
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-policy-statement-action-matcher-pkg16.json",
    "src/application/policy-statement-action-matcher.mjs",
    "tests/kernel-policy-statement-action-matcher.test.mjs", "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths and no other");
  assert.deepEqual(c.evidencePolicy?.required, ["qa1", "qa2", "fresh-independent-review"],
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  for (const re of [
    /targetActor/i, /resourceType/i, /\bcondition\b/i, /\bpriority\b/i, /\blayer\b/i, /\bversion\b/i,
    /candidate|deriveCandidate/i, /evaluator/i, /\bpdp\b|policy\s*port/i,
    /rbac|abac|rebac/i, /\brls\b/i, /\bdb\b|database/i, /\bsdk\b/i, /delivery/i, /\bhttp\b/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands, /node --test tests\/kernel-policy-statement-action-matcher\.test\.mjs/, "red.commands");
  hasMatch(c.green?.requirements, /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements, /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements, /fresh independent review/i, "green.requirements (fresh independent review)");
  assert.ok(typeof c.rollback === "string" && c.rollback.length > 0, "rollback must be stated");
  assert.match(String(c.rollback), /revert(s|ed)?.*five.file.*shard|revert(s|ed)?.*exactly.*shard/i,
    "rollback must revert exactly this five-file shard");
  for (const re of [
    /allowed.?file parity/i, /\bqa\s*1\b/i, /fresh.*review/i,
    /source.*(<=|at most|no more than).*300/i, /net.*(<=|at most|no more than).*800/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});
