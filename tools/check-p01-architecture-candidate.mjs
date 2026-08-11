import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================================
// P01-W1 architecture decision candidate — the fail-closed verifier
//
// P01 owns two questions a model is not allowed to answer: KG-002, which language is canonical
// and which ring is owned in which language, and KG-003, who owns the sources and where the
// extraction boundary sits. The phase chain says so in its own words — "No architectural
// decision may be closed by a model decision; KG-002 and KG-003 require a human signature" —
// and it is the kind of sentence that holds only while something refuses to let a document
// drift past it.
//
// So this file judges a decision *candidate*. Six independent read-only analyses stand behind
// its option register; their neutral synthesis is that a Node-canonical route works but opens a
// cross-process tenant claim boundary before the phase that builds the policy decision point,
// that a Python-canonical route with the web framework confined to Delivery carries the lowest
// lifecycle cost and opens no such boundary, and that a permanent dual runtime is REJECT. The
// candidate may carry the second as a recommendation. The one thing it may never do is carry it
// as an answer.
//
// What that means concretely, and what every function below exists to refuse:
//
//   decisionState stays HUMAN_DECISION_REQUIRED, effective stays false, selectedOption stays
//   null, and signature, signer and date stay null. No RCPT-01. No gap reaches CLOSED. No
//   readiness, release, deploy or production flag moves. sourceExtraction stays false and is
//   read back out of the repository's own authority files rather than asserted here. The seven
//   Node baseline modules are hash-pinned and compared against the tree, so "we did not touch
//   the existing code" is a measurement and not a promise. The web framework is denied every
//   kernel identity by name, because the failure this route actually risks is not a bad import
//   — it is a framework quietly becoming the model.
//
// What this file will not do:
//
//   - it writes nothing. Every function here is a pure function over data or a reader, and the
//     suite asserts that no write API is even named in this source. A checker that can change
//     the thing it judges is not a checker.
//   - it selects nothing, signs nothing and issues nothing. A GREEN run means the candidate is
//     still honestly a candidate. It does not mean the decision is good, and it certainly does
//     not mean the decision is made.
//   - it does not become the source of truth for P01 scope. The pinned ownership and dependency
//     overlays are, and when the evidence root is readable the six gaps and five closure edges
//     are re-derived from them and any drift from this document's projection is RED.
//
// External evidence is handled fail-closed in the direction that matters. If a pinned root is
// present, every file under it must be present and byte-exact or the run is RED; if a root is
// wholly absent the run reports it as absent and never as verified. Absence is stated, never
// assumed away.
//
// One honest omission, recorded rather than papered over. EXIT-01 also requires an architecture
// fitness function that fails the build on a dependency-direction violation, and PERF-01-1
// requires it to complete inside a build budget. No calibrated budget exists in the pinned
// evidence. This checker therefore reports its own elapsed time and records the P01 exit
// build-budget baseline as PENDING. Inventing a threshold here would hand a later gate a number
// that looks measured and never was.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CANDIDATE_PATH = "planning/p01-architecture-decision-candidate.json";
export const SCHEMA_PATH = "planning/p01-architecture-decision.schema.json";
export const RING_PATH = "planning/p01-ring-ownership-candidate.json";
export const PACKET_PATH = "docs/p01-architecture-decision-candidate.md";
export const CHECKER_PATH = "tools/check-p01-architecture-candidate.mjs";

export const REQUIRED_DECISION_STATE = "HUMAN_DECISION_REQUIRED";
export const DECISION_AUTHORITY = "authorized human";
export const REJECTED_OPTION_ID = "S3";

export const OPTION_IDS = ["S1", "S2", "S3"];
export const REQUIRED_HUMAN_DECISION_RECORDS = ["HD-RUNTIME-ADR", "HD-TOPOLOGY-EXTRACTION-ADR"];

export const P01_GAP_ORDER = ["KG-003", "KG-002", "KG-004", "KG-005", "KG-006", "KG-084"];

/** The five accepted P01 closure edges, as the dependency overlay records them. */
export const P01_CLOSURE_EDGES = {
  "E-002": {
    sourceGap: "KG-002",
    destinationGap: "KG-004",
    sourcePhase: "P01",
    destinationPhase: "P01",
    classification: "INTRA_ATOMIC",
    expectedDestinationReceipt: "RCPT-01",
  },
  "E-003": {
    sourceGap: "KG-003",
    destinationGap: "KG-002",
    sourcePhase: "P01",
    destinationPhase: "P01",
    classification: "INTRA_ATOMIC",
    expectedDestinationReceipt: "RCPT-01",
  },
  "E-005": {
    sourceGap: "KG-004",
    destinationGap: "KG-023",
    sourcePhase: "P01",
    destinationPhase: "P03",
    classification: "FORWARD_DEFERRED",
    expectedDestinationReceipt: "RCPT-03",
  },
  "E-152": {
    sourceGap: "KG-084",
    destinationGap: "KG-019",
    sourcePhase: "P01",
    destinationPhase: "P02",
    classification: "FORWARD_DEFERRED",
    expectedDestinationReceipt: "RCPT-02",
  },
  "E-153": {
    sourceGap: "KG-084",
    destinationGap: "KG-050",
    sourcePhase: "P01",
    destinationPhase: "P05",
    classification: "FORWARD_DEFERRED",
    expectedDestinationReceipt: "RCPT-05",
  },
};

export const RING_DIRECTION = "Domain <- Application <- Adapters <- Delivery";
export const RING_ORDER = ["Domain", "Application", "Adapters", "Delivery"];

/** The modules that may never be reachable from an inner ring, whatever the delivery host is. */
export const FORBIDDEN_INNER_IMPORTS = ["fastapi", "starlette", "pydantic"];

/** Every identity a delivery host must be denied, spelled out so none has to be inferred. */
export const FASTAPI_DENIED_IDENTITIES = [
  "isPolicyDecisionPoint",
  "isPolicyEngine",
  "isDomainModel",
  "isWorkflowEngine",
  "isMetadataEngine",
  "isSdk",
  "isUi",
  "isProductCapability",
  "isKernelCapability",
];

export const CROSS_CUTTING_AXIS_IDS = [
  "ai",
  "multi-llm",
  "archetype-metadata",
  "module-plugin",
  "observability",
];

export const KERNEL_SHARED_PRIMITIVE_IDS = [
  "money-value",
  "quantity",
  "unit",
  "party-reference",
  "address-value",
  "document-number",
  "period-time-reference",
  "domain-neutral-identifier",
];

export const BOUNDED_DOMAIN_EXCLUSION_IDS = [
  "ledger-accounting",
  "inventory-valuation",
  "payment",
  "procurement",
  "order-orchestration",
  "logistics",
  "payroll-hcm",
];

export const BOUNDED_DOMAIN_OWNER = "bounded context";

export const DELIVERY_REFERENCE_SURFACE_IDS = ["fastapi", "django", "frappe", "flask", "symfony"];

export const READINESS_FLAGS = [
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

export const CLAIM_FIELDS = [
  "producesRuntimeCapability",
  "producesSdk",
  "producesApp",
  "producesProductCapability",
  "movesAnyReadinessFlag",
  "producesReceipt",
  "closesAnyGap",
  "modifiesRuntimeOrDbOrSrc",
  "addsPythonOrFastApiDependency",
  "movesOrExtractsSources",
];

export const KILL_TRIGGER_IDS = [
  "KT-PARITY-FAILURE",
  "KT-SECURITY-BOUNDARY-VIOLATION",
  "KT-UNACCEPTABLE-MEASURED-COST",
  "KT-DETERMINISM-OR-AI-OFF-LOSS",
];

/** The one proposition the human packet puts to a decision, carried here verbatim. */
export const DECISION_PROPOSITION =
  "Önerilen yön: MetaFramer’ın kanonik kernel dili Python; FastAPI yalnız dış API/Delivery " +
  "kapısı; mevcut Node kodu geçiş boyunca dondurulmuş uyumluluk referansı. Kalıcı " +
  "çift-runtime yok.";

/** Turkish phrasings that would turn the packet from a question into an announcement. */
export const PACKET_DECIDED_PHRASES = [
  "imzalandı",
  "onaylandı",
  "karar verildi",
  "seçildi",
  "yürürlüğe girdi",
  "kabul edildi",
];

const SHA256 = /^[0-9a-f]{64}$/;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dedupe = (values) => [...new Set(values)];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const TYPE_OF = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

// -------------------------------------------------------------------------------------
// 1. The decision state
//
// This is the section that matters. Everything else in the package could be right and this one
// wrong, and the package would have answered a question reserved for a signature.
// -------------------------------------------------------------------------------------

/**
 * The decision block, judged as the boundary it is.
 *
 * Each field is checked by equality against the one value the pre-decision state admits, rather
 * than by "is it absent". A document that grows a plausible-sounding `selectedBy` is exactly the
 * shape this refuses.
 *
 * @param {unknown} document the decision candidate
 * @returns {string[]} one stable machine finding per broken clause
 */
export function decisionViolations(document) {
  const findings = [];
  const decision = document?.decision;
  if (!isPlainObject(decision)) return [`DECISION_BLOCK_ABSENT:${TYPE_OF(decision)}`];

  if (decision.decisionState !== REQUIRED_DECISION_STATE) {
    findings.push(`DECISION_STATE:${decision.decisionState}`);
  }
  if (decision.effective !== false) findings.push(`EFFECTIVE_CLAIMED:${decision.effective}`);
  if (decision.selectedOption !== null) {
    findings.push(`OPTION_SELECTED:${decision.selectedOption}`);
  }
  for (const field of ["selectedBy", "signature", "signerId", "signedOn"]) {
    if (decision[field] !== null) {
      findings.push(`SIGNATURE_FIELD_PRESENT:${field}:${TYPE_OF(decision[field])}`);
    }
  }
  if (decision.recommendationIsSelection !== false) {
    findings.push(`RECOMMENDATION_IS_SELECTION:${decision.recommendationIsSelection}`);
  }
  if (decision.modelMaySelect !== false) findings.push(`MODEL_MAY_SELECT:${decision.modelMaySelect}`);
  if (decision.modelMaySign !== false) findings.push(`MODEL_MAY_SIGN:${decision.modelMaySign}`);
  if (decision.decisionAuthority !== DECISION_AUTHORITY) {
    findings.push(`DECISION_AUTHORITY:${decision.decisionAuthority}`);
  }
  if (decision.producesReceipt !== false) findings.push(`RECEIPT_CLAIMED:${decision.producesReceipt}`);
  if (decision.receiptId !== null) findings.push(`RECEIPT_ID_PRESENT:${decision.receiptId}`);
  if (decision.closesAnyGap !== false) findings.push(`CLOSED_GAP_CLAIMED:${decision.closesAnyGap}`);
  if (decision.satisfiesExitGate !== false) {
    findings.push(`EXIT_GATE_CLAIMED:${decision.satisfiesExitGate}`);
  }
  if (decision.proposition !== DECISION_PROPOSITION) findings.push("PROPOSITION_DRIFT");

  const records = decision.openHumanDecisionRecords;
  if (!Array.isArray(records)) {
    findings.push(`HUMAN_DECISION_RECORDS_ABSENT:${TYPE_OF(records)}`);
  } else {
    const byId = new Map(records.map((record) => [record?.id, record]));
    for (const id of REQUIRED_HUMAN_DECISION_RECORDS) {
      if (!byId.has(id)) findings.push(`HUMAN_DECISION_RECORD_MISSING:${id}`);
    }
    for (const record of records) {
      if (record?.state !== "OPEN") {
        findings.push(`HUMAN_DECISION_RECORD_NOT_OPEN:${record?.id}:${record?.state}`);
      }
      if (record?.owner !== "human") {
        findings.push(`HUMAN_DECISION_RECORD_OWNER:${record?.id}:${record?.owner}`);
      }
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 2. The option register
// -------------------------------------------------------------------------------------

/**
 * Three routes, each priced on the same dimensions, with the rejected one still recorded.
 *
 * Recording the rejected option matters as much as recording the preferred one: a register that
 * quietly drops what it refused is a register a later reader cannot audit.
 */
export function optionRegisterViolations(document) {
  const findings = [];
  const options = document?.options;
  if (!Array.isArray(options)) return [`OPTION_REGISTER_ABSENT:${TYPE_OF(options)}`];

  const ids = options.map((option) => option?.id);
  if (JSON.stringify(ids) !== JSON.stringify(OPTION_IDS)) {
    findings.push(`OPTION_SET:${ids.join(",")}`);
  }

  for (const option of options) {
    for (const field of [
      "title",
      "summary",
      "security",
      "compatibility",
      "migration",
      "historyPreservation",
      "codeRollback",
      "dataRollback",
      "operationalCost",
    ]) {
      if (typeof option?.[field] !== "string" || option[field].length === 0) {
        findings.push(`OPTION_DIMENSION_MISSING:${option?.id}:${field}`);
      }
    }
    if (option?.costBasis !== "relative-and-evidence") {
      findings.push(`OPTION_COST_BASIS:${option?.id}:${option?.costBasis}`);
    }
    if (option?.verdict === "REJECT" && (option?.rejectionReasons ?? []).length === 0) {
      findings.push(`OPTION_REJECTION_REASON_MISSING:${option?.id}`);
    }
    if (option?.verdict === "CONDITIONAL" && (option?.conditions ?? []).length === 0) {
      findings.push(`OPTION_CONDITIONS_MISSING:${option?.id}`);
    }
  }

  const rejected = options.find((option) => option?.id === REJECTED_OPTION_ID);
  if (rejected !== undefined && rejected.verdict !== "REJECT") {
    findings.push(`OPTION_VERDICT:${REJECTED_OPTION_ID}:${rejected.verdict}`);
  }

  const recommended = document?.decision?.recommendedOption;
  const match = options.find((option) => option?.id === recommended);
  if (match === undefined) {
    findings.push(`RECOMMENDATION_UNKNOWN_OPTION:${recommended}`);
  } else if (match.verdict === "REJECT") {
    findings.push(`RECOMMENDATION_REJECTED_OPTION:${recommended}`);
  }
  if (recommended === REJECTED_OPTION_ID) {
    findings.push(`RECOMMENDATION_PERMANENT_DUAL_RUNTIME:${recommended}`);
  }
  if (document?.recommendedTarget?.optionId !== recommended) {
    findings.push(
      `RECOMMENDATION_TARGET_MISMATCH:${document?.recommendedTarget?.optionId}!=${recommended}`,
    );
  }

  return dedupe(findings);
}

/**
 * Currency anywhere in the document.
 *
 * The pinned evidence carries no calibrated figures, so a number with a currency attached to it
 * would be invented, and an invented figure is the kind of thing a later reader treats as
 * measured. Relative cost with evidence behind it is what the register is allowed to say.
 */
export function monetaryEstimateViolations(document) {
  const pattern =
    /[$€₺£¥]|\b(USD|EUR|TRY|GBP|JPY|TL)\b|\b(dolar|euro|avro|lira|sterlin)\b|\b\d[\d.,]*\s*(k|m|bin|milyon|million|thousand)\b/i;
  const findings = [];

  const walk = (node, pointer) => {
    if (typeof node === "string") {
      const hit = pattern.exec(node);
      if (hit !== null) findings.push(`MONETARY_ESTIMATE:${pointer || "/"}:${hit[0]}`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value, index) => walk(value, `${pointer}/${index}`));
      return;
    }
    if (isPlainObject(node)) {
      for (const [name, value] of Object.entries(node)) walk(value, `${pointer}/${name}`);
    }
  };
  walk(document, "");

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 3. The recommended target
// -------------------------------------------------------------------------------------

/**
 * The target assignment, judged clause by clause.
 *
 * The delivery host is refused every kernel identity by name rather than by a single "is it in
 * the right ring" test, because the way a framework takes over a kernel is never a stray import
 * — it is a document that starts describing it as the thing that decides.
 */
export function targetAssignmentViolations(document) {
  const findings = [];
  const target = document?.recommendedTarget;
  if (!isPlainObject(target)) return [`TARGET_ABSENT:${TYPE_OF(target)}`];

  if (target.appliesOnlyAfterHumanSignature !== true) {
    findings.push(`TARGET_APPLIES_WITHOUT_SIGNATURE:${target.appliesOnlyAfterHumanSignature}`);
  }
  if (target.isCurrentState !== false) findings.push(`TARGET_AS_CURRENT_STATE:${target.isCurrentState}`);

  const owners = target.ringOwners ?? {};
  if (target.optionId === "S2") {
    for (const ringName of RING_ORDER) {
      if (owners[ringName] !== "python") findings.push(`RING_OWNER:${ringName}:${owners[ringName]}`);
    }
  } else if (target.optionId === "S1") {
    for (const ringName of ["Domain", "Application"]) {
      if (owners[ringName] !== "node") findings.push(`RING_OWNER:${ringName}:${owners[ringName]}`);
    }
  }

  const fastapi = target.fastapi;
  if (!isPlainObject(fastapi)) {
    findings.push(`FASTAPI_BLOCK_ABSENT:${TYPE_OF(fastapi)}`);
  } else {
    if (fastapi.role !== "delivery-host-only") findings.push(`FASTAPI_ROLE:${fastapi.role}`);
    for (const ringName of fastapi.permittedRings ?? []) {
      if (ringName !== "Delivery") findings.push(`FASTAPI_RING:${ringName}`);
    }
    for (const ringName of ["Domain", "Application"]) {
      if (!(fastapi.forbiddenRings ?? []).includes(ringName)) {
        findings.push(`FASTAPI_FORBIDDEN_RING_MISSING:${ringName}`);
      }
    }
    for (const field of FASTAPI_DENIED_IDENTITIES) {
      if (fastapi[field] !== false) findings.push(`FASTAPI_CLAIM:${field}:${fastapi[field]}`);
    }
    if (fastapi.installedToday !== false) findings.push(`FASTAPI_INSTALLED:${fastapi.installedToday}`);
  }

  const forbidden = target.innerRingForbiddenImports ?? {};
  for (const ringName of ["Domain", "Application"]) {
    const declared = forbidden[ringName];
    if (!Array.isArray(declared)) {
      findings.push(`INNER_RING_REFUSAL_ABSENT:${ringName}`);
      continue;
    }
    for (const module of FORBIDDEN_INNER_IMPORTS) {
      if (!declared.includes(module)) {
        findings.push(`INNER_RING_IMPORT_PERMITTED:${ringName}:${module}`);
      }
    }
  }

  const node = target.node;
  if (!isPlainObject(node)) {
    findings.push(`NODE_BLOCK_ABSENT:${TYPE_OF(node)}`);
  } else {
    if (node.writeAuthority !== "none") findings.push(`NODE_WRITE_AUTHORITY:${node.writeAuthority}`);
    if (node.role !== "frozen-conformance-reference-client") findings.push(`NODE_ROLE:${node.role}`);
    if (node.dualWrite !== false) findings.push(`DUAL_WRITE:recommendedTarget.node:${node.dualWrite}`);
    if (node.frozen !== true) findings.push(`NODE_NOT_FROZEN:${node.frozen}`);
    if (node.deletedByThisPackage !== false) findings.push(`NODE_DELETED:${node.deletedByThisPackage}`);
    if (node.writeRefusalIsMachineChecked !== true) {
      findings.push(`NODE_WRITE_REFUSAL_NOT_CHECKED:${node.writeRefusalIsMachineChecked}`);
    }
  }

  const boundary = target.crossRuntime;
  if (!isPlainObject(boundary)) {
    findings.push(`CROSS_RUNTIME_ABSENT:${TYPE_OF(boundary)}`);
  } else {
    for (const field of [
      "permanentProcessBoundary",
      "permanentApiBoundary",
      "permanentFfiBoundary",
    ]) {
      if (boundary[field] !== false) findings.push(`PERMANENT_BOUNDARY:${field}:${boundary[field]}`);
    }
    if (boundary.tenantClaimCrossesRuntimeBeforeP04 !== false) {
      findings.push(`CLAIM_CROSSES_RUNTIME:tenant:${boundary.tenantClaimCrossesRuntimeBeforeP04}`);
    }
    if (boundary.authClaimCrossesRuntimeBeforeP04 !== false) {
      findings.push(`CLAIM_CROSSES_RUNTIME:auth:${boundary.authClaimCrossesRuntimeBeforeP04}`);
    }
  }

  const truth = target.contractTruth;
  if (!isPlainObject(truth)) {
    findings.push(`CONTRACT_TRUTH_ABSENT:${TYPE_OF(truth)}`);
  } else {
    if (truth.crossLanguageTruth !== "versioned-contract-fixtures-ir") {
      findings.push(`CROSS_LANGUAGE_TRUTH:${truth.crossLanguageTruth}`);
    }
    if (truth.isOnlyCrossLanguageTruth !== true) {
      findings.push(`CROSS_LANGUAGE_TRUTH_NOT_SOLE:${truth.isOnlyCrossLanguageTruth}`);
    }
    if (truth.sdkProjectionsDeriveFromIr !== true) {
      findings.push(`SDK_PROJECTION_SOURCE:${truth.sdkProjectionsDeriveFromIr}`);
    }
    if (truth.builtByThisPackage !== false) {
      findings.push(`CONTRACT_TRUTH_BUILT_HERE:${truth.builtByThisPackage}`);
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 4. Migration, rollback and the pending drill
// -------------------------------------------------------------------------------------

/**
 * The migration plan, including the parts that are honestly not done.
 *
 * Code rollback and data rollback are kept apart on purpose: reverting a commit restores code
 * and restores nothing else, and the substrate's downgrade path destroys the audit trail. A
 * plan that reports one rollback has reported the easy half.
 */
export function migrationViolations(document) {
  const findings = [];
  const migration = document?.migration;
  if (!isPlainObject(migration)) return [`MIGRATION_ABSENT:${TYPE_OF(migration)}`];

  if (migration.mode !== "in-repo-staged-parity-then-cutover") {
    findings.push(`MIGRATION_MODE:${migration.mode}`);
  }
  if (migration.destructiveMigrationInThisPackage !== false) {
    findings.push(`DESTRUCTIVE_MIGRATION:${migration.destructiveMigrationInThisPackage}`);
  }
  if (migration.dataDowngradeInThisPackage !== false) {
    findings.push(`DATA_DOWNGRADE:${migration.dataDowngradeInThisPackage}`);
  }
  if (migration.dualWrite !== false) findings.push(`DUAL_WRITE:migration:${migration.dualWrite}`);
  if (migration.parityFixturesBeforeCutover !== true) {
    findings.push(`PARITY_FIXTURES:${migration.parityFixturesBeforeCutover}`);
  }
  if (migration.nodeBaselineRetainedUntilIndependentParity !== true) {
    findings.push(`BASELINE_NOT_RETAINED:${migration.nodeBaselineRetainedUntilIndependentParity}`);
  }
  if (migration.cutoverRequiresHumanSignature !== true) {
    findings.push(`CUTOVER_WITHOUT_SIGNATURE:${migration.cutoverRequiresHumanSignature}`);
  }
  if (migration.gitHistoryPreserved !== true) {
    findings.push(`GIT_HISTORY_NOT_PRESERVED:${migration.gitHistoryPreserved}`);
  }
  if (migration.sourceExtraction !== false) {
    findings.push(`MIGRATION_SOURCE_EXTRACTION:${migration.sourceExtraction}`);
  }

  const code = migration.codeRollback;
  const data = migration.dataRollback;
  for (const [label, rollback, kind] of [
    ["code", code, "code"],
    ["data", data, "data"],
  ]) {
    if (!isPlainObject(rollback)) {
      findings.push(`ROLLBACK_ABSENT:${label}`);
      continue;
    }
    if (rollback.kind !== kind) findings.push(`ROLLBACK_KIND:${label}:${rollback.kind}`);
    if (typeof rollback.route !== "string" || rollback.route.length === 0) {
      findings.push(`ROLLBACK_ROUTE_MISSING:${label}`);
    }
    if (rollback.exercised !== false) {
      findings.push(`${label === "data" ? "DATA" : "CODE"}_ROLLBACK_EXERCISED:${rollback.exercised}`);
    }
  }
  if (isPlainObject(data) && data.state !== "PENDING") {
    findings.push(`DATA_ROLLBACK_STATE:${data.state}`);
  }
  if (isPlainObject(code) && code.state !== "AVAILABLE") {
    findings.push(`CODE_ROLLBACK_STATE:${code.state}`);
  }

  const triggers = migration.killTriggers;
  if (!Array.isArray(triggers)) {
    findings.push(`KILL_TRIGGERS_ABSENT:${TYPE_OF(triggers)}`);
  } else {
    const ids = new Set(triggers.map((trigger) => trigger?.id));
    for (const id of KILL_TRIGGER_IDS) {
      if (!ids.has(id)) findings.push(`KILL_TRIGGER_MISSING:${id}`);
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 5. Current state, the Node baseline, and source authority
// -------------------------------------------------------------------------------------

/** The facts as they stand today, kept apart from the target so neither can be read as the other. */
export function currentStateViolations(document) {
  const findings = [];
  const current = document?.currentEffectiveState;
  if (!isPlainObject(current)) return [`CURRENT_STATE_ABSENT:${TYPE_OF(current)}`];

  for (const field of [
    "canonicalRuntimeDecided",
    "adaptersRingExists",
    "deliveryRingExists",
    "sdkRingExists",
    "fastapiInstalled",
    "fastapiShipped",
    "nodeAndPythonCallEachOther",
    "boundaryContractExists",
  ]) {
    if (current[field] !== false) findings.push(`CURRENT_STATE:${field}:${current[field]}`);
  }
  if (current.pythonSubstrateRole !== "S1 persistence substrate") {
    findings.push(`CURRENT_STATE:pythonSubstrateRole:${current.pythonSubstrateRole}`);
  }

  return dedupe(findings);
}

/**
 * Every `.mjs` module under `src`, hashed.
 *
 * The set is observed rather than taken from the document, so a file added, removed or edited
 * outside the pin is caught by the comparison rather than by trust.
 */
export function observeNodeBaseline(base) {
  const source = path.join(base, "src");
  if (!existsSync(source)) return [];

  const observed = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
        const bytes = readFileSync(absolute);
        observed.push({
          path: path.relative(base, absolute).split(path.sep).join("/"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  };
  walk(source);
  return observed;
}

/** The pinned baseline against the tree: present, byte-exact, and neither grown nor shrunk. */
export function nodeBaselineViolations(document, observed) {
  const findings = [];
  const baseline = document?.currentEffectiveState?.nodeBaseline;
  if (!isPlainObject(baseline) || !Array.isArray(baseline.files)) {
    return [`BASELINE_ABSENT:${TYPE_OF(baseline)}`];
  }

  for (const field of ["changedByThisPackage", "deletedByThisPackage", "rewrittenByThisPackage"]) {
    if (baseline[field] !== false) findings.push(`BASELINE_CHANGE_CLAIMED:${field}:${baseline[field]}`);
  }

  const actualByPath = new Map((observed ?? []).map((file) => [file.path, file]));
  const declaredByPath = new Map(baseline.files.map((file) => [file?.path, file]));

  for (const file of baseline.files) {
    if (!SHA256.test(file?.sha256 ?? "")) findings.push(`BASELINE_PIN_SHAPE:${file?.path}`);
    const actual = actualByPath.get(file?.path);
    if (actual === undefined) {
      findings.push(`BASELINE_FILE_ABSENT:${file?.path}`);
      continue;
    }
    if (actual.bytes !== file.bytes) {
      findings.push(`BASELINE_BYTES:${file.path}:${actual.bytes}!=${file.bytes}`);
    }
    if (actual.sha256 !== file.sha256) findings.push(`BASELINE_SHA256:${file.path}`);
  }

  for (const actual of observed ?? []) {
    if (!declaredByPath.has(actual.path)) findings.push(`BASELINE_FILE_UNDECLARED:${actual.path}`);
  }
  if (baseline.files.length !== (observed ?? []).length) {
    findings.push(`BASELINE_FILE_COUNT:${baseline.files.length}!=${(observed ?? []).length}`);
  }

  return dedupe(findings);
}

/**
 * The phrase each authority file must still carry.
 *
 * The checker owns this table rather than reading the expected phrase out of the candidate: a
 * document that supplies both the claim and the test for the claim has tested nothing. The two
 * prose files say the same thing in their own words, and each is matched against the words it
 * actually uses.
 */
export const AUTHORITY_ASSERTIONS = {
  "AGENTS.md": "Source extraction and repository topology changes remain separately human-gated",
  "README.md": "sourceExtraction=false",
};

/** The repository's own answer on source extraction, read rather than restated. */
export function readRepositoryAuthority(base) {
  const assertions = {};
  let sourceExtraction = null;

  const statusPath = path.join(base, "repository-status.json");
  if (existsSync(statusPath)) {
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      sourceExtraction = status?.sourceTopology?.sourceExtraction ?? null;
      assertions["repository-status.json"] = sourceExtraction === false;
    } catch {
      assertions["repository-status.json"] = false;
    }
  }

  for (const [relative, phrase] of Object.entries(AUTHORITY_ASSERTIONS)) {
    const absolute = path.join(base, relative);
    if (!existsSync(absolute)) continue;
    assertions[relative] = readFileSync(absolute, "utf8").includes(phrase);
  }

  return { sourceExtraction, assertions };
}

/** The extraction fence, checked against the repository rather than asserted by the candidate. */
export function sourceAuthorityViolations(document, facts) {
  const findings = [];
  const authority = document?.sourceAuthority;
  if (!isPlainObject(authority)) return [`SOURCE_AUTHORITY_ABSENT:${TYPE_OF(authority)}`];

  if (authority.sourceExtraction !== false) {
    findings.push(`SOURCE_EXTRACTION:${authority.sourceExtraction}`);
  }
  if (authority.sourceExtraction !== facts?.sourceExtraction) {
    findings.push(
      `SOURCE_EXTRACTION_REPO_DRIFT:${authority.sourceExtraction}!=${facts?.sourceExtraction}`,
    );
  }
  for (const field of ["sourceMoveAuthorized", "repositorySplitAuthorized", "extractionAuthorized"]) {
    if (authority[field] !== false) findings.push(`SOURCE_AUTHORIZATION:${field}:${authority[field]}`);
  }

  for (const file of authority.authorityFiles ?? []) {
    const observed = facts?.assertions?.[file?.path];
    if (observed === undefined) {
      findings.push(`AUTHORITY_FILE_MISSING:${file?.path}`);
      continue;
    }
    if (observed !== true) findings.push(`AUTHORITY_FILE_ASSERTION_MISSING:${file?.path}`);
    if (file?.machineRead !== true) findings.push(`AUTHORITY_FILE_NOT_MACHINE_READ:${file?.path}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 6. P01 scope
// -------------------------------------------------------------------------------------

/** The six gaps in their accepted order and the five closure edges with their real endpoints. */
export function p01ScopeViolations(document) {
  const findings = [];
  const scope = document?.p01Scope;
  if (!isPlainObject(scope)) return [`P01_SCOPE_ABSENT:${TYPE_OF(scope)}`];

  const gapIds = (scope.orderedGaps ?? []).map((gap) => gap?.id);
  if (JSON.stringify(gapIds) !== JSON.stringify(P01_GAP_ORDER)) {
    findings.push(`P01_GAP_ORDER:${gapIds.join(",")}`);
  }
  (scope.orderedGaps ?? []).forEach((gap, index) => {
    if (gap?.intraSeq !== index + 1) findings.push(`P01_GAP_INTRA_SEQ:${gap?.id}:${gap?.intraSeq}`);
  });

  const edgeIds = (scope.closureEdges ?? []).map((edge) => edge?.edgeId);
  const expectedIds = Object.keys(P01_CLOSURE_EDGES);
  if (JSON.stringify(edgeIds) !== JSON.stringify(expectedIds)) {
    findings.push(`P01_CLOSURE_EDGE_SET:${edgeIds.join(",")}`);
  }
  for (const edge of scope.closureEdges ?? []) {
    const expected = P01_CLOSURE_EDGES[edge?.edgeId];
    if (expected === undefined) continue;
    for (const [field, value] of Object.entries(expected)) {
      if (edge[field] !== value) {
        findings.push(`CLOSURE_EDGE_FIELD:${edge.edgeId}:${field}:${edge[field]}!=${value}`);
      }
    }
  }

  if (scope.forwardOnly !== true) findings.push(`FORWARD_ONLY:${scope.forwardOnly}`);
  if (scope.closureSemanticsAuthority !== "planning/p01-closure-semantics-addendum.json") {
    findings.push(`CLOSURE_SEMANTICS_AUTHORITY:${scope.closureSemanticsAuthority}`);
  }
  if (scope.preservesAcceptedClosureSemantics !== true) {
    findings.push(`CLOSURE_SEMANTICS_NOT_PRESERVED:${scope.preservesAcceptedClosureSemantics}`);
  }
  if ((scope.dischargedByThisPackage ?? []).length !== 0) {
    findings.push(`CLOSURE_DISCHARGE_CLAIMED:${(scope.dischargedByThisPackage ?? []).join(",")}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 7. The ring and bounded-context register
// -------------------------------------------------------------------------------------

/**
 * The register, judged as a shape rather than as prose.
 *
 * Two refusals carry most of the weight. Surface is not a ring, because giving composition an
 * ordinal invents a dependency direction that does not exist and lets composition argue for
 * inward access. And a bounded domain is never a shared primitive, because the moment ledger,
 * inventory or payroll rules dissolve into generic metadata they stop being provable.
 */
export function ringOwnershipViolations(register) {
  const findings = [];
  if (!isPlainObject(register)) return [`RING_REGISTER_ABSENT:${TYPE_OF(register)}`];

  if (register.decisionState !== REQUIRED_DECISION_STATE) {
    findings.push(`RING_DECISION_STATE:${register.decisionState}`);
  }
  if (register.effective !== false) findings.push(`RING_EFFECTIVE_CLAIMED:${register.effective}`);
  if (register.direction !== RING_DIRECTION) findings.push(`RING_DIRECTION:${register.direction}`);
  if (register.capabilityDelta !== "NONE") {
    findings.push(`RING_CAPABILITY_DELTA:${register.capabilityDelta}`);
  }

  const rings = register.rings ?? [];
  const ids = rings.map((entry) => entry?.id);
  if (JSON.stringify(ids) !== JSON.stringify(RING_ORDER)) {
    findings.push(`RING_SET:${ids.join(",")}`);
  }
  const ordinalOf = new Map(rings.map((entry) => [entry?.id, entry?.ordinal]));
  rings.forEach((entry, index) => {
    if (entry?.ordinal !== index + 1) findings.push(`RING_ORDINAL:${entry?.id}:${entry?.ordinal}`);
    for (const target of entry?.mayImport ?? []) {
      const targetOrdinal = ordinalOf.get(target);
      if (targetOrdinal === undefined || !(targetOrdinal < entry?.ordinal)) {
        findings.push(`RING_OUTWARD_IMPORT:${entry?.id}:${target}`);
      }
    }
  });

  const surface = register.surface;
  if (!isPlainObject(surface)) {
    findings.push(`SURFACE_ABSENT:${TYPE_OF(surface)}`);
  } else {
    if (surface.isOnionRing !== false) findings.push(`SURFACE_AS_RING:${surface.isOnionRing}`);
    if (surface.kind !== "outer-composition-boundary") findings.push(`SURFACE_KIND:${surface.kind}`);
    if (surface.ordinal !== null) findings.push(`SURFACE_ORDINAL:${surface.ordinal}`);
  }

  const axes = register.crossCuttingAxes ?? [];
  const axisIds = new Set(axes.map((axis) => axis?.id));
  for (const id of CROSS_CUTTING_AXIS_IDS) {
    if (!axisIds.has(id)) findings.push(`AXIS_MISSING:${id}`);
  }
  for (const axis of axes) {
    if (axis?.isRing !== false) findings.push(`AXIS_AS_RING:${axis?.id}`);
  }

  const shared = register.kernelSharedPrimitives ?? [];
  if (shared.length === 0) findings.push("SHARED_PRIMITIVE_EMPTY");
  for (const entry of shared) {
    if (BOUNDED_DOMAIN_EXCLUSION_IDS.includes(entry?.id)) {
      findings.push(`BOUNDED_DOMAIN_IN_SHARED:${entry?.id}`);
      continue;
    }
    if (!KERNEL_SHARED_PRIMITIVE_IDS.includes(entry?.id)) {
      findings.push(`SHARED_PRIMITIVE_UNKNOWN:${entry?.id}`);
    }
  }

  const excluded = register.excludedFromKernelSharedOwnership ?? [];
  const excludedIds = new Set(excluded.map((entry) => entry?.id));
  for (const id of BOUNDED_DOMAIN_EXCLUSION_IDS) {
    if (!excludedIds.has(id)) findings.push(`BOUNDED_DOMAIN_EXCLUSION_MISSING:${id}`);
  }
  for (const entry of excluded) {
    if (entry?.owner !== BOUNDED_DOMAIN_OWNER) {
      findings.push(`BOUNDED_DOMAIN_OWNER:${entry?.id}:${entry?.owner}`);
    }
  }

  const archeType = register.archeTypeMetadata;
  if (!isPlainObject(archeType)) {
    findings.push(`ARCHETYPE_ABSENT:${TYPE_OF(archeType)}`);
  } else {
    if (archeType.absorbsBoundedDomainInvariants !== false) {
      findings.push(`ARCHETYPE_ABSORBS_BOUNDED_DOMAIN:${archeType.absorbsBoundedDomainInvariants}`);
    }
    if (archeType.isRing !== false) findings.push(`ARCHETYPE_AS_RING:${archeType.isRing}`);
  }

  const surfaces = register.deliveryAndReferenceSurfaces ?? [];
  const surfaceIds = new Set(surfaces.map((entry) => entry?.id));
  for (const id of DELIVERY_REFERENCE_SURFACE_IDS) {
    if (!surfaceIds.has(id)) findings.push(`SURFACE_MISSING:${id}`);
  }
  for (const entry of surfaces) {
    if (entry?.isKernelSemantics !== false) {
      findings.push(`SURFACE_AS_KERNEL_SEMANTICS:${entry?.id}`);
    }
    if (entry?.isProductProof !== false) findings.push(`SURFACE_AS_PRODUCT_PROOF:${entry?.id}`);
    if (entry?.isOnionRing !== false) findings.push(`SURFACE_AS_ONION_RING:${entry?.id}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 8. Capability delta
// -------------------------------------------------------------------------------------

/** What the package is not, kept as a checked value rather than a sentence in a document. */
export function capabilityViolations(document) {
  const findings = [];
  if (!isPlainObject(document)) return [`DOCUMENT_ABSENT:${TYPE_OF(document)}`];

  if (document.capabilityDelta !== "NONE") findings.push(`CAPABILITY_DELTA:${document.capabilityDelta}`);
  if ((document.newlyBuildableProducts ?? []).length !== 0) {
    findings.push(`NEW_CAPABILITY_CLAIMED:${(document.newlyBuildableProducts ?? []).length}`);
  }
  if ((document.stillNotBuildable ?? []).length === 0) findings.push("STILL_NOT_BUILDABLE_EMPTY");

  const binding = document.readinessFlagBinding;
  if (!isPlainObject(binding)) {
    findings.push(`READINESS_BINDING_ABSENT:${TYPE_OF(binding)}`);
  } else {
    if (binding.mutatesAnyFlag !== false) findings.push(`FLAG_MUTATION_CLAIMED:${binding.mutatesAnyFlag}`);
    for (const flag of READINESS_FLAGS) {
      if (binding.values?.[flag] !== false) findings.push(`READINESS_FLAG:${flag}:${binding.values?.[flag]}`);
    }
  }

  const claims = document.claims;
  if (!isPlainObject(claims)) {
    findings.push(`CLAIMS_ABSENT:${TYPE_OF(claims)}`);
  } else {
    for (const field of CLAIM_FIELDS) {
      if (claims[field] !== false) findings.push(`CAPABILITY_CLAIM:${field}:${claims[field]}`);
    }
  }

  const performance = document.checkerPerformance;
  if (!isPlainObject(performance)) {
    findings.push(`PERFORMANCE_BLOCK_ABSENT:${TYPE_OF(performance)}`);
  } else {
    if (performance.performanceThresholdMs !== null) {
      findings.push(`INVENTED_PERFORMANCE_THRESHOLD:${performance.performanceThresholdMs}`);
    }
    if (performance.productionThresholdInvented !== false) {
      findings.push(`INVENTED_PERFORMANCE_THRESHOLD:${performance.productionThresholdInvented}`);
    }
    if (performance.p01ExitBuildBudgetBaseline !== "PENDING") {
      findings.push(`BUILD_BUDGET_BASELINE:${performance.p01ExitBuildBudgetBaseline}`);
    }
    if (performance.elapsedTimeReported !== true) {
      findings.push(`ELAPSED_TIME_NOT_REPORTED:${performance.elapsedTimeReported}`);
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 9. A JSON Schema subset, and the schema's own fail-closed shape
//
// No dependency is added for this. The subset is exactly what this package's schema uses, and an
// unknown keyword is reported rather than skipped, so the validator cannot quietly
// under-enforce a schema that grew a keyword it does not implement.
// -------------------------------------------------------------------------------------

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "minItems",
  "maxItems",
  "required",
  "properties",
  "additionalProperties",
  "items",
]);

export function validateAgainstSchema(schema, instance, pointer = "") {
  const findings = [];
  if (!isPlainObject(schema)) return [`schema:${pointer || "/"}`];

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) findings.push(`unsupportedKeyword:${pointer}/${keyword}`);
  }

  if (schema.type !== undefined && TYPE_OF(instance) !== schema.type) {
    if (!(schema.type === "number" && typeof instance === "number")) {
      findings.push(`type:${pointer || "/"}`);
      return findings;
    }
  }
  if (Object.hasOwn(schema, "const") && instance !== schema.const) {
    findings.push(`const:${pointer || "/"}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(instance)) {
    findings.push(`enum:${pointer || "/"}`);
  }
  if (schema.pattern !== undefined && typeof instance === "string") {
    if (!new RegExp(schema.pattern).test(instance)) findings.push(`pattern:${pointer || "/"}`);
  }
  if (schema.minLength !== undefined && typeof instance === "string") {
    if (instance.length < schema.minLength) findings.push(`minLength:${pointer || "/"}`);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      findings.push(`minItems:${pointer || "/"}`);
    }
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
      findings.push(`maxItems:${pointer || "/"}`);
    }
  }

  if (isPlainObject(instance)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(instance, name)) findings.push(`required:${pointer}/${name}`);
    }
    const properties = schema.properties ?? {};
    for (const [name, value] of Object.entries(instance)) {
      if (Object.hasOwn(properties, name)) {
        findings.push(...validateAgainstSchema(properties[name], value, `${pointer}/${name}`));
      } else if (schema.additionalProperties === false) {
        findings.push(`additionalProperties:${pointer}/${name}`);
      }
    }
  }

  if (Array.isArray(instance) && isPlainObject(schema.items)) {
    instance.forEach((value, index) => {
      findings.push(...validateAgainstSchema(schema.items, value, `${pointer}/${index}`));
    });
  }

  return findings;
}

/** The root fields without which the document is not this document. */
const SCHEMA_ROOT_REQUIRED = [
  "decision",
  "currentEffectiveState",
  "options",
  "recommendedTarget",
  "migration",
  "p01Scope",
  "sourceAuthority",
  "sourcePins",
  "checkerPerformance",
  "claims",
  "capabilityDelta",
  "readinessFlagBinding",
];

/** The decision fields that must be required by name, because optional is how a null goes missing. */
const SCHEMA_DECISION_REQUIRED = [
  "decisionState",
  "effective",
  "selectedOption",
  "selectedBy",
  "signature",
  "signerId",
  "signedOn",
  "decisionAuthority",
  "recommendedOption",
  "recommendationIsSelection",
  "modelMaySelect",
  "modelMaySign",
  "producesReceipt",
  "receiptId",
  "closesAnyGap",
  "satisfiesExitGate",
  "openHumanDecisionRecords",
];

/** The values the schema must pin by `const`, so an unsigned document cannot be typed into a signed one. */
const SCHEMA_PINS = [
  ["decision.decisionState", REQUIRED_DECISION_STATE],
  ["decision.effective", false],
  ["decision.selectedOption", null],
  ["decision.selectedBy", null],
  ["decision.signature", null],
  ["decision.signerId", null],
  ["decision.signedOn", null],
  ["decision.recommendationIsSelection", false],
  ["decision.modelMaySelect", false],
  ["decision.modelMaySign", false],
  ["decision.producesReceipt", false],
  ["decision.receiptId", null],
  ["decision.closesAnyGap", false],
  ["decision.satisfiesExitGate", false],
  ["capabilityDelta", "NONE"],
  ["sourceAuthority.sourceExtraction", false],
  ["migration.dualWrite", false],
  ["recommendedTarget.node.dualWrite", false],
  ["recommendedTarget.node.writeAuthority", "none"],
  ["checkerPerformance.performanceThresholdMs", null],
  ["checkerPerformance.p01ExitBuildBudgetBaseline", "PENDING"],
  ["readinessFlagBinding.mutatesAnyFlag", false],
];

function schemaNodeAt(schema, dotted) {
  let node = schema;
  for (const name of dotted.split(".")) {
    node = node?.properties?.[name];
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * The schema document itself.
 *
 * A schema that forgets `additionalProperties: false` on one nested object is a schema with a
 * door in it, so every object level is checked rather than the root alone.
 */
export function schemaViolations(schema) {
  const findings = [];
  if (!isPlainObject(schema)) return ["SCHEMA_MALFORMED"];

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    findings.push(`SCHEMA_DIALECT:${schema.$schema}`);
  }
  if (typeof schema.$id !== "string" || schema.$id === "") findings.push("SCHEMA_ID_MISSING");
  if (schema.type !== "object") findings.push(`SCHEMA_ROOT_TYPE:${schema.type}`);

  const walk = (node, pointer) => {
    if (!isPlainObject(node)) return;
    for (const keyword of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) findings.push(`SCHEMA_UNSUPPORTED:${pointer}/${keyword}`);
    }
    if (node.type === "object" || isPlainObject(node.properties)) {
      if (node.additionalProperties !== false) findings.push(`SCHEMA_OPEN_OBJECT:${pointer || "/"}`);
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        walk(child, `${pointer}/${name}`);
      }
    }
    if (isPlainObject(node.items)) walk(node.items, `${pointer}/items`);
  };
  walk(schema, "");

  const rootRequired = new Set(schema.required ?? []);
  for (const field of SCHEMA_ROOT_REQUIRED) {
    if (!rootRequired.has(field)) findings.push(`SCHEMA_LINKAGE_NOT_REQUIRED:${field}`);
  }
  const decisionRequired = new Set(schema.properties?.decision?.required ?? []);
  for (const field of SCHEMA_DECISION_REQUIRED) {
    if (!decisionRequired.has(field)) {
      findings.push(`SCHEMA_LINKAGE_NOT_REQUIRED:decision.${field}`);
    }
  }

  for (const [dotted, expected] of SCHEMA_PINS) {
    const node = schemaNodeAt(schema, dotted);
    if (!isPlainObject(node) || node.const !== expected) findings.push(`SCHEMA_PIN:${dotted}`);
  }

  // The rejected option must be unreachable as a recommendation at the shape level too, not only
  // by a rule that a later editor could read as advisory.
  const recommendable = schema.properties?.decision?.properties?.recommendedOption?.enum;
  if (!Array.isArray(recommendable) || recommendable.includes(REJECTED_OPTION_ID)) {
    findings.push(`SCHEMA_RECOMMENDABLE_OPTIONS:${JSON.stringify(recommendable)}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 10. External evidence — verified, or honestly absent
// -------------------------------------------------------------------------------------

function tsvRows(text) {
  const lines = text.split("\n").filter((line) => line !== "");
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(header.map((name, index) => [name, cells[index]]));
  });
}

/**
 * The pinned authority sources and the six analyses, verified or reported absent.
 *
 * Present-and-different is RED. Wholly absent is `absent` and is never printed as verified. When
 * the overlays are readable, the six gaps and five closure edges are re-derived from them and
 * compared with this document's projection, so the projection cannot drift from the source of
 * truth unnoticed.
 */
export function externalEvidenceReport(document) {
  const pins = document?.sourcePins;
  if (!isPlainObject(pins) || !Array.isArray(pins.files) || !Array.isArray(pins.analyses)) {
    return {
      state: "drifted",
      findings: ["EVIDENCE_PINS_MALFORMED"],
      verifiedFiles: 0,
      verifiedAnalyses: 0,
      derivedProjectionMatches: null,
    };
  }

  const findings = [];
  const evidenceRootPresent =
    typeof pins.evidenceRoot === "string" && existsSync(pins.evidenceRoot);
  const analysisRootPresent =
    typeof pins.analysisRoot === "string" && existsSync(pins.analysisRoot);

  const verifyPin = (absolute, pin, label) => {
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      findings.push(`${label}_FILE_ABSENT:${pin.path ?? pin.file}`);
      return false;
    }
    const bytes = readFileSync(absolute);
    if (bytes.length !== pin.bytes) {
      findings.push(`${label}_BYTES:${pin.path ?? pin.file}:${bytes.length}!=${pin.bytes}`);
      return false;
    }
    if (sha256(bytes) !== pin.sha256) {
      findings.push(`${label}_SHA256:${pin.path ?? pin.file}`);
      return false;
    }
    return true;
  };

  let verifiedFiles = 0;
  if (evidenceRootPresent) {
    for (const file of pins.files) {
      if (verifyPin(path.join(pins.evidenceRoot, file.path), file, "EVIDENCE")) verifiedFiles += 1;
    }
  }

  let verifiedAnalyses = 0;
  if (analysisRootPresent) {
    for (const analysis of pins.analyses) {
      if (verifyPin(path.join(pins.analysisRoot, analysis.file), analysis, "ANALYSIS")) {
        verifiedAnalyses += 1;
      }
    }
  }

  let derivedProjectionMatches = null;
  if (evidenceRootPresent && findings.length === 0) {
    derivedProjectionMatches = true;
    const ownershipPin = pins.files.find((file) => file.path.includes("07-OWNERSHIP-OVERLAY"));
    const dependencyPin = pins.files.find((file) => file.path.includes("08-DEPENDENCY-OVERLAY"));

    if (ownershipPin !== undefined) {
      const rows = tsvRows(
        readFileSync(path.join(pins.evidenceRoot, ownershipPin.path), "utf8"),
      ).filter((row) => row.phase === "P01");
      const derived = rows
        .slice()
        .sort((a, b) => Number(a.intra_seq) - Number(b.intra_seq))
        .map((row) => row.kg_id);
      const projected = (document.p01Scope?.orderedGaps ?? []).map((gap) => gap.id);
      if (JSON.stringify(derived) !== JSON.stringify(projected)) {
        findings.push(`DERIVED_GAP_ORDER:${derived.join(",")}!=${projected.join(",")}`);
        derivedProjectionMatches = false;
      }
    }

    if (dependencyPin !== undefined) {
      const rows = tsvRows(
        readFileSync(path.join(pins.evidenceRoot, dependencyPin.path), "utf8"),
      ).filter((row) => row.dep_type === "CLOSURE" && row.src_phase === "P01");
      const projected = new Map(
        (document.p01Scope?.closureEdges ?? []).map((edge) => [edge.edgeId, edge]),
      );
      if (rows.length !== projected.size) {
        findings.push(`DERIVED_EDGE_COUNT:${rows.length}!=${projected.size}`);
        derivedProjectionMatches = false;
      }
      for (const row of rows) {
        const edge = projected.get(row.edge_id);
        if (edge === undefined) {
          findings.push(`DERIVED_EDGE_ABSENT:${row.edge_id}`);
          derivedProjectionMatches = false;
          continue;
        }
        const expected = {
          sourceGap: row.src_kg,
          destinationGap: row.dst,
          sourcePhase: row.src_phase,
          destinationPhase: row.dst_phase,
        };
        for (const [field, value] of Object.entries(expected)) {
          if (edge[field] !== value) {
            findings.push(`DERIVED_EDGE_FIELD:${row.edge_id}:${field}`);
            derivedProjectionMatches = false;
          }
        }
        const derivedClassification =
          row.src_phase === row.dst_phase ? "INTRA_ATOMIC" : "FORWARD_DEFERRED";
        if (edge.classification !== derivedClassification) {
          findings.push(`DERIVED_EDGE_FIELD:${row.edge_id}:classification`);
          derivedProjectionMatches = false;
        }
      }
    }
  }

  const rootsPresent = evidenceRootPresent && analysisRootPresent;
  const state = findings.length > 0 ? "drifted" : rootsPresent ? "verified" : "absent";

  return {
    state,
    findings: dedupe(findings),
    verifiedFiles,
    verifiedAnalyses,
    evidenceRoot: evidenceRootPresent ? "present" : "absent",
    analysisRoot: analysisRootPresent ? "present" : "absent",
    derivedProjectionMatches,
  };
}

// -------------------------------------------------------------------------------------
// 11. The human packet
// -------------------------------------------------------------------------------------

/** The Turkish packet: one proposition, an unsigned block, and no sentence that answers it. */
export function decisionPacketViolations(text) {
  const findings = [];
  if (typeof text !== "string") return [`PACKET_UNREADABLE:${TYPE_OF(text)}`];

  if (!text.includes(DECISION_PROPOSITION)) findings.push("PACKET_PROPOSITION_MISSING");
  if (!text.includes("HENÜZ İMZALANMADI") || !text.includes("KARAR: VERİLMEDİ")) {
    findings.push("PACKET_UNSIGNED_BLOCK_MISSING");
  }
  for (const phrase of PACKET_DECIDED_PHRASES) {
    if (text.includes(phrase)) findings.push(`PACKET_CLAIMS_DECIDED:${phrase}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 12. The whole decision, as a pure function of read facts
// -------------------------------------------------------------------------------------

export function evaluate(facts) {
  const findings = [];
  const summary = {
    decisionState: "UNKNOWN",
    effective: null,
    selectedOption: "UNKNOWN",
    recommendedOption: "UNKNOWN",
    options: 0,
    gaps: 0,
    closureEdges: 0,
    baselineFiles: 0,
    rings: 0,
    externalEvidence: facts.externalEvidence?.state ?? "absent",
    verifiedSources: facts.externalEvidence?.verifiedFiles ?? 0,
    verifiedAnalyses: facts.externalEvidence?.verifiedAnalyses ?? 0,
    capabilityDelta: "UNKNOWN",
    performanceThresholdMs: null,
    buildBudgetBaseline: "UNKNOWN",
    elapsedMs: null,
  };

  const { candidate, schema, ring, packetText } = facts;

  if (!isPlainObject(candidate)) findings.push(`CANDIDATE_UNREADABLE:${CANDIDATE_PATH}`);
  if (!isPlainObject(schema)) {
    findings.push(`SCHEMA_UNREADABLE:${SCHEMA_PATH}`);
  } else {
    findings.push(...schemaViolations(schema));
  }
  if (!isPlainObject(ring)) {
    findings.push(`RING_REGISTER_UNREADABLE:${RING_PATH}`);
  } else {
    findings.push(...ringOwnershipViolations(ring));
    summary.rings = (ring.rings ?? []).length;
  }
  findings.push(...decisionPacketViolations(packetText));
  findings.push(...(facts.externalEvidence?.findings ?? []));

  if (typeof facts.checkScript !== "string") {
    findings.push("CHECK_SCRIPT_UNREADABLE:package.json");
  } else if (!facts.checkScript.includes(CHECKER_PATH)) {
    findings.push(`CHECKER_NOT_WIRED:${CHECKER_PATH}`);
  }

  if (!isPlainObject(candidate)) return { findings: dedupe(findings), summary };

  if (isPlainObject(schema)) findings.push(...validateAgainstSchema(schema, candidate));
  findings.push(...decisionViolations(candidate));
  findings.push(...optionRegisterViolations(candidate));
  findings.push(...monetaryEstimateViolations(candidate));
  findings.push(...targetAssignmentViolations(candidate));
  findings.push(...migrationViolations(candidate));
  findings.push(...currentStateViolations(candidate));
  findings.push(...nodeBaselineViolations(candidate, facts.observedBaseline));
  findings.push(...sourceAuthorityViolations(candidate, facts.repositoryAuthority));
  findings.push(...p01ScopeViolations(candidate));
  findings.push(...capabilityViolations(candidate));

  // The two documents are separate artifacts and must still agree about the one thing they both
  // state, or a later reader can quote whichever suits them.
  if (isPlainObject(ring) && ring.direction !== RING_DIRECTION) {
    findings.push(`RING_DIRECTION_DRIFT:${ring.direction}`);
  }
  if (isPlainObject(ring) && ring.candidateOf !== CANDIDATE_PATH) {
    findings.push(`RING_REGISTER_UNBOUND:${ring.candidateOf}`);
  }

  Object.assign(summary, {
    decisionState: candidate.decision?.decisionState,
    effective: candidate.decision?.effective,
    selectedOption: String(candidate.decision?.selectedOption),
    recommendedOption: candidate.decision?.recommendedOption,
    options: (candidate.options ?? []).length,
    gaps: (candidate.p01Scope?.orderedGaps ?? []).length,
    closureEdges: (candidate.p01Scope?.closureEdges ?? []).length,
    baselineFiles: (candidate.currentEffectiveState?.nodeBaseline?.files ?? []).length,
    capabilityDelta: candidate.capabilityDelta,
    performanceThresholdMs: candidate.checkerPerformance?.performanceThresholdMs ?? null,
    buildBudgetBaseline: candidate.checkerPerformance?.p01ExitBuildBudgetBaseline,
  });

  return { findings: dedupe(findings), summary };
}

function readJson(base, relative) {
  const absolute = path.join(base, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

function readText(base, relative) {
  const absolute = path.join(base, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
  return readFileSync(absolute, "utf8");
}

/** The reader. The only part that touches a filesystem, and it only ever reads. */
export function readFacts(rootDirectory) {
  const base = typeof rootDirectory === "string" && rootDirectory !== "" ? rootDirectory : root;
  const candidate = readJson(base, CANDIDATE_PATH);
  return {
    candidate,
    schema: readJson(base, SCHEMA_PATH),
    ring: readJson(base, RING_PATH),
    packetText: readText(base, PACKET_PATH),
    checkScript: readJson(base, "package.json")?.scripts?.check ?? null,
    observedBaseline: observeNodeBaseline(base),
    repositoryAuthority: readRepositoryAuthority(base),
    externalEvidence: isPlainObject(candidate)
      ? externalEvidenceReport(candidate)
      : { state: "absent", findings: [], verifiedFiles: 0, verifiedAnalyses: 0 },
  };
}

/** The reader composed with the evaluators, timed. Reads a real tree; changes nothing in it. */
export function runCheck(rootDirectory) {
  const started = performance.now();
  const report = evaluate(readFacts(rootDirectory));
  report.summary.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = runCheck(root);
  if (report.findings.length > 0) {
    console.error(`p01-architecture-candidate: RED\n  - ${report.findings.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    const { summary } = report;
    console.log(
      `OK p01-architecture-candidate: decisionState=${summary.decisionState} ` +
        `effective=${summary.effective} selectedOption=${summary.selectedOption} ` +
        `recommendedOption=${summary.recommendedOption} options=${summary.options} ` +
        `gaps=${summary.gaps}/6 closureEdges=${summary.closureEdges}/5 ` +
        `baselineFiles=${summary.baselineFiles} rings=${summary.rings}/4 ` +
        `externalEvidence=${summary.externalEvidence} ` +
        `verifiedSources=${summary.verifiedSources} verifiedAnalyses=${summary.verifiedAnalyses} ` +
        `capabilityDelta=${summary.capabilityDelta} elapsedMs=${summary.elapsedMs} ` +
        `buildBudgetBaseline=${summary.buildBudgetBaseline}`,
    );
    console.log(
      "P01-W1 is a decision candidate, not a decision: it recommends one route, selects none, " +
        "produces no RCPT-01, closes no gap, moves no readiness flag, and leaves KG-002 and " +
        "KG-003 open for a human signature.",
    );
  }
}
