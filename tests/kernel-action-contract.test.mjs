import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// P02 — ActionContract, a handler-free declarative IR
//
// This is the whole observable surface of src/application/action-contract.mjs: one immutable
// value describing an action's shape — never an action, never a handler, never something that
// executes. It carries exactly `kind`, `name`, `version`, ordered `fields`, ordered `outcomes`
// and ordered `errorEnvelopeFields`. Written before the module exists, so every assertion here
// is a requirement.
//
// What must not appear: a handler, dispatcher, bus, router, use-case contract, policy/PDP type
// or data, write envelope, persistence, renderer, CLI or SDK surface. Command and Query stay the
// effect boundary in action-primitives.mjs; this module only describes shape.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/action-contract.mjs";

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

const EXPORTS = ["ActionContract"];

const OPTION_KEYS = ["kind", "name", "version", "fields", "outcomes", "errorEnvelopeFields"];
const JSON_KEYS = OPTION_KEYS;

const contractOptions = (overrides = {}) => ({
  kind: "command",
  name: "billing.invoice.issue",
  version: 1,
  fields: ["requestId", "actorId", "tenantId", "payload"],
  outcomes: ["ALLOW_COMMIT", "DENY", "INVALID", "CROSS_TENANT_DENY"],
  errorEnvelopeFields: ["code", "message", "requestId", "retryable"],
  ...overrides,
});

const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// The module surface: exactly one export, no handler/dispatcher/policy vocabulary anywhere.
// -------------------------------------------------------------------------------------

test("the module exports exactly ActionContract, no handler/dispatcher/policy vocabulary, and touches no ambient capability", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), EXPORTS, "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  for (const absent of [
    "UseCase", "Handler", "CommandHandler", "QueryHandler", "Dispatcher", "Bus", "Router",
    "Port", "PolicyDecisionPoint", "PolicyPort", "WriteEnvelope", "Repository", "Renderer",
    "Cli", "Sdk", "execute", "render", "dispatch", "handle",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, never to a declarative IR`);
  }
  assert.equal(typeof m.ActionContract, "function", "ActionContract must be a class");
  assert.deepEqual(Object.getOwnPropertySymbols(m.ActionContract), [], "no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.ActionContract.prototype), [Symbol.toStringTag],
    "the prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.ActionContract.prototype), Object.prototype, "must stand directly on Object");

  const text = sourceText ?? "";
  for (const [label, pattern] of [
    ["a clock", /\bDate\b|\bperformance\b|\bhrtime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\bcrypto\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b/],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b/i],
    ["a rendering vocabulary", /\brender\b|\btemplate\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
});

// -------------------------------------------------------------------------------------
// Construction: exact option set, kind/name/version validation.
// -------------------------------------------------------------------------------------

test("ActionContract accepts exactly its six declared options, all required", () => {
  const m = mod();
  const built = new m.ActionContract(contractOptions());
  assert.equal(built.kind, "command");
  assert.equal(built.name, "billing.invoice.issue");
  assert.equal(built.version, 1);
  assert.deepEqual([...built.fields], ["requestId", "actorId", "tenantId", "payload"]);
  assert.deepEqual([...built.outcomes], ["ALLOW_COMMIT", "DENY", "INVALID", "CROSS_TENANT_DENY"]);
  assert.deepEqual([...built.errorEnvelopeFields], ["code", "message", "requestId", "retryable"]);

  throws(() => new m.ActionContract(contractOptions({ handler: () => {} })), "an unknown option must be refused by name");
  for (const key of OPTION_KEYS) {
    const options = contractOptions();
    delete options[key];
    throws(() => new m.ActionContract(options), `omitting ${key} must be refused`);
    throws(() => new m.ActionContract(contractOptions({ [key]: null })), `${key} must not accept null`);
    throws(() => new m.ActionContract(contractOptions({ [key]: undefined })), `${key} must not accept undefined`);
  }
  for (const notOptions of [undefined, null, "x", 1, [], () => {}]) {
    throws(() => new m.ActionContract(notOptions), `an options object is required, not ${String(notOptions)}`);
  }

  assert.deepEqual(
    Object.getOwnPropertyNames(m.ActionContract.prototype).sort(),
    ["constructor", "equals", "errorEnvelopeFields", "fields", "kind", "name", "outcomes", "toJSON", "toString", "version"],
  );
  assert.deepEqual(Object.getOwnPropertyNames(m.ActionContract).sort(), ["length", "name", "prototype"], "no static factory");
});

test("kind admits only command or query", () => {
  const m = mod();
  for (const ok of ["command", "query"]) {
    assert.equal(new m.ActionContract(contractOptions({ kind: ok })).kind, ok);
  }
  for (const bad of ["Command", "COMMAND", "event", "handler", "", "command ", 1, true, [], {}, null]) {
    throws(() => new m.ActionContract(contractOptions({ kind: bad })), `${JSON.stringify(bad)} is not a legal kind`);
  }
});

test("a name is a dotted lowercase identifier of at most 128 characters", () => {
  const m = mod();
  const segment = (n) => "a".repeat(n);
  const exactly128 = `${segment(63)}.${segment(64)}`;
  for (const ok of ["billing.invoice.issue", "a.b", "order2.line3.add", exactly128]) {
    assert.equal(new m.ActionContract(contractOptions({ name: ok })).name, ok);
  }
  for (const bad of [
    "", "a", "Billing.invoice", "billing invoice", "billing-invoice.issue",
    "billing/invoice", "1billing.invoice", `${exactly128}a`, 1, true, [], {},
  ]) {
    throws(() => new m.ActionContract(contractOptions({ name: bad })), `${JSON.stringify(bad)} is not a legal name`);
  }
});

test("a version is a safe integer of at least 1", () => {
  const m = mod();
  for (const ok of [1, 2, 99, Number.MAX_SAFE_INTEGER]) {
    assert.equal(new m.ActionContract(contractOptions({ version: ok })).version, ok);
  }
  for (const bad of [0, -1, 1.5, NaN, Infinity, "1", true, Number.MAX_SAFE_INTEGER + 1, 1n, [1]]) {
    throws(() => new m.ActionContract(contractOptions({ version: bad })), `${String(bad)} is not a legal version`);
  }
});

// -------------------------------------------------------------------------------------
// The ordered-identifier-list rule, proven identically on fields, outcomes, errorEnvelopeFields.
// -------------------------------------------------------------------------------------

const LIST_KEYS = ["fields", "outcomes", "errorEnvelopeFields"];

test("fields, outcomes and errorEnvelopeFields preserve caller order and are deeply frozen", () => {
  const m = mod();
  for (const key of LIST_KEYS) {
    const built = new m.ActionContract(contractOptions({ [key]: ["zeta", "alpha", "mike"] }));
    assert.deepEqual([...built[key]], ["zeta", "alpha", "mike"], `${key}: order must not be sorted or otherwise changed`);
    assert.ok(Object.isFrozen(built[key]), `${key}: must be frozen`);
    assert.throws(() => { built[key].push("x"); }, TypeError, `${key}: a frozen array must refuse a push`);
    assert.equal(built[key], built[key], `${key}: the getter must be stable by reference`);

    const input = ["a", "b"];
    const contract = new m.ActionContract(contractOptions({ [key]: input }));
    input.push("c");
    assert.deepEqual([...contract[key]], ["a", "b"], `${key}: mutating the caller's array after construction must not reach the contract`);
  }
});

test("each list admits only an ordinary dense array of unique safe string identifiers", () => {
  const m = mod();
  for (const key of LIST_KEYS) {
    for (const bad of [
      "not-an-array", 1, {}, null,
      ["dup", "dup"],
      ["ok", ""],
      ["ok", "has space"],
      ["ok", "has-dash"],
      ["ok", "1leadingDigit"],
      ["ok", "Ünïcode"],
      ["ok", 1],
      ["ok", null],
      ["ok", undefined],
      ["ok", true],
      ["ok", {}],
      ["ok", []],
      ["ok", Symbol("x")],
    ]) {
      throws(() => new m.ActionContract(contractOptions({ [key]: bad })), `${key}: an unsafe entry must be refused`);
    }
    // Sparse and non-index-tagged arrays are refused the same way a data array would be.
    const sparse = ["a", "b"]; delete sparse[1];
    throws(() => new m.ActionContract(contractOptions({ [key]: sparse })), `${key}: a sparse hole must be refused`);
    const tagged = ["a"]; tagged.extra = "b";
    throws(() => new m.ActionContract(contractOptions({ [key]: tagged })), `${key}: an extra own property on the array must be refused`);
    const customProto = Object.setPrototypeOf(["a"], { evil: true });
    throws(() => new m.ActionContract(contractOptions({ [key]: customProto })), `${key}: a non-ordinary array prototype must be refused`);
    // A getter masquerading as an element is a side-effecting read and must be refused.
    const withGetter = ["a"];
    Object.defineProperty(withGetter, 1, { get: () => "b", enumerable: true, configurable: true });
    throws(() => new m.ActionContract(contractOptions({ [key]: withGetter })), `${key}: an accessor element must be refused`);
    // Ordinary, legal shapes stay legal.
    assert.doesNotThrow(() => new m.ActionContract(contractOptions({ [key]: ["okOne", "OK_TWO", "ok3"] })), `${key}: ordinary identifiers are legal`);
  }
});

// -------------------------------------------------------------------------------------
// Rendering, equality, non-leaking construction.
// -------------------------------------------------------------------------------------

test("the contract is frozen, exposes its fields as getters and carries no own property", () => {
  const m = mod();
  const built = new m.ActionContract(contractOptions());
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "fields live behind getters, not own properties");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member");
  assert.equal(built[Symbol.toStringTag], "ActionContract");
  assert.throws(() => { built.name = "other.name"; }, TypeError, "assignment must throw");
  assert.ok(Object.isFrozen(m.ActionContract.prototype) && Object.isFrozen(m.ActionContract));
});

test("toJSON/toString render a fixed key order and are deterministic", () => {
  const m = mod();
  const built = new m.ActionContract(contractOptions());
  const json = built.toJSON();
  assert.deepEqual(Object.keys(json), JSON_KEYS, "the envelope keeps its declared key order");
  assert.equal(built.toString(), JSON.stringify(built.toJSON()), "toString is the JSON rendering and nothing else");
  assert.equal(built.toString(), built.toString(), "repeated renderings must be identical");
  assert.equal(JSON.stringify(built), built.toString(), "JSON.stringify must route through the same envelope");
  const twin = new m.ActionContract(contractOptions());
  assert.equal(built.toString(), twin.toString(), "two constructions from the same input are byte-identical");
});

test("equals is exact-class and structural, sensitive to every field including order", () => {
  const m = mod();
  const a = new m.ActionContract(contractOptions());
  const b = new m.ActionContract(contractOptions());
  assert.ok(a.equals(b) && b.equals(a) && a.equals(a));
  for (const [key, value] of [
    ["kind", "query"], ["name", "billing.invoice.void"], ["version", 2],
    ["fields", ["requestId"]], ["outcomes", ["DENY", "ALLOW_COMMIT", "INVALID", "CROSS_TENANT_DENY"]],
    ["errorEnvelopeFields", ["message", "code", "requestId", "retryable"]],
  ]) {
    assert.equal(a.equals(new m.ActionContract(contractOptions({ [key]: value }))), false, `a difference in ${key} must break equality`);
  }
  class SubActionContract extends m.ActionContract {}
  const sub = new SubActionContract(contractOptions());
  assert.equal(a.equals(sub), false, "a subclass instance is not an ActionContract for this purpose");
  assert.equal(sub.equals(a), false, "and not in the other direction either");
  assert.equal(a.equals(Object.create(m.ActionContract.prototype)), false, "inheriting the prototype does not make an instance");
  for (const foreign of [null, undefined, 0, "", true, {}, [], a.toJSON()]) {
    assert.equal(a.equals(foreign), false, `equals must answer false for ${String(foreign)}`);
  }
});

test("the identity coordinates must be exact P-M1-01-style strings, never look-alike wrapper objects, and cycles cannot arise", () => {
  const m = mod();
  // The list fields hold only primitive strings, so there is no container depth for a cycle to
  // form through — proven by refusing the one shape that would try: a String wrapper.
  for (const key of LIST_KEYS) {
    throws(() => new m.ActionContract(contractOptions({ [key]: [new String("ok")] })), `${key}: a String wrapper is not a primitive string`);
  }
  throws(() => new m.ActionContract(contractOptions({ name: new String("billing.invoice.issue") })), "name must be a primitive string");
});

// -------------------------------------------------------------------------------------
// The top-level options object: only an ordinary Object.prototype data object with exactly
// the six declared own enumerable data properties, never a look-alike.
// -------------------------------------------------------------------------------------

test("the options argument admits only an ordinary object literal, never an array, function, scalar or null", () => {
  const m = mod();
  for (const notOptions of [[], ["kind"], () => {}, function named() {}, class C {}, 1, "x", true, Symbol("x")]) {
    throws(() => new m.ActionContract(notOptions), `an options object is required, not ${String(notOptions)}`);
  }
});

test("the options object must stand directly on Object.prototype, not a custom or null prototype", () => {
  const m = mod();
  const nullProto = Object.assign(Object.create(null), contractOptions());
  throws(() => new m.ActionContract(nullProto), "a null-prototype options object must be refused");
  const customProto = Object.create({ evil: true });
  Object.assign(customProto, contractOptions());
  throws(() => new m.ActionContract(customProto), "a custom-prototype options object must be refused");
});

test("an accessor property on the options object is refused without ever invoking its getter", () => {
  const m = mod();
  let invoked = false;
  const withGetter = contractOptions();
  delete withGetter.kind;
  Object.defineProperty(withGetter, "kind", { get: () => { invoked = true; return "command"; }, enumerable: true, configurable: true });
  throws(() => new m.ActionContract(withGetter), "an accessor option must be refused");
  assert.equal(invoked, false, "the getter must never run: this module checks shape, it does not read through it");
});

test("a non-enumerable, symbol-keyed, or extra own property on the options object is refused", () => {
  const m = mod();
  const withHidden = contractOptions();
  Object.defineProperty(withHidden, "kind", { value: "command", enumerable: false, writable: true, configurable: true });
  throws(() => new m.ActionContract(withHidden), "a non-enumerable own property must be refused");

  const withSymbol = contractOptions();
  withSymbol[Symbol("hidden")] = 1;
  throws(() => new m.ActionContract(withSymbol), "a symbol-keyed member must be refused");

  throws(() => new m.ActionContract(contractOptions({ extra: 1 })), "an extra unknown property must be refused");
});

// -------------------------------------------------------------------------------------
// Unsafe identifier keys, refused by exact name even though each matches the identifier
// grammar.
// -------------------------------------------------------------------------------------

test("__proto__, constructor and prototype are refused as list entries, however they arrive", () => {
  const m = mod();
  for (const key of LIST_KEYS) {
    for (const unsafe of ["__proto__", "constructor", "prototype"]) {
      throws(() => new m.ActionContract(contractOptions({ [key]: [unsafe] })), `${key}: ${unsafe} must be refused as an entry`);
      throws(() => new m.ActionContract(contractOptions({ [key]: ["ok", unsafe] })), `${key}: ${unsafe} must be refused alongside a legal entry`);
    }
    // A literal own __proto__ data property on the array, however defined, is still an unsafe
    // entry once read as element 0 — proven the same way action-primitives.mjs proves it.
    const viaDefine = [];
    Object.defineProperty(viaDefine, 0, { value: "__proto__", enumerable: true, writable: true, configurable: true });
    throws(() => new m.ActionContract(contractOptions({ [key]: viaDefine })), `${key}: __proto__ defined directly as an element must be refused`);
  }
});

// -------------------------------------------------------------------------------------
// The P02 planning record: a bounded, machine-readable-record guard against silent drift.
// -------------------------------------------------------------------------------------

test("the P02 planning record states truthful, non-drifting base/scope/gate/capability facts", async () => {
  const planningPath = path.join(root, "planning/kernel-action-contract-ir-p02.json");
  const text = await readFile(planningPath, "utf8");
  const record = JSON.parse(text);

  assert.equal(record.id, "kernel-action-contract-ir-p02-2026-08-24", "the record's own id must not drift");
  assert.equal(record.sequenceReference?.id, "P02", "the roadmap sequence id must stay pinned to P02");
  assert.equal(record.baseCommit, "fd144e1b602d1b5a142674555abb72a7173a3107", "the immutable base must be recorded exactly");
  assert.deepEqual(
    [...record.allowedFiles].sort(),
    [
      "CHANGELOG.md",
      "planning/kernel-action-contract-ir-p02.json",
      "src/application/action-contract.mjs",
      "tests/kernel-action-contract.test.mjs",
      "tests/repository-boundary.test.mjs",
    ],
    "the allowed-file set must match the MASTER-authorized five-file correction exactly",
  );
  // A writer may never self-claim GREEN or an external gate: those are decided outside this
  // repository, by a fresh reviewer and by CI, on an unchanged committed snapshot.
  assert.notEqual(record.packageState, "GREEN", "the writer must not self-claim a completed package state");
  assert.equal(typeof record.packageState, "string", "a candidate state must still be recorded, just not GREEN");
  assert.equal(record.budget?.conditionalEvidence?.freshReviewerAccept?.includes("PENDING"), true, "fresh reviewer acceptance must be recorded as pending, never self-claimed");
  assert.equal(record.capability_delta, "PUBLIC_ACTION_CONTRACT_IR_ONLY", "the capability delta must not silently widen");
  for (const flag of ["runnableProduct", "kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed", "productionAllowed", "gapClosed"]) {
    assert.equal(record.flags?.[flag], false, `${flag} must stay false: every stronger readiness claim is out of scope`);
  }
  // The planning record is public and portable: it must never carry a session-local or
  // machine-local filesystem locator, since a Git-hosted, cross-machine record cannot rely on
  // one reader's private /tmp or home directory existing at all.
  assert.ok(!text.includes("/private/tmp"), "the planning record must not embed a session-local /private/tmp locator");
  assert.ok(!/\/Users\/[^/"]+\//.test(text), "the planning record must not embed any machine-local /Users/<name>/ home-directory path");
});
