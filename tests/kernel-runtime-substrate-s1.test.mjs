import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Repository identity is derived here, never read from a recorded absolute path.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = "db/kernel-runtime-substrate-s1.json";
const verifierPath = "tools/check-kernel-runtime-substrate-s1.mjs";

const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);
const {
  ACTIONPLAN_SHA, KERNEL_BASE_SHA, CURRENT_VERDICT, PHASE, PACKAGE_STATE,
  ACTIVATION_BASE_STATE, DESIRED_STATE, MOVED_DIMENSIONS, SHUT_FLAGS, ACTIVATION_PREDICATES,
  READ_ONLY_FILES, REQUIRED_CAPABILITY_IDS, BEHAVIORAL_IDS, FORBIDDEN_ROOT_PATHS,
  FORBIDDEN_PACKAGE_PATHS, PRODUCTION_IMPORT_ROOT, PRODUCTION_PACKAGE, PRODUCTION_MODULES,
  REVISIONS_DIR, HEAD_REVISION, PHYSICAL_RUNTIME_TABLES,
  LIFECYCLE_IMAGE, MIGRATION_ROLE, RUNTIME_ROLE, RUNTIME_TABLES, FORBIDDEN_TOKENS,
  STATIC_SCRIPT, EPHEMERAL_INVOCATIONS, FENCING_PREDICATE, FENCED_MUTATION_APIS,
  REMOVED_IDS_ONLY_APIS, ACTIVATION_COMPOSITOR_MODULE, FORBIDDEN_FLAG_NAMES, checkRedFollowUps,
  canonicalJson, sha256, validateKernelBase, evaluateContract, checkNoHistoricalRewrite,
  checkProductionSurface, checkSourceCrossBinding, checkBehavioralModules, checkForbiddenTokens,
  checkStaticAnalysisWiring,
} = verifier;

const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const contract = await readJson(contractPath);

const clone = (value) => structuredClone(value);
const setPath = (target, dotted, value) => {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
  return target;
};
const mutated = (dotted, value) => setPath(clone(contract), dotted, value);

// =====================================================================================
// Presence and positive semantics
// =====================================================================================

test("the substrate contract and its verifier exist", () => {
  for (const relative of [contractPath, verifierPath]) {
    assert.ok(existsSync(path.join(root, relative)), `substrate-package-missing: ${relative}`);
  }
});

test("importing the verifier has no side effects and exposes the pure evaluators", () => {
  for (const name of [
    "evaluateContract", "validateKernelBase", "checkNoHistoricalRewrite",
    "checkProductionSurface", "checkSourceCrossBinding", "checkBehavioralModules",
    "checkForbiddenTokens", "checkDependencyFilenameCollision", "main",
  ]) {
    assert.equal(typeof verifier[name], "function", `${name} must be exported as a pure helper`);
  }
});

test("the contract satisfies every structural invariant", () => {
  const { errors, ok } = evaluateContract({ contract });
  assert.deepEqual(errors, [], "contract must have no structural findings");
  assert.equal(ok, true);
});

test("the contract pins the exact existing authority and the exact pre-existing kernel base", () => {
  const authority = contract.authorityBinding;
  assert.equal(authority.actionplan.commit, ACTIONPLAN_SHA);
  assert.equal(authority.actionplan.verdict, CURRENT_VERDICT);
  assert.equal(authority.actionplan.headSeq, 4);
  assert.equal(authority.actionplan.mutationAllowed, false);
  assert.equal(authority.kernelBase.commit, KERNEL_BASE_SHA);
  // The base is a pre-existing commit object in this repository, never this package's own commit.
  assert.deepEqual(validateKernelBase(root), { ok: true, reason: null });
  assert.equal(authority.kernelBase.selfReferential, false);
  assert.equal(authority.selfReferentialCommitShaRecorded, false);
  assert.equal(contract.activation.selfReferentialCommitShaRecorded, false);
  // No absolute path is embedded anywhere in the contract.
  const raw = JSON.stringify(contract);
  assert.ok(!raw.includes(root), "the contract must not embed the kernel worktree root");
  assert.ok(!raw.includes("/worktrees/"), "the contract must not embed a worktree path");
});

test("the activation base is digest-pinned to the bytes actually on disk", async () => {
  for (const [relative, recorded] of [
    [contract.activationBase.artifact, contract.activationBase.artifactSha256],
    [contract.activationBase.verifier, contract.activationBase.verifierSha256],
  ]) {
    const bytes = await readFile(path.join(root, relative));
    assert.equal(sha256(bytes), recorded, `${relative} digest drifted from the pinned value`);
  }
  assert.equal(contract.activationBase.rewritten, false);
  assert.equal(contract.activationBase.mutationAllowed, false);
});

test("no historical artifact is rewritten, proven against the pinned base commit", () => {
  assert.deepEqual(
    checkNoHistoricalRewrite(root),
    [],
    "every read-only artifact must be byte-identical to its content at the base commit",
  );
  // The set is pinned in the verifier, so it cannot be narrowed by editing the contract.
  for (const file of [
    "repository-status.json",
    "planning/bootstrap-state.json",
    "planning/human-decision-request.json",
    "planning/kernel-ai-development-readiness.json",
    "planning/kernel-runtime-pilot-consumer-sync.json",
  ]) {
    assert.ok(READ_ONLY_FILES.includes(file), `${file} must stay in the read-only set`);
    assert.ok(contract.preservation.readOnly.includes(file));
  }
  assert.equal(contract.preservation.rewritesHistoricalArtifacts, false);
});

test("the activation base and the branch candidate are distinguished, not conflated", () => {
  // What is in force now.
  assert.deepEqual(contract.activationBase.state, ACTIVATION_BASE_STATE);
  assert.equal(contract.activationBase.state.runtimeImplementationStarted, false);
  // What this branch desires once externally activated.
  assert.equal(contract.desiredState.effective, false);
  assert.equal(contract.desiredState.verdict, CURRENT_VERDICT);
  assert.equal(contract.desiredState.codeStartAllowed, true);
  assert.equal(contract.desiredState.runtimeCodeAllowed, true);
  assert.equal(contract.desiredState.runtimeImplementationStarted, true);
  for (const flag of SHUT_FLAGS) {
    assert.equal(contract.desiredState[flag], false, `${flag} must stay false`);
  }
  // Exactly one dimension moves, and the delta agrees with both states it connects.
  assert.deepEqual(contract.stateDelta.changedDimensions, MOVED_DIMENSIONS);
  assert.equal(contract.stateDelta.from.runtimeImplementationStarted, false);
  assert.equal(contract.stateDelta.to.runtimeImplementationStarted, true);
  for (const key of Object.keys(ACTIVATION_BASE_STATE)) {
    if (MOVED_DIMENSIONS.includes(key)) continue;
    assert.equal(contract.activationBase.state[key], contract.desiredState[key], `${key} must not move`);
  }
});

test("the package stays prepared, claims nothing, and invents no verification or countersign", () => {
  assert.equal(contract.packageState, PACKAGE_STATE);
  assert.equal(contract.activation.state, PACKAGE_STATE);
  assert.equal(contract.activation.effective, false);
  assert.equal(contract.activation.activatedBy, null);
  assert.equal(contract.activation.effectiveFrom, null);
  assert.equal(contract.activation.inRepoStatusFlipCommitRequired, false);
  assert.deepEqual(contract.activation.predicates.map((p) => p.id), ACTIVATION_PREDICATES);
  for (const predicate of contract.activation.predicates) {
    assert.equal(predicate.satisfiedOnThisBranch, false);
    assert.equal(predicate.evaluator, "codex-master");
  }
  assert.equal(contract.independentVerification.recorded, false);
  assert.equal(contract.independentVerification.inRepoEvidenceCreated, false);
  assert.equal(contract.independentVerification.writerMaySelfVerify, false);
  assert.equal(contract.humanCountersign.recorded, false);
  assert.equal(contract.humanCountersign.writerMayCountersign, false);
  assert.equal(contract.promotionClaims.claimedVerdict, null);
  assert.deepEqual(contract.promotionClaims.claimedGates, []);
  assert.equal(contract.promotionClaims.claimsGate01, false);
  assert.equal(contract.promotionClaims.claimsRuntimePilot, false);
  assert.equal(contract.promotionClaims.claimsProduction, false);
});

test("scope, non-goals, allowed targets, RED, GREEN and rollback are all specified", () => {
  assert.equal(contract.scope.sequenceId, "postgresql-rls-transaction-outbox-audit-substrate");
  assert.equal(contract.scope.sequenceOrder, 1);
  for (const field of ["summary", "phaseAScope", "phaseBScope"]) {
    assert.equal(typeof contract.scope[field], "string");
    assert.ok(contract.scope[field].length > 0);
  }
  assert.ok(contract.nonGoals.length >= 10, "the non-goal set must be explicit");
  for (const target of ["db", "tests", "tools"]) assert.ok(contract.allowedTargets.includes(target));
  assert.equal(contract.red.phase, "A");
  assert.ok(contract.red.provenBy.length > 0);
  assert.ok(contract.red.notProvenBy.length > 0);
  assert.ok(contract.red.exitCriteria.length > 0);
  assert.equal(contract.green.phase, "B");
  assert.equal(contract.green.notReachableFromPhaseA, true);
  assert.equal(contract.rollback.owner, "codex-master");
  for (const field of ["trigger", "action", "blastRadius", "runtimeDataImpact", "dependentCode", "reversibilityNote"]) {
    assert.ok(contract.rollback[field].length > 0, `rollback.${field} must be specified`);
  }
});

test("the rollback tells the truth about destroying data now that a schema exists", () => {
  const rollback = contract.rollback;
  // Phase A could honestly say "none". A substrate that owns an audit trail cannot.
  assert.notEqual(rollback.runtimeDataImpact, "none");
  assert.match(rollback.runtimeDataImpact, /DESTRUCTIVE/);
  for (const table of RUNTIME_TABLES) {
    assert.ok(
      rollback.runtimeDataImpact.includes(table),
      `the data impact must name ${table}, whose rows the downgrade drops`,
    );
  }
  assert.match(rollback.runtimeDataImpact, /backup/i, "a destructive rollback must advise a backup");
  // The mechanism, not just a file revert.
  assert.match(rollback.action, /downgrade/i);
  assert.match(rollback.action, /alembic/i);
  assert.match(rollback.reversibilityNote, /prospective/i);
});

test("RED is kept as history and GREEN as the current obligation", () => {
  assert.equal(contract.red.role, "historical-phase-a-record");
  assert.equal(contract.red.phase, "A");
  assert.equal(contract.green.role, "current-phase-b-obligation");
  assert.equal(contract.green.phase, "B");
  // The Phase A fence is retained explicitly as a record, not as a claim about today.
  assert.equal(contract.forbiddenInPhaseA.role, "historical-phase-a-record");
  assert.ok(contract.forbiddenInPhaseA.paths.includes("db/metaframer_kernel_db"));
  assert.ok(existsSync(path.join(root, "db/metaframer_kernel_db")), "which exists now, by design");
  // The standing constraint is the root fence, and it still holds.
  assert.deepEqual(contract.forbiddenAlways, FORBIDDEN_ROOT_PATHS);
  for (const fenced of contract.forbiddenAlways) {
    assert.equal(existsSync(path.join(root, fenced)), false, `${fenced} must not exist at the root`);
  }
});

test("every public outbox mutation is fenced on the claim token, in the SQL itself", async () => {
  const outbox = await readFile(path.join(root, "db/metaframer_kernel_db/outbox.py"), "utf8");
  const gap = contract.redFollowUps.gaps.find((g) => g.id === "GAP1-outbox-claim-fencing");

  // The predicate appears once per fenced mutation, and the contract names the same string.
  const occurrences = outbox.split(gap.fencingPredicate).length - 1;
  assert.equal(occurrences, FENCED_MUTATION_APIS.length, "each fenced mutation needs the predicate");
  assert.equal(gap.fencingPredicate, FENCING_PREDICATE);

  for (const api of FENCED_MUTATION_APIS) {
    assert.match(outbox, new RegExp(`^def ${api}\\(.*claim_token`, "m"), `${api} must take a token`);
  }
  // No identifier-only mutation path survives, and a missing token refuses rather than defaults.
  for (const removed of REMOVED_IDS_ONLY_APIS) {
    assert.ok(!new RegExp(`^def ${removed}\\b`, "m").test(outbox), `${removed} must be gone`);
  }
  assert.match(outbox, /claim_token is None/, "an absent token must be refused, not defaulted");
  assert.deepEqual(checkSourceCrossBinding(root), []);
  assert.deepEqual(checkRedFollowUps(contract, root), []);
});

test("the contract names the real owner of each composed line", async () => {
  const composition = contract.checkComposition;
  // The compositor emits the final line; the consumer-sync verifier supplies the base it is
  // composed from. Crediting the wrong file sends a reader to the wrong place.
  assert.equal(composition.finalCurrentEffectiveLineOwner, ACTIVATION_COMPOSITOR_MODULE);
  assert.equal(composition.activationBaseLineOwner, "tools/check-kernel-runtime-pilot-consumer-sync.mjs");
  assert.equal(composition.emitsCurrentEffectiveLine, false, "this verifier emits no such line");

  // Proven from the files: the named owner is the one that actually formats the line.
  const compositorSource = await readFile(path.join(root, ACTIVATION_COMPOSITOR_MODULE), "utf8");
  assert.match(compositorSource, /CURRENT_PREFIX = "CURRENT EFFECTIVE:"/);
  assert.match(compositorSource, /export function composeCurrentEffective/);
  const verifierSource = await readFile(path.join(root, verifierPath), "utf8");
  assert.ok(
    !/console\.log\(\s*[`"']CURRENT EFFECTIVE/.test(verifierSource),
    "the substrate verifier must not print a current-effective line",
  );
});

test("the check wires the compositor around the activation base without editing it", async () => {
  const pkg = await readJson("package.json");
  const wiring = contract.redFollowUps.gaps.find((g) => g.id === "GAP2-external-tag-activation").checkWiring;

  assert.ok(pkg.scripts.check.includes(wiring.invocation), "the check must run the declared wiring");
  assert.ok(pkg.scripts.check.includes("tools/check-kernel-runtime-pilot-consumer-sync.mjs"));
  assert.ok(pkg.scripts.check.includes(ACTIVATION_COMPOSITOR_MODULE));
  assert.equal(wiring.activationBaseVerifierEdited, false);
  assert.equal(wiring.activationBaseArtifactEdited, false);

  // Proven, not asserted: both activation-base files are byte-identical to the pinned base commit.
  assert.deepEqual(checkNoHistoricalRewrite(root), []);
  const verifierBytes = await readFile(path.join(root, "tools/check-kernel-runtime-pilot-consumer-sync.mjs"));
  assert.equal(sha256(verifierBytes), contract.activationBase.verifierSha256);
});

test("the composed check emits one CURRENT EFFECTIVE line after one relabelled activation base", () => {
  const result = spawnSync("npm", ["run", "check", "--silent"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `npm run check failed: ${result.stderr}`);
  const lines = String(result.stdout).split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith(">"));

  const current = lines.filter((l) => l.startsWith("CURRENT EFFECTIVE"));
  const base = lines.filter((l) => l.startsWith("ACTIVATION BASE"));
  assert.equal(current.length, 1, `expected one CURRENT EFFECTIVE line, got ${current.length}`);
  assert.equal(base.length, 1, `expected one ACTIVATION BASE line, got ${base.length}`);
  assert.equal(lines.at(-1), current[0], "the CURRENT EFFECTIVE line must be last");
  assert.ok(lines.indexOf(base[0]) < lines.indexOf(current[0]));
  // Not activated on a feature branch, and nothing stronger moved.
  assert.match(current[0], /runtimeImplementationStarted=false/);
  assert.match(current[0], /activationRecord=absent/);
  for (const flag of SHUT_FLAGS) assert.match(current[0], new RegExp(`${flag}=false`));
  for (const name of FORBIDDEN_FLAG_NAMES) assert.ok(!current[0].includes(name));
});

test("an expired claim lease is a proven behaviour, not a promise", () => {
  const outbox = contract.behavioralContract.find((s) => s.id === "outbox-claim").assertions;
  const expiry = outbox.find((a) => /expires without/i.test(a));
  assert.ok(expiry, "lease expiry must be a declared behavioural obligation");
  assert.match(expiry, /same identifier/i);
  assert.match(expiry, /attempt count/i);
  assert.ok(outbox.some((a) => /expired claim/i.test(a) && /tenant boundary/i.test(a)));
  assert.ok(outbox.some((a) => /published row/i.test(a) && /never handed out/i.test(a)));
  // The claim query must actually implement both arms, and no index may use a volatile predicate.
  const claim = readFileSync(path.join(root, "db/metaframer_kernel_db/outbox.py"), "utf8");
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim, /claimed_at IS NULL OR claim_expires_at <= now\(\)/);
  assert.match(claim, /published_at IS NULL/);
  assert.deepEqual(checkSourceCrossBinding(root), []);
});

test("the bounded scope is PostgreSQL 16 / Python 3.12 / SQLAlchemy 2.0 + Alembic, and fences the forbidden stack", () => {
  assert.equal(contract.boundedScope.database, "PostgreSQL 16");
  assert.equal(contract.boundedScope.language, "Python 3.12");
  assert.match(contract.boundedScope.orm, /SQLAlchemy 2\.0/);
  assert.equal(contract.boundedScope.migrations, "Alembic");
  for (const forbidden of ["Prisma", "Next.js", "Supabase", "SQLite", "mock database", "in-memory database"]) {
    assert.ok(
      contract.boundedScope.forbiddenTechnologies.includes(forbidden),
      `${forbidden} must be declared forbidden`,
    );
  }
});

// =====================================================================================
// Phase A: the production substrate must be absent, and provably so
// =====================================================================================

test("every declared capability is implemented, inside the one production surface", () => {
  assert.equal(contract.phase, PHASE);
  assert.deepEqual(contract.requiredCapabilities.map((c) => c.id), REQUIRED_CAPABILITY_IDS);
  for (const capability of contract.requiredCapabilities) {
    // Still recorded, because it is still true: this is what Phase A proved absent.
    assert.equal(capability.absentInPhaseA, true, `${capability.id} must record its Phase A absence`);
    assert.equal(capability.implementedInPhaseB, true, `${capability.id} must be implemented`);
    assert.ok(
      PRODUCTION_MODULES.includes(capability.implementedIn),
      `${capability.id} is implemented outside the declared surface: ${capability.implementedIn}`,
    );
    assert.ok(capability.target.startsWith(`${PRODUCTION_IMPORT_ROOT}.`));
    assert.ok(capability.target.includes(":"), "a target must name module:attribute");
  }
});

test("the production surface is exactly one substrate package with exactly one revision", () => {
  assert.deepEqual(checkProductionSurface(root), []);
  for (const relative of PRODUCTION_MODULES) {
    assert.ok(existsSync(path.join(root, relative)), `${relative} must exist`);
  }
  // One revision, and it is the baseline.
  const revisions = readdirSync(path.join(root, REVISIONS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .map((entry) => entry.name);
  assert.deepEqual(revisions, [`${HEAD_REVISION}.py`]);
  assert.equal(contract.productionSurface.revisionCount, 1);
  assert.equal(contract.productionSurface.headRevision, HEAD_REVISION);
  // The repository-root fence and the no-second-home rule both still hold.
  for (const fenced of FORBIDDEN_ROOT_PATHS) {
    assert.equal(existsSync(path.join(root, fenced)), false, `${fenced} must not exist at the root`);
  }
  for (const forbidden of FORBIDDEN_PACKAGE_PATHS) {
    assert.equal(existsSync(path.join(root, forbidden)), false, `${forbidden} must not exist`);
  }
});

test("the contract agrees with the production source it describes", () => {
  assert.deepEqual(checkSourceCrossBinding(root), []);
  // Exactly two runtime tables, and the names in the contract are the names in the code.
  assert.deepEqual(contract.productionSurface.runtimeTables, PHYSICAL_RUNTIME_TABLES);
  assert.equal(contract.productionSurface.runtimeTables.length, RUNTIME_TABLES.length);
  assert.equal(contract.productionSurface.package, PRODUCTION_PACKAGE);
});

test("the tenant-context mechanism keeps no secret in the repository and claims no more than it delivers", () => {
  const mechanism = contract.productionSurface.tenantContextMechanism;
  assert.equal(mechanism.secretInVersionControl, false);
  assert.equal(mechanism.secretReadableByRuntimeRole, false);
  // The design does not depend on preventing the write, only on making it worthless.
  assert.equal(mechanism.rawSettingWritableByRuntimeRole, true);
  assert.equal(mechanism.rawSettingSufficientForAccess, false);
  assert.equal(mechanism.boundToTransaction, true);
  // The owner is exempt from the signature but never from the tenant filter.
  assert.equal(mechanism.ownerExemptFromAttestation, true);
  assert.equal(mechanism.ownerExemptFromTenantFilter, false);
  assert.ok(mechanism.residualRisk.length > 0, "a single-role substrate must state its residual risk");
  assert.match(mechanism.design, /hmac/i);
  // No signing material may be committed: the secret is generated by the migration per database.
  const revision = readFileSync(path.join(root, `${REVISIONS_DIR}/${HEAD_REVISION}.py`), "utf8");
  assert.match(revision, /gen_random_bytes\(32\)/);
  assert.ok(!/secret\s*=\s*['"][0-9a-fA-F]{16,}/.test(revision), "no literal key may be committed");
});

test("passing on this branch is not verification, activation, or a gate", () => {
  assert.equal(contract.phaseStatus.greenImplemented, true);
  assert.equal(contract.phaseStatus.greenSuitePassesOnThisBranch, true);
  assert.equal(contract.phaseStatus.greenIndependentlyVerified, false);
  assert.equal(contract.phaseStatus.externallyEffective, false);
  assert.equal(contract.activation.effective, false);
  assert.equal(contract.packageState, PACKAGE_STATE);
  assert.equal(contract.independentVerification.recorded, false);
  assert.equal(contract.humanCountersign.recorded, false);
  assert.equal(contract.promotionClaims.claimedVerdict, null);
  for (const suite of contract.behavioralContract) {
    assert.equal(suite.phaseBOutcome, "pass", `${suite.id} must pass in Phase B`);
  }
});

test("the historical repository boundary is upheld, not relaxed, by living under db/", () => {
  // The boundary snapshot fences these at the repository root; the substrate is package-local.
  for (const fenced of ["apps", "src", "packages", "deploy", "migrations"]) {
    assert.equal(existsSync(path.join(root, fenced)), false, `${fenced} must not exist at the root`);
  }
  assert.ok(existsSync(path.join(root, "db")), "the substrate package must live under db/");
  assert.match(contract.allowedTargetsNote, /repository-boundary/i);
});

test("no file name anywhere in the package can trip the historical-evidence fence", () => {
  // The activation-base verifier fails closed on any /epoch/i file name in the repository.
  assert.deepEqual(verifier.checkDependencyFilenameCollision(root), []);
  const walk = (dir, relative) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".pytest_cache") continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else assert.ok(!/epoch/i.test(entry.name), `file name trips the historical-evidence fence: ${rel}`);
    }
  };
  walk(path.join(root, "db"), "db");
});

// =====================================================================================
// The behavioural contract is behaviour-oriented, not file-presence-oriented
// =====================================================================================

test("every declared behavioural suite exists as a real test module", () => {
  assert.deepEqual(contract.behavioralContract.map((s) => s.id), BEHAVIORAL_IDS);
  assert.deepEqual(checkBehavioralModules(contract, root), []);
});

test("the behavioural contract names observable behaviour, never mere file presence", () => {
  for (const suite of contract.behavioralContract) {
    assert.ok(suite.assertions.length >= 3, `${suite.id} states too few behavioural assertions`);
    for (const assertion of suite.assertions) {
      assert.equal(typeof assertion, "string");
      assert.ok(assertion.length > 0);
      assert.ok(!/^the file .* exists$/i.test(assertion), `${suite.id} asserts file presence only`);
    }
  }
  // The environment suite is the control that must pass; every other suite is RED for a
  // capability reason, so each must actually depend on a capability.
  const environment = contract.behavioralContract.find((s) => s.id === "environment");
  assert.equal(environment.phaseAOutcome, "pass");
  assert.deepEqual(environment.requiresCapabilities, []);
  const exercised = new Set();
  for (const suite of contract.behavioralContract.filter((s) => s.id !== "environment")) {
    assert.equal(suite.phaseAOutcome, "red-missing-capability");
    assert.ok(suite.requiresCapabilities.length > 0, `${suite.id} must depend on a capability`);
    for (const id of suite.requiresCapabilities) {
      assert.ok(REQUIRED_CAPABILITY_IDS.includes(id), `${suite.id} names an undeclared capability`);
      exercised.add(id);
    }
  }
  for (const id of REQUIRED_CAPABILITY_IDS) {
    assert.ok(exercised.has(id), `capability ${id} is declared but never exercised`);
  }
});

test("the required negative and concurrency proofs cannot be dropped silently", () => {
  const suite = (id) => contract.behavioralContract.find((s) => s.id === id);
  const rls = suite("rls-isolation").assertions;
  assert.ok(rls.filter((a) => /negative proof/i.test(a)).length >= 5, "RLS needs real negative proofs");
  assert.ok(rls.some((a) => /ENABLE/.test(a) && /FORCE/.test(a)), "RLS must assert ENABLE and FORCE");
  assert.ok(
    rls.some((a) => /fails closed/i.test(a) && /reads and writes/i.test(a)),
    "a missing context must deny reads and writes",
  );
  assert.ok(rls.some((a) => /invalid or empty/i.test(a)), "an invalid context must be covered too");
  const transaction = suite("transaction-atomicity").assertions;
  assert.ok(transaction.some((a) => /SET LOCAL/.test(a)));
  assert.ok(transaction.filter((a) => /non-leakage/i.test(a)).length >= 2);
  const audit = suite("audit-immutability").assertions;
  assert.ok(audit.some((a) => /privileged invariant/i.test(a)));
  const migration = suite("migration-roundtrip").assertions;
  for (const token of [/upgrade/i, /downgrade/i, /re-upgrade/i]) {
    assert.ok(migration.some((a) => token.test(a)), `migration round trip missing ${token.source}`);
  }
});

test("row-level security is enumerated over every runtime table this package owns", () => {
  // Two runtime tables, named as they exist in the database, and no business table among them.
  assert.deepEqual(contract.scope.runtimeTables, RUNTIME_TABLES);
  assert.deepEqual(contract.scope.runtimeTables, ["transactional_outbox", "audit_log"]);
  // Scope and production surface must name the same two tables, not two different vocabularies.
  assert.deepEqual(contract.scope.runtimeTables, contract.productionSurface.runtimeTables);
  // ...and the Alembic path the note points at is the one the revisions actually live in.
  assert.match(contract.allowedTargetsNote, /db\/metaframer_kernel_db\/alembic\/versions/);
  assert.ok(!/live at db\/migrations/.test(contract.allowedTargetsNote), "the stale path must be gone");
  assert.ok(existsSync(path.join(root, REVISIONS_DIR)));
  const rls = contract.behavioralContract.find((s) => s.id === "rls-isolation").assertions;
  for (const table of ["outbox table", "audit table"]) {
    assert.ok(rls.some((a) => a.includes(table)), `RLS coverage must name the ${table}`);
  }
  assert.ok(
    rls.some((a) => /enumerated over the declared runtime table list/i.test(a)),
    "coverage must be enumerated rather than spot-checked",
  );
});

test("a forged tenant context is proven to grant no access, by outcome rather than by SQL text", () => {
  const rls = contract.behavioralContract.find((s) => s.id === "rls-isolation");
  const forged = rls.assertions.find((a) => /forg/i.test(a));
  assert.ok(forged, "the forged-context negative proof must be declared");
  assert.match(forged, /SET LOCAL/);
  assert.match(forged, /set_config/);
  assert.match(forged, /attestation/i);
  assert.match(forged, /outcome/i, "the proof must assert the access outcome, not the SQL text");
  assert.match(forged, /read or write/i, "both reads and writes must be denied");
  // The capability that carries the property is declared and exercised by this suite.
  assert.ok(REQUIRED_CAPABILITY_IDS.includes("runtime.tenant_context_attestation"));
  assert.ok(rls.requiresCapabilities.includes("runtime.tenant_context_attestation"));
  const capability = contract.requiredCapabilities.find((c) => c.id === "runtime.tenant_context_attestation");
  assert.match(capability.contract, /forgeable_by_runtime_role/);
  assert.match(capability.contract, /policy_settings/);
  // The mechanism is deliberately left to Phase B.
  assert.match(capability.contract, /Phase B's choice/);
});

test("outbox semantics are at-least-once and never claim exactly-once", () => {
  const outbox = contract.behavioralContract.find((s) => s.id === "outbox-claim").assertions;
  assert.ok(outbox.some((a) => /SKIP LOCKED/.test(a)));
  assert.ok(outbox.some((a) => /tenant B/.test(a)), "outbox must assert no cross-tenant claim");
  assert.ok(outbox.some((a) => /at-least-once/i.test(a)), "the guarantee must be stated");
  assert.ok(
    outbox.some((a) => /redeliver/i.test(a) && /permitted/i.test(a)),
    "redelivery after a crash or an expired lease must be permitted, not excluded",
  );
  assert.ok(
    outbox.some((a) => /stable identifier/i.test(a) && /dedup/i.test(a)),
    "a stable identifier for downstream deduplication must be declared",
  );
  // Non-overlap is scoped to a single claim attempt, which is all a lease can promise.
  const nonOverlap = outbox.find((a) => /same row/i.test(a));
  assert.ok(nonOverlap, "the non-overlap proof must be declared");
  assert.match(nonOverlap, /(claim attempt|claim lease)/i);
});

test("no domain record table and no exactly-once promise survive anywhere in the package", () => {
  assert.deepEqual(
    checkForbiddenTokens(root),
    [],
    "the contract and the test suite must contain neither a domain record table nor an exactly-once promise",
  );
  assert.equal(FORBIDDEN_TOKENS.length, 2);
  // The bans are enforced against real files, so confirm the scanner actually reads them.
  const scanned = ["db/kernel-runtime-substrate-s1.json", "db/tests/test_outbox_claim.py"];
  for (const relative of scanned) assert.ok(existsSync(path.join(root, relative)));
  // ...and that it would catch a reintroduction.
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-substrate-tokens-"));
  try {
    execFileSync("mkdir", ["-p", path.join(scratch, "db/tests")]);
    writeFileSync(path.join(scratch, "db/tests/t.py"), "names.record_table\n# delivered exactly once\n");
    const findings = checkForbiddenTokens(scratch);
    assert.ok(findings.some((f) => f.startsWith("forbidden-token:domain-record-table:")));
    assert.ok(findings.some((f) => f.startsWith("forbidden-token:exactly-once-promise:")));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the declared database lifecycle is deterministic, bounded, cleaned and secret-free", () => {
  const lifecycle = contract.databaseLifecycle;
  assert.equal(lifecycle.image, LIFECYCLE_IMAGE);
  assert.equal(lifecycle.majorVersion, 16);
  assert.equal(lifecycle.engine, "docker");
  for (const flag of ["uniquelyNamedPerRun", "readinessPolled", "boundedTimeouts", "cleanedOnFailure"]) {
    assert.equal(lifecycle[flag], true, `${flag} must be guaranteed`);
  }
  assert.equal(lifecycle.hostPsqlUsed, false);
  assert.equal(lifecycle.committedSecrets, false);
  assert.ok(lifecycle.readinessSignals.length >= 2, "readiness must not rest on a single signal");
  assert.ok(lifecycle.cleanupMechanisms.length >= 2, "cleanup must not rest on a single mechanism");
  // The role split is what makes a FORCE RLS proof non-vacuous.
  assert.equal(lifecycle.roles.migration.name, MIGRATION_ROLE);
  assert.equal(lifecycle.roles.runtime.name, RUNTIME_ROLE);
  assert.notEqual(lifecycle.roles.migration.name, lifecycle.roles.runtime.name);
  assert.equal(lifecycle.roles.runtime.superuser, false);
  assert.equal(lifecycle.roles.runtime.bypassRls, false);
  assert.equal(lifecycle.roles.runtime.ownsDatabase, false);
  assert.equal(lifecycle.roles.runtime.ownsSchema, false);
  assert.equal(lifecycle.roles.migration.ownsDatabase, true);
  assert.equal(lifecycle.roles.migration.superuser, false);
});

test("the static toolchain is pinned in the project, not fetched on the fly", async () => {
  const declared = contract.staticAnalysis;
  const pkg = await readJson("package.json");
  const pyproject = await readFile(path.join(root, "db/pyproject.toml"), "utf8");
  const lock = await readFile(path.join(root, "db/uv.lock"), "utf8");

  // The contract names the script, and the script is exactly what the contract says it is.
  assert.equal(declared.script, STATIC_SCRIPT);
  assert.equal(pkg.scripts[STATIC_SCRIPT], declared.command);
  assert.deepEqual(checkStaticAnalysisWiring(contract, root), []);

  // Ruff is a project dependency at the exact version the lock resolved and the contract pins.
  assert.match(pyproject, /"ruff>=0\.14\.0,<0\.15\.0"/);
  assert.match(pyproject, /^\[tool\.ruff\]/m, "settings must live in pyproject so commands need no flags");
  const resolved = /name = "ruff"\nversion = "([^"]+)"/.exec(lock);
  assert.ok(resolved, "ruff must be resolved in uv.lock");
  assert.equal(resolved[1], declared.pinnedVersions.ruff);

  // Every step runs from that resolved environment, and none of them fetches a tool.
  assert.equal((declared.command.match(/uv run --frozen/g) ?? []).length, 3);
  for (const ephemeral of EPHEMERAL_INVOCATIONS) {
    assert.ok(!declared.command.includes(ephemeral), `the static command must not use ${ephemeral.trim()}`);
  }
  assert.equal(declared.packagePinned, true);
  assert.equal(declared.ephemeralToolInvocationAllowed, false);

  // All three checks the reviewer asked for, plus the lock-consistency gate.
  for (const fragment of [
    "uv lock --check",
    "ruff check metaframer_kernel_db tests",
    "ruff format --check metaframer_kernel_db tests",
    "python -m compileall -q metaframer_kernel_db tests",
  ]) {
    assert.ok(declared.command.includes(fragment), `the static command must run ${fragment}`);
  }
});

test("the static check leaves no cache artifact to be tracked", async () => {
  const declared = contract.staticAnalysis;
  assert.equal(declared.cacheArtifactsWrittenIntoTree, false);
  // compileall's bytecode is redirected outside the working tree.
  assert.match(declared.command, /PYTHONPYCACHEPREFIX="\$\{TMPDIR:-\/tmp\}\//);
  // ...and any cache that a different tool writes is ignored rather than committed.
  const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
  for (const pattern of ["__pycache__/", ".pytest_cache/", "*.py[cod]"]) {
    assert.ok(gitignore.includes(pattern), `.gitignore must cover ${pattern}`);
  }
  const tracked = execFileSync("git", ["ls-files", "db"], { cwd: root, encoding: "utf8" });
  assert.ok(!/__pycache__|\.pyc/.test(tracked), "no cache artifact may be tracked");
});

test("the static wiring fails closed when any of its three sources drifts", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-substrate-static-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  execFileSync("mkdir", ["-p", path.join(scratch, "db")]);

  const write = (relative, body) => writeFileSync(path.join(scratch, relative), body);
  // A repository whose script, dependency declaration and lock all disagree with the contract.
  write("package.json", JSON.stringify({ scripts: { [STATIC_SCRIPT]: "uvx ruff check ." } }));
  write("db/pyproject.toml", "[project]\nname = 'x'\n");
  write("db/uv.lock", 'name = "ruff"\nversion = "9.9.9"\n');

  const findings = checkStaticAnalysisWiring(contract, scratch);
  for (const expected of [
    "static-analysis-command-drift",
    "ruff-not-a-declared-dependency",
    "ruff-not-configured-in-pyproject",
    `ruff-version-drift:lock=9.9.9:contract=${contract.staticAnalysis.pinnedVersions.ruff}`,
  ]) {
    assert.ok(findings.includes(expected), `expected ${expected}, got ${JSON.stringify(findings)}`);
  }
  // A missing script is caught too, not silently treated as satisfied.
  write("package.json", JSON.stringify({ scripts: {} }));
  assert.ok(checkStaticAnalysisWiring(contract, scratch).includes(`static-analysis-script-missing:${STATIC_SCRIPT}`));
});

test("the pinned dependency lock is committed and matches the declared bounded scope", async () => {
  const pyproject = await readFile(path.join(root, "db/pyproject.toml"), "utf8");
  assert.ok(existsSync(path.join(root, "db/uv.lock")), "db/uv.lock must be committed");
  assert.match(pyproject, /requires-python\s*=\s*"==3\.12\.\*"/);
  assert.match(pyproject, /sqlalchemy>=2\.0/);
  assert.match(pyproject, /alembic>=1\./);
  assert.match(pyproject, /sqlmodel>=0\./);
  assert.match(pyproject, /psycopg\[binary\]>=3\./);
  // Phase B ships one real, installable package, so the capability targets are ordinary imports.
  assert.match(pyproject, /build-backend\s*=\s*"hatchling\.build"/);
  assert.match(pyproject, /packages\s*=\s*\["metaframer_kernel_db"\]/);
  const lock = await readFile(path.join(root, "db/uv.lock"), "utf8");
  for (const pinned of ["sqlalchemy", "alembic", "sqlmodel", "psycopg", "pytest"]) {
    assert.ok(lock.includes(`name = "${pinned}"`), `${pinned} must be pinned in uv.lock`);
  }
  // No forbidden stack member may enter the lock.
  for (const forbidden of ["prisma", "supabase", "pysqlite"]) {
    assert.ok(!lock.includes(`name = "${forbidden}"`), `${forbidden} must not be locked`);
  }
});

// =====================================================================================
// Adversarial: contract mutations
// =====================================================================================

const attacks = [
  ["an added root key", () => ({ ...clone(contract), extra: true }), "contract-root-key-drift"],
  ["a package declared already effective", () => mutated("packageState", "effective"), "contract-package-state-drift"],
  ["a phase advanced past the work that was actually done", () => mutated("phase", "C-PROMOTED"), "contract-phase-drift"],
  ["a green run promoted to independent verification", () => mutated("phaseStatus.greenIndependentlyVerified", true), "phase-status-drift:greenIndependentlyVerified"],
  ["a green run promoted to effectiveness", () => mutated("phaseStatus.externallyEffective", true), "phase-status-drift:externallyEffective"],
  ["a capability declared implemented outside the production surface", () => mutated("requiredCapabilities.0.implementedIn", "db/tests/_harness/capability.py"), "capability-implemented-outside-production-surface:migration.alembic_config"],
  ["a capability quietly left unimplemented", () => mutated("requiredCapabilities.0.implementedInPhaseB", false), "capability-not-implemented:migration.alembic_config"],
  ["a second revision claimed without one existing", () => mutated("productionSurface.revisionCount", 2), "production-surface-drift:revisionCount"],
  ["a domain table added to the production surface", () => mutated("productionSurface.runtimeTables", ["transactional_outbox", "audit_log", "business_record"]), "production-surface-drift:runtimeTables"],
  ["a signing secret admitted into version control", () => mutated("productionSurface.tenantContextMechanism.secretInVersionControl", true), "tenant-context-mechanism-drift:secretInVersionControl"],
  ["a raw setting declared sufficient for access", () => mutated("productionSurface.tenantContextMechanism.rawSettingSufficientForAccess", true), "tenant-context-mechanism-drift:rawSettingSufficientForAccess"],
  ["the owner exempted from the tenant filter", () => mutated("productionSurface.tenantContextMechanism.ownerExemptFromTenantFilter", true), "tenant-context-mechanism-drift:ownerExemptFromTenantFilter"],
  ["a mechanism that admits no residual risk", () => mutated("productionSurface.tenantContextMechanism.residualRisk", ""), "tenant-context-mechanism-missing:residualRisk"],
  ["a suite that no longer passes in Phase B", () => mutated("behavioralContract.2.phaseBOutcome", "fail"), "behavioral-phase-b-outcome-drift:rls-isolation"],
  ["an embedded absolute path", () => mutated("scope.summary", "the substrate at /Users/someone/db"), "contract-embeds-absolute-path"],

  ["a drifted Actionplan authority commit", () => mutated("authorityBinding.actionplan.commit", "0".repeat(40)), "authority-drift:commit"],
  ["an overreaching authority verdict", () => mutated("authorityBinding.actionplan.verdict", "GO-RUNTIME-PILOT"), "verdict-overreach:GO-RUNTIME-PILOT"],
  ["a drifted kernel base", () => mutated("authorityBinding.kernelBase.commit", "0".repeat(40)), "kernel-base-drift:commit"],
  ["a self-referential base", () => mutated("authorityBinding.kernelBase.selfReferential", true), "kernel-base-self-referential"],
  ["a recorded self-referential SHA", () => mutated("authorityBinding.selfReferentialCommitShaRecorded", true), "self-referential-sha-recorded"],

  ["an activation base declared rewritten", () => mutated("activationBase.rewritten", true), "activation-base-rewritten"],
  ["an activation base already claiming runtime start", () => mutated("activationBase.state.runtimeImplementationStarted", true), "activation-base-state-drift:runtimeImplementationStarted"],
  ["a candidate declaring itself effective", () => mutated("desiredState.effective", true), "desired-state-declared-effective"],
  ["a desired state that opens release", () => mutated("desiredState.releaseAllowed", true), "forbidden-true:releaseAllowed"],
  ["a desired state that opens deploy", () => mutated("desiredState.deployAllowed", true), "forbidden-true:deployAllowed"],
  ["a desired state that opens production", () => mutated("desiredState.productionAllowed", true), "forbidden-true:productionAllowed"],
  ["a desired state that closes the gap", () => mutated("desiredState.gapClosed", true), "forbidden-true:gapClosed"],
  ["a desired state that claims the kernel is ready", () => mutated("desiredState.kernelReady", true), "forbidden-true:kernelReady"],
  ["a desired state that closes the code-start floor", () => mutated("desiredState.codeStartAllowed", false), "desired-state-drift:codeStartAllowed"],
  ["a desired state that never starts the runtime", () => mutated("desiredState.runtimeImplementationStarted", false), "desired-state-drift:runtimeImplementationStarted"],
  ["a delta that moves more than the one dimension", () => mutated("stateDelta.changedDimensions", ["runtimeImplementationStarted", "releaseAllowed"]), "state-delta-drift:changedDimensions"],

  ["a capability no longer declared absent", () => mutated("requiredCapabilities.0.absentInPhaseA", false), "capability-not-declared-absent:migration.alembic_config"],
  ["a dropped capability", () => {
    const forged = clone(contract);
    forged.requiredCapabilities = forged.requiredCapabilities.filter((c) => c.id !== "outbox.claim_batch");
    return forged;
  }, "capability-set-drift"],
  ["a capability target escaping the production import root", () => mutated("requiredCapabilities.0.target", "tests._harness.fake:thing"), "capability-target-outside-production-root:migration.alembic_config"],

  ["a behavioural suite reduced to file presence", () => mutated("behavioralContract.2.assertions", ["the file exists"]), "behavioral-assertions-too-thin:rls-isolation"],
  ["RLS negative proofs quietly dropped", () => mutated("behavioralContract.2.assertions", [
    "a tenant reads only its own rows",
    "the policy is FORCE row-level security",
    "rows are visible",
  ]), "rls-negative-proofs-too-thin"],
  ["the FORCE requirement downgraded to ENABLE", () => mutated("behavioralContract.2.assertions", [
    "negative proof: tenant A cannot SELECT tenant B's row",
    "negative proof: tenant A cannot UPDATE tenant B's row",
    "negative proof: tenant A cannot INSERT as tenant B",
    "row-level security is enabled",
  ]), "rls-force-not-asserted"],
  ["the audit privileged invariant dropped", () => mutated("behavioralContract.5.assertions", [
    "an audit row can be appended",
    "the runtime role cannot UPDATE an existing audit row",
    "the runtime role cannot DELETE an existing audit row",
  ]), "audit-privileged-invariant-missing"],
  ["SET LOCAL non-leakage weakened", () => mutated("behavioralContract.3.assertions", [
    "a transaction that raises leaves no partial row behind",
    "a committed transaction persists every row it wrote",
    "the tenant context is applied",
  ]), "transaction-set-local-not-asserted"],
  ["the outbox cross-tenant proof dropped", () => mutated("behavioralContract.4.assertions", [
    "an outbox row is written in the same transaction as its change",
    "two concurrent claimers never receive the same outbox row",
    "concurrent claimers do not block each other, proving FOR UPDATE SKIP LOCKED rather than a plain FOR UPDATE",
  ]), "outbox-cross-tenant-not-asserted"],
  ["a RED suite that depends on no capability", () => mutated("behavioralContract.1.requiresCapabilities", []), "behavioral-red-without-capability:migration-roundtrip"],
  ["a RED suite relabelled as passing", () => mutated("behavioralContract.1.phaseAOutcome", "pass"), "behavioral-phase-a-outcome-drift:migration-roundtrip"],

  ["a lifecycle downgraded off PostgreSQL 16", () => mutated("databaseLifecycle.image", "postgres:15-alpine"), "lifecycle-image-drift"],
  ["a lifecycle that stops cleaning up", () => mutated("databaseLifecycle.cleanedOnFailure", false), "lifecycle-guarantee-missing:cleanedOnFailure"],
  ["a lifecycle that stops polling readiness", () => mutated("databaseLifecycle.readinessPolled", false), "lifecycle-guarantee-missing:readinessPolled"],
  ["a lifecycle admitting committed secrets", () => mutated("databaseLifecycle.committedSecrets", true), "lifecycle-committed-secrets"],
  ["a runtime role granted BYPASSRLS", () => mutated("databaseLifecycle.roles.runtime.bypassRls", true), "runtime-role-drift:bypassRls"],
  ["a runtime role made superuser", () => mutated("databaseLifecycle.roles.runtime.superuser", true), "runtime-role-drift:superuser"],
  ["a runtime role made the schema owner", () => mutated("databaseLifecycle.roles.runtime.ownsSchema", true), "runtime-role-drift:ownsSchema"],

  ["an activation declared effective on this branch", () => mutated("activation.effective", true), "activation-effective-on-branch"],
  ["a predicate satisfied from this branch", () => mutated("activation.predicates.0.satisfiedOnThisBranch", true), "activation-predicate-satisfied-on-branch:artifact-present-on-kernel-main"],
  ["a preclaimed activator", () => mutated("activation.activatedBy", "claude"), "activation-preclaimed"],

  ["an invented independent verification", () => mutated("independentVerification.recorded", true), "independent-verification-invented"],
  ["invented in-repo verification evidence", () => mutated("independentVerification.inRepoEvidenceCreated", true), "independent-verification-evidence-invented"],
  ["a writer permitted to self-verify", () => mutated("independentVerification.writerMaySelfVerify", true), "writer-self-verification-allowed"],
  ["an invented human countersign", () => mutated("humanCountersign.recorded", true), "human-countersign-invented"],
  ["a dropped human countersign requirement", () => mutated("humanCountersign.required", false), "human-countersign-not-required"],
  ["a claimed verdict", () => mutated("promotionClaims.claimedVerdict", "GO-RUNTIME-PILOT"), "promotion-verdict-claimed"],
  ["a claimed promotion gate", () => mutated("promotionClaims.claimedGates", ["GRP-05"]), "promotion-gate-claimed"],
  ["a GRP-01 claim", () => mutated("promotionClaims.claimsGate01", true), "promotion-claim:claimsGate01"],
  ["a production claim", () => mutated("promotionClaims.claimsProduction", true), "promotion-claim:claimsProduction"],

  // --- the four scope repairs, each guarded against silent reintroduction -------------------
  ["a domain record table added to the runtime table list", () => mutated("scope.runtimeTables", ["record_table", "outbox_table", "audit_table"]), "runtime-table-set-drift"],
  ["a runtime table dropped from the list", () => mutated("scope.runtimeTables", ["outbox_table"]), "runtime-table-set-drift"],
  ["RLS coverage that omits the audit table", () => mutated("behavioralContract.2.assertions", [
    "every runtime table has row-level security both ENABLEd and FORCEd",
    "negative proof: tenant A cannot SELECT a tenant B row in the outbox table",
    "negative proof: tenant A cannot UPDATE or DELETE a tenant B outbox row",
    "negative proof: tenant A cannot INSERT into the outbox table as tenant B",
    "negative proof: a missing context fails closed and denies reads and writes",
    "negative proof: an invalid or empty context is denied",
    "negative proof: forging with SET LOCAL or set_config changes no outcome without an attestation",
  ]), "rls-runtime-table-not-covered:audit"],
  ["the forged-context negative proof dropped", () => mutated("behavioralContract.2.assertions", [
    "every runtime table — the outbox table and the audit table — has row-level security ENABLEd and FORCEd, enumerated over the declared runtime table list",
    "negative proof: tenant A cannot SELECT a tenant B row",
    "negative proof: tenant A cannot UPDATE or DELETE a tenant B row",
    "negative proof: tenant A cannot INSERT as tenant B",
    "negative proof: a missing context fails closed and denies reads and writes",
    "negative proof: an invalid or empty context is denied",
  ]), "rls-forged-context-proof-missing"],
  ["a fail-closed proof that only denies reads", () => mutated("behavioralContract.2.assertions", [
    "every runtime table — the outbox table and the audit table — has row-level security ENABLEd and FORCEd, enumerated over the declared runtime table list",
    "negative proof: tenant A cannot SELECT a tenant B row",
    "negative proof: tenant A cannot UPDATE or DELETE a tenant B row",
    "negative proof: tenant A cannot INSERT as tenant B",
    "negative proof: with no tenant context the runtime role sees no rows, so the policy fails closed",
    "negative proof: an invalid or empty tenant context is denied",
    "negative proof: forging with SET LOCAL or set_config yields the same outcome without an attestation",
  ]), "rls-fail-closed-must-deny-reads-and-writes"],
  ["an at-least-once guarantee quietly dropped", () => mutated("behavioralContract.4.assertions", [
    "an outbox row is written in the same transaction boundary as the audit row it accompanies, and is rolled back with it",
    "two concurrent claimers do not receive the same row within one claim attempt",
    "concurrent claimers do not block each other, proving FOR UPDATE SKIP LOCKED rather than a plain FOR UPDATE",
    "a claimer in tenant A never claims an outbox row belonging to tenant B",
    "each outbox row carries a stable identifier so a consumer can dedup redeliveries",
  ]), "outbox-at-least-once-not-declared"],
  ["a non-overlap claim widened beyond one attempt", () => mutated("behavioralContract.4.assertions", [
    "an outbox row is written in the same transaction boundary as the audit row it accompanies, and is rolled back with it",
    "two concurrent claimers never receive the same row, ever",
    "concurrent claimers do not block each other, proving FOR UPDATE SKIP LOCKED rather than a plain FOR UPDATE",
    "a claimer in tenant A never claims an outbox row belonging to tenant B",
    "semantics are at-least-once and redelivery is permitted after a crash",
    "each outbox row carries a stable identifier so a consumer can dedup redeliveries",
  ]), "outbox-non-overlap-not-scoped-to-one-attempt"],
  ["atomicity moved off the runtime tables", () => mutated("behavioralContract.3.assertions", [
    "a transaction that raises is rolled back",
    "a committed transaction is persisted",
    "the tenant context is applied with SET LOCAL and is therefore transaction-local",
    "non-leakage: the setting does not survive its transaction",
    "non-leakage: a later transaction never inherits the previous tenant",
  ]), "transaction-atomicity-not-over-runtime-tables:rolled back"],
  ["the tenant-context attestation capability removed", () => {
    const forged = clone(contract);
    forged.requiredCapabilities = forged.requiredCapabilities.filter(
      (c) => c.id !== "runtime.tenant_context_attestation",
    );
    return forged;
  }, "capability-set-drift"],

  // --- the two follow-ups, now GREEN and cross-bound to their source ------------------------
  ["a follow-up quietly reverted to RED", () => mutated("redFollowUps.phase", "RED"), "follow-ups-phase-drift"],
  ["a follow-up that forgets it was ever RED", () => mutated("redFollowUps.originallyRed", false), "follow-ups-forgot-their-red"],
  ["a gap not declared green", () => mutated("redFollowUps.gaps.0.status", "red"), "follow-up-not-green:GAP1-outbox-claim-fencing"],
  ["a capability declared unimplemented while its code exists", () => mutated("redFollowUps.gaps.0.declaredCapabilities.0.implemented", false), "follow-up-capability-not-implemented:outbox.release_claim"],
  ["a fencing predicate loosened in the contract", () => mutated("redFollowUps.gaps.0.fencingPredicate", "id = ANY(:ids)"), "fencing-predicate-drift"],
  ["an ids-only mutation path readmitted", () => mutated("redFollowUps.gaps.0.idsOnlyMutationPathRemoved", false), "fencing-ids-only-path-retained"],
  ["a removed ids-only API quietly restored to the public set", () => mutated("redFollowUps.gaps.0.publicMutationApis", ["release_claim", "publish_claim", "release_batch"]), "fencing-public-api-drift"],
  ["row-level security demoted below the token check", () => mutated("redFollowUps.gaps.0.rowLevelSecurityRemainsDecisive", false), "fencing-rls-not-decisive"],
  ["an evaluator declared missing while it exists", () => mutated("redFollowUps.gaps.1.evaluator.implemented", false), "activation-evaluator-not-implemented"],
  ["a compositor declared missing while it exists", () => mutated("redFollowUps.gaps.1.compositor.implemented", false), "activation-compositor-not-implemented"],
  ["an unbounded remote reader", () => mutated("redFollowUps.gaps.1.reader.boundedTimeoutMs", 0), "activation-reader-unbounded"],
  ["a reader permitted to prompt", () => mutated("redFollowUps.gaps.1.reader.nonInteractive", false), "activation-reader-interactive"],
  ["a reader permitted to throw instead of denying", () => mutated("redFollowUps.gaps.1.reader.failureIsNotEffectiveNotAnException", false), "activation-reader-may-throw"],
  ["a reader that always hits the network", () => mutated("redFollowUps.gaps.1.reader.shortCircuitsBeforeAnyNetworkCall", ""), "activation-reader-always-hits-network"],
  ["a reader that stops deriving the package commit", () => mutated("redFollowUps.gaps.1.reader.proves", ["HEAD equals refs/remotes/origin/main", "the canonical origin", "local tag object", "ls-remote"]), "activation-reader-missing-proof:package-commit"],
  ["a check that edits the activation base verifier", () => mutated("redFollowUps.gaps.1.checkWiring.activationBaseVerifierEdited", true), "activation-base-verifier-edited"],
  ["a check that edits the activation base artifact", () => mutated("redFollowUps.gaps.1.checkWiring.activationBaseArtifactEdited", true), "activation-base-artifact-edited"],
  ["a check wiring that drops the activation base", () => mutated("redFollowUps.gaps.1.checkWiring.invocation", "node tools/compose-current-effective.mjs"), "activation-check-wiring-drift:activation-base"],

  ["a static toolchain fetched ephemerally", () => mutated("staticAnalysis.command", "cd db && uvx ruff check ."), "static-analysis-uses-ephemeral-tool:uvx"],
  ["a static toolchain no longer declared as pinned", () => mutated("staticAnalysis.packagePinned", false), "static-analysis-not-package-pinned"],
  ["ephemeral tool invocation re-permitted", () => mutated("staticAnalysis.ephemeralToolInvocationAllowed", true), "static-analysis-allows-ephemeral-tools"],
  ["a static step run outside the frozen environment", () => mutated("staticAnalysis.command", "cd db && uv lock --check && ruff check metaframer_kernel_db tests && ruff format --check metaframer_kernel_db tests && PYTHONPYCACHEPREFIX=/tmp/x python -m compileall -q metaframer_kernel_db tests"), "static-analysis-unfrozen-runs:0"],
  ["a lint step dropped from the command", () => mutated("staticAnalysis.command", "cd db && uv lock --check && uv run --frozen ruff format --check metaframer_kernel_db tests && uv run --frozen ruff check metaframer_kernel_db tests && uv run --frozen python -m compileall -q metaframer_kernel_db"), "static-analysis-tool-not-in-command:compileall:compile"],
  ["cache artifacts admitted into the tree", () => mutated("staticAnalysis.cacheArtifactsWrittenIntoTree", true), "static-analysis-writes-cache-into-tree"],
  ["the cache redirect removed", () => mutated("staticAnalysis.command", "cd db && uv lock --check && uv run --frozen ruff check metaframer_kernel_db tests && uv run --frozen ruff format --check metaframer_kernel_db tests && uv run --frozen python -m compileall -q metaframer_kernel_db tests"), "static-analysis-omits-cache-redirect"],
  ["the lock-consistency gate removed", () => mutated("staticAnalysis.command", "cd db && uv run --frozen ruff check metaframer_kernel_db tests && uv run --frozen ruff format --check metaframer_kernel_db tests && PYTHONPYCACHEPREFIX=/tmp/x uv run --frozen python -m compileall -q metaframer_kernel_db tests"), "static-analysis-omits-lock-consistency-check"],
  ["an unpinned linter version", () => mutated("staticAnalysis.pinnedVersions.ruff", ""), "static-analysis-drift:pinnedVersions.ruff"],

  ["a declared historical rewrite", () => mutated("preservation.rewritesHistoricalArtifacts", true), "historical-rewrite-declared"],
  ["a narrowed read-only set", () => mutated("preservation.readOnly", ["repository-status.json"]), "read-only-entry-missing:planning/kernel-runtime-pilot-consumer-sync.json"],
  ["a candidate that seizes the current-effective line", () => mutated("checkComposition.emitsCurrentEffectiveLine", true), "candidate-emits-current-effective-line"],
  ["the final line credited to the activation base rather than the compositor", () => mutated("checkComposition.finalCurrentEffectiveLineOwner", "tools/check-kernel-runtime-pilot-consumer-sync.mjs"), "current-effective-owner-drift"],
  ["the activation base credited to the compositor", () => mutated("checkComposition.activationBaseLineOwner", "tools/compose-current-effective.mjs"), "activation-base-owner-drift"],
  ["a candidate that drops its branch-candidate line", () => mutated("checkComposition.emitsBranchCandidateLine", false), "candidate-omits-branch-candidate-line"],
];

for (const [name, build, expected] of attacks) {
  test(`the verifier rejects ${name}`, () => {
    const { errors, ok } = evaluateContract({ contract: build() });
    assert.equal(ok, false, `${name} must be rejected`);
    assert.ok(errors.includes(expected), `expected ${expected}, got ${JSON.stringify(errors)}`);
  });
}

test("a missing contract is rejected rather than treated as empty", () => {
  assert.deepEqual(evaluateContract({ contract: null }), { errors: ["contract-missing"], ok: false });
  assert.equal(evaluateContract({}).ok, false);
});

test("the base commit is verified as a commit object, not as a ref name", () => {
  assert.equal(validateKernelBase(root, "0".repeat(40)).reason, "base-commit-absent");
  assert.equal(validateKernelBase(root, "main").reason, "base-sha-malformed");
  assert.equal(validateKernelBase(root, KERNEL_BASE_SHA.toUpperCase()).reason, "base-sha-malformed");
});

test("a second home for the production package is caught", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-substrate-s1-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  // A copy of the package somewhere other than its declared home would mean two substrates.
  const stray = path.join(scratch, "db", "vendor", PRODUCTION_IMPORT_ROOT);
  execFileSync("mkdir", ["-p", stray]);
  writeFileSync(path.join(stray, "__init__.py"), "");
  const findings = checkProductionSurface(scratch);
  assert.ok(
    findings.some((f) => f.startsWith("production-package-homes:")),
    `a stray production package must be caught, got ${JSON.stringify(findings)}`,
  );
});

test("a contract that drifts from the source it describes is caught", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-substrate-src-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  execFileSync("mkdir", ["-p", path.join(scratch, REVISIONS_DIR)]);
  // A revision tree whose baseline names a different revision, drops FORCE, and hard-codes a key.
  writeFileSync(
    path.join(scratch, `${REVISIONS_DIR}/${HEAD_REVISION}.py`),
    'revision = "0002_something_else"\ndown_revision = "0001"\n',
  );
  writeFileSync(path.join(scratch, "db/metaframer_kernel_db/migrations.py"), "HEAD_REVISION = 'nope'\n");
  writeFileSync(path.join(scratch, "db/metaframer_kernel_db/schema.py"), "OUTBOX = 'other'\n");
  writeFileSync(path.join(scratch, "db/metaframer_kernel_db/outbox.py"), "SELECT 1\n");
  const findings = checkSourceCrossBinding(scratch);
  for (const expected of [
    `head-revision-not-declared-in-source:${HEAD_REVISION}`,
    "revision-id-mismatch",
    "baseline-revision-has-a-predecessor",
    "revision-missing:FORCE ROW LEVEL SECURITY",
    "revision-missing:per-database-secret",
    "claim-not-skip-locked",
  ]) {
    assert.ok(findings.includes(expected), `expected ${expected}, got ${JSON.stringify(findings)}`);
  }
});

// =====================================================================================
// Production CLI and repository wiring
// =====================================================================================

test("the production CLI validates the real repository and exits zero", () => {
  const output = execFileSync(process.execPath, [path.join(root, verifierPath)], { encoding: "utf8", cwd: root });
  assert.match(output, /^OK kernel-runtime-substrate-s1:/m);
  assert.match(output, new RegExp(KERNEL_BASE_SHA.slice(0, 7)));
  assert.match(output, /BRANCH CANDIDATE \(not effective/);
  assert.match(output, new RegExp(`phase=${PHASE}`));
  assert.match(output, /packageState=prepared-awaiting-main-activation/);
  assert.match(output, /runtimeImplementationStarted=true/);
  // The candidate never emits the single authoritative current-effective summary.
  assert.ok(!output.includes("CURRENT EFFECTIVE"), "the candidate must not emit a current-effective line");
});

test("npm run check wires this verifier before the activation-base verifier, and npm test discovers this suite", async () => {
  const pkg = await readJson("package.json");
  assert.ok(pkg.scripts.check.includes(verifierPath), "npm run check must run the substrate verifier");
  assert.equal(pkg.scripts["check:substrate-s1"], `node ${verifierPath}`);
  // Ordering matters: the compositor owns the final CURRENT EFFECTIVE line, and it wraps the
  // activation-base verifier whose output it consumes, so both must run after this one.
  assert.ok(
    pkg.scripts.check.indexOf(verifierPath) <
      pkg.scripts.check.indexOf("tools/check-kernel-runtime-pilot-consumer-sync.mjs"),
    "the substrate verifier must run before the activation-base verifier",
  );
  // The existing checks are extended, never bypassed or replaced.
  for (const existing of [
    "tools/check-repository-boundary.mjs",
    "tools/check-control-plane-bootstrap.mjs",
    "tools/check-kernel-ai-development-readiness.mjs",
    "tools/check-kernel-runtime-pilot-consumer-sync.mjs",
  ]) {
    assert.ok(pkg.scripts.check.includes(existing), `${existing} must stay in npm run check`);
  }
  // The substrate suite stays out of npm test: it needs a Docker daemon and a real PostgreSQL 16
  // container, which npm test must not require of anyone running the governance checks.
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs");
  assert.ok(!pkg.scripts.test.includes("pytest"), "the substrate suite must not run inside npm test");
  assert.equal(pkg.scripts["test:substrate-s1"], "cd db && uv run --frozen pytest");
  // The Phase A name is gone: the suite passes now, so calling it ":red" would be a lie.
  assert.equal(pkg.scripts["test:substrate-s1:red"], undefined, "the stale RED-only script name must be gone");
});

test("npm run check still ends with exactly one CURRENT EFFECTIVE line, owned by the compositor, with the activation-base line relabelled", () => {
  const result = spawnSync("npm", ["run", "check", "--silent"], { cwd: root, encoding: "utf8" });
  assert.equal(result.error, undefined, `npm run check could not be executed: ${result.error?.message}`);
  const lines = String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(">"));
  const context = `\n--- npm run check output ---\n${lines.join("\n")}\n---`;

  const current = lines.filter((line) => line.includes("CURRENT EFFECTIVE"));
  assert.equal(current.length, 1, `expected exactly one CURRENT EFFECTIVE line${context}`);
  assert.equal(lines.at(-1), current[0], `the CURRENT EFFECTIVE line must be last${context}`);
  assert.match(current[0], new RegExp(CURRENT_VERDICT));
  // The activation base still reports runtime start as not yet in force.
  assert.match(current[0], /runtimeImplementationStarted=false/);

  // The branch candidate is present, distinct, explicitly non-effective, and comes earlier.
  const candidates = lines.filter((line) => line.startsWith("BRANCH CANDIDATE"));
  assert.equal(candidates.length, 1, `expected exactly one BRANCH CANDIDATE line${context}`);
  assert.match(candidates[0], /not effective/);
  assert.match(candidates[0], /runtimeImplementationStarted=true/);
  assert.ok(lines.indexOf(candidates[0]) < lines.indexOf(current[0]), `the candidate must precede the current line${context}`);

  // The two lines must not be confusable: one is in force, the other is a desire.
  assert.ok(!candidates[0].includes("CURRENT EFFECTIVE"));
  // No legacy verdict token may appear on the candidate line.
  for (const legacy of ["PLANNING_ONLY", "VALID_BLOCKED", "NO_GO", "NO-GO", "code start denied", "BLOCKED"]) {
    assert.ok(!candidates[0].includes(legacy), `the candidate line reuses the legacy token ${legacy}`);
  }
  for (const overreach of ["GO-RUNTIME-PILOT", "GO-PRODUCTION"]) {
    assert.ok(!candidates[0].includes(overreach), `the candidate line overreaches with ${overreach}`);
  }
});
