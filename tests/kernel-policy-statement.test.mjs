import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// P04a — PolicyStatement, an immutable policy-as-data row
//
// This is the whole observable surface of src/application/policy-statement.mjs: one immutable
// value carrying exactly the ten declared fields of one declarative policy row — never a
// matcher, a record set, a candidate resolver, condition semantics, a batch or a decision log.
// Written before the module exists, so every assertion here is a requirement.
//
// What must not appear: matching, wildcard, condition evaluation, record set, candidate
// derivation, resolver, combining, deny-overrides execution, batch, decision-log, audit/outbox/
// cache, persistence, migration, RLS, PEP, HTTP/UI. The existing Policy, PolicyRequest,
// PolicyDecision, AuthorizationEvaluator and PolicyDecisionPoint stay untouched.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

let sourceText = null;
try {
  sourceText = await readFile(path.join(root, modulePath), "utf8");
} catch {
  sourceText = null;
}

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}

const EXPORTS = ["PolicyStatement"];

const OPTION_KEYS = [
  "id", "effect", "targetActor", "targetAction", "targetResourceType",
  "condition", "priority", "layer", "version", "enabled",
];

const statementOptions = (overrides = {}) => ({
  id: "policy.sales-own-customer",
  effect: "allow",
  targetActor: { role: "sales-rep" },
  targetAction: "customer.update",
  targetResourceType: "customer",
  condition: { field: "ownerId", equals: "actor.id" },
  priority: 100,
  layer: "tenant",
  version: "1.0.0",
  enabled: true,
  ...overrides,
});

const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// The module surface: exactly one export, no matcher/resolver/batch/log vocabulary anywhere.
// -------------------------------------------------------------------------------------

test("the module exports exactly PolicyStatement, no matcher/resolver/batch/log vocabulary, and touches no ambient capability", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), EXPORTS, "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  for (const absent of [
    "PolicyRecordSet", "PolicyStatementSet", "CandidateResolver", "candidatesFor",
    "PolicyDecisionLog", "DecisionLog", "BatchEvaluator", "Matcher", "match", "evaluate",
    "combine", "resolve", "Repository", "Adapter", "Rls", "Pep",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later P04 subpackage, never to an inert data row`);
  }
  assert.equal(typeof m.PolicyStatement, "function", "PolicyStatement must be a class");
  assert.deepEqual(Object.getOwnPropertySymbols(m.PolicyStatement), [], "no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.PolicyStatement.prototype), [Symbol.toStringTag],
    "the prototype must carry the class-name tag and no other symbol",
  );
});

test("the module imports nothing: no relative import, no bare specifier, no node: builtin", () => {
  assert.ok(sourceText !== null, `${modulePath} must exist on disk to inspect its source`);
  assert.doesNotMatch(sourceText, /^\s*import\b/m, "PolicyStatement must carry zero imports");
});

test("class/prototype are frozen", () => {
  const { PolicyStatement } = mod();
  assert.ok(Object.isFrozen(PolicyStatement), "the class itself must be frozen");
  assert.ok(Object.isFrozen(PolicyStatement.prototype), "the prototype must be frozen");
});

// -------------------------------------------------------------------------------------
// Construction: exact option set, all ten fields required.
// -------------------------------------------------------------------------------------

test("constructs from exactly the ten declared options and freezes the instance", () => {
  const { PolicyStatement } = mod();
  const statement = new PolicyStatement(statementOptions());
  assert.ok(Object.isFrozen(statement), "instance must be frozen");
  assert.equal(statement.id, "policy.sales-own-customer");
  assert.equal(statement.effect, "allow");
  assert.deepEqual({ ...statement.targetActor }, { role: "sales-rep" });
  assert.equal(statement.targetAction, "customer.update");
  assert.equal(statement.targetResourceType, "customer");
  assert.deepEqual({ ...statement.condition }, { field: "ownerId", equals: "actor.id" });
  assert.equal(statement.priority, 100);
  assert.equal(statement.layer, "tenant");
  assert.equal(statement.version, "1.0.0");
  assert.equal(statement.enabled, true);
});

test("refuses a missing or extra option, a non-ordinary options object, and an accessor option", () => {
  const { PolicyStatement } = mod();
  throws(() => new PolicyStatement(undefined), "undefined options");
  throws(() => new PolicyStatement(null), "null options");
  throws(() => new PolicyStatement("nope"), "non-object options");
  throws(() => new PolicyStatement([]), "array options");
  for (const key of OPTION_KEYS) {
    const partial = statementOptions();
    delete partial[key];
    throws(() => new PolicyStatement(partial), `missing ${key}`);
  }
  throws(() => new PolicyStatement(statementOptions({ extra: 1 })), "unknown extra option");
  throws(
    () => new PolicyStatement(Object.create(null, Object.getOwnPropertyDescriptors(statementOptions()))),
    "null-prototype options object",
  );
  const withAccessor = statementOptions();
  Object.defineProperty(withAccessor, "id", { get: () => "policy.sneaky", enumerable: true, configurable: true });
  throws(() => new PolicyStatement(withAccessor), "accessor-defined option");
  const withNonEnumerable = statementOptions();
  Object.defineProperty(withNonEnumerable, "id", { value: "policy.hidden", enumerable: false, configurable: true });
  throws(() => new PolicyStatement(withNonEnumerable), "non-enumerable option");
});

// -------------------------------------------------------------------------------------
// effect / layer / priority / enabled / version scalars
// -------------------------------------------------------------------------------------

test("effect must be exactly allow or deny", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["ALLOW", "Deny", "permit", "", 1, null, undefined, true]) {
    throws(() => new PolicyStatement(statementOptions({ effect: bad })), `effect ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ effect: "deny" })).effect, "deny");
});

test("layer must be exactly system, platform or tenant", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["SYSTEM", "global", "", 1, null, undefined]) {
    throws(() => new PolicyStatement(statementOptions({ layer: bad })), `layer ${String(bad)}`);
  }
  for (const good of ["system", "platform", "tenant"]) {
    assert.equal(new PolicyStatement(statementOptions({ layer: good })).layer, good);
  }
});

test("priority must be a safe integer", () => {
  const { PolicyStatement } = mod();
  for (const bad of [1.5, NaN, Infinity, -Infinity, "1", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    throws(() => new PolicyStatement(statementOptions({ priority: bad })), `priority ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ priority: -5 })).priority, -5);
  assert.equal(new PolicyStatement(statementOptions({ priority: 0 })).priority, 0);
});

test("enabled must be a primitive boolean", () => {
  const { PolicyStatement } = mod();
  for (const bad of [1, 0, "true", "false", null, undefined, new Boolean(true)]) {
    throws(() => new PolicyStatement(statementOptions({ enabled: bad })), `enabled ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ enabled: false })).enabled, false);
});

test("version must be an exact SemVer 2.0.0 string, retained verbatim", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "1.0.0-", "", 1, null, undefined, "01.0.0"]) {
    throws(() => new PolicyStatement(statementOptions({ version: bad })), `version ${String(bad)}`);
  }
  for (const good of ["0.0.1", "2.10.3", "1.0.0-alpha.1", "1.0.0+build.5", "1.0.0-rc.1+exp.sha.5114f85"]) {
    assert.equal(new PolicyStatement(statementOptions({ version: good })).version, good);
  }
});

// -------------------------------------------------------------------------------------
// id / targetAction / targetResourceType bounded canonical scalars
// -------------------------------------------------------------------------------------

test("id must be a bounded canonical lowercase identifier", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["", "Policy.Id", "policy id", "-policy", "policy-", "a".repeat(129), 1, null, undefined]) {
    throws(() => new PolicyStatement(statementOptions({ id: bad })), `id ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ id: "a" })).id, "a");
});

test("targetAction must be a dotted lowercase action coordinate", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["", "Customer.Update", "customer", "customer update", "customer..update", 1, null, undefined]) {
    throws(() => new PolicyStatement(statementOptions({ targetAction: bad })), `targetAction ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ targetAction: "billing.invoice.issue" })).targetAction, "billing.invoice.issue");
});

test("targetResourceType must be a bounded lowercase resource-type token", () => {
  const { PolicyStatement } = mod();
  for (const bad of ["", "Customer", "customer type", "-customer", 1, null, undefined]) {
    throws(() => new PolicyStatement(statementOptions({ targetResourceType: bad })), `targetResourceType ${String(bad)}`);
  }
  assert.equal(new PolicyStatement(statementOptions({ targetResourceType: "customer.record" })).targetResourceType, "customer.record");
});

// -------------------------------------------------------------------------------------
// targetActor / condition: defensive, deterministic, deeply frozen JSON data
// -------------------------------------------------------------------------------------

test("targetActor and condition are deeply frozen and defensively cloned", () => {
  const { PolicyStatement } = mod();
  const targetActor = { role: "sales-rep", tags: ["a", "b"] };
  const condition = { field: "ownerId", nested: { deep: [1, 2, 3] } };
  const statement = new PolicyStatement(statementOptions({ targetActor, condition }));
  assert.ok(Object.isFrozen(statement.targetActor));
  assert.ok(Object.isFrozen(statement.targetActor.tags));
  assert.ok(Object.isFrozen(statement.condition));
  assert.ok(Object.isFrozen(statement.condition.nested));
  assert.ok(Object.isFrozen(statement.condition.nested.deep));
  assert.notEqual(statement.targetActor, targetActor, "must be cloned, not the caller's object by reference");
  targetActor.role = "mutated";
  assert.equal(statement.targetActor.role, "sales-rep", "post-construction mutation of the caller's object must not leak in");
});

test("targetActor and condition refuse hostile, cyclic and exotic structured data", () => {
  const { PolicyStatement } = mod();

  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  throws(() => new PolicyStatement(statementOptions({ targetActor: cyclic })), "cyclic targetActor");
  throws(() => new PolicyStatement(statementOptions({ condition: cyclic })), "cyclic condition");

  throws(() => new PolicyStatement(statementOptions({ targetActor: null })), "null targetActor");
  throws(() => new PolicyStatement(statementOptions({ targetActor: [] })), "array-root targetActor");
  throws(() => new PolicyStatement(statementOptions({ targetActor: "nope" })), "scalar-root targetActor");
  throws(() => new PolicyStatement(statementOptions({ condition: null })), "null condition");
  throws(() => new PolicyStatement(statementOptions({ condition: [] })), "array-root condition");

  const withAccessor = { get poison() { return 1; } };
  throws(() => new PolicyStatement(statementOptions({ targetActor: withAccessor })), "accessor property inside targetActor");

  const withSymbol = { [Symbol("x")]: 1, ok: 1 };
  throws(() => new PolicyStatement(statementOptions({ targetActor: withSymbol })), "symbol-keyed member inside targetActor");

  const withProtoKey = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
  throws(() => new PolicyStatement(statementOptions({ targetActor: withProtoKey })), "__proto__ own key inside targetActor");

  throws(() => new PolicyStatement(statementOptions({ targetActor: { constructor: 1, ok: 1 } })), "constructor own key inside targetActor");
  throws(() => new PolicyStatement(statementOptions({ targetActor: { prototype: 1, ok: 1 } })), "prototype own key inside targetActor");
  throws(() => new PolicyStatement(statementOptions({ condition: { constructor: 1, ok: 1 } })), "constructor own key inside condition");
  throws(() => new PolicyStatement(statementOptions({ condition: { prototype: 1, ok: 1 } })), "prototype own key inside condition");

  const shared = { x: 1 };
  throws(() => new PolicyStatement(statementOptions({ targetActor: { a: shared, b: shared } })), "one structured value repeated by reference in targetActor");
  throws(() => new PolicyStatement(statementOptions({ condition: { a: shared, b: shared } })), "one structured value repeated by reference in condition");

  const withHole = [1, , 3];
  throws(() => new PolicyStatement(statementOptions({ targetActor: { list: withHole } })), "sparse array hole inside targetActor");

  const withNonFinite = { value: NaN };
  throws(() => new PolicyStatement(statementOptions({ targetActor: withNonFinite })), "NaN inside targetActor");
  throws(() => new PolicyStatement(statementOptions({ targetActor: { value: Infinity } })), "Infinity inside targetActor");

  class Exotic { constructor() { this.x = 1; } }
  throws(() => new PolicyStatement(statementOptions({ targetActor: new Exotic() })), "class-instance root targetActor");

  const foreignArrayProto = Object.setPrototypeOf([1, 2], { extra: true });
  throws(() => new PolicyStatement(statementOptions({ targetActor: { list: foreignArrayProto } })), "foreign-prototype array inside targetActor");
});

// -------------------------------------------------------------------------------------
// Deterministic rendering and equality
// -------------------------------------------------------------------------------------

test("toJSON/toString render deterministically in fixed field order", () => {
  const { PolicyStatement } = mod();
  const statement = new PolicyStatement(statementOptions());
  const json = statement.toJSON();
  assert.deepEqual(Object.keys(json), OPTION_KEYS, "toJSON must render the ten fields in fixed declared order");
  assert.equal(statement.toString(), JSON.stringify(json));
  assert.equal(JSON.stringify(statement), statement.toString(), "JSON.stringify must route through toJSON");
});

test("equals is exact-class and structural, never true across a lookalike", () => {
  const { PolicyStatement } = mod();
  const a = new PolicyStatement(statementOptions());
  const b = new PolicyStatement(statementOptions());
  const different = new PolicyStatement(statementOptions({ priority: 200 }));
  assert.ok(a.equals(b), "two statements built from equal options must compare equal");
  assert.ok(!a.equals(different), "a differing field must break equality");
  assert.ok(!a.equals({ ...a.toJSON() }), "a plain-object lookalike must never compare equal");
  assert.ok(!a.equals(null));
  assert.ok(!a.equals(undefined));
});

test("equals refuses a genuine subclass instance and a hollow object built only on the prototype", () => {
  const { PolicyStatement } = mod();
  const a = new PolicyStatement(statementOptions());

  class SubStatement extends PolicyStatement {}
  const sub = new SubStatement(statementOptions());
  assert.ok(!a.equals(sub), "a genuine subclass instance must never compare equal by prototype-chain instanceof");
  assert.ok(!sub.equals(a), "the refusal must hold symmetrically from the subclass side");

  const hollow = Object.create(PolicyStatement.prototype);
  assert.ok(!a.equals(hollow), "an object built only on the prototype, with no private field ever installed, must never compare equal");
});

test("structured data nests at most sixteen containers deep, and a deeper value fails closed", () => {
  const { PolicyStatement } = mod();
  const buildNested = (depth) => {
    let value = { leaf: true };
    for (let i = 0; i < depth; i += 1) value = { nested: value };
    return value;
  };
  assert.equal(new PolicyStatement(statementOptions({ targetActor: buildNested(15) })).targetActor !== undefined, true, "15 nested containers must be admitted");
  throws(() => new PolicyStatement(statementOptions({ targetActor: buildNested(17) })), "17 nested containers must fail closed");
  throws(() => new PolicyStatement(statementOptions({ condition: buildNested(17) })), "17 nested containers must fail closed in condition too");
});

test("no clock, random, environment, filesystem or network effect is reachable from construction", () => {
  assert.ok(sourceText !== null, `${modulePath} must exist on disk to inspect its source`);
  for (const forbidden of [
    "Date.now", "new Date(", "Math.random", "process.env", "readFile", "fetch(", "require(",
  ]) {
    assert.ok(!sourceText.includes(forbidden), `${modulePath} must not reference ${forbidden}`);
  }
});
