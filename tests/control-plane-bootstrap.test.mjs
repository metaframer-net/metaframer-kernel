import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const grantedRef = "refs/heads/agent/kernel-control-plane-reconcile";
const remoteAbsenceCommand = `git ls-remote --heads origin ${grantedRef}`;
const expectedBaseSha = "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("raw source inventory is complete, immutable and duplicate-aware", async () => {
  const inventory = await readJson("planning/source-inventory.json");
  const files = inventory.rawInputs.files;

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.rawInputs.configuredPath, "/Users/karaca/Downloads");
  assert.equal(files.length, 40);
  assert.equal(new Set(files.map(({ file }) => file)).size, 40);
  assert.equal(new Set(files.map(({ taskId }) => taskId)).size, 39);

  for (const entry of files) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.match(entry.semanticSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.wbsCode, /^12(?:\.|$)/);
    assert.equal(entry.status, "backlog");
    assert.equal(entry.phase, "requirements");
    assert.match(entry.canonicalNodeRef, /^src\/data\/generated\/nodes\/.+\.json$/);
  }

  assert.deepEqual(inventory.rawInputs.semanticDuplicateGroups, [
    {
      taskId: "k-granulerlik",
      files: [
        "12.4-k-granulerlik-raw (1).json",
        "12.4-k-granulerlik-raw.json",
      ],
      semanticSha256:
        "2bcf49d51d0b6883e0d44e6314120bdefc08eca50fffee080f7aa0a20bfce367",
      differingFields: ["exportedAt"],
      disposition: "retain-both-as-snapshot-evidence",
    },
  ]);
});

test("every raw input is traceable to WBS, requirements and governance", async () => {
  const inventory = await readJson("planning/source-inventory.json");
  const traceability = await readJson("planning/traceability-matrix.json");
  const inventoryFiles = inventory.rawInputs.files.map(({ file }) => file).sort();
  const traceFiles = traceability.entries
    .flatMap(({ sourceFiles }) => sourceFiles)
    .sort();

  assert.deepEqual(traceFiles, inventoryFiles);
  assert.equal(traceability.entries.length, 39);
  assert.equal(new Set(traceability.entries.map(({ taskId }) => taskId)).size, 39);

  for (const entry of traceability.entries) {
    assert.ok(entry.sourceFiles.length > 0);
    assert.ok(entry.taskId);
    assert.match(entry.wbsCode, /^12(?:\.|$)/);
    assert.ok(entry.requirementDomains.length > 0);
    assert.ok(entry.governanceDecisionIds.length > 0);
    assert.ok(
      entry.governanceDecisionIds.every((id) =>
        /^KGA-D(?:0[1-9]|10)$/.test(id),
      ),
    );
    assert.match(entry.canonicalNodeRef, /^src\/data\/generated\/nodes\/.+\.json$/);
  }

  const duplicate = traceability.entries.find(
    ({ taskId }) => taskId === "k-granulerlik",
  );
  assert.deepEqual(duplicate.sourceFiles, [
    "12.4-k-granulerlik-raw (1).json",
    "12.4-k-granulerlik-raw.json",
  ]);
});

test("governance closure proposals preserve the human decision boundary", async () => {
  const governance = await readJson("planning/governance-decisions.json");
  const ids = governance.decisions.map(({ id }) => id);
  const deterministic = governance.decisions
    .filter(({ resolutionClass }) => resolutionClass === "deterministic")
    .map(({ id }) => id);
  const human = governance.decisions
    .filter(({ resolutionClass }) => resolutionClass === "human")
    .map(({ id }) => id);

  assert.deepEqual(ids, [
    "KGA-D01",
    "KGA-D02",
    "KGA-D03",
    "KGA-D04",
    "KGA-D05",
    "KGA-D06",
    "KGA-D07",
    "KGA-D08",
    "KGA-D09",
    "KGA-D10",
  ]);
  assert.deepEqual(deterministic, [
    "KGA-D02",
    "KGA-D03",
    "KGA-D05",
    "KGA-D06",
    "KGA-D07",
  ]);
  assert.deepEqual(human, [
    "KGA-D01",
    "KGA-D04",
    "KGA-D08",
    "KGA-D09",
    "KGA-D10",
  ]);

  for (const decision of governance.decisions) {
    assert.ok(decision.proposedDecision);
    assert.ok(decision.rationale.length > 0);
    assert.ok(decision.evidence.length > 0);
    assert.ok(decision.risks.length > 0);
    assert.ok(decision.acceptanceCriteria.length > 0);
    assert.ok(decision.rollback.trigger);
    assert.ok(decision.rollback.action);
    assert.equal(decision.codeStartAllowed, false);
    assert.equal(
      decision.canonicalStatus,
      "pending",
      `${decision.id} canonical status may only change through authorized Actionplan write-back`,
    );
  }

  for (const id of human) {
    const decision = governance.decisions.find((entry) => entry.id === id);
    assert.equal(decision.proposalStatus, "human-decision-recorded");
    assert.equal(decision.humanDecisionRecord.decider, "user-admin");
    assert.equal(decision.humanDecisionRecord.recordedAt, "2026-07-30");
    assert.equal(
      decision.humanDecisionRecord.requestRef,
      "planning/human-decision-request.json",
    );
    assert.ok(decision.humanDecisionRecord.selectedOptionId);
    assert.ok(decision.humanDecisionRecord.effect.length > 0);
    assert.equal(decision.humanDecisionRecord.canonicalWriteBackAuthorized, false);
  }
});

test("approved human decisions are recorded with durable provenance", async () => {
  const request = await readJson("planning/human-decision-request.json");
  const { response } = request;

  assert.equal(request.status, "answered-recorded");
  assert.equal(request.canonicalWriteBackAuthorized, false);
  assert.equal(response.packageId, request.packageId);
  assert.equal(response.recordedAt, "2026-07-30");
  assert.equal(response.decider, "user-admin");
  assert.equal(
    response.selectionLine,
    "T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A, A01-A",
  );
  assert.deepEqual(response.selectedOptionIds, [
    "T01-A",
    "T02-A",
    "D01-A",
    "D04+D09-A",
    "D08-A",
    "D10-A",
    "A01-A",
  ]);
  assert.deepEqual(
    response.selections.map(({ optionId }) => optionId),
    response.selectedOptionIds,
  );
  assert.deepEqual(
    response.selections.map(({ questionId }) => questionId),
    request.questions.map(({ id }) => id),
  );

  for (const selection of response.selections) {
    const question = request.questions.find(({ id }) => id === selection.questionId);
    assert.ok(question, `${selection.questionId} must exist in the request`);
    assert.ok(
      question.options.some(({ id }) => id === selection.optionId),
      `${selection.optionId} must be a real option of ${selection.questionId}`,
    );
    assert.equal(selection.optionId, question.recommendedOption);
    assert.ok(selection.effect.length > 0);
  }

  const { effects } = response;
  assert.equal(effects.d01DeferredParentCount, 33);
  assert.deepEqual(
    effects.d01DeferredParentIds,
    request.questions.find(({ id }) => id === "D01").recommendedDeferredParentIds,
  );
  assert.equal(effects.d01InventedDescendants, 0);
  assert.equal(effects.d04d09RejectedIdentityCount, 13);
  assert.deepEqual(
    effects.d04d09RejectedIdentityIds,
    request.questions
      .find(({ id }) => id === "D04+D09")
      .recommendedDispositionMatrix.map(({ missingNodeId }) => missingNodeId),
  );
  assert.equal(effects.d04d09DirectiveDisposition, "non-executable-requirements-evidence");
  assert.equal(effects.d08Policy, "quarantine-deprecate-and-reallocate");
  assert.equal(effects.d08AmbiguousIdsUsableAsApprovalRef, false);
  assert.equal(effects.d10PhysicalStrategy, "shared-schema-rls");
  assert.equal(effects.d10TenantDiscriminator, "tenant_id");
  assert.equal(effects.d10RlsDenyByDefault, true);
  assert.equal(effects.d10ThresholdDisposition, "not-applicable-fixed-topology");
  assert.equal(effects.d10AutomaticPromotion, false);
  assert.equal(effects.topologyState, "APPROVED_CONDITIONAL");
  assert.equal(effects.topologyFutureOwner, "metaframer-net/metaframer-kernel");
  assert.equal(effects.topologyActivatesAfter, "all-canonical-KGA-decisions-closed");
  assert.equal(effects.currentImplementationWorkspace, "platform monorepo");
  assert.equal(effects.governanceOwner, "actionplan");
  assert.equal(effects.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
  assert.equal(effects.sourceExtraction, false);
  assert.equal(effects.canonicalWriteBackAuthorized, false);
  assert.equal(effects.runtimeCodeAllowed, false);
  assert.equal(effects.codeStartAllowed, false);
  assert.equal(effects.releaseDecision, "NO_GO");
});

test("the one-shot publish grant never becomes standing or Claude-consumable", async () => {
  const { response } = await readJson("planning/human-decision-request.json");
  const grant = response.oneShotGitAuthorization;
  const audit = response.remoteAudit;

  assert.equal(grant.scope, "one-shot");
  assert.equal(grant.repository, "metaframer-net/metaframer-kernel");
  assert.equal(grant.branch, "agent/kernel-control-plane-reconcile");
  assert.equal(grant.expectedBaseSha, "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434");
  assert.equal(grant.ref, "refs/heads/agent/kernel-control-plane-reconcile");
  assert.equal(grant.pushMode, "normal-non-force");
  assert.equal(grant.force, false);
  assert.equal(grant.tags, false);
  assert.equal(grant.commit, true);
  assert.equal(grant.push, true);
  assert.equal(grant.defaultBranchPush, false);
  assert.equal(grant.pullRequest, false);
  assert.equal(grant.grantee, "codex");
  assert.equal(grant.executor, "codex");
  assert.equal(grant.consumableByClaude, false);
  assert.equal(grant.standingAuthorization, false);
  assert.equal(grant.reuseAllowed, false);
  assert.equal(grant.consumptionStatus, "unconsumed");
  assert.equal(grant.consumedAt, null);
  assert.match(grant.consumptionRule, /first successful normal non-force push/);
  assert.ok(
    grant.consumptionRule.includes("refs/heads/agent/kernel-control-plane-reconcile"),
    "the consumption rule must name the exact granted ref",
  );
  assert.match(grant.consumptionRule, /new exact human approval/);
  assert.ok(
    grant.evidenceRule.includes("descendant of expected base 90e5f6ac2b8beb4d8be1064390ba433b2bbdd434"),
    "the evidence rule must pin the descendant check to the expected base",
  );
  assert.match(grant.evidenceRule, /push to main .*is outside this grant/);
  assert.equal(grant.merge, false);
  assert.equal(grant.release, false);
  assert.equal(grant.deploy, false);
  assert.equal(grant.actionplanWriteBack, false);
  assert.equal(grant.runtimeImplementation, false);

  assert.equal(
    grant.consumptionAuthority,
    "remote-ref-absence-before-first-push",
    "remote-ref state, not the static field, must be the consumption fence",
  );
  assert.equal(grant.prePushVerificationCommand, remoteAbsenceCommand);
  assert.ok(
    grant.prePushRule.includes(remoteAbsenceCommand),
    "the preflight rule must name the exact remote absence command",
  );
  assert.match(grant.prePushRule, /no matching ref and no output/);
  assert.match(grant.prePushRule, /already spent/);
  assert.match(grant.prePushRule, /stop immediately/);
  assert.ok(
    grant.postPushEvidenceRule.includes("must equal the local commit"),
    "the post-push rule must require remote/local commit equality",
  );
  assert.ok(
    grant.postPushEvidenceRule.includes(`descend from expected base ${expectedBaseSha}`),
    "the post-push rule must keep the expected-base ancestry check",
  );
  assert.equal(grant.consumptionStatusAuthority, "snapshot-evidence-only");
  assert.match(
    grant.consumptionStatusNote,
    /never sufficient authority after publication/,
  );

  const authority = response.selections.find(({ questionId }) => questionId === "A01");
  assert.equal(authority.optionId, "A01-A");
  assert.equal(authority.oneShotGitAuthorizationRef, "response.oneShotGitAuthorization");
  assert.equal(response.effects.a01StandingAuthorization, false);
  assert.equal(response.effects.a01OneShotReuseAllowed, false);
  assert.equal(response.effects.a01OneShotExecutor, "codex");

  assert.equal(audit.repository, "metaframer-net/metaframer-kernel");
  assert.equal(audit.visibility, "private");
  assert.equal(audit.defaultBranch, "main");
  assert.equal(audit.mainSha, "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434");
  assert.equal(audit.otherRemoteBranches, 0);
  assert.equal(audit.pullRequests, 0);
  assert.equal(audit.releases, 0);
  assert.equal(audit.actionsRuns, 0);
  assert.equal(audit.remoteRuntimeDevelopmentObserved, false);
});

test("the CLAUDE_ONLY writer lock is machine-enforced and matches AGENTS.md", async () => {
  const state = await readJson("planning/bootstrap-state.json");
  const { response } = await readJson("planning/human-decision-request.json");
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const policy = state.codingPolicy;

  assert.deepEqual(
    policy,
    response.codingPolicy,
    "the resume state and approval provenance must mirror one identical policy",
  );

  assert.equal(policy.mode, "CLAUDE_ONLY");
  assert.equal(policy.persistent, true);
  assert.equal(policy.active, true);
  assert.equal(policy.immutable, true);
  assert.equal(policy.singleActiveWriter, true);
  assert.equal(policy.fallbackWriter, null);
  assert.equal(policy.fallbackWriterAllowed, false);
  assert.equal(policy.separateCodeStartAuthorityRequired, true);

  assert.equal(policy.writer.agent, "claude");
  // Immutable historical approval record: preserved byte-faithfully, never retro-fitted.
  assert.equal(policy.writer.invocation, "claude_implement");
  assert.equal(policy.writer.role, "bounded-worker");
  assert.equal(policy.writer.mayOrchestrate, false);
  assert.deepEqual(policy.writer.forbiddenActions, [
    "commit",
    "push",
    "merge",
    "release",
    "deploy",
  ]);

  assert.equal(policy.master.agent, "codex");
  assert.equal(policy.master.role, "MASTER");
  assert.equal(policy.master.finalReviewer, true);
  assert.equal(policy.master.ownsScopeAndRollback, true);
  assert.equal(policy.master.mayWriteFilesInScope, false);
  assert.equal(policy.master.isFallbackWriter, false);

  assert.deepEqual(policy.scope.appliesTo, [
    "code",
    "tests",
    "tools",
    "scripts",
    "schemas",
    "config",
    "migrations",
    "associated-planning-docs",
  ]);
  assert.equal(
    policy.scope.trigger,
    "any repository file modification that forms a coding or implementation package",
  );

  assert.deepEqual(policy.authGate, {
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    subscriptionType: "max",
  });
  assert.deepEqual(policy.prohibitedAuthPaths, [
    "anthropic-api-key",
    "api-credits",
    "auth-token-override",
    "bedrock",
    "vertex",
    "foundry",
    "proxy",
    "provider-fallback",
  ]);
  assert.equal(policy.providerFallbackAllowed, false);
  assert.equal(policy.onAuthFailure, "fail-closed-no-other-writer");

  assert.equal(policy.capabilityUse.evaluateRelevantAgentsSkillsMcps, true);
  assert.equal(policy.capabilityUse.mayAlterAuthorityHierarchy, false);

  assert.match(agents, /^## Immutable CLAUDE-ONLY writer lock$/m);
  // Additive current successor invocation, asserted separately from the historical record.
  const readinessPackage = JSON.parse(
    readFileSync(path.join(root, "planning/kernel-ai-development-readiness.json"), "utf8"),
  );
  const successor = readinessPackage.successorInvocationPolicy;
  assert.ok(successor, "readiness package must record the successor invocation policy");
  assert.equal(successor.currentWorkerInvocation, "pane-visible-agent-claude");
  assert.equal(successor.forbiddenInvocation, "mcp-claude_implement");
  assert.equal(successor.historicalInvocation, "claude_implement");
  assert.equal(successor.historicalPolicyRewritten, false);
  assert.match(agents, /Immutable historical approval record/);
  assert.match(agents, /Additive current successor invocation/);
  assert.ok(
    !/this text and those two mirrors must always agree/.test(agents),
    "AGENTS.md must not claim the active text and the historical mirrors are identical",
  );

  for (const literal of [
    "CLAUDE_ONLY",
    "claude_implement",
    "pane-visible-agent-claude",
    "single active writer",
    "no fallback writer",
    "loggedIn=true",
    "authMethod=claude.ai",
    "apiProvider=firstParty",
    "subscriptionType=max",
    "separate code-start authority",
    "fail closed",
  ]) {
    assert.ok(agents.includes(literal), `AGENTS.md lock must state ${literal}`);
  }
  assert.ok(agents.includes("<!-- pane-agent-context:start -->"));
  assert.ok(agents.includes("<!-- pane-agent-context:end -->"));
});

test("resume state records the approved decisions and stays fail-closed", async () => {
  const state = await readJson("planning/bootstrap-state.json");
  const status = await readJson("repository-status.json");

  assert.equal(state.lifecycleState, "APPROVED_AWAITING_CANONICAL_WRITEBACK");
  assert.equal(state.runtimeCodeAllowed, false);
  assert.equal(state.releaseDecision, "NO_GO");
  assert.equal(state.currentPhase, "planning-bootstrap");
  assert.equal(state.phaseStatus, "validated-decisions-recorded");
  assert.equal(state.nextAction, "obtain-actionplan-canonical-writeback-authority");
  assert.deepEqual(state.requiredChecks, ["npm test", "npm run check"]);

  const [bootstrapRed, approvalRed] = state.testResults.redEvidenceHistory;
  assert.equal(state.testResults.redEvidenceHistory.length, 2);
  assert.equal(bootstrapRed.phase, "initial-bootstrap");
  assert.equal(bootstrapRed.failingTestCount, 5);
  assert.equal(bootstrapRed.observed, "5 tests, 0 pass, 5 fail");
  assert.equal(approvalRed.phase, "approval-reconciliation");
  assert.equal(approvalRed.failingTestCount, 7);
  assert.deepEqual(approvalRed.failingTestNames, [
    "governance closure proposals preserve the human decision boundary",
    "approved human decisions are recorded with durable provenance",
    "the one-shot publish grant never becomes standing or Claude-consumable",
    "the CLAUDE_ONLY writer lock is machine-enforced and matches AGENTS.md",
    "resume state records the approved decisions and stays fail-closed",
    "no artifact still presents the human decision as the current state",
    "repository status stays fail-closed until the runtime decision gate is complete",
  ]);
  assert.equal(approvalRed.failingTestNames.length, approvalRed.failingTestCount);

  assert.equal(state.testResults.greenEvidence.status, "passed");
  assert.equal(state.testResults.greenEvidence.testsPassed, 12);
  assert.equal(state.testResults.greenEvidence.testsFailed, 0);
  assert.match(state.testResults.greenEvidence.result, /^12 tests passed;/);
  assert.equal(state.testResults.sourceVerification.status, "passed");
  assert.match(
    state.testResults.sourceVerification.result,
    /40 raw files, 39 unique tasks and actionplan@5087469/,
  );

  assert.equal(state.blockers.length, 7);
  for (const blocker of state.blockers) {
    assert.equal(blocker.status, "closed-locally");
    assert.ok(blocker.resolvedBy);
  }
  const canonicalTracked = state.blockers.filter(({ canonicalStatus }) => canonicalStatus);
  assert.deepEqual(canonicalTracked.map(({ id }) => id), [
    "KGA-D01",
    "KGA-D04",
    "KGA-D08",
    "KGA-D09",
    "KGA-D10",
  ]);
  assert.ok(canonicalTracked.every(({ canonicalStatus }) => canonicalStatus === "pending"));

  assert.equal(state.governance.canonicalStatus, "pending");
  assert.equal(state.governance.canonicalWriteBackAuthorized, false);
  assert.equal(
    state.approvedDecisions.requestRef,
    "planning/human-decision-request.json",
  );
  assert.equal(
    state.approvedDecisions.packageId,
    "kernel-bootstrap-human-decisions-2026-07-30",
  );
  assert.equal(state.approvedDecisions.decider, "user-admin");
  assert.equal(state.approvedDecisions.recordedAt, "2026-07-30");
  assert.deepEqual(state.approvedDecisions.selectedOptionIds, [
    "T01-A",
    "T02-A",
    "D01-A",
    "D04+D09-A",
    "D08-A",
    "D10-A",
    "A01-A",
  ]);
  assert.equal(state.approvedDecisions.standingAuthorization, false);

  assert.equal(state.sourceTopology.state, "APPROVED_CONDITIONAL");
  assert.equal(state.sourceTopology.futureOwner, "metaframer-net/metaframer-kernel");
  assert.equal(
    state.sourceTopology.activatesAfter,
    "all-canonical-KGA-decisions-closed",
  );
  assert.equal(
    state.sourceTopology.currentImplementationWorkspace,
    "platform monorepo",
  );
  assert.equal(state.sourceTopology.governanceOwner, "actionplan");
  assert.equal(state.sourceTopology.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
  assert.equal(state.sourceTopology.sourceExtraction, false);
  const effective = state.effectiveAuthorization;
  assert.equal(
    effective.scope,
    "standing",
    "effectiveAuthorization must stay a standing/default-deny model",
  );
  assert.deepEqual(effective.standingActions, {
    commit: false,
    push: false,
    merge: false,
    release: false,
    deploy: false,
    actionplanWriteBack: false,
    downloadsWrite: false,
    runtimeImplementation: false,
  });
  assert.ok(
    Object.values(effective.standingActions).every((value) => value === false),
    "no standing action may ever be true under A01-A",
  );
  assert.equal(effective.oneShotGitAuthorizationRef, "response.oneShotGitAuthorization");

  const effectiveOneShot = effective.oneShotGitAuthorization;
  assert.equal(
    effectiveOneShot.sourceRef,
    "planning/human-decision-request.json#/response/oneShotGitAuthorization",
  );
  assert.equal(effectiveOneShot.scope, "one-shot");
  assert.equal(effectiveOneShot.grantedAfter, "A01-A");
  assert.equal(effectiveOneShot.ref, "refs/heads/agent/kernel-control-plane-reconcile");
  assert.equal(
    effectiveOneShot.expectedBaseSha,
    "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434",
  );
  assert.equal(effectiveOneShot.pushMode, "normal-non-force");
  assert.equal(effectiveOneShot.executor, "codex");
  assert.equal(effectiveOneShot.consumableByClaude, false);
  assert.equal(effectiveOneShot.reuseAllowed, false);
  assert.equal(effectiveOneShot.consumptionStatus, "unconsumed");
  assert.equal(effectiveOneShot.pullRequest, false);
  assert.equal(
    effectiveOneShot.consumptionAuthority,
    "remote-ref-absence-before-first-push",
  );
  assert.equal(effectiveOneShot.prePushVerificationCommand, remoteAbsenceCommand);
  assert.ok(effectiveOneShot.prePushRule.includes(remoteAbsenceCommand));
  assert.match(effectiveOneShot.prePushRule, /no matching ref and no output/);
  assert.match(effectiveOneShot.prePushRule, /already spent/);
  assert.ok(
    effectiveOneShot.postPushEvidenceRule.includes("must equal the local commit"),
  );
  assert.ok(
    effectiveOneShot.postPushEvidenceRule.includes(
      `descend from expected base ${expectedBaseSha}`,
    ),
  );
  assert.equal(effectiveOneShot.consumptionStatusAuthority, "snapshot-evidence-only");
  assert.match(
    effectiveOneShot.consumptionStatusNote,
    /snapshot evidence only/,
  );

  const { response } = await readJson("planning/human-decision-request.json");
  const grant = response.oneShotGitAuthorization;
  assert.equal(grant.commit, true);
  assert.equal(grant.push, true);
  assert.equal(grant.branch, "agent/kernel-control-plane-reconcile");
  assert.equal(grant.ref, effectiveOneShot.ref);
  assert.equal(grant.expectedBaseSha, effectiveOneShot.expectedBaseSha);
  assert.equal(grant.pushMode, effectiveOneShot.pushMode);
  assert.equal(grant.executor, effectiveOneShot.executor);
  assert.equal(grant.consumptionStatus, effectiveOneShot.consumptionStatus);
  assert.equal(grant.consumptionAuthority, effectiveOneShot.consumptionAuthority);
  assert.equal(
    grant.prePushVerificationCommand,
    effectiveOneShot.prePushVerificationCommand,
  );
  for (const denied of [
    "force",
    "tags",
    "defaultBranchPush",
    "pullRequest",
    "standingAuthorization",
    "reuseAllowed",
    "consumableByClaude",
    "merge",
    "release",
    "deploy",
    "actionplanWriteBack",
    "runtimeImplementation",
  ]) {
    assert.equal(grant[denied], false, `the one-shot grant must keep ${denied} false`);
  }

  assert.equal(status.classification, "PLANNING_ONLY");
  assert.equal(status.runtime.status, "VALID_BLOCKED");
  assert.equal(status.runtime.releaseDecision, "NO_GO");
  assert.equal(status.decisionGate.state, "INCOMPLETE");
  assert.equal(status.sourceTopology.state, "APPROVED_CONDITIONAL");
  assert.equal(
    status.planningControlPlane.state,
    "APPROVED_AWAITING_CANONICAL_WRITEBACK",
  );
  assert.equal(status.planningControlPlane.rawInputCount, 40);
  assert.equal(status.planningControlPlane.uniqueTaskCount, 39);
});

test("no artifact still presents the human decision as the current state", async () => {
  const staleTokens = [
    "AWAITING_HUMAN_DECISIONS",
    "PENDING_HUMAN_DECISION",
    "collect-consolidated-human-decision",
    "awaiting-single-consolidated-response",
    "validated-awaiting-human",
    "human-decision-required",
  ];

  for (const relativePath of [
    "AGENTS.md",
    "README.md",
    "repository-status.json",
    "docs/repository-boundary.md",
    "docs/control-plane-bootstrap.md",
    "docs/human-decision-package.md",
    "docs/resume-runbook.md",
    "planning/bootstrap-state.json",
    "planning/governance-decisions.json",
    "planning/human-decision-request.json",
    "tools/check-control-plane-bootstrap.mjs",
  ]) {
    const content = await readFile(path.join(root, relativePath), "utf8");
    for (const token of staleTokens) {
      assert.ok(
        !content.includes(token),
        `${relativePath} still presents ${token} as the current state`,
      );
    }
  }
});

test("the resume runbook records the remote-ref consumption fence statically", async () => {
  const runbook = await readFile(path.join(root, "docs/resume-runbook.md"), "utf8");
  const { response } = await readJson("planning/human-decision-request.json");
  const grant = response.oneShotGitAuthorization;

  assert.ok(
    runbook.includes(remoteAbsenceCommand),
    "the runbook must display the exact remote absence command",
  );
  assert.ok(
    runbook.includes(grant.prePushVerificationCommand),
    "the runbook command must match the recorded prePushVerificationCommand",
  );
  assert.ok(
    runbook.includes(grantedRef),
    "the runbook must name the exact granted ref",
  );
  assert.match(runbook, /empty output/);
  assert.match(
    runbook,
    /If any matching ref exists at any SHA, the grant is\s+already spent: stop immediately/,
    "the runbook must stop execution when the remote ref already exists",
  );
  assert.match(runbook, /snapshot evidence only/);
  assert.match(runbook, /authoritative pre-consumption proof/);
  assert.ok(
    runbook.includes("must equal the local commit"),
    "the runbook must keep the post-push remote/local equality proof",
  );
  assert.ok(
    runbook.includes(`git merge-base --is-ancestor ${expectedBaseSha} FETCH_HEAD`),
    "the runbook must keep the post-push expected-base ancestry proof",
  );
});

test("human-readable control-plane handoff files exist", async () => {
  for (const relativePath of [
    "docs/control-plane-bootstrap.md",
    "docs/human-decision-package.md",
    "docs/resume-runbook.md",
  ]) {
    const content = await readFile(path.join(root, relativePath), "utf8");
    assert.ok(content.length > 500, `${relativePath} must be substantive`);
    assert.ok(content.includes("PLANNING_ONLY"));
    assert.ok(content.includes("NO_GO"));
  }
});
