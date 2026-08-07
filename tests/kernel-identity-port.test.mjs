import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ActorId, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

// =====================================================================================
// P-M1-06 — the Identity port, frozen as a public surface
//
// This file is the whole observable surface of src/application/identity.mjs: one exported class that
// takes exactly one collaborator function and guarantees what the caller receives when it asks who
// is acting. It is written before the module exists, so every assertion here is a requirement rather
// than a description of something already built.
//
// The scope is the port and nothing beyond it. A port says what a boundary must have; it is never
// evidence that anything has been built behind one. Nothing here may be read as a claim that this
// kernel can establish who is calling it, that any caller has been authenticated, that a session,
// token or directory has been reached, or that any exit criterion has been closed.
//
// What this port actually promises, stated plainly so nobody has to infer it:
//
//   - `current()` calls its collaborator exactly once, with zero arguments and an undefined
//     receiver, awaits whatever came back, and either resolves with that value — when it is a
//     genuine `Principal`, admitted by *both* prototype identity and a private-brand probe — as the
//     very same object it already was, or rejects. There is no third outcome.
//
// And what it explicitly does *not* promise, because an identity port is the single easiest place in
// a kernel to accidentally claim more than was built:
//
//   - not that the principal is *true*. Nothing here compares the collaborator against anything, so
//     a conforming collaborator may hand back a principal for a tenant that closed last year and
//     this port will pass it straight through. The Domain brand proves that a `Principal` was
//     *constructed* through its own constructor and therefore satisfies its own invariants. It
//     proves nothing whatsoever about whether that principal is currently, actually, the caller.
//   - not that the caller may do anything. There is no authentication, authorization, session,
//     token, role, scope, permission, Policy, tenant-membership truth or freshness here, and none
//     belongs here. A port that answered "who" and "may they" at once would make every caller that
//     needs the first depend on a model of the second.
//   - not that readings are cached, stable, repeatable or ordered. Two calls may answer with two
//     different principals, and the second may settle before the first. Both are admitted, because
//     noticing either would mean remembering the previous answer, and a port that remembered would
//     be answering partly from itself rather than wholly from its collaborator.
//
// There is therefore no stored principal, no held promise, no flag and no queue in the module under
// test: two calls on one instance meet nowhere, and two instances share nothing, because there is
// nothing for them to share. That is not an omission to be filled in later — it is the whole reason
// the list above can be honest.
//
// The frozen non-goals: no authentication, authorization, session, token, role, scope, permission,
// Policy, tenant-membership truth, freshness, store, persistence, adapter, clock, randomness,
// environment, I/O or database; no Audit and no Outbox; no validation boundary and no composition
// root. No existing contract, version, changelog or authority state is touched by this package, and
// none may be read into it.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module must
// fail every row here by name rather than collapsing the file into a single load error: sixteen
// named failures are the RED specification, and one import error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/identity.mjs";

/** The five modules that already exist, with the import and export sets their packages froze. */
const EXISTING = [
  { path: "src/domain/identity-primitives.mjs", imports: ["node:crypto"], exports: ["ActorId", "CausationId", "CorrelationId", "IdempotencyKey", "Principal", "TenantId"] },
  { path: "src/application/action-primitives.mjs", imports: ["../domain/identity-primitives.mjs"], exports: ["Command", "KernelError", "Query", "Result"] },
  { path: "src/application/use-case.mjs", imports: ["./action-primitives.mjs"], exports: ["UseCase"] },
  { path: "src/application/unit-of-work.mjs", imports: [], exports: ["UnitOfWork"] },
  { path: "src/application/clock.mjs", imports: [], exports: ["Clock"] },
];

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
 * Line-based on purpose: this module must explain in prose why it refuses to answer "may they" as
 * well as "who", and a scan that could not tell the explanation from the deed would forbid the
 * explanation.
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

const importsOf = (text) =>
  [...new Set([...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]))].sort();

/** A short, safe rendering for assertion messages — never used to build an expected value. */
function inspectShort(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `function ${value.name || "anonymous"}`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
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
 * `current` always returns a Promise, so a synchronous throw is a contract breach even when the
 * thrown value is the right one: a caller that wrote `identity.current().catch(...)` would never
 * reach its handler. The facts are asserted separately so a failure says which one broke.
 */
async function assertRejects(call, label) {
  let promise;
  assert.doesNotThrow(() => { promise = call(); }, `${label}: current must never throw synchronously; it always returns a Promise`);
  assert.ok(promise instanceof Promise, `${label}: current must return a Promise`);
  const error = await rejectionOf(promise);
  assert.notEqual(error, NO_REJECTION, `${label}: must reject rather than resolve`);
  return error;
}

async function assertRejectsTypeError(call, label) {
  const error = await assertRejects(call, label);
  assert.ok(error instanceof TypeError, `${label}: must reject with a TypeError, got ${inspectShort(error)}`);
  return error;
}

// -------------------------------------------------------------------------------------
// Fixtures.
//
// Every genuine Principal below is built through the Domain constructor that owns it. This test
// file never rebuilds Principal, TenantId or ActorId, and neither may the module under test: the
// brand this port probes is meaningful precisely because only that constructor can install it.
// -------------------------------------------------------------------------------------

const TENANT_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TENANT_B = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ACTOR_A = "operator@example.test";
const ACTOR_B = "svc-billing-worker";

const principalOf = (tenant, actor) => new Principal(new TenantId(tenant), new ActorId(actor));

const PRINCIPAL_A = principalOf(TENANT_A, ACTOR_A);
const PRINCIPAL_B = principalOf(TENANT_B, ACTOR_B);

/**
 * The same probe the module under test must capture: the getter installed on the frozen
 * `Principal.prototype` for `tenantId`.
 *
 * It is read here for one reason — to demonstrate, in this file, that each half of the admission
 * rule accepts something the other half rejects. That is what makes the two-half requirement a
 * requirement rather than a preference.
 */
const brandProbe = Object.getOwnPropertyDescriptor(Principal.prototype, "tenantId").get;

const brandAnswers = (value) => {
  try {
    brandProbe.call(value);
    return true;
  } catch {
    return false;
  }
};

/** An Identity built through the module under test. Every caller reaches the guard through mod(). */
const build = (current) => new (mod().Identity)({ current });

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

// -------------------------------------------------------------------------------------
// A1–A3. The module surface, the single import it is allowed, and the vocabulary it never carries.
// -------------------------------------------------------------------------------------

test("the module exports exactly Identity, re-exports nothing, and no later-package surface stands beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["Identity"], "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  assert.equal(typeof m.Identity, "function", "Identity must be a class");
  assert.equal(Object.getPrototypeOf(m.Identity), Function.prototype, "Identity must extend nothing");
  // Each absent name is a whole concern this package has not started. They are listed rather than
  // summarised because the failure they guard against is one of them appearing alone, quietly, as
  // "just a small helper" beside the port. Every one of them is a question about *permission*,
  // *provenance* or *storage*, and this port answers none of the three.
  for (const absent of [
    "IdentityPort", "CurrentPrincipal", "PrincipalProvider", "PrincipalResolver", "ActorResolver",
    "TenantResolver", "Authenticator", "Authentication", "Authorization", "AuthN", "AuthZ",
    "Session", "SessionStore", "Token", "TokenVerifier", "Claims", "Credential", "Login",
    "Role", "Scope", "Permission", "Grant", "Policy", "PolicyPort", "Membership", "Tenancy",
    "Impersonation", "OnBehalfOf", "Delegation", "Freshness", "Revocation",
    "ClockPort", "Clock", "AuditPort", "OutboxPort", "RepositoryPort", "Cache", "Store",
    "ValidationBoundary", "Validator", "validate", "CompositionRoot", "container", "configure",
    "register", "resolve", "Adapter", "Schema", "Sdk", "Database", "Connection", "Pool",
    "current", "currentPrincipal", "principalOf", "authenticate", "authorize", "can", "may",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the Identity port`);
  }
  // The one type this module is allowed to import must not be handed back out again. Re-exporting
  // `Principal` would give the kernel two front doors to one Domain contract, and the second would
  // be free to drift the day either module is versioned. The import exists to *probe* the brand,
  // never to republish the type that carries it.
  for (const borrowed of [
    "Principal", "TenantId", "ActorId", "CorrelationId", "CausationId", "IdempotencyKey",
    "UnitOfWork", "UseCase", "Command", "Query", "Result", "KernelError",
  ]) {
    assert.equal(m[borrowed], undefined, `${borrowed} is owned elsewhere and must not stand in this module's export set`);
  }
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; a port carries no version of its own`);
  }
  // The namespace object itself is not asserted symbol-free: a module namespace exotic object owns
  // Symbol.toStringTag by construction, so requiring zero symbols there would be a requirement on
  // the language rather than on this module. What the module actually controls is asserted instead.
  assert.deepEqual(Object.getOwnPropertySymbols(m.Identity), [], "Identity must carry no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.Identity.prototype), [Symbol.toStringTag],
    "Identity.prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.Identity.prototype), Object.prototype, "Identity must stand directly on Object");
  assert.ok(!(m.Identity.prototype instanceof Error), "an Identity is not an error type");
});

test("the module imports exactly Principal from the domain ring, nothing else, and no inner module imports it back", async () => {
  const text = code();
  // Exactly one import, pointing inward. Application-to-Domain is the only direction this module is
  // permitted to look, and the single named binding is the whole of what it may take: the brand it
  // probes lives on `Principal.prototype`, and nothing else in this kernel is any of its business.
  assert.deepEqual(
    importsOf(text), ["../domain/identity-primitives.mjs"],
    `${modulePath} must import from exactly one module, the domain identity primitives`,
  );
  const named = [...text.matchAll(/(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)];
  assert.equal(named.length, 1, `${modulePath} must carry exactly one named import statement`);
  assert.deepEqual(
    named[0][1].split(",").map((binding) => binding.trim()).filter(Boolean).sort(), ["Principal"],
    `${modulePath} must take exactly the Principal binding and no second name beside it`,
  );
  assert.equal(named[0][2], "../domain/identity-primitives.mjs", "and it must take it from the domain ring");
  assert.ok(!/\bas\s+\w/.test(named[0][1]), "the binding must not be renamed: a local alias hides which Domain type is being probed");
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(bare, [], `${modulePath} must carry no side-effect-only import`);
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import: it needs one type, not a module`);
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["a sibling in its own ring", /action-primitives|use-case|unit-of-work|clock/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
  assert.ok(!/export\s[^;\n]*\bfrom\s*["']/.test(text), `${modulePath} must not re-export from another module: the Principal it imports is probed, never republished`);
  // Dependency direction, proven from the other side too. Nothing already in the kernel may learn
  // about this module: a port is depended *on*, and the day an inner module imported it the arrow
  // would point outward and the onion would stop being one. Each is read comment-stripped, because
  // a comment naming this port is documentation and a code reference is a dependency.
  for (const existing of EXISTING) {
    const innerText = await readFile(path.join(root, existing.path), "utf8");
    const innerCode = stripComments(innerText);
    assert.ok(!/identity\.mjs/.test(innerCode), `${existing.path} must not import ${modulePath}`);
    assert.ok(!/\bIdentity\b/.test(innerCode), `${existing.path} must not name Identity in code`);
    // And the packages beside and beneath stay exactly as they froze themselves. This package
    // widens nothing in order to make room for a port: no new import, and no new exported name. In
    // particular the Domain module is *read* by this port and is not altered by it — the brand this
    // port probes must remain the brand that module already installed.
    assert.deepEqual(importsOf(innerCode), existing.imports, `${existing.path} keeps the import set its own package froze`);
    const namespace = await import(pathToFileURL(path.join(root, existing.path)).href);
    assert.deepEqual(Object.keys(namespace).sort(), existing.exports, `${existing.path} keeps the export set its own package froze`);
  }
});

test("the module reaches no ambient capability and carries none of the frozen non-goal vocabulary", () => {
  const text = code();
  // An identity port whose *own* behaviour could reach a store, a directory or a token verifier is
  // the one failure this package exists to prevent: it would be able to answer without its
  // collaborator, and every guarantee below would then describe something other than the thing
  // being called.
  for (const [label, pattern] of [
    ["process", /\bprocess\b/],
    ["the environment", /\benv\b/i],
    ["fetch", /\bfetch\s*\(/],
    ["globalThis", /\bglobalThis\b/],
    ["ambient time", /\bperformance\b|\bhrtime\b|\buptime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\brandomBytes\b|\bcrypto\b/],
    ["a timer", /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b|\breaddir\b/],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b/i],
    ["a database", /\bdatabase\b|\bpostgres|\bsqlalchemy\b|\bsqlite\b|\bSELECT\b|\bINSERT\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // The clock, named separately. A port that could read a time could compute a freshness, and a
  // freshness is an answer about whether a principal is *still* true — which is exactly the claim
  // this package refuses to make.
  for (const [label, pattern] of [
    ["a clock", /\bclock\b|\bnow\b/i],
    ["Date", /\bDate\b/],
    ["Temporal", /\bTemporal\b/],
    ["a timestamp", /\btimestamp\b|\bexpir|\bttl\b|\brefresh/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not name ${label}: this port answers who, never when or for how long`);
  }
  // The frozen non-goals, scanned in code rather than only asserted as absent exports. A private
  // cache is still a cache, and it would never show up in the export set.
  for (const [label, pattern] of [
    ["a cache", /\bcache\b|\bmemo/i],
    ["authentication", /\bauthenticat/i],
    ["authorization", /\bauthoriz|\bauthn\b|\bauthz\b/i],
    ["a session", /\bsession\b/i],
    ["a token", /\btoken\b|\bjwt\b|\boauth\b|\bbearer\b/i],
    ["a credential", /\bcredential|\blogin\b|\bpassword\b|\bsecret\b/i],
    ["a role", /\brole\b/i],
    ["a scope", /\bscope\b/i],
    ["a permission or grant", /\bpermission|\bgrant\b|\bentitle/i],
    ["a policy", /\bpolicy\b|\bpdp\b/i],
    ["tenant membership", /\bmembership\b|\bbelongs\s*To\b/i],
    ["freshness", /\bfresh/i],
    ["impersonation", /\bimpersonat|\bdelegat|\bonBehalfOf\b/i],
    ["revocation", /\brevok|\brevoc/i],
    ["a store or persistence", /\bstore\b|\bpersist|\bdirectory\b/i],
    ["a repository", /\brepositor/i],
    ["an outbox", /\boutbox\b/i],
    ["an audit trail", /\baudit\b/i],
    ["a retry", /\bretry\b|\bbackoff\b/i],
    ["a validation boundary", /\bvalidationBoundary\b/i],
    ["a composition root", /\bcompositionRoot\b|\bcontainer\b/i],
    ["a registry", /\bregistry\b|\bdispatcher\b/i],
    ["an adapter", /\badapter\b/i],
    ["a schema", /\bschema\b/i],
    ["an SDK", /\bsdk\b/i],
    ["a readiness or authority claim", /\breadiness\b|\bauthority\b|\bchangelog\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not carry ${label}`);
  }
  // The Domain types it has no import for, and must therefore not name either. A hand-rolled
  // reference to one of these would be this module rebuilding a value type it is only allowed to
  // recognise — and a rebuilt `Principal` carries a brand this port itself minted, which would make
  // the admission check a test of this module rather than of the Domain.
  for (const rebuilt of ["TenantId", "ActorId", "CorrelationId", "CausationId", "IdempotencyKey"]) {
    assert.ok(
      !new RegExp(`\\b${rebuilt}\\b`).test(text),
      `${modulePath} must not name ${rebuilt}: this port recognises a Principal, it never reconstructs one or its parts`,
    );
  }
  // The caller-side types it knows nothing about. An identity port that named a Command or a
  // UseCase would be growing an opinion about *why* it was asked.
  for (const borrowed of ["Result", "KernelError", "UseCase", "Command", "Query", "UnitOfWork"]) {
    assert.ok(
      !new RegExp(`\\b${borrowed}\\b`).test(text),
      `${modulePath} must not name ${borrowed}: an identity port knows nothing about its caller`,
    );
  }
});

// -------------------------------------------------------------------------------------
// B1–B2. Construction, and what a constructed Identity is.
// -------------------------------------------------------------------------------------

test("the constructor takes exactly one ordinary object holding exactly one current function, and never runs caller code to read it", () => {
  const m = mod();
  const fn = () => PRINCIPAL_A;
  assert.ok(build(fn) instanceof m.Identity, "the one-function port must construct");
  assert.equal(m.Identity.length, 1, "the constructor takes one options object, not a positional function");
  // A frozen options object is still an ordinary options object; refusing one would be a rule about
  // how carefully the caller held its own data.
  assert.doesNotThrow(() => new m.Identity(Object.freeze({ current: fn })), "a frozen options object is admissible");
  // Every flavour of function stays admissible. Refusing one would be a rule about how a caller
  // spelled its collaborator, which is not this port's business.
  for (const ok of [() => PRINCIPAL_A, function named() { return PRINCIPAL_A; }, async () => PRINCIPAL_A, class Who {}]) {
    assert.doesNotThrow(() => new m.Identity({ current: ok }), `current as ${inspectShort(ok)} is a legal collaborator`);
  }
  // Missing is refused rather than defaulted. There is no fallback principal, no anonymous, no
  // system and no root: an Identity that supplied its own answer would answer without the
  // collaborator, and the caller would never learn its identity port was never wired.
  throws(() => new m.Identity({}), "omitting current must be refused, never defaulted to an ambient or anonymous principal");
  throws(() => new m.Identity({ current: undefined }), "current is required and must not accept undefined");
  throws(() => new m.Identity({ current: null }), "current is required and must not accept null");
  for (const bad of [
    "current", 1, 0, true, false, [], {}, Symbol("current"), 7n,
    { call: () => PRINCIPAL_A }, { current: () => PRINCIPAL_A }, PRINCIPAL_A,
  ]) {
    throws(() => new m.Identity({ current: bad }), `current as ${inspectShort(bad)} is not a function`);
  }
  // A ready-made Principal is the sharpest of those: handing the value instead of the capability
  // would make this a holder rather than a port, and a holder answers the same thing forever.
  throws(() => new m.Identity({ current: PRINCIPAL_A }), "a Principal is not a collaborator: this port is handed a capability, never an answer");
  // An unknown key is refused rather than dropped, because silently ignoring one lets a caller
  // believe it configured something — a fallback, a policy, a cache — that nothing reads.
  for (const extra of ["currentFn", "identity", "principal", "provider", "fallback", "anonymous", "cache", "policy", "toJSON", "then"]) {
    throws(() => new m.Identity({ current: fn, [extra]: () => PRINCIPAL_A }), `an unknown option key ${extra} must be refused by name`);
  }
  throws(() => new m.Identity({ current: fn, [Symbol("hidden")]: () => PRINCIPAL_A }), "a symbol-keyed option member must be refused");
  // The key must be a plain, enumerable data property, and the descriptor must be read rather than
  // the value fetched. An accessor would run caller code during construction, and this row proves
  // the refusal happens *without* invoking it rather than merely after doing so.
  let accessorRan = false;
  const accessorOptions = { get current() { accessorRan = true; return fn; } };
  throws(() => new m.Identity(accessorOptions), "an accessor-defined current must be refused: reading an option may not run caller code");
  assert.equal(accessorRan, false, "and the accessor must never have been invoked: the descriptor is read, the value is not fetched");
  throws(
    () => new m.Identity(Object.defineProperty({}, "current", { value: fn, enumerable: false, configurable: true, writable: true })),
    "a non-enumerable current must be refused: an option nobody can enumerate is an option nobody can review",
  );
  // Ordinary means ordinary: prototype exactly Object.prototype, no exotic behaviour behind it.
  for (const notOrdinary of [
    Object.assign(Object.create(null), { current: fn }),
    Object.assign(Object.create({ inherited: true }), { current: fn }),
    Object.assign([], { current: fn }),
    Object.assign(function carrier() {}, { current: fn }),
    new (class Options { constructor() { this.current = fn; } })(),
  ]) {
    throws(() => new m.Identity(notOrdinary), `${inspectShort(notOrdinary)} is not an ordinary options object`);
  }
  // A hostile exotic carrier, watched. Ordinariness is settled before the key is looked at, so an
  // object whose prototype is already wrong must be refused without its `current` ever being read —
  // a capability object that could observe the read could hand a different function to the reader
  // than to the reviewer.
  const watched = [];
  const hostileCarrier = new Proxy(Object.create(null), {
    get(target, key, receiver) { watched.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
    getOwnPropertyDescriptor(target, key) { watched.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
    ownKeys(target) { watched.push("ownKeys"); return Reflect.ownKeys(target); },
  });
  throws(() => new m.Identity(hostileCarrier), "an exotic carrier with a null prototype must be refused");
  assert.ok(!watched.includes("get:current"), `the hostile carrier's current was fetched before it was refused: ${watched.join(", ")}`);
  // The residual on the other side of that rule, stated positively because the honest answer is
  // that it cannot be refused. A transparent proxy over legal options answers every question the
  // constructor is able to ask exactly as its target does — same prototype, same single own key,
  // same data descriptor, the same function by identity — and ECMAScript exposes no standard way to
  // ask whether an object is a proxy at all. Construction through one is therefore admitted here,
  // and this row records that as a known limit rather than pretending to a detection nothing can
  // perform.
  const proxiedOptions = new Proxy({ current: fn }, {});
  assert.equal(Object.getPrototypeOf(proxiedOptions), Object.prototype, "a transparent proxy reports the ordinary prototype");
  assert.deepEqual(Reflect.ownKeys(proxiedOptions), ["current"], "and exactly the one own key");
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(proxiedOptions, "current"),
    { value: fn, writable: true, enumerable: true, configurable: true },
    "and the identical data descriptor, holding the very same function",
  );
  assert.doesNotThrow(
    () => new m.Identity(proxiedOptions),
    "a transparent proxy over legal options is indistinguishable from those options and is therefore admitted: this port claims no proxy detection, because none exists to claim",
  );
  // An inherited current is not an own key: reading it would let a prototype somewhere else decide
  // what this port calls.
  throws(() => new m.Identity(Object.create({ current: fn })), "an inherited current must be refused: the option must be the caller's own");
  for (const notOptions of [undefined, null, "current", 1, true, [], () => PRINCIPAL_A, Symbol("options"), 7n]) {
    throws(() => new m.Identity(notOptions), `${inspectShort(notOptions)} is not an options object`);
  }
  throws(() => new m.Identity(), "construction with no options object at all must be refused");
});

test("a constructed Identity is frozen, own-property-free, tagged, exposes exactly current, and never hands its collaborator back", () => {
  const m = mod();
  const built = build(() => PRINCIPAL_A);
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.ok(Object.isFrozen(m.Identity.prototype), "Identity.prototype must be frozen");
  assert.ok(Object.isFrozen(m.Identity), "Identity itself must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "the collaborator is private state, not an own property");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.equal(built[Symbol.toStringTag], "Identity", "the instance must tag itself with its class name");
  assert.throws(() => { built.current = () => PRINCIPAL_A; }, TypeError, "assignment into a frozen instance must throw");
  // The public surface, frozen in both directions: these members and no others. Every name absent
  // here is a decision — an Identity is behaviour, not a value, so it has no equality and no
  // rendering, and a toJSON would put a live collaborator one serialisation away from a log.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Identity.prototype).sort(), ["constructor", "current"],
    "Identity.prototype must carry exactly constructor and current",
  );
  for (const absent of [
    "equals", "toJSON", "toString", "valueOf", "inspect", "principal", "tenantId", "actorId",
    "authenticate", "authorize", "assume", "impersonate", "withPrincipal", "of", "create", "from",
    "anonymous", "system", "root", "then",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m.Identity.prototype, absent), false,
      `${absent} must not appear on Identity.prototype`,
    );
  }
  assert.equal(m.Identity.prototype.toString, Object.prototype.toString, "toString must not be overridden");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Identity).sort(), ["length", "name", "prototype"],
    "Identity must carry no static factory, no registry and no lookup",
  );
  assert.equal(m.Identity.name, "Identity", "the class must be named Identity");
  // No getters on the named surface. A getter is how state becomes readable by accident, and the
  // one thing this instance holds is exactly the thing that must never be readable.
  for (const name of Object.getOwnPropertyNames(m.Identity.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(m.Identity.prototype, name);
    assert.equal(descriptor.get, undefined, `${name} must not be a getter`);
    assert.equal(descriptor.set, undefined, `${name} must not be a setter`);
  }
  // Leak probes. A collaborator that can be reached off the instance can be called directly, and a
  // caller that can call it directly has walked straight around the only thing this port does.
  const marked = build(function MARKER_current_8a52() { return PRINCIPAL_A; });
  assert.equal(marked.current, m.Identity.prototype.current, "current must be the prototype method, not a per-instance copy closing over the collaborator");
  for (const [label, rendered] of [
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(marked))],
    ["own keys", JSON.stringify(Object.keys(marked))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(marked))],
    ["prototype descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Identity.prototype))],
    ["class descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Identity))],
    ["JSON", JSON.stringify(marked) ?? "undefined"],
    ["the string form", String(marked)],
    ["the class source", String(m.Identity.prototype.current)],
  ]) {
    assert.ok(!rendered.includes("MARKER_"), `the collaborator leaked through ${label}: ${rendered}`);
  }
});

// -------------------------------------------------------------------------------------
// C1–C2. The call: what current promises, and exactly how the collaborator is invoked.
// -------------------------------------------------------------------------------------

test("current is a zero-argument async method, always returns a native Promise, and awaits whatever the collaborator produced", async () => {
  const m = mod();
  assert.equal(
    Object.prototype.toString.call(m.Identity.prototype.current), "[object AsyncFunction]",
    "current must be declared async: a caller that wrote identity.current().catch(...) must reach its handler on every path, and async is what makes that true by construction rather than by remembering",
  );
  assert.equal(m.Identity.prototype.current.length, 0, "current takes no argument: there is nothing a caller may pass to a question about who is already acting");
  // Extra arguments are ignored rather than refused — arity zero is what the method promises, not a
  // rule about how the caller spelled the call site. It is emphatically not a hint that a caller may
  // narrow, scope or parameterise the answer.
  assert.ok(
    Object.is(await build(() => PRINCIPAL_A).current("tenant", 1, null), PRINCIPAL_A),
    "surplus arguments must not change the answer: there is no per-tenant or per-scope variant of this question",
  );
  // A native Promise, not a thenable and not a subclass: a caller may hand this straight to
  // Promise.all or await it twice, and either would break on a hand-rolled thenable.
  for (const [label, behaviour] of [
    ["a synchronous value", () => PRINCIPAL_A],
    ["a resolved promise", () => Promise.resolve(PRINCIPAL_A)],
    ["a promise that settles later", () => settledLater(PRINCIPAL_A)],
    ["an async function", async () => PRINCIPAL_A],
    ["a thenable", () => ({ then(resolve) { resolve(PRINCIPAL_A); } })],
    ["a thenable that settles later", () => ({ then(resolve) { settledLater(PRINCIPAL_A).then(resolve); } })],
  ]) {
    const identity = build(behaviour);
    let returned;
    assert.doesNotThrow(() => { returned = identity.current(); }, `${label}: current must never throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: current must return a Promise`);
    assert.equal(Object.getPrototypeOf(returned), Promise.prototype, `${label}: it must be a native Promise, not a subclass or a thenable`);
    const value = await returned;
    assert.ok(Object.is(value, PRINCIPAL_A), `${label}: the collaborator's principal must be awaited and returned as the very same object`);
  }
  // The port is asynchronous by construction, and this row says so rather than letting a reader
  // assume the collaborator was consulted before current() returned.
  let consulted = false;
  const pending = build(async () => { await settledLater(null); consulted = true; return PRINCIPAL_A; }).current();
  assert.equal(consulted, false, "current must return before a slow collaborator has settled: this port is asynchronous, and no principal is available synchronously");
  assert.ok(Object.is(await pending, PRINCIPAL_A), "and the awaited answer arrives afterwards");
  // A resolution that is not a genuine Principal is a rejection, whichever route it arrived by.
  for (const [label, behaviour] of [
    ["a synchronous non-principal", () => ({ tenantId: TENANT_A, actorId: ACTOR_A })],
    ["a non-principal from a promise", () => Promise.resolve({ tenantId: TENANT_A, actorId: ACTOR_A })],
    ["a non-principal from a thenable", () => ({ then(resolve) { resolve({ tenantId: TENANT_A, actorId: ACTOR_A }); } })],
    ["nothing at all", () => undefined],
  ]) {
    await assertRejectsTypeError(() => build(behaviour).current(), label);
  }
});

test("each call invokes the collaborator exactly once, with zero arguments and an undefined this", async () => {
  mod();
  const record = recorder();
  const identity = build(record.make("current", () => PRINCIPAL_A));
  assert.ok(Object.is(await identity.current(), PRINCIPAL_A), "the principal comes back");
  assert.equal(record.countOf("current"), 1, "one call to current is one call to the collaborator — not zero, not two");
  assert.equal(record.firstOf("current").count, 0, "the collaborator is called with zero arguments: it is the thing that knows who is acting, not a thing that is told");
  assert.deepEqual(record.firstOf("current").args, [], "and nothing at all is passed to it");
  // `this` is undefined: a collaborator that could reach the port could call it back, and a
  // collaborator that received the options object could read a member the caller never exposed. The
  // field is lifted out before being called, which is what makes an undefined receiver true by
  // construction rather than by discipline.
  assert.equal(record.firstOf("current").self, undefined, "the collaborator must be invoked with an undefined this");
  assert.notEqual(record.firstOf("current").self, identity, "it must not receive the Identity as this");
  // Three more calls, and the count tracks them exactly. A collaborator called twice per answer is a
  // port that consulted its source and then consulted it again to check — which is precisely the
  // kind of quiet extra read a port must not perform on behalf of an arbitrary collaborator, and
  // exactly what a cache would hide by making the count *lower* instead.
  for (let round = 0; round < 3; round += 1) {
    assert.ok(Object.is(await identity.current(), PRINCIPAL_A), `round ${round} must resolve`);
  }
  assert.equal(record.countOf("current"), 4, "four questions are exactly four collaborator calls: not one call and three cached answers");
  for (const call of record.calls) {
    assert.equal(call.count, 0, "every call must pass zero arguments");
    assert.equal(call.self, undefined, "every call must observe an undefined this");
  }
  // A refused answer still costs exactly one call: the port does not retry, and does not ask a
  // second time in the hope of a better principal.
  const failing = recorder();
  await assertRejectsTypeError(() => build(failing.make("current", () => ({ tenantId: TENANT_A }))).current(), "a non-principal answer");
  assert.equal(failing.countOf("current"), 1, "a refused answer is one call, never a retry");
  const throwing = recorder();
  await assertRejects(() => build(throwing.make("current", () => { throw new RangeError("boom"); })).current(), "a throwing collaborator");
  assert.equal(throwing.countOf("current"), 1, "a failed answer is one call, never a retry");
});

// -------------------------------------------------------------------------------------
// D1–D4. Admission: identity by Object.is, both halves of the brand, the lookalikes, and the
// refusal that says nothing.
// -------------------------------------------------------------------------------------

test("a genuine Principal is answered as the very same object by Object.is, never as a value-equal rebuild", async () => {
  mod();
  // The twin is the whole point of this row. It is value-equal to PRINCIPAL_A in both directions,
  // it is a genuine Principal, and it is a different object. A port that reconstructed the
  // principal it was handed — reading tenantId and actorId back off it and calling the Domain
  // constructor again — would produce exactly this twin, and would satisfy every equality-based
  // assertion anyone might write. Object.is is what refuses it.
  const twin = principalOf(TENANT_A, ACTOR_A);
  assert.ok(twin.equals(PRINCIPAL_A) && PRINCIPAL_A.equals(twin), "the twin is value-equal to the original in both directions");
  assert.ok(!Object.is(twin, PRINCIPAL_A), "and it is nonetheless a different object");
  const answered = await build(() => PRINCIPAL_A).current();
  assert.ok(
    Object.is(answered, PRINCIPAL_A),
    "the port must answer with the very object its collaborator produced: this port hands the principal on, it does not rebuild it",
  );
  assert.ok(
    !Object.is(answered, twin),
    "a port that rebuilt a value-equal Principal would pass every equals-based check and must still fail here",
  );
  assert.equal(answered.tenantId, PRINCIPAL_A.tenantId, "the very same TenantId instance travels with it, uncopied");
  assert.equal(answered.actorId, PRINCIPAL_A.actorId, "and the very same ActorId instance");
  // Delivered through each admissible route, because identity cannot depend on how the collaborator
  // chose to hand the value over.
  assert.ok(Object.is(await build(() => Promise.resolve(PRINCIPAL_A)).current(), PRINCIPAL_A), "via a promise it must be identical too");
  assert.ok(Object.is(await build(() => settledLater(PRINCIPAL_A)).current(), PRINCIPAL_A), "via a promise that settles later, identical too");
  assert.ok(Object.is(await build(() => ({ then(resolve) { resolve(PRINCIPAL_A); } })).current(), PRINCIPAL_A), "via a thenable, identical too");
  // A second, different principal travels on exactly the same terms. One instance is not calibrated
  // to one principal.
  assert.ok(Object.is(await build(() => PRINCIPAL_B).current(), PRINCIPAL_B), "a different genuine principal is answered identically");
  const alternating = [PRINCIPAL_A, PRINCIPAL_B, PRINCIPAL_A, PRINCIPAL_B];
  let index = 0;
  const shifting = build(() => alternating[index++]);
  for (const expected of alternating) {
    assert.ok(Object.is(await shifting.current(), expected), "each call answers with that call's own principal");
  }
  assert.equal(index, 4, "and the collaborator was consulted once per call");
});

test("admission needs both halves: prototype identity alone admits a shaped impostor, and the private brand alone admits a subclass", async () => {
  const m = mod();
  const real = build(() => PRINCIPAL_A);
  assert.ok(Object.is(await real.current(), PRINCIPAL_A), "the genuine principal is admitted, which is what makes the refusals below meaningful");
  // ---- Half one is not enough. ----
  // An impostor built straight on the frozen prototype. It answers `instanceof`, it carries the
  // tag, it renders identically, and its prototype *is* Principal.prototype — so the plausible
  // implementation of this check, a bare prototype comparison, admits it. It holds no private
  // field, so it is not a Principal at all: nothing ever ran the Domain constructor for it, and
  // therefore none of that constructor's invariants were ever checked.
  const shaped = Object.create(Principal.prototype);
  assert.equal(Object.getPrototypeOf(shaped), Principal.prototype, "the shaped impostor passes a prototype-identity check exactly");
  assert.ok(shaped instanceof Principal, "and it passes instanceof, which walks the same chain");
  assert.equal(shaped[Symbol.toStringTag], "Principal", "and it inherits the class-name tag");
  assert.equal(Object.prototype.toString.call(shaped), "[object Principal]", "and it renders exactly like the real thing");
  assert.equal(brandAnswers(shaped), false, "only the private brand tells it apart: the tenantId getter refuses it");
  await assertRejectsTypeError(() => build(() => shaped).current(), "an Object.create(Principal.prototype) impostor");
  // The same impostor dressed to look complete. Own data properties shadow the prototype accessors,
  // so it reads back exactly like a principal to anything that merely looks at its shape.
  const dressed = Object.create(Principal.prototype);
  Object.defineProperty(dressed, "tenantId", { value: PRINCIPAL_A.tenantId, enumerable: true });
  Object.defineProperty(dressed, "actorId", { value: PRINCIPAL_A.actorId, enumerable: true });
  assert.equal(dressed.tenantId, PRINCIPAL_A.tenantId, "the dressed impostor reads back a genuine TenantId");
  assert.equal(dressed.actorId, PRINCIPAL_A.actorId, "and a genuine ActorId");
  assert.equal(brandAnswers(dressed), false, "and the brand still refuses it, because own properties are not the private field");
  await assertRejectsTypeError(() => build(() => dressed).current(), "a shaped impostor carrying genuine parts");
  // ---- Half two is not enough either. ----
  // A subclass instance. The Domain constructor really did run for it, so the private field is
  // installed and the brand probe answers — a brand-only check admits it. Its prototype is not
  // Principal.prototype, and it may carry behaviour, state and overrides the Domain never saw.
  class DerivedPrincipal extends Principal {
    get [Symbol.toStringTag]() { return "Principal"; }
  }
  const derived = new DerivedPrincipal(new TenantId(TENANT_A), new ActorId(ACTOR_A));
  assert.equal(brandAnswers(derived), true, "the subclass instance passes a brand-only check: the Domain constructor installed the private field");
  assert.notEqual(Object.getPrototypeOf(derived), Principal.prototype, "but its prototype is the derived one, not Principal.prototype");
  assert.ok(derived instanceof Principal, "so instanceof admits it, and instanceof is therefore not the check either");
  assert.equal(Object.prototype.toString.call(derived), "[object Principal]", "and it can render identically");
  await assertRejectsTypeError(() => build(() => derived).current(), "a Principal subclass instance");
  // ---- Therefore both halves are load-bearing, and this row states it as a fact. ----
  assert.notEqual(
    Object.getPrototypeOf(shaped) === Principal.prototype, Object.getPrototypeOf(derived) === Principal.prototype,
    "the two impostors disagree on the prototype half",
  );
  assert.notEqual(
    brandAnswers(shaped), brandAnswers(derived),
    "and they disagree on the brand half: each is admitted by exactly the check the other defeats, which is why neither check alone is the contract",
  );
  // And the genuine article passes both, which is what stops "refuse everything" from satisfying
  // this row.
  assert.equal(Object.getPrototypeOf(PRINCIPAL_A), Principal.prototype, "the genuine principal passes the prototype half");
  assert.equal(brandAnswers(PRINCIPAL_A), true, "and the brand half");
  assert.ok(Object.is(await build(() => PRINCIPAL_A).current(), PRINCIPAL_A), "and it is still admitted after all of the above");
});

test("lookalikes, proxies and near-misses are refused, and the port never reconstructs what it refused", async () => {
  mod();
  // A transparent proxy over a *genuine* Principal. The instance behind it is real, its prototype
  // reads as Principal.prototype, and it passes instanceof — and it is still refused, because a
  // private field is looked up on the proxy rather than on its target. That is a residual worth
  // stating plainly rather than a bug: wrapping a principal in the most ordinary proxy there is
  // makes it unusable here, and this port refuses it deliberately rather than guessing past it.
  const proxied = new Proxy(PRINCIPAL_A, {});
  assert.equal(Object.getPrototypeOf(proxied), Principal.prototype, "the proxy reports the genuine prototype");
  assert.ok(proxied instanceof Principal, "and passes instanceof");
  assert.equal(brandAnswers(proxied), false, "and fails the brand probe, because private fields do not pass through a proxy");
  await assertRejectsTypeError(() => build(() => proxied).current(), "a transparent proxy over a genuine Principal");
  // A forwarding proxy that rebinds each method to its target answers every *public* question
  // exactly as the real principal does — and is refused on the same grounds, because the brand
  // probe is invoked with the candidate as its receiver rather than through the trap.
  const forwarding = new Proxy(PRINCIPAL_A, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.equal(forwarding.tenantId, PRINCIPAL_A.tenantId, "the forwarding proxy hands back the genuine TenantId");
  assert.equal(String(forwarding), String(PRINCIPAL_A), "and renders identically");
  await assertRejectsTypeError(() => build(() => forwarding).current(), "a forwarding proxy over a genuine Principal");
  // Everything that merely looks like a principal.
  class NotAPrincipal {
    constructor() { this.tenantId = PRINCIPAL_A.tenantId; this.actorId = PRINCIPAL_A.actorId; }
    equals() { return true; }
    toJSON() { return PRINCIPAL_A.toJSON(); }
    get [Symbol.toStringTag]() { return "Principal"; }
  }
  const lookalikes = [
    ["a plain object with the right keys", { tenantId: PRINCIPAL_A.tenantId, actorId: PRINCIPAL_A.actorId }],
    ["a plain object with string parts", { tenantId: TENANT_A, actorId: ACTOR_A }],
    ["a structural copy", { ...PRINCIPAL_A, tenantId: PRINCIPAL_A.tenantId, actorId: PRINCIPAL_A.actorId }],
    ["a JSON round trip", JSON.parse(JSON.stringify(PRINCIPAL_A))],
    ["a hand-rolled class wearing the tag", new NotAPrincipal()],
    ["a null-prototype shape", Object.assign(Object.create(null), { tenantId: TENANT_A, actorId: ACTOR_A })],
    ["another Domain value type", PRINCIPAL_A.tenantId],
    ["a second Domain value type", PRINCIPAL_A.actorId],
    ["the Principal class itself", Principal],
    ["the frozen Principal prototype", Principal.prototype],
  ];
  for (const [label, candidate] of lookalikes) {
    await assertRejectsTypeError(() => build(() => candidate).current(), label);
  }
  // Refused, not repaired. A port that read the parts off a lookalike and built a real Principal
  // from them would be deciding what its collaborator meant, and the next collaborator to arrive
  // would be calibrated against a repair rather than against the contract.
  const repairable = { tenantId: PRINCIPAL_A.tenantId, actorId: PRINCIPAL_A.actorId };
  const outcome = await rejectionOf(build(() => repairable).current());
  assert.notEqual(outcome, NO_REJECTION, "a repairable lookalike must reject");
  assert.ok(!(outcome instanceof Principal), "and must not be answered with a Principal assembled out of its parts");
  assert.ok(outcome instanceof TypeError, "the refusal is a TypeError");
});

test("the brand refusal is one fixed TypeError that names no candidate, no tenant and no actor", async () => {
  mod();
  // Three refused candidates, each carrying a marker in a different place: an own property, a
  // genuine ActorId built from a marked string, and a bare lookalike. None of the three may reach
  // the caller through the refusal. A principal names a real tenant and a real person or service,
  // and an error message is the one place a value walks straight into a log nobody redacted.
  const markedImpostor = Object.create(Principal.prototype);
  Object.defineProperty(markedImpostor, "actorId", { value: "MARKER_actor_4d17", enumerable: true });
  Object.defineProperty(markedImpostor, "tenantId", { value: "MARKER_tenant_4d17", enumerable: true });
  class MarkedPrincipal extends Principal {}
  const markedSubclass = new MarkedPrincipal(new TenantId(TENANT_B), new ActorId("MARKER_actor_4d17"));
  const markedLookalike = { tenantId: "MARKER_tenant_4d17", actorId: "MARKER_actor_4d17" };
  const marked = [
    ["a shaped impostor carrying marked own properties", markedImpostor],
    ["a subclass instance carrying a marked ActorId", markedSubclass],
    ["a bare lookalike carrying marked strings", markedLookalike],
  ];
  const messages = [];
  for (const [label, candidate] of marked) {
    const error = await assertRejectsTypeError(() => build(() => candidate).current(), label);
    messages.push(error.message);
    for (const [where, rendered] of [
      ["the message", String(error?.message ?? "")],
      ["the string form", String(error)],
      ["the stack", String(error?.stack ?? "")],
      ["the own properties", JSON.stringify(Object.getOwnPropertyDescriptors(Object(error)))],
      ["the cause", String(error?.cause ?? "")],
    ]) {
      assert.ok(!rendered.includes("MARKER_"), `${label}: the refused candidate was echoed through ${where}: ${rendered}`);
      assert.ok(!rendered.includes(TENANT_A) && !rendered.includes(TENANT_B), `${label}: a tenant identifier was echoed through ${where}`);
    }
  }
  // Fixed, not composed. One message for every brand refusal, so the refusal itself cannot become a
  // side channel that tells a caller *which* of its several near-misses it got wrong.
  assert.equal(new Set(messages).size, 1, `the brand refusal must be one fixed message, and three distinct candidates produced: ${[...new Set(messages)].join(" | ")}`);
  // The same fixed message reaches the genuinely different shapes too.
  const shaped = Object.create(Principal.prototype);
  const other = await assertRejectsTypeError(() => build(() => shaped).current(), "an unmarked shaped impostor");
  assert.equal(other.message, messages[0], "an unmarked candidate must be refused with the identical message");
  const notAnObject = await assertRejectsTypeError(() => build(() => "a principal, honestly").current(), "a string");
  assert.equal(notAnObject.message, messages[0], "and so must a value that is not an object at all");
  // The message must not carry the vocabulary this port refuses to own: a refusal that mentioned
  // authentication or permission would be documenting a boundary that does not exist here.
  for (const forbidden of [/\bauthenticat/i, /\bauthoriz/i, /\bpermission/i, /\bsession\b/i, /\btoken\b/i, /\bpolicy\b/i]) {
    assert.ok(!forbidden.test(messages[0]), `the refusal message must not name ${forbidden}: this port refuses a value, it does not refuse an access`);
  }
  assert.ok(messages[0].length > 0, "and the refusal must still say something: a silent TypeError explains nothing");
});

// -------------------------------------------------------------------------------------
// E1–E2. Genuine instances only, and the residual that awaiting an arbitrary value leaves behind.
// -------------------------------------------------------------------------------------

test("only a genuine Principal is admitted, and no coercion hook is ever consulted", async () => {
  mod();
  // Everything that is not a Principal is refused as it stands. A port that coerced would be running
  // caller code inside its own admission check, and the value it admitted would not be the value it
  // was handed.
  for (const notAPrincipal of [
    undefined, null, 0, -0, 1, NaN, Infinity, true, false, 20260807n, Symbol("principal"),
    "principal", [PRINCIPAL_A], [], {}, () => PRINCIPAL_A, new Error("principal"), new Map(), new Set(),
    new Date(0), Promise.resolve(), Object.create(null),
  ]) {
    await assertRejectsTypeError(() => build(() => notAPrincipal).current(), `an answer of ${inspectShort(notAPrincipal)}`);
  }
  // An array holding the genuine principal is the sharpest of those: everything the caller wanted is
  // in there, and the port must still refuse rather than unwrap. Unwrapping would be this port
  // deciding what a collaborator meant.
  await assertRejectsTypeError(() => build(() => [PRINCIPAL_A]).current(), "a genuine principal inside an array");
  await assertRejectsTypeError(() => build(() => ({ principal: PRINCIPAL_A })).current(), "a genuine principal inside a wrapper object");
  // Instrumented coercion hooks, none of which may fire. The object below is not a thenable, so
  // nothing about awaiting it can excuse a call to any of these.
  const traps = [];
  const coercible = {
    toString() { traps.push("toString"); return String(PRINCIPAL_A); },
    valueOf() { traps.push("valueOf"); return PRINCIPAL_A; },
    toJSON() { traps.push("toJSON"); return PRINCIPAL_A.toJSON(); },
    [Symbol.toPrimitive](hint) { traps.push(`toPrimitive:${hint}`); return String(PRINCIPAL_A); },
  };
  await assertRejectsTypeError(() => build(() => coercible).current(), "an object that would coerce into something principal-shaped");
  assert.deepEqual(traps, [], `a coercion hook was consulted: ${traps.join(", ")} — this port recognises a value, it never converts one`);
  // The same object handed over through a promise. The extra hop must not change the answer, and
  // must not turn the object into the thing it is willing to pretend to be.
  await assertRejectsTypeError(() => build(() => Promise.resolve(coercible)).current(), "the same object delivered through a promise");
  assert.deepEqual(traps, [], "and still no coercion hook was consulted");
  // A `valueOf` that returns the genuine principal is the trap this row exists for: one call to it
  // would turn a refusal into an admission, and it must never be made.
  assert.ok(Object.is(coercible.valueOf(), PRINCIPAL_A), "this file can reach the genuine principal through valueOf");
  assert.deepEqual(traps, ["valueOf"], "which proves the hook works and that the port simply never called it");
});

test("awaiting an arbitrary value leaves a real residual: one unavoidable then lookup, and a thenable that runs its own code", async () => {
  mod();
  // A non-thenable hostile object, watched on every trap. This row does *not* claim the port never
  // touches what its collaborator returned — it claims the only touches are the `then` lookup that
  // `await` performs on the language's behalf and the prototype read the admission check must make.
  // Neither is avoidable: the first while `current` remains async, the second because prototype
  // identity is half of the contract.
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
  await assertRejectsTypeError(() => build(() => watched).current(), "a hostile non-thenable object");
  assert.ok(touches.length >= 1, "the count is not zero and this row does not pretend it is: awaiting a value reads its then");
  const permitted = new Set(["get:then", "getPrototypeOf"]);
  for (const touch of touches) {
    assert.ok(
      permitted.has(touch),
      `the candidate was touched by ${touch}; beyond the unavoidable then lookup and the prototype read, this port reads nothing it was handed`,
    );
  }
  assert.ok(touches.includes("get:then"), "the then lookup is real, and is recorded here rather than denied");
  assert.ok(!touches.some((touch) => touch.startsWith("get:tenantId") || touch.startsWith("get:actorId")), "the port must not read a candidate's parts: it recognises the value, it does not inspect it");
  // A hostile thenable is a different residual, and a larger one. Because `await` calls `then`, an
  // object that carries one gets to run arbitrary code inside this port's call — it may resolve, it
  // may reject, it may do neither for a while, and it may do anything else first. Nothing here
  // prevents that, and the assertions below record what an implementation is therefore exposed to
  // rather than claiming an isolation this port does not have.
  let executed = false;
  const hostile = { then(resolve) { executed = true; resolve(PRINCIPAL_A); } };
  assert.ok(Object.is(await build(() => hostile).current(), PRINCIPAL_A), "a hostile thenable may resolve, and its resolution is admitted like any other");
  assert.equal(executed, true, "and its then body ran inside the port's call: this is the residual, stated rather than hidden");
  // The same door, used to reject. The rejection reaches the caller exactly as any other would.
  const refusal = new RangeError("MARKER_thenable_6b04");
  const rejecting = { then(resolve, reject) { reject(refusal); } };
  const caught = await assertRejects(() => build(() => rejecting).current(), "a hostile thenable that rejects");
  assert.equal(caught, refusal, "a thenable's rejection propagates by identity, like a collaborator's own");
  // Assimilation is what it is; it does not widen what counts as a principal. A thenable resolving
  // to a lookalike is refused on exactly the ordinary terms.
  await assertRejectsTypeError(
    () => build(() => ({ then(resolve) { resolve(Object.create(Principal.prototype)); } })).current(),
    "a thenable resolving to a shaped impostor",
  );
  // And a `then` that is not callable is not a thenable at all: the object is the resolution, and
  // the ordinary admission rule refuses it.
  await assertRejectsTypeError(() => build(() => ({ then: PRINCIPAL_A })).current(), "an object whose then is not callable");
});

// -------------------------------------------------------------------------------------
// F1. What the brand actually proves, and the four things it does not.
// -------------------------------------------------------------------------------------

test("branding is honest: the brand proves construction and invariants only, never truth, and freezing stops neither subclassing nor interposition", async () => {
  const m = mod();
  const real = build(() => PRINCIPAL_A);
  assert.ok(Object.is(await real.current(), PRINCIPAL_A), "the genuine instance works, which is what makes the limits below meaningful");
  // 1. What the brand proves, stated exactly. It proves the Domain constructor ran, and therefore
  //    that a TenantId and an ActorId were validated on the way in. It proves nothing about whether
  //    this principal is the one currently acting: a collaborator may mint a perfectly genuine
  //    Principal for any tenant and any actor it likes, and this port will hand it straight on.
  const fabricated = principalOf(TENANT_B, "someone-who-never-called");
  assert.equal(brandAnswers(fabricated), true, "a fabricated principal carries a perfectly genuine brand");
  assert.ok(
    Object.is(await build(() => fabricated).current(), fabricated),
    "and it is admitted without question: the brand is a construction proof, never a truth claim, and this port makes no claim it cannot support",
  );
  // 2. The probe's own provenance. It is read once from a frozen, non-configurable accessor on the
  //    frozen Principal.prototype — which is what makes the capture trustworthy and, in the same
  //    breath, makes "captured once" unobservable from outside. There is no way to replace the
  //    getter afterwards, so there is no experiment that could tell a once-captured probe from a
  //    re-read one. This row records that rather than asserting a fact nothing can witness.
  const descriptor = Object.getOwnPropertyDescriptor(Principal.prototype, "tenantId");
  assert.equal(typeof descriptor.get, "function", "the brand probe is the tenantId getter");
  assert.equal(descriptor.set, undefined, "which is a getter only");
  assert.equal(descriptor.configurable, false, "and is non-configurable, so it can never be swapped out from under the capture");
  assert.ok(Object.isFrozen(Principal.prototype), "the prototype it lives on is frozen");
  assert.ok(Object.isFrozen(Principal), "and so is the class");
  assert.throws(
    () => Object.defineProperty(Principal.prototype, "tenantId", { get() { return "substituted"; } }),
    TypeError,
    "the probe cannot be substituted, which is exactly why capture-once has no observable consequence to assert",
  );
  // 3. Freezing does not close the subclass door — on either type. `Object.freeze` protects the
  //    properties it was given; it says nothing about a derived prototype, which is a new object.
  //    An Identity subclass may therefore replace `current` entirely and its instances still answer
  //    `instanceof`, and this port does not pretend otherwise.
  class Assuming extends m.Identity {
    async current() { return "whatever this subclass feels like"; }
  }
  const assuming = new Assuming({ current: () => PRINCIPAL_A });
  assert.ok(Object.isFrozen(m.Identity) && Object.isFrozen(m.Identity.prototype), "both are frozen");
  assert.ok(assuming instanceof m.Identity, "and a subclass instance is still an Identity by instanceof");
  assert.equal(
    await assuming.current(), "whatever this subclass feels like",
    "a subclass overrode the method the base class froze, and returned something that is not a Principal at all: freezing a prototype does not freeze the ones derived from it",
  );
  // 4. Interposition is undetectable from the far side. A forwarding proxy over a genuine Identity
  //    works perfectly, observes every call, and cannot be seen by the caller. Nothing in this port
  //    can prevent that; the honest statement is that a caller holding a reference is trusting
  //    whoever handed it over.
  const observed = [];
  const forwarding = new Proxy(real, {
    get(target, key, receiver) {
      observed.push(String(key));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.ok(Object.is(await forwarding.current(), PRINCIPAL_A), "a bound forwarding proxy answers exactly as the real instance does");
  assert.ok(observed.includes("current"), "and it saw the call go past");
  assert.ok(forwarding instanceof m.Identity, "it passes instanceof");
  assert.equal(Object.prototype.toString.call(forwarding), "[object Identity]", "it renders identically");
  assert.ok(Object.isFrozen(forwarding), "and it even reports itself frozen: interposition here is undetectable from the outside");
  // 5. The impostor that answers nothing. An object built on the prototype carries the tag and
  //    passes instanceof, and holds no collaborator — so the method must refuse it. This is why the
  //    port's own brand is a private field rather than a marker property: a marker can be copied.
  const impostor = Object.create(m.Identity.prototype);
  assert.ok(impostor instanceof m.Identity, "instanceof is satisfied by a prototype, so it proves nothing about state");
  assert.equal(impostor[Symbol.toStringTag], "Identity", "the tag is inherited, so it proves nothing either");
  await assertRejectsTypeError(() => impostor.current(), "an Object.create impostor");
  await assertRejectsTypeError(() => m.Identity.prototype.current.call({}), "the method called on a plain object");
  await assertRejectsTypeError(() => m.Identity.prototype.current.call(undefined), "the method called on nothing at all");
  await assertRejectsTypeError(() => new Proxy(real, {}).current(), "a default proxy over a genuine Identity, whose private field is looked up on the proxy");
});

// -------------------------------------------------------------------------------------
// G1–H1. Independence between calls, and what a failing collaborator does.
// -------------------------------------------------------------------------------------

test("calls are independent and uncached: no memo, no single-flight, no previous chain, no queue and no imposed ordering", async () => {
  mod();
  // A hundred calls, each answered by that call's own principal. A cache would have returned the
  // first one a hundred times, and nothing in this port may notice that the principal changed
  // between calls — noticing would mean remembering, and remembering is the cache this row forbids.
  const sequence = [];
  for (let i = 0; i < 100; i += 1) sequence.push(principalOf(i % 2 === 0 ? TENANT_A : TENANT_B, `actor-${i}`));
  let index = 0;
  const identity = build(() => sequence[index++]);
  const seen = [];
  for (let call = 0; call < sequence.length; call += 1) seen.push(await identity.current());
  assert.equal(seen.length, 100, "a hundred calls must produce a hundred answers");
  for (let i = 0; i < sequence.length; i += 1) {
    assert.ok(Object.is(seen[i], sequence[i]), `call ${i} must return its own principal: a cache would have returned the first one every time`);
  }
  assert.equal(index, 100, "and the collaborator must have been consulted exactly a hundred times");
  assert.equal(new Set(seen).size, 100, "a hundred distinct principals came back: nothing was substituted or reused");
  // Two Identity instances share nothing. There is no module-level state for them to meet in, so
  // one cannot observe, delay or influence the other.
  const left = build(() => PRINCIPAL_A);
  const right = build(() => PRINCIPAL_B);
  assert.notEqual(left, right, "two constructions are two ports");
  const [a, b] = await Promise.all([left.current(), right.current()]);
  assert.ok(Object.is(a, PRINCIPAL_A), "the first is unaffected by the second");
  assert.ok(Object.is(b, PRINCIPAL_B), "and the second by the first");
  // The direct proof of independence, and the row's whole reason for existing.
  //
  // The hundred-call loop above proves a hundred answers arrived and that none was copied from
  // another. What it cannot prove is that two calls were ever in flight together: a port holding a
  // `#previous` promise and chaining each call behind the last produces exactly those hundred
  // values, in exactly that order, and passes every assertion above unchanged. Independence is
  // therefore proven directly here, by driving two calls whose collaborator hands back a promise
  // nobody but this test can settle, and then settling them in the opposite order to the one they
  // were started in.
  //
  // No timer, no wall clock and no sort. The evidence is a settlement log written by handlers that
  // were attached before anything was resolved, so the order in the log *is* the order the two
  // calls settled. And every wait below is a bounded microtask drain rather than an await on a
  // call: a port that queued or single-flighted these calls must fail this row promptly, not hang
  // it waiting for a second collaborator call that its own queue will never make.
  const gates = [];
  const gated = build(function gatedCurrent() {
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    gates.push({ promise, settle });
    return promise;
  });
  const drain = async () => { for (let tick = 0; tick < 16; tick += 1) await null; };
  const settlements = [];
  const first = gated.current();
  const second = gated.current();
  assert.notEqual(first, second, "two calls are two promises: a single-flight port would have handed the same one back twice");
  first.then((value) => { settlements.push(["first", value]); }, (error) => { settlements.push(["first", error]); });
  second.then((value) => { settlements.push(["second", value]); }, (error) => { settlements.push(["second", error]); });
  await drain();
  // Both calls are outstanding at once, and neither has been allowed to finish. A queue would still
  // be holding the second call back here, because the first has not been resolved and cannot be
  // until this test says so.
  assert.equal(
    gates.length, 2,
    "both calls must have reached the collaborator before either was resolved: a single-flight port calls it once and shares the result, and a queued port would still be waiting for the first call to finish",
  );
  assert.notEqual(gates[0].promise, gates[1].promise, "each call must await its own pending answer, not one promise shared between them");
  assert.deepEqual(settlements, [], "and neither call may settle while both collaborator promises are still pending");
  // The second call's answer is produced first, and the second call must settle first. This is the
  // ordering a queue cannot produce: behind a `#previous` chain the second call cannot finish before
  // the first, however promptly its own collaborator answered.
  gates[1].settle(PRINCIPAL_B);
  await drain();
  assert.equal(settlements.length, 1, "resolving the second call's own answer must settle the second call, and it alone");
  assert.equal(settlements[0][0], "second", "the second call settles first: its answer does not wait on a principal that has not been produced");
  assert.ok(Object.is(settlements[0][1], PRINCIPAL_B), "and it resolves with its own principal, the very object its collaborator produced");
  gates[0].settle(PRINCIPAL_A);
  await drain();
  assert.equal(settlements.length, 2, "resolving the first call's answer settles the first call");
  assert.deepEqual(
    settlements.map(([label]) => label), ["second", "first"],
    "the settlement log, read in the order it was written: exactly second then first, the inverse of the order the calls were started in",
  );
  assert.ok(Object.is(settlements[1][1], PRINCIPAL_A), "the first call resolves with its own principal, unchanged");
  assert.ok(!Object.is(settlements[0][1], settlements[1][1]), "two calls, two distinct principals: neither answer was substituted for the other");
  assert.ok(Object.is(await second, PRINCIPAL_B), "the second call's promise resolves with the second principal");
  assert.ok(Object.is(await first, PRINCIPAL_A), "and the first call's with the first");
  assert.ok(Object.isFrozen(gated), "the instance must still be frozen after two overlapping calls");
  assert.deepEqual(Object.getOwnPropertyNames(gated), [], "and must still carry no own property: nothing was stored to sequence them");
  // Concurrent calls on one instance do not interfere either: there is no in-flight flag here,
  // because there is no boundary to hold open.
  let concurrent = 0;
  const shared = build(async () => { const call = concurrent++; await settledLater(null); return sequence[call]; });
  const together = await Promise.all([shared.current(), shared.current(), shared.current()]);
  assert.equal(new Set(together).size, 3, "three concurrent calls are three collaborator calls, each with its own principal");
  for (const answered of together) assert.ok(sequence.includes(answered), "and each answer is one the collaborator actually produced");
  assert.ok(Object.isFrozen(shared), "the instance must still be frozen after repeated use");
  assert.deepEqual(Object.getOwnPropertyNames(shared), [], "and must still carry no own property");
});

test("a collaborator that fails propagates by identity, whatever it threw, and leaves the port usable", async () => {
  mod();
  const boom = new RangeError("MARKER_current_7c60");
  for (const [label, behaviour] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
    ["a rejecting thenable", () => ({ then(resolve, reject) { reject(boom); } })],
  ]) {
    const identity = build(behaviour);
    let returned;
    assert.doesNotThrow(() => { returned = identity.current(); }, `${label}: current must not throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: current must still yield a Promise`);
    const caught = await rejectionOf(returned);
    assert.equal(caught, boom, `${label}: the very value the collaborator threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_current_7c60", `${label}: and its message must be untouched`);
  }
  // Non-Error throws propagate on exactly the same terms. A port that only preserved Errors would
  // quietly normalise everything else, and a caller matching on its own sentinel would never match.
  const sentinel = Symbol("MARKER_sentinel_7c60");
  for (const thrown of ["a failure", 0, -0, NaN, null, undefined, false, 7n, sentinel, { code: "IDENTITY_UNAVAILABLE" }, [1, 2]]) {
    const thrower = build(() => { throw thrown; });
    const caught = await rejectionOf(thrower.current());
    assert.notEqual(caught, NO_REJECTION, `a collaborator throwing ${inspectShort(thrown)} must reject rather than resolve`);
    assert.ok(Object.is(caught, thrown), `a collaborator throwing ${inspectShort(thrown)} must propagate it by identity`);
    // The same value, arriving as a rejection rather than a throw.
    const rejecter = build(() => Promise.reject(thrown));
    const alsoCaught = await rejectionOf(rejecter.current());
    assert.notEqual(alsoCaught, NO_REJECTION, `a collaborator rejecting with ${inspectShort(thrown)} must reject`);
    assert.ok(Object.is(alsoCaught, thrown), `a collaborator rejecting with ${inspectShort(thrown)} must propagate it by identity`);
  }
  // A failure is not fatal to the port, and it is emphatically not remembered. There is no state to
  // poison, so the next call simply runs: a port that latched its first failure would turn one
  // unavailable answer into a dead instance, and nothing would tell the caller which call killed it.
  let fail = true;
  const flaky = build(() => { if (fail) throw boom; return PRINCIPAL_A; });
  assert.equal(await rejectionOf(flaky.current()), boom, "the first call fails");
  fail = false;
  assert.ok(Object.is(await flaky.current(), PRINCIPAL_A), "and the very next call on the same instance succeeds");
  assert.ok(Object.is(await flaky.current(), PRINCIPAL_A), "and the one after it");
  fail = true;
  assert.equal(await rejectionOf(flaky.current()), boom, "and it can fail again afterwards, by identity, with nothing accumulated in between");
  assert.ok(Object.isFrozen(flaky), "the instance must still be frozen after a failure");
  assert.deepEqual(Object.getOwnPropertyNames(flaky), [], "and must still carry no own property");
  // A refused answer is not remembered either: a brand refusal and a genuine principal alternate on
  // the same instance with nothing carried between them.
  let genuine = false;
  const alternating = build(() => (genuine ? PRINCIPAL_B : Object.create(Principal.prototype)));
  await assertRejectsTypeError(() => alternating.current(), "the first call is refused");
  genuine = true;
  assert.ok(Object.is(await alternating.current(), PRINCIPAL_B), "and the next call on the same instance is admitted");
  genuine = false;
  await assertRejectsTypeError(() => alternating.current(), "and it refuses again afterwards");
});
