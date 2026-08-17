import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addendumContractViolations } from "../tools/check-p01-closure-semantics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addendumPath = path.join(__dirname, "..", "planning", "p01-closure-semantics-addendum.json");
const canonicalAddendum = JSON.parse(readFileSync(addendumPath, "utf8"));
const clone = (value) => structuredClone(value);

const CHAIN = "P00 -> P01 -> P02 -> P03 -> P04 -> P05 -> P06 -> P07 -> P08 -> P09 -> P10 -> P11 -> P12";
const PHASE_COUNT = 13;
const DERIVATION_RULE_ID = "DRV-P01-PHASE-PROJECTION-V1";
const DERIVATION_RULE =
  "One row per phase of 00-PHASE-CHAIN.json, in chain order, carrying only the fields the execution projection needs. No field is invented and no field is edited.";
const TOP_LEVEL_KEYS = ["chain", "phaseCount", "noSkip", "derivationRuleId", "derivationRule", "phases"];
const ROW_KEYS = [
  "id",
  "ordinal",
  "title",
  "receiptId",
  "predecessor",
  "successor",
  "predecessorReceiptId",
  "predecessorReceiptRequired",
  "noSkip",
  "mutatesAnyFlag",
  "closureEdgeCount",
  "closureEdgeIds",
];

// Canonical per-source-phase closureObligations, sourced from 00-PHASE-CHAIN.json (sha256
// 7794df62ef49829f134f742172eb2e6ed32cbc68a140a1ce5f70bdd4c23176c9), each edgeIds array equal to
// that phase's closureObligations.edgeIds verbatim.
const CANONICAL_PHASES = [
  { id: "P00", ordinal: 0, title: "Authority and Program Foundation", receiptId: "RCPT-00", predecessor: null, successor: "P01", predecessorReceiptId: null, predecessorReceiptRequired: false, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 0, closureEdgeIds: [] },
  { id: "P01", ordinal: 1, title: "Architectural Constitution and Topology", receiptId: "RCPT-01", predecessor: "P00", successor: "P02", predecessorReceiptId: "RCPT-00", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 5, closureEdgeIds: ["E-002", "E-003", "E-005", "E-152", "E-153"] },
  { id: "P02", ordinal: 2, title: "Deterministic Kernel Core", receiptId: "RCPT-02", predecessor: "P01", successor: "P03", predecessorReceiptId: "RCPT-01", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 12, closureEdgeIds: ["E-010", "E-012", "E-013", "E-014", "E-016", "E-019", "E-020", "E-021", "E-022", "E-023", "E-025", "E-027"] },
  { id: "P03", ordinal: 3, title: "One Write Path and Transactional Integrity", receiptId: "RCPT-03", predecessor: "P02", successor: "P04", predecessorReceiptId: "RCPT-02", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 5, closureEdgeIds: ["E-030", "E-031", "E-033", "E-035", "E-037"] },
  { id: "P04", ordinal: 4, title: "Zero Trust Identity, Tenancy and PDP", receiptId: "RCPT-04", predecessor: "P03", successor: "P05", predecessorReceiptId: "RCPT-03", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 17, closureEdgeIds: ["E-045", "E-046", "E-048", "E-049", "E-051", "E-052", "E-053", "E-057", "E-058", "E-060", "E-062", "E-064", "E-066", "E-068", "E-070", "E-073", "E-075"] },
  { id: "P05", ordinal: 5, title: "Archetype IR Compiler Registry and Evolution", receiptId: "RCPT-05", predecessor: "P04", successor: "P06", predecessorReceiptId: "RCPT-04", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 4, closureEdgeIds: ["E-083", "E-086", "E-090", "E-092"] },
  { id: "P06", ordinal: 6, title: "Workflow ECA Scheduler and Eventing", receiptId: "RCPT-06", predecessor: "P05", successor: "P07", predecessorReceiptId: "RCPT-05", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 4, closureEdgeIds: ["E-100", "E-102", "E-106", "E-111"] },
  { id: "P07", ordinal: 7, title: "AI-native Multi-LLM Orchestration", receiptId: "RCPT-07", predecessor: "P06", successor: "P08", predecessorReceiptId: "RCPT-06", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 1, closureEdgeIds: ["E-140"] },
  { id: "P08", ordinal: 8, title: "Tools Plugins Skills and Supply Chain Security", receiptId: "RCPT-08", predecessor: "P07", successor: "P09", predecessorReceiptId: "RCPT-07", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 2, closureEdgeIds: ["E-138", "E-150"] },
  { id: "P09", ordinal: 9, title: "SDK Codegen Protocols and Surface Readiness", receiptId: "RCPT-09", predecessor: "P08", successor: "P10", predecessorReceiptId: "RCPT-08", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 1, closureEdgeIds: ["E-130"] },
  { id: "P10", ordinal: 10, title: "Performance Observability and Capacity", receiptId: "RCPT-10", predecessor: "P09", successor: "P11", predecessorReceiptId: "RCPT-09", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 1, closureEdgeIds: ["E-134"] },
  { id: "P11", ordinal: 11, title: "Resilience HA DR Privacy and Compliance", receiptId: "RCPT-11", predecessor: "P10", successor: "P12", predecessorReceiptId: "RCPT-10", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 1, closureEdgeIds: ["E-136"] },
  { id: "P12", ordinal: 12, title: "Golden Slices Conformance and Kernel Promotion", receiptId: "RCPT-12", predecessor: "P11", successor: null, predecessorReceiptId: "RCPT-11", predecessorReceiptRequired: true, noSkip: true, mutatesAnyFlag: false, closureEdgeCount: 0, closureEdgeIds: [] },
];

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function phaseChainProjectionViolations(projection) {
  if (!isPlainObject(projection)) return ["PROJECTION_MALFORMED"];
  const violations = [];
  const topKeys = Object.keys(projection);
  for (const key of TOP_LEVEL_KEYS) if (!(key in projection)) violations.push(`TOP_LEVEL_FIELD_MISSING:${key}`);
  for (const key of topKeys) if (!TOP_LEVEL_KEYS.includes(key)) violations.push(`TOP_LEVEL_FIELD_EXTRA:${key}`);
  if (projection.chain !== CHAIN) violations.push("CHAIN_MISMATCH");
  if (projection.phaseCount !== PHASE_COUNT) violations.push("PHASE_COUNT_MISMATCH");
  if (projection.noSkip !== true) violations.push("NO_SKIP_MISMATCH");
  if (projection.derivationRuleId !== DERIVATION_RULE_ID) violations.push("DERIVATION_RULE_ID_MISMATCH");
  if (projection.derivationRule !== DERIVATION_RULE) violations.push("DERIVATION_RULE_MISMATCH");

  const phases = Array.isArray(projection.phases) ? projection.phases : null;
  if (!phases) {
    violations.push("PHASES_MALFORMED");
    return violations;
  }
  if (phases.length !== PHASE_COUNT) violations.push(`PHASES_LENGTH_MISMATCH:${phases.length}`);

  const seenIds = new Set();
  const seenOrdinals = new Set();
  const seenReceipts = new Set();
  phases.forEach((row, idx) => {
    if (!isPlainObject(row)) {
      violations.push(`ROW_MALFORMED:${idx}`);
      return;
    }
    const rowKeys = Object.keys(row);
    for (const key of ROW_KEYS) if (!(key in row)) violations.push(`ROW_FIELD_MISSING:${idx}:${key}`);
    for (const key of rowKeys) if (!ROW_KEYS.includes(key)) violations.push(`ROW_FIELD_EXTRA:${idx}:${key}`);
    if (seenIds.has(row.id)) violations.push(`ROW_ID_DUPLICATE:${row.id}`);
    else seenIds.add(row.id);
    if (seenOrdinals.has(row.ordinal)) violations.push(`ROW_ORDINAL_DUPLICATE:${row.ordinal}`);
    else seenOrdinals.add(row.ordinal);
    if (seenReceipts.has(row.receiptId)) violations.push(`ROW_RECEIPT_DUPLICATE:${row.receiptId}`);
    else seenReceipts.add(row.receiptId);
    if (row.noSkip !== true) violations.push(`ROW_NO_SKIP_MISMATCH:${idx}`);
    if (row.mutatesAnyFlag !== false) violations.push(`ROW_MUTATES_ANY_FLAG_MISMATCH:${idx}`);
    const expectedReceiptRequired = idx !== 0;
    if (row.predecessorReceiptRequired !== expectedReceiptRequired) violations.push(`ROW_PREDECESSOR_RECEIPT_REQUIRED_MISMATCH:${idx}`);
  });

  CANONICAL_PHASES.forEach((expected, idx) => {
    const row = phases[idx];
    if (!isPlainObject(row)) return;
    for (const key of ROW_KEYS) {
      const matches = Array.isArray(expected[key])
        ? Array.isArray(row[key]) && row[key].length === expected[key].length && row[key].every((v, i) => v === expected[key][i])
        : row[key] === expected[key];
      if (!matches) violations.push(`ROW_FIELD_MISMATCH:${idx}:${key}`);
    }
  });

  return violations;
}

test("phaseChainProjection exists and passes structural/content validation with zero findings", () => {
  assert.deepEqual(phaseChainProjectionViolations(canonicalAddendum.phaseChainProjection), []);
});

test("chain string reconstructs exactly from the 13 ordered phase ids", () => {
  const phases = canonicalAddendum.phaseChainProjection.phases;
  assert.equal(phases.map((p) => p.id).join(" -> "), CHAIN);
  assert.equal(canonicalAddendum.phaseChainProjection.phaseCount, 13);
  assert.equal(canonicalAddendum.phaseChainProjection.derivationRuleId, DERIVATION_RULE_ID);
  assert.equal(canonicalAddendum.phaseChainProjection.derivationRule, DERIVATION_RULE);
});

test("ordinals run exactly 0..12 with no gap, cycle or skip", () => {
  const ordinals = canonicalAddendum.phaseChainProjection.phases.map((p) => p.ordinal).sort((a, b) => a - b);
  assert.deepEqual(ordinals, Array.from({ length: 13 }, (_, i) => i));
});

test("predecessor/successor are mutual inverses with P00/P12 endpoints", () => {
  const phases = canonicalAddendum.phaseChainProjection.phases;
  const byId = new Map(phases.map((p) => [p.id, p]));
  assert.equal(phases[0].id, "P00");
  assert.equal(phases[0].predecessor, null);
  assert.equal(phases[12].id, "P12");
  assert.equal(phases[12].successor, null);
  for (const row of phases) {
    if (row.predecessor !== null) assert.equal(byId.get(row.predecessor).successor, row.id);
    if (row.successor !== null) assert.equal(byId.get(row.successor).predecessor, row.id);
  }
});

test("predecessorReceiptId equals the predecessor row's receiptId; required only when a predecessor exists", () => {
  const phases = canonicalAddendum.phaseChainProjection.phases;
  const byId = new Map(phases.map((p) => [p.id, p]));
  for (const row of phases) {
    if (row.predecessor === null) {
      assert.equal(row.predecessorReceiptId, null);
      assert.equal(row.predecessorReceiptRequired, false);
    } else {
      assert.equal(row.predecessorReceiptId, byId.get(row.predecessor).receiptId);
      assert.equal(row.predecessorReceiptRequired, true);
    }
  }
});

test("adversarial clone: wrong phaseCount is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phaseCount = 12;
  assert.ok(phaseChainProjectionViolations(bad).includes("PHASE_COUNT_MISMATCH"));
});

test("adversarial clone: missing ordinal is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  delete bad.phases[3].ordinal;
  assert.ok(phaseChainProjectionViolations(bad).includes("ROW_FIELD_MISSING:3:ordinal"));
});

test("adversarial clone: duplicate ordinal is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[5].ordinal = bad.phases[4].ordinal;
  assert.ok(phaseChainProjectionViolations(bad).some((v) => v.startsWith("ROW_ORDINAL_DUPLICATE:")));
});

test("adversarial clone: broken predecessor/successor linkage is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[6].predecessor = "P99";
  assert.ok(phaseChainProjectionViolations(bad).includes("ROW_FIELD_MISMATCH:6:predecessor"));
});

test("adversarial clone: wrong receipt link is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[2].predecessorReceiptId = "RCPT-99";
  assert.ok(phaseChainProjectionViolations(bad).includes("ROW_FIELD_MISMATCH:2:predecessorReceiptId"));
});

test("adversarial clone: flipped noSkip is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[0].noSkip = false;
  const violations = phaseChainProjectionViolations(bad);
  assert.ok(violations.includes("ROW_NO_SKIP_MISMATCH:0"));
  assert.ok(violations.includes("ROW_FIELD_MISMATCH:0:noSkip"));
});

test("adversarial clone: flipped mutatesAnyFlag is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[9].mutatesAnyFlag = true;
  const violations = phaseChainProjectionViolations(bad);
  assert.ok(violations.includes("ROW_MUTATES_ANY_FLAG_MISMATCH:9"));
  assert.ok(violations.includes("ROW_FIELD_MISMATCH:9:mutatesAnyFlag"));
});

test("adversarial clone: injected unknown row key is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.phases[1].injected = "unexpected";
  assert.ok(phaseChainProjectionViolations(bad).includes("ROW_FIELD_EXTRA:1:injected"));
});

test("adversarial clone: injected unknown container key is detected", () => {
  const bad = clone(canonicalAddendum.phaseChainProjection);
  bad.injected = "unexpected";
  assert.ok(phaseChainProjectionViolations(bad).includes("TOP_LEVEL_FIELD_EXTRA:injected"));
});

test("closureEdgeCount/closureEdgeIds are consistent per row and sum to the canonical 53 CLOSURE edges", () => {
  const phases = canonicalAddendum.phaseChainProjection.phases;
  let total = 0;
  const allIds = [];
  for (const row of phases) {
    assert.equal(row.closureEdgeCount, row.closureEdgeIds.length);
    assert.equal(new Set(row.closureEdgeIds).size, row.closureEdgeIds.length);
    total += row.closureEdgeCount;
    allIds.push(...row.closureEdgeIds);
  }
  assert.equal(total, 53);
  assert.equal(new Set(allIds).size, 53);
});

test("no duplicate id or receiptId across rows", () => {
  const phases = canonicalAddendum.phaseChainProjection.phases;
  assert.equal(new Set(phases.map((p) => p.id)).size, 13);
  assert.equal(new Set(phases.map((p) => p.receiptId)).size, 13);
});

test("existing semantics/nonAuthorizations/capabilityDelta remain byte-identical / zero findings through the existing public addendum validator", () => {
  assert.deepEqual(addendumContractViolations(canonicalAddendum), []);
  assert.equal(canonicalAddendum.package, "PKG-05");
  assert.equal(canonicalAddendum.status, "PARTIAL_ADDITIVE");
  assert.equal(canonicalAddendum.capabilityDelta, "NONE");
});
