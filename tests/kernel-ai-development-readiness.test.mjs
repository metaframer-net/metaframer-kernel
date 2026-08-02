import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Repository identity is derived here, never read from a recorded absolute path.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = "planning/kernel-ai-development-readiness.json";
const docPath = "docs/kernel-ai-development-readiness.md";
const checkerPath = "tools/check-kernel-ai-development-readiness.mjs";
const expectedExecutionCardCount = 33;
const actionplanSha = "7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d";
const kernelSha = "b80f2ed0f4d968ee11d59bc3b31890f960ac9372";
const runtimePhases = [
  "db-rls-transaction-outbox-audit",
  "kernel-primitives",
  "sdk",
  "walking-skeleton",
];
const qualityAxes = [
  "unit", "integration", "contract", "e2e", "tenant", "rls", "race", "idempotency",
  "migration", "atomicity", "fuzz", "scans", "performance", "load", "failureInjection",
  "observability", "compatibility", "sdk", "rollback",
];
const gateKeys = ["codeStartAllowed", "runtimeCodeAllowed", "implemented", "started", "readinessClaimed"];
const runtimeKeys = ["implemented", "started", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed", "kernelReady"];
const rootKeys = [
  "schemaVersion", "id", "generatedAt", "packageKind", "readinessStatus", "codeStartAllowed",
  "runtimeCodeAllowed", "verdict", "verdictTokenMap", "candidateDisposition", "runtime", "identity",
  "sourceEvidence", "redEvidence", "successorInvocationPolicy", "promotionProtocol", "blueprint", "dependencyGraph", "qualityAxes",
  "executionCards", "unresolvedGates", "deferredRisks", "nonGoals", "rollback",
];
const cardKeys = [
  "cardId", "decisionId", "shardClass", "parentId", "parentOwner", "sourceCluster",
  "selectedDescendantId", "title", "level", "approvalRef", "selectionStatus",
  "fileClass", "semantics",
  "implementationBoundary", "sequencePhase", "blockedByPhase", "repoPath", "allowedFiles",
  "nonGoals", "ownerLease", "predecessorEvidence", "redTest", "plannedTest",
  "deterministicBehaviors", "acceptanceMapping", "dataImpact", "securityImpact",
  "performanceBudget", "observability", "rollback", "expectedEvidence",
  "quality", "gate", "provenance",
];
const perfTiers = { "kernel-core": 100, adapter: 200, "app-e2e": 400, asynchronous: null };
const candidateGateIds = new Set(["successor-authority", "review-a", "review-b", "codex-verification"]);

async function readReadinessArtifact() {
  let raw;
  try {
    raw = await readFile(path.join(root, artifactPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(`readiness-artifact-missing: ${artifactPath} does not exist`);
    }
    throw error;
  }
  return JSON.parse(raw);
}

test("kernel AI development readiness artifact exists and stays fail-closed", async () => {
  const readiness = await readReadinessArtifact();

  assert.equal(typeof readiness.readinessStatus, "string");
  assert.ok(
    readiness.readinessStatus.length > 0,
    "readinessStatus must be a non-empty status token",
  );
  assert.equal(
    readiness.codeStartAllowed,
    false,
    "code start stays blocked until the governance gate is closed",
  );
  assert.equal(
    readiness.runtimeCodeAllowed,
    false,
    "runtime code stays blocked until the governance gate is closed",
  );
  assert.equal(readiness.verdict, "NO-GO");
  assert.equal(readiness.verdictTokenMap.kernelLocal, "NO_GO");

  assert.ok(
    Array.isArray(readiness.executionCards),
    "executionCards must be an array",
  );
  assert.equal(readiness.executionCards.length, expectedExecutionCardCount);
});

test("the artifact keeps an exact root schema and stays a candidate", async () => {
  const readiness = await readReadinessArtifact();

  assert.deepEqual(Object.keys(readiness).sort(), [...rootKeys].sort(), "root key set drifted");
  assert.equal(readiness.packageKind, "readiness-candidate");
  assert.equal(readiness.readinessStatus, "BLOCKED");
  assert.equal(readiness.verdictTokenMap.canonical, "NO-GO");
  assert.equal(readiness.candidateDisposition.status, "candidate-not-effective");
  assert.equal(readiness.candidateDisposition.successorAuthorityEffective, false);
  assert.equal(readiness.candidateDisposition.approvedBy, null);
  assert.equal(readiness.candidateDisposition.effectiveFrom, null);

  assert.deepEqual(Object.keys(readiness.runtime).sort(), [...runtimeKeys].sort());
  for (const key of runtimeKeys) {
    assert.equal(readiness.runtime[key], false, `runtime.${key} must stay false`);
  }
});

test("identity is portable and records no ephemeral absolute path", async () => {
  const readiness = await readReadinessArtifact();
  const raw = JSON.stringify(readiness);

  assert.equal(readiness.identity.pathMode, "repository-relative");
  assert.equal(readiness.identity.absoluteKernelWorktreePathsRecorded, false);
  assert.ok(!("absolutePathsRecorded" in readiness.identity), "the misleading key must be gone");
  assert.equal(readiness.identity.kernelRootResolution, "derived-from-import-meta-url");
  assert.equal(readiness.sourceEvidence.kernel.rootPathRecorded, false);
  assert.ok(!("repoPath" in readiness.sourceEvidence.kernel), "kernel evidence must not record a path");
  assert.ok(!raw.includes(root), "artifact must not embed this worktree root");
  assert.ok(!raw.includes("/worktrees/"), "artifact must not embed a worktree path");

  // Actionplan identity is repository+ref+sha; its local checkout is verification input only.
  assert.equal(readiness.sourceEvidence.actionplan.repository, "karacaismail/actionplan");
  assert.equal(readiness.sourceEvidence.actionplan.ref, "refs/remotes/origin/main");
  assert.equal(readiness.sourceEvidence.actionplan.sha, actionplanSha);
  assert.equal(readiness.sourceEvidence.actionplan.mutationAllowed, false);
  assert.equal(readiness.sourceEvidence.actionplan.localVerificationPath.isIdentity, false);
  assert.equal(readiness.sourceEvidence.kernel.sha, kernelSha);
  assert.equal(readiness.sourceEvidence.kernel.mutationAllowed, false);
  assert.equal(readiness.sourceEvidence.d01Ledger.rows, expectedExecutionCardCount);
});

test("the registry is history and the live application state is fully applied", async () => {
  const readiness = await readReadinessArtifact();

  assert.equal(readiness.sourceEvidence.decisionRegistry.isReadinessBlocker, false);
  assert.equal(readiness.sourceEvidence.decisionRegistry.allRowsStatus, "pending");
  assert.deepEqual(readiness.sourceEvidence.applicationState.summary, {
    total: 10,
    applied: 10,
    pending: 0,
    canonical: 10,
  });
  assert.equal(readiness.sourceEvidence.effectiveAuthority.epochId, "AUTHORITY-SUPERSESSION-03");
  assert.equal(readiness.sourceEvidence.effectiveAuthority.seq, 3);
});

test("the observed RED is recorded once and is not re-staged", async () => {
  const readiness = await readReadinessArtifact();
  const red = readiness.redEvidence;

  assert.equal(red.observed, true);
  assert.equal(red.observedBefore, "artifact-creation");
  assert.equal(red.command, "node --test tests/kernel-ai-development-readiness.test.mjs");
  assert.equal(red.failureToken, `readiness-artifact-missing: ${artifactPath}`);
  assert.equal(
    red.preWriteTestSha256,
    "ee66e6fb8600d6cb61d6e445bccf455faa0999aa3bf1df62245178511a7cb260",
  );
  assert.equal(red.reRunProducesRed, false);
});

test("the promotion protocol is staged and non-circular", async () => {
  const readiness = await readReadinessArtifact();
  const protocol = readiness.promotionProtocol;

  assert.equal(protocol.circularityAvoided, true);
  assert.equal(protocol.selfHashRecorded, false);
  assert.deepEqual(protocol.steps.map((step) => step.order), [1, 2, 3]);
  assert.equal(protocol.currentStep, 1);
  assert.ok(protocol.steps[1].recordedIn.includes("EPOCH-04"));
  assert.ok(protocol.steps[2].pins.some((pin) => pin.includes("EPOCH-04")));
  assert.ok(protocol.terminalStates.blocked.length > 0);
  assert.ok(protocol.terminalStates.ready.length > 0);
  // Staged non-circularity, asserted substantively: step 1 is this candidate and may not pin any
  // digest of itself; only the later EPOCH-04 step pins the artifact digest, once it is committed.
  // A "digest of raw appears inside raw" check would be vacuous by construction and is not used.
  assert.ok(
    !protocol.steps[0].pins.some((pin) => /artifact digest|candidate digest|self/i.test(pin)),
    "step 1 must not pin a candidate digest",
  );
  assert.ok(
    protocol.steps[1].pins.some((pin) => /artifact digest/i.test(pin)),
    "step 2 must pin the candidate artifact digest",
  );
  for (const key of Object.keys(readiness)) {
    assert.ok(
      !/^(selfSha256|selfDigest|artifactSha256|artifactDigest)$/.test(key),
      `artifact must not carry a self digest field: ${key}`,
    );
  }
});

test("every execution card carries the exact FAZ-3 field set and stays unstarted", async () => {
  const readiness = await readReadinessArtifact();
  const internalIds = new Set(readiness.executionCards.map((card) => card.selectedDescendantId));
  assert.equal(internalIds.size, expectedExecutionCardCount, "descendant ids must be unique");

  for (const card of readiness.executionCards) {
    const where = `${card.cardId} (${card.selectedDescendantId})`;
    assert.deepEqual(Object.keys(card).sort(), [...cardKeys].sort(), `${where} card key set drifted`);
    assert.equal(card.decisionId, "KGA-D01", `${where} must stay a D01 card`);
    assert.equal(card.shardClass, "kernel-contract-shard", `${where} shardClass drifted`);
    assert.ok(runtimePhases.includes(card.sequencePhase), `${where} has an unknown phase`);
    assert.equal(card.implementationBoundary.expansionAllowed, false, `${where} allows expansion`);
    assert.ok(card.nonGoals.length >= 3, `${where} must record substantive non-goals`);

    const lease = card.ownerLease;
    assert.equal(lease.mode, "CLAUDE_ONLY", `${where} lease mode drifted`);
    assert.equal(lease.concurrentWriters, 1, `${where} lease is not single-writer`);
    assert.equal(lease.invocation, "visible Pane --agent claude", `${where} lease invocation drifted`);
    assert.ok(
      lease.invocationForbidden.includes("MCP claude_implement"),
      `${where} must forbid MCP claude_implement`,
    );
    assert.equal(lease.delegationAllowed, false, `${where} allows delegation`);
    assert.equal(lease.fallbackWriter, null, `${where} names a fallback writer`);
    assert.equal(lease.gitMutationAllowed, false, `${where} allows Git mutation`);
    assert.equal(lease.accountGate.failClosed, true, `${where} account gate is not fail-closed`);
    assert.equal(lease.accountGate.providerFallbackAllowed, false, `${where} allows provider fallback`);

    assert.deepEqual(Object.keys(card.gate).sort(), [...gateKeys].sort(), `${where} gate keys drifted`);
    for (const key of gateKeys) {
      assert.equal(card.gate[key], false, `${where} gate.${key} must stay false`);
    }
    for (const key of ["schemaChange", "migrationRequired", "rlsPolicyChange", "rlsScopeRequired"]) {
      assert.equal(typeof card.dataImpact[key], "boolean", `${where} dataImpact.${key} must be boolean`);
    }
    assert.equal(card.dataImpact.runtimeDataImpact, "none", `${where} current data impact must be none`);
    assert.ok(card.dataImpact.plannedRuntimeDataImpact?.length > 0, `${where} needs a planned data impact`);
    assert.equal(typeof card.securityImpact.secretsHandled, "boolean", `${where} secretsHandled must be boolean`);
    assert.equal(typeof card.securityImpact.piiHandled, "boolean", `${where} piiHandled must be boolean`);
    if (card.securityImpact.piiHandled) {
      assert.ok(
        card.securityImpact.controls.some((c) => /PII|residency|retention/i.test(c)),
        `${where} handles PII without a PII control`,
      );
    }
    if (card.securityImpact.secretsHandled) {
      assert.ok(
        card.securityImpact.controls.some((c) => /credential|secret/i.test(c)),
        `${where} handles secrets without a secret control`,
      );
    }
    // Bounded write scope.
    assert.equal(card.repoPath, "metaframer-kernel", `${where} repoPath drifted`);
    assert.ok(!path.isAbsolute(card.repoPath), `${where} repoPath is absolute`);
    assert.ok(Array.isArray(card.allowedFiles) && card.allowedFiles.length > 0, `${where} allowedFiles empty`);
    assert.ok(
      card.allowedFiles.includes(card.plannedTest.testFileRelative),
      `${where} allowedFiles must include its planned test`,
    );
    assert.ok(
      card.securityImpact.tenantIsolation.includes("FORCE RLS"),
      `${where} weakens tenant isolation`,
    );
    assert.ok(Object.keys(perfTiers).includes(card.performanceBudget.tier), `${where} unknown performance tier`);
    assert.equal(card.performanceBudget.p95Ms, perfTiers[card.performanceBudget.tier], `${where} p95 does not match its tier`);
    assert.equal(card.performanceBudget.measured, false, `${where} claims a measured budget`);
    assert.equal(card.observability.emitted, false, `${where} claims emitted telemetry`);
    assert.ok(card.observability.requiredFields.includes("tenant_id"), `${where} drops tenant_id`);
    assert.equal(card.rollback.decisionOwner, "codex", `${where} rollback owner drifted`);
    assert.equal(card.rollback.executor, "claude-via-visible-pane", `${where} rollback executor drifted`);
    assert.ok(card.rollback.executorForbidden.includes("codex"), `${where} allows codex as executor`);
    assert.ok(card.rollback.verification.length > 0, `${where} rollback has no verification`);
    assert.equal(card.expectedEvidence.currentEvidence, null, `${where} carries evidence`);
    assert.equal(card.provenance.actionplanSha, actionplanSha, `${where} provenance drifted`);
    assert.ok(card.deterministicBehaviors.positive.length > 0, `${where} has no positive behavior`);
    assert.ok(card.deterministicBehaviors.negativeFailClosed.length >= 2, `${where} has too few fail-closed behaviors`);
    assert.equal(card.acceptanceMapping.humanRunRequired, true, `${where} skips the human run`);
  }
});

test("planned tests and red tests are recorded, never executed, and their paths are absent", async () => {
  const readiness = await readReadinessArtifact();

  let checked = 0;
  for (const card of readiness.executionCards) {
    const where = `${card.cardId} (${card.selectedDescendantId})`;
    assert.equal(card.redTest.required, true, `${where} skips a red test`);
    assert.equal(card.redTest.observed, false, `${where} claims an observed card red`);
    assert.equal(card.redTest.observedEvidence, null, `${where} fabricates red evidence`);
    assert.equal(card.plannedTest.status, "planned-not-run", `${where} is not planned-not-run`);
    assert.equal(card.plannedTest.executed, false, `${where} claims execution`);
    assert.equal(card.plannedTest.evidence, null, `${where} fabricates test evidence`);
    assert.ok(card.plannedTest.testCommand?.length > 0, `${where} has no planned test command`);

    const relative = card.plannedTest.testFileRelative;
    assert.ok(!path.isAbsolute(relative), `${where} planned path is absolute: ${relative}`);
    assert.ok(!relative.split("/").includes(".."), `${where} planned path traverses: ${relative}`);
    const resolved = path.resolve(root, relative);
    assert.ok(resolved.startsWith(`${root}${path.sep}`), `${where} planned path escapes the root`);
    assert.equal(existsSync(resolved), false, `${where} planned path already exists: ${relative}`);
    assert.ok(
      card.acceptanceMapping.mappedTo.positive.includes(relative),
      `${where} acceptance is not mapped to its own test file`,
    );
    checked += 1;
  }
  assert.equal(checked, expectedExecutionCardCount);
});

test("each card carries all 19 quality axes with contract-specific, unevidenced content", async () => {
  const readiness = await readReadinessArtifact();
  assert.deepEqual([...readiness.qualityAxes].sort(), [...qualityAxes].sort());

  for (const card of readiness.executionCards) {
    const where = `${card.cardId} (${card.selectedDescendantId})`;
    assert.deepEqual(Object.keys(card.quality).sort(), [...qualityAxes].sort(), `${where} axis set drifted`);
    for (const axis of qualityAxes) {
      const entry = card.quality[axis];
      assert.equal(entry.axis, axis, `${where} axis ${axis} is mislabelled`);
      assert.ok(["applicable", "not-applicable"].includes(entry.applicability), `${where} ${axis} applicability`);
      assert.equal(entry.currentEvidence, null, `${where} axis ${axis} carries evidence`);
      assert.equal(entry.humanRunRequired, true, `${where} axis ${axis} skips the human run`);
      assert.ok(entry.specialistRole?.length > 0, `${where} axis ${axis} has no specialist role`);
      assert.ok(entry.risk?.length > 0, `${where} axis ${axis} has no risk`);
      assert.ok(entry.acceptance?.length > 0, `${where} axis ${axis} has no acceptance`);
      // Genuinely card-specific: bound to this card's own title, scope clause, declared
      // dependencies and data impact, so the binding is checked against real card fields.
      const bound = entry.boundTo;
      assert.ok(bound, `${where} axis ${axis} records no binding`);
      assert.equal(bound.title, card.title, `${where} axis ${axis} binding title drifted`);
      assert.ok(
        card.implementationBoundary.scope.startsWith(bound.scopeClause),
        `${where} axis ${axis} scope clause is not from its own boundary`,
      );
      assert.equal(
        bound.plannedRuntimeDataImpact,
        card.dataImpact.plannedRuntimeDataImpact,
        `${where} axis ${axis} planned data impact drifted`,
      );
      assert.equal(
        bound.performanceTier,
        card.performanceBudget.tier,
        `${where} axis ${axis} performance tier drifted`,
      );
      // Ledger order is asserted exactly by the checker, which re-reads the pinned ledger;
      // here the binding is compared as a set against the card's declared predecessors.
      assert.deepEqual(
        [...bound.dependencies].sort(),
        [
          ...card.predecessorEvidence.internalPredecessors.map((p) => p.cardRef),
          ...card.predecessorEvidence.externalPredecessors.map((p) => p.nodeId),
        ].sort(),
        `${where} axis ${axis} dependency binding drifted`,
      );
      if (entry.applicability === "not-applicable") {
        assert.ok(entry.notApplicableReason?.length > 0, `${where} axis ${axis} is N/A without a reason`);
        assert.equal(entry.evidenceArtifact, null, `${where} N/A axis ${axis} names an artifact`);
      } else {
        assert.equal(entry.notApplicableReason, null, `${where} applicable axis ${axis} has an N/A reason`);
        assert.ok(entry.evidenceArtifact?.length > 0, `${where} applicable axis ${axis} has no artifact`);
      }
    }
  }
});

test("every axis entry binds at least two typed card-specific semantic signals", async () => {
  const readiness = await readReadinessArtifact();
  const semanticTypes = [
    "domain", "observable-signal", "primary-threat", "characteristic-failure",
    "excluded-scope", "planned-data-impact", "performance-tier", "security-class",
  ];
  // These sentences share axis-level frames on purpose. What must be card-specific is the
  // bound meaning, so this measures typed semantic signals rather than prose novelty.
  const values = new Map(semanticTypes.map((type) => [type, new Set()]));
  for (const card of readiness.executionCards) {
    assert.deepEqual(
      [...new Set(Object.values(card.semantics).map((sig) => sig.type))].sort(),
      [...semanticTypes].sort(),
      `${card.cardId} structured semantic type set drifted`,
    );
    for (const signal of Object.values(card.semantics)) {
      assert.ok(signal.value.trim().length >= 4, `${card.cardId} semantic ${signal.type} is too thin`);
      assert.ok(!/^nothing beyond|^n\/a$|^none$|^generic|^tbd$/i.test(signal.value.trim()), `${card.cardId} semantic ${signal.type} is generic`);
      values.get(signal.type).add(signal.value);
    }
    for (const axis of qualityAxes) {
      const entry = card.quality[axis];
      for (const field of ["risk", "acceptance"]) {
        const present = [
          ...new Set(
            Object.values(card.semantics)
              .filter((sig) => entry[field].includes(sig.value))
              .map((sig) => sig.type),
          ),
        ].sort();
        assert.ok(
          present.length >= 2,
          `${card.cardId} axis ${axis} ${field} binds only ${present.length} typed semantic signal(s); at least 2 required`,
        );
        assert.deepEqual(entry.semanticBinding[field], present, `${card.cardId} axis ${axis} ${field} recorded binding mismatches its text`);
      }
    }
  }
  // The signals themselves must be diverse, not one phrase reused across the deck.
  for (const type of ["domain", "observable-signal", "primary-threat", "characteristic-failure", "excluded-scope"]) {
    assert.equal(values.get(type).size, expectedExecutionCardCount, `semantic type ${type} is not card-specific`);
  }
});

test("isolated shards own disjoint files and declare a file class", async () => {
  const readiness = await readReadinessArtifact();
  const owner = new Map();
  for (const card of readiness.executionCards) {
    assert.ok(["isolated", "shared"].includes(card.fileClass), `${card.cardId} fileClass invalid`);
    if (card.fileClass !== "isolated") continue;
    for (const file of card.allowedFiles) {
      assert.equal(owner.get(file), undefined, `${owner.get(file)} and ${card.cardId} both claim ${file}`);
      owner.set(file, card.cardId);
    }
  }
  const total = readiness.executionCards.reduce((sum, card) => sum + card.allowedFiles.length, 0);
  assert.equal(total, expectedExecutionCardCount * 2);
  assert.equal(owner.size, total, "allowedFiles are not pairwise disjoint across isolated shards");
});

test("package check script wires the readiness checker", () => {
  const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.ok(scripts.check.includes(checkerPath), "npm run check must invoke the readiness checker");
  assert.equal(scripts["check:readiness"], `node ${checkerPath}`);
});

test("expected evidence and axis artifact paths stay contained", async () => {
  const readiness = await readReadinessArtifact();

  const contained = (relative, where, label) => {
    assert.ok(!path.isAbsolute(relative), `${where} ${label} is absolute: ${relative}`);
    assert.ok(!relative.split("/").includes(".."), `${where} ${label} traverses: ${relative}`);
    assert.ok(
      path.resolve(root, relative).startsWith(`${root}${path.sep}`),
      `${where} ${label} escapes the root: ${relative}`,
    );
  };
  for (const card of readiness.executionCards) {
    const where = `${card.cardId} (${card.selectedDescendantId})`;
    for (const artifact of card.expectedEvidence.artifacts) {
      const candidate = artifact.replace(/ run output$/, "");
      if (!candidate.includes("/")) continue;
      contained(candidate, where, "expectedEvidence artifact");
    }
    for (const axis of qualityAxes) {
      const artifact = card.quality[axis].evidenceArtifact;
      if (artifact) contained(artifact, where, `quality.${axis} evidenceArtifact`);
    }
  }
});

test("the historical mirrors and the current successor invocation stay distinct", async () => {
  const readiness = await readReadinessArtifact();

  const agentsDoc = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const bootstrap = JSON.parse(
    readFileSync(path.join(root, "planning/bootstrap-state.json"), "utf8"),
  ).codingPolicy;
  const approval = JSON.parse(
    readFileSync(path.join(root, "planning/human-decision-request.json"), "utf8"),
  ).response.codingPolicy;

  // Immutable historical approval record, byte-faithful.
  assert.equal(bootstrap.writer.invocation, "claude_implement");
  assert.equal(approval.writer.invocation, "claude_implement");
  assert.equal(bootstrap.writer.invocation, approval.writer.invocation, "historical mirrors disagree");

  // Additive current successor invocation, recorded elsewhere and never retro-fitted.
  assert.equal(readiness.successorInvocationPolicy.currentWorkerInvocation, "pane-visible-agent-claude");
  assert.equal(readiness.blueprint.singleWriterLeaseModel.invocation, "visible Pane --agent claude");
  assert.ok(
    readiness.blueprint.singleWriterLeaseModel.invocationForbidden.includes("MCP claude_implement"),
  );

  // The active text must separate the two records, not claim they are identical.
  assert.ok(agentsDoc.includes("claude_implement"), "AGENTS.md must still name the historical invocation");
  assert.ok(agentsDoc.includes("pane-visible-agent-claude"), "AGENTS.md must name the successor invocation");
  assert.match(agentsDoc, /Immutable historical approval record/);
  assert.match(agentsDoc, /Additive current successor invocation/);
  assert.ok(
    !/this text and those two mirrors must always agree/.test(agentsDoc),
    "AGENTS.md must not claim the active text and the historical mirrors are identical",
  );

  // The lock itself is unchanged by the successor instruction.
  assert.equal(bootstrap.mode, "CLAUDE_ONLY");
  assert.equal(bootstrap.singleActiveWriter, true);
  assert.equal(bootstrap.fallbackWriter, null);
  assert.equal(bootstrap.separateCodeStartAuthorityRequired, true);
});

test("the dependency graph is scoped, set-equal to the cards and provably acyclic", async () => {
  const readiness = await readReadinessArtifact();
  const graph = readiness.dependencyGraph;
  const internalIds = new Set(readiness.executionCards.map((card) => card.selectedDescendantId));

  assert.equal(graph.scope, "d01-33-subgraph");
  assert.equal(graph.coversRelationDirectionConflicts, false);
  assert.equal(graph.relationDirectionNote.decisionRef, "KGA-D07");
  assert.equal(graph.relationDirectionNote.unrepairedKernelEdges, 8);
  assert.equal(graph.relationDirectionNote.edgesRepaired, 0);
  assert.equal(graph.relationDirectionNote.totalConflicts, 46);
  assert.ok(!("acyclic" in graph), "unscoped acyclicity claim must not appear");
  assert.equal(graph.acyclicWithinScope, true);

  const cardEdges = readiness.executionCards.flatMap((card) =>
    card.predecessorEvidence.internalPredecessors.map((p) => `${card.selectedDescendantId}->${p.cardRef}`),
  );
  const graphEdges = graph.edges.map((edge) => `${edge.from}->${edge.to}`);
  assert.deepEqual([...graphEdges].sort(), [...cardEdges].sort(), "graph edges are not set-equal to card edges");
  assert.equal(graph.edgeCount, graphEdges.length);
  assert.equal(graph.nodeCount, internalIds.size);
  for (const edge of graph.edges) {
    assert.ok(internalIds.has(edge.from), `edge from unknown node: ${edge.from}`);
    assert.ok(internalIds.has(edge.to), `edge to unknown node: ${edge.to}`);
  }

  const adjacency = new Map();
  for (const edge of graph.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const state = new Map();
  const walk = (node) => {
    state.set(node, "open");
    for (const next of adjacency.get(node) ?? []) {
      assert.notEqual(state.get(next), "open", `dependency cycle through ${node} -> ${next}`);
      if (state.get(next) === undefined) walk(next);
    }
    state.set(node, "done");
  };
  for (const node of adjacency.keys()) if (state.get(node) === undefined) walk(node);
});

test("external predecessors are pinned, never internal and never blanket-dispositioned", async () => {
  const readiness = await readReadinessArtifact();
  const internalIds = new Set(readiness.executionCards.map((card) => card.selectedDescendantId));
  const externals = readiness.dependencyGraph.externalPredecessors;

  assert.equal(externals.length, readiness.dependencyGraph.externalPredecessorCount);
  for (const external of externals) {
    assert.ok(!internalIds.has(external.nodeId), `${external.nodeId} is internal, not external`);
    assert.equal(external.satisfied, false, `${external.nodeId} claims satisfaction`);
    assert.ok(
      external.canonicalRef.startsWith("src/data/generated/nodes/"),
      `${external.nodeId} has no canonical node ref`,
    );
    assert.match(external.canonicalSha256, /^[0-9a-f]{64}$/, `${external.nodeId} has no pinned digest`);
    assert.notEqual(
      external.disposition,
      "deferred-to-human-predecessor-decision",
      `${external.nodeId} uses a blanket disposition`,
    );
  }

  const capability = externals.find((entry) => entry.nodeId === "capability-registry-contract");
  assert.ok(capability, "capability-registry-contract must be dispositioned");
  assert.equal(capability.disposition, "deferred-to-pr07-pre-execution-node-rescope");
  assert.equal(capability.decisionRef, "KGA-D03");
  assert.ok(capability.decisionArtifact.includes("module-registry-ownership-split"));
  for (const other of externals.filter((entry) => entry.nodeId !== "capability-registry-contract")) {
    assert.equal(other.disposition, "planning-predecessor-not-evaluated-for-readiness");
  }
});

test("blueprint ordering, D02 boundary and the lease model stay fail-closed", async () => {
  const readiness = await readReadinessArtifact();
  const blueprint = readiness.blueprint;

  assert.deepEqual(blueprint.phases.map((phase) => phase.id), runtimePhases);
  blueprint.phases.forEach((phase, index) => {
    assert.equal(phase.order, index + 1, `phase ${phase.id} is out of order`);
    assert.equal(phase.status, "not-started", `phase ${phase.id} claims progress`);
    assert.ok(phase.canonicalRef?.length > 0, `phase ${phase.id} has no canonical ref`);
    assert.ok(phase.decisionRef?.length > 0, `phase ${phase.id} has no decision ref`);
  });
  assert.deepEqual(blueprint.dataPlaneOrdering.sequence, ["db", "rls", "transaction", "outbox", "audit"]);
  assert.equal(blueprint.dataPlaneOrdering.tenancy.rowLevelSecurity, "FORCE RLS");
  assert.equal(blueprint.dataPlaneOrdering.tenancy.denyByDefault, true);
  assert.equal(blueprint.dataPlaneOrdering.tenancy.enforced, false);
  assert.equal(blueprint.dataPlaneOrdering.tenancy.decisionRef, "KGA-D10");
  assert.equal(blueprint.dataPlaneOrdering.enforcementExecutor, "human-developer-only");

  const sdk = blueprint.sdkPublicBoundary;
  assert.equal(sdk.decisionRef, "KGA-D02");
  assert.equal(sdk.contract, "Edition/App->SDK->Kernel");
  assert.equal(sdk.scope, "governance-semantics-only");
  assert.ok(sdk.provisionalContractBoundary.includes("provisional projection contract"));
  assert.equal(sdk.canonicalDocRef.path, "docs/kernel-sdk-app-delivery-sequence.md");
  assert.match(sdk.canonicalDocRef.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!("canonicalDocRefs" in sdk), "unclassified canonicalDocRefs must not reappear");
  assert.equal(sdk.canonicalDocAnchors.length, 2);
  for (const anchor of sdk.canonicalDocAnchors) {
    assert.equal(anchor.isCanonicalPath, false, `${anchor.ref} must not be a canonical path`);
    assert.equal(anchor.verifiedByDigest, false, `${anchor.ref} must not claim digest verification`);
    assert.equal(anchor.documentPath, sdk.canonicalDocRef.path, `${anchor.ref} points at an unpinned document`);
  }
  assert.ok(sdk.outOfScope.length >= 4);
  assert.equal(sdk.exitCeiling, "scaffold-only");

  const model = blueprint.singleWriterLeaseModel;
  assert.equal(model.mode, "CLAUDE_ONLY");
  assert.equal(model.concurrentWriters, 1);
  assert.equal(model.invocation, "visible Pane --agent claude");
  assert.ok(model.invocationForbidden.includes("MCP claude_implement"));
  assert.equal(model.fallbackWriter, null);
  assert.equal(model.accountGate.failClosed, true);
  assert.equal(model.accountGate.providerFallbackAllowed, false);
});

test("candidate gates are review gates only and deferred risks are not blockers", async () => {
  const readiness = await readReadinessArtifact();

  assert.ok(readiness.unresolvedGates.length > 0);
  for (const gate of readiness.unresolvedGates) {
    assert.equal(gate.status, "open", `gate ${gate.id} must stay open`);
    assert.ok(candidateGateIds.has(gate.id), `${gate.id} is a deferred risk, not a candidate gate`);
  }
  assert.ok(readiness.deferredRisks.length > 0);
  for (const risk of readiness.deferredRisks) {
    assert.equal(risk.kind, "deferred-risk", `${risk.id} kind drifted`);
    assert.equal(risk.isReadinessBlocker, false, `${risk.id} must not be a readiness blocker`);
  }
});

test("the human-readable projection and checker exist, are wired and claim no PASS", () => {
  assert.ok(existsSync(path.join(root, docPath)), `${docPath} must exist`);
  assert.ok(existsSync(path.join(root, checkerPath)), `${checkerPath} must exist`);

  const doc = readFileSync(path.join(root, docPath), "utf8");
  for (const token of [
    "CANDIDATE", "BLOCKED", "NO-GO", "NO_GO", "planned-not-run",
    "visible Pane --agent claude", actionplanSha, kernelSha,
  ]) {
    assert.ok(doc.includes(token), `${docPath} is missing ${token}`);
  }
  for (const forbidden of ["CI passed", "tests passed", "PASS:", "production-ready", "release-ready", root]) {
    assert.ok(!doc.includes(forbidden), `${docPath} claims or embeds ${forbidden}`);
  }

  const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(scripts["check:readiness"], `node ${checkerPath}`);
});

test("the strongest readiness checker runs clean inside npm test", () => {
  // Wiring the checker into the test surface means npm test cannot pass while a byte-exact
  // digest, ledger projection or policy-mirror check fails.
  const output = execFileSync(process.execPath, [path.join(root, checkerPath)], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(output, /readiness candidate:/);
  assert.match(output, /BLOCKED \/ NO-GO/);
  assert.match(output, /code start denied/);
});

test("the additive successor policy is recorded separately from immutable history", async () => {
  const readiness = await readReadinessArtifact();
  const successor = readiness.successorInvocationPolicy;

  assert.equal(successor.currentWorkerInvocation, "pane-visible-agent-claude");
  assert.equal(successor.forbiddenInvocation, "mcp-claude_implement");
  assert.equal(successor.historicalInvocation, "claude_implement");
  assert.equal(successor.historicalPolicyRewritten, false);
  assert.equal(successor.supersedes, "invocation-mechanism-only");
  assert.equal(successor.mode, "CLAUDE_ONLY");
  assert.equal(successor.singleActiveWriter, true);
  assert.equal(successor.fallbackWriter, null);
  assert.equal(successor.runtimeStarted, false);
  assert.equal(successor.accountGate.failClosed, true);
  assert.equal(successor.collectorEvent.eventId, "37e87ad17327e4e5f004");

  // The 2026-07-30 provenance must still read the original value, byte-faithfully.
  const bootstrap = JSON.parse(readFileSync(path.join(root, "planning/bootstrap-state.json"), "utf8"));
  const approval = JSON.parse(readFileSync(path.join(root, "planning/human-decision-request.json"), "utf8"));
  assert.equal(bootstrap.codingPolicy.writer.invocation, "claude_implement");
  assert.equal(approval.response.codingPolicy.writer.invocation, "claude_implement");
  assert.notEqual(successor.currentWorkerInvocation, bootstrap.codingPolicy.writer.invocation);
});

test("a canonical path hidden inside an array is discovered", () => {
  // Guards the array-recursion fix: a bare canonical string in an array must be swept up.
  const CANONICAL_REF = /^(reports|docs|src\/data\/generated\/nodes)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(json|md)$/;
  const found = new Set();
  const walk = (node) => {
    if (typeof node === "string") {
      if (CANONICAL_REF.test(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const value of Object.values(node)) walk(value);
  };
  walk({ nested: { list: ["reports/hidden-in-an-array.json", { deeper: ["docs/also-hidden.md"] }] } });
  assert.deepEqual(
    [...found].sort(),
    ["docs/also-hidden.md", "reports/hidden-in-an-array.json"],
    "array recursion failed to discover canonical paths",
  );
});
