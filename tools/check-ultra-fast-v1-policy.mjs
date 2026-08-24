import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// Ultra-fast v1 pilot guardrails — a read-only, deterministic build-time guard over the
// additive fast-development-package overlay. `planning/ultra-fast-v1-policy.json` is the sole
// canonical owner of every speed number and semantic value here; this checker never duplicates
// those numbers as separate literals — it derives its checks from the loaded policy object.
// This is a pilot guard only, timed to the policy's checkpoint minute: it never asserts
// release/runtime/production readiness.
// =====================================================================================

export const POLICY_PATH = path.join(root, "planning", "ultra-fast-v1-policy.json");

export const EXTERNAL_BUDGET_REFERENCE =
  "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";

const REQUIRED_POLICY_FIELDS = [
  "fullQaBudget",
  "releaseAllowed",
  "runtimeAuthorityClaimed",
  "readinessClaimed",
  "sourceCommit",
  "thresholds",
  "checkpointTerminalOutcomes",
  "requiredPaneMode",
  "requiredGcTrigger",
  "projectionFiles",
];

/**
 * Loads and validates the canonical policy document. Fails closed: a missing file, malformed
 * JSON, or a document missing any required field throws rather than returning a partial policy.
 */
export function loadPolicy(opts = {}) {
  const filePath = opts.path ?? POLICY_PATH;
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`ultra-fast-v1 policy is missing or unreadable: "${filePath}"`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ultra-fast-v1 policy is not valid JSON: "${filePath}"`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`ultra-fast-v1 policy must be a JSON object: "${filePath}"`);
  }
  for (const field of REQUIRED_POLICY_FIELDS) {
    if (!(field in parsed)) {
      throw new Error(`ultra-fast-v1 policy is missing required field "${field}": "${filePath}"`);
    }
  }
  if (typeof parsed.sourceCommit !== "string" || parsed.sourceCommit.length === 0) {
    throw new Error(`ultra-fast-v1 policy sourceCommit must be a non-empty string: "${filePath}"`);
  }
  return parsed;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_HANDOFF_FIELDS = [
  "packageClass",
  "scenarioCount",
  "testFileCount",
  "checkpoint",
  "correctionWaveCount",
  "paneMode",
  "speculativePaneCount",
  "concurrency",
  "gcTrigger",
  "fullQaBudget",
  "localFullQaRuns",
  "ciFullQaRuns",
  "visibleUiJourneyChanged",
  "browserTestsRun",
];

function isValidHandoffSchema(handoff) {
  if (!isPlainObject(handoff)) return false;
  for (const field of REQUIRED_HANDOFF_FIELDS) {
    if (!(field in handoff)) return false;
  }
  if (typeof handoff.packageClass !== "string") return false;
  if (typeof handoff.scenarioCount !== "number") return false;
  if (typeof handoff.testFileCount !== "number") return false;
  if (!isPlainObject(handoff.checkpoint)) return false;
  if (typeof handoff.correctionWaveCount !== "number") return false;
  if (typeof handoff.paneMode !== "string") return false;
  if (typeof handoff.speculativePaneCount !== "number") return false;
  if (!isPlainObject(handoff.concurrency)) return false;
  if (typeof handoff.gcTrigger !== "string") return false;
  if (typeof handoff.fullQaBudget !== "number") return false;
  if (typeof handoff.localFullQaRuns !== "number") return false;
  if (typeof handoff.ciFullQaRuns !== "number") return false;
  if (typeof handoff.visibleUiJourneyChanged !== "boolean") return false;
  if (typeof handoff.browserTestsRun !== "number") return false;
  return true;
}

function deny(reason) {
  return { ok: false, reason };
}

/**
 * Evaluates one worker handoff against the canonical policy. Returns `{ ok: true }` or
 * `{ ok: false, reason: <CODE> }` naming the first rule violated, checked in a fixed order.
 */
export function evaluateHandoff(handoff, opts = {}) {
  const policy = opts.policy ?? loadPolicy();

  if (!isValidHandoffSchema(handoff)) return deny("HANDOFF_SCHEMA_INVALID");

  if (handoff.fullQaBudget !== policy.fullQaBudget) return deny("FULL_QA_BUDGET_DRIFT");
  if (handoff.localFullQaRuns > 1) return deny("SAME_SNAPSHOT_LOCAL_FULL_QA_REPEAT");
  if (handoff.localFullQaRuns + handoff.ciFullQaRuns > policy.fullQaBudget) {
    return deny("FULL_QA_BUDGET_EXCEEDED");
  }

  const { scenarioBandMin, scenarioBandMax, testFileCountMax, concurrencyStaticCeiling } = policy.thresholds;

  if (handoff.scenarioCount < scenarioBandMin || handoff.scenarioCount > scenarioBandMax) {
    const exception = handoff.namedRiskException;
    if (!isPlainObject(exception) || typeof exception.reason !== "string" || exception.reason.length === 0) {
      return deny("SCENARIO_COUNT_OUT_OF_BAND");
    }
    const { ceiling } = exception;
    if (
      typeof ceiling !== "number" ||
      !Number.isFinite(ceiling) ||
      ceiling <= 0 ||
      ceiling < scenarioBandMax
    ) {
      return deny("NAMED_RISK_EXCEPTION_INVALID");
    }
    if (handoff.scenarioCount > ceiling) return deny("NAMED_RISK_CEILING_EXCEEDED");
  }
  if (handoff.testFileCount > testFileCountMax) return deny("TEST_FILE_COUNT_EXCEEDED");

  const checkpoint = handoff.checkpoint;
  if (checkpoint.claimsReadiness === true) return deny("CHECKPOINT_CLAIMS_READINESS");
  if (checkpoint.tag !== "pilot") return deny("CHECKPOINT_NOT_PILOT_TAGGED");
  if (checkpoint.minute !== policy.thresholds.checkpointMinute) return deny("CHECKPOINT_MINUTE_MISMATCH");
  if ("outcome" in checkpoint && checkpoint.outcome !== undefined) {
    if (!policy.checkpointTerminalOutcomes.includes(checkpoint.outcome)) {
      return deny("CHECKPOINT_OUTCOME_INVALID");
    }
  }

  if (handoff.correctionWaveCount >= 2 && !handoff.splitOrReplanMarker) {
    return deny("SECOND_CORRECTION_WAVE_REQUIRES_SPLIT_OR_REPLAN");
  }

  if (handoff.speculativePaneCount > 0) return deny("SPECULATIVE_PANE_FORBIDDEN");
  if (handoff.paneMode !== policy.requiredPaneMode) return deny("PANE_MODE_NOT_JIT_EXACT_WORKTREE");

  const concurrency = handoff.concurrency;
  const dynamicMin = Math.min(
    concurrency.guardianRecommendation,
    concurrency.dagReadyCount,
    concurrency.sharedLockCapacity,
    concurrencyStaticCeiling,
  );
  if (concurrency.requested > dynamicMin) return deny("CONCURRENCY_EXCEEDS_DYNAMIC_MIN");

  if (handoff.gcTrigger !== policy.requiredGcTrigger) return deny("GC_TRIGGER_NOT_EVENT_DRIVEN");

  if (handoff.browserTestsRun > 0 && !handoff.visibleUiJourneyChanged) {
    return deny("BROWSER_TEST_WITHOUT_VISIBLE_UI_JOURNEY_CHANGE");
  }

  return { ok: true };
}

/**
 * Rejects a projection doc that hardcodes a numeric threshold the canonical policy already owns.
 * Patterns are derived from the loaded policy's own thresholds, never a second copy of the
 * numbers themselves.
 */
export function validateProjectionText(text, policy) {
  const { scenarioBandMin, scenarioBandMax, checkpointMinute } = policy.thresholds;
  const bandPattern = new RegExp(`\\b${scenarioBandMin}\\s*-\\s*${scenarioBandMax}\\b`);
  const minutePattern = new RegExp(`\\b${checkpointMinute}\\s*-?\\s*minute`, "i");

  if (bandPattern.test(text) || minutePattern.test(text)) {
    return { ok: false, reason: "NUMERIC_THRESHOLD_DUPLICATED_IN_PROJECTION" };
  }
  return { ok: true };
}

/**
 * Runs the canonical ultra-fast-v1 policy and projection assertions: every projection file
 * must exist and must not duplicate a numeric threshold the policy already owns, and the
 * canonical example handoff must be accepted by its own policy. Throws on any violation.
 */
export function runUltraFastV1PolicyCheck() {
  const policy = loadPolicy();

  assert.ok(Array.isArray(policy.projectionFiles) && policy.projectionFiles.length > 0);
  for (const rel of policy.projectionFiles) {
    assert.ok(!path.isAbsolute(rel) && !rel.includes(".."), `${rel} must be a safe repo-relative path`);
    const abs = path.join(root, rel);
    assert.ok(existsSync(abs), `expected projection file ${rel} to exist`);
    const text = readFileSync(abs, "utf8");
    const result = validateProjectionText(text, policy);
    assert.ok(result.ok, `${rel} must not hardcode a duplicate numeric threshold`);
  }

  const canonicalHandoff = {
    packageClass: "L1",
    scenarioCount: 5,
    testFileCount: 1,
    namedRiskException: null,
    checkpoint: { minute: policy.thresholds.checkpointMinute, tag: "pilot", claimsReadiness: false },
    correctionWaveCount: 1,
    splitOrReplanMarker: null,
    paneMode: policy.requiredPaneMode,
    speculativePaneCount: 0,
    concurrency: { guardianRecommendation: 4, dagReadyCount: 5, sharedLockCapacity: 2, requested: 2 },
    gcTrigger: policy.requiredGcTrigger,
    fullQaBudget: policy.fullQaBudget,
    localFullQaRuns: 1,
    ciFullQaRuns: 0,
    visibleUiJourneyChanged: false,
    browserTestsRun: 0,
  };
  const result = evaluateHandoff(canonicalHandoff, { policy });
  assert.ok(result.ok, `canonical example handoff must be accepted by its own policy: ${result.reason}`);

  console.log("ultra-fast-v1 policy: canonical policy and projections classify cleanly (build-time guard only).");
}

function main() {
  runUltraFastV1PolicyCheck();
}

const invokedAsCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) main();
