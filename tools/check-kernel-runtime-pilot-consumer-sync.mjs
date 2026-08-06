#!/usr/bin/env node
// Fail-closed oracle for the current-authority consumer-sync overlay.
//
// Two rules shape this file. First, nothing the overlay says about where to look is trusted:
// a local Actionplan checkout is a discovery hint whose origin identity and exact commit
// object are validated before a single byte is read, and no mutable ref such as main is
// required to equal or contain that commit. Second, digests alone never suffice: the pinned
// canonical blobs are parsed and their content cross-bound against the overlay, so a forged
// overlay matched by a forged contract still fails.
//
// Importing this module has no side effects; the CLI runs only under the main guard at the end.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OVERLAY_PATH = "planning/kernel-runtime-pilot-consumer-sync.json";

// --- pinned identity ---------------------------------------------------------------------
// Every constant below is pinned here rather than read from the overlay, so the overlay can
// never vouch for itself.
export const ACTIONPLAN_REPO = "karacaismail/actionplan";
export const ACTIONPLAN_REMOTE = "git@github.com:karacaismail/actionplan.git";
export const ACTIONPLAN_SHA = "811505b0229705cf39edbf0d6b60248c46a72091";
export const AUTHORITY_ANCHOR_SHA = "673a23c3093cf254d9d59b5c109f065f93416d29";
export const HISTORICAL_ACTIONPLAN_SHA = "7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d";
export const KERNEL_SHA = "f62dc8e8cbacaa510aea1187212dc7171cbffa0a";

export const CONTRACT_REF = "reports/kernel-runtime-pilot-promotion-contract-2026-08-06.json";
export const CONTRACT_SHA256 = "ba7e5bcc36899681d840e5f4d28e859693354440c45e26eee9a6595593eb3a8f";
export const CHAIN_REF = "reports/kernel-effective-authority-chain-2026-07-31.json";
export const CHAIN_SHA256 = "5d060052f2769dd32ff15d9fc79e3790d6bbaf8e456b7517c72fd87bef147794";
export const STATE_REF = "reports/kernel-governance-application-state-2026-08-01.json";
export const STATE_SHA256 = "9f6f3989fbc2d61cf5f9fa23ab89eeaf77831bf8c441cc0ff1c3fc9599fc1be4";

export const GATE_SET_SHA256 = "3f8c98150e66d2e9b4ea4f453eff58045fc0c16d069a4fa8d0f5d1650881b4f6";
// The frozen gate set: ten [order, id, definition] triples, this order, permanently.
export const GATE_DEFINITIONS = [
  [1, "GRP-01", "authority/consumer sync"],
  [2, "GRP-02", "contract, dependency and Onion boundary lock"],
  [3, "GRP-03", "one pilot app/module/archetype scope"],
  [4, "GRP-04", "baseline, SLO, RTO, RPO"],
  [5, "GRP-05", "PostgreSQL, RLS, transaction, outbox, audit baseline"],
  [6, "GRP-06", "typed action/envelope, PDP, primitive contracts"],
  [7, "GRP-07", "generated SDK"],
  [8, "GRP-08", "golden-slice end-to-end evidence"],
  [9, "GRP-09", "security, rollback, independent verification"],
  [10, "GRP-10", "atomic promotion and human countersign"],
];
export const GATE_IDS = GATE_DEFINITIONS.map(([, id]) => id);
export const CLASSIFICATIONS = ["existing-gate-evidence", "post-pilot-backlog", "production-blocker"];

export const CURRENT_VERDICT = "GO-KERNEL-DEVELOPMENT-ONLY";
export const HISTORICAL_VERDICT = "NO-GO";
export const PROMOTION_VERDICT = "GO-RUNTIME-PILOT";
export const FORBIDDEN_VERDICT = "GO-PRODUCTION";
// Anything other than the one verdict in force is overreach when claimed as current.
export const OVERREACH_VERDICTS = [PROMOTION_VERDICT, FORBIDDEN_VERDICT, "GO", "GO-RELEASE", "GO-DEPLOY"];
// Flags that must stay false while the current authority is kernel-development-only.
export const FORBIDDEN_TRUE_FLAGS = [
  "runtimeImplementationStarted", "kernelReady", "sdkReady", "appBuildable",
  "releaseAllowed", "deployAllowed", "productionAllowed", "gapClosed",
];

export const ONION_LAYERS = ["Domain", "Application", "Adapters", "Delivery"];
export const ONION_DEPENDS_ON = { Domain: [], Application: ["Domain"], Adapters: ["Application"], Delivery: ["Adapters"] };
export const OUTER_MEMBERS = { Surface: "Delivery", "ai-agent-adapter": "Adapters", "infrastructure-adapter": "Adapters" };
export const META_AXES = ["wbs-metaphor", "lifecycle-phases", "prompts", "multi-agent", "evidence", "governance", "planes"];
export const LIFECYCLE_PHASES = ["requirements", "test-plan", "db-schema", "development", "test-qa", "verification", "release-maintenance"];
export const PLANES = ["control", "data", "ai"];

export const RUNTIME_START_SEQUENCE = [
  "postgresql-rls-transaction-outbox-audit-substrate",
  "kernel-primitives-typed-action-pdp",
  "generated-sdk",
  "one-golden-slice",
];
export const RUNTIME_START_STEP_FIELDS = ["order", "id", "scope", "nonGoals", "red", "green", "rollback", "allowedTargetAreas", "exitCriteria"];

export const ACTIVATION_PREDICATES = [
  "artifact-present-on-kernel-main",
  "npm-test-passes-on-kernel-main",
  "npm-run-check-passes-on-kernel-main",
  "independent-codex-verification-evidence-exists",
];

// Byte-faithful preservation set, pinned so a relaxed overlay entry cannot widen it.
export const PRESERVED_FILES = {
  "planning/bootstrap-state.json": "fd3bbee02b19e8307755504648a0833a0ccc533e69e0a766420db04a47e6b574",
  "planning/governance-decisions.json": "ec9e8318f786f36376409704f9c0fd03ad3d5c99b6b0929c34761771ecca8b9c",
  "planning/kernel-ai-development-readiness.json": "532b780bac4049b852def1a76298b0e1ac63cc27c8748a786b65c509b137f297",
  "docs/kernel-ai-development-readiness.md": "984d5544ac8d288ce21e98dbdb61e746b89520ad0135e4438df867221018e75f",
};

export const OVERLAY_ROOT_KEYS = [
  "schemaVersion", "id", "generatedAt", "packageKind", "packageState", "overlayMode",
  "sourceIdentity", "historicalSnapshot", "currentEffectiveAuthority", "promotionContractBinding",
  "gate01", "activation", "architectureContract", "nextRuntimeStartPackage",
  "preservation", "nonGoals", "rollback",
];

// --- deterministic helpers ----------------------------------------------------------------
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
export const sha256 = (input) => createHash("sha256").update(input).digest("hex");
// A machine-local absolute path anywhere in the overlay, quoted or mid-sentence.
export const ABSOLUTE_PATH = /\/(Users|home|root|private|var|tmp|opt|mnt|srv)\//;
const triples = (gates) => (gates ?? []).map((g) => [g?.order, g?.id, g?.definition]);
export const freezeDigest = (gates) => sha256(Buffer.from(canonicalJson(triples(gates)), "utf8"));

// --- remote identity ------------------------------------------------------------------------
// Repository identity is host + owner + repo, never owner/repo alone. Matching only the last
// two path segments would accept https://evil.example/karacaismail/actionplan.git and
// file:///tmp/karacaismail/actionplan.git, so each accepted form is matched whole, anchored at
// both ends, against the canonical github.com host.
//
// Exactly three canonical forms are admissible, with an optional .git suffix:
//   git@github.com:<owner>/<repo>            (SSH, scp-like)
//   ssh://git@github.com/<owner>/<repo>      (SSH, URL)
//   https://github.com/<owner>/<repo>        (HTTPS)
//
// Everything else fails closed: any other host or scheme, file:// URLs, a host that is merely a
// suffix or prefix of github.com, an explicit port, an extra path prefix, embedded credentials,
// and userinfo that merely spells the canonical host (https://github.com@evil.example/...).
const SEGMENT = "[A-Za-z0-9._-]+";
export const REMOTE_FORMS = [
  { id: "ssh-scp", pattern: new RegExp(`^git@github\\.com:(${SEGMENT})/(${SEGMENT}?)(?:\\.git)?$`) },
  { id: "ssh-url", pattern: new RegExp(`^ssh://git@github\\.com/(${SEGMENT})/(${SEGMENT}?)(?:\\.git)?$`) },
  { id: "https", pattern: new RegExp(`^https://github\\.com/(${SEGMENT})/(${SEGMENT}?)(?:\\.git)?$`) },
];

// Returns the parsed canonical identity, or a named refusal. Never guesses and never repairs.
export function parseGitHubRemote(url) {
  if (typeof url !== "string") return { ok: false, reason: "remote-not-a-string" };
  const trimmed = url.trim();
  if (trimmed === "") return { ok: false, reason: "remote-empty" };
  // Interior whitespace, control characters and URL query/fragment syntax are never part of
  // a canonical remote. Each rejected character is listed explicitly so the class cannot
  // silently become a range that admits digits, dots, colons or slashes.
  if (/[\s\u0000-\u001f\u007f?#]/.test(trimmed)) return { ok: false, reason: "remote-malformed" };
  for (const { id, pattern } of REMOTE_FORMS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const [, owner, repo] = match;
    if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
      return { ok: false, reason: "remote-malformed" };
    }
    return { ok: true, form: id, host: "github.com", owner, repo, slug: `${owner}/${repo}` };
  }
  return { ok: false, reason: "remote-not-canonical-github" };
}

// The canonical owner/repo slug for an admissible remote, or null. A null is a refusal, never a
// value to compare loosely: callers must treat it as inadmissible rather than as "unknown".
export const normaliseRemote = (url) => {
  const parsed = parseGitHubRemote(url);
  return parsed.ok ? parsed.slug : null;
};

// --- hardened git access ------------------------------------------------------------------
// Replacement objects disabled, config and directory overrides scrubbed, no shell.
const GIT_ENV = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" };
for (const key of [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_REPLACE_REF_BASE", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT",
  "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE", "GIT_CEILING_DIRECTORIES",
]) delete GIT_ENV[key];

export const git = (cwd, args) =>
  execFileSync("git", ["--no-replace-objects", "-C", cwd, ...args], {
    encoding: "utf8", env: GIT_ENV, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
  });
const gitBuffer = (cwd, args) =>
  execFileSync("git", ["--no-replace-objects", "-C", cwd, ...args], {
    env: GIT_ENV, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
  });

// A candidate is accepted only on repository identity plus the exact commit object. Mutable
// refs are never consulted, so a stale, detached or ref-less checkout still verifies and a
// checkout whose main merely *names* the commit never substitutes for the object itself.
export function validateActionplanCandidate(candidate, sha = ACTIONPLAN_SHA) {
  if (!candidate || !existsSync(path.join(candidate, ".git"))) return { ok: false, reason: "not-a-git-checkout" };
  let origin;
  try { origin = git(candidate, ["remote", "get-url", "origin"]); } catch { return { ok: false, reason: "no-origin-remote" }; }
  // Host first: a remote that is not a canonical github.com URL for this repository is refused
  // before its owner/repo segments are even compared, so a matching tail on a foreign host,
  // a file:// path or a credential-bearing URL can never impersonate the canonical repository.
  const parsed = parseGitHubRemote(origin);
  if (!parsed.ok) return { ok: false, reason: `origin-${parsed.reason}` };
  if (parsed.host !== "github.com") return { ok: false, reason: "origin-host-mismatch" };
  if (parsed.slug !== ACTIONPLAN_REPO) return { ok: false, reason: "origin-identity-mismatch" };
  let topLevel;
  try { topLevel = git(candidate, ["rev-parse", "--show-toplevel"]).trim(); } catch { return { ok: false, reason: "no-toplevel" }; }
  // Compared through realpath so a symlinked prefix such as /var -> /private/var is not
  // mistaken for a checkout that sits below its own repository root.
  const samePath = (a, b) => {
    try { return realpathSync(a) === realpathSync(b); } catch { return path.resolve(a) === path.resolve(b); }
  };
  if (!samePath(topLevel, candidate)) return { ok: false, reason: "not-repository-root" };
  let format;
  try { format = git(candidate, ["rev-parse", "--show-object-format"]).trim(); } catch { return { ok: false, reason: "no-object-format" }; }
  if (format !== "sha1") return { ok: false, reason: `unsupported-object-format:${format}` };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: "pinned-sha-malformed" };
  let resolved;
  try { resolved = git(candidate, ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`]).trim(); }
  catch { return { ok: false, reason: "pinned-commit-absent" }; }
  if (resolved !== sha) return { ok: false, reason: "pinned-commit-did-not-resolve-to-itself" };
  let type;
  try { type = git(candidate, ["cat-file", "-t", sha]).trim(); } catch { return { ok: false, reason: "pinned-object-unreadable" }; }
  if (type !== "commit") return { ok: false, reason: `pinned-object-not-a-commit:${type}` };
  return { ok: true, reason: null };
}

// Hints are hints. They are searched first for speed, then discarded in favour of the same
// identity validation every other candidate faces.
export function discoverActionplanRoot({ hints = [], base = ROOT } = {}) {
  const rejected = [];
  const seen = new Set();
  const candidates = [];
  for (const hint of hints) if (hint) candidates.push(path.resolve(hint));
  let cursor = base;
  for (let depth = 0; depth < 5; depth += 1) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
    let entries;
    try { entries = readdirSync(cursor, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory()) candidates.push(path.join(cursor, entry.name));
  }
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const verdict = validateActionplanCandidate(candidate);
    if (verdict.ok) return { root: candidate, rejected };
    if (verdict.reason !== "not-a-git-checkout") rejected.push({ candidate, reason: verdict.reason });
  }
  return { root: null, rejected };
}

export const readCanonicalAt = (apRoot, ref, sha = ACTIONPLAN_SHA) =>
  gitBuffer(apRoot, ["show", "--no-textconv", `${sha}:${ref}`]);

// --- pure evaluators ------------------------------------------------------------------------
// Each returns every reason it failed, so a submission cannot be repaired one hidden
// rejection at a time.

export function evaluateOverlay({ overlay } = {}) {
  const errors = [];
  const push = (code) => errors.push(code);
  if (!overlay || typeof overlay !== "object") return { errors: ["overlay-missing"], ok: false };

  if (canonicalJson(Object.keys(overlay).sort()) !== canonicalJson([...OVERLAY_ROOT_KEYS].sort())) push("overlay-root-key-drift");
  if (overlay.id !== "kernel-runtime-pilot-consumer-sync-2026-08-06") push("overlay-id-drift");
  if (overlay.packageKind !== "current-authority-consumer-sync-overlay") push("overlay-package-kind-drift");
  if (overlay.packageState !== "prepared-awaiting-main-activation") push("overlay-package-state-drift");
  if (overlay.overlayMode !== "additive-non-destructive") push("overlay-mode-drift");

  // --- source identity: repository + exact commit, never a path, never a mutable ref -------
  const ap = overlay.sourceIdentity?.actionplan ?? {};
  if (ap.repository !== ACTIONPLAN_REPO) push("actionplan-identity-drift:repository");
  if (ap.remote !== ACTIONPLAN_REMOTE) push("actionplan-identity-drift:remote");
  if (ap.commit !== ACTIONPLAN_SHA) push("actionplan-identity-drift:commit");
  if (ap.readMode !== "git-show-at-exact-commit") push("actionplan-identity-drift:readMode");
  if (ap.mutationAllowed !== false) push("actionplan-identity-drift:mutationAllowed");
  if (ap.localPathIsIdentity !== false) push("actionplan-path-trusted");
  if (ap.localPathRole !== "discovery-hint-only") push("actionplan-path-trusted");
  if (ap.mutableRefResolutionRequired !== false) push("actionplan-mutable-ref-required");
  const kernel = overlay.sourceIdentity?.kernel ?? {};
  if (kernel.commit !== KERNEL_SHA) push("kernel-commit-drift");
  if (kernel.access !== "read-only") push("kernel-access-drift");
  if (kernel.rootPathRecorded !== false) push("kernel-path-recorded");
  const digests = overlay.sourceIdentity?.canonicalDigests ?? {};
  const expectedDigests = { CONTRACT: [CONTRACT_REF, CONTRACT_SHA256], CHAIN: [CHAIN_REF, CHAIN_SHA256], STATE: [STATE_REF, STATE_SHA256] };
  if (canonicalJson(Object.keys(digests).sort()) !== canonicalJson(Object.keys(expectedDigests).sort())) push("canonical-digest-key-drift");
  for (const [key, [ref, digest]] of Object.entries(expectedDigests)) {
    if (digests[key]?.path !== ref) push(`canonical-digest-drift:${key}.path`);
    if (digests[key]?.sha256 !== digest) push(`canonical-digest-drift:${key}.sha256`);
  }
  // No absolute path may be embedded anywhere in the overlay, in any string value.
  const raw = JSON.stringify(overlay);
  if (raw.includes("/worktrees/") || ABSOLUTE_PATH.test(raw)) push("overlay-embeds-absolute-path");

  // --- historical snapshot: immutable, non-effective, still NO_GO ---------------------------
  const hist = overlay.historicalSnapshot ?? {};
  if (hist.role !== "historical-immutable-non-effective") push("historical-role-drift");
  if (hist.effective !== false) push("historical-snapshot-effective");
  if (hist.mutationAllowed !== false) push("historical-snapshot-mutable");
  if (hist.rewritten !== false) push("historical-snapshot-rewritten");
  if (hist.actionplanCommit !== HISTORICAL_ACTIONPLAN_SHA) push("historical-commit-drift");
  if (hist.epochId !== "AUTHORITY-SUPERSESSION-03" || hist.seq !== 3) push("historical-epoch-drift");
  if (hist.verdict !== HISTORICAL_VERDICT) push("historical-verdict-drift");
  if (hist.kernelLocalVerdictToken !== "NO_GO") push("historical-verdict-token-drift");
  if (hist.readinessStatus !== "BLOCKED") push("historical-status-drift");
  if (hist.codeStartAllowed !== false || hist.runtimeCodeAllowed !== false) push("historical-floor-drift");
  if (hist.supersededBy !== "AUTHORITY-SUPERSESSION-04") push("historical-supersession-drift");
  const histArtifacts = Object.fromEntries((hist.artifacts ?? []).map((a) => [a?.path, a?.sha256]));
  for (const artifactPath of ["planning/kernel-ai-development-readiness.json", "docs/kernel-ai-development-readiness.md"]) {
    if (histArtifacts[artifactPath] !== PRESERVED_FILES[artifactPath]) push(`historical-artifact-digest-drift:${artifactPath}`);
  }

  // --- current effective authority: exactly one verdict, every downstream stage shut --------
  const cur = overlay.currentEffectiveAuthority ?? {};
  if (cur.actionplanCommit !== ACTIONPLAN_SHA) push("current-authority-commit-drift");
  if (cur.verdict !== CURRENT_VERDICT) {
    push("current-verdict-drift");
    if (OVERREACH_VERDICTS.includes(cur.verdict)) push(`verdict-overreach:${cur.verdict}`);
  }
  if (cur.effectiveVerdictCount !== 1) push("effective-verdict-count-drift");
  if (cur.codeStartAllowed !== true) push("code-start-not-open");
  if (cur.runtimeCodeAllowed !== true) push("runtime-code-not-open");
  for (const flag of FORBIDDEN_TRUE_FLAGS) if (cur[flag] !== false) push(`forbidden-true:${flag}`);
  if (cur.headSeq !== 4 || cur.headEpochId !== "AUTHORITY-SUPERSESSION-04") push("authority-head-drift:identity");
  if (cur.headStatus !== "effective") push("authority-head-drift:status");
  if (cur.chainFileSha256 !== CHAIN_SHA256) push("authority-head-drift:chainFileSha256");
  if (cur.stateFileSha256 !== STATE_SHA256) push("authority-head-drift:stateFileSha256");
  // The stale predecessor digest must never resurface as the current one.
  if (cur.chainFileSha256 === hist.chainFileSha256) push("stale-authority-head-reused");

  // --- frozen promotion contract binding -----------------------------------------------------
  const bind = overlay.promotionContractBinding ?? {};
  if (bind.ref !== CONTRACT_REF) push("contract-ref-drift");
  if (bind.sha256 !== CONTRACT_SHA256) push("contract-digest-drift");
  if (bind.gateSetSha256 !== GATE_SET_SHA256) push("contract-gate-set-hash-drift");
  // Semantic freeze: the triples must BE the frozen ones, so a co-forged contract that
  // redefines a gate and recomputes a perfectly self-consistent digest still dies here.
  if (canonicalJson(triples(bind.gates)) !== canonicalJson(GATE_DEFINITIONS)) push("contract-gate-set-drift");
  if (bind.gateSetSha256 !== freezeDigest(bind.gates)) push("contract-freeze-drift");
  if (bind.gateCount !== 10 || bind.gateSetClosedAt !== 10) push("gate-count-drift");
  if (bind.gateAdditionAllowed !== false) push("gate-addition-allowed");
  if (bind.authorityAnchorCommit !== AUTHORITY_ANCHOR_SHA) push("authority-anchor-drift");
  const seen = new Map();
  for (const gate of bind.gates ?? []) {
    if (!GATE_IDS.includes(gate?.id)) push(`unknown-gate:${gate?.id}`);
    else if (seen.has(gate.id)) push(`duplicate-gate:${gate.id}`);
    else seen.set(gate.id, gate);
  }
  for (const id of GATE_IDS) if (!seen.has(id)) push(`missing-gate:${id}`);
  const rule = bind.promotionRule ?? {};
  const expectedRule = { requiredGreenGates: 10, requiresIndependentVerifier: true, requiresHumanCountersign: true, humanCountersignDefault: false, writerMaySelfClose: false, writerMaySelfVerify: false, targetVerdict: PROMOTION_VERDICT, impliesProduction: false };
  for (const [key, value] of Object.entries(expectedRule)) if (rule[key] !== value) push(`promotion-rule-drift:${key}`);
  const later = bind.laterTopicPolicy ?? {};
  if (canonicalJson(later.classifications) !== canonicalJson(CLASSIFICATIONS)) push("later-topic-classification-drift");
  if (later.newGateAllowed !== false || later.gateSetClosedAt !== 10) push("later-topic-policy-drift");
  const production = bind.productionPolicy ?? {};
  if (production.reachableFromThisPackage !== false || production.reachableFromRuntimePilot !== false) push("production-reachable-claimed");
  if (production.separatePostPilotStage !== true) push("production-not-separate-stage");
  if (bind.claimedVerdict !== null) push("overlay-claims-verdict");
  if (bind.claimsRuntimePilot !== false) push("runtime-pilot-claimed");
  if (bind.claimsProduction !== false) push("production-claimed");
  if (raw.includes(FORBIDDEN_VERDICT) && production.forbiddenVerdicts?.includes(FORBIDDEN_VERDICT) !== true) push("production-claimed");

  // --- GRP-01 is never closed from this branch ------------------------------------------------
  const gate01 = overlay.gate01 ?? {};
  if (gate01.id !== "GRP-01") push("gate01-id-drift");
  if (gate01.definition !== GATE_DEFINITIONS[0][2]) push("gate01-definition-drift");
  if (gate01.claimedStatus !== "RED") push("gate01-preclaimed-green");
  if (gate01.preclaimedGreen !== false) push("gate01-preclaimed-green");
  if (gate01.selfClosedByWriter !== false || gate01.writerMaySelfClose !== false || gate01.writerMaySelfVerify !== false) push("gate01-self-closed");
  if (gate01.independentVerifierRecorded !== false) push("gate01-verifier-preclaimed");
  if (gate01.evaluator !== "codex-master") push("gate01-evaluator-drift");
  if (canonicalJson(gate01.externallyEvaluableWhen) !== canonicalJson(ACTIVATION_PREDICATES)) push("gate01-predicate-drift");

  // --- activation stays prepared on this branch -------------------------------------------------
  const act = overlay.activation ?? {};
  if (act.state !== "prepared-awaiting-main-activation") push("activation-state-drift");
  if (act.effective !== false) push("activation-effective-on-branch");
  if (act.deterministic !== true) push("activation-not-deterministic");
  if (act.inRepoStatusFlipCommitRequired !== false) push("activation-status-flip-required");
  if (act.selfReferentialCommitShaRecorded !== false) push("activation-self-sha-recorded");
  if (act.activatedBy !== null || act.effectiveFrom !== null) push("activation-preclaimed");
  const predicateIds = (act.predicates ?? []).map((p) => p?.id);
  if (canonicalJson(predicateIds) !== canonicalJson(ACTIVATION_PREDICATES)) push("activation-predicate-drift");
  for (const predicate of act.predicates ?? []) {
    if (predicate?.satisfiedOnThisBranch !== false) push(`activation-predicate-satisfied-on-branch:${predicate?.id}`);
    if (predicate?.evaluator !== "codex-master") push(`activation-predicate-evaluator-drift:${predicate?.id}`);
  }

  // --- architecture contract -----------------------------------------------------------------------
  const onion = overlay.architectureContract?.onion ?? {};
  if (onion.appliesTo !== "code-bearing-backend-and-archetype-only") push("onion-scope-drift");
  if (onion.dependencyDirection !== "inward") push("onion-direction-drift");
  const layerNames = (onion.layers ?? []).map((l) => l?.name);
  if (canonicalJson(layerNames) !== canonicalJson(ONION_LAYERS)) push("onion-layer-drift");
  for (const layer of onion.layers ?? []) {
    const expected = ONION_DEPENDS_ON[layer?.name];
    if (!expected) continue;
    if (canonicalJson(layer?.dependsOn) !== canonicalJson(expected)) push(`onion-dependency-drift:${layer?.name}`);
    const order = ONION_LAYERS.indexOf(layer?.name) + 1;
    if (layer?.order !== order) push(`onion-order-drift:${layer?.name}`);
  }
  const outer = Object.fromEntries((onion.outerMembers ?? []).map((m) => [m?.name, m]));
  for (const [name, layer] of Object.entries(OUTER_MEMBERS)) {
    if (!outer[name]) push(`outer-member-missing:${name}`);
    else if (outer[name].layer !== layer) push(`outer-member-drift:${name}`);
    else if (outer[name].outer !== true) push(`outer-member-not-outer:${name}`);
  }
  if (outer.Surface && outer.Surface.layer !== "Delivery") push("surface-not-delivery");
  const axes = overlay.architectureContract?.metaFrameworkAxes ?? [];
  if (canonicalJson(axes.map((a) => a?.axis)) !== canonicalJson(META_AXES)) push("meta-axis-drift");
  for (const axis of axes) {
    if (axis?.isOnionLayer !== false) push(`meta-axis-is-onion-layer:${axis?.axis}`);
    if (ONION_LAYERS.includes(axis?.axis)) push(`meta-axis-collides-with-onion-layer:${axis?.axis}`);
  }
  const lifecycle = axes.find((a) => a?.axis === "lifecycle-phases");
  if (canonicalJson(lifecycle?.members) !== canonicalJson(LIFECYCLE_PHASES)) push("lifecycle-phase-drift");
  const planes = axes.find((a) => a?.axis === "planes");
  if (canonicalJson(planes?.members) !== canonicalJson(PLANES)) push("plane-drift");

  // --- next runtime-start package ---------------------------------------------------------------------
  const next = overlay.nextRuntimeStartPackage ?? {};
  if (next.separatePackage !== true) push("runtime-start-not-separate");
  if (next.startsRuntimeInThisPackage !== false || next.thisPackageStartsNoRuntime !== true) push("runtime-start-in-this-package");
  const steps = next.sequence ?? [];
  if (canonicalJson(steps.map((s) => s?.id)) !== canonicalJson(RUNTIME_START_SEQUENCE)) push("runtime-start-sequence-drift");
  steps.forEach((step, index) => {
    if (step?.order !== index + 1) push(`runtime-start-order-drift:${step?.id}`);
    for (const field of RUNTIME_START_STEP_FIELDS) {
      const value = step?.[field];
      const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
      if (empty) push(`runtime-start-step-missing-field:${step?.id}.${field}`);
    }
  });

  // --- preservation ------------------------------------------------------------------------------------
  const preserved = Object.fromEntries((overlay.preservation?.byteFaithful ?? []).map((e) => [e?.path, e?.sha256]));
  for (const [file, digest] of Object.entries(PRESERVED_FILES)) {
    if (preserved[file] !== digest) push(`preservation-entry-drift:${file}`);
  }
  const epoch = overlay.preservation?.historicalEpochEvidence ?? {};
  if (epoch.rule !== "absent" || epoch.expectedMatches !== 0) push("epoch-evidence-not-absent");

  return { errors, ok: errors.length === 0 };
}

// Content cross-binding. Digests prove the bytes; this proves the bytes say what the overlay
// claims they say, and that the three canonical documents agree with each other.
export function evaluateCrossBindings({ overlay, contract, chain, state } = {}) {
  const errors = [];
  const push = (code) => errors.push(code);
  const cur = overlay?.currentEffectiveAuthority ?? {};
  const bind = overlay?.promotionContractBinding ?? {};

  if (contract?.id !== "kernel-runtime-pilot-promotion-contract-2026-08-06") push("contract-id-drift");
  if (contract?.frozen !== true) push("contract-not-frozen");
  if (contract?.status !== "frozen-promotion-contract-not-promoted") push("contract-status-drift");
  if (contract?.gateSetSha256 !== GATE_SET_SHA256) push("contract-gate-set-hash-drift");
  if (canonicalJson(triples(contract?.gates)) !== canonicalJson(GATE_DEFINITIONS)) push("contract-gate-set-drift");
  if (contract?.gateSetSha256 !== freezeDigest(contract?.gates)) push("contract-freeze-drift");

  const anchor = contract?.authorityBinding ?? {};
  const expectedAnchor = {
    actionplanCommit: AUTHORITY_ANCHOR_SHA, chainRef: CHAIN_REF, chainHeadSeq: 4,
    chainHeadEntrySha256: "90a0a9ba795fcff67d48829d9d0083cbac956e4d1b277527862fa19586228c37",
    chainSha256: "f2315ba09192e3614e272bb7256ae41a288f1a6fdc435cb67aca74954ec3a1b8",
    stateRef: STATE_REF, kernelRepository: "metaframer-kernel", kernelCommit: KERNEL_SHA,
    kernelAccess: "read-only", currentVerdict: CURRENT_VERDICT,
  };
  for (const [key, value] of Object.entries(expectedAnchor)) if (anchor[key] !== value) push(`contract-authority-binding-drift:${key}`);

  const status = contract?.currentStatus ?? {};
  const expectedStatus = { greenGates: 0, promotionAllowed: false, humanCountersign: false, independentVerifierRecorded: false, verdict: CURRENT_VERDICT, runtimeImplementationStarted: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false };
  for (const [key, value] of Object.entries(expectedStatus)) if (status[key] !== value) push(`contract-current-status-drift:${key}`);
  const contractGate01 = (status.gates ?? []).find((g) => g?.id === "GRP-01");
  if (contractGate01?.status !== "RED") push("contract-gate01-not-red");
  if (contract?.nextChangePackage?.subject !== "kernel-consumer-sync") push("contract-next-change-package-drift:subject");
  if (contract?.nextChangePackage?.blocksGate !== "GRP-01") push("contract-next-change-package-drift:blocksGate");
  if (canonicalJson(contract?.laterTopicPolicy?.classifications) !== canonicalJson(CLASSIFICATIONS)) push("contract-later-topic-drift");
  if (contract?.promotionRule?.targetVerdict !== PROMOTION_VERDICT) push("contract-target-verdict-drift");
  if (contract?.promotionRule?.impliesProduction !== false) push("contract-implies-production");

  // Chain: the head must be the appended EPOCH-04 entry, effective, and agree with the overlay.
  if (chain?.chainHeadSeq !== 4) push("chain-head-seq-drift");
  if (chain?.chainHeadEntrySha256 !== cur.headEntrySha256) push("chain-head-entry-drift");
  if (chain?.chainSha256 !== cur.chainInternalSha256) push("chain-internal-digest-drift");
  const head = chain?.entries?.at(-1);
  if (head?.seq !== 4 || head?.epochId !== "AUTHORITY-SUPERSESSION-04") push("chain-head-epoch-drift");
  if (head?.status !== "effective") push("chain-head-not-effective");
  if (head?.entrySha256 !== chain?.chainHeadEntrySha256) push("chain-head-entry-self-drift");
  if (head?.normalizedTextSha256 !== cur.headNormalizedTextSha256) push("chain-head-text-drift");
  if (head?.dimensions?.verdict?.value !== CURRENT_VERDICT) push("chain-verdict-drift");
  if (head?.dimensions?.codeStart?.value !== "YES") push("chain-code-start-drift");
  if (head?.dimensions?.runtimeCode?.value !== "YES") push("chain-runtime-code-drift");
  if (typeof head?.normalizedText !== "string" || !head.normalizedText.includes("RUNTIME_IMPLEMENTATION_START=NO")) push("chain-runtime-start-drift");
  const boundary = chain?.effectiveAuthorityBoundary ?? {};
  for (const [key, value] of Object.entries({ codeStartAllowed: true, runtimeCodeAllowed: true, releaseAllowed: false, deployAllowed: false, verdict: CURRENT_VERDICT })) {
    if (boundary[key] !== value) push(`chain-boundary-drift:${key}`);
  }
  // The stale consumer pin is disclosed as the predecessor, never as the head.
  const projection = chain?.supersessionProjection ?? {};
  if (projection.predecessorChainFileSha256 !== overlay?.historicalSnapshot?.chainFileSha256) push("chain-predecessor-drift:digest");
  if (projection.predecessorChainFileSource !== `actionplan@${HISTORICAL_ACTIONPLAN_SHA}`) push("chain-predecessor-drift:source");
  if (projection.predecessorChainFileSha256 === chain?.chainSha256) push("stale-authority-head-reused");

  // Application state must agree with the same head and keep every downstream stage shut.
  if (state?.status !== cur.stateStatus) push("state-status-drift");
  if (canonicalJson(state?.summary) !== canonicalJson(cur.stateSummary)) push("state-summary-drift");
  const stateAuthority = state?.effectiveAuthority ?? {};
  if (stateAuthority.seq !== 4 || stateAuthority.epochId !== "AUTHORITY-SUPERSESSION-04") push("state-authority-drift:head");
  if (stateAuthority.chainHeadSha256 !== cur.headEntrySha256) push("state-authority-drift:chainHeadSha256");
  if (stateAuthority.normalizedTextSha256 !== cur.headNormalizedTextSha256) push("state-authority-drift:normalizedTextSha256");
  const stateGate = state?.gate ?? {};
  for (const [key, value] of Object.entries({ gapClosed: false, codeStartAllowed: true, runtimeCodeAllowed: true, releaseAllowed: false, deployAllowed: false, kernelReady: false, sdkReady: false, appBuildable: false, verdict: CURRENT_VERDICT })) {
    if (stateGate[key] !== value) push(`state-gate-drift:${key}`);
  }
  return { errors, ok: errors.length === 0 };
}

// Activation is a deterministic function of external predicates. It never reads a status field
// the package set for itself and never accepts a self-referential commit SHA as evidence.
export function evaluateActivation({ overlay, predicates = {}, statusFlipCommit = false, selfReferentialSha = null } = {}) {
  const errors = [];
  if (overlay?.activation?.effective === true) errors.push("activation-self-declared-effective");
  if (statusFlipCommit === true) errors.push("activation-status-flip-claimed");
  if (selfReferentialSha !== null && selfReferentialSha !== undefined) errors.push("activation-self-sha-claimed");
  for (const key of Object.keys(predicates)) if (!ACTIVATION_PREDICATES.includes(key)) errors.push(`activation-unknown-predicate:${key}`);
  const unsatisfied = ACTIVATION_PREDICATES.filter((id) => predicates[id] !== true);
  const status = errors.length === 0 && unsatisfied.length === 0 ? "effective" : "prepared-awaiting-main-activation";
  return { status, errors, unsatisfied, requiresStatusFlipCommit: false, requiresSelfReferentialSha: false };
}

// GRP-01 turns GREEN only once the artifact is externally activated and an independent verifier
// that is not the writer has recorded verification. The overlay's own claim never contributes.
export function evaluateGate01({ overlay, activation, verification } = {}) {
  const errors = [];
  if (overlay?.gate01?.claimedStatus === "GREEN" || overlay?.gate01?.preclaimedGreen === true) errors.push("gate01-preclaimed-green");
  if (activation?.status !== "effective") errors.push("gate01-not-activated");
  if (!verification?.recorded) errors.push("gate01-verification-missing");
  else if (!verification.verifierId) errors.push("gate01-verifier-missing");
  else if (verification.verifierId === verification.writerId || verification.independentOfWriter !== true) errors.push("gate01-self-verification");
  return { status: errors.length === 0 ? "GREEN" : "RED", errors };
}

export function classifyLaterTopic({ classification } = {}) {
  const errors = [];
  if (classification === "new-promotion-gate") errors.push("new-promotion-gate-forbidden");
  else if (!CLASSIFICATIONS.includes(classification)) errors.push(`unknown-classification:${classification}`);
  return { errors, classification, createsGate: false };
}

// Promotion is never reachable from this package, and production is never reachable at all.
export function evaluatePromotionClaim({ claim } = {}) {
  const errors = [];
  if (claim?.targetVerdict === FORBIDDEN_VERDICT) errors.push("production-claimed");
  else if (claim?.targetVerdict === PROMOTION_VERDICT) errors.push("promotion-claimed-from-consumer-sync");
  else if (claim?.targetVerdict !== undefined && claim?.targetVerdict !== null && claim?.targetVerdict !== CURRENT_VERDICT) {
    errors.push(`verdict-overreach:${claim?.targetVerdict}`);
  }
  if (claim?.greenGates !== undefined && claim.greenGates !== 0) errors.push("green-gate-claimed");
  return { errors, promotionAllowed: false };
}

// --- repository-side checks --------------------------------------------------------------------
export function checkPreservedFiles(root = ROOT) {
  const errors = [];
  for (const [file, digest] of Object.entries(PRESERVED_FILES)) {
    const full = path.join(root, file);
    if (!existsSync(full)) { errors.push(`preserved-file-missing:${file}`); continue; }
    if (sha256(readFileSync(full)) !== digest) errors.push(`preserved-file-mutated:${file}`);
  }
  return errors;
}

export function findEpochEvidence(root = ROOT) {
  const matches = [];
  const walk = (dir, relative) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (/epoch/i.test(entry.name)) matches.push(rel);
    }
  };
  walk(root, "");
  return matches;
}

// --- CLI -----------------------------------------------------------------------------------------
export function main(root = ROOT) {
  const failures = [];
  const overlayFile = path.join(root, OVERLAY_PATH);
  if (!existsSync(overlayFile)) {
    console.error(`FAIL consumer-sync-overlay-missing: ${OVERLAY_PATH}`);
    return 1;
  }
  const overlay = JSON.parse(readFileSync(overlayFile, "utf8"));
  failures.push(...evaluateOverlay({ overlay }).errors);

  // Discovery is a hint; identity and the exact commit object are what actually admit a checkout.
  const { root: apRoot, rejected } = discoverActionplanRoot({
    hints: [process.env.METAFRAMER_ACTIONPLAN_PATH].filter(Boolean),
    base: root,
  });
  if (!apRoot) {
    console.error(`FAIL actionplan-checkout-not-admissible: no local checkout of ${ACTIONPLAN_REPO} carries commit ${ACTIONPLAN_SHA}`);
    for (const entry of rejected) console.error(`  rejected ${entry.candidate}: ${entry.reason}`);
    return 1;
  }

  const blobs = {};
  for (const [key, [ref, digest]] of Object.entries({ CONTRACT: [CONTRACT_REF, CONTRACT_SHA256], CHAIN: [CHAIN_REF, CHAIN_SHA256], STATE: [STATE_REF, STATE_SHA256] })) {
    let bytes;
    try { bytes = readCanonicalAt(apRoot, ref); } catch { failures.push(`canonical-blob-unreadable:${key}`); continue; }
    const actual = sha256(bytes);
    if (actual !== digest) { failures.push(`canonical-blob-digest-drift:${key}`); continue; }
    try { blobs[key] = JSON.parse(bytes.toString("utf8")); } catch { failures.push(`canonical-blob-unparsable:${key}`); }
  }
  // The contract's own authority anchor commit must exist as a commit object too.
  const anchorVerdict = validateActionplanCandidate(apRoot, AUTHORITY_ANCHOR_SHA);
  if (!anchorVerdict.ok) failures.push(`authority-anchor-commit-unverified:${anchorVerdict.reason}`);
  // ...and the chain must be byte-identical at the anchor commit and at the pinned commit.
  try {
    if (sha256(readCanonicalAt(apRoot, CHAIN_REF, AUTHORITY_ANCHOR_SHA)) !== CHAIN_SHA256) failures.push("chain-drifted-between-anchor-and-pin");
  } catch { failures.push("chain-unreadable-at-anchor"); }

  if (blobs.CONTRACT && blobs.CHAIN && blobs.STATE) {
    failures.push(...evaluateCrossBindings({ overlay, contract: blobs.CONTRACT, chain: blobs.CHAIN, state: blobs.STATE }).errors);
  }

  failures.push(...checkPreservedFiles(root));
  for (const match of findEpochEvidence(root)) failures.push(`epoch-evidence-present:${match}`);

  // This branch is prepared, never effective, and GRP-01 is never GREEN from here.
  const activation = evaluateActivation({ overlay, predicates: {} });
  if (activation.status !== "prepared-awaiting-main-activation") failures.push("activation-effective-on-branch");
  const gate01 = evaluateGate01({ overlay, activation, verification: null });
  if (gate01.status !== "RED") failures.push("gate01-green-on-branch");

  if (failures.length > 0) {
    console.error(`FAIL kernel-runtime-pilot-consumer-sync: ${failures.length} finding(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  // Verification evidence first, then the single authoritative current-state line. The facts on
  // that line are read from the overlay this run just validated, so the summary cannot drift from
  // the artifact it reports.
  console.log(
    `OK kernel-runtime-pilot-consumer-sync: actionplan@${ACTIONPLAN_SHA.slice(0, 7)} verified as a git commit object; ` +
    `contract/chain/state blobs byte-exact and cross-bound at that commit; ` +
    `${Object.keys(PRESERVED_FILES).length} preserved files byte-faithful; EPOCH evidence absent.`,
  );
  const cur = overlay.currentEffectiveAuthority;
  // The last line of `npm run check`: exactly one current-effective summary, no promotion or
  // production verdict, and no legacy token that could read as today's boundary.
  console.log(
    `CURRENT EFFECTIVE: verdict=${cur.verdict} codeStartAllowed=${cur.codeStartAllowed} ` +
    `runtimeCodeAllowed=${cur.runtimeCodeAllowed} runtimeImplementationStarted=${cur.runtimeImplementationStarted} ` +
    `kernelReady=${cur.kernelReady} sdkReady=${cur.sdkReady} appBuildable=${cur.appBuildable} ` +
    `releaseAllowed=${cur.releaseAllowed} deployAllowed=${cur.deployAllowed} ` +
    `productionAllowed=${cur.productionAllowed} gapClosed=${cur.gapClosed} ` +
    `GRP-01=${overlay.gate01.claimedStatus} packageState=${overlay.packageState}`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
