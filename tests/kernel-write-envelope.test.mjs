import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UnitOfWork } from "../src/application/unit-of-work.mjs";
import { CommitReceipt } from "../src/application/commit-receipt.mjs";

// P05b — WriteEnvelope: runs one write through a UnitOfWork, answers with a CommitReceipt.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "src/application/write-envelope.mjs";

let loaded = null;
let loadError = null;
try { loaded = await import(pathToFileURL(path.join(root, modulePath)).href); }
catch (error) { loadError = error; }

function mod() {
  assert.ok(loaded !== null, `${modulePath} must exist and import cleanly: ${loadError?.message ?? "not imported"}`);
  return loaded;
}

const VALID_RECEIPT_FIELDS = {
  requestId: "req-9001",
  tenantId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  resourceId: "res-billing-invoice-9001",
  outcome: "COMMITTED",
  committedAt: "2026-08-25T10:15:30.000Z",
  auditId: "audit-9001",
  outboxEventIds: ["evt-1"],
  idempotencyKey: "order-9001-retry-1",
};

function realUnitOfWork(overrides = {}) {
  return new UnitOfWork({ begin: async () => ({ scope: true }), commit: async () => undefined, rollback: async () => undefined, ...overrides });
}

function realReceipt() {
  return new CommitReceipt({ ...VALID_RECEIPT_FIELDS });
}

test("WriteEnvelope export/constructor: exact export/prototype/toStringTag surface; exact import specifiers; ordinary {unitOfWork, write} accepted, accessors/non-exact/malformed input refused without executing", () => {
  const { WriteEnvelope } = mod();
  assert.deepEqual(Object.keys(mod()), ["WriteEnvelope"], "module must export exactly WriteEnvelope");
  assert.equal(typeof WriteEnvelope, "function", "WriteEnvelope must be exported as a class/constructor");
  assert.ok(Object.isFrozen(WriteEnvelope), "WriteEnvelope class object must be frozen");
  assert.ok(Object.isFrozen(WriteEnvelope.prototype), "WriteEnvelope.prototype must be frozen");
  assert.deepEqual(Object.getOwnPropertyNames(WriteEnvelope.prototype).sort(), ["commit", "constructor"], "prototype must expose exactly constructor and commit");

  const unitOfWork = realUnitOfWork();
  const write = async () => realReceipt();
  const instance = new WriteEnvelope({ unitOfWork, write });
  assert.ok(Object.isFrozen(instance), "instance must be frozen");
  assert.equal(Object.prototype.toString.call(instance), "[object Object]", "instance must carry the ordinary Object tag");

  let getterCalled = false;
  const hostile = {};
  Object.defineProperty(hostile, "unitOfWork", { enumerable: true, get() { getterCalled = true; return unitOfWork; } });
  Object.defineProperty(hostile, "write", { enumerable: true, value: write });
  assert.throws(() => new WriteEnvelope(hostile), TypeError, "accessor unitOfWork must be refused");
  assert.equal(getterCalled, false, "hostile accessor must never be invoked during admission refusal");
  assert.throws(() => new WriteEnvelope({ unitOfWork: {}, write }), TypeError, "non-exact UnitOfWork must be refused");
  assert.throws(() => new WriteEnvelope({ unitOfWork, write: "not-a-function" }), TypeError, "non-function write must be refused");

  const nonEnum = {};
  Object.defineProperty(nonEnum, "unitOfWork", { value: unitOfWork, enumerable: false });
  Object.defineProperty(nonEnum, "write", { value: write, enumerable: true });
  const symbolExtra = { unitOfWork, write }; symbolExtra[Symbol("x")] = 1;
  const customProto = Object.assign(Object.create({ marker: true }), { unitOfWork, write });
  const nullProto = Object.assign(Object.create(null), { unitOfWork, write });
  const malformed = [
    [{ write }, "missing unitOfWork"], [{ unitOfWork }, "missing write"],
    [{ unitOfWork, write, extra: 1 }, "extra key"], [symbolExtra, "symbol-keyed extra"],
    [nonEnum, "non-enumerable key"], [[unitOfWork, write], "array input"],
    [null, "null input"], [customProto, "custom-prototype input"], [nullProto, "null-prototype input"],
  ];
  for (const [input, label] of malformed) {
    assert.throws(() => new WriteEnvelope(input), TypeError, `${label} must be refused`);
  }

  let source = "";
  try { source = readFileSync(path.join(root, modulePath), "utf8"); } catch { /* absent */ }
  const specifiers = [...source.matchAll(/^\s*import\s+.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1].replace(/^.*\//, ""));
  assert.deepEqual(specifiers.sort(), ["commit-receipt.mjs", "unit-of-work.mjs"], "source must import exactly commit-receipt.mjs and unit-of-work.mjs, no other module");
});

test("WriteEnvelope success order: begin -> write -> commit; scope and preparedChangeSet pass by identity; write sees undefined this; exact receipt returned only after commit settles", async () => {
  const { WriteEnvelope } = mod();
  const order = [];
  let sawScope;
  let sawChangeSet;
  let commitSettled = false;
  const scopeToken = { marker: "scope" };
  const preparedChangeSet = { marker: "change-set" };
  const receipt = realReceipt();

  const unitOfWork = realUnitOfWork({
    begin: async () => { order.push("begin"); return scopeToken; },
    commit: async () => { order.push("commit"); commitSettled = true; },
  });
  let sawThis = "unset";
  const write = async function writeFn(scope, changeSet) {
    order.push("write");
    sawScope = scope;
    sawChangeSet = changeSet;
    sawThis = this;
    return receipt;
  };

  const envelope = new WriteEnvelope({ unitOfWork, write });
  const result = await envelope.commit(preparedChangeSet);

  assert.deepEqual(order, ["begin", "write", "commit"], "must run begin -> write -> commit in exact order");
  assert.equal(sawScope, scopeToken, "write must see the begin-produced scope by identity");
  assert.equal(sawChangeSet, preparedChangeSet, "write must see the exact preparedChangeSet by identity as its second argument");
  assert.equal(sawThis, undefined, "write must be invoked as a plain function with undefined this");
  assert.equal(result, receipt, "returned value must be the exact CommitReceipt instance by identity");
  assert.ok(commitSettled, "commit must have settled before the receipt is returned");
});

test("WriteEnvelope refuses a non-exact CommitReceipt from write: TypeError, rollback exactly once, commit never called", async () => {
  const { WriteEnvelope } = mod();
  let rollbackCalls = 0;
  let commitCalls = 0;
  const unitOfWork = realUnitOfWork({
    commit: async () => { commitCalls += 1; },
    rollback: async () => { rollbackCalls += 1; },
  });
  const write = async () => ({ requestId: "not-a-real-receipt" });
  const envelope = new WriteEnvelope({ unitOfWork, write });

  await assert.rejects(() => envelope.commit({}), TypeError, "non-exact CommitReceipt result must be refused with TypeError");
  assert.equal(rollbackCalls, 1, "rollback must run exactly once");
  assert.equal(commitCalls, 0, "commit must never run");
});

test("WriteEnvelope write failure rolls back once, never commits, and preserves the original failure identity even when rollback itself fails", async () => {
  const { WriteEnvelope } = mod();
  const originalFailure = new Error("write blew up");
  let rollbackCalls = 0;
  let commitCalls = 0;
  const unitOfWork = realUnitOfWork({
    commit: async () => { commitCalls += 1; },
    rollback: async () => { rollbackCalls += 1; throw new Error("rollback also blew up"); },
  });
  const write = async () => { throw originalFailure; };
  const envelope = new WriteEnvelope({ unitOfWork, write });

  await assert.rejects(() => envelope.commit({}), (error) => error === originalFailure, "the original write failure must propagate by identity, not the rollback's failure");
  assert.equal(rollbackCalls, 1, "rollback must run exactly once");
  assert.equal(commitCalls, 0, "commit must never run");
});

test("WriteEnvelope begin failure reaches no write/commit/rollback; UnitOfWork commit failure propagates by identity and the receipt never resolves", async () => {
  const { WriteEnvelope } = mod();
  const beginFailure = new Error("begin blew up");
  let writeCalls = 0;
  let commitCalls = 0;
  let rollbackCalls = 0;
  const failingBeginUow = realUnitOfWork({
    begin: async () => { throw beginFailure; },
    commit: async () => { commitCalls += 1; },
    rollback: async () => { rollbackCalls += 1; },
  });
  const write = async () => { writeCalls += 1; return realReceipt(); };
  const envelopeA = new WriteEnvelope({ unitOfWork: failingBeginUow, write });

  await assert.rejects(() => envelopeA.commit({}), (error) => error === beginFailure, "begin failure must propagate by identity");
  assert.equal(writeCalls, 0, "write must never run when begin fails");
  assert.equal(commitCalls, 0, "commit must never run when begin fails");
  assert.equal(rollbackCalls, 0, "rollback must never run when begin fails");

  const commitFailure = new Error("commit blew up");
  const failingCommitUow = realUnitOfWork({ commit: async () => { throw commitFailure; } });
  const envelopeB = new WriteEnvelope({ unitOfWork: failingCommitUow, write: async () => realReceipt() });

  await assert.rejects(() => envelopeB.commit({}), (error) => error === commitFailure, "UnitOfWork commit failure must propagate by identity");
});
