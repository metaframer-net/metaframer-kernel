import test from "node:test";
import assert from "node:assert/strict";

import {
  legacyClosureBinding,
  analyzeClosureGraph,
} from "../tools/check-p01-closure-semantics.mjs";

// Compact synthetic two-phase chain: P1 (ordinal 1) -> P2 (ordinal 2).
const PHASES = [
  { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E1"], closureEdgeCount: 1 },
  { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: ["E2"], closureEdgeCount: 1 },
];

const GAP_PHASE = { G1: "P1", G2: "P1", G3: "P2" };

function edge(overrides) {
  return {
    edgeId: "E1",
    sourceGap: "G1",
    sourcePhase: "P1",
    destinationGap: "G2",
    destinationPhase: "P1",
    classification: "INTRA_ATOMIC",
    expectedDestinationReceipt: "RCPT-P1",
    owningPhase: "P1",
    ...overrides,
  };
}

const VALID_EDGES = [
  edge({ edgeId: "E1" }),
  edge({
    edgeId: "E2",
    sourceGap: "G2",
    sourcePhase: "P1",
    destinationGap: "G3",
    destinationPhase: "P2",
    classification: "FORWARD_DEFERRED",
    expectedDestinationReceipt: "RCPT-P2",
  }),
];

const VALID_PHASES = [
  { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E1", "E2"], closureEdgeCount: 2 },
  { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: [], closureEdgeCount: 0 },
];

test("legacyClosureBinding accepts a source-only-matching enumeration with no omissions/extras", () => {
  const result = legacyClosureBinding(VALID_PHASES, VALID_EDGES, GAP_PHASE);
  assert.deepEqual(result.omissions, []);
  assert.deepEqual(result.extras, []);
  assert.deepEqual(result.countMismatch, []);
  assert.equal(result.violations.length, 0);
});

test("legacyClosureBinding stays blind to a rewritten unknown destination gap", () => {
  const rewritten = [
    { ...VALID_EDGES[0] },
    { ...VALID_EDGES[1], destinationGap: "G_DOES_NOT_EXIST" },
  ];
  const result = legacyClosureBinding(VALID_PHASES, rewritten, GAP_PHASE);
  assert.equal(result.violations.length, 0);
});

test("analyzeClosureGraph refuses the same rewritten unknown destination", () => {
  const rewritten = [
    { ...VALID_EDGES[0] },
    { ...VALID_EDGES[1], destinationGap: "G_DOES_NOT_EXIST" },
  ];
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: rewritten,
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("DESTINATION_GAP_UNKNOWN:E2:")));
});

test("analyzeClosureGraph accepts the valid two-edge chain with correct counts", () => {
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: VALID_EDGES,
    gapPhase: GAP_PHASE,
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.counts, {
    totalEdges: 2,
    intraAtomic: 1,
    forwardDeferred: 1,
    backward: 0,
    duplicate: 0,
    missing: 0,
    extra: 0,
  });
});

test("analyzeClosureGraph derives INTRA_ATOMIC/FORWARD_DEFERRED from ordinals, never accepts backward", () => {
  const backwardEdge = edge({
    edgeId: "E3",
    sourceGap: "G3",
    sourcePhase: "P2",
    destinationGap: "G1",
    destinationPhase: "P1",
    classification: "INTRA_ATOMIC",
    expectedDestinationReceipt: "RCPT-P1",
  });
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: [backwardEdge],
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("BACKWARD_EDGE:E3:P2->P1")));
  assert.equal(result.counts.backward, 1);
});

test("analyzeClosureGraph refuses an asserted classification mismatch", () => {
  const mismatched = edge({
    edgeId: "E2",
    sourceGap: "G2",
    sourcePhase: "P1",
    destinationGap: "G3",
    destinationPhase: "P2",
    classification: "INTRA_ATOMIC",
    expectedDestinationReceipt: "RCPT-P2",
  });
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: [VALID_EDGES[0], mismatched],
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("CLASSIFICATION_MISMATCH:E2:")));
});

test("analyzeClosureGraph refuses a destination receipt mismatch", () => {
  const badReceipt = edge({
    edgeId: "E2",
    sourceGap: "G2",
    sourcePhase: "P1",
    destinationGap: "G3",
    destinationPhase: "P2",
    classification: "FORWARD_DEFERRED",
    expectedDestinationReceipt: "RCPT-WRONG",
  });
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: [VALID_EDGES[0], badReceipt],
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("EXPECTED_RECEIPT_MISMATCH:E2:")));
});

test("analyzeClosureGraph refuses an ownership mistake", () => {
  const badOwner = edge({ owningPhase: "P2" });
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: [badOwner, VALID_EDGES[1]],
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("OWNING_PHASE_MISMATCH:E1:")));
});

test("analyzeClosureGraph refuses a duplicate edge id", () => {
  const result = analyzeClosureGraph({
    phases: VALID_PHASES,
    edges: [VALID_EDGES[0], { ...VALID_EDGES[0] }],
    gapPhase: GAP_PHASE,
  });
  assert.ok(result.violations.some((v) => v.startsWith("DUPLICATE_EDGE:E1")));
  assert.equal(result.counts.duplicate, 1);
});

test("analyzeClosureGraph refuses a missing enumeration", () => {
  const phasesMissingE1 = [
    { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: [], closureEdgeCount: 0 },
    { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: ["E2"], closureEdgeCount: 1 },
  ];
  const result = analyzeClosureGraph({ phases: phasesMissingE1, edges: VALID_EDGES, gapPhase: GAP_PHASE });
  assert.ok(result.violations.some((v) => v.startsWith("MISSING_EDGE:E1")));
});

test("analyzeClosureGraph refuses an ownership mistake in enumeration placement", () => {
  const phasesMisplaced = [
    { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E2"], closureEdgeCount: 1 },
    { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: ["E1"], closureEdgeCount: 1 },
  ];
  const result = analyzeClosureGraph({ phases: phasesMisplaced, edges: VALID_EDGES, gapPhase: GAP_PHASE });
  assert.ok(result.violations.some((v) => v.startsWith("OWNERSHIP_MISPLACED:P2:E1:")));
});

test("analyzeClosureGraph refuses an extra edge id not present in the accepted set", () => {
  const phasesWithExtra = [
    { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E1", "E2", "E_GHOST"], closureEdgeCount: 3 },
    { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: [], closureEdgeCount: 0 },
  ];
  const result = analyzeClosureGraph({ phases: phasesWithExtra, edges: VALID_EDGES, gapPhase: GAP_PHASE });
  assert.ok(result.violations.some((v) => v.startsWith("EXTRA_EDGE:P1:E_GHOST")));
});

test("analyzeClosureGraph refuses a duplicated accepted edge id inside phase enumeration", () => {
  const phasesDuplicateEnum = [
    { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E1", "E1"], closureEdgeCount: 2 },
    { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: ["E2"], closureEdgeCount: 1 },
  ];
  const result = analyzeClosureGraph({ phases: phasesDuplicateEnum, edges: VALID_EDGES, gapPhase: GAP_PHASE });
  assert.ok(result.violations.some((v) => v.startsWith("ENUMERATION_DUPLICATE:3!=2")));
});

test("analyzeClosureGraph refuses a declared phase edge count mismatch", () => {
  const phasesBadCount = [
    { id: "P1", ordinal: 1, receiptId: "RCPT-P1", closureEdgeIds: ["E1", "E2"], closureEdgeCount: 5 },
    { id: "P2", ordinal: 2, receiptId: "RCPT-P2", closureEdgeIds: [], closureEdgeCount: 0 },
  ];
  const result = analyzeClosureGraph({ phases: phasesBadCount, edges: VALID_EDGES, gapPhase: GAP_PHASE });
  assert.ok(result.violations.some((v) => v.startsWith("PHASE_COUNT_MISMATCH:P1:5!=2")));
});
