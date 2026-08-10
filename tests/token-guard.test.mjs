import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardUrl = pathToFileURL(path.join(root, "tools", "token-guard.mjs")).href;

// =====================================================================================
// Token guard — the frozen RED specification for the deterministic, zero-LLM gate
//
// The economics this package exists for are simple and easy to get backwards. A governor that
// asks a language model whether work is wasteful costs tokens on every question, including the
// overwhelming majority of questions whose answer was already determined by two file hashes and
// a branch name. So the split asserted here is not a style preference: everything decidable from
// facts is decided in this file's evaluators at zero model cost, and the model is reached only
// where a fact cannot settle the matter.
//
// The evaluators are pure. They take facts and return findings, they read nothing, and they never
// print. That is what makes the adversarial rows below possible without creating a worktree, a
// panel or a git repository anywhere, and it is why a false accusation is cheap to disprove.
//
// Three decisions, and the middle one is the whole design:
//
//   PASS      nothing here needs a model. Proceed.
//   ESCALATE  a fact-level check cannot settle this. Spend model tokens deliberately.
//   DENY      a fact settles it in the negative. Spending model tokens would only produce a
//             more expensive way to reach the same answer.
//
// DENY is asserted to be reachable without ESCALATE. A gate whose only two outcomes are "fine"
// and "ask the expensive thing" is not a gate; it is a toll booth.
//
// Fail-closed in the direction that costs tokens, not in the direction that spends them. Facts
// that cannot be read produce an ESCALATE and never a silent PASS, because an unreadable fact is
// exactly the case where a human or a model should look. But an unreadable fact must not produce
// DENY either: refusing work because a probe failed is how a guard becomes the outage.
//
// One limit, recorded rather than papered over: these evaluators see the facts they are handed.
// A caller that assembles facts dishonestly gets an honest answer to a dishonest question. The
// reader in `tools/token-guard.mjs` is what makes the production facts real, and it is tested
// separately against a real tree.

const PASS = "PASS";
const ESCALATE = "ESCALATE";
const DENY = "DENY";

let guard;
test("token-guard module loads", async () => {
  guard = await import(guardUrl);
});

// -------------------------------------------------------------------------------------
// 1. Duplicate worker — the single most expensive mistake this gate can prevent
// -------------------------------------------------------------------------------------

test("duplicate worker: an identical live task signature is denied, not escalated", () => {
  const findings = guard.evaluateDuplicateWorker({
    requested: { taskSignature: "p00-r1-marker-scanner", model: "opus" },
    liveWorkers: [{ taskSignature: "p00-r1-marker-scanner", panelId: "a", state: "running" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
  assert.match(findings[0].id, /duplicate-worker/);
});

test("duplicate worker: a finished worker with the same signature does not block a rerun", () => {
  const findings = guard.evaluateDuplicateWorker({
    requested: { taskSignature: "p00-r1-marker-scanner" },
    liveWorkers: [{ taskSignature: "p00-r1-marker-scanner", panelId: "a", state: "completed" }],
  });
  assert.deepEqual(findings, []);
});

test("duplicate worker: a deliberate independent review is allowed to duplicate the signature", () => {
  // Two reviewers on the same snapshot is the point of independent review, not a duplicate.
  const findings = guard.evaluateDuplicateWorker({
    requested: { taskSignature: "p00-review", role: "independent-reviewer", lens: "security" },
    liveWorkers: [{ taskSignature: "p00-review", role: "independent-reviewer", lens: "architecture", state: "running" }],
  });
  assert.deepEqual(findings, []);
});

test("duplicate worker: two reviewers with the SAME lens are still a duplicate", () => {
  const findings = guard.evaluateDuplicateWorker({
    requested: { taskSignature: "p00-review", role: "independent-reviewer", lens: "security" },
    liveWorkers: [{ taskSignature: "p00-review", role: "independent-reviewer", lens: "security", state: "running" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

// -------------------------------------------------------------------------------------
// 2. Duplicate file read
// -------------------------------------------------------------------------------------

test("duplicate file read: same path at the same hash is denied", () => {
  const findings = guard.evaluateDuplicateFileRead({
    requested: { path: "src/kernel.ts", sha256: "abc" },
    alreadyRead: [{ path: "src/kernel.ts", sha256: "abc" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

test("duplicate file read: same path at a CHANGED hash is not a duplicate", () => {
  const findings = guard.evaluateDuplicateFileRead({
    requested: { path: "src/kernel.ts", sha256: "def" },
    alreadyRead: [{ path: "src/kernel.ts", sha256: "abc" }],
  });
  assert.deepEqual(findings, []);
});

test("duplicate file read: a narrower line range of an already-read file is not a duplicate", () => {
  const findings = guard.evaluateDuplicateFileRead({
    requested: { path: "a.ts", sha256: "abc", lines: [100, 140] },
    alreadyRead: [{ path: "a.ts", sha256: "abc", lines: [1, 40] }],
  });
  assert.deepEqual(findings, []);
});

// -------------------------------------------------------------------------------------
// 3. Writer ownership — the single-writer invariant, mechanically
// -------------------------------------------------------------------------------------

test("writer ownership: a second writer on the same change package is denied", () => {
  const findings = guard.evaluateWriterOwnership({
    requested: { changePackage: "cp-1", role: "writer", sessionId: "s2" },
    activeWriters: [{ changePackage: "cp-1", sessionId: "s1" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
  assert.match(findings[0].id, /single-writer/);
});

test("writer ownership: writers on different change packages do not collide", () => {
  const findings = guard.evaluateWriterOwnership({
    requested: { changePackage: "cp-2", role: "writer", sessionId: "s2" },
    activeWriters: [{ changePackage: "cp-1", sessionId: "s1" }],
  });
  assert.deepEqual(findings, []);
});

test("writer ownership: the writer of a package may not also review it", () => {
  const findings = guard.evaluateWriterOwnership({
    requested: { changePackage: "cp-1", role: "independent-reviewer", sessionId: "s1" },
    activeWriters: [{ changePackage: "cp-1", sessionId: "s1" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
  assert.match(findings[0].id, /self-review/);
});

// -------------------------------------------------------------------------------------
// 4. Dirty snapshot and 7. stale review — the same fact, two consequences
// -------------------------------------------------------------------------------------

test("dirty snapshot: review requested on a dirty tree is denied", () => {
  const findings = guard.evaluateDirtySnapshot({
    requested: { role: "independent-reviewer", worktree: "/w" },
    worktrees: [{ path: "/w", dirty: true, head: "aaa" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

test("dirty snapshot: a WRITER on a dirty tree is expected, not a finding", () => {
  const findings = guard.evaluateDirtySnapshot({
    requested: { role: "writer", worktree: "/w" },
    worktrees: [{ path: "/w", dirty: true, head: "aaa" }],
  });
  assert.deepEqual(findings, []);
});

test("stale review: a verdict bound to a superseded head is denied reuse", () => {
  const findings = guard.evaluateStaleReview({
    requested: { changePackage: "cp-1", useReviewFrom: "r1" },
    reviews: [{ id: "r1", changePackage: "cp-1", snapshot: "aaa", verdict: "ACCEPT" }],
    currentSnapshot: "bbb",
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
  assert.match(findings[0].id, /stale-review/);
});

test("stale review: a verdict on the current snapshot is reusable", () => {
  const findings = guard.evaluateStaleReview({
    requested: { changePackage: "cp-1", useReviewFrom: "r1" },
    reviews: [{ id: "r1", changePackage: "cp-1", snapshot: "aaa", verdict: "ACCEPT" }],
    currentSnapshot: "aaa",
  });
  assert.deepEqual(findings, []);
});

// -------------------------------------------------------------------------------------
// 5. Branch and worktree collision
// -------------------------------------------------------------------------------------

test("branch collision: a branch already checked out in another worktree is denied", () => {
  const findings = guard.evaluateBranchWorktreeCollision({
    requested: { branch: "feature/x", worktree: "/new" },
    worktrees: [{ path: "/old", branch: "feature/x", head: "aaa" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

test("branch collision: reusing the SAME worktree for its own branch is fine", () => {
  const findings = guard.evaluateBranchWorktreeCollision({
    requested: { branch: "feature/x", worktree: "/old" },
    worktrees: [{ path: "/old", branch: "feature/x", head: "aaa" }],
  });
  assert.deepEqual(findings, []);
});

// -------------------------------------------------------------------------------------
// 6. Guardian admission — read the decision, never re-derive it from raw numbers
// -------------------------------------------------------------------------------------

test("guardian: allowNewWorker=false denies a new worker", () => {
  const findings = guard.evaluateGuardianAdmission({
    requested: { opensWorker: true },
    guardian: { allowNewWorker: false, mode: "CRITICAL", recommendedNewWorkers: 0 },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

test("guardian: exceeding recommendedNewWorkers escalates rather than denying", () => {
  const findings = guard.evaluateGuardianAdmission({
    requested: { opensWorker: true, requestedWorkerCount: 3 },
    guardian: { allowNewWorker: true, mode: "GUARDED", recommendedNewWorkers: 1 },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, ESCALATE);
});

test("guardian: a WARN-only guardian does not block", () => {
  const findings = guard.evaluateGuardianAdmission({
    requested: { opensWorker: true, requestedWorkerCount: 1 },
    guardian: { allowNewWorker: true, mode: "NORMAL", recommendedNewWorkers: 3, warn: ["swap 95%"] },
  });
  assert.deepEqual(findings, []);
});

test("guardian: an unreadable admission object escalates and never silently passes", () => {
  const findings = guard.evaluateGuardianAdmission({
    requested: { opensWorker: true },
    guardian: null,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, ESCALATE);
});

// -------------------------------------------------------------------------------------
// 8. Commit / push / promotion gate
// -------------------------------------------------------------------------------------

const greenGates = {
  correctWorktree: true, cleanBase: true, originFetched: true, noConflict: true,
  targetedTestsGreen: true, fullCheckGreen: true, independentReviewGreen: true,
  writerDidNotSelfReview: true, readmeCurrent: true, changelogCurrent: true,
  versionParityGreen: true, rollbackShaReady: true, noPublicApiBreak: true,
  noProductionDeployment: true, noSecret: true,
};

test("promotion: every gate green passes without spending a model token", () => {
  const findings = guard.evaluatePromotionGate({
    requested: { action: "main-promotion" }, gates: greenGates,
  });
  assert.deepEqual(findings, []);
});

test("promotion: a failing test gate denies promotion", () => {
  const findings = guard.evaluatePromotionGate({
    requested: { action: "main-promotion" },
    gates: { ...greenGates, targetedTestsGreen: false },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, DENY);
});

test("promotion: a secret in the change package denies promotion", () => {
  const findings = guard.evaluatePromotionGate({
    requested: { action: "main-promotion" }, gates: { ...greenGates, noSecret: false },
  });
  assert.equal(findings[0].decision, DENY);
});

test("promotion: an unknown gate value escalates instead of assuming green", () => {
  const gates = { ...greenGates };
  delete gates.rollbackShaReady;
  const findings = guard.evaluatePromotionGate({ requested: { action: "main-promotion" }, gates });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, ESCALATE);
});

test("promotion: force push is denied regardless of how green everything else is", () => {
  const findings = guard.evaluatePromotionGate({
    requested: { action: "main-promotion", forcePush: true }, gates: greenGates,
  });
  assert.ok(findings.some((f) => f.decision === DENY && /force-push/.test(f.id)));
});

// -------------------------------------------------------------------------------------
// 9. Completed panel cleanup
// -------------------------------------------------------------------------------------

test("panel cleanup: a completed panel left open is reported", () => {
  const findings = guard.evaluateCompletedPanelCleanup({
    panels: [{ panelId: "p1", state: "completed", open: true }],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].id, /panel-cleanup/);
});

test("panel cleanup: a running panel is not a leak", () => {
  const findings = guard.evaluateCompletedPanelCleanup({
    panels: [{ panelId: "p1", state: "running", open: true }],
  });
  assert.deepEqual(findings, []);
});

// -------------------------------------------------------------------------------------
// decide() — composition, and the escalation surface
// -------------------------------------------------------------------------------------

test("decide: a clean request passes with zero escalation reasons", () => {
  const r = guard.decide({
    requested: { action: "read", path: "a.ts", sha256: "x" },
    alreadyRead: [], liveWorkers: [], activeWriters: [], worktrees: [], reviews: [],
    panels: [], guardian: { allowNewWorker: true, mode: "NORMAL", recommendedNewWorkers: 3 },
  });
  assert.equal(r.decision, PASS);
  assert.deepEqual(r.escalationReasons, []);
});

test("decide: any DENY finding makes the whole decision DENY", () => {
  const r = guard.decide({
    requested: { action: "read", path: "a.ts", sha256: "x" },
    alreadyRead: [{ path: "a.ts", sha256: "x" }],
    liveWorkers: [], activeWriters: [], worktrees: [], reviews: [], panels: [],
    guardian: { allowNewWorker: true, mode: "NORMAL", recommendedNewWorkers: 3 },
  });
  assert.equal(r.decision, DENY);
});

test("decide: DENY outranks ESCALATE, so a settled negative never costs a model call", () => {
  const r = guard.decide({
    requested: { action: "open-worker", taskSignature: "t", opensWorker: true, requestedWorkerCount: 9 },
    liveWorkers: [{ taskSignature: "t", state: "running" }],
    alreadyRead: [], activeWriters: [], worktrees: [], reviews: [], panels: [],
    guardian: { allowNewWorker: true, mode: "GUARDED", recommendedNewWorkers: 1 },
  });
  assert.equal(r.decision, DENY);
});

test("decide: the declared escalation gates are the only ones that reach the model", () => {
  const gates = guard.ESCALATION_GATES;
  assert.ok(Array.isArray(gates) && gates.length > 0);
  for (const g of ["parallel-worker", "writer-assignment", "model-escalation",
                   "snapshot-change", "commit-push", "main-promotion", "policy-anomaly"]) {
    assert.ok(gates.includes(g), `missing declared escalation gate: ${g}`);
  }
});

test("decide: an ordinary small task never reaches the model", () => {
  // The claim the whole package rests on. If a plain edit escalates, the governor is a tax.
  const r = guard.decide({
    requested: { action: "edit", changePackage: "cp-1", role: "writer", sessionId: "s1",
                 worktree: "/w", path: "a.ts", sha256: "new" },
    worktrees: [{ path: "/w", dirty: true, branch: "b", head: "aaa" }],
    activeWriters: [{ changePackage: "cp-1", sessionId: "s1" }],
    alreadyRead: [], liveWorkers: [], reviews: [], panels: [],
    guardian: { allowNewWorker: true, mode: "NORMAL", recommendedNewWorkers: 3 },
  });
  assert.equal(r.decision, PASS);
  assert.equal(r.modelCallsRequired, 0);
});

// -------------------------------------------------------------------------------------
// Governor economics — the governor must pay for itself or switch itself off
// -------------------------------------------------------------------------------------

test("economics: a net-positive governor stays on", () => {
  const e = guard.evaluateGovernorEconomics({
    ledger: { invocations: 10, tokensSpent: 12_000, tokensSaved: 90_000 },
    policy: { minimumInvocations: 5, minimumNetSaving: 0 },
  });
  assert.equal(e.autoInvocationEnabled, true);
  assert.equal(e.netSaving, 78_000);
});

test("economics: a net-negative governor disables its own automatic invocation", () => {
  const e = guard.evaluateGovernorEconomics({
    ledger: { invocations: 10, tokensSpent: 90_000, tokensSaved: 12_000 },
    policy: { minimumInvocations: 5, minimumNetSaving: 0 },
  });
  assert.equal(e.autoInvocationEnabled, false);
  assert.ok(e.netSaving < 0);
});

test("economics: too few invocations to judge keeps it on and says so", () => {
  const e = guard.evaluateGovernorEconomics({
    ledger: { invocations: 2, tokensSpent: 9_000, tokensSaved: 0 },
    policy: { minimumInvocations: 5, minimumNetSaving: 0 },
  });
  assert.equal(e.autoInvocationEnabled, true);
  assert.match(e.reason, /insufficient/i);
});

test("economics: disabling automatic invocation never disables the deterministic gate", () => {
  const e = guard.evaluateGovernorEconomics({
    ledger: { invocations: 50, tokensSpent: 500_000, tokensSaved: 1 },
    policy: { minimumInvocations: 5, minimumNetSaving: 0 },
  });
  assert.equal(e.autoInvocationEnabled, false);
  assert.equal(e.deterministicGateEnabled, true);
});
