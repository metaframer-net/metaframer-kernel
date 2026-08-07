import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ActorId, CausationId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";

// =====================================================================================
// P-M1-02 — the action primitives, frozen as a public contract
//
// This is the whole observable surface of src/application/action-primitives.mjs: a typed
// Command, a typed Query, a typed Result and one canonical KernelError. It is written before
// the module exists, so every assertion here is a requirement rather than a description of
// something already built.
//
// The Application ring owns these four types. That ownership is the point of the package and
// it is stated once, here, in a form that fails rather than drifts: Domain keeps the identity
// values, Application composes them into an action, and nothing in this file may be satisfied
// by moving a type inward. A Command that lived in Domain would make Domain know what a
// use-case is; a Command that lived in an adapter would make every caller depend on transport.
//
// Two orderings live here and they are not the same rule, so they are never mixed:
//
//   - The *envelope* — what a Command, Query, KernelError or Result renders as — has a fixed,
//     hand-chosen key order. It is a discovery contract: a reader meets `kind` first, then the
//     action's name and version, then who acted, then how the message was caused, and only then
//     the data. Alphabetising it would put `causationId` before `kind` and turn the first thing
//     a reader sees into the least useful one.
//   - The *canonical value* — a payload, a KernelError's details, a Result's value — sorts its
//     keys, because it is data whose byte form must not depend on how a caller happened to type
//     it. Determinism is the whole rule there, and sorting is the only rule that gives it.
//
// What is deliberately *not* here, and must not appear:
//
//   - no UseCase contract, handler, dispatcher, bus or router — an action is a value, and the
//     thing that executes it is a later package with its own gate;
//   - no port of any kind, no unit of work, no clock, no policy, no audit, no outbox;
//   - no validation boundary and no composition root;
//   - no database, transport, framework, environment, clock or randomness of any kind.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module
// must fail every test by name rather than collapsing the file into a single load error, since
// twenty named failures are the RED specification and one load error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/action-primitives.mjs";
const domainPath = "src/domain/identity-primitives.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

let sourceText = null;
let sourceError = null;
try {
  sourceText = await readFile(path.join(root, modulePath), "utf8");
} catch (error) {
  sourceError = error;
}

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}

function source() {
  assert.ok(sourceText !== null, `${modulePath} must exist as a readable file: ${sourceError?.message ?? "not read"}`);
  return sourceText;
}

/**
 * The source with comments removed, so a token scan reads what the module *does*.
 *
 * Line-based on purpose: this module may explain in prose why it never touches a clock, and a
 * scan that could not tell the explanation from the deed would forbid the explanation. The one
 * thing it cannot survive is `//` inside a string literal, which this module has no reason to
 * carry — it holds no URL, no path and no regex over a slash.
 */
function code() {
  return source()
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      return line.split("//")[0];
    })
    .join("\n");
}

/** The prototype chain above a value, used to reach every inherited getter. */
const chain = (value) => {
  const out = [];
  for (let p = Object.getPrototypeOf(value); p !== null; p = Object.getPrototypeOf(p)) out.push(p);
  return out;
};

const EXPORTS = ["Command", "KernelError", "Query", "Result"];

// Fixtures. Literal identity values, built through the P-M1-01 constructors, because a Command
// that accepted anything looser than these instances would push validation back onto its callers.
const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-billing-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const OTHER_PRINCIPAL = new Principal(new TenantId("9c858901-8a57-4791-81fe-4c455b099bc9"), ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const CAUSATION = new CausationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const RAW_IDEMPOTENCY = "order-7731-retry-2";
const IDEMPOTENCY = new IdempotencyKey(RAW_IDEMPOTENCY);
const OTHER_IDEMPOTENCY = new IdempotencyKey("order-7731-retry-3");

const NAME = "billing.invoice.issue";
const VERSION = 3;

// Subclasses of every identity type. `instanceof` would admit all four of these while they carry
// whatever the subclass added, and the action would have no way to know — so each one is refused.
class SubPrincipal extends Principal {}
class SubCorrelationId extends CorrelationId {}
class SubCausationId extends CausationId {}
class SubIdempotencyKey extends IdempotencyKey {}

/** The seven Command options, all present and all non-null but `causationId`. */
const commandOptions = (overrides = {}) => ({
  name: NAME,
  version: VERSION,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: CAUSATION,
  idempotencyKey: IDEMPOTENCY,
  payload: { amount: 100, currency: "EUR" },
  ...overrides,
});

/** The six Query options: the same coordinates without an idempotency key. */
const queryOptions = (overrides = {}) => {
  const { idempotencyKey, ...rest } = commandOptions(overrides);
  return rest;
};

/** Construction options, in no particular order — an options object has no reading order. */
const COMMAND_OPTION_KEYS = [
  "name", "version", "principal", "correlationId", "causationId", "idempotencyKey", "payload",
];
const QUERY_OPTION_KEYS = COMMAND_OPTION_KEYS.filter((key) => key !== "idempotencyKey");
/** `causationId` is the one coordinate with a legal null: a root action has nothing that caused it. */
const NULLABLE_OPTION = "causationId";

/** The envelope, in its fixed discovery order. This order is the contract, not a consequence. */
const COMMAND_JSON_KEYS = [
  "kind", "name", "version", "principal", "correlationId", "causationId", "idempotencyKey", "payload",
];
const QUERY_JSON_KEYS = COMMAND_JSON_KEYS.filter((key) => key !== "idempotencyKey");
const PRINCIPAL_JSON_KEYS = ["tenantId", "actorId"];
const ERROR_JSON_KEYS = ["code", "details", "cause"];

/** Every way a value can be built at depth. The root counts as level 1. */
const nest = (levels, leaf = null) => {
  let value = leaf;
  for (let i = levels; i >= 1; i -= 1) value = { [`level${i}`]: value };
  return value;
};

/** The same, alternating object and array, so a depth rule cannot be array-blind. */
const nestMixed = (levels, leaf = null) => {
  let value = leaf;
  for (let i = levels; i >= 1; i -= 1) value = i % 2 === 0 ? [value] : { [`level${i}`]: value };
  return value;
};

/**
 * Every surface that accepts a canonical JSON value, so each canonical rule is proven on all of them.
 *
 * A Command payload, a Query payload, a Result value and a KernelError's details are one rule
 * wearing four names. Testing one and trusting the others is how the four come to disagree — and
 * details is the one most likely to drift, because an error is the place a developer reaches for
 * "just this once" when something un-serialisable would be convenient to attach.
 */
const canonicalSurfaces = () => {
  const m = mod();
  return [
    ["Command payload", (value) => new m.Command(commandOptions({ payload: value })).payload],
    ["Query payload", (value) => new m.Query(queryOptions({ payload: value })).payload],
    ["Result.ok value", (value) => m.Result.ok(value).value],
    ["KernelError details", (value) => new m.KernelError({ code: "X_Y", details: value, cause: null }).details],
  ];
};

/** Build a chain of `depth` nested KernelErrors, innermost cause first. */
const errorChain = (depth) => {
  const m = mod();
  let cause = null;
  for (let i = depth; i >= 1; i -= 1) cause = new m.KernelError({ code: `LAYER_${i}`, details: null, cause });
  return cause;
};

const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// 1–3. The module surface, its one import, and the capabilities it never reaches.
// -------------------------------------------------------------------------------------

test("the module exports exactly Command, Query, Result and KernelError, and nothing else", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), EXPORTS, "the export set is frozen at exactly these four names");
  assert.equal(m.default, undefined, "a default export would be an unnamed fifth surface");
  // Each absent name is a whole concern this package must not have started. They are listed
  // rather than summarised because the failure they guard against is one of them appearing
  // alone, quietly, as "just a small helper".
  for (const absent of [
    "UseCase", "UseCaseContract", "Handler", "CommandHandler", "QueryHandler", "Dispatcher",
    "Bus", "CommandBus", "Router", "Port", "UnitOfWork", "Transaction", "Clock", "IdentityPort",
    "PolicyPort", "AuditPort", "OutboxPort", "Repository", "ValidationBoundary", "Validator",
    "CompositionRoot", "container", "configure", "register",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the action primitives`);
  }
  // The version coordinate of an action is `name@version`, carried by each instance. A module
  // level version would be a second, competing answer to "which version is this", and the two
  // would be free to disagree the moment one action is versioned independently of another.
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; the version coordinate is name@version`);
  }
  // The complete class surface, frozen for all four. A symbol member is the one kind of surface
  // that never shows up in `Object.keys`, a JSON rendering or a code review that reads for names,
  // so it is the natural place for a fifth behaviour to arrive unannounced.
  for (const name of EXPORTS) {
    assert.equal(typeof m[name], "function", `${name} must be a class`);
    assert.deepEqual(Object.getOwnPropertySymbols(m[name]), [], `${name} must carry no static symbol member`);
    assert.deepEqual(
      Object.getOwnPropertySymbols(m[name].prototype), [Symbol.toStringTag],
      `${name}.prototype must carry the class-name tag and no other symbol`,
    );
    // No exported class may stand on another. A shared public base would let one of these four
    // silently inherit a validator, an equality or a rendering written for a different type.
    for (const other of EXPORTS) {
      if (other === name) continue;
      assert.notEqual(Object.getPrototypeOf(m[name]), m[other], `${name} must not extend ${other}`);
      assert.notEqual(
        Object.getPrototypeOf(m[name].prototype), m[other].prototype,
        `${name}.prototype must not inherit from ${other}.prototype`,
      );
    }
    assert.equal(Object.getPrototypeOf(m[name].prototype), Object.prototype, `${name} must stand directly on Object`);
  }
});

test("the module imports the domain identity primitives and nothing else, and Domain never imports back", async () => {
  const text = code();
  const specifiers = [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  assert.deepEqual(
    [...new Set([...specifiers, ...bare])].sort(), ["../domain/identity-primitives.mjs"],
    `${modulePath} may import exactly the domain identity primitives and nothing else`,
  );
  // Every other way a dependency can arrive, refused by name so a finding says which door opened.
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // Dependency direction, proven from the inner side too. Application may know Domain; Domain
  // learning Application would close the ring into a cycle and the onion would stop being one.
  const domainSource = await readFile(path.join(root, domainPath), "utf8");
  assert.ok(!/application/i.test(domainSource), `${domainPath} must not mention the Application ring in any form`);
  assert.ok(!/action-primitives/.test(domainSource), `${domainPath} must not import ${modulePath}`);
});

test("the module reaches no ambient capability, no clock, no randomness and no persistence vocabulary", () => {
  const text = code();
  // A value type that could read a clock, mint a random value or reach the environment would be
  // a value type whose two constructions from the same input are free to differ — and every
  // determinism assertion below would be testing a coincidence.
  for (const [label, pattern] of [
    ["process", /\bprocess\b/],
    ["fetch", /\bfetch\s*\(/],
    ["globalThis", /\bglobalThis\b/],
    ["a clock", /\bDate\b|\bperformance\b|\bhrtime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\brandomBytes\b|\bcrypto\b/],
    ["a timer", /\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b|\breaddir\b/],
    ["SQL", /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bpostgres\b|\bpsycopg\b|\bsqlalchemy\b/i],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
});

// -------------------------------------------------------------------------------------
// 4–8. Construction: the option sets, the one legal null, exact identity instances, name, version.
// -------------------------------------------------------------------------------------

test("Command and Query accept exactly their declared option sets, and only Command carries an idempotency key", () => {
  const m = mod();
  const built = new m.Command(commandOptions());
  assert.equal(built.name, NAME);
  assert.equal(built.version, VERSION);
  // The identity coordinates arrive already immutable and already validated, so they are kept by
  // reference rather than rebuilt. Re-wrapping them would re-run a Domain rule in the Application
  // ring — a second copy of a validator — and would make `command.principal === principal` false
  // for a caller that has every reason to expect the value it just handed over.
  assert.equal(built.principal, PRINCIPAL, "the exact Principal instance must be preserved by reference");
  assert.equal(built.correlationId, CORRELATION, "the exact CorrelationId instance must be preserved");
  assert.equal(built.causationId, CAUSATION, "a non-null CausationId must be preserved by reference too");
  assert.equal(built.idempotencyKey, IDEMPOTENCY, "the exact IdempotencyKey instance must be preserved");
  assert.equal(built.principal, built.principal, "and the getter must be stable across reads");

  const query = new m.Query(queryOptions());
  assert.equal(query.principal, PRINCIPAL, "a Query preserves its identity coordinates on the same terms");
  assert.equal(query.correlationId, CORRELATION);
  assert.equal(query.causationId, CAUSATION);
  assert.equal(query.idempotencyKey, undefined, "a Query is a read: it changes nothing, retries freely, and has no idempotency key to carry");
  throws(() => new m.Query({ ...queryOptions(), idempotencyKey: IDEMPOTENCY }), "a Query must refuse an idempotencyKey option outright, not ignore it");
  throws(() => new m.Query({ ...queryOptions(), tenantId: TENANT }), "a Query must refuse any unknown option, not only the one it deliberately lacks");
  throws(() => new m.Query({ ...queryOptions(), kind: "query" }), "an option named after an envelope key is still unknown");

  // Prototype membership is frozen in both directions: these members and no others.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Command.prototype).sort(),
    ["causationId", "constructor", "correlationId", "equals", "idempotencyKey", "name", "payload", "principal", "toJSON", "toString", "version"],
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Query.prototype).sort(),
    ["causationId", "constructor", "correlationId", "equals", "name", "payload", "principal", "toJSON", "toString", "version"],
  );
  for (const name of ["Command", "Query"]) {
    assert.deepEqual(Object.getOwnPropertyNames(m[name]).sort(), ["length", "name", "prototype"], `${name} must carry no static factory`);
  }
  assert.notEqual(Object.getPrototypeOf(m.Command), m.Query, "Command and Query must not share a public base");
  assert.notEqual(Object.getPrototypeOf(m.Query), m.Command, "and not in the other direction either");
  // An unknown option is refused rather than dropped: silently ignoring `tenantId` would let a
  // caller believe it had set something.
  throws(() => new m.Command(commandOptions({ tenantId: TENANT })), "an unknown option must be refused by name");
  for (const notOptions of [undefined, null, "x", 1, [], PRINCIPAL]) {
    throws(() => new m.Command(notOptions), `${inspectShort(notOptions)} is not an options object`);
  }
});

test("causationId is the one coordinate that may be null, and no coordinate may be omitted", () => {
  const m = mod();
  // A root action has no cause, so `null` is a real statement here. It is required rather than
  // defaulted because an omitted key and a deliberate `null` are different statements, and a
  // constructor that treats them alike cannot tell a decision from a typo.
  const rooted = new m.Command(commandOptions({ causationId: null }));
  assert.equal(rooted.causationId, null);
  assert.ok(rooted.idempotencyKey.equals(IDEMPOTENCY), "dropping the cause must not drop the idempotency key with it");
  assert.equal(new m.Query(queryOptions({ causationId: null })).causationId, null);

  // Everything else is required outright. An idempotency key in particular: a Command changes
  // state, so "this retry is the same act as that one" is not an optional thing to know. A
  // nullable key would make the un-deduplicated command the easiest one to write.
  for (const key of COMMAND_OPTION_KEYS) {
    if (key === NULLABLE_OPTION) continue;
    throws(() => new m.Command(commandOptions({ [key]: null })), `${key} is required and must not accept null`);
    throws(() => new m.Command(commandOptions({ [key]: undefined })), `${key} is required and must not accept undefined`);
  }
  for (const key of COMMAND_OPTION_KEYS) {
    const options = commandOptions();
    delete options[key];
    throws(() => new m.Command(options), `omitting ${key} must be refused, even where null is a legal value`);
  }
  for (const key of QUERY_OPTION_KEYS) {
    const options = queryOptions();
    delete options[key];
    throws(() => new m.Query(options), `omitting ${key} must be refused on a Query too`);
  }
});

test("the identity coordinates must be exact P-M1-01 instances, never their strings, look-alikes or subclasses", () => {
  const m = mod();
  // The whole value of a typed action is that its coordinates arrived already validated. Accepting
  // a string would move that validation here, where it would be a second copy of a rule Domain
  // already owns — and a second copy is a thing that drifts.
  //
  // Exact class, not `instanceof`: a subclass passes an instanceof gate while carrying whatever
  // the subclass added. Every one of the four coordinates is checked, because a rule proven on one
  // representative is a rule the other three are free to have implemented differently.
  const wrong = [
    ["principal", [
      PRINCIPAL.toJSON(), String(PRINCIPAL), TENANT, ACTOR,
      { tenantId: TENANT, actorId: ACTOR },
      { tenantId: TENANT, actorId: ACTOR, equals: () => true, toJSON: () => PRINCIPAL.toJSON() },
      new SubPrincipal(TENANT, ACTOR),
    ]],
    ["correlationId", [
      String(CORRELATION), CAUSATION, TENANT,
      { toString: () => String(CORRELATION), toJSON: () => String(CORRELATION) },
      new SubCorrelationId(String(CORRELATION)),
    ]],
    ["causationId", [
      String(CAUSATION), CORRELATION, TENANT,
      { toString: () => String(CAUSATION), toJSON: () => String(CAUSATION) },
      new SubCausationId(String(CAUSATION)),
    ]],
    ["idempotencyKey", [
      RAW_IDEMPOTENCY, IDEMPOTENCY.fingerprint, String(IDEMPOTENCY),
      { fingerprint: IDEMPOTENCY.fingerprint, toString: () => IDEMPOTENCY.fingerprint },
      new SubIdempotencyKey(RAW_IDEMPOTENCY),
    ]],
  ];
  for (const [key, values] of wrong) {
    for (const value of values) {
      throws(() => new m.Command(commandOptions({ [key]: value })), `${key} must refuse ${inspectShort(value)}`);
    }
  }
  // The Query coordinates are held to the same rule, so the read path is not the looser one.
  for (const [key, values] of wrong.filter(([key]) => key !== "idempotencyKey")) {
    for (const value of values) {
      throws(() => new m.Query(queryOptions({ [key]: value })), `a Query must refuse ${inspectShort(value)} as ${key}`);
    }
  }
  // Correlation and causation are distinct types and must not be interchangeable, however alike
  // their canonical strings look.
  throws(() => new m.Command(commandOptions({ correlationId: CAUSATION })), "a CausationId must not stand in for a CorrelationId");
  throws(() => new m.Command(commandOptions({ causationId: CORRELATION })), "a CorrelationId must not stand in for a CausationId");
});

test("a name is a dotted lowercase identifier of at most 128 characters", () => {
  const m = mod();
  const segment = (n) => "a".repeat(n);
  const exactly128 = `${segment(63)}.${segment(64)}`;
  assert.equal(exactly128.length, 128);
  for (const ok of [NAME, "a.b", "billing.invoice.issue.v2.retry", "order2.line3.add", exactly128]) {
    assert.equal(new m.Command(commandOptions({ name: ok })).name, ok, `${ok} is a legal action name`);
  }
  for (const bad of [
    "", ".", "..", "a", "a.", ".a", "a..b", "a.b.", "Billing.invoice", "billing.Invoice",
    "billing invoice", "billing-invoice.issue", "billing_invoice.issue", "billing/invoice",
    "1billing.invoice", "billing.1invoice", "billing..invoice", " billing.invoice",
    "billing.invoice ", "billing.invoice\n", "billing.faturä", `${exactly128}a`, `${segment(200)}.b`,
  ]) {
    throws(() => new m.Command(commandOptions({ name: bad })), `${JSON.stringify(bad)} is not a legal action name`);
  }
  for (const bad of [1, true, [], {}, Symbol("billing.invoice"), new String(NAME)]) {
    throws(() => new m.Command(commandOptions({ name: bad })), `a name must be a primitive string, not ${inspectShort(bad)}`);
  }
});

test("a version is a safe integer of at least 1, and the version coordinate is name@version", () => {
  const m = mod();
  for (const ok of [1, 2, 99, Number.MAX_SAFE_INTEGER]) {
    assert.equal(new m.Command(commandOptions({ version: ok })).version, ok);
  }
  for (const bad of [
    0, -1, -3, 1.5, 0.1, NaN, Infinity, -Infinity, "1", "v1", true,
    Number.MAX_SAFE_INTEGER + 1, 2 ** 53, 1n, [1], { version: 1 },
  ]) {
    throws(() => new m.Command(commandOptions({ version: bad })), `${inspectShort(bad)} is not a legal version`);
  }
  // Two versions of one name are two different actions, and nothing about them may collapse.
  const v1 = new m.Command(commandOptions({ version: 1 }));
  const v2 = new m.Command(commandOptions({ version: 2 }));
  assert.equal(v1.equals(v2), false, "name@1 and name@2 are different actions");
  assert.notEqual(v1.toString(), v2.toString(), "the rendering must carry the version, not only the name");
});

// -------------------------------------------------------------------------------------
// 9–13. The canonical value rule, proven identically on every surface that accepts one.
// -------------------------------------------------------------------------------------

test("a canonical value has sorted keys, is deep-cloned from its input and is deeply frozen", () => {
  for (const [label, canonicalize] of canonicalSurfaces()) {
    const input = { zeta: 1, alpha: { nested: { yankee: 1, bravo: 2 } }, mike: [{ delta: 1, charlie: 2 }] };
    const out = canonicalize(input);
    assert.deepEqual(Object.keys(out), ["alpha", "mike", "zeta"], `${label}: top-level keys must be sorted`);
    assert.deepEqual(Object.keys(out.alpha.nested), ["bravo", "yankee"], `${label}: nested keys must be sorted`);
    assert.deepEqual(Object.keys(out.mike[0]), ["charlie", "delta"], `${label}: keys inside arrays must be sorted`);
    // Array order is data, not key order, and must survive untouched.
    assert.deepEqual(canonicalize({ items: [3, 1, 2] }).items, [3, 1, 2], `${label}: array order is preserved`);

    // Cloned: a caller that keeps a reference to what it passed must not be able to reach in later.
    assert.notEqual(out, input, `${label}: the canonical value must not be the caller's object`);
    assert.notEqual(out.alpha, input.alpha, `${label}: nested containers must be cloned too`);
    input.zeta = 999;
    input.alpha.nested.bravo = 999;
    assert.equal(out.zeta, 1, `${label}: mutating the input must not reach the canonical value`);
    assert.equal(out.alpha.nested.bravo, 2, `${label}: nested mutation must not reach it either`);

    // Frozen at every level, so the value cannot be edited after it has been accepted.
    for (const node of [out, out.alpha, out.alpha.nested, out.mike, out.mike[0]]) {
      assert.ok(Object.isFrozen(node), `${label}: every container must be frozen`);
    }
    assert.throws(() => { out.zeta = 5; }, TypeError, `${label}: assignment into a frozen value must throw`);
    assert.throws(() => { out.mike.push(1); }, TypeError, `${label}: a frozen array must refuse a push`);
    // A frozen object with an Object.prototype chain is still reachable through it; the canonical
    // value carries a null prototype so nothing can be inherited into it.
    assert.equal(Object.getPrototypeOf(out), null, `${label}: a canonical object must have a null prototype`);
  }
});

test("only finite JSON numbers survive, and negative zero normalizes to zero", () => {
  for (const [label, canonicalize] of canonicalSurfaces()) {
    const out = canonicalize({ negZero: -0, zero: 0, int: 7, float: 1.5, negative: -2.25, big: Number.MAX_SAFE_INTEGER });
    // -0 and 0 are indistinguishable through JSON and through equality, but not through Object.is,
    // so a value that kept -0 would make two values that must be identical distinguishable by one
    // observer and not another. Normalising is the only answer that holds everywhere.
    assert.ok(Object.is(out.negZero, 0), `${label}: -0 must normalize to 0, got ${Object.is(out.negZero, -0) ? "-0" : String(out.negZero)}`);
    assert.ok(!Object.is(out.negZero, -0), `${label}: -0 must not survive`);
    assert.equal(out.zero, 0);
    assert.equal(out.int, 7);
    assert.equal(out.float, 1.5);
    assert.equal(out.negative, -2.25);
    assert.equal(out.big, Number.MAX_SAFE_INTEGER);
    assert.ok(Object.is(canonicalize({ v: [-0] }).v[0], 0), `${label}: -0 inside an array normalizes too`);
    for (const bad of [NaN, Infinity, -Infinity]) {
      throws(() => canonicalize({ v: bad }), `${label}: ${String(bad)} has no JSON form and must be refused`);
    }
  }
});

test("noncanonical values are refused by kind rather than coerced or dropped", () => {
  for (const [label, canonicalize] of canonicalSurfaces()) {
    for (const ok of [null, true, false, 0, "", "text", [], {}]) {
      assert.doesNotThrow(() => canonicalize({ v: ok }), `${label}: ${inspectShort(ok)} is canonical JSON`);
    }
    for (const bad of [
      undefined, Symbol("s"), 1n, () => {}, function named() {}, class C {},
      new Date(0), /re/, new Map(), new Set(), new WeakMap(), Promise.resolve(1),
      new Error("boom"), Buffer.from("x"), new Uint8Array([1]),
    ]) {
      throws(() => canonicalize({ v: bad }), `${label}: ${inspectShort(bad)} must be refused, not coerced`);
    }
    // Class instances are the sharpest case: the identity primitives define toJSON, so a
    // canonicalizer built on JSON.stringify would accept them and silently flatten a typed value
    // into a string. A payload is data; a value with behaviour is not data.
    for (const instance of [PRINCIPAL, TENANT, CORRELATION, IDEMPOTENCY]) {
      throws(() => canonicalize({ v: instance }), `${label}: a ${instance[Symbol.toStringTag]} instance must be refused inside a value`);
    }
    // A `toJSON` of one's own is the same attack spelled by hand.
    throws(() => canonicalize({ v: { toJSON: () => "flat" } }), `${label}: a toJSON hook must not be honoured`);
    // A getter would make reading the value a side-effecting operation.
    const withGetter = {};
    Object.defineProperty(withGetter, "v", { get: () => 1, enumerable: true, configurable: true });
    throws(() => canonicalize(withGetter), `${label}: an accessor property must be refused`);
    // Symbol-keyed members are data the JSON form would silently lose.
    throws(() => canonicalize({ v: 1, [Symbol("hidden")]: 2 }), `${label}: a symbol-keyed member must be refused`);

    // An ordinary object literal is the only legal container, and the rule is one rule: every
    // shape below carries data that the JSON form this value will travel as would silently drop.
    // Dropping is the failure — a value that arrives smaller than it left is worse than one that
    // was refused, because nothing anywhere records that it changed.
    const withInherited = Object.create({ inherited: 1 });
    withInherited.visible = 2;
    const withHidden = { visible: 1 };
    Object.defineProperty(withHidden, "invisible", { value: 2, enumerable: false, writable: true, configurable: true });
    for (const [why, shape] of [
      // A null-prototype input is refused rather than welcomed: the hardened form is *minted* here,
      // from an ordinary object, and accepting one ready-made would mean accepting a container this
      // module did not build and cannot vouch for.
      ["a null-prototype object", Object.create(null)],
      ["an object with a custom inherited prototype", withInherited],
      ["an object with a non-enumerable own property", withHidden],
      ["an object with inherited data", Object.create({ inherited: 1 })],
    ]) {
      throws(() => canonicalize(shape), `${label}: ${why} must be refused at the root`);
      throws(() => canonicalize({ v: shape }), `${label}: ${why} must be refused at any depth`);
      throws(() => canonicalize({ v: [shape] }), `${label}: ${why} must be refused inside an array`);
    }
    // The ordinary case stays ordinary, and what comes back is hardened rather than echoed.
    assert.doesNotThrow(() => canonicalize({ plain: { nested: [1, "two", null] } }), `${label}: an ordinary object literal is legal`);
    assert.equal(Object.getPrototypeOf(canonicalize({ plain: 1 })), null, `${label}: the canonical object is minted with a null prototype`);
    // Sparse and non-index array members are refused for the same reason.
    throws(() => canonicalize({ v: [, 1] }), `${label}: a sparse array hole must be refused`);
    const tagged = [1]; tagged.extra = 2;
    throws(() => canonicalize({ v: tagged }), `${label}: an array with a non-index property must be refused`);
  }
});

test("cycles and repeated references are refused rather than expanded", () => {
  for (const [label, canonicalize] of canonicalSurfaces()) {
    const direct = { name: "x" }; direct.self = direct;
    throws(() => canonicalize(direct), `${label}: a direct cycle must be refused, not overflow the stack`);
    const a = {}; const b = { a }; a.b = b;
    throws(() => canonicalize({ a, b }), `${label}: an indirect cycle must be refused`);
    const arrayCycle = []; arrayCycle.push(arrayCycle);
    throws(() => canonicalize({ v: arrayCycle }), `${label}: a cycle through an array must be refused`);
    // A shared reference is acyclic, so a cycle detector alone would accept it — and then one
    // input object would have become two frozen clones that no longer share anything. Refusing
    // says so, where cloning would quietly change what the caller passed.
    const shared = { k: 1 };
    throws(() => canonicalize({ left: shared, right: shared }), `${label}: a value repeated by reference must be refused`);
    const sharedArray = [1];
    throws(() => canonicalize({ v: [sharedArray, sharedArray] }), `${label}: a repeated array reference must be refused`);
    // Two structurally equal but distinct objects are not a repeat and stay legal.
    assert.doesNotThrow(() => canonicalize({ left: { k: 1 }, right: { k: 1 } }), `${label}: equal-but-distinct values are not a repeat`);
  }
});

test("prototype-pollution keys are refused, and the canonical depth stops at sixteen", () => {
  for (const [label, canonicalize] of canonicalSurfaces()) {
    // `__proto__` as a literal key is inert on a null-prototype object, but the value does not stay
    // in this module: it is read, re-serialised and merged by consumers whose targets do inherit
    // from Object.prototype. Refusing at the boundary is the only place the rule holds for all of them.
    for (const key of ["__proto__", "constructor", "prototype"]) {
      throws(() => canonicalize({ [key]: { polluted: true } }), `${label}: ${key} must be refused as a key`);
      throws(() => canonicalize({ nested: { [key]: 1 } }), `${label}: ${key} must be refused at any depth`);
      throws(() => canonicalize({ v: [{ [key]: 1 }] }), `${label}: ${key} must be refused inside an array`);
    }
    const viaDefine = {};
    Object.defineProperty(viaDefine, "__proto__", { value: { polluted: true }, enumerable: true, writable: true, configurable: true });
    throws(() => canonicalize(viaDefine), `${label}: an own __proto__ data property must be refused however it was defined`);
    // Depth: sixteen levels of containers is the contract, and the seventeenth is refused rather
    // than truncated. A bound that silently truncated would change the value it accepted.
    assert.doesNotThrow(() => canonicalize(nest(16)), `${label}: sixteen levels must be accepted`);
    throws(() => canonicalize(nest(17)), `${label}: seventeen levels must be refused`);
    assert.doesNotThrow(() => canonicalize(nestMixed(16)), `${label}: arrays count toward depth the same way`);
    throws(() => canonicalize(nestMixed(17)), `${label}: a deep value must be refused whichever container it nests through`);
  }
});

// -------------------------------------------------------------------------------------
// 14–17. What a constructed action is: closed, discoverable, comparable, and non-leaking.
// -------------------------------------------------------------------------------------

test("a constructed action is frozen, carries no own property and exposes its coordinates as getters", () => {
  const m = mod();
  for (const [label, built] of [["Command", new m.Command(commandOptions())], ["Query", new m.Query(queryOptions())]]) {
    assert.ok(Object.isFrozen(built), `${label}: the instance must be frozen`);
    assert.deepEqual(Object.getOwnPropertyNames(built), [], `${label}: coordinates live behind getters, not as own properties`);
    assert.deepEqual(Object.getOwnPropertySymbols(built), [], `${label}: no symbol-keyed own member either`);
    assert.equal(built[Symbol.toStringTag], label, `${label}: must tag itself with its own class name`);
    assert.throws(() => { built.name = "other.name"; }, TypeError, `${label}: assignment must throw`);
    // The payload getter must hand back the same frozen value every time. Returning a fresh clone
    // per read would make two reads of one action distinguishable by reference.
    assert.equal(built.payload, built.payload, `${label}: the payload getter must be stable by reference`);
    assert.ok(Object.isFrozen(built.payload), `${label}: the payload handed out must be frozen`);
    assert.ok(Object.isFrozen(m[label].prototype), `${label}.prototype must be frozen`);
    assert.ok(Object.isFrozen(m[label]), `${label} itself must be frozen`);
  }
});

test("the discovery envelope keeps its fixed key order, lowercase kind, and sorted payload", () => {
  const m = mod();
  const first = new m.Command(commandOptions({ payload: { zeta: 1, alpha: 2 } }));
  const second = new m.Command(commandOptions({ payload: { alpha: 2, zeta: 1 } }));
  const json = first.toJSON();
  // The envelope order is the contract. It is deliberately not alphabetical: a reader meets the
  // kind, then the action, then the actor, then the causal chain, then the data — which is the
  // order the questions are actually asked in.
  assert.deepEqual(Object.keys(json), COMMAND_JSON_KEYS, "the Command envelope must keep its fixed discovery order");
  assert.notDeepEqual(Object.keys(json), [...COMMAND_JSON_KEYS].sort(), "the envelope must not be alphabetized; only canonical values sort");
  assert.equal(json.kind, "command", "kind is lowercase: it is a wire token, not a class name");
  assert.equal(json.name, NAME);
  assert.equal(json.version, VERSION);
  assert.deepEqual(Object.keys(json.principal), PRINCIPAL_JSON_KEYS, "the principal shape is tenant first, actor second");
  assert.deepEqual(json.principal, { tenantId: String(TENANT), actorId: String(ACTOR) });
  assert.equal(json.correlationId, String(CORRELATION));
  assert.equal(json.causationId, String(CAUSATION));
  assert.equal(json.idempotencyKey, IDEMPOTENCY.fingerprint);
  assert.deepEqual(Object.keys(json.payload), ["alpha", "zeta"], "the payload is a canonical value and sorts its keys");

  const queryJson = new m.Query(queryOptions()).toJSON();
  assert.deepEqual(Object.keys(queryJson), QUERY_JSON_KEYS, "the Query envelope is the same fixed order minus the idempotency key");
  assert.equal(queryJson.kind, "query");
  assert.equal(queryJson.idempotencyKey, undefined, "a Query renders no idempotency key at all, not a null one");

  // Determinism is the whole point: two constructions from inputs that differ only in key order
  // must be byte-identical, because this rendering is what a caller would hash, log or compare.
  assert.equal(first.toString(), second.toString(), "key order in the input must not reach the rendering");
  assert.equal(first.toString(), JSON.stringify(first.toJSON()), "toString is the JSON rendering and nothing else");
  assert.equal(first.toString(), first.toString(), "repeated renderings must be identical");
  assert.equal(JSON.stringify(first), first.toString(), "JSON.stringify must route through the same envelope");
  // An explicit null cause survives the rendering rather than vanishing from it: "this action had
  // no cause" and "this rendering forgot to say" must not look alike.
  const rooted = new m.Command(commandOptions({ causationId: null })).toJSON();
  assert.deepEqual(Object.keys(rooted), COMMAND_JSON_KEYS, "a rooted action keeps every envelope key");
  assert.equal(rooted.causationId, null);
});

test("equals is exact-class and structural, and a Command never equals a Query", () => {
  const m = mod();
  const a = new m.Command(commandOptions());
  const b = new m.Command(commandOptions({ payload: { currency: "EUR", amount: 100 } }));
  assert.ok(a.equals(b), "two Commands built from the same coordinates are equal whatever the key order");
  assert.ok(b.equals(a), "equality is symmetric");
  assert.ok(a.equals(a), "equality is reflexive");
  for (const [key, value] of [
    ["name", "billing.invoice.void"], ["version", 9], ["principal", OTHER_PRINCIPAL],
    ["correlationId", new CorrelationId("6ba7b811-9dad-11d1-80b4-00c04fd430c8")],
    ["causationId", null], ["idempotencyKey", OTHER_IDEMPOTENCY],
    ["payload", { amount: 101, currency: "EUR" }],
  ]) {
    assert.equal(a.equals(new m.Command(commandOptions({ [key]: value }))), false, `a difference in ${key} must break equality`);
  }
  // A Command and a Query are different kinds of act — one changes state, one does not — so they
  // never compare equal however identical their shared coordinates are.
  const query = new m.Query(queryOptions());
  assert.equal(a.equals(query), false, "a Command must never equal a Query");
  assert.equal(query.equals(a), false, "and not in the other direction either");
  assert.notEqual(a.toString(), query.toString(), "their renderings differ by kind before anything else");
  // Exact class in both directions. One direction is not enough: a check written as
  // `other instanceof Command` answers true for a subclass and false for the base, so a suite that
  // only ever asks the base would pass while the two disagreed about whether they were equal.
  class SubCommand extends m.Command {}
  class SubQuery extends m.Query {}
  const subCommand = new SubCommand(commandOptions());
  const subQuery = new SubQuery(queryOptions());
  assert.equal(a.equals(subCommand), false, "a subclass instance is not a Command for this purpose");
  assert.equal(subCommand.equals(a), false, "and the subclass must not consider itself equal to the base either");
  assert.equal(query.equals(subQuery), false, "the same rule holds for a Query");
  assert.equal(subQuery.equals(query), false, "in both directions");
  // An object that merely inherits the prototype is not an instance either, and asking must not
  // throw: `equals` answers a question about a foreign value, it does not assume one.
  assert.equal(a.equals(Object.create(m.Command.prototype)), false, "inheriting Command.prototype does not make a Command");
  // Foreign values are refused without throwing — `equals` answers a question, it does not guard.
  for (const foreign of [null, undefined, 0, "", NAME, true, Symbol("x"), {}, [], PRINCIPAL, a.toJSON()]) {
    assert.equal(a.equals(foreign), false, `equals must answer false for ${inspectShort(foreign)}`);
  }
});

test("no surface of a Command can yield the raw idempotency input back", () => {
  const m = mod();
  // A distinctive marker, so a leak is unmistakable wherever it surfaces. The raw string is a
  // caller secret — it routinely carries an order reference or a customer token. Domain hashes it
  // on the way in; this asserts Application never puts it back.
  const raw = "MARKER-4c71-raw-idempotency-input";
  const key = new IdempotencyKey(raw);
  const built = new m.Command(commandOptions({ idempotencyKey: key }));
  const surfaces = [
    ["own keys", JSON.stringify(Object.keys(built))],
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(built))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(built))],
    ["JSON", JSON.stringify(built)],
    ["toJSON", JSON.stringify(built.toJSON())],
    ["String", String(built)],
    ["inspect", inspect(built, { showHidden: true, depth: null, getters: true })],
    ["every getter on the chain", chain(built).flatMap((proto) =>
      Object.entries(Object.getOwnPropertyDescriptors(proto))
        .filter(([, d]) => typeof d.get === "function")
        .map(([name, d]) => {
          // A getter that throws is still a surface: its message is read by whatever logged it.
          try { return `${name}=${inspect(d.get.call(built), { depth: null })}`; } catch (error) { return `${name}!${String(error?.message)}`; }
        })).join("|")],
  ];
  for (const [label, rendered] of surfaces) {
    assert.ok(!rendered.includes(raw), `the raw input leaked through ${label}: ${rendered}`);
  }
  // The fingerprint is visible exactly where the contract renders it, and nowhere a reader would
  // reach expecting an opaque instance.
  for (const [label, rendered] of [["toString", String(built)], ["JSON", JSON.stringify(built)], ["toJSON", JSON.stringify(built.toJSON())]]) {
    assert.ok(rendered.includes(key.fingerprint), `${label} must carry the fingerprint in place of the raw input`);
  }
  for (const [label, rendered] of surfaces.slice(0, 3)) {
    assert.ok(!rendered.includes(key.fingerprint), `${label} must expose nothing at all: the coordinates live behind getters`);
  }
  assert.equal(built.toJSON().idempotencyKey, key.fingerprint, "the envelope carries the fingerprint");
  // The rejection path must not echo it either — an error message is a surface like any other.
  assert.throws(() => new m.Command(commandOptions({ idempotencyKey: raw })), (error) => {
    assert.ok(!String(error.message).includes(raw), `the rejection message echoed the raw input: ${error.message}`);
    return true;
  });
});

// -------------------------------------------------------------------------------------
// 18–20. KernelError and Result.
// -------------------------------------------------------------------------------------

test("KernelError takes exactly code, details and cause, with explicit nulls and an uppercase code", () => {
  const m = mod();
  const built = new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: { invoice: "7731" }, cause: null });
  assert.equal(built.code, "INVOICE_ALREADY_ISSUED");
  assert.deepEqual({ ...built.details }, { invoice: "7731" });
  assert.equal(built.cause, null);
  assert.ok(Object.isFrozen(built.details), "details are a canonical value and are frozen like one");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.KernelError.prototype).sort(),
    ["cause", "code", "constructor", "details", "equals", "toJSON", "toString"],
  );
  assert.deepEqual(Object.getOwnPropertyNames(m.KernelError).sort(), ["length", "name", "prototype"], "KernelError must carry no static factory");
  for (const key of ERROR_JSON_KEYS) {
    const options = { code: "X_Y", details: null, cause: null };
    delete options[key];
    throws(() => new m.KernelError(options), `omitting ${key} must be refused; null is the explicit spelling`);
  }
  throws(() => new m.KernelError({ code: "X_Y", details: null, cause: null, message: "boom" }), "an unknown option must be refused");
  for (const notOptions of [undefined, null, "X_Y", 1, []]) throws(() => new m.KernelError(notOptions), `${inspectShort(notOptions)} is not an options object`);
  // The code is the machine-readable identity of a failure, so it is bounded and shouted.
  const exactly64 = `A${"_B".repeat(31)}A`;
  assert.equal(exactly64.length, 64);
  for (const ok of ["X", "X_Y", "INVOICE_ALREADY_ISSUED", "HTTP_409", "E2_BIG", exactly64]) {
    assert.equal(new m.KernelError({ code: ok, details: null, cause: null }).code, ok, `${ok} is a legal code`);
  }
  for (const bad of [
    "", "_", "_X", "X_", "X__Y", "x_y", "X_y", "X-Y", "X.Y", "X Y", "9X", "X$Y", "Ä_B",
    `${exactly64}A`, 1, null, undefined, true, ["X"], Symbol("X"),
  ]) {
    throws(() => new m.KernelError({ code: bad, details: null, cause: null }), `${inspectShort(bad)} is not a legal code`);
  }
  // Details obey the full canonical rule — proven row by row in the canonical-surface table above —
  // and are additionally restricted to an object or null. A scalar detail carries no name for what
  // it is, and a reader would have to guess from the code what the bare value meant.
  for (const bad of ["text", 1, true, [], [{ k: 1 }]]) {
    throws(() => new m.KernelError({ code: "X_Y", details: bad, cause: null }), `details must be an object or null, not ${inspectShort(bad)}`);
  }
  assert.equal(new m.KernelError({ code: "X_Y", details: null, cause: null }).details, null, "null details are the explicit absence");
});

test("KernelError carries no message, no stack and no native Error, and its cause chain stops at eight", () => {
  const m = mod();
  const built = new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null });
  // A message is prose written for one audience, and it is where untranslatable, unversioned and
  // occasionally secret text ends up. The code is the contract; a caller that wants a sentence
  // renders one from the code in the ring that knows who is reading.
  assert.equal(built.message, undefined, "a KernelError must carry no message");
  assert.equal(built.stack, undefined, "a stack is a snapshot of one process and is not part of a value");
  assert.ok(!(built instanceof Error), "a KernelError must not extend the native Error");
  assert.notEqual(Object.getPrototypeOf(m.KernelError), Error, "KernelError must not subclass Error");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "no own property, so nothing to read around the getters");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.ok(Object.isFrozen(built) && Object.isFrozen(m.KernelError.prototype) && Object.isFrozen(m.KernelError));
  assert.equal(built[Symbol.toStringTag], "KernelError");

  // Fixed envelope order here too: what failed, what it was about, what it came from.
  const withCause = new m.KernelError({ code: "OUTER", details: { at: "line" }, cause: built });
  // The cause is already an immutable KernelError, so it is kept by reference like the identity
  // coordinates of an action. Cloning it would break `error.cause === theErrorIJustCaught` for a
  // caller holding the very value it passed in.
  assert.equal(withCause.cause, built, "the exact KernelError instance must be preserved as the cause");
  assert.equal(withCause.cause, withCause.cause, "and the getter must be stable across reads");
  assert.deepEqual(Object.keys(withCause.toJSON()), ERROR_JSON_KEYS, "the error envelope is code, details, cause");
  assert.deepEqual(Object.keys(withCause.toJSON().cause), ERROR_JSON_KEYS, "a nested cause keeps the same order");
  assert.equal(withCause.toJSON().cause.code, "INVOICE_ALREADY_ISSUED");
  assert.equal(withCause.toString(), JSON.stringify(withCause.toJSON()), "toString is the JSON rendering and nothing else");

  // Deterministic equality, exact-class, with the unequal cases stated rather than assumed.
  const twin = new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null });
  assert.ok(built.equals(twin) && twin.equals(built), "same code, details and cause means equal");
  assert.equal(built.toString(), twin.toString(), "and byte-identical renderings");
  for (const [label, other] of [
    ["a different code", new m.KernelError({ code: "OTHER_CODE", details: null, cause: null })],
    ["different details", new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: { a: 1 }, cause: null })],
    ["a different cause", new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: twin })],
  ]) {
    assert.equal(built.equals(other), false, `${label} must break equality`);
    assert.notEqual(built.toString(), other.toString(), `${label} must change the rendering too`);
  }
  class SubKernelError extends m.KernelError {}
  const subError = new SubKernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null });
  assert.equal(built.equals(subError), false, "a subclass instance is not a KernelError for this purpose");
  assert.equal(subError.equals(built), false, "and the subclass must not consider itself equal to the base either");
  assert.equal(built.equals(Object.create(m.KernelError.prototype)), false, "inheriting KernelError.prototype does not make a KernelError");
  for (const foreign of [null, undefined, "INVOICE_ALREADY_ISSUED", new Error("boom"), built.toJSON()]) {
    assert.equal(built.equals(foreign), false, `equals must answer false for ${inspectShort(foreign)}`);
  }

  // A cause is an exact KernelError or null. A native Error would drag a stack and a message in
  // through the one door the type just closed; a subclass would drag in whatever it added.
  for (const bad of [new Error("boom"), "CAUSE", { code: "X_Y" }, undefined, built.toJSON()]) {
    throws(() => new m.KernelError({ code: "X_Y", details: null, cause: bad }), `${inspectShort(bad)} is not a legal cause`);
  }
  throws(() => new m.KernelError({ code: "X_Y", details: null, cause: subError }), "a subclass of KernelError is not a legal cause");
  assert.doesNotThrow(() => errorChain(8), "a chain of eight is the contract");
  throws(() => errorChain(9), "a ninth link must be refused rather than truncated");
  assert.equal(errorChain(8).cause.cause.cause.cause.cause.cause.cause.cause, null, "the eighth link ends the chain");
});

test("Result offers only ok and failure, is deterministic on both branches, and throws on the wrong branch", () => {
  const m = mod();
  const ok = m.Result.ok({ invoice: "7731" });
  const error = new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null });
  const failure = m.Result.failure(error);
  assert.equal(ok.isOk, true);
  assert.equal(failure.isOk, false);
  assert.deepEqual({ ...ok.value }, { invoice: "7731" });
  // The error is already an immutable KernelError and is kept by reference; the value is data and
  // is cloned. The asymmetry is the rule: what arrived closed stays the same object, what arrived
  // open is hardened into a new one.
  assert.equal(failure.error, error, "the exact KernelError instance must be preserved by Result.failure");
  assert.equal(failure.error, failure.error, "and the getter must be stable across reads");
  assert.notEqual(m.Result.ok({ invoice: "7731" }).value, ok.value, "an ok value is cloned, never shared between Results");
  // One question, asked one way. A second predicate spelling the negation would be a second thing
  // to keep true, and the first caller to read `isFailure` on a value that answered both would
  // never learn which one was authoritative.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Result.prototype).sort(),
    ["constructor", "equals", "error", "isOk", "toJSON", "toString", "value"],
  );
  assert.deepEqual(Object.getOwnPropertySymbols(m.Result.prototype), [Symbol.toStringTag]);
  assert.equal(m.Result.prototype.isFailure, undefined, "isOk is the single predicate; isFailure would be a second answer to one question");
  assert.equal(ok[Symbol.toStringTag], "Result");
  // Reading the branch that is not there throws rather than answering undefined. An undefined is
  // a value a caller can carry three frames before noticing; a throw is noticed here.
  throws(() => ok.error, "reading the error of an ok Result must throw");
  throws(() => failure.value, "reading the value of a failed Result must throw");

  // Exactly two ways in, and no way in by hand: a directly constructed Result could be neither
  // branch, or both, and every getter above would then be answering about nothing.
  assert.deepEqual(Object.getOwnPropertyNames(m.Result).sort(), ["failure", "length", "name", "ok", "prototype"]);
  throws(() => new m.Result({ value: 1 }), "public construction must be refused");
  throws(() => new m.Result(), "public construction must be refused with no argument too");
  // A subclass is the remaining way in, and it must be closed the same way. No Result subclass
  // instance can exist, so subclass equality is asked of the one impostor that can be built: an
  // object inheriting the prototype. Asking must answer false rather than throw.
  class SubResult extends m.Result {}
  throws(() => new SubResult({ ok: true, value: 1 }), "a Result subclass must not be publicly constructible either");
  assert.equal(Object.getPrototypeOf(ok), m.Result.prototype, "Result.ok mints an exact Result");
  assert.equal(Object.getPrototypeOf(failure), m.Result.prototype, "Result.failure mints an exact Result");
  // Written as `new this(...)`, the factories would hand a subclass the key to the door the
  // constructor just locked. Reached through a subclass they must still mint an exact Result.
  assert.equal(Object.getPrototypeOf(SubResult.ok({ k: 1 })), m.Result.prototype, "the ok factory must mint an exact Result even through a subclass");
  assert.equal(Object.getPrototypeOf(SubResult.failure(error)), m.Result.prototype, "and so must the failure factory");
  const impostor = Object.create(m.Result.prototype);
  assert.equal(ok.equals(impostor), false, "inheriting Result.prototype does not make a Result");
  assert.equal(failure.equals(impostor), false, "on the failed branch too");
  // A failure carries an exact KernelError and nothing else — not a native Error, not a subclass,
  // not the JSON shape of one.
  class SubKernelError extends m.KernelError {}
  for (const bad of [new Error("boom"), null, undefined, "INVOICE_ALREADY_ISSUED", { code: "X_Y" }, error.toJSON(), new SubKernelError({ code: "X_Y", details: null, cause: null })]) {
    throws(() => m.Result.failure(bad), `${inspectShort(bad)} is not a legal failure`);
  }
  // A Result value is a canonical value, and a scalar or null is a complete answer on its own:
  // a use-case that computed a count has nothing to wrap it in.
  for (const value of [null, 0, -0, 1.5, "", "text", true, false, [], {}, [1, 2]]) {
    assert.doesNotThrow(() => m.Result.ok(value), `${inspectShort(value)} is a canonical Result value`);
  }
  assert.equal(m.Result.ok(null).value, null, "null is a value, not an absence");
  assert.ok(Object.is(m.Result.ok(-0).value, 0), "a scalar value normalizes like any canonical number");
  for (const bad of [undefined, NaN, Infinity, new Date(0), PRINCIPAL, Symbol("s"), 1n, () => {}]) {
    throws(() => m.Result.ok(bad), `${inspectShort(bad)} is not a canonical Result value`);
  }

  // Fixed envelope per branch: the discriminator first, then exactly the branch that exists.
  assert.deepEqual(Object.keys(ok.toJSON()), ["ok", "value"], "an ok Result renders ok then value");
  assert.deepEqual(Object.keys(failure.toJSON()), ["ok", "error"], "a failed Result renders ok then error");
  assert.equal(ok.toJSON().ok, true);
  assert.equal(failure.toJSON().ok, false);
  assert.equal(ok.toJSON().error, undefined, "an ok Result renders no error key at all");
  assert.equal(failure.toJSON().value, undefined, "a failed Result renders no value key at all");
  assert.deepEqual(Object.keys(failure.toJSON().error), ERROR_JSON_KEYS, "the nested error keeps its own envelope order");
  for (const branch of [ok, failure]) {
    assert.equal(branch.toString(), JSON.stringify(branch.toJSON()), "toString is the JSON rendering and nothing else");
    assert.equal(branch.toString(), branch.toString(), "repeated renderings must be identical");
    assert.ok(Object.isFrozen(branch), "a Result is frozen");
    assert.deepEqual(Object.getOwnPropertyNames(branch), [], "the branches live behind getters");
    assert.deepEqual(Object.getOwnPropertySymbols(branch), [], "and carry no symbol-keyed own member");
    assert.equal(branch[Symbol.toStringTag], "Result", "both branches tag themselves the same way: the branch is state, not type");
  }
  assert.equal(m.Result.ok({ b: 1, a: 2 }).toString(), m.Result.ok({ a: 2, b: 1 }).toString(), "input key order must not reach the rendering");
  assert.notEqual(ok.toString(), failure.toString(), "the two branches never render alike");

  // Exact-class, structural equality on both branches, with the unequal cases stated.
  assert.ok(m.Result.ok({ invoice: "7731" }).equals(ok), "two ok Results over equal values are equal");
  assert.ok(m.Result.failure(new m.KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null })).equals(failure), "two failures over equal errors are equal");
  assert.equal(ok.equals(failure), false, "an ok Result never equals a failed one");
  assert.equal(failure.equals(ok), false, "and not in the other direction either");
  assert.equal(ok.equals(m.Result.ok({ invoice: "7732" })), false, "a different value breaks equality");
  assert.equal(failure.equals(m.Result.failure(new m.KernelError({ code: "OTHER_CODE", details: null, cause: null }))), false, "a different error breaks equality");
  assert.equal(m.Result.ok(0).equals(m.Result.ok(false)), false, "0 and false are different values");
  assert.equal(m.Result.ok(null).equals(m.Result.ok(0)), false, "null and 0 are different values");
  for (const foreign of [null, undefined, 0, "", true, {}, [], error, ok.toJSON()]) {
    assert.equal(ok.equals(foreign), false, `equals must answer false for ${inspectShort(foreign)}`);
  }

  // No combinators. They are how a result type grows a control-flow vocabulary, and control flow
  // belongs to the use-case that has not been authorized yet.
  for (const combinator of [
    "map", "mapErr", "mapError", "flatMap", "andThen", "chain", "then", "fold", "match",
    "unwrap", "unwrapOr", "unwrapOrElse", "orElse", "getOrElse", "recover", "tap", "bimap", "ap",
  ]) {
    assert.equal(m.Result.prototype[combinator], undefined, `Result must carry no ${combinator} combinator`);
  }
  assert.ok(Object.isFrozen(m.Result.prototype) && Object.isFrozen(m.Result));
});

/** A short, safe rendering for assertion messages — never used to build an expected value. */
function inspectShort(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `function ${value.name || "anonymous"}`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return JSON.stringify(value);
}
