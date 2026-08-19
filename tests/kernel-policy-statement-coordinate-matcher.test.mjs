import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyStatement } from "../src/application/policy-statement.mjs";

// PKG18 — PolicyStatementCoordinateMatcher: an exact wrapper over the two existing exact-equality
// matchers, and nothing else. A frozen, stateless, no-arg class whose
// `matchesCoordinates({statement, actionName, resourceType})` is entirely synchronous and pure —
// never a Promise. It calls PolicyStatementActionMatcher#matchesAction and
// PolicyStatementResourceTypeMatcher#matchesResourceType exactly once each, with the coordinate
// pinned to the same statement, and both are evaluated before the AND is taken — never a
// short-circuit that skips the second collaborator once the first has already answered false.
// The answer is exactly `matchesAction(...) && matchesResourceType(...)` after both are computed.
// No targetActor/condition/priority/layer/version semantics reach this module; no candidate
// derivation, no Evaluator, no PDP, no Policy port, no RBAC/ABAC/ReBAC, no RLS/DB/SDK/Delivery/HTTP
// vocabulary.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement-coordinate-matcher.mjs";
const actionMatcherPath = "src/application/policy-statement-action-matcher.mjs";
const resourceTypeMatcherPath = "src/application/policy-statement-resource-type-matcher.mjs";

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
// A genuine statement, and the coordinate this matcher is entitled to read via its two
// collaborators only: enabled, targetAction, targetResourceType.
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

function matches(matcher, statement, actionName, resourceType) {
  return matcher.matchesCoordinates({ statement, actionName, resourceType });
}

// =====================================================================================
// A. Module surface, imports and forbidden vocabulary.
// =====================================================================================

test("module surface: exactly PolicyStatementCoordinateMatcher, frozen, no matching/candidate/RBAC/RLS/SDK vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyStatementCoordinateMatcher"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyStatementCoordinateMatcher, "function", "PolicyStatementCoordinateMatcher must be a class");
  assert.ok(Object.isFrozen(m.PolicyStatementCoordinateMatcher), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyStatementCoordinateMatcher.prototype), "the prototype must be frozen");
  for (const absent of [
    "deriveCandidate", "AuthorizationCandidate", "AuthorizationEvaluator", "Pdp", "PDP", "Pep", "PEP",
    "Policy", "PolicyDecisionPoint", "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role",
    "Permission", "Grant", "Rls", "RowLevelSecurity", "Repository", "Adapter", "Sdk", "SDK",
    "PolicyStatementActionMatcher", "PolicyStatementResourceTypeMatcher",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the PolicyStatementCoordinateMatcher module`);
  }
});

test("module imports both existing matchers by relative path and reaches no forbidden field, framework, or matching-strategy vocabulary in code", () => {
  const text = code();
  assert.match(text, /from\s*["']\.\/policy-statement-action-matcher\.mjs["']/, "must import PolicyStatementActionMatcher from its existing sibling module");
  assert.match(text, /from\s*["']\.\/policy-statement-resource-type-matcher\.mjs["']/, "must import PolicyStatementResourceTypeMatcher from its existing sibling module");
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
    ["the condition field", /\bcondition\b/],
    ["the priority field", /\bpriority\b/],
    ["the layer field", /\blayer\b/],
    ["the version field", /\bversion\b/],
    ["the PolicyStatement module directly", /from\s*["']\.\/policy-statement\.mjs["']/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
});

test("src/application/policy-statement-coordinate-matcher.mjs is at most 200 lines", () => {
  const lines = source().split("\n");
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  assert.ok(count <= 200, `${modulePath} must be at most 200 lines (a thin wrapper), found ${count}`);
});

// =====================================================================================
// B. Construction: frozen, stateless, no-arg class.
// =====================================================================================

test("PolicyStatementCoordinateMatcher is a frozen, stateless, no-arg class; matchesCoordinates is a method", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  assert.ok(Object.isFrozen(matcher), "a PolicyStatementCoordinateMatcher instance must be frozen");
  assert.equal(typeof matcher.matchesCoordinates, "function", "matchesCoordinates must be a method");
  for (const bad of [{}, undefined, null, [], "x", 0]) {
    throws(() => new m.PolicyStatementCoordinateMatcher(bad),
      "the constructor must refuse any supplied argument, explicit undefined included");
  }
});

// =====================================================================================
// C. matchesCoordinates options admission: an ordinary object with exactly the three
//    enumerable own data properties statement, actionName and resourceType.
// =====================================================================================

test("matchesCoordinates options must be an ordinary object with exactly enumerable data properties statement, actionName and resourceType", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();

  throws(() => matcher.matchesCoordinates(), "no input at all must be refused");
  throws(() => matcher.matchesCoordinates(null), "a null input must be refused");
  throws(() => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE, extra: 1 }),
    "an unknown top-level key must be refused");
  throws(() => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME }), "a missing resourceType must be refused");
  throws(() => matcher.matchesCoordinates({ statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE }), "a missing actionName must be refused");
  throws(() => matcher.matchesCoordinates({ actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }), "a missing statement must be refused");

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
    throws(() => matcher.matchesCoordinates(bad), `matchesCoordinates options with ${label} must be refused`);
  }

  assert.doesNotThrow(() => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    "a well-formed options object is admissible");
});

// =====================================================================================
// D. statement admission: exact genuine PolicyStatement only, as inherited from both
//    collaborators. A hollow prototype object, a subclass, a structurally identical plain
//    lookalike, and a forging Proxy are all refused.
// =====================================================================================

test("statement must be an exact genuine PolicyStatement: hollow, subclass and plain lookalike are refused", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();

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
    throws(() => matcher.matchesCoordinates({ statement: bad, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
      `statement ${label} must be refused: not an exact genuine PolicyStatement`);
  }

  assert.doesNotThrow(() => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    "a genuine PolicyStatement is admissible");
});

test("statement refuses a Proxy over a genuine PolicyStatement whose traps forge the prototype and fabricate enabled/targetAction/targetResourceType, exactly TypeError, without ever reaching the fabricating get traps", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const genuine = stmt({ enabled: false, targetAction: "billing.invoice.void", targetResourceType: "invoice-line" });
  const reached = { enabled: 0, targetAction: 0, targetResourceType: 0 };
  const forged = new Proxy(genuine, {
    getPrototypeOf: () => PolicyStatement.prototype,
    get(target, prop, receiver) {
      if (prop === "enabled") { reached.enabled += 1; return true; }
      if (prop === "targetAction") { reached.targetAction += 1; return ACTION_NAME; }
      if (prop === "targetResourceType") { reached.targetResourceType += 1; return RESOURCE_TYPE; }
      return Reflect.get(target, prop, receiver);
    },
  });

  assert.throws(
    () => matcher.matchesCoordinates({ statement: forged, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    TypeError,
    "a Proxy forging PolicyStatement admission must be refused with exactly a TypeError",
  );
  assert.deepEqual(reached, { enabled: 0, targetAction: 0, targetResourceType: 0 },
    "the field-forging get traps must never be reached: refusal happens before any forged field is read",
  );
});

// =====================================================================================
// E. actionName/resourceType grammar: inherited exactly from the two collaborators, since
//    this module is a wrapper and enforces no grammar of its own. A malformed actionName is
//    refused by the same rule PKG16 enforces; a malformed resourceType is refused by the same
//    rule PKG17 enforces.
// =====================================================================================

test("actionName grammar is inherited from PolicyStatementActionMatcher: at least two dotted lowercase segments, at most 128 characters", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const build = (actionName) => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName, resourceType: RESOURCE_TYPE });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(ACTION_NAME), { toString: () => ACTION_NAME },
    { valueOf: () => ACTION_NAME }, Symbol("x"),
  ]) {
    throws(() => build(bad), `actionName ${String(bad)} must be refused: not a primitive string, never coerced`);
  }
  for (const bad of ["", "billing", "Billing.Invoice.Read", "billing..invoice", "billing.invoice."]) {
    throws(() => build(bad), `actionName ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  const at128 = `a.${"b".repeat(126)}`;
  assert.equal(at128.length, 128, "fixture sanity: the boundary fixture must be exactly 128 characters");
  assert.doesNotThrow(() => build(at128), "a 128-character actionName is admissible");
  throws(() => build(`${at128}b`), "a 129-character actionName must be refused");

  assert.doesNotThrow(() => build("billing.invoice.read"), "an ordinary two-dot Command/Query-shaped name is admissible");
});

test("resourceType grammar is inherited from PolicyStatementResourceTypeMatcher: lowercase dot/hyphen id, 1 to 128 characters", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const build = (resourceType) => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(RESOURCE_TYPE), { toString: () => RESOURCE_TYPE },
    { valueOf: () => RESOURCE_TYPE }, Symbol("x"),
  ]) {
    throws(() => build(bad), `resourceType ${String(bad)} must be refused: not a primitive string, never coerced`);
  }
  for (const bad of ["", "Invoice", "invoice_line", "invoice..line", "invoice."]) {
    throws(() => build(bad), `resourceType ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  const at128 = `a${"b".repeat(127)}`;
  assert.equal(at128.length, 128, "fixture sanity: the boundary fixture must be exactly 128 characters");
  assert.doesNotThrow(() => build(at128), "a 128-character resourceType is admissible");
  throws(() => build(`${at128}b`), "a 129-character resourceType must be refused");

  assert.doesNotThrow(() => build("invoice"), "a single-segment lowercase id is admissible");
  assert.doesNotThrow(() => build("invoice.line"), "a dot-separated id is admissible");
});

// =====================================================================================
// F. The truth table: matchesCoordinates answers exactly the AND of both collaborator
//    answers, across enabled and each coordinate independently.
// =====================================================================================

test("matchesCoordinates answers exactly matchesAction && matchesResourceType across the full truth table", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const TARGET_ACTION = "billing.invoice.read";
  const OTHER_ACTION = "billing.invoice.void";
  const TARGET_RESOURCE = "invoice";
  const OTHER_RESOURCE = "invoice-line";

  const rows = [
    // enabled, targetAction, targetResourceType, actionName, resourceType, expected
    [true, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, TARGET_RESOURCE, true],
    [true, TARGET_ACTION, TARGET_RESOURCE, OTHER_ACTION, TARGET_RESOURCE, false],
    [true, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, OTHER_RESOURCE, false],
    [true, TARGET_ACTION, TARGET_RESOURCE, OTHER_ACTION, OTHER_RESOURCE, false],
    [false, TARGET_ACTION, TARGET_RESOURCE, TARGET_ACTION, TARGET_RESOURCE, false],
    [false, TARGET_ACTION, TARGET_RESOURCE, OTHER_ACTION, OTHER_RESOURCE, false],
  ];
  for (const [enabled, targetAction, targetResourceType, actionName, resourceType, expected] of rows) {
    const statement = stmt({ enabled, targetAction, targetResourceType });
    const result = matches(matcher, statement, actionName, resourceType);
    assert.equal(result, expected,
      `enabled=${enabled} targetAction=${targetAction} targetResourceType=${targetResourceType} actionName=${actionName} resourceType=${resourceType} must answer exactly ${expected}`);
    assert.equal(typeof result, "boolean", "matchesCoordinates must answer a primitive boolean, never a truthy/falsy non-boolean");
  }
});

// =====================================================================================
// G. No short-circuit: both collaborators are evaluated before the AND is taken. An action
//    mismatch must not suppress resourceType evaluation, and a resourceType mismatch must not
//    suppress action evaluation — proven by pairing a valid-but-mismatching coordinate on one
//    axis with a grammatically invalid value on the other axis. A short-circuiting
//    implementation would answer `false` without ever validating the second coordinate; the
//    required implementation must still throw, because it evaluates both.
// =====================================================================================

test("a mismatching but grammatical actionName does not suppress resourceType evaluation: an ungrammatical resourceType still throws", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const statement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice" });

  throws(
    () => matcher.matchesCoordinates({ statement, actionName: "billing.invoice.void", resourceType: "Invoice" }),
    "resourceType must still be validated and refused even though actionName already mismatches: no short-circuit on the action axis",
  );
});

test("a mismatching but grammatical resourceType does not suppress action evaluation: an ungrammatical actionName still throws", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const statement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice" });

  throws(
    () => matcher.matchesCoordinates({ statement, actionName: "billing", resourceType: "invoice-line" }),
    "actionName must still be validated and refused even though resourceType already mismatches: no short-circuit on the resourceType axis",
  );
});

test("a disabled statement does not suppress evaluation of either coordinate: an ungrammatical actionName or resourceType still throws even though enabled=false already forces false", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const statement = stmt({ enabled: false, targetAction: "billing.invoice.read", targetResourceType: "invoice" });

  throws(
    () => matcher.matchesCoordinates({ statement, actionName: "Billing.Invoice.Read", resourceType: "invoice" }),
    "actionName must still be grammar-checked even though the statement is disabled",
  );
  throws(
    () => matcher.matchesCoordinates({ statement, actionName: "billing.invoice.read", resourceType: "Invoice" }),
    "resourceType must still be grammar-checked even though the statement is disabled",
  );
});

// =====================================================================================
// H. Exact equality only: no wildcard, no prefix, no suffix, no substring, no case-fold, on
//    either coordinate — inherited behavior, re-proven at the wrapper boundary.
// =====================================================================================

test("matching is exact-equality only on both coordinates: no prefix, suffix, substring or case-folded match, even when enabled", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const enabledStatement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice.line" });

  for (const [label, actionName, resourceType] of [
    ["a prefix of the target action", "billing.invoice", "invoice.line"],
    ["a suffix of the target action", "invoice.read", "invoice.line"],
    ["a prefix of the target resourceType", "billing.invoice.read", "invoice"],
    ["a suffix of the target resourceType", "billing.invoice.read", "line"],
  ]) {
    assert.equal(matches(matcher, enabledStatement, actionName, resourceType), false,
      `${label} must not match even though it shares a substring with the target`);
  }
});

// =====================================================================================
// I. Determinism, no mutation, synchronous.
// =====================================================================================

test("matchesCoordinates is synchronous, deterministic and mutates neither the statement nor the matcher", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const statement = stmt({ enabled: true, targetAction: "billing.invoice.read", targetResourceType: "invoice" });
  const before = statement.toString();

  const result = matcher.matchesCoordinates({ statement, actionName: "billing.invoice.read", resourceType: "invoice" });

  assert.ok(!(result instanceof Promise), "matchesCoordinates must never return a Promise");
  assert.equal(statement.toString(), before, "the statement must be unchanged after matchesCoordinates");
  assert.ok(Object.isFrozen(matcher), "the matcher must remain frozen after matchesCoordinates");

  const again = matcher.matchesCoordinates({ statement, actionName: "billing.invoice.read", resourceType: "invoice" });
  assert.equal(again, result, "repeated calls with the same input must answer identically");
});

// =====================================================================================
// J. Error redaction: a malformed coordinate value is never echoed into a thrown message.
// =====================================================================================

test("a malformed actionName, resourceType or statement is never echoed into the thrown error message", () => {
  const m = mod();
  const matcher = new m.PolicyStatementCoordinateMatcher();
  const sentinelAction = "SECRET-TOKEN-do-not-leak-9f2c";
  const sentinelResource = "SECRET-RESOURCE-do-not-leak-7a31";
  const sentinelStatementValue = "SECRET-STATEMENT-do-not-leak-3e71";

  assert.throws(
    () => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: sentinelAction, resourceType: RESOURCE_TYPE }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelAction), "the refused actionName must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => matcher.matchesCoordinates({ statement: ENABLED_MATCH, actionName: ACTION_NAME, resourceType: sentinelResource }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelResource), "the refused resourceType must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => matcher.matchesCoordinates({ statement: sentinelStatementValue, actionName: ACTION_NAME, resourceType: RESOURCE_TYPE }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelStatementValue), "the refused statement must not be echoed into the error message");
      return true;
    },
  );
});

// =====================================================================================
// K. The two collaborator modules stay untouched: this package adds a wrapper, not a
//    rewrite. Proven by re-import identity of the unrelated matcher classes.
// =====================================================================================

test("the two existing matcher modules are unmodified collaborators: their classes remain importable and independently constructible", async () => {
  const actionMod = await import(pathToFileURL(path.join(root, actionMatcherPath)).href);
  const resourceMod = await import(pathToFileURL(path.join(root, resourceTypeMatcherPath)).href);
  assert.equal(typeof actionMod.PolicyStatementActionMatcher, "function");
  assert.equal(typeof resourceMod.PolicyStatementResourceTypeMatcher, "function");
  assert.doesNotThrow(() => new actionMod.PolicyStatementActionMatcher());
  assert.doesNotThrow(() => new resourceMod.PolicyStatementResourceTypeMatcher());
});

// =====================================================================================
// L. The PKG18 change-gate contract itself (RED until planning/kernel-policy-statement-coordinate-matcher-pkg18.json exists).
// =====================================================================================

const CONTRACT_PATH = "planning/kernel-policy-statement-coordinate-matcher-pkg18.json";
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

test("PKG18 change-gate contract: identity, base, scope hash, exact allowed files, budget, non-goals, QA, rollback and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.packageId, "p01-pkg18-policy-statement-coordinate-matcher");
  assert.equal(c.baseCommit, "cc98e5afdb952215921f0ed67cde2bd0ec513d6f", "baseCommit must be the immutable PKG18 base");
  assert.equal(c.classification, "security-test-conformance");
  assert.equal(c.authority?.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.match(String(c.authority?.subset ?? ""), /coordinate.?matcher|policy.?statement/i);
  assert.equal(
    c.scope?.sha256,
    "9ba354d3db36e0ed06193bc6451474579df301521424a731d64869130de00505",
    "scope.sha256 must equal the final frozen scope hash this package was authored against",
  );
  assert.equal(c.scope?.waiver, null, "scope.waiver must be pinned null: no scope waiver was granted for this package");
  assert.equal(c.budget?.band, "conditional");
  assert.equal(c.budget?.maxNet, 800, "the package net ceiling must equal the canonical conditional-band ceiling");
  assert.equal(c.budget?.maxChangedFiles, 5, "the changed-file ceiling must be exactly 5");
  assert.equal(c.budget?.fullQaBudget, 2, "the full QA budget must be exactly 2");
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-policy-statement-coordinate-matcher-pkg18.json",
    "src/application/policy-statement-coordinate-matcher.mjs",
    "tests/kernel-policy-statement-coordinate-matcher.test.mjs", "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths and no other");
  assert.deepEqual([...(c.evidencePolicy?.required ?? [])].sort(), ["fresh-independent-review", "qa1", "qa2"].sort(),
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  assert.ok(Array.isArray(c.router?.standardMatrix) && c.router.standardMatrix.length > 0,
    "router.standardMatrix must be a pinned nonempty array naming this package's Standard Router placement");
  hasMatch(c.router.standardMatrix, /coordinate/i, "router.standardMatrix");
  for (const re of [
    /targetActor/i, /\bcondition\b/i, /\bpriority\b/i, /\blayer\b/i, /\bversion\b/i,
    /candidate|deriveCandidate/i, /evaluator/i, /\bpdp\b|policy\s*port/i,
    /rbac|abac|rebac/i, /\brls\b/i, /\bdb\b|database/i, /\bsdk\b/i, /delivery/i, /\bhttp\b/i,
    /short.?circuit/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands ?? [], /node --test tests\/kernel-policy-statement-coordinate-matcher\.test\.mjs/, "red.commands");
  hasMatch(c.green?.requirements ?? [], /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements ?? [], /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements ?? [], /fresh independent review/i, "green.requirements (fresh independent review)");
  assert.ok(typeof c.rollback === "string" && c.rollback.length > 0, "rollback must be stated");
  assert.match(String(c.rollback), /revert(s|ed)?.*five.file.*shard|revert(s|ed)?.*exactly.*shard/i,
    "rollback must revert exactly this five-file shard");
  for (const re of [
    /allowed.?file parity/i, /\bqa\s*1\b/i, /fresh.*review/i,
    /source.*(<=|at most|no more than).*200/i, /net.*(<=|at most|no more than).*800/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});
