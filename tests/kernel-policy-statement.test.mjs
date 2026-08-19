import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// PKG15 — PolicyStatement: an immutable exact typed value carrying one policy-as-data rule,
// the complete canonical ten-field row. It matches, evaluates, combines and decides nothing:
// no rule/condition semantics, no matching, no wildcard, no deriveCandidate, no candidate
// combining, no PDP/Evaluator/Policy-port wiring, no RBAC/ABAC/ReBAC engine, no role/permission
// /grant model, no RLS/DB/audit/outbox/cache/SDK/generated artifact/delivery/HTTP vocabulary.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy-statement.mjs";

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

const FIELDS = [
  "id", "effect", "targetActor", "targetAction", "targetResourceType",
  "condition", "priority", "layer", "version", "enabled",
];

const good = (overrides = {}) => ({
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
const build = (overrides) => new (mod().PolicyStatement)(good(overrides));

// A. Module surface: exactly one export, no default, zero imports, forbidden vocabulary absent.
test("module surface: exactly PolicyStatement, frozen, zero imports, no rule/matching/RBAC/RLS/SDK vocabulary", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["PolicyStatement"], "export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "no default export");
  assert.equal(typeof m.PolicyStatement, "function", "PolicyStatement must be a class");
  assert.ok(Object.isFrozen(m.PolicyStatement), "the class itself must be frozen");
  assert.ok(Object.isFrozen(m.PolicyStatement.prototype), "the prototype must be frozen");
  const text = code();
  assert.ok(!/^\s*import\b/m.test(text), `${modulePath} must carry zero imports`);
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import`);
  for (const [label, pattern] of [
    ["deriveCandidate/matching", /derives?candidate|\bmatch(es|ing)?\b\s*\(/i],
    ["a central decision point", /\bPDP\b|\bPEP\b|central\s+decision/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\bgrant\b|\bpermission\b|\brole\b/i],
    ["persistence or telemetry", /\baudit\b|\bcache\b|\brepositor|\bpersist|\bRLS\b|\boutbox\b/i],
    ["a transport/SDK surface", /fastapi|uvicorn|hypercorn|\basgi\b|\bhttp\b|\bdelivery\b|\bsdk\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for or name ${label}`);
  }
});

// B. Construction: exact ten keys, exact descriptors. Caller insertion order is not semantic.
test("PolicyStatement takes exactly the ten fields, all present; caller insertion order is not semantic", () => {
  const m = mod();
  for (const bad of [undefined, null, "x", 0, [], {}]) {
    throws(() => new m.PolicyStatement(bad), "the constructor must refuse a non-genuine options object");
  }
  throws(() => build({ extra: 1 }), "an unknown key must be refused");
  for (const field of FIELDS) {
    const { [field]: _drop, ...rest } = good();
    throws(() => new m.PolicyStatement(rest), `a missing ${field} must be refused`);
  }
  assert.doesNotThrow(() => build(), "a well-formed options object is admissible");

  const reordered = {};
  for (const field of [...FIELDS].reverse()) reordered[field] = good()[field];
  const shuffled = new m.PolicyStatement(reordered);
  assert.deepEqual(Object.keys(shuffled.toJSON()), FIELDS, "toJSON key order is fixed regardless of caller insertion order");
  assert.ok(shuffled.equals(build()), "a shuffled-but-complete ordinary data object constructs a value equal to the declared-order build");
});

test("src/application/policy-statement.mjs is at most 300 lines", () => {
  const lines = source().split("\n");
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  assert.ok(count <= 300, `${modulePath} must be at most 300 lines, found ${count}`);
});

test("options must be an ordinary object with exact enumerable data descriptors, no exotic carrier admitted", () => {
  const accessorOptions = { ...good() };
  delete accessorOptions.id;
  Object.defineProperty(accessorOptions, "id", { enumerable: true, get: () => "pol-a" });
  const nonEnumOptions = { ...good() };
  delete nonEnumOptions.id;
  Object.defineProperty(nonEnumOptions, "id", { value: "pol-a", enumerable: false });
  const nullProtoOptions = Object.assign(Object.create(null), good());
  class CustomOptions {}
  const customProtoOptions = Object.assign(new CustomOptions(), good());
  for (const [label, bad] of [
    ["an accessor-defined key", accessorOptions],
    ["a non-enumerable key", nonEnumOptions],
    ["a null-prototype options object", nullProtoOptions],
    ["a custom-prototype options object", customProtoOptions],
  ]) {
    throws(() => new (mod().PolicyStatement)(bad), `options with ${label} must be refused`);
  }
});

// C. Each scalar field's validation.
test("id and targetResourceType share the same bounded lowercase canonical-id rule", () => {
  for (const field of ["id", "targetResourceType"]) {
    for (const bad of ["Pol-A", "", "a".repeat(129), "pol_a!", 1, null, undefined, "-lead", "trail-"]) {
      throws(() => build({ [field]: bad }), `${field} must refuse ${JSON.stringify(bad)}`);
    }
    assert.doesNotThrow(() => build({ [field]: "a1.b-2" }), `${field} admits a canonical dotted/hyphenated id`);
  }
});

test("effect is exactly allow or deny", () => {
  for (const bad of ["ALLOW", "permit", 1, null, undefined, ""]) throws(() => build({ effect: bad }));
  assert.doesNotThrow(() => build({ effect: "deny" }));
});

test("targetAction is one or more dotted lowercase identifier segments", () => {
  for (const bad of ["Billing.Read", "", "1action", "a..b", "a.", ".a", 1, null, "a_b"]) {
    throws(() => build({ targetAction: bad }));
  }
  assert.doesNotThrow(() => build({ targetAction: "a.b1.c2" }));
});

test("priority is a safe integer", () => {
  for (const bad of [1.5, NaN, Infinity, -Infinity, "1", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    throws(() => build({ priority: bad }));
  }
  assert.doesNotThrow(() => build({ priority: -5 }));
  assert.doesNotThrow(() => build({ priority: 0 }));
});

test("layer is exactly system, platform, or tenant", () => {
  for (const bad of ["Tenant", "global", 1, null, undefined, ""]) throws(() => build({ layer: bad }));
  for (const good_ of ["system", "platform", "tenant"]) assert.doesNotThrow(() => build({ layer: good_ }));
});

test("version is a primitive string valid under SemVer 2.0.0 syntax, retained exactly", () => {
  for (const bad of ["1.2", "v1.2.3", "1.2.3.4", "01.2.3", "1.2.3-", 1, null, undefined, ""]) {
    throws(() => build({ version: bad }));
  }
  for (const okVersion of ["0.1.0-alpha.1", "1.0.0", "2.3.4-rc.10+build.5"]) {
    assert.equal(build({ version: okVersion }).version, okVersion, "version must be retained exactly, never normalized");
  }
});

test("enabled is a primitive boolean, required even though a future default might exist", () => {
  for (const bad of ["true", 1, null, undefined, 0]) throws(() => build({ enabled: bad }));
  assert.equal(build({ enabled: false }).enabled, false);
});

// D. targetActor / condition: canonicalized, deeply frozen JSON-data objects; hostile input refused.
test("targetActor and condition are canonicalized: sorted keys, deep freeze, defensive clone, empty admitted", () => {
  for (const field of ["targetActor", "condition"]) {
    const statement = build({ [field]: { b: 1, a: { d: 1, c: 2 } } });
    assert.deepEqual(Object.keys(statement[field]), ["a", "b"], `${field} keys must be sorted`);
    assert.deepEqual(Object.keys(statement[field].a), ["c", "d"], `${field} keys must be sorted at every depth`);
    assert.ok(Object.isFrozen(statement[field]), `${field} must be deeply frozen`);
    assert.ok(Object.isFrozen(statement[field].a), `${field} must be deeply frozen at every depth`);
    assert.equal(Object.getPrototypeOf(statement[field]), null, `${field} must render with a null prototype`);
    assert.doesNotThrow(() => build({ [field]: {} }), `${field} admits an empty object`);

    const original = { x: 1 };
    assert.notEqual(build({ [field]: original })[field], original, `${field} must be a defensive clone`);
  }
});

test("targetActor and condition refuse hostile structured data", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const shared = { x: 1 };
  const symbolKeyed = { [Symbol("x")]: 1 };
  const accessorHeld = (() => { const o = {}; Object.defineProperty(o, "g", { enumerable: true, get: () => 1 }); return o; })();
  for (const [label, bad] of [
    ["an ordinary object with an enumerable own __proto__ key", JSON.parse('{"__proto__":{"polluted":true}}')],
    ["a constructor key", JSON.parse('{"constructor":1}')],
    ["a prototype key", { prototype: 1 }],
    ["a symbol key", symbolKeyed],
    ["a non-finite number", { n: Infinity }],
    ["NaN", { n: NaN }],
    ["undefined", { n: undefined }],
    ["a bigint", { n: 1n }],
    ["a function", { n: () => 1 }],
    ["a null-prototype object", Object.create(null)],
    ["an array hole", (() => { const a = [1]; a.length = 3; return { list: a }; })()],
    ["an extra array property", Object.assign([1, 2], { extra: true })],
    ["a non-array exotic", new Map()],
    ["an accessor property", accessorHeld],
    ["a cycle", cyclic],
  ]) {
    throws(() => build({ targetActor: bad }), `targetActor with ${label} must be refused`);
    throws(() => build({ condition: bad }), `condition with ${label} must be refused`);
  }
  throws(() => build({ targetActor: { a: shared, b: shared } }), "a value repeated by reference must be refused");
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 20; i += 1) { cursor.next = {}; cursor = cursor.next; }
  throws(() => build({ targetActor: deep }), "nesting beyond the max depth must be refused");
  throws(() => build({ targetActor: [] }), "targetActor must be an ordinary object, never an array");
  throws(() => build({ condition: [] }), "condition must be an ordinary object, never an array");
});

// E. Frozen exact value, exact-class identity, forgery/subclass refusal.
test("a constructed PolicyStatement is frozen, its getters are read-only, and it carries all ten fields", () => {
  const statement = build();
  assert.ok(Object.isFrozen(statement), "the instance must be frozen");
  for (const field of FIELDS) assert.notEqual(statement[field], undefined, `${field} must be readable`);
  assert.throws(() => { statement.id = "pol-b"; }, TypeError);
  assert.throws(() => { statement.extra = 1; }, TypeError);
});

test("PolicyStatement is exact-class identified, never by instanceof: a subclass and a hollow object are refused", () => {
  const m = mod();
  const genuine = build();
  assert.ok(isExactly(genuine, m.PolicyStatement), "a genuine instance must be exact-class identified");

  class Derived extends m.PolicyStatement {}
  const derived = new Derived(good());
  assert.ok(derived instanceof m.PolicyStatement, "a subclass instance is still instanceof its base");
  assert.ok(!isExactly(derived, m.PolicyStatement), "a subclass instance must never be exact-class identified");

  const hollow = Object.create(m.PolicyStatement.prototype);
  assert.ok(hollow instanceof m.PolicyStatement, "a hollow object built on the prototype is still instanceof");
  assert.ok(!genuine.equals(hollow), "a hollow prototype-only object must never equal a genuine instance");
  assert.ok(!genuine.equals(derived), "a subclass instance must never equal a genuine exact instance");
});

// F. Deterministic rendering and equality.
test("toJSON is a plain object carrying all ten fields in the declared order, toString is its JSON rendering", () => {
  const statement = build();
  assert.deepEqual(Object.keys(statement.toJSON()), FIELDS, "toJSON key order is fixed to the declared field order");
  assert.equal(statement.toString(), JSON.stringify(statement.toJSON()));
  assert.equal(JSON.stringify(statement), statement.toString(), "JSON.stringify must defer to toJSON/toString");
  assert.equal(statement[Symbol.toStringTag], "PolicyStatement");
});

test("equals is true only for another exact genuine PolicyStatement carrying the identical value", () => {
  const a = build();
  const sameValue = build();
  const differentId = build({ id: "pol-b" });
  const plainLookalike = good();

  assert.ok(a.equals(sameValue), "two instances carrying the identical value must be equal");
  assert.equal(a.equals(a), true, "an instance must equal itself");
  assert.ok(!a.equals(differentId));
  assert.ok(!a.equals(plainLookalike), "a plain data object with the identical shape must never equal a typed instance");
  for (const bad of [null, undefined, "pol-a", 1, [], {}]) {
    assert.equal(a.equals(bad), false, `equals must answer false, never throw, for ${String(bad)}`);
  }
});
