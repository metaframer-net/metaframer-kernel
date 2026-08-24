import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// P05a — the CommitReceipt Application-ring contract, frozen against the canonical
// eight-field public contract (Actionplan c3d9e47e:reports/gj01-v2-contract-freeze-2026-08-22.json):
// requestId, tenantId, resourceId, outcome, committedAt, auditId, outboxEventIds, idempotencyKey.
// Scope: the CommitReceipt value type only — no WriteEnvelope, no UoW wiring, no adapter.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/commit-receipt.mjs";

let loaded = null;
let loadError = null;
try { loaded = await import(pathToFileURL(path.join(root, modulePath)).href); }
catch (error) { loadError = error; }

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}

const CANONICAL_KEYS = [
  "requestId", "tenantId", "resourceId", "outcome",
  "committedAt", "auditId", "outboxEventIds", "idempotencyKey",
];

const VALID = {
  requestId: "req-7731",
  tenantId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  resourceId: "res-billing-invoice-9001",
  outcome: "COMMITTED",
  committedAt: "2026-08-22T10:15:30.000Z",
  auditId: "audit-4471",
  outboxEventIds: ["evt-1", "evt-2"],
  idempotencyKey: "order-7731-retry-2",
};

function throwsTypeOrRange(fn, label) {
  assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError, label);
}

test("CommitReceipt export shape: exact export, frozen class/prototype/instance, deterministic JSON exposes exactly the canonical eight fields", () => {
  const { CommitReceipt } = mod();
  assert.equal(typeof CommitReceipt, "function", "CommitReceipt must be exported as a class/constructor");
  assert.ok(Object.isFrozen(CommitReceipt), "CommitReceipt class object must be frozen");
  assert.ok(Object.isFrozen(CommitReceipt.prototype), "CommitReceipt.prototype must be frozen");

  const receipt = new CommitReceipt(VALID);
  assert.ok(Object.isFrozen(receipt), "CommitReceipt instance must be frozen");
  assert.equal(Object.getPrototypeOf(receipt), CommitReceipt.prototype, "instance must have exact CommitReceipt prototype");

  const json = JSON.parse(JSON.stringify(receipt));
  const keys = Object.keys(json).sort();
  assert.deepEqual(keys, [...CANONICAL_KEYS].sort(), "serialized JSON must expose exactly the canonical eight fields");
  for (const key of CANONICAL_KEYS) {
    assert.ok(key in json, `serialized JSON missing canonical field ${key}`);
  }
});

test("CommitReceipt constructor admission: accepts exactly one ordinary enumerable data object with the exact keys; rejects missing/extra/symbol/accessor/non-enumerable/array/null/custom-prototype input without invoking accessors", () => {
  const { CommitReceipt } = mod();

  // missing key
  for (const key of CANONICAL_KEYS) {
    const missing = { ...VALID };
    delete missing[key];
    throwsTypeOrRange(() => new CommitReceipt(missing), `missing ${key} must be refused`);
  }

  // extra key
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, unexpected: "x" }), "unexpected extra key must be refused");

  // symbol-keyed extra property
  const symbolExtra = { ...VALID };
  symbolExtra[Symbol("extra")] = "x";
  throwsTypeOrRange(() => new CommitReceipt(symbolExtra), "symbol-keyed extra property must be refused");

  // hostile accessor on a required key, never invoked during admission refusal
  let getterCalled = false;
  const hostile = { ...VALID };
  delete hostile.requestId;
  Object.defineProperty(hostile, "requestId", { enumerable: true, get() { getterCalled = true; return VALID.requestId; } });
  throwsTypeOrRange(() => new CommitReceipt(hostile), "hostile accessor on a required key must be refused");
  assert.equal(getterCalled, false, "hostile accessor on a required key must never be invoked");

  // non-enumerable required key
  const hiddenKey = {};
  for (const key of CANONICAL_KEYS) {
    Object.defineProperty(hiddenKey, key, { value: VALID[key], enumerable: key !== "requestId" });
  }
  throwsTypeOrRange(() => new CommitReceipt(hiddenKey), "non-enumerable required key must be refused");

  // array input
  throwsTypeOrRange(() => new CommitReceipt([VALID]), "array input must be refused");

  // null input
  throwsTypeOrRange(() => new CommitReceipt(null), "null input must be refused");

  // no-argument construction
  throwsTypeOrRange(() => new CommitReceipt(), "no-argument construction must be refused");

  // custom-prototype input object
  const customProto = Object.create({ marker: true });
  Object.assign(customProto, VALID);
  throwsTypeOrRange(() => new CommitReceipt(customProto), "custom-prototype input object must be refused");

  // null-prototype input object
  const nullProto = Object.assign(Object.create(null), VALID);
  throwsTypeOrRange(() => new CommitReceipt(nullProto), "null-prototype input object must be refused");

  // valid ordinary enumerable data object is accepted
  assert.doesNotThrow(() => new CommitReceipt({ ...VALID }), "exact canonical ordinary object must be accepted");
});

test("CommitReceipt string fields: requestId/tenantId/resourceId/auditId/idempotencyKey are non-empty primitive strings; outcome is exactly COMMITTED; no ambient clock/ID generation", () => {
  const { CommitReceipt } = mod();
  const stringFields = ["requestId", "tenantId", "resourceId", "auditId", "idempotencyKey"];

  for (const field of stringFields) {
    for (const bad of ["", "   ", 123, null, undefined, true, new String(VALID[field]), Symbol("x"), {}, []]) {
      throwsTypeOrRange(() => new CommitReceipt({ ...VALID, [field]: bad }), `${field} must reject non-empty-primitive-string ${String(bad)}`);
    }
    assert.doesNotThrow(() => new CommitReceipt({ ...VALID, [field]: VALID[field] }), `${field} must accept a non-empty primitive string`);
  }

  for (const bad of ["committed", "COMMIT", "committed_ok", "Committed", "", "PENDING", 1, null, undefined]) {
    throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outcome: bad }), `outcome must reject non-exact value ${String(bad)}`);
  }
  assert.doesNotThrow(() => new CommitReceipt({ ...VALID, outcome: "COMMITTED" }), "outcome must accept exactly COMMITTED");

  const receiptA = new CommitReceipt({ ...VALID });
  const receiptB = new CommitReceipt({ ...VALID });
  assert.equal(receiptA.requestId, receiptB.requestId, "no ambient/random requestId generation across identical constructions");
  assert.equal(receiptA.committedAt, receiptB.committedAt, "no ambient clock use — committedAt must come from input, not Date.now()");
});

test("CommitReceipt committedAt: real canonical UTC millisecond ISO instant with arithmetic calendar validation, not permissive Date parsing", () => {
  const { CommitReceipt } = mod();

  const validInstants = [
    "2026-08-22T10:15:30.000Z",
    "2000-02-29T00:00:00.000Z", // leap day, arithmetically valid
    "1970-01-01T00:00:00.000Z",
  ];
  for (const instant of validInstants) {
    assert.doesNotThrow(() => new CommitReceipt({ ...VALID, committedAt: instant }), `${instant} must be accepted`);
  }

  const invalidInstants = [
    "2026-08-22T10:15:30Z",        // missing milliseconds
    "2026-08-22T10:15:30.000+00:00", // offset instead of Z
    "2026-08-22 10:15:30.000Z",    // space instead of T
    "2026-13-01T00:00:00.000Z",    // month 13
    "2026-02-30T00:00:00.000Z",    // Feb 30 — arithmetically invalid
    "2025-02-29T00:00:00.000Z",    // non-leap-year Feb 29
    "2026-08-32T00:00:00.000Z",    // day 32
    "2026-08-22T24:00:00.000Z",    // hour 24
    "not-a-date",
    "",
    1755855330000,                 // epoch millis number, not a string
    null,
    undefined,
    new Date("2026-08-22T10:15:30.000Z"), // Date object, not a string
  ];
  for (const bad of invalidInstants) {
    throwsTypeOrRange(() => new CommitReceipt({ ...VALID, committedAt: bad }), `committedAt must reject ${String(bad)}`);
  }
});

test("CommitReceipt outboxEventIds: non-empty dense ordinary array of unique non-empty primitive strings, defensively copied and frozen", () => {
  const { CommitReceipt } = mod();

  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: [] }), "empty outboxEventIds must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: ["evt-1", "evt-1"] }), "duplicate outboxEventIds must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: ["evt-1", ""] }), "empty-string element must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: ["evt-1", 42] }), "non-string element must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: ["evt-1", null] }), "null element must be refused");
  // eslint-disable-next-line no-sparse-arrays
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: ["evt-1", , "evt-2"] }), "sparse array must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: "evt-1" }), "non-array outboxEventIds must be refused");
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: null }), "null outboxEventIds must be refused");

  // Array subclass instance refused despite a valid element; accessor element refused unread
  class EvilArray extends Array {}
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: EvilArray.from(["evt-1"]) }), "Array subclass instance must be refused");
  let outboxGetterCalled = false; const accessorArray = ["evt-1"];
  Object.defineProperty(accessorArray, 0, { enumerable: true, configurable: true, get() { outboxGetterCalled = true; return "evt-1"; } });
  throwsTypeOrRange(() => new CommitReceipt({ ...VALID, outboxEventIds: accessorArray }), "accessor refused");
  assert.equal(outboxGetterCalled, false, "accessor element on outboxEventIds must never be invoked");

  const source = ["evt-1", "evt-2", "evt-3"];
  const receipt = new CommitReceipt({ ...VALID, outboxEventIds: source });
  assert.deepEqual(receipt.outboxEventIds, source, "accepted outboxEventIds must preserve order and values");
  assert.ok(Object.isFrozen(receipt.outboxEventIds), "outboxEventIds must be frozen on the instance");
  assert.notEqual(receipt.outboxEventIds, source, "outboxEventIds must be defensively copied, not aliased to caller's array");

  source.push("evt-4");
  assert.equal(receipt.outboxEventIds.length, 3, "mutating the caller's source array after construction must not affect the receipt");
});
