import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelFromAddendum } from "../tools/check-p01-closure-semantics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addendumPath = path.join(__dirname, "..", "planning", "p01-closure-semantics-addendum.json");
const canonicalAddendum = JSON.parse(readFileSync(addendumPath, "utf8"));
const clone = (value) => structuredClone(value);

const GAP_COUNT = 90;
const DERIVATION_RULE_ID = "DRV-P01-GAP-REGISTRY-PROJECTION-V1";
const DERIVATION_RULE =
  "KG-001..KG-090 are projected in kg_id order from the overlay's current phase column and independently cross-checked against phase-chain ownedGaps membership; no field is invented or edited.";
const TOP_LEVEL_KEYS = ["gapCount", "derivationRuleId", "derivationRule", "gapPhase"];
const VALID_PHASES = new Set(Array.from({ length: 13 }, (_, i) => `P${String(i).padStart(2, "0")}`));
const KG_PATTERN = /^KG-\d{3}$/;

// Compact frozen fixture #1 — kg_id -> current phase, verbatim from 07-OWNERSHIP-OVERLAY.tsv's
// `phase` column (sha256 5a4ecba5b4cff30e10165a5dcc082b862f288475fdd19a7cb317ed31fdd63e0a), in the
// TSV's own row order (kg_id ascending). Independent of the phase-chain fixture below.
const OVERLAY_ROWS = [
  ["KG-001", "P00"], ["KG-002", "P01"], ["KG-003", "P01"], ["KG-004", "P01"], ["KG-005", "P01"],
  ["KG-006", "P01"], ["KG-007", "P02"], ["KG-008", "P02"], ["KG-009", "P02"], ["KG-010", "P02"],
  ["KG-011", "P02"], ["KG-012", "P02"], ["KG-013", "P02"], ["KG-014", "P02"], ["KG-015", "P02"],
  ["KG-016", "P02"], ["KG-017", "P02"], ["KG-018", "P02"], ["KG-019", "P02"], ["KG-020", "P03"],
  ["KG-021", "P03"], ["KG-022", "P03"], ["KG-023", "P03"], ["KG-024", "P03"], ["KG-025", "P03"],
  ["KG-026", "P03"], ["KG-027", "P04"], ["KG-028", "P04"], ["KG-029", "P04"], ["KG-030", "P04"],
  ["KG-031", "P04"], ["KG-032", "P04"], ["KG-033", "P04"], ["KG-034", "P04"], ["KG-035", "P04"],
  ["KG-036", "P04"], ["KG-037", "P04"], ["KG-038", "P04"], ["KG-039", "P04"], ["KG-040", "P04"],
  ["KG-041", "P04"], ["KG-042", "P04"], ["KG-043", "P04"], ["KG-044", "P04"], ["KG-045", "P04"],
  ["KG-046", "P04"], ["KG-047", "P04"], ["KG-048", "P04"], ["KG-049", "P04"], ["KG-050", "P05"],
  ["KG-051", "P05"], ["KG-052", "P05"], ["KG-053", "P05"], ["KG-054", "P05"], ["KG-055", "P05"],
  ["KG-056", "P05"], ["KG-057", "P06"], ["KG-058", "P06"], ["KG-059", "P06"], ["KG-060", "P06"],
  ["KG-061", "P06"], ["KG-062", "P06"], ["KG-063", "P06"], ["KG-064", "P06"], ["KG-065", "P09"],
  ["KG-066", "P09"], ["KG-067", "P09"], ["KG-068", "P09"], ["KG-069", "P09"], ["KG-070", "P09"],
  ["KG-071", "P09"], ["KG-072", "P09"], ["KG-073", "P09"], ["KG-074", "P09"], ["KG-075", "P10"],
  ["KG-076", "P11"], ["KG-077", "P08"], ["KG-078", "P07"], ["KG-079", "P07"], ["KG-080", "P08"],
  ["KG-081", "P11"], ["KG-082", "P10"], ["KG-083", "P08"], ["KG-084", "P01"], ["KG-085", "P12"],
  ["KG-086", "P12"], ["KG-087", "P12"], ["KG-088", "P12"], ["KG-089", "P12"], ["KG-090", "P12"],
];

// Compact frozen fixture #2 — phase id -> ownedGaps.ids, verbatim from 00-PHASE-CHAIN.json
// (sha256 7794df62ef49829f134f742172eb2e6ed32cbc68a140a1ce5f70bdd4c23176c9), each phase's ids in
// the phase object's own array order (not kg_id order). Independent of the overlay fixture above.
const PHASE_CHAIN_OWNED_GAPS = [
  ["P00", ["KG-001"]],
  ["P01", ["KG-003", "KG-002", "KG-004", "KG-005", "KG-006", "KG-084"]],
  ["P02", ["KG-008", "KG-009", "KG-010", "KG-011", "KG-012", "KG-013", "KG-014", "KG-016", "KG-007", "KG-015", "KG-017", "KG-018", "KG-019"]],
  ["P03", ["KG-020", "KG-021", "KG-023", "KG-022", "KG-024", "KG-025", "KG-026"]],
  ["P04", ["KG-027", "KG-029", "KG-030", "KG-031", "KG-028", "KG-033", "KG-032", "KG-034", "KG-035", "KG-037", "KG-038", "KG-039", "KG-040", "KG-041", "KG-036", "KG-042", "KG-043", "KG-044", "KG-045", "KG-046", "KG-047", "KG-048", "KG-049"]],
  ["P05", ["KG-050", "KG-051", "KG-052", "KG-053", "KG-054", "KG-055", "KG-056"]],
  ["P06", ["KG-057", "KG-059", "KG-060", "KG-061", "KG-058", "KG-062", "KG-063", "KG-064"]],
  ["P07", ["KG-078", "KG-079"]],
  ["P08", ["KG-077", "KG-080", "KG-083"]],
  ["P09", ["KG-065", "KG-066", "KG-067", "KG-068", "KG-069", "KG-070", "KG-071", "KG-072", "KG-073", "KG-074"]],
  ["P10", ["KG-075", "KG-082"]],
  ["P11", ["KG-076", "KG-081"]],
  ["P12", ["KG-085", "KG-086", "KG-087", "KG-088", "KG-089", "KG-090"]],
];

const KG_ID_ORDER = Array.from({ length: GAP_COUNT }, (_, i) => `KG-${String(i + 1).padStart(3, "0")}`);

// Derives kg_id -> phase from the overlay fixture, in kg_id order.
function deriveFromOverlay() {
  const byId = new Map(OVERLAY_ROWS);
  const result = {};
  for (const id of KG_ID_ORDER) result[id] = byId.get(id);
  return result;
}

// Derives kg_id -> phase from the phase-chain ownedGaps membership fixture, in kg_id order.
function deriveFromPhaseChain() {
  const byId = new Map();
  for (const [phaseId, ids] of PHASE_CHAIN_OWNED_GAPS) {
    for (const id of ids) byId.set(id, phaseId);
  }
  const result = {};
  for (const id of KG_ID_ORDER) result[id] = byId.get(id);
  return result;
}

const overlayView = deriveFromOverlay();
const phaseChainView = deriveFromPhaseChain();

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function gapRegistryProjectionViolations(projection) {
  if (!isPlainObject(projection)) return ["PROJECTION_MALFORMED"];
  const violations = [];
  const topKeys = Object.keys(projection);
  for (const key of TOP_LEVEL_KEYS) if (!(key in projection)) violations.push(`TOP_LEVEL_FIELD_MISSING:${key}`);
  for (const key of topKeys) if (!TOP_LEVEL_KEYS.includes(key)) violations.push(`TOP_LEVEL_FIELD_EXTRA:${key}`);
  if (projection.gapCount !== GAP_COUNT) violations.push("GAP_COUNT_MISMATCH");
  if (projection.derivationRuleId !== DERIVATION_RULE_ID) violations.push("DERIVATION_RULE_ID_MISMATCH");
  if (projection.derivationRule !== DERIVATION_RULE) violations.push("DERIVATION_RULE_MISMATCH");

  const gapPhase = projection.gapPhase;
  if (!isPlainObject(gapPhase)) {
    violations.push("GAP_PHASE_MALFORMED");
    return violations;
  }
  const keys = Object.keys(gapPhase);
  for (const id of KG_ID_ORDER) if (!(id in gapPhase)) violations.push(`GAP_PHASE_MISSING:${id}`);
  for (const key of keys) {
    if (!KG_PATTERN.test(key)) violations.push(`GAP_PHASE_KEY_FORMAT:${key}`);
    else if (!KG_ID_ORDER.includes(key)) violations.push(`GAP_PHASE_KEY_EXTRA:${key}`);
  }
  for (const [id, phase] of Object.entries(gapPhase)) {
    if (!VALID_PHASES.has(phase)) violations.push(`GAP_PHASE_VALUE_INVALID:${id}:${phase}`);
    else if (KG_ID_ORDER.includes(id) && phase !== overlayView[id]) {
      violations.push(`GAP_PHASE_MAPPING_MISMATCH:${id}:${phase}!=${overlayView[id]}`);
    }
  }
  return violations;
}

test("independent overlay-derived and phase-chain-derived views agree on all 90 gaps", () => {
  assert.equal(Object.keys(overlayView).length, GAP_COUNT);
  assert.equal(Object.keys(phaseChainView).length, GAP_COUNT);
  assert.deepEqual(overlayView, phaseChainView);
});

test("KG-084 current phase is P01 (never its historical phase_original P12)", () => {
  assert.equal(overlayView["KG-084"], "P01");
  assert.equal(phaseChainView["KG-084"], "P01");
});

test("gapRegistryProjection exists on the addendum and passes structural validation with zero findings", () => {
  assert.deepEqual(gapRegistryProjectionViolations(canonicalAddendum.gapRegistryProjection), []);
});

test("addendum gapRegistryProjection.gapPhase equals both independently derived canonical views", () => {
  const actual = canonicalAddendum.gapRegistryProjection.gapPhase;
  assert.deepEqual(actual, overlayView);
  assert.deepEqual(actual, phaseChainView);
});

test("addendum gapCount is 90 and derivationRuleId/derivationRule are exact", () => {
  const projection = canonicalAddendum.gapRegistryProjection;
  assert.equal(projection.gapCount, GAP_COUNT);
  assert.equal(projection.derivationRuleId, DERIVATION_RULE_ID);
  assert.equal(projection.derivationRule, DERIVATION_RULE);
});

test("modelFromAddendum exposes 90 gapPhase entries from the addendum", () => {
  const model = modelFromAddendum(canonicalAddendum);
  assert.equal(Object.keys(model.gapPhase).length, GAP_COUNT);
  assert.deepEqual(model.gapPhase, overlayView);
});

test("adversarial clone: wrong gapCount is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.gapCount = 89;
  assert.ok(gapRegistryProjectionViolations(bad).includes("GAP_COUNT_MISMATCH"));
});

test("adversarial clone: missing gap entry is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  delete bad.gapPhase["KG-050"];
  assert.ok(gapRegistryProjectionViolations(bad).includes("GAP_PHASE_MISSING:KG-050"));
});

test("adversarial clone: extra unknown gap key is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.gapPhase["KG-999"] = "P01";
  assert.ok(gapRegistryProjectionViolations(bad).includes("GAP_PHASE_KEY_EXTRA:KG-999"));
});

test("adversarial clone: malformed kg id key is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  delete bad.gapPhase["KG-001"];
  bad.gapPhase["KG-1"] = "P00";
  assert.ok(gapRegistryProjectionViolations(bad).includes("GAP_PHASE_KEY_FORMAT:KG-1"));
});

test("adversarial clone: out-of-range phase value is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.gapPhase["KG-050"] = "P13";
  assert.ok(gapRegistryProjectionViolations(bad).includes("GAP_PHASE_VALUE_INVALID:KG-050:P13"));
});

test("adversarial clone: KG-084 historical-phase trap (P12 instead of current P01) is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.gapPhase["KG-084"] = "P12";
  const violations = gapRegistryProjectionViolations(bad);
  assert.deepEqual(violations, ["GAP_PHASE_MAPPING_MISMATCH:KG-084:P12!=P01"]);
  assert.notDeepEqual(bad.gapPhase, overlayView);
  assert.notDeepEqual(bad.gapPhase, phaseChainView);
});

test("adversarial clone: unknown top-level key is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.injected = "unexpected";
  assert.ok(gapRegistryProjectionViolations(bad).includes("TOP_LEVEL_FIELD_EXTRA:injected"));
});

test("adversarial clone: wrong derivationRuleId is detected", () => {
  const bad = clone(canonicalAddendum.gapRegistryProjection);
  bad.derivationRuleId = "DRV-WRONG-V1";
  assert.ok(gapRegistryProjectionViolations(bad).includes("DERIVATION_RULE_ID_MISMATCH"));
});

test("no source/movedGaps/gaps array top-level keys are present on gapRegistryProjection", () => {
  const projection = canonicalAddendum.gapRegistryProjection;
  assert.equal("source" in projection, false);
  assert.equal("movedGaps" in projection, false);
  assert.equal("gaps" in projection, false);
});
