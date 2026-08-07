import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ActorId, CausationId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { Command, KernelError, Result } from "../src/application/action-primitives.mjs";
import { UseCase } from "../src/application/use-case.mjs";

// =====================================================================================
// P-M1-04 — the UnitOfWork port, frozen as a public surface
//
// This is the whole observable surface of src/application/unit-of-work.mjs: one exported class
// that takes three collaborator functions and guarantees the order they are called in, the value
// each of them sees, and what happens to the caller when any one of them fails. It is written
// before the module exists, so every assertion here is a requirement rather than a description of
// something already built.
//
// The scope is the port and nothing beyond it. A port says what a boundary must do; it is not
// evidence that anything has been built behind one. Nothing here may be read as a claim that a
// transactional boundary exists, that a database has been reached, or that the kernel is ready.
//
// The Application ring owns this type, and it owns it alone: this module imports nothing at all,
// not even from its own ring. That is the point of a port — it is the shape a later adapter must
// satisfy, so it may not know a single thing about who satisfies it. The composition below proves
// the same fact from the other side: a real UseCase over a real Command producing a real Result
// runs *inside* the body, without this module knowing that any of those three types exist.
//
// What is deliberately *not* here, and must not appear:
//
//   - no idempotency, no cache, no Result validation, no repositories, no savepoints, no retry,
//     no isolation level — every one of those is a policy about *how* a boundary behaves, and this
//     port only says *when* its three functions are called;
//   - no database, no connection, no pool, no SQL, no outbox, no audit, no clock;
//   - no policy, no identity, no validation boundary, no composition root, no adapter, no schema,
//     no SDK, no app, no release work.
//
// One residual is explicit rather than hidden. When the body fails and the rollback fails too, the
// body's failure is what propagates and the rollback's failure is dropped on the floor here. That
// is deliberate: the caller's error handling was written against what its own body threw, and
// replacing that with a collaborator's failure would destroy the one piece of evidence it has. The
// dropped rollback failure is a real loss of information, and observing it is delegated to the
// later adapter that actually owns a boundary — it is not this port's to invent, and this comment
// is where that debt is recorded rather than forgotten.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module must
// fail every test by name rather than collapsing the file into a single load error, since twelve
// named failures are the RED specification and one load error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/unit-of-work.mjs";
const useCasePath = "src/application/use-case.mjs";
const actionPath = "src/application/action-primitives.mjs";
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
 * A source with comments removed, so a token scan reads what a module *does*.
 *
 * Line-based on purpose: a module may explain in prose why it never reaches a database, and a scan
 * that could not tell the explanation from the deed would forbid the explanation. It matters twice
 * over here, because the reverse-direction check below reads three modules whose comments
 * legitimately name this one while their code must not.
 */
function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      return line.split("//")[0];
    })
    .join("\n");
}

const code = () => stripComments(source());

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

const throws = (fn, label) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);

/** The sentinel that separates "resolved" from "rejected with undefined". */
const NO_REJECTION = Symbol("no rejection");

async function rejectionOf(promise) {
  try {
    await promise;
    return NO_REJECTION;
  } catch (error) {
    return error;
  }
}

/**
 * Call `run` and require the refusal to arrive as a rejection.
 *
 * `run` always returns a Promise, so a synchronous throw is a contract breach even when the thrown
 * value is the right one: a caller that wrote `unitOfWork.run(body).catch(...)` would never reach
 * its handler. The two facts are asserted separately so a failure says which one broke.
 */
async function assertRejectsTypeError(call, label) {
  let promise;
  assert.doesNotThrow(() => { promise = call(); }, `${label}: run must never throw synchronously; it always returns a Promise`);
  assert.ok(promise instanceof Promise, `${label}: run must return a Promise`);
  const error = await rejectionOf(promise);
  assert.notEqual(error, NO_REJECTION, `${label}: must reject rather than resolve`);
  assert.ok(error instanceof TypeError, `${label}: must reject with a TypeError, got ${inspectShort(error)}`);
}

// -------------------------------------------------------------------------------------
// Fixtures.
// -------------------------------------------------------------------------------------

/** The three port keys, in no particular order — an options object has no reading order. */
const PORT_KEYS = ["begin", "commit", "rollback"];

/** The opaque scope. Nothing here may be read, rendered or stored; it is a token, not a value. */
const SCOPE = Object.freeze({ marker: "MARKER_scope_2ad4" });

const OK = Result.ok({ invoice: "7731" });

const ports = (overrides = {}) => ({
  begin: () => SCOPE,
  commit: () => undefined,
  rollback: () => undefined,
  ...overrides,
});

/** A unit of work built through the module under test. Every caller reaches the guard through mod(). */
const build = (overrides = {}) => new (mod().UnitOfWork)(ports(overrides));

/** Resolve after a few microtask turns, so "was this awaited" is a question with a real answer. */
async function settledLater(value) {
  for (let tick = 0; tick < 3; tick += 1) await null;
  return value;
}

/**
 * A call recorder over plain, named functions.
 *
 * Never arrows: an arrow closes over this file's `this` and could never observe what the contract
 * actually passed, which is one of the facts under test.
 */
function recorder() {
  const calls = [];
  const make = (label, behaviour) => ({
    [label]: function recorded(...args) {
      calls.push({ label, self: this, args, count: args.length });
      return behaviour === undefined ? undefined : behaviour(...args);
    },
  }[label]);
  return {
    calls,
    make,
    order: () => calls.map((call) => call.label),
    countOf: (label) => calls.filter((call) => call.label === label).length,
    firstOf: (label) => calls.find((call) => call.label === label),
  };
}

/** Real P-M1-01 identities and a real P-M1-02 command, for the composition the port never sees. */
const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-billing-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const CAUSATION = new CausationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const IDEMPOTENCY = new IdempotencyKey("order-7731-retry-2");

const NAME = "billing.invoice.issue";
const VERSION = 3;

const commandOf = () => new Command({
  name: NAME,
  version: VERSION,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: CAUSATION,
  idempotencyKey: IDEMPOTENCY,
  payload: { amount: 100, currency: "EUR" },
});

// -------------------------------------------------------------------------------------
// 1–3. The module surface, the imports it does not have, and the vocabulary it never carries.
// -------------------------------------------------------------------------------------

test("the module exports exactly UnitOfWork, and no later-package surface stands beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["UnitOfWork"], "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  assert.equal(typeof m.UnitOfWork, "function", "UnitOfWork must be a class");
  // Each absent name is a whole concern this package must not have started. They are listed rather
  // than summarised because the failure they guard against is one of them appearing alone, quietly,
  // as "just a small helper" beside the port.
  for (const absent of [
    "Transaction", "TransactionManager", "Savepoint", "Isolation", "IsolationLevel", "Retry",
    "Repository", "RepositoryPort", "OutboxPort", "AuditPort", "PolicyPort", "IdentityPort",
    "Clock", "ClockPort", "Cache", "IdempotencyStore", "Database", "Connection", "Pool",
    "ValidationBoundary", "Validator", "validate", "CompositionRoot", "container", "configure",
    "register", "resolve", "Adapter", "Schema", "Sdk",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the UnitOfWork port`);
  }
  // Re-exporting the ring's existing types would give the kernel two front doors to one contract,
  // and the second would be free to drift the day either module is versioned. This module cannot
  // even reach them — it imports nothing — so an appearance here would be a hand-rolled copy.
  for (const borrowed of ["UseCase", "Command", "Query", "Result", "KernelError", "Principal", "TenantId"]) {
    assert.equal(m[borrowed], undefined, `${borrowed} is owned elsewhere and must not stand in this module's export set`);
  }
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; a port carries no version of its own`);
  }
  assert.deepEqual(Object.getOwnPropertySymbols(m.UnitOfWork), [], "UnitOfWork must carry no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.UnitOfWork.prototype), [Symbol.toStringTag],
    "UnitOfWork.prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.UnitOfWork.prototype), Object.prototype, "UnitOfWork must stand directly on Object");
  assert.ok(!(m.UnitOfWork.prototype instanceof Error), "a UnitOfWork is not an error type");
});

test("the module imports nothing at all, and no inner module imports it back", async () => {
  const text = code();
  // The empty import set is the port's defining property, not an accident of it being small. A
  // port that knew one concrete type would be a contract about that type, and the adapter that
  // arrives later would be satisfying something narrower than a boundary.
  const specifiers = [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  assert.deepEqual(
    [...new Set([...specifiers, ...bare])], [],
    `${modulePath} must import nothing: a port that names a collaborator is no longer a port`,
  );
  assert.ok(!/(?:^|\n)\s*import\s/.test(text), `${modulePath} must carry no import statement of any form`);
  // Every other way a dependency can arrive, refused by name so a finding says which door opened.
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["its own ring", /action-primitives|use-case/],
    ["the domain ring", /identity-primitives/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
  // Dependency direction, proven from the other side too. Nothing already in the kernel may learn
  // about this module: a port is depended *on*, and the day an inner module imported it the arrow
  // would point outward and the onion would stop being one. All three are read comment-stripped,
  // because a comment naming this port is documentation and a code reference is a dependency.
  for (const inner of [domainPath, actionPath, useCasePath]) {
    const innerCode = stripComments(await readFile(path.join(root, inner), "utf8"));
    assert.ok(!/unit-of-work/.test(innerCode), `${inner} must not import ${modulePath}`);
    assert.ok(!/\bUnitOfWork\b/.test(innerCode), `${inner} must not name UnitOfWork in code`);
  }
  // And the import sets beneath stay exactly as their own packages froze them; this package widens
  // nothing under itself in order to make room for a port.
  const importsOf = (text2) =>
    [...new Set([...text2.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m2) => m2[1]))].sort();
  assert.deepEqual(importsOf(stripComments(await readFile(path.join(root, domainPath), "utf8"))), ["node:crypto"], `${domainPath} keeps the import set P-M1-01 froze`);
  assert.deepEqual(importsOf(stripComments(await readFile(path.join(root, actionPath), "utf8"))), ["../domain/identity-primitives.mjs"], `${actionPath} keeps the import set P-M1-02 froze`);
  assert.deepEqual(importsOf(stripComments(await readFile(path.join(root, useCasePath), "utf8"))), ["./action-primitives.mjs"], `${useCasePath} keeps the import set P-M1-03 froze`);
});

test("the module reaches no ambient capability, no database, and carries none of the frozen non-goal vocabulary", () => {
  const text = code();
  // A port whose behaviour could depend on a clock, a random value or the environment is a port
  // whose two runs over the same body are free to differ — and every ordering assertion below would
  // then be testing a coincidence.
  for (const [label, pattern] of [
    ["process", /\bprocess\b/],
    ["fetch", /\bfetch\s*\(/],
    ["globalThis", /\bglobalThis\b/],
    ["a clock", /\bDate\b|\bperformance\b|\bhrtime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\brandomBytes\b|\bcrypto\b/],
    ["a timer", /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b|\breaddir\b/],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // The database this port deliberately knows nothing about. `begin`, `commit` and `rollback` are
  // the three words a boundary is made of; every word below is the boundary's *implementation*
  // leaking into the shape that was supposed to outlive it.
  for (const [label, pattern] of [
    ["SQL", /\bSELECT\b|\bINSERT\b|\bDELETE\s+FROM\b|\bsql\b/i],
    ["a database", /\bdatabase\b|\bpostgres|\bpsycopg\b|\bsqlalchemy\b|\bsqlite\b/i],
    ["a connection", /\bconnection\b|\bpool\b|\bcursor\b|\bdriver\b/i],
    ["a savepoint", /\bsavepoint\b|\bnested\s*transaction\b/i],
    ["an isolation level", /\bisolation\b|\bserializable\b|\bread\s*committed\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not name ${label}`);
  }
  // The frozen non-goals, scanned in code rather than only asserted as absent exports. A private
  // retry loop is still a retry, and it would never show up in the export set.
  for (const [label, pattern] of [
    ["idempotency", /\bidempoten/i],
    ["a cache", /\bcache\b|\bmemo/i],
    ["a repository", /\brepositor/i],
    ["a retry", /\bretry\b|\battempts\b|\bbackoff\b/i],
    ["an outbox", /\boutbox\b/i],
    ["an audit trail", /\baudit\b/i],
    ["a clock port", /\bclock\b/i],
    ["a policy", /\bpolicy\b|\bpdp\b/i],
    ["a validation boundary", /\bvalidationBoundary\b/i],
    ["a composition root", /\bcompositionRoot\b|\bcontainer\b/i],
    ["a registry", /\bregistry\b|\bdispatcher\b/i],
    ["an adapter", /\badapter\b/i],
    ["a schema", /\bschema\b/i],
    ["an SDK", /\bsdk\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not carry ${label}`);
  }
  // The types it has no import for, and must therefore not name either. A hand-rolled reference to
  // one of these would be this module quietly growing an opinion about what a body may return.
  for (const borrowed of ["Result", "KernelError", "UseCase", "Command", "Query", "Principal", "TenantId"]) {
    assert.ok(
      !new RegExp(`\\b${borrowed}\\b`).test(text),
      `${modulePath} must not name ${borrowed}: a port validates no value it was handed`,
    );
  }
});

// -------------------------------------------------------------------------------------
// 4–5. Construction, and what a constructed unit of work is.
// -------------------------------------------------------------------------------------

test("the constructor takes exactly begin, commit and rollback, all required and all functions", () => {
  const m = mod();
  assert.ok(build() instanceof m.UnitOfWork, "the three-function port must construct");
  assert.equal(m.UnitOfWork.length, 1, "the constructor takes one port object, not three positional arguments");
  // A missing key is refused rather than defaulted: a unit of work that supplied its own no-op
  // rollback would silently commit nothing and swallow nothing, and the caller would never learn
  // that half its boundary was never wired. An unknown key is refused rather than dropped, because
  // silently ignoring one lets a caller believe it configured something.
  for (const key of PORT_KEYS) {
    const options = ports();
    delete options[key];
    throws(() => new m.UnitOfWork(options), `omitting ${key} must be refused`);
    throws(() => new m.UnitOfWork(ports({ [key]: undefined })), `${key} is required and must not accept undefined`);
    throws(() => new m.UnitOfWork(ports({ [key]: null })), `${key} is required and must not accept null`);
    for (const bad of [
      "begin", 1, 0, true, false, [], {}, Symbol(key), { call: () => undefined },
      { [key]: () => undefined }, OK, SCOPE,
    ]) {
      throws(() => new m.UnitOfWork(ports({ [key]: bad })), `${key} as ${inspectShort(bad)} is not a function`);
    }
    // Every flavour of function stays admissible. Refusing one would be a rule about how a caller
    // spelled its collaborator, which is not this port's business.
    for (const ok of [() => undefined, function named() {}, async () => undefined, class Boundary {}]) {
      assert.doesNotThrow(() => new m.UnitOfWork(ports({ [key]: ok })), `${key} as ${inspectShort(ok)} is a legal collaborator`);
    }
  }
  for (const extra of ["run", "scope", "savepoint", "retry", "isolation", "clock", "repository", "toJSON", "begins"]) {
    throws(() => new m.UnitOfWork(ports({ [extra]: () => undefined })), `an unknown port key ${extra} must be refused by name`);
  }
  throws(() => new m.UnitOfWork({ ...ports(), [Symbol("hidden")]: () => undefined }), "a symbol-keyed port member must be refused");
  for (const notOptions of [undefined, null, "begin", 1, true, [], () => undefined, PRINCIPAL, OK]) {
    throws(() => new m.UnitOfWork(notOptions), `${inspectShort(notOptions)} is not a port object`);
  }
  throws(() => new m.UnitOfWork(), "construction with no port object at all must be refused");
});

test("a constructed unit of work is frozen, own-property-free, tagged, exposes exactly run, and never hands its collaborators back", () => {
  const m = mod();
  const built = build();
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.ok(Object.isFrozen(m.UnitOfWork.prototype), "UnitOfWork.prototype must be frozen");
  assert.ok(Object.isFrozen(m.UnitOfWork), "UnitOfWork itself must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "the collaborators are private state, not own properties");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.equal(built[Symbol.toStringTag], "UnitOfWork", "the instance must tag itself with its class name");
  assert.throws(() => { built.begin = () => undefined; }, TypeError, "assignment into a frozen instance must throw");
  // The public surface, frozen in both directions: these members and no others. Every name absent
  // here is a decision — a unit of work is behaviour, not a value, so it has no equality and no
  // rendering, and a toJSON would put three live collaborators one serialisation away from a log.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.UnitOfWork.prototype).sort(),
    ["constructor", "run"],
    "UnitOfWork.prototype must carry exactly constructor and run",
  );
  for (const absent of [
    "begin", "commit", "rollback", "equals", "toJSON", "toString", "valueOf", "inspect",
    "scope", "execute", "transaction", "withScope", "of", "create", "from", "isRunning",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m.UnitOfWork.prototype, absent), false,
      `${absent} must not appear on UnitOfWork.prototype`,
    );
  }
  assert.equal(m.UnitOfWork.prototype.toString, Object.prototype.toString, "toString must not be overridden");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.UnitOfWork).sort(), ["length", "name", "prototype"],
    "UnitOfWork must carry no static factory, no registry and no lookup",
  );
  assert.equal(typeof m.UnitOfWork.prototype.run, "function", "run must be a method");
  assert.equal(m.UnitOfWork.prototype.run.length, 1, "run takes exactly one argument: the body, and no collaborator beside it");
  // No getters on the named surface. A getter is how state becomes readable by accident, and the
  // three things this instance holds are exactly the three that must never be readable.
  for (const name of Object.getOwnPropertyNames(m.UnitOfWork.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(m.UnitOfWork.prototype, name);
    assert.equal(descriptor.get, undefined, `${name} must not be a getter`);
    assert.equal(descriptor.set, undefined, `${name} must not be a setter`);
  }
  // Leak probes. A collaborator that can be reached off the instance can be called directly, and a
  // caller that can call `commit` without `begin` has walked around the only thing this port does.
  const marked = build({
    begin: function MARKER_begin_9c02() { return SCOPE; },
    commit: function MARKER_commit_9c02() {},
    rollback: function MARKER_rollback_9c02() {},
  });
  for (const key of PORT_KEYS) {
    assert.equal(marked[key], undefined, `there must be no ${key} getter on the instance`);
    assert.equal(m.UnitOfWork.prototype[key], undefined, `and none on the prototype either`);
  }
  for (const [label, rendered] of [
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(marked))],
    ["own keys", JSON.stringify(Object.keys(marked))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(marked))],
    ["prototype descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.UnitOfWork.prototype))],
    ["class descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.UnitOfWork))],
    ["JSON", JSON.stringify(marked) ?? "undefined"],
    ["the string form", String(marked)],
  ]) {
    assert.ok(!rendered.includes("MARKER_"), `a collaborator leaked through ${label}: ${rendered}`);
  }
});

// -------------------------------------------------------------------------------------
// 6–8. The call: what run promises, the order it keeps, and the scope it threads.
// -------------------------------------------------------------------------------------

test("run is asynchronous, always returns a Promise, and requires a function body before anything begins", async () => {
  const m = mod();
  assert.equal(
    Object.prototype.toString.call(m.UnitOfWork.prototype.run), "[object AsyncFunction]",
    "run must be declared async: a caller that wrote run(body).catch(...) must reach its handler on every path, and async is what makes that true by construction rather than by remembering",
  );
  const settled = build().run(() => OK);
  assert.ok(settled instanceof Promise, "run must return a Promise");
  assert.equal(typeof settled.then, "function", "and it must be thenable");
  assert.equal(await settled, OK, "the body's value comes back through it");
  // A body is the one thing run cannot supply for itself, and a missing one is refused before the
  // boundary opens — beginning something no body will ever run is the worst possible ordering.
  const record = recorder();
  const guarded = build({
    begin: record.make("begin", () => SCOPE),
    commit: record.make("commit"),
    rollback: record.make("rollback"),
  });
  for (const bad of [
    undefined, null, "body", 1, 0, true, false, [], {}, Symbol("body"),
    { call: () => OK }, { run: () => OK }, OK, SCOPE,
  ]) {
    await assertRejectsTypeError(() => guarded.run(bad), `a body of ${inspectShort(bad)}`);
  }
  await assertRejectsTypeError(() => guarded.run(), "no body at all");
  assert.deepEqual(record.order(), [], "a refused body must reach no collaborator: nothing may have begun");
  // The rule is a gate, not a wall: a real body still runs, on the very same instance.
  assert.equal(await guarded.run(() => OK), OK, "a function body is admitted");
  assert.deepEqual(record.order(), ["begin", "commit"], "and it opens and closes the boundary exactly once");
});

test("the happy path awaits begin, body and commit in that order, each with an undefined this, and resolves the body's own value by identity", async () => {
  const record = recorder();
  let committed = false;
  const unit = build({
    begin: record.make("begin", () => settledLater(SCOPE)),
    commit: record.make("commit", async () => { await settledLater(null); committed = true; }),
    rollback: record.make("rollback"),
  });

  // A real UseCase over a real Command producing a real Result, run inside the body. The port never
  // learns that any of these three types exist — which is the whole claim a port makes.
  const useCase = new UseCase({ kind: "command", name: NAME, version: VERSION, handler: () => OK });
  const body = record.make("body", (scope) => useCase.execute(commandOf()));

  const returned = unit.run(body);
  assert.ok(returned instanceof Promise, "run must return a Promise on the happy path too");
  const value = await returned;

  assert.deepEqual(record.order(), ["begin", "body", "commit"], "begin, then the body, then commit — in that order and no other");
  assert.equal(record.countOf("rollback"), 0, "a body that did not fail must never be rolled back");
  assert.equal(record.countOf("begin"), 1, "begin runs exactly once per run");
  assert.equal(record.countOf("body"), 1, "the body runs exactly once per run");
  assert.equal(record.countOf("commit"), 1, "commit runs exactly once per run");

  assert.equal(record.firstOf("begin").count, 0, "begin is called with zero arguments: it is the thing that produces a scope, not a thing that receives one");
  assert.equal(record.firstOf("body").count, 1, "the body receives exactly one argument");
  assert.equal(record.firstOf("body").args[0], SCOPE, "and that argument is the very scope begin resolved to, awaited rather than passed as a promise");
  assert.equal(record.firstOf("commit").count, 1, "commit receives exactly one argument");
  assert.equal(record.firstOf("commit").args[0], SCOPE, "and it is the same scope by identity, not a copy of it");

  // `this` is undefined for all three: a collaborator that could reach the unit of work could
  // re-enter run, and the in-flight refusal below would be the only thing standing between a
  // boundary and itself. Each is lifted out of its field before being called, which is what makes
  // an undefined receiver true by construction.
  for (const label of ["begin", "body", "commit"]) {
    assert.equal(record.firstOf(label).self, undefined, `${label} must be invoked with an undefined this`);
    assert.notEqual(record.firstOf(label).self, unit, `${label} must not receive the unit of work as this`);
  }

  assert.ok(committed, "run must not resolve before commit has settled: an unawaited commit is a boundary that closed on paper only");
  assert.equal(value, OK, "the body's own value comes back by identity — not a copy, not a rebuild, not the commit's return value");

  // A failure Result is a value like any other. The port has no opinion about it, does not inspect
  // it, and commits exactly as it would for an ok one: a modelled failure is the body succeeding at
  // saying no, and rolling it back would be this port inventing a policy it was told not to have.
  const second = recorder();
  const failed = Result.failure(new KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null }));
  const failing = new UseCase({ kind: "command", name: NAME, version: VERSION, handler: () => failed });
  const unitTwo = build({
    begin: second.make("begin", () => SCOPE),
    commit: second.make("commit"),
    rollback: second.make("rollback"),
  });
  const answer = await unitTwo.run(second.make("body", () => failing.execute(commandOf())));
  assert.equal(answer, failed, "a failure Result is returned by identity");
  assert.equal(answer.isOk, false, "and it is still the failure branch on the far side");
  assert.deepEqual(second.order(), ["begin", "body", "commit"], "a failure Result commits like any other returned value");
  assert.equal(second.countOf("rollback"), 0, "and it is never rolled back");
});

test("the scope is opaque: any value passes through by identity, unread, unrendered and unstored", async () => {
  // Whatever begin produced is a token this port carries from one hand to the other. It may be a
  // handle, a connection, a session, a string or nothing at all — a port that read one property of
  // it would have made a rule about what an adapter is allowed to be.
  for (const opaque of [
    null, undefined, 0, -0, "", "scope", false, true, NaN, 7n, Symbol("scope"),
    Object.freeze({ deep: { nested: true } }), [1, 2, 3], () => undefined, OK, PRINCIPAL,
  ]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => opaque),
      commit: record.make("commit"),
      rollback: record.make("rollback"),
    });
    await unit.run(record.make("body"));
    assert.deepEqual(record.order(), ["begin", "body", "commit"], `a scope of ${inspectShort(opaque)} must not change the order`);
    assert.ok(Object.is(record.firstOf("body").args[0], opaque), `the body must receive ${inspectShort(opaque)} by identity`);
    assert.ok(Object.is(record.firstOf("commit").args[0], opaque), `and commit must receive the same ${inspectShort(opaque)} by identity`);
  }

  // Read-recording proxy. The only property access this port may cause is the `then` lookup the
  // language itself performs when an object is awaited — an unavoidable consequence of `await
  // begin()`, and the one exception this row admits by name. Anything else is this module reading a
  // scope it was told to treat as a token.
  const touches = [];
  const trap = (name) => (target, ...rest) => {
    touches.push(`${name}:${String(rest[0])}`);
    return Reflect[name](target, ...rest);
  };
  const watched = new Proxy({}, {
    get: trap("get"), set: trap("set"), has: trap("has"), deleteProperty: trap("deleteProperty"),
    defineProperty: trap("defineProperty"), getOwnPropertyDescriptor: trap("getOwnPropertyDescriptor"),
    ownKeys: (target) => { touches.push("ownKeys"); return Reflect.ownKeys(target); },
    getPrototypeOf: (target) => { touches.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  });
  const watcher = recorder();
  const watching = build({
    begin: watcher.make("begin", () => watched),
    commit: watcher.make("commit"),
    rollback: watcher.make("rollback"),
  });
  await watching.run(watcher.make("body"));
  assert.equal(watcher.firstOf("body").args[0], watched, "the proxied scope must arrive by identity");
  for (const touch of touches) {
    assert.equal(touch, "get:then", `the scope was touched by ${touch}; a port may not read, render or enumerate the token it carries`);
  }

  // Nothing about a scope survives the call that carried it. A marker function is the scope here so
  // a stored reference would render its own name into any descriptor probe.
  const stored = build({ begin: () => function MARKER_scope_5a19() {}, commit: () => undefined, rollback: () => undefined });
  await stored.run(() => undefined);
  const m = mod();
  for (const [label, rendered] of [
    ["the instance", JSON.stringify(Object.getOwnPropertyDescriptors(stored))],
    ["its own names", JSON.stringify(Object.getOwnPropertyNames(stored))],
    ["the prototype", JSON.stringify(Object.getOwnPropertyDescriptors(m.UnitOfWork.prototype))],
    ["the class", JSON.stringify(Object.getOwnPropertyDescriptors(m.UnitOfWork))],
  ]) {
    assert.ok(!rendered.includes("MARKER_scope_5a19"), `the scope outlived its run on ${label}: ${rendered}`);
  }
  assert.ok(Object.isFrozen(stored), "the instance must still be frozen after carrying a scope");
  assert.deepEqual(Object.getOwnPropertyNames(stored), [], "and must still carry no own property");
});

// -------------------------------------------------------------------------------------
// 9–11. The three ways a run can fail, and exactly what each one does.
// -------------------------------------------------------------------------------------

test("a begin that fails reaches no body, no commit and no rollback, and propagates by identity", async () => {
  const boom = new RangeError("MARKER_begin_9f31");
  // Nothing opened, so there is nothing to close. A rollback here would be this port asking a
  // collaborator to undo a boundary it never received — and the collaborator has no scope to undo
  // it with, because producing that scope is the very thing that just failed.
  for (const [label, begin] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
  ]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", begin),
      commit: record.make("commit"),
      rollback: record.make("rollback"),
    });
    let returned;
    assert.doesNotThrow(() => { returned = unit.run(record.make("body")); }, `${label}: run must not throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: run must still yield a Promise`);
    const caught = await rejectionOf(returned);
    assert.equal(caught, boom, `${label}: the very value begin threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_begin_9f31", `${label}: and its message must be untouched`);
    assert.deepEqual(record.order(), ["begin"], `${label}: begin failed, so nothing else may have been called`);
  }
  // Non-Error throws propagate on exactly the same terms; a port that only preserved Errors would
  // quietly normalise everything else, and a caller matching on its own sentinel would never match.
  for (const thrown of ["a string failure", 0, null, undefined, false, { code: "X_Y" }, OK]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => { throw thrown; }),
      commit: record.make("commit"),
      rollback: record.make("rollback"),
    });
    const caught = await rejectionOf(unit.run(record.make("body")));
    assert.equal(caught, thrown, `a begin throwing ${inspectShort(thrown)} must propagate by identity`);
    assert.deepEqual(record.order(), ["begin"], `and still reach nothing else`);
  }
});

test("a body that fails rolls back exactly once with its scope, never commits, and propagates by identity even when the rollback fails too", async () => {
  const boom = new RangeError("MARKER_body_4c71");
  for (const [label, body] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
  ]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => settledLater(SCOPE)),
      commit: record.make("commit"),
      rollback: record.make("rollback", async () => settledLater(null)),
    });
    const caught = await rejectionOf(unit.run(record.make("body", body)));
    assert.deepEqual(record.order(), ["begin", "body", "rollback"], `${label}: the boundary must be rolled back, and never committed`);
    assert.equal(record.countOf("rollback"), 1, `${label}: rolled back exactly once, not once per await point`);
    assert.equal(record.countOf("commit"), 0, `${label}: a failed body must never be committed`);
    assert.equal(record.firstOf("rollback").count, 1, `${label}: rollback receives exactly one argument`);
    assert.equal(record.firstOf("rollback").args[0], SCOPE, `${label}: and it is the same scope by identity`);
    assert.equal(record.firstOf("rollback").self, undefined, `${label}: rollback is lifted too, and observes an undefined this`);
    assert.equal(caught, boom, `${label}: the very value the body threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_body_4c71", `${label}: and its message must be untouched`);
  }
  for (const thrown of ["a string failure", 0, null, undefined, false, { code: "X_Y" }, OK]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => SCOPE),
      commit: record.make("commit"),
      rollback: record.make("rollback"),
    });
    const caught = await rejectionOf(unit.run(record.make("body", () => { throw thrown; })));
    assert.equal(caught, thrown, `a body throwing ${inspectShort(thrown)} must propagate by identity`);
    assert.deepEqual(record.order(), ["begin", "body", "rollback"], "and it must still be rolled back");
  }
  // The residual, asserted rather than assumed. When the rollback fails too, the *body's* failure is
  // what the caller receives: its error handling was written against what its own body threw, and
  // replacing that with a collaborator's failure would destroy the only evidence it has. The
  // rollback's own failure is therefore dropped here, deliberately and with a real cost — observing
  // it belongs to the later adapter that owns a boundary, and is explicitly not this port's to
  // invent. This row exists so that debt is a decision on the record rather than an accident.
  const rollbackBoom = new RangeError("MARKER_rollback_4c71");
  for (const [label, rollback] of [
    ["a synchronous throw", () => { throw rollbackBoom; }],
    ["an async rejection", async () => { throw rollbackBoom; }],
    ["a returned rejected promise", () => Promise.reject(rollbackBoom)],
  ]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => SCOPE),
      commit: record.make("commit"),
      rollback: record.make("rollback", rollback),
    });
    const caught = await rejectionOf(unit.run(record.make("body", () => { throw boom; })));
    assert.equal(caught, boom, `${label}: the body's failure is what propagates, not the rollback's`);
    assert.notEqual(caught, rollbackBoom, `${label}: a failing rollback must not replace the body's failure`);
    assert.equal(caught.message, "MARKER_body_4c71", `${label}: and it arrives unwrapped and unaltered`);
    assert.equal(record.countOf("rollback"), 1, `${label}: rollback is still attempted exactly once`);
    assert.equal(record.countOf("commit"), 0, `${label}: and a failed body is still never committed`);
  }
});

test("a commit that fails never rolls back, and propagates by identity", async () => {
  const boom = new RangeError("MARKER_commit_1d55");
  // The body already ran and already succeeded. Rolling back here would ask a collaborator to undo
  // work whose boundary is in a state only that collaborator can describe — and the caller would
  // receive a rollback's opinion instead of the failure it actually needs to see.
  for (const [label, commit] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
  ]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => SCOPE),
      commit: record.make("commit", commit),
      rollback: record.make("rollback"),
    });
    let returned;
    assert.doesNotThrow(() => { returned = unit.run(record.make("body", () => OK)); }, `${label}: run must not throw synchronously`);
    const caught = await rejectionOf(returned);
    assert.deepEqual(record.order(), ["begin", "body", "commit"], `${label}: a failed commit must not be followed by a rollback`);
    assert.equal(record.countOf("rollback"), 0, `${label}: rollback must be uncalled`);
    assert.equal(caught, boom, `${label}: the very value commit threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_commit_1d55", `${label}: and its message must be untouched`);
  }
  for (const thrown of ["a string failure", 0, null, undefined, false, { code: "X_Y" }, OK]) {
    const record = recorder();
    const unit = build({
      begin: record.make("begin", () => SCOPE),
      commit: record.make("commit", () => { throw thrown; }),
      rollback: record.make("rollback"),
    });
    const caught = await rejectionOf(unit.run(record.make("body", () => OK)));
    assert.equal(caught, thrown, `a commit throwing ${inspectShort(thrown)} must propagate by identity`);
    assert.equal(record.countOf("rollback"), 0, "and it must still not roll back");
  }
  // The body's value is discarded when the commit fails: a caller that received it would believe
  // the boundary closed. The commit's failure is the whole answer.
  const record = recorder();
  const unit = build({
    begin: record.make("begin", () => SCOPE),
    commit: record.make("commit", () => { throw boom; }),
    rollback: record.make("rollback"),
  });
  const caught = await rejectionOf(unit.run(() => OK));
  assert.notEqual(caught, OK, "a failed commit may not resolve with the body's value");
  assert.equal(caught, boom, "it rejects with the commit's own failure");
});

// -------------------------------------------------------------------------------------
// 12. One unit of work, one run at a time — and nothing carried between them.
// -------------------------------------------------------------------------------------

test("one unit of work refuses a nested or concurrent run, clears its flag in finally, and stays stateless across sequential reuse", async () => {
  // Nesting. A second run on the same instance would begin a second boundary inside the first, and
  // the two would share nothing but a commit order nobody declared. The refusal is a TypeError
  // rejection, it reaches no collaborator, and the outer run is entirely unaffected by it.
  const nested = recorder();
  const inner = recorder();
  const unit = build({
    begin: nested.make("begin", () => settledLater(SCOPE)),
    commit: nested.make("commit"),
    rollback: nested.make("rollback"),
  });
  let nestedError = NO_REJECTION;
  const outer = await unit.run(async (scope) => {
    nestedError = await rejectionOf(unit.run(inner.make("body")));
    return OK;
  });
  assert.notEqual(nestedError, NO_REJECTION, "a nested run must reject rather than resolve");
  assert.ok(nestedError instanceof TypeError, `a nested run must reject with a TypeError, got ${inspectShort(nestedError)}`);
  assert.equal(inner.countOf("body"), 0, "the nested body must never run");
  assert.deepEqual(nested.order(), ["begin", "commit"], "the nested attempt must reach no collaborator of its own");
  assert.equal(outer, OK, "and the outer run must be entirely unaffected by the refusal it contained");

  // Concurrency. The same rule, reached the other way: two runs started from outside, the first
  // still suspended on its begin. The refusal must arrive as a rejection here too — a synchronous
  // throw would break `unit.run(a); unit.run(b).catch(...)` for the caller that wrote it defensively.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const concurrent = recorder();
  const gated = build({
    begin: concurrent.make("begin", () => gate.then(() => SCOPE)),
    commit: concurrent.make("commit"),
    rollback: concurrent.make("rollback"),
  });
  const first = gated.run(concurrent.make("body", () => OK));
  await assertRejectsTypeError(() => gated.run(concurrent.make("second-body")), "a concurrent run while the first is in flight");
  assert.equal(concurrent.countOf("begin"), 1, "the refused run must not have begun a second boundary");
  assert.equal(concurrent.countOf("second-body"), 0, "and its body must never have run");
  release();
  assert.equal(await first, OK, "the run that was already in flight must finish normally");
  assert.deepEqual(concurrent.order(), ["begin", "body", "commit"], "and its own order must be untouched by the refusal");

  // The flag clears in a finally, so every one of the three failure paths leaves the instance
  // usable. A flag cleared only on success would make one failed run a permanently dead unit of
  // work, and the caller would never be told which run poisoned it.
  for (const [label, overrides] of [
    ["a failed begin", { begin: () => { throw new RangeError("begin"); } }],
    ["a failed body", {}],
    ["a failed commit", { commit: () => { throw new RangeError("commit"); } }],
    ["a failed rollback", { rollback: () => { throw new RangeError("rollback"); } }],
  ]) {
    let fail = true;
    const reused = build({ begin: () => SCOPE, commit: () => undefined, rollback: () => undefined, ...overrides });
    const body = () => { if (fail) throw new RangeError("body"); return OK; };
    // The first run fails on whichever path this row is about; the second must simply work.
    await rejectionOf(reused.run(body));
    fail = false;
    if (label === "a failed begin" || label === "a failed commit") {
      // These two rows fail in a collaborator that keeps failing, so the reuse they prove is that a
      // *second* run is admitted at all — it reaches the same failure rather than a TypeError about
      // a run that never ended.
      const again = await rejectionOf(reused.run(body));
      assert.ok(!(again instanceof TypeError), `${label}: the flag must clear in a finally, or the next run is refused as still in flight`);
      assert.ok(again instanceof RangeError, `${label}: the next run must reach the same real failure`);
    } else {
      assert.equal(await reused.run(body), OK, `${label}: a later sequential run must succeed`);
    }
  }

  // Statelessness across reuse: one instance, many runs, no accumulation and no drift.
  const repeat = recorder();
  const stable = build({
    begin: repeat.make("begin", () => SCOPE),
    commit: repeat.make("commit"),
    rollback: repeat.make("rollback"),
  });
  for (let round = 0; round < 3; round += 1) {
    assert.equal(await stable.run(repeat.make("body", () => OK)), OK, `sequential run ${round} must resolve with the body's value`);
  }
  assert.equal(repeat.countOf("begin"), 3, "each sequential run must open the boundary exactly once");
  assert.equal(repeat.countOf("commit"), 3, "and close it exactly once");
  assert.equal(repeat.countOf("rollback"), 0, "and never roll back a body that did not fail");
  assert.ok(Object.isFrozen(stable), "the instance must still be frozen after repeated use");
  assert.deepEqual(Object.getOwnPropertyNames(stable), [], "and must still carry no own property");
  // Two units of work share nothing: there is no module-level state for them to meet in, so one
  // being in flight can never refuse the other.
  const left = build({ begin: () => SCOPE });
  const right = build({ begin: () => SCOPE });
  assert.notEqual(left, right, "two constructions are two units of work");
  const [a, b] = await Promise.all([left.run(() => OK), right.run(() => OK)]);
  assert.equal(a, OK, "the first runs concurrently with the second");
  assert.equal(b, OK, "and the second with the first");
});
