import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerRelative = "tools/check-p01-architecture-candidate.mjs";
const checkerUrl = pathToFileURL(path.join(root, checkerRelative)).href;

// =====================================================================================
// P01-W1 architecture decision candidate — the RED specification
//
// This is candidate preparation, not P01 exit. The package it specifies may recommend a route
// and may not select one. Everything below exists to make that distinction machine-enforced
// rather than promised in prose, because a decision packet that can quietly promote itself into
// a decision is the one failure mode that would matter here: it would answer, in a model's
// voice, the two questions the phase chain reserves for a human signature — KG-002 canonical
// runtime and KG-003 canonical ownership and extraction boundary.
//
// Six independent read-only Claude analyses stand behind the option register, pinned by path,
// byte count and SHA-256 rather than summarised on trust. Their neutral synthesis is that S1
// (Node canonical, Python adapter) is CONDITIONAL but opens a cross-process tenant/security
// boundary before the phase that builds the policy decision point; that S2 (Python canonical,
// FastAPI as Delivery host only, Node frozen as a conformance reference) is CONDITIONAL and
// carries the lowest lifecycle cost, and is what the security comparator prefers because no
// permanent cross-runtime claim boundary is opened; and that S3, a permanent dual runtime with
// two co-equal write paths, is REJECT.
//
// The candidate may carry S2 as its recommendation. It may not carry it as an answer.
//
// Every assertion in this file was RED before `tools/check-p01-architecture-candidate.mjs`,
// `planning/p01-architecture-decision-candidate.json`,
// `planning/p01-architecture-decision.schema.json` and
// `planning/p01-ring-ownership-candidate.json` existed. The adversarial sections are the
// substance: each one takes the real document, applies one mutation a careless or motivated
// writer could plausibly make, and requires a named finding. A checker that only agrees with a
// correct document has measured nothing.
// =====================================================================================

const imported = await import(checkerUrl).then(
  (module) => ({ module }),
  (error) => ({ error }),
);

/** The checker, or a failure that names the missing package rather than a bare module error. */
function api() {
  assert.equal(
    imported.error,
    undefined,
    `${checkerRelative} must exist and be importable: ${imported.error?.message ?? ""}`,
  );
  return imported.module;
}

function readJson(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return null;
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function readText(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute, "utf8");
}

const CANDIDATE_PATH = "planning/p01-architecture-decision-candidate.json";
const SCHEMA_PATH = "planning/p01-architecture-decision.schema.json";
const RING_PATH = "planning/p01-ring-ownership-candidate.json";
const DOC_PATH = "docs/p01-architecture-decision-candidate.md";

const candidateDocument = readJson(CANDIDATE_PATH);
const schemaDocument = readJson(SCHEMA_PATH);
const ringDocument = readJson(RING_PATH);

/** A deep copy, so a mutation probing the contract can never rewrite the contract it probes. */
function candidate() {
  assert.notEqual(candidateDocument, null, `${CANDIDATE_PATH} must exist`);
  return structuredClone(candidateDocument);
}

function ring() {
  assert.notEqual(ringDocument, null, `${RING_PATH} must exist`);
  return structuredClone(ringDocument);
}

/** Every finding whose head matches `prefix`, so an assertion names a rule rather than a string. */
function withPrefix(findings, prefix) {
  return findings.filter((finding) => finding.startsWith(prefix));
}

function assertFinding(findings, prefix, message) {
  assert.ok(
    withPrefix(findings, prefix).length > 0,
    `${message}\n  expected a finding starting ${prefix}\n  got: ${JSON.stringify(findings)}`,
  );
}

// -------------------------------------------------------------------------------------
// 1. The documents exist and are what they claim to be
// -------------------------------------------------------------------------------------

test("the four candidate artifacts exist", () => {
  for (const relative of [CANDIDATE_PATH, SCHEMA_PATH, RING_PATH, DOC_PATH]) {
    assert.ok(existsSync(path.join(root, relative)), `${relative} must exist`);
  }
});

test("the checker is pure: no write or process API appears in its source", () => {
  const source = readText(checkerRelative);
  assert.notEqual(source, null, `${checkerRelative} must exist`);
  for (const forbidden of [
    "writeFile",
    "appendFile",
    "createWriteStream",
    "mkdir",
    "rmSync",
    "unlink",
    "rename",
    "copyFile",
    "execSync",
    "execFileSync",
    "spawnSync",
    "spawn(",
  ]) {
    assert.equal(source.includes(forbidden), false, `the checker must not reference ${forbidden}`);
  }
});

test("the checker is import-safe: importing it runs no check and exits nothing", () => {
  const source = readText(checkerRelative);
  assert.ok(
    source.includes("process.argv[1] === fileURLToPath(import.meta.url)"),
    "the CLI must be guarded so importing the module performs no run",
  );
  assert.equal(process.exitCode, undefined, "importing the checker must not set an exit code");
});

test("a clean tree is GREEN and reports elapsed time without inventing a threshold", () => {
  const report = api().runCheck(root);
  assert.deepEqual(report.findings, [], "the committed package must be GREEN");
  assert.equal(typeof report.summary.elapsedMs, "number");
  assert.ok(Number.isFinite(report.summary.elapsedMs) && report.summary.elapsedMs >= 0);
  assert.equal(
    report.summary.performanceThresholdMs,
    null,
    "no production performance threshold may be invented here",
  );
  assert.equal(report.summary.buildBudgetBaseline, "PENDING");
});

// -------------------------------------------------------------------------------------
// 2. The decision state — the boundary this whole package exists to hold
// -------------------------------------------------------------------------------------

test("the committed candidate is unsigned, unselected and not effective", () => {
  const document = candidate();
  assert.equal(document.decision.decisionState, "HUMAN_DECISION_REQUIRED");
  assert.equal(document.decision.effective, false);
  assert.equal(document.decision.selectedOption, null);
  assert.equal(document.decision.selectedBy, null);
  assert.equal(document.decision.signature, null);
  assert.equal(document.decision.signerId, null);
  assert.equal(document.decision.signedOn, null);
  assert.equal(document.decision.decisionAuthority, "authorized human");
  assert.equal(document.decision.recommendedOption, "S2");
  assert.equal(document.decision.recommendationIsSelection, false);
  assert.equal(document.decision.modelMaySelect, false);
  assert.equal(document.decision.modelMaySign, false);
  assert.equal(document.decision.producesReceipt, false);
  assert.equal(document.decision.receiptId, null);
  assert.equal(document.decision.closesAnyGap, false);
  assert.equal(document.decision.satisfiesExitGate, false);
});

test("ADVERSARIAL: a model-selected decision is refused", () => {
  const document = candidate();
  document.decision.selectedOption = "S2";
  document.decision.selectedBy = "claude-opus-5";
  document.decision.modelMaySelect = true;
  const findings = api().decisionViolations(document);
  assertFinding(findings, "OPTION_SELECTED", "a selected option must be a finding");
  assertFinding(findings, "SIGNATURE_FIELD_PRESENT:selectedBy", "a selector must be a finding");
  assertFinding(findings, "MODEL_MAY_SELECT", "model self-selection must be a finding");
});

test("ADVERSARIAL: a pre-signed decision is refused", () => {
  const document = candidate();
  document.decision.signature = "0".repeat(64);
  document.decision.signerId = "ismail-karaca";
  document.decision.signedOn = "2026-08-11";
  document.decision.modelMaySign = true;
  const findings = api().decisionViolations(document);
  for (const field of ["signature", "signerId", "signedOn"]) {
    assertFinding(findings, `SIGNATURE_FIELD_PRESENT:${field}`, `a ${field} must be a finding`);
  }
  assertFinding(findings, "MODEL_MAY_SIGN", "a model signing permission must be a finding");
});

test("ADVERSARIAL: effective=true is refused", () => {
  const document = candidate();
  document.decision.effective = true;
  assertFinding(
    api().decisionViolations(document),
    "EFFECTIVE_CLAIMED",
    "an effective candidate must be a finding",
  );
});

test("ADVERSARIAL: a decision state other than HUMAN_DECISION_REQUIRED is refused", () => {
  for (const state of ["SATISFIED", "CLOSED", "ACCEPTED", "OPEN"]) {
    const document = candidate();
    document.decision.decisionState = state;
    assertFinding(
      api().decisionViolations(document),
      "DECISION_STATE",
      `decisionState=${state} must be a finding`,
    );
  }
});

test("ADVERSARIAL: recommendation dressed as selection is refused", () => {
  const document = candidate();
  document.decision.recommendationIsSelection = true;
  assertFinding(
    api().decisionViolations(document),
    "RECOMMENDATION_IS_SELECTION",
    "a recommendation that calls itself a selection must be a finding",
  );
});

test("ADVERSARIAL: an issued receipt, a closed gap or a satisfied exit gate is refused", () => {
  const receipt = candidate();
  receipt.decision.producesReceipt = true;
  receipt.decision.receiptId = "RCPT-01";
  const receiptFindings = api().decisionViolations(receipt);
  assertFinding(receiptFindings, "RECEIPT_CLAIMED", "an issued receipt must be a finding");
  assertFinding(receiptFindings, "RECEIPT_ID_PRESENT", "an RCPT-01 id must be a finding");

  const closed = candidate();
  closed.decision.closesAnyGap = true;
  assertFinding(api().decisionViolations(closed), "CLOSED_GAP_CLAIMED", "a CLOSED gap is refused");

  const exit = candidate();
  exit.decision.satisfiesExitGate = true;
  assertFinding(api().decisionViolations(exit), "EXIT_GATE_CLAIMED", "EXIT-01 is not satisfied here");
});

test("the two human decision records stay OPEN and are named", () => {
  const document = candidate();
  const ids = document.decision.openHumanDecisionRecords.map((record) => record.id);
  assert.ok(ids.includes("HD-RUNTIME-ADR"), "the KG-002 runtime ADR request must stay open");
  assert.ok(ids.includes("HD-TOPOLOGY-EXTRACTION-ADR"), "the KG-003 topology request must stay open");
  for (const record of document.decision.openHumanDecisionRecords) {
    assert.equal(record.state, "OPEN", `${record.id} must be OPEN`);
  }
});

test("ADVERSARIAL: answering a human decision record is refused", () => {
  const document = candidate();
  document.decision.openHumanDecisionRecords[0].state = "SATISFIED";
  assertFinding(
    api().decisionViolations(document),
    "HUMAN_DECISION_RECORD_NOT_OPEN",
    "a closed human decision record must be a finding",
  );
});

// -------------------------------------------------------------------------------------
// 3. The option register — three routes, one rejection, no self-promotion
// -------------------------------------------------------------------------------------

test("all three options are recorded with every required dimension", () => {
  const document = candidate();
  assert.deepEqual(
    document.options.map((option) => option.id),
    ["S1", "S2", "S3"],
  );
  for (const option of document.options) {
    for (const field of [
      "security",
      "compatibility",
      "migration",
      "historyPreservation",
      "codeRollback",
      "dataRollback",
      "operationalCost",
      "verdict",
    ]) {
      assert.ok(
        typeof option[field] === "string" && option[field].length > 0,
        `${option.id} must record ${field}`,
      );
    }
    assert.equal(option.costBasis, "relative-and-evidence");
  }
  assert.equal(document.options.find((option) => option.id === "S3").verdict, "REJECT");
  assert.equal(document.options.find((option) => option.id === "S1").verdict, "CONDITIONAL");
  assert.equal(document.options.find((option) => option.id === "S2").verdict, "CONDITIONAL");
});

test("the rejected option carries rejection reasons and the conditional ones carry conditions", () => {
  const document = candidate();
  const s3 = document.options.find((option) => option.id === "S3");
  assert.ok(s3.rejectionReasons.length > 0, "S3 must say why it is rejected");
  for (const id of ["S1", "S2"]) {
    const option = document.options.find((candidateOption) => candidateOption.id === id);
    assert.ok(option.conditions.length > 0, `${id} must record its conditions`);
  }
});

test("ADVERSARIAL: recommending S3, the permanent dual runtime, is refused", () => {
  const document = candidate();
  document.decision.recommendedOption = "S3";
  const findings = api().optionRegisterViolations(document);
  assertFinding(
    findings,
    "RECOMMENDATION_PERMANENT_DUAL_RUNTIME",
    "a permanent dual-runtime recommendation must be a finding",
  );
  assertFinding(findings, "RECOMMENDATION_REJECTED_OPTION", "a REJECT option may not be recommended");
});

test("ADVERSARIAL: softening S3 from REJECT is refused", () => {
  const document = candidate();
  document.options.find((option) => option.id === "S3").verdict = "CONDITIONAL";
  assertFinding(
    api().optionRegisterViolations(document),
    "OPTION_VERDICT:S3",
    "S3 must stay REJECT",
  );
});

test("ADVERSARIAL: dropping an option from the register is refused", () => {
  const document = candidate();
  document.options = document.options.filter((option) => option.id !== "S1");
  assertFinding(api().optionRegisterViolations(document), "OPTION_SET", "all three options are required");
});

test("ADVERSARIAL: an invented monetary estimate anywhere in the document is refused", () => {
  const money = candidate();
  money.options.find((option) => option.id === "S2").operationalCost =
    "about 250000 USD of migration effort";
  assertFinding(
    api().monetaryEstimateViolations(money),
    "MONETARY_ESTIMATE",
    "a currency estimate must be a finding",
  );
  assert.deepEqual(
    api().monetaryEstimateViolations(candidate()),
    [],
    "the committed document must contain no monetary estimate",
  );
});

// -------------------------------------------------------------------------------------
// 4. The recommended target — what S2 is, and what it may never become
// -------------------------------------------------------------------------------------

test("the recommended target assigns the inner rings to Python and FastAPI to Delivery only", () => {
  const document = candidate();
  const target = document.recommendedTarget;
  assert.equal(target.optionId, "S2");
  assert.equal(target.appliesOnlyAfterHumanSignature, true);
  assert.equal(target.ringOwners.Domain, "python");
  assert.equal(target.ringOwners.Application, "python");
  assert.equal(target.ringOwners.Adapters, "python");
  assert.equal(target.ringOwners.Delivery, "python");
  assert.equal(target.fastapi.role, "delivery-host-only");
  assert.deepEqual(target.fastapi.permittedRings, ["Delivery"]);
  assert.deepEqual(target.fastapi.forbiddenRings, ["Domain", "Application"]);
});

test("FastAPI is denied every kernel identity by name", () => {
  const document = candidate();
  for (const field of [
    "isPolicyDecisionPoint",
    "isPolicyEngine",
    "isDomainModel",
    "isWorkflowEngine",
    "isMetadataEngine",
    "isSdk",
    "isUi",
    "isProductCapability",
    "isKernelCapability",
  ]) {
    assert.equal(document.recommendedTarget.fastapi[field], false, `fastapi.${field} must be false`);
  }
});

test("ADVERSARIAL: FastAPI inside Domain or Application is refused", () => {
  for (const ringName of ["Domain", "Application"]) {
    const document = candidate();
    document.recommendedTarget.fastapi.permittedRings = ["Delivery", ringName];
    assertFinding(
      api().targetAssignmentViolations(document),
      `FASTAPI_RING:${ringName}`,
      `FastAPI in the ${ringName} ring must be a finding`,
    );
  }
});

test("ADVERSARIAL: FastAPI counted as a kernel capability is refused", () => {
  const document = candidate();
  document.recommendedTarget.fastapi.isKernelCapability = true;
  assertFinding(
    api().targetAssignmentViolations(document),
    "FASTAPI_CLAIM:isKernelCapability",
    "FastAPI as kernel capability must be a finding",
  );
});

test("ADVERSARIAL: a Domain or Application import of a web framework is refused", () => {
  const document = candidate();
  document.recommendedTarget.innerRingForbiddenImports.Domain = ["starlette"];
  const findings = api().targetAssignmentViolations(document);
  assertFinding(
    findings,
    "INNER_RING_IMPORT_PERMITTED:Domain:fastapi",
    "dropping fastapi from the Domain refusal list must be a finding",
  );
  assertFinding(
    findings,
    "INNER_RING_IMPORT_PERMITTED:Domain:pydantic",
    "dropping pydantic from the Domain refusal list must be a finding",
  );
});

test("Node keeps zero write authority and dual write is refused outright", () => {
  const document = candidate();
  assert.equal(document.recommendedTarget.node.writeAuthority, "none");
  assert.equal(document.recommendedTarget.node.role, "frozen-conformance-reference-client");
  assert.equal(document.recommendedTarget.node.dualWrite, false);
  assert.equal(document.recommendedTarget.node.frozen, true);
});

test("ADVERSARIAL: Node writer authority is refused", () => {
  const document = candidate();
  document.recommendedTarget.node.writeAuthority = "shared";
  assertFinding(
    api().targetAssignmentViolations(document),
    "NODE_WRITE_AUTHORITY",
    "Node write authority must be a finding",
  );
});

test("ADVERSARIAL: dual-write mode is refused", () => {
  const document = candidate();
  document.recommendedTarget.node.dualWrite = true;
  assertFinding(
    api().targetAssignmentViolations(document),
    "DUAL_WRITE",
    "dual write must be a finding",
  );
});

test("no permanent process, API or FFI boundary is created, and no claim crosses before P04", () => {
  const document = candidate();
  const boundary = document.recommendedTarget.crossRuntime;
  assert.equal(boundary.permanentProcessBoundary, false);
  assert.equal(boundary.permanentApiBoundary, false);
  assert.equal(boundary.permanentFfiBoundary, false);
  assert.equal(boundary.tenantClaimCrossesRuntimeBeforeP04, false);
  assert.equal(boundary.authClaimCrossesRuntimeBeforeP04, false);
});

test("ADVERSARIAL: a permanent cross-runtime boundary is refused", () => {
  for (const field of [
    "permanentProcessBoundary",
    "permanentApiBoundary",
    "permanentFfiBoundary",
  ]) {
    const document = candidate();
    document.recommendedTarget.crossRuntime[field] = true;
    assertFinding(
      api().targetAssignmentViolations(document),
      `PERMANENT_BOUNDARY:${field}`,
      `${field} must be a finding`,
    );
  }
});

test("ADVERSARIAL: a tenant claim crossing into a second runtime before P04 is refused", () => {
  const document = candidate();
  document.recommendedTarget.crossRuntime.tenantClaimCrossesRuntimeBeforeP04 = true;
  assertFinding(
    api().targetAssignmentViolations(document),
    "CLAIM_CROSSES_RUNTIME:tenant",
    "a pre-P04 tenant claim crossing must be a finding",
  );
});

test("the cross-language truth is versioned contract fixtures, and SDKs derive from them", () => {
  const document = candidate();
  assert.equal(document.recommendedTarget.contractTruth.crossLanguageTruth, "versioned-contract-fixtures-ir");
  assert.equal(document.recommendedTarget.contractTruth.isOnlyCrossLanguageTruth, true);
  assert.equal(document.recommendedTarget.contractTruth.sdkProjectionsDeriveFromIr, true);
  assert.equal(document.recommendedTarget.contractTruth.builtByThisPackage, false);
});

// -------------------------------------------------------------------------------------
// 5. Migration, rollback and the honest pending state
// -------------------------------------------------------------------------------------

test("the migration plan is non-destructive, parity-first and signature-gated", () => {
  const document = candidate();
  const migration = document.migration;
  assert.equal(migration.mode, "in-repo-staged-parity-then-cutover");
  assert.equal(migration.destructiveMigrationInThisPackage, false);
  assert.equal(migration.dataDowngradeInThisPackage, false);
  assert.equal(migration.dualWrite, false);
  assert.equal(migration.parityFixturesBeforeCutover, true);
  assert.equal(migration.nodeBaselineRetainedUntilIndependentParity, true);
  assert.equal(migration.cutoverRequiresHumanSignature, true);
  assert.equal(migration.gitHistoryPreserved, true);
  assert.equal(migration.sourceExtraction, false);
});

test("code rollback and data rollback are separate, and data rollback is honestly pending", () => {
  const document = candidate();
  assert.notEqual(document.migration.codeRollback, document.migration.dataRollback);
  assert.equal(document.migration.dataRollback.exercised, false);
  assert.equal(document.migration.dataRollback.state, "PENDING");
  assert.ok(document.migration.codeRollback.route.length > 0);
  assert.ok(document.migration.dataRollback.route.length > 0);
});

test("ADVERSARIAL: claiming the data rollback was exercised is refused", () => {
  const document = candidate();
  document.migration.dataRollback.exercised = true;
  document.migration.dataRollback.state = "VERIFIED";
  const findings = api().migrationViolations(document);
  assertFinding(findings, "DATA_ROLLBACK_EXERCISED", "an unexercised drill may not be claimed");
  assertFinding(findings, "DATA_ROLLBACK_STATE", "the data rollback state must stay PENDING");
});

test("ADVERSARIAL: a destructive migration or a data downgrade is refused", () => {
  const destructive = candidate();
  destructive.migration.destructiveMigrationInThisPackage = true;
  assertFinding(api().migrationViolations(destructive), "DESTRUCTIVE_MIGRATION", "refused");

  const downgrade = candidate();
  downgrade.migration.dataDowngradeInThisPackage = true;
  assertFinding(api().migrationViolations(downgrade), "DATA_DOWNGRADE", "refused");
});

test("ADVERSARIAL: cutover without parity fixtures or without a signature is refused", () => {
  const parity = candidate();
  parity.migration.parityFixturesBeforeCutover = false;
  assertFinding(api().migrationViolations(parity), "PARITY_FIXTURES", "parity must precede cutover");

  const unsigned = candidate();
  unsigned.migration.cutoverRequiresHumanSignature = false;
  assertFinding(api().migrationViolations(unsigned), "CUTOVER_WITHOUT_SIGNATURE", "refused");
});

test("the kill and pivot triggers cover parity, security, cost and determinism", () => {
  const document = candidate();
  const ids = document.migration.killTriggers.map((trigger) => trigger.id);
  for (const required of [
    "KT-PARITY-FAILURE",
    "KT-SECURITY-BOUNDARY-VIOLATION",
    "KT-UNACCEPTABLE-MEASURED-COST",
    "KT-DETERMINISM-OR-AI-OFF-LOSS",
  ]) {
    assert.ok(ids.includes(required), `${required} must be a recorded kill trigger`);
  }
});

test("ADVERSARIAL: dropping a kill trigger is refused", () => {
  const document = candidate();
  document.migration.killTriggers = document.migration.killTriggers.filter(
    (trigger) => trigger.id !== "KT-DETERMINISM-OR-AI-OFF-LOSS",
  );
  assertFinding(
    api().migrationViolations(document),
    "KILL_TRIGGER_MISSING:KT-DETERMINISM-OR-AI-OFF-LOSS",
    "a dropped kill trigger must be a finding",
  );
});

// -------------------------------------------------------------------------------------
// 6. The current effective state, the Node baseline, and source authority
// -------------------------------------------------------------------------------------

test("the current effective state is recorded separately from the recommended target", () => {
  const document = candidate();
  const current = document.currentEffectiveState;
  assert.equal(current.canonicalRuntimeDecided, false);
  assert.equal(current.nodeSurfaces, "src/domain and src/application, framework-free .mjs modules");
  assert.equal(current.pythonSubstrateRole, "S1 persistence substrate");
  assert.equal(current.adaptersRingExists, false);
  assert.equal(current.deliveryRingExists, false);
  assert.equal(current.sdkRingExists, false);
  assert.equal(current.fastapiInstalled, false);
  assert.equal(current.fastapiShipped, false);
});

test("ADVERSARIAL: claiming FastAPI is installed or an Adapters ring exists is refused", () => {
  const installed = candidate();
  installed.currentEffectiveState.fastapiInstalled = true;
  assertFinding(api().currentStateViolations(installed), "CURRENT_STATE:fastapiInstalled", "refused");

  const adapters = candidate();
  adapters.currentEffectiveState.adaptersRingExists = true;
  assertFinding(api().currentStateViolations(adapters), "CURRENT_STATE:adaptersRingExists", "refused");
});

test("the seven Node baseline files are pinned and unchanged on disk", () => {
  const document = candidate();
  const baseline = document.currentEffectiveState.nodeBaseline;
  assert.equal(baseline.files.length, 7);
  assert.equal(baseline.changedByThisPackage, false);
  assert.equal(baseline.deletedByThisPackage, false);
  assert.equal(baseline.rewrittenByThisPackage, false);
  for (const file of baseline.files) {
    const absolute = path.join(root, file.path);
    assert.ok(existsSync(absolute), `${file.path} must exist`);
    const bytes = readFileSync(absolute);
    assert.equal(bytes.length, file.bytes, `${file.path} byte count must match the pin`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
      `${file.path} SHA-256 must match the pin`,
    );
  }
});

test("ADVERSARIAL: a changed or missing Node baseline hash is refused", () => {
  const observed = api().observeNodeBaseline(root);

  const drifted = candidate();
  drifted.currentEffectiveState.nodeBaseline.files[0].sha256 = "f".repeat(64);
  assertFinding(
    api().nodeBaselineViolations(drifted, observed),
    "BASELINE_SHA256",
    "a drifted baseline hash must be a finding",
  );

  const dropped = candidate();
  dropped.currentEffectiveState.nodeBaseline.files =
    dropped.currentEffectiveState.nodeBaseline.files.slice(1);
  assertFinding(
    api().nodeBaselineViolations(dropped, observed),
    "BASELINE_FILE_UNDECLARED",
    "an undeclared Node source file must be a finding",
  );

  const invented = candidate();
  invented.currentEffectiveState.nodeBaseline.files.push({
    path: "src/application/does-not-exist.mjs",
    bytes: 1,
    sha256: "a".repeat(64),
  });
  assertFinding(
    api().nodeBaselineViolations(invented, observed),
    "BASELINE_FILE_ABSENT",
    "a pinned file that is not on disk must be a finding",
  );
});

test("ADVERSARIAL: claiming this package changed the Node baseline is refused", () => {
  const document = candidate();
  document.currentEffectiveState.nodeBaseline.changedByThisPackage = true;
  assertFinding(
    api().nodeBaselineViolations(document, api().observeNodeBaseline(root)),
    "BASELINE_CHANGE_CLAIMED",
    "this package changes no Node source",
  );
});

test("sourceExtraction=false is machine-checked against the repository authority files", () => {
  const document = candidate();
  assert.equal(document.sourceAuthority.sourceExtraction, false);
  assert.equal(document.sourceAuthority.sourceMoveAuthorized, false);
  assert.equal(document.sourceAuthority.repositorySplitAuthorized, false);
  assert.equal(document.sourceAuthority.extractionAuthorized, false);

  const facts = api().readRepositoryAuthority(root);
  assert.equal(facts.sourceExtraction, false, "repository-status.json must still say false");
  assert.deepEqual(
    api().sourceAuthorityViolations(document, facts),
    [],
    "the committed document must agree with the repository authority",
  );
});

test("ADVERSARIAL: sourceExtraction=true or an authorized source move is refused", () => {
  const facts = api().readRepositoryAuthority(root);

  const extraction = candidate();
  extraction.sourceAuthority.sourceExtraction = true;
  const extractionFindings = api().sourceAuthorityViolations(extraction, facts);
  assertFinding(extractionFindings, "SOURCE_EXTRACTION", "sourceExtraction must stay false");
  assertFinding(extractionFindings, "SOURCE_EXTRACTION_REPO_DRIFT", "drift from the repo authority");

  for (const field of ["sourceMoveAuthorized", "repositorySplitAuthorized", "extractionAuthorized"]) {
    const document = candidate();
    document.sourceAuthority[field] = true;
    assertFinding(
      api().sourceAuthorityViolations(document, facts),
      `SOURCE_AUTHORIZATION:${field}`,
      `${field} must be a finding`,
    );
  }
});

// -------------------------------------------------------------------------------------
// 7. P01 scope — the six gaps in order and the five closure edges
// -------------------------------------------------------------------------------------

test("P01 owns exactly six gaps in the accepted order", () => {
  const document = candidate();
  assert.deepEqual(document.p01Scope.orderedGaps.map((gap) => gap.id), [
    "KG-003",
    "KG-002",
    "KG-004",
    "KG-005",
    "KG-006",
    "KG-084",
  ]);
  assert.deepEqual(document.p01Scope.orderedGaps.map((gap) => gap.intraSeq), [1, 2, 3, 4, 5, 6]);
});

test("ADVERSARIAL: a missing, extra or reordered P01 gap is refused", () => {
  const reordered = candidate();
  const gaps = reordered.p01Scope.orderedGaps;
  [gaps[0], gaps[1]] = [gaps[1], gaps[0]];
  assertFinding(api().p01ScopeViolations(reordered), "P01_GAP_ORDER", "a reorder must be a finding");

  const missing = candidate();
  missing.p01Scope.orderedGaps = missing.p01Scope.orderedGaps.filter((gap) => gap.id !== "KG-084");
  assertFinding(api().p01ScopeViolations(missing), "P01_GAP_ORDER", "a missing gap must be a finding");

  const extra = candidate();
  extra.p01Scope.orderedGaps.push({ id: "KG-019", intraSeq: 7, title: "smuggled", currentStatus: "ABSENT" });
  assertFinding(api().p01ScopeViolations(extra), "P01_GAP_ORDER", "an extra gap must be a finding");
});

test("the five P01 closure edges are preserved with their accepted endpoints", () => {
  const document = candidate();
  const edges = document.p01Scope.closureEdges;
  assert.deepEqual(edges.map((edge) => edge.edgeId), ["E-002", "E-003", "E-005", "E-152", "E-153"]);
  const byId = new Map(edges.map((edge) => [edge.edgeId, edge]));
  assert.equal(byId.get("E-002").classification, "INTRA_ATOMIC");
  assert.equal(byId.get("E-003").classification, "INTRA_ATOMIC");
  for (const id of ["E-005", "E-152", "E-153"]) {
    assert.equal(byId.get(id).classification, "FORWARD_DEFERRED");
  }
  assert.equal(byId.get("E-005").destinationPhase, "P03");
  assert.equal(byId.get("E-152").destinationPhase, "P02");
  assert.equal(byId.get("E-153").destinationPhase, "P05");
  assert.equal(document.p01Scope.forwardOnly, true);
  assert.equal(
    document.p01Scope.closureSemanticsAuthority,
    "planning/p01-closure-semantics-addendum.json",
  );
});

test("ADVERSARIAL: a wrong closure edge or a wrong destination is refused", () => {
  const swapped = candidate();
  swapped.p01Scope.closureEdges.find((edge) => edge.edgeId === "E-005").destinationPhase = "P01";
  assertFinding(
    api().p01ScopeViolations(swapped),
    "CLOSURE_EDGE_FIELD:E-005:destinationPhase",
    "a rewritten destination must be a finding",
  );

  const dropped = candidate();
  dropped.p01Scope.closureEdges = dropped.p01Scope.closureEdges.filter(
    (edge) => edge.edgeId !== "E-153",
  );
  assertFinding(api().p01ScopeViolations(dropped), "P01_CLOSURE_EDGE_SET", "a dropped edge is refused");

  const invented = candidate();
  invented.p01Scope.closureEdges.push({
    edgeId: "E-999",
    sourceGap: "KG-084",
    destinationGap: "KG-050",
    sourcePhase: "P01",
    destinationPhase: "P05",
    classification: "FORWARD_DEFERRED",
  });
  assertFinding(api().p01ScopeViolations(invented), "P01_CLOSURE_EDGE_SET", "an invented edge is refused");
});

test("ADVERSARIAL: reclassifying a forward edge as intra-atomic is refused", () => {
  const document = candidate();
  document.p01Scope.closureEdges.find((edge) => edge.edgeId === "E-152").classification =
    "INTRA_ATOMIC";
  assertFinding(
    api().p01ScopeViolations(document),
    "CLOSURE_EDGE_FIELD:E-152:classification",
    "a reclassified edge must be a finding",
  );
});

// -------------------------------------------------------------------------------------
// 8. The ring / bounded-context register
// -------------------------------------------------------------------------------------

test("the ring register enforces the target dependency direction", () => {
  const register = ring();
  assert.equal(register.direction, "Domain <- Application <- Adapters <- Delivery");
  assert.deepEqual(register.rings.map((entry) => entry.id), [
    "Domain",
    "Application",
    "Adapters",
    "Delivery",
  ]);
  assert.deepEqual(register.rings.map((entry) => entry.ordinal), [1, 2, 3, 4]);
  assert.deepEqual(register.rings.find((entry) => entry.id === "Domain").mayImport, []);
  assert.deepEqual(register.rings.find((entry) => entry.id === "Application").mayImport, ["Domain"]);
});

test("ADVERSARIAL: an outward ring import is refused", () => {
  const register = ring();
  register.rings.find((entry) => entry.id === "Domain").mayImport = ["Adapters"];
  assertFinding(
    api().ringOwnershipViolations(register),
    "RING_OUTWARD_IMPORT:Domain:Adapters",
    "an outward import must be a finding",
  );
});

test("Surface is an outer composition boundary and not an Onion ring", () => {
  const register = ring();
  assert.equal(register.surface.isOnionRing, false);
  assert.equal(register.surface.kind, "outer-composition-boundary");
  assert.equal(
    register.rings.some((entry) => entry.id === "Surface"),
    false,
    "Surface must not appear in the ring list",
  );
});

test("ADVERSARIAL: Surface represented as an Onion ring is refused", () => {
  const flagged = ring();
  flagged.surface.isOnionRing = true;
  assertFinding(api().ringOwnershipViolations(flagged), "SURFACE_AS_RING", "refused");

  const smuggled = ring();
  smuggled.rings.push({ id: "Surface", ordinal: 5, owner: "python", mayImport: ["Delivery"] });
  assertFinding(api().ringOwnershipViolations(smuggled), "RING_SET", "Surface is not a ring");
});

test("the cross-cutting axes are axes, never rings", () => {
  const register = ring();
  const ids = register.crossCuttingAxes.map((axis) => axis.id);
  for (const required of ["ai", "multi-llm", "archetype-metadata", "module-plugin", "observability"]) {
    assert.ok(ids.includes(required), `${required} must be a recorded cross-cutting axis`);
  }
  for (const axis of register.crossCuttingAxes) {
    assert.equal(axis.isRing, false, `${axis.id} must not be a ring`);
  }
});

test("ADVERSARIAL: a cross-cutting axis promoted to a ring is refused", () => {
  const register = ring();
  register.crossCuttingAxes.find((axis) => axis.id === "ai").isRing = true;
  assertFinding(api().ringOwnershipViolations(register), "AXIS_AS_RING:ai", "refused");
});

test("kernel shared primitives are domain-neutral, and the bounded domains are excluded by name", () => {
  const register = ring();
  const shared = register.kernelSharedPrimitives.map((entry) => entry.id);
  for (const required of [
    "money-value",
    "quantity",
    "unit",
    "party-reference",
    "address-value",
    "document-number",
    "period-time-reference",
  ]) {
    assert.ok(shared.includes(required), `${required} must be a kernel shared primitive`);
  }
  const excluded = register.excludedFromKernelSharedOwnership.map((entry) => entry.id);
  for (const required of [
    "ledger-accounting",
    "inventory-valuation",
    "payment",
    "procurement",
    "order-orchestration",
    "logistics",
    "payroll-hcm",
  ]) {
    assert.ok(excluded.includes(required), `${required} must be excluded from kernel shared ownership`);
  }
  assert.equal(register.archeTypeMetadata.absorbsBoundedDomainInvariants, false);
});

test("ADVERSARIAL: a bounded-domain invariant assigned to shared Kernel ownership is refused", () => {
  const shared = ring();
  shared.kernelSharedPrimitives.push({ id: "payment", title: "payment", rationale: "smuggled" });
  assertFinding(
    api().ringOwnershipViolations(shared),
    "BOUNDED_DOMAIN_IN_SHARED:payment",
    "a bounded domain may not become a shared primitive",
  );

  const owner = ring();
  owner.excludedFromKernelSharedOwnership.find((entry) => entry.id === "ledger-accounting").owner =
    "kernel-shared";
  assertFinding(
    api().ringOwnershipViolations(owner),
    "BOUNDED_DOMAIN_OWNER:ledger-accounting",
    "a bounded domain must be owned by its own bounded context",
  );
});

test("ADVERSARIAL: ArcheType metadata absorbing a bounded-domain invariant is refused", () => {
  const register = ring();
  register.archeTypeMetadata.absorbsBoundedDomainInvariants = true;
  assertFinding(
    api().ringOwnershipViolations(register),
    "ARCHETYPE_ABSORBS_BOUNDED_DOMAIN",
    "refused",
  );
});

test("the delivery and comparison frameworks are named as non-kernel and non-proof", () => {
  const register = ring();
  const ids = register.deliveryAndReferenceSurfaces.map((surface) => surface.id);
  for (const required of ["fastapi", "django", "frappe", "flask", "symfony"]) {
    assert.ok(ids.includes(required), `${required} must be recorded`);
  }
  for (const surface of register.deliveryAndReferenceSurfaces) {
    assert.equal(surface.isKernelSemantics, false, `${surface.id} is not kernel semantics`);
    assert.equal(surface.isProductProof, false, `${surface.id} is not product proof`);
  }
});

test("ADVERSARIAL: a framework claimed as kernel semantics or product proof is refused", () => {
  const semantics = ring();
  semantics.deliveryAndReferenceSurfaces.find((surface) => surface.id === "frappe").isKernelSemantics =
    true;
  assertFinding(api().ringOwnershipViolations(semantics), "SURFACE_AS_KERNEL_SEMANTICS:frappe", "refused");

  const proof = ring();
  proof.deliveryAndReferenceSurfaces.find((surface) => surface.id === "django").isProductProof = true;
  assertFinding(api().ringOwnershipViolations(proof), "SURFACE_AS_PRODUCT_PROOF:django", "refused");
});

// -------------------------------------------------------------------------------------
// 9. Capability delta — the package must keep saying what it is not
// -------------------------------------------------------------------------------------

test("the capability delta is NONE and every readiness flag stays false", () => {
  const document = candidate();
  assert.equal(document.capabilityDelta, "NONE");
  assert.deepEqual(document.newlyBuildableProducts, []);
  assert.equal(document.readinessFlagBinding.mutatesAnyFlag, false);
  for (const flag of [
    "kernelReady",
    "sdkReady",
    "appBuildable",
    "releaseAllowed",
    "deployAllowed",
    "productionAllowed",
    "gapClosed",
  ]) {
    assert.equal(document.readinessFlagBinding.values[flag], false, `${flag} must be false`);
  }
  assert.ok(document.stillNotBuildable.length > 0);
});

test("ADVERSARIAL: a capability, readiness, runtime, SDK, app or product claim is refused", () => {
  const delta = candidate();
  delta.capabilityDelta = "ADDITIVE";
  assertFinding(api().capabilityViolations(delta), "CAPABILITY_DELTA", "refused");

  const products = candidate();
  products.newlyBuildableProducts = ["kernel SDK"];
  assertFinding(api().capabilityViolations(products), "NEW_CAPABILITY_CLAIMED", "refused");

  for (const flag of ["kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "productionAllowed"]) {
    const document = candidate();
    document.readinessFlagBinding.values[flag] = true;
    assertFinding(api().capabilityViolations(document), `READINESS_FLAG:${flag}`, "refused");
  }

  for (const field of [
    "producesRuntimeCapability",
    "producesSdk",
    "producesApp",
    "producesProductCapability",
    "movesAnyReadinessFlag",
  ]) {
    const document = candidate();
    document.claims[field] = true;
    assertFinding(api().capabilityViolations(document), `CAPABILITY_CLAIM:${field}`, "refused");
  }
});

test("the non-authorizations are stated rather than implied", () => {
  const document = candidate();
  const text = document.nonAuthorizations.join("\n");
  for (const phrase of ["RCPT-01", "sourceExtraction", "FastAPI", "readiness"]) {
    assert.ok(text.includes(phrase), `the non-authorizations must name ${phrase}`);
  }
});

// -------------------------------------------------------------------------------------
// 10. The schema — closed, and closed at every level
// -------------------------------------------------------------------------------------

test("the schema is a closed 2020-12 object schema with the linkage fields required", () => {
  assert.notEqual(schemaDocument, null, `${SCHEMA_PATH} must exist`);
  assert.deepEqual(api().schemaViolations(schemaDocument), []);
  assert.equal(schemaDocument.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schemaDocument.type, "object");
  assert.equal(schemaDocument.additionalProperties, false);
});

test("the committed candidate validates against its own schema", () => {
  assert.deepEqual(api().validateAgainstSchema(schemaDocument, candidate()), []);
});

test("ADVERSARIAL: an unknown field anywhere in the candidate is refused", () => {
  const rootLevel = candidate();
  rootLevel.smuggledField = "an open object is a door";
  assertFinding(
    api().validateAgainstSchema(schemaDocument, rootLevel),
    "additionalProperties:/smuggledField",
    "an unknown root field must be refused",
  );

  const nested = candidate();
  nested.decision.preApproved = true;
  assertFinding(
    api().validateAgainstSchema(schemaDocument, nested),
    "additionalProperties:/decision/preApproved",
    "an unknown nested field must be refused",
  );
});

test("ADVERSARIAL: a schema that opens one nested object is refused", () => {
  const opened = structuredClone(schemaDocument);
  delete opened.properties.decision.additionalProperties;
  assertFinding(
    api().schemaViolations(opened),
    "SCHEMA_OPEN_OBJECT:/decision",
    "an open nested object must be a finding",
  );
});

test("ADVERSARIAL: a schema that stops pinning the unsigned state is refused", () => {
  const unpinned = structuredClone(schemaDocument);
  unpinned.properties.decision.properties.effective = { type: "boolean" };
  assertFinding(
    api().schemaViolations(unpinned),
    "SCHEMA_PIN:decision.effective",
    "the schema must pin effective to false",
  );

  const optional = structuredClone(schemaDocument);
  optional.properties.decision.required = optional.properties.decision.required.filter(
    (name) => name !== "signature",
  );
  assertFinding(
    api().schemaViolations(optional),
    "SCHEMA_LINKAGE_NOT_REQUIRED:decision.signature",
    "the signature field must stay required",
  );
});

// -------------------------------------------------------------------------------------
// 11. External evidence — verified, or honestly absent
// -------------------------------------------------------------------------------------

test("the four pinned authority sources and six analyses are recorded by path, bytes and hash", () => {
  const document = candidate();
  const paths = document.sourcePins.files.map((file) => file.path);
  for (const required of [
    "reports/kernel-development-roadmap/00-PHASE-CHAIN.json",
    "reports/p00-treaty-correction/07-OWNERSHIP-OVERLAY.tsv",
    "reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv",
    "reports/claude/CLAUDE-KERNEL-GAP-MATRIX.tsv",
  ]) {
    assert.ok(paths.includes(required), `${required} must be pinned`);
  }
  assert.equal(document.sourcePins.analyses.length, 6);
  for (const analysis of document.sourcePins.analyses) {
    assert.match(analysis.sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof analysis.bytes, "number");
    assert.ok(["CONDITIONAL", "REJECT"].includes(analysis.transcriptVerdictToken));
    assert.equal(analysis.readOnly, true);
  }
});

test("external evidence is verified when present and reported absent when the root is missing", () => {
  const document = candidate();
  const present = api().externalEvidenceReport(document);
  assert.ok(["verified", "absent", "drifted"].includes(present.state));
  assert.notEqual(present.state, "drifted", "a present-and-different pin would be RED");

  const moved = candidate();
  moved.sourcePins.evidenceRoot = path.join(root, "no-such-evidence-root");
  moved.sourcePins.analysisRoot = path.join(root, "no-such-analysis-root");
  const report = api().externalEvidenceReport(moved);
  assert.equal(report.state, "absent", "an absent root is absent, never verified");
  assert.deepEqual(report.findings, [], "absence is stated, not accused");
  assert.notEqual(report.state, "verified");
});

test("ADVERSARIAL: a present-but-different pinned source is RED rather than absent", () => {
  const document = candidate();
  if (!existsSync(document.sourcePins.evidenceRoot)) return; // honestly skipped when absent
  document.sourcePins.files[0].sha256 = "b".repeat(64);
  const report = api().externalEvidenceReport(document);
  assert.equal(report.state, "drifted");
  assertFinding(report.findings, "EVIDENCE_SHA256", "a drifted pin must be a finding");
});

// -------------------------------------------------------------------------------------
// 12. The wiring, the packet and the version
// -------------------------------------------------------------------------------------

test("ADVERSARIAL: the checker missing from npm run check is refused", () => {
  const packageJson = readJson("package.json");
  assert.ok(
    packageJson.scripts.check.includes(checkerRelative),
    "the checker must run inside npm run check",
  );
  const findings = api().evaluate({
    ...api().readFacts(root),
    checkScript: "node tools/check-repository-boundary.mjs",
  }).findings;
  assertFinding(findings, "CHECKER_NOT_WIRED", "an unwired checker must be a finding");
});

test("the existing checks keep their order and only one insertion was made", () => {
  const packageJson = readJson("package.json");
  const parts = packageJson.scripts.check.split("&&").map((part) => part.trim());
  const existing = [
    "node tools/check-repository-boundary.mjs",
    "node tools/check-control-plane-bootstrap.mjs",
    "node tools/check-kernel-ai-development-readiness.mjs",
    "node tools/check-kernel-runtime-substrate-s1.mjs",
    "node tools/check-token-economy.mjs",
    "node tools/check-p01-closure-semantics.mjs",
    "node tools/check-versioning-changelog.mjs",
  ];
  const kept = parts.filter((part) => existing.includes(part));
  assert.deepEqual(kept, existing, "no existing check may be reordered or dropped");
  assert.equal(
    parts.filter((part) => part.includes(checkerRelative)).length,
    1,
    "exactly one insertion",
  );
});

test("the version is untouched and no release marker appears", () => {
  const packageJson = readJson("package.json");
  assert.equal(packageJson.version, "0.1.0-alpha.1");
  assert.equal(packageJson.private, true);
});

test("the Turkish decision packet states one proposition and leaves the decision unsigned", () => {
  const text = readText(DOC_PATH);
  assert.notEqual(text, null, `${DOC_PATH} must exist`);
  assert.ok(
    text.includes(
      "Önerilen yön: MetaFramer’ın kanonik kernel dili Python; FastAPI yalnız dış API/Delivery " +
        "kapısı; mevcut Node kodu geçiş boyunca dondurulmuş uyumluluk referansı. Kalıcı " +
        "çift-runtime yok.",
    ),
    "the packet must carry the decision proposition verbatim",
  );
  assert.ok(text.includes("HENÜZ İMZALANMADI"), "the packet must carry an unsigned decision block");
  assert.ok(text.includes("KARAR: VERİLMEDİ"), "the packet must show the decision as not taken");
  for (const forbidden of [
    "imzalandı",
    "onaylandı",
    "karar verildi",
    "seçildi",
    "yürürlüğe girdi",
    "kabul edildi",
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `the packet must not claim the decision was taken: ${forbidden}`,
    );
  }
});

test("ADVERSARIAL: a packet that claims the decision was taken is refused", () => {
  const findings = api().decisionPacketViolations(
    "# Karar\n\nBu karar imzalandı ve yürürlüğe girdi.\n",
  );
  assertFinding(findings, "PACKET_CLAIMS_DECIDED", "a packet claiming a decision must be a finding");
  assertFinding(findings, "PACKET_PROPOSITION_MISSING", "the proposition must be present");
  assertFinding(findings, "PACKET_UNSIGNED_BLOCK_MISSING", "the unsigned block must be present");
});
