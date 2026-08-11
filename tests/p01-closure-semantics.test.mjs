import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerUrl = pathToFileURL(path.join(root, "tools", "check-p01-closure-semantics.mjs")).href;
const checker = await import(checkerUrl);

// =====================================================================================
// P01 closure semantics — the RED specification for an executable phase chain
//
// The immutable P00 package accepted 53 CLOSURE edges and bound each one to the phase of its
// source gap. Every one of those 53 destinations sits in the same phase as its source or in a
// later one; not one points backwards. Beside them, every phase's exit contract carries the
// sentence
//
//     "This phase may not produce its exit receipt while any listed obligation is unsatisfied."
//
// and every obligation reads "<source> cannot reach CLOSED until <destination> publishes its
// phase receipt". Read literally and together, those two sentences make a phase's exit receipt
// wait on receipts that can only be issued after it. P02 and everything after it refuse entry
// without the predecessor receipt and `noSkip` is true, so the whole chain stops at P00.
//
// That is the defect this package corrects, and it corrects it forward-only. Nothing in P00 is
// rewritten: RCPT-00, its evidence and its hashes stay exactly as issued. What changes is the
// execution reading, and only that:
//
//   PHASE RECEIPT      is produced when the phase's own outputs, gates, review and human
//                      decisions are satisfied, and is what a successor consumes.
//   GAP FINAL CLOSURE  is a separate fact. A CLOSURE edge blocks the source gap reaching CLOSED.
//                      It never blocks the source phase receipt on the ground that a forward
//                      destination receipt does not exist yet.
//
//   INTRA_ATOMIC       sourcePhase == destinationPhase. Discharged inside the one phase receipt
//                      that carries both sides.
//   FORWARD_DEFERRED   destination in a later phase. Recorded in the source phase receipt as an
//                      append-only open debt; the source gap stays CLOSURE_PENDING and may not
//                      be reported CLOSED. A separate append-only CLOSURE_DISCHARGE receipt
//                      binds the two receipt hashes when the destination receipt is published.
//                      The source phase receipt is never rewritten.
//
// Two assertions in this file are behavioural characterizations of the defect rather than of the
// fix, and they are meant to keep passing forever:
//
//   - `HISTORICAL_LITERAL` really does stall the chain at RCPT-00 (section 2);
//   - the P00 routine `analyzeClosureBinding` really is blind to a destination that does not
//     exist, because it reads `src` and never reads `dst` (section 1).
//
// They are the evidence, so they are executed rather than asserted in prose. Everything else in
// this file is the corrected contract, and every one of those assertions was RED before the
// corrected semantics existed.
//
// Nothing here issues a receipt, signs anything, answers a human decision or closes a gap. The
// simulation proves that a receipt is *reachable* under stated assumptions; a reachable receipt
// is not an issued one. Human and external gates are modelled as satisfiable but never
// auto-closed, which is why this file can say "the chain can run" without saying "the chain ran".
// =====================================================================================

const HISTORICAL_LITERAL = "HISTORICAL_LITERAL";
const P01_SEMANTICS = "P01_CLOSURE_SEMANTICS_V1";

function readJson(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return null;
  return JSON.parse(readFileSync(absolute, "utf8"));
}

const addendum = readJson("planning/p01-closure-semantics-addendum.json");
const dischargeSchema = readJson("planning/p01-closure-discharge.schema.json");

/** A 64-hex stand-in. Receipt hashes are shape-checked here, never invented as real digests. */
const digest = (seed) => seed.padEnd(64, "0").slice(0, 64).toLowerCase().replaceAll(/[^0-9a-f]/g, "0");

// -------------------------------------------------------------------------------------
// The frozen sub-model: P00..P05 carrying only the five real P01 obligations.
//
// Deliberately the most favourable sub-chain that can be built out of the real data. The five
// edges are the genuine P01 rows of 08-DEPENDENCY-OVERLAY.tsv with their genuine destinations
// and destination phases; every other phase in the window is handed a closure load of zero,
// which is strictly kinder than the real chain, where P02 alone carries twelve. If even this
// model cannot advance under the literal reading, the real one cannot either.
// -------------------------------------------------------------------------------------

const SUBMODEL_PHASES = [
  { id: "P00", ordinal: 0, receiptId: "RCPT-00", predecessor: null, successor: "P01", predecessorReceiptId: null, closureEdgeIds: [] },
  { id: "P01", ordinal: 1, receiptId: "RCPT-01", predecessor: "P00", successor: "P02", predecessorReceiptId: "RCPT-00", closureEdgeIds: ["E-002", "E-003", "E-005", "E-152", "E-153"] },
  { id: "P02", ordinal: 2, receiptId: "RCPT-02", predecessor: "P01", successor: "P03", predecessorReceiptId: "RCPT-01", closureEdgeIds: [] },
  { id: "P03", ordinal: 3, receiptId: "RCPT-03", predecessor: "P02", successor: "P04", predecessorReceiptId: "RCPT-02", closureEdgeIds: [] },
  { id: "P04", ordinal: 4, receiptId: "RCPT-04", predecessor: "P03", successor: "P05", predecessorReceiptId: "RCPT-03", closureEdgeIds: [] },
  { id: "P05", ordinal: 5, receiptId: "RCPT-05", predecessor: "P04", successor: null, predecessorReceiptId: "RCPT-04", closureEdgeIds: [] },
];

const SUBMODEL_EDGES = [
  { edgeId: "E-002", sourceGap: "KG-002", destinationGap: "KG-004", sourcePhase: "P01", destinationPhase: "P01", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-01" },
  { edgeId: "E-003", sourceGap: "KG-003", destinationGap: "KG-002", sourcePhase: "P01", destinationPhase: "P01", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-01" },
  { edgeId: "E-005", sourceGap: "KG-004", destinationGap: "KG-023", sourcePhase: "P01", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-152", sourceGap: "KG-084", destinationGap: "KG-019", sourcePhase: "P01", destinationPhase: "P02", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-02" },
  { edgeId: "E-153", sourceGap: "KG-084", destinationGap: "KG-050", sourcePhase: "P01", destinationPhase: "P05", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-05" },
];

const SUBMODEL_GAP_PHASE = {
  "KG-002": "P01",
  "KG-003": "P01",
  "KG-004": "P01",
  "KG-019": "P02",
  "KG-023": "P03",
  "KG-050": "P05",
  "KG-084": "P01",
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const subModel = () => ({
  phases: clone(SUBMODEL_PHASES),
  edges: clone(SUBMODEL_EDGES),
  gapPhase: clone(SUBMODEL_GAP_PHASE),
});

const codes = (violations) => violations.map((violation) => violation.split(":")[0]);

// -------------------------------------------------------------------------------------
// 1. The P00 routine, ported faithfully, and what it cannot see
//
// `legacyClosureBinding` is a behaviour-faithful port of `analyzeClosureBinding` from
// reports/p00-treaty-correction/validate-p00-treaty-correction-final.mjs. It exists here for one
// reason: to be run side by side with the graph check, on the same mutated input, so the blind
// spot is demonstrated rather than described.
// -------------------------------------------------------------------------------------

test("legacy binding: the real, unmutated sub-model produces no violation", () => {
  const model = subModel();
  const result = checker.legacyClosureBinding(model.phases, model.edges, model.gapPhase);
  assert.deepEqual(result.violations, []);
  assert.equal(result.reachable, 5);
});

test("legacy binding is blind to a destination that does not exist — it reads src and never dst", () => {
  const model = subModel();
  for (const edge of model.edges) edge.destinationGap = "KG-999-NONEXISTENT-FUTURE-NODE";

  const result = checker.legacyClosureBinding(model.phases, model.edges, model.gapPhase);
  assert.deepEqual(
    result.violations,
    [],
    "the P00 routine still reports a clean binding after every destination was rewritten to a node that does not exist",
  );
  assert.equal(result.reachable, 5);
});

test("the graph check refuses the same mutation the legacy routine passed", () => {
  const model = subModel();
  for (const edge of model.edges) edge.destinationGap = "KG-999-NONEXISTENT-FUTURE-NODE";

  const findings = checker.analyzeClosureGraph(model).violations;
  assert.equal(findings.length, 5);
  assert.deepEqual([...new Set(codes(findings))], ["DESTINATION_GAP_UNKNOWN"]);
  for (const edge of SUBMODEL_EDGES) {
    assert.ok(
      findings.some((finding) => finding.includes(edge.edgeId)),
      `${edge.edgeId} must be named in the refusal`,
    );
  }
});

test("the graph check counts what the legacy routine counted, and keeps counting it", () => {
  const model = subModel();
  const legacy = checker.legacyClosureBinding(model.phases, model.edges, model.gapPhase);
  const graph = checker.analyzeClosureGraph(model);
  assert.deepEqual(graph.violations, []);
  assert.equal(graph.counts.totalEdges, legacy.reachable);
  assert.equal(graph.counts.duplicate, 0);
  assert.equal(graph.counts.missing, 0);
  assert.equal(graph.counts.extra, 0);
});

// -------------------------------------------------------------------------------------
// 2. The historical literal semantics, executed
//
// The stall is not an opinion about wording. It is a fixed point of a state machine over the
// real edges, and this is what it computes.
// -------------------------------------------------------------------------------------

test("historical literal semantics: the chain stops at RCPT-00 and P01 never exits", () => {
  const run = checker.simulateExecution(subModel(), { semantics: HISTORICAL_LITERAL });

  assert.deepEqual(run.reachedPhaseReceipts, ["RCPT-00"]);
  assert.deepEqual(run.blockedPhases, ["P01", "P02", "P03", "P04", "P05"]);
  assert.equal(run.deadlocked, true);
});

test("historical literal semantics: P01 is blocked by all five of its own obligations", () => {
  const run = checker.simulateExecution(subModel(), { semantics: HISTORICAL_LITERAL });
  assert.deepEqual(run.blockedBy["P01"], ["E-002", "E-003", "E-005", "E-152", "E-153"]);
});

test("historical literal semantics: the two intra-phase edges are self-cycles", () => {
  const run = checker.simulateExecution(subModel(), { semantics: HISTORICAL_LITERAL });
  assert.deepEqual(
    run.selfCycles,
    ["E-002", "E-003"],
    "an obligation whose destination phase is its own phase waits on the receipt it is blocking",
  );
});

test("historical literal semantics: P02 is never admitted, so no-skip is not the thing that broke", () => {
  const run = checker.simulateExecution(subModel(), { semantics: HISTORICAL_LITERAL });
  assert.equal(run.reachedPhaseReceipts.includes("RCPT-01"), false);
  assert.equal(run.admitted.includes("P02"), false);
  assert.deepEqual(run.violations, []);
});

// -------------------------------------------------------------------------------------
// 3. The corrected semantics on exactly the same sub-model
// -------------------------------------------------------------------------------------

test("corrected semantics: every phase receipt in the window becomes reachable, in chain order", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  assert.deepEqual(run.reachedPhaseReceipts, [
    "RCPT-00",
    "RCPT-01",
    "RCPT-02",
    "RCPT-03",
    "RCPT-04",
    "RCPT-05",
  ]);
  assert.equal(run.deadlocked, false);
  assert.deepEqual(run.blockedPhases, []);
  assert.deepEqual(run.violations, []);
});

test("corrected semantics: the two intra-phase edges discharge inside RCPT-01 itself", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  const intra = run.discharges.filter((entry) => entry.classification === "INTRA_ATOMIC");
  assert.deepEqual(
    intra.map((entry) => entry.edgeId),
    ["E-002", "E-003"],
  );
  for (const entry of intra) {
    assert.equal(entry.sourcePhaseReceipt, "RCPT-01");
    assert.equal(entry.destinationPhaseReceipt, "RCPT-01");
    assert.equal(entry.atomic, true);
  }
});

test("corrected semantics: the three forward edges are open debts at the moment RCPT-01 is reachable", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  const recorded = run.debtsRecordedAt["RCPT-01"];
  assert.deepEqual(
    recorded.map((debt) => debt.edgeId),
    ["E-005", "E-152", "E-153"],
  );
  assert.deepEqual(recorded.find((debt) => debt.edgeId === "E-005"), {
    edgeId: "E-005",
    sourceGap: "KG-004",
    destinationGap: "KG-023",
    destinationPhase: "P03",
    expectedDestinationReceipt: "RCPT-03",
  });
});

test("corrected semantics: a gap with an open forward debt is CLOSURE_PENDING, never CLOSED", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  const atIssue = run.gapStatusAt["RCPT-01"];
  assert.equal(atIssue["KG-004"], "CLOSURE_PENDING");
  assert.equal(atIssue["KG-084"], "CLOSURE_PENDING");
  assert.equal(atIssue["KG-002"], "CLOSED");
  assert.equal(atIssue["KG-003"], "CLOSED");
});

test("corrected semantics: no discharge is ever recorded before its destination receipt", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  const at = new Map(run.reachedPhaseReceipts.map((receipt, index) => [receipt, index]));
  for (const entry of run.discharges) {
    assert.ok(
      at.get(entry.destinationPhaseReceipt) <= at.get(entry.recordedAtReceipt),
      `${entry.edgeId} was discharged at ${entry.recordedAtReceipt}, before ${entry.destinationPhaseReceipt} existed`,
    );
  }
});

test("corrected semantics: every forward debt is eventually discharged and none is dropped", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  assert.deepEqual(run.openDebts, []);
  assert.deepEqual(
    run.discharges.map((entry) => entry.edgeId).sort(),
    ["E-002", "E-003", "E-005", "E-152", "E-153"],
  );
  assert.equal(run.gapStatusFinal["KG-084"], "CLOSED");
});

test("corrected semantics: a successor consumes only its declared predecessor receipt", () => {
  const run = checker.simulateExecution(subModel(), { semantics: P01_SEMANTICS });
  assert.deepEqual(run.consumed, {
    P01: "RCPT-00",
    P02: "RCPT-01",
    P03: "RCPT-02",
    P04: "RCPT-03",
    P05: "RCPT-04",
  });
});

// -------------------------------------------------------------------------------------
// 4. The addendum: all 53 accepted edges, classified exactly once
// -------------------------------------------------------------------------------------

test("the addendum exists and is the canonical successor execution contract", () => {
  assert.notEqual(addendum, null, "planning/p01-closure-semantics-addendum.json must exist");
  assert.equal(addendum.canonicalOwner, "planning/p01-closure-semantics-addendum.json");
  assert.equal(addendum.packageMode, "additive-forward-only-successor");
  assert.equal(
    addendum.dependencySourceOfTruth,
    "reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv",
    "the addendum must not declare itself the dependency source of truth",
  );
});

test("the addendum classifies exactly the 53 accepted CLOSURE edges", () => {
  const { counts, edges } = addendum.closureEdgeProjection;
  assert.equal(edges.length, 53);
  assert.equal(counts.totalEdges, 53);
  assert.equal(counts.intraAtomic, 23);
  assert.equal(counts.forwardDeferred, 30);
  assert.equal(counts.backward, 0);
  assert.equal(counts.duplicate, 0);
  assert.equal(counts.missing, 0);
  assert.equal(counts.extra, 0);
  assert.equal(new Set(edges.map((edge) => edge.edgeId)).size, 53);
});

test("every addendum edge carries the exact edgeId shape and a complete classification record", () => {
  for (const edge of addendum.closureEdgeProjection.edges) {
    assert.match(edge.edgeId, /^E-\d{3}$/);
    assert.match(edge.sourceGap, /^KG-\d{3}$/);
    assert.match(edge.destinationGap, /^KG-\d{3}$/);
    assert.match(edge.sourcePhase, /^P(?:0\d|1[0-2])$/);
    assert.match(edge.destinationPhase, /^P(?:0\d|1[0-2])$/);
    assert.match(edge.expectedDestinationReceipt, /^RCPT-(?:0\d|1[0-2])$/);
    assert.ok(["INTRA_ATOMIC", "FORWARD_DEFERRED"].includes(edge.classification));
    assert.equal(typeof edge.historicalObligationText, "string");
    assert.notEqual(edge.historicalObligationText, "");
  }
});

test("the graph check accepts the full addendum model with no violation", () => {
  const model = checker.modelFromAddendum(addendum);
  const result = checker.analyzeClosureGraph(model);
  assert.deepEqual(result.violations, []);
  assert.equal(result.counts.totalEdges, 53);
});

test("every destination gap exists and its phase agrees with the ownership overlay projection", () => {
  const { gapPhase } = addendum.gapRegistryProjection;
  assert.equal(Object.keys(gapPhase).length, 90);
  for (const edge of addendum.closureEdgeProjection.edges) {
    assert.equal(gapPhase[edge.destinationGap], edge.destinationPhase, `${edge.edgeId} destination phase`);
    assert.equal(gapPhase[edge.sourceGap], edge.sourcePhase, `${edge.edgeId} source phase`);
  }
});

test("both endpoints of every edge name a phase that exists in the chain", () => {
  const known = new Set(addendum.phaseChainProjection.phases.map((phase) => phase.id));
  assert.equal(known.size, 13);
  for (const edge of addendum.closureEdgeProjection.edges) {
    assert.ok(known.has(edge.sourcePhase), `${edge.edgeId} source phase`);
    assert.ok(known.has(edge.destinationPhase), `${edge.edgeId} destination phase`);
  }
});

test("INTRA_ATOMIC iff same phase, FORWARD_DEFERRED iff strictly later, and never backwards", () => {
  const ordinal = Object.fromEntries(
    addendum.phaseChainProjection.phases.map((phase) => [phase.id, phase.ordinal]),
  );
  for (const edge of addendum.closureEdgeProjection.edges) {
    const source = ordinal[edge.sourcePhase];
    const destination = ordinal[edge.destinationPhase];
    assert.ok(destination >= source, `${edge.edgeId} points backwards`);
    assert.equal(
      edge.classification,
      destination === source ? "INTRA_ATOMIC" : "FORWARD_DEFERRED",
      `${edge.edgeId} classification`,
    );
  }
});

test("expectedDestinationReceipt is the destination phase's own receipt, never a substitute", () => {
  const receiptOf = Object.fromEntries(
    addendum.phaseChainProjection.phases.map((phase) => [phase.id, phase.receiptId]),
  );
  for (const edge of addendum.closureEdgeProjection.edges) {
    assert.equal(edge.expectedDestinationReceipt, receiptOf[edge.destinationPhase], edge.edgeId);
  }
});

test("the per-phase enumeration is a partition: each edge owned once, by its source phase", () => {
  const perPhase = addendum.closureEdgeProjection.perPhaseEdgeIds;
  const enumerated = Object.values(perPhase).flat();
  assert.equal(enumerated.length, 53);
  assert.equal(new Set(enumerated).size, 53);
  for (const [phaseId, edgeIds] of Object.entries(perPhase)) {
    for (const edgeId of edgeIds) {
      const edge = addendum.closureEdgeProjection.edges.find((candidate) => candidate.edgeId === edgeId);
      assert.equal(edge.sourcePhase, phaseId, `${edgeId} is owned by its source phase`);
      assert.equal(edge.owningPhase, phaseId, `${edgeId} owningPhase`);
    }
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(perPhase).map(([phaseId, ids]) => [phaseId, ids.length])),
    { P00: 0, P01: 5, P02: 12, P03: 5, P04: 17, P05: 4, P06: 4, P07: 1, P08: 2, P09: 1, P10: 1, P11: 1, P12: 0 },
    "the per-phase counts must still be the ones P00 accepted",
  );
});

// -------------------------------------------------------------------------------------
// 5. The whole chain, simulated
// -------------------------------------------------------------------------------------

test("the real 53-edge chain deadlocks under the historical literal reading", () => {
  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: HISTORICAL_LITERAL,
  });
  assert.deepEqual(run.reachedPhaseReceipts, ["RCPT-00"]);
  assert.equal(run.deadlocked, true);
  assert.equal(run.blockedPhases.length, 12);
});

test("the real 53-edge chain reaches RCPT-01..RCPT-12 in order under the corrected semantics", () => {
  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: P01_SEMANTICS,
  });
  assert.deepEqual(run.reachedPhaseReceipts, [
    "RCPT-00", "RCPT-01", "RCPT-02", "RCPT-03", "RCPT-04", "RCPT-05", "RCPT-06",
    "RCPT-07", "RCPT-08", "RCPT-09", "RCPT-10", "RCPT-11", "RCPT-12",
  ]);
  assert.equal(run.deadlocked, false);
  assert.deepEqual(run.violations, []);
});

test("all 53 obligations discharge, 23 atomically and 30 through a later destination receipt", () => {
  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: P01_SEMANTICS,
  });
  assert.equal(run.discharges.length, 53);
  assert.equal(run.discharges.filter((entry) => entry.classification === "INTRA_ATOMIC").length, 23);
  assert.equal(run.discharges.filter((entry) => entry.classification === "FORWARD_DEFERRED").length, 30);
  assert.deepEqual(run.openDebts, []);
});

test("the simulation never reports a gap CLOSED while one of its obligations is open", () => {
  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: P01_SEMANTICS,
  });
  const owed = new Map();
  for (const edge of addendum.closureEdgeProjection.edges) {
    owed.set(edge.sourceGap, (owed.get(edge.sourceGap) ?? 0) + 1);
  }
  for (const [receipt, statuses] of Object.entries(run.gapStatusAt)) {
    const discharged = new Set(
      run.discharges
        .filter((entry) => run.reachedPhaseReceipts.indexOf(entry.recordedAtReceipt) <= run.reachedPhaseReceipts.indexOf(receipt))
        .map((entry) => entry.edgeId),
    );
    for (const [gap, status] of Object.entries(statuses)) {
      if (status !== "CLOSED") continue;
      const open = addendum.closureEdgeProjection.edges.filter(
        (edge) => edge.sourceGap === gap && !discharged.has(edge.edgeId),
      );
      assert.deepEqual(open, [], `${gap} was reported CLOSED at ${receipt} with open obligations`);
    }
  }
  assert.ok(owed.size > 0);
});

test("the simulation issues nothing: it is a reachability proof, not an execution", () => {
  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: P01_SEMANTICS,
  });
  assert.equal(run.receiptsIssued, 0);
  assert.equal(run.signaturesProduced, 0);
  assert.equal(run.humanDecisionsClosed, 0);
  assert.equal(run.gatePolicy, "SATISFIABLE_BUT_NOT_AUTO_CLOSED");
});

// -------------------------------------------------------------------------------------
// 6. Negative fixtures. Each one is a way the corrected contract could be faked.
// -------------------------------------------------------------------------------------

test("negative: a destination gap that does not exist is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  model.edges[0].destinationGap = "KG-999";
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.deepEqual(codes(findings), ["DESTINATION_GAP_UNKNOWN"]);
});

test("negative: a destination phase that disagrees with the ownership overlay is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  const victim = model.edges.find((edge) => edge.classification === "FORWARD_DEFERRED");
  victim.destinationPhase = "P12";
  victim.expectedDestinationReceipt = "RCPT-12";
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding.startsWith("DESTINATION_PHASE_MISMATCH")));
  assert.ok(findings.every((finding) => finding.includes(victim.edgeId)));
});

test("negative: a backward closure edge is refused rather than reclassified", () => {
  const model = checker.modelFromAddendum(addendum);
  const victim = model.edges.find((edge) => edge.sourcePhase === "P04");
  victim.destinationGap = "KG-002";
  victim.destinationPhase = "P01";
  victim.expectedDestinationReceipt = "RCPT-01";
  victim.classification = "FORWARD_DEFERRED";
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding.startsWith("BACKWARD_EDGE")));
});

test("negative: a duplicated edge id is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  model.edges.push(clone(model.edges[0]));
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding.startsWith("DUPLICATE_EDGE")));
});

// The two directions of the same partition, which are different defects and must not be
// reported as one. An accepted edge nobody owes is a hole in the obligation set; a phase owing
// an edge the accepted set does not contain is a claim about a row that is not there.

test("negative: an accepted edge that no phase enumerates is refused as missing", () => {
  const model = checker.modelFromAddendum(addendum);
  const phase = model.phases.find((candidate) => candidate.id === "P04");
  const [dropped] = phase.closureEdgeIds.splice(3, 1);
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding === `MISSING_EDGE:${dropped}`));
  assert.ok(findings.some((finding) => finding.startsWith("PHASE_COUNT_MISMATCH:P04")));
  assert.ok(findings.some((finding) => finding.startsWith("EDGE_COUNT")));
});

test("negative: an edge dropped from the accepted set is refused as extra, not silently dropped", () => {
  const model = checker.modelFromAddendum(addendum);
  const [dropped] = model.edges.splice(7, 1);
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding === `EXTRA_EDGE:${dropped.sourcePhase}:${dropped.edgeId}`));
  assert.ok(findings.some((finding) => finding.startsWith("EDGE_COUNT")));
  assert.equal(checker.analyzeClosureGraph(model).counts.extra, 1);
});

test("negative: an edge enumerated by a phase but absent from the accepted set is refused as extra", () => {
  const model = checker.modelFromAddendum(addendum);
  model.phases.find((phase) => phase.id === "P07").closureEdgeIds.push("E-999");
  const findings = checker.analyzeClosureGraph(model).violations;
  assert.ok(findings.some((finding) => finding === "EXTRA_EDGE:P07:E-999"));
});

test("negative: a successor that skips its predecessor receipt is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  const p02 = model.phases.find((phase) => phase.id === "P02");
  p02.predecessor = "P00";
  p02.predecessorReceiptId = "RCPT-00";
  const findings = checker.analyzeChainIntegrity(model);
  assert.ok(findings.some((finding) => finding.startsWith("SUCCESSOR_SKIP:P02")));
});

test("negative: a chain whose predecessor receipt id does not match its predecessor phase is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  model.phases.find((phase) => phase.id === "P05").predecessorReceiptId = "RCPT-02";
  const findings = checker.analyzeChainIntegrity(model);
  assert.ok(findings.some((finding) => finding.startsWith("PREDECESSOR_RECEIPT_MISMATCH:P05")));
});

// A discharge receipt and the state it is judged against. E-005 is real: KG-004 in P01 owes
// KG-023 in P03, so the discharge may only exist once RCPT-03 does.
const dischargeState = () => ({
  issuedReceipts: { "RCPT-00": digest("a0"), "RCPT-01": digest("a1"), "RCPT-02": digest("a2"), "RCPT-03": digest("a3") },
  dischargedEdgeIds: [],
});

const dischargeDocument = () => ({
  receiptKind: "CLOSURE_DISCHARGE",
  dischargeId: "DSCH-E-005",
  edgeId: "E-005",
  classification: "FORWARD_DEFERRED",
  sourceGap: "KG-004",
  destinationGap: "KG-023",
  sourcePhase: "P01",
  destinationPhase: "P03",
  sourcePhaseReceiptId: "RCPT-01",
  sourcePhaseReceiptHash: digest("a1"),
  destinationPhaseReceiptId: "RCPT-03",
  destinationPhaseReceiptHash: digest("a3"),
  appendOnly: true,
  sourceReceiptRewritten: false,
  gapStatusAfter: "CLOSURE_PENDING",
  capabilityDelta: "NONE",
  readinessFlagMutation: { mutatesAnyFlag: false },
  writerId: "c37169b1-89e6-4bd4-b719-1785b595dcf7",
  reviewerId: "2495e19c-719d-48d8-88e8-2df10bd99e63",
  createdAtSource: { source: "phase-execution", value: "2026-08-11" },
});

test("a well-formed discharge receipt for a real edge is accepted", () => {
  const findings = checker.validateDischargeReceipt(
    dischargeDocument(),
    checker.modelFromAddendum(addendum),
    dischargeState(),
  );
  assert.deepEqual(findings, []);
});

test("negative: a discharge claimed before the destination receipt exists is refused", () => {
  const state = dischargeState();
  delete state.issuedReceipts["RCPT-03"];
  const findings = checker.validateDischargeReceipt(
    dischargeDocument(),
    checker.modelFromAddendum(addendum),
    state,
  );
  assert.ok(findings.some((finding) => finding.startsWith("DESTINATION_RECEIPT_ABSENT")));
});

test("negative: a discharge whose destination receipt hash is a placeholder is refused", () => {
  const document = dischargeDocument();
  document.destinationPhaseReceiptHash = digest("ff");
  const findings = checker.validateDischargeReceipt(
    document,
    checker.modelFromAddendum(addendum),
    dischargeState(),
  );
  assert.ok(findings.some((finding) => finding.startsWith("DESTINATION_RECEIPT_HASH_MISMATCH")));
});

test("negative: declaring the gap CLOSED while another obligation of that gap is open is refused", () => {
  const model = checker.modelFromAddendum(addendum);
  const document = dischargeDocument();
  document.edgeId = "E-152";
  document.dischargeId = "DSCH-E-152";
  document.sourceGap = "KG-084";
  document.destinationGap = "KG-019";
  document.destinationPhase = "P02";
  document.destinationPhaseReceiptId = "RCPT-02";
  document.destinationPhaseReceiptHash = digest("a2");
  document.gapStatusAfter = "CLOSED";

  const findings = checker.validateDischargeReceipt(document, model, dischargeState());
  assert.ok(findings.some((finding) => finding.startsWith("CLOSED_WITH_PENDING_FORWARD:KG-084")));
  assert.ok(findings.some((finding) => finding.includes("E-153")));
});

test("the same gap may be declared CLOSED once its last obligation is the one being discharged", () => {
  const model = checker.modelFromAddendum(addendum);
  const state = dischargeState();
  state.dischargedEdgeIds = ["E-153"];
  const document = dischargeDocument();
  document.edgeId = "E-152";
  document.dischargeId = "DSCH-E-152";
  document.sourceGap = "KG-084";
  document.destinationGap = "KG-019";
  document.destinationPhase = "P02";
  document.destinationPhaseReceiptId = "RCPT-02";
  document.destinationPhaseReceiptHash = digest("a2");
  document.gapStatusAfter = "CLOSED";

  assert.deepEqual(checker.validateDischargeReceipt(document, model, state), []);
});

test("negative: a discharge that rewrites or contradicts its source receipt is refused", () => {
  const model = checker.modelFromAddendum(addendum);

  const rewritten = dischargeDocument();
  rewritten.sourceReceiptRewritten = true;
  assert.ok(
    checker
      .validateDischargeReceipt(rewritten, model, dischargeState())
      .some((finding) => finding.startsWith("SOURCE_RECEIPT_REWRITTEN")),
  );

  const drifted = dischargeDocument();
  drifted.sourcePhaseReceiptHash = digest("bd");
  assert.ok(
    checker
      .validateDischargeReceipt(drifted, model, dischargeState())
      .some((finding) => finding.startsWith("SOURCE_RECEIPT_HASH_MISMATCH")),
  );
});

test("negative: a discharge that is not append-only, or claims a capability, is refused", () => {
  const model = checker.modelFromAddendum(addendum);

  const mutable = dischargeDocument();
  mutable.appendOnly = false;
  assert.ok(
    checker
      .validateDischargeReceipt(mutable, model, dischargeState())
      .some((finding) => finding.startsWith("NOT_APPEND_ONLY")),
  );

  const claiming = dischargeDocument();
  claiming.capabilityDelta = "SDK";
  assert.ok(
    checker
      .validateDischargeReceipt(claiming, model, dischargeState())
      .some((finding) => finding.startsWith("CAPABILITY_DELTA")),
  );

  const moving = dischargeDocument();
  moving.readinessFlagMutation = { mutatesAnyFlag: true };
  assert.ok(
    checker
      .validateDischargeReceipt(moving, model, dischargeState())
      .some((finding) => finding.startsWith("READINESS_FLAG_MUTATION")),
  );
});

test("negative: a discharge for an edge nobody accepted is refused", () => {
  const document = dischargeDocument();
  document.edgeId = "E-999";
  document.dischargeId = "DSCH-E-999";
  const findings = checker.validateDischargeReceipt(
    document,
    checker.modelFromAddendum(addendum),
    dischargeState(),
  );
  assert.ok(findings.some((finding) => finding.startsWith("UNKNOWN_EDGE:E-999")));
});

test("negative: a writer reviewing its own discharge is refused", () => {
  const document = dischargeDocument();
  document.reviewerId = document.writerId;
  const findings = checker.validateDischargeReceipt(
    document,
    checker.modelFromAddendum(addendum),
    dischargeState(),
  );
  assert.ok(findings.some((finding) => finding.startsWith("SELF_REVIEW")));
});

// -------------------------------------------------------------------------------------
// 7. The discharge schema, and the fact that it fails closed
// -------------------------------------------------------------------------------------

test("the discharge schema exists and is a 2020-12 JSON Schema", () => {
  assert.notEqual(dischargeSchema, null, "planning/p01-closure-discharge.schema.json must exist");
  assert.equal(dischargeSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(dischargeSchema.type, "object");
});

test("the schema refuses unknown properties at every object level", () => {
  assert.deepEqual(checker.schemaViolations(dischargeSchema), []);
});

test("the schema pins the immutable linkage fields as required", () => {
  for (const field of [
    "receiptKind",
    "edgeId",
    "sourcePhaseReceiptId",
    "sourcePhaseReceiptHash",
    "destinationPhaseReceiptId",
    "destinationPhaseReceiptHash",
    "appendOnly",
    "sourceReceiptRewritten",
  ]) {
    assert.ok(dischargeSchema.required.includes(field), `${field} must be required`);
  }
});

test("the schema accepts a well-formed discharge receipt", () => {
  assert.deepEqual(checker.validateAgainstSchema(dischargeSchema, dischargeDocument()), []);
});

test("the schema refuses an unknown property rather than ignoring it", () => {
  const document = dischargeDocument();
  document.alsoClosesTheGap = true;
  const findings = checker.validateAgainstSchema(dischargeSchema, document);
  assert.deepEqual(findings, ["additionalProperties:/alsoClosesTheGap"]);
});

test("the schema refuses a hash that is not a lowercase sha256", () => {
  for (const bad of ["", "not-a-hash", digest("a1").toUpperCase(), `${digest("a1")}0`]) {
    const document = dischargeDocument();
    document.destinationPhaseReceiptHash = bad;
    const findings = checker.validateAgainstSchema(dischargeSchema, document);
    assert.ok(
      findings.some((finding) => finding.includes("/destinationPhaseReceiptHash")),
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("the schema refuses a discharge with its destination linkage removed", () => {
  for (const field of ["destinationPhaseReceiptId", "destinationPhaseReceiptHash"]) {
    const document = dischargeDocument();
    delete document[field];
    assert.deepEqual(checker.validateAgainstSchema(dischargeSchema, document), [`required:/${field}`]);
  }
});

test("the schema refuses a discharge that declares itself rewritable", () => {
  const mutable = dischargeDocument();
  mutable.appendOnly = false;
  assert.deepEqual(checker.validateAgainstSchema(dischargeSchema, mutable), ["const:/appendOnly"]);

  const rewritten = dischargeDocument();
  rewritten.sourceReceiptRewritten = true;
  assert.deepEqual(checker.validateAgainstSchema(dischargeSchema, rewritten), [
    "const:/sourceReceiptRewritten",
  ]);
});

test("the schema refuses a receipt kind that is not a closure discharge", () => {
  const document = dischargeDocument();
  document.receiptKind = "PHASE_RECEIPT";
  assert.deepEqual(checker.validateAgainstSchema(dischargeSchema, document), ["const:/receiptKind"]);
});

// -------------------------------------------------------------------------------------
// 8. What this package pins, and what it refuses to claim
// -------------------------------------------------------------------------------------

test("the addendum pins the P00 sources by exact hash", () => {
  const pinned = Object.fromEntries(addendum.sourcePins.files.map((file) => [file.path, file.sha256]));
  assert.equal(
    pinned["reports/p00-treaty-correction/RCPT-00.json"],
    "2dbee1e439357b2848915c87739e1f8b704ffbfe9915f8bf77809c92e67ff473",
  );
  assert.equal(
    pinned["reports/p00-treaty-correction/07-OWNERSHIP-OVERLAY.tsv"],
    "5a4ecba5b4cff30e10165a5dcc082b862f288475fdd19a7cb317ed31fdd63e0a",
  );
  assert.equal(
    pinned["reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv"],
    "482bdba5c54f1f08fb89821c86991d7b86b23f65c6815d7b601d5ac81f8d3a30",
  );
  assert.equal(
    pinned["reports/kernel-development-roadmap/00-PHASE-CHAIN.json"],
    "7794df62ef49829f134f742172eb2e6ed32cbc68a140a1ce5f70bdd4c23176c9",
  );
  assert.equal(
    pinned["reports/p00-treaty-correction/validate-p00-treaty-correction-final.mjs"],
    "75efc281dcd78add736a0757ced5253052e066e9e1a6cf35c5bd6ac28bb5bd3f",
  );
  assert.equal(addendum.sourcePins.p00Receipt.receiptId, "RCPT-00");
  for (const file of addendum.sourcePins.files) assert.match(file.sha256, /^[0-9a-f]{64}$/);
});

test("the addendum pins the independent deadlock audit that produced its root finding", () => {
  const audit = addendum.sourcePins.independentDeadlockAudit;
  assert.equal(audit.sha256, "7826e1812085fbc59dcd873cabc3732daaf95d8e3bbb2000a7e21e200e043661");
  assert.equal(audit.bytes, 420887);
  assert.equal(audit.verdict, "REJECT");
  assert.equal(audit.manifestedByPathAndHashOnly, true);
});

test("the addendum supersedes no historical P00 artifact and rewrites nothing", () => {
  assert.equal(addendum.supersedesHistoricalP00Artifacts, false);
  assert.equal(addendum.rewritesAnyHistoricalArtifact, false);
  assert.equal(addendum.correctedSentence.scopeOfCorrection, "execution-interpretation-only");
  assert.equal(addendum.correctedSentence.historicalTextPreserved, true);
  assert.equal(
    addendum.correctedSentence.historicalText,
    "This phase may not produce its exit receipt while any listed obligation is unsatisfied.",
  );
});

test("the addendum moves no readiness flag and opens no capability", () => {
  assert.equal(addendum.readinessFlagBinding.mutatesAnyFlag, false);
  assert.equal(addendum.capabilityDelta, "NONE");
  assert.deepEqual(addendum.newlyBuildableProducts, []);
  for (const flag of [
    "kernelReady",
    "sdkReady",
    "appBuildable",
    "releaseAllowed",
    "deployAllowed",
    "productionAllowed",
    "gapClosed",
  ]) {
    assert.equal(addendum.readinessFlagBinding.values[flag], false, flag);
  }
  for (const product of ["SDK", "PWA", "release", "deploy", "production"]) {
    assert.ok(addendum.stillNotBuildable.includes(product), `${product} must stay not buildable`);
  }
});

test("the addendum produces no receipt, no signature and no closed gap", () => {
  assert.equal(addendum.executionProjection.producesNoReceipt, true);
  assert.equal(addendum.executionProjection.producesNoSignature, true);
  assert.equal(addendum.executionProjection.producesNoClosedGap, true);
  assert.ok(addendum.nonAuthorizations.some((line) => line.includes("RCPT-01")));
});

test("the phase-chain projection keeps no-skip and the predecessor receipt requirement", () => {
  const { phases } = addendum.phaseChainProjection;
  assert.equal(phases.length, 13);
  assert.equal(addendum.phaseChainProjection.noSkip, true);
  for (const phase of phases) {
    assert.equal(phase.noSkip, true, phase.id);
    assert.equal(phase.mutatesAnyFlag, false, phase.id);
    if (phase.id === "P00") {
      assert.equal(phase.predecessor, null);
      assert.equal(phase.predecessorReceiptRequired, false);
    } else {
      assert.equal(phase.predecessorReceiptRequired, true, phase.id);
    }
  }
  assert.deepEqual(checker.analyzeChainIntegrity(checker.modelFromAddendum(addendum)), []);
});

// -------------------------------------------------------------------------------------
// 9. The checker as a command
// -------------------------------------------------------------------------------------

test("the checker reads a real tree and reports no finding on this one", () => {
  const report = checker.runCheck(root);
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.edges, 53);
  assert.equal(report.summary.backward, 0);
  assert.equal(report.summary.discharges, 53);
  assert.equal(report.summary.historicalLiteralReceipts, 1);
  assert.equal(report.summary.capabilityDelta, "NONE");
  assert.ok(["verified", "absent"].includes(report.summary.externalEvidence));
});

test("the checker writes nothing: no write API appears in its source", () => {
  const source = readFileSync(path.join(root, "tools", "check-p01-closure-semantics.mjs"), "utf8");
  for (const forbidden of [
    "writeFile",
    "appendFile",
    "createWriteStream",
    "mkdir",
    "rmSync",
    "unlink",
    "copyFile",
    "execSync",
    "execFileSync",
    "spawnSync",
  ]) {
    assert.equal(source.includes(forbidden), false, `the checker must not reference ${forbidden}`);
  }
});

test("the checker refuses a tree whose addendum contradicts the accepted edge count", () => {
  const report = checker.evaluate({
    addendum: (() => {
      const copy = clone(addendum);
      copy.closureEdgeProjection.counts.totalEdges = 52;
      return copy;
    })(),
    schema: dischargeSchema,
    externalEvidence: { state: "absent", findings: [] },
  });
  assert.ok(report.findings.some((finding) => finding.startsWith("DECLARED_COUNT")));
});

test("the checker refuses a tree with no addendum and no schema rather than passing quietly", () => {
  const report = checker.evaluate({
    addendum: null,
    schema: null,
    externalEvidence: { state: "absent", findings: [] },
  });
  assert.ok(report.findings.some((finding) => finding.startsWith("ADDENDUM_UNREADABLE")));
  assert.ok(report.findings.some((finding) => finding.startsWith("SCHEMA_UNREADABLE")));
});

test("external evidence is either verified against the pins or reported absent, never assumed", () => {
  const evidence = checker.externalEvidenceReport(addendum);
  assert.ok(["verified", "absent"].includes(evidence.state));
  if (evidence.state === "verified") {
    assert.deepEqual(evidence.findings, []);
    assert.equal(evidence.verifiedFiles, addendum.sourcePins.files.length);
    assert.equal(
      evidence.derivedProjectionMatches,
      true,
      "the 53-edge projection must be re-derivable from the pinned overlay and phase chain",
    );
  } else {
    assert.equal(evidence.verifiedFiles, 0);
  }
});

// -------------------------------------------------------------------------------------
// 10. The human gate: satisfied by a human, or nothing is discharged
//
// The classification record used to say an intra-phase obligation discharges when "the relevant
// human gate is open rather than closed". That reads the gate backwards. An OPEN human decision
// is one nobody has answered yet, and an unanswered decision is the reason to withhold a
// discharge, never the ground for granting one. Two different facts were being run together, and
// this section keeps them apart:
//
//   REAL DISCHARGE  a phase receipt, and the INTRA_ATOMIC discharges carried inside it, require
//                   every human decision gating either side to be recorded SATISFIED by the
//                   authorized human.
//   SIMULATION      the reachability run may assume such a gate is satisfiable, and does so for
//                   one purpose: to show that a receipt is reachable. The assumption answers no
//                   decision, signs nothing, closes nothing, and leaves behind no receipt that a
//                   real discharge can be built on.
//
// The wording is asserted, but the wording is the weakest thing here. The same separation is
// executed: the simulation is run, and its own output is then offered to the validator that
// judges real discharges, which refuses it.
// -------------------------------------------------------------------------------------

const HUMAN_GATE_BLOCKING_STATES = ["OPEN", "HUMAN_DECISION_REQUIRED", "UNANSWERED", "UNSATISFIED"];

test("a real discharge requires a SATISFIED human decision; an open one is never sufficient", () => {
  const policy = addendum.semantics.humanGatePolicy;
  assert.equal(policy.realDischargeRequiredDecisionState, "SATISFIED");
  assert.equal(policy.decisionAuthority, "authorized human");
  for (const state of HUMAN_GATE_BLOCKING_STATES) {
    assert.ok(
      policy.realDischargeBlockingDecisionStates.includes(state),
      `${state} must be listed as a state that blocks a real discharge`,
    );
  }
  assert.equal(
    policy.realDischargeBlockingDecisionStates.includes(policy.realDischargeRequiredDecisionState),
    false,
    "the one state that permits a discharge may not also be listed as a state that blocks it",
  );
});

test("the INTRA_ATOMIC record demands a satisfied decision and never asks for an open gate", () => {
  const intra = addendum.semantics.classifications.INTRA_ATOMIC;
  assert.equal(intra.definition, "sourcePhase == destinationPhase");
  assert.equal(intra.sourceGapStatusAtSourceReceipt, "CLOSED");
  assert.match(
    intra.discharge,
    /SATISFIED/,
    "the discharge condition must name the state the authorized human has to have recorded",
  );
  assert.equal(
    /gate is open rather than closed/i.test(intra.discharge),
    false,
    "requiring an open gate inverts it: an open human decision is an unanswered one",
  );
});

test("the simulation may assume a gate is satisfiable, and that assumption closes no decision", () => {
  const policy = addendum.semantics.humanGatePolicy;
  assert.equal(policy.simulationMayAssumeGateSatisfiable, true);
  assert.equal(policy.simulationAssumptionCountsAsSatisfaction, false);

  const run = checker.simulateExecution(checker.modelFromAddendum(addendum), {
    semantics: P01_SEMANTICS,
  });
  const decisions = addendum.phaseChainProjection.phases.flatMap((phase) => phase.humanDecisionIds);
  assert.equal(decisions.length, 26);
  assert.equal(run.reachedPhaseReceipts.length, 13);
  assert.equal(run.gatePolicy, "SATISFIABLE_BUT_NOT_AUTO_CLOSED");

  // Thirteen receipts reachable, twenty-six decisions still unanswered. That gap is the point.
  assert.equal(run.humanDecisionsClosed, 0);
  assert.equal(run.signaturesProduced, 0);
  assert.equal(run.receiptsIssued, 0);

  // What the addendum declares about the simulation must be what the simulation does.
  assert.equal(policy.simulationClosesAnyHumanDecision, run.humanDecisionsClosed > 0);
  assert.equal(policy.simulationSignsAnything, run.signaturesProduced > 0);
  assert.equal(policy.simulationProducesRealReceipt, run.receiptsIssued > 0);
});

test("a discharge standing on the simulation alone is refused: reachable is not issued", () => {
  const model = checker.modelFromAddendum(addendum);
  const run = checker.simulateExecution(model, { semantics: P01_SEMANTICS });

  const simulated = run.discharges.find((entry) => entry.edgeId === "E-005");
  assert.equal(simulated.sourcePhaseReceipt, "RCPT-01");
  assert.equal(simulated.destinationPhaseReceipt, "RCPT-03");

  // The same edge, offered to the validator that judges real discharges, with nothing behind it
  // but the run above. No receipt was issued, so neither endpoint of the linkage exists.
  const findings = checker.validateDischargeReceipt(dischargeDocument(), model, {
    issuedReceipts: {},
    dischargedEdgeIds: [],
  });
  assert.ok(findings.some((finding) => finding.startsWith("SOURCE_RECEIPT_ABSENT:E-005")));
  assert.ok(findings.some((finding) => finding.startsWith("DESTINATION_RECEIPT_ABSENT:E-005")));
});

test("the simulation's final CLOSED is a projection, not a closure the validator will accept", () => {
  const model = checker.modelFromAddendum(addendum);
  const run = checker.simulateExecution(model, { semantics: P01_SEMANTICS });
  assert.equal(run.gapStatusFinal["KG-084"], "CLOSED", "the run does end with KG-084 projected CLOSED");

  // Real state, where E-153 has not been discharged by anybody. The projection does not carry.
  const document = dischargeDocument();
  document.edgeId = "E-152";
  document.dischargeId = "DSCH-E-152";
  document.sourceGap = "KG-084";
  document.destinationGap = "KG-019";
  document.destinationPhase = "P02";
  document.destinationPhaseReceiptId = "RCPT-02";
  document.destinationPhaseReceiptHash = digest("a2");
  document.gapStatusAfter = "CLOSED";

  const findings = checker.validateDischargeReceipt(document, model, dischargeState());
  assert.ok(findings.some((finding) => finding.startsWith("CLOSED_WITH_PENDING_FORWARD:KG-084")));
  assert.ok(findings.some((finding) => finding.includes("E-153")));
});

// -------------------------------------------------------------------------------------
// 11. The canonical semantics block, bound to the gates that run
//
// An independent reviewer proved that everything above this line could hold while the document
// the docs call "the canonical owner of every value below" said the opposite. Applied together to
// planning/p01-closure-semantics-addendum.json, all four of these left `npm run check` and
// `npm test` GREEN:
//
//   separation.rule                        -> a forward edge blocks the source phase receipt
//   separation.gapFinalClosure             -> closure is implied by the phase receipt
//   appendOnly.sourcePhaseReceiptRewritten -> true
//   successorAdmission.noSkip              -> false
//
// That is the defect this package exists to correct, wearing the package's own clothes: a
// validator that checks projections and counts and never reads the statement carrying the
// meaning. Section 10 pins `humanGatePolicy` in this suite alone, which is the same hole one
// field over — a suite is not what a later reader runs when they run the gate.
//
// So the canonical statements are bound by exact equality rather than by substring. A substring
// test asks whether some words are present; the mutations above are fluent English that keeps the
// words and inverts the claim. The addendum is the one place these values are owned, the checker
// is a gate rather than a second owner of them, and equality is the only instrument that refuses
// every rewording without having to anticipate which rewording arrives.
// -------------------------------------------------------------------------------------

const withSemantics = (mutate) => {
  const copy = clone(addendum);
  mutate(copy.semantics);
  return copy;
};

const evaluateAddendum = (mutated) =>
  checker.evaluate({
    addendum: mutated,
    schema: dischargeSchema,
    externalEvidence: { state: "absent", findings: [] },
  });

/** The four mutations the reviewer demonstrated, each with the finding that must now refuse it. */
const REVIEWER_MUTATIONS = [
  {
    name: "separation.rule says a forward edge blocks the source phase receipt",
    mutate: (semantics) => {
      semantics.separation.rule =
        "A CLOSURE edge blocks the source gap's final CLOSED state. It blocks the source phase " +
        "receipt while a forward destination receipt does not exist yet.";
    },
    finding: "SEMANTICS_SEPARATION:rule",
  },
  {
    name: "separation.gapFinalClosure says closure is implied by the phase receipt",
    mutate: (semantics) => {
      semantics.separation.gapFinalClosure =
        "A gap reaches CLOSED only when every CLOSURE obligation originating at it is discharged. " +
        "Implied by the phase receipt.";
    },
    finding: "SEMANTICS_SEPARATION:gapFinalClosure",
  },
  {
    name: "appendOnly.sourcePhaseReceiptRewritten becomes true",
    mutate: (semantics) => {
      semantics.appendOnly.sourcePhaseReceiptRewritten = true;
    },
    finding: "SEMANTICS_SOURCE_PHASE_RECEIPT_REWRITTEN:true",
  },
  {
    name: "successorAdmission.noSkip becomes false",
    mutate: (semantics) => {
      semantics.successorAdmission.noSkip = false;
    },
    finding: "SEMANTICS_NO_SKIP:false",
  },
];

test("the unmutated canonical semantics block produces no semantic finding", () => {
  assert.deepEqual(checker.semanticContractViolations(addendum.semantics), []);
  assert.deepEqual(evaluateAddendum(clone(addendum)).findings, []);
});

for (const mutation of REVIEWER_MUTATIONS) {
  test(`the evaluate path refuses the reviewer mutation: ${mutation.name}`, () => {
    const report = evaluateAddendum(withSemantics(mutation.mutate));
    assert.ok(
      report.findings.includes(mutation.finding),
      `expected ${mutation.finding} among ${JSON.stringify(report.findings)}`,
    );
  });
}

test("the evaluate path refuses all four reviewer mutations applied at once", () => {
  const report = evaluateAddendum(
    withSemantics((semantics) => {
      for (const mutation of REVIEWER_MUTATIONS) mutation.mutate(semantics);
    }),
  );
  for (const mutation of REVIEWER_MUTATIONS) {
    assert.ok(
      report.findings.includes(mutation.finding),
      `${mutation.finding} must survive being reported beside the other three`,
    );
  }
});

test("the evaluate path refuses a semantics block that is missing altogether", () => {
  const copy = clone(addendum);
  delete copy.semantics;
  assert.ok(
    evaluateAddendum(copy).findings.some((finding) => finding.startsWith("SEMANTICS_BLOCK_ABSENT")),
  );
});

test("the separation statements are pinned by equality, so any reworded claim is refused", () => {
  const separation = addendum.semantics.separation;
  assert.equal(
    separation.phaseReceipt,
    "Produced when the phase's outputs, gates, review and human decisions are satisfied. It is " +
      "what a successor consumes for no-skip admission.",
  );
  assert.equal(
    separation.gapFinalClosure,
    "A gap reaches CLOSED only when every CLOSURE obligation originating at it is discharged. " +
      "This is a separate fact from the phase receipt and is never implied by it.",
  );
  assert.equal(
    separation.rule,
    "A CLOSURE edge blocks the source gap's final CLOSED state. It never blocks the source phase " +
      "receipt on the ground that a forward destination receipt does not exist yet.",
  );

  for (const field of ["phaseReceipt", "gapFinalClosure", "rule"]) {
    const report = evaluateAddendum(
      withSemantics((semantics) => {
        semantics.separation[field] = `${separation[field]} `;
      }),
    );
    assert.ok(
      report.findings.includes(`SEMANTICS_SEPARATION:${field}`),
      `${field} must be refused even by a one-character drift`,
    );
  }
});

/** Every field of the C1 human-gate contract, and the value that must not be allowed back. */
const HUMAN_GATE_MUTATIONS = [
  ["realDischargeRequiredDecisionState", "OPEN", "SEMANTICS_HUMAN_GATE_REQUIRED_STATE:OPEN"],
  ["decisionAuthority", "the simulation", "SEMANTICS_DECISION_AUTHORITY:the simulation"],
  [
    "simulationMayAssumeGateSatisfiable",
    false,
    "SEMANTICS_HUMAN_GATE:simulationMayAssumeGateSatisfiable:false",
  ],
  [
    "simulationAssumptionCountsAsSatisfaction",
    true,
    "SEMANTICS_HUMAN_GATE:simulationAssumptionCountsAsSatisfaction:true",
  ],
  ["simulationSignsAnything", true, "SEMANTICS_HUMAN_GATE:simulationSignsAnything:true"],
  [
    "simulationClosesAnyHumanDecision",
    true,
    "SEMANTICS_HUMAN_GATE:simulationClosesAnyHumanDecision:true",
  ],
  ["simulationProducesRealReceipt", true, "SEMANTICS_HUMAN_GATE:simulationProducesRealReceipt:true"],
];

for (const [field, value, finding] of HUMAN_GATE_MUTATIONS) {
  test(`the evaluate path refuses humanGatePolicy.${field} = ${JSON.stringify(value)}`, () => {
    const report = evaluateAddendum(
      withSemantics((semantics) => {
        semantics.humanGatePolicy[field] = value;
      }),
    );
    assert.ok(
      report.findings.includes(finding),
      `expected ${finding} among ${JSON.stringify(report.findings)}`,
    );
  });
}

test("the blocking decision states are exact: nothing missing, nothing extra, nothing doubled", () => {
  assert.deepEqual(
    addendum.semantics.humanGatePolicy.realDischargeBlockingDecisionStates,
    HUMAN_GATE_BLOCKING_STATES,
  );

  const dropped = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.humanGatePolicy.realDischargeBlockingDecisionStates = [
        "OPEN",
        "UNANSWERED",
        "UNSATISFIED",
      ];
    }),
  );
  assert.ok(
    dropped.findings.includes("SEMANTICS_HUMAN_GATE_BLOCKING_MISSING:HUMAN_DECISION_REQUIRED"),
  );

  const widened = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.humanGatePolicy.realDischargeBlockingDecisionStates.push("SATISFIED");
    }),
  );
  assert.ok(
    widened.findings.includes("SEMANTICS_HUMAN_GATE_BLOCKING_EXTRA:SATISFIED"),
    "the one state that permits a discharge may never also be listed as one that blocks it",
  );

  const doubled = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.humanGatePolicy.realDischargeBlockingDecisionStates.push("OPEN");
    }),
  );
  assert.ok(
    doubled.findings.some((finding) => finding.startsWith("SEMANTICS_HUMAN_GATE_BLOCKING_DUPLICATE")),
  );

  const emptied = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.humanGatePolicy.realDischargeBlockingDecisionStates = [];
    }),
  );
  for (const state of HUMAN_GATE_BLOCKING_STATES) {
    assert.ok(emptied.findings.includes(`SEMANTICS_HUMAN_GATE_BLOCKING_MISSING:${state}`), state);
  }
});

test("the evaluate path refuses an appendOnly block that drops its separation or its schema", () => {
  const notSeparate = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.appendOnly.dischargeReceiptsAreSeparateArtifacts = false;
    }),
  );
  assert.ok(notSeparate.findings.includes("SEMANTICS_DISCHARGE_RECEIPTS_NOT_SEPARATE:false"));

  const wrongSchema = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.appendOnly.schema = "planning/some-other-schema.json";
    }),
  );
  assert.ok(
    wrongSchema.findings.includes("SEMANTICS_APPEND_ONLY_SCHEMA:planning/some-other-schema.json"),
  );
});

test("the evaluate path refuses an INTRA_ATOMIC record that asks for an open gate again", () => {
  const inverted = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.classifications.INTRA_ATOMIC.discharge =
        "Discharged atomically inside the same phase receipt when the relevant human gate is open " +
        "rather than closed.";
    }),
  );
  assert.ok(inverted.findings.includes("SEMANTICS_INTRA_ATOMIC_OPEN_GATE"));
  assert.ok(inverted.findings.includes("SEMANTICS_INTRA_ATOMIC_DISCHARGE_STATE"));
});

test("the evaluate path refuses a semantics block relabelled as a different contract", () => {
  const report = evaluateAddendum(
    withSemantics((semantics) => {
      semantics.id = "P01-CLOSURE-SEMANTICS-V2";
    }),
  );
  assert.ok(report.findings.includes("SEMANTICS_ID:P01-CLOSURE-SEMANTICS-V2"));
});

// -------------------------------------------------------------------------------------
// The command itself, in a scratch tree.
//
// Everything above runs `evaluate` in-process, which is the function the CLI calls but is not the
// CLI. The gate a later reader actually runs is `npm run check`, and what that consumes is an exit
// code. So the checker is copied beside a mutated addendum in a temporary tree — `root` resolves
// relative to the tool's own location, so the copy reads the mutated document — and the real
// command is executed.
//
// The control run is checked for its OK line, not merely for exit 0, and the scratch path is
// resolved through `realpathSync` first. Both matter: on a platform where the temporary directory
// is a symlink, `process.argv[1]` and `fileURLToPath(import.meta.url)` disagree, the CLI block at
// the foot of the checker never runs, and the command exits 0 having done nothing at all. A
// control that only asserts exit 0 passes exactly as happily in that case as in a real GREEN,
// which would leave this whole test asserting nothing — the failure mode the test exists to catch,
// one layer up.
// -------------------------------------------------------------------------------------

test("the real command exits non-zero on the four mutations, and zero on the same tree unmutated", () => {
  const scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), "p01-closure-semantics-")));
  try {
    mkdirSync(path.join(scratch, "tools"));
    mkdirSync(path.join(scratch, "planning"));
    const tool = path.join(scratch, "tools", "check-p01-closure-semantics.mjs");
    cpSync(path.join(root, "tools", "check-p01-closure-semantics.mjs"), tool);
    cpSync(
      path.join(root, "planning", "p01-closure-discharge.schema.json"),
      path.join(scratch, "planning", "p01-closure-discharge.schema.json"),
    );

    const addendumPath = path.join(scratch, "planning", "p01-closure-semantics-addendum.json");
    const writeAddendum = (document) =>
      writeFileSync(addendumPath, JSON.stringify(document, null, 2));
    const run = () => spawnSync(process.execPath, [tool], { encoding: "utf8" });

    writeAddendum(addendum);
    const control = run();
    assert.equal(control.status, 0, `the unmutated control must be GREEN, got: ${control.stderr}`);
    assert.match(
      control.stdout,
      /OK p01-closure-semantics/,
      "the control must have actually run the checker, not exited 0 without reaching it",
    );

    writeAddendum(
      withSemantics((semantics) => {
        for (const mutation of REVIEWER_MUTATIONS) mutation.mutate(semantics);
      }),
    );
    const mutated = run();
    assert.equal(mutated.status, 1, "npm run check must not stay GREEN once the semantics invert");
    assert.match(mutated.stderr, /p01-closure-semantics: RED/);
    for (const mutation of REVIEWER_MUTATIONS) {
      assert.ok(
        mutated.stderr.includes(mutation.finding),
        `the command must name ${mutation.finding}`,
      );
    }

    writeAddendum(
      withSemantics((semantics) => {
        semantics.humanGatePolicy.realDischargeRequiredDecisionState = "OPEN";
      }),
    );
    const humanGate = run();
    assert.equal(
      humanGate.status,
      1,
      "an unanswered decision may never be the state a real discharge requires",
    );
    assert.ok(humanGate.stderr.includes("SEMANTICS_HUMAN_GATE_REQUIRED_STATE:OPEN"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------
// 12. One non-authorization, scoped to what this package can speak for
//
// The other five entries are scoped to the package — entry 3 says "because of this package", and
// `p00Receipt.note` says this addendum "does not authorise P01 entry either". This one was bare.
// Read absolutely it says nothing authorises P01 entry, which is a claim about the programme
// rather than about a planning addendum, and one an already admitted P01 workstream contradicts.
// A package correcting an over-literal sentence should not ship one.
// -------------------------------------------------------------------------------------

test("the RCPT-01 non-authorization speaks for this package and not for the programme", () => {
  const line = addendum.nonAuthorizations.find((entry) => entry.includes("RCPT-01"));
  assert.equal(line, "No RCPT-01 is produced, and this package does not authorise P01 entry.");

  for (const entry of addendum.nonAuthorizations) {
    assert.equal(
      /P01 entry is not authoris/i.test(entry),
      false,
      `the unscoped wording claims more than this package can: ${entry}`,
    );
  }
  assert.match(addendum.sourcePins.p00Receipt.note, /does not authorise P01 entry either/);
});
