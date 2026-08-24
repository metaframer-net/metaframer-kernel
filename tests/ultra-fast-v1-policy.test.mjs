import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

import {
  loadPolicy,
  evaluateHandoff,
  validateProjectionText,
  POLICY_PATH,
  EXTERNAL_BUDGET_REFERENCE,
} from "../tools/check-ultra-fast-v1-policy.mjs";

const root = path.resolve(import.meta.dirname, "..");

function baseHandoff(overrides = {}) {
  return {
    packageClass: "L1",
    scenarioCount: 5,
    testFileCount: 1,
    namedRiskException: null,
    checkpoint: { minute: 20, tag: "pilot", claimsReadiness: false },
    correctionWaveCount: 1,
    splitOrReplanMarker: null,
    paneMode: "jit-exact-worktree",
    speculativePaneCount: 0,
    concurrency: { guardianRecommendation: 4, dagReadyCount: 5, sharedLockCapacity: 2, requested: 2 },
    gcTrigger: "event-driven",
    fullQaBudget: 2,
    localFullQaRuns: 1,
    ciFullQaRuns: 0,
    visibleUiJourneyChanged: false,
    browserTestsRun: 0,
    ...overrides,
  };
}

test("canonical policy preserves fullQa=2 and claims no readiness/runtime authority", () => {
  const policy = loadPolicy();
  assert.equal(policy.fullQaBudget, 2, "existing exactly-two-full-QA rule must remain unchanged");
  assert.equal(policy.releaseAllowed, false);
  assert.equal(policy.runtimeAuthorityClaimed, false);
  assert.equal(policy.readinessClaimed, false);
  assert.equal(typeof policy.sourceCommit, "string");
  assert.ok(policy.sourceCommit.length > 0, "policy must record its authoring source commit");

  const preCi = evaluateHandoff(baseHandoff({ fullQaBudget: 2, localFullQaRuns: 1, ciFullQaRuns: 0 }));
  assert.equal(preCi.ok, true, "writer-local full QA before CI must be allowed");

  const driftedBudget = evaluateHandoff(baseHandoff({ fullQaBudget: 3 }));
  assert.equal(driftedBudget.ok, false);
  assert.equal(driftedBudget.reason, "FULL_QA_BUDGET_DRIFT");

  const localRepeat = evaluateHandoff(baseHandoff({ localFullQaRuns: 2, ciFullQaRuns: 0 }));
  assert.equal(localRepeat.ok, false);
  assert.equal(localRepeat.reason, "SAME_SNAPSHOT_LOCAL_FULL_QA_REPEAT");

  const postCi = evaluateHandoff(baseHandoff({ localFullQaRuns: 1, ciFullQaRuns: 1 }));
  assert.equal(postCi.ok, true, "one writer-local run plus one CI run must be allowed");

  const overTotal = evaluateHandoff(baseHandoff({ localFullQaRuns: 1, ciFullQaRuns: 2 }));
  assert.equal(overTotal.ok, false);
  assert.equal(overTotal.reason, "FULL_QA_BUDGET_EXCEEDED");
});

test("normal L1 scenario band is 3-8 with an explicit fail-closed named-risk exception", () => {
  const inBand = evaluateHandoff(baseHandoff({ scenarioCount: 3 }));
  assert.equal(inBand.ok, true);

  const topOfBand = evaluateHandoff(baseHandoff({ scenarioCount: 8 }));
  assert.equal(topOfBand.ok, true);

  const belowBand = evaluateHandoff(baseHandoff({ scenarioCount: 2 }));
  assert.equal(belowBand.ok, false);
  assert.equal(belowBand.reason, "SCENARIO_COUNT_OUT_OF_BAND");

  const overBandNoException = evaluateHandoff(baseHandoff({ scenarioCount: 12, namedRiskException: null }));
  assert.equal(overBandNoException.ok, false);
  assert.equal(overBandNoException.reason, "SCENARIO_COUNT_OUT_OF_BAND");

  const overBandWithException = evaluateHandoff(
    baseHandoff({
      scenarioCount: 12,
      packageClass: "governance-checker",
      namedRiskException: { reason: "rule-enumeration package", ceiling: 15 },
    }),
  );
  assert.equal(overBandWithException.ok, true);

  const overExceptionCeiling = evaluateHandoff(
    baseHandoff({
      scenarioCount: 16,
      packageClass: "governance-checker",
      namedRiskException: { reason: "rule-enumeration package", ceiling: 15 },
    }),
  );
  assert.equal(overExceptionCeiling.ok, false);
  assert.equal(overExceptionCeiling.reason, "NAMED_RISK_CEILING_EXCEEDED");

  const tooManyFiles = evaluateHandoff(baseHandoff({ testFileCount: 3 }));
  assert.equal(tooManyFiles.ok, false);
  assert.equal(tooManyFiles.reason, "TEST_FILE_COUNT_EXCEEDED");

  const policy = loadPolicy();
  const invalidCeilings = [undefined, "15", NaN, Infinity, 0, -5, policy.thresholds.scenarioBandMax - 1];
  for (const ceiling of invalidCeilings) {
    const invalidException = evaluateHandoff(
      baseHandoff({
        scenarioCount: 12,
        packageClass: "governance-checker",
        namedRiskException: { reason: "rule-enumeration package", ceiling },
      }),
    );
    assert.equal(invalidException.ok, false, `ceiling ${String(ceiling)} must be rejected`);
    assert.equal(invalidException.reason, "NAMED_RISK_EXCEPTION_INVALID");
  }
});

test("20-minute checkpoint is pilot-only with exact terminal outcomes; second correction needs split/replan", () => {
  const validPilot = evaluateHandoff(baseHandoff());
  assert.equal(validPilot.ok, true);

  const claimsReadiness = evaluateHandoff(
    baseHandoff({ checkpoint: { minute: 20, tag: "pilot", claimsReadiness: true } }),
  );
  assert.equal(claimsReadiness.ok, false);
  assert.equal(claimsReadiness.reason, "CHECKPOINT_CLAIMS_READINESS");

  const missingPilotTag = evaluateHandoff(
    baseHandoff({ checkpoint: { minute: 20, tag: "release", claimsReadiness: false } }),
  );
  assert.equal(missingPilotTag.ok, false);
  assert.equal(missingPilotTag.reason, "CHECKPOINT_NOT_PILOT_TAGGED");

  for (const outcome of ["READY_FOR_CI", "CLEAN_SPLIT_OR_ROLLBACK", "BLOCKED_WITH_ONE_EVIDENCE"]) {
    const withOutcome = evaluateHandoff(
      baseHandoff({ checkpoint: { minute: 20, tag: "pilot", claimsReadiness: false, outcome } }),
    );
    assert.equal(withOutcome.ok, true, `expected terminal outcome ${outcome} to be accepted`);
  }
  const badOutcome = evaluateHandoff(
    baseHandoff({ checkpoint: { minute: 20, tag: "pilot", claimsReadiness: false, outcome: "MOSTLY_DONE" } }),
  );
  assert.equal(badOutcome.ok, false);
  assert.equal(badOutcome.reason, "CHECKPOINT_OUTCOME_INVALID");

  const secondWaveWithoutMarker = evaluateHandoff(
    baseHandoff({ correctionWaveCount: 2, splitOrReplanMarker: null }),
  );
  assert.equal(secondWaveWithoutMarker.ok, false);
  assert.equal(secondWaveWithoutMarker.reason, "SECOND_CORRECTION_WAVE_REQUIRES_SPLIT_OR_REPLAN");

  const secondWaveWithMarker = evaluateHandoff(
    baseHandoff({ correctionWaveCount: 2, splitOrReplanMarker: "SPLIT_REQUESTED" }),
  );
  assert.equal(secondWaveWithMarker.ok, true);

  const policy = loadPolicy();
  const mismatchedMinute = evaluateHandoff(
    baseHandoff({
      checkpoint: { minute: policy.thresholds.checkpointMinute + 1, tag: "pilot", claimsReadiness: false },
    }),
  );
  assert.equal(mismatchedMinute.ok, false);
  assert.equal(mismatchedMinute.reason, "CHECKPOINT_MINUTE_MISMATCH");
});

test("JIT exact-worktree Pane, bounded dynamic concurrency, no speculative Panes, event-driven GC-02", () => {
  const validPane = evaluateHandoff(baseHandoff());
  assert.equal(validPane.ok, true);

  const speculativePane = evaluateHandoff(baseHandoff({ speculativePaneCount: 1 }));
  assert.equal(speculativePane.ok, false);
  assert.equal(speculativePane.reason, "SPECULATIVE_PANE_FORBIDDEN");

  const notJit = evaluateHandoff(baseHandoff({ paneMode: "pre-created" }));
  assert.equal(notJit.ok, false);
  assert.equal(notJit.reason, "PANE_MODE_NOT_JIT_EXACT_WORKTREE");

  const concurrencyOk = evaluateHandoff(
    baseHandoff({
      concurrency: { guardianRecommendation: 5, dagReadyCount: 5, sharedLockCapacity: 5, requested: 3 },
    }),
  );
  assert.equal(concurrencyOk.ok, true);

  const concurrencyTooHigh = evaluateHandoff(
    baseHandoff({
      concurrency: { guardianRecommendation: 5, dagReadyCount: 5, sharedLockCapacity: 5, requested: 4 },
    }),
  );
  assert.equal(concurrencyTooHigh.ok, false);
  assert.equal(concurrencyTooHigh.reason, "CONCURRENCY_EXCEEDS_DYNAMIC_MIN");

  const concurrencyBoundedByLock = evaluateHandoff(
    baseHandoff({
      concurrency: { guardianRecommendation: 5, dagReadyCount: 5, sharedLockCapacity: 1, requested: 1 },
    }),
  );
  assert.equal(concurrencyBoundedByLock.ok, true);

  const scheduledGc = evaluateHandoff(baseHandoff({ gcTrigger: "scheduled-timer" }));
  assert.equal(scheduledGc.ok, false);
  assert.equal(scheduledGc.reason, "GC_TRIGGER_NOT_EVENT_DRIVEN");
});

test("projection docs reference the canonical policy without duplicating its numeric thresholds", () => {
  const policy = loadPolicy();
  assert.ok(Array.isArray(policy.projectionFiles) && policy.projectionFiles.length > 0);

  const expected = [
    ".claude/skills/ultra-fast-development/SKILL.md",
    ".claude/agents/ultra-fast-test-writer.md",
    ".claude/agents/ultra-fast-implementation-writer.md",
    ".claude/agents/ultra-fast-reviewer.md",
    "RULES.md",
  ];
  for (const file of expected) {
    assert.ok(
      policy.projectionFiles.includes(file),
      `expected canonical policy to declare ${file} as a numeric-free projection`,
    );
  }

  for (const rel of policy.projectionFiles) {
    assert.ok(!path.isAbsolute(rel) && !rel.includes(".."), `${rel} must be a safe repo-relative path`);
    const abs = path.join(root, rel);
    assert.ok(existsSync(abs), `expected projection file ${rel} to exist`);
    const text = readFileSync(abs, "utf8");
    const result = validateProjectionText(text, policy);
    assert.equal(result.ok, true, `${rel} must not hardcode a duplicate numeric threshold`);
  }

  const duplicatedThresholdSample = `
The default scenario band for a normal L1 package is 3-8 scenarios.
The safe checkpoint fires every 20 minutes.
See planning/ultra-fast-v1-policy.json for the canonical band and checkpoint minute.
`;
  const negative = validateProjectionText(duplicatedThresholdSample, policy);
  assert.equal(negative.ok, false);
  assert.equal(negative.reason, "NUMERIC_THRESHOLD_DUPLICATED_IN_PROJECTION");

  const uiJourneyUnchanged = evaluateHandoff(baseHandoff({ visibleUiJourneyChanged: false, browserTestsRun: 1 }));
  assert.equal(uiJourneyUnchanged.ok, false);
  assert.equal(uiJourneyUnchanged.reason, "BROWSER_TEST_WITHOUT_VISIBLE_UI_JOURNEY_CHANGE");

  const uiJourneyChanged = evaluateHandoff(baseHandoff({ visibleUiJourneyChanged: true, browserTestsRun: 1 }));
  assert.equal(uiJourneyChanged.ok, true);

  const skillText = readFileSync(path.join(root, ".claude/skills/ultra-fast-development/SKILL.md"), "utf8");
  assert.ok(
    !skillText.includes("npm run check:ultra-fast-v1-policy"),
    "skill must not name the nonexistent npm run check:ultra-fast-v1-policy command",
  );
  assert.ok(
    skillText.includes("npm run check") || skillText.includes("node tools/check-ultra-fast-v1-policy.mjs"),
    "skill must name a real invocation path for the policy checker",
  );
});

test("validator fails closed on missing/malformed policy and rejects invalid handoffs, accepts canonical one", () => {
  assert.throws(() => loadPolicy({ path: path.join(root, "planning", "does-not-exist.json") }), /policy/i);
  assert.throws(() => loadPolicy({ path: path.join(root, "package.json") }), /policy/i);

  assert.doesNotThrow(() => loadPolicy({ path: POLICY_PATH }));

  const missingFields = evaluateHandoff({});
  assert.equal(missingFields.ok, false);
  assert.equal(missingFields.reason, "HANDOFF_SCHEMA_INVALID");

  const canonical = evaluateHandoff(baseHandoff());
  assert.equal(canonical.ok, true);

  assert.equal(typeof EXTERNAL_BUDGET_REFERENCE, "string");
  assert.ok(
    EXTERNAL_BUDGET_REFERENCE.includes("short-code.json#changePackageBudget"),
    "must reference the external canonical budget pointer read-only, never copy its numbers",
  );
});
