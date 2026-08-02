import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const grantedRef = "refs/heads/agent/kernel-control-plane-reconcile";
const remoteAbsenceCommand = `git ls-remote --heads origin ${grantedRef}`;
const expectedBaseSha = "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434";
const kgaIds = Array.from(
  { length: 10 },
  (_, index) => `KGA-D${String(index + 1).padStart(2, "0")}`,
);
const deterministicIds = [
  "KGA-D02",
  "KGA-D03",
  "KGA-D05",
  "KGA-D06",
  "KGA-D07",
];
const humanIds = [
  "KGA-D01",
  "KGA-D04",
  "KGA-D08",
  "KGA-D09",
  "KGA-D10",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const [inventory, traceability, governance, humanRequest, state, status] =
  await Promise.all([
    readJson("planning/source-inventory.json"),
    readJson("planning/traceability-matrix.json"),
    readJson("planning/governance-decisions.json"),
    readJson("planning/human-decision-request.json"),
    readJson("planning/bootstrap-state.json"),
    readJson("repository-status.json"),
  ]);

assert.equal(inventory.schemaVersion, 1);
assert.equal(inventory.rawInputs.readOnly, true);
assert.equal(inventory.rawInputs.fileCount, 40);
assert.equal(inventory.rawInputs.uniqueTaskCount, 39);
assert.equal(inventory.rawInputs.totalBytes, 7894060);
assert.equal(inventory.rawInputs.files.length, 40);
assert.equal(
  inventory.rawInputs.aggregateSha256,
  "6f46808be102addddf1d37a96460d9a8f49e4021f911bacf4bb88a61d0881415",
);
assert.equal(
  new Set(inventory.rawInputs.files.map(({ file }) => file)).size,
  40,
);
assert.equal(
  new Set(inventory.rawInputs.files.map(({ taskId }) => taskId)).size,
  39,
);
assert.equal(inventory.rawInputs.semanticDuplicateGroups.length, 1);
assert.deepEqual(
  inventory.rawInputs.semanticDuplicateGroups[0].files,
  ["12.4-k-granulerlik-raw (1).json", "12.4-k-granulerlik-raw.json"],
);

for (const file of inventory.rawInputs.files) {
  assert.match(file.file, /^[^/]+\.json$/);
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.match(file.semanticSha256, /^[a-f0-9]{64}$/);
  assert.match(file.taskId, /^[a-z0-9-]+$/);
  assert.match(file.wbsCode, /^12(?:\.|$)/);
  assert.match(file.canonicalNodeRef, /^src\/data\/generated\/nodes\/.+\.json$/);
  assert.match(file.canonicalNodeSha256, /^[a-f0-9]{64}$/);
}

assert.equal(traceability.authority.rawInputsRemainReadOnly, true);
assert.equal(traceability.authority.rawTextIsUntrustedData, true);
assert.deepEqual(traceability.classificationCounts, {
  REQ_KERNEL: 17,
  WBS_DEMO: 4,
  URLP_PLATFORM_HANDOFF: 18,
});
assert.deepEqual(traceability.coverageSummary, {
  uniqueTaskCount: 39,
  sourceFileCount: 40,
  acceptanceCriteria: 436,
  risks: 74,
  deliverables: 266,
  resolvedDirectives: 593,
  resolvedStandards: 712,
  dependsOn: 53,
  blocks: 85,
  related: 136,
});
assert.equal(traceability.entries.length, 39);
assert.deepEqual(
  traceability.entries.flatMap(({ sourceFiles }) => sourceFiles).sort(),
  inventory.rawInputs.files.map(({ file }) => file).sort(),
);

const inventoryByFile = new Map(
  inventory.rawInputs.files.map((entry) => [entry.file, entry]),
);
const coverageFields = [
  "acceptanceCriteria",
  "risks",
  "deliverables",
  "resolvedDirectives",
  "resolvedStandards",
  "dependsOn",
  "blocks",
  "related",
];
const coverageSums = Object.fromEntries(
  coverageFields.map((field) => [field, 0]),
);

const classifiedTaskIds = Object.values(
  traceability.classificationRules,
).flat();
assert.equal(classifiedTaskIds.length, 39);
assert.equal(new Set(classifiedTaskIds).size, 39);
assert.deepEqual(
  [...classifiedTaskIds].sort(),
  traceability.entries.map(({ taskId }) => taskId).sort(),
);

for (const entry of traceability.entries) {
  assert.ok(entry.sourceFiles.length > 0);
  assert.ok(entry.requirementPointers.length > 0);
  assert.ok(entry.requirementDomains.length > 0);
  assert.ok(entry.governanceDecisionIds.length > 0);
  const sourceEntries = entry.sourceFiles.map((file) => inventoryByFile.get(file));
  assert.ok(
    sourceEntries.every(Boolean),
    `${entry.taskId} references an unknown source file`,
  );
  for (const sourceEntry of sourceEntries) {
    assert.equal(sourceEntry.taskId, entry.taskId);
    assert.equal(sourceEntry.wbsCode, entry.wbsCode);
    assert.equal(sourceEntry.level, entry.level);
    assert.equal(sourceEntry.title, entry.title);
    assert.equal(sourceEntry.parentId, entry.parentId);
    assert.equal(sourceEntry.canonicalNodeRef, entry.canonicalNodeRef);
    assert.equal(
      entry.canonicalNodeCommit,
      inventory.canonicalPlanningSource.sha,
    );
  }
  for (const field of coverageFields) {
    assert.ok(
      Number.isSafeInteger(entry.coverage[field]) && entry.coverage[field] >= 0,
      `${entry.taskId} has invalid ${field} coverage`,
    );
    coverageSums[field] += entry.coverage[field];
  }
  assert.ok(
    entry.governanceDecisionIds.every((id) => kgaIds.includes(id)),
    `${entry.taskId} contains an unknown KGA reference`,
  );
  assert.match(entry.canonicalNodeRef, /^src\/data\/generated\/nodes\/.+\.json$/);
}
for (const field of coverageFields) {
  assert.equal(
    coverageSums[field],
    traceability.coverageSummary[field],
    `${field} coverage summary drifted`,
  );
}

assert.equal(governance.status, "human-decisions-recorded-canonical-pending");
assert.equal(governance.verdict, "NO_GO");
assert.equal(governance.humanDecisionResponse.decider, "user-admin");
assert.equal(governance.humanDecisionResponse.recordedAt, "2026-07-30");
assert.equal(
  governance.humanDecisionResponse.packageId,
  "kernel-bootstrap-human-decisions-2026-07-30",
);
assert.equal(
  governance.humanDecisionResponse.selectionLine,
  "T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A, A01-A",
);
assert.equal(governance.humanDecisionResponse.canonicalWriteBackAuthorized, false);
assert.deepEqual(governance.deterministicClosureIds, deterministicIds);
assert.deepEqual(governance.humanDecisionIds, humanIds);
assert.deepEqual(
  governance.decisions.map(({ id }) => id),
  kgaIds,
);

for (const decision of governance.decisions) {
  assert.equal(decision.canonicalStatus, "pending");
  assert.ok(["deterministic", "human"].includes(decision.resolutionClass));
  assert.ok(decision.proposedDecision.length > 0);
  assert.ok(decision.rationale.length > 0);
  assert.ok(decision.evidence.length > 0);
  assert.ok(decision.risks.length > 0);
  assert.ok(decision.acceptanceCriteria.length > 0);
  assert.ok(decision.rollback.trigger.length > 0);
  assert.ok(decision.rollback.action.length > 0);
  assert.equal(decision.canonicalWriteBackApprovalRequired, true);
  assert.equal(decision.codeStartAllowed, false);
  assert.equal(
    decision.proposalStatus,
    decision.resolutionClass === "human"
      ? "human-decision-recorded"
      : "proposed-deterministic-closure",
  );
  if (decision.resolutionClass === "human") {
    const record = decision.humanDecisionRecord;
    assert.ok(record, `${decision.id} must carry a human decision record`);
    assert.equal(record.decider, "user-admin");
    assert.equal(record.recordedAt, "2026-07-30");
    assert.equal(record.requestRef, "planning/human-decision-request.json");
    assert.ok(record.selectedOptionId.length > 0);
    assert.ok(record.effect.length > 0);
    assert.equal(record.canonicalWriteBackAuthorized, false);
  } else {
    assert.equal(decision.humanDecisionRecord, undefined);
  }
}

const d04Record = governance.decisions.find(({ id }) => id === "KGA-D04")
  .humanDecisionRecord;
const d09Record = governance.decisions.find(({ id }) => id === "KGA-D09")
  .humanDecisionRecord;

assert.equal(d09Record.rejectedMissingNodeCount, 13);
assert.equal(d09Record.rejectedMissingNodeIds.length, 13);
assert.equal(new Set(d09Record.rejectedMissingNodeIds).size, 13);
assert.equal(d09Record.sharedWith, "KGA-D04");

assert.equal(d04Record.identityNameReconciliation.mappings.length, 7);
assert.deepEqual(
  d04Record.identityNameReconciliation.mappings.map(
    ({ proposalIdentity, missingNodeId, mappingType }) => ({
      proposalIdentity,
      missingNodeId,
      mappingType,
    }),
  ),
  [
    { proposalIdentity: "k-kms", missingNodeId: "k-kms", mappingType: "direct" },
    {
      proposalIdentity: "k-legal-hold",
      missingNodeId: "k-legal-hold-retention",
      mappingType: "renamed",
    },
    {
      proposalIdentity: "k-provider-adapter",
      missingNodeId: "k-provider-adapter",
      mappingType: "direct",
    },
    {
      proposalIdentity: "k-signature-trust",
      missingNodeId: "k-signature",
      mappingType: "renamed",
    },
    {
      proposalIdentity: "k-evidence-seal",
      missingNodeId: "k-evidence",
      mappingType: "renamed",
    },
    {
      proposalIdentity: "k-migration-bridge",
      missingNodeId: "k-migration-bridge",
      mappingType: "direct",
    },
    {
      proposalIdentity: "k-obligation",
      missingNodeId: "k-obligation",
      mappingType: "direct",
    },
  ],
);
for (const mapping of d04Record.identityNameReconciliation.mappings) {
  assert.equal(mapping.disposition, "reject");
  assert.ok(mapping.directiveRef.startsWith("docs/"));
  assert.ok(
    d09Record.rejectedMissingNodeIds.includes(mapping.missingNodeId),
    `${mapping.proposalIdentity} must map onto a canonical KGA-D09 missing-node row`,
  );
}

assert.equal(humanRequest.status, "answered-recorded");
assert.equal(humanRequest.canonicalWriteBackAuthorized, false);
assert.deepEqual(humanRequest.deterministicClosuresNotAsked, deterministicIds);
assert.deepEqual(
  humanRequest.questions.map(({ id }) => id),
  ["T01", "T02", "D01", "D04+D09", "D08", "D10", "A01"],
);
for (const question of humanRequest.questions) {
  assert.ok(
    question.options.some(({ id }) => id === question.recommendedOption),
    `${question.id} must identify a real recommended option`,
  );
}
const historyQuestion = humanRequest.questions.find(({ id }) => id === "T02");
assert.ok(historyQuestion.selectionRule.includes("T01-B requires T02-N"));
assert.deepEqual(
  historyQuestion.options.map(({ id }) => id),
  ["T02-A", "T02-B", "T02-C", "T02-N"],
);
const descendantQuestion = humanRequest.questions.find(({ id }) => id === "D01");
assert.deepEqual(descendantQuestion.recommendedDeferredParentIds, [
  "k-actor",
  "k-agent-runtime",
  "k-archetype-bayraklari",
  "k-archetype-computation",
  "k-archetype-fieldtypes",
  "k-archetype-mode-profile",
  "k-authz",
  "k-boyut1-ops-panel",
  "k-boyut2-developer-panel",
  "k-boyut3-tenant-panel",
  "k-bus",
  "k-calendar-capacity",
  "k-computation",
  "k-control-planes",
  "k-edge-gateway",
  "k-genealogy-graph",
  "k-jurisdiction",
  "k-kpi-registry",
  "k-mdm",
  "k-mod-l",
  "k-mode",
  "k-party",
  "k-plugin",
  "k-policy-pdp",
  "k-schema",
  "k-search",
  "k-sequence",
  "k-sozlesme",
  "k-storage",
  "k-surface",
  "k-surface-consumer",
  "k-terminoloji",
  "k-worker",
]);
assert.equal(descendantQuestion.recommendedDisposition.disposition, "defer");
assert.equal(descendantQuestion.recommendedDisposition.selectedDescendantId, null);
assert.ok(descendantQuestion.selectionRule.includes("complete 33-row override"));

const ghostQuestion = humanRequest.questions.find(({ id }) => id === "D04+D09");
assert.deepEqual(
  ghostQuestion.recommendedDispositionMatrix.map(({ missingNodeId }) => missingNodeId),
  [
    "archetype-agreement",
    "archetype-document-composition",
    "k-event-projection",
    "k-evidence",
    "k-exec-context",
    "k-kms",
    "k-legal-hold-retention",
    "k-migration-bridge",
    "k-module-security",
    "k-obligation",
    "k-provider-adapter",
    "k-signature",
    "privacy-retention-matrix",
  ],
);
assert.ok(
  ghostQuestion.recommendedDispositionMatrix.every(
    ({ directiveRef, disposition, effect }) =>
      directiveRef.startsWith("docs/") &&
      disposition === "reject" &&
      effect.includes("non-executable requirements evidence"),
  ),
);
assert.ok(ghostQuestion.selectionRule.includes("complete 13-row matrix"));

const adrQuestion = humanRequest.questions.find(({ id }) => id === "D08");
assert.deepEqual(adrQuestion.collisionClusters, [
  {
    ambiguousId: "ADR-E1",
    topics: ["event-replay-projection", "evidence-seal"],
  },
  {
    ambiguousId: "ADR-M1",
    topics: ["migration-bridge", "module-security-sandbox"],
  },
  {
    ambiguousId: "ADR-S1",
    topics: ["object-storage-dam", "surface-family"],
  },
  {
    ambiguousId: "ADR-X1",
    topics: ["execution-contract-matrix", "execution-context-envelope"],
  },
  {
    ambiguousId: "ADR-A5/ADR-0022",
    topics: [
      "archetype-storage",
      "variant-fieldtype-extension",
      "duplicate-storage-identity",
    ],
  },
]);

const tenancyQuestion = humanRequest.questions.find(({ id }) => id === "D10");
assert.deepEqual(
  tenancyQuestion.options.map(({ id, physicalStrategy }) => ({
    id,
    physicalStrategy,
  })),
  [
    { id: "D10-A", physicalStrategy: "shared-schema-rls" },
    { id: "D10-B", physicalStrategy: "schema-per-tenant-rls" },
    { id: "D10-C", physicalStrategy: "hybrid" },
  ],
);
for (const option of tenancyQuestion.options) {
  assert.equal(option.decisionOwner, "user-admin");
  assert.ok(option.thresholdDisposition);
}
assert.equal(
  tenancyQuestion.options[0].thresholdDisposition,
  "not-applicable-fixed-topology",
);
assert.equal(
  tenancyQuestion.options[1].thresholdDisposition,
  "not-applicable-fixed-topology",
);
assert.equal(
  tenancyQuestion.options[2].thresholdDisposition.tenantCountTrigger,
  "none",
);
assert.ok(tenancyQuestion.options[2].thresholdDisposition.resourceTrigger);
assert.equal(
  tenancyQuestion.options[2].thresholdDisposition.approvalOwner,
  "user-admin",
);
const authorityQuestion = humanRequest.questions.find(({ id }) => id === "A01");
assert.deepEqual(authorityQuestion.currentTurn, {
  commit: false,
  push: false,
  merge: false,
  release: false,
  deploy: false,
  actionplanWriteBack: false,
});

const { response } = humanRequest;
assert.equal(response.packageId, humanRequest.packageId);
assert.equal(response.decider, "user-admin");
assert.equal(response.recordedAt, "2026-07-30");
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
  response.selections.map(({ questionId }) => questionId),
  humanRequest.questions.map(({ id }) => id),
);
for (const selection of response.selections) {
  const question = humanRequest.questions.find(
    ({ id }) => id === selection.questionId,
  );
  assert.ok(
    question.options.some(({ id }) => id === selection.optionId),
    `${selection.optionId} must be a real option of ${selection.questionId}`,
  );
  assert.equal(selection.optionId, question.recommendedOption);
  assert.ok(selection.effect.length > 0);
}
assert.equal(response.effects.d01DeferredParentCount, 33);
assert.deepEqual(
  response.effects.d01DeferredParentIds,
  descendantQuestion.recommendedDeferredParentIds,
);
assert.equal(response.effects.d04d09RejectedIdentityCount, 13);
assert.deepEqual(
  response.effects.d04d09RejectedIdentityIds,
  ghostQuestion.recommendedDispositionMatrix.map(
    ({ missingNodeId }) => missingNodeId,
  ),
);
assert.deepEqual(
  response.effects.d04d09RejectedIdentityIds,
  d09Record.rejectedMissingNodeIds,
);
assert.equal(response.effects.d08Policy, "quarantine-deprecate-and-reallocate");
assert.equal(response.effects.d10PhysicalStrategy, "shared-schema-rls");
assert.equal(response.effects.d10TenantDiscriminator, "tenant_id");
assert.equal(response.effects.d10RlsDenyByDefault, true);
assert.equal(
  response.effects.d10ThresholdDisposition,
  "not-applicable-fixed-topology",
);
assert.equal(response.effects.d10AutomaticPromotion, false);
assert.equal(response.effects.topologyState, "APPROVED_CONDITIONAL");
assert.equal(
  response.effects.topologyFutureOwner,
  "metaframer-net/metaframer-kernel",
);
assert.equal(
  response.effects.topologyActivatesAfter,
  "all-canonical-KGA-decisions-closed",
);
assert.equal(response.effects.governanceOwner, "actionplan");
assert.equal(response.effects.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
assert.equal(response.effects.sourceExtraction, false);
assert.equal(response.effects.canonicalWriteBackAuthorized, false);
assert.equal(response.effects.runtimeCodeAllowed, false);
assert.equal(response.effects.codeStartAllowed, false);
assert.equal(response.effects.releaseDecision, "NO_GO");

const grant = response.oneShotGitAuthorization;
assert.equal(grant.scope, "one-shot");
assert.equal(grant.repository, "metaframer-net/metaframer-kernel");
assert.equal(grant.branch, "agent/kernel-control-plane-reconcile");
assert.equal(grant.ref, "refs/heads/agent/kernel-control-plane-reconcile");
assert.equal(grant.expectedBaseSha, "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434");
assert.equal(grant.pushMode, "normal-non-force");
assert.equal(grant.commit, true);
assert.equal(grant.push, true);
assert.equal(grant.executor, "codex");
assert.equal(grant.consumptionStatus, "unconsumed");
assert.equal(grant.consumptionAuthority, "remote-ref-absence-before-first-push");
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
assert.match(grant.consumptionStatusNote, /never sufficient authority after publication/);
for (const forbidden of [
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
  assert.equal(grant[forbidden], false);
}

const audit = response.remoteAudit;
assert.equal(audit.repository, "metaframer-net/metaframer-kernel");
assert.equal(audit.visibility, "private");
assert.equal(audit.defaultBranch, "main");
assert.equal(audit.mainSha, "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434");
assert.equal(audit.otherRemoteBranches, 0);
assert.equal(audit.pullRequests, 0);
assert.equal(audit.releases, 0);
assert.equal(audit.actionsRuns, 0);
assert.equal(audit.remoteRuntimeDevelopmentObserved, false);

const policy = state.codingPolicy;
assert.deepEqual(
  policy,
  response.codingPolicy,
  "the resume state and approval provenance must mirror one identical coding policy",
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

const agentsDoc = await readFile(path.join(root, "AGENTS.md"), "utf8");
// Additive current successor invocation: distinct from the immutable historical record above.
// Both must hold; neither is allowed to be quietly moved onto the other.
const readinessPackage = JSON.parse(
  await readFile(path.join(root, "planning/kernel-ai-development-readiness.json"), "utf8"),
);
const successor = readinessPackage.successorInvocationPolicy;
assert.ok(successor, "the readiness package must record the additive successor invocation policy");
assert.equal(successor.currentWorkerInvocation, "pane-visible-agent-claude");
assert.equal(successor.forbiddenInvocation, "mcp-claude_implement");
assert.equal(successor.historicalPolicyRewritten, false);
assert.equal(successor.historicalInvocation, "claude_implement");
assert.equal(successor.supersedes, "invocation-mechanism-only");
assert.equal(policy.mode, "CLAUDE_ONLY");
assert.equal(policy.singleActiveWriter, true);
assert.equal(policy.fallbackWriter, null);
// The active text must distinguish the two records rather than claim they are identical.
assert.match(agentsDoc, /Immutable historical approval record/);
assert.match(agentsDoc, /Additive current successor invocation/);
assert.ok(
  !/this text and those two mirrors must always agree/.test(agentsDoc),
  "AGENTS.md must not claim the active text and the historical mirrors are identical",
);

assert.match(agentsDoc, /^## Immutable CLAUDE-ONLY writer lock$/m);
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
  "<!-- pane-agent-context:start -->",
  "<!-- pane-agent-context:end -->",
]) {
  assert.ok(agentsDoc.includes(literal), `AGENTS.md must state ${literal}`);
}

assert.equal(state.lifecycleState, "APPROVED_AWAITING_CANONICAL_WRITEBACK");
assert.equal(state.classification, "PLANNING_ONLY");
assert.equal(state.runtimeStatus, "VALID_BLOCKED");
assert.equal(state.releaseDecision, "NO_GO");
assert.equal(state.runtimeCodeAllowed, false);
assert.equal(state.phaseStatus, "validated-decisions-recorded");
assert.equal(
  state.nextAction,
  "obtain-actionplan-canonical-writeback-authority",
);
assert.equal(state.blockers.length, 7);
for (const blocker of state.blockers) {
  assert.equal(blocker.status, "closed-locally");
  assert.ok(blocker.resolvedBy);
}
assert.deepEqual(
  state.blockers.filter(({ canonicalStatus }) => canonicalStatus).map(({ id }) => id),
  humanIds,
);
assert.ok(
  state.blockers
    .filter(({ canonicalStatus }) => canonicalStatus)
    .every(({ canonicalStatus }) => canonicalStatus === "pending"),
);
assert.deepEqual(
  state.approvedDecisions.selectedOptionIds,
  response.selectedOptionIds,
);
assert.equal(state.approvedDecisions.decider, "user-admin");
assert.equal(state.approvedDecisions.standingAuthorization, false);
assert.equal(state.approvedDecisions.canonicalWriteBackAuthorized, false);
assert.equal(state.sourceTopology.state, "APPROVED_CONDITIONAL");
assert.equal(
  state.sourceTopology.historyStrategy,
  "CLEAN_START_WITH_PROVENANCE",
);
assert.equal(state.sourceTopology.sourceExtraction, false);
assert.deepEqual(state.requiredChecks, ["npm test", "npm run check"]);
assert.equal(state.testResults.greenEvidence.status, "passed");
assert.equal(state.testResults.sourceVerification.status, "passed");
assert.deepEqual(state.governance.deterministicClosureIds, deterministicIds);
assert.deepEqual(state.governance.humanDecisionIds, humanIds);
assert.equal(state.governance.canonicalWriteBackAuthorized, false);
const effective = state.effectiveAuthorization;
assert.equal(effective.scope, "standing");
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
assert.ok(Object.values(effective.standingActions).every((value) => value === false));
assert.equal(effective.oneShotGitAuthorizationRef, "response.oneShotGitAuthorization");
assert.equal(
  effective.oneShotGitAuthorization.sourceRef,
  "planning/human-decision-request.json#/response/oneShotGitAuthorization",
);
assert.equal(effective.oneShotGitAuthorization.scope, "one-shot");
assert.equal(
  effective.oneShotGitAuthorization.ref,
  "refs/heads/agent/kernel-control-plane-reconcile",
);
assert.equal(
  effective.oneShotGitAuthorization.expectedBaseSha,
  "90e5f6ac2b8beb4d8be1064390ba433b2bbdd434",
);
assert.equal(effective.oneShotGitAuthorization.pushMode, "normal-non-force");
assert.equal(effective.oneShotGitAuthorization.executor, "codex");
assert.equal(effective.oneShotGitAuthorization.consumableByClaude, false);
assert.equal(effective.oneShotGitAuthorization.reuseAllowed, false);
assert.equal(effective.oneShotGitAuthorization.consumptionStatus, "unconsumed");

const effectiveOneShot = effective.oneShotGitAuthorization;
assert.equal(effectiveOneShot.pullRequest, false);
assert.equal(
  effectiveOneShot.consumptionAuthority,
  grant.consumptionAuthority,
  "the resume mirror must repeat the recorded consumption authority",
);
assert.equal(
  effectiveOneShot.consumptionAuthority,
  "remote-ref-absence-before-first-push",
);
assert.equal(effectiveOneShot.prePushVerificationCommand, remoteAbsenceCommand);
assert.equal(
  effectiveOneShot.prePushVerificationCommand,
  grant.prePushVerificationCommand,
);
assert.ok(effectiveOneShot.prePushRule.includes(remoteAbsenceCommand));
assert.match(effectiveOneShot.prePushRule, /no matching ref and no output/);
assert.match(effectiveOneShot.prePushRule, /already spent/);
assert.ok(effectiveOneShot.postPushEvidenceRule.includes("must equal the local commit"));
assert.ok(
  effectiveOneShot.postPushEvidenceRule.includes(
    `descend from expected base ${expectedBaseSha}`,
  ),
);
assert.equal(effectiveOneShot.consumptionStatusAuthority, "snapshot-evidence-only");
assert.match(effectiveOneShot.consumptionStatusNote, /snapshot evidence only/);
assert.equal(state.security.promptOrDirectiveExecutionAllowed, false);

assert.equal(status.classification, "PLANNING_ONLY");
assert.equal(status.runtime.status, "VALID_BLOCKED");
assert.equal(status.runtime.releaseDecision, "NO_GO");
assert.equal(status.decisionGate.state, "INCOMPLETE");
assert.equal(status.sourceTopology.state, "APPROVED_CONDITIONAL");
assert.equal(
  status.sourceTopology.standaloneKernelSource,
  "CONDITIONALLY_SELECTED_AFTER_CANONICAL_GATE",
);
assert.equal(status.sourceTopology.sourceExtraction, false);
assert.equal(
  status.planningControlPlane.state,
  "APPROVED_AWAITING_CANONICAL_WRITEBACK",
);
assert.equal(status.planningControlPlane.codingPolicyMode, "CLAUDE_ONLY");
assert.deepEqual(status.planningControlPlane.deterministicClosureIds, deterministicIds);
assert.deepEqual(status.planningControlPlane.humanDecisionIds, humanIds);
assert.equal(status.planningControlPlane.canonicalWriteBackAuthorized, false);
assert.equal(status.planningControlPlane.runtimeCodeAllowed, false);

for (const runtimePath of ["apps", "src", "packages", "deploy", "migrations"]) {
  assert.equal(
    await exists(runtimePath),
    false,
    `${runtimePath} must remain absent while the decision gate is incomplete`,
  );
}

for (const relativePath of [
  "docs/control-plane-bootstrap.md",
  "docs/human-decision-package.md",
  "docs/resume-runbook.md",
]) {
  const content = await readFile(path.join(root, relativePath), "utf8");
  assert.ok(content.length > 500);
  assert.ok(content.includes("PLANNING_ONLY"));
  assert.ok(content.includes("NO_GO"));
}

// Static text check only: the remote fence is never executed by this checker.
const runbook = await readFile(path.join(root, "docs/resume-runbook.md"), "utf8");
assert.ok(
  runbook.includes(remoteAbsenceCommand),
  "the resume runbook must display the exact remote absence command",
);
assert.ok(
  runbook.includes(grantedRef),
  "the resume runbook must name the exact granted ref",
);
assert.match(runbook, /empty output/);
assert.match(
  runbook,
  /If any matching ref exists at any SHA, the grant is\s+already spent: stop immediately/,
  "the resume runbook must stop execution when the remote ref already exists",
);
assert.match(runbook, /snapshot evidence only/);
assert.match(runbook, /authoritative pre-consumption proof/);
assert.ok(runbook.includes("must equal the local commit"));
assert.ok(
  runbook.includes(`git merge-base --is-ancestor ${expectedBaseSha} FETCH_HEAD`),
  "the resume runbook must keep the post-push expected-base ancestry proof",
);

console.log(
  "control plane: 40 files -> 39 tasks -> KGA-D01..D10 pending / APPROVED_AWAITING_CANONICAL_WRITEBACK / CLAUDE_ONLY / NO_GO / one-shot fence = remote-ref absence",
);
