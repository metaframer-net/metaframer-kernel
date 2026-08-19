import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PolicyStatement } from "../src/application/policy-statement.mjs";

// PKG17 — PolicyStatementResourceTypeMatcher: exact-equality resource-type matching, and nothing
// else. A frozen, stateless, no-arg class whose `matchesResourceType({statement, resourceType})`
// is entirely synchronous and pure — never a Promise. `statement` must be an exact genuine
// PolicyStatement; `resourceType` is a primitive canonical resource-type id. The answer is
// exactly `statement.enabled === true && statement.targetResourceType === resourceType` — string
// identity only, never a prefix, a wildcard, a case-fold or a coercion. No targetAction/
// targetActor/condition/priority/layer/version semantics reach this module; no candidate
// derivation, no Evaluator, no PDP, no Policy port, no RBAC/ABAC/ReBAC, no RLS/DB/SDK/Delivery/
// HTTP/ASGI/FastAPI/Uvicorn/Hypercorn vocabulary.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement-resource-type-matcher.mjs";

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
const RESOURCE_TYPE = "invoice";

function matches(matcher, statement, resourceType) {
  return matcher.matchesResourceType({ statement, resourceType });
}

// =====================================================================================
// A. Module surface, imports and forbidden vocabulary.
// =====================================================================================

test("module surface: exactly PolicyStatementResourceTypeMatcher, frozen, no matching/candidate/RBAC/RLS/SDK vocabulary beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyStatementResourceTypeMatcher"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyStatementResourceTypeMatcher, "function", "PolicyStatementResourceTypeMatcher must be a class");
  assert.ok(Object.isFrozen(m.PolicyStatementResourceTypeMatcher), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyStatementResourceTypeMatcher.prototype), "the prototype must be frozen");
  for (const absent of [
    "deriveCandidate", "AuthorizationCandidate", "AuthorizationEvaluator", "Pdp", "PDP", "Pep", "PEP",
    "Policy", "PolicyDecisionPoint", "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role",
    "Permission", "Grant", "Rls", "RowLevelSecurity", "Repository", "Adapter", "Sdk", "SDK",
    "PolicyStatementActionMatcher",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs elsewhere, not to the PolicyStatementResourceTypeMatcher module`);
  }
});

test("module reaches no forbidden import, targetAction/targetActor/condition/priority/layer/version field, or PDP/RBAC/RLS/SDK/Delivery/HTTP/ASGI vocabulary in code", () => {
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
    ["the targetAction field", /\btargetAction\b/],
    ["the targetActor field", /\btargetActor\b/],
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

test("src/application/policy-statement-resource-type-matcher.mjs is at most 300 lines", () => {
  const lines = source().split("\n");
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  assert.ok(count <= 300, `${modulePath} must be at most 300 lines, found ${count}`);
});

// =====================================================================================
// B. Construction: frozen, stateless, no-arg class.
// =====================================================================================

test("PolicyStatementResourceTypeMatcher is a frozen, stateless, no-arg class; matchesResourceType is a method", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  assert.ok(Object.isFrozen(matcher), "a PolicyStatementResourceTypeMatcher instance must be frozen");
  assert.equal(typeof matcher.matchesResourceType, "function", "matchesResourceType must be a method");
  for (const bad of [{}, undefined, null, [], "x", 0]) {
    throws(() => new m.PolicyStatementResourceTypeMatcher(bad),
      "the constructor must refuse any supplied argument, explicit undefined included");
  }
});

// =====================================================================================
// C. matchesResourceType options admission: an ordinary object with exactly the two enumerable
//    own data properties `statement` and `resourceType`.
// =====================================================================================

test("matchesResourceType options must be an ordinary object with exactly enumerable data properties statement and resourceType", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();

  throws(() => matcher.matchesResourceType(), "no input at all must be refused");
  throws(() => matcher.matchesResourceType(null), "a null input must be refused");
  throws(() => matcher.matchesResourceType({ statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE, extra: 1 }),
    "an unknown top-level key must be refused");
  throws(() => matcher.matchesResourceType({ statement: ENABLED_MATCH }), "a missing resourceType must be refused");
  throws(() => matcher.matchesResourceType({ resourceType: RESOURCE_TYPE }), "a missing statement must be refused");

  const accessorStatement = {};
  Object.defineProperty(accessorStatement, "statement", { enumerable: true, get: () => ENABLED_MATCH });
  Object.defineProperty(accessorStatement, "resourceType", { enumerable: true, value: RESOURCE_TYPE });
  const accessorResourceType = { statement: ENABLED_MATCH };
  Object.defineProperty(accessorResourceType, "resourceType", { enumerable: true, get: () => RESOURCE_TYPE });
  const nonEnumStatement = { resourceType: RESOURCE_TYPE };
  Object.defineProperty(nonEnumStatement, "statement", { value: ENABLED_MATCH, enumerable: false });
  const symbolKeyedOptions = { statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE };
  symbolKeyedOptions[Symbol("x")] = 1;
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), { statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE });
  const nullProtoOptions = Object.assign(Object.create(null), { statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE });

  for (const [label, bad] of [
    ["an array", [ENABLED_MATCH, RESOURCE_TYPE]],
    ["a null-prototype object", nullProtoOptions],
    ["a custom-prototype object", customProtoOptions],
    ["an accessor-defined statement", accessorStatement],
    ["an accessor-defined resourceType", accessorResourceType],
    ["a symbol-keyed extra property", symbolKeyedOptions],
    ["a non-enumerable statement key", nonEnumStatement],
  ]) {
    throws(() => matcher.matchesResourceType(bad), `matchesResourceType options with ${label} must be refused`);
  }

  assert.doesNotThrow(() => matcher.matchesResourceType({ statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE }),
    "a well-formed options object is admissible");
});

// =====================================================================================
// D. statement admission: exact genuine PolicyStatement only. A hollow prototype object, a
//    subclass, a structurally identical plain lookalike, and a forging Proxy are all refused.
// =====================================================================================

test("statement must be an exact genuine PolicyStatement: hollow, subclass and plain lookalike are refused", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();

  const hollow = Object.create(PolicyStatement.prototype);
  class DerivedStatement extends PolicyStatement {}
  const derived = new DerivedStatement(statementFields());
  const lookalike = { ...ENABLED_MATCH.toJSON() };
  const nullProtoLookalike = Object.assign(Object.create(null), ENABLED_MATCH.toJSON());

  for (const [label, bad] of [
    ["null", null], ["undefined", undefined], ["a string", "invoice"], ["a number", 1],
    ["an ordinary empty object", {}], ["an array", []],
    ["a hollow prototype object", hollow],
    ["a subclass instance", derived],
    ["a plain object exposing the same enumerable JSON fields", lookalike],
    ["a null-prototype object exposing the same fields", nullProtoLookalike],
  ]) {
    throws(() => matcher.matchesResourceType({ statement: bad, resourceType: RESOURCE_TYPE }),
      `statement ${label} must be refused: not an exact genuine PolicyStatement`);
  }

  assert.doesNotThrow(() => matcher.matchesResourceType({ statement: ENABLED_MATCH, resourceType: RESOURCE_TYPE }),
    "a genuine PolicyStatement is admissible");
});

test("statement refuses a Proxy over a genuine PolicyStatement whose traps forge the prototype and fabricate enabled/targetResourceType, exactly TypeError, without ever reaching the fabricating get traps", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const genuine = stmt({ enabled: false, targetResourceType: "invoice-line" });
  const reached = { enabled: 0, targetResourceType: 0 };
  const forged = new Proxy(genuine, {
    getPrototypeOf: () => PolicyStatement.prototype,
    get(target, prop, receiver) {
      if (prop === "enabled") { reached.enabled += 1; return true; }
      if (prop === "targetResourceType") { reached.targetResourceType += 1; return RESOURCE_TYPE; }
      return Reflect.get(target, prop, receiver);
    },
  });

  assert.throws(
    () => matcher.matchesResourceType({ statement: forged, resourceType: RESOURCE_TYPE }),
    TypeError,
    "a Proxy forging PolicyStatement admission must be refused with exactly a TypeError",
  );
  assert.deepEqual(reached, { enabled: 0, targetResourceType: 0 },
    "the field-forging get traps must never be reached: refusal happens before any forged field is read");
});

// =====================================================================================
// E. resourceType grammar: a primitive lowercase canonical id, dot/hyphen separated, at least
//    one character, at most 128 characters — the same grammar PolicyStatement itself enforces
//    for targetResourceType.
// =====================================================================================

test("resourceType must be a primitive string of 1 to 128 characters matching the canonical lowercase id grammar", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const build = (resourceType) => matcher.matchesResourceType({ statement: ENABLED_MATCH, resourceType });

  for (const bad of [
    null, undefined, 1, true, {}, [], new String(RESOURCE_TYPE), { toString: () => RESOURCE_TYPE },
    { valueOf: () => RESOURCE_TYPE }, Symbol("x"),
  ]) {
    throws(() => build(bad), `resourceType ${String(bad)} must be refused: not a primitive string, never coerced`);
  }

  for (const bad of [
    "", "Invoice", "INVOICE", "invoice_line", "invoice line", "invoice..line", "invoice.-line",
    ".invoice", "invoice.", "-invoice", "invoice-", "invoice*", "*invoice", "invoice/line",
    "invoice\\line", "invoice#1",
  ]) {
    throws(() => build(bad), `resourceType ${JSON.stringify(bad)} must be refused as ungrammatical`);
  }

  const at128 = `a${"b".repeat(127)}`;
  assert.equal(at128.length, 128, "fixture sanity: the boundary fixture must be exactly 128 characters");
  assert.doesNotThrow(() => build(at128), "a 128-character resourceType is admissible");
  const at129 = `${at128}b`;
  throws(() => build(at129), "a 129-character resourceType must be refused");

  assert.doesNotThrow(() => build("invoice"), "a single-segment lowercase id is admissible");
  assert.doesNotThrow(() => build("invoice.line"), "a dot-separated id is admissible");
  assert.doesNotThrow(() => build("invoice-line"), "a hyphen-separated id is admissible");
  assert.doesNotThrow(() => build("i9"), "a short alphanumeric id is admissible");
});

// =====================================================================================
// F. The truth table: exactly statement.enabled === true && statement.targetResourceType === resourceType.
// =====================================================================================

test("matchesResourceType answers exactly statement.enabled===true && statement.targetResourceType===resourceType across the full truth table", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const TARGET = "invoice";
  const OTHER = "invoice-line";

  const rows = [
    [true, TARGET, TARGET, true],
    [true, TARGET, OTHER, false],
    [false, TARGET, TARGET, false],
    [false, TARGET, OTHER, false],
  ];
  for (const [enabled, targetResourceType, resourceType, expected] of rows) {
    const statement = stmt({ enabled, targetResourceType });
    const result = matches(matcher, statement, resourceType);
    assert.equal(result, expected,
      `enabled=${enabled} targetResourceType=${targetResourceType} resourceType=${resourceType} must answer exactly ${expected}`);
    assert.equal(typeof result, "boolean", "matchesResourceType must answer a primitive boolean, never a truthy/falsy non-boolean");
  }
});

// =====================================================================================
// G. Exact equality only: no wildcard, no prefix, no suffix, no substring, no case-fold.
// =====================================================================================

test("matching is exact-equality only: no prefix, suffix, substring or case-folded match, even when enabled", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const enabledStatement = stmt({ enabled: true, targetResourceType: "invoice.line" });

  for (const [label, resourceType] of [
    ["a prefix of the target", "invoice"],
    ["a suffix of the target", "line"],
    ["the target with a trailing segment", "invoice.line.extra"],
    ["the target with a leading segment", "acme.invoice.line"],
  ]) {
    assert.equal(matches(matcher, enabledStatement, resourceType), false,
      `${label} must not match even though it shares a substring with the target resource type`);
  }

  const upperStatement = stmt({ enabled: true, targetResourceType: "invoice" });
  throws(() => matches(matcher, upperStatement, "INVOICE"),
    "an uppercase resourceType is grammatically refused rather than case-folded into a match");
});

// =====================================================================================
// H. Determinism, no mutation, synchronous.
// =====================================================================================

test("matchesResourceType is synchronous, deterministic and mutates neither the statement nor the matcher", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const statement = stmt({ enabled: true, targetResourceType: "invoice" });
  const before = statement.toString();

  const result = matcher.matchesResourceType({ statement, resourceType: "invoice" });

  assert.ok(!(result instanceof Promise), "matchesResourceType must never return a Promise");
  assert.equal(statement.toString(), before, "the statement must be unchanged after matchesResourceType");
  assert.ok(Object.isFrozen(matcher), "the matcher must remain frozen after matchesResourceType");

  const again = matcher.matchesResourceType({ statement, resourceType: "invoice" });
  assert.equal(again, result, "repeated calls with the same input must answer identically");
});

// =====================================================================================
// I. Error redaction: a malformed candidate value is never echoed into a thrown message.
// =====================================================================================

test("a malformed resourceType or statement is never echoed into the thrown error message", () => {
  const m = mod();
  const matcher = new m.PolicyStatementResourceTypeMatcher();
  const sentinelResourceType = "SECRET-TOKEN-do-not-leak-9f2c";
  const sentinelStatementValue = "SECRET-STATEMENT-do-not-leak-3e71";

  assert.throws(
    () => matcher.matchesResourceType({ statement: ENABLED_MATCH, resourceType: sentinelResourceType }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelResourceType), "the refused resourceType must not be echoed into the error message");
      return true;
    },
  );
  assert.throws(
    () => matcher.matchesResourceType({ statement: sentinelStatementValue, resourceType: RESOURCE_TYPE }),
    (error) => {
      assert.ok(!String(error.message).includes(sentinelStatementValue), "the refused statement must not be echoed into the error message");
      return true;
    },
  );
});

// =====================================================================================
// J. The PKG17 change-gate contract itself (RED until planning/kernel-policy-statement-resource-type-matcher-pkg17.json exists).
// =====================================================================================

const CONTRACT_PATH = "planning/kernel-policy-statement-resource-type-matcher-pkg17.json";
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

test("PKG17 change-gate contract: identity, base, scope hash, exact allowed files, budget, non-goals, QA, rollback and exit criteria", async () => {
  const c = await contract();
  assert.equal(c.packageId, "p01-pkg17-policy-statement-resource-type-matcher");
  assert.equal(c.baseCommit, "6b07adbb525d90ad6f49e7d6253ecf444c83554b", "baseCommit must be the immutable PKG17 base");
  assert.equal(c.classification, "security-test-conformance");
  assert.match(String(c.authority?.subset ?? c.subset ?? ""), /resource.?type|policy.?statement/i);
  const scopeHash = c.scope?.sha256 ?? c.scopeHash;
  assert.equal(
    scopeHash,
    "07cdd9e09eecbb75ed862e797ac091f547e8ce8846fd6e4bb40b19237a96face",
    "scope.sha256 must equal the final scope hash this package was authored against",
  );
  const budget = c.budget ?? {};
  assert.equal(budget.band, "conditional");
  assert.equal(budget.maxNet, 800, "the package net ceiling must equal the canonical conditional-band ceiling");
  assert.equal(budget.maxChangedFiles, 5, "the changed-file ceiling must be exactly 5");
  assert.equal(budget.fullQaBudget, 2, "the full QA budget must be exactly 2");
  assert.deepEqual([...c.allowedFiles].sort(), [
    "README.md", "planning/kernel-policy-statement-resource-type-matcher-pkg17.json",
    "src/application/policy-statement-resource-type-matcher.mjs",
    "tests/kernel-policy-statement-resource-type-matcher.test.mjs", "tests/repository-boundary.test.mjs",
  ].sort(), "allowedFiles must be exactly these five paths and no other");
  const evidenceRequired = c.evidencePolicy?.required ?? c.evidence?.required;
  assert.deepEqual([...(evidenceRequired ?? [])].sort(), ["fresh-independent-review", "qa1", "qa2"].sort(),
    "evidencePolicy.required must be exactly qa1, qa2, fresh-independent-review");
  for (const re of [
    /targetAction/i, /targetActor/i, /\bcondition\b/i, /\bpriority\b/i, /\blayer\b/i, /\bversion\b/i,
    /candidate|deriveCandidate/i, /evaluator/i, /\bpdp\b|policy\s*port/i,
    /rbac|abac|rebac/i, /\brls\b/i, /\bdb\b|database/i, /\bsdk\b/i, /delivery/i, /\bhttp\b/i,
    /asgi|fastapi|uvicorn|hypercorn/i,
  ]) hasMatch(c.nonGoals, re, "nonGoals");
  hasMatch(c.red?.commands ?? c.redCommands ?? [], /node --test tests\/kernel-policy-statement-resource-type-matcher\.test\.mjs/, "red.commands");
  hasMatch(c.green?.requirements ?? c.greenRequirements ?? [], /npm test/, "green.requirements (npm test)");
  hasMatch(c.green?.requirements ?? c.greenRequirements ?? [], /npm run check/, "green.requirements (npm run check)");
  hasMatch(c.green?.requirements ?? c.greenRequirements ?? [], /fresh independent review/i, "green.requirements (fresh independent review)");
  assert.ok(typeof c.rollback === "string" && c.rollback.length > 0, "rollback must be stated");
  assert.match(String(c.rollback), /revert(s|ed)?.*five.file.*shard|revert(s|ed)?.*exactly.*shard/i,
    "rollback must revert exactly this five-file shard");
  for (const re of [
    /allowed.?file parity/i, /\bqa\s*1\b/i, /fresh.*review/i,
    /source.*(<=|at most|no more than).*300/i, /net.*(<=|at most|no more than).*800/i,
  ]) hasMatch(c.exitCriteria, re, "exitCriteria");
});
