import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// Token guard — the deterministic, zero-model gate
//
// The economics are easy to get backwards. A governor that asks a language model whether work is
// wasteful spends tokens on every question, including the overwhelming majority whose answer was
// already settled by two file hashes and a branch name. So the split here is the design, not a
// style preference: everything decidable from facts is decided in this file at zero model cost,
// and the model is reached only where no fact can settle the matter.
//
// Three decisions, and the middle one is the point:
//
//   PASS      no model needed. Proceed.
//   ESCALATE  a fact-level check cannot settle this. Spend model tokens deliberately.
//   DENY      a fact settles it in the negative. Escalating would buy a more expensive route to
//             the same answer.
//
// DENY outranks ESCALATE for exactly that reason. A gate whose only outcomes are "fine" and "ask
// the expensive thing" is not a gate; it is a toll booth.
//
// Fail-closed in the direction that costs tokens, not in the direction that spends them. A fact
// that cannot be read produces ESCALATE — an unreadable fact is precisely when a human or a model
// should look. It must never produce PASS, and it must never produce DENY either: refusing work
// because a probe failed is how a guard becomes the outage it was meant to prevent.
//
// Structure follows the house pattern in `tools/check-versioning-changelog.mjs`: pure evaluators
// over injected facts, then one reader that turns a real tree into those facts, then a CLI behind
// an invocation guard. Importing this module reads nothing, prints nothing and asserts nothing.
//
// Limit recorded rather than papered over: an evaluator sees the facts it is handed. A caller
// that assembles facts dishonestly gets an honest answer to a dishonest question, and no amount
// of logic here can fix that. `readFacts` is what makes the production facts real.

export const PASS = "PASS";
export const ESCALATE = "ESCALATE";
export const DENY = "DENY";
const ADVISE = "ADVISE";

// The only situations that may reach a language model. Anything not on this list is either
// settled by an evaluator below or is not the governor's business.
//
// Two of these are entered by the MASTER directly rather than emitted by an evaluator here:
// `model-escalation` (no fact decides whether a task needs a larger model) and `commit-push`
// (a commit or push is classified by the promotion gate under `main-promotion`). They are
// listed because they are legitimate reasons to spend model tokens, and GUARD_EMITTED_GATES
// below records which subset this file can actually produce, so neither list can quietly
// become decoration.
export const ESCALATION_GATES = [
  "parallel-worker",
  "writer-assignment",
  "model-escalation",
  "snapshot-change",
  "commit-push",
  "main-promotion",
  "policy-anomaly",
];

// The subset an evaluator in this file can emit. Asserted against ESCALATION_GATES by the
// suite so that a gate can be master-entered on purpose but never unreachable by accident.
export const GUARD_EMITTED_GATES = [
  "parallel-worker", "writer-assignment", "snapshot-change", "main-promotion", "policy-anomaly",
];

const finding = (id, decision, message, gate) => ({ id, decision, message, gate });

const REVIEW_ROLES = new Set(["independent-reviewer", "reviewer", "auditor"]);

// An unobservable registry is not an empty one, and the difference is the whole gate. `[]` means
// "looked, found nothing"; a missing array means "could not look", and the second must escalate.
// Conflating them turns every check whose registry the reader cannot see into a silent PASS.
const unobserved = (id, name, gate) => [finding(
  id, ESCALATE,
  `${name} could not be observed; an unobservable registry is not an empty one`, gate,
)];

// -------------------------------------------------------------------------------------
// 1. Duplicate worker
// -------------------------------------------------------------------------------------

export function evaluateDuplicateWorker({ requested = {}, liveWorkers } = {}) {
  if (!requested.taskSignature) return [];
  if (!Array.isArray(liveWorkers)) return unobserved("live-workers-unobserved", "the live worker registry", "parallel-worker");
  const live = liveWorkers.filter(
    (w) => w.state === "running" && w.taskSignature === requested.taskSignature,
  );
  if (live.length === 0) return [];

  // Two reviewers on one snapshot is the point of independent review, not a duplicate — but only
  // while they look through different lenses. Same lens twice is the same answer paid for twice.
  if (REVIEW_ROLES.has(requested.role)) {
    const sameLens = live.filter(
      (w) => REVIEW_ROLES.has(w.role) && w.lens === requested.lens,
    );
    if (sameLens.length === 0) return [];
    return [finding(
      "duplicate-worker-same-lens", DENY,
      `a reviewer with lens ${requested.lens} is already running on ${requested.taskSignature}`,
      "parallel-worker",
    )];
  }

  return [finding(
    "duplicate-worker", DENY,
    `task ${requested.taskSignature} already has a running worker (${live.map((w) => w.panelId).join(", ")})`,
    "parallel-worker",
  )];
}

// -------------------------------------------------------------------------------------
// 2. Duplicate file read
// -------------------------------------------------------------------------------------

const covers = (prior, want) => {
  if (!prior.lines) return true;          // a full read covers any range of the same bytes
  if (!want.lines) return false;          // a ranged read does not cover a full read
  return prior.lines[0] <= want.lines[0] && prior.lines[1] >= want.lines[1];
};

export function evaluateDuplicateFileRead({ requested = {}, alreadyRead } = {}) {
  if (!requested.path || !requested.sha256) return [];
  if (!Array.isArray(alreadyRead)) {
    // A registry the policy says is observable but is not is a policy anomaly, and that is a
    // declared gate. An escalation reason outside ESCALATION_GATES routes to nothing.
    return unobserved("read-log-unobserved", "the session read log", "policy-anomaly");
  }
  const hit = alreadyRead.find(
    (r) => r.path === requested.path && r.sha256 === requested.sha256 && covers(r, requested),
  );
  if (!hit) return [];
  return [finding(
    "duplicate-file-read", DENY,
    `${requested.path} was already read at ${requested.sha256.slice(0, 12)} and has not changed`,
  )];
}

// -------------------------------------------------------------------------------------
// 3. Writer ownership — the single-writer invariant, mechanically
// -------------------------------------------------------------------------------------

export function evaluateWriterOwnership({ requested = {}, activeWriters } = {}) {
  if (!requested.changePackage) return [];
  if (!Array.isArray(activeWriters)) return unobserved("writer-registry-unobserved", "the active writer registry", "writer-assignment");
  const onPackage = activeWriters.filter((w) => w.changePackage === requested.changePackage);
  if (onPackage.length === 0) return [];

  if (requested.role === "writer") {
    const others = onPackage.filter((w) => w.sessionId !== requested.sessionId);
    if (others.length === 0) return [];
    return [finding(
      "single-writer-violation", DENY,
      `${requested.changePackage} already has an active writer (${others[0].sessionId})`,
      "writer-assignment",
    )];
  }

  if (REVIEW_ROLES.has(requested.role)) {
    const self = onPackage.find((w) => w.sessionId === requested.sessionId);
    if (!self) return [];
    return [finding(
      "self-review-violation", DENY,
      `session ${requested.sessionId} wrote ${requested.changePackage} and may not review it`,
      "writer-assignment",
    )];
  }

  return [finding(
    "requester-role-unclassified", ESCALATE,
    `${requested.changePackage} has an active writer and the requested role ` +
    `${JSON.stringify(requested.role)} is neither writer nor reviewer`,
    "writer-assignment",
  )];
}

// -------------------------------------------------------------------------------------
// 4. Dirty snapshot
// -------------------------------------------------------------------------------------

export function evaluateDirtySnapshot({ requested = {}, worktrees } = {}) {
  if (!requested.worktree) return [];
  if (requested.role === "writer") return [];
  if (!REVIEW_ROLES.has(requested.role)) {
    return [finding("snapshot-role-unclassified", ESCALATE,
      `role ${JSON.stringify(requested.role)} is not classified, so snapshot cleanliness cannot be judged`,
      "snapshot-change")];
  }
  if (!Array.isArray(worktrees)) return unobserved("worktrees-unobserved", "the worktree set", "snapshot-change");
  const wt = worktrees.find((w) => w.path === requested.worktree);
  if (!wt) {
    return [finding(
      "dirty-snapshot-unknown", ESCALATE,
      `worktree ${requested.worktree} is not in the observed set`,
      "snapshot-change",
    )];
  }
  if (wt.dirty === false) return [];
  if (wt.dirty !== true) {
    // git status failed on a pruned, missing or unreadable worktree. Falsy is not clean.
    return [finding("dirty-snapshot-unreadable", ESCALATE,
      `cleanliness of ${requested.worktree} could not be determined`, "snapshot-change")];
  }
  return [finding(
    "dirty-snapshot", DENY,
    `${requested.worktree} has uncommitted changes; a review on a moving tree proves nothing`,
    "snapshot-change",
  )];
}

// -------------------------------------------------------------------------------------
// 5. Branch and worktree collision
// -------------------------------------------------------------------------------------

export function evaluateBranchWorktreeCollision({ requested = {}, worktrees } = {}) {
  if (!requested.branch) return [];
  if (!Array.isArray(worktrees)) {
    return unobserved("worktrees-unobserved-branch", "the worktree set", "policy-anomaly");
  }
  const elsewhere = worktrees.filter(
    (w) => w.branch === requested.branch && w.path !== requested.worktree,
  );
  if (elsewhere.length === 0) return [];
  return [finding(
    "branch-worktree-collision", DENY,
    `branch ${requested.branch} is already checked out at ${elsewhere[0].path}`,
  )];
}

// -------------------------------------------------------------------------------------
// 6. Guardian admission — read the decision, never re-derive it from raw numbers
// -------------------------------------------------------------------------------------

export function evaluateGuardianAdmission({ requested = {}, guardian } = {}) {
  if (!requested.opensWorker) return [];
  if (!guardian || typeof guardian.allowNewWorker !== "boolean") {
    return [finding(
      "guardian-unreadable", ESCALATE,
      "guardian admission could not be read; an unreadable resource decision is not a pass",
      "parallel-worker",
    )];
  }
  if (guardian.allowNewWorker === false) {
    return [finding(
      "guardian-blocked", DENY,
      `guardian reports allowNewWorker=false (mode ${guardian.mode})`,
      "parallel-worker",
    )];
  }
  const want = requested.requestedWorkerCount ?? 1;
  const cap = guardian.recommendedNewWorkers ?? 1;
  if (want > cap) {
    return [finding(
      "guardian-over-cap", ESCALATE,
      `${want} workers requested against a recommended ceiling of ${cap}`,
      "parallel-worker",
    )];
  }
  return [];
}

// -------------------------------------------------------------------------------------
// 7. Stale review
// -------------------------------------------------------------------------------------

export function evaluateStaleReview({ requested = {}, reviews, currentSnapshot } = {}) {
  if (!requested.useReviewFrom) return [];
  if (!Array.isArray(reviews)) return unobserved("review-registry-unobserved", "the review registry", "snapshot-change");
  const review = reviews.find((r) => r.id === requested.useReviewFrom);
  if (!review) {
    return [finding("stale-review-unknown", ESCALATE,
      `review ${requested.useReviewFrom} was not found`, "snapshot-change")];
  }
  // Both absent used to compare equal, so a review with no recorded snapshot against a repo
  // whose HEAD could not be read reported "still valid". Two unknowns are not a match.
  if (typeof review.snapshot !== "string" || typeof currentSnapshot !== "string") {
    return [finding("stale-review-unverifiable", ESCALATE,
      `review ${review.id} cannot be checked: snapshot=${JSON.stringify(review.snapshot)}, `
      + `current=${JSON.stringify(currentSnapshot)}`, "snapshot-change")];
  }
  if (review.snapshot === currentSnapshot) return [];
  return [finding(
    "stale-review", DENY,
    `review ${review.id} was taken on ${review.snapshot} and the tree is now ${currentSnapshot}`,
    "snapshot-change",
  )];
}

// -------------------------------------------------------------------------------------
// 8. Commit / push / promotion gate
// -------------------------------------------------------------------------------------

const PROMOTION_ACTIONS = new Set(["commit", "push", "main-promotion"]);

// Any of these on a request means git is about to be mutated, whatever the caller decided to
// call the action. Without this, the single free gate on main promotion was armed by a string
// the caller controls: `{forcePush: true}` with no `action` skipped the whole evaluator, force
// push included. An unclassified mutation intent now escalates instead of passing.
const MUTATION_SIGNALS = [
  "forcePush", "commitToMain", "commit", "push", "merge", "promote", "release", "tag", "rebase",
];

// Classification by allowlist, not by blacklist.
//
// A pattern over mutation words under-matched `push --force`, `cherry-pick`, `reset --hard`
// and `git_merge`, and over-matched `git-status` and `git-log` into a model call apiece. Both
// directions are inherent to guessing from a word list: a blacklist is only as good as the
// vocabulary its author happened to think of, and this one gates main promotion.
//
// So actions known to mutate nothing are enumerated, promotion actions are enumerated, and
// anything else escalates. An unrecognised action costs one model call and a one-line
// addition here; an unrecognised action that passed cost a bypass of the only free gate on
// main promotion, three review rounds running.
const NON_MUTATING_ACTIONS = new Set([
  "read", "edit", "write", "analyze", "analyse", "review", "inventory", "search", "grep",
  "plan", "test", "check", "verify", "open-worker", "close-worker", "status", "report",
  // Read-only git verbs. Added the moment review showed them escalating: the allowlist is meant
  // to grow by one line per genuinely safe action, which is the cost of refusing to guess.
  "git-status", "git-log", "git-diff", "git-blame", "git-show", "fetch", "ls", "list",
]);

// Signals are boolean flags. Requiring `=== true` keeps incidental metadata — `tag: "v1.2.3"`
// on a read, `merge: "no"` — from taxing an ordinary request with a model call.
const carriesMutationIntent = (requested) =>
  MUTATION_SIGNALS.some((k) => requested[k] === true);

// null when the action says nothing either way (absent), true when it is known safe.
const actionIsKnownSafe = (action) =>
  action === undefined || action === null
    ? null
    : typeof action === "string" && NON_MUTATING_ACTIONS.has(action.trim().toLowerCase());

const REQUIRED_GATES = [
  "correctWorktree", "cleanBase", "originFetched", "noConflict",
  "targetedTestsGreen", "fullCheckGreen", "independentReviewGreen",
  "writerDidNotSelfReview", "readmeCurrent", "changelogCurrent",
  "versionParityGreen", "rollbackShaReady", "noPublicApiBreak",
  "noProductionDeployment", "noSecret",
];

export function evaluatePromotionGate({ requested = {}, gates } = {}) {
  const out = [];

  // Checked before anything else and outside every action guard. Nothing on the gate list can
  // make a force push acceptable, and a check that only runs when the caller names the action
  // correctly is a check the caller can switch off by choosing a different word.
  // `=== true` for the denial, and anything else truthy escalates rather than denying. The
  // same string metadata that must not tax a read (`tag: "v1.2.3"`) must not hard-deny one
  // either, and the two branches previously disagreed about that.
  if (requested.forcePush === true) {
    out.push(finding("force-push-forbidden", DENY,
      "force push is not within MASTER authority under any gate state", "main-promotion"));
  } else if (requested.forcePush) {
    out.push(finding("force-push-unclassified", ESCALATE,
      `forcePush is ${JSON.stringify(requested.forcePush)} rather than a boolean`,
      "main-promotion"));
  }

  const named = PROMOTION_ACTIONS.has(requested.action);
  if (!named) {
    // An unnamed action that nevertheless carries mutation intent, or arrives with a gate report
    // attached, is a promotion in everything but its label. It escalates rather than passing.
    // A gate report only implies a promotion when it actually carries gates. An empty or
    // null slot attached uniformly by a caller must not buy a model call on every read.
    const reportsGates =
      gates !== null && typeof gates === "object" && Object.keys(gates).length > 0;
    const safe = actionIsKnownSafe(requested.action);
    if (carriesMutationIntent(requested) || reportsGates || safe === false) {
      out.push(finding("promotion-intent-unclassified", ESCALATE,
        `action ${JSON.stringify(requested.action)} is neither a recognised promotion action `
        + `nor on the non-mutating list; promotion actions are `
        + `${[...PROMOTION_ACTIONS].join(", ")}`, "main-promotion"));
    }
    return out;
  }

  if (gates === null || typeof gates !== "object") {
    out.push(finding("promotion-gates-unreadable", ESCALATE,
      "a promotion was requested with no readable gate report", "main-promotion"));
    return out;
  }

  for (const key of REQUIRED_GATES) {
    if (!(key in gates)) {
      out.push(finding(`promotion-gate-unknown:${key}`, ESCALATE,
        `gate ${key} was not reported; an unreported gate is not a green gate`, "main-promotion"));
    } else if (gates[key] !== true) {
      out.push(finding(`promotion-gate-failed:${key}`, DENY,
        `gate ${key} is not green`, "main-promotion"));
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------
// 9. Completed panel cleanup
// -------------------------------------------------------------------------------------

export function evaluateCompletedPanelCleanup({ panels } = {}) {
  if (!Array.isArray(panels)) {
    return [finding("panel-registry-unobserved", ADVISE, "the panel registry could not be observed")];
  }
  const leaked = panels.filter((p) => p.state === "completed" && p.open);
  if (leaked.length === 0) return [];
  return [finding(
    "panel-cleanup-pending", ADVISE,
    `${leaked.length} completed panel(s) still open: ${leaked.map((p) => p.panelId).join(", ")}`,
  )];
}

// -------------------------------------------------------------------------------------
// Composition
// -------------------------------------------------------------------------------------

export function decide(facts = {}) {
  const findings = [
    ...evaluateDuplicateWorker(facts),
    ...evaluateDuplicateFileRead(facts),
    ...evaluateWriterOwnership(facts),
    ...evaluateDirtySnapshot(facts),
    ...evaluateBranchWorktreeCollision(facts),
    ...evaluateGuardianAdmission(facts),
    ...evaluateStaleReview(facts),
    ...evaluatePromotionGate(facts),
    ...evaluateCompletedPanelCleanup(facts),
  ];

  const decision = findings.some((f) => f.decision === DENY)
    ? DENY
    : findings.some((f) => f.decision === ESCALATE)
      ? ESCALATE
      : PASS;

  const escalationReasons = decision === ESCALATE
    ? [...new Set(findings.filter((f) => f.decision === ESCALATE).map((f) => f.gate ?? f.id))]
    : [];

  return {
    decision,
    findings,
    escalationReasons,
    // The number the ledger is built on. A PASS or a DENY costs nothing; only ESCALATE buys a
    // model call, and that is the whole claim this package makes about its own economics.
    modelCallsRequired: decision === ESCALATE ? 1 : 0,
  };
}

// -------------------------------------------------------------------------------------
// Governor economics — it pays for itself or it switches itself off
// -------------------------------------------------------------------------------------

export function evaluateGovernorEconomics({ ledger = {}, policy = {} } = {}) {
  const spent = ledger.tokensSpent ?? 0;
  const saved = ledger.tokensSaved ?? 0;
  const netSaving = saved - spent;
  const invocations = ledger.invocations;
  const minInvocations = policy.minimumInvocations ?? 5;
  const minNet = policy.minimumNetSaving ?? 0;

  // A ledger with no invocation count cannot support the "not enough evidence yet" branch, and
  // defaulting it to 0 made that branch permanent: any net cost stayed enabled forever because
  // 0 is always below the minimum. An unusable ledger fails closed toward NOT spending tokens.
  if (typeof invocations !== "number" || !Number.isFinite(invocations) || invocations < 0) {
    return {
      netSaving, invocations: null, deterministicGateEnabled: true,
      autoInvocationEnabled: false,
      reason: "ledger carries no usable invocation count; automatic invocation stays off until it does",
    };
  }

  // The deterministic gate is free and is never part of this judgement. Only the model-backed
  // governor can be switched off, and switching it off must not quietly remove the checks that
  // were carrying most of the weight anyway.
  const base = { netSaving, invocations, deterministicGateEnabled: true };

  if (invocations < minInvocations) {
    return {
      ...base, autoInvocationEnabled: true,
      reason: `insufficient evidence: ${invocations} invocation(s) against a minimum of ${minInvocations}`,
    };
  }
  const enabled = netSaving > minNet;
  return {
    ...base,
    autoInvocationEnabled: enabled,
    reason: enabled
      ? `net saving ${netSaving} tokens over ${invocations} invocation(s)`
      : `net cost ${-netSaving} tokens over ${invocations} invocation(s); automatic invocation disabled`,
  };
}

// -------------------------------------------------------------------------------------
// Reader — the only part that touches a real tree
// -------------------------------------------------------------------------------------

const git = (args, cwd = root) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

export function readWorktrees(repo = root) {
  const raw = git(["worktree", "list", "--porcelain"], repo);
  if (raw === null) return null;
  const out = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = { path: line.slice(9), branch: null, head: null, dirty: null };
    } else if (line.startsWith("HEAD ") && cur) {
      cur.head = line.slice(5);
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    }
  }
  if (cur) out.push(cur);
  for (const w of out) {
    const status = git(["status", "--porcelain"], w.path);
    w.dirty = status === null ? null : status.length > 0;
  }
  return out;
}

// Thresholds come from the canonical policy, never from whoever called the CLI. A governor
// that reads its own pass mark out of its caller's arguments is not measuring anything.
export function readPolicyEconomics(repo = root) {
  try {
    const doc = JSON.parse(readFileSync(path.join(repo, "token-economy-policy.json"), "utf8"));
    return doc.governor?.economics ?? null;
  } catch {
    return null;
  }
}

export function readLedger(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readGuardian() {
  try {
    const raw = execFileSync("guardianctl", ["admission", "--json"], { encoding: "utf8" });
    return JSON.parse(raw);
  } catch {
    // Deliberately not a throw. An unreadable guardian is an ESCALATE upstream, never a PASS and
    // never a DENY, and that distinction is lost if this becomes an exception.
    return null;
  }
}

export function readFacts(requested = {}, { repo = root } = {}) {
  return {
    requested,
    // null when git itself could not be read. Coercing to [] here reopened exactly the
    // defect this file spends thirty lines forbidding, one registry short of the five it
    // had just fixed.
    worktrees: readWorktrees(repo),
    guardian: readGuardian(),
    // null, not []. This reader can see git; it cannot see the session read log, the live worker
    // registry, writer ownership, prior reviews or open panels — those live in the orchestration
    // layer and must be supplied by the caller through --facts. Handing back empty arrays would
    // have reported "looked, found nothing" for five checks that were never performed, which is
    // exactly the silent PASS this file spends thirty lines forbidding.
    alreadyRead: null, liveWorkers: null, activeWriters: null, reviews: null, panels: null,
    currentSnapshot: git(["rev-parse", "HEAD"], repo),
  };
}

// -------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------

function economicsCommand(argv) {
  const arg = argv.find((a) => a.startsWith("--ledger="));
  const file = arg ? arg.slice(9) : path.join(root, "token-economy-ledger.json");
  const ledger = readLedger(file);
  if (ledger === null) {
    console.error(`token-guard economics: ledger not readable: ${file}`);
    return 2;
  }
  const policy = readPolicyEconomics();
  if (policy === null) {
    console.error("token-guard economics: canonical policy thresholds not readable");
    return 2;
  }
  const verdict = evaluateGovernorEconomics({ ledger, policy });
  process.stdout.write(JSON.stringify({ ledgerFile: file, ...verdict }, null, 2) + "\n");
  return verdict.autoInvocationEnabled ? 0 : 5;
}

function main(argv) {
  if (argv[0] === "economics") return economicsCommand(argv.slice(1));
  const jsonArg = argv.find((a) => a.startsWith("--facts="));
  let facts;
  if (jsonArg) {
    const file = jsonArg.slice(8);
    if (!existsSync(file)) {
      console.error(`token-guard: facts file not found: ${file}`);
      return 2;
    }
    facts = JSON.parse(readFileSync(file, "utf8"));
  } else {
    const req = argv.find((a) => a.startsWith("--request="));
    facts = readFacts(req ? JSON.parse(req.slice(10)) : {});
  }
  const result = decide(facts);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.decision === DENY ? 3 : result.decision === ESCALATE ? 4 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
