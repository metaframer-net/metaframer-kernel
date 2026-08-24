import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { PolicyRequest, PolicyDecision } from "../src/application/policy-decision.mjs";

// =====================================================================================
// P04d — DecisionLogEntry, its hash-chain primitive and the DecisionLogPort: not yet
// implemented. Written before src/application/decision-log-entry.mjs and
// src/application/decision-log-port.mjs exist, so every assertion below is a requirement
// on the not-yet-written modules; the dynamic import guards below turn "the module does
// not exist yet" into three informative, per-scenario RED failures rather than one crash.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryModulePath = "src/application/decision-log-entry.mjs";
const portModulePath = "src/application/decision-log-port.mjs";

let entryLoaded = null;
let entryLoadError = null;
try {
  entryLoaded = await import(pathToFileURL(path.join(root, entryModulePath)).href);
} catch (error) {
  entryLoadError = error;
}

let portLoaded = null;
let portLoadError = null;
try {
  portLoaded = await import(pathToFileURL(path.join(root, portModulePath)).href);
} catch (error) {
  portLoadError = error;
}

function entryMod(scenario) {
  assert.ok(
    entryLoaded !== null && typeof entryLoaded.DecisionLogEntry === "function",
    `[${scenario}] ${entryModulePath} must exist, import cleanly and export DecisionLogEntry: `
      + `${entryLoadError?.message ?? "DecisionLogEntry export missing"}`,
  );
  return entryLoaded;
}

function portMod(scenario) {
  assert.ok(
    portLoaded !== null && typeof portLoaded.DecisionLogPort === "function",
    `[${scenario}] ${portModulePath} must exist, import cleanly and export DecisionLogPort: `
      + `${portLoadError?.message ?? "DecisionLogPort export missing"}`,
  );
  return portLoaded;
}

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;
const throwsAdmission = (fn) => assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError);

// Fixtures, built through the constructors that own each type.
const TENANT = new TenantId("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
const ACTOR = new ActorId("svc-billing-worker");
const PRINCIPAL = new Principal(TENANT, ACTOR);
const CORRELATION = new CorrelationId("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
const OTHER_CORRELATION = new CorrelationId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const IDEMPOTENCY = new IdempotencyKey("order-7731-retry-2");

const ACTION = new Command({
  name: "billing.invoice.issue", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
  causationId: null, idempotencyKey: IDEMPOTENCY, payload: { amount: 100 },
});
const RESOURCE = { type: "invoice", id: "7731" };
const CONTEXT = { channel: "api" };
const REQUEST = new PolicyRequest({ action: ACTION, resource: RESOURCE, context: CONTEXT });
const ALLOW_DECISION = new PolicyDecision({
  effect: "allow", reason: "policy matched", matchedPolicyId: "pol-billing-issue", traceId: CORRELATION,
});
const DENY_DECISION = new PolicyDecision({
  effect: "deny", reason: "no policy matched", matchedPolicyId: null, traceId: CORRELATION,
});
// A decision whose traceId is a distinct genuine CorrelationId from REQUEST's action correlationId.
const CROSS_TRACE_DECISION = new PolicyDecision({
  effect: "allow", reason: "policy matched", matchedPolicyId: "pol-billing-issue", traceId: OTHER_CORRELATION,
});

const GENESIS_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SUCCESSOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const GENESIS_TS = "2026-08-24T10:00:00.000Z";
const SUCCESSOR_TS = "2026-08-24T10:00:01.000Z";

function baseGenesisOptions() {
  return {
    id: GENESIS_ID, request: REQUEST, decision: ALLOW_DECISION,
    layerResolved: "tenant", ts: GENESIS_TS, prevHash: null,
  };
}

// Expected fixed JSON payload computed purely from the fixed fixtures/literal inputs above —
// never read back from an entry's own getters or output, so this is never a self-referential oracle.
function expectedGenesisPayload() {
  return {
    id: GENESIS_ID,
    requestActor: { tenantId: TENANT.toString(), actorId: ACTOR.toString() },
    requestAction: "billing.invoice.issue",
    requestResource: RESOURCE,
    requestContext: CONTEXT,
    decision: "allow",
    reason: "policy matched",
    matchedPolicyId: "pol-billing-issue",
    layerResolved: "tenant",
    traceId: CORRELATION.toString(),
    ts: GENESIS_TS,
    prevHash: null,
  };
}

function sha256Of(payload) {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

// A. DecisionLogEntry construction, canonical fields, fixed serialization and admission.
test("DecisionLogEntry: canonical fields, fixed serialization against a literal payload, and admission matrix", () => {
  const { DecisionLogEntry } = entryMod("A");

  const genesis = new DecisionLogEntry(baseGenesisOptions());
  assert.ok(isExactly(genesis, DecisionLogEntry), "exact-class DecisionLogEntry instance");
  assert.ok(Object.isFrozen(genesis), "entry instance is frozen");
  assert.ok(Object.isFrozen(DecisionLogEntry), "DecisionLogEntry class is frozen");
  assert.ok(Object.isFrozen(DecisionLogEntry.prototype), "DecisionLogEntry prototype is frozen");
  assert.equal(genesis.id, GENESIS_ID);
  assert.equal(genesis.prevHash, null);
  assert.equal(genesis.layerResolved, "tenant");
  assert.equal(genesis.decision.traceId, REQUEST.action.correlationId, "decision.traceId is request.action.correlationId by identity");

  // Fixed serialization: entry.toJSON() (minus entryHash) must equal the literal, independently
  // authored expected payload, and entryHash must equal sha256 of exactly that payload.
  const expectedPayload = expectedGenesisPayload();
  const json = genesis.toJSON();
  assert.deepEqual(
    Object.keys(json).sort(),
    ["decision", "entryHash", "id", "layerResolved", "matchedPolicyId", "prevHash", "reason",
      "requestAction", "requestActor", "requestContext", "requestResource", "traceId", "ts"].sort(),
  );
  const { entryHash, ...withoutHash } = json;
  assert.deepEqual(withoutHash, expectedPayload, "fixed payload equals the literal input-derived expectation");
  assert.equal(entryHash, sha256Of(expectedPayload), "entryHash equals sha256 of the fixed payload excluding entryHash");
  assert.match(entryHash, /^[0-9a-f]{64}$/, "entryHash is lowercase 64-hex");

  // Equal genuine twin: same covered inputs -> equal serialization, equals() true, distinct object identity.
  const genesisTwin = new DecisionLogEntry(baseGenesisOptions());
  assert.deepEqual(genesisTwin.toJSON(), genesis.toJSON());
  assert.notEqual(genesisTwin, genesis, "distinct instances remain distinct objects");
  assert.equal(typeof genesis.equals, "function");
  assert.equal(genesis.equals(genesisTwin), true, "equal genuine twin accepted by equals");
  assert.equal(typeof genesis.toString, "function");
  assert.equal(genesis.toString(), JSON.stringify(genesis.toJSON()), "toString renders the same fixed JSON");

  // equals refuses an exact-class counterfeit (hollow prototype-only instance) and a subclass instance.
  const counterfeit = Object.create(DecisionLogEntry.prototype);
  assert.equal(genesis.equals(counterfeit), false, "exact-class counterfeit refused by equals");
  class DerivedEntry extends DecisionLogEntry {}
  const derived = new DerivedEntry(baseGenesisOptions());
  assert.equal(genesis.equals(derived), false, "subclass instance refused by equals");

  // id must be an uppercase 26-char canonical ULID; reject wrong case, wrong shape and invalid alphabet.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), id: GENESIS_ID.toLowerCase() }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), id: "not-a-ulid" }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), id: `${GENESIS_ID}X` }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), id: "01ARZ3NDEKTSV4RRFFQ69G5FAI" }), "I is outside Crockford base32");

  // ts must be canonical UTC millisecond ISO; reject a missing-millis form and an impossible-but-shaped date.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), ts: "2026-08-24T10:00:00Z" }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), ts: "2026-02-30T10:00:00.000Z" }), "impossible calendar date rejected despite matching shape");

  // prevHash must be null or lowercase 64-hex.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), prevHash: "A".repeat(64) }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), prevHash: "0".repeat(63) }));
  const withPrev = new DecisionLogEntry({ ...baseGenesisOptions(), id: SUCCESSOR_ID, prevHash: "0".repeat(64) });
  assert.equal(withPrev.prevHash, "0".repeat(64));

  // layerResolved must be system|platform|tenant when matchedPolicyId is non-null, and null only for default-deny.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), layerResolved: "bogus" }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), layerResolved: null }), "null layerResolved refused when matchedPolicyId is non-null");
  const defaultDeny = new DecisionLogEntry({
    ...baseGenesisOptions(), decision: DENY_DECISION, layerResolved: null,
  });
  assert.equal(defaultDeny.layerResolved, null);
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), decision: DENY_DECISION, layerResolved: "tenant" }), "non-null layerResolved refused for a default-deny decision");

  // Cross-trace refusal: decision.traceId must be request.action.correlationId by identity, not merely equal value.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), decision: CROSS_TRACE_DECISION }), "decision with a distinct genuine traceId refused");

  // exact ordinary data options: reject unknown keys and a hostile accessor on a required key without invoking it.
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), extra: true }));
  let getterCalled = false;
  const hostileOptions = { ...baseGenesisOptions() };
  delete hostileOptions.id;
  Object.defineProperty(hostileOptions, "id", { enumerable: true, get() { getterCalled = true; return GENESIS_ID; } });
  throwsAdmission(() => new DecisionLogEntry(hostileOptions));
  assert.equal(getterCalled, false, "hostile accessor on a required key never invoked during admission refusal");
  throwsAdmission(() => new DecisionLogEntry(Object.create({ ...baseGenesisOptions() })));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), request: { action: ACTION, resource: {}, context: {} } }));
  throwsAdmission(() => new DecisionLogEntry({ ...baseGenesisOptions(), decision: { effect: "allow" } }));
});

// B. Hash-chain primitive: genesis/successor linkage and per-input change sensitivity.
test("DecisionLogEntry hash chain: genesis, successor linkage and per-input change sensitivity", () => {
  const { DecisionLogEntry } = entryMod("B");

  const genesisPayload = expectedGenesisPayload();
  const genesisHash = sha256Of(genesisPayload);
  const genesis = new DecisionLogEntry(baseGenesisOptions());
  assert.equal(genesis.entryHash, genesisHash);

  const successorPayload = { ...genesisPayload, id: SUCCESSOR_ID, ts: SUCCESSOR_TS, prevHash: genesisHash };
  const successor = new DecisionLogEntry({
    id: SUCCESSOR_ID, request: REQUEST, decision: ALLOW_DECISION,
    layerResolved: "tenant", ts: SUCCESSOR_TS, prevHash: genesisHash,
  });
  assert.equal(successor.prevHash, genesisHash, "successor prevHash equals genesis entryHash");
  assert.equal(successor.entryHash, sha256Of(successorPayload));
  assert.notEqual(successor.entryHash, genesis.entryHash);

  // Same covered content, different predecessor -> different entryHash.
  const differentPrevPayload = { ...successorPayload, prevHash: "1".repeat(64) };
  const sameContentDifferentPrev = new DecisionLogEntry({
    id: SUCCESSOR_ID, request: REQUEST, decision: ALLOW_DECISION,
    layerResolved: "tenant", ts: SUCCESSOR_TS, prevHash: "1".repeat(64),
  });
  assert.notEqual(sameContentDifferentPrev.entryHash, successor.entryHash, "changed prevHash changes entryHash");
  assert.equal(sameContentDifferentPrev.entryHash, sha256Of(differentPrevPayload));

  // Each changed covered input independently changes entryHash relative to genesis.
  const changedId = new DecisionLogEntry({ ...baseGenesisOptions(), id: "01ARZ3NDEKTSV4RRFFQ69G5FAX" });
  assert.equal(changedId.entryHash, sha256Of({ ...genesisPayload, id: "01ARZ3NDEKTSV4RRFFQ69G5FAX" }));

  const changedTs = new DecisionLogEntry({ ...baseGenesisOptions(), ts: "2026-08-24T10:00:02.000Z" });
  assert.equal(changedTs.entryHash, sha256Of({ ...genesisPayload, ts: "2026-08-24T10:00:02.000Z" }));

  const changedDecision = new DecisionLogEntry({ ...baseGenesisOptions(), decision: DENY_DECISION, layerResolved: null });
  assert.equal(changedDecision.entryHash, sha256Of({
    ...genesisPayload, decision: "deny", reason: "no policy matched", matchedPolicyId: null, layerResolved: null,
  }));

  const changedLayer = new DecisionLogEntry({ ...baseGenesisOptions(), layerResolved: "platform" });
  assert.equal(changedLayer.entryHash, sha256Of({ ...genesisPayload, layerResolved: "platform" }));

  const otherAction = new Command({
    name: "billing.invoice.void", version: 1, principal: PRINCIPAL, correlationId: CORRELATION,
    causationId: null, idempotencyKey: new IdempotencyKey("order-7731-void-1"), payload: { amount: 100 },
  });
  const changedRequest = new DecisionLogEntry({
    ...baseGenesisOptions(),
    request: new PolicyRequest({ action: otherAction, resource: RESOURCE, context: CONTEXT }),
  });
  assert.equal(changedRequest.entryHash, sha256Of({ ...genesisPayload, requestAction: "billing.invoice.void" }));

  const hashes = [genesis, changedId, changedTs, changedDecision, changedLayer, changedRequest].map((e) => e.entryHash);
  assert.equal(new Set(hashes).size, hashes.length, "every changed covered input yields a distinct entryHash");
});

// C. DecisionLogPort: exact seam, hostile/counterfeit admission and single-call append forwarding.
test("DecisionLogPort: exact append-only seam, hostile admission and forwarding integrity", async () => {
  const { DecisionLogEntry } = entryMod("C");
  const { DecisionLogPort } = portMod("C");

  const genesis = new DecisionLogEntry(baseGenesisOptions());

  assert.ok(Object.isFrozen(DecisionLogPort), "DecisionLogPort class is frozen");
  assert.ok(Object.isFrozen(DecisionLogPort.prototype), "DecisionLogPort prototype is frozen");
  assert.deepEqual(
    Object.getOwnPropertyNames(DecisionLogPort.prototype).sort(),
    ["append", "constructor"],
    "DecisionLogPort exposes exactly append and no update/delete/read/latest/replay/query method",
  );

  throwsAdmission(() => new DecisionLogPort());
  throwsAdmission(() => new DecisionLogPort({}));
  throwsAdmission(() => new DecisionLogPort({ append: "not-a-function" }));
  throwsAdmission(() => new DecisionLogPort({ append: async () => {}, extra: true }));

  let getterCalled = false;
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, "append", { enumerable: true, get() { getterCalled = true; return async () => {}; } });
  throwsAdmission(() => new DecisionLogPort(hostileOptions));
  assert.equal(getterCalled, false, "hostile append accessor never invoked during admission refusal");

  let calls = 0;
  let seenReceiver = "unset";
  let seenEntry = null;
  const RESULT = { appended: true };
  const port = new DecisionLogPort({
    append(entry) {
      calls += 1;
      seenReceiver = this;
      seenEntry = entry;
      return Promise.resolve(RESULT);
    },
  });
  assert.ok(Object.isFrozen(port), "port instance is frozen");

  const result = await port.append(genesis);
  assert.equal(calls, 1, "collaborator called exactly once");
  assert.equal(seenReceiver, undefined, "collaborator invoked with an undefined receiver");
  assert.equal(seenEntry, genesis, "collaborator receives the exact same entry identity");
  assert.equal(result, RESULT, "resolved result preserves collaborator's identity");

  // Counterfeit entry refused before the collaborator is ever called.
  const counterfeit = Object.create(DecisionLogEntry.prototype);
  await assert.rejects(() => port.append(counterfeit), (e) => e instanceof TypeError);
  assert.equal(calls, 1, "counterfeit entry never reaches the collaborator");

  const REJECTION = new Error("append backend unavailable");
  const rejectingPort = new DecisionLogPort({ append: () => Promise.reject(REJECTION) });
  await assert.rejects(() => rejectingPort.append(genesis), (e) => e === REJECTION, "rejection identity preserved");
});
