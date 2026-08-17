import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEMANTICS_ID,
  BACKWARD_REFUSED,
  HUMAN_GATE_REQUIRED_DECISION_STATE,
  HUMAN_GATE_BLOCKING_DECISION_STATES,
  CANONICAL_SEPARATION,
  semanticContractViolations,
  nonAuthorizationViolations,
  addendumContractViolations,
} from "../tools/check-p01-closure-semantics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addendumPath = path.join(__dirname, "..", "planning", "p01-closure-semantics-addendum.json");
const canonicalAddendum = JSON.parse(readFileSync(addendumPath, "utf8"));
const clone = (value) => structuredClone(value);
const SEMANTIC_KEYS = ["separation", "classifications", "humanGatePolicy", "successorAdmission", "appendOnly"];
const SIMULATION_FLAGS = [
  "simulationMayAssumeGateSatisfiable",
  "simulationAssumptionCountsAsSatisfaction",
  "simulationSignsAnything",
  "simulationClosesAnyHumanDecision",
  "simulationProducesRealReceipt",
];
const EXTRA_KEY_CASES = [
  ["separation", "SEPARATION_FIELD_EXTRA"],
  ["successorAdmission", "SUCCESSOR_ADMISSION_FIELD_EXTRA"],
  ["appendOnly", "APPEND_ONLY_FIELD_EXTRA"],
  ["humanGatePolicy", "HUMAN_GATE_POLICY_FIELD_EXTRA"],
];

test("exported constants are the canonical identifiers", () => {
  assert.equal(SEMANTICS_ID, "P01-CLOSURE-SEMANTICS-V1");
  assert.equal(BACKWARD_REFUSED, "BACKWARD_REFUSED");
  assert.equal(HUMAN_GATE_REQUIRED_DECISION_STATE, "SATISFIED");
  assert.deepEqual([...HUMAN_GATE_BLOCKING_DECISION_STATES].sort(), ["HUMAN_DECISION_REQUIRED", "OPEN", "UNANSWERED", "UNSATISFIED"]);
  assert.ok(!HUMAN_GATE_BLOCKING_DECISION_STATES.includes(HUMAN_GATE_REQUIRED_DECISION_STATE));
  assert.equal(typeof CANONICAL_SEPARATION.rule, "string");
});

test("addendum nests every semantic block under semantics; no shadow keys; addendumContractViolations is zero", () => {
  for (const key of SEMANTIC_KEYS) assert.ok(!(key in canonicalAddendum), `top-level "${key}" must not shadow semantics.${key}`);
  for (const key of SEMANTIC_KEYS) assert.ok(key in canonicalAddendum.semantics, `semantics.${key} must exist`);
  assert.equal(canonicalAddendum.capabilityDelta, "NONE");
  assert.deepEqual(addendumContractViolations(canonicalAddendum), []);
});

test("addendumContractViolations composes both validators and catches capabilityDelta drift", () => {
  const granted = clone(canonicalAddendum);
  granted.capabilityDelta = "SOME_CAPABILITY";
  assert.ok(addendumContractViolations(granted).includes("CAPABILITY_DELTA_MISMATCH"));
  const brokenSemantics = clone(canonicalAddendum);
  delete brokenSemantics.semantics.id;
  assert.ok(addendumContractViolations(brokenSemantics).includes("SEMANTICS_ID_MISMATCH"));
});

test("semanticContractViolations rejects an injected unknown key in separation/successorAdmission/appendOnly/humanGatePolicy", () => {
  for (const [blockKey, code] of EXTRA_KEY_CASES) {
    const mutated = clone(canonicalAddendum.semantics);
    mutated[blockKey].injected = "unexpected";
    assert.ok(semanticContractViolations(mutated).includes(`${code}:injected`), blockKey);
  }
});

test("semanticContractViolations flags a missing/wrong id and a core separation inversion", () => {
  const missing = clone(canonicalAddendum.semantics);
  delete missing.id;
  const wrong = clone(canonicalAddendum.semantics);
  wrong.id = "P01-CLOSURE-SEMANTICS-V2";
  for (const bad of [missing, wrong]) assert.ok(semanticContractViolations(bad).includes("SEMANTICS_ID_MISMATCH"));
  const inverted = clone(canonicalAddendum.semantics);
  const { phaseReceipt, gapFinalClosure } = inverted.separation;
  inverted.separation.phaseReceipt = gapFinalClosure;
  inverted.separation.gapFinalClosure = phaseReceipt;
  const findings = semanticContractViolations(inverted);
  assert.ok(findings.includes("SEPARATION_FIELD_MISMATCH:phaseReceipt"));
  assert.ok(findings.includes("SEPARATION_FIELD_MISMATCH:gapFinalClosure"));
});

test("semanticContractViolations flags every human-gate state/actor/blocking-set drift", () => {
  const wrongState = clone(canonicalAddendum.semantics);
  wrongState.humanGatePolicy.realDischargeRequiredDecisionState = "APPROVED";
  assert.ok(semanticContractViolations(wrongState).includes("HUMAN_GATE_REQUIRED_DECISION_STATE_MISMATCH"));
  const wrongAuthority = clone(canonicalAddendum.semantics);
  wrongAuthority.humanGatePolicy.decisionAuthority = "any reviewer";
  assert.ok(semanticContractViolations(wrongAuthority).includes("HUMAN_GATE_DECISION_AUTHORITY_MISMATCH"));
  const missing = clone(canonicalAddendum.semantics);
  missing.humanGatePolicy.realDischargeBlockingDecisionStates = missing.humanGatePolicy.realDischargeBlockingDecisionStates.slice(1);
  assert.ok(semanticContractViolations(missing).some((v) => v.startsWith("HUMAN_GATE_BLOCKING_STATE_MISSING:")));
  const extra = clone(canonicalAddendum.semantics);
  extra.humanGatePolicy.realDischargeBlockingDecisionStates.push("REVIEW");
  assert.ok(semanticContractViolations(extra).includes("HUMAN_GATE_BLOCKING_STATE_EXTRA:REVIEW"));
  const duplicate = clone(canonicalAddendum.semantics);
  duplicate.humanGatePolicy.realDischargeBlockingDecisionStates.push(duplicate.humanGatePolicy.realDischargeBlockingDecisionStates[0]);
  assert.ok(semanticContractViolations(duplicate).some((v) => v.startsWith("HUMAN_GATE_BLOCKING_STATE_DUPLICATE:")));
});

test("semanticContractViolations flags every human-gate simulation boolean inversion", () => {
  for (const flag of SIMULATION_FLAGS) {
    const inverted = clone(canonicalAddendum.semantics);
    inverted.humanGatePolicy[flag] = !inverted.humanGatePolicy[flag];
    assert.ok(semanticContractViolations(inverted).includes(`HUMAN_GATE_SIMULATION_FIELD_MISMATCH:${flag}`), flag);
  }
});

test("semanticContractViolations flags classification field drift and a missing classification", () => {
  for (const field of ["definition", "discharge", "sourceGapStatusAtSourceReceipt"]) {
    const drifted = clone(canonicalAddendum.semantics);
    drifted.classifications.FORWARD_DEFERRED[field] = "drifted";
    assert.ok(semanticContractViolations(drifted).includes(`CLASSIFICATION_FIELD_MISMATCH:FORWARD_DEFERRED:${field}`));
  }
  const missingDischargedBy = clone(canonicalAddendum.semantics);
  delete missingDischargedBy.classifications.FORWARD_DEFERRED.dischargedBy;
  assert.ok(semanticContractViolations(missingDischargedBy).includes("CLASSIFICATION_FIELD_MISSING:FORWARD_DEFERRED:dischargedBy"));
  const wrongAdmitted = clone(canonicalAddendum.semantics);
  wrongAdmitted.classifications.BACKWARD_REFUSED.admitted = true;
  assert.ok(semanticContractViolations(wrongAdmitted).includes("CLASSIFICATION_FIELD_MISMATCH:BACKWARD_REFUSED:admitted"));
  const missingClassification = clone(canonicalAddendum.semantics);
  delete missingClassification.classifications.BACKWARD_REFUSED;
  assert.ok(semanticContractViolations(missingClassification).includes("CLASSIFICATION_MISSING:BACKWARD_REFUSED"));
});

test("semanticContractViolations flags append-only and successor-admission drift, including noSkip", () => {
  const rewritten = clone(canonicalAddendum.semantics);
  rewritten.appendOnly.sourcePhaseReceiptRewritten = true;
  assert.ok(semanticContractViolations(rewritten).includes("APPEND_ONLY_FIELD_MISMATCH:sourcePhaseReceiptRewritten"));
  const skip = clone(canonicalAddendum.semantics);
  skip.successorAdmission.noSkip = false;
  assert.ok(semanticContractViolations(skip).includes("SUCCESSOR_ADMISSION_FIELD_MISMATCH:noSkip"));
});

test("nonAuthorizationViolations flags reordering, rewording, missing, and duplicates against the exact six entries", () => {
  assert.equal(canonicalAddendum.nonAuthorizations[0], "No RCPT-01 is produced, and this package does not authorise P01 entry.");
  assert.equal(canonicalAddendum.nonAuthorizations[5], "This package is not reviewed by the session that wrote it.");
  const reordered = clone(canonicalAddendum.nonAuthorizations);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const reorderedFindings = nonAuthorizationViolations(reordered);
  assert.ok(reorderedFindings.includes("NON_AUTHORIZATION_MISMATCH:0"));
  assert.ok(reorderedFindings.includes("NON_AUTHORIZATION_MISMATCH:1"));
  const reworded = clone(canonicalAddendum.nonAuthorizations);
  reworded[0] = "No RCPT-01 is produced for P01.";
  assert.ok(nonAuthorizationViolations(reworded).includes("NON_AUTHORIZATION_MISMATCH:0"));
  const duplicated = clone(canonicalAddendum.nonAuthorizations);
  duplicated.push(duplicated[0]);
  const duplicatedFindings = nonAuthorizationViolations(duplicated);
  assert.ok(duplicatedFindings.some((v) => v.startsWith("NON_AUTHORIZATIONS_LENGTH_MISMATCH:")));
  assert.ok(duplicatedFindings.some((v) => v.startsWith("NON_AUTHORIZATION_DUPLICATE:")));
});

test("both validators never mutate input and fail closed without throwing", () => {
  const frozenSemantics = clone(canonicalAddendum.semantics);
  const semanticsSnapshot = clone(frozenSemantics);
  semanticContractViolations(frozenSemantics);
  assert.deepEqual(frozenSemantics, semanticsSnapshot);
  const frozenAddendum = clone(canonicalAddendum);
  const addendumSnapshot = clone(frozenAddendum);
  addendumContractViolations(frozenAddendum);
  assert.deepEqual(frozenAddendum, addendumSnapshot);
  assert.doesNotThrow(() => semanticContractViolations(null));
  assert.doesNotThrow(() => semanticContractViolations("not-an-object"));
  assert.ok(semanticContractViolations(null).length > 0);
  assert.ok(semanticContractViolations({}).length > 0);
  assert.doesNotThrow(() => nonAuthorizationViolations(null));
  assert.deepEqual(nonAuthorizationViolations(null), ["NON_AUTHORIZATIONS_MALFORMED"]);
  assert.doesNotThrow(() => addendumContractViolations(null));
  assert.deepEqual(addendumContractViolations(null), ["ADDENDUM_MALFORMED"]);
});
