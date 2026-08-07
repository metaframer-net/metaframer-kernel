import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ActorId, CausationId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { Command, KernelError, Query, Result } from "../src/application/action-primitives.mjs";

// =====================================================================================
// P-M1-03 — the UseCase contract, frozen as a public surface
//
// This is the whole observable surface of src/application/use-case.mjs: one exported class that
// binds a declared action coordinate to a handler and guarantees what happens either side of the
// call. It is written before the module exists, so every assertion here is a requirement rather
// than a description of something already built.
//
// The scope is canonical M1 line 229 — `UseCase contract` — and nothing beyond it. This package
// does not claim line 249 (kernel primitives used inside a real use case) and does not claim
// line 251 (PostgreSQL integration proof). A contract that says what a use case must be is not
// evidence that one has been built against a database, and no assertion here may be read as one.
//
// The Application ring owns this type. Domain keeps the identity values, P-M1-02 composes them
// into an action, and P-M1-03 says what may be done with one — in that direction only. Nothing
// here may be satisfied by moving a type inward or by teaching an inner module about this one.
//
// What is deliberately *not* here, and must not appear:
//
//   - no registry, dispatcher, bus, router or resolver — a UseCase knows one action coordinate
//     and one handler, and choosing between use cases is a later package with its own gate;
//   - no port of any kind, no unit of work, no clock, no policy, no audit, no outbox;
//   - no validation boundary and no composition root;
//   - no KernelError import and no new error code — this package mints no failure vocabulary. A
//     refusal is a TypeError, which is what a broken contract has always been;
//   - no database, transport, framework, environment, clock or randomness of any kind.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module must
// fail every test by name rather than collapsing the file into a single load error, since fifteen
// named failures are the RED specification and one load error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/use-case.mjs";
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
 * Line-based on purpose: a module may explain in prose why it never touches a clock, and a scan
 * that could not tell the explanation from the deed would forbid the explanation. This matters
 * more here than in P-M1-02, because the reverse-direction check below reads two modules whose
 * comments legitimately use the words this package forbids in code.
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

// -------------------------------------------------------------------------------------
// Fixtures. Real P-M1-01 identity values and real P-M1-02 actions — never hand-rolled
// look-alikes on the positive path, because a contract proven against a stand-in is a contract
// about the stand-in.
// -------------------------------------------------------------------------------------

const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-billing-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const CAUSATION = new CausationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const IDEMPOTENCY = new IdempotencyKey("order-7731-retry-2");

const NAME = "billing.invoice.issue";
const VERSION = 3;

const commandOf = (overrides = {}) => new Command({
  name: NAME,
  version: VERSION,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: CAUSATION,
  idempotencyKey: IDEMPOTENCY,
  payload: { amount: 100, currency: "EUR" },
  ...overrides,
});

const queryOf = (overrides = {}) => new Query({
  name: NAME,
  version: VERSION,
  principal: PRINCIPAL,
  correlationId: CORRELATION,
  causationId: CAUSATION,
  payload: { invoice: "7731" },
  ...overrides,
});

const OK = Result.ok({ invoice: "7731" });
const FAILED = Result.failure(new KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null }));

/** The four declaration keys, in no particular order — an options object has no reading order. */
const DECLARATION_KEYS = ["kind", "name", "version", "handler"];

const declaration = (overrides = {}) => ({
  kind: "command",
  name: NAME,
  version: VERSION,
  handler: () => OK,
  ...overrides,
});

/** A use case built through the module under test. Every caller reaches the guard through mod(). */
const build = (overrides = {}) => new (mod().UseCase)(declaration(overrides));

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
 * Call `execute` and require the refusal to arrive as a rejection.
 *
 * `execute` always returns a Promise, so a synchronous throw is a contract breach even when the
 * thrown value is the right one: a caller that wrote `useCase.execute(x).catch(...)` would never
 * reach its handler. The two facts are asserted separately so a failure says which one broke.
 */
async function assertRejectsTypeError(call, label) {
  let promise;
  assert.doesNotThrow(() => { promise = call(); }, `${label}: execute must never throw synchronously; it always returns a Promise`);
  assert.ok(promise instanceof Promise, `${label}: execute must return a Promise`);
  const error = await rejectionOf(promise);
  assert.notEqual(error, NO_REJECTION, `${label}: must reject rather than resolve`);
  assert.ok(error instanceof TypeError, `${label}: must reject with a TypeError, got ${inspectShort(error)}`);
}

// -------------------------------------------------------------------------------------
// 1–3. The module surface, its imports, the direction of those imports, and what it never reaches.
// -------------------------------------------------------------------------------------

test("the module exports exactly UseCase, and no later-package surface stands beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["UseCase"], "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  assert.equal(typeof m.UseCase, "function", "UseCase must be a class");
  // Each absent name is a whole concern this package must not have started. They are listed rather
  // than summarised because the failure they guard against is one of them appearing alone, quietly,
  // as "just a small helper".
  for (const absent of [
    "Registry", "UseCaseRegistry", "Dispatcher", "Bus", "CommandBus", "QueryBus", "Router",
    "Resolver", "Handler", "CommandHandler", "QueryHandler", "Port", "UnitOfWork", "Transaction",
    "Clock", "IdentityPort", "PolicyPort", "AuditPort", "OutboxPort", "Repository",
    "ValidationBoundary", "Validator", "validate", "CompositionRoot", "container", "configure",
    "register", "resolve",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the UseCase contract`);
  }
  // Re-exporting the P-M1-02 types would give the kernel two front doors to one contract, and the
  // second would be free to drift the day either module is versioned.
  for (const borrowed of ["Command", "Query", "Result", "KernelError"]) {
    assert.equal(m[borrowed], undefined, `${borrowed} is owned by ${actionPath} and must not be re-exported here`);
  }
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; a use case carries its own name and version`);
  }
  assert.deepEqual(Object.getOwnPropertySymbols(m.UseCase), [], "UseCase must carry no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.UseCase.prototype), [Symbol.toStringTag],
    "UseCase.prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.UseCase.prototype), Object.prototype, "UseCase must stand directly on Object");
  assert.ok(!(m.UseCase.prototype instanceof Error), "a UseCase is not an error type");
});

test("the module imports exactly Command, Query and Result from the action primitives, and nothing imports back", async () => {
  const text = code();
  const specifiers = [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  assert.deepEqual(
    [...new Set([...specifiers, ...bare])].sort(), ["./action-primitives.mjs"],
    `${modulePath} may import exactly the action primitives and nothing else`,
  );
  // The named bindings are the contract too. Importing the whole module namespace, or reaching for
  // KernelError, would widen the coupling past the three types this package actually composes.
  const clause = text.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/action-primitives\.mjs["']/);
  assert.ok(clause, `${modulePath} must use a named import clause from ./action-primitives.mjs`);
  assert.deepEqual(
    clause[1].split(",").map((part) => part.trim()).filter(Boolean).sort(),
    ["Command", "Query", "Result"],
    `${modulePath} must import exactly Command, Query and Result`,
  );
  assert.ok(!/\bKernelError\b/.test(text), `${modulePath} must not import or name KernelError: this package mints no failure vocabulary`);
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not import a whole module namespace`);
  // Every other way a dependency can arrive, refused by name so a finding says which door opened.
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the domain ring directly", /identity-primitives/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // Dependency direction, proven from the inner side too. Application may know Application, and
  // Application may know Domain; either of them learning about this module would close the ring
  // into a cycle and the onion would stop being one. Both are read comment-stripped, because both
  // legitimately say "use-case" in prose while saying nothing about it in code.
  for (const inner of [domainPath, actionPath]) {
    const innerCode = stripComments(await readFile(path.join(root, inner), "utf8"));
    assert.ok(!/use-case/.test(innerCode), `${inner} must not import ${modulePath}`);
    assert.ok(!/\bUseCase\b/.test(innerCode), `${inner} must not name UseCase in code`);
  }
  const actionCode = stripComments(await readFile(path.join(root, actionPath), "utf8"));
  const actionSpecifiers = [...actionCode.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m2) => m2[1]);
  assert.deepEqual(
    [...new Set(actionSpecifiers)].sort(), ["../domain/identity-primitives.mjs"],
    `${actionPath} must keep the import set P-M1-02 froze; this package widens nothing beneath it`,
  );
});

test("the module reaches no ambient capability, no clock, no randomness, no persistence and no orchestration vocabulary", () => {
  const text = code();
  // A contract whose behaviour could depend on a clock, a random value or the environment is a
  // contract whose two executions over the same action are free to differ — and every determinism
  // assertion below would then be testing a coincidence.
  for (const [label, pattern] of [
    ["process", /\bprocess\b/],
    ["fetch", /\bfetch\s*\(/],
    ["globalThis", /\bglobalThis\b/],
    ["a clock", /\bDate\b|\bperformance\b|\bhrtime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\brandomBytes\b|\bcrypto\b/],
    ["a timer", /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b|\breaddir\b/],
    ["SQL", /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bpostgres\b|\bpsycopg\b|\bsqlalchemy\b/i],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // The frozen non-goals, scanned in code rather than only asserted as absent exports. A private
  // registry is still a registry, and it would never show up in the export set.
  for (const [label, pattern] of [
    ["a registry", /\bregistry\b/i],
    ["a dispatcher", /\bdispatcher\b|\bdispatch\s*\(/i],
    ["a bus", /\bCommandBus\b|\bQueryBus\b|\beventBus\b/i],
    ["a router", /\brouter\b/i],
    ["a unit of work", /\bUnitOfWork\b/i],
    ["a port", /\bOutboxPort\b|\bAuditPort\b|\bPolicyPort\b|\bIdentityPort\b/i],
    ["a composition root", /\bcompositionRoot\b/i],
    ["a validation boundary", /\bvalidationBoundary\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not carry ${label}`);
  }
});

// -------------------------------------------------------------------------------------
// 4–8. Construction: the declaration, and one validator per coordinate.
// -------------------------------------------------------------------------------------

test("the constructor takes exactly kind, name, version and handler, all required and all present", () => {
  const m = mod();
  const built = build();
  assert.ok(built instanceof m.UseCase, "the declared use case must construct");
  assert.equal(built.kind, "command");
  assert.equal(built.name, NAME);
  assert.equal(built.version, VERSION);
  assert.equal(m.UseCase.length, 1, "the constructor takes one declaration object, not four positional arguments");
  // An unknown key is refused rather than dropped: silently ignoring one lets a caller believe it
  // set something. A missing key is refused too, because there is no coordinate here with a
  // defensible default — a use case that guessed its own kind would guess wrong in silence.
  for (const key of DECLARATION_KEYS) {
    const options = declaration();
    delete options[key];
    throws(() => new m.UseCase(options), `omitting ${key} must be refused`);
    throws(() => new m.UseCase(declaration({ [key]: undefined })), `${key} is required and must not accept undefined`);
    throws(() => new m.UseCase(declaration({ [key]: null })), `${key} is required and must not accept null`);
  }
  for (const extra of ["ports", "clock", "registry", "execute", "toJSON", "handle", "kindOf"]) {
    throws(() => new m.UseCase(declaration({ [extra]: 1 })), `an unknown declaration key ${extra} must be refused by name`);
  }
  throws(() => new m.UseCase({ ...declaration(), [Symbol("hidden")]: 1 }), "a symbol-keyed declaration member must be refused");
  for (const notOptions of [undefined, null, "command", 1, true, [], () => {}, PRINCIPAL]) {
    throws(() => new m.UseCase(notOptions), `${inspectShort(notOptions)} is not a declaration object`);
  }
  throws(() => new m.UseCase(), "construction with no declaration at all must be refused");
});

test("kind is exactly the string command or the string query", () => {
  const m = mod();
  for (const ok of ["command", "query"]) {
    assert.equal(new m.UseCase(declaration({ kind: ok })).kind, ok, `${ok} is a legal kind`);
  }
  // Case is not folded and neither is padding: a kind that arrived spelled differently is a caller
  // that believed something different, and normalising it would hide the disagreement.
  for (const bad of [
    "Command", "COMMAND", "Query", " command", "command ", "commands", "cmd", "", "event",
    "command\n", 1, 0, true, false, [], {}, ["command"], Symbol("command"),
    new String("command"), () => "command", { toString: () => "command" },
  ]) {
    throws(() => new m.UseCase(declaration({ kind: bad })), `${inspectShort(bad)} is not a legal kind`);
  }
});

test("name is a non-empty primitive string", () => {
  const m = mod();
  for (const ok of [NAME, "x", "billing.invoice.void", "a b c", "İşlem"]) {
    assert.equal(new m.UseCase(declaration({ name: ok })).name, ok, `${JSON.stringify(ok)} is a legal name`);
  }
  for (const bad of [
    "", 1, 0, true, false, [], {}, [NAME], Symbol(NAME), new String(NAME),
    () => NAME, { toString: () => NAME },
  ]) {
    throws(() => new m.UseCase(declaration({ name: bad })), `${inspectShort(bad)} is not a legal name`);
  }
});

test("version is a safe integer of at least one", () => {
  const m = mod();
  for (const ok of [1, 2, 99, Number.MAX_SAFE_INTEGER]) {
    assert.equal(new m.UseCase(declaration({ version: ok })).version, ok, `${ok} is a legal version`);
  }
  for (const bad of [
    0, -1, -3, 1.5, 0.1, NaN, Infinity, -Infinity, "1", "v1", true, false,
    Number.MAX_SAFE_INTEGER + 1, 2 ** 53, 1n, [1], { version: 1 }, Symbol("1"),
  ]) {
    throws(() => new m.UseCase(declaration({ version: bad })), `${inspectShort(bad)} is not a legal version`);
  }
});

test("handler is a function, and is never readable back off the instance", () => {
  const m = mod();
  // Only the ordinary function test. A class is a function and stays admissible: refusing one
  // would be a rule about how a caller spelled its handler, which is not this contract's business.
  for (const ok of [() => OK, function named() { return OK; }, async () => OK, class Handler {}]) {
    assert.doesNotThrow(() => new m.UseCase(declaration({ handler: ok })), `${inspectShort(ok)} is a legal handler`);
  }
  for (const bad of [
    "handler", 1, 0, true, false, [], {}, Symbol("handler"),
    { call: () => OK }, { handle: () => OK }, OK,
  ]) {
    throws(() => new m.UseCase(declaration({ handler: bad })), `${inspectShort(bad)} is not a legal handler`);
  }
  // The handler is collaborator state, not part of the contract's surface. A getter would let any
  // caller reach past `execute` and call it directly, which is exactly the gate this type is for.
  const marker = function MARKER_handler_4c71() { return OK; };
  const built = new m.UseCase(declaration({ handler: marker }));
  assert.equal(built.handler, undefined, "there must be no handler getter");
  assert.equal(m.UseCase.prototype.handler, undefined, "and none on the prototype either");
  for (const [label, rendered] of [
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(built))],
    ["own keys", JSON.stringify(Object.keys(built))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(built))],
    ["prototype descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.UseCase.prototype))],
  ]) {
    assert.ok(!rendered.includes("MARKER_handler_4c71"), `the handler leaked through ${label}: ${rendered}`);
  }
});

// -------------------------------------------------------------------------------------
// 9. What a constructed use case is: closed, minimal, and exactly this wide.
// -------------------------------------------------------------------------------------

test("a constructed use case is frozen, own-property-free, tagged, and exposes exactly five prototype names", () => {
  const m = mod();
  const built = build();
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.ok(Object.isFrozen(m.UseCase.prototype), "UseCase.prototype must be frozen");
  assert.ok(Object.isFrozen(m.UseCase), "UseCase itself must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "the coordinates live behind getters, not as own properties");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.equal(built[Symbol.toStringTag], "UseCase", "the instance must tag itself with its class name");
  assert.throws(() => { built.name = "other"; }, TypeError, "assignment into a frozen instance must throw");
  // The public surface, frozen in both directions: these members and no others. Every name absent
  // here is a decision — a UseCase is not a value, so it has no equality and no rendering, and a
  // toJSON would put a live handler one serialisation away from a log line.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.UseCase.prototype).sort(),
    ["constructor", "execute", "kind", "name", "version"],
    "UseCase.prototype must carry exactly constructor, execute, kind, name and version",
  );
  for (const absent of ["equals", "toJSON", "toString", "handler", "handle", "run", "call", "with", "bind"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m.UseCase.prototype, absent), false,
      `${absent} must not appear on UseCase.prototype`,
    );
  }
  assert.equal(m.UseCase.prototype.toString, Object.prototype.toString, "toString must not be overridden");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.UseCase).sort(), ["length", "name", "prototype"],
    "UseCase must carry no static factory, no registry and no lookup",
  );
  // The getters answer the same thing every time, and answer it about the declaration.
  for (const key of ["kind", "name", "version"]) {
    assert.equal(built[key], built[key], `the ${key} getter must be stable across reads`);
    const descriptor = Object.getOwnPropertyDescriptor(m.UseCase.prototype, key);
    assert.equal(typeof descriptor.get, "function", `${key} must be a getter`);
    assert.equal(descriptor.set, undefined, `${key} must have no setter`);
  }
  assert.equal(typeof m.UseCase.prototype.execute, "function", "execute must be a method");
  assert.equal(m.UseCase.prototype.execute.length, 1, "execute takes exactly one argument: the action, and no collaborator beside it");
});

// -------------------------------------------------------------------------------------
// 10–12. The gate: which action this use case will accept, and how it refuses the rest.
// -------------------------------------------------------------------------------------

test("a command use case admits an exact Command and refuses every other kind of action", async () => {
  const useCase = build({ kind: "command" });
  const action = commandOf();
  assert.equal(await useCase.execute(action), OK, "an exact Command matching kind, name and version is admitted");

  class SubCommand extends Command {}
  // Exact prototype, not `instanceof`: a subclass passes an instanceof gate while carrying whatever
  // the subclass added, and the use case would have no way to know.
  for (const [label, bad] of [
    ["a Query of the same coordinates", queryOf()],
    ["a subclass of Command", new SubCommand({
      name: NAME, version: VERSION, principal: PRINCIPAL, correlationId: CORRELATION,
      causationId: CAUSATION, idempotencyKey: IDEMPOTENCY, payload: { amount: 100, currency: "EUR" },
    })],
    ["the JSON shape of a Command", action.toJSON()],
    ["the string form of a Command", String(action)],
    ["a bare object wearing the coordinates", { kind: "command", name: NAME, version: VERSION }],
    ["null", null],
    ["undefined", undefined],
    ["no argument at all", undefined],
    ["a number", 1],
    ["an array", []],
    ["a Principal", PRINCIPAL],
    ["a Result", OK],
  ]) {
    await assertRejectsTypeError(() => useCase.execute(bad), `a command use case handed ${label}`);
  }
  // An object built directly on Command.prototype satisfies the prototype rule and holds no field,
  // so whichever way the implementation reaches its coordinates it must end in a TypeError — and
  // it must still arrive as a rejection, not as a synchronous throw out of a getter.
  await assertRejectsTypeError(() => useCase.execute(Object.create(Command.prototype)), "a command use case handed a brandless Command impostor");
});

test("a query use case admits an exact Query and refuses a Command on the same terms", async () => {
  const useCase = build({ kind: "query", handler: () => OK });
  const action = queryOf();
  assert.equal(await useCase.execute(action), OK, "an exact Query matching kind, name and version is admitted");
  assert.equal(useCase.kind, "query", "the declared kind is what the gate is about");

  class SubQuery extends Query {}
  for (const [label, bad] of [
    ["a Command of the same coordinates", commandOf()],
    ["a subclass of Query", new SubQuery({
      name: NAME, version: VERSION, principal: PRINCIPAL, correlationId: CORRELATION,
      causationId: CAUSATION, payload: { invoice: "7731" },
    })],
    ["the JSON shape of a Query", action.toJSON()],
    ["a bare object wearing the coordinates", { kind: "query", name: NAME, version: VERSION }],
    ["null", null],
    ["undefined", undefined],
    ["a Result", OK],
  ]) {
    await assertRejectsTypeError(() => useCase.execute(bad), `a query use case handed ${label}`);
  }
  await assertRejectsTypeError(() => useCase.execute(Object.create(Query.prototype)), "a query use case handed a brandless Query impostor");
});

test("a name or a version that does not match the declaration is refused, and the refusal is a rejection", async () => {
  const useCase = build({ kind: "command", name: NAME, version: VERSION });
  // name@version is the action's identity. A use case that ran the wrong version of its own action
  // would be the quietest possible failure: everything downstream would look like it worked.
  for (const [label, bad] of [
    ["a different name", commandOf({ name: "billing.invoice.void" })],
    ["a longer name sharing a prefix", commandOf({ name: "billing.invoice.issue.retry" })],
    ["an earlier version", commandOf({ version: VERSION - 1 })],
    ["a later version", commandOf({ version: VERSION + 1 })],
    ["version one against a declared three", commandOf({ version: 1 })],
  ]) {
    await assertRejectsTypeError(() => useCase.execute(bad), `a use case handed ${label}`);
  }
  // The matching action still passes, so the rule above is a gate rather than a wall.
  assert.equal(await useCase.execute(commandOf()), OK, "the declared name and version still match");
  // The same rule on the query side, so the read path is not the looser one.
  const reader = build({ kind: "query", name: NAME, version: VERSION });
  await assertRejectsTypeError(() => reader.execute(queryOf({ name: "billing.invoice.list" })), "a query use case handed a different name");
  await assertRejectsTypeError(() => reader.execute(queryOf({ version: 9 })), "a query use case handed a different version");
  assert.equal(await reader.execute(queryOf()), OK, "the declared query coordinates still match");
});

// -------------------------------------------------------------------------------------
// 13–15. The call: how the handler is invoked, what may come back, and what propagates.
// -------------------------------------------------------------------------------------

test("the handler is invoked with exactly the action and with an undefined this", async () => {
  const calls = [];
  // A plain function, not an arrow: an arrow would close over this file's `this` and could never
  // observe what the contract actually passed.
  const handler = function recording(...args) {
    calls.push({ self: this, args, count: args.length });
    return OK;
  };
  const useCase = build({ handler });
  const action = commandOf();
  await useCase.execute(action);
  assert.equal(calls.length, 1, "the handler must be invoked exactly once per execute");
  // `this` is undefined rather than the use case: a handler that could reach its use case could
  // reach the coordinates the gate just checked, and re-enter execute.
  assert.equal(calls[0].self, undefined, "the handler must be invoked with an undefined this");
  assert.notEqual(calls[0].self, useCase, "the handler must not receive the use case as this");
  assert.equal(calls[0].count, 1, "the handler must receive exactly one argument");
  assert.equal(calls[0].args[0], action, "and that argument must be the very action that was handed in");
  // A refused action never reaches the handler. The gate is a gate, not an annotation.
  await assertRejectsTypeError(() => useCase.execute(queryOf()), "a refused action");
  await assertRejectsTypeError(() => useCase.execute(commandOf({ version: 9 })), "a version mismatch");
  assert.equal(calls.length, 1, "a refused action must not reach the handler at all");
});

test("execute always returns a Promise, requires an exact Result back, and returns that same reference", async () => {
  // Synchronous handler, asynchronous handler, and a handler returning a bare thenable: all three
  // are the same contract from the caller's side, which is the whole reason execute is uniform.
  for (const [label, handler] of [
    ["a synchronous handler", () => OK],
    ["an async handler", async () => OK],
    ["a handler returning a promise", () => Promise.resolve(OK)],
  ]) {
    const useCase = build({ handler });
    const returned = useCase.execute(commandOf());
    assert.ok(returned instanceof Promise, `${label}: execute must return a Promise`);
    assert.equal(typeof returned.then, "function", `${label}: and it must be thenable`);
    // The same reference, not an equal one. A Result rebuilt on the way out would break
    // `result === theResultMyHandlerReturned` for a caller holding the value it just produced.
    assert.equal(await returned, OK, `${label}: the very Result the handler returned must come back`);
  }
  // A failure Result is a legitimate answer and is passed through exactly like an ok one. Refusing
  // it would make the contract treat a modelled failure as a broken handler.
  const failing = build({ handler: () => FAILED });
  assert.equal(await failing.execute(commandOf()), FAILED, "a failure Result passes through unchanged");
  assert.equal((await failing.execute(commandOf())).isOk, false, "and it is still the failure branch on the far side");

  // Anything that is not an exact Result is a broken handler, and it is refused rather than wrapped.
  const notResults = [
    undefined, null, 0, "", "ok", true, false, {}, [], { ok: true, value: 1 },
    OK.toJSON(), commandOf(), PRINCIPAL, () => OK, Symbol("result"),
  ];
  for (const bad of notResults) {
    await assertRejectsTypeError(() => build({ handler: () => bad }).execute(commandOf()), `a handler returning ${inspectShort(bad)}`);
    await assertRejectsTypeError(() => build({ handler: async () => bad }).execute(commandOf()), `an async handler resolving to ${inspectShort(bad)}`);
  }
  // A handler returning nothing at all is the most likely real mistake, so it is named separately
  // from the table above rather than left to be inferred from `undefined`.
  await assertRejectsTypeError(() => build({ handler: () => {} }).execute(commandOf()), "a handler that returns nothing");

  // The two impostors a prototype-identity gate cannot see. Both of these answer `Result.prototype`
  // to `Object.getPrototypeOf`, so a check written as `getPrototypeOf(r) === Result.prototype` — the
  // exact-class test this ring already uses on the way *in* — admits them, and the caller receives
  // something that is not a Result while every type in the chain believed it was.
  //
  //   - `Object.create(Result.prototype)` carries no branch, no value and no error. Reading `isOk`
  //     on it throws, so a caller that trusted the contract discovers the breach three frames later
  //     rather than here.
  //   - `new Proxy(OK, {})` forwards `getPrototypeOf` to a real Result, so it is indistinguishable
  //     by prototype — but a proxy never carries the private fields, so its getters throw too, and
  //     every trap on it is a place a later handler could interpose behaviour on a value the
  //     contract has already vouched for.
  //
  // The gate must therefore *reach* the value rather than only look at its prototype: reading a
  // branch is what separates a Result from something wearing its prototype. This is the outbound
  // rule only. The inbound action gate already refuses both shapes by the same reasoning.
  const brandless = Object.create(Result.prototype);
  const proxied = new Proxy(OK, {});
  for (const [label, impostor] of [["a brandless Result impostor", brandless], ["a proxied Result", proxied]]) {
    assert.equal(
      Object.getPrototypeOf(impostor), Result.prototype,
      `${label} must answer Result.prototype, or this row is not testing the gap it exists for`,
    );
    await assertRejectsTypeError(() => build({ handler: () => impostor }).execute(commandOf()), `a handler returning ${label}`);
  }
  // The gate runs after the await, not only on the synchronous return path, so an impostor cannot
  // arrive by the async door once the direct one is shut.
  await assertRejectsTypeError(() => build({ handler: async () => proxied }).execute(commandOf()), "an async handler resolving to a proxied Result");
  // The real thing still passes, so the rule above is a gate and not a wall: a genuine Result comes
  // back by identity exactly as it did before this row was added.
  assert.equal(await build({ handler: () => OK }).execute(commandOf()), OK, "a real Result still returns by identity");
});

test("a thrown or rejected value propagates by identity, and the contract stays deterministic and stateless", async () => {
  // Unchanged means unchanged: the same object, not a copy, not a wrapper, not a re-typed error.
  // A contract that rewrote what a handler threw would destroy the one piece of evidence the
  // caller's own error handling was written against.
  const boom = new RangeError("MARKER_thrown_9f31");
  for (const [label, handler] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
  ]) {
    const caught = await rejectionOf(build({ handler }).execute(commandOf()));
    assert.equal(caught, boom, `${label}: the very value the handler threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_thrown_9f31", `${label}: and its message must be untouched`);
  }
  // Non-Error throws propagate on exactly the same terms; a contract that only preserved Errors
  // would quietly normalise everything else.
  for (const thrown of ["a string failure", 0, null, undefined, false, { code: "X_Y" }, OK]) {
    const caught = await rejectionOf(build({ handler: () => { throw thrown; } }).execute(commandOf()));
    assert.equal(caught, thrown, `a thrown ${inspectShort(thrown)} must propagate by identity`);
  }
  // A propagated throw is not a synchronous throw: it still arrives through the Promise.
  let returned;
  assert.doesNotThrow(() => { returned = build({ handler: () => { throw boom; } }).execute(commandOf()); }, "a throwing handler must not make execute throw synchronously");
  assert.ok(returned instanceof Promise, "a throwing handler must still yield a Promise");
  assert.equal(await rejectionOf(returned), boom);

  // Stateless: one use case, many executions, no accumulation and no drift. The instance is the
  // declaration and nothing else, so nothing about it may change by being used.
  let count = 0;
  const counting = build({ handler: () => { count += 1; return OK; } });
  const action = commandOf();
  const before = action.toString();
  const results = await Promise.all([counting.execute(action), counting.execute(commandOf()), counting.execute(action)]);
  assert.equal(count, 3, "each execution must reach the handler exactly once");
  for (const result of results) assert.equal(result, OK, "every execution must return the same Result reference the handler gave");
  assert.equal(action.toString(), before, "executing must not mutate the action");
  assert.equal(counting.kind, "command", "the declaration must survive execution unchanged");
  assert.equal(counting.name, NAME);
  assert.equal(counting.version, VERSION);
  assert.ok(Object.isFrozen(counting), "the instance must still be frozen after use");
  assert.deepEqual(Object.getOwnPropertyNames(counting), [], "and must still carry no own property");
  // A refusal is deterministic too: the same bad action refused twice, the same way, with the
  // handler untouched both times.
  await assertRejectsTypeError(() => counting.execute(queryOf()), "the first refusal");
  await assertRejectsTypeError(() => counting.execute(queryOf()), "the second refusal");
  assert.equal(count, 3, "a refusal must never reach the handler");
  // Two independently declared use cases over the same coordinates behave identically and share
  // nothing — there is no module-level state for them to meet in.
  const first = build();
  const second = build();
  assert.notEqual(first, second, "two declarations are two use cases");
  assert.equal(await first.execute(commandOf()), await second.execute(commandOf()), "and they answer identically");
});
