#!/usr/bin/env node
// Fail-closed oracle for the runtime-substrate S1 change package (Phase B, GREEN).
//
// Three rules shape this file.
//
// First, the contract never vouches for itself: every pinned identity below is a constant here,
// not a value read from the artifact, so an edited artifact cannot move its own goalposts.
//
// Second, "no historical rewrite" is proven rather than asserted. Each file the package declares
// read-only is compared byte-for-byte against its content at the pinned base commit, read through
// `git show`. A contract that merely *claims* it rewrote nothing fails here if it did.
//
// Third, the production surface is bounded in both directions. Phase A enforced it negatively —
// the declared capabilities had to be absent. Phase B enforces it positively and narrowly: the
// package must exist, in exactly one place, with exactly the modules and the one revision it
// declares, and the contract is cross-bound to the source it describes so documentation cannot
// drift away from code. The repository-root fence holds in both phases.
//
// This verifier deliberately does NOT re-derive Actionplan authority. It pins the same commit the
// current-authority consumer sync pins, so the canonical read happens exactly once, in the artifact
// that owns it, and this one never becomes a second competing source of the effective verdict. For
// the same reason it never prints a current-effective line: it prints a branch-candidate line that
// is explicitly non-effective. The one final current-effective line belongs to
// tools/compose-current-effective.mjs, which runs after this verifier and composes it from the
// consumer-sync output.
//
// Importing this module has no side effects; the CLI runs only under the main guard at the end.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ROOT_ABSENT_PATHS,
  ROOT_SRC_PERMITTED_CHILDREN,
  ROOT_SRC_FORBIDDEN_CHILDREN,
  checkRootTopology,
} from "./check-repository-boundary.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_PATH = "db/kernel-runtime-substrate-s1.json";

// --- pinned identity ------------------------------------------------------------------------
export const CONTRACT_ID = "kernel-runtime-substrate-s1-2026-08-06";
export const PACKAGE_KIND = "runtime-substrate-change-package";
export const PACKAGE_STATE = "prepared-awaiting-main-activation";
export const PHASE = "B-GREEN";

export const ACTIONPLAN_REPO = "karacaismail/actionplan";
export const ACTIONPLAN_SHA = "811505b0229705cf39edbf0d6b60248c46a72091";
export const ACTIONPLAN_HEAD_SEQ = 4;
export const ACTIONPLAN_HEAD_ID = "AUTHORITY-SUPERSESSION-04";
export const CURRENT_VERDICT = "GO-KERNEL-DEVELOPMENT-ONLY";
// The pre-existing commit this branch started from. It is a base, never this package's own commit.
export const KERNEL_BASE_SHA = "20941b1ef2590000eef909fefd907b8a40248ffe";

export const ACTIVATION_BASE_ARTIFACT = "planning/kernel-runtime-pilot-consumer-sync.json";
export const ACTIVATION_BASE_VERIFIER = "tools/check-kernel-runtime-pilot-consumer-sync.mjs";

// The state in force now, and the state this candidate desires once externally activated. Exactly
// one dimension differs; every downstream stage stays shut in both.
export const ACTIVATION_BASE_STATE = {
  verdict: CURRENT_VERDICT,
  codeStartAllowed: true,
  runtimeCodeAllowed: true,
  runtimeImplementationStarted: false,
  kernelReady: false,
  sdkReady: false,
  appBuildable: false,
  releaseAllowed: false,
  deployAllowed: false,
  productionAllowed: false,
  gapClosed: false,
};
export const DESIRED_STATE = { ...ACTIVATION_BASE_STATE, runtimeImplementationStarted: true };
export const MOVED_DIMENSIONS = ["runtimeImplementationStarted"];
export const SHUT_FLAGS = [
  "kernelReady", "sdkReady", "appBuildable",
  "releaseAllowed", "deployAllowed", "productionAllowed", "gapClosed",
];
export const OVERREACH_VERDICTS = ["GO-RUNTIME-PILOT", "GO-PRODUCTION", "GO", "GO-RELEASE", "GO-DEPLOY"];

export const ACTIVATION_PREDICATES = [
  "artifact-present-on-kernel-main",
  "npm-test-passes-on-kernel-main",
  "npm-run-check-passes-on-kernel-main",
  "independent-codex-verification-evidence-exists",
];

// Files this package must leave byte-identical. Proven against the pinned base commit, so the
// list cannot be quietly narrowed by editing the artifact.
export const READ_ONLY_FILES = [
  "repository-status.json",
  "planning/bootstrap-state.json",
  "planning/governance-decisions.json",
  "planning/human-decision-request.json",
  "planning/kernel-ai-development-readiness.json",
  "planning/kernel-runtime-pilot-consumer-sync.json",
  "planning/source-inventory.json",
  "planning/traceability-matrix.json",
  "docs/kernel-ai-development-readiness.md",
];

// The root topology is owned by tools/check-repository-boundary.mjs and re-exported here, so this
// package reads the rule rather than keeping a second copy of it. apps, packages, deploy and root
// migrations stay fenced in every phase. Root `src` is constrained to the two inner onion rings,
// `src/domain` and `src/application` — that is the one part of the old flat fence that narrowed,
// and the substrate stays package-local under db/ regardless: db/ is the allowed target area this
// package was scoped to, not a way around the root.
export const FORBIDDEN_ROOT_PATHS = ROOT_ABSENT_PATHS;
export { ROOT_SRC_PERMITTED_CHILDREN, ROOT_SRC_FORBIDDEN_CHILDREN };
// Never legitimate anywhere: a second home for the production package would mean two substrates.
export const FORBIDDEN_PACKAGE_PATHS = ["db/src", "db/tests/metaframer_kernel_db"];

// The production import root the declared capability targets resolve through.
export const PRODUCTION_IMPORT_ROOT = "metaframer_kernel_db";
export const PRODUCTION_PACKAGE = "db/metaframer_kernel_db";
// Exactly the modules the package ships. A seventh would be scope creep; a missing one is a gap.
export const PRODUCTION_MODULES = [
  "db/metaframer_kernel_db/__init__.py",
  "db/metaframer_kernel_db/schema.py",
  "db/metaframer_kernel_db/migrations.py",
  "db/metaframer_kernel_db/session.py",
  "db/metaframer_kernel_db/outbox.py",
  "db/metaframer_kernel_db/alembic/env.py",
  "db/metaframer_kernel_db/alembic/versions/0001_runtime_substrate.py",
];
export const REVISIONS_DIR = "db/metaframer_kernel_db/alembic/versions";
export const HEAD_REVISION = "0001_runtime_substrate";
// This package owns exactly these runtime tables, named as they exist in the database. There is
// no domain here, so no business table may be invented to exercise transaction or policy
// behaviour; the substrate's own tables are the subjects. Row-level-security obligations are
// enumerated over this list, and the contract and the production source must both agree with it.
export const PHYSICAL_RUNTIME_TABLES = ["transactional_outbox", "audit_log"];

export const REQUIRED_CAPABILITY_IDS = [
  "migration.alembic_config",
  "migration.head_revision",
  "schema.contract",
  "runtime.tenant_context_attestation",
  "runtime.tenant_transaction",
  "outbox.claim_batch",
];

// The same two tables. Kept as a named alias because the contract, the behavioural obligations
// and the source cross-binding all have to agree on one list, not three.
export const RUNTIME_TABLES = PHYSICAL_RUNTIME_TABLES;

// Language this package must never contain. Both bans are substantive, not stylistic:
//   * a domain/business record table would put a domain inside a substrate package;
//   * an exactly-once promise would overstate what a transactional outbox can deliver, since a
//     crash or an expired claim lease legitimately redelivers a row.
export const FORBIDDEN_TOKENS = [
  { id: "domain-record-table", pattern: /record[_ ]table/i },
  { id: "exactly-once-promise", pattern: /exactly[- ]once/i },
];
// Files whose prose and code are held to those bans.
export const TOKEN_SCANNED_GLOBS = [
  "db/kernel-runtime-substrate-s1.json",
  "db/tests",
  "db/metaframer_kernel_db",
];
export const BEHAVIORAL_IDS = [
  "environment",
  "migration-roundtrip",
  "rls-isolation",
  "transaction-atomicity",
  "outbox-claim",
  "audit-immutability",
];
export const PASSING_BEHAVIORAL_ID = "environment";

export const LIFECYCLE_IMAGE = "postgres:16-alpine";
export const LIFECYCLE_MAJOR = 16;
export const MIGRATION_ROLE = "mfk_migration";
export const RUNTIME_ROLE = "mfk_runtime";

export const CONTRACT_ROOT_KEYS = [
  "schemaVersion", "id", "generatedAt", "packageKind", "packageState", "packageMode", "phase",
  "authorityBinding", "activationBase", "desiredState", "stateDelta", "boundedScope", "scope",
  "nonGoals", "allowedTargets", "allowedTargetsNote", "forbiddenInPhaseA", "red", "green",
  "requiredCapabilities", "behavioralContract", "databaseLifecycle", "rollback", "activation",
  "independentVerification", "humanCountersign", "promotionClaims", "preservation",
  "checkComposition", "knownHazards", "phaseStatus", "productionSurface", "forbiddenAlways",
  "rootSourceTopology", "staticAnalysis", "redFollowUps",
];

// Declared RED follow-ups. Each names work that is specified and failing, never work that is done.
export const RED_FOLLOW_UP_IDS = ["GAP1-outbox-claim-fencing", "GAP2-external-tag-activation"];
export const FENCING_CAPABILITY_IDS = ["outbox.release_claim", "outbox.publish_claim"];
// Every public mutation is fenced on this predicate. Named here so the contract, the verifier and
// the SQL have to agree on one string rather than three descriptions of one.
export const FENCING_PREDICATE = "claim_token = CAST(:claim_token AS uuid)";
export const FENCED_MUTATION_APIS = ["release_claim", "publish_claim"];
// The identifier-only paths that are gone. A mutation that cannot see a token cannot tell the
// current claimant from a previous one, so there is no safe way to keep one of these around.
export const REMOVED_IDS_ONLY_APIS = ["release_batch", "mark_published"];
export const ACTIVATION_TAG_NAME = "kernel-runtime-substrate-s1-activated";
export const ACTIVATION_EVALUATOR_EXPORT = "evaluateExternalTagActivation";
export const ACTIVATION_REQUIRED_COMMANDS = [
  "npm test",
  "npm run check",
  "npm run check:substrate-s1:static",
  "npm run test:substrate-s1",
];
export const ACTIVATION_MESSAGE_FIELDS = [
  "packageId", "packageCommit", "independentVerification", "verifiedCommands", "results",
];
export const ACTIVATION_MESSAGE_HEADER = "KERNEL-RUNTIME-SUBSTRATE-S1-ACTIVATION";
// The artifact whose introduction on origin/main identifies the package commit, deterministically.
export const PACKAGE_MARKER_PATH = CONTRACT_PATH;
// Every remote lookup is bounded. An origin that will not answer must not hold the check open.
export const REMOTE_LOOKUP_TIMEOUT_MS = 15000;
// Production pins this. Tests inject their own expected remote so they can use a scratch origin.
export const CANONICAL_KERNEL_REMOTE = "git@github.com:metaframer-net/metaframer-kernel.git";
export const ACTIVATION_COMPOSITOR_MODULE = "tools/compose-current-effective.mjs";
export const ACTIVATION_COMPOSITOR_EXPORT = "composeCurrentEffective";
// The canonical flag is appBuildable, and it stays false. `appReady` is not a flag this project
// has; introducing one would be a way to claim readiness while leaving appBuildable honest.
export const FORBIDDEN_FLAG_NAMES = ["appReady"];

// The static toolchain has to be reproducible, which means pinned in the project and run from the
// resolved environment. `uvx` fetches whatever version it likes, so it is refused by name.
export const STATIC_SCRIPT = "check:substrate-s1:static";
export const STATIC_TOOL_NAMES = ["uv", "ruff", "compileall"];
export const EPHEMERAL_INVOCATIONS = ["uvx", "pipx", "pip install", "npx "];

// --- deterministic helpers -------------------------------------------------------------------
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
export const sha256 = (input) => createHash("sha256").update(input).digest("hex");
export const ABSOLUTE_PATH = /\/(Users|home|root|private|var|tmp|opt|mnt|srv)\//;
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const nonEmptyArray = (value) => Array.isArray(value) && value.length > 0;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- hardened git access ----------------------------------------------------------------------
const GIT_ENV = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" };
for (const key of [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_REPLACE_REF_BASE", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT",
  "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE", "GIT_CEILING_DIRECTORIES",
]) delete GIT_ENV[key];

const gitBuffer = (cwd, args) =>
  execFileSync("git", ["--no-replace-objects", "-C", cwd, ...args], {
    env: GIT_ENV, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
  });
export const git = (cwd, args) => gitBuffer(cwd, args).toString("utf8");

/** The pinned base must exist here as a real commit object, not merely as a ref name. */
export function validateKernelBase(root = ROOT, sha = KERNEL_BASE_SHA) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: "base-sha-malformed" };
  let resolved;
  try { resolved = git(root, ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`]).trim(); }
  catch { return { ok: false, reason: "base-commit-absent" }; }
  if (resolved !== sha) return { ok: false, reason: "base-commit-did-not-resolve-to-itself" };
  let type;
  try { type = git(root, ["cat-file", "-t", sha]).trim(); } catch { return { ok: false, reason: "base-object-unreadable" }; }
  if (type !== "commit") return { ok: false, reason: `base-object-not-a-commit:${type}` };
  return { ok: true, reason: null };
}

// --- pure evaluator ------------------------------------------------------------------------------
// Returns every reason it failed, so a submission cannot be repaired one hidden rejection at a time.
export function evaluateContract({ contract } = {}) {
  const errors = [];
  const push = (code) => errors.push(code);
  if (!contract || typeof contract !== "object") return { errors: ["contract-missing"], ok: false };

  if (canonicalJson(Object.keys(contract).sort()) !== canonicalJson([...CONTRACT_ROOT_KEYS].sort())) push("contract-root-key-drift");
  if (contract.id !== CONTRACT_ID) push("contract-id-drift");
  if (contract.packageKind !== PACKAGE_KIND) push("contract-package-kind-drift");
  if (contract.packageState !== PACKAGE_STATE) push("contract-package-state-drift");
  if (contract.packageMode !== "additive-non-destructive") push("contract-mode-drift");
  if (contract.phase !== PHASE) push("contract-phase-drift");

  const raw = JSON.stringify(contract);
  if (raw.includes("/worktrees/") || ABSOLUTE_PATH.test(raw)) push("contract-embeds-absolute-path");

  // No invented readiness flag. The forbidden names may be *named* — that is how they are declared
  // forbidden — but never asserted true, and never carried inside a state-bearing block.
  for (const name of FORBIDDEN_FLAG_NAMES) {
    if (new RegExp(`"${name}"\\s*:\\s*true`).test(raw)) push(`forbidden-flag-claimed-true:${name}`);
    for (const block of ["activationBase", "desiredState", "stateDelta", "phaseStatus"]) {
      if (Object.prototype.hasOwnProperty.call(contract[block] ?? {}, name)) {
        push(`forbidden-flag-in-state-block:${block}.${name}`);
      }
      if (Object.prototype.hasOwnProperty.call(contract[block]?.state ?? {}, name)) {
        push(`forbidden-flag-in-state-block:${block}.state.${name}`);
      }
    }
  }
  // The canonical readiness flag stays false wherever the contract states a position on it.
  for (const [block, value] of [
    ["activationBase", contract.activationBase?.state?.appBuildable],
    ["desiredState", contract.desiredState?.appBuildable],
  ]) {
    if (value !== false) push(`app-buildable-not-false:${block}`);
  }

  // --- authority binding: the exact existing authority and the exact pre-existing base ---------
  const ap = contract.authorityBinding?.actionplan ?? {};
  if (ap.repository !== ACTIONPLAN_REPO) push("authority-drift:repository");
  if (ap.commit !== ACTIONPLAN_SHA) push("authority-drift:commit");
  if (ap.headSeq !== ACTIONPLAN_HEAD_SEQ || ap.headId !== ACTIONPLAN_HEAD_ID) push("authority-drift:head");
  if (ap.verdict !== CURRENT_VERDICT) {
    push("authority-drift:verdict");
    if (OVERREACH_VERDICTS.includes(ap.verdict)) push(`verdict-overreach:${ap.verdict}`);
  }
  if (ap.mutationAllowed !== false) push("authority-drift:mutationAllowed");
  const base = contract.authorityBinding?.kernelBase ?? {};
  if (base.commit !== KERNEL_BASE_SHA) push("kernel-base-drift:commit");
  if (base.selfReferential !== false) push("kernel-base-self-referential");
  if (base.access !== "read-only") push("kernel-base-drift:access");
  if (base.rootPathRecorded !== false) push("kernel-base-path-recorded");
  if (contract.authorityBinding?.selfReferentialCommitShaRecorded !== false) push("self-referential-sha-recorded");

  // --- activation base: what is in force now, digest-pinned and never rewritten ----------------
  const activationBase = contract.activationBase ?? {};
  if (activationBase.artifact !== ACTIVATION_BASE_ARTIFACT) push("activation-base-drift:artifact");
  if (activationBase.verifier !== ACTIVATION_BASE_VERIFIER) push("activation-base-drift:verifier");
  if (!/^[0-9a-f]{64}$/.test(activationBase.artifactSha256 ?? "")) push("activation-base-drift:artifactSha256");
  if (!/^[0-9a-f]{64}$/.test(activationBase.verifierSha256 ?? "")) push("activation-base-drift:verifierSha256");
  if (activationBase.rewritten !== false) push("activation-base-rewritten");
  if (activationBase.mutationAllowed !== false) push("activation-base-mutable");
  for (const [key, value] of Object.entries(ACTIVATION_BASE_STATE)) {
    if (activationBase.state?.[key] !== value) push(`activation-base-state-drift:${key}`);
  }

  // --- desired state: exactly the desired shape, and never self-declared effective --------------
  const desired = contract.desiredState ?? {};
  if (desired.effective !== false) push("desired-state-declared-effective");
  for (const [key, value] of Object.entries(DESIRED_STATE)) {
    if (desired[key] !== value) push(`desired-state-drift:${key}`);
  }
  if (OVERREACH_VERDICTS.includes(desired.verdict)) push(`verdict-overreach:${desired.verdict}`);
  for (const flag of SHUT_FLAGS) if (desired[flag] !== false) push(`forbidden-true:${flag}`);

  // The delta must be exactly the one dimension, and must agree with both states it connects.
  const delta = contract.stateDelta ?? {};
  if (canonicalJson(delta.changedDimensions) !== canonicalJson(MOVED_DIMENSIONS)) push("state-delta-drift:changedDimensions");
  for (const dimension of MOVED_DIMENSIONS) {
    if (delta.from?.[dimension] !== ACTIVATION_BASE_STATE[dimension]) push(`state-delta-drift:from.${dimension}`);
    if (delta.to?.[dimension] !== DESIRED_STATE[dimension]) push(`state-delta-drift:to.${dimension}`);
  }
  const unchanged = delta.unchangedDimensions ?? [];
  for (const key of Object.keys(ACTIVATION_BASE_STATE)) {
    if (MOVED_DIMENSIONS.includes(key)) continue;
    if (!unchanged.includes(key)) push(`state-delta-drift:unchanged-missing.${key}`);
    if (activationBase.state?.[key] !== desired[key]) push(`state-delta-inconsistent:${key}`);
  }

  // --- bounded scope --------------------------------------------------------------------------
  const bounded = contract.boundedScope ?? {};
  if (bounded.database !== "PostgreSQL 16") push("bounded-scope-drift:database");
  if (bounded.language !== "Python 3.12") push("bounded-scope-drift:language");
  if (!/SQLAlchemy 2\.0/.test(bounded.orm ?? "")) push("bounded-scope-drift:orm");
  if (bounded.migrations !== "Alembic") push("bounded-scope-drift:migrations");
  if (!nonEmptyArray(bounded.capabilities)) push("bounded-scope-drift:capabilities");
  for (const forbidden of ["Prisma", "Next.js", "Supabase", "SQLite", "mock database", "in-memory database"]) {
    if (!(bounded.forbiddenTechnologies ?? []).includes(forbidden)) push(`forbidden-technology-not-declared:${forbidden}`);
  }

  // --- scope, non-goals, allowed targets, RED/GREEN, rollback -----------------------------------
  const scope = contract.scope ?? {};
  for (const field of ["summary", "sequenceId", "phaseAScope", "phaseBScope"]) {
    if (!nonEmptyString(scope[field])) push(`scope-missing:${field}`);
  }
  if (scope.sequenceId !== "postgresql-rls-transaction-outbox-audit-substrate") push("scope-sequence-drift");
  if (scope.sequenceOrder !== 1) push("scope-sequence-order-drift");
  // The runtime table list is pinned here, so a domain table cannot be added to it later.
  if (canonicalJson(scope.runtimeTables) !== canonicalJson(RUNTIME_TABLES)) push("runtime-table-set-drift");
  if (!nonEmptyString(scope.runtimeTablesNote)) push("scope-missing:runtimeTablesNote");
  if (!nonEmptyArray(contract.nonGoals)) push("non-goals-missing");
  if (!nonEmptyArray(contract.allowedTargets)) push("allowed-targets-missing");
  for (const target of ["db", "tests", "tools"]) {
    if (!(contract.allowedTargets ?? []).includes(target)) push(`allowed-target-missing:${target}`);
  }
  // The standing root fence, and the Phase A record kept explicitly as history.
  if (canonicalJson(contract.forbiddenAlways) !== canonicalJson(FORBIDDEN_ROOT_PATHS)) push("forbidden-always-drift");

  // The narrowed root-source topology, stated in the contract and closed on all four sides: the
  // permitted children cannot be widened or narrowed, the refused siblings cannot be dropped nor
  // can a permitted ring be pushed back among them, an unclassified first child cannot be
  // admitted, and the clause cannot claim authority over what lives beneath src/domain or
  // src/application — that depth belongs to a later package, not this one.
  const rootTopology = contract.rootSourceTopology;
  if (rootTopology === null || typeof rootTopology !== "object") push("root-source-topology-missing");
  else {
    if (canonicalJson(rootTopology.permittedFirstChildren) !== canonicalJson(ROOT_SRC_PERMITTED_CHILDREN)) {
      push("root-source-topology-drift:permittedFirstChildren");
    }
    if (canonicalJson(rootTopology.forbiddenFirstChildren) !== canonicalJson(ROOT_SRC_FORBIDDEN_CHILDREN)) {
      push("root-source-topology-drift:forbiddenFirstChildren");
    }
    if (rootTopology.unknownFirstChildRefused !== true) push("root-source-topology-admits-unknown-first-child");
    if (rootTopology.nestedContentClassified !== false) push("root-source-topology-overreaches-into-nested-content");
    if (!nonEmptyString(rootTopology.note)) push("root-source-topology-note-missing");
  }

  const phaseAFence = contract.forbiddenInPhaseA ?? {};
  if (phaseAFence.role !== "historical-phase-a-record") push("forbidden-phase-a-not-marked-historical");
  if (!nonEmptyArray(phaseAFence.paths)) push("forbidden-phase-a-paths-missing");
  if (!nonEmptyString(phaseAFence.note)) push("forbidden-phase-a-note-missing");

  const red = contract.red ?? {};
  if (red.phase !== "A") push("red-phase-drift");
  // RED is the record of what Phase A proved; GREEN is what Phase B must keep true. Labelling
  // them stops the Phase A exit criteria from reading as a claim about the package today.
  if (red.role !== "historical-phase-a-record") push("red-not-marked-historical");
  if (!nonEmptyString(red.statement)) push("red-statement-missing");
  if (!nonEmptyArray(red.provenBy)) push("red-proven-by-missing");
  if (!nonEmptyArray(red.notProvenBy)) push("red-not-proven-by-missing");
  if (!nonEmptyArray(red.exitCriteria)) push("red-exit-criteria-missing");
  const green = contract.green ?? {};
  if (green.phase !== "B") push("green-phase-drift");
  if (!nonEmptyString(green.statement)) push("green-statement-missing");
  if (green.notReachableFromPhaseA !== true) push("green-reachable-from-phase-a");
  if (!nonEmptyArray(green.exitCriteria)) push("green-exit-criteria-missing");
  if (green.role !== "current-phase-b-obligation") push("green-not-marked-current");

  const rollback = contract.rollback ?? {};
  for (const field of [
    "owner", "trigger", "action", "blastRadius", "runtimeDataImpact",
    "dependentCode", "reversibilityNote",
  ]) {
    if (!nonEmptyString(rollback[field])) push(`rollback-missing:${field}`);
  }
  if (rollback.owner !== "codex-master") push("rollback-owner-drift");
  // A substrate that owns an audit trail cannot be un-applied without destroying one. Once the
  // migration exists, a rollback block claiming no data impact is false, so it is refused here.
  if (/^none$/i.test(String(rollback.runtimeDataImpact ?? ""))) push("rollback-claims-no-data-impact");
  if (!/destructive/i.test(String(rollback.runtimeDataImpact ?? ""))) push("rollback-omits-destructive-warning");
  for (const table of RUNTIME_TABLES) {
    if (!String(rollback.runtimeDataImpact ?? "").includes(table)) {
      push(`rollback-data-impact-omits-table:${table}`);
    }
  }
  // The rollback has to name the actual mechanism, not a file revert alone.
  if (!/downgrade/i.test(String(rollback.action ?? ""))) push("rollback-action-omits-downgrade");

  // --- phase status: honest about what passing on a feature branch does and does not mean -------
  const status = contract.phaseStatus ?? {};
  for (const [key, value] of Object.entries({
    redSpecified: true, redProven: true, greenImplemented: true, greenSuitePassesOnThisBranch: true,
    // Neither of these may ever be self-asserted from here.
    greenIndependentlyVerified: false, externallyEffective: false,
  })) {
    if (status[key] !== value) push(`phase-status-drift:${key}`);
  }
  if (!nonEmptyString(status.note)) push("phase-status-missing-note");

  // --- production surface: exactly one substrate, and nothing beyond it -------------------------
  const surface = contract.productionSurface ?? {};
  if (surface.package !== PRODUCTION_PACKAGE) push("production-surface-drift:package");
  if (surface.importRoot !== PRODUCTION_IMPORT_ROOT) push("production-surface-drift:importRoot");
  if (surface.headRevision !== HEAD_REVISION) push("production-surface-drift:headRevision");
  if (surface.revisionCount !== 1) push("production-surface-drift:revisionCount");
  if (canonicalJson(surface.runtimeTables) !== canonicalJson(PHYSICAL_RUNTIME_TABLES)) {
    push("production-surface-drift:runtimeTables");
  }
  if (canonicalJson((surface.modules ?? []).map((m) => m?.path)) !== canonicalJson(PRODUCTION_MODULES)) {
    push("production-surface-drift:modules");
  }
  if (!nonEmptyArray(surface.supportObjects)) push("production-surface-missing:supportObjects");
  if (!nonEmptyArray(surface.notShipped)) push("production-surface-missing:notShipped");
  const mechanism = surface.tenantContextMechanism ?? {};
  for (const [key, value] of Object.entries({
    // The security claims, each stated as a checkable fact rather than as prose.
    secretInVersionControl: false,
    secretReadableByRuntimeRole: false,
    rawSettingSufficientForAccess: false,
    boundToTransaction: true,
    ownerExemptFromTenantFilter: false,
  })) {
    if (mechanism[key] !== value) push(`tenant-context-mechanism-drift:${key}`);
  }
  if (!nonEmptyString(mechanism.design)) push("tenant-context-mechanism-missing:design");
  // A mechanism that claims no residual risk is not being honest about a single-role substrate.
  if (!nonEmptyString(mechanism.residualRisk)) push("tenant-context-mechanism-missing:residualRisk");

  // --- capabilities: declared, complete, absent in Phase A and implemented in Phase B -----------
  const capabilities = contract.requiredCapabilities ?? [];
  if (canonicalJson(capabilities.map((c) => c?.id)) !== canonicalJson(REQUIRED_CAPABILITY_IDS)) push("capability-set-drift");
  for (const capability of capabilities) {
    for (const field of ["id", "target", "kind", "contract", "proves"]) {
      if (!nonEmptyString(capability?.[field])) push(`capability-missing-field:${capability?.id}.${field}`);
    }
    // Still true, and still recorded: this is what Phase A proved absent.
    if (capability?.absentInPhaseA !== true) push(`capability-not-declared-absent:${capability?.id}`);
    if (capability?.implementedInPhaseB !== true) push(`capability-not-implemented:${capability?.id}`);
    if (!nonEmptyString(capability?.implementedIn)) push(`capability-missing-field:${capability?.id}.implementedIn`);
    else if (!PRODUCTION_MODULES.includes(capability.implementedIn)) {
      push(`capability-implemented-outside-production-surface:${capability?.id}`);
    }
    if (!String(capability?.target ?? "").startsWith(`${PRODUCTION_IMPORT_ROOT}.`)) {
      push(`capability-target-outside-production-root:${capability?.id}`);
    }
    if (!String(capability?.target ?? "").includes(":")) push(`capability-target-malformed:${capability?.id}`);
  }

  // --- behavioural contract: behaviour-oriented, not file-presence-oriented ----------------------
  const behavioral = contract.behavioralContract ?? [];
  if (canonicalJson(behavioral.map((b) => b?.id)) !== canonicalJson(BEHAVIORAL_IDS)) push("behavioral-contract-drift");
  const capabilityIds = new Set(REQUIRED_CAPABILITY_IDS);
  for (const suite of behavioral) {
    if (!nonEmptyString(suite?.module)) push(`behavioral-missing-module:${suite?.id}`);
    if (!nonEmptyString(suite?.marker)) push(`behavioral-missing-marker:${suite?.id}`);
    // Every suite must state at least three observable behavioural assertions. A suite that only
    // says "the file exists" cannot satisfy this.
    if (!Array.isArray(suite?.assertions) || suite.assertions.length < 3) push(`behavioral-assertions-too-thin:${suite?.id}`);
    for (const assertion of suite?.assertions ?? []) {
      if (!nonEmptyString(assertion)) push(`behavioral-assertion-empty:${suite?.id}`);
      if (/^the file .* exists$/i.test(assertion)) push(`behavioral-assertion-file-presence-only:${suite?.id}`);
    }
    for (const required of suite?.requiresCapabilities ?? []) {
      if (!capabilityIds.has(required)) push(`behavioral-unknown-capability:${suite?.id}:${required}`);
    }
    const expected = suite?.id === PASSING_BEHAVIORAL_ID ? "pass" : "red-missing-capability";
    if (suite?.phaseAOutcome !== expected) push(`behavioral-phase-a-outcome-drift:${suite?.id}`);
    // A RED suite that requires no capability could never be RED for a capability reason.
    if (expected === "red-missing-capability" && !nonEmptyArray(suite?.requiresCapabilities)) {
      push(`behavioral-red-without-capability:${suite?.id}`);
    }
    // In Phase B every suite passes, including the ones that were the RED.
    if (suite?.phaseBOutcome !== "pass") push(`behavioral-phase-b-outcome-drift:${suite?.id}`);
  }
  // Every declared capability must actually be exercised by some behavioural suite.
  const exercised = new Set(behavioral.flatMap((s) => s?.requiresCapabilities ?? []));
  for (const id of REQUIRED_CAPABILITY_IDS) if (!exercised.has(id)) push(`capability-never-exercised:${id}`);
  // The negative-proof obligations are named explicitly, so they cannot be dropped silently.
  const rls = behavioral.find((s) => s?.id === "rls-isolation");
  const rlsAssertions = rls?.assertions ?? [];
  const negatives = rlsAssertions.filter((a) => /negative proof/i.test(a)).length;
  if (negatives < 5) push("rls-negative-proofs-too-thin");
  if (!rlsAssertions.some((a) => /FORCE/.test(a))) push("rls-force-not-asserted");
  if (!rlsAssertions.some((a) => /ENABLE/.test(a) && /FORCE/.test(a))) push("rls-enable-and-force-not-asserted");
  // Coverage must enumerate every runtime table, not spot-check one of them.
  for (const table of ["outbox", "audit"]) {
    if (!rlsAssertions.some((a) => new RegExp(`${table} table`, "i").test(a))) {
      push(`rls-runtime-table-not-covered:${table}`);
    }
  }
  // The forged-context proof: a runtime role writing the raw setting itself must gain nothing.
  const forged = rlsAssertions.find((a) => /forg/i.test(a));
  if (!forged) push("rls-forged-context-proof-missing");
  else {
    if (!/set_config/i.test(forged) || !/SET LOCAL/i.test(forged)) push("rls-forged-context-mechanisms-too-thin");
    if (!/attestation/i.test(forged)) push("rls-forged-context-attestation-not-required");
    if (!/outcome/i.test(forged)) push("rls-forged-context-not-outcome-oriented");
  }
  if (!rlsAssertions.some((a) => /invalid or empty/i.test(a))) push("rls-invalid-context-proof-missing");
  if (!rlsAssertions.some((a) => /fails closed/i.test(a) && /reads and writes/i.test(a))) {
    push("rls-fail-closed-must-deny-reads-and-writes");
  }

  const audit = behavioral.find((s) => s?.id === "audit-immutability");
  if (!(audit?.assertions ?? []).some((a) => /privileged invariant/i.test(a))) push("audit-privileged-invariant-missing");

  const transaction = behavioral.find((s) => s?.id === "transaction-atomicity");
  const transactionAssertions = transaction?.assertions ?? [];
  if (!transactionAssertions.some((a) => /SET LOCAL/.test(a))) push("transaction-set-local-not-asserted");
  if (transactionAssertions.filter((a) => /non-leakage/i.test(a)).length < 2) push("transaction-non-leakage-too-thin");
  // Atomicity is exercised against the substrate's own tables, both inside one boundary.
  for (const phrase of [/rolled back/i, /persisted/i]) {
    const matching = transactionAssertions.filter((a) => phrase.test(a));
    if (!matching.some((a) => /audit row/i.test(a) && /outbox row/i.test(a) && /one transaction boundary/i.test(a))) {
      push(`transaction-atomicity-not-over-runtime-tables:${phrase.source}`);
    }
  }

  const outbox = behavioral.find((s) => s?.id === "outbox-claim");
  const outboxAssertions = outbox?.assertions ?? [];
  if (!outboxAssertions.some((a) => /SKIP LOCKED/.test(a))) push("outbox-skip-locked-not-asserted");
  if (!outboxAssertions.some((a) => /tenant B/.test(a))) push("outbox-cross-tenant-not-asserted");
  // At-least-once is the guarantee. Non-overlap is scoped to a single claim attempt or lease.
  if (!outboxAssertions.some((a) => /at-least-once/i.test(a))) push("outbox-at-least-once-not-declared");
  if (!outboxAssertions.some((a) => /redeliver/i.test(a) && /permitted/i.test(a))) {
    push("outbox-redelivery-not-permitted");
  }
  if (!outboxAssertions.some((a) => /stable identifier/i.test(a) && /dedup/i.test(a))) {
    push("outbox-stable-identifier-not-declared");
  }
  const nonOverlap = outboxAssertions.find((a) => /same row/i.test(a));
  if (!nonOverlap) push("outbox-non-overlap-proof-missing");
  else if (!/(claim attempt|claim lease)/i.test(nonOverlap)) push("outbox-non-overlap-not-scoped-to-one-attempt");
  // Redelivery has to be exercised, not merely permitted in prose: a lease that expires without
  // the row being published must make it claimable again, or at-least-once is aspirational.
  const expiry = outboxAssertions.find((a) => /expires without/i.test(a));
  if (!expiry) push("outbox-expiry-reclaim-proof-missing");
  else {
    if (!/same identifier/i.test(expiry)) push("outbox-expiry-reclaim-loses-identifier");
    if (!/attempt count/i.test(expiry)) push("outbox-expiry-reclaim-omits-attempt-count");
  }
  if (!outboxAssertions.some((a) => /expired claim/i.test(a) && /tenant boundary/i.test(a))) {
    push("outbox-expiry-cross-tenant-proof-missing");
  }
  if (!outboxAssertions.some((a) => /published row/i.test(a) && /never handed out/i.test(a))) {
    push("outbox-published-row-reclaim-proof-missing");
  }
  const migration = behavioral.find((s) => s?.id === "migration-roundtrip");
  for (const token of [/upgrade/i, /downgrade/i, /re-upgrade/i]) {
    if (!(migration?.assertions ?? []).some((a) => token.test(a))) push(`migration-roundtrip-incomplete:${token.source}`);
  }

  // --- database lifecycle ---------------------------------------------------------------------
  const lifecycle = contract.databaseLifecycle ?? {};
  if (lifecycle.image !== LIFECYCLE_IMAGE) push("lifecycle-image-drift");
  if (lifecycle.majorVersion !== LIFECYCLE_MAJOR) push("lifecycle-major-version-drift");
  if (lifecycle.engine !== "docker") push("lifecycle-engine-drift");
  for (const flag of ["uniquelyNamedPerRun", "readinessPolled", "boundedTimeouts", "cleanedOnFailure"]) {
    if (lifecycle[flag] !== true) push(`lifecycle-guarantee-missing:${flag}`);
  }
  if (lifecycle.hostPsqlUsed !== false) push("lifecycle-host-psql-used");
  if (lifecycle.committedSecrets !== false) push("lifecycle-committed-secrets");
  if (!nonEmptyArray(lifecycle.readinessSignals)) push("lifecycle-readiness-signals-missing");
  if (!nonEmptyArray(lifecycle.cleanupMechanisms)) push("lifecycle-cleanup-mechanisms-missing");
  const roles = lifecycle.roles ?? {};
  if (roles.migration?.name !== MIGRATION_ROLE) push("lifecycle-migration-role-drift");
  if (roles.runtime?.name !== RUNTIME_ROLE) push("lifecycle-runtime-role-drift");
  // The whole point of the role split: the runtime role must be non-owner, non-superuser and
  // NOBYPASSRLS, or a FORCE RLS proof would be vacuous.
  for (const [flag, value] of Object.entries({ ownsDatabase: false, ownsSchema: false, superuser: false, bypassRls: false, createOnSchema: false })) {
    if (roles.runtime?.[flag] !== value) push(`runtime-role-drift:${flag}`);
  }
  for (const [flag, value] of Object.entries({ ownsDatabase: true, ownsSchema: true, superuser: false, bypassRls: false })) {
    if (roles.migration?.[flag] !== value) push(`migration-role-drift:${flag}`);
  }
  if (roles.migration?.name === roles.runtime?.name) push("roles-not-separated");

  // --- activation stays prepared on this branch ---------------------------------------------------
  const activation = contract.activation ?? {};
  if (activation.state !== PACKAGE_STATE) push("activation-state-drift");
  if (activation.effective !== false) push("activation-effective-on-branch");
  if (activation.deterministic !== true) push("activation-not-deterministic");
  if (activation.inRepoStatusFlipCommitRequired !== false) push("activation-status-flip-required");
  if (activation.selfReferentialCommitShaRecorded !== false) push("activation-self-sha-recorded");
  if (activation.activatedBy !== null || activation.effectiveFrom !== null) push("activation-preclaimed");
  if (canonicalJson((activation.predicates ?? []).map((p) => p?.id)) !== canonicalJson(ACTIVATION_PREDICATES)) push("activation-predicate-drift");
  for (const predicate of activation.predicates ?? []) {
    if (predicate?.satisfiedOnThisBranch !== false) push(`activation-predicate-satisfied-on-branch:${predicate?.id}`);
    if (predicate?.evaluator !== "codex-master") push(`activation-predicate-evaluator-drift:${predicate?.id}`);
    if (!nonEmptyString(predicate?.evidence)) push(`activation-predicate-evidence-missing:${predicate?.id}`);
  }

  // --- nothing invented: no verification, no countersign, no gate claim ------------------------------
  const verification = contract.independentVerification ?? {};
  if (verification.recorded !== false) push("independent-verification-invented");
  if (verification.inRepoEvidenceCreated !== false) push("independent-verification-evidence-invented");
  if (verification.writerMaySelfVerify !== false) push("writer-self-verification-allowed");
  if (verification.evaluator !== "codex-master") push("independent-verification-evaluator-drift");
  const countersign = contract.humanCountersign ?? {};
  if (countersign.recorded !== false) push("human-countersign-invented");
  if (countersign.required !== true) push("human-countersign-not-required");
  if (countersign.default !== false) push("human-countersign-default-drift");
  if (countersign.writerMayCountersign !== false) push("writer-countersign-allowed");
  const claims = contract.promotionClaims ?? {};
  if (claims.claimedVerdict !== null) push("promotion-verdict-claimed");
  if (nonEmptyArray(claims.claimedGates)) push("promotion-gate-claimed");
  for (const flag of ["claimsGate01", "claimsRuntimePilot", "claimsProduction"]) {
    if (claims[flag] !== false) push(`promotion-claim:${flag}`);
  }

  // --- preservation and check composition ---------------------------------------------------------
  const preservation = contract.preservation ?? {};
  if (preservation.rewritesHistoricalArtifacts !== false) push("historical-rewrite-declared");
  for (const file of READ_ONLY_FILES) {
    if (!(preservation.readOnly ?? []).includes(file)) push(`read-only-entry-missing:${file}`);
  }
  // --- static analysis: pinned, reproducible, and leaving nothing behind ------------------------
  const staticAnalysis = contract.staticAnalysis ?? {};
  if (staticAnalysis.script !== STATIC_SCRIPT) push("static-analysis-drift:script");
  if (!nonEmptyString(staticAnalysis.command)) push("static-analysis-drift:command");
  if (staticAnalysis.configuredIn !== "db/pyproject.toml") push("static-analysis-drift:configuredIn");
  if (staticAnalysis.packagePinned !== true) push("static-analysis-not-package-pinned");
  if (staticAnalysis.ephemeralToolInvocationAllowed !== false) push("static-analysis-allows-ephemeral-tools");
  if (staticAnalysis.cacheArtifactsWrittenIntoTree !== false) push("static-analysis-writes-cache-into-tree");
  if (!nonEmptyString(staticAnalysis.pinnedVersions?.ruff)) push("static-analysis-drift:pinnedVersions.ruff");
  const toolNames = [...new Set((staticAnalysis.tools ?? []).map((t) => t?.name))].sort();
  if (canonicalJson(toolNames) !== canonicalJson([...STATIC_TOOL_NAMES].sort())) push("static-analysis-tool-set-drift");
  for (const tool of staticAnalysis.tools ?? []) {
    for (const field of ["name", "role", "invocation", "pinnedIn"]) {
      if (!nonEmptyString(tool?.[field])) push(`static-analysis-tool-missing-field:${tool?.name}.${field}`);
    }
    // Every declared step must actually be in the command it claims to describe.
    if (nonEmptyString(tool?.invocation) && !String(staticAnalysis.command ?? "").includes(tool.invocation)) {
      push(`static-analysis-tool-not-in-command:${tool?.name}:${tool?.role}`);
    }
  }
  const command = String(staticAnalysis.command ?? "");
  for (const ephemeral of EPHEMERAL_INVOCATIONS) {
    if (command.includes(ephemeral)) push(`static-analysis-uses-ephemeral-tool:${ephemeral.trim()}`);
  }
  // Each Python step runs from the resolved environment, not from whatever is on PATH.
  const frozenRuns = (command.match(/uv run --frozen/g) ?? []).length;
  if (frozenRuns < 3) push(`static-analysis-unfrozen-runs:${frozenRuns}`);
  if (!command.includes("uv lock --check")) push("static-analysis-omits-lock-consistency-check");
  if (!command.includes("PYTHONPYCACHEPREFIX")) push("static-analysis-omits-cache-redirect");

  // --- RED follow-ups: specified and failing, never quietly marked done -------------------------
  const followUps = contract.redFollowUps ?? {};
  if (followUps.phase !== "GREEN") push("follow-ups-phase-drift");
  // The record of where they came from is kept: a follow-up that forgets it was RED loses the
  // evidence that its tests were written before the code that satisfies them.
  if (followUps.originallyRed !== true) push("follow-ups-forgot-their-red");
  if (followUps.implementationAuthorised !== true) push("follow-ups-authorisation-drift");
  if (!nonEmptyString(followUps.note)) push("follow-ups-missing-note");
  const gaps = followUps.gaps ?? [];
  if (canonicalJson(gaps.map((g) => g?.id)) !== canonicalJson(RED_FOLLOW_UP_IDS)) push("red-follow-up-set-drift");
  for (const gap of gaps) {
    for (const field of ["id", "kind", "module", "statement", "phaseRedOutcome"]) {
      if (!nonEmptyString(gap?.[field])) push(`red-follow-up-missing-field:${gap?.id}.${field}`);
    }
    if (!Array.isArray(gap?.assertions) || gap.assertions.length < 5) {
      push(`red-follow-up-assertions-too-thin:${gap?.id}`);
    }
    if (gap?.status !== "green") push(`follow-up-not-green:${gap?.id}`);
    if (gap?.phaseGreenOutcome !== "pass") push(`follow-up-green-outcome-drift:${gap?.id}`);
    // The RED outcome is retained as history; it records what the failing state was.
    if (!nonEmptyString(gap?.phaseRedOutcome)) push(`follow-up-forgot-red-outcome:${gap?.id}`);
    for (const capability of gap?.declaredCapabilities ?? []) {
      for (const field of ["id", "target", "kind", "contract", "proves"]) {
        if (!nonEmptyString(capability?.[field])) push(`red-capability-missing-field:${capability?.id}.${field}`);
      }
      if (capability?.implemented !== true) push(`follow-up-capability-not-implemented:${capability?.id}`);
      if (!nonEmptyString(capability?.implementedIn)) push(`follow-up-capability-missing-location:${capability?.id}`);
      if (REQUIRED_CAPABILITY_IDS.includes(capability?.id)) push(`red-capability-collides-with-shipped:${capability?.id}`);
    }
  }

  const fencing = gaps.find((g) => g?.id === "GAP1-outbox-claim-fencing") ?? {};
  const fencingIds = (fencing.declaredCapabilities ?? []).map((c) => c?.id);
  if (canonicalJson(fencingIds) !== canonicalJson(FENCING_CAPABILITY_IDS)) push("fencing-capability-set-drift");
  if (fencing.phaseRedOutcome !== "red-missing-capability") push("fencing-outcome-drift");
  // The fencing predicate is named here so the source cross-binding has something exact to check.
  if (fencing.fencingPredicate !== FENCING_PREDICATE) push("fencing-predicate-drift");
  if (fencing.idsOnlyMutationPathRemoved !== true) push("fencing-ids-only-path-retained");
  if (canonicalJson(fencing.removedApis) !== canonicalJson(REMOVED_IDS_ONLY_APIS)) push("fencing-removed-api-drift");
  if (canonicalJson(fencing.publicMutationApis) !== canonicalJson(FENCED_MUTATION_APIS)) push("fencing-public-api-drift");
  if (fencing.rowLevelSecurityRemainsDecisive !== true) push("fencing-rls-not-decisive");
  if (!nonEmptyString(fencing.boundaryNote)) push("fencing-boundary-note-missing");
  if (!nonEmptyArray(fencing.provableWithoutTheNewCapability)) push("fencing-control-assertions-missing");
  // The three proofs that make the fencing failure attributable rather than generic.
  for (const [code, pattern] of [
    ["stale-release", /stale claimant's fenced release/i],
    ["stale-publish", /stale claimant's fenced publish/i],
    ["cross-tenant", /never crosses the tenant boundary/i],
  ]) {
    if (!(fencing.assertions ?? []).some((a) => pattern.test(a))) push(`fencing-proof-missing:${code}`);
  }
  if (!(fencing.assertions ?? []).some((a) => /affects zero rows/i.test(a))) push("fencing-zero-rows-not-asserted");

  // --- the external tag is the activation record, and the writer never creates it ---------------
  const activation2 = gaps.find((g) => g?.id === "GAP2-external-tag-activation") ?? {};
  const authority = activation2.tagAuthority ?? {};
  if (authority.tagName !== ACTIVATION_TAG_NAME) push("activation-tag-name-drift");
  if (authority.tagType !== "annotated") push("activation-tag-type-drift");
  if (authority.createdBy !== "root-codex-master") push("activation-tag-authority-drift");
  for (const [flag, value] of Object.entries({
    writerMayCreate: false,
    writerMaySelfVerify: false,
    inRepoStatusFlipCommitRequired: false,
    selfReferentialCommitShaRecorded: false,
    lightweightTagAccepted: false,
    checkoutMustEqualExactOriginMain: true,
    remoteIdentityCheckRequired: true,
    targetMustBeAncestorOrEqualOfExactOriginMain: true,
    targetMustBeVerifiedPackageCommit: true,
  })) {
    if (authority[flag] !== value) push(`activation-tag-authority-drift:${flag}`);
  }
  if (canonicalJson(authority.requiredMessageFields) !== canonicalJson(ACTIVATION_MESSAGE_FIELDS)) {
    push("activation-tag-message-field-drift");
  }
  if (canonicalJson(authority.requiredVerifiedCommands) !== canonicalJson(ACTIVATION_REQUIRED_COMMANDS)) {
    push("activation-tag-command-set-drift");
  }
  if (authority.requiredIndependentVerification !== "root-codex") push("activation-tag-verifier-drift");
  if (authority.requiredResult !== "GREEN") push("activation-tag-result-drift");
  if (authority.requiredPackageId !== CONTRACT_ID) push("activation-tag-package-id-drift");
  // A local tag proves nothing about the project. The record is the tag object on the canonical
  // origin, confirmed by a bounded lookup whose failure means not-effective, never an error.
  if (authority.canonicalRemote !== CANONICAL_KERNEL_REMOTE) push("activation-canonical-remote-drift");
  for (const [flag, value] of Object.entries({
    tagMustBePublishedOnCanonicalOrigin: true,
    localOnlyTagAccepted: false,
    remoteTagObjectMustMatchLocal: true,
    remoteLookupIsBounded: true,
    remoteLookupFailureIsNotEffective: true,
    remoteLookupFailureIsNotATestFailure: true,
    expectedRemoteInjectableInTests: true,
  })) {
    if (authority[flag] !== value) push(`activation-remote-publication-drift:${flag}`);
  }
  if (!nonEmptyArray(activation2.rootProcedure)) push("activation-root-procedure-missing");
  if (!nonEmptyArray(activation2.invariantsUnderActivation)) push("activation-invariants-missing");
  if (!(activation2.rootProcedure ?? []).some((s) => /pushes the tag/i.test(s))) {
    push("activation-root-procedure-omits-publication");
  }
  const evaluator = activation2.evaluator ?? {};
  if (evaluator.export !== ACTIVATION_EVALUATOR_EXPORT) push("activation-evaluator-export-drift");
  if (evaluator.implemented !== true) push("activation-evaluator-not-implemented");
  if (!(evaluator.inputs ?? []).includes("expectedRemote")) push("activation-evaluator-missing-input:expectedRemote");
  if (activation2.phaseRedOutcome !== "red-missing-evaluator") push("activation-outcome-drift");

  // The reader is what turns a working tree into the evaluator's input, and its boundedness is the
  // property that keeps an unreachable origin from holding the check open or taking it down.
  const reader = activation2.reader ?? {};
  if (reader.export !== "readActivationFacts") push("activation-reader-export-drift");
  if (reader.implemented !== true) push("activation-reader-not-implemented");
  if (reader.nonInteractive !== true) push("activation-reader-interactive");
  if (reader.failureIsNotEffectiveNotAnException !== true) push("activation-reader-may-throw");
  if (!Number.isInteger(reader.boundedTimeoutMs) || reader.boundedTimeoutMs <= 0) {
    push("activation-reader-unbounded");
  }
  if (!nonEmptyString(reader.shortCircuitsBeforeAnyNetworkCall)) push("activation-reader-always-hits-network");
  if (!nonEmptyArray(reader.proves)) push("activation-reader-proves-nothing");
  for (const [code, pattern] of [
    ["origin-main", /refs\/remotes\/origin\/main/],
    ["remote-identity", /canonical origin/i],
    ["package-commit", /introduced the S1 artifact/i],
    ["tag-object", /local tag object/i],
    ["publication", /ls-remote/i],
  ]) {
    if (!(reader.proves ?? []).some((p) => pattern.test(p))) push(`activation-reader-missing-proof:${code}`);
  }

  // The compositor must wrap the activation base, never edit it.
  const wiring = activation2.checkWiring ?? {};
  if (wiring.script !== "check") push("activation-check-wiring-drift:script");
  if (!String(wiring.invocation ?? "").includes(ACTIVATION_COMPOSITOR_MODULE)) {
    push("activation-check-wiring-drift:compositor");
  }
  if (!String(wiring.invocation ?? "").includes(ACTIVATION_BASE_VERIFIER)) {
    push("activation-check-wiring-drift:activation-base");
  }
  if (wiring.activationBaseVerifierEdited !== false) push("activation-base-verifier-edited");
  if (wiring.activationBaseArtifactEdited !== false) push("activation-base-artifact-edited");

  // The compositor turns the evaluator's verdict into one authoritative line.
  const compositor = activation2.compositor ?? {};
  if (compositor.module !== ACTIVATION_COMPOSITOR_MODULE) push("activation-compositor-module-drift");
  if (compositor.export !== ACTIVATION_COMPOSITOR_EXPORT) push("activation-compositor-export-drift");
  if (compositor.implemented !== true) push("activation-compositor-not-implemented");
  if (compositor.consumes !== ACTIVATION_BASE_VERIFIER) push("activation-compositor-source-drift");
  if (compositor.consumedOutputIsImmutable !== true) push("activation-compositor-mutates-its-source");
  if (!nonEmptyArray(compositor.behaviour)) push("activation-compositor-behaviour-missing");
  // The count has to come from the emitted lines, not from something the compositor says about itself.
  if (!/counting the lines/i.test(String(compositor.assertedBy ?? ""))) {
    push("activation-compositor-count-self-reported");
  }
  for (const pattern of [/relabels/i, /exactly one final CURRENT EFFECTIVE/i]) {
    if (!(compositor.behaviour ?? []).some((b) => pattern.test(b))) {
      push(`activation-compositor-behaviour-missing:${pattern.source}`);
    }
  }
  // appBuildable stays false, and no readiness flag is invented to work around it.
  const forbiddenFlags = activation2.forbiddenFlags ?? {};
  for (const name of FORBIDDEN_FLAG_NAMES) {
    if (!nonEmptyString(forbiddenFlags[name])) push(`activation-forbidden-flag-not-declared:${name}`);
  }
  if (!nonEmptyString(forbiddenFlags.appBuildable)) push("activation-appbuildable-not-pinned-false");

  const composition = contract.checkComposition ?? {};
  if (composition.emitsCurrentEffectiveLine !== false) push("candidate-emits-current-effective-line");
  if (composition.emitsBranchCandidateLine !== true) push("candidate-omits-branch-candidate-line");
  // The compositor owns the final line; the consumer-sync verifier owns the activation base it is
  // composed from. Naming the wrong owner would send a reader to the wrong file to understand the
  // one line that matters.
  if (composition.finalCurrentEffectiveLineOwner !== ACTIVATION_COMPOSITOR_MODULE) {
    push("current-effective-owner-drift");
  }
  if (composition.activationBaseLineOwner !== ACTIVATION_BASE_VERIFIER) push("activation-base-owner-drift");

  return { errors, ok: errors.length === 0 };
}

// --- activation: the pure evaluator --------------------------------------------------------------
// Deterministic and total. Every input shape produces a verdict; none produces an exception. That
// matters most for the remote lookup: an origin that cannot be reached must be unable to activate
// the package, and equally unable to break the run that asked.

/** The state activation composes. Stronger flags stay false in both branches, by construction. */
export const ACTIVATION_STATE = Object.freeze({
  verdict: CURRENT_VERDICT,
  codeStartAllowed: true,
  runtimeCodeAllowed: true,
  runtimeImplementationStarted: false,
  kernelReady: false,
  sdkReady: false,
  appBuildable: false,
  releaseAllowed: false,
  deployAllowed: false,
  productionAllowed: false,
  gapClosed: false,
  inRepoStatusFlipCommitRequired: false,
  selfReferentialCommitShaRecorded: false,
  historicalArtifactsRewritten: false,
});

/**
 * Parse the strict structured tag message.
 *
 * The grammar is closed in both directions. A message is not merely required to contain what the
 * contract asks for; it is required to contain nothing else. Ignoring an unrecognised line would
 * let an activation record say more than the verifier reads, and a second value for a field the
 * verifier already checked is a contradiction rather than an override — either would make the tag
 * mean one thing to a human and another to this function.
 *
 * `ok: false` is a hard reject: the text is not a message. `issues` are well-formed lines that say
 * the wrong thing, and are reported by the caller alongside its own findings.
 */
export function parseActivationTagMessage(message) {
  const text = typeof message === "string" ? message : "";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const reject = (reason) => ({ ok: false, reason, fields: {}, issues: [] });

  if (lines.length === 0) return reject("tag-message-malformed:empty");
  if (lines[0] !== ACTIVATION_MESSAGE_HEADER) return reject("tag-message-malformed:header-missing");

  const body = lines.slice(1);
  if (body.length === 0) return reject("tag-message-malformed:no-fields");

  const fields = {};
  const issues = [];
  for (const line of body) {
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line);
    // A non-empty line that is not a field is not decoration; it is an unreadable message.
    if (!match) return reject("tag-message-malformed:unparsable-line");
    const [, key, value] = match;
    if (!ACTIVATION_MESSAGE_FIELDS.includes(key)) {
      issues.push(`tag-message-unknown-field:${key}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      // First value wins, and the contradiction is reported rather than silently resolved.
      issues.push(`tag-message-duplicate-field:${key}`);
      continue;
    }
    fields[key] = value;
  }
  return { ok: true, reason: null, fields, issues };
}

/**
 * The recorded command list must be the canonical sequence exactly: same commands, same order, no
 * extras. A superset would let an activation be recorded after running the required commands plus
 * something that changed the outcome, and order is recorded because the contract states one.
 */
export function evaluateVerifiedCommands(recordedValue) {
  const errors = [];
  const recorded = String(recordedValue ?? "")
    .split("|")
    .map((command) => command.trim())
    .filter(Boolean);
  for (const command of ACTIVATION_REQUIRED_COMMANDS) {
    if (!recorded.includes(command)) errors.push(`required-command-missing:${command}`);
  }
  for (const command of recorded) {
    if (!ACTIVATION_REQUIRED_COMMANDS.includes(command)) errors.push(`unexpected-command:${command}`);
  }
  const duplicates = recorded.filter((c, i) => recorded.indexOf(c) !== i);
  for (const command of new Set(duplicates)) errors.push(`duplicate-command:${command}`);
  if (errors.length === 0 && recorded.join("|") !== ACTIVATION_REQUIRED_COMMANDS.join("|")) {
    errors.push("verified-commands-not-in-canonical-order");
  }
  return errors;
}

export function evaluateExternalTagActivation(input = {}) {
  const errors = [];
  const push = (code) => errors.push(code);

  const expectedRemote = input?.expectedRemote ?? CANONICAL_KERNEL_REMOTE;
  const remote = input?.remote ?? {};
  const checkout = input?.checkout ?? {};
  const pkg = input?.package ?? {};
  const tag = input?.tag ?? null;

  // 1. Only an exact origin/main checkout can carry an activation. A feature branch never can,
  //    whatever tags happen to sit in its working copy.
  if (checkout.isExactOriginMain !== true) push("not-on-exact-origin-main");

  // 2. The remote must be this project's, and must have been checked rather than assumed.
  if (remote.identityVerified !== true) push("remote-identity-unverified");
  if (remote.url !== expectedRemote) push("remote-identity-mismatch");

  if (tag === null || tag === undefined) {
    push("tag-absent");
    return { effective: false, errors, state: { ...ACTIVATION_STATE } };
  }

  // 3. A lightweight tag is a bare ref with no object and no message; there is nothing to bind.
  if (tag.type !== "annotated") push("tag-not-annotated");
  if (tag.name !== ACTIVATION_TAG_NAME) push(`tag-name-mismatch:${tag.name}`);

  // 4. It must point at the package commit, and that commit must actually be on main.
  if (tag.targetCommit !== pkg.commit) push("tag-target-mismatch");
  if (tag.targetIsAncestorOrEqualOfOriginMain !== true) push("tag-target-not-ancestor-of-origin-main");

  // 5. The message binds what was verified, by whom, and with what result.
  const parsed = parseActivationTagMessage(tag.message);
  if (!parsed.ok) push(parsed.reason);
  else {
    for (const issue of parsed.issues) push(issue);
    for (const field of ACTIVATION_MESSAGE_FIELDS) {
      if (!(field in parsed.fields)) push(`tag-message-field-missing:${field}`);
    }
    if ("packageId" in parsed.fields && parsed.fields.packageId !== (pkg.id ?? CONTRACT_ID)) {
      push("tag-message-binding-drift:packageId");
    }
    if ("packageCommit" in parsed.fields && parsed.fields.packageCommit !== pkg.commit) {
      push("tag-message-binding-drift:packageCommit");
    }
    if (parsed.fields.independentVerification !== "root-codex") {
      push("independent-verification-not-root-codex");
    }
    if (parsed.fields.results !== "GREEN") push("results-not-green");
    for (const code of evaluateVerifiedCommands(parsed.fields.verifiedCommands)) push(code);
  }

  // 6. Publication. A tag nobody else can see is evidence about one machine, not about the project.
  //    Every way the lookup can fail to answer denies, and none of them throws.
  const lookup = tag.remoteLookup;
  if (lookup === "error") push("remote-tag-lookup-failed");
  else if (lookup === "timeout") push("remote-tag-lookup-timed-out");
  else if (lookup !== "ok" && lookup !== "absent") push(`remote-tag-lookup-failed:${String(lookup)}`);

  if (tag.remotePublished !== true) push("tag-not-published-on-canonical-origin");
  else if (tag.remoteTagObject === null || tag.remoteTagObject === undefined) {
    push("remote-tag-object-missing");
  } else if (tag.localTagObject != null && tag.remoteTagObject !== tag.localTagObject) {
    push("remote-tag-object-mismatch");
  }

  const effective = errors.length === 0;
  return {
    effective,
    errors,
    state: { ...ACTIVATION_STATE, runtimeImplementationStarted: effective },
  };
}

// --- activation: the bounded, fail-closed Git reader ----------------------------------------------
// Turns a working tree into the evaluator's input. Every git call is wrapped: a failure produces a
// missing fact, never an exception, because the caller's job is to report a verdict.

/** One bounded git call. Returns null instead of throwing, and never prompts. */
function tryGit(cwd, args, timeout = REMOTE_LOOKUP_TIMEOUT_MS) {
  try {
    return execFileSync("git", ["--no-replace-objects", "-C", cwd, ...args], {
      encoding: "utf8",
      env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 1 << 24,
    }).trim();
  } catch {
    return null;
  }
}

/** The bounded publication lookup. Distinguishes "said no" from "could not say". */
export function lookupPublishedTag(cwd, remoteUrl, tagName, timeout = REMOTE_LOOKUP_TIMEOUT_MS) {
  let output;
  try {
    output = execFileSync(
      "git",
      ["--no-replace-objects", "-C", cwd, "ls-remote", "--tags", "--", remoteUrl, `refs/tags/${tagName}`],
      {
        encoding: "utf8",
        env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        maxBuffer: 1 << 24,
      },
    );
  } catch (error) {
    // A timeout is worth telling apart from a refusal: one may be transient, the other is an answer.
    const timedOut = error?.killed === true || error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT";
    return { status: timedOut ? "timeout" : "error", object: null };
  }
  const line = output.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return { status: "absent", object: null };
  return { status: "ok", object: line.split(/\s+/)[0] };
}

/**
 * Read every fact the evaluator needs, from a real working tree.
 *
 * The order matters. The exact-origin/main test comes first and short-circuits, so a feature branch
 * never reaches the network at all — there is nothing a remote could say that would make a feature
 * branch effective, and asking would only be a way to be slow or to fail for the wrong reason.
 */
export function readActivationFacts({
  root = ROOT,
  expectedRemote = CANONICAL_KERNEL_REMOTE,
  tagName = ACTIVATION_TAG_NAME,
  packageId = CONTRACT_ID,
  timeout = REMOTE_LOOKUP_TIMEOUT_MS,
} = {}) {
  const head = tryGit(root, ["rev-parse", "HEAD"]);
  const originMain = tryGit(root, ["rev-parse", "--verify", "--end-of-options", "refs/remotes/origin/main"]);
  const branch = tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // Both halves are required. HEAD equality alone is not enough: a feature branch that has not yet
  // diverged has the same HEAD as origin/main, and treating that as "on main" would let work in
  // progress be mistaken for the merged result. Detached HEAD at origin/main is the other
  // legitimate shape, which is what a verification checkout looks like.
  const onMain = branch === "main" || branch === "HEAD";
  const isExactOriginMain = Boolean(head && originMain && head === originMain && onMain);
  const remoteUrl = tryGit(root, ["remote", "get-url", "origin"]);

  const facts = {
    expectedRemote,
    remote: { url: remoteUrl, identityVerified: remoteUrl === expectedRemote },
    checkout: { commit: head, isExactOriginMain, branch },
    package: { id: packageId, commit: null },
    tag: null,
    lookupPerformed: false,
  };

  // Nothing below can rescue a checkout that is not exact origin/main, so stop here and stay local.
  if (!isExactOriginMain) return facts;

  // The package commit is derived, not declared: the commit that introduced the S1 artifact on
  // origin/main. Deterministic, and impossible for a tag to assert its way around.
  const introduced = tryGit(root, [
    "log", "--diff-filter=A", "--format=%H", "--reverse",
    "refs/remotes/origin/main", "--", PACKAGE_MARKER_PATH,
  ]);
  facts.package.commit = introduced ? introduced.split("\n")[0].trim() : null;

  const localTagObject = tryGit(root, ["rev-parse", "--verify", "--end-of-options", `refs/tags/${tagName}`]);
  if (!localTagObject) return facts;

  const objectType = tryGit(root, ["cat-file", "-t", localTagObject]);
  const targetCommit = tryGit(root, ["rev-list", "-n", "1", `refs/tags/${tagName}`]);
  const message = objectType === "tag" ? tryGit(root, ["tag", "-l", "--format=%(contents)", tagName]) : null;
  const ancestor =
    targetCommit && originMain
      ? tryGit(root, ["merge-base", "--is-ancestor", targetCommit, originMain]) !== null
      : false;

  const published = lookupPublishedTag(root, expectedRemote, tagName, timeout);
  facts.lookupPerformed = true;
  facts.tag = {
    name: tagName,
    type: objectType === "tag" ? "annotated" : "lightweight",
    targetCommit,
    targetIsAncestorOrEqualOfOriginMain: ancestor,
    message,
    localTagObject,
    remotePublished: published.status === "ok",
    remoteTagObject: published.object,
    remoteLookup: published.status,
  };
  return facts;
}

/** Read the working tree and evaluate it in one step. Never throws. */
export function resolveActivation(options = {}) {
  try {
    const facts = readActivationFacts(options);
    return { ...evaluateExternalTagActivation(facts), facts };
  } catch (error) {
    // Belt and braces: a verdict is always producible, even if reading somehow failed.
    return {
      effective: false,
      errors: [`activation-read-failed:${error?.code ?? "unknown"}`],
      state: { ...ACTIVATION_STATE },
      facts: null,
    };
  }
}

// --- repository-side checks ----------------------------------------------------------------------

/** Prove, rather than assert, that no historical artifact was rewritten by this package. */
export function checkNoHistoricalRewrite(root = ROOT, sha = KERNEL_BASE_SHA) {
  const errors = [];
  for (const file of READ_ONLY_FILES) {
    const full = path.join(root, file);
    if (!existsSync(full)) { errors.push(`read-only-file-missing:${file}`); continue; }
    let atBase;
    try { atBase = gitBuffer(root, ["show", "--no-textconv", `${sha}:${file}`]); }
    catch { errors.push(`read-only-file-unreadable-at-base:${file}`); continue; }
    if (sha256(readFileSync(full)) !== sha256(atBase)) errors.push(`historical-artifact-rewritten:${file}`);
  }
  return errors;
}

// The shared rule reports the four absent root paths as `forbidden-root-path-present:`. This
// package has always named them `fenced-root-path-present:`, and its recorded findings and messages
// keep that spelling; only the decision is shared, not the wording.
const SHARED_ROOT_PATH_FINDING = "forbidden-root-path-present:";
const PACKAGE_ROOT_PATH_FINDING = "fenced-root-path-present:";

/**
 * The production surface is exactly one substrate package, in exactly one place.
 *
 * The repository-root topology holds in every phase, and is decided by the shared reader: the four
 * fenced root paths must be absent, and a root `src` — permitted now, and this checkout now
 * materializes `src/domain` for P-M1-01 and `src/application` for P-M1-02 — may hold those two
 * inner rings and nothing else. A forbidden or unclassified first child is named in its own
 * finding. Nothing beneath `src/domain` or `src/application` is classified here.
 *
 * Inside db/, the package must exist with the modules it declares and no second copy of itself, and
 * the revision tree must hold exactly the one cohesive revision — a second revision file appearing
 * without the contract's revisionCount moving with it is drift, not progress.
 */
export function checkProductionSurface(root = ROOT) {
  const errors = [];
  for (const finding of checkRootTopology(root)) {
    errors.push(
      finding.startsWith(SHARED_ROOT_PATH_FINDING)
        ? `${PACKAGE_ROOT_PATH_FINDING}${finding.slice(SHARED_ROOT_PATH_FINDING.length)}`
        : finding,
    );
  }
  for (const relative of FORBIDDEN_PACKAGE_PATHS) {
    if (existsSync(path.join(root, relative))) errors.push(`forbidden-package-path-present:${relative}`);
  }
  for (const relative of PRODUCTION_MODULES) {
    const full = path.join(root, relative);
    if (!existsSync(full)) errors.push(`production-module-missing:${relative}`);
    else if (!statSync(full).isFile()) errors.push(`production-module-not-a-file:${relative}`);
  }
  // Exactly one home for the package: a second copy anywhere under db/ would mean two substrates.
  const homes = [];
  const walk = (dir, relative, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".pytest_cache") continue;
      if (!entry.isDirectory()) continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.name === PRODUCTION_IMPORT_ROOT) homes.push(rel);
      else walk(path.join(dir, entry.name), rel, depth + 1);
    }
  };
  if (existsSync(path.join(root, "db"))) walk(path.join(root, "db"), "db", 0);
  if (homes.length !== 1 || homes[0] !== PRODUCTION_PACKAGE) {
    errors.push(`production-package-homes:${homes.join(",") || "none"}`);
  }

  const versions = path.join(root, REVISIONS_DIR);
  if (!existsSync(versions)) errors.push(`revisions-directory-missing:${REVISIONS_DIR}`);
  else {
    const revisions = readdirSync(versions, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
      .map((entry) => entry.name)
      .sort();
    if (revisions.length !== 1) errors.push(`revision-count:${revisions.length}:${revisions.join(",")}`);
    else if (revisions[0] !== `${HEAD_REVISION}.py`) errors.push(`revision-name-drift:${revisions[0]}`);
  }
  return errors;
}

/**
 * Cross-bind the contract to the production source it describes.
 *
 * Digests and declarations are cheap; agreement is not. The head revision and the two physical
 * table names are read out of the Python that actually defines them, so a contract that drifts
 * from the code it documents fails here rather than being believed.
 */
export function checkSourceCrossBinding(root = ROOT) {
  const errors = [];
  const read = (relative) => {
    try { return readFileSync(path.join(root, relative), "utf8"); } catch { return null; }
  };

  const migrations = read("db/metaframer_kernel_db/migrations.py");
  if (migrations === null) errors.push("source-unreadable:db/metaframer_kernel_db/migrations.py");
  else if (!new RegExp(`HEAD_REVISION\\s*:\\s*Final\\s*=\\s*"${HEAD_REVISION}"`).test(migrations)) {
    errors.push(`head-revision-not-declared-in-source:${HEAD_REVISION}`);
  }

  const revision = read(`${REVISIONS_DIR}/${HEAD_REVISION}.py`);
  if (revision === null) errors.push(`source-unreadable:${REVISIONS_DIR}/${HEAD_REVISION}.py`);
  else {
    if (!new RegExp(`^revision\\s*=\\s*"${HEAD_REVISION}"`, "m").test(revision)) {
      errors.push("revision-id-mismatch");
    }
    // The baseline must be the first revision: a down_revision would mean it is not a baseline.
    if (!/^down_revision\s*=\s*None/m.test(revision)) errors.push("baseline-revision-has-a-predecessor");
    // Both runtime tables must carry ENABLE and FORCE, and the audit trail its append-only trigger.
    for (const fragment of ["ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY"]) {
      if (!revision.includes(fragment)) errors.push(`revision-missing:${fragment}`);
    }
    if (!/FOR EACH STATEMENT EXECUTE FUNCTION mfk_audit_append_only/.test(revision)) {
      errors.push("revision-missing:audit-append-only-statement-trigger");
    }
    if (!/gen_random_bytes\(32\)/.test(revision)) errors.push("revision-missing:per-database-secret");
  }

  const schema = read("db/metaframer_kernel_db/schema.py");
  if (schema === null) errors.push("source-unreadable:db/metaframer_kernel_db/schema.py");
  else {
    for (const table of PHYSICAL_RUNTIME_TABLES) {
      if (!schema.includes(`"${table}"`)) errors.push(`runtime-table-not-declared-in-source:${table}`);
    }
    // A third runtime table would be a domain sneaking in.
    const declared = schema.match(/^RUNTIME_TABLES\s*:\s*Final\s*=\s*\(([^)]*)\)/m);
    if (!declared) errors.push("runtime-table-tuple-not-declared-in-source");
    else if ((declared[1].match(/[A-Z_]+/g) ?? []).length !== PHYSICAL_RUNTIME_TABLES.length) {
      errors.push(`runtime-table-count-in-source:${declared[1].trim()}`);
    }
  }

  const outbox = read("db/metaframer_kernel_db/outbox.py");
  if (outbox === null) errors.push("source-unreadable:db/metaframer_kernel_db/outbox.py");
  else {
    if (!/FOR UPDATE SKIP LOCKED/.test(outbox)) errors.push("claim-not-skip-locked");
    // Both fenced mutations must carry the token predicate, in the SQL itself. Counting them keeps
    // one of the two from being quietly loosened while the other stays honest.
    const fenced = (outbox.match(new RegExp(escapeRegExp(FENCING_PREDICATE), "g")) ?? []).length;
    if (fenced < FENCED_MUTATION_APIS.length) {
      errors.push(`fencing-predicate-missing:${fenced}-of-${FENCED_MUTATION_APIS.length}`);
    }
    for (const api of FENCED_MUTATION_APIS) {
      if (!new RegExp(`^def ${api}\\(.*claim_token`, "m").test(outbox)) {
        errors.push(`fenced-api-takes-no-token:${api}`);
      }
    }
    // A mutation without a token must refuse rather than default to something.
    if (!/claim_token is None/.test(outbox)) errors.push("fenced-api-accepts-absent-token");
    // Both arms of the claim predicate: never-claimed, and claimed-but-expired.
    if (!/claimed_at IS NULL OR claim_expires_at <= now\(\)/.test(outbox)) {
      errors.push("claim-cannot-reclaim-an-expired-lease");
    }
    if (!/published_at IS NULL/.test(outbox)) errors.push("claim-may-reclaim-a-published-row");
  }

  // Partial-index predicates must be immutable. A predicate mentioning now() would be rejected by
  // PostgreSQL outright, and one that slipped through would silently rot as time passed.
  if (revision !== null) {
    // Table names are interpolated, so an index reads as `CREATE INDEX {OUTBOX_TABLE}_suffix`.
    const predicates = [...revision.matchAll(/CREATE (?:UNIQUE )?INDEX[\s\S]{0,400}?WHERE ([^\n]+)/g)]
      .map((match) => match[1]);
    for (const predicate of predicates) {
      if (/\b(now|clock_timestamp|current_timestamp|statement_timestamp)\s*\(/i.test(predicate)) {
        errors.push(`index-predicate-is-volatile:${predicate.trim()}`);
      }
    }
    if (predicates.length === 0) errors.push("revision-has-no-partial-index-predicates");
    if (!/CREATE INDEX \{OUTBOX_TABLE\}_expired_claims/.test(revision)) {
      errors.push("revision-missing:expired-claim-index");
    }
    if (!/CREATE INDEX \{OUTBOX_TABLE\}_unclaimed/.test(revision)) {
      errors.push("revision-missing:unclaimed-index");
    }
  }

  return errors;
}

/**
 * Ban two substantive claims from the contract and the test suite alike.
 *
 * A `record_table` would mean a domain/business table invented inside a package that has no
 * domain. An `exactly-once` promise would overstate a transactional outbox: a crash or an expired
 * claim lease legitimately redelivers a row, so the honest guarantee is at-least-once plus a
 * stable identifier for downstream deduplication. Scanning the tests as well as the contract keeps
 * the two from drifting apart — a test that quietly reintroduces either claim fails the check.
 */
export function checkForbiddenTokens(root = ROOT) {
  const errors = [];
  const inspect = (file, relative) => {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { return; }
    for (const { id, pattern } of FORBIDDEN_TOKENS) {
      if (pattern.test(text)) errors.push(`forbidden-token:${id}:${relative}`);
    }
  };
  const walk = (dir, relative, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".pytest_cache") continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, depth + 1);
      else if (/\.(py|json)$/.test(entry.name)) inspect(path.join(dir, entry.name), rel);
    }
  };
  for (const target of TOKEN_SCANNED_GLOBS) {
    const full = path.join(root, target);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full, target, 0);
    else inspect(full, target);
  }
  return errors;
}

/**
 * Bind the declared static command to the three files that have to agree with it.
 *
 * The contract can say the toolchain is pinned; that is worth nothing unless the script really is
 * the one declared, the linter really is in the lock at the declared version, and the dependency
 * really is in the project rather than fetched on the fly. Each of those is checked against the
 * file that owns it, so any of them drifting fails the run rather than being taken on trust.
 */
export function checkStaticAnalysisWiring(contract, root = ROOT) {
  const errors = [];
  const declared = contract?.staticAnalysis ?? {};

  let pkg;
  try { pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")); }
  catch { return ["static-analysis-package-json-unreadable"]; }
  const actual = pkg?.scripts?.[declared.script ?? STATIC_SCRIPT];
  if (!actual) errors.push(`static-analysis-script-missing:${declared.script ?? STATIC_SCRIPT}`);
  else if (actual !== declared.command) errors.push("static-analysis-command-drift");

  // The linter must be a project dependency, at the exact version the contract pins.
  const pyproject = (() => {
    try { return readFileSync(path.join(root, "db/pyproject.toml"), "utf8"); } catch { return null; }
  })();
  if (pyproject === null) errors.push("static-analysis-pyproject-unreadable");
  else {
    if (!/^\s*"ruff[><=]/m.test(pyproject)) errors.push("ruff-not-a-declared-dependency");
    if (!/^\[tool\.ruff\]/m.test(pyproject)) errors.push("ruff-not-configured-in-pyproject");
  }

  const lock = (() => {
    try { return readFileSync(path.join(root, "db/uv.lock"), "utf8"); } catch { return null; }
  })();
  if (lock === null) errors.push("static-analysis-lock-unreadable");
  else {
    const resolved = /name = "ruff"\nversion = "([^"]+)"/.exec(lock);
    if (!resolved) errors.push("ruff-not-resolved-in-lock");
    else if (resolved[1] !== declared.pinnedVersions?.ruff) {
      errors.push(`ruff-version-drift:lock=${resolved[1]}:contract=${declared.pinnedVersions?.ruff}`);
    }
  }
  return errors;
}

/** Every declared behavioural suite must exist as a real test module. */
export function checkBehavioralModules(contract, root = ROOT) {
  const errors = [];
  for (const suite of contract?.behavioralContract ?? []) {
    if (!nonEmptyString(suite?.module)) continue;
    const full = path.join(root, "db", suite.module);
    if (!existsSync(full)) { errors.push(`behavioral-module-missing:db/${suite.module}`); continue; }
    if (!statSync(full).isFile()) errors.push(`behavioral-module-not-a-file:db/${suite.module}`);
  }
  return errors;
}

/**
 * A follow-up's declaration must match what the repository actually contains.
 *
 * The check runs in whichever direction the contract points. While a follow-up was RED it refused
 * an implementation that had quietly appeared; now that both are GREEN it refuses a declaration of
 * work that is not there. Either way the contract cannot describe a repository it is not looking at.
 */
export function checkRedFollowUps(contract, root = ROOT) {
  const errors = [];
  const gaps = contract?.redFollowUps?.gaps ?? [];
  const read = (relative) => {
    try { return readFileSync(path.join(root, relative), "utf8"); } catch { return null; }
  };

  for (const gap of gaps) {
    if (!nonEmptyString(gap?.module)) continue;
    // Python suites live under db/; Node suites are repository-level.
    const candidates = gap.module.endsWith(".mjs") ? [gap.module] : [path.join("db", gap.module)];
    const found = candidates.find((relative) => existsSync(path.join(root, relative)));
    if (!found) errors.push(`red-follow-up-module-missing:${candidates[0]}`);
    else if (!statSync(path.join(root, found)).isFile()) {
      errors.push(`red-follow-up-module-not-a-file:${found}`);
    }
  }

  // Each declared capability must be present exactly where the contract says it is.
  for (const capability of gaps.flatMap((g) => g?.declaredCapabilities ?? [])) {
    const attribute = String(capability?.target ?? "").split(":")[1];
    if (!attribute) continue;
    const source = nonEmptyString(capability?.implementedIn) ? read(capability.implementedIn) : null;
    const defined = source !== null && new RegExp(`^def ${attribute}\\b`, "m").test(source);
    if (capability?.implemented === true && !defined) {
      errors.push(`follow-up-capability-absent:${capability.id}`);
    }
    if (capability?.implemented === false && defined) {
      errors.push(`red-capability-already-implemented:${capability.id}`);
    }
  }

  // No identifier-only mutation path may survive alongside the fenced ones.
  const outbox = read("db/metaframer_kernel_db/outbox.py");
  if (outbox !== null) {
    for (const removed of REMOVED_IDS_ONLY_APIS) {
      if (new RegExp(`^def ${removed}\\b`, "m").test(outbox)) {
        errors.push(`ids-only-mutation-path-present:${removed}`);
      }
    }
  }

  const self = read(path.relative(root, fileURLToPath(import.meta.url)));
  const declaredEvaluator = gaps.find((g) => g?.evaluator)?.evaluator;
  if (declaredEvaluator && self !== null) {
    const present = new RegExp(`export function ${declaredEvaluator.export}\\b`).test(self);
    if (declaredEvaluator.implemented === true && !present) {
      errors.push(`follow-up-evaluator-absent:${declaredEvaluator.export}`);
    }
    if (declaredEvaluator.implemented === false && present) {
      errors.push(`red-evaluator-already-implemented:${declaredEvaluator.export}`);
    }
  }
  const declaredReader = gaps.find((g) => g?.reader)?.reader;
  if (declaredReader?.implemented === true && self !== null) {
    if (!new RegExp(`export function ${declaredReader.export}\\b`).test(self)) {
      errors.push(`follow-up-reader-absent:${declaredReader.export}`);
    }
  }

  const declaredCompositor = gaps.find((g) => g?.compositor)?.compositor;
  if (declaredCompositor && nonEmptyString(declaredCompositor.module)) {
    const source = read(declaredCompositor.module);
    if (declaredCompositor.implemented === true) {
      if (source === null) errors.push(`follow-up-compositor-absent:${declaredCompositor.module}`);
      else if (!new RegExp(`export function ${declaredCompositor.export}\\b`).test(source)) {
        errors.push(`follow-up-compositor-export-absent:${declaredCompositor.export}`);
      }
    } else if (source !== null) {
      errors.push(`red-compositor-already-implemented:${declaredCompositor.module}`);
    }
  }
  return errors;
}

/**
 * The declared hazard, checked here first so it is diagnosable.
 *
 * The activation-base verifier fails closed on any filename matching /epoch/i anywhere in the
 * repository. The Python virtual environment sits inside that walk, so a dependency shipping such
 * a filename would trip a governance check for a reason that has nothing to do with governance.
 * Reporting it here, by its real cause, upholds that check instead of bypassing it.
 */
export function checkDependencyFilenameCollision(root = ROOT) {
  const errors = [];
  const venv = path.join(root, "db", ".venv");
  if (!existsSync(venv)) return errors;
  const walk = (dir, relative, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, depth + 1);
      else if (/epoch/i.test(entry.name)) errors.push(`dependency-filename-collides-with-historical-evidence-fence:${rel}`);
    }
  };
  walk(venv, "db/.venv", 0);
  return errors;
}

// --- CLI ---------------------------------------------------------------------------------------
export function main(root = ROOT) {
  const failures = [];
  const contractFile = path.join(root, CONTRACT_PATH);
  if (!existsSync(contractFile)) {
    console.error(`FAIL runtime-substrate-s1-contract-missing: ${CONTRACT_PATH}`);
    return 1;
  }
  let contract;
  try { contract = JSON.parse(readFileSync(contractFile, "utf8")); }
  catch (error) {
    console.error(`FAIL runtime-substrate-s1-contract-unparsable: ${error.message}`);
    return 1;
  }

  failures.push(...evaluateContract({ contract }).errors);

  const baseVerdict = validateKernelBase(root);
  if (!baseVerdict.ok) failures.push(`kernel-base-unverified:${baseVerdict.reason}`);

  // The digests the contract pins for the activation base must be the bytes actually on disk.
  for (const [relative, recorded] of [
    [ACTIVATION_BASE_ARTIFACT, contract.activationBase?.artifactSha256],
    [ACTIVATION_BASE_VERIFIER, contract.activationBase?.verifierSha256],
  ]) {
    const full = path.join(root, relative);
    if (!existsSync(full)) { failures.push(`activation-base-file-missing:${relative}`); continue; }
    if (sha256(readFileSync(full)) !== recorded) failures.push(`activation-base-digest-drift:${relative}`);
  }

  failures.push(...checkNoHistoricalRewrite(root));
  failures.push(...checkProductionSurface(root));
  failures.push(...checkSourceCrossBinding(root));
  failures.push(...checkBehavioralModules(contract, root));
  failures.push(...checkRedFollowUps(contract, root));
  failures.push(...checkStaticAnalysisWiring(contract, root));
  failures.push(...checkForbiddenTokens(root));
  failures.push(...checkDependencyFilenameCollision(root));

  if (failures.length > 0) {
    console.error(`FAIL kernel-runtime-substrate-s1: ${failures.length} finding(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }

  const capabilities = contract.requiredCapabilities.length;
  const suites = contract.behavioralContract.length;
  console.log(
    `OK kernel-runtime-substrate-s1: base ${KERNEL_BASE_SHA.slice(0, 7)} verified as a git commit object; ` +
    `${READ_ONLY_FILES.length} historical artifacts byte-identical to that base; ` +
    `activation base digest-pinned; phase ${PHASE} with ${capabilities} capabilities implemented in ` +
    `${PRODUCTION_PACKAGE} at revision ${HEAD_REVISION}; ` +
    `${PHYSICAL_RUNTIME_TABLES.length} runtime tables under ENABLE+FORCE row-level security; ` +
    `${suites} behavioural suites declared; static toolchain pinned ` +
    `(ruff ${contract.staticAnalysis.pinnedVersions.ruff}) and bound to npm run ${STATIC_SCRIPT}; ` +
    `${contract.redFollowUps.gaps.length} follow-ups implemented and cross-bound to their source.`,
  );
  // Deliberately a *candidate* line, not a current-effective one: this branch is not in force, and
  // the single authoritative current-effective summary belongs to the compositor
  // that runs immediately after this one.
  const desired = contract.desiredState;
  console.log(
    `BRANCH CANDIDATE (not effective; desired state on external activation, not the state in force): ` +
    `phase=${contract.phase} packageState=${contract.packageState} ` +
    `verdict=${desired.verdict} codeStartAllowed=${desired.codeStartAllowed} ` +
    `runtimeCodeAllowed=${desired.runtimeCodeAllowed} ` +
    `runtimeImplementationStarted=${desired.runtimeImplementationStarted} ` +
    `kernelReady=${desired.kernelReady} sdkReady=${desired.sdkReady} appBuildable=${desired.appBuildable} ` +
    `releaseAllowed=${desired.releaseAllowed} deployAllowed=${desired.deployAllowed} ` +
    `productionAllowed=${desired.productionAllowed} gapClosed=${desired.gapClosed} ` +
    `movedDimensions=${MOVED_DIMENSIONS.join(",")} promotionGateClaimed=none`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
