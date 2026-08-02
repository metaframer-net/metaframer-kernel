#!/usr/bin/env node
// Strict fail-closed oracle for the kernel AI development readiness CANDIDATE package.
// It never trusts artifact-supplied paths or environment overrides: the canonical Actionplan
// repository is discovered from verified local topology and its origin identity.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = "planning/kernel-ai-development-readiness.json";
const DOC = "docs/kernel-ai-development-readiness.md";
const ACTIONPLAN_REPO = "karacaismail/actionplan";
const ACTIONPLAN_SHA = "7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d";
const KERNEL_SHA = "b80f2ed0f4d968ee11d59bc3b31890f960ac9372";
const CARD_COUNT = 33;
const EDGE_COUNT = 50;
const EXTERNAL_COUNT = 9;
const PHASES = ["db-rls-transaction-outbox-audit", "kernel-primitives", "sdk", "walking-skeleton"];
const DATA_PLANE = ["db", "rls", "transaction", "outbox", "audit"];
const AXES = ["unit","integration","contract","e2e","tenant","rls","race","idempotency","migration","atomicity","fuzz","scans","performance","load","failureInjection","observability","compatibility","sdk","rollback"];
const GATE_KEYS = ["codeStartAllowed","runtimeCodeAllowed","implemented","started","readinessClaimed"];
const RUNTIME_KEYS = ["implemented","started","sdkReady","appBuildable","releaseAllowed","deployAllowed","kernelReady"];
const ROOT_KEYS = ["schemaVersion","id","generatedAt","packageKind","readinessStatus","codeStartAllowed","runtimeCodeAllowed","verdict","verdictTokenMap","candidateDisposition","runtime","identity","sourceEvidence","redEvidence","successorInvocationPolicy","promotionProtocol","blueprint","dependencyGraph","qualityAxes","executionCards","unresolvedGates","deferredRisks","nonGoals","rollback"];
const CARD_KEYS = ["cardId","decisionId","shardClass","fileClass","semantics","parentId","parentOwner","sourceCluster","selectedDescendantId","title","level","approvalRef","selectionStatus","implementationBoundary","sequencePhase","blockedByPhase","repoPath","allowedFiles","nonGoals","ownerLease","predecessorEvidence","redTest","plannedTest","deterministicBehaviors","acceptanceMapping","dataImpact","securityImpact","performanceBudget","observability","rollback","expectedEvidence","quality","gate","provenance"];
const ALLOWED_GATE_IDS = new Set(["successor-authority","review-a","review-b","codex-verification"]);
const CANONICAL_REF = /^(reports|docs|src\/data\/generated\/nodes)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(json|md)$/;
const PERF_TIERS = { "kernel-core": 100, adapter: 200, "app-e2e": 400, asynchronous: null };
// Semantic-binding coverage. These sentences deliberately share axis-level frames; what must
// be card-specific is the *bound meaning*, so the oracle measures typed semantic signals, not
// prose novelty. No uniqueness score is claimed or enforced.
const SEMANTIC_TYPES = ["domain","observable-signal","primary-threat","characteristic-failure","excluded-scope","planned-data-impact","performance-tier","security-class"];
const MIN_TYPED_SIGNALS = 2; // per risk and per acceptance entry
const GENERIC_VALUES = [/^nothing beyond/i,/^n\/a$/i,/^none$/i,/^generic/i,/^various/i,/^to be decided/i,/^tbd$/i];
const TYPE_DIVERSITY_FLOOR = { domain: 33, "observable-signal": 33, "primary-threat": 33, "characteristic-failure": 33, "excluded-scope": 33, "planned-data-impact": 20, "performance-tier": 4, "security-class": 15 };

// --- hardened git access --------------------------------------------------------
// Replacement objects disabled, config and directory overrides scrubbed, no shell.
const GIT_ENV = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" };
for (const key of ["GIT_DIR","GIT_WORK_TREE","GIT_OBJECT_DIRECTORY","GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_REPLACE_REF_BASE","GIT_CONFIG_GLOBAL","GIT_CONFIG_SYSTEM","GIT_CONFIG_COUNT","GIT_COMMON_DIR","GIT_INDEX_FILE","GIT_NAMESPACE","GIT_CEILING_DIRECTORIES","GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
  delete GIT_ENV[key];
}
const git = (cwd, args) =>
  execFileSync("git", ["--no-replace-objects", "-C", cwd, ...args], {
    encoding: "utf8",
    env: GIT_ENV,
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
const normaliseRemote = (url) => url.trim().replace(/\.git$/, "").replace(/^.*[:/]([^/:]+\/[^/:]+)$/, "$1");

// Discover the canonical Actionplan checkout from local topology only. The artifact's
// localVerificationPath is never used as an input to this search.
function discoverActionplan() {
  const seen = new Set();
  const roots = [];
  let cursor = root;
  for (let depth = 0; depth < 5; depth += 1) {
    cursor = path.dirname(cursor);
    if (cursor === path.dirname(cursor)) break;
    roots.push(cursor);
  }
  const candidates = [];
  for (const base of roots) {
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(base, entry.name);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (!existsSync(path.join(candidate, ".git"))) continue;
      candidates.push(candidate);
    }
  }
  for (const candidate of candidates) {
    let origin;
    try {
      origin = git(candidate, ["remote", "get-url", "origin"]);
    } catch {
      continue;
    }
    if (normaliseRemote(origin) !== ACTIONPLAN_REPO) continue;
    let topLevel;
    try {
      topLevel = git(candidate, ["rev-parse", "--show-toplevel"]).trim();
    } catch {
      continue;
    }
    if (path.resolve(topLevel) !== path.resolve(candidate)) continue;
    return candidate;
  }
  assert.fail(`canonical Actionplan checkout for ${ACTIONPLAN_REPO} was not discoverable from local topology`);
}

const apRoot = discoverActionplan();
// Object-format-safe: the pinned id length must match the repository's object format.
const objectFormat = git(apRoot, ["rev-parse", "--show-object-format"]).trim();
assert.ok(["sha1", "sha256"].includes(objectFormat), `unsupported object format: ${objectFormat}`);
assert.equal(
  ACTIONPLAN_SHA.length,
  objectFormat === "sha1" ? 40 : 64,
  `pinned Actionplan id length does not match the ${objectFormat} object format`,
);
assert.match(ACTIONPLAN_SHA, /^[0-9a-f]+$/, "pinned Actionplan id is not lowercase hex");
// Exact commit, resolved without replacement objects and without ref interpretation.
assert.equal(
  git(apRoot, ["rev-parse", "--verify", "--end-of-options", `${ACTIONPLAN_SHA}^{commit}`]).trim(),
  ACTIONPLAN_SHA,
  "pinned Actionplan commit did not resolve to itself",
);
assert.equal(git(apRoot, ["cat-file", "-t", ACTIONPLAN_SHA]).trim(), "commit", "pinned Actionplan id is not a commit");
const canonicalBlob = (ref) => git(apRoot, ["show", "--no-textconv", `${ACTIONPLAN_SHA}:${ref}`]);
const canonicalDigest = (ref) => createHash("sha256").update(canonicalBlob(ref)).digest("hex");

const readiness = JSON.parse(readFileSync(path.join(root, ARTIFACT), "utf8"));
const raw = JSON.stringify(readiness);
const deck = readiness.executionCards;

// --- root contract ---------------------------------------------------------------
assert.deepEqual(Object.keys(readiness).sort(), [...ROOT_KEYS].sort(), "artifact root key set drifted");
assert.equal(readiness.packageKind, "readiness-candidate");
assert.equal(readiness.readinessStatus, "BLOCKED");
assert.equal(readiness.codeStartAllowed, false);
assert.equal(readiness.runtimeCodeAllowed, false);
assert.equal(readiness.verdict, "NO-GO");
assert.equal(readiness.verdictTokenMap.canonical, "NO-GO");
assert.equal(readiness.verdictTokenMap.kernelLocal, "NO_GO");
assert.equal(readiness.candidateDisposition.successorAuthorityEffective, false);
assert.equal(readiness.candidateDisposition.approvedBy, null);
assert.equal(readiness.candidateDisposition.effectiveFrom, null);
assert.deepEqual(Object.keys(readiness.runtime).sort(), [...RUNTIME_KEYS].sort());
for (const key of RUNTIME_KEYS) assert.equal(readiness.runtime[key], false, `runtime.${key} must stay false`);
assert.ok(Array.isArray(deck), "executionCards must be an array");
assert.equal(deck.length, CARD_COUNT);

// --- identity --------------------------------------------------------------------
assert.equal(readiness.identity.pathMode, "repository-relative");
assert.equal(readiness.identity.absoluteKernelWorktreePathsRecorded, false, "kernel worktree path claim drifted");
assert.ok(!("absolutePathsRecorded" in readiness.identity), "the misleading absolutePathsRecorded key must be gone");
assert.equal(readiness.identity.kernelRootResolution, "derived-from-import-meta-url");
assert.equal(readiness.sourceEvidence.kernel.rootPathRecorded, false);
assert.ok(!("repoPath" in readiness.sourceEvidence.kernel), "kernel evidence must not record a path");
assert.ok(!raw.includes(root), "artifact must not embed the kernel worktree root");
assert.ok(!raw.includes("/worktrees/"), "artifact must not embed a worktree path");
assert.equal(readiness.sourceEvidence.actionplan.repository, ACTIONPLAN_REPO);
assert.equal(readiness.sourceEvidence.actionplan.ref, "refs/remotes/origin/main");
assert.equal(readiness.sourceEvidence.actionplan.sha, ACTIONPLAN_SHA);
assert.equal(readiness.sourceEvidence.actionplan.mutationAllowed, false);
assert.equal(readiness.sourceEvidence.actionplan.localVerificationPath.isIdentity, false);
assert.equal(readiness.sourceEvidence.kernel.sha, KERNEL_SHA);
assert.equal(readiness.sourceEvidence.kernel.mutationAllowed, false);

// --- every recorded canonical digest is verified, and none is unused ---------------
const verifiedRefs = new Set();
const verifyDigest = (ref, digest, where) => {
  assert.match(ref, CANONICAL_REF, `${where} canonical ref is not a strict canonical path: ${ref}`);
  assert.match(digest, /^[0-9a-f]{64}$/, `${where} digest is malformed`);
  assert.equal(digest, canonicalDigest(ref), `${where} digest is not byte-exact at ${ACTIONPLAN_SHA}`);
  verifiedRefs.add(ref);
};
const evidence = readiness.sourceEvidence;
for (const [key, entry] of Object.entries(evidence.canonicalDigests)) verifyDigest(entry.path, entry.sha256, `canonicalDigests.${key}`);
verifyDigest(evidence.d01Ledger.path, evidence.d01Ledger.sha256, "d01Ledger");
verifyDigest(evidence.effectiveAuthority.ref, evidence.effectiveAuthority.sha256, "effectiveAuthority");
verifyDigest(evidence.applicationState.ref, evidence.applicationState.sha256, "applicationState");
verifyDigest(evidence.decisionRegistry.ref, evidence.decisionRegistry.sha256, "decisionRegistry");
verifyDigest(readiness.dependencyGraph.relationDirectionNote.canonicalRef, readiness.dependencyGraph.relationDirectionNote.canonicalSha256, "relationDirectionNote");
verifyDigest(readiness.blueprint.sdkPublicBoundary.canonicalRef, readiness.blueprint.sdkPublicBoundary.canonicalSha256, "sdkPublicBoundary");
verifyDigest(readiness.blueprint.sdkPublicBoundary.canonicalDocRef.path, readiness.blueprint.sdkPublicBoundary.canonicalDocRef.sha256, "sdkPublicBoundary.canonicalDocRef");
verifyDigest(readiness.blueprint.dataPlaneOrdering.tenancy.canonicalRef, readiness.blueprint.dataPlaneOrdering.tenancy.canonicalSha256, "tenancy");
for (const phase of readiness.blueprint.phases) verifyDigest(phase.canonicalRef, phase.canonicalSha256, `phase ${phase.id}`);

// Live chain head, application state and registry are re-read from the pinned commit.
const chain = JSON.parse(canonicalBlob(evidence.effectiveAuthority.ref));
assert.equal(evidence.effectiveAuthority.seq, chain.chainHeadSeq, "chain head seq drifted");
assert.equal(evidence.effectiveAuthority.chainHeadSha256, chain.chainHeadEntrySha256, "chain head digest drifted");
assert.equal(evidence.effectiveAuthority.normalizedTextSha256, chain.entries.at(-1).normalizedTextSha256, "chain head text digest drifted");
assert.equal(evidence.effectiveAuthority.epochId, chain.entries.at(-1).epochId, "epoch id drifted");
const state = JSON.parse(canonicalBlob(evidence.applicationState.ref));
assert.deepEqual(evidence.applicationState.summary, state.summary, "application state summary drifted");
assert.equal(evidence.applicationState.status, state.status, "application state status drifted");
assert.equal(evidence.decisionRegistry.isReadinessBlocker, false);
const registry = JSON.parse(canonicalBlob(evidence.decisionRegistry.ref));
assert.ok(registry.decisions.every((d) => d.status === evidence.decisionRegistry.allRowsStatus), "registry row status drifted");

// --- external collector ledger, read for real ---------------------------------------
// Resolved fail-closed from the user's Codex ledger directory, independent of any path or
// override the artifact supplies. Artifact literals are never treated as external evidence.
function resolveCollectorLedger(slug) {
  const home = process.env.HOME;
  assert.ok(home && path.isAbsolute(home), "HOME is not usable for collector-ledger resolution");
  const dir = path.join(home, ".codex", "actionplan-changelog-ledger");
  assert.ok(existsSync(dir) && statSync(dir).isDirectory(), `collector ledger directory is missing: ${dir}`);
  const matches = readdirSync(dir).filter((name) => name.startsWith(slug) && name.endsWith(".jsonl")).sort();
  assert.equal(matches.length, 1, `expected exactly one collector ledger for ${slug}, found ${matches.length}`);
  return path.join(dir, matches[0]);
}
const ledgerFile = resolveCollectorLedger("kernel-ai-readiness-actionplan-2026-08-01-");
const collectorRecords = readFileSync(ledgerFile, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));
assert.ok(collectorRecords.length > 0, "collector ledger is empty");
const collectorById = new Map(collectorRecords.map((record) => [record.event_id, record]));
const ORIGINAL_ID = "bc594837225bd49b449a";
const COMPLETION_ID = "66f8369293744c534dde";
const originalRecord = collectorById.get(ORIGINAL_ID);
const completionRecord = collectorById.get(COMPLETION_ID);
assert.ok(originalRecord, `collector ledger does not contain original event ${ORIGINAL_ID}`);
assert.ok(completionRecord, `collector ledger does not contain completion event ${COMPLETION_ID}`);

// Each event is cross-validated only on the fields it genuinely carries.
// Original: RED identity, time, phase, the missing artifact and its own test line.
assert.equal(originalRecord.phase, "red", "original collector event is not a RED record");
assert.equal(originalRecord.timestamp, "2026-08-02T02:22:49.463298+00:00", "original event timestamp drifted");
assert.equal(originalRecord.facts.missing, ARTIFACT, "original event does not name the missing artifact");
assert.ok(
  originalRecord.tests.some((line) => line.includes("readiness-artifact-missing")),
  "original event carries no failing readiness test line",
);
assert.match(originalRecord.summary, /readiness oracle is RED on missing artifact/i, "original event summary drifted");
// Completion: exact command, exit code, exact token, pre-write digest, no historical rewrite.
assert.equal(completionRecord.timestamp, "2026-08-02T04:04:39.577513+00:00", "completion event timestamp drifted");
assert.equal(completionRecord.facts.original_event_id, ORIGINAL_ID, "completion event does not back-reference the original");
assert.equal(completionRecord.facts.original_timestamp, originalRecord.timestamp, "completion event back-reference time drifted");
assert.equal(
  completionRecord.facts.pre_write_test_sha256,
  "ee66e6fb8600d6cb61d6e445bccf455faa0999aa3bf1df62245178511a7cb260",
  "completion event pre-write digest drifted",
);
assert.match(completionRecord.facts.reRunProducesRed, /^false because/i, "completion event does not explain the non-rerun");
assert.match(completionRecord.facts.reRunProducesRed, /no historical file rewritten/i, "completion event does not attest the absence of a historical rewrite");
const completionTestLine = completionRecord.tests.find((line) => line.startsWith("node --test tests/kernel-ai-development-readiness.test.mjs"));
assert.ok(completionTestLine, "completion event carries no exact command line");
assert.ok(completionTestLine.includes("exit 1"), "completion event does not record exit 1");
assert.ok(completionTestLine.includes(`token readiness-artifact-missing: ${ARTIFACT}`), "completion event does not record the exact token");
assert.ok(Date.parse(originalRecord.timestamp) < Date.parse(completionRecord.timestamp), "collector events are out of order");

// --- collector-backed RED evidence ------------------------------------------------
const red = readiness.redEvidence;
assert.equal(red.observed, true);
assert.equal(red.observedBefore, "artifact-creation");
assert.equal(red.command, "node --test tests/kernel-ai-development-readiness.test.mjs");
assert.equal(red.exitCode, 1, "recorded RED exit code drifted");
assert.equal(red.failureToken, `readiness-artifact-missing: ${ARTIFACT}`);
assert.equal(red.preWriteTestSha256, "ee66e6fb8600d6cb61d6e445bccf455faa0999aa3bf1df62245178511a7cb260");
assert.equal(red.reRunProducesRed, false);
assert.equal(red.rerunClaimed, false, "no rerun may be claimed");
assert.equal(red.collectorEvents.length, 2, "both collector events must be recorded");
const [original, completion] = red.collectorEvents;
assert.equal(original.eventId, ORIGINAL_ID);
assert.equal(original.kind, "original");
assert.equal(original.observedAt, originalRecord.timestamp, "recorded original time disagrees with the ledger");
assert.equal(completion.eventId, COMPLETION_ID);
assert.equal(completion.kind, "completion");
assert.equal(completion.observedAt, completionRecord.timestamp, "recorded completion time disagrees with the ledger");
assert.equal(red.ledgerFileName, path.basename(ledgerFile), "recorded collector ledger file name disagrees with the resolved ledger");
// Per-record attestation must claim only what each external event really carries.
assert.deepEqual(
  original.attests.sort(),
  ["missing-artifact-path", "red-identity", "red-phase", "red-timestamp", "failing-readiness-test-line"].sort(),
  "original event attestation set is not what the ledger record carries",
);
assert.deepEqual(
  completion.attests.sort(),
  ["exact-command", "exact-token", "exit-code-1", "no-historical-rewrite", "original-event-backreference", "pre-write-test-sha256"].sort(),
  "completion event attestation set is not what the ledger record carries",
);
assert.ok(!original.attests.includes("exact-command"), "the original event does not carry the exact command");
assert.ok(!original.attests.includes("pre-write-test-sha256"), "the original event does not carry the pre-write digest");

// --- additive successor invocation policy and its collector attestation ----------------
const SUCCESSOR_ID = "37e87ad17327e4e5f004";
const successorRecord = collectorById.get(SUCCESSOR_ID);
assert.ok(successorRecord, `collector ledger does not contain successor event ${SUCCESSOR_ID}`);
assert.equal(successorRecord.timestamp, "2026-08-02T04:55:48.555639+00:00", "successor event timestamp drifted");
assert.equal(successorRecord.phase, "handoff", "successor event phase drifted");
assert.equal(successorRecord.facts.current_worker_invocation, "pane-visible-agent-claude");
assert.equal(successorRecord.facts.forbidden_invocation, "mcp-claude_implement");
assert.equal(successorRecord.facts.runtimeStarted, "false");
assert.match(successorRecord.facts.auth, /claude\.ai firstParty max/, "successor auth gate drifted");
assert.match(successorRecord.facts.auth, /claude-opus-5/, "successor model drifted");
assert.match(successorRecord.facts.auth, /fail-closed/, "successor fail-closed flag drifted");
assert.match(successorRecord.facts.codex_role, /MASTER/, "successor codex role drifted");
assert.match(successorRecord.facts.historical_policy, /byte-faithful/i, "successor event does not attest byte-faithful history");
assert.match(successorRecord.facts.historical_policy, /additive/i, "successor event does not describe itself as additive");

const successor = readiness.successorInvocationPolicy;
assert.equal(successor.currentWorkerInvocation, successorRecord.facts.current_worker_invocation);
assert.equal(successor.forbiddenInvocation, successorRecord.facts.forbidden_invocation);
assert.equal(successor.historicalInvocation, "claude_implement");
assert.equal(successor.historicalPolicyRewritten, false);
assert.equal(successor.supersedes, "invocation-mechanism-only");
assert.equal(successor.mode, "CLAUDE_ONLY");
assert.equal(successor.singleActiveWriter, true);
assert.equal(successor.fallbackWriter, null);
assert.equal(successor.runtimeStarted, false);
assert.equal(successor.accountGate.failClosed, true);
assert.equal(successor.collectorEvent.eventId, SUCCESSOR_ID);
assert.equal(successor.collectorEvent.observedAt, successorRecord.timestamp);
// The historical mirrors must still read the original value, byte-faithfully.
const historicalBootstrap = JSON.parse(readFileSync(path.join(root, "planning/bootstrap-state.json"), "utf8")).codingPolicy;
const historicalApproval = JSON.parse(readFileSync(path.join(root, "planning/human-decision-request.json"), "utf8")).response.codingPolicy;
assert.equal(historicalBootstrap.writer.invocation, "claude_implement", "historical bootstrap provenance was rewritten");
assert.equal(historicalApproval.writer.invocation, "claude_implement", "historical approval provenance was rewritten");
assert.notEqual(successor.currentWorkerInvocation, historicalBootstrap.writer.invocation, "successor and historical records must stay distinct");

// --- promotion protocol ------------------------------------------------------------
const protocol = readiness.promotionProtocol;
assert.equal(protocol.circularityAvoided, true);
assert.equal(protocol.selfHashRecorded, false);
assert.deepEqual(protocol.steps.map((s) => s.order), [1, 2, 3]);
assert.equal(protocol.currentStep, 1);
assert.ok(protocol.steps[1].recordedIn.includes("EPOCH-04"));
assert.ok(!protocol.steps[0].pins.some((p) => /artifact digest|candidate digest|self/i.test(p)), "step 1 must not pin a candidate digest");
assert.ok(protocol.steps[1].pins.some((p) => /artifact digest/i.test(p)), "step 2 must pin the candidate artifact digest");
for (const key of Object.keys(readiness)) {
  assert.ok(!/^(selfSha256|selfDigest|artifactSha256|artifactDigest)$/.test(key), `self digest field present: ${key}`);
}

// --- canonical ledger and its edge projection ---------------------------------------
const ledger = JSON.parse(canonicalBlob(evidence.d01Ledger.path)).ledger;
assert.equal(ledger.length, CARD_COUNT, "pinned D01 ledger row count drifted");
const selected = new Set(ledger.map((row) => row.selectedDescendantId));
const ledgerEdges = ledger.flatMap((row) =>
  row.dependencies.filter((dep) => selected.has(dep)).map((dep) => `${row.selectedDescendantId}->${dep}`),
);
assert.equal(ledgerEdges.length, EDGE_COUNT, `ledger projects ${ledgerEdges.length} internal edges, expected ${EDGE_COUNT}`);

// --- execution cards -----------------------------------------------------------------
const internalIds = new Set(deck.map((card) => card.selectedDescendantId));
assert.equal(internalIds.size, CARD_COUNT);
const semanticValues = new Map(SEMANTIC_TYPES.map((type) => [type, new Set()]));
const axisTypeSignatures = new Set();
const globalNormalised = new Set();
let plannedPathCount = 0;

const contained = (relative, where, label) => {
  assert.equal(typeof relative, "string", `${where} ${label} is not a string`);
  assert.ok(relative.length > 0, `${where} ${label} is empty`);
  assert.ok(!path.isAbsolute(relative), `${where} ${label} is absolute: ${relative}`);
  assert.ok(!relative.split("/").includes(".."), `${where} ${label} traverses upward: ${relative}`);
  assert.ok(path.resolve(root, relative).startsWith(`${root}${path.sep}`), `${where} ${label} escapes the root: ${relative}`);
};
const verifyExternal = (external, where) => {
  assert.match(external.canonicalRef, CANONICAL_REF, `${where} external ref is not a strict canonical path`);
  assert.ok(external.canonicalRef.startsWith("src/data/generated/nodes/"), `${where} external ref is not a generated node`);
  verifyDigest(external.canonicalRef, external.canonicalSha256, `${where} external`);
  assert.equal(external.satisfied, false, `${where} external claims satisfaction`);
  assert.notEqual(external.disposition, "deferred-to-human-predecessor-decision", `${where} uses a blanket disposition`);
};

deck.forEach((card, index) => {
  const row = ledger[index];
  const where = `${card.cardId} (${card.selectedDescendantId})`;
  assert.deepEqual(Object.keys(card).sort(), [...CARD_KEYS].sort(), `${where} card key set drifted`);
  assert.equal(card.decisionId, "KGA-D01");
  assert.equal(card.shardClass, "kernel-contract-shard");
  assert.equal(card.parentId, row.parentId, `${where} parentId drifted from the pinned ledger`);
  assert.equal(card.selectedDescendantId, row.selectedDescendantId, `${where} descendant drifted`);
  assert.equal(card.plannedTest.testCommand, row.plannedTestCommand, `${where} test command drifted`);
  assert.equal(card.implementationBoundary.expansionAllowed, false);
  assert.ok(PHASES.includes(card.sequencePhase));

  // repoPath and allowedFiles: bounded, non-empty, contained.
  assert.equal(card.repoPath, "metaframer-kernel", `${where} repoPath must name the kernel repository identity`);
  assert.ok(!path.isAbsolute(card.repoPath), `${where} repoPath must not be absolute`);
  assert.ok(!card.repoPath.includes("/worktrees/"), `${where} repoPath must not embed a worktree`);
  assert.ok(Array.isArray(card.allowedFiles) && card.allowedFiles.length > 0, `${where} allowedFiles must be non-empty`);
  for (const file of card.allowedFiles) contained(file, where, "allowedFiles entry");
  assert.ok(card.allowedFiles.includes(card.plannedTest.testFileRelative), `${where} allowedFiles must include its planned test`);
  assert.equal(new Set(card.allowedFiles).size, card.allowedFiles.length, `${where} allowedFiles has duplicates`);

  // Owner lease.
  const lease = card.ownerLease;
  assert.equal(lease.mode, "CLAUDE_ONLY");
  assert.equal(lease.concurrentWriters, 1);
  assert.equal(lease.invocation, "visible Pane --agent claude", `${where} lease invocation drifted`);
  assert.ok(lease.invocationForbidden.includes("MCP claude_implement"), `${where} must forbid MCP claude_implement`);
  assert.equal(lease.delegationAllowed, false);
  assert.equal(lease.fallbackWriter, null);
  assert.equal(lease.gitMutationAllowed, false);
  assert.equal(lease.accountGate.failClosed, true);
  assert.equal(lease.accountGate.providerFallbackAllowed, false);

  // Predecessors.
  const pre = card.predecessorEvidence;
  assert.equal(pre.allSatisfied, false);
  const declaredInternal = row.dependencies.filter((dep) => selected.has(dep));
  const declaredExternal = row.dependencies.filter((dep) => !selected.has(dep));
  assert.deepEqual(pre.internalPredecessors.map((p) => p.cardRef), declaredInternal, `${where} internal predecessors drifted from the ledger`);
  assert.deepEqual(pre.externalPredecessors.map((p) => p.nodeId), declaredExternal, `${where} external predecessors drifted from the ledger`);
  for (const internal of pre.internalPredecessors) {
    assert.ok(internalIds.has(internal.cardRef), `${where} internal predecessor unknown`);
    assert.equal(internal.completionEvidence, null, `${where} fabricates predecessor evidence`);
    assert.equal(internal.satisfied, false);
  }
  for (const external of pre.externalPredecessors) {
    assert.ok(!internalIds.has(external.nodeId), `${where} lists an internal id as external`);
    verifyExternal(external, where);
  }

  // RED and planned test, exactly.
  assert.equal(card.redTest.required, true);
  assert.equal(card.redTest.observed, false);
  assert.equal(card.redTest.observedEvidence, null);
  assert.equal(card.redTest.command, `uv run --python 3.12 pytest -q ${card.plannedTest.testFileRelative}`, `${where} redTest command is not exact`);
  assert.equal(card.redTest.expectedFailureToken, `ERROR: file or directory not found: ${card.plannedTest.testFileRelative}`, `${where} redTest token is not exact`);
  assert.equal(card.plannedTest.status, "planned-not-run");
  assert.equal(card.plannedTest.executed, false);
  assert.equal(card.plannedTest.evidence, null);
  contained(card.plannedTest.testFileRelative, where, "planned test path");
  assert.equal(existsSync(path.resolve(root, card.plannedTest.testFileRelative)), false, `${where} planned test path exists`);
  plannedPathCount += 1;
  for (const artifact of card.expectedEvidence.artifacts) {
    const candidate = artifact.replace(/ run output$/, "");
    if (candidate.includes("/")) contained(candidate, where, "expectedEvidence artifact");
  }
  assert.equal(card.expectedEvidence.currentEvidence, null);

  // Deterministic behaviors.
  assert.ok(card.deterministicBehaviors.positive.length >= 2, `${where} needs at least two positive behaviors`);
  assert.ok(card.deterministicBehaviors.negativeFailClosed.length >= 3, `${where} needs at least three fail-closed behaviors`);
  assert.equal(card.acceptanceMapping.humanRunRequired, true);
  assert.ok(card.acceptanceMapping.mappedTo.positive.includes(card.plannedTest.testFileRelative), `${where} acceptance is unmapped`);
  assert.ok(card.nonGoals.length >= 4, `${where} needs substantive non-goals`);

  // Data impact: typed, and truthful rather than blanket.
  const di = card.dataImpact;
  for (const key of ["schemaChange", "migrationRequired", "rlsPolicyChange", "rlsScopeRequired"]) {
    assert.equal(typeof di[key], "boolean", `${where} dataImpact.${key} must be boolean`);
  }
  assert.equal(di.runtimeDataImpact, "none", `${where} current runtime data impact must be none while nothing is implemented`);
  assert.ok(typeof di.plannedRuntimeDataImpact === "string" && di.plannedRuntimeDataImpact.length > 0, `${where} needs a planned runtime data impact`);
  // Phase 1 has not started, so no card may already require a schema, migration or policy.
  assert.equal(di.schemaChange, false, `${where} cannot change schema before phase 1`);
  assert.equal(di.migrationRequired, false, `${where} cannot require a migration before phase 1`);
  assert.equal(di.rlsPolicyChange, false, `${where} cannot change an RLS policy before phase 1`);
  // A card that will hold tenant data must say its rows need tenant scoping.
  const definitionsOnly = /definitions only$/.test(di.plannedRuntimeDataImpact);
  assert.equal(di.rlsScopeRequired, !definitionsOnly, `${where} rlsScopeRequired must follow its planned data impact`);

  // Security impact: typed and semantically consistent with the contract.
  const si = card.securityImpact;
  assert.equal(typeof si.secretsHandled, "boolean", `${where} secretsHandled must be boolean`);
  assert.equal(typeof si.piiHandled, "boolean", `${where} piiHandled must be boolean`);
  assert.ok(si.securityClass?.length > 0, `${where} needs a security class`);
  assert.ok(si.primaryThreat?.length > 0, `${where} needs a primary threat`);
  assert.ok(si.characteristicFailure?.length > 0, `${where} needs a characteristic failure`);
  assert.ok(si.tenantIsolation.includes("FORCE RLS"), `${where} weakens tenant isolation`);
  assert.ok(Array.isArray(si.controls) && si.controls.length > 0, `${where} needs security controls`);
  if (si.piiHandled) {
    assert.ok(si.controls.some((c) => /PII|residency|retention/i.test(c)), `${where} handles PII without a PII control`);
  }
  if (si.secretsHandled) {
    assert.ok(si.controls.some((c) => /credential|secret/i.test(c)), `${where} handles secrets without a secret control`);
  }
  if (si.securityClass === "authorization-critical") {
    assert.ok(/deny|fail-open|unaudited|unexplainable/i.test(si.primaryThreat), `${where} is authorization-critical but names no deny/fail-open threat`);
  }
  if (si.securityClass === "tenant-isolation-critical") {
    assert.equal(si.crossTenantRisk, "primary-risk-for-this-contract", `${where} is tenant-isolation-critical but downplays cross-tenant risk`);
  }

  // Performance: tiered, ranged, never a blanket 100.
  const pb = card.performanceBudget;
  assert.ok(Object.keys(PERF_TIERS).includes(pb.tier), `${where} unknown performance tier: ${pb.tier}`);
  assert.equal(pb.p95Ms, PERF_TIERS[pb.tier], `${where} p95 does not match its declared tier`);
  if (pb.p95Ms !== null) {
    assert.ok(Number.isInteger(pb.p95Ms) && pb.p95Ms > 0 && pb.p95Ms <= 1000, `${where} p95 is out of range`);
  }
  assert.equal(pb.measured, false, `${where} claims a measured budget`);

  // Observability, rollback, gate.
  assert.equal(card.observability.emitted, false);
  assert.ok(card.observability.requiredFields.includes("tenant_id"));
  assert.ok(card.observability.signalName?.length > 0, `${where} names no observable signal`);
  assert.ok(card.observability.counters.length > 0 && card.observability.histograms.length > 0, `${where} declares no metrics`);
  assert.equal(card.rollback.decisionOwner, "codex");
  assert.equal(card.rollback.executor, "claude-via-visible-pane");
  assert.ok(card.rollback.executorForbidden.includes("codex"));
  assert.ok(card.rollback.verification.length > 0);
  assert.deepEqual(Object.keys(card.gate).sort(), [...GATE_KEYS].sort(), `${where} gate key set drifted`);
  for (const key of GATE_KEYS) assert.equal(card.gate[key], false, `${where} gate.${key} must stay false`);
  assert.equal(card.provenance.actionplanSha, ACTIONPLAN_SHA);

  // Structured semantics: typed, truthful, non-generic and context-appropriate.
  assert.ok(card.semantics && typeof card.semantics === "object", `${where} records no structured semantics`);
  assert.deepEqual(
    [...new Set(Object.values(card.semantics).map((sig) => sig.type))].sort(),
    [...SEMANTIC_TYPES].sort(),
    `${where} structured semantic type set drifted`,
  );
  for (const [key, signal] of Object.entries(card.semantics)) {
    assert.ok(typeof signal.value === "string" && signal.value.trim().length >= 4, `${where} semantics.${key} is too thin to be meaningful`);
    for (const generic of GENERIC_VALUES) {
      assert.ok(!generic.test(signal.value.trim()), `${where} semantics.${key} is a generic placeholder: ${signal.value}`);
    }
    // A signal must never be a bare identifier substitution.
    assert.notEqual(signal.value, card.selectedDescendantId, `${where} semantics.${key} is just the descendant id`);
    assert.notEqual(signal.value, card.title, `${where} semantics.${key} is just the title`);
    assert.notEqual(signal.value, card.parentId, `${where} semantics.${key} is just the parent id`);
    semanticValues.get(signal.type).add(signal.value);
  }
  // Context-appropriate: each structured value must agree with the card field it describes.
  assert.equal(card.semantics.threat.value, card.securityImpact.primaryThreat, `${where} threat signal disagrees with securityImpact`);
  assert.equal(card.semantics.failure.value, card.securityImpact.characteristicFailure, `${where} failure signal disagrees with securityImpact`);
  assert.equal(card.semantics.dataImpact.value, card.dataImpact.plannedRuntimeDataImpact, `${where} data-impact signal disagrees with dataImpact`);
  assert.equal(card.semantics.perfTier.value, card.performanceBudget.tier, `${where} performance-tier signal disagrees with performanceBudget`);
  assert.equal(card.semantics.securityClass.value, card.securityImpact.securityClass, `${where} security-class signal disagrees with securityImpact`);
  assert.equal(card.semantics.signal.value, card.observability.signalName, `${where} observable-signal disagrees with observability`);
  // The exclusion must be derivable from this card's own recorded scope sentence.
  const scopeText = card.implementationBoundary.scope.toLowerCase();
  const exclusionWords = card.semantics.exclusion.value.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  assert.ok(
    exclusionWords.length > 0 && exclusionWords.some((word) => scopeText.includes(word)),
    `${where} excluded-scope signal is not derivable from its own scope: ${card.semantics.exclusion.value}`,
  );

  // Shard file class and bounded write scope.
  assert.ok(["isolated", "shared"].includes(card.fileClass), `${where} fileClass must be isolated or shared`);

  // Quality axes: 19, bound and unevidenced.
  assert.deepEqual(Object.keys(card.quality).sort(), [...AXES].sort(), `${where} quality axis set drifted`);
  const tokens = [card.selectedDescendantId, card.title, card.parentId, ...row.dependencies].sort((a, b) => b.length - a.length);
  for (const axis of AXES) {
    const entry = card.quality[axis];
    assert.equal(entry.axis, axis);
    assert.ok(["applicable", "not-applicable"].includes(entry.applicability));
    assert.equal(entry.currentEvidence, null, `${where} axis ${axis} carries evidence`);
    assert.equal(entry.humanRunRequired, true);
    assert.ok(entry.specialistRole?.length > 0);
    assert.ok(entry.risk?.length > 0, `${where} axis ${axis} has no risk`);
    assert.ok(entry.acceptance?.length > 0, `${where} axis ${axis} has no acceptance`);
    const bound = entry.boundTo;
    assert.ok(bound, `${where} axis ${axis} records no binding`);
    assert.equal(bound.title, card.title);
    assert.ok(card.implementationBoundary.scope.startsWith(bound.scopeClause), `${where} axis ${axis} scope clause is foreign`);
    assert.deepEqual(bound.dependencies, row.dependencies, `${where} axis ${axis} dependency binding drifted`);
    assert.equal(bound.plannedRuntimeDataImpact, di.plannedRuntimeDataImpact, `${where} axis ${axis} data impact drifted`);
    assert.equal(bound.performanceTier, pb.tier, `${where} axis ${axis} performance tier drifted`);
    if (entry.applicability === "not-applicable") {
      assert.ok(entry.notApplicableReason?.length > 0, `${where} axis ${axis} is N/A without a reason`);
      assert.equal(entry.evidenceArtifact, null);
    } else {
      assert.equal(entry.notApplicableReason, null);
      contained(entry.evidenceArtifact, where, `quality.${axis} evidenceArtifact`);
    }
    // Semantic-binding coverage: each entry must carry at least two independently typed,
    // truthful signals drawn from this card's explicit structured semantics.
    const boundTypes = (text) => [...new Set(Object.values(card.semantics).filter((sig) => text.includes(sig.value)).map((sig) => sig.type))].sort();
    for (const field of ["risk", "acceptance"]) {
      const present = boundTypes(entry[field]);
      assert.ok(
        present.length >= MIN_TYPED_SIGNALS,
        `${where} axis ${axis} ${field} binds only ${present.length} typed semantic signal(s); at least ${MIN_TYPED_SIGNALS} required`,
      );
      assert.deepEqual(entry.semanticBinding[field], present, `${where} axis ${axis} ${field} recorded binding does not match its text`);
    }
    axisTypeSignatures.add(`${axis}:${entry.semanticBinding.risk.join("+")}|${entry.semanticBinding.acceptance.join("+")}`);
  }
});

// --- semantic-binding coverage, not prose uniqueness ---------------------------------
for (const [type, values] of semanticValues) {
  const floor = TYPE_DIVERSITY_FLOOR[type];
  assert.ok(
    values.size >= floor,
    `semantic type ${type} carries only ${values.size} distinct values across ${CARD_COUNT} cards; at least ${floor} required`,
  );
}
assert.ok(
  axisTypeSignatures.size > 1,
  "every axis binds the identical type signature; axes must bind different facets of a card",
);

// --- isolated shards must not share files -------------------------------------------
const isolatedFiles = new Map();
for (const card of deck) {
  if (card.fileClass !== "isolated") continue;
  for (const file of card.allowedFiles) {
    const owner = isolatedFiles.get(file);
    assert.equal(owner, undefined, `isolated shards ${owner} and ${card.cardId} both claim ${file}`);
    isolatedFiles.set(file, card.cardId);
  }
}
const totalAllowed = deck.reduce((sum, card) => sum + card.allowedFiles.length, 0);
assert.equal(isolatedFiles.size, totalAllowed, `allowedFiles are not pairwise disjoint across isolated shards`);
assert.equal(totalAllowed, CARD_COUNT * 2, `expected ${CARD_COUNT * 2} allowedFiles across the deck, found ${totalAllowed}`);

// --- every recorded canonical reference is consumed; none is decorative ----------------
// Every canonical path anywhere in the artifact must be discovered, including bare strings
// inside arrays. A string that merely looks canonical is caught wherever it hides.
const recordedRefs = new Set();
const anchorRefs = new Set();
const walkRefs = (node) => {
  if (typeof node === "string") {
    if (CANONICAL_REF.test(node)) recordedRefs.add(node);
    else if (/^(reports|docs|src\/data\/generated\/nodes)\/[^\s]+#/.test(node)) anchorRefs.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkRefs(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const value of Object.values(node)) walkRefs(value);
};
walkRefs(readiness);
// The detector must actually find things; a silently empty sweep would pass vacuously.
assert.ok(recordedRefs.size >= verifiedRefs.size, "canonical-reference sweep found fewer refs than were verified");
assert.ok(recordedRefs.size > 0, "canonical-reference sweep found nothing; the walk is vacuous");
// Anchor-only references are classified honestly: not canonical paths, not digest-verified,
// but every one must point into a document that IS pinned and verified.
for (const anchor of anchorRefs) {
  const documentPath = anchor.split("#")[0];
  assert.ok(
    verifiedRefs.has(documentPath),
    `anchor reference ${anchor} points into ${documentPath}, which is never pinned or verified`,
  );
}
// Two kinds of fragment reference exist: document anchors (docs/*.md#section) and JSON
// pointers into pinned reports (reports/*.json#/pointer). Neither is a canonical path, and
// neither is digest-verified on its own — but the document each points into must be pinned.
const docAnchors = new Set([...anchorRefs].filter((ref) => ref.startsWith("docs/")));
const pointerRefs = new Set([...anchorRefs].filter((ref) => !ref.startsWith("docs/")));
assert.ok(pointerRefs.size > 0, "JSON-pointer references were not discovered; the sweep is incomplete");
const declaredAnchors = readiness.blueprint.sdkPublicBoundary.canonicalDocAnchors ?? [];
assert.equal(declaredAnchors.length, docAnchors.size, "declared anchor set does not match the document anchors found in the artifact");
// The anchor set is grounded in KGA-D02's own canonicalDocRefs at the pinned commit, so an
// anchor cannot be quietly dropped from both the declaration and the sweep together.
const d02Doc = JSON.parse(canonicalBlob(readiness.blueprint.sdkPublicBoundary.canonicalRef));
assert.deepEqual(
  declaredAnchors.map((entry) => entry.ref).sort(),
  [...d02Doc.directionContract.canonicalDocRefs].sort(),
  "declared document anchors do not match KGA-D02 canonicalDocRefs at the pinned commit",
);
for (const entry of declaredAnchors) {
  assert.equal(entry.isCanonicalPath, false, `${entry.ref} must not be classified as a canonical path`);
  assert.equal(entry.verifiedByDigest, false, `${entry.ref} must not claim digest verification`);
  assert.equal(entry.documentPath, entry.ref.split("#")[0], `${entry.ref} document path is inconsistent`);
  assert.ok(verifiedRefs.has(entry.documentPath), `${entry.ref} document is not verified`);
  assert.ok(docAnchors.has(entry.ref), `${entry.ref} is declared but not present in the artifact`);
}
assert.ok(!("canonicalDocRefs" in readiness.blueprint.sdkPublicBoundary), "unclassified canonicalDocRefs must not reappear");
for (const ref of recordedRefs) {
  assert.ok(verifiedRefs.has(ref), `canonical reference ${ref} is recorded but never verified`);
}
assert.equal(recordedRefs.size, verifiedRefs.size, "recorded and verified canonical reference sets differ");

// --- dependency graph: exact projection of the canonical ledger ------------------------
const graph = readiness.dependencyGraph;
assert.equal(graph.scope, "d01-33-subgraph");
assert.equal(graph.coversRelationDirectionConflicts, false);
assert.ok(!("acyclic" in graph), "unscoped acyclicity claim must not reappear");
assert.equal(graph.acyclicWithinScope, true);
const cardEdges = deck.flatMap((card) => card.predecessorEvidence.internalPredecessors.map((p) => `${card.selectedDescendantId}->${p.cardRef}`));
const graphEdges = graph.edges.map((edge) => `${edge.from}->${edge.to}`);
assert.deepEqual([...graphEdges].sort(), [...ledgerEdges].sort(), "graph edges are not the exact canonical ledger projection");
assert.deepEqual([...cardEdges].sort(), [...ledgerEdges].sort(), "card edges are not the exact canonical ledger projection");
assert.equal(graph.edgeCount, EDGE_COUNT);
assert.equal(graph.nodeCount, internalIds.size);
assert.equal(graph.externalPredecessorCount, EXTERNAL_COUNT);
assert.equal(graph.externalPredecessors.length, EXTERNAL_COUNT);
for (const edge of graph.edges) {
  assert.ok(internalIds.has(edge.from) && internalIds.has(edge.to), `edge touches an unknown node: ${edge.from}->${edge.to}`);
}
for (const external of graph.externalPredecessors) {
  assert.ok(!internalIds.has(external.nodeId), `external predecessor is internal: ${external.nodeId}`);
  verifyExternal(external, `graph external ${external.nodeId}`);
}
const capability = graph.externalPredecessors.find((p) => p.nodeId === "capability-registry-contract");
assert.ok(capability, "capability-registry-contract must be dispositioned");
assert.equal(capability.disposition, "deferred-to-pr07-pre-execution-node-rescope");
assert.equal(capability.decisionRef, "KGA-D03");
for (const other of graph.externalPredecessors.filter((p) => p.nodeId !== "capability-registry-contract")) {
  assert.equal(other.disposition, "planning-predecessor-not-evaluated-for-readiness");
}
const adjacency = new Map();
for (const edge of graph.edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
const walkState = new Map();
const walk = (node) => {
  walkState.set(node, "open");
  for (const next of adjacency.get(node) ?? []) {
    assert.notEqual(walkState.get(next), "open", `dependency cycle through ${node} -> ${next}`);
    if (walkState.get(next) === undefined) walk(next);
  }
  walkState.set(node, "done");
};
for (const node of adjacency.keys()) if (walkState.get(node) === undefined) walk(node);

// --- D07 relation-direction wording must acknowledge the overlap ----------------------
const rd = graph.relationDirectionNote;
const d07 = JSON.parse(canonicalBlob(rd.canonicalRef));
assert.equal(rd.decisionRef, "KGA-D07");
assert.equal(rd.totalConflicts, d07.conflictSplit.totalConflicts);
assert.equal(rd.unrepairedKernelEdges, d07.conflictSplit.kernelEdgesToRepair);
assert.equal(rd.edgesRepaired, d07.repairBoundary.edgesRepaired);
assert.deepEqual(rd.kernelNodeIds, d07.conflictSplit.kernelNodeIds, "D07 kernel node list drifted");
const cardParents = new Set(deck.map((card) => card.parentId));
const trueOverlap = d07.conflictSplit.kernelNodeIds.filter((id) => cardParents.has(id));
assert.deepEqual(rd.kernelNodeIdsOverlappingCardParents, trueOverlap, "recorded overlap is not the real overlap");
assert.equal(rd.overlapCount, trueOverlap.length);
assert.ok(trueOverlap.length > 0, "the overlap is real and must not be recorded as empty");
// Reject the false claim ("outside this subgraph" / "disjoint from") while allowing the
// correct negation ("not disjoint from"), which is what the note is required to say.
assert.ok(!/outside this subgraph|(?<!not )disjoint from/i.test(rd.note), "the note must not claim the conflicts are outside the subgraph");
assert.ok(rd.note.includes("not disjoint"), "the note must acknowledge the overlap explicitly");
assert.ok(/explicitly excluded/i.test(rd.note), "the note must record the exclusion as explicit");

// --- blueprint ------------------------------------------------------------------------
const blueprint = readiness.blueprint;
assert.deepEqual(blueprint.phases.map((p) => p.id), PHASES);
blueprint.phases.forEach((phase, index) => {
  assert.equal(phase.order, index + 1);
  assert.equal(phase.status, "not-started");
  assert.ok(phase.decisionRef?.length > 0);
});
assert.deepEqual(blueprint.dataPlaneOrdering.sequence, DATA_PLANE);
assert.equal(blueprint.dataPlaneOrdering.tenancy.rowLevelSecurity, "FORCE RLS");
assert.equal(blueprint.dataPlaneOrdering.tenancy.denyByDefault, true);
assert.equal(blueprint.dataPlaneOrdering.tenancy.enforced, false);
assert.equal(blueprint.dataPlaneOrdering.enforcementExecutor, "human-developer-only");
const sdk = blueprint.sdkPublicBoundary;
assert.equal(sdk.decisionRef, "KGA-D02");
assert.equal(sdk.contract, "Edition/App->SDK->Kernel");
assert.equal(sdk.scope, "governance-semantics-only");
assert.ok(sdk.provisionalContractBoundary.includes("provisional projection contract"));
assert.ok(sdk.outOfScope.length >= 4);
assert.equal(sdk.exitCeiling, "scaffold-only");
const model = blueprint.singleWriterLeaseModel;
assert.equal(model.mode, "CLAUDE_ONLY");
assert.equal(model.concurrentWriters, 1);
assert.equal(model.invocation, "visible Pane --agent claude");
assert.ok(model.invocationForbidden.includes("MCP claude_implement"));
assert.equal(model.fallbackWriter, null);

// --- writer-invocation mirror parity ---------------------------------------------------
const MIRROR = "pane-visible-agent-claude";
const agentsDoc = readFileSync(path.join(root, "AGENTS.md"), "utf8");
const bootstrapPolicy = JSON.parse(readFileSync(path.join(root, "planning/bootstrap-state.json"), "utf8")).codingPolicy;
const approvalPolicy = JSON.parse(readFileSync(path.join(root, "planning/human-decision-request.json"), "utf8")).response.codingPolicy;
assert.ok(agentsDoc.includes(MIRROR), "AGENTS.md must name the Pane writer invocation");
assert.equal(bootstrapPolicy.writer.invocation, "claude_implement", "historical bootstrap mirror drifted");
assert.equal(approvalPolicy.writer.invocation, "claude_implement", "historical approval mirror drifted");
assert.equal(bootstrapPolicy.writer.invocation, approvalPolicy.writer.invocation, "historical mirrors disagree");
assert.ok(agentsDoc.includes("claude_implement"), "AGENTS.md must still name the historical invocation");
assert.ok(/Immutable historical approval record/.test(agentsDoc), "AGENTS.md must separate the historical record");
assert.ok(/Additive current successor invocation/.test(agentsDoc), "AGENTS.md must separate the successor record");
assert.ok(!/this text and those two mirrors must always agree/.test(agentsDoc), "AGENTS.md must not claim text and mirrors are identical");
assert.equal(bootstrapPolicy.mode, "CLAUDE_ONLY");
assert.equal(bootstrapPolicy.singleActiveWriter, true);
assert.equal(bootstrapPolicy.fallbackWriter, null);
assert.equal(bootstrapPolicy.separateCodeStartAuthorityRequired, true);

// --- acceptance-surface wiring -------------------------------------------------------------
// This checker must remain reachable from npm run check, so a green run is never possible
// while it is quietly unwired.
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
const checkerRelative = "tools/check-kernel-ai-development-readiness.mjs";
assert.ok(scripts.check.includes(checkerRelative), "npm run check must invoke the readiness checker");
assert.equal(scripts["check:readiness"], `node ${checkerRelative}`, "check:readiness wiring drifted");

// --- gates and deferred risks -----------------------------------------------------------
for (const gate of readiness.unresolvedGates) {
  assert.equal(gate.status, "open");
  assert.ok(ALLOWED_GATE_IDS.has(gate.id), `${gate.id} is a deferred risk, not a candidate gate`);
}
for (const risk of readiness.deferredRisks) {
  assert.equal(risk.kind, "deferred-risk");
  assert.equal(risk.isReadinessBlocker, false);
}

// --- human-readable projection ------------------------------------------------------------
const doc = readFileSync(path.join(root, DOC), "utf8");
for (const token of ["CANDIDATE","BLOCKED","NO-GO","NO_GO","planned-not-run","visible Pane --agent claude","pane-visible-agent-claude",ACTIONPLAN_SHA,KERNEL_SHA,"bc594837225bd49b449a","66f8369293744c534dde"]) {
  assert.ok(doc.includes(token), `human-readable projection is missing ${token}`);
}
for (const forbidden of ["CI passed","tests passed","PASS:","production-ready","release-ready",root]) {
  assert.ok(!doc.includes(forbidden), `human-readable projection claims or embeds ${forbidden}`);
}

console.log(
  `readiness candidate: ${CARD_COUNT} cards / ${AXES.length} axes / ${graphEdges.length} ledger-projected edges / ` +
    `${EXTERNAL_COUNT} external refs / ${verifiedRefs.size} canonical digests verified at ${ACTIONPLAN_SHA.slice(0, 7)} / ` +
    `${plannedPathCount} planned test paths absent / D07 overlap ${trueOverlap.length}/${rd.kernelNodeIds.length} / ` +
    `${readiness.readinessStatus} / ${readiness.verdict} (kernel-local ${readiness.verdictTokenMap.kernelLocal}) / code start denied`,
);
