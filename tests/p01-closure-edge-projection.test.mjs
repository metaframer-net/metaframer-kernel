import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeClosureGraph, modelFromAddendum } from "../tools/check-p01-closure-semantics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addendumPath = path.join(__dirname, "..", "planning", "p01-closure-semantics-addendum.json");
const canonicalAddendum = JSON.parse(readFileSync(addendumPath, "utf8"));
const clone = (value) => structuredClone(value);

// Canonical source #1: reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv
// sha256 482bdba5c54f1f08fb89821c86991d7b86b23f65c6815d7b601d5ac81f8d3a30
// 53 dep_type=CLOSURE rows: 23 INTRA_ATOMIC (same src/dst phase), 30 FORWARD_DEFERRED
// (later dst phase), 0 backward.
// Canonical source #2: reports/kernel-development-roadmap/00-PHASE-CHAIN.json
// sha256 7794df62ef49829f134f742172eb2e6ed32cbc68a140a1ce5f70bdd4c23176c9
// 13 phases; the union of every phase's closureObligations.edgeIds is the same 53 unique IDs.
const DERIVATION_RULE_ID = "DRV-P01-CLOSURE-EDGE-PROJECTION-V1";
const DERIVATION_RULE =
  "One row per dep_type=CLOSURE record in 08-DEPENDENCY-OVERLAY.tsv, sorted by edge_id, carrying only the fields analyzeClosureGraph consumes. classification is derived from phase ordinal (same phase => INTRA_ATOMIC, later => FORWARD_DEFERRED); expectedDestinationReceipt is the destination phase's canonical receiptId. No field is invented and no field is edited.";
const CONTAINER_KEYS = ["edgeCount", "derivationRuleId", "derivationRule", "edges"];
const EDGE_KEYS = [
  "edgeId",
  "sourceGap",
  "destinationGap",
  "sourcePhase",
  "destinationPhase",
  "classification",
  "expectedDestinationReceipt",
];

// Canonical 53 CLOSURE edges, sorted by edge_id, cross-checked against both sources above.
const CANONICAL_EDGES = [
  { edgeId: "E-002", sourceGap: "KG-002", destinationGap: "KG-004", sourcePhase: "P01", destinationPhase: "P01", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-01" },
  { edgeId: "E-003", sourceGap: "KG-003", destinationGap: "KG-002", sourcePhase: "P01", destinationPhase: "P01", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-01" },
  { edgeId: "E-005", sourceGap: "KG-004", destinationGap: "KG-023", sourcePhase: "P01", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-010", sourceGap: "KG-007", destinationGap: "KG-015", sourcePhase: "P02", destinationPhase: "P02", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-02" },
  { edgeId: "E-012", sourceGap: "KG-007", destinationGap: "KG-023", sourcePhase: "P02", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-013", sourceGap: "KG-008", destinationGap: "KG-014", sourcePhase: "P02", destinationPhase: "P02", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-02" },
  { edgeId: "E-014", sourceGap: "KG-008", destinationGap: "KG-039", sourcePhase: "P02", destinationPhase: "P04", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-016", sourceGap: "KG-012", destinationGap: "KG-066", sourcePhase: "P02", destinationPhase: "P09", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-09" },
  { edgeId: "E-019", sourceGap: "KG-015", destinationGap: "KG-023", sourcePhase: "P02", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-020", sourceGap: "KG-015", destinationGap: "KG-049", sourcePhase: "P02", destinationPhase: "P04", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-021", sourceGap: "KG-016", destinationGap: "KG-021", sourcePhase: "P02", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-022", sourceGap: "KG-016", destinationGap: "KG-022", sourcePhase: "P02", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-023", sourceGap: "KG-016", destinationGap: "KG-063", sourcePhase: "P02", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-025", sourceGap: "KG-017", destinationGap: "KG-061", sourcePhase: "P02", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-027", sourceGap: "KG-018", destinationGap: "KG-026", sourcePhase: "P02", destinationPhase: "P03", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-030", sourceGap: "KG-020", destinationGap: "KG-062", sourcePhase: "P03", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-031", sourceGap: "KG-020", destinationGap: "KG-063", sourcePhase: "P03", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-033", sourceGap: "KG-021", destinationGap: "KG-063", sourcePhase: "P03", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-035", sourceGap: "KG-022", destinationGap: "KG-025", sourcePhase: "P03", destinationPhase: "P03", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-037", sourceGap: "KG-023", destinationGap: "KG-024", sourcePhase: "P03", destinationPhase: "P03", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-03" },
  { edgeId: "E-045", sourceGap: "KG-028", destinationGap: "KG-041", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-046", sourceGap: "KG-031", destinationGap: "KG-081", sourcePhase: "P04", destinationPhase: "P11", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-048", sourceGap: "KG-032", destinationGap: "KG-039", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-049", sourceGap: "KG-033", destinationGap: "KG-032", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-051", sourceGap: "KG-034", destinationGap: "KG-041", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-052", sourceGap: "KG-035", destinationGap: "KG-039", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-053", sourceGap: "KG-035", destinationGap: "KG-079", sourcePhase: "P04", destinationPhase: "P07", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-07" },
  { edgeId: "E-057", sourceGap: "KG-036", destinationGap: "KG-042", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-058", sourceGap: "KG-037", destinationGap: "KG-036", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-060", sourceGap: "KG-038", destinationGap: "KG-036", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-062", sourceGap: "KG-039", destinationGap: "KG-036", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-064", sourceGap: "KG-040", destinationGap: "KG-042", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-066", sourceGap: "KG-041", destinationGap: "KG-036", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-068", sourceGap: "KG-042", destinationGap: "KG-057", sourcePhase: "P04", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-070", sourceGap: "KG-043", destinationGap: "KG-047", sourcePhase: "P04", destinationPhase: "P04", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-04" },
  { edgeId: "E-073", sourceGap: "KG-045", destinationGap: "KG-076", sourcePhase: "P04", destinationPhase: "P11", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-075", sourceGap: "KG-046", destinationGap: "KG-081", sourcePhase: "P04", destinationPhase: "P11", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-083", sourceGap: "KG-050", destinationGap: "KG-051", sourcePhase: "P05", destinationPhase: "P05", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-05" },
  { edgeId: "E-086", sourceGap: "KG-052", destinationGap: "KG-057", sourcePhase: "P05", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-090", sourceGap: "KG-054", destinationGap: "KG-074", sourcePhase: "P05", destinationPhase: "P09", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-09" },
  { edgeId: "E-092", sourceGap: "KG-055", destinationGap: "KG-063", sourcePhase: "P05", destinationPhase: "P06", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-100", sourceGap: "KG-059", destinationGap: "KG-062", sourcePhase: "P06", destinationPhase: "P06", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-102", sourceGap: "KG-060", destinationGap: "KG-082", sourcePhase: "P06", destinationPhase: "P10", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-10" },
  { edgeId: "E-106", sourceGap: "KG-062", destinationGap: "KG-063", sourcePhase: "P06", destinationPhase: "P06", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-06" },
  { edgeId: "E-111", sourceGap: "KG-064", destinationGap: "KG-077", sourcePhase: "P06", destinationPhase: "P08", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-08" },
  { edgeId: "E-130", sourceGap: "KG-073", destinationGap: "KG-085", sourcePhase: "P09", destinationPhase: "P12", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-12" },
  { edgeId: "E-134", sourceGap: "KG-075", destinationGap: "KG-082", sourcePhase: "P10", destinationPhase: "P10", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-10" },
  { edgeId: "E-136", sourceGap: "KG-076", destinationGap: "KG-081", sourcePhase: "P11", destinationPhase: "P11", classification: "INTRA_ATOMIC", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-138", sourceGap: "KG-077", destinationGap: "KG-076", sourcePhase: "P08", destinationPhase: "P11", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-140", sourceGap: "KG-078", destinationGap: "KG-066", sourcePhase: "P07", destinationPhase: "P09", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-09" },
  { edgeId: "E-150", sourceGap: "KG-083", destinationGap: "KG-076", sourcePhase: "P08", destinationPhase: "P11", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-11" },
  { edgeId: "E-152", sourceGap: "KG-084", destinationGap: "KG-019", sourcePhase: "P01", destinationPhase: "P02", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-02" },
  { edgeId: "E-153", sourceGap: "KG-084", destinationGap: "KG-050", sourcePhase: "P01", destinationPhase: "P05", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-05" },
];

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function closureEdgeProjectionViolations(projection) {
  if (!isPlainObject(projection)) return ["PROJECTION_MALFORMED"];
  const violations = [];
  const topKeys = Object.keys(projection);
  for (const key of CONTAINER_KEYS) if (!(key in projection)) violations.push(`TOP_LEVEL_FIELD_MISSING:${key}`);
  for (const key of topKeys) if (!CONTAINER_KEYS.includes(key)) violations.push(`TOP_LEVEL_FIELD_EXTRA:${key}`);
  if (projection.edgeCount !== 53) violations.push("EDGE_COUNT_MISMATCH");
  if (projection.derivationRuleId !== DERIVATION_RULE_ID) violations.push("DERIVATION_RULE_ID_MISMATCH");
  if (projection.derivationRule !== DERIVATION_RULE) violations.push("DERIVATION_RULE_MISMATCH");

  const edges = Array.isArray(projection.edges) ? projection.edges : null;
  if (!edges) {
    violations.push("EDGES_MALFORMED");
    return violations;
  }
  if (edges.length !== 53) violations.push(`EDGES_LENGTH_MISMATCH:${edges.length}`);

  const seenIds = new Set();
  edges.forEach((row, idx) => {
    if (!isPlainObject(row)) {
      violations.push(`EDGE_MALFORMED:${idx}`);
      return;
    }
    const rowKeys = Object.keys(row);
    for (const key of EDGE_KEYS) if (!(key in row)) violations.push(`EDGE_FIELD_MISSING:${idx}:${key}`);
    for (const key of rowKeys) if (!EDGE_KEYS.includes(key)) violations.push(`EDGE_FIELD_EXTRA:${idx}:${key}`);
    if (seenIds.has(row.edgeId)) violations.push(`EDGE_ID_DUPLICATE:${row.edgeId}`);
    else seenIds.add(row.edgeId);
  });

  CANONICAL_EDGES.forEach((expected, idx) => {
    const row = edges[idx];
    if (!isPlainObject(row)) return;
    for (const key of EDGE_KEYS) {
      if (row[key] !== expected[key]) violations.push(`EDGE_FIELD_MISMATCH:${idx}:${key}`);
    }
  });

  return violations;
}
test("closureEdgeProjection exists and passes structural/content validation with zero findings", () => {
  assert.deepEqual(closureEdgeProjectionViolations(canonicalAddendum.closureEdgeProjection), []);
});

test("edgeCount, derivationRuleId and derivationRule are exact", () => {
  const projection = canonicalAddendum.closureEdgeProjection;
  assert.equal(projection.edgeCount, 53);
  assert.equal(projection.derivationRuleId, DERIVATION_RULE_ID);
  assert.equal(projection.derivationRule, DERIVATION_RULE);
});

test("the 53 canonical edge ids are exactly present, no duplicate/missing/extra", () => {
  const declared = canonicalAddendum.closureEdgeProjection.edges.map((e) => e.edgeId);
  assert.deepEqual(declared, CANONICAL_EDGES.map((e) => e.edgeId));
  assert.equal(new Set(declared).size, 53);
});

test("edges reconstruct exactly 23 INTRA_ATOMIC and 30 FORWARD_DEFERRED, 0 backward", () => {
  const edges = canonicalAddendum.closureEdgeProjection.edges;
  const intra = edges.filter((e) => e.classification === "INTRA_ATOMIC");
  const forward = edges.filter((e) => e.classification === "FORWARD_DEFERRED");
  assert.equal(intra.length, 23);
  assert.equal(forward.length, 30);
  assert.equal(edges.length, 53);
});

test("endpoint gap/phase parity: sourceGap/destinationGap phases match gapRegistryProjection.gapPhase", () => {
  const gapPhase = canonicalAddendum.gapRegistryProjection.gapPhase;
  for (const e of canonicalAddendum.closureEdgeProjection.edges) {
    assert.equal(gapPhase[e.sourceGap], e.sourcePhase, `${e.edgeId} sourceGap phase`);
    assert.equal(gapPhase[e.destinationGap], e.destinationPhase, `${e.edgeId} destinationGap phase`);
  }
});

test("expectedDestinationReceipt equals the destination phase's canonical receiptId", () => {
  const byId = new Map(canonicalAddendum.phaseChainProjection.phases.map((p) => [p.id, p]));
  for (const e of canonicalAddendum.closureEdgeProjection.edges) {
    assert.equal(e.expectedDestinationReceipt, byId.get(e.destinationPhase).receiptId, e.edgeId);
  }
});

test("KG-084's two forward edges E-152/E-153 are exact", () => {
  const byId = new Map(canonicalAddendum.closureEdgeProjection.edges.map((e) => [e.edgeId, e]));
  assert.deepEqual(byId.get("E-152"), { edgeId: "E-152", sourceGap: "KG-084", destinationGap: "KG-019", sourcePhase: "P01", destinationPhase: "P02", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-02" });
  assert.deepEqual(byId.get("E-153"), { edgeId: "E-153", sourceGap: "KG-084", destinationGap: "KG-050", sourcePhase: "P01", destinationPhase: "P05", classification: "FORWARD_DEFERRED", expectedDestinationReceipt: "RCPT-05" });
});

test("analyzeClosureGraph(modelFromAddendum(canonicalAddendum)) has zero violations and exact counts", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const result = analyzeClosureGraph(model);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.counts, {
    totalEdges: 53,
    intraAtomic: 23,
    forwardDeferred: 30,
    backward: 0,
    duplicate: 0,
    missing: 0,
    extra: 0,
  });
});

test("adversarial clone: injected unknown container key is detected", () => {
  const bad = clone(canonicalAddendum.closureEdgeProjection);
  bad.injected = "unexpected";
  assert.ok(closureEdgeProjectionViolations(bad).includes("TOP_LEVEL_FIELD_EXTRA:injected"));
});

test("adversarial clone: injected unknown edge key is detected", () => {
  const bad = clone(canonicalAddendum.closureEdgeProjection);
  bad.edges[0].injected = "unexpected";
  assert.ok(closureEdgeProjectionViolations(bad).includes("EDGE_FIELD_EXTRA:0:injected"));
});

test("adversarial clone: classification mismatch is refused by analyzeClosureGraph", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-002");
  target.classification = "FORWARD_DEFERRED";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("CLASSIFICATION_MISMATCH:E-002:")));
});

test("adversarial clone: unknown destination gap is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-005");
  target.destinationGap = "KG-DOES-NOT-EXIST";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("DESTINATION_GAP_UNKNOWN:E-005:")));
});

test("adversarial clone: a fabricated backward edge is refused, never admitted", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-005");
  const dst = target.destinationGap;
  target.destinationGap = target.sourceGap;
  target.sourceGap = dst;
  target.sourcePhase = "P03";
  target.destinationPhase = "P01";
  target.classification = "INTRA_ATOMIC";
  target.expectedDestinationReceipt = "RCPT-01";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("BACKWARD_EDGE:E-005:P03->P01")));
  assert.equal(result.counts.backward, 1);
});

test("adversarial clone: missing phase enumeration is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const p01 = model.phases.find((p) => p.id === "P01");
  p01.closureEdgeIds = p01.closureEdgeIds.filter((id) => id !== "E-002");
  p01.closureEdgeCount = p01.closureEdgeIds.length;
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.includes("MISSING_EDGE:E-002"));
});

test("adversarial clone: ghost extra enumeration is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const p01 = model.phases.find((p) => p.id === "P01");
  p01.closureEdgeIds = [...p01.closureEdgeIds, "E-GHOST"];
  p01.closureEdgeCount = p01.closureEdgeIds.length;
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("EXTRA_EDGE:P01:E-GHOST")));
});

test("adversarial clone: declared phase edge count mismatch is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const p01 = model.phases.find((p) => p.id === "P01");
  p01.closureEdgeCount = p01.closureEdgeIds.length + 1;
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith(`PHASE_COUNT_MISMATCH:P01:${p01.closureEdgeCount}!=`)));
});

test("adversarial clone: duplicate edge id is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  model.edges.push({ ...model.edges.find((e) => e.edgeId === "E-002") });
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("DUPLICATE_EDGE:E-002")));
  assert.equal(result.counts.duplicate, 1);
});

test("adversarial clone: wrong expected destination receipt is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-005");
  target.expectedDestinationReceipt = "RCPT-WRONG";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("EXPECTED_RECEIPT_MISMATCH:E-005:")));
});

test("adversarial clone: wrong source phase is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-005");
  target.sourcePhase = "P02";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("SOURCE_PHASE_MISMATCH:E-005:")));
});

test("adversarial clone: wrong destination phase is refused", () => {
  const model = modelFromAddendum(canonicalAddendum);
  const target = model.edges.find((e) => e.edgeId === "E-005");
  target.destinationPhase = "P02";
  const result = analyzeClosureGraph(model);
  assert.ok(result.violations.some((v) => v.startsWith("DESTINATION_PHASE_MISMATCH:E-005:")));
});

test("adversarial clone: phase count mismatch across the whole projection changes edgeCount", () => {
  const bad = clone(canonicalAddendum.closureEdgeProjection);
  bad.edgeCount = 52;
  assert.ok(closureEdgeProjectionViolations(bad).includes("EDGE_COUNT_MISMATCH"));
});

test("two independent canonical views (dependency overlay CLOSURE rows, phase-chain closureObligations) agree on the 53 edge id set and per-phase membership", () => {
  const overlayIds = CANONICAL_EDGES.map((e) => e.edgeId).slice().sort();
  const phaseChainIds = canonicalAddendum.phaseChainProjection.phases
    .flatMap((p) => p.closureEdgeIds)
    .slice()
    .sort();
  assert.deepEqual(overlayIds, phaseChainIds);

  const overlayByPhase = new Map();
  for (const e of CANONICAL_EDGES) {
    if (!overlayByPhase.has(e.sourcePhase)) overlayByPhase.set(e.sourcePhase, []);
    overlayByPhase.get(e.sourcePhase).push(e.edgeId);
  }
  for (const p of canonicalAddendum.phaseChainProjection.phases) {
    const expected = (overlayByPhase.get(p.id) ?? []).slice().sort();
    assert.deepEqual(p.closureEdgeIds.slice().sort(), expected, p.id);
  }
});
