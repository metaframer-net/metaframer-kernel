import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// P-M1-01 — the identity primitives, frozen as a public contract
//
// This is the whole observable surface of src/domain/identity-primitives.mjs. It is written
// before the module exists, so every row here is a requirement rather than a description of
// something already built. The suite is table-driven: a new attack is a new row.
//
// The module is loaded once, guarded. A missing module must fail every test by name rather
// than collapsing the file into a single unreadable load error.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/domain/identity-primitives.mjs";

let loaded = null;
let loadError = null;
try {
  loaded = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  loadError = error;
}

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}

const EXPORTS = ["ActorId", "CausationId", "CorrelationId", "IdempotencyKey", "Principal", "TenantId"];
const UUID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const UUID_B = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ACTOR_A = "svc-billing-worker";
const ACTOR_B = "User_42";
// Known SHA-256 vectors. Literals on purpose: a fingerprint the suite recomputes proves nothing.
const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_HELLO = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

/** Values `equals` must refuse without throwing, whatever the receiver is. */
const FOREIGN = () => {
  const m = mod();
  return [null, undefined, 0, "", UUID_A, true, Symbol("x"), {}, [], new m.TenantId(UUID_A)];
};

/** [name, Class, inputA, canonicalA, inputB, canonicalB] — one row per scalar. */
const scalars = () => {
  const m = mod();
  return [
    ["TenantId", m.TenantId, UUID_A, UUID_A, UUID_B, UUID_B],
    ["CorrelationId", m.CorrelationId, UUID_A, UUID_A, UUID_B, UUID_B],
    ["CausationId", m.CausationId, UUID_A, UUID_A, UUID_B, UUID_B],
    ["ActorId", m.ActorId, ACTOR_A, ACTOR_A, ACTOR_B, ACTOR_B],
    ["IdempotencyKey", m.IdempotencyKey, "abc", SHA_ABC, "hello world", SHA_HELLO],
  ];
};

/** The exact own members each prototype may carry. Anything else is undeclared behaviour. */
const PROTOTYPE_MEMBERS = {
  TenantId: ["constructor", "equals", "toJSON", "toString"],
  CorrelationId: ["constructor", "equals", "toJSON", "toString"],
  CausationId: ["constructor", "equals", "toJSON", "toString"],
  ActorId: ["constructor", "equals", "toJSON", "toString"],
  IdempotencyKey: ["constructor", "equals", "fingerprint", "toJSON", "toString"],
  Principal: ["actorId", "constructor", "equals", "tenantId", "toJSON", "toString"],
};

const chain = (value) => {
  const out = [];
  for (let p = Object.getPrototypeOf(value); p !== null; p = Object.getPrototypeOf(p)) out.push(p);
  return out;
};

// -------------------------------------------------------------------------------------
// The module surface. Six names, no seventh, no shared public base, no static factory —
// which is also how "no command/query/use-case/port/composition behaviour" is proven:
// there is nowhere for such behaviour to be exposed.
// -------------------------------------------------------------------------------------

test("the module exports exactly the six identity primitives and nothing else", () => {
  const m = mod();
  assert.deepEqual(Object.keys(m).sort(), EXPORTS, "the export set is frozen at exactly these six names");
  assert.equal(m.default, undefined, "a default export would be an unnamed seventh surface");
  assert.equal(m.Subject, undefined, "Principal is the sole public composite name; Subject would duplicate authority");
  for (const name of EXPORTS) assert.equal(typeof m[name], "function", `${name} must be a class`);
});

test("no class exposes a static factory, and none shares a public base with another", () => {
  const m = mod();
  for (const name of EXPORTS) {
    assert.deepEqual(
      Object.getOwnPropertyNames(m[name]).sort(), ["length", "name", "prototype"],
      `${name} must carry no static member — no generate, parse, from or fromFingerprint`,
    );
    assert.deepEqual(Object.getOwnPropertySymbols(m[name]), [], `${name} must carry no static symbol member`);
    for (const other of EXPORTS) {
      if (other === name) continue;
      assert.notEqual(Object.getPrototypeOf(m[name]), m[other], `${name} must not extend ${other}`);
    }
  }
});

test("each prototype carries exactly its declared members and the class-name tag", () => {
  const m = mod();
  const tenant = new m.TenantId(UUID_A);
  const actor = new m.ActorId(ACTOR_A);
  const instances = Object.fromEntries([
    ...scalars().map(([name, Class, input]) => [name, new Class(input)]),
    ["Principal", new m.Principal(tenant, actor)],
  ]);
  for (const [name, expected] of Object.entries(PROTOTYPE_MEMBERS)) {
    const proto = m[name].prototype;
    assert.deepEqual(Object.getOwnPropertyNames(proto).sort(), expected, `${name}.prototype members are frozen`);
    assert.deepEqual(Object.getOwnPropertySymbols(proto), [Symbol.toStringTag], `${name} must tag itself and no more`);
    const instance = instances[name];
    assert.equal(instance[Symbol.toStringTag], name, `${name} must tag itself with its own class name`);
    assert.equal(Object.prototype.toString.call(instance), `[object ${name}]`);
    assert.deepEqual(Object.getOwnPropertyNames(instance), [], `${name} must hold no own property — state stays private`);
    assert.deepEqual(Object.getOwnPropertySymbols(instance), []);
    for (const link of chain(instance).filter((p) => p !== proto)) {
      for (const other of EXPORTS) {
        assert.notEqual(link, m[other].prototype, `${name} must not inherit from the public ${other}`);
      }
    }
    assert.ok(Object.isFrozen(instance), `${name} instances must be frozen`);
    assert.ok(Object.isFrozen(m[name]), `the exported ${name} class must be frozen`);
    assert.ok(Object.isFrozen(proto), `${name}.prototype must be frozen`);
    assert.throws(() => { instance.injected = 1; }, Error, `${name} must refuse an injected property`);
  }
});

// -------------------------------------------------------------------------------------
// Canonical value, serialisation and exact-class equality — one table for every scalar.
// -------------------------------------------------------------------------------------

test("every scalar serialises to its canonical string and compares by exact class and value", () => {
  for (const [name, Class, inputA, canonicalA, inputB, canonicalB] of scalars()) {
    const a = new Class(inputA);
    const again = new Class(inputA);
    const b = new Class(inputB);
    assert.equal(a.toString(), canonicalA, `${name}.toString must be canonical`);
    assert.equal(a.toJSON(), canonicalA, `${name}.toJSON must be canonical`);
    assert.equal(String(a), canonicalA);
    assert.equal(JSON.stringify(a), JSON.stringify(canonicalA));
    assert.equal(a.equals(again), true, `${name} equality is by value, not identity`);
    assert.equal(a.equals(b), false, `${name} must separate distinct values`);
    for (const foreign of FOREIGN()) {
      if (foreign instanceof Class) continue;
      assert.equal(a.equals(foreign), false, `${name}.equals must refuse ${String(foreign?.constructor?.name ?? foreign)} without throwing`);
    }
    class Sub extends Class {}
    const sub = new Sub(inputA);
    assert.equal(a.equals(sub), false, `${name} must not accept a subclass instance as its own class`);
    assert.equal(sub.equals(a), false, `a ${name} subclass must not borrow exact-class equality in reverse`);
  }
});

// -------------------------------------------------------------------------------------
// Admissible and inadmissible constructor input, per primitive family.
// -------------------------------------------------------------------------------------

const NON_STRINGS = [undefined, null, 0, 42, true, {}, [], Symbol("s"), () => UUID_A, { toString: () => UUID_A }];

const UUID_OK = [
  ["v1 form", UUID_A], ["v4 form", UUID_B],
  ["no version restriction", "01234567-89ab-cdef-0123-456789abcdef"],
  ["max form", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
  ["one bit off nil", "00000000-0000-0000-0000-000000000001"],
];

const UUID_BAD = [
  ["nil uuid", "00000000-0000-0000-0000-000000000000"],
  ["uppercase", UUID_A.toUpperCase()], ["mixed case", "3f2504e0-4F89-11d3-9a0c-0305e82c3301"],
  ["unhyphenated", UUID_A.replaceAll("-", "")], ["braced", `{${UUID_A}}`], ["urn form", `urn:uuid:${UUID_A}`],
  ["leading space", ` ${UUID_A}`], ["trailing space", `${UUID_A} `], ["trailing newline", `${UUID_A}\n`],
  ["too short", UUID_A.slice(0, -1)], ["too long", `${UUID_A}1`], ["shifted hyphen", "3f2504e-04f89-11d3-9a0c-0305e82c3301"],
  ["non-hex digit", `${UUID_A.slice(0, -1)}g`], ["empty", ""],
];

const ACTOR_OK = [
  ["one character", "a"], ["lowest visible ascii", "!"], ["highest visible ascii", "~"],
  ["case preserved", "AbC-DeF"], ["punctuation", "actor:tenant/42"],
  ["every visible ascii", Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("")],
  ["maximum length", "a".repeat(128)],
];

const ACTOR_BAD = [
  ["empty", ""], ["overlong", "a".repeat(129)],
  ["leading space", " actor"], ["trailing space", "actor "], ["internal space", "act or"],
  ["tab", "\tactor"], ["newline", "actor\n"], ["nul", "act\u0000or"], ["del", "actor\u007f"],
  ["non-ascii letter", "act\u00f6r"], ["astral", "actor\u{1f642}"],
];

test("the uuid-form scalars admit only canonical lowercase hyphenated uuids", () => {
  for (const [name, Class] of scalars().filter(([n]) => n !== "ActorId" && n !== "IdempotencyKey")) {
    for (const [label, value] of UUID_OK) assert.equal(new Class(value).toString(), value, `${name} must admit ${label}`);
    for (const [label, value] of UUID_BAD) {
      assert.throws(() => new Class(value), Error, `${name} must refuse ${label}: ${JSON.stringify(value)}`);
    }
    for (const value of [...NON_STRINGS, new String(UUID_A)]) {
      assert.throws(() => new Class(value), Error, `${name} must refuse the non-primitive-string ${String(typeof value)}`);
    }
    assert.throws(() => new Class(), Error, `${name} must refuse a missing argument`);
  }
});

test("ActorId admits opaque visible ascii of 1 to 128 characters and preserves case exactly", () => {
  const { ActorId } = mod();
  for (const [label, value] of ACTOR_OK) assert.equal(new ActorId(value).toString(), value, `ActorId must admit ${label} unchanged`);
  for (const [label, value] of ACTOR_BAD) assert.throws(() => new ActorId(value), Error, `ActorId must refuse ${label}`);
  for (const value of [...NON_STRINGS, new String(ACTOR_A)]) assert.throws(() => new ActorId(value), Error);
  assert.throws(() => new ActorId(), Error);
});

// -------------------------------------------------------------------------------------
// Principal — a composite of two exact instances, and nothing about authority.
// -------------------------------------------------------------------------------------

test("Principal composes exact TenantId and ActorId instances, and refuses everything else", () => {
  const m = mod();
  const tenant = new m.TenantId(UUID_A);
  const actor = new m.ActorId(ACTOR_A);
  class SubTenant extends m.TenantId {}
  class SubActor extends m.ActorId {}
  const principal = new m.Principal(tenant, actor);
  assert.equal(principal.tenantId, tenant, "the tenant getter must return the exact instance given");
  assert.equal(principal.actorId, actor, "the actor getter must return the exact instance given");

  for (const [label, first, second] of [
    ["raw strings", UUID_A, ACTOR_A], ["a raw tenant string", UUID_A, actor], ["a raw actor string", tenant, ACTOR_A],
    ["swapped order", actor, tenant], ["two tenants", tenant, tenant], ["two actors", actor, actor],
    ["a CorrelationId as tenant", new m.CorrelationId(UUID_A), actor],
    ["a subclassed tenant", new SubTenant(UUID_A), actor], ["a subclassed actor", tenant, new SubActor(ACTOR_A)],
    ["a look-alike object", { toString: () => UUID_A }, actor], ["nulls", null, null], ["nothing", undefined, undefined],
  ]) {
    assert.throws(() => new m.Principal(first, second), Error, `Principal must refuse ${label}`);
  }
});

test("Principal is immutable, serialises stably, and compares by exact class and both values", () => {
  const m = mod();
  const make = (t, a) => new m.Principal(new m.TenantId(t), new m.ActorId(a));
  const principal = make(UUID_A, ACTOR_A);
  const json = principal.toJSON();
  assert.deepEqual(Object.keys(json), ["tenantId", "actorId"], "the key order is part of the stable shape");
  assert.deepEqual(json, { tenantId: UUID_A, actorId: ACTOR_A });
  assert.equal(principal.toString(), `{"tenantId":"${UUID_A}","actorId":"${ACTOR_A}"}`, "toString is compact deterministic JSON");
  assert.equal(principal.toString(), make(UUID_A, ACTOR_A).toString(), "two equal principals must render identically");
  assert.equal(JSON.stringify(principal), principal.toString());

  assert.equal(principal.equals(make(UUID_A, ACTOR_A)), true);
  assert.equal(principal.equals(make(UUID_B, ACTOR_A)), false, "a different tenant is a different principal");
  assert.equal(principal.equals(make(UUID_A, ACTOR_B)), false, "a different actor is a different principal");
  for (const foreign of FOREIGN()) assert.equal(principal.equals(foreign), false, "Principal.equals must refuse foreign values without throwing");
  class SubPrincipal extends m.Principal {}
  const sub = new SubPrincipal(new m.TenantId(UUID_A), new m.ActorId(ACTOR_A));
  assert.equal(principal.equals(sub), false);
  assert.equal(sub.equals(principal), false);
});

// -------------------------------------------------------------------------------------
// IdempotencyKey — the raw string is hashed and dropped. Nothing may surface it again.
// -------------------------------------------------------------------------------------

const RAW_OK = [
  ["one byte", "a"], ["internal space", "order 42"], ["internal non-breaking space", "a\u00a0b"],
  ["maximum ascii bytes", "a".repeat(1024)], ["maximum multibyte bytes", "\u00e9".repeat(512)],
];

const RAW_BAD = [
  ["empty", ""], ["one byte over ascii", "a".repeat(1025)],
  ["one character over in multibyte bytes", "\u00e9".repeat(513)],
  ["inside the character limit but over the byte limit", "\u3042".repeat(1024)],
  ["leading space", " abc"], ["trailing space", "abc "], ["leading tab", "\tabc"],
  ["trailing newline", "abc\n"], ["only whitespace", "   "],
  ["leading non-breaking space", "\u00a0abc"], ["trailing byte order mark", "abc\ufeff"],
  ["leading nul", "\u0000abc"], ["internal nul", "ab\u0000cd"],
  ["internal c0 control", "ab\u001fcd"], ["internal del", "ab\u007fcd"],
];

test("IdempotencyKey admits only a bounded, untrimmed, control-free primitive string", () => {
  const { IdempotencyKey } = mod();
  assert.equal(new TextEncoder().encode("\u00e9".repeat(512)).length, 1024, "the boundary row must really sit on 1024 bytes");
  for (const [label, raw] of RAW_OK) assert.match(new IdempotencyKey(raw).fingerprint, /^[0-9a-f]{64}$/, `must admit ${label}`);
  for (const [label, raw] of RAW_BAD) assert.throws(() => new IdempotencyKey(raw), Error, `must refuse ${label}`);
  for (const raw of [...NON_STRINGS, new String("abc")]) assert.throws(() => new IdempotencyKey(raw), Error);
  assert.throws(() => new IdempotencyKey(), Error);
});

test("IdempotencyKey retains only a lowercase sha-256 fingerprint of the raw input", () => {
  const { IdempotencyKey } = mod();
  const key = new IdempotencyKey("abc");
  assert.equal(key.fingerprint, SHA_ABC, "the known vector fixes the algorithm, encoding and case");
  assert.equal(new IdempotencyKey("hello world").fingerprint, SHA_HELLO);
  assert.equal(key.fingerprint, key.fingerprint.toLowerCase());
  assert.equal(key.toString(), SHA_ABC);
  assert.equal(key.toJSON(), SHA_ABC);
  for (const near of ["abd", "abcd", "ab c", "ABC", "cba"]) {
    assert.notEqual(new IdempotencyKey(near).fingerprint, SHA_ABC, `${JSON.stringify(near)} must not collapse onto "abc"`);
  }
  // Feeding a serialised fingerprint back in hashes it again: reconstruction is not in this package.
  assert.notEqual(new IdempotencyKey(key.fingerprint).fingerprint, key.fingerprint);
  for (const factory of ["from", "of", "parse", "generate", "fromFingerprint"]) {
    assert.equal(IdempotencyKey[factory], undefined, `IdempotencyKey.${factory} must not exist`);
  }
});

test("no surface of an IdempotencyKey can yield the raw input back", () => {
  const { IdempotencyKey } = mod();
  const raw = "MARKER-9f2c-raw-idempotency-input";
  const key = new IdempotencyKey(raw);
  const surfaces = [
    ["own keys", JSON.stringify(Object.keys(key))],
    ["own property names", JSON.stringify(Object.getOwnPropertyNames(key))],
    ["own descriptors", JSON.stringify(Object.getOwnPropertyDescriptors(key))],
    ["JSON", JSON.stringify(key)],
    ["String", String(key)],
    ["inspect", inspect(key, { showHidden: true, depth: null, getters: true })],
    ["every getter on the chain", chain(key).flatMap((p) => Object.entries(Object.getOwnPropertyDescriptors(p))
      .filter(([, d]) => typeof d.get === "function").map(([, d]) => String(d.get.call(key)))).join("|")],
  ];
  for (const [label, rendered] of surfaces) {
    assert.ok(!rendered.includes(raw), `the raw input leaked through ${label}: ${rendered}`);
  }
  // The rejection path must not echo it either — an error message is a surface like any other.
  assert.throws(() => new IdempotencyKey(` ${raw} `), (error) => {
    assert.ok(!String(error.message).includes(raw), `the rejection message echoed the raw input: ${error.message}`);
    return true;
  });
});

// -------------------------------------------------------------------------------------
// Cross-type construction. Constructors take primitive strings, so an already-built
// primitive is refused wherever it is offered — including by its own class.
// -------------------------------------------------------------------------------------

test("no primitive can be constructed from another primitive object", () => {
  const m = mod();
  const built = [
    ["TenantId", new m.TenantId(UUID_A)], ["CorrelationId", new m.CorrelationId(UUID_A)],
    ["CausationId", new m.CausationId(UUID_A)], ["ActorId", new m.ActorId(ACTOR_A)],
    ["IdempotencyKey", new m.IdempotencyKey("abc")],
    ["Principal", new m.Principal(new m.TenantId(UUID_A), new m.ActorId(ACTOR_A))],
  ];
  for (const target of EXPORTS) {
    for (const [source, instance] of built) {
      assert.throws(() => new m[target](instance), Error, `${target} must refuse a ${source} instance as its raw input`);
    }
  }
});

// -------------------------------------------------------------------------------------
// Architecture. A domain file that reaches for anything but node:crypto is not a domain
// file, and the residual risk of hashing low-entropy input must be stated where it lives.
// -------------------------------------------------------------------------------------

test("the domain module is framework-free and imports only node:crypto", async () => {
  mod();
  const source = await readFile(path.join(root, modulePath), "utf8");
  const specifiers = [...source.matchAll(/^import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm)].map((hit) => hit[1]);
  assert.deepEqual([...new Set(specifiers)], ["node:crypto"], "node:crypto is the only dependency a domain primitive may have");
  for (const [label, pattern] of [
    ["a dynamic import", /\bimport\s*\(/], ["a CommonJS require", /\brequire\s*\(/],
    ["process access", /\bprocess\s*\./], ["network access", /\bfetch\s*\(/], ["global escape", /\bglobalThis\b/],
    ["an HMAC or key secret", /createHmac|\bhmac\b/i], ["persistence", /writeFile|readFile|node:fs/],
    ["SQL", /\b(SELECT|INSERT INTO|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE)\b|sql`/],
  ]) {
    assert.ok(!pattern.test(source), `the domain module must contain no ${label}`);
  }
  // Every top-level export is one of the six classes: no port, use-case, command, query or
  // composition helper can be smuggled in as a loose function or constant.
  for (const line of source.match(/^export\b.*$/gm) ?? []) {
    assert.match(line, new RegExp(`^export class (${EXPORTS.join("|")})\\b`), `unexpected top-level export: ${line}`);
  }
  for (const [label, pattern] of [["low entropy", /low[-\s]entropy/i], ["offline", /offline/i], ["guessing", /guess/i]]) {
    assert.match(source, pattern, `the source prose must state the residual ${label} risk of a fingerprint over guessable input`);
  }
});
