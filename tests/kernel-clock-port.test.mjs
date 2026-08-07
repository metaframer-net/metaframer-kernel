import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// P-M1-05 — the Clock port, frozen as a public surface
//
// This file is the whole observable surface of src/application/clock.mjs: one exported class that
// takes exactly one collaborator function and guarantees what the caller receives when it asks for
// the time. It is written before the module exists, so every assertion here is a requirement rather
// than a description of something already built.
//
// The scope is the port and nothing beyond it. A port says what a boundary must do; it is never
// evidence that anything has been built behind one. Nothing here may be read as a claim that the
// kernel can tell the time, that a system clock has been reached, or that the kernel is ready.
//
// What this port actually promises, stated plainly so nobody has to infer it:
//
//   - `now()` calls its collaborator exactly once, with zero arguments and an undefined receiver,
//     awaits whatever came back, and either resolves with that value *unchanged* — when it is a
//     string primitive spelled exactly `YYYY-MM-DDTHH:MM:SS.sssZ` and arithmetically a real
//     Gregorian instant in years 0001–9999 — or rejects. There is no third outcome.
//
// And what it explicitly does *not* promise, because a clock port is the single easiest place in a
// kernel to accidentally claim more than was built:
//
//   - not that the value is *true*. The port never compares its collaborator against anything, so a
//     conforming clock may be wrong by a century and this port will pass it through.
//   - not that it is *accurate*, *unique*, *repeatable*, *ordered* or *monotonic*. Two calls may
//     return the same instant; the second may be earlier than the first; a hundred calls may return
//     a hundred identical strings. Every one of those is admitted below, on purpose.
//   - not that reading it is cheap, safe or side-effect-free. The collaborator is arbitrary code.
//
// The validity rule is explicit arithmetic, not a parser. `Date` is lenient in exactly the places a
// clock is dangerous: it rolls 1900-02-29 forward to March, turns 2024-02-30 into 2024-03-01, and
// accepts hour 24 as midnight the next day. A port that validated with `new Date(candidate)` would
// therefore admit instants that do not exist and hand them on as if they did. That leniency is
// demonstrated *in this file only* — the module under test may not name `Date` or `Temporal` at all.
//
// The frozen non-goals: no ambient time, no randomness, no environment, no I/O, no database; no
// adapter, no scheduler, no timer; no Identity, Policy, Audit or Outbox port; no validation
// boundary and no composition root. No existing contract, version, changelog or authority state is
// touched by this package, and none may be read into it.
//
// The module is loaded once, guarded, and its source is read once, guarded. A missing module must
// fail every row here by name rather than collapsing the file into a single load error: fifteen
// named failures are the RED specification, and one import error is not.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/clock.mjs";

/** The four modules that already exist, with the import and export sets their packages froze. */
const EXISTING = [
  { path: "src/domain/identity-primitives.mjs", imports: ["node:crypto"], exports: ["ActorId", "CausationId", "CorrelationId", "IdempotencyKey", "Principal", "TenantId"] },
  { path: "src/application/action-primitives.mjs", imports: ["../domain/identity-primitives.mjs"], exports: ["Command", "KernelError", "Query", "Result"] },
  { path: "src/application/use-case.mjs", imports: ["./action-primitives.mjs"], exports: ["UseCase"] },
  { path: "src/application/unit-of-work.mjs", imports: [], exports: ["UnitOfWork"] },
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
 * Line-based on purpose: this module must explain in prose why it refuses to reach for `Date`, and
 * a scan that could not tell the explanation from the deed would forbid the explanation.
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
 * `now` always returns a Promise, so a synchronous throw is a contract breach even when the thrown
 * value is the right one: a caller that wrote `clock.now().catch(...)` would never reach its
 * handler. The facts are asserted separately so a failure says which one broke.
 */
async function assertRejects(call, label) {
  let promise;
  assert.doesNotThrow(() => { promise = call(); }, `${label}: now must never throw synchronously; it always returns a Promise`);
  assert.ok(promise instanceof Promise, `${label}: now must return a Promise`);
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
// -------------------------------------------------------------------------------------

/** One canonical instant, used wherever the row is about something other than the spelling. */
const CANON = "2026-08-07T09:41:07.123Z";

/** A clock built through the module under test. Every caller reaches the guard through mod(). */
const build = (now) => new (mod().Clock)({ now });

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

/** Canonical instants that must survive the port completely untouched. */
const CANONICAL = [
  "0001-01-01T00:00:00.000Z",
  "9999-12-31T23:59:59.999Z",
  "1970-01-01T00:00:00.000Z",
  "2000-02-29T12:00:00.000Z",
  "2024-02-29T23:59:59.999Z",
  "0004-02-29T00:00:00.000Z",
  "0400-02-29T00:00:00.000Z",
  "0100-02-28T23:59:59.999Z",
  "1900-02-28T00:00:00.000Z",
  "2100-02-28T00:00:00.000Z",
  "2023-01-31T00:00:00.000Z",
  "2023-04-30T00:00:00.000Z",
  "2023-06-30T12:34:56.789Z",
  "2023-09-30T23:00:00.000Z",
  "2023-11-30T00:00:00.001Z",
  "2024-12-31T23:59:59.999Z",
  CANON,
];

/** Real instants spelled in a way this port does not accept. Every one must be refused, not repaired. */
const NONCANONICAL = [
  "2024-01-01T00:00:00Z",
  "2024-01-01T00:00:00.00Z",
  "2024-01-01T00:00:00.0000Z",
  "2024-01-01T00:00:00.000+00:00",
  "2024-01-01T00:00:00.000-00:00",
  "2024-01-01T00:00:00.000z",
  "2024-01-01t00:00:00.000Z",
  "2024-01-01 00:00:00.000Z",
  "2024-01-01T00:00:00.000",
  "2024-01-01T00:00:00.000Z ",
  " 2024-01-01T00:00:00.000Z",
  "2024-01-01T00:00:00.000Z\n",
  "2024-01-01T00:00:00.000Z\u0000",
  "\u200b2024-01-01T00:00:00.000Z",
  "+002024-01-01T00:00:00.000Z",
  "2024-1-01T00:00:00.000Z",
  "2024-01-1T00:00:00.000Z",
  "2024-01-01T0:00:00.000Z",
  "24-01-01T00:00:00.000Z",
  "2024-01-01",
  "2024-01-01T00:00:00.000ZZ",
  "2024-01-01T00:00:00,000Z",
  "2024/01/01T00:00:00.000Z",
  "２０２４-01-01T00:00:00.000Z",
  "",
];

/**
 * Instants that are correctly *spelled* and do not exist.
 *
 * Each is [candidate, why]. They are the whole reason validity is arithmetic here: a parser-shaped
 * check answers "does this look like a timestamp", and every one of these looks like one.
 */
const FALSE_DATES = [
  ["0000-01-01T00:00:00.000Z", "year 0000 is below the 0001 floor"],
  ["0000-12-31T23:59:59.999Z", "no part of year 0000 is admissible"],
  ["1900-02-29T00:00:00.000Z", "1900 is divisible by 100 and not by 400, so it is not a leap year"],
  ["2100-02-29T00:00:00.000Z", "2100 is divisible by 100 and not by 400, so it is not a leap year"],
  ["2023-02-29T00:00:00.000Z", "2023 is not divisible by 4"],
  ["2024-02-30T00:00:00.000Z", "February never has thirty days"],
  ["2024-02-31T00:00:00.000Z", "February never has thirty-one days"],
  ["2024-04-31T00:00:00.000Z", "April has thirty days"],
  ["2024-06-31T00:00:00.000Z", "June has thirty days"],
  ["2024-09-31T00:00:00.000Z", "September has thirty days"],
  ["2024-11-31T00:00:00.000Z", "November has thirty days"],
  ["2024-00-10T00:00:00.000Z", "month 00 is below the range"],
  ["2024-13-10T00:00:00.000Z", "month 13 is above the range"],
  ["2024-01-00T00:00:00.000Z", "day 00 is below the range"],
  ["2024-01-32T00:00:00.000Z", "day 32 is above the range"],
  ["2024-03-32T00:00:00.000Z", "no month has thirty-two days"],
  ["2024-01-01T24:00:00.000Z", "hour 24 is not a time of day"],
  ["2024-01-01T25:00:00.000Z", "hour 25 is not a time of day"],
  ["2024-01-01T00:60:00.000Z", "minute 60 is not a minute"],
  ["2024-01-01T00:00:60.000Z", "second 60 is not a second: this port carries no leap-second table"],
  ["2024-01-01T00:00:99.000Z", "second 99 is not a second"],
];

/** The arithmetic contrast: the same shapes that *are* real, and must be admitted. */
const TRUE_DATES = [
  "2000-02-29T00:00:00.000Z",
  "2024-02-29T00:00:00.000Z",
  "2024-01-31T23:59:59.999Z",
  "2024-04-30T00:00:00.000Z",
  "0001-01-01T00:00:00.000Z",
  "9999-12-31T23:59:59.999Z",
];

// -------------------------------------------------------------------------------------
// A1–A3. The module surface, the imports it does not have, and the vocabulary it never carries.
// -------------------------------------------------------------------------------------

test("the module exports exactly Clock, and no later-package surface stands beside it", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), ["Clock"], "the export set is frozen at exactly this one name");
  assert.equal(m.default, undefined, "a default export would be an unnamed second surface");
  assert.equal(typeof m.Clock, "function", "Clock must be a class");
  assert.equal(Object.getPrototypeOf(m.Clock), Function.prototype, "Clock must extend nothing");
  // Each absent name is a whole concern this package has not started. They are listed rather than
  // summarised because the failure they guard against is one of them appearing alone, quietly, as
  // "just a small helper" beside the port.
  for (const absent of [
    "ClockPort", "SystemClock", "FixedClock", "FrozenClock", "TestClock", "MonotonicClock",
    "Timestamp", "Instant", "Duration", "Interval", "Deadline", "Timeout", "Timer", "Scheduler",
    "Cron", "Stopwatch", "TimeZone", "Calendar", "Offset", "Elapsed",
    "IdentityPort", "PolicyPort", "AuditPort", "OutboxPort", "RepositoryPort", "Cache",
    "ValidationBoundary", "Validator", "validate", "CompositionRoot", "container", "configure",
    "register", "resolve", "Adapter", "Schema", "Sdk", "Database", "Connection", "Pool",
    "now", "utcNow", "currentTime", "parse", "format", "isValid",
  ]) {
    assert.equal(m[absent], undefined, `${absent} belongs to a later package, not to the Clock port`);
  }
  // Re-exporting the ring's existing types would give the kernel two front doors to one contract,
  // and the second would be free to drift the day either module is versioned. This module cannot
  // even reach them — it imports nothing — so an appearance here would be a hand-rolled copy.
  for (const borrowed of ["UnitOfWork", "UseCase", "Command", "Query", "Result", "KernelError", "Principal", "TenantId"]) {
    assert.equal(m[borrowed], undefined, `${borrowed} is owned elsewhere and must not stand in this module's export set`);
  }
  for (const absent of ["VERSION", "version", "SCHEMA_VERSION", "MODULE_VERSION", "API_VERSION"]) {
    assert.equal(m[absent], undefined, `${absent} would be a module-level version; a port carries no version of its own`);
  }
  // The namespace object itself is not asserted symbol-free: a module namespace exotic object owns
  // Symbol.toStringTag by construction, so requiring zero symbols there would be a requirement on
  // the language rather than on this module. What the module actually controls is asserted instead.
  assert.deepEqual(Object.getOwnPropertySymbols(m.Clock), [], "Clock must carry no static symbol member");
  assert.deepEqual(
    Object.getOwnPropertySymbols(m.Clock.prototype), [Symbol.toStringTag],
    "Clock.prototype must carry the class-name tag and no other symbol",
  );
  assert.equal(Object.getPrototypeOf(m.Clock.prototype), Object.prototype, "Clock must stand directly on Object");
  assert.ok(!(m.Clock.prototype instanceof Error), "a Clock is not an error type");
});

test("the module imports nothing at all, no inner module imports it back, and the four existing packages are untouched", async () => {
  const text = code();
  // The empty import set is the port's defining property, not an accident of it being small. A port
  // that knew one concrete type would be a contract about that type, and the adapter that arrives
  // later would be satisfying something narrower than a boundary.
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set([...importsOf(text), ...bare])], [],
    `${modulePath} must import nothing: a port that names a collaborator is no longer a port`,
  );
  assert.ok(!/(?:^|\n)\s*import\s/.test(text), `${modulePath} must carry no import statement of any form`);
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/],
    ["a CommonJS require", /\brequire\s*\(/],
    ["a Node builtin", /["']node:/],
    ["a package dependency", /from\s*["'][a-z@][^"'./][^"']*["']/],
    ["its own ring", /action-primitives|use-case|unit-of-work/],
    ["the domain ring", /identity-primitives/],
    ["an outer ring", /\.\.\/(?:adapters|delivery|sdk|infrastructure|api)\b/],
    ["the substrate package", /\bdb\/|metaframer_kernel_db/],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not reach for ${label}`);
  }
  assert.ok(!/export\s+default/.test(text), `${modulePath} must not carry a default export`);
  // Dependency direction, proven from the other side too. Nothing already in the kernel may learn
  // about this module: a port is depended *on*, and the day an inner module imported it the arrow
  // would point outward and the onion would stop being one. Each is read comment-stripped, because
  // a comment naming this port is documentation and a code reference is a dependency.
  for (const existing of EXISTING) {
    const innerText = await readFile(path.join(root, existing.path), "utf8");
    const innerCode = stripComments(innerText);
    assert.ok(!/clock\.mjs/.test(innerCode), `${existing.path} must not import ${modulePath}`);
    assert.ok(!/\bClock\b/.test(innerCode), `${existing.path} must not name Clock in code`);
    // And the packages beneath stay exactly as they froze themselves. This package widens nothing
    // under itself in order to make room for a port: no new import, and no new exported name.
    assert.deepEqual(importsOf(innerCode), existing.imports, `${existing.path} keeps the import set its own package froze`);
    const namespace = await import(pathToFileURL(path.join(root, existing.path)).href);
    assert.deepEqual(Object.keys(namespace).sort(), existing.exports, `${existing.path} keeps the export set its own package froze`);
  }
});

test("the module reaches no ambient capability, parses with no Date or Temporal, and carries none of the frozen non-goal vocabulary", () => {
  const text = code();
  // A clock port whose *own* behaviour could read a clock is the one failure this package exists to
  // prevent: it would be able to answer without its collaborator, and every guarantee below would
  // then describe something other than the thing being called.
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
  // The parsers this port refuses to delegate to. `Date` is lenient exactly where a clock is
  // dangerous — it rolls impossible days forward rather than refusing them — so validity here must
  // be arithmetic the module performs and can be read. `Temporal` would be correct and is still
  // refused: a port that depends on a host object depends on which host it is running in.
  for (const [label, pattern] of [
    ["Date", /\bDate\b/],
    ["Temporal", /\bTemporal\b/],
    ["a Date accessor", /\btoISOString\b|\bgetTime\b|\bgetUTC|\bsetUTC|\btoJSON\b/],
    ["Intl", /\bIntl\b/],
    ["a date library", /\bmoment\b|\bdayjs\b|\bluxon\b|\bdate-fns\b/i],
    ["a zone database", /\btimezone\b|\btime\s+zone\b|\btzdata\b|\bIANA\b/i],
  ]) {
    assert.ok(!pattern.test(text), `${modulePath} must not name ${label}: validity here is explicit arithmetic, not a delegated parse`);
  }
  // The frozen non-goals, scanned in code rather than only asserted as absent exports. A private
  // cache is still a cache, and it would never show up in the export set.
  for (const [label, pattern] of [
    ["a cache", /\bcache\b|\bmemo/i],
    ["a monotonicity claim", /\bmonotonic/i],
    ["a synchronisation claim", /\bsynchroni[sz]/i],
    ["an accuracy claim", /\baccura/i],
    ["clock drift or NTP", /\bdrift\b|\bntp\b/i],
    ["a leap second", /\bleap\s*second/i],
    ["a scheduler", /\bschedul/i],
    ["a retry", /\bretry\b|\bbackoff\b/i],
    ["a repository", /\brepositor/i],
    ["an outbox", /\boutbox\b/i],
    ["an audit trail", /\baudit\b/i],
    ["a policy", /\bpolicy\b|\bpdp\b/i],
    ["identity", /\bidentity\b|\bprincipal\b|\btenant\b/i],
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
  // The types it has no import for, and must therefore not name either. A hand-rolled reference to
  // one of these would be this module quietly growing an opinion about who is asking it the time.
  for (const borrowed of ["Result", "KernelError", "UseCase", "Command", "Query", "UnitOfWork"]) {
    assert.ok(
      !new RegExp(`\\b${borrowed}\\b`).test(text),
      `${modulePath} must not name ${borrowed}: a clock port knows nothing about its caller`,
    );
  }
});

// -------------------------------------------------------------------------------------
// B1–B2. Construction, and what a constructed clock is.
// -------------------------------------------------------------------------------------

test("the constructor takes exactly one ordinary object holding exactly one now function", () => {
  const m = mod();
  const fn = () => CANON;
  assert.ok(build(fn) instanceof m.Clock, "the one-function port must construct");
  assert.equal(m.Clock.length, 1, "the constructor takes one options object, not a positional function");
  // A frozen options object is still an ordinary options object; refusing one would be a rule about
  // how carefully the caller held its own data.
  assert.doesNotThrow(() => new m.Clock(Object.freeze({ now: fn })), "a frozen options object is admissible");
  // Every flavour of function stays admissible. Refusing one would be a rule about how a caller
  // spelled its collaborator, which is not this port's business.
  for (const ok of [() => CANON, function named() { return CANON; }, async () => CANON, class Reading {}]) {
    assert.doesNotThrow(() => new m.Clock({ now: ok }), `now as ${inspectShort(ok)} is a legal collaborator`);
  }
  // Missing is refused rather than defaulted: a clock that supplied its own reading would answer
  // without the collaborator, and the caller would never learn its clock was never wired.
  throws(() => new m.Clock({}), "omitting now must be refused");
  throws(() => new m.Clock({ now: undefined }), "now is required and must not accept undefined");
  throws(() => new m.Clock({ now: null }), "now is required and must not accept null");
  for (const bad of ["now", 1, 0, true, false, [], {}, Symbol("now"), 7n, { call: () => CANON }, { now: () => CANON }, CANON]) {
    throws(() => new m.Clock({ now: bad }), `now as ${inspectShort(bad)} is not a function`);
  }
  // An unknown key is refused rather than dropped, because silently ignoring one lets a caller
  // believe it configured something — a tolerance, a timeout, a fallback — that nothing reads.
  for (const extra of ["nowFn", "clock", "timeout", "tolerance", "fallback", "monotonic", "scheduler", "toJSON", "then"]) {
    throws(() => new m.Clock({ now: fn, [extra]: () => CANON }), `an unknown option key ${extra} must be refused by name`);
  }
  throws(() => new m.Clock({ now: fn, [Symbol("hidden")]: () => CANON }), "a symbol-keyed option member must be refused");
  // The key must be a plain, enumerable data property. An accessor would run caller code during
  // construction, and a hidden non-enumerable member is a second option nobody can see.
  throws(() => new m.Clock({ get now() { return fn; } }), "an accessor-defined now must be refused: reading an option may not run caller code");
  throws(
    () => new m.Clock(Object.defineProperty({}, "now", { value: fn, enumerable: false, configurable: true, writable: true })),
    "a non-enumerable now must be refused: an option nobody can enumerate is an option nobody can review",
  );
  // Ordinary means ordinary: prototype exactly Object.prototype, no exotic behaviour behind it.
  for (const notOrdinary of [
    Object.assign(Object.create(null), { now: fn }),
    Object.assign(Object.create({ inherited: true }), { now: fn }),
    Object.assign([], { now: fn }),
    Object.assign(function carrier() {}, { now: fn }),
    new (class Options { constructor() { this.now = fn; } })(),
  ]) {
    throws(() => new m.Clock(notOrdinary), `${inspectShort(notOrdinary)} is not an ordinary options object`);
  }
  // The residual on the other side of that rule, stated positively because the honest answer is
  // that it cannot be refused. A transparent proxy over a legal options object answers every
  // question the constructor is able to ask exactly as its target does — same prototype, same
  // single own key, same data descriptor, the same function by identity — and ECMAScript exposes
  // no standard way to ask whether an object is a proxy at all. So construction through one is
  // admitted here, and this row records that as a known limit of the ordinariness check rather
  // than pretending to a detection nothing can perform.
  const proxiedOptions = new Proxy({ now: fn }, {});
  assert.equal(Object.getPrototypeOf(proxiedOptions), Object.prototype, "a transparent proxy reports the ordinary prototype");
  assert.deepEqual(Reflect.ownKeys(proxiedOptions), ["now"], "and exactly the one own key");
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(proxiedOptions, "now"),
    { value: fn, writable: true, enumerable: true, configurable: true },
    "and the identical data descriptor, holding the very same function",
  );
  assert.doesNotThrow(
    () => new m.Clock(proxiedOptions),
    "a transparent proxy over legal options is indistinguishable from those options and is therefore admitted: this port claims no proxy detection, because none exists to claim",
  );
  // An inherited now is not an own key: reading it would let a prototype somewhere else decide what
  // this clock calls.
  throws(() => new m.Clock(Object.create({ now: fn })), "an inherited now must be refused: the option must be the caller's own");
  for (const notOptions of [undefined, null, "now", 1, true, [], () => CANON, Symbol("options"), 7n]) {
    throws(() => new m.Clock(notOptions), `${inspectShort(notOptions)} is not an options object`);
  }
  throws(() => new m.Clock(), "construction with no options object at all must be refused");
});

test("a constructed clock is frozen, own-property-free, tagged, exposes exactly now, and never hands its collaborator back", () => {
  const m = mod();
  const built = build(() => CANON);
  assert.ok(Object.isFrozen(built), "the instance must be frozen");
  assert.ok(Object.isFrozen(m.Clock.prototype), "Clock.prototype must be frozen");
  assert.ok(Object.isFrozen(m.Clock), "Clock itself must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(built), [], "the collaborator is private state, not an own property");
  assert.deepEqual(Object.getOwnPropertySymbols(built), [], "no symbol-keyed own member either");
  assert.equal(built[Symbol.toStringTag], "Clock", "the instance must tag itself with its class name");
  assert.throws(() => { built.now = () => CANON; }, TypeError, "assignment into a frozen instance must throw");
  // The public surface, frozen in both directions: these members and no others. Every name absent
  // here is a decision — a clock is behaviour, not a value, so it has no equality and no rendering,
  // and a toJSON would put a live collaborator one serialisation away from a log.
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Clock.prototype).sort(), ["constructor", "now"],
    "Clock.prototype must carry exactly constructor and now",
  );
  for (const absent of [
    "equals", "toJSON", "toString", "valueOf", "inspect", "read", "tick", "advance", "freeze",
    "since", "elapsed", "of", "create", "from", "system", "fixed", "utc", "then",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m.Clock.prototype, absent), false,
      `${absent} must not appear on Clock.prototype`,
    );
  }
  assert.equal(m.Clock.prototype.toString, Object.prototype.toString, "toString must not be overridden");
  assert.deepEqual(
    Object.getOwnPropertyNames(m.Clock).sort(), ["length", "name", "prototype"],
    "Clock must carry no static factory, no registry and no lookup",
  );
  assert.equal(m.Clock.name, "Clock", "the class must be named Clock");
  // No getters on the named surface. A getter is how state becomes readable by accident, and the
  // one thing this instance holds is exactly the thing that must never be readable.
  for (const name of Object.getOwnPropertyNames(m.Clock.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(m.Clock.prototype, name);
    assert.equal(descriptor.get, undefined, `${name} must not be a getter`);
    assert.equal(descriptor.set, undefined, `${name} must not be a setter`);
  }
  // Leak probes. A collaborator that can be reached off the instance can be called directly, and a
  // caller that can call it directly has walked straight around the only thing this port does.
  const marked = build(function MARKER_now_7b41() { return CANON; });
  assert.equal(marked.now, m.Clock.prototype.now, "now must be the prototype method, not a per-instance copy closing over the collaborator");
  for (const [label, rendered] of [
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(marked))],
    ["own keys", JSON.stringify(Object.keys(marked))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(marked))],
    ["prototype descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Clock.prototype))],
    ["class descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(m.Clock))],
    ["JSON", JSON.stringify(marked) ?? "undefined"],
    ["the string form", String(marked)],
    ["the class source", String(m.Clock.prototype.now)],
  ]) {
    assert.ok(!rendered.includes("MARKER_"), `the collaborator leaked through ${label}: ${rendered}`);
  }
});

// -------------------------------------------------------------------------------------
// C1–C2. The call: what now promises, and exactly how the collaborator is invoked.
// -------------------------------------------------------------------------------------

test("now is a zero-argument async method, always returns a native Promise, and awaits whatever the collaborator produced", async () => {
  const m = mod();
  assert.equal(
    Object.prototype.toString.call(m.Clock.prototype.now), "[object AsyncFunction]",
    "now must be declared async: a caller that wrote clock.now().catch(...) must reach its handler on every path, and async is what makes that true by construction rather than by remembering",
  );
  assert.equal(m.Clock.prototype.now.length, 0, "now takes no argument: there is nothing a caller may pass to a reading of the time");
  // Extra arguments are ignored rather than refused — arity zero is what the method promises, not a
  // rule about how the caller spelled the call site.
  assert.equal(await build(() => CANON).now("ignored", 1, null), CANON, "surplus arguments must not change the answer");
  // A native Promise, not a thenable and not a subclass: a caller may hand this straight to
  // Promise.all or await it twice, and either would break on a hand-rolled thenable.
  for (const [label, behaviour] of [
    ["a synchronous primitive", () => CANON],
    ["a resolved promise", () => Promise.resolve(CANON)],
    ["a promise that settles later", () => settledLater(CANON)],
    ["an async function", async () => CANON],
    ["a thenable", () => ({ then(resolve) { resolve(CANON); } })],
    ["a thenable that settles later", () => ({ then(resolve) { settledLater(CANON).then(resolve); } })],
  ]) {
    const clock = build(behaviour);
    let returned;
    assert.doesNotThrow(() => { returned = clock.now(); }, `${label}: now must never throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: now must return a Promise`);
    assert.equal(Object.getPrototypeOf(returned), Promise.prototype, `${label}: it must be a native Promise, not a subclass or a thenable`);
    const value = await returned;
    assert.equal(typeof value, "string", `${label}: the resolution must be a string primitive`);
    assert.equal(value, CANON, `${label}: the collaborator's value must be awaited and returned unchanged`);
  }
  // The port is asynchronous by construction, and this row says so rather than letting a reader
  // assume the collaborator was consulted before now() returned.
  let consulted = false;
  const pending = build(async () => { await settledLater(null); consulted = true; return CANON; }).now();
  assert.equal(consulted, false, "now must return before a slow collaborator has settled: this port is asynchronous, and no reading is available synchronously");
  assert.equal(await pending, CANON, "and the awaited answer arrives afterwards");
  // An invalid resolution is a rejection, whichever route it arrived by. The value the collaborator
  // produced never reaches the caller when it is not a canonical instant.
  for (const [label, behaviour] of [
    ["a synchronous invalid value", () => "not a time"],
    ["an invalid value from a promise", () => Promise.resolve("not a time")],
    ["an invalid value from a thenable", () => ({ then(resolve) { resolve("not a time"); } })],
    ["nothing at all", () => undefined],
  ]) {
    await assertRejectsTypeError(() => build(behaviour).now(), label);
  }
});

test("each call invokes the collaborator exactly once, with zero arguments and an undefined this", async () => {
  mod();
  const record = recorder();
  const clock = build(record.make("now", () => CANON));
  assert.equal(await clock.now(), CANON, "the reading comes back");
  assert.equal(record.countOf("now"), 1, "one call to now is one call to the collaborator — not zero, not two");
  assert.equal(record.firstOf("now").count, 0, "the collaborator is called with zero arguments: it is the thing that produces a reading, not a thing that receives one");
  assert.deepEqual(record.firstOf("now").args, [], "and nothing at all is passed to it");
  // `this` is undefined: a collaborator that could reach the clock could call it back, and a
  // collaborator that received the options object could read a member the caller never exposed. The
  // field is lifted out before being called, which is what makes an undefined receiver true by
  // construction rather than by discipline.
  assert.equal(record.firstOf("now").self, undefined, "the collaborator must be invoked with an undefined this");
  assert.notEqual(record.firstOf("now").self, clock, "it must not receive the clock as this");
  // Three more calls, and the count tracks them exactly. A collaborator called twice per reading is
  // a clock that consulted its source and then consulted it again to check — which is precisely the
  // kind of quiet extra read a port must not perform on behalf of an arbitrary collaborator.
  for (let round = 0; round < 3; round += 1) assert.equal(await clock.now(), CANON, `round ${round} must resolve`);
  assert.equal(record.countOf("now"), 4, "four readings are exactly four collaborator calls");
  for (const call of record.calls) {
    assert.equal(call.count, 0, "every call must pass zero arguments");
    assert.equal(call.self, undefined, "every call must observe an undefined this");
  }
  // A refused reading still costs exactly one call: the port does not retry, and does not ask a
  // second time in the hope of a better answer.
  const failing = recorder();
  await assertRejectsTypeError(() => build(failing.make("now", () => "not a time")).now(), "an invalid reading");
  assert.equal(failing.countOf("now"), 1, "an invalid reading is one call, never a retry");
  const throwing = recorder();
  await assertRejects(() => build(throwing.make("now", () => { throw new RangeError("boom"); })).now(), "a throwing collaborator");
  assert.equal(throwing.countOf("now"), 1, "a failed reading is one call, never a retry");
});

// -------------------------------------------------------------------------------------
// D1–D3. The one accepted spelling, the spellings refused, and arithmetic validity.
// -------------------------------------------------------------------------------------

test("a canonical UTC instant resolves as the very same primitive, unchanged", async () => {
  mod();
  for (const canonical of CANONICAL) {
    const value = await build(() => canonical).now();
    assert.equal(typeof value, "string", `${canonical} must resolve as a string primitive`);
    assert.ok(Object.is(value, canonical), `${canonical} must come back unchanged: the port returns the reading, it does not rebuild it`);
    assert.equal(value.length, 24, `${canonical} must be exactly twenty-four characters`);
    // Delivered through a promise and through a thenable too: the spelling rule cannot depend on
    // which of the three admissible routes the collaborator used.
    assert.ok(Object.is(await build(() => Promise.resolve(canonical)).now(), canonical), `${canonical} via a promise must be identical too`);
    assert.ok(Object.is(await build(() => ({ then(resolve) { resolve(canonical); } })).now(), canonical), `${canonical} via a thenable must be identical too`);
  }
  // The endpoints and the leap cases, named individually so a failure says which boundary moved
  // rather than only that one did.
  assert.equal(await build(() => "0001-01-01T00:00:00.000Z").now(), "0001-01-01T00:00:00.000Z", "year 0001 is the floor and is admitted");
  assert.equal(await build(() => "9999-12-31T23:59:59.999Z").now(), "9999-12-31T23:59:59.999Z", "year 9999 is the ceiling and is admitted");
  assert.equal(await build(() => "2000-02-29T00:00:00.000Z").now(), "2000-02-29T00:00:00.000Z", "2000 is divisible by 400, so its twenty-ninth of February exists");
  assert.equal(await build(() => "2024-02-29T00:00:00.000Z").now(), "2024-02-29T00:00:00.000Z", "2024 is divisible by 4, so its twenty-ninth of February exists");
});

test("a real instant spelled any other way is refused, never normalised, and never echoed back", async () => {
  mod();
  for (const candidate of NONCANONICAL) {
    const error = await assertRejectsTypeError(() => build(() => candidate).now(), `the spelling ${inspectShort(candidate)}`);
    // Refused, not repaired. A port that trimmed a trailing newline or upper-cased a `z` would be
    // deciding what its collaborator meant, and the next collaborator to arrive would be calibrated
    // against a repair rather than against the contract.
    assert.ok(!(error instanceof RangeError) || error instanceof TypeError, `${inspectShort(candidate)}: the refusal is a TypeError`);
  }
  // A rejection carries no candidate. The reading may be the only genuinely sensitive value this
  // port ever holds — it is what an offset, a skew or a session window is computed from — and an
  // error message is the one place a value travels straight into a log nobody redacted.
  const marked = "2024-01-01T00:00:00.000Z_MARKER_raw_5c73";
  const error = await assertRejectsTypeError(() => build(() => marked).now(), "a marked non-canonical candidate");
  for (const [label, rendered] of [
    ["the message", String(error?.message ?? "")],
    ["the string form", String(error)],
    ["the stack", String(error?.stack ?? "")],
    ["the own properties", JSON.stringify(Object.getOwnPropertyDescriptors(Object(error)))],
  ]) {
    assert.ok(!rendered.includes("MARKER_raw_5c73"), `the refused candidate was echoed through ${label}: ${rendered}`);
  }
  // And no normalisation anywhere: each of these differs from a canonical instant only by a repair
  // a lenient port would happily perform, and every one of them must still reject rather than
  // resolve with the repaired form.
  for (const [candidate, repaired] of [
    ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00.000Z"],
    [" 2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"],
    ["2024-01-01T00:00:00.000Z ", "2024-01-01T00:00:00.000Z"],
    ["2024-01-01T00:00:00.000z", "2024-01-01T00:00:00.000Z"],
    ["2024-01-01T00:00:00.000+00:00", "2024-01-01T00:00:00.000Z"],
  ]) {
    const outcome = await rejectionOf(build(() => candidate).now());
    assert.notEqual(outcome, NO_REJECTION, `${inspectShort(candidate)} must reject`);
    assert.notEqual(outcome, repaired, `${inspectShort(candidate)} must not be repaired into ${repaired}`);
  }
});

test("validity is arithmetic Gregorian: instants that do not exist are refused, and Date would have admitted several of them", async () => {
  mod();
  for (const [candidate, why] of FALSE_DATES) {
    await assertRejectsTypeError(() => build(() => candidate).now(), `${candidate} — ${why}`);
  }
  // The arithmetic contrast. A rule that refused everything would pass the rows above and be
  // useless, so the same shapes that *are* real are asserted admitted in the same breath.
  for (const candidate of TRUE_DATES) {
    assert.equal(await build(() => candidate).now(), candidate, `${candidate} is a real instant and must be admitted`);
  }
  // Why the rule is arithmetic rather than delegated, demonstrated here and only here. `Date` is
  // used in this test file to *show* the leniency; the module under test may not name it at all,
  // which the vocabulary row asserts separately. Each candidate below is an instant that does not
  // exist, that `Date` accepts, and that it silently moves to a different day.
  const lenient = [
    ["0000-01-01T00:00:00.000Z", "a year below the floor"],
    ["1900-02-29T00:00:00.000Z", "a non-leap February the twenty-ninth"],
    ["2100-02-29T00:00:00.000Z", "another non-leap February the twenty-ninth"],
    ["2024-02-30T00:00:00.000Z", "a thirtieth of February"],
    ["2024-04-31T00:00:00.000Z", "a thirty-first of April"],
    ["2024-01-01T24:00:00.000Z", "hour twenty-four"],
  ];
  for (const [candidate, why] of lenient) {
    const parsed = new Date(candidate);
    assert.ok(
      !Number.isNaN(parsed.getTime()),
      `this row's premise broke: Date no longer admits ${candidate} (${why}), so the leniency being guarded against has changed`,
    );
    await assertRejectsTypeError(() => build(() => candidate).now(), `${candidate} (${why}) is admitted by Date and must still be refused here`);
  }
  // Four of the six are not merely admitted — they are moved. A port that validated by round-trip
  // would call these canonical and hand on a day the collaborator never named.
  for (const candidate of ["1900-02-29T00:00:00.000Z", "2100-02-29T00:00:00.000Z", "2024-02-30T00:00:00.000Z", "2024-04-31T00:00:00.000Z"]) {
    assert.notEqual(new Date(candidate).toISOString(), candidate, `${candidate} is silently relocated by Date, which is why validity here is computed rather than parsed`);
  }
});

// -------------------------------------------------------------------------------------
// E1–E2. Primitives only, and the residual that awaiting an arbitrary value leaves behind.
// -------------------------------------------------------------------------------------

test("only a string primitive is admitted, and no coercion hook is ever consulted", async () => {
  mod();
  // Everything that is not a string primitive is refused as it stands. A port that coerced would be
  // running caller code inside its own validity check, and the value it validated would not be the
  // value it was handed.
  for (const notAString of [
    undefined, null, 0, -0, 1, NaN, Infinity, true, false, 20260807n, Symbol(CANON),
    [CANON], { value: CANON }, () => CANON, new Error(CANON), new Map(), new Set(),
  ]) {
    await assertRejectsTypeError(() => build(() => notAString).now(), `a reading of ${inspectShort(notAString)}`);
  }
  // A String object is the sharpest case: it stringifies to a perfectly canonical instant, and it
  // is still not a string primitive. `typeof` is the whole test, and it must be reached before any
  // hook could run.
  await assertRejectsTypeError(() => build(() => new String(CANON)).now(), "a boxed String carrying a canonical instant");
  // Instrumented coercion hooks, none of which may fire. The object below is not a thenable, so
  // nothing about awaiting it can excuse a call to any of these.
  const traps = [];
  const coercible = {
    toString() { traps.push("toString"); return CANON; },
    valueOf() { traps.push("valueOf"); return CANON; },
    [Symbol.toPrimitive](hint) { traps.push(`toPrimitive:${hint}`); return CANON; },
  };
  await assertRejectsTypeError(() => build(() => coercible).now(), "an object that would coerce to a canonical instant");
  assert.deepEqual(traps, [], `a coercion hook was consulted: ${traps.join(", ")} — this port reads a value, it never converts one`);
  // The same object handed over through a promise. The extra hop must not change the answer, and
  // must not turn the object into the string it is willing to pretend to be.
  await assertRejectsTypeError(() => build(() => Promise.resolve(coercible)).now(), "the same object delivered through a promise");
  assert.deepEqual(traps, [], "and still no coercion hook was consulted");
  // The one exception, named here and dissected in the row below: an object carrying `then` is
  // assimilated by `await` itself, before this port ever sees a value. That is a property of the
  // language, not a decision this port took, and pretending otherwise would be the dishonest half.
  const assimilated = { then(resolve) { resolve(CANON); }, toString() { traps.push("toString"); return "no"; } };
  assert.equal(await build(() => assimilated).now(), CANON, "a thenable is assimilated by await: the port receives its resolution, not the object");
  assert.deepEqual(traps, [], "assimilation is not coercion: no hook fired for it either");
});

test("awaiting an arbitrary value leaves a real residual: one unavoidable then lookup, and a thenable that runs its own code", async () => {
  mod();
  // A non-thenable hostile object, watched on every trap. This row does *not* claim the port never
  // touches what its collaborator returned — it claims the only touch is the one `await` performs
  // on the language's behalf, which no implementation of this port can avoid while remaining async.
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
  await assertRejectsTypeError(() => build(() => watched).now(), "a hostile non-thenable object");
  assert.ok(touches.length >= 1, "the count is not zero and this row does not pretend it is: awaiting a value reads its then");
  for (const touch of touches) {
    assert.equal(touch, "get:then", `the reading was touched by ${touch}; beyond the unavoidable then lookup, this port reads nothing it was handed`);
  }
  // A hostile thenable is a different residual, and a larger one. Because `await` calls `then`, an
  // object that carries one gets to run arbitrary code inside this port's call — it may resolve, it
  // may reject, it may do neither for a while, and it may do anything else first. Nothing here
  // prevents that, and the assertions below record what an implementation is therefore exposed to
  // rather than claiming an isolation this port does not have.
  let executed = false;
  const hostile = { then(resolve) { executed = true; resolve(CANON); } };
  assert.equal(await build(() => hostile).now(), CANON, "a hostile thenable may resolve, and its resolution is validated like any other");
  assert.equal(executed, true, "and its then body ran inside the port's call: this is the residual, stated rather than hidden");
  // The same door, used to reject. The rejection reaches the caller exactly as any other would.
  const refusal = new RangeError("MARKER_thenable_2f88");
  const rejecting = { then(resolve, reject) { reject(refusal); } };
  const caught = await assertRejects(() => build(() => rejecting).now(), "a hostile thenable that rejects");
  assert.equal(caught, refusal, "a thenable's rejection propagates by identity, like a collaborator's own");
  // A thenable may also resolve with something invalid, and the ordinary refusal applies to it. The
  // assimilation is what it is; it does not widen what counts as a reading.
  await assertRejectsTypeError(() => build(() => ({ then(resolve) { resolve("not a time"); } })).now(), "a thenable resolving to an invalid value");
  // And a `then` that is not callable is not a thenable at all: the object is the resolution, and
  // the ordinary primitive rule refuses it.
  await assertRejectsTypeError(() => build(() => ({ then: CANON })).now(), "an object whose then is not callable");
});

// -------------------------------------------------------------------------------------
// F1. What the brand actually proves, and the three things it does not.
// -------------------------------------------------------------------------------------

test("branding is honest: the private brand is the only proof, and freezing stops neither subclassing nor a forwarding proxy", async () => {
  const m = mod();
  const real = build(() => CANON);
  assert.equal(await real.now(), CANON, "the genuine instance works, which is what makes the failures below meaningful");
  // An impostor built straight on the prototype. It answers `instanceof` and it carries the tag,
  // and it holds no collaborator — so the method must refuse it. This is why the brand is a private
  // field rather than a marker property: a marker can be copied onto anything.
  const impostor = Object.create(m.Clock.prototype);
  assert.ok(impostor instanceof m.Clock, "instanceof is satisfied by a prototype, so it proves nothing about state");
  assert.equal(impostor[Symbol.toStringTag], "Clock", "the tag is inherited, so it proves nothing either");
  assert.equal(Object.prototype.toString.call(impostor), "[object Clock]", "and it renders exactly like the real thing");
  await assertRejectsTypeError(() => impostor.now(), "an Object.create impostor");
  await assertRejectsTypeError(() => m.Clock.prototype.now.call({}), "the method called on a plain object");
  await assertRejectsTypeError(() => m.Clock.prototype.now.call(undefined), "the method called on nothing at all");
  // A default proxy over a genuine instance. The instance behind it is real, and the call still
  // fails, because a private field is looked up on the proxy rather than on its target. That is a
  // residual worth stating plainly: wrapping a clock in the most ordinary proxy there is breaks it.
  const proxied = new Proxy(real, {});
  assert.ok(proxied instanceof m.Clock, "the proxy passes instanceof");
  await assertRejectsTypeError(() => proxied.now(), "a default proxy over a genuine instance");
  // Freezing the class and its prototype does not close the subclass door. `Object.freeze` protects
  // the properties it was given; it says nothing about a derived prototype, which is a new object.
  // A subclass may therefore replace `now` entirely and its instances still answer `instanceof`.
  class Skewed extends m.Clock {
    async now() { return "whatever this subclass feels like"; }
  }
  const skewed = new Skewed({ now: () => CANON });
  assert.ok(Object.isFrozen(m.Clock) && Object.isFrozen(m.Clock.prototype), "both are frozen");
  assert.ok(skewed instanceof m.Clock, "and a subclass instance is still a Clock by instanceof");
  assert.equal(
    await skewed.now(), "whatever this subclass feels like",
    "a subclass overrode the method the base class froze: freezing a prototype does not freeze the ones derived from it, and this port does not claim otherwise",
  );
  // A forwarding proxy that rebinds each method to the target works perfectly, observes every call,
  // and is not detectable from the far side. Nothing in this port can prevent interposition; the
  // honest statement is that a caller holding a reference is trusting whoever handed it over.
  const observed = [];
  const forwarding = new Proxy(real, {
    get(target, key, receiver) {
      observed.push(String(key));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.equal(await forwarding.now(), CANON, "a bound forwarding proxy answers exactly as the real instance does");
  assert.ok(observed.includes("now"), "and it saw the call go past");
  assert.ok(forwarding instanceof m.Clock, "it passes instanceof");
  assert.equal(Object.prototype.toString.call(forwarding), "[object Clock]", "it renders identically");
  assert.ok(Object.isFrozen(forwarding), "and it even reports itself frozen: interposition here is undetectable from the outside");
});

// -------------------------------------------------------------------------------------
// G1–H1. Independence between readings, and what a failing collaborator does.
// -------------------------------------------------------------------------------------

test("readings are independent and uncached: repeats, decreases and a hundred calls are all admitted, and no ordering is claimed", async () => {
  mod();
  const stamp = (millis) => `2024-06-15T12:00:00.${String(millis).padStart(3, "0")}Z`;
  // Fifty strictly decreasing readings followed by fifty identical ones. Every one of them is a
  // conforming answer: this port compares no reading against any other, so it cannot notice that
  // time went backwards and must not pretend to. A clock that guaranteed monotonicity would have to
  // remember the last value, and remembering it is the cache this row forbids.
  const sequence = [];
  for (let i = 0; i < 50; i += 1) sequence.push(stamp(999 - i * 2));
  for (let i = 0; i < 50; i += 1) sequence.push(stamp(500));
  let index = 0;
  const clock = build(() => sequence[index++]);
  const seen = [];
  for (let call = 0; call < sequence.length; call += 1) seen.push(await clock.now());
  assert.equal(seen.length, 100, "a hundred calls must produce a hundred readings");
  assert.deepEqual(seen, sequence, "each call must return that call's own reading: a cache would have returned the first one a hundred times");
  assert.equal(index, 100, "and the collaborator must have been consulted exactly a hundred times");
  assert.ok(seen[1] < seen[0], "a later reading may be earlier than an earlier one, and it is admitted");
  assert.equal(seen[98], seen[99], "two readings may be identical, and they are admitted");
  assert.equal(new Set(seen).size, 51, "uniqueness is not claimed and not enforced");
  // Two clocks share nothing. There is no module-level state for them to meet in, so one cannot
  // observe, delay or influence the other.
  const left = build(() => stamp(1));
  const right = build(() => stamp(2));
  assert.notEqual(left, right, "two constructions are two clocks");
  const [a, b] = await Promise.all([left.now(), right.now()]);
  assert.equal(a, stamp(1), "the first is unaffected by the second");
  assert.equal(b, stamp(2), "and the second by the first");
  // Concurrent calls on one clock do not interfere either: there is no in-flight flag here, because
  // there is no boundary to hold open.
  let concurrent = 0;
  const shared = build(async () => { const call = ++concurrent; await settledLater(null); return stamp(call); });
  const together = await Promise.all([shared.now(), shared.now(), shared.now()]);
  assert.deepEqual([...together].sort(), [stamp(1), stamp(2), stamp(3)], "three concurrent readings are three collaborator calls, each with its own answer");
  // The comparison above proves three answers arrived and that none was copied from another. What it
  // cannot prove is that they were ever in flight together: a port holding a `#previous` promise and
  // chaining each reading behind the last produces exactly those three values, in exactly that set,
  // and passes every assertion above unchanged. Independence is therefore proven directly here, by
  // driving two calls whose collaborator hands back a promise nobody but this test can settle, and
  // then settling them in the opposite order to the one they were started in.
  //
  // No timer, no wall clock and no sort. The evidence is a settlement log written by handlers that
  // were attached before anything was resolved, so the order in the log *is* the order the two
  // readings settled. And every wait below is a bounded microtask drain rather than an await on a
  // reading: a port that queued or single-flighted these calls must fail this row promptly, not hang
  // it waiting for a second collaborator call that its own queue will never make.
  const gates = [];
  const gated = build(function gatedNow() {
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    gates.push({ promise, settle });
    return promise;
  });
  const drain = async () => { for (let tick = 0; tick < 16; tick += 1) await null; };
  const settlements = [];
  const readingOne = stamp(11);
  const readingTwo = stamp(22);
  const first = gated.now();
  const second = gated.now();
  assert.notEqual(first, second, "two calls are two promises: a single-flight port would have handed the same one back twice");
  first.then((value) => { settlements.push(["first", value]); }, (error) => { settlements.push(["first", error]); });
  second.then((value) => { settlements.push(["second", value]); }, (error) => { settlements.push(["second", error]); });
  await drain();
  // Both readings are outstanding at once, and neither has been allowed to finish. A queue would
  // still be holding the second call back here, because the first has not been resolved and cannot
  // be until this test says so.
  assert.equal(
    gates.length, 2,
    "both calls must have reached the collaborator before either reading was resolved: a single-flight port calls it once and shares the result, and a queued port would still be waiting for the first reading to finish",
  );
  assert.notEqual(gates[0].promise, gates[1].promise, "each call must await its own pending reading, not one promise shared between them");
  assert.deepEqual(settlements, [], "and neither reading may settle while both collaborator promises are still pending");
  // The second call's reading is produced first, and the second call must settle first. This is the
  // ordering a queue cannot produce: behind a `#previous` chain the second reading cannot finish
  // before the first, however promptly its own collaborator answered.
  gates[1].settle(readingTwo);
  await drain();
  assert.equal(settlements.length, 1, "resolving the second call's own reading must settle the second call, and it alone");
  assert.equal(settlements[0][0], "second", "the second call settles first: its answer does not wait on a reading that has not been produced");
  assert.ok(Object.is(settlements[0][1], readingTwo), "and it resolves with its own reading, the very primitive its collaborator produced");
  gates[0].settle(readingOne);
  await drain();
  assert.equal(settlements.length, 2, "resolving the first call's reading settles the first call");
  assert.deepEqual(
    settlements.map(([label]) => label), ["second", "first"],
    "the settlement log, read in the order it was written: exactly second then first, the inverse of the order the calls were started in",
  );
  assert.ok(Object.is(settlements[1][1], readingOne), "the first call resolves with its own reading, unchanged");
  assert.equal(typeof settlements[0][1], "string", "the second call's answer is a string primitive");
  assert.equal(typeof settlements[1][1], "string", "and so is the first call's");
  assert.notEqual(settlements[0][1], settlements[1][1], "two calls, two distinct readings: neither answer was substituted for the other");
  assert.equal(await second, readingTwo, "the second call's promise resolves with the second reading");
  assert.equal(await first, readingOne, "and the first call's with the first");
  assert.ok(Object.isFrozen(gated), "the instance must still be frozen after two overlapping calls");
  assert.deepEqual(Object.getOwnPropertyNames(gated), [], "and must still carry no own property: nothing was stored to sequence them");
  assert.ok(Object.isFrozen(shared), "the instance must still be frozen after repeated use");
  assert.deepEqual(Object.getOwnPropertyNames(shared), [], "and must still carry no own property");
});

test("a collaborator that fails propagates by identity, whatever it threw, and leaves the clock usable", async () => {
  mod();
  const boom = new RangeError("MARKER_now_9f31");
  for (const [label, behaviour] of [
    ["a synchronous throw", () => { throw boom; }],
    ["an async rejection", async () => { throw boom; }],
    ["a returned rejected promise", () => Promise.reject(boom)],
    ["a rejecting thenable", () => ({ then(resolve, reject) { reject(boom); } })],
  ]) {
    const clock = build(behaviour);
    let returned;
    assert.doesNotThrow(() => { returned = clock.now(); }, `${label}: now must not throw synchronously`);
    assert.ok(returned instanceof Promise, `${label}: now must still yield a Promise`);
    const caught = await rejectionOf(returned);
    assert.equal(caught, boom, `${label}: the very value the collaborator threw must propagate`);
    assert.ok(caught instanceof RangeError, `${label}: it must not be re-typed`);
    assert.equal(caught.message, "MARKER_now_9f31", `${label}: and its message must be untouched`);
  }
  // Non-Error throws propagate on exactly the same terms. A port that only preserved Errors would
  // quietly normalise everything else, and a caller matching on its own sentinel would never match.
  const sentinel = Symbol("MARKER_sentinel_9f31");
  for (const thrown of ["a string failure", 0, -0, NaN, null, undefined, false, 7n, sentinel, { code: "CLOCK_UNAVAILABLE" }, [1, 2]]) {
    const thrower = build(() => { throw thrown; });
    const caught = await rejectionOf(thrower.now());
    assert.notEqual(caught, NO_REJECTION, `a collaborator throwing ${inspectShort(thrown)} must reject rather than resolve`);
    assert.ok(Object.is(caught, thrown), `a collaborator throwing ${inspectShort(thrown)} must propagate it by identity`);
    // The same value, arriving as a rejection rather than a throw.
    const rejecter = build(() => Promise.reject(thrown));
    const alsoCaught = await rejectionOf(rejecter.now());
    assert.notEqual(alsoCaught, NO_REJECTION, `a collaborator rejecting with ${inspectShort(thrown)} must reject`);
    assert.ok(Object.is(alsoCaught, thrown), `a collaborator rejecting with ${inspectShort(thrown)} must propagate it by identity`);
  }
  // A failure is not fatal to the clock. There is no state to poison, so the next call simply runs:
  // a port that latched its first failure would turn one unavailable reading into a dead instance,
  // and nothing would tell the caller which reading killed it.
  let fail = true;
  const flaky = build(() => { if (fail) throw boom; return CANON; });
  assert.equal(await rejectionOf(flaky.now()), boom, "the first reading fails");
  fail = false;
  assert.equal(await flaky.now(), CANON, "and the very next reading on the same instance succeeds");
  assert.equal(await flaky.now(), CANON, "and the one after it");
  fail = true;
  assert.equal(await rejectionOf(flaky.now()), boom, "and it can fail again afterwards, by identity, with nothing accumulated in between");
  assert.ok(Object.isFrozen(flaky), "the instance must still be frozen after a failure");
  assert.deepEqual(Object.getOwnPropertyNames(flaky), [], "and must still carry no own property");
});
