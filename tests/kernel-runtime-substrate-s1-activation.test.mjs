// GAP2, RED by design: neither the activation evaluator nor the compositor exists yet.
//
// Every test that drives them fails with a message naming exactly what is missing, and that is the
// point. The cases below are the specification they will have to satisfy, written before they are
// written, so the implementation is measured against a contract it cannot quietly reshape.
//
// The design under specification: activation is recorded by exactly one annotated Git tag,
// `kernel-runtime-substrate-s1-activated`, created by the root Codex MASTER after merge and
// **published on the canonical origin**. There is no in-repository status flip and no commit that
// records its own hash, because either would let the package vouch for itself. A tag sitting in
// somebody's working copy is evidence about that machine, not about the project, so it activates
// nothing until it is pushed.
//
// Git facts are produced by a real scratch repository with a real bare origin — no network, no
// fixed SHAs, nothing hand-waved. Tests inject that scratch path as the expected remote; production
// pins git@github.com:metaframer-net/metaframer-kernel.git.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = "tools/check-kernel-runtime-substrate-s1.mjs";
const verifier = await import(pathToFileURL(path.join(root, verifierPath)).href);

const contract = JSON.parse(
  await readFile(path.join(root, "db/kernel-runtime-substrate-s1.json"), "utf8"),
);
const gap = contract.redFollowUps.gaps.find((g) => g.id === "GAP2-external-tag-activation");
const authority = gap.tagAuthority;

const {
  ACTIVATION_TAG_NAME, ACTIVATION_EVALUATOR_EXPORT, ACTIVATION_REQUIRED_COMMANDS,
  ACTIVATION_MESSAGE_FIELDS, ACTIVATION_COMPOSITOR_MODULE, ACTIVATION_COMPOSITOR_EXPORT,
  CANONICAL_KERNEL_REMOTE, CONTRACT_ID, SHUT_FLAGS, FORBIDDEN_FLAG_NAMES,
} = verifier;

// =====================================================================================
// A real scratch repository with a real bare origin. Deterministic and offline.
// =====================================================================================

const git = (cwd, args) =>
  execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/**
 * Build an origin and a working clone, then produce the three tag states that matter:
 * absent, local-only, and published.
 */
function buildFixture() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-activation-"));
  const origin = path.join(scratch, "origin.git");
  const work = path.join(scratch, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["clone", "-q", origin, work], { stdio: ["ignore", "pipe", "pipe"] });

  writeFileSync(path.join(work, "package-marker"), "substrate s1\n");
  git(work, ["add", "package-marker"]);
  git(work, ["commit", "-q", "-m", "substrate s1"]);
  git(work, ["push", "-q", "origin", "main"]);
  const packageCommit = git(work, ["rev-parse", "HEAD"]);

  // A later commit on main, so "ancestor of origin/main" is a real relation and not a tautology.
  writeFileSync(path.join(work, "later"), "later\n");
  git(work, ["add", "later"]);
  git(work, ["commit", "-q", "-m", "later work"]);
  git(work, ["push", "-q", "origin", "main"]);
  const originMainCommit = git(work, ["rev-parse", "HEAD"]);

  // A commit that never reaches main at all.
  git(work, ["checkout", "-q", "-b", "sidetrack", packageCommit]);
  writeFileSync(path.join(work, "sidetrack"), "off main\n");
  git(work, ["add", "sidetrack"]);
  git(work, ["commit", "-q", "-m", "off main"]);
  const offMainCommit = git(work, ["rev-parse", "HEAD"]);
  git(work, ["checkout", "-q", "main"]);

  return { scratch, origin, work, packageCommit, originMainCommit, offMainCommit };
}

const validMessage = (fixture, overrides = {}) => {
  const fields = {
    packageId: CONTRACT_ID,
    packageCommit: fixture.packageCommit,
    independentVerification: "root-codex",
    verifiedCommands: ACTIVATION_REQUIRED_COMMANDS.join("|"),
    results: "GREEN",
    ...overrides,
  };
  return [
    authority.requiredMessageHeader,
    ...ACTIVATION_MESSAGE_FIELDS.map((key) => `${key}=${fields[key]}`),
  ].join("\n");
};

/** Create the annotated tag locally and report whether the origin knows about it. */
function tagLocally(fixture, { message, target = fixture.packageCommit, annotated = true } = {}) {
  const args = annotated
    ? ["tag", "-a", ACTIVATION_TAG_NAME, "-m", message, target]
    : ["tag", ACTIVATION_TAG_NAME, target];
  git(fixture.work, args);
  return {
    localTagObject: git(fixture.work, ["rev-parse", ACTIVATION_TAG_NAME]),
    remote: remoteTagObject(fixture),
  };
}

/** What the origin actually publishes for this tag, via a plain ref listing. No network. */
function remoteTagObject(fixture) {
  const listing = git(fixture.work, ["ls-remote", "--tags", "origin", ACTIVATION_TAG_NAME]);
  if (!listing) return null;
  return listing.split("\n")[0].split("\t")[0];
}

function publishTag(fixture) {
  git(fixture.work, ["push", "-q", "origin", ACTIVATION_TAG_NAME]);
  return remoteTagObject(fixture);
}

/** The one input shape that must be accepted. Every case below is this, minus something. */
function validInput(fixture, tagState) {
  return {
    expectedRemote: fixture.origin,
    remote: { url: fixture.origin, identityVerified: true },
    checkout: { commit: fixture.originMainCommit, isExactOriginMain: true, branch: "main" },
    tag: {
      name: ACTIVATION_TAG_NAME,
      type: "annotated",
      targetCommit: fixture.packageCommit,
      targetIsAncestorOrEqualOfOriginMain: true,
      message: validMessage(fixture),
      localTagObject: tagState.localTagObject,
      remotePublished: true,
      remoteTagObject: tagState.published,
      remoteLookup: "ok",
    },
    package: { id: CONTRACT_ID, commit: fixture.packageCommit },
  };
}

const withPatch = (base, patch) => {
  const input = structuredClone(base);
  for (const [dotted, value] of Object.entries(patch)) {
    const parts = dotted.split(".");
    let cursor = input;
    for (const part of parts.slice(0, -1)) cursor = cursor[part];
    if (value === undefined) delete cursor[parts.at(-1)];
    else cursor[parts.at(-1)] = value;
  }
  return input;
};

/** Resolve the evaluator, or fail naming exactly what is missing. */
function evaluator() {
  const fn = verifier[ACTIVATION_EVALUATOR_EXPORT];
  assert.equal(
    typeof fn,
    "function",
    `MISSING CAPABILITY (GAP2, RED by design): ${verifierPath} exports no ` +
      `${ACTIVATION_EVALUATOR_EXPORT}(input) -> { effective, errors, state }. ` +
      "This is the declared activation evaluator, not an environment or harness failure; " +
      "db/kernel-runtime-substrate-s1.json declares it with implemented=false.",
  );
  return fn;
}

/** Resolve the compositor, or fail naming exactly what is missing. */
async function compositor() {
  let module = null;
  try {
    module = await import(pathToFileURL(path.join(root, ACTIVATION_COMPOSITOR_MODULE)).href);
  } catch {
    module = null;
  }
  assert.ok(
    module && typeof module[ACTIVATION_COMPOSITOR_EXPORT] === "function",
    `MISSING CAPABILITY (GAP2, RED by design): ${ACTIVATION_COMPOSITOR_MODULE} does not exist or ` +
      `exports no ${ACTIVATION_COMPOSITOR_EXPORT}(input) -> { lines }. This is the declared ` +
      "current-effective compositor, not an environment or harness failure; " +
      "db/kernel-runtime-substrate-s1.json declares it with implemented=false.",
  );
  return module[ACTIVATION_COMPOSITOR_EXPORT];
}

/** The immutable input the compositor consumes: the consumer-sync verifier's real output. */
function consumerSyncOutput() {
  return execFileSync(
    process.execPath,
    [path.join(root, "tools/check-kernel-runtime-pilot-consumer-sync.mjs")],
    { encoding: "utf8", cwd: root },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// =====================================================================================
// The declaration itself is present and honest. These pass today.
// =====================================================================================

test("the tag authority is declared, and the writer may neither create nor verify it", () => {
  assert.equal(authority.tagName, ACTIVATION_TAG_NAME);
  assert.equal(authority.tagType, "annotated");
  assert.equal(authority.createdBy, "root-codex-master");
  assert.equal(authority.writerMayCreate, false);
  assert.equal(authority.writerMaySelfVerify, false);
  // The two things the design exists to avoid.
  assert.equal(authority.inRepoStatusFlipCommitRequired, false);
  assert.equal(authority.selfReferentialCommitShaRecorded, false);
  // The parts are built now; the authority to use them is still not the writer's.
  assert.equal(gap.evaluator.implemented, true);
  assert.equal(gap.compositor.implemented, true);
  assert.equal(gap.reader.implemented, true);
  assert.equal(gap.status, "green");
  // ...and the record of what the RED was is kept, not overwritten.
  assert.equal(gap.phaseRedOutcome, "red-missing-evaluator");
  assert.equal(contract.redFollowUps.originallyRed, true);
  assert.ok(gap.rootProcedure.length >= 6, "the root procedure must be spelled out");
});

// POST-MERGE REGRESSION RED — test-design evidence, NOT activation evidence.
//
// On exact main/origin-main commit 89528cd0b815711e49553682f457326e9b171b03 this focused suite ran
// 27 pass / 1 fail. The failure was here: the test read the repository it happened to be running in
// and asserted `isExactOriginMain=false` with the message "this is a feature branch", while the
// actual value was `true`. That was correct behaviour from the production reader — the checkout
// really was exact main — and a wrong assumption in the test, which had baked in the branch it was
// authored on. No production defect was found, and tools/check-kernel-runtime-substrate-s1.mjs is
// unchanged.
//
// This note records a test-design regression only. It is not evidence about activation, and nothing
// about it belongs in a canonical or history artifact.
//
// The correction below never inspects the repository running the test. Both directions are proven
// in the isolated scratch fixture instead, where the branch is something the test creates rather
// than something it inherits.

test("the reader is bounded, non-interactive, and admits exact main", (t) => {
  const declared = gap.reader;
  assert.equal(declared.nonInteractive, true);
  assert.equal(declared.failureIsNotEffectiveNotAnException, true);
  assert.ok(Number.isInteger(declared.boundedTimeoutMs) && declared.boundedTimeoutMs > 0);
  assert.match(declared.shortCircuitsBeforeAnyNetworkCall, /not exact origin\/main/i);

  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  // The clone sits on main at the commit origin/main points to: the shape a verification checkout
  // has, and the only one that may ever be admitted.
  assert.equal(git(fixture.work, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  assert.equal(git(fixture.work, ["rev-parse", "HEAD"]), fixture.originMainCommit);

  const started = Date.now();
  const resolved = verifier.resolveActivation({
    root: fixture.work,
    expectedRemote: fixture.origin,
  });
  const elapsed = Date.now() - started;

  assert.equal(resolved.facts.checkout.isExactOriginMain, true, "exact main must be admitted");
  assert.equal(resolved.facts.checkout.branch, "main");
  assert.ok(
    !resolved.errors.includes("not-on-exact-origin-main"),
    `exact main must not be refused as off-main: ${JSON.stringify(resolved.errors)}`,
  );
  assert.ok(elapsed < declared.boundedTimeoutMs, `reading took ${elapsed}ms`);
  // Admitted is not activated: there is no tag here, so nothing becomes effective.
  assert.equal(resolved.effective, false);
  assert.ok(resolved.errors.includes("tag-absent"));
});

test("a branch that is not main never reaches the network, even at the same commit", (t) => {
  const declared = gap.reader;
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));

  // Same commit as origin/main, different branch. This is the case HEAD-equality alone would get
  // wrong, and the one that made the old assumption look right for the wrong reason.
  git(fixture.work, ["checkout", "-q", "-b", "post-merge-feature"]);
  assert.equal(git(fixture.work, ["rev-parse", "HEAD"]), fixture.originMainCommit);
  assert.equal(git(fixture.work, ["rev-parse", "--abbrev-ref", "HEAD"]), "post-merge-feature");

  const started = Date.now();
  const resolved = verifier.resolveActivation({
    root: fixture.work,
    expectedRemote: fixture.origin,
  });
  const elapsed = Date.now() - started;

  assert.equal(resolved.facts.checkout.isExactOriginMain, false, "a non-main branch is not exact main");
  assert.equal(resolved.facts.lookupPerformed, false, "a non-main branch must not reach the network");
  assert.equal(resolved.effective, false);
  assert.ok(resolved.errors.includes("not-on-exact-origin-main"));
  assert.ok(elapsed < declared.boundedTimeoutMs, `reading took ${elapsed}ms`);
  // Whatever it decided, it decided without throwing and with the stronger flags shut.
  assert.equal(resolved.state.runtimeImplementationStarted, false);
  assert.equal(resolved.state.appBuildable, false);
  for (const flag of SHUT_FLAGS) assert.equal(resolved.state[flag], false, `${flag} must stay false`);
});

test("a remote that cannot be reached is a verdict, not a crash", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-activation-remote-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main", scratch], { stdio: ["ignore", "pipe", "pipe"] });

  // A remote that does not exist. The lookup must come back with an answer, bounded, not an error.
  let result;
  assert.doesNotThrow(() => {
    result = verifier.lookupPublishedTag(
      scratch,
      path.join(scratch, "no-such-origin.git"),
      ACTIVATION_TAG_NAME,
      5000,
    );
  });
  assert.ok(["error", "timeout", "absent"].includes(result.status), `got ${result.status}`);
  assert.equal(result.object, null);

  // ...and that answer never activates anything.
  const verdict = verifier[ACTIVATION_EVALUATOR_EXPORT]({
    expectedRemote: "x",
    remote: { url: "x", identityVerified: true },
    checkout: { commit: "a", isExactOriginMain: true, branch: "main" },
    package: { id: CONTRACT_ID, commit: "a" },
    tag: {
      name: ACTIVATION_TAG_NAME,
      type: "annotated",
      targetCommit: "a",
      targetIsAncestorOrEqualOfOriginMain: true,
      message: "",
      remoteLookup: result.status,
      remotePublished: false,
      remoteTagObject: null,
    },
  });
  assert.equal(verdict.effective, false);
});

test("publication on the canonical origin is a declared requirement, and production pins it", () => {
  assert.equal(authority.canonicalRemote, CANONICAL_KERNEL_REMOTE);
  assert.equal(CANONICAL_KERNEL_REMOTE, "git@github.com:metaframer-net/metaframer-kernel.git");
  assert.equal(authority.tagMustBePublishedOnCanonicalOrigin, true);
  assert.equal(authority.localOnlyTagAccepted, false);
  assert.equal(authority.remoteTagObjectMustMatchLocal, true);
  // A lookup that cannot answer must deny, and must not take the run down with it.
  assert.equal(authority.remoteLookupIsBounded, true);
  assert.equal(authority.remoteLookupFailureIsNotEffective, true);
  assert.equal(authority.remoteLookupFailureIsNotATestFailure, true);
  // Tests inject their own origin; production still pins the canonical one.
  assert.equal(authority.expectedRemoteInjectableInTests, true);
  assert.ok(gap.evaluator.inputs.includes("expectedRemote"));
  assert.ok(gap.rootProcedure.some((s) => /pushes the tag/i.test(s)));
});

test("no readiness flag is invented, and appBuildable stays false", () => {
  for (const name of FORBIDDEN_FLAG_NAMES) {
    assert.ok(gap.forbiddenFlags[name], `${name} must be declared forbidden`);
    // Declared forbidden is fine; asserted true is not, anywhere in the contract.
    const raw = JSON.stringify(contract);
    assert.ok(!new RegExp(`"${name}"\\s*:\\s*true`).test(raw), `${name} must never be claimed true`);
  }
  assert.equal(contract.activationBase.state.appBuildable, false);
  assert.equal(contract.desiredState.appBuildable, false);
  assert.ok(SHUT_FLAGS.includes("appBuildable"));
  assert.ok(gap.invariantsUnderActivation.some((i) => /appReady/.test(i) && /never/.test(i)));
});

test("the scratch fixture produces real, distinct git objects", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  for (const sha of [fixture.packageCommit, fixture.originMainCommit, fixture.offMainCommit]) {
    assert.match(sha, /^[0-9a-f]{40}$/);
  }
  assert.notEqual(fixture.packageCommit, fixture.originMainCommit);
  // The package commit really is an ancestor of origin/main; the sidetrack commit really is not.
  assert.doesNotThrow(() =>
    git(fixture.work, ["merge-base", "--is-ancestor", fixture.packageCommit, fixture.originMainCommit]),
  );
  assert.throws(() =>
    git(fixture.work, ["merge-base", "--is-ancestor", fixture.offMainCommit, fixture.originMainCommit]),
  );
  // A tag is invisible on the origin until it is pushed.
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  assert.match(local.localTagObject, /^[0-9a-f]{40}$/);
  assert.equal(local.remote, null, "an unpushed tag must not appear on the origin");
  assert.equal(publishTag(fixture), local.localTagObject, "the pushed tag object must match the local one");
});

// =====================================================================================
// RED: the deterministic composition the evaluator must implement.
// =====================================================================================

test("a feature branch is never effective, even carrying a forged tag of the right name", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  for (const branch of ["kernel-runtime-substrate-s1-2026-08-06", "some-other-branch"]) {
    const verdict = evaluate(
      withPatch(base, { "checkout.branch": branch, "checkout.isExactOriginMain": false }),
    );
    assert.equal(verdict.effective, false, `${branch} must never be effective`);
    assert.ok(verdict.errors.includes("not-on-exact-origin-main"));
  }
});

test("a tag that exists only locally never activates, even on exact origin/main", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  assert.equal(local.remote, null, "the fixture must leave the tag unpublished");

  const evaluate = evaluator();
  // Everything else is valid: exact main, verified remote, well-formed annotated tag on the right
  // commit. The only thing missing is that anyone else can see it.
  const verdict = evaluate(
    withPatch(validInput(fixture, { localTagObject: local.localTagObject, published: null }), {
      "tag.remotePublished": false,
      "tag.remoteTagObject": null,
    }),
  );
  assert.equal(verdict.effective, false, "a local-only tag must not activate anything");
  assert.ok(verdict.errors.includes("tag-not-published-on-canonical-origin"));
});

test("a published tag object that differs from the local one is not effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  // Someone re-tagged locally, or the origin carries a different object under the same name.
  const verdict = evaluate(withPatch(base, { "tag.remoteTagObject": fixture.offMainCommit }));
  assert.equal(verdict.effective, false);
  assert.ok(verdict.errors.includes("remote-tag-object-mismatch"));

  // A missing remote object with remotePublished still claimed true is the same disagreement.
  const claimed = evaluate(withPatch(base, { "tag.remoteTagObject": null }));
  assert.equal(claimed.effective, false);
  assert.ok(claimed.errors.some((code) => code.startsWith("remote-tag-object")));
});

test("a remote lookup that cannot answer denies, and does not throw", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  // An unreachable origin must not be able to activate anything, and must not break the check.
  for (const [lookup, code] of [
    ["error", "remote-tag-lookup-failed"],
    ["timeout", "remote-tag-lookup-timed-out"],
    ["absent", "tag-not-published-on-canonical-origin"],
  ]) {
    let verdict;
    assert.doesNotThrow(() => {
      verdict = evaluate(
        withPatch(base, {
          "tag.remoteLookup": lookup,
          "tag.remotePublished": lookup === "absent" ? false : undefined,
          "tag.remoteTagObject": null,
        }),
      );
    }, `a ${lookup} lookup must be a verdict, not an exception`);
    assert.equal(verdict.effective, false, `a ${lookup} lookup must not activate`);
    assert.ok(
      verdict.errors.includes(code),
      `expected ${code}, got ${JSON.stringify(verdict.errors)}`,
    );
  }
});

test("an exact origin/main checkout with no tag is not effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const evaluate = evaluator();
  const verdict = evaluate(
    withPatch(validInput(fixture, { localTagObject: null, published: null }), { tag: null }),
  );
  assert.equal(verdict.effective, false);
  assert.ok(verdict.errors.includes("tag-absent"));
});

test("a checkout is admitted only after an exact remote identity check", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  const unverified = evaluate(withPatch(base, { "remote.identityVerified": false }));
  assert.equal(unverified.effective, false);
  assert.ok(unverified.errors.includes("remote-identity-unverified"));

  // A different repository carrying the same tag name is not this package's activation.
  const foreign = evaluate(withPatch(base, { "remote.url": path.join(fixture.scratch, "elsewhere.git") }));
  assert.equal(foreign.effective, false);
  assert.ok(foreign.errors.some((code) => code.startsWith("remote-identity")));
});

test("a lightweight tag is not effective, because it carries no message to bind", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  // A real lightweight tag: a ref pointing straight at the commit, with no tag object at all.
  const lightweight = tagLocally(fixture, { annotated: false });
  assert.equal(lightweight.localTagObject, fixture.packageCommit, "a lightweight tag has no object of its own");
  const published = publishTag(fixture);

  const evaluate = evaluator();
  const verdict = evaluate(
    withPatch(validInput(fixture, { localTagObject: lightweight.localTagObject, published }), {
      "tag.type": "lightweight",
      "tag.message": undefined,
    }),
  );
  assert.equal(verdict.effective, false);
  assert.ok(verdict.errors.includes("tag-not-annotated"));
});

test("a tag targeting anything but the verified package commit is not effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const verdict = evaluator()(withPatch(base, { "tag.targetCommit": fixture.originMainCommit }));
  assert.equal(verdict.effective, false);
  assert.ok(verdict.errors.includes("tag-target-mismatch"));
});

test("a tag whose target is not an ancestor of, or equal to, exact origin/main is not effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture), target: fixture.offMainCommit });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const verdict = evaluator()(
    withPatch(base, {
      "tag.targetCommit": fixture.offMainCommit,
      "tag.targetIsAncestorOrEqualOfOriginMain": false,
      "package.commit": fixture.offMainCommit,
    }),
  );
  assert.equal(verdict.effective, false);
  assert.ok(verdict.errors.includes("tag-target-not-ancestor-of-origin-main"));
});

test("a malformed tag message is not effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  for (const [name, message] of [
    ["empty", ""],
    ["header missing", "packageId=x\nresults=GREEN"],
    ["free prose", "activated by root codex, everything looked fine"],
    ["header only", authority.requiredMessageHeader],
  ]) {
    const verdict = evaluate(withPatch(base, { "tag.message": message }));
    assert.equal(verdict.effective, false, `${name} must not activate`);
    assert.ok(
      verdict.errors.some((code) => code.startsWith("tag-message-malformed")),
      `${name} must be reported as a malformed message, got ${JSON.stringify(verdict.errors)}`,
    );
  }
});

test("every required message field must be present, and bind the right value", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  for (const field of ACTIVATION_MESSAGE_FIELDS) {
    const lines = validMessage(fixture)
      .split("\n")
      .filter((line) => !line.startsWith(`${field}=`));
    const verdict = evaluate(withPatch(base, { "tag.message": lines.join("\n") }));
    assert.equal(verdict.effective, false, `a message without ${field} must not activate`);
    assert.ok(verdict.errors.some((code) => code.includes(field)));
  }

  for (const [field, wrong, code] of [
    ["packageId", "some-other-package", "tag-message-binding-drift:packageId"],
    ["packageCommit", fixture.offMainCommit, "tag-message-binding-drift:packageCommit"],
    ["independentVerification", "claude-writer", "independent-verification-not-root-codex"],
    ["results", "RED", "results-not-green"],
  ]) {
    const verdict = evaluate(
      withPatch(base, { "tag.message": validMessage(fixture, { [field]: wrong }) }),
    );
    assert.equal(verdict.effective, false, `${field}=${wrong} must not activate`);
    assert.ok(verdict.errors.includes(code), `expected ${code}, got ${JSON.stringify(verdict.errors)}`);
  }
});

test("the message grammar is closed: unknown, duplicate and unparsable lines are all rejected", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();
  const valid = validMessage(fixture);

  // A field the verifier does not read must not be silently ignored: the tag would then say more
  // than anything checks.
  const unknown = evaluate(withPatch(base, { "tag.message": `${valid}\nsignedOffBy=someone` }));
  assert.equal(unknown.effective, false);
  assert.ok(unknown.errors.includes("tag-message-unknown-field:signedOffBy"));

  // A second value for a field already checked is a contradiction, not an override.
  const duplicate = evaluate(
    withPatch(base, { "tag.message": `${valid}\nresults=RED` }),
  );
  assert.equal(duplicate.effective, false);
  assert.ok(duplicate.errors.includes("tag-message-duplicate-field:results"));

  // A non-empty line that is not a field makes the whole message unreadable.
  for (const junk of ["just some prose", "packageId", "= value", "9bad=x"]) {
    const verdict = evaluate(withPatch(base, { "tag.message": `${valid}\n${junk}` }));
    assert.equal(verdict.effective, false, `${junk} must not activate`);
    assert.ok(
      verdict.errors.includes("tag-message-malformed:unparsable-line"),
      `expected an unparsable-line rejection for ${JSON.stringify(junk)}, got ${JSON.stringify(verdict.errors)}`,
    );
  }

  // The parser reports the same things directly.
  assert.equal(verifier.parseActivationTagMessage(`${valid}\nnot a field`).ok, false);
  assert.deepEqual(verifier.parseActivationTagMessage(valid).issues, []);
});

test("the recorded command list must be the canonical sequence exactly", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();
  const canonical = ACTIVATION_REQUIRED_COMMANDS;

  // A superset is not acceptance: the extra command may be what changed the outcome.
  const extra = evaluate(
    withPatch(base, {
      "tag.message": validMessage(fixture, { verifiedCommands: [...canonical, "npm run something-else"].join("|") }),
    }),
  );
  assert.equal(extra.effective, false);
  assert.ok(extra.errors.includes("unexpected-command:npm run something-else"));

  // A repeat is not a second run worth recording.
  const repeated = evaluate(
    withPatch(base, {
      "tag.message": validMessage(fixture, { verifiedCommands: [...canonical, canonical[0]].join("|") }),
    }),
  );
  assert.equal(repeated.effective, false);
  assert.ok(repeated.errors.includes(`duplicate-command:${canonical[0]}`));

  // The contract states an order, so the record must be in it.
  const reordered = [...canonical].reverse();
  const outOfOrder = evaluate(
    withPatch(base, { "tag.message": validMessage(fixture, { verifiedCommands: reordered.join("|") }) }),
  );
  assert.equal(outOfOrder.effective, false);
  assert.ok(outOfOrder.errors.includes("verified-commands-not-in-canonical-order"));

  // ...and the canonical sequence itself is clean.
  assert.deepEqual(verifier.evaluateVerifiedCommands(canonical.join("|")), []);
});

test("a valid annotated, remotely published tag still activates after the grammar tightened", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const published = publishTag(fixture);
  const verdict = evaluator()(validInput(fixture, { localTagObject: local.localTagObject, published }));
  assert.deepEqual(verdict.errors, [], "tightening the grammar must not break the valid shape");
  assert.equal(verdict.effective, true);
});

test("the message must record every required command as GREEN, not a subset", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const base = validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) });
  const evaluate = evaluator();

  for (const omitted of ACTIVATION_REQUIRED_COMMANDS) {
    const remaining = ACTIVATION_REQUIRED_COMMANDS.filter((c) => c !== omitted);
    const verdict = evaluate(
      withPatch(base, { "tag.message": validMessage(fixture, { verifiedCommands: remaining.join("|") }) }),
    );
    assert.equal(verdict.effective, false, `omitting ${omitted} must not activate`);
    assert.ok(verdict.errors.includes(`required-command-missing:${omitted}`));
  }
});

test("only the complete, verified, remotely published shape becomes effective", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const published = publishTag(fixture);
  assert.equal(published, local.localTagObject);

  const verdict = evaluator()(validInput(fixture, { localTagObject: local.localTagObject, published }));
  assert.deepEqual(verdict.errors, [], "the valid shape must produce no findings");
  assert.equal(verdict.effective, true);
});

test("activation moves one dimension and leaves every stronger flag false", (t) => {
  const fixture = buildFixture();
  t.after(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  const local = tagLocally(fixture, { message: validMessage(fixture) });
  const { state } = evaluator()(
    validInput(fixture, { localTagObject: local.localTagObject, published: publishTag(fixture) }),
  );
  assert.equal(state.verdict, "GO-KERNEL-DEVELOPMENT-ONLY");
  assert.equal(state.codeStartAllowed, true);
  assert.equal(state.runtimeCodeAllowed, true);
  assert.equal(state.runtimeImplementationStarted, true);
  for (const flag of SHUT_FLAGS) {
    assert.equal(state[flag], false, `${flag} must stay false through activation`);
  }
  assert.equal(state.appBuildable, false, "appBuildable is the canonical flag and it stays false");
  for (const name of FORBIDDEN_FLAG_NAMES) {
    assert.ok(!(name in state), `activation must not introduce ${name}`);
  }
  // Activation records itself in the tag, never in the repository.
  assert.equal(state.inRepoStatusFlipCommitRequired, false);
  assert.equal(state.selfReferentialCommitShaRecorded, false);
  assert.equal(state.historicalArtifactsRewritten, false);
});

// =====================================================================================
// RED: the compositor. Counted from the lines it emits, never from what it says about itself.
// =====================================================================================

test("the compositor emits exactly one CURRENT EFFECTIVE line when the package is not activated", async () => {
  const compose = await compositor();
  const consumed = consumerSyncOutput();
  const { lines } = compose({ consumerSyncOutput: consumed, activation: { effective: false } });

  const current = lines.filter((line) => line.startsWith("CURRENT EFFECTIVE"));
  assert.equal(current.length, 1, `expected one CURRENT EFFECTIVE line, got ${current.length}`);
  assert.equal(lines.at(-1), current[0], "the CURRENT EFFECTIVE line must be last");
  assert.match(current[0], /runtimeImplementationStarted=false/);
  assert.match(current[0], /appBuildable=false/);

  // The old line is relabelled, not deleted: the state in force before activation stays visible.
  const base = lines.filter((line) => line.startsWith("ACTIVATION BASE"));
  assert.equal(base.length, 1, "the consumer-sync line must be relabelled as the activation base");
  assert.ok(lines.indexOf(base[0]) < lines.indexOf(current[0]));
});

test("the compositor emits exactly one CURRENT EFFECTIVE line when the package is activated", async () => {
  const compose = await compositor();
  const consumed = consumerSyncOutput();
  const { lines } = compose({
    consumerSyncOutput: consumed,
    activation: { effective: true, state: { runtimeImplementationStarted: true } },
  });

  const current = lines.filter((line) => line.startsWith("CURRENT EFFECTIVE"));
  assert.equal(current.length, 1, `expected one CURRENT EFFECTIVE line, got ${current.length}`);
  assert.equal(lines.at(-1), current[0], "the CURRENT EFFECTIVE line must be last");
  assert.match(current[0], /runtimeImplementationStarted=true/);
  // Activating the substrate raises nothing downstream.
  for (const flag of SHUT_FLAGS) {
    assert.match(current[0], new RegExp(`${flag}=false`), `${flag} must stay false on the composed line`);
  }
  for (const name of FORBIDDEN_FLAG_NAMES) {
    assert.ok(!current[0].includes(name), `the composed line must not introduce ${name}`);
  }
  assert.equal(lines.filter((line) => line.startsWith("ACTIVATION BASE")).length, 1);
});

test("the compositor refuses to compose when the base line is absent or duplicated", async () => {
  const compose = await compositor();
  const consumed = consumerSyncOutput();
  const baseLine = consumed.find((line) => line.startsWith("CURRENT EFFECTIVE:"));
  assert.ok(baseLine, "the activation base must supply exactly one line to start from");

  // Zero: there is nothing to relabel, so appending a final line would invent the answer.
  const none = compose({
    consumerSyncOutput: consumed.filter((line) => !line.startsWith("CURRENT EFFECTIVE:")),
    activation: { effective: false },
  });
  assert.equal(none.ok, false);
  assert.equal(none.lines, null, "no lines may be emitted when the base is missing");
  assert.ok(none.errors.includes("activation-base-line-count:0"));

  // Two: the input already disagreed with itself; picking one would hide the contradiction.
  const twice = compose({
    consumerSyncOutput: [...consumed, baseLine],
    activation: { effective: true, state: { runtimeImplementationStarted: true } },
  });
  assert.equal(twice.ok, false);
  assert.equal(twice.lines, null);
  assert.ok(twice.errors.includes("activation-base-line-count:2"));

  // Neither refusal invents a verdict.
  for (const refused of [none, twice]) {
    assert.equal(refused.effective, false);
    assert.equal(refused.state, null);
  }
});

test("the compositor CLI exits non-zero rather than emitting a misleading line", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kernel-compose-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));

  const run = (body) => {
    const stand = path.join(scratch, `stand-${Buffer.from(body).length}.mjs`);
    writeFileSync(stand, body);
    return spawnSync(
      process.execPath,
      [path.join(root, ACTIVATION_COMPOSITOR_MODULE), path.relative(root, stand)],
      { cwd: root, encoding: "utf8" },
    );
  };

  // A stand-in activation base that emits no CURRENT EFFECTIVE line at all.
  const none = run('console.log("OK nothing-to-say");\n');
  assert.notEqual(none.status, 0, "the compositor must exit non-zero when the base line is missing");
  assert.equal(none.stdout.trim(), "", "nothing may reach stdout when composition is refused");
  assert.match(none.stderr, /activation-base-line-count:0/);

  // ...and one that emits two, which is a contradiction rather than a choice.
  const twice = run(
    'console.log("CURRENT EFFECTIVE: verdict=A");console.log("CURRENT EFFECTIVE: verdict=B");\n',
  );
  assert.notEqual(twice.status, 0);
  assert.equal(twice.stdout.trim(), "");
  assert.match(twice.stderr, /activation-base-line-count:2/);
});

test("the compositor consumes the consumer-sync output without rewriting it", async () => {
  const compose = await compositor();
  const consumed = consumerSyncOutput();
  const snapshot = structuredClone(consumed);
  const { lines } = compose({ consumerSyncOutput: consumed, activation: { effective: false } });

  assert.deepEqual(consumed, snapshot, "the compositor must not mutate the output it consumes");
  // Every historical-snapshot line survives verbatim.
  for (const line of snapshot.filter((l) => l.startsWith("HISTORICAL SNAPSHOT"))) {
    assert.ok(lines.includes(line), `the compositor dropped a historical line: ${line}`);
  }
  assert.equal(gap.compositor.consumedOutputIsImmutable, true);
});
