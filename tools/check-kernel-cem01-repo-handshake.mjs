#!/usr/bin/env node
// Fail-closed oracle for the M4 CEM-01 repository handshake overlay.
//
// This overlay is additive and passive: it records the CEM-01 target schema, the mandatory
// RED set and the externally-evaluated activation predicates, and it never self-declares
// cem01Active, paneClaudeExecutionMasterAllowed or cem01RepoHandshakePrepared true. Importing
// this module has no side effects; the CLI runs only under the main guard at the end.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OVERLAY_PATH = "planning/kernel-cem01-repo-handshake.json";

export const ROOT_AUTHORIZED_CREATORS = ["codex-desktop-master"];
export const RED_SET = [
  "self-declared-master",
  "child-lease-without-parent-envelope",
  "scope-base-allowed-files-expansion",
  "expired-nonce-or-lease",
  "create-submit-while-guardian-auth-policy-red",
  "second-active-writer",
  "delegation-depth-gt-1",
  "root-capability-mint-attempt",
  "worker-delegation-attempt",
  "reviewer-write-request",
];
export const ACTIVATION_PREDICATES = [
  "artifact-present-on-kernel-main",
  "npm-test-passes-on-kernel-main",
  "npm-run-check-passes-on-kernel-main",
  "independent-reviewer-accept-recorded",
];

const canonicalJson = (value) => JSON.stringify(value);

// Each returns every reason it failed, so a submission cannot be repaired one hidden
// rejection at a time.
export function evaluateOverlay({ overlay } = {}) {
  const errors = [];
  const push = (code) => errors.push(code);
  if (!overlay || typeof overlay !== "object") return { errors: ["overlay-missing"], ok: false };

  if (overlay.packageState !== "prepared-awaiting-main-activation") push("overlay-package-state-drift");
  if (overlay.overlayMode !== "additive-passive") push("overlay-mode-drift");

  const cem01 = overlay.cem01 ?? {};
  if (canonicalJson(cem01.authorizedRootCreators) !== canonicalJson(ROOT_AUTHORIZED_CREATORS)) push("root-authorized-creators-widened");
  if (cem01.rootAuthorizer !== "chatgpt-codex-governance-master") push("root-authorizer-drift");
  if (cem01.verifiedDelegate !== "pane-claude-execution-master") push("verified-delegate-drift");
  if (cem01.delegateProvider !== "claude") push("delegate-provider-drift");
  if (cem01.broker !== "narrower-child-lease-only") push("broker-drift");
  if (cem01.delegateCapabilityMintAllowed !== false) push("delegate-capability-mint-allowed");
  if (cem01.directRunpaneByDelegateAllowed !== false) push("direct-runpane-by-delegate-allowed");
  if (cem01.selfDeclaredActorSufficient !== false) push("self-declared-actor-sufficient");
  if (cem01.rootAuthorizationActorSeparation !== true) push("root-authorization-actor-separation-dropped");
  if (cem01.delegateWorkerProviderSeparation !== false) push("delegate-worker-provider-separation-overclaimed");
  if (cem01.independentReviewSessionSeparation !== true) push("independent-review-session-separation-dropped");
  if (cem01.rootContainment !== false) push("root-containment-overclaimed");

  const fields = overlay.targetFields ?? {};
  if (fields.cem01Prepared !== true) push("cem01-prepared-not-recorded");
  if (fields.cem01Active !== false) push("cem01-active-preclaimed");
  if (fields.cem01RepoHandshakePrepared !== false) push("repo-handshake-prepared-preclaimed");
  if (fields.paneClaudeExecutionMasterAllowed !== false) push("execution-master-preclaimed");
  if (fields.rootAuthorizedCreatorsUnchanged !== true) push("root-authorized-creators-unchanged-not-recorded");

  if (canonicalJson(overlay.redSet) !== canonicalJson(RED_SET)) push("red-set-incomplete");

  const act = overlay.activation ?? {};
  if (act.state !== "prepared-awaiting-main-activation") push("activation-state-drift");
  if (act.effective !== false) push("activation-effective-on-branch");
  if (act.deterministic !== true) push("activation-not-deterministic");
  const predicateIds = (act.predicates ?? []).map((p) => p?.id);
  if (canonicalJson(predicateIds) !== canonicalJson(ACTIVATION_PREDICATES)) push("activation-predicate-drift");
  for (const predicate of act.predicates ?? []) {
    if (predicate?.satisfiedOnThisBranch !== false) push(`activation-predicate-satisfied-on-branch:${predicate?.id}`);
  }

  return { errors, ok: errors.length === 0 };
}

// Deterministic function of external predicates only; never accepts a self-declared effective
// overlay as evidence.
export function evaluateActivation({ overlay, predicates = {} } = {}) {
  const errors = [];
  if (overlay?.activation?.effective === true) errors.push("activation-self-declared-effective");
  for (const key of Object.keys(predicates)) if (!ACTIVATION_PREDICATES.includes(key)) errors.push(`activation-unknown-predicate:${key}`);
  const unsatisfied = ACTIVATION_PREDICATES.filter((id) => predicates[id] !== true);
  const status = errors.length === 0 && unsatisfied.length === 0 ? "effective" : "prepared-awaiting-main-activation";
  return { status, errors, unsatisfied };
}

export function main(root = ROOT) {
  const overlayFile = path.join(root, OVERLAY_PATH);
  if (!existsSync(overlayFile)) {
    console.error(`FAIL cem01-handshake-overlay-missing: ${OVERLAY_PATH}`);
    return 1;
  }
  const overlay = JSON.parse(readFileSync(overlayFile, "utf8"));
  const { errors } = evaluateOverlay({ overlay });
  if (errors.length > 0) {
    console.error(`FAIL kernel-cem01-repo-handshake: ${errors.length} finding(s)`);
    for (const failure of errors) console.error(`  - ${failure}`);
    return 1;
  }
  const fields = overlay.targetFields;
  console.log(`OK kernel-cem01-repo-handshake: overlay is additive-passive and structurally sound.`);
  console.log(
    `CEM01 STATE: cem01Prepared=${fields.cem01Prepared} cem01Active=${fields.cem01Active} ` +
    `cem01RepoHandshakePrepared=${fields.cem01RepoHandshakePrepared} ` +
    `paneClaudeExecutionMasterAllowed=${fields.paneClaudeExecutionMasterAllowed} ` +
    `rootAuthorizedCreatorsUnchanged=${fields.rootAuthorizedCreatorsUnchanged} ` +
    `packageState=${overlay.packageState}`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
