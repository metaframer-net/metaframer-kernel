import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command, KernelError, Query, Result } from "../src/application/action-primitives.mjs";
import { ActorId, CausationId, CorrelationId, IdempotencyKey, Principal, TenantId } from "../src/domain/identity-primitives.mjs";

// =====================================================================================
// P-M1-07 — the Policy port, frozen as a public surface
//
// This file is the whole observable surface of src/application/policy.mjs: one exported class that
// takes exactly one collaborator function and guarantees what a caller receives when it asks that
// collaborator about an action. It is written before the module exists, so every assertion here is
// a requirement rather than a description of something already built.
//
// The scope is the port and nothing beyond it. A port says what a boundary must have; it is never
// evidence that anything has been built behind one. Nothing here may be read as a claim that this
// kernel decides anything about permission, that a decision point exists, that a rule has ever been
// written or evaluated, or that any exit criterion has been closed.
//
// What this port actually promises, stated plainly so nobody has to infer it:
//
//   - `consult(action)` admits its argument first — exactly one genuine `Command` or `Query`,
//     admitted by *both* prototype identity and a private-brand probe — then calls its collaborator
//     exactly once, with an undefined receiver and exactly that one action object, awaits whatever
//     came back, and either resolves with it — when it is a genuine `Result`, admitted by both
//     halves again — as the very same object it already was, or rejects. There is no third outcome.
//
// And what it explicitly does *not* promise, because a port whose name contains the word "policy"
// is the single easiest place in a kernel to accidentally claim an entire authorization subsystem:
//
//   - not that anything is decided here. This module holds no rule, no condition, no subject, no
//     resource, no action verb and no combining algorithm. It does not evaluate; it forwards a
//     question to the one collaborator it was handed and hands back the answer it was given.
//   - not that a `Result` means "allowed". A `Result` has two branches and this port reads neither.
//     `Result.failure` is a perfectly ordinary answer: it resolves, it travels back by identity, and
//     it is never re-read as a refusal, never converted into a rejection, and never turned into a
//     denial. A port that treated one branch as "no" would be the first line of an authorization
//     model, written in the one place nobody would look for one.
//   - not that answers are cached, stable, repeatable or ordered. Two consultations of the same
//     action may answer differently, and the second may settle before the first. Both are admitted,
//     because noticing either would mean remembering the previous answer, and a port that remembered
//     would be answering partly from itself rather than wholly from its collaborator. It would also
//     be the exact shape of a decision cache, which is a thing with a correctness argument, an
//     invalidation story and a staleness window — none of which this package has.
//
// There is therefore no stored decision, no held promise, no flag and no queue in the module under
// test: two calls on one instance meet nowhere, and two instances share nothing, because there is
// nothing for them to share. That is not an omission to be filled in later — it is the whole reason
// the list above can be honest.
//
// The frozen non-goals: no authentication, authorization, RBAC, ReBAC or ABAC; no decision point,
// enforcement point, rule, obligation, allow, deny or permit; no policy authoring, no audit, no
// outbox, no row-level security, no persistence, no adapter, no session, token or delegation, no
// freshness, no clock, no environment and no I/O. No `PolicyRequest` and no `PolicyDecision`: a
// request type and a decision type are the two halves of a decision protocol, and naming either one
// would commit this kernel to the protocol between them. The action already has a type — `Command`
// or `Query` — and the answer already has a type — `Result`. A port that invented two more would be
// designing the M2 surface here, under a package that only opens the seam.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module must
// fail every row here by name rather than collapsing the file into a single load error: fourteen
// named failures are the RED specification, and one import error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/policy.mjs";

/** The six modules that already exist, with the import and export sets their packages froze. */
const EXISTING = [
  { path: "src/domain/identity-primitives.mjs", imports: ["node:crypto"], exports: ["ActorId", "CausationId", "CorrelationId", "IdempotencyKey", "Principal", "TenantId"] },
  { path: "src/application/action-primitives.mjs", imports: ["../domain/identity-primitives.mjs"], exports: ["Command", "KernelError", "Query", "Result"] },
  { path: "src/application/use-case.mjs", imports: ["./action-primitives.mjs"], exports: ["UseCase"] },
  { path: "src/application/unit-of-work.mjs", imports: [], exports: ["UnitOfWork"] },
  { path: "src/application/clock.mjs", imports: [], exports: ["Clock"] },
  { path: "src/application/identity.mjs", imports: ["../domain/identity-primitives.mjs"], exports: ["Identity"] },
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
 * Line-based on purpose, and load-bearing here more than anywhere else in this kernel. This module
 * must explain in prose why it refuses to decide, evaluate, allow or deny — and the honest way to
 * write that prose is to use those words. A scan that could not tell the explanation from the deed
 * would forbid the explanation, and the module would be left either silently wrong or silently
 * undocumented. The stripper is itself asserted in A3 rather than trusted, because a stripper that
 * over-removed would turn the whole vocabulary scan into a scan of an empty string.
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
 * `consult` always returns a Promise, so a synchronous throw is a contract breach even when the
 * thrown value is the right one: a caller that wrote `policy.consult(action).catch(...)` would never
 * reach its handler. The facts are asserted separately so a failure says which one broke.
 */
async function assertRejects(call, label) {
  let promise;
  assert.doesNotThrow(() => { promise = call(); }, `${label}: consult must never throw synchronously; it always returns a Promise`);
  assert.ok(promise instanceof Promise, `${label}: consult must return a Promise`);
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
// The three fixed messages.
//
// They are written out here as literals rather than read back off whatever the module produced,
// because a test that harvested the message it then asserted would pass against any message at all.
// Each one names the rule that was broken and nothing else: no candidate, no coordinate, no
// payload, and none of the vocabulary this port refuses to own.
// -------------------------------------------------------------------------------------

const OPTIONS_MESSAGE = "Policy needs an ordinary object holding exactly one own enumerable consult function";
const ACTION_MESSAGE = "Policy.consult needs an exact Command or Query instance";
const RESULT_MESSAGE = "Policy.consult needs a genuine Result instance from its collaborator";

// -------------------------------------------------------------------------------------
// Fixtures.
//
// Every genuine Command, Query and Result below is built through the Application constructor that
// owns it. This test file never rebuilds one, and neither may the module under test: the brands
// this port probes are meaningful precisely because only those constructors can install them.
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

const COMMAND = commandOf();
const QUERY = queryOf();
const OK = Result.ok({ invoice: "7731" });
const FAILED = Result.failure(new KernelError({ code: "INVOICE_ALREADY_ISSUED", details: null, cause: null }));

/**
 * The three brand probes, captured once, exactly as the module under test must capture them.
 *
 * They are read here for one reason — to demonstrate, in this file, that each half of each
 * admission rule accepts something the other half rejects. That is what makes the two-half
 * requirement a requirement rather than a preference. Each is a getter installed on a frozen,
 * non-configurable accessor of a frozen prototype, so the capture cannot be substituted afterwards.
 */
const COMMAND_BRAND = Object.getOwnPropertyDescriptor(Command.prototype, "name").get;
const QUERY_BRAND = Object.getOwnPropertyDescriptor(Query.prototype, "name").get;
const RESULT_BRAND = Object.getOwnPropertyDescriptor(Result.prototype, "isOk").get;

const brandAnswers = (probe, value) => {
  try {
    probe.call(value);
    return true;
  } catch {
    return false;
  }
};

/** A Policy built through the module under test. Every caller reaches the guard through mod(). */
const build = (consult) => new (mod().Policy)({ consult });

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
    countOf: (label) => calls.filter((call) => call.label === label).length,
    firstOf: (label) => calls.find((call) => call.label === label),
  };
}

/**
 * The impostors, built once and reused, because every row that refuses one wants the same set.
 *
 * `hollow` passes a bare prototype-identity check and holds no private field at all. `derived` is
 * the mirror image: the real constructor ran, so the brand answers, and its prototype is not the
 * frozen one. Between them they defeat each half of the rule separately, which is what forces the
 * implementation to carry both.
 */
const hollowCommand = Object.create(Command.prototype);
const hollowQuery = Object.create(Query.prototype);
const hollowResult = Object.create(Result.prototype);

class DerivedCommand extends Command {}
class DerivedQuery extends Query {}

const derivedCommand = new DerivedCommand({
  name: NAME, version: VERSION, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: CAUSATION, idempotencyKey: IDEMPOTENCY, payload: { amount: 100, currency: "EUR" },
});
const derivedQuery = new DerivedQuery({
  name: NAME, version: VERSION, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: CAUSATION, payload: { invoice: "7731" },
});

// -------------------------------------------------------------------------------------
// A1–A4. The module surface, the single import it is allowed, the vocabulary it never carries, and
// the direction of every arrow that touches it.
// -------------------------------------------------------------------------------------

test("the module exports exactly Policy, re-exports nothing, and no decision-protocol surface stands beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["Policy"], "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  assert.equal(typeof m.Policy, "function", "Policy must be a class");
  assert.equal(Object.getPrototypeOf(m.Policy), Function.prototype, "Policy must extend nothing");
  // The two names this package refuses hardest, called out before the list so the reason is not
  // lost inside it. A `PolicyRequest` and a `PolicyDecision` are the two ends of a decision
  // protocol; exporting either one commits this kernel to the protocol between them, and to a
  // vocabulary of subjects, resources, effects and obligations that nothing here has designed. The
  // action already has a type and the answer already has a type. This port needs no third.
  assert.equal(m.PolicyRequest, undefined, "PolicyRequest would invent a request type beside Command and Query, and commit this kernel to a decision protocol M2 has not designed");
  assert.equal(m.PolicyDecision, undefined, "PolicyDecision would invent an answer type beside Result, and make this port the place where allow and deny are first spelled");
  // Each absent name below is a whole concern this package has not started. They are listed rather
  // than summarised because the failure they guard against is one of them appearing alone, quietly,
  // as "just a small helper" beside the port.
  for (const absent of [
    "PolicyPort", "PolicySet", "PolicyEngine", "PolicyStore", "Rule", "RuleSet", "Condition",
    "Decision", "Effect", "Obligation", "Advice", "Combiner", "CombiningAlgorithm",
    "Allow", "Deny", "Permit", "Forbid", "Indeterminate", "NotApplicable",
    "Pdp", "PDP", "Pep", "PEP", "Pip", "Pap", "Enforcer", "Enforcement", "Guard", "Gate",
    "Rbac", "RBAC", "Abac", "ABAC", "Rebac", "ReBAC", "Role", "Scope", "Permission", "Grant",
    "Subject", "Resource", "Action", "Attribute", "Relation", "Tuple",
    "Authenticator", "Authentication", "Authorization", "AuthN", "AuthZ", "Authorizer",
    "Session", "SessionStore", "Token", "TokenVerifier", "Claims", "Credential", "Login",
    "Delegation", "Impersonation", "OnBehalfOf", "Freshness", "Revocation",
    "AuditPort", "Audit", "OutboxPort", "Outbox", "Rls", "RowLevelSecurity",
    "RepositoryPort", "Repository", "Cache", "Store", "Adapter", "Schema", "Sdk",
    "Database", "Connection", "Pool", "ClockPort", "IdentityPort",
    "ValidationBoundary", "Validator", "validate", "CompositionRoot", "container", "configure",
    "register", "resolve", "consult", "decide", "evaluate", "authorize", "enforce", "check",
    "allow", "deny", "permit", "can", "may", "must",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the Policy port`);
  }
  // The three types this module is allowed to import must not be handed back out again.
  // Re-exporting one would give the kernel two front doors to one Application contract, and the
  // second would be free to drift the day either module is versioned. The imports exist to *probe*
  // the brands, never to republish the types that carry them.
  for (const borrowed of [
    "Command", "Query", "Result", "KernelError", "UseCase", "UnitOfWork", "Clock", "Identity",
    "Principal", "TenantId", "ActorId", "CorrelationId", "CausationId", "IdempotencyKey",
  ]) {
    assert.equal(m[borrowed], undefined, `${borrowed} is owned elsewhere and must not stand in this module's export set`);
  }
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; a port carries no version of its own`);
  }
  // The namespace object itself is not asserted symbol-free: a module namespace exotic object owns
  // Symbol.toStringTag by construction, so requiring zero symbols there would be a requirement on
  // the language rather than on this module. What the module actually controls is asserted instead.
  assert.deepEqual(Object.getOwnPropertySymbols(m.Policy), [], "Policy must carry no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.Policy.prototype), [Symbol.toStringTag],
    "Policy.prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.Policy.prototype), Object.prototype, "Policy must stand directly on Object");
  assert.ok(!(m.Policy.prototype instanceof Error), "a Policy is not an error type");
});

test("the module imports exactly Command, Query and Result from its own ring, nothing else, and never re-exports them", () => {
  const text = code();
  // Exactly one import, pointing sideways within the Application ring at the module that owns the
  // three types this port recognises. There is no inward import: this port never touches a Domain
  // value, because the only Domain values in play arrive already sealed inside an action it does
  // not open.
  assert.deepEqual(
    importsOf(text), ["./action-primitives.mjs"],
    `${modulePath} must import from exactly one module, the action primitives beside it`,
  );
  const named = [...text.matchAll(/(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)];
  assert.equal(named.length, 1, `${modulePath} must carry exactly one named import statement`);
  assert.deepEqual(
    named[0][1].split(",").map((binding) => binding.trim()).filter(Boolean).sort(),
    ["Command", "Query", "Result"],
    `${modulePath} must take exactly the three bindings it probes and no fourth name beside them`,
  );
  assert.equal(named[0][2], "./action-primitives.mjs", "and it must take them from the action primitives");
  assert.ok(!/\bas\s+\w/.test(named[0][1]), "the bindings must not be renamed: a local alias hides which Application type is being probed");
  // KernelError is the sharpest of the absences. It is exported by the very module this port
  // imports from, so taking it costs one word — and a port holding an error type is a port one edit
  // away from minting a failure Result of its own, which is exactly the denial this package refuses
  // to invent.
  assert.ok(
    !/\bKernelError\b/.test(text),
    `${modulePath} must not import or name KernelError: a port that could mint an error could mint a refusal, and this port never authors an answer`,
  );
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(bare, [], `${modulePath} must carry no side-effect-only import`);
  assert.ok(!/import\s*\*\s*as/.test(text), `${modulePath} must not take a namespace import: it needs three types, not a module`);
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["the domain ring directly", /\.\.\/domain\/|identity-primitives/],
    ["a sibling port", /use-case\.mjs|unit-of-work\.mjs|clock\.mjs|identity\.mjs/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
  assert.ok(
    !/export\s[^;\n]*\bfrom\s*["']/.test(text),
    `${modulePath} must not re-export from another module: the three types it imports are probed, never republished`,
  );
  // Exactly one exported name in the source text too, so the export set asserted in A1 is a
  // property of the file rather than of what happened to be reachable at import time.
  const exported = [...text.matchAll(/(?:^|\n)\s*export\s+(?:class|function|const|let|var)\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported, ["Policy"], `${modulePath} must declare exactly one exported name, Policy`);
});

test("the module reaches no ambient capability and carries none of the frozen non-goal vocabulary, in code rather than in prose", () => {
  // The stripper is proven before it is trusted. This module has to explain, in prose, that it does
  // not decide, allow, deny or enforce — and the only honest way to write that sentence is with
  // those words in it. So the scan below runs on stripped source, and these four assertions fix
  // both directions: a forbidden token inside a comment must disappear, and the identical token in
  // code must survive. Without them the whole row could be satisfied by a stripper that returned
  // the empty string, and every scan beneath would be scanning nothing.
  const probe = [
    "// this port never decides whether to allow or deny an action",
    "/* and it holds no rbac, no abac and no policy decision point */",
    " * an obligation is never attached here",
    "const kept = consultTheCollaborator(action); // allow",
  ].join("\n");
  const stripped = stripComments(probe);
  assert.ok(!/\ballow\b/i.test(stripped), "a forbidden token written in a line comment must be stripped, or this port could never explain itself");
  assert.ok(!/\brbac\b/i.test(stripped), "a forbidden token written in a block comment must be stripped too");
  assert.ok(!/\bobligation\b/i.test(stripped), "and one written in a continuation line of a block comment");
  assert.ok(/consultTheCollaborator/.test(stripped), "but code on a line carrying a trailing comment must survive: the scan reads what the module does");
  assert.ok(stripped.includes("const kept ="), "and the code before a trailing comment must survive intact");

  const text = code();
  // A policy port whose *own* behaviour could reach a store, an environment or a network is the one
  // failure this package exists to prevent: it would be able to answer without its collaborator, and
  // every guarantee below would then describe something other than the thing being called.
  for (const [label, pattern] of [
    ["process", /\bprocess\b/],
    ["the environment", /\benv\b/i],
    ["fetch", /\bfetch\s*\(/],
    ["globalThis", /\bglobalThis\b/],
    ["ambient time", /\bperformance\b|\bhrtime\b|\buptime\b/],
    ["randomness", /\bMath\s*\.\s*random\b|\brandomUUID\b|\brandomBytes\b|\bcrypto\b/],
    ["a timer", /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/],
    ["the filesystem", /\breadFile\b|\bwriteFile\b|\breaddir\b/],
    ["a transport", /\bhttp\b|\bgraphql\b|\bwebsocket\b|\bgrpc\b/i],
    ["a database", /\bdatabase\b|\bpostgres|\bsqlalchemy\b|\bsqlite\b|\bSELECT\b|\bINSERT\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  // The clock, named separately. A port that could read a time could compute a freshness or an
  // expiry, and both are answers about whether a decision is *still* good — a claim this package
  // makes no attempt to support.
  for (const [label, pattern] of [
    ["a clock", /\bclock\b|\bnow\b/i],
    ["Date", /\bDate\b/],
    ["Temporal", /\bTemporal\b/],
    ["a timestamp", /\btimestamp\b|\bexpir|\bttl\b|\brefresh|\bfresh/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not name ${label}: this port forwards a question, it never decides when an answer stops being one`);
  }
  // The decision vocabulary. This is the centre of the row: every token here is a word that would
  // turn a forwarding port into the first draft of an authorization model, and each is refused in
  // code while remaining perfectly sayable in the prose above it.
  for (const [label, pattern] of [
    ["a decision", /\bdecide\b|\bdecision\b|\bdecid/i],
    ["an evaluation", /\bevaluat\b|\bevaluate\b|\bevaluation\b/i],
    ["allow", /\ballow/i],
    ["deny", /\bden(?:y|ies|ied|ial)\b/i],
    ["permit", /\bpermit/i],
    ["an effect", /\beffect\b|\bforbid|\bindeterminate\b|\bnotApplicable\b/i],
    ["an obligation", /\bobligation\b|\badvice\b/i],
    ["a rule", /\brule\b|\bruleSet\b|\bcondition\b|\bcombin/i],
    ["a decision or enforcement point", /\bpdp\b|\bpep\b|\bpip\b|\bpap\b|\benforce/i],
    ["a policy model", /\brbac\b|\babac\b|\brebac\b|\bpolicySet\b|\bauthoring\b/i],
    ["authentication", /\bauthenticat/i],
    ["authorization", /\bauthoriz|\bauthn\b|\bauthz\b/i],
    ["a role, scope, permission or grant", /\brole\b|\bscope\b|\bpermission|\bgrant\b|\bentitle/i],
    ["a subject or resource model", /\bsubject\b|\bresource\b|\battribute\b|\brelation\b|\btuple\b/i],
    ["a session", /\bsession\b/i],
    ["a token", /\btoken\b|\bjwt\b|\boauth\b|\bbearer\b/i],
    ["a credential", /\bcredential|\blogin\b|\bpassword\b|\bsecret\b/i],
    ["delegation", /\bdelegat|\bimpersonat|\bonBehalfOf\b/i],
    ["revocation", /\brevok|\brevoc/i],
    ["a cache", /\bcache\b|\bmemo|\bsingleFlight\b|\bqueue\b|\bpending\b|\binFlight\b/i],
    ["a store or persistence", /\bstore\b|\bpersist|\bdirectory\b|\brepositor/i],
    ["row-level security", /\brls\b|\browLevel/i],
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
  // The two invented types, refused in the source text as well as in the export set. A private
  // `PolicyRequest` that never reached the export list would still be this package designing the M2
  // protocol, one class at a time, where nobody was looking.
  for (const invented of ["PolicyRequest", "PolicyDecision"]) {
    assert.ok(!new RegExp(`\\b${invented}\\b`).test(text), `${modulePath} must not name ${invented}, not even privately`);
  }
  // The kernel types it has no import for, and must therefore not name either. A hand-rolled
  // reference to one of these would be this module rebuilding a type it is only allowed to
  // recognise — and a rebuilt `Result` carries a brand this port itself minted, which would make the
  // admission check a test of this module rather than of the module that owns the type.
  for (const rebuilt of [
    "Principal", "TenantId", "ActorId", "CorrelationId", "CausationId", "IdempotencyKey",
    "UseCase", "UnitOfWork", "Identity",
  ]) {
    assert.ok(
      !new RegExp(`\\b${rebuilt}\\b`).test(text),
      `${modulePath} must not name ${rebuilt}: this port recognises an action and a result, it never reconstructs one or reaches past it`,
    );
  }
  // And it must not read into the action it forwards. A port that touched a coordinate would be
  // starting to care *which* action it was handed, which is the first line of a rule.
  for (const coordinate of ["payload", "principal", "correlationId", "causationId", "idempotencyKey"]) {
    assert.ok(
      !new RegExp(`\\b${coordinate}\\b`).test(text),
      `${modulePath} must not name ${coordinate}: the action is forwarded whole and unopened, and a port that read a coordinate would be deciding something about it`,
    );
  }
});

test("no module in the kernel depends on this port, and every existing package keeps the import and export set it froze", async () => {
  for (const existing of EXISTING) {
    const innerText = await readFile(path.join(root, existing.path), "utf8");
    const innerCode = stripComments(innerText);
    // Dependency direction, proven from the other side. Nothing already in the kernel may learn
    // about this module: a port is depended *on*, and the day an inner module imported it the arrow
    // would point outward and the onion would stop being one. Each is read comment-stripped,
    // because a comment naming this port is documentation and a code reference is a dependency.
    assert.ok(!/policy\.mjs/.test(innerCode), `${existing.path} must not import ${modulePath}`);
    assert.ok(!/\bPolicy\b/.test(innerCode), `${existing.path} must not name Policy in code`);
    // The action primitives are the sharpest case: this port imports *from* them, so an import back
    // would close a cycle between two modules in the same ring, and the module that owns Command,
    // Query and Result would then be unable to load without the port that merely recognises them.
    assert.deepEqual(importsOf(innerCode), existing.imports, `${existing.path} keeps the import set its own package froze`);
    // And the packages beside and beneath stay exactly as they froze themselves. This package
    // widens nothing in order to make room for a port: no new import, and no new exported name. In
    // particular the action primitives are *read* by this port and are not altered by it — the
    // brands this port probes must remain the brands that module already installed.
    const namespace = await import(pathToFileURL(path.join(root, existing.path)).href);
    assert.deepEqual(Object.keys(namespace).sort(), existing.exports, `${existing.path} keeps the export set its own package froze`);
  }
  // The three probed prototypes are frozen and their probes non-configurable, which is what makes
  // capturing them once a safe thing for the module under test to do. If any of this drifted, the
  // admission rule below would be resting on an accessor somebody could replace at run time.
  for (const [label, klass, probeName] of [
    ["Command", Command, "name"], ["Query", Query, "name"], ["Result", Result, "isOk"],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(klass.prototype, probeName);
    assert.equal(typeof descriptor.get, "function", `${label}.prototype.${probeName} must be the brand probe, a getter`);
    assert.equal(descriptor.set, undefined, `${label}.prototype.${probeName} must be a getter only`);
    assert.equal(descriptor.configurable, false, `${label}.prototype.${probeName} must be non-configurable, so a captured probe can never be swapped out from under it`);
    assert.ok(Object.isFrozen(klass.prototype), `${label}.prototype must be frozen`);
    assert.ok(Object.isFrozen(klass), `${label} itself must be frozen`);
  }
  // The three probes are genuinely three. A single probe reused for all of them would admit a
  // Command where a Result was required, and the port would be checking a shape rather than a type.
  assert.notEqual(COMMAND_BRAND, QUERY_BRAND, "Command and Query must carry distinct private brands, or one would be admissible as the other");
  assert.equal(brandAnswers(QUERY_BRAND, COMMAND), false, "a Command must fail the Query brand probe");
  assert.equal(brandAnswers(COMMAND_BRAND, QUERY), false, "a Query must fail the Command brand probe");
  assert.equal(brandAnswers(RESULT_BRAND, COMMAND), false, "a Command must fail the Result brand probe");
  assert.equal(brandAnswers(COMMAND_BRAND, OK), false, "a Result must fail the Command brand probe");
  // The module must exist as a flat module in the Application ring and nowhere else. Its own
  // package's boundary row states this from the tree; it is stated here from the module's own side
  // so a file that moved would fail beside the contract it belongs to.
  assert.ok(source().length > 0, `${modulePath} must be a real file in the Application ring`);
});

// -------------------------------------------------------------------------------------
// B1–B2. Construction, and what a constructed Policy is.
// -------------------------------------------------------------------------------------

test("the constructor takes exactly one ordinary object holding exactly one consult function, and never runs caller code to read it", () => {
  const m = mod();
  const fn = () => OK;
  assert.ok(build(fn) instanceof m.Policy, "the one-function port must construct");
  assert.equal(m.Policy.length, 1, "the constructor takes one options object, not a positional function");
  // A frozen options object is still an ordinary options object; refusing one would be a rule about
  // how carefully the caller held its own data.
  assert.doesNotThrow(() => new m.Policy(Object.freeze({ consult: fn })), "a frozen options object is admissible");
  // Every flavour of function stays admissible. Refusing one would be a rule about how a caller
  // spelled its collaborator, which is not this port's business.
  for (const ok of [() => OK, function named() { return OK; }, async () => OK, class Consulted {}]) {
    assert.doesNotThrow(() => new m.Policy({ consult: ok }), `consult as ${inspectShort(ok)} is a legal collaborator`);
  }
  // Missing is refused rather than defaulted. There is no default decision, no fail-open and no
  // fail-closed here: a Policy that supplied its own answer would answer without the collaborator,
  // and the caller would never learn its policy port was never wired. Both defaults are wrong in
  // this position, which is why neither is offered.
  throws(() => new m.Policy({}), "omitting consult must be refused, never defaulted: a port with a built-in answer is a port that answers when nothing was wired");
  throws(() => new m.Policy({ consult: undefined }), "consult is required and must not accept undefined");
  throws(() => new m.Policy({ consult: null }), "consult is required and must not accept null");
  for (const bad of [
    "consult", 1, 0, true, false, [], {}, Symbol("consult"), 7n,
    { call: () => OK }, { consult: () => OK }, OK, FAILED, COMMAND,
  ]) {
    throws(() => new m.Policy({ consult: bad }), `consult as ${inspectShort(bad)} is not a function`);
  }
  // A ready-made Result is the sharpest of those: handing the answer instead of the capability
  // would make this a holder rather than a port, and a holder answers the same thing forever — a
  // constant verdict wearing a port's name.
  throws(() => new m.Policy({ consult: OK }), "an ok Result is not a collaborator: this port is handed a capability, never an answer");
  throws(() => new m.Policy({ consult: FAILED }), "and a failure Result is not one either");
  // An unknown key is refused rather than dropped, because silently ignoring one lets a caller
  // believe it configured something — a default, a cache, a fail-open — that nothing reads.
  for (const extra of ["consultFn", "policy", "decide", "fallback", "default", "cache", "onDeny", "timeout", "toJSON", "then"]) {
    throws(() => new m.Policy({ consult: fn, [extra]: () => OK }), `an unknown option key ${extra} must be refused by name`);
  }
  throws(() => new m.Policy({ consult: fn, [Symbol("hidden")]: () => OK }), "a symbol-keyed option member must be refused");
  // The key must be a plain, enumerable data property, and the descriptor must be read rather than
  // the value fetched. An accessor would run caller code during construction, and this row proves
  // the refusal happens *without* invoking it rather than merely after doing so.
  let accessorRan = false;
  const accessorOptions = { get consult() { accessorRan = true; return fn; } };
  throws(() => new m.Policy(accessorOptions), "an accessor-defined consult must be refused: reading an option may not run caller code");
  assert.equal(accessorRan, false, "and the accessor must never have been invoked: the descriptor is read, the value is not fetched");
  throws(
    () => new m.Policy(Object.defineProperty({}, "consult", { value: fn, enumerable: false, configurable: true, writable: true })),
    "a non-enumerable consult must be refused: an option nobody can enumerate is an option nobody can review",
  );
  // Ordinary means ordinary: prototype exactly Object.prototype, no exotic behaviour behind it.
  for (const notOrdinary of [
    Object.assign(Object.create(null), { consult: fn }),
    Object.assign(Object.create({ inherited: true }), { consult: fn }),
    Object.assign([], { consult: fn }),
    Object.assign(function carrier() {}, { consult: fn }),
    new (class Options { constructor() { this.consult = fn; } })(),
  ]) {
    throws(() => new m.Policy(notOrdinary), `${inspectShort(notOrdinary)} is not an ordinary options object`);
  }
  // A hostile exotic carrier, watched. Ordinariness is settled before the key is looked at, so an
  // object whose prototype is already wrong must be refused without its `consult` ever being read —
  // a capability object that could observe the read could hand a different function to the reader
  // than to the reviewer.
  const watched = [];
  const hostileCarrier = new Proxy(Object.create(null), {
    get(target, key, receiver) { watched.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
    getOwnPropertyDescriptor(target, key) { watched.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
    ownKeys(target) { watched.push("ownKeys"); return Reflect.ownKeys(target); },
  });
  throws(() => new m.Policy(hostileCarrier), "an exotic carrier with a null prototype must be refused");
  assert.ok(!watched.includes("get:consult"), `the hostile carrier's consult was fetched before it was refused: ${watched.join(", ")}`);
  // The residual on the other side of that rule, stated positively because the honest answer is
  // that it cannot be refused. A transparent proxy over legal options answers every question the
  // constructor is able to ask exactly as its target does — same prototype, same single own key,
  // same data descriptor, the same function by identity — and ECMAScript exposes no standard way to
  // ask whether an object is a proxy at all. Construction through one is therefore admitted here,
  // and this row records that as a known limit rather than pretending to a detection nothing can
  // perform.
  const proxiedOptions = new Proxy({ consult: fn }, {});
  assert.equal(Object.getPrototypeOf(proxiedOptions), Object.prototype, "a transparent proxy reports the ordinary prototype");
  assert.deepEqual(Reflect.ownKeys(proxiedOptions), ["consult"], "and exactly the one own key");
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(proxiedOptions, "consult"),
    { value: fn, writable: true, enumerable: true, configurable: true },
    "and the identical data descriptor, holding the very same function",
  );
  assert.doesNotThrow(
    () => new m.Policy(proxiedOptions),
    "a transparent proxy over legal options is indistinguishable from those options and is therefore admitted: this port claims no proxy detection, because none exists to claim",
  );
  // An inherited consult is not an own key: reading it would let a prototype somewhere else decide
  // what this port calls.
  throws(() => new m.Policy(Object.create({ consult: fn })), "an inherited consult must be refused: the option must be the caller's own");
  for (const notOptions of [undefined, null, "consult", 1, true, [], () => OK, Symbol("options"), 7n]) {
    throws(() => new m.Policy(notOptions), `${inspectShort(notOptions)} is not an options object`);
  }
  throws(() => new m.Policy(), "construction with no options object at all must be refused");
});

test("a constructed Policy is frozen, own-property-free, tagged, exposes exactly consult, and never hands its collaborator back", () => {
  const m = mod();
  const built = build(() => OK);
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.ok(Object.isFrozen(m.Policy.prototype), "Policy.prototype must be frozen");
  assert.ok(Object.isFrozen(m.Policy), "Policy itself must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "the collaborator is private state, not an own property");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.equal(built[Symbol.toStringTag], "Policy", "the instance must tag itself with its class name");
  assert.throws(() => { built.consult = () => OK; }, TypeError, "assignment into a frozen instance must throw");
  // The public surface, frozen in both directions: these members and no others. Every name absent
  // here is a decision — a Policy is behaviour, not a value, so it has no equality and no
  // rendering, and a toJSON would put a live collaborator one serialisation away from a log.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Policy.prototype).sort(), ["constructor", "consult"],
    "Policy.prototype must carry exactly constructor and consult",
  );
  for (const absent of [
    "equals", "toJSON", "toString", "valueOf", "inspect", "decide", "evaluate", "authorize",
    "enforce", "check", "allow", "deny", "permit", "can", "may", "of", "create", "from",
    "withDefault", "failOpen", "failClosed", "then",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m.Policy.prototype, absent), false,
      `${absent} must not appear on Policy.prototype`,
    );
  }
  assert.equal(m.Policy.prototype.toString, Object.prototype.toString, "toString must not be overridden");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Policy).sort(), ["length", "name", "prototype"],
    "Policy must carry no static factory, no registry and no lookup",
  );
  assert.equal(m.Policy.name, "Policy", "the class must be named Policy");
  // No getters on the named surface. A getter is how state becomes readable by accident, and the
  // one thing this instance holds is exactly the thing that must never be readable.
  for (const name of Object.getOwnPropertyNames(m.Policy.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(m.Policy.prototype, name);
    assert.equal(descriptor.get, undefined, `${name} must not be a getter`);
    assert.equal(descriptor.set, undefined, `${name} must not be a setter`);
  }
  // Leak probes. A collaborator that can be reached off the instance can be called directly, and a
  // caller that can call it directly has walked straight around the only thing this port does.
  const marked = build(function MARKER_consult_1e70() { return OK; });
  assert.equal(marked.consult, m.Policy.prototype.consult, "consult must be the prototype method, not a per-instance copy closing over the collaborator");
  for (const [label, rendered] of [
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(marked))],
    ["own keys", JSON.stringify(Object.keys(marked))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(marked))],
    ["prototype descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Policy.prototype))],
    ["class descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Policy))],
    ["JSON", JSON.stringify(marked) ?? "undefined"],
    ["the string form", String(marked)],
    ["the class source", String(m.Policy.prototype.consult)],
  ]) {
    assert.ok(!rendered.includes("MARKER_"), `the collaborator leaked through ${label}: ${rendered}`);
  }
  // The two residuals that freezing does not close, recorded here rather than left for a reader to
  // discover. Both are real, both are unavoidable, and neither is a defect in this port.
  //
  // First: `Object.freeze` protects the properties it was given; it says nothing about a derived
  // prototype, which is a new object. A subclass may therefore replace `consult` entirely and its
  // instances still answer `instanceof`.
  class Deciding extends m.Policy {
    async consult() { return "whatever this subclass feels like"; }
  }
  const deciding = new Deciding({ consult: () => OK });
  assert.ok(deciding instanceof m.Policy, "a subclass instance is still a Policy by instanceof");
  assert.ok(Object.isFrozen(m.Policy) && Object.isFrozen(m.Policy.prototype), "both the class and its prototype are frozen");
  // Second: interposition is undetectable from the far side. A forwarding proxy over a genuine
  // Policy works perfectly, observes every call, and cannot be seen by the caller. Nothing in this
  // port can prevent that; the honest statement is that a caller holding a reference is trusting
  // whoever handed it over. A port cannot enforce itself, and this file never claims it can.
  const observed = [];
  const forwarding = new Proxy(built, {
    get(target, key) {
      observed.push(String(key));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.ok(forwarding instanceof m.Policy, "a forwarding proxy passes instanceof");
  assert.equal(Object.prototype.toString.call(forwarding), "[object Policy]", "and renders identically");
  assert.ok(Object.isFrozen(forwarding), "and even reports itself frozen: interposition here is undetectable from the outside");
  // And the impostor that answers nothing. An object built on the prototype carries the tag and
  // passes instanceof, and holds no collaborator — which is why the port's own brand is a private
  // field rather than a marker property: a marker can be copied.
  const impostor = Object.create(m.Policy.prototype);
  assert.ok(impostor instanceof m.Policy, "instanceof is satisfied by a prototype, so it proves nothing about state");
  assert.equal(impostor[Symbol.toStringTag], "Policy", "the tag is inherited, so it proves nothing either");
});

// -------------------------------------------------------------------------------------
// C1–C2. The call: what consult promises, and exactly how the collaborator is invoked.
// -------------------------------------------------------------------------------------

test("consult is a one-argument async method, always returns a native Promise, and awaits whatever the collaborator produced", async () => {
  const m = mod();
  assert.equal(
    Object.prototype.toString.call(m.Policy.prototype.consult), "[object AsyncFunction]",
    "consult must be declared async: a caller that wrote policy.consult(action).catch(...) must reach its handler on every path, and async is what makes that true by construction rather than by remembering",
  );
  assert.equal(
    m.Policy.prototype.consult.length, 1,
    "consult takes exactly one argument, the action: a second parameter would be a context, an option or a hint, and each of those is a knob on a decision this port does not make",
  );
  // Extra arguments are ignored rather than refused — arity one is what the method promises, not a
  // rule about how the caller spelled the call site. It is emphatically not a hint that a caller may
  // pass a context, an override or a default alongside the action.
  assert.ok(
    Object.is(await build(() => OK).consult(COMMAND, { override: true }, null), OK),
    "surplus arguments must not change the answer: there is no context parameter and no second input to this question",
  );
  // A native Promise, not a thenable and not a subclass: a caller may hand this straight to
  // Promise.all or await it twice, and either would break on a hand-rolled thenable.
  for (const [label, behaviour] of [
    ["a synchronous value", () => OK],
    ["a resolved promise", () => Promise.resolve(OK)],
    ["a promise that settles later", () => settledLater(OK)],
    ["an async function", async () => OK],
    ["a thenable", () => ({ then(resolve) { resolve(OK); } })],
    ["a thenable that settles later", () => ({ then(resolve) { settledLater(OK).then(resolve); } })],
  ]) {
    const policy = build(behaviour);
    let returned;
    assert.doesNotThrow(() => { returned = policy.consult(COMMAND); }, `${label}: consult must never throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: consult must return a Promise`);
    assert.equal(Object.getPrototypeOf(returned), Promise.prototype, `${label}: it must be a native Promise, not a subclass or a thenable`);
    const value = await returned;
    assert.ok(Object.is(value, OK), `${label}: the collaborator's Result must be awaited and returned as the very same object`);
  }
  // The port is asynchronous by construction, and this row says so rather than letting a reader
  // assume the collaborator was consulted before consult() returned.
  let consulted = false;
  const pending = build(async () => { await settledLater(null); consulted = true; return OK; }).consult(COMMAND);
  assert.equal(consulted, false, "consult must return before a slow collaborator has settled: this port is asynchronous, and no answer is available synchronously");
  assert.ok(Object.is(await pending, OK), "and the awaited answer arrives afterwards");
  // A refusal is a rejection on every path, including the input gate — which is the half a
  // synchronous throw would break, because the gate runs first and would otherwise be the one
  // refusal that escaped the promise.
  await assertRejectsTypeError(() => build(() => OK).consult(undefined), "a missing action must reject, not throw");
  await assertRejectsTypeError(() => build(() => OK).consult(), "and so must no action at all");
  // A resolution that is not a genuine Result is a rejection, whichever route it arrived by.
  for (const [label, behaviour] of [
    ["a synchronous non-result", () => ({ isOk: true, value: { invoice: "7731" } })],
    ["a non-result from a promise", () => Promise.resolve({ isOk: true, value: { invoice: "7731" } })],
    ["a non-result from a thenable", () => ({ then(resolve) { resolve({ isOk: true }); } })],
    ["nothing at all", () => undefined],
  ]) {
    await assertRejectsTypeError(() => build(behaviour).consult(COMMAND), label);
  }
});

test("each call invokes the collaborator exactly once, with an undefined this and exactly the one action object it was given", async () => {
  mod();
  for (const [label, action] of [["a Command", COMMAND], ["a Query", QUERY]]) {
    const record = recorder();
    const policy = build(record.make("consult", () => OK));
    assert.ok(Object.is(await policy.consult(action), OK), `${label}: the Result comes back`);
    assert.equal(record.countOf("consult"), 1, `${label}: one consultation is one call to the collaborator — not zero, not two`);
    assert.equal(
      record.firstOf("consult").count, 1,
      `${label}: the collaborator is called with exactly one argument: a second would be a context this port neither has nor may invent`,
    );
    assert.ok(
      Object.is(record.firstOf("consult").args[0], action),
      `${label}: the collaborator must receive the very object the caller passed — not a copy, not a rebuild, and not a projection of its coordinates`,
    );
    // `this` is undefined: a collaborator that could reach the port could call it back, and a
    // collaborator that received the options object could read a member the caller never exposed.
    // The field is lifted out before being called, which is what makes an undefined receiver true by
    // construction rather than by discipline.
    assert.equal(record.firstOf("consult").self, undefined, `${label}: the collaborator must be invoked with an undefined this`);
    assert.notEqual(record.firstOf("consult").self, policy, `${label}: it must not receive the Policy as this`);
  }
  // The action travels whole and unopened. A port that read a coordinate off the action and passed
  // that instead would be deciding what its collaborator needed to know, and the day a collaborator
  // needed a coordinate this port had not thought to forward, the answer would be wrong rather than
  // missing.
  const forwarding = recorder();
  const marked = commandOf({ payload: { marker: "MARKER_payload_1e70" } });
  await build(forwarding.make("consult", () => OK)).consult(marked);
  const received = forwarding.firstOf("consult").args[0];
  assert.ok(Object.is(received, marked), "the collaborator receives the action itself");
  assert.equal(Object.getPrototypeOf(received), Command.prototype, "still an exact Command on the far side");
  assert.deepEqual(received.payload, marked.payload, "carrying its own payload, untouched");
  assert.ok(Object.isFrozen(received), "and still frozen: nothing was unpacked and repacked on the way through");
  // Four consultations are four collaborator calls. A collaborator called twice per answer is a
  // port that asked and then asked again to check; a collaborator called once for four questions is
  // a cache. Both are refused by the same count.
  const counting = recorder();
  const policy = build(counting.make("consult", () => OK));
  for (let round = 0; round < 4; round += 1) {
    assert.ok(Object.is(await policy.consult(COMMAND), OK), `round ${round} must resolve`);
  }
  assert.equal(
    counting.countOf("consult"), 4,
    "four questions about the identical action are exactly four collaborator calls: not one call and three remembered answers",
  );
  for (const call of counting.calls) {
    assert.equal(call.count, 1, "every call must pass exactly one argument");
    assert.ok(Object.is(call.args[0], COMMAND), "and it must be the action");
    assert.equal(call.self, undefined, "every call must observe an undefined this");
  }
  // A refused answer still costs exactly one call: the port does not retry, and does not ask a
  // second time in the hope of a better one.
  const failing = recorder();
  await assertRejectsTypeError(() => build(failing.make("consult", () => ({ isOk: true }))).consult(COMMAND), "a non-result answer");
  assert.equal(failing.countOf("consult"), 1, "a refused answer is one call, never a retry");
  const throwing = recorder();
  await assertRejects(() => build(throwing.make("consult", () => { throw new RangeError("boom"); })).consult(COMMAND), "a throwing collaborator");
  assert.equal(throwing.countOf("consult"), 1, "a failed answer is one call, never a retry");
});

// -------------------------------------------------------------------------------------
// D1–D2. The answer: identity, and the failure branch that is not a denial.
// -------------------------------------------------------------------------------------

test("a genuine Result is answered as the very same object by Object.is, and a failure Result resolves rather than becoming a refusal", async () => {
  mod();
  // The twin is the whole point of the first half. It is value-equal to OK, it is a genuine Result,
  // and it is a different object. A port that reconstructed the answer it was handed — reading the
  // branch and the value back off it and calling the factory again — would produce exactly this
  // twin, and would satisfy every equality-based assertion anyone might write. Object.is refuses it.
  const twin = Result.ok({ invoice: "7731" });
  assert.ok(twin.equals(OK) && OK.equals(twin), "the twin is value-equal to the original in both directions");
  assert.ok(!Object.is(twin, OK), "and it is nonetheless a different object");
  const answered = await build(() => OK).consult(COMMAND);
  assert.ok(
    Object.is(answered, OK),
    "the port must answer with the very object its collaborator produced: this port hands the Result on, it does not rebuild it",
  );
  assert.ok(!Object.is(answered, twin), "a port that rebuilt a value-equal Result would pass every equals-based check and must still fail here");
  // Delivered through each admissible route, because identity cannot depend on how the collaborator
  // chose to hand the value over.
  for (const [label, behaviour] of [
    ["a promise", () => Promise.resolve(OK)],
    ["a promise that settles later", () => settledLater(OK)],
    ["a thenable", () => ({ then(resolve) { resolve(OK); } })],
    ["an async collaborator", async () => OK],
  ]) {
    assert.ok(Object.is(await build(behaviour).consult(COMMAND), OK), `via ${label} it must be identical too`);
  }
  // ---- The failure branch. This is the centre of the row. ----
  //
  // `Result.failure` is an ordinary Result. It is not a denial, it is not a refusal, and it is not
  // this port's business what it means. A port that read `isOk` would be interpreting its
  // collaborator's answer, and the very first interpretation anyone reaches for is "false means no"
  // — which is an authorization model, invented here, in the one module that promised not to have
  // one. So the failure branch resolves, by identity, exactly like the ok branch.
  const failed = await build(() => FAILED).consult(COMMAND);
  assert.ok(Object.is(failed, FAILED), "a failure Result must resolve with the very object the collaborator produced");
  assert.equal(failed.isOk, false, "it is still the failure branch on the far side: nothing was flipped, wrapped or normalised");
  assert.ok(Object.is(failed.error, FAILED.error), "and it still carries its own error, the same object it always held");
  for (const [label, behaviour] of [
    ["a promise", () => Promise.resolve(FAILED)],
    ["a thenable", () => ({ then(resolve) { resolve(FAILED); } })],
    ["an async collaborator", async () => FAILED],
  ]) {
    const viaRoute = await build(behaviour).consult(COMMAND);
    assert.ok(Object.is(viaRoute, FAILED), `a failure delivered via ${label} must resolve identically`);
  }
  // Stated as the negative too, because "resolves" and "does not reject" are the two halves of the
  // promise and only one of them is proven by reading the value.
  const outcome = await rejectionOf(build(() => FAILED).consult(QUERY));
  assert.equal(
    outcome, NO_REJECTION,
    "a failure Result must never be turned into a rejection: a port that rejected on the failure branch would have decided that failure means denial, which is a policy this package did not write",
  );
  // Both branches travel on exactly the same terms, alternating on one instance, so neither is the
  // path the implementation happened to test.
  const branches = [OK, FAILED, OK, FAILED, FAILED, OK];
  let index = 0;
  const alternating = build(() => branches[index++]);
  for (const expected of branches) {
    const seen = await alternating.consult(COMMAND);
    assert.ok(Object.is(seen, expected), `each call answers with that call's own Result, ok or failure alike`);
  }
  assert.equal(index, branches.length, "and the collaborator was consulted once per call");
  // A second, different Result travels the same way — one instance is not calibrated to one answer.
  const other = Result.ok({ invoice: "9002" });
  assert.ok(Object.is(await build(() => other).consult(QUERY), other), "a different genuine Result is answered identically");
});

// -------------------------------------------------------------------------------------
// E1–E3. The two gates: what they refuse, in what order, and what they never repair.
// -------------------------------------------------------------------------------------

test("an inadmissible action is refused before the collaborator is reached, and the collaborator is never called at all", async () => {
  mod();
  // The order is the requirement, and it is not decorative. If the gate ran after the call, every
  // refusal below would already have handed an unrecognised object to the collaborator — which is
  // the one party in this arrangement that is entitled to trust what the port gives it. A port that
  // validated afterwards would be a port that leaked first and complained second.
  const candidates = [
    ["nothing at all", undefined],
    ["null", null],
    ["a hollow Command impostor", hollowCommand],
    ["a hollow Query impostor", hollowQuery],
    ["a Command subclass instance", derivedCommand],
    ["a Query subclass instance", derivedQuery],
    ["a transparent proxy over a genuine Command", new Proxy(COMMAND, {})],
    ["a transparent proxy over a genuine Query", new Proxy(QUERY, {})],
    ["a structural lookalike", { name: NAME, version: VERSION, principal: PRINCIPAL, payload: {} }],
    ["a JSON round trip of a Command", JSON.parse(JSON.stringify(COMMAND))],
    ["a JSON round trip of a Query", JSON.parse(JSON.stringify(QUERY))],
    ["the Command class itself", Command],
    ["the Query class itself", Query],
    ["the frozen Command prototype", Command.prototype],
    ["the frozen Query prototype", Query.prototype],
    ["a Result in the action position", OK],
    ["a failure Result in the action position", FAILED],
    ["a Principal", PRINCIPAL],
    ["a string", NAME],
    ["a number", VERSION],
    ["an array holding a genuine Command", [COMMAND]],
    ["a wrapper object holding a genuine Command", { action: COMMAND }],
    ["a promise of a genuine Command", Promise.resolve(COMMAND)],
    ["a thenable resolving to a genuine Command", { then(resolve) { resolve(COMMAND); } }],
    ["a function returning a genuine Command", () => COMMAND],
    ["a null-prototype shape", Object.assign(Object.create(null), { name: NAME, version: VERSION })],
    ["a Map", new Map()],
    ["an Error", new Error(NAME)],
    ["a symbol", Symbol("action")],
    ["a bigint", 20260808n],
    ["true", true],
  ];
  for (const [label, candidate] of candidates) {
    const record = recorder();
    const policy = build(record.make("consult", () => OK));
    const error = await assertRejectsTypeError(() => policy.consult(candidate), label);
    assert.equal(error.message, ACTION_MESSAGE, `${label}: the input gate must refuse with its own fixed message`);
    assert.equal(
      record.countOf("consult"), 0,
      `${label}: the collaborator must never have been called — the gate runs first, so an inadmissible action never reaches it`,
    );
  }
  // A promise of a genuine action is the sharpest of those: everything the caller wanted is in
  // there, and the port must still refuse rather than await it. `consult` takes an action, not a
  // promise of one; awaiting the argument would make the input gate asynchronous, would let an
  // arbitrary thenable run before the gate had decided anything, and would quietly turn "hand me an
  // action" into "hand me something that might become one".
  const awaiting = recorder();
  await assertRejectsTypeError(() => build(awaiting.make("consult", () => OK)).consult(Promise.resolve(COMMAND)), "a promise of an action");
  assert.equal(awaiting.countOf("consult"), 0, "and it is refused without the collaborator being reached");
  let thenableRan = false;
  const hostile = { then(resolve) { thenableRan = true; resolve(COMMAND); } };
  await assertRejectsTypeError(() => build(() => OK).consult(hostile), "a thenable in the action position");
  assert.equal(
    thenableRan, false,
    "the argument's then must never be called: the input gate does not await what it was handed, so a hostile thenable in the action position never runs",
  );
  // No coercion either. A port that coerced would be running caller code inside its own admission
  // check, and the value it admitted would not be the value it was handed.
  const traps = [];
  const coercible = {
    toString() { traps.push("toString"); return String(COMMAND); },
    valueOf() { traps.push("valueOf"); return COMMAND; },
    toJSON() { traps.push("toJSON"); return COMMAND.toJSON(); },
    [Symbol.toPrimitive](hint) { traps.push(`toPrimitive:${hint}`); return String(COMMAND); },
  };
  await assertRejectsTypeError(() => build(() => OK).consult(coercible), "an object that would coerce into something action-shaped");
  assert.deepEqual(traps, [], `a coercion hook was consulted: ${traps.join(", ")} — this port recognises an action, it never converts one`);
  assert.ok(Object.is(coercible.valueOf(), COMMAND), "this file can reach the genuine Command through valueOf");
  assert.deepEqual(traps, ["valueOf"], "which proves the hook works and that the port simply never called it");
  // And the genuine articles still pass, which is what stops "refuse everything" from satisfying
  // this row.
  assert.ok(Object.is(await build(() => OK).consult(COMMAND), OK), "a genuine Command is still admitted");
  assert.ok(Object.is(await build(() => OK).consult(QUERY), OK), "and a genuine Query");
});

test("an inadmissible answer is refused as it stands, never repaired, unwrapped or rebuilt into a Result", async () => {
  mod();
  // Refused, not repaired. A port that read the branch and the value off a lookalike and built a
  // real Result from them would be deciding what its collaborator meant, and the next collaborator
  // to arrive would be calibrated against a repair rather than against the contract. Worse, the
  // repair would be this port authoring an answer — and an authored answer in a policy port is a
  // decision, however mechanically it was assembled.
  const repairable = [
    ["an ok-shaped lookalike", { isOk: true, value: { invoice: "7731" } }],
    ["a failure-shaped lookalike", { isOk: false, error: FAILED.error }],
    ["a hollow Result impostor", hollowResult],
    ["a JSON round trip of an ok Result", JSON.parse(JSON.stringify(OK))],
    ["a JSON round trip of a failure Result", JSON.parse(JSON.stringify(FAILED))],
    ["a rendering of a Result", OK.toJSON()],
    ["a genuine Result inside an array", [OK]],
    ["a genuine Result inside a wrapper", { result: OK }],
    ["a bare value that a port might wrap", { invoice: "7731" }],
    ["a bare error that a port might wrap", FAILED.error],
    ["a boolean a port might read as a verdict", true],
    ["the other boolean", false],
    ["the Result class itself", Result],
    ["the frozen Result prototype", Result.prototype],
    ["an action in the answer position", COMMAND],
    ["a query in the answer position", QUERY],
    ["nothing at all", undefined],
    ["null", null],
    ["a string", "ok"],
    ["a Promise", Promise.resolve()],
    ["a Set", new Set()],
    ["a symbol", Symbol("result")],
  ];
  for (const [label, answer] of repairable) {
    const error = await assertRejectsTypeError(() => build(() => answer).consult(COMMAND), label);
    assert.equal(error.message, RESULT_MESSAGE, `${label}: the output gate must refuse with its own fixed message`);
    assert.ok(!(error instanceof Result), `${label}: the refusal must be an error, never a Result assembled out of what was refused`);
  }
  // The two repairs a port would most plausibly attempt, called out by name and proven not to have
  // happened. Neither lookalike may come back as a Result at all: the caller must receive a
  // rejection, not a value that merely looks like the answer it asked for.
  for (const [label, answer] of [
    ["an ok-shaped lookalike", { isOk: true, value: { invoice: "7731" } }],
    ["a failure-shaped lookalike", { isOk: false, error: FAILED.error }],
  ]) {
    const outcome = await rejectionOf(build(() => answer).consult(QUERY));
    assert.notEqual(outcome, NO_REJECTION, `${label}: must reject`);
    assert.ok(!(outcome instanceof Result), `${label}: must not be answered with a Result built from its parts`);
    assert.ok(outcome instanceof TypeError, `${label}: the refusal is a TypeError`);
  }
  // A bare value must not be wrapped into Result.ok, and a bare error must not be wrapped into
  // Result.failure. These are the two one-line conveniences that would make this port an author of
  // answers rather than a conduit for them.
  const wrapped = await rejectionOf(build(() => ({ invoice: "7731" })).consult(COMMAND));
  assert.ok(!(wrapped instanceof Result) && wrapped instanceof TypeError, "a bare value must not be wrapped into an ok Result");
  const wrappedError = await rejectionOf(build(() => FAILED.error).consult(COMMAND));
  assert.ok(!(wrappedError instanceof Result) && wrappedError instanceof TypeError, "and a bare error must not be wrapped into a failure Result");
  // No coercion on the way out either, and no reading of the candidate's parts. The port recognises
  // the value; it does not inspect it, and it does not ask it what it would like to be.
  const traps = [];
  const coercible = {
    get isOk() { traps.push("isOk"); return true; },
    get value() { traps.push("value"); return { invoice: "7731" }; },
    get error() { traps.push("error"); return FAILED.error; },
    toJSON() { traps.push("toJSON"); return OK.toJSON(); },
    valueOf() { traps.push("valueOf"); return OK; },
    [Symbol.toPrimitive](hint) { traps.push(`toPrimitive:${hint}`); return String(OK); },
  };
  await assertRejectsTypeError(() => build(() => coercible).consult(COMMAND), "an answer that would coerce into something Result-shaped");
  assert.deepEqual(traps, [], `a hook on the refused answer was consulted: ${traps.join(", ")} — reading isOk would be this port interpreting a verdict it never receives`);
  await assertRejectsTypeError(() => build(() => Promise.resolve(coercible)).consult(QUERY), "the same object delivered through a promise");
  assert.deepEqual(traps, [], "and still nothing on it was read");
  assert.ok(Object.is(coercible.valueOf(), OK), "this file can reach the genuine Result through valueOf");
  assert.deepEqual(traps, ["valueOf"], "which proves the hook works and that the port simply never called it");
  // A genuine Result is still admitted afterwards, so this row is not satisfied by refusing
  // everything.
  assert.ok(Object.is(await build(() => OK).consult(COMMAND), OK), "a genuine Result still returns by identity");
  assert.ok(Object.is(await build(() => FAILED).consult(COMMAND), FAILED), "and so does a genuine failure");
});

test("admission needs both halves: prototype identity alone admits a hollow impostor, and the private brand alone admits a subclass", async () => {
  mod();
  const real = build(() => OK);
  assert.ok(Object.is(await real.consult(COMMAND), OK), "the genuine pair works, which is what makes the refusals below meaningful");
  // ---- Half one is not enough, on the input side. ----
  // An impostor built straight on the frozen prototype. It answers `instanceof`, it carries the
  // tag, it renders as the real thing, and its prototype *is* Command.prototype — so the plausible
  // implementation of this check, a bare prototype comparison, admits it. It holds no private field,
  // so it is not a Command at all: nothing ever ran that constructor for it, and therefore none of
  // that constructor's invariants were ever checked. Forwarding it would hand the collaborator an
  // object whose `name` throws on read.
  for (const [label, hollow, klass, probe] of [
    ["a hollow Command", hollowCommand, Command, COMMAND_BRAND],
    ["a hollow Query", hollowQuery, Query, QUERY_BRAND],
  ]) {
    assert.equal(Object.getPrototypeOf(hollow), klass.prototype, `${label} passes a prototype-identity check exactly`);
    assert.ok(hollow instanceof klass, `${label} passes instanceof, which walks the same chain`);
    assert.equal(Object.prototype.toString.call(hollow), `[object ${klass.name}]`, `${label} renders exactly like the real thing`);
    assert.equal(brandAnswers(probe, hollow), false, `only the private brand tells ${label} apart`);
    const record = recorder();
    await assertRejectsTypeError(() => build(record.make("consult", () => OK)).consult(hollow), label);
    assert.equal(record.countOf("consult"), 0, `${label} must be refused before the collaborator sees it`);
  }
  // ---- Half two is not enough either, on the input side. ----
  // A subclass instance. The real constructor ran for it, so the private field is installed and the
  // brand probe answers — a brand-only check admits it. Its prototype is not the frozen one, and it
  // may carry behaviour, state and overrides the Application ring never saw.
  for (const [label, derived, klass, probe] of [
    ["a Command subclass instance", derivedCommand, Command, COMMAND_BRAND],
    ["a Query subclass instance", derivedQuery, Query, QUERY_BRAND],
  ]) {
    assert.equal(brandAnswers(probe, derived), true, `${label} passes a brand-only check: the real constructor installed the private field`);
    assert.notEqual(Object.getPrototypeOf(derived), klass.prototype, `${label} has the derived prototype, not the frozen one`);
    assert.ok(derived instanceof klass, `${label} passes instanceof, and instanceof is therefore not the check either`);
    const record = recorder();
    await assertRejectsTypeError(() => build(record.make("consult", () => OK)).consult(derived), label);
    assert.equal(record.countOf("consult"), 0, `${label} must be refused before the collaborator sees it`);
  }
  // ---- Therefore both halves are load-bearing on the input side, stated as a fact. ----
  assert.notEqual(
    Object.getPrototypeOf(hollowCommand) === Command.prototype,
    Object.getPrototypeOf(derivedCommand) === Command.prototype,
    "the two impostors disagree on the prototype half",
  );
  assert.notEqual(
    brandAnswers(COMMAND_BRAND, hollowCommand), brandAnswers(COMMAND_BRAND, derivedCommand),
    "and they disagree on the brand half: each is admitted by exactly the check the other defeats, which is why neither check alone is the contract",
  );
  assert.equal(Object.getPrototypeOf(COMMAND), Command.prototype, "the genuine Command passes the prototype half");
  assert.equal(brandAnswers(COMMAND_BRAND, COMMAND), true, "and the brand half");
  // ---- The output side, where only one counterexample can be built, and this row says why. ----
  // The brand half is load-bearing on the answer too: a hollow Result passes a prototype comparison
  // exactly and holds no branch at all, so a port that admitted it would resolve with an object
  // whose `isOk` throws the moment the caller reads it.
  assert.equal(Object.getPrototypeOf(hollowResult), Result.prototype, "a hollow Result passes a prototype-identity check exactly");
  assert.ok(hollowResult instanceof Result, "and passes instanceof");
  assert.equal(brandAnswers(RESULT_BRAND, hollowResult), false, "and only the private brand tells it apart");
  await assertRejectsTypeError(() => build(() => hollowResult).consult(COMMAND), "a hollow Result impostor");
  // The mirror-image counterexample — a brand-carrying value whose prototype is not
  // `Result.prototype` — cannot be constructed at all, and this file states that rather than
  // quietly skipping it. `Result` has no public constructor, so a subclass cannot install the
  // private field; its instances are frozen, so a prototype cannot be swapped afterwards; and the
  // static factories name `Result` directly, so reaching them through a subclass mints an exact
  // `Result` anyway. The prototype half is therefore required by the contract and unfalsifiable by
  // experiment on this type — an honest limit on what this row can demonstrate, not a gap in what
  // the implementation must carry.
  class DerivedResult extends Result {}
  assert.throws(() => new DerivedResult(), TypeError, "a Result subclass cannot be constructed: the constructor is private, so no subclass instance can ever carry the brand");
  assert.throws(() => Object.setPrototypeOf(OK, Object.create(Result.prototype)), TypeError, "and a genuine Result is frozen, so its prototype cannot be moved out from under the check");
  const throughSubclass = DerivedResult.ok({ invoice: "7731" });
  assert.equal(Object.getPrototypeOf(throughSubclass), Result.prototype, "reaching the factory through a subclass still mints an exact Result");
  assert.ok(
    Object.is(await build(() => throughSubclass).consult(COMMAND), throughSubclass),
    "and that exact Result is admitted and returned by identity, so the closed constructor costs a legitimate caller nothing",
  );
  // A proxy over a genuine value of any of the three types is refused, on both sides. The instance
  // behind it is real and its prototype reads correctly — and a private field is looked up on the
  // proxy rather than on its target, so the brand probe refuses it. That is a residual worth stating
  // plainly rather than a bug: wrapping any of these in the most ordinary proxy there is makes it
  // unusable here, and this port refuses it deliberately rather than guessing past it.
  await assertRejectsTypeError(() => build(() => OK).consult(new Proxy(COMMAND, {})), "a transparent proxy over a genuine Command");
  await assertRejectsTypeError(() => build(() => new Proxy(OK, {})).consult(COMMAND), "a transparent proxy over a genuine Result");
  const forwardingResult = new Proxy(OK, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.equal(forwardingResult.isOk, true, "a forwarding proxy answers every public question exactly as the real Result does");
  await assertRejectsTypeError(() => build(() => forwardingResult).consult(COMMAND), "a forwarding proxy over a genuine Result");
  // What the brand actually proves, stated exactly so nothing larger is read into it. It proves the
  // owning constructor ran, and therefore that that constructor's invariants were checked. It proves
  // nothing about whether the action is the one really being attempted, whether its principal is
  // truly the caller, or whether the answer is correct. A collaborator may mint a perfectly genuine
  // Result for any action it likes, and this port hands it straight on.
  const fabricated = Result.ok({ invoice: "not-the-one-that-was-asked-about" });
  assert.equal(brandAnswers(RESULT_BRAND, fabricated), true, "a fabricated answer carries a perfectly genuine brand");
  assert.ok(
    Object.is(await build(() => fabricated).consult(COMMAND), fabricated),
    "and it is admitted without question: the brand is a construction proof, never a truth claim, and this port makes no claim it cannot support",
  );
  const foreignTenant = commandOf({ principal: new Principal(new TenantId("9c858901-8a57-4791-81fe-4c455b099bc9"), ACTOR) });
  assert.ok(
    Object.is(await build(() => OK).consult(foreignTenant), OK),
    "an action naming any tenant at all is forwarded unexamined: this port proves construction, never identity, authorisation or tenant truth",
  );
});

test("every refusal is one of three fixed messages, chosen by which rule broke, and none of them echoes what it refused", async () => {
  const m = mod();
  // Three rules, three messages, fixed as literals in this file rather than harvested from whatever
  // the module produced. A refusal that composed its message from the candidate would be a side
  // channel: it would tell a caller *which* of its near-misses it got wrong, and it would carry a
  // payload, a tenant or an actor straight into a log nobody redacted.
  const markedPayload = "MARKER_payload_1e70";
  const markedActor = new ActorId("MARKER_actor_1e70");
  const markedPrincipal = new Principal(TENANT, markedActor);
  const markedCommand = commandOf({ principal: markedPrincipal, payload: { marker: markedPayload } });
  const markedQuery = queryOf({ principal: markedPrincipal, payload: { marker: markedPayload } });

  const rendered = (error) => [
    ["the message", String(error?.message ?? "")],
    ["the string form", String(error)],
    ["the stack", String(error?.stack ?? "")],
    ["the own properties", JSON.stringify(Object.getOwnPropertyDescriptors(Object(error)))],
    ["the cause", String(error?.cause ?? "")],
  ];

  const noEcho = (error, label) => {
    for (const [where, text] of rendered(error)) {
      assert.ok(!text.includes("MARKER_"), `${label}: the refused candidate was echoed through ${where}: ${text}`);
      assert.ok(!text.includes(TENANT.toString()), `${label}: a tenant identifier was echoed through ${where}`);
      assert.ok(!text.includes(CORRELATION.toString()), `${label}: a correlation identifier was echoed through ${where}`);
    }
  };

  // ---- Rule one: the options object. A synchronous TypeError, because construction is synchronous.
  const optionsMessages = [];
  for (const [label, options] of [
    ["a marked extra key", { consult: () => OK, MARKER_extra_1e70: () => OK }],
    ["a marked non-function", { consult: "MARKER_consult_1e70" }],
    ["a null-prototype carrier", Object.assign(Object.create(null), { consult: () => OK })],
    ["no options at all", undefined],
    ["an empty object", {}],
    ["a function", () => OK],
  ]) {
    let caught = null;
    try { new m.Policy(options); } catch (error) { caught = error; }
    assert.ok(caught instanceof TypeError, `${label}: construction must be refused with a TypeError, got ${inspectShort(caught)}`);
    assert.equal(caught.message, OPTIONS_MESSAGE, `${label}: the constructor's refusal must be exactly the fixed options message`);
    optionsMessages.push(caught.message);
    noEcho(caught, label);
  }
  assert.equal(new Set(optionsMessages).size, 1, "the options refusal must be one fixed message across every way of getting it wrong");

  // The carrier that answers every structural question legally and still holds nothing. Its traps
  // are within their invariants over an empty, extensible target: it reports the ordinary prototype,
  // it reports exactly the one own key `consult`, and it then reports *no descriptor* for that very
  // key. A carrier is entitled to do this, so the constructor must treat the missing descriptor as
  // one more way of getting the options wrong and refuse it by the same fixed message — not fail
  // while inspecting it, and not fetch the value to find out.
  //
  // The get trap is the proof of the second half. It throws, and it records that it was reached, so
  // "the candidate was never read" is a fact this row observes rather than a claim it reads off the
  // source. If the constructor ever reached for the value, the escaping error would be the trap's
  // own Error rather than the fixed TypeError, and the flag beneath would be true.
  let candidateGetTrapRan = false;
  const descriptorlessCarrier = new Proxy({}, {
    getPrototypeOf() { return Object.prototype; },
    ownKeys() { return ["consult"]; },
    getOwnPropertyDescriptor() { return undefined; },
    get() { candidateGetTrapRan = true; throw new Error("candidate get trap must not run"); },
  });
  // The carrier really is legal on every question the constructor is able to ask before the
  // descriptor, so the refusal below is a refusal of the missing descriptor and nothing else.
  assert.equal(Object.getPrototypeOf(descriptorlessCarrier), Object.prototype, "the carrier reports the ordinary prototype");
  assert.deepEqual(Reflect.ownKeys(descriptorlessCarrier), ["consult"], "and exactly the one own key consult");
  assert.equal(Object.getOwnPropertyDescriptor(descriptorlessCarrier, "consult"), undefined, "and then no descriptor at all for that key");
  let descriptorlessCaught = null;
  try { new m.Policy(descriptorlessCarrier); } catch (error) { descriptorlessCaught = error; }
  assert.ok(
    descriptorlessCaught instanceof TypeError,
    `a carrier reporting an own consult key with no descriptor must be refused with a TypeError, got ${inspectShort(descriptorlessCaught)}`,
  );
  assert.equal(
    candidateGetTrapRan, false,
    "the candidate was fetched: the descriptor is read and the value is never fetched, so no caller code may run while the options are being admitted",
  );
  assert.ok(
    !String(descriptorlessCaught?.message ?? "").includes("candidate get trap"),
    "and the escaping refusal must not be the carrier's own error wearing the constructor's place",
  );
  assert.equal(
    descriptorlessCaught.message, OPTIONS_MESSAGE,
    "and the refusal must be exactly the fixed options message: a missing descriptor is one more way of getting the options wrong, not an error escaping from the inspection itself",
  );
  noEcho(descriptorlessCaught, "a carrier reporting an own consult key with no descriptor");
  // The other side of the same rule, restated here so this row cannot be satisfied by refusing every
  // proxy. A transparent proxy over legal options answers every question the constructor can ask
  // exactly as its target does, and remains admitted: this port claims no proxy detection, because
  // none exists to claim.
  const legalProxyOptions = new Proxy({ consult: () => OK }, {});
  assert.doesNotThrow(
    () => new m.Policy(legalProxyOptions),
    "a transparent proxy over legal options stays admissible: the refusal above is of a missing descriptor, never of interposition, which nothing here can detect",
  );

  // ---- Rule two: the action. Every inadmissible action, however it is wrong, gets one message.
  const actionMessages = [];
  for (const [label, candidate] of [
    ["a marked lookalike", { name: NAME, version: VERSION, marker: markedPayload }],
    ["a marked hollow impostor", Object.defineProperty(Object.create(Command.prototype), "payload", { value: { marker: markedPayload }, enumerable: true })],
    ["a marked Command subclass instance", new DerivedCommand({ name: NAME, version: VERSION, principal: markedPrincipal, correlationId: CORRELATION, causationId: CAUSATION, idempotencyKey: IDEMPOTENCY, payload: { marker: markedPayload } })],
    ["a marked JSON round trip", JSON.parse(JSON.stringify(markedCommand))],
    ["a marked query round trip", JSON.parse(JSON.stringify(markedQuery))],
    ["a marked string", `MARKER_action_1e70`],
    ["nothing at all", undefined],
    ["a Result in the action position", OK],
  ]) {
    const error = await assertRejectsTypeError(() => build(() => OK).consult(candidate), label);
    assert.equal(error.message, ACTION_MESSAGE, `${label}: the action refusal must be exactly the fixed action message`);
    actionMessages.push(error.message);
    noEcho(error, label);
  }
  assert.equal(new Set(actionMessages).size, 1, "the action refusal must be one fixed message: which near-miss it was is not the caller's to learn from an error");

  // ---- Rule three: the answer. Same discipline, and a marked answer must not travel back either.
  const resultMessages = [];
  for (const [label, answer] of [
    ["a marked lookalike", { isOk: true, value: { marker: markedPayload } }],
    ["a marked hollow Result", Object.defineProperty(Object.create(Result.prototype), "value", { value: { marker: markedPayload }, enumerable: true })],
    ["a marked JSON round trip", JSON.parse(JSON.stringify(Result.ok({ marker: markedPayload })))],
    ["a marked bare value", { marker: markedPayload }],
    ["a marked string", "MARKER_result_1e70"],
    ["nothing at all", undefined],
    ["an action in the answer position", markedCommand],
  ]) {
    const error = await assertRejectsTypeError(() => build(() => answer).consult(COMMAND), label);
    assert.equal(error.message, RESULT_MESSAGE, `${label}: the answer refusal must be exactly the fixed result message`);
    resultMessages.push(error.message);
    noEcho(error, label);
  }
  assert.equal(new Set(resultMessages).size, 1, "the answer refusal must be one fixed message too");

  // ---- The three are three. A single shared message would be cheaper and would tell a caller
  // nothing about which end of the port it got wrong — the argument it passed, or the collaborator
  // it wired.
  assert.equal(new Set([OPTIONS_MESSAGE, ACTION_MESSAGE, RESULT_MESSAGE]).size, 3, "the three rules must be distinguishable from one another");
  for (const message of [OPTIONS_MESSAGE, ACTION_MESSAGE, RESULT_MESSAGE]) {
    assert.ok(message.length > 0, "a silent TypeError explains nothing");
    // And none of them may carry the vocabulary this port refuses to own. A refusal that mentioned
    // authorization, denial or a decision would be documenting a boundary that does not exist here —
    // and an error message is where a reader looks first to learn what a module is for.
    for (const forbidden of [
      /\ballow/i, /\bden(?:y|ies|ied|ial)\b/i, /\bpermit/i, /\bauthoriz/i, /\bauthenticat/i,
      /\bdecid/i, /\bdecision\b/i, /\brule\b/i, /\brole\b/i, /\bpermission/i, /\bscope\b/i,
      /\bsession\b/i, /\btoken\b/i, /\benforce/i, /\bpdp\b/i, /\bpep\b/i, /\brbac\b/i, /\babac\b/i,
    ]) {
      assert.ok(!forbidden.test(message), `the message "${message}" must not name ${forbidden}: this port refuses a value, it never refuses an access`);
    }
  }
});

// -------------------------------------------------------------------------------------
// F1. Independence between calls, and what a failing collaborator does.
// -------------------------------------------------------------------------------------

test("calls are independent and uncached: no memo, no single-flight, no queue, no imposed ordering, and a failure propagates by identity", async () => {
  mod();
  // A hundred consultations of the *same* action, each answered by that call's own Result. This is
  // the shape a decision cache would break first: keyed by the action, a cache would have returned
  // the first answer a hundred times, and nothing in this port may notice that the answer changed
  // between calls — noticing would mean remembering, and remembering is the cache this row forbids.
  const answers = [];
  for (let i = 0; i < 100; i += 1) answers.push(i % 2 === 0 ? Result.ok({ n: i }) : Result.failure(new KernelError({ code: `CASE_${i}`, details: null, cause: null })));
  let index = 0;
  const policy = build(() => answers[index++]);
  const seen = [];
  for (let call = 0; call < answers.length; call += 1) seen.push(await policy.consult(COMMAND));
  assert.equal(seen.length, 100, "a hundred consultations must produce a hundred answers");
  for (let i = 0; i < answers.length; i += 1) {
    assert.ok(Object.is(seen[i], answers[i]), `call ${i} must return its own Result: a cache keyed on the action would have returned the first one every time`);
  }
  assert.equal(index, 100, "and the collaborator must have been consulted exactly a hundred times");
  assert.equal(new Set(seen).size, 100, "a hundred distinct answers came back: nothing was substituted or reused");
  assert.equal(seen.filter((r) => !r.isOk).length, 50, "half of them were failures, and every one of them resolved");
  // Two Policy instances share nothing. There is no module-level state for them to meet in, so one
  // cannot observe, delay or influence the other.
  const left = build(() => OK);
  const right = build(() => FAILED);
  const [a, b] = await Promise.all([left.consult(COMMAND), right.consult(COMMAND)]);
  assert.ok(Object.is(a, OK), "the first is unaffected by the second");
  assert.ok(Object.is(b, FAILED), "and the second by the first");
  // The direct proof of independence, and this row's whole reason for existing.
  //
  // The hundred-call loop proves a hundred answers arrived and that none was copied from another.
  // What it cannot prove is that two calls were ever in flight together: a port holding a
  // `#previous` promise and chaining each call behind the last produces exactly those hundred
  // values, in exactly that order, and passes every assertion above unchanged. Independence is
  // therefore proven directly here, by driving two consultations whose collaborator hands back a
  // promise nobody but this test can settle, and then settling them in the opposite order to the
  // one they were started in.
  //
  // No timer, no wall clock and no sort. The evidence is a settlement log written by handlers
  // attached before anything was resolved, so the order in the log *is* the order the two calls
  // settled. And every wait below is a bounded microtask drain rather than an await on a call: a
  // port that queued or single-flighted these calls must fail this row promptly, not hang it
  // waiting for a second collaborator call its own queue will never make.
  const gates = [];
  const gated = build(function gatedConsult() {
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    gates.push({ promise, settle });
    return promise;
  });
  const drain = async () => { for (let tick = 0; tick < 16; tick += 1) await null; };
  const settlements = [];
  const first = gated.consult(COMMAND);
  const second = gated.consult(COMMAND);
  assert.notEqual(first, second, "two consultations are two promises: a single-flight port would have handed the same one back twice");
  first.then((value) => { settlements.push(["first", value]); }, (error) => { settlements.push(["first", error]); });
  second.then((value) => { settlements.push(["second", value]); }, (error) => { settlements.push(["second", error]); });
  await drain();
  // Both calls are outstanding at once, and neither has been allowed to finish. A queue would still
  // be holding the second call back here, because the first has not been resolved and cannot be
  // until this test says so. Note that both were made with the *identical* action — which is exactly
  // the case a single-flight optimisation would collapse.
  assert.equal(
    gates.length, 2,
    "both consultations must have reached the collaborator before either was resolved: a single-flight port calls it once and shares the result, and a queued port would still be waiting for the first to finish",
  );
  assert.notEqual(gates[0].promise, gates[1].promise, "each call must await its own pending answer, not one promise shared between them");
  assert.deepEqual(settlements, [], "and neither call may settle while both collaborator promises are still pending");
  // The second call's answer is produced first, and the second call must settle first. This is the
  // ordering a queue cannot produce: behind a `#previous` chain the second call cannot finish before
  // the first, however promptly its own collaborator answered.
  gates[1].settle(FAILED);
  await drain();
  assert.equal(settlements.length, 1, "resolving the second call's own answer must settle the second call, and it alone");
  assert.equal(settlements[0][0], "second", "the second call settles first: its answer does not wait on one that has not been produced");
  assert.ok(Object.is(settlements[0][1], FAILED), "and it resolves with its own Result — a failure, resolved, not rejected");
  gates[0].settle(OK);
  await drain();
  assert.equal(settlements.length, 2, "resolving the first call's answer settles the first call");
  assert.deepEqual(
    settlements.map(([label]) => label), ["second", "first"],
    "the settlement log, read in the order it was written: exactly second then first, the inverse of the order the calls were started in",
  );
  assert.ok(Object.is(settlements[1][1], OK), "the first call resolves with its own Result, unchanged");
  assert.ok(Object.is(await second, FAILED), "the second call's promise resolves with the second answer");
  assert.ok(Object.is(await first, OK), "and the first call's with the first");
  assert.ok(Object.isFrozen(gated), "the instance must still be frozen after two overlapping calls");
  assert.deepEqual(Object.getOwnPropertyNames(gated), [], "and must still carry no own property: nothing was stored to sequence them");
  // Concurrent calls on one instance do not interfere either: there is no in-flight flag here,
  // because there is no boundary to hold open.
  let concurrent = 0;
  const shared = build(async () => { const call = concurrent++; await settledLater(null); return answers[call]; });
  const together = await Promise.all([shared.consult(COMMAND), shared.consult(QUERY), shared.consult(COMMAND)]);
  assert.equal(new Set(together).size, 3, "three concurrent consultations are three collaborator calls, each with its own answer");
  for (const answered of together) assert.ok(answers.includes(answered), "and each answer is one the collaborator actually produced");
  // A hostile thenable is a real residual, and a larger one than the reads above. Because `await`
  // calls `then`, an answer that carries one gets to run arbitrary code inside this port's call — it
  // may resolve, it may reject, it may do neither for a while, and it may do anything else first.
  // Nothing here prevents that, and these assertions record what an implementation is therefore
  // exposed to rather than claiming an isolation this port does not have. The input side is closed
  // — E1 proves the action's `then` is never called — but the answer must be awaited, so this door
  // stays open by construction.
  let executed = false;
  const hostile = { then(resolve) { executed = true; resolve(OK); } };
  assert.ok(Object.is(await build(() => hostile).consult(COMMAND), OK), "a hostile thenable answer may resolve, and its resolution is admitted like any other");
  assert.equal(executed, true, "and its then body ran inside the port's call: this is the residual, stated rather than hidden");
  await assertRejectsTypeError(
    () => build(() => ({ then(resolve) { resolve(Object.create(Result.prototype)); } })).consult(COMMAND),
    "a thenable resolving to a hollow Result",
  );
  // A `then` that is not callable is not a thenable at all: the object *is* the resolution, and the
  // ordinary admission rule refuses it as the lookalike it is. It is refused for holding no brand,
  // not for having disappointed an await.
  for (const [label, answer] of [["a Result", { then: OK }], ["a number", { then: 7 }]]) {
    const error = await assertRejectsTypeError(() => build(() => answer).consult(COMMAND), `an answer whose then is ${label}`);
    assert.equal(error.message, RESULT_MESSAGE, `an answer whose then is ${label} is refused by the ordinary output rule`);
  }
  // A failing collaborator propagates by identity, whatever it threw and however it threw it. A port
  // that re-typed the failure would make a caller matching on its own sentinel never match, and a
  // port that converted it into a failure Result would be authoring an answer out of an outage.
  const boom = new RangeError("MARKER_consult_1e70");
  for (const [label, behaviour] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
    ["a rejecting thenable", () => ({ then(resolve, reject) { reject(boom); } })],
  ]) {
    const caught = await assertRejects(() => build(behaviour).consult(COMMAND), label);
    assert.equal(caught, boom, `${label}: the very value the collaborator threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.ok(!(caught instanceof Result), `${label}: and it must not be converted into a failure Result: an outage is not an answer`);
  }
  const sentinel = Symbol("MARKER_sentinel_1e70");
  for (const thrown of ["unavailable", 0, NaN, null, undefined, false, 7n, sentinel, { code: "POLICY_UNAVAILABLE" }]) {
    const caught = await rejectionOf(build(() => { throw thrown; }).consult(COMMAND));
    assert.ok(Object.is(caught, thrown), `a collaborator throwing ${inspectShort(thrown)} must propagate it by identity`);
    const alsoCaught = await rejectionOf(build(() => Promise.reject(thrown)).consult(QUERY));
    assert.ok(Object.is(alsoCaught, thrown), `a collaborator rejecting with ${inspectShort(thrown)} must propagate it by identity`);
  }
  // Nothing is remembered across any of it. There is no state to poison, so a failure, a refusal and
  // a success alternate freely on one instance: a port that latched its first failure would turn one
  // unavailable answer into a dead instance, and nothing would tell the caller which call killed it.
  let phase = 0;
  const flaky = build(() => {
    phase += 1;
    if (phase === 1) throw boom;
    if (phase === 2) return { isOk: true };
    if (phase === 3) return FAILED;
    return OK;
  });
  assert.equal(await rejectionOf(flaky.consult(COMMAND)), boom, "the first call fails by identity");
  const refused = await rejectionOf(flaky.consult(COMMAND));
  assert.ok(refused instanceof TypeError && refused.message === RESULT_MESSAGE, "the second is refused as a lookalike");
  assert.ok(Object.is(await flaky.consult(COMMAND), FAILED), "the third resolves with a failure Result, unaffected by either");
  assert.ok(Object.is(await flaky.consult(COMMAND), OK), "and the fourth with an ok Result");
  assert.equal(phase, 4, "each call reached the collaborator exactly once, with nothing accumulated in between");
  assert.ok(Object.isFrozen(flaky), "the instance must still be frozen after all of it");
  assert.deepEqual(Object.getOwnPropertyNames(flaky), [], "and must still carry no own property");
});
