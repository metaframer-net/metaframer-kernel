import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Repository identity is derived here, never read from a recorded absolute path.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayPath = "planning/kernel-runtime-pilot-consumer-sync.json";
const verifierPath = "tools/check-kernel-runtime-pilot-consumer-sync.mjs";

const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
const {
  ACTIONPLAN_REPO, ACTIONPLAN_SHA, AUTHORITY_ANCHOR_SHA, HISTORICAL_ACTIONPLAN_SHA, KERNEL_SHA,
  CONTRACT_REF, CONTRACT_SHA256, CHAIN_REF, CHAIN_SHA256, STATE_REF, STATE_SHA256,
  GATE_SET_SHA256, GATE_DEFINITIONS, GATE_IDS, CLASSIFICATIONS, PRESERVED_FILES,
  CURRENT_VERDICT, PROMOTION_VERDICT, FORBIDDEN_VERDICT, ACTIVATION_PREDICATES,
  canonicalJson, freezeDigest, sha256, normaliseRemote,
  validateActionplanCandidate, discoverActionplanRoot, readCanonicalAt,
  evaluateOverlay, evaluateCrossBindings, evaluateActivation, evaluateGate01,
  classifyLaterTopic, evaluatePromotionClaim, checkPreservedFiles, findEpochEvidence,
} = verifier;

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const overlay = await readJson(overlayPath);

// The canonical documents are read exactly as production reads them: by git show at the exact
// pinned commit, from a checkout admitted on repository identity and commit object alone.
const { root: apRoot } = discoverActionplanRoot({ base: root });
assert.ok(apRoot, `canonical ${ACTIONPLAN_REPO} checkout carrying ${ACTIONPLAN_SHA} was not discoverable`);
const canonical = {
  contract: JSON.parse(readCanonicalAt(apRoot, CONTRACT_REF).toString("utf8")),
  chain: JSON.parse(readCanonicalAt(apRoot, CHAIN_REF).toString("utf8")),
  state: JSON.parse(readCanonicalAt(apRoot, STATE_REF).toString("utf8")),
};

const clone = (value) => structuredClone(value);
const setPath = (target, dotted, value) => {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
  return target;
};
const mutatedOverlay = (dotted, value) => setPath(clone(overlay), dotted, value);

// =====================================================================================
// Presence and positive semantics
// =====================================================================================

test("the current-authority consumer overlay and its verifier exist", () => {
  for (const relativePath of [overlayPath, verifierPath]) {
    assert.ok(existsSync(path.join(root, relativePath)), `consumer-sync-package-missing: ${relativePath}`);
  }
});

test("importing the verifier has no side effects and exposes the pure evaluators", () => {
  for (const name of [
    "evaluateOverlay", "evaluateCrossBindings", "evaluateActivation", "evaluateGate01",
    "classifyLaterTopic", "evaluatePromotionClaim", "validateActionplanCandidate",
    "discoverActionplanRoot", "readCanonicalAt", "main",
  ]) {
    assert.equal(typeof verifier[name], "function", `${name} must be exported as a pure helper`);
  }
});

test("the overlay satisfies every structural invariant", () => {
  const { errors, ok } = evaluateOverlay({ overlay });
  assert.deepEqual(errors, [], "overlay must have no structural findings");
  assert.equal(ok, true);
});

// Remotes that keep the owner/repo tail but move the host, the scheme or the path prefix. Each
// of these would pass a last-two-segments normalisation, which is exactly the gap being closed.
const forgedRemotes = [
  ["a same owner/repo tail on an evil host", "https://evil.example/karacaismail/actionplan.git"],
  ["an evil host over SSH", "git@evil.example:karacaismail/actionplan.git"],
  ["a file URL", "file:///tmp/karacaismail/actionplan.git"],
  ["a local filesystem path", "/tmp/karacaismail/actionplan"],
  ["an extra path prefix under the canonical host", "https://github.com/mirror/karacaismail/actionplan.git"],
  ["the canonical host spelled as userinfo", "https://github.com@evil.example/karacaismail/actionplan.git"],
  ["the canonical host as an SSH user", "ssh://github.com@evil.example/karacaismail/actionplan.git"],
  ["embedded credentials", "https://karacaismail:token@github.com/karacaismail/actionplan.git"],
  ["a host suffix confusion", "git@github.com.evil.example:karacaismail/actionplan.git"],
  ["a host prefix confusion", "https://notgithub.com/karacaismail/actionplan.git"],
  ["a subdomain confusion", "https://github.com.evil.example/karacaismail/actionplan.git"],
  ["an explicit port", "https://github.com:8443/karacaismail/actionplan.git"],
  ["a downgraded scheme", "http://github.com/karacaismail/actionplan.git"],
  ["a git protocol remote", "git://github.com/karacaismail/actionplan.git"],
  ["a query string", "https://github.com/karacaismail/actionplan.git?upstream=evil.example"],
  ["a fragment", "https://github.com/karacaismail/actionplan.git#evil"],
  ["a trailing path traversal", "https://github.com/karacaismail/actionplan.git/../../evil"],
];

test("remote identity is host plus exact owner and repository, not a matching tail", () => {
  // The three canonical forms, with and without the .git suffix.
  for (const canonicalRemote of [
    "git@github.com:karacaismail/actionplan.git",
    "git@github.com:karacaismail/actionplan",
    "https://github.com/karacaismail/actionplan.git",
    "https://github.com/karacaismail/actionplan",
    "ssh://git@github.com/karacaismail/actionplan.git",
  ]) {
    assert.equal(normaliseRemote(canonicalRemote), ACTIONPLAN_REPO, `${canonicalRemote} must be admissible`);
    const parsed = verifier.parseGitHubRemote(canonicalRemote);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.host, "github.com");
    assert.equal(parsed.owner, "karacaismail");
    assert.equal(parsed.repo, "actionplan");
  }

  // Every forged remote is refused outright: null is a refusal, never a comparable value.
  for (const [name, remote] of forgedRemotes) {
    assert.equal(normaliseRemote(remote), null, `${name} must be refused: ${remote}`);
    assert.equal(verifier.parseGitHubRemote(remote).ok, false, `${name} must not parse`);
  }
  // A canonical remote for a different repository parses but is not this repository.
  assert.equal(normaliseRemote("git@github.com:attacker/actionplan.git"), "attacker/actionplan");
  assert.notEqual(normaliseRemote("git@github.com:attacker/actionplan.git"), ACTIONPLAN_REPO);
  // Non-string and empty remotes are refused rather than coerced.
  for (const bad of [null, undefined, 42, "", "   "]) assert.equal(normaliseRemote(bad), null);
});

test("Actionplan identity is the repository and the exact commit object, never a path or a ref", () => {
  assert.equal(normaliseRemote("git@github.com:karacaismail/actionplan.git"), ACTIONPLAN_REPO);
  assert.equal(overlay.sourceIdentity.actionplan.repository, ACTIONPLAN_REPO);
  assert.equal(overlay.sourceIdentity.actionplan.remote, "git@github.com:karacaismail/actionplan.git");
  assert.equal(overlay.sourceIdentity.actionplan.commit, ACTIONPLAN_SHA);
  assert.equal(overlay.sourceIdentity.actionplan.localPathIsIdentity, false);
  assert.equal(overlay.sourceIdentity.actionplan.localPathRole, "discovery-hint-only");
  assert.equal(overlay.sourceIdentity.actionplan.mutableRefResolutionRequired, false);

  // The commit resolves to itself as a commit object, without consulting any mutable ref.
  assert.deepEqual(validateActionplanCandidate(apRoot, ACTIONPLAN_SHA), { ok: true, reason: null });
  assert.deepEqual(validateActionplanCandidate(apRoot, AUTHORITY_ANCHOR_SHA), { ok: true, reason: null });
  // No absolute path is embedded anywhere in the overlay.
  const raw = JSON.stringify(overlay);
  assert.ok(!raw.includes(root), "overlay must not embed the kernel worktree root");
  assert.ok(!raw.includes("/worktrees/"), "overlay must not embed a worktree path");
});

test("every pinned canonical blob is byte-exact at the pinned commit", () => {
  for (const [ref, digest] of [[CONTRACT_REF, CONTRACT_SHA256], [CHAIN_REF, CHAIN_SHA256], [STATE_REF, STATE_SHA256]]) {
    assert.equal(sha256(readCanonicalAt(apRoot, ref)), digest, `${ref} is not byte-exact at ${ACTIONPLAN_SHA}`);
  }
  // The chain is byte-identical at the contract's authority anchor commit and at the pinned commit.
  assert.equal(sha256(readCanonicalAt(apRoot, CHAIN_REF, AUTHORITY_ANCHOR_SHA)), CHAIN_SHA256);
  const digests = overlay.sourceIdentity.canonicalDigests;
  assert.equal(digests.CONTRACT.sha256, CONTRACT_SHA256);
  assert.equal(digests.CHAIN.sha256, CHAIN_SHA256);
  assert.equal(digests.STATE.sha256, STATE_SHA256);
});

test("the overlay is cross-bound to the content of the canonical documents, not only their digests", () => {
  const { errors, ok } = evaluateCrossBindings({ overlay, ...canonical });
  assert.deepEqual(errors, [], "cross-binding must have no findings");
  assert.equal(ok, true);

  // Content, read from the pinned blobs themselves.
  assert.equal(canonical.chain.chainHeadSeq, 4);
  assert.equal(canonical.chain.entries.at(-1).epochId, "AUTHORITY-SUPERSESSION-04");
  assert.equal(canonical.chain.entries.at(-1).status, "effective");
  assert.equal(canonical.chain.effectiveAuthorityBoundary.verdict, CURRENT_VERDICT);
  assert.ok(canonical.chain.entries.at(-1).normalizedText.includes("RUNTIME_IMPLEMENTATION_START=NO"));
  assert.equal(canonical.state.gate.verdict, CURRENT_VERDICT);
  assert.equal(canonical.state.gate.gapClosed, false);
  assert.equal(canonical.contract.currentStatus.gates.find((g) => g.id === "GRP-01").status, "RED");
  assert.equal(canonical.contract.authorityBinding.kernelCommit, KERNEL_SHA);
});

test("the historical NO_GO candidate stays historical, immutable and non-effective", () => {
  const historical = overlay.historicalSnapshot;
  assert.equal(historical.role, "historical-immutable-non-effective");
  assert.equal(historical.effective, false);
  assert.equal(historical.mutationAllowed, false);
  assert.equal(historical.rewritten, false);
  assert.equal(historical.actionplanCommit, HISTORICAL_ACTIONPLAN_SHA);
  assert.equal(historical.verdict, "NO-GO");
  assert.equal(historical.kernelLocalVerdictToken, "NO_GO");
  assert.equal(historical.readinessStatus, "BLOCKED");
  assert.equal(historical.codeStartAllowed, false);
  assert.equal(historical.runtimeCodeAllowed, false);
  assert.equal(historical.supersededBy, "AUTHORITY-SUPERSESSION-04");
  // The stale chain digest is disclosed as the predecessor by the canonical chain itself.
  assert.equal(canonical.chain.supersessionProjection.predecessorChainFileSha256, historical.chainFileSha256);
  assert.equal(canonical.chain.supersessionProjection.predecessorChainFileSource, `actionplan@${HISTORICAL_ACTIONPLAN_SHA}`);
  assert.notEqual(historical.chainFileSha256, CHAIN_SHA256, "the stale digest must never be the current one");
});

test("exactly one verdict is effective now and every downstream stage stays shut", () => {
  const current = overlay.currentEffectiveAuthority;
  assert.equal(current.effectiveVerdictCount, 1);
  assert.equal(current.verdict, CURRENT_VERDICT);
  assert.equal(current.codeStartAllowed, true);
  assert.equal(current.runtimeCodeAllowed, true);
  for (const flag of [
    "runtimeImplementationStarted", "kernelReady", "sdkReady", "appBuildable",
    "releaseAllowed", "deployAllowed", "productionAllowed", "gapClosed",
  ]) {
    assert.equal(current[flag], false, `${flag} must stay false`);
  }
  assert.equal(overlay.promotionContractBinding.claimsRuntimePilot, false);
  assert.equal(overlay.promotionContractBinding.claimsProduction, false);
  assert.equal(overlay.promotionContractBinding.claimedVerdict, null);
});

test("the frozen ten-gate set and the closed later-topic policy are preserved", () => {
  const binding = overlay.promotionContractBinding;
  assert.equal(binding.gates.length, 10);
  assert.deepEqual(binding.gates.map((g) => g.id), GATE_IDS);
  assert.equal(canonicalJson(binding.gates.map((g) => [g.order, g.id, g.definition])), canonicalJson(GATE_DEFINITIONS));
  assert.equal(binding.gateSetSha256, GATE_SET_SHA256);
  assert.equal(freezeDigest(binding.gates), GATE_SET_SHA256, "the frozen digest must reproduce from the gate triples");
  assert.equal(binding.gateAdditionAllowed, false);
  assert.deepEqual(binding.laterTopicPolicy.classifications, CLASSIFICATIONS);
  assert.equal(binding.laterTopicPolicy.newGateAllowed, false);
  assert.deepEqual(binding.promotionRule, {
    requiredGreenGates: 10, requiresIndependentVerifier: true, requiresHumanCountersign: true,
    humanCountersignDefault: false, writerMaySelfClose: false, writerMaySelfVerify: false,
    targetVerdict: PROMOTION_VERDICT, impliesProduction: false,
  });
  assert.equal(binding.productionPolicy.separatePostPilotStage, true);
  assert.equal(binding.productionPolicy.reachableFromRuntimePilot, false);
});

test("the Onion contract is inward, backend-only, and Surface and AI/infra sit outer", () => {
  const onion = overlay.architectureContract.onion;
  assert.equal(onion.appliesTo, "code-bearing-backend-and-archetype-only");
  assert.equal(onion.dependencyDirection, "inward");
  assert.deepEqual(onion.layers.map((l) => l.name), ["Domain", "Application", "Adapters", "Delivery"]);
  assert.deepEqual(onion.layers.find((l) => l.name === "Domain").dependsOn, []);
  assert.deepEqual(onion.layers.find((l) => l.name === "Application").dependsOn, ["Domain"]);
  assert.deepEqual(onion.layers.find((l) => l.name === "Adapters").dependsOn, ["Application"]);
  assert.deepEqual(onion.layers.find((l) => l.name === "Delivery").dependsOn, ["Adapters"]);
  const outer = Object.fromEntries(onion.outerMembers.map((m) => [m.name, m]));
  assert.equal(outer.Surface.layer, "Delivery");
  assert.equal(outer["ai-agent-adapter"].layer, "Adapters");
  assert.equal(outer["infrastructure-adapter"].layer, "Adapters");
  for (const member of onion.outerMembers) assert.equal(member.outer, true);
});

test("the meta-framework axes are separate from the Onion and never layers", () => {
  const axes = overlay.architectureContract.metaFrameworkAxes;
  assert.deepEqual(axes.map((a) => a.axis), [
    "wbs-metaphor", "lifecycle-phases", "prompts", "multi-agent", "evidence", "governance", "planes",
  ]);
  for (const axis of axes) {
    assert.equal(axis.isOnionLayer, false, `${axis.axis} must not be an Onion layer`);
    assert.ok(!["Domain", "Application", "Adapters", "Delivery"].includes(axis.axis));
  }
  assert.deepEqual(axes.find((a) => a.axis === "lifecycle-phases").members, [
    "requirements", "test-plan", "db-schema", "development", "test-qa", "verification", "release-maintenance",
  ]);
  assert.deepEqual(axes.find((a) => a.axis === "planes").members, ["control", "data", "ai"]);
});

test("the next runtime-start package is separate, ordered and fully specified", () => {
  const next = overlay.nextRuntimeStartPackage;
  assert.equal(next.separatePackage, true);
  assert.equal(next.startsRuntimeInThisPackage, false);
  assert.equal(next.thisPackageStartsNoRuntime, true);
  assert.deepEqual(next.sequence.map((s) => s.id), [
    "postgresql-rls-transaction-outbox-audit-substrate",
    "kernel-primitives-typed-action-pdp",
    "generated-sdk",
    "one-golden-slice",
  ]);
  next.sequence.forEach((step, index) => {
    assert.equal(step.order, index + 1, `${step.id} is out of order`);
    for (const field of ["scope", "red", "green", "rollback"]) {
      assert.equal(typeof step[field], "string");
      assert.ok(step[field].length > 0, `${step.id}.${field} must be specified`);
    }
    for (const field of ["nonGoals", "allowedTargetAreas", "exitCriteria"]) {
      assert.ok(Array.isArray(step[field]) && step[field].length > 0, `${step.id}.${field} must be specified`);
    }
  });
  // The substrate comes first and the golden slice last; SDK never precedes primitives.
  const order = next.sequence.map((s) => s.id);
  assert.ok(order.indexOf("postgresql-rls-transaction-outbox-audit-substrate") < order.indexOf("kernel-primitives-typed-action-pdp"));
  assert.ok(order.indexOf("kernel-primitives-typed-action-pdp") < order.indexOf("generated-sdk"));
  assert.ok(order.indexOf("generated-sdk") < order.indexOf("one-golden-slice"));
});

test("the preserved planning set stays byte-faithful and no EPOCH evidence is created", () => {
  assert.deepEqual(checkPreservedFiles(root), [], "preserved files must be byte-identical");
  assert.deepEqual(findEpochEvidence(root), [], "no EPOCH evidence file may exist in this repository");
  const recorded = Object.fromEntries(overlay.preservation.byteFaithful.map((e) => [e.path, e.sha256]));
  assert.deepEqual(recorded, PRESERVED_FILES);
  assert.equal(overlay.preservation.historicalEpochEvidence.rule, "absent");
  assert.equal(overlay.preservation.historicalEpochEvidence.expectedMatches, 0);
});

// =====================================================================================
// Adversarial: overlay mutations
// =====================================================================================

const overlayAttacks = [
  ["an added root key", () => ({ ...clone(overlay), extra: true }), "overlay-root-key-drift"],
  ["a package declared already effective", () => mutatedOverlay("packageState", "effective"), "overlay-package-state-drift"],

  ["a stale Actionplan commit", () => mutatedOverlay("sourceIdentity.actionplan.commit", HISTORICAL_ACTIONPLAN_SHA), "actionplan-identity-drift:commit"],
  ["a forged Actionplan remote", () => mutatedOverlay("sourceIdentity.actionplan.remote", "git@github.com:attacker/actionplan.git"), "actionplan-identity-drift:remote"],
  ["a local path promoted to identity", () => mutatedOverlay("sourceIdentity.actionplan.localPathIsIdentity", true), "actionplan-path-trusted"],
  ["a path role widened beyond a hint", () => mutatedOverlay("sourceIdentity.actionplan.localPathRole", "identity"), "actionplan-path-trusted"],
  ["a mutable ref made a precondition", () => mutatedOverlay("sourceIdentity.actionplan.mutableRefResolutionRequired", true), "actionplan-mutable-ref-required"],
  ["an embedded absolute path", () => mutatedOverlay("sourceIdentity.actionplan.note", "checkout at /Users/someone/actionplan"), "overlay-embeds-absolute-path"],
  ["a drifted canonical digest", () => mutatedOverlay("sourceIdentity.canonicalDigests.CONTRACT.sha256", "0".repeat(64)), "canonical-digest-drift:CONTRACT.sha256"],
  ["a missing canonical digest entry", () => { const o = clone(overlay); delete o.sourceIdentity.canonicalDigests.STATE; return o; }, "canonical-digest-key-drift"],
  ["a drifted kernel commit", () => mutatedOverlay("sourceIdentity.kernel.commit", "0".repeat(40)), "kernel-commit-drift"],

  ["a historical snapshot made effective", () => mutatedOverlay("historicalSnapshot.effective", true), "historical-snapshot-effective"],
  ["a historical snapshot made mutable", () => mutatedOverlay("historicalSnapshot.mutationAllowed", true), "historical-snapshot-mutable"],
  ["a rewritten historical verdict", () => mutatedOverlay("historicalSnapshot.verdict", CURRENT_VERDICT), "historical-verdict-drift"],
  ["a rewritten historical NO_GO token", () => mutatedOverlay("historicalSnapshot.kernelLocalVerdictToken", "GO"), "historical-verdict-token-drift"],
  ["a tampered historical artifact digest", () => mutatedOverlay("historicalSnapshot.artifacts.0.sha256", "0".repeat(64)), "historical-artifact-digest-drift:planning/kernel-ai-development-readiness.json"],

  ["a GO-RUNTIME-PILOT claim as current verdict", () => mutatedOverlay("currentEffectiveAuthority.verdict", PROMOTION_VERDICT), `verdict-overreach:${PROMOTION_VERDICT}`],
  ["a GO-PRODUCTION claim as current verdict", () => mutatedOverlay("currentEffectiveAuthority.verdict", FORBIDDEN_VERDICT), `verdict-overreach:${FORBIDDEN_VERDICT}`],
  ["a closed code-start floor", () => mutatedOverlay("currentEffectiveAuthority.codeStartAllowed", false), "code-start-not-open"],
  ["a closed runtime-code floor", () => mutatedOverlay("currentEffectiveAuthority.runtimeCodeAllowed", false), "runtime-code-not-open"],
  ["a runtime-start claim", () => mutatedOverlay("currentEffectiveAuthority.runtimeImplementationStarted", true), "forbidden-true:runtimeImplementationStarted"],
  ["an sdkReady claim", () => mutatedOverlay("currentEffectiveAuthority.sdkReady", true), "forbidden-true:sdkReady"],
  ["an appBuildable claim", () => mutatedOverlay("currentEffectiveAuthority.appBuildable", true), "forbidden-true:appBuildable"],
  ["a releaseAllowed claim", () => mutatedOverlay("currentEffectiveAuthority.releaseAllowed", true), "forbidden-true:releaseAllowed"],
  ["a deployAllowed claim", () => mutatedOverlay("currentEffectiveAuthority.deployAllowed", true), "forbidden-true:deployAllowed"],
  ["a productionAllowed claim", () => mutatedOverlay("currentEffectiveAuthority.productionAllowed", true), "forbidden-true:productionAllowed"],
  ["a kernelReady claim", () => mutatedOverlay("currentEffectiveAuthority.kernelReady", true), "forbidden-true:kernelReady"],
  ["a gapClosed claim", () => mutatedOverlay("currentEffectiveAuthority.gapClosed", true), "forbidden-true:gapClosed"],
  ["two effective verdicts", () => mutatedOverlay("currentEffectiveAuthority.effectiveVerdictCount", 2), "effective-verdict-count-drift"],
  ["a stale authority head seq", () => mutatedOverlay("currentEffectiveAuthority.headSeq", 3), "authority-head-drift:identity"],
  ["the stale predecessor digest reused as the head", () => mutatedOverlay("currentEffectiveAuthority.chainFileSha256", overlay.historicalSnapshot.chainFileSha256), "stale-authority-head-reused"],

  ["a forged contract digest", () => mutatedOverlay("promotionContractBinding.sha256", "0".repeat(64)), "contract-digest-drift"],
  ["a forged gate-set hash", () => mutatedOverlay("promotionContractBinding.gateSetSha256", "0".repeat(64)), "contract-gate-set-hash-drift"],
  ["a co-forged gate set whose recomputed digest is self-consistent", () => {
    const forged = clone(overlay);
    forged.promotionContractBinding.gates[4].definition = "PostgreSQL baseline, RLS optional";
    forged.promotionContractBinding.gateSetSha256 = freezeDigest(forged.promotionContractBinding.gates);
    return forged;
  }, "contract-gate-set-drift"],
  ["an eleventh gate", () => {
    const forged = clone(overlay);
    forged.promotionContractBinding.gates.push({ order: 11, id: "GRP-11", definition: "production readiness" });
    return forged;
  }, "unknown-gate:GRP-11"],
  ["a removed gate", () => {
    const forged = clone(overlay);
    forged.promotionContractBinding.gates = forged.promotionContractBinding.gates.filter((g) => g.id !== "GRP-10");
    return forged;
  }, "missing-gate:GRP-10"],
  ["a duplicated gate", () => {
    const forged = clone(overlay);
    forged.promotionContractBinding.gates.push(clone(forged.promotionContractBinding.gates[0]));
    return forged;
  }, "duplicate-gate:GRP-01"],
  ["gate addition re-opened", () => mutatedOverlay("promotionContractBinding.gateAdditionAllowed", true), "gate-addition-allowed"],
  ["a dropped human countersign requirement", () => mutatedOverlay("promotionContractBinding.promotionRule.requiresHumanCountersign", false), "promotion-rule-drift:requiresHumanCountersign"],
  ["a writer permitted to self-close", () => mutatedOverlay("promotionContractBinding.promotionRule.writerMaySelfClose", true), "promotion-rule-drift:writerMaySelfClose"],
  ["a fourth later-topic classification", () => mutatedOverlay("promotionContractBinding.laterTopicPolicy.classifications", [...CLASSIFICATIONS, "new-promotion-gate"]), "later-topic-classification-drift"],
  ["production made reachable from the pilot", () => mutatedOverlay("promotionContractBinding.productionPolicy.reachableFromRuntimePilot", true), "production-reachable-claimed"],
  ["a runtime-pilot claim", () => mutatedOverlay("promotionContractBinding.claimsRuntimePilot", true), "runtime-pilot-claimed"],
  ["a production claim", () => mutatedOverlay("promotionContractBinding.claimsProduction", true), "production-claimed"],
  ["a self-asserted verdict", () => mutatedOverlay("promotionContractBinding.claimedVerdict", CURRENT_VERDICT), "overlay-claims-verdict"],

  ["a preclaimed GREEN GRP-01", () => mutatedOverlay("gate01.claimedStatus", "GREEN"), "gate01-preclaimed-green"],
  ["a writer-self-closed GRP-01", () => mutatedOverlay("gate01.writerMaySelfClose", true), "gate01-self-closed"],
  ["a preclaimed independent verifier", () => mutatedOverlay("gate01.independentVerifierRecorded", true), "gate01-verifier-preclaimed"],
  ["a shortened GRP-01 predicate set", () => mutatedOverlay("gate01.externallyEvaluableWhen", ACTIVATION_PREDICATES.slice(0, 2)), "gate01-predicate-drift"],

  ["an activation declared effective on this branch", () => mutatedOverlay("activation.effective", true), "activation-effective-on-branch"],
  ["an activation requiring an in-repo status flip", () => mutatedOverlay("activation.inRepoStatusFlipCommitRequired", true), "activation-status-flip-required"],
  ["an activation recording a self-referential SHA", () => mutatedOverlay("activation.selfReferentialCommitShaRecorded", true), "activation-self-sha-recorded"],
  ["a preclaimed activator", () => mutatedOverlay("activation.activatedBy", "claude"), "activation-preclaimed"],
  ["a predicate satisfied from this branch", () => mutatedOverlay("activation.predicates.0.satisfiedOnThisBranch", true), "activation-predicate-satisfied-on-branch:artifact-present-on-kernel-main"],

  ["an outward Onion", () => mutatedOverlay("architectureContract.onion.dependencyDirection", "outward"), "onion-direction-drift"],
  ["a reordered Onion", () => mutatedOverlay("architectureContract.onion.layers", clone(overlay.architectureContract.onion.layers).reverse()), "onion-layer-drift"],
  ["Domain depending outward", () => mutatedOverlay("architectureContract.onion.layers.0.dependsOn", ["Adapters"]), "onion-dependency-drift:Domain"],
  ["an Onion widened beyond backend and archetype", () => mutatedOverlay("architectureContract.onion.appliesTo", "everything"), "onion-scope-drift"],
  ["Surface pulled inward", () => mutatedOverlay("architectureContract.onion.outerMembers.0.layer", "Domain"), "outer-member-drift:Surface"],
  ["an AI adapter pulled inward", () => mutatedOverlay("architectureContract.onion.outerMembers.1.layer", "Application"), "outer-member-drift:ai-agent-adapter"],
  ["an axis treated as an Onion layer", () => mutatedOverlay("architectureContract.metaFrameworkAxes.1.isOnionLayer", true), "meta-axis-is-onion-layer:lifecycle-phases"],
  ["an Onion layer smuggled in as an axis", () => mutatedOverlay("architectureContract.metaFrameworkAxes.0.axis", "Domain"), "meta-axis-drift"],
  ["six lifecycle phases", () => mutatedOverlay("architectureContract.metaFrameworkAxes.1.members", overlay.architectureContract.metaFrameworkAxes[1].members.slice(0, 6)), "lifecycle-phase-drift"],
  ["a missing plane", () => mutatedOverlay("architectureContract.metaFrameworkAxes.6.members", ["control", "data"]), "plane-drift"],

  ["an SDK-first runtime-start order", () => {
    const forged = clone(overlay);
    const [substrate, primitives, sdk, slice] = forged.nextRuntimeStartPackage.sequence;
    forged.nextRuntimeStartPackage.sequence = [sdk, substrate, primitives, slice];
    return forged;
  }, "runtime-start-sequence-drift"],
  ["a runtime-start step without exit criteria", () => mutatedOverlay("nextRuntimeStartPackage.sequence.0.exitCriteria", []), "runtime-start-step-missing-field:postgresql-rls-transaction-outbox-audit-substrate.exitCriteria"],
  ["a runtime-start step without a rollback", () => mutatedOverlay("nextRuntimeStartPackage.sequence.3.rollback", ""), "runtime-start-step-missing-field:one-golden-slice.rollback"],
  ["runtime started inside this package", () => mutatedOverlay("nextRuntimeStartPackage.thisPackageStartsNoRuntime", false), "runtime-start-in-this-package"],

  ["a relaxed preservation digest", () => mutatedOverlay("preservation.byteFaithful.0.sha256", "0".repeat(64)), "preservation-entry-drift:planning/bootstrap-state.json"],
  ["EPOCH evidence declared present", () => mutatedOverlay("preservation.historicalEpochEvidence.rule", "present"), "epoch-evidence-not-absent"],
];

for (const [name, build, expected] of overlayAttacks) {
  test(`the verifier rejects ${name}`, () => {
    const { errors, ok } = evaluateOverlay({ overlay: build() });
    assert.equal(ok, false, `${name} must be rejected`);
    assert.ok(errors.includes(expected), `expected ${expected}, got ${JSON.stringify(errors)}`);
  });
}

test("a missing overlay is rejected rather than treated as empty", () => {
  assert.deepEqual(evaluateOverlay({ overlay: null }), { errors: ["overlay-missing"], ok: false });
  assert.equal(evaluateOverlay({}).ok, false);
});

// =====================================================================================
// Adversarial: forged and co-forged canonical documents
// =====================================================================================

const crossAttacks = [
  ["a contract that is not frozen", (docs) => setPath(docs, "contract.frozen", false), "contract-not-frozen"],
  ["a contract whose authority binding is forged", (docs) => setPath(docs, "contract.authorityBinding.kernelCommit", "0".repeat(40)), "contract-authority-binding-drift:kernelCommit"],
  ["a contract anchored at a forged Actionplan commit", (docs) => setPath(docs, "contract.authorityBinding.actionplanCommit", HISTORICAL_ACTIONPLAN_SHA), "contract-authority-binding-drift:actionplanCommit"],
  ["a contract claiming production is allowed", (docs) => setPath(docs, "contract.currentStatus.productionAllowed", true), "contract-current-status-drift:productionAllowed"],
  ["a contract claiming runtime implementation started", (docs) => setPath(docs, "contract.currentStatus.runtimeImplementationStarted", true), "contract-current-status-drift:runtimeImplementationStarted"],
  ["a contract that already reports GRP-01 GREEN", (docs) => {
    docs.contract.currentStatus.gates.find((g) => g.id === "GRP-01").status = "GREEN";
    return docs;
  }, "contract-gate01-not-red"],
  ["a contract co-forged with a self-consistent redefined gate", (docs) => {
    docs.contract.gates[0].definition = "authority sync, self-attested";
    docs.contract.gateSetSha256 = freezeDigest(docs.contract.gates);
    return docs;
  }, "contract-gate-set-drift"],
  ["a contract whose freeze digest no longer matches its own gates", (docs) => {
    docs.contract.gates[0].definition = "authority sync, self-attested";
    return docs;
  }, "contract-freeze-drift"],
  ["a contract that implies production", (docs) => setPath(docs, "contract.promotionRule.impliesProduction", true), "contract-implies-production"],

  ["a chain rewound to the stale head", (docs) => setPath(docs, "chain.chainHeadSeq", 3), "chain-head-seq-drift"],
  ["a chain head that is not effective", (docs) => {
    docs.chain.entries.at(-1).status = "superseded";
    return docs;
  }, "chain-head-not-effective"],
  ["a chain head whose verdict is overreached", (docs) => {
    docs.chain.entries.at(-1).dimensions.verdict.value = PROMOTION_VERDICT;
    return docs;
  }, "chain-verdict-drift"],
  ["a chain head that claims runtime start", (docs) => {
    const head = docs.chain.entries.at(-1);
    head.normalizedText = head.normalizedText.replace("RUNTIME_IMPLEMENTATION_START=NO", "RUNTIME_IMPLEMENTATION_START=YES");
    return docs;
  }, "chain-runtime-start-drift"],
  ["a chain boundary that opens release", (docs) => setPath(docs, "chain.effectiveAuthorityBoundary.releaseAllowed", true), "chain-boundary-drift:releaseAllowed"],
  ["a chain that presents the stale predecessor as its own head", (docs) => setPath(docs, "chain.supersessionProjection.predecessorChainFileSha256", docs.chain.chainSha256), "stale-authority-head-reused"],

  ["an application state that opens deploy", (docs) => setPath(docs, "state.gate.deployAllowed", true), "state-gate-drift:deployAllowed"],
  ["an application state that closes the gap", (docs) => setPath(docs, "state.gate.gapClosed", true), "state-gate-drift:gapClosed"],
  ["an application state bound to the stale head", (docs) => setPath(docs, "state.effectiveAuthority.seq", 3), "state-authority-drift:head"],
  ["an application state whose summary drifted", (docs) => setPath(docs, "state.summary.applied", 9), "state-summary-drift"],
];

for (const [name, forge, expected] of crossAttacks) {
  test(`the verifier rejects ${name}`, () => {
    const docs = forge(clone(canonical));
    const { errors, ok } = evaluateCrossBindings({ overlay, ...docs });
    assert.equal(ok, false, `${name} must be rejected`);
    assert.ok(errors.includes(expected), `expected ${expected}, got ${JSON.stringify(errors)}`);
  });
}

// =====================================================================================
// Adversarial: checkout discovery and forged paths
// =====================================================================================

test("a discovery hint never substitutes for repository identity or the commit object", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-consumer-sync-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const initRepo = (name, originUrl) => {
    const repo = path.join(scratch, name);
    execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: ["ignore", "pipe", "pipe"] });
    writeFileSync(path.join(repo, "README.md"), `${name}\n`);
    const run = (...args) => execFileSync("git", ["-C", repo, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    run("add", "README.md");
    run("commit", "-q", "-m", "fixture");
    if (originUrl) run("remote", "add", "origin", originUrl);
    return repo;
  };

  // A plain directory is not a checkout at all.
  assert.equal(validateActionplanCandidate(path.join(scratch, "absent")).reason, "not-a-git-checkout");
  // A repository with no origin cannot claim the identity.
  assert.equal(validateActionplanCandidate(initRepo("no-origin", null)).reason, "no-origin-remote");
  // A forged origin under a different owner is refused even though the name matches.
  assert.equal(validateActionplanCandidate(initRepo("forged-origin", "git@github.com:attacker/actionplan.git")).reason, "origin-identity-mismatch");

  // Real checkouts whose origin keeps the karacaismail/actionplan tail but moves the host,
  // the scheme or the path prefix. A last-two-segments normalisation would admit every one.
  const hostForgeries = [
    ["evil-host", "https://evil.example/karacaismail/actionplan.git"],
    ["file-url", "file:///tmp/karacaismail/actionplan.git"],
    ["extra-prefix", "https://github.com/mirror/karacaismail/actionplan.git"],
    ["embedded-user-host", "https://github.com@evil.example/karacaismail/actionplan.git"],
    ["embedded-credentials", "https://karacaismail:token@github.com/karacaismail/actionplan.git"],
    ["host-suffix", "git@github.com.evil.example:karacaismail/actionplan.git"],
  ];
  for (const [name, remote] of hostForgeries) {
    const repo = initRepo(name, remote);
    const verdict = validateActionplanCandidate(repo);
    assert.equal(verdict.ok, false, `${remote} must be refused`);
    assert.ok(
      verdict.reason.startsWith("origin-remote-"),
      `${remote} must be refused on remote form, got ${verdict.reason}`,
    );
    // ...and it is never admitted through discovery, with or without a hint.
    assert.notEqual(discoverActionplanRoot({ hints: [repo], base: scratch }).root, repo, `${remote} must not be discoverable`);
  }

  // The right origin is still not enough: the exact commit object must be present.
  const impostor = initRepo("right-origin", "git@github.com:karacaismail/actionplan.git");
  assert.equal(validateActionplanCandidate(impostor).reason, "pinned-commit-absent");
  // Passing the impostor as a hint does not admit it.
  const { root: discovered } = discoverActionplanRoot({ hints: [impostor], base: scratch });
  assert.notEqual(discovered, impostor, "a hint must not bypass identity validation");
});

test("the pinned commit is verified as a commit object, not as a ref name", () => {
  assert.equal(validateActionplanCandidate(apRoot, "0".repeat(40)).reason, "pinned-commit-absent");
  assert.equal(validateActionplanCandidate(apRoot, "main").reason, "pinned-sha-malformed");
  assert.equal(validateActionplanCandidate(apRoot, ACTIONPLAN_SHA.toUpperCase()).reason, "pinned-sha-malformed");
});

// =====================================================================================
// Activation, GRP-01, later topics and promotion claims
// =====================================================================================

test("activation stays prepared until every external predicate is true", () => {
  const none = evaluateActivation({ overlay, predicates: {} });
  assert.equal(none.status, "prepared-awaiting-main-activation");
  assert.deepEqual(none.unsatisfied, ACTIVATION_PREDICATES);

  const partial = evaluateActivation({ overlay, predicates: { "artifact-present-on-kernel-main": true, "npm-test-passes-on-kernel-main": true } });
  assert.equal(partial.status, "prepared-awaiting-main-activation");

  const all = Object.fromEntries(ACTIVATION_PREDICATES.map((id) => [id, true]));
  const effective = evaluateActivation({ overlay, predicates: all });
  assert.equal(effective.status, "effective");
  assert.deepEqual(effective.errors, []);
  // Deterministic: no in-repo status flip and no self-referential SHA are ever required.
  assert.equal(effective.requiresStatusFlipCommit, false);
  assert.equal(effective.requiresSelfReferentialSha, false);
});

test("activation refuses self-closure, status flips and self-referential SHAs", () => {
  const all = Object.fromEntries(ACTIVATION_PREDICATES.map((id) => [id, true]));
  const selfDeclared = evaluateActivation({ overlay: mutatedOverlay("activation.effective", true), predicates: all });
  assert.ok(selfDeclared.errors.includes("activation-self-declared-effective"));
  assert.equal(selfDeclared.status, "prepared-awaiting-main-activation");

  const flipped = evaluateActivation({ overlay, predicates: all, statusFlipCommit: true });
  assert.ok(flipped.errors.includes("activation-status-flip-claimed"));
  assert.equal(flipped.status, "prepared-awaiting-main-activation");

  const selfSha = evaluateActivation({ overlay, predicates: all, selfReferentialSha: "0".repeat(40) });
  assert.ok(selfSha.errors.includes("activation-self-sha-claimed"));

  const unknown = evaluateActivation({ overlay, predicates: { ...all, "writer-says-so": true } });
  assert.ok(unknown.errors.includes("activation-unknown-predicate:writer-says-so"));
});

test("GRP-01 is RED on this branch and can never be closed by the writer", () => {
  const prepared = evaluateActivation({ overlay, predicates: {} });
  assert.deepEqual(evaluateGate01({ overlay, activation: prepared, verification: null }), {
    status: "RED", errors: ["gate01-not-activated", "gate01-verification-missing"],
  });

  const all = Object.fromEntries(ACTIVATION_PREDICATES.map((id) => [id, true]));
  const active = evaluateActivation({ overlay, predicates: all });

  // Self-verification is caught by identity and by the missing independence claim alike.
  const selfVerified = evaluateGate01({ overlay, activation: active, verification: { recorded: true, verifierId: "claude-writer", writerId: "claude-writer", independentOfWriter: true } });
  assert.equal(selfVerified.status, "RED");
  assert.ok(selfVerified.errors.includes("gate01-self-verification"));

  const undeclared = evaluateGate01({ overlay, activation: active, verification: { recorded: true, verifierId: "codex-master", writerId: "claude-writer" } });
  assert.equal(undeclared.status, "RED");
  assert.ok(undeclared.errors.includes("gate01-self-verification"));

  // A preclaimed GREEN overlay never contributes, even with a valid independent verifier.
  const preclaimed = evaluateGate01({
    overlay: mutatedOverlay("gate01.claimedStatus", "GREEN"),
    activation: active,
    verification: { recorded: true, verifierId: "codex-master", writerId: "claude-writer", independentOfWriter: true },
  });
  assert.equal(preclaimed.status, "RED");
  assert.ok(preclaimed.errors.includes("gate01-preclaimed-green"));

  // Only external activation plus an independent verifier turns it GREEN.
  const green = evaluateGate01({ overlay, activation: active, verification: { recorded: true, verifierId: "codex-master", writerId: "claude-writer", independentOfWriter: true } });
  assert.deepEqual(green, { status: "GREEN", errors: [] });
});

test("a later topic can never become an eleventh promotion gate", () => {
  for (const classification of CLASSIFICATIONS) {
    assert.deepEqual(classifyLaterTopic({ classification }), { errors: [], classification, createsGate: false });
  }
  assert.ok(classifyLaterTopic({ classification: "new-promotion-gate" }).errors.includes("new-promotion-gate-forbidden"));
  assert.ok(classifyLaterTopic({ classification: "GRP-11" }).errors.includes("unknown-classification:GRP-11"));
  assert.equal(classifyLaterTopic({ classification: "post-pilot-backlog" }).createsGate, false);
});

test("no promotion or production verdict is reachable from this package", () => {
  assert.deepEqual(evaluatePromotionClaim({ claim: { targetVerdict: CURRENT_VERDICT } }), { errors: [], promotionAllowed: false });
  assert.ok(evaluatePromotionClaim({ claim: { targetVerdict: PROMOTION_VERDICT } }).errors.includes("promotion-claimed-from-consumer-sync"));
  assert.ok(evaluatePromotionClaim({ claim: { targetVerdict: FORBIDDEN_VERDICT } }).errors.includes("production-claimed"));
  assert.ok(evaluatePromotionClaim({ claim: { targetVerdict: "GO-RELEASE" } }).errors.includes("verdict-overreach:GO-RELEASE"));
  assert.ok(evaluatePromotionClaim({ claim: { greenGates: 10 } }).errors.includes("green-gate-claimed"));
  assert.equal(evaluatePromotionClaim({ claim: { targetVerdict: PROMOTION_VERDICT } }).promotionAllowed, false);
});

// =====================================================================================
// Production CLI and repository wiring
// =====================================================================================

test("the production CLI validates real git objects and exits zero", () => {
  const output = execFileSync(process.execPath, [path.join(root, verifierPath)], { encoding: "utf8", cwd: root });
  assert.match(output, /^OK kernel-runtime-pilot-consumer-sync:/m);
  assert.match(output, new RegExp(ACTIONPLAN_SHA.slice(0, 7)));
  assert.match(output, new RegExp(CURRENT_VERDICT));
  assert.match(output, /GRP-01=RED/);
  assert.match(output, /packageState=prepared-awaiting-main-activation/);
  // The verifier's own last line is the single current-effective summary.
  const printed = output.split("\n").map((line) => line.trim()).filter(Boolean);
  assert.match(printed.at(-1), /^CURRENT EFFECTIVE: /);
  assert.equal(printed.filter((line) => line.includes("CURRENT EFFECTIVE")).length, 1);
});

test("the CLI fails closed when no admissible Actionplan checkout carries the pinned commit", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-consumer-sync-cli-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  // main() resolves its own repository from the module path, so an unreachable hint plus an
  // isolated search base is the only way discovery can come up empty.
  const isolated = verifier.discoverActionplanRoot({ hints: [path.join(scratch, "nowhere")], base: scratch });
  assert.equal(isolated.root, null, "an isolated base must admit no checkout");
});

test("npm run check wires the verifier and npm test discovers this suite", async () => {
  const pkg = await readJson("package.json");
  assert.ok(pkg.scripts.check.includes(verifierPath), "npm run check must run the consumer-sync verifier");
  assert.equal(pkg.scripts["check:consumer-sync"], `node ${verifierPath}`);
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs");
});

// Markdown wraps prose, so multi-word phrases are matched against whitespace-normalised text.
const flatten = (text) => text.replace(/\s+/g, " ");

test("AGENTS.md separates the historical snapshot from the current effective authority", async () => {
  const raw = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const agents = flatten(raw);
  assert.ok(agents.includes(overlayPath), "AGENTS.md must reference the overlay");
  assert.ok(agents.includes(verifierPath), "AGENTS.md must reference the verifier");
  assert.ok(agents.includes(CURRENT_VERDICT), "AGENTS.md must record the current effective verdict");
  assert.ok(agents.includes("historical snapshot"), "AGENTS.md must name the historical snapshot");
  // The historical PLANNING_ONLY snapshot language survives, framed as history.
  for (const token of ["PLANNING_ONLY", "VALID_BLOCKED", "NO_GO", "immutable historical snapshot"]) {
    assert.ok(agents.includes(token), `AGENTS.md must keep the historical snapshot token ${token}`);
  }
  // The current authorization boundary is stated exactly. What that boundary now says about
  // runtime start is bound by the current-authority test below, not here.
  assert.ok(agents.includes("codeStartAllowed"), "AGENTS.md must name the open code-start floor");
  assert.ok(agents.includes("runtimeCodeAllowed"), "AGENTS.md must name the open runtime-code floor");
  assert.ok(
    agents.includes("separately scoped, test-first, single-writer change gate"),
    "AGENTS.md must route runtime implementation through the separately scoped change gate",
  );
  assert.ok(
    agents.includes("This consumer-sync package starts no runtime itself"),
    "AGENTS.md must state that this package starts no runtime",
  );
  assert.ok(
    agents.includes("Source extraction and repository topology changes remain separately human-gated"),
    "AGENTS.md must keep source extraction and topology separately human-gated",
  );
  assert.ok(agents.includes("DB/RLS/transaction/outbox/audit -> kernel primitives -> SDK -> walking skeleton"));
  // The writer lock and the account gate stay intact.
  assert.ok(agents.includes("pane-visible-agent-claude"));
  assert.ok(agents.includes("claude_implement"));
  assert.ok(agents.includes("Mode is `CLAUDE_ONLY`"));
});

// The one published annotated tag that records activation. Both are immutable Git objects; the
// commit `main` points at is deliberately not pinned, because it moves whenever anything lands.
const ACTIVATION_TAG_OBJECT = "c34fabc84aaeac80b61d27c777fcc6db0cc8f99b";
const ACTIVATION_TAG_TARGET = "89528cd0b815711e49553682f457326e9b171b03";
const SHUT_FLAGS = [
  "kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed",
];

test("AGENTS.md states the activated exact-main authority, not a stale runtime-not-started claim", async () => {
  const agents = flatten(await readFile(path.join(root, "AGENTS.md"), "utf8"));

  // The live claim is stale: one authorized package started runtime work on exact main and was
  // activated externally. Left standing, this sentence denies the published activation record.
  assert.ok(
    !agents.includes("Runtime implementation has not started"),
    "AGENTS.md must not keep the stale live claim that runtime implementation has not started",
  );

  // The current exact-main project authority, stated as machine-readable dimensions.
  assert.ok(agents.includes(CURRENT_VERDICT), "AGENTS.md must record the current effective verdict");
  for (const token of [
    "codeStartAllowed=true", "runtimeCodeAllowed=true",
    "runtimeImplementationStarted=true", "activationRecord=external-annotated-tag",
  ]) {
    assert.ok(agents.includes(token), `AGENTS.md must state ${token} as current exact-main project authority`);
  }

  // Activation moved exactly one dimension. Every stronger dimension stays shut, and no readiness,
  // release, deployment or production claim may ride along with it.
  for (const flag of SHUT_FLAGS) {
    assert.ok(agents.includes(`${flag}=false`), `AGENTS.md must keep ${flag} false`);
    assert.ok(!agents.includes(`${flag}=true`), `AGENTS.md must not claim ${flag}=true`);
  }
  assert.ok(!agents.includes(FORBIDDEN_VERDICT), `AGENTS.md must not name ${FORBIDDEN_VERDICT} as reachable`);

  // The record of activation is external: one published annotated tag object with a fixed target,
  // never an in-repository status flip.
  assert.match(agents, /annotated (Git )?tag/i, "AGENTS.md must name the annotated tag as the activation record");
  assert.ok(agents.includes(ACTIVATION_TAG_OBJECT), `AGENTS.md must pin the activation tag object ${ACTIVATION_TAG_OBJECT}`);
  assert.ok(agents.includes(ACTIVATION_TAG_TARGET), `AGENTS.md must pin the tag target commit ${ACTIVATION_TAG_TARGET}`);

  // A feature checkout composes its own projection: the activation reader consults the published
  // tag only from an exact origin/main checkout, so a branch reports the unactivated pair. That is
  // a statement about the checkout in hand, never the project's authority.
  for (const token of ["runtimeImplementationStarted=false", "activationRecord=absent"]) {
    assert.ok(agents.includes(token), `AGENTS.md must show ${token} as the branch projection, not as project authority`);
  }
  assert.match(agents, /origin\/main/, "AGENTS.md must state that activation is looked up from exact origin/main");
  assert.match(agents, /checkout-local projection/i, "AGENTS.md must name the branch value a checkout-local projection");
  assert.match(agents, /not (the )?project authority/i, "AGENTS.md must deny that the checkout-local projection is project authority");
});

// =====================================================================================
// npm run check output labelling
//
// The checkers print three historical-snapshot lines and one current-authority line. Unlabelled,
// the historical lines read as today's verdict, so the aggregate output says PLANNING_ONLY /
// VALID_BLOCKED / NO_GO / "code start denied" and GO-KERNEL-DEVELOPMENT-ONLY at once. Every
// historical line must therefore be labelled, and exactly one CURRENT EFFECTIVE summary must be
// the last word.
// =====================================================================================

const HISTORICAL_LINES = [
  ["repository boundary", "repository boundary"],
  ["control plane", "control plane:"],
  ["readiness candidate", "readiness candidate:"],
];
const LEGACY_TOKENS = ["PLANNING_ONLY", "VALID_BLOCKED", "NO_GO", "NO-GO", "code start denied", "BLOCKED"];
const isHistoricallyLabelled = (line) => line.includes("HISTORICAL SNAPSHOT") && line.includes("non-effective");

// This verifier owns the activation base, not the project's authority.
//
// Its own last line begins `CURRENT EFFECTIVE:` and always has; those bytes are frozen and this
// suite still proves them, above. But that line is an *input*. The compositor consumes it,
// relabels it as the activation base, and decides for itself what closes the run — and only an
// admitted checkout, exact origin/main carrying the published annotated tag, may close it with
// the project-authority label. This worktree is a feature checkout, so the CURRENT-looking line
// this verifier produces must not survive anywhere in the composed output.
const CURRENT_LABEL = "CURRENT EFFECTIVE";
const CURRENT_PREFIX = "CURRENT EFFECTIVE:";
const PROJECTION_PREFIX = "CHECKOUT-LOCAL PROJECTION (non-effective; not project authority):";
const COMPOSITOR_MODULE = "tools/compose-current-effective.mjs";
const SHUT_FLAG_NAMES = [
  "kernelReady", "sdkReady", "appBuildable", "releaseAllowed", "deployAllowed",
  "productionAllowed", "gapClosed",
];

/** The compositor's pure entry point, resolved once. */
const composeCurrentEffective = async () => {
  const module = await import(pathToFileURL(path.join(root, COMPOSITOR_MODULE)).href);
  assert.equal(
    typeof module.composeCurrentEffective,
    "function",
    `${COMPOSITOR_MODULE} must export composeCurrentEffective(input) -> { lines }`,
  );
  return module.composeCurrentEffective;
};

/** Exactly what the compositor consumes: this verifier's real, unmodified stdout. */
const consumerSyncOutput = () =>
  execFileSync(process.execPath, [path.join(root, verifierPath)], { encoding: "utf8", cwd: root })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const runCheck = () => {
  const result = spawnSync("npm", ["run", "check", "--silent"], { cwd: root, encoding: "utf8" });
  assert.equal(result.error, undefined, `npm run check could not be executed: ${result.error?.message}`);
  return String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(">"));
};

test("npm run check labels every historical line and ends with one checkout-local projection", () => {
  const lines = runCheck();
  assert.ok(lines.length > 0, "npm run check produced no output to evaluate");
  const context = `\n--- npm run check output ---\n${lines.join("\n")}\n---`;

  // 1-3. Each historical checker line is explicitly labelled as a non-effective snapshot.
  const historicalIndices = [];
  for (const [name, marker] of HISTORICAL_LINES) {
    const index = lines.findIndex((line) => line.includes(marker));
    assert.notEqual(index, -1, `the ${name} line is missing from npm run check output${context}`);
    historicalIndices.push(index);
    assert.ok(
      isHistoricallyLabelled(lines[index]),
      `the ${name} line is not labelled HISTORICAL SNAPSHOT / non-effective:\n  ${lines[index]}${context}`,
    );
  }

  // 4. No legacy verdict token may sit on an unlabelled, current-looking line.
  for (const line of lines) {
    const legacy = LEGACY_TOKENS.filter((token) => line.includes(token));
    if (legacy.length === 0) continue;
    assert.ok(
      isHistoricallyLabelled(line),
      `legacy verdict token(s) ${legacy.join(", ")} appear on an unlabelled current-looking line:\n  ${line}${context}`,
    );
  }

  // 5. Not one line may speak with project authority. This checkout is not exact origin/main, so
  //    the activation reader never looks the tag up, and the answer it composes is about this
  //    working copy. Saying that under the project-authority label would deny the published
  //    activation record in the project's own vocabulary.
  assert.deepEqual(
    lines.filter((line) => line.includes(CURRENT_LABEL)),
    [],
    `a feature checkout must emit zero lines carrying "${CURRENT_LABEL}"${context}`,
  );

  // 6. Exactly one checkout-local projection, and it is the final line.
  const projectionIndices = lines
    .map((line, index) => (line.startsWith(PROJECTION_PREFIX) ? index : -1))
    .filter((i) => i !== -1);
  assert.equal(
    projectionIndices.length,
    1,
    `expected exactly one line prefixed "${PROJECTION_PREFIX}", found ${projectionIndices.length}${context}`,
  );
  const currentIndex = projectionIndices[0];
  assert.equal(currentIndex, lines.length - 1, `the checkout-local projection must be the final line${context}`);
  const current = lines[currentIndex];

  for (const token of [
    CURRENT_VERDICT,
    "codeStartAllowed=true",
    "runtimeCodeAllowed=true",
    "runtimeImplementationStarted=false",
    "activationRecord=absent",
    "kernelReady=false",
    "sdkReady=false",
    "appBuildable=false",
    "releaseAllowed=false",
    "deployAllowed=false",
    "productionAllowed=false",
    "gapClosed=false",
  ]) {
    assert.ok(current.includes(token), `the checkout-local projection is missing ${token}:\n  ${current}${context}`);
  }
  for (const forbidden of [PROMOTION_VERDICT, FORBIDDEN_VERDICT, "GO-RELEASE", "GO-DEPLOY"]) {
    assert.ok(!current.includes(forbidden), `the checkout-local projection overreaches with ${forbidden}:\n  ${current}${context}`);
  }
  // The projection carries no legacy verdict token of its own.
  for (const token of LEGACY_TOKENS) {
    assert.ok(!current.includes(token), `the checkout-local projection reuses the legacy token ${token}:\n  ${current}${context}`);
  }

  // 7. The activation base is explicit, non-effective, and earlier than the final line.
  const baseIndices = lines
    .map((line, index) => (line.startsWith("ACTIVATION BASE") ? index : -1))
    .filter((i) => i !== -1);
  assert.equal(baseIndices.length, 1, `expected exactly one ACTIVATION BASE line${context}`);
  assert.match(lines[baseIndices[0]], /non-effective/, `the activation base must be explicitly non-effective${context}`);
  assert.ok(baseIndices[0] < currentIndex, `the activation base must precede the final line${context}`);

  // 8. The final line comes after every historical line.
  for (const [position, [name]] of HISTORICAL_LINES.entries()) {
    assert.ok(
      currentIndex > historicalIndices[position],
      `the checkout-local projection must come after the ${name} line${context}`,
    );
  }
});

// =====================================================================================
// The two composed paths, proven from pure compositor inputs.
//
// This checkout is a feature branch, so it can prove the unadmitted path directly. It can never
// prove the admitted one by observation — that would mean inferring exact-main authority from a
// working copy that is not exact main, which is precisely the confusion these labels exist to
// stop. The admitted path is therefore driven as a pure input instead.
// =====================================================================================

test("this verifier's CURRENT-looking line is an activation-base input, relabelled and never the final word", async () => {
  const compose = await composeCurrentEffective();
  const consumed = consumerSyncOutput();

  // The frozen bytes still produce exactly one CURRENT-looking line, and it is this verifier's own
  // last word about itself.
  const supplied = consumed.filter((line) => line.startsWith(CURRENT_PREFIX));
  assert.equal(supplied.length, 1, `expected one ${CURRENT_PREFIX} line from ${verifierPath}`);
  assert.equal(consumed.at(-1), supplied[0], `${verifierPath} must end with its own current-effective line`);

  const snapshot = structuredClone(consumed);
  const composed = compose({ consumerSyncOutput: consumed, activation: { effective: false } });
  assert.equal(composed.ok, true, `composition refused: ${JSON.stringify(composed.errors)}`);
  assert.deepEqual(consumed, snapshot, "the compositor must not mutate the output it consumes");

  // The supplied line survives as evidence, under a label that denies it is in force...
  const base = composed.lines.filter((line) => line.startsWith("ACTIVATION BASE"));
  assert.equal(base.length, 1, "the supplied line must be relabelled as the activation base");
  assert.match(base[0], /non-effective/);
  assert.ok(
    base[0].endsWith(supplied[0].slice(CURRENT_PREFIX.length).trim()),
    `the relabelled base must carry the supplied facts verbatim:\n  ${base[0]}`,
  );

  // ...and it does not survive as authority, verbatim or otherwise.
  assert.ok(!composed.lines.includes(supplied[0]), "the supplied CURRENT-looking line must not pass through");
  assert.deepEqual(
    composed.lines.filter((line) => line.includes(CURRENT_LABEL)),
    [],
    `a false/absent composition must carry zero "${CURRENT_LABEL}" lines:\n${composed.lines.join("\n")}`,
  );
  assert.ok(composed.lines.at(-1).startsWith(PROJECTION_PREFIX), `the last line must be the checkout-local projection`);
  assert.ok(composed.lines.indexOf(base[0]) < composed.lines.length - 1);
});

test("only the admitted activated path carries the project-authority label, and it carries all of it", async () => {
  const compose = await composeCurrentEffective();
  // A stand-in activation base, so the admitted path is driven by input rather than inferred from
  // whatever branch this happens to be.
  const stand = [
    "OK stand-in-activation-base: fixture",
    `${CURRENT_PREFIX} verdict=${CURRENT_VERDICT} codeStartAllowed=true runtimeCodeAllowed=true ` +
      "runtimeImplementationStarted=false kernelReady=false sdkReady=false appBuildable=false " +
      "releaseAllowed=false deployAllowed=false productionAllowed=false gapClosed=false",
  ];

  const activated = compose({ consumerSyncOutput: stand, activation: { effective: true } });
  assert.equal(activated.ok, true, `composition refused: ${JSON.stringify(activated.errors)}`);
  const authority = activated.lines.filter((line) => line.includes(CURRENT_LABEL));
  assert.equal(authority.length, 1, `expected exactly one authority line:\n${activated.lines.join("\n")}`);
  assert.ok(
    authority[0].startsWith(CURRENT_PREFIX),
    `the project-authority prefix must be exactly "${CURRENT_PREFIX}": ${authority[0]}`,
  );
  assert.equal(activated.lines.at(-1), authority[0], "the authority line must be last");
  for (const token of [
    `verdict=${CURRENT_VERDICT}`,
    "codeStartAllowed=true",
    "runtimeCodeAllowed=true",
    "runtimeImplementationStarted=true",
    "activationRecord=external-annotated-tag",
  ]) {
    assert.ok(authority[0].includes(token), `the authority line is missing ${token}:\n  ${authority[0]}`);
  }
  for (const flag of SHUT_FLAG_NAMES) {
    assert.ok(authority[0].includes(`${flag}=false`), `${flag} must stay false on the authority line`);
  }
  for (const overreach of [PROMOTION_VERDICT, FORBIDDEN_VERDICT, "GO-RELEASE", "GO-DEPLOY"]) {
    assert.ok(!authority[0].includes(overreach), `the authority line overreaches with ${overreach}`);
  }
  for (const legacy of LEGACY_TOKENS) {
    assert.ok(!authority[0].includes(legacy), `the authority line reuses the legacy token ${legacy}`);
  }
  // Authority is never demoted to a projection, and the base it moved from stays visible.
  assert.deepEqual(activated.lines.filter((line) => line.startsWith(PROJECTION_PREFIX)), []);
  assert.equal(activated.lines.filter((line) => line.startsWith("ACTIVATION BASE")).length, 1);

  // The same input, unadmitted, is the same facts under a label that claims nothing for them.
  const projected = compose({ consumerSyncOutput: stand, activation: { effective: false } });
  assert.equal(projected.ok, true, `composition refused: ${JSON.stringify(projected.errors)}`);
  const projection = projected.lines.at(-1);
  assert.ok(projection.startsWith(PROJECTION_PREFIX), `expected the projection prefix: ${projection}`);
  assert.ok(!projection.includes(CURRENT_LABEL), "a false/absent projection must not be promoted to authority");
  assert.match(projection, /runtimeImplementationStarted=false/);
  assert.match(projection, /activationRecord=absent/);
  for (const flag of SHUT_FLAG_NAMES) {
    assert.ok(projection.includes(`${flag}=false`), `${flag} must stay false on the projection`);
  }
  assert.notEqual(projection, authority[0]);
});

test("no general planning-only or not-authorized claim may return to AGENTS.md or the package description", async () => {
  const agents = flatten(await readFile(path.join(root, "AGENTS.md"), "utf8"));
  const pkg = await readJson("package.json");

  // A general denial contradicts GO-KERNEL-DEVELOPMENT-ONLY with codeStartAllowed and
  // runtimeCodeAllowed true, and would block the required separate substrate package.
  const staleGeneralClaims = [
    "runtime implementation and source extraction are not",
    "runtime implementation is not authorized",
    "runtime code is not authorized",
    "This repository is `PLANNING_ONLY`",
    "this repository is planning-only",
    "Planning-only repository",
    "planning-only repository",
    "Opening kernel development does not open runtime start",
  ];
  for (const claim of staleGeneralClaims) {
    assert.ok(!agents.includes(claim), `AGENTS.md reintroduced the stale general claim: ${claim}`);
    assert.ok(!pkg.description.includes(claim), `package description reintroduced the stale general claim: ${claim}`);
  }
  assert.ok(!/planning[- ]only/i.test(pkg.description), "package description must not call the repository planning-only");

  // ...and the correction must not overreach in the other direction either.
  for (const overreach of ["runtime-ready", "production-ready", "release-ready", "MVP", PROMOTION_VERDICT, FORBIDDEN_VERDICT]) {
    assert.ok(!pkg.description.includes(overreach), `package description overreaches with ${overreach}`);
  }
  assert.match(pkg.description, /current-authority consumer/i, "package description must describe the current-authority consumer role");
  assert.match(pkg.description, /runtime-kernel boundary/i, "package description must keep the runtime-kernel boundary framing");

  // The overlay itself still reports runtime as not started.
  assert.equal(overlay.currentEffectiveAuthority.runtimeImplementationStarted, false);
  assert.equal(overlay.nextRuntimeStartPackage.thisPackageStartsNoRuntime, true);
});
