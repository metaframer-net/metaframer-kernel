import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORICAL_LITERAL,
  P01_CLOSURE_SEMANTICS_V1,
  simulateExecution,
} from "../tools/check-p01-closure-semantics.mjs";

// Compact synthetic chain: P1 (ordinal 1) -> P2 (ordinal 2).
// E_SELF is a same-phase self-cycle (P1 -> P1), classified INTRA_ATOMIC.
// E_FWD carries a forward obligation (P1 -> P2), classified FORWARD_DEFERRED.
function buildModel() {
  return {
    phases: [
      {
        id: "P1",
        ordinal: 1,
        predecessor: null,
        receiptId: "RCPT-P1",
        closureEdgeIds: ["E_SELF", "E_FWD"],
      },
      {
        id: "P2",
        ordinal: 2,
        predecessor: "P1",
        receiptId: "RCPT-P2",
        closureEdgeIds: [],
      },
    ],
    edges: [
      {
        edgeId: "E_SELF",
        sourceGap: "G1",
        destinationGap: "G1",
        sourcePhase: "P1",
        destinationPhase: "P1",
        classification: "INTRA_ATOMIC",
        expectedDestinationReceipt: "RCPT-P1",
      },
      {
        edgeId: "E_FWD",
        sourceGap: "G2",
        destinationGap: "G3",
        sourcePhase: "P1",
        destinationPhase: "P2",
        classification: "FORWARD_DEFERRED",
        expectedDestinationReceipt: "RCPT-P2",
      },
    ],
  };
}

test("HISTORICAL_LITERAL blocks the source phase receipt on the self-cycle and deadlocks", () => {
  const model = buildModel();
  const result = simulateExecution(model, { semantics: HISTORICAL_LITERAL });

  assert.deepEqual(result.reachedPhaseReceipts, []);
  assert.deepEqual(result.blockedPhases, ["P1", "P2"]);
  assert.deepEqual(result.selfCycles, ["E_SELF"]);
  assert.equal(result.deadlocked, true);
  assert.equal(result.receiptsIssued, 0);
  assert.equal(result.signaturesProduced, 0);
  assert.equal(result.humanDecisionsClosed, 0);
});

test("P01_CLOSURE_SEMANTICS_V1 discharges the intra-phase obligation within the reached receipt", () => {
  const model = buildModel();
  const result = simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });

  assert.deepEqual(result.reachedPhaseReceipts, ["RCPT-P1", "RCPT-P2"]);
  assert.deepEqual(result.blockedPhases, []);
  assert.equal(result.deadlocked, false);

  assert.equal(result.intraDischarges.length, 1);
  assert.equal(result.intraDischarges[0].edgeId, "E_SELF");
  assert.equal(result.intraDischarges[0].receiptId, "RCPT-P1");

  // The forward obligation is an open debt the moment P1 issues, before P2 exists.
  assert.equal(result.gapStatusAt["RCPT-P1"].G1, "CLOSED");
  assert.equal(result.gapStatusAt["RCPT-P1"].G2, "CLOSURE_PENDING");

  // The debt is recorded at its source receipt the moment that receipt becomes reachable,
  // before the destination phase (and thus the discharge) exists.
  assert.equal(result.debtsRecordedAt["RCPT-P1"].length, 1);
  assert.equal(result.debtsRecordedAt["RCPT-P1"][0].edgeId, "E_FWD");
  assert.equal(result.debtsRecordedAt["RCPT-P1"][0].sourcePhaseReceipt, "RCPT-P1");
  assert.equal(result.debtsRecordedAt["RCPT-P2"], undefined);

  // It discharges only once the destination phase receipt (P2) becomes reachable, and the
  // debt record recorded at RCPT-P1 survives that discharge.
  assert.deepEqual(result.forwardDebts, []);
  assert.equal(result.debtsRecordedAt["RCPT-P1"].length, 1);
  assert.equal(result.dischargeTimings.length, 1);
  assert.equal(result.dischargeTimings[0].edgeId, "E_FWD");
  assert.equal(result.dischargeTimings[0].sourcePhaseReceipt, "RCPT-P1");
  assert.equal(result.dischargeTimings[0].destinationPhaseReceipt, "RCPT-P2");
  assert.equal(result.dischargeTimings[0].recordedAtReceipt, "RCPT-P2");

  assert.deepEqual(result.gapStatusFinal, { G1: "CLOSED", G2: "CLOSED" });
  assert.equal(result.consumed.P2, "RCPT-P1");

  assert.equal(result.receiptsIssued, 0);
  assert.equal(result.signaturesProduced, 0);
  assert.equal(result.humanDecisionsClosed, 0);
});

test("refuses an unsupported semantics value with no phase reachability claim", () => {
  const model = buildModel();
  const result = simulateExecution(model, { semantics: "UNSUPPORTED_READING" });

  assert.deepEqual(result.reachedPhaseReceipts, []);
  assert.deepEqual(result.blockedPhases, ["P1", "P2"]);
  assert.equal(result.deadlocked, true);
  assert.ok(result.violations.includes("SEMANTICS_UNSUPPORTED:UNSUPPORTED_READING"));
  assert.equal(result.receiptsIssued, 0);
});

test("defaults to P01_CLOSURE_SEMANTICS_V1 when no semantics option is given", () => {
  const model = buildModel();
  const result = simulateExecution(model);
  assert.equal(result.semantics, P01_CLOSURE_SEMANTICS_V1);
  assert.deepEqual(result.blockedPhases, []);
});

test("refuses an unknown obligation id without a reachability claim for that phase", () => {
  const model = buildModel();
  model.phases[0].closureEdgeIds = ["E_SELF", "E_MISSING"];
  const result = simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });

  assert.ok(result.violations.includes("UNKNOWN_OBLIGATION:P1:E_MISSING"));
  assert.ok(result.blockedPhases.includes("P1"));
  assert.ok(result.blockedPhases.includes("P2"));
});

test("refuses an off-phase classification (FORWARD_DEFERRED targeting its own phase)", () => {
  const model = buildModel();
  model.edges[1].destinationPhase = "P1";
  const result = simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });

  assert.ok(result.violations.includes("FORWARD_DEFERRED_ON_PHASE:E_FWD"));
  assert.ok(result.blockedPhases.includes("P1"));
});

test("refuses a FORWARD_DEFERRED edge whose destination ordinal is not later (backward-mislabeled-forward)", () => {
  const model = {
    phases: [
      { id: "P1", ordinal: 1, predecessor: null, receiptId: "RCPT-P1", closureEdgeIds: [] },
      { id: "P2", ordinal: 2, predecessor: "P1", receiptId: "RCPT-P2", closureEdgeIds: ["E_BACK"] },
    ],
    edges: [
      {
        edgeId: "E_BACK",
        sourceGap: "G4",
        destinationGap: "G5",
        sourcePhase: "P2",
        destinationPhase: "P1",
        classification: "FORWARD_DEFERRED",
        expectedDestinationReceipt: "RCPT-P1",
      },
    ],
  };
  const result = simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });

  assert.ok(result.violations.includes("FORWARD_DEFERRED_BACKWARD:E_BACK"));
  assert.ok(result.blockedPhases.includes("P2"));
});

test("never mutates the input model", () => {
  const model = buildModel();
  const frozen = JSON.parse(JSON.stringify(model));
  simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });
  assert.deepEqual(model, frozen);
});
