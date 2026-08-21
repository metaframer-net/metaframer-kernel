import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// Kernel versioning and changelog governance — the frozen RED specification
//
// This file is written before a single line of the package it describes exists. Nothing under
// `versioning-policy.json`, `CHANGELOG.md`, `tools/check-versioning-changelog.mjs` or
// `docs/versioning-policy.md` has been created, and `package.json` still carries the planning
// placeholder. Every row below is therefore a requirement rather than a description, and 145 of
// the 149 rows are expected to fail on this checkout. That failure is the deliverable.
//
// Four rows pass from the start, and they are named here so that nobody can read "149 rows" as
// "149 failures". They are guards, not achievements: `package.json` declares no `dependencies`
// key, declares no `devDependencies` key, keeps `scripts.test` byte-exact, and keeps the four
// pre-existing checkers wired into `scripts.check`. They exist to fail *later*, if the GREEN
// implementation regresses any of them, and a suite that could not say which rows were already
// green would be claiming credit it has not earned.
//
// -------------------------------------------------------------------------------------
// What this package decides, and what it deliberately refuses to decide
// -------------------------------------------------------------------------------------
//
// One canonical owner. `versioning-policy.json` at the repository root is the only place a
// version or policy value is decided. `package.json#version`, `CHANGELOG.md`, the README's
// versioning section and `docs/versioning-policy.md` are projections of it. Parity is asserted in
// exactly one direction — canonical to projection — so a drift finding always names the
// projection that moved and never invites the canonical file to be "corrected" to match a copy.
// A projection that could be treated as a source is a second source, and two sources is how a
// version becomes a matter of opinion.
//
// Two independent gates, and conflating them is the specific failure this matrix exists to
// prevent. The first gate is Semantic Versioning 2.0.0 as written: a syntax and a precedence
// order that this repository does not get to reinterpret. The second is this project's much
// narrower train: `0.1.0-alpha.N`, `0.1.0-beta.N`, `0.1.0-rc.N`. A string can be flawless SemVer
// and still be refused here — `0.1.0-alpha.1+001` and `1.0.0` both parse perfectly — and a string
// can be refused by both. The evaluators are separate functions for that reason, and the findings
// are separate families, so a reviewer can tell "malformed" from "forbidden here" at a glance.
//
// The current version is exactly `0.1.0-alpha.1`. It is a train entry on an unpublished, private
// package identity: it publishes nothing, tags nothing, and produces no artifact. `0.0.0-planning`
// is preserved as a valid historical planning placeholder — syntactically a pre-release of a
// version that was never released — and is never described as a release, and never permitted
// going forward.
//
// The ceiling is `0.1.0` and it is the conceptual terminus, not a permitted current value. The
// eventual "Kernel 1.0 complete" milestone maps to package `0.1.0` and never to `1.0.0`, because
// SemVer rule 5 makes `1.0.0` a public-API definition that no decision has authorized. But while
// completion and release authority are false, `0.1.0` itself is not a legal current value and not
// a legal recommendation either: `rc.N -> 0.1.0` must fail under the policy in force, and may only
// become eligible through a fresh, explicit human completion decision. No final transition is
// automated by anything in this package.
//
// Agent authority is recommendation-only, and the permitted moves are deliberately tiny: the
// counter forward by one within a stage, or the next adjacent stage with the counter reset to one.
// No skips, no backwards moves, no no-ops, no counter jumps, no ceiling escapes. Stage skipping is
// precedence-forward and would be harmless under a looser policy; it is refused because the moment
// a stage can be silently skipped, "which prereleases actually happened" stops being answerable
// from the version alone. A human may skip a stage. An agent may not.
//
// Release, tag, GitHub Release, npm publish, deploy and production are all false, and the package
// stays private. The changelog therefore carries exactly one `## [Unreleased]` section, zero
// version sections, zero release dates, zero link definitions and zero `[YANKED]` markers, because
// every one of those is a claim that a release exists. A dangling `.../compare/v0.1.0...HEAD` link
// is a fabricated release wearing a URL.
//
// -------------------------------------------------------------------------------------
// Honest limits, recorded here rather than discovered later
// -------------------------------------------------------------------------------------
//
// The ceiling is a review tripwire, not a cryptographic gate. This file pins the literal `0.1.0`
// and `humanDecisionRecord === null`, so an actor who edits the policy alone turns the suite RED
// and an actor who edits both makes a high-salience two-file change. No in-repo mechanism can
// bind an actor who can edit every file, and claiming otherwise would be exactly the kind of
// overclaim the checkers in this repository exist to prevent.
//
// Tag visibility is bounded by the local clone. A remote-only fabricated release tag is invisible
// to a local tag read. That can under-report and can never produce a false accusation, and remote
// tag governance stays outside this package.
//
// -------------------------------------------------------------------------------------
// Why the imports below are defensive
// -------------------------------------------------------------------------------------
//
// A bare top-level `await import()` of a module that does not exist collapses this entire file
// into one load error. One load error is not a 145-row specification — it is a single sentence
// saying "a file is missing", and it destroys the one thing a RED phase produces: a count and a
// named list of what is owed. So the checker is imported inside a try, the canonical policy is
// read and parsed inside a try, and every row that needs either of them demands it *by name*
// first. A row whose helper is missing fails as itself, with a message naming the export it
// wanted. Nothing here is ever skipped, and nothing here passes because a helper was absent.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const POLICY_PATH = "versioning-policy.json";
const CHECKER_PATH = "tools/check-versioning-changelog.mjs";
const CHANGELOG_PATH = "CHANGELOG.md";
const DOCS_PATH = "docs/versioning-policy.md";
const COMPOSITOR_PATH = "tools/compose-current-effective.mjs";
const CHECKER_SCRIPT = "check:versioning";

/** The frozen decision, mirrored here so a row states what it wants instead of reading it back. */
const CURRENT_VERSION = "0.1.0-alpha.1";
const PREVIOUS_VERSION = "0.0.0-planning";
const CEILING = "0.1.0";
const CONCEPTUAL_MILESTONE = "Kernel 1.0 complete";
const FORBIDDEN_CONCEPTUAL_VERSION = "1.0.0";
const STAGES = ["alpha", "beta", "rc"];
const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const SEMVER_SPEC_VERSION = "2.0.0";
const SEMVER_SPEC_URL = "https://semver.org/spec/v2.0.0.html";
const KAC_SPEC_VERSION = "1.1.0";
const KAC_SPEC_URL = "https://keepachangelog.com/en/1.1.0/";
const NON_RELEASE_TAG = "kernel-runtime-substrate-s1-activated";

/** The eight exports the checker owes, in the order a run uses them. */
const REQUIRED_EXPORTS = [
  "parseSemVer",
  "comparePrecedence",
  "policyViolations",
  "transitionViolations",
  "changelogViolations",
  "parityViolations",
  "readVersioningFacts",
  "checkVersioning",
];

/** The four checkers `npm run check` already runs directly, before the compositor. */
const PRE_EXISTING_CHECKERS = [
  "tools/check-repository-boundary.mjs",
  "tools/check-control-plane-bootstrap.mjs",
  "tools/check-kernel-ai-development-readiness.mjs",
  "tools/check-kernel-runtime-substrate-s1.mjs",
];

const checkerUrl = pathToFileURL(path.join(root, CHECKER_PATH)).href;

// -------------------------------------------------------------------------------------
// Guarded loads. Every failure below is remembered, never thrown at module scope.
// -------------------------------------------------------------------------------------

let checkerModule = null;
let checkerLoadError = null;
try {
  checkerModule = await import(checkerUrl);
} catch (error) {
  checkerLoadError = error;
}

let checkerSource = null;
let checkerSourceError = null;
try {
  checkerSource = await readFile(path.join(root, CHECKER_PATH), "utf8");
} catch (error) {
  checkerSourceError = error;
}

let policyText = null;
let policyDocument = null;
let policyError = null;
try {
  policyText = await readFile(path.join(root, POLICY_PATH), "utf8");
  policyDocument = JSON.parse(policyText);
} catch (error) {
  policyError = error;
}

let changelogText = null;
let changelogError = null;
try {
  changelogText = await readFile(path.join(root, CHANGELOG_PATH), "utf8");
} catch (error) {
  changelogError = error;
}

let docsText = null;
let docsError = null;
try {
  docsText = await readFile(path.join(root, DOCS_PATH), "utf8");
} catch (error) {
  docsError = error;
}

// `package.json` and `README.md` exist today, so their reads are not guarded: a failure here is a
// broken checkout rather than a missing deliverable, and it should be loud.
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const readmeText = await readFile(path.join(root, "README.md"), "utf8");

// -------------------------------------------------------------------------------------
// Demands. Each one fails the calling row by name; none of them ever skips a row.
// -------------------------------------------------------------------------------------

/** The checker module itself, or a failure naming why it could not be imported. */
function checker() {
  assert.ok(
    checkerModule !== null,
    `${CHECKER_PATH} must exist and import cleanly: ${checkerLoadError?.message ?? "not imported"}`,
  );
  return checkerModule;
}

/** One named export, demanded as a function before a row is allowed to use it. */
function evaluator(name) {
  const module = checker();
  const value = module[name];
  assert.equal(
    typeof value,
    "function",
    `${CHECKER_PATH} must export ${name} as a function — got ${inspectShort(value)}`,
  );
  return value;
}

/** The checker's source text, for the dependency-freedom scan. */
function source() {
  assert.ok(
    checkerSource !== null,
    `${CHECKER_PATH} must exist as a readable file: ${checkerSourceError?.message ?? "not read"}`,
  );
  return checkerSource;
}

/** The canonical policy document, demanded before any row that reads a policy value. */
function policy() {
  assert.ok(
    policyDocument !== null && typeof policyDocument === "object",
    `${POLICY_PATH} must exist at the repository root and parse as JSON: ` +
      `${policyError?.message ?? "not parsed"}`,
  );
  return policyDocument;
}

/** The real changelog, demanded before any row that reads the shipped document. */
function changelog() {
  assert.ok(
    changelogText !== null,
    `${CHANGELOG_PATH} must exist at the repository root: ${changelogError?.message ?? "not read"}`,
  );
  return changelogText;
}

/** The human projection of the policy, demanded before the docs parity row reads it. */
function docs() {
  assert.ok(
    docsText !== null,
    `${DOCS_PATH} must exist: ${docsError?.message ?? "not read"}`,
  );
  return docsText;
}

/** A deep structural clone, so a mutation row can never leak into the next row. */
const clone = (value) => JSON.parse(JSON.stringify(value));

/** A short, safe rendering for assertion messages — never used to build an expected value. */
function inspectShort(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `function ${value.name || "anonymous"}`;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return JSON.stringify(value);
}

// -------------------------------------------------------------------------------------
// Finding helpers. `[]` is an all-clear, so it is asserted deliberately and never by default.
// -------------------------------------------------------------------------------------

function findingList(findings, label) {
  assert.ok(
    Array.isArray(findings),
    `${label}: an evaluator must return an array of findings, got ${inspectShort(findings)}`,
  );
  return findings.map((finding) => String(finding));
}

function expectFinding(findings, pattern, label) {
  const list = findingList(findings, label);
  assert.ok(list.length > 0, `${label}: expected at least one finding, got an all-clear`);
  assert.ok(
    list.some((finding) => pattern.test(finding)),
    `${label}: no finding matched ${pattern}\n  - ${list.join("\n  - ")}`,
  );
}

function expectClean(findings, label) {
  const list = findingList(findings, label);
  assert.deepEqual(list, [], `${label}: expected no findings, got:\n  - ${list.join("\n  - ")}`);
}

/** Assert a chain ranks strictly upward under the comparator. Symmetry has its own row. */
function ascending(compare, chain, label) {
  for (let index = 0; index + 1 < chain.length; index += 1) {
    assert.equal(
      compare(chain[index], chain[index + 1]),
      -1,
      `${label}: ${chain[index]} must rank strictly below ${chain[index + 1]}`,
    );
  }
}

/** A callable that must fail closed rather than answer, for malformed comparator operands. */
const failsClosed = (fn, label) =>
  assert.throws(fn, (error) => error instanceof TypeError || error instanceof RangeError, label);

// -------------------------------------------------------------------------------------
// The changelog fixture. Built from parts so a mutation row changes exactly one thing.
//
// The preamble deliberately mentions `[Unreleased]` in prose, names the two specification
// versions `1.1.0` and `2.0.0`, names the ceiling `0.1.0`, the current `0.1.0-alpha.1` and the
// prior placeholder `0.0.0-planning`. Every one of those is a token a careless scanner would
// reject, and every one of them is explicitly expected here. A checker that cannot tell a
// specification version from a fabricated release heading is not context-aware enough to ship.
// -------------------------------------------------------------------------------------

const CHANGELOG_TITLE = "# Changelog";

const CHANGELOG_PREAMBLE = [
  "All notable changes to this project are documented in this file.",
  "",
  `The format is based on [Keep a Changelog ${KAC_SPEC_VERSION}](${KAC_SPEC_URL}),`,
  `and this project adheres to [Semantic Versioning ${SEMVER_SPEC_VERSION}](${SEMVER_SPEC_URL}).`,
  "",
  "This project is in initial development (SemVer 0.y.z). No release exists: there is no",
  "released version, no release tag, no GitHub Release and no published package. The single",
  `[Unreleased] section below describes implemented project state, not a release. The package`,
  `version is ${CURRENT_VERSION}, a train entry on the way to ${CEILING}; the previous planning`,
  `placeholder was ${PREVIOUS_VERSION} and was never released either.`,
].join("\n");

const CHANGELOG_BODY = [
  "## [Unreleased]",
  "",
  "### Added",
  "- The unit-of-work port in `src/application/unit-of-work.mjs`, specifying the begin / body /",
  "  commit order and rollback on failure.",
  "",
  "### Changed",
  "- The package version moved from the planning placeholder onto the prerelease train.",
].join("\n");

const VALID_CHANGELOG = `${CHANGELOG_TITLE}\n\n${CHANGELOG_PREAMBLE}\n\n${CHANGELOG_BODY}\n`;

/** The fixture with its body replaced, keeping the title and preamble intact. */
const withBody = (body) => `${CHANGELOG_TITLE}\n\n${CHANGELOG_PREAMBLE}\n\n${body}\n`;

/** The fixture with extra markdown appended after a valid document. */
const withExtra = (extra) => `${VALID_CHANGELOG}\n${extra}\n`;

// =====================================================================================
// 1. The canonical policy artifact and its schema — 6 rows
//
// The policy is the only source. If it does not exist, does not parse, or does not pin the two
// specifications exactly, then every downstream answer is an opinion. These six rows are what
// makes the rest of the file mean anything.
// =====================================================================================

test("the canonical versioning policy exists at the repository root and parses as JSON", () => {
  const document = policy();
  assert.equal(typeof document, "object");
  assert.ok(!Array.isArray(document), `${POLICY_PATH} must be a JSON object, not an array`);
  assert.ok(
    policyText !== null && policyText.endsWith("\n"),
    `${POLICY_PATH} must end with a newline, like every other JSON artifact here`,
  );
});

test("the policy declares every required top-level section", () => {
  const document = policy();
  for (const field of [
    "schemaVersion",
    "id",
    "packageKind",
    "specifications",
    "developmentStage",
    "conceptualMapping",
    "ceiling",
    "train",
    "currentVersion",
    "release",
    "changelog",
    "unreleasedProvenance",
    "authorityBinding",
    "agentAuthority",
    "parity",
    "nonGoals",
  ]) {
    assert.ok(
      Object.hasOwn(document, field),
      `${POLICY_PATH} must declare ${field} — a missing section is an unanswerable question`,
    );
  }
  assert.equal(document.developmentStage, "initial-development");
  assert.ok(Array.isArray(document.nonGoals) && document.nonGoals.length > 0);
});

test("the policy pins Semantic Versioning 2.0.0 and Keep a Changelog 1.1.0 with exact URLs", () => {
  const { specifications } = policy();
  assert.equal(specifications?.semver?.name, "Semantic Versioning");
  assert.equal(specifications?.semver?.version, SEMVER_SPEC_VERSION);
  assert.equal(specifications?.semver?.url, SEMVER_SPEC_URL);
  assert.equal(specifications?.keepAChangelog?.name, "Keep a Changelog");
  assert.equal(specifications?.keepAChangelog?.version, KAC_SPEC_VERSION);
  assert.equal(specifications?.keepAChangelog?.url, KAC_SPEC_URL);
});

test("the ceiling is 0.1.0, agent-capped at 0.1.0, and carries no human override record", () => {
  const { ceiling } = policy();
  assert.equal(ceiling?.maxVersion, CEILING);
  assert.equal(ceiling?.agentAuthorizedMax, CEILING);
  assert.equal(ceiling?.raiseRequires, "explicit-human-decision");
  assert.equal(
    ceiling?.humanDecisionRecord,
    null,
    "the override record must stay null until a human writes one; a populated record here is the " +
      "single highest-salience change in this package",
  );
  for (const forbidden of ["0.1.1", "0.2.0", "1.0.0", "1.0.0-rc.1"]) {
    assert.ok(
      Array.isArray(ceiling?.forbiddenExamples) && ceiling.forbiddenExamples.includes(forbidden),
      `${forbidden} must be named as a forbidden example so the ceiling is legible, not implied`,
    );
  }
});

test("the policy records the current version, the placeholder it replaced, and zero releases", () => {
  const { currentVersion, train } = policy();
  assert.equal(currentVersion?.value, CURRENT_VERSION);
  assert.equal(currentVersion?.previousValue, PREVIOUS_VERSION);
  assert.equal(currentVersion?.isRelease, false);
  assert.equal(currentVersion?.previousWasRelease, false);
  assert.equal(currentVersion?.releaseCount, 0);
  assert.equal(currentVersion?.firstReleaseExists, false);
  assert.deepEqual(train?.stages, STAGES);
  assert.equal(train?.finalVersion, CEILING);
  assert.equal(train?.counterMin, 1);
  assert.equal(train?.leadingZeroesAllowed, false);
  assert.equal(train?.bareStageAllowed, false);
  assert.equal(train?.extraIdentifiersAllowed, false);
  assert.equal(train?.buildMetadataAllowed, false);
  assert.equal(train?.stageSkipAllowed, false);
});

test("every release dimension is false, the package is private, and parity is one-way", () => {
  const document = policy();
  for (const flag of [
    "authorized",
    "tagAllowed",
    "githubReleaseAllowed",
    "npmPublishAllowed",
    "deployAllowed",
    "productionAllowed",
  ]) {
    assert.equal(document.release?.[flag], false, `release.${flag} must be false`);
  }
  assert.equal(document.release?.packagePrivate, true);
  assert.ok(
    Array.isArray(document.release?.knownNonReleaseTags) &&
      document.release.knownNonReleaseTags.includes(NON_RELEASE_TAG),
    `the activation tag ${NON_RELEASE_TAG} must be named as a known non-release tag, so no reader ` +
      "and no checker can mistake an activation record for a release",
  );
  assert.equal(document.parity?.canonical, POLICY_PATH);
  assert.equal(document.parity?.direction, "one-way-canonical-to-projection");
  assert.equal(document.agentAuthority?.mayRecommendNextVersion, true);
  for (const denied of [
    "mayWriteVersion",
    "mayTag",
    "mayRelease",
    "mayPublish",
    "mayRaiseCeiling",
    "mayFabricateReleaseSection",
  ]) {
    assert.equal(document.agentAuthority?.[denied], false, `agentAuthority.${denied} must be false`);
  }
});

// =====================================================================================
// 2. The checker's exported surface, its purity, and its fail-closed floor — 4 rows
//
// Importing a checker must never run it, and no evaluator may ever answer "all clear" to a
// question it could not read. An empty finding list is the only answer that must be unreachable
// by accident, because it is the one that ends a review.
// =====================================================================================

test("the checker exports eight named evaluators, readers and entry points, all functions", () => {
  const module = checker();
  for (const name of REQUIRED_EXPORTS) {
    assert.equal(
      typeof module[name],
      "function",
      `${CHECKER_PATH} must export ${name} as a function — got ${inspectShort(module[name])}`,
    );
  }
});

test("importing the checker produces no output and runs none of its CLI assertions", () => {
  // Demanded first, so a missing module fails this row by name rather than through a child's
  // exit code, which would say only "3" and name nothing.
  checker();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(checkerUrl)});\n` +
        `for (const name of ${JSON.stringify(REQUIRED_EXPORTS)}) {\n` +
        "  if (typeof m[name] !== 'function') process.exit(3);\n" +
        "}\n",
    ],
    { encoding: "utf8", cwd: root },
  );
  assert.equal(result.status, 0, `importing the checker failed: ${result.stderr}`);
  assert.equal(result.stdout, "", `importing the checker wrote to stdout:\n${result.stdout}`);
  assert.equal(result.stderr, "", `importing the checker wrote to stderr:\n${result.stderr}`);
});

test("the checker imports only node: builtins and adds no dependency to the repository", () => {
  const text = source();
  const specifiers = [...text.matchAll(/(?:^|\n)\s*import\s[^\n]*?from\s+["']([^"']+)["']/g)]
    .map((match) => match[1])
    .concat([...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]));
  assert.ok(specifiers.length > 0, `${CHECKER_PATH} must import at least the builtins it uses`);
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith("node:"),
      `${CHECKER_PATH} imports ${specifier}; only node: builtins are permitted. A semver package ` +
        "would be the obvious shortcut and the largest new attack surface in this repository",
    );
  }
  assert.ok(
    !Object.hasOwn(packageJson, "dependencies") && !Object.hasOwn(packageJson, "devDependencies"),
    "no dependency key may be introduced for this package",
  );
});

test("every evaluator fails closed on undefined, null and malformed facts rather than answering", () => {
  const policyOf = evaluator("policyViolations");
  const transitionOf = evaluator("transitionViolations");
  const changelogOf = evaluator("changelogViolations");
  const parityOf = evaluator("parityViolations");
  const document = policy();

  expectFinding(policyOf(undefined, document), /./, "policyViolations(undefined, policy)");
  expectFinding(policyOf(CURRENT_VERSION, undefined), /./, "policyViolations(version, undefined)");
  expectFinding(policyOf(CURRENT_VERSION, null), /./, "policyViolations(version, null)");
  expectFinding(policyOf(CURRENT_VERSION, 42), /./, "policyViolations(version, 42)");
  expectFinding(transitionOf(undefined, undefined, document), /./, "transitionViolations(undefined…)");
  expectFinding(transitionOf(CURRENT_VERSION, null, document), /./, "transitionViolations(…, null)");
  expectFinding(changelogOf(null, document), /./, "changelogViolations(null, policy)");
  expectFinding(changelogOf(VALID_CHANGELOG, null), /./, "changelogViolations(…, null)");
  expectFinding(parityOf(undefined), /./, "parityViolations(undefined)");
  expectFinding(parityOf(null), /./, "parityViolations(null)");
  expectFinding(parityOf({}), /./, "parityViolations({})");
  expectFinding(parityOf("facts"), /./, "parityViolations(string)");
});

// =====================================================================================
// 3. Syntactically valid Semantic Versioning 2.0.0 — 8 rows
//
// This is the specification as written, not this project's train. Every string below must parse,
// including several this project will refuse a moment later. The parse result separates numeric
// from alphanumeric pre-release identifiers, because rule 11 cannot be implemented without that
// distinction and a parser that flattens it has already lost.
// =====================================================================================

const validSemVerRows = [
  ["0.0.4", { major: 0, minor: 0, patch: 4, prerelease: [], build: [] }],
  ["1.2.3", { major: 1, minor: 2, patch: 3, prerelease: [], build: [] }],
  [CURRENT_VERSION, { major: 0, minor: 1, patch: 0, prerelease: ["alpha", 1], build: [] }],
  ["0.1.0-alpha.beta", { major: 0, minor: 1, patch: 0, prerelease: ["alpha", "beta"], build: [] }],
  ["1.0.0-0A.is.legal", { major: 1, minor: 0, patch: 0, prerelease: ["0A", "is", "legal"], build: [] }],
  [PREVIOUS_VERSION, { major: 0, minor: 0, patch: 0, prerelease: ["planning"], build: [] }],
  ["0.1.0+build", { major: 0, minor: 1, patch: 0, prerelease: [], build: ["build"] }],
  ["0.1.0-rc.1+001", { major: 0, minor: 1, patch: 0, prerelease: ["rc", 1], build: ["001"] }],
];

for (const [version, expected] of validSemVerRows) {
  test(`SemVer 2.0.0 accepts ${version} and parses it exactly`, () => {
    const parse = evaluator("parseSemVer");
    const parsed = parse(version);
    assert.notEqual(parsed, null, `${version} is valid SemVer 2.0.0 and must parse`);
    assert.equal(parsed.major, expected.major, `${version}: major`);
    assert.equal(parsed.minor, expected.minor, `${version}: minor`);
    assert.equal(parsed.patch, expected.patch, `${version}: patch`);
    assert.deepEqual(
      parsed.prerelease,
      expected.prerelease,
      `${version}: pre-release identifiers must keep numeric identifiers as numbers and ` +
        "alphanumeric identifiers as strings, or rule 11 cannot be implemented",
    );
    assert.deepEqual(parsed.build, expected.build, `${version}: build metadata`);
  });
}

// =====================================================================================
// 4. Malformed Semantic Versioning — 14 rows
//
// Every one of these must return null. The final row is a long pathological identifier: it is a
// smoke check that the expression is linear on what it rejects, asserted by completing at all
// rather than by a wall-clock threshold, because a timing threshold on a shared machine is a
// flaky test wearing a security costume.
// =====================================================================================

const REDOS_PROBE = `0.1.0-${"0".repeat(20000)}!`;

const malformedSemVerRows = [
  ["1", "a bare major is not a version core"],
  ["1.2", "a two-part core is not a version core"],
  ["1.2.3.4", "a fourth numeric part is not part of the grammar"],
  ["1.2.3-", "an empty pre-release is not an identifier"],
  ["1.2.3+", "an empty build metadata field is not an identifier"],
  ["1.2.3-alpha..1", "an empty dot-separated identifier is refused"],
  ["v1.2.3", "the v prefix belongs to a tag name, never to a version"],
  ["1.2.3-α", "identifiers are [0-9A-Za-z-] only; non-ASCII is refused"],
  ["-1.2.3", "a negative core is not in the grammar"],
  ["1.2.3 ", "a trailing space is not trimmed away by a parser"],
  [" 1.2.3", "a leading space is not trimmed away by a parser"],
  ["", "the empty string is not a version"],
  ["0.1.0-alpha_1", "underscore is not a permitted identifier character"],
  [REDOS_PROBE, "a long pathological identifier is rejected, and terminates"],
];

for (const [version, why] of malformedSemVerRows) {
  const label = version === "" ? "the empty string" : version === REDOS_PROBE ? "a 20000-character identifier" : version;
  test(`SemVer 2.0.0 refuses ${label} — ${why}`, () => {
    const parse = evaluator("parseSemVer");
    assert.equal(parse(version), null, `${label} must not parse: ${why}`);
  });
}

// =====================================================================================
// 5. Leading zeroes, where the specification is precise and easy to get wrong — 6 rows
//
// Rule 2 forbids leading zeroes in the version core and rule 9 forbids them in a *numeric*
// pre-release identifier. Neither rule reaches an alphanumeric identifier, and rule 10 places no
// constraint on build metadata at all. Two of the six rows below are therefore legal SemVer, and
// they are here precisely because a parser that refuses them is wrong about the specification even
// though it happens to agree with this project's policy.
// =====================================================================================

const leadingZeroRows = [
  ["01.1.0", false, "rule 2: a leading zero in the major"],
  ["1.01.0", false, "rule 2: a leading zero in the minor"],
  ["1.1.01", false, "rule 2: a leading zero in the patch"],
  ["0.1.0-alpha.01", false, "rule 9: a numeric pre-release identifier may not carry a leading zero"],
  ["0.1.0-alpha.0a", true, "0a is alphanumeric, so no leading-zero rule fires"],
  ["0.1.0-alpha.1+001", true, "rule 10 places no leading-zero constraint on build metadata"],
];

for (const [version, valid, why] of leadingZeroRows) {
  test(`SemVer ${valid ? "accepts" : "refuses"} ${version} — ${why}`, () => {
    const parse = evaluator("parseSemVer");
    const parsed = parse(version);
    if (valid) {
      assert.notEqual(parsed, null, `${version} is valid SemVer 2.0.0: ${why}`);
    } else {
      assert.equal(parsed, null, `${version} is invalid SemVer 2.0.0: ${why}`);
    }
  });
}

// =====================================================================================
// 6. Precedence, SemVer rule 11 — 12 rows
//
// The comparator is the part of a versioning system that is most often wrong and least often
// noticed, because a lexical sort looks right until it silently reverses `alpha.9` and `alpha.10`.
// Every claim below comes from the specification, and the two that come from this repository —
// the placeholder ranking below the train entry, and the ascent past the ceiling — are stated as
// facts about ordering, never as permissions.
// =====================================================================================

test("the official SemVer 2.0.0 rule 11 example chain ranks in exactly the published order", () => {
  const compare = evaluator("comparePrecedence");
  ascending(
    compare,
    [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ],
    "the official rule 11 chain",
  );
});

test("numeric pre-release identifiers compare numerically: alpha.9 ranks below alpha.10", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(
    compare("0.1.0-alpha.9", "0.1.0-alpha.10"),
    -1,
    "a lexical comparator gets this backwards, and a versioning system may not ship with that defect",
  );
});

test("numeric comparison holds inside the beta stage too: beta.2 ranks below beta.11", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(compare("0.1.0-beta.2", "0.1.0-beta.11"), -1);
});

test("a numeric identifier always ranks below an alphanumeric one", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(compare("0.1.0-alpha.1", "0.1.0-alpha.beta"), -1);
});

test("a larger set of pre-release fields ranks above a prefix of it", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(
    compare("0.1.0-alpha", "0.1.0-alpha.1"),
    -1,
    "this is why a bare stage is refused by policy: it leaves the first transition ambiguous",
  );
});

test("build metadata is ignored, so two differently-built strings have equal precedence", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(
    compare("0.1.0-rc.1+aaa", "0.1.0-rc.1+bbb"),
    0,
    "rule 10 — and this equality is exactly why build metadata is banned from the train: two " +
      "distinct strings with identical precedence destroy the determinism of one current version",
  );
});

test("the comparator is symmetric across the whole project train", () => {
  const compare = evaluator("comparePrecedence");
  const train = [
    PREVIOUS_VERSION,
    "0.1.0-alpha.1",
    "0.1.0-alpha.2",
    "0.1.0-alpha.10",
    "0.1.0-beta.1",
    "0.1.0-rc.1",
    CEILING,
  ];
  for (const left of train) {
    for (const right of train) {
      assert.equal(
        compare(left, right),
        -compare(right, left) || 0,
        `compare(${left}, ${right}) must be the negation of compare(${right}, ${left})`,
      );
    }
  }
});

test("the comparator is reflexive: every train form has equal precedence with itself", () => {
  const compare = evaluator("comparePrecedence");
  for (const version of [PREVIOUS_VERSION, CURRENT_VERSION, "0.1.0-beta.1", "0.1.0-rc.1", CEILING]) {
    assert.equal(compare(version, version), 0, `${version} must equal itself`);
  }
});

test("a pre-release ranks below the version it prefixes", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(compare("0.1.0-rc.2", CEILING), -1);
});

test("the version core is compared before any pre-release identifier is consulted", () => {
  const compare = evaluator("comparePrecedence");
  assert.equal(
    compare(PREVIOUS_VERSION, CURRENT_VERSION),
    -1,
    "0.0.0 < 0.1.0 on the core alone, so moving off the planning placeholder is precedence-forward " +
      "and rewrites no history",
  );
});

test("versions above the ceiling still order correctly, which is a fact about ordering only", () => {
  const compare = evaluator("comparePrecedence");
  ascending(compare, [CEILING, "0.1.1", "0.2.0", "1.0.0"], "above the ceiling");
});

test("the comparator fails closed on a malformed operand rather than reporting equality", () => {
  const compare = evaluator("comparePrecedence");
  failsClosed(() => compare("v0.1.0", CURRENT_VERSION), "a v-prefixed operand must not be compared");
  failsClosed(() => compare(CURRENT_VERSION, "1.2"), "an incomplete core must not be compared");
  failsClosed(() => compare(null, CURRENT_VERSION), "null must not be compared");
  failsClosed(() => compare(CURRENT_VERSION, undefined), "undefined must not be compared");
});

// =====================================================================================
// 7. Forms this project permits — 6 rows
//
// The train and nothing else. `0.1.0` is absent on purpose: it is the conceptual terminus and it
// appears in the *refused* group below, because completion and release authority are false and a
// terminus nobody has authorized reaching is not a legal current value.
// =====================================================================================

const permittedRows = [
  ["0.1.0-alpha.1", "the first train entry, and the current version"],
  ["0.1.0-alpha.2", "the counter forward by one"],
  ["0.1.0-alpha.10", "a two-digit counter, with no leading zero"],
  ["0.1.0-beta.1", "the second stage, counter reset"],
  ["0.1.0-rc.1", "the third stage, counter reset"],
  ["0.1.0-rc.11", "a two-digit counter in the final stage"],
];

for (const [version, why] of permittedRows) {
  test(`policy permits ${version} — ${why}`, () => {
    const policyOf = evaluator("policyViolations");
    expectClean(policyOf(version, policy()), `${version} (${why})`);
  });
}

// =====================================================================================
// 8. Forms this project refuses — 14 rows
//
// Nine of these fourteen are perfectly valid SemVer. That is the point: syntax and policy are
// separate gates, and a ceiling that only refused malformed strings would refuse nothing that
// mattered. The finding families are separate too, so `policy-*` never masquerades as `semver-*`.
// =====================================================================================

const refusedRows = [
  [CEILING, /ceiling|terminal|completion|authority/i,
    "the conceptual terminus is not a permitted current value while completion and release " +
      "authority are false; only a fresh explicit human decision makes it reachable"],
  ["0.1.1", /ceiling/i, "above the ceiling"],
  ["0.2.0", /ceiling/i, "above the ceiling"],
  ["1.0.0", /ceiling|1\.0\.0/, "above the ceiling, and the version SemVer rule 5 reserves for a public API"],
  ["1.0.0-rc.1", /ceiling/i, "a pre-release of a higher core is still above the ceiling"],
  ["0.1.0-alpha.1+001", /build/i, "build metadata is refused outright: it breaks the one-current-version property"],
  ["0.1.0-alpha.1.2", /identifier|shape|form/i, "an extra identifier is not <stage>.<N>"],
  ["0.1.0-alpha", /bare|stage|counter/i, "a bare stage leaves the first transition ambiguous"],
  ["0.1.0-alpha.0", /counter|minimum|min/i, "the counter starts at one"],
  ["0.1.0-alpha.01", /leading|zero/i, "a numeric identifier may not carry a leading zero"],
  ["0.1.0-alpha.0a", /numeric|counter/i, "legal SemVer, but the counter must be a numeric identifier"],
  [PREVIOUS_VERSION, /placeholder|planning|train/i,
    "the historical planning placeholder is preserved as history and is never a value going forward"],
  ["0.1.0-gamma.1", /stage/i, "an unknown stage is not on the train"],
  ["0.1.0-Alpha.1", /case|stage/i, "stage names are lowercase; a case escape is still an escape"],
];

for (const [version, pattern, why] of refusedRows) {
  test(`policy refuses ${version} — ${why}`, () => {
    const policyOf = evaluator("policyViolations");
    expectFinding(policyOf(version, policy()), pattern, `${version} (${why})`);
  });
}

// =====================================================================================
// 9. Transitions — 13 rows
//
// Four moves are permitted and nine are refused. The permitted set is deliberately tiny because
// every version an agent can reach without a human is a version a human never chose. `rc.N` to
// `0.1.0` is in the refused set and belongs there under the authority in force: it is the
// completion move, and completion is a human decision that no automation in this package makes.
// =====================================================================================

const transitionRows = [
  ["0.1.0-alpha.1", "0.1.0-alpha.2", null, "the counter forward by one"],
  ["0.1.0-alpha.9", "0.1.0-alpha.10", null, "the counter forward by one, across a digit boundary"],
  ["0.1.0-alpha.3", "0.1.0-beta.1", null, "the next adjacent stage, counter reset to one"],
  ["0.1.0-beta.2", "0.1.0-rc.1", null, "the next adjacent stage, counter reset to one"],
  ["0.1.0-alpha.2", "0.1.0-alpha.2", /no-op|same|unchanged/i, "a no-op is not a transition"],
  ["0.1.0-alpha.2", "0.1.0-alpha.1", /backward|decrease|counter/i, "the counter never moves backwards"],
  ["0.1.0-alpha.2", "0.1.0-alpha.4", /skip|jump|counter/i, "the counter never jumps"],
  ["0.1.0-beta.1", "0.1.0-alpha.1", /backward|stage/i, "a stage never moves backwards"],
  ["0.1.0-alpha.1", "0.1.0-rc.1", /skip|stage/i,
    "stage skipping is precedence-forward and still refused: it destroys the record of which " +
      "prereleases actually happened"],
  ["0.1.0-rc.1", CEILING, /completion|human|release|authority/i,
    "the completion move is a human decision, never an automated one"],
  ["0.1.0-alpha.1", CEILING, /completion|human|release|authority|stage/i,
    "and it is not reachable from alpha under any reading"],
  ["0.1.0-rc.1", "0.1.1", /ceiling/i, "a ceiling escape is a ceiling escape wherever it starts"],
  ["0.1.0-rc.1", "1.0.0", /ceiling|1\.0\.0/, "the forbidden conceptual version is unreachable by transition"],
];

for (const [from, to, pattern, why] of transitionRows) {
  const verb = pattern === null ? "permits" : "refuses";
  test(`transition ${verb} ${from} -> ${to} — ${why}`, () => {
    const transitionOf = evaluator("transitionViolations");
    const findings = transitionOf(from, to, policy());
    if (pattern === null) {
      expectClean(findings, `${from} -> ${to} (${why})`);
    } else {
      expectFinding(findings, pattern, `${from} -> ${to} (${why})`);
    }
  });
}

// =====================================================================================
// 10. The conceptual Kernel-1.0 mapping — 4 rows
//
// "Kernel 1.0 complete" is a milestone in a plan. `1.0.0` is a promise about a public API that
// SemVer rule 5 defines and that nobody here has made. Keeping the two apart in machine-readable
// form is the only thing that stops a future reader — human or agent — from helpfully closing the
// gap between them.
// =====================================================================================

test("the milestone maps to package 0.1.0 and names 1.0.0 as forbidden", () => {
  const { conceptualMapping } = policy();
  assert.equal(conceptualMapping?.conceptualMilestone, CONCEPTUAL_MILESTONE);
  assert.equal(conceptualMapping?.packageVersion, CEILING);
  assert.equal(conceptualMapping?.forbiddenPackageVersion, FORBIDDEN_CONCEPTUAL_VERSION);
  assert.match(
    String(conceptualMapping?.note ?? ""),
    /1\.0\.0/,
    "the note must say in prose why 1.0.0 is refused, not merely record a field",
  );
});

test("a policy that maps the milestone to 1.0.0 is refused", () => {
  const policyOf = evaluator("policyViolations");
  const tampered = clone(policy());
  tampered.conceptualMapping.packageVersion = FORBIDDEN_CONCEPTUAL_VERSION;
  expectFinding(
    policyOf(CURRENT_VERSION, tampered),
    /conceptual|1\.0\.0|mapping/i,
    "a conceptual mapping onto 1.0.0",
  );
});

test("a changelog claiming Kernel 1.0 alongside a 1.0.0 version token is refused", () => {
  const changelogOf = evaluator("changelogViolations");
  expectFinding(
    changelogOf(
      withBody(
        [
          "## [Unreleased]",
          "",
          "### Added",
          "- Kernel 1.0 is complete and the package is now at 1.0.0.",
        ].join("\n"),
      ),
      policy(),
    ),
    /1\.0\.0|conceptual|version/i,
    "a Kernel 1.0 completion claim carrying a 1.0.0 token",
  );
});

test("a policy with the forbidden conceptual version removed is refused, not treated as permissive", () => {
  const policyOf = evaluator("policyViolations");
  const tampered = clone(policy());
  delete tampered.conceptualMapping.forbiddenPackageVersion;
  expectFinding(
    policyOf(CURRENT_VERSION, tampered),
    /forbidden|conceptual|mapping/i,
    "a policy whose forbidden mapping was deleted — absence must fail closed, never open",
  );
});

// =====================================================================================
// 11. Keep a Changelog 1.1.0 structure — 20 rows
//
// Strict by construction rather than by parser sophistication. This is a format the project fully
// controls, so canonical column-zero ATX headings are the whole grammar and every exotic form is a
// finding rather than a parsing challenge. That choice is what keeps this reader roughly twenty
// lines long and keeps the hardened README parser next door out of a surface it does not need.
//
// The last two rows are negative controls. A matrix that only ever asserts failure proves that a
// function can say no, which any function that always says no can do.
// =====================================================================================

const changelogRows = [
  [null, /missing|unreadable|absent/i, "an absent changelog is a finding, not an all-clear"],
  [VALID_CHANGELOG.replace(`${CHANGELOG_TITLE}\n\n`, ""), /title|h1/i, "a missing H1 title"],
  [`${CHANGELOG_TITLE}\n\n${VALID_CHANGELOG}`, /title|h1|duplicate/i, "a duplicate H1 title"],
  [
    VALID_CHANGELOG.replace(`Keep a Changelog ${KAC_SPEC_VERSION}`, "some changelog convention"),
    /preamble|keep a changelog/i,
    "a preamble that no longer names the specification it follows",
  ],
  [withBody("### Added\n- Something."), /unreleased/i, "zero [Unreleased] sections"],
  [withExtra("## [Unreleased]\n\n### Fixed\n- Something."), /unreleased|duplicate/i, "two [Unreleased] sections"],
  [
    withBody(["## [Notes]", "", "- Something.", "", "## [Unreleased]", "", "### Added", "- Something."].join("\n")),
    /unreleased|first/i,
    "[Unreleased] is not the first H2",
  ],
  [
    withBody(["## [Unreleased]", "", "### Added", "- One.", "", "### Added", "- Two."].join("\n")),
    /duplicate|added/i,
    "a duplicated category",
  ],
  [
    withBody(["## [Unreleased]", "", "### Notes", "- Something."].join("\n")),
    /category|notes|unknown/i,
    "a category outside the canonical six",
  ],
  [
    withBody(["## [Unreleased]", "", "### Fixed", "- One.", "", "### Added", "- Two."].join("\n")),
    /order/i,
    "categories out of canonical order — Fixed before Added",
  ],
  [
    withBody(["## [Unreleased]", "", "### Added", "- One.", "", "### Security", ""].join("\n")),
    /empty|security/i,
    "an empty category: an empty Security heading reads as audited-and-clean, a claim nobody made",
  ],
  [
    withBody(["## [Unreleased]", "", "## Added", "- One."].join("\n")),
    /depth|heading|category/i,
    "a category at H2 depth",
  ],
  [
    withBody(["## [Unreleased]", "", "#### Added", "- One."].join("\n")),
    /depth|heading|category/i,
    "a category at H4 depth",
  ],
  [
    withBody(["[Unreleased]", "-----------", "", "### Added", "- One."].join("\n")),
    /heading|atx|setext|unreleased/i,
    "a setext heading",
  ],
  [
    withBody(["<h2>[Unreleased]</h2>", "", "### Added", "- One."].join("\n")),
    /heading|html|unreleased/i,
    "an HTML heading",
  ],
  [
    withBody(["  ## [Unreleased]", "", "### Added", "- One."].join("\n")),
    /heading|indent|column|unreleased/i,
    "an indented heading, which is not excused as code",
  ],
  [
    withBody(["> ## [Unreleased]", "", "### Added", "- One."].join("\n")),
    /heading|quote|unreleased/i,
    "a blockquoted heading",
  ],
  [
    withBody(["- ## [Unreleased]", "", "### Added", "- One."].join("\n")),
    /heading|list|unreleased/i,
    "a heading inside a list item",
  ],
  [
    withExtra(["```markdown", "## [0.1.0] - 2026-08-07", "", "### Added", "- An example.", "```"].join("\n")),
    null,
    "a fenced example is documentation, not a release section",
  ],
  [VALID_CHANGELOG, null, "the canonical document, which must be clean"],
];

for (const [markdown, pattern, why] of changelogRows) {
  const verb = pattern === null ? "accepts" : "refuses";
  test(`changelog ${verb} ${why}`, () => {
    const changelogOf = evaluator("changelogViolations");
    const findings = changelogOf(markdown, policy());
    if (pattern === null) {
      expectClean(findings, why);
    } else {
      expectFinding(findings, pattern, why);
    }
  });
}

// =====================================================================================
// 12. Fabricated releases, tags and commit-log dumps — 7 rows
//
// Zero releases exist. Every construct below is a way of writing one into a document without
// having made one: a version heading, a date, a yank marker, a comparison link naming a tag that
// does not exist, a tag reference that assumes it does, and two forms of commit-log dump. Keep a
// Changelog names the commit-log dump as the first thing that makes a changelog bad; here it is
// also the fastest way to fabricate provenance.
// =====================================================================================

const fabricationRows = [
  [
    withExtra(["## [0.1.0] - 2026-08-07", "", "### Added", "- Something."].join("\n")),
    /version section|release|0\.1\.0/i,
    "a version section with a release date",
  ],
  [
    withExtra(["## 2026-08-07", "", "### Added", "- Something."].join("\n")),
    /date|release/i,
    "a bare date in a heading position",
  ],
  [
    withExtra(["## [0.1.0] - 2026-08-07 [YANKED]", "", "### Removed", "- Something."].join("\n")),
    /yank/i,
    "a [YANKED] marker, which presumes a release existed to be withdrawn",
  ],
  [
    withExtra("[Unreleased]: https://github.com/metaframer-net/metaframer-kernel/compare/v0.1.0...HEAD"),
    /link|definition|tag|compare/i,
    "a comparison link definition naming a tag that does not exist",
  ],
  [
    withBody(
      ["## [Unreleased]", "", "### Added", `- Released as \`${NON_RELEASE_TAG}\`.`].join("\n"),
    ),
    /tag|release/i,
    "an activation tag presented as a release",
  ],
  [
    withBody(
      ["## [Unreleased]", "", "### Added", "- 29b92eb1624f6dd44ccdc4f7abbdbdce180d31ba added a port."].join("\n"),
    ),
    /commit|sha|hash/i,
    "an entry carrying a raw commit hash",
  ],
  [
    withBody(
      [
        "## [Unreleased]",
        "",
        "### Added",
        "- Merge pull request #12 from karacaismail/feature",
        "- feat(kernel): add unit of work port",
      ].join("\n"),
    ),
    /commit|merge|conventional/i,
    "a git-log dump: a merge subject and a conventional-commit prefix",
  ],
];

for (const [markdown, pattern, why] of fabricationRows) {
  test(`changelog refuses ${why}`, () => {
    const changelogOf = evaluator("changelogViolations");
    expectFinding(changelogOf(markdown, policy()), pattern, why);
  });
}

// =====================================================================================
// 13. Parity and drift — 8 rows
//
// One direction, always. A drift finding names the projection that moved, so a fix has exactly one
// legal shape: bring the projection back to the canonical value. The reverse reading — "update the
// policy to match package.json" — is the one repair that must never look reasonable, because it
// turns a copy into a source.
// =====================================================================================

/** A fact set that agrees with the canonical policy in every projection. */
function consistentFacts() {
  const document = policy();
  return {
    policy: document,
    packageJson: { name: packageJson.name, private: true, version: CURRENT_VERSION },
    changelog: VALID_CHANGELOG,
    readme: `## Versioning and changelog\n\nThe current version is ${CURRENT_VERSION}. The ceiling is ${CEILING}. No release is authorized.\n`,
    docs: `# Versioning policy\n\nCurrent version: ${CURRENT_VERSION}. Ceiling: ${CEILING}.\n`,
    tags: [NON_RELEASE_TAG],
  };
}

test("parity refuses a package.json version that drifted from the canonical policy", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.packageJson.version = "0.1.0-beta.1";
  expectFinding(parityOf(facts), /package\.json/i, "package.json drift");
});

test("parity refuses a changelog version token that drifted from the canonical policy", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.changelog = VALID_CHANGELOG.replaceAll(CURRENT_VERSION, "0.1.0-alpha.7");
  expectFinding(parityOf(facts), /changelog/i, "changelog drift");
});

test("parity refuses a README versioning section that drifted from the canonical policy", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.readme = facts.readme.replace(CURRENT_VERSION, "0.1.0-rc.4");
  expectFinding(parityOf(facts), /readme/i, "README drift");
});

test("parity refuses a docs projection that drifted from the canonical policy", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.docs = facts.docs.replace(CEILING, "0.2.0");
  expectFinding(parityOf(facts), /docs|versioning-policy\.md/i, "docs drift");
});

test("parity refuses a policy whose recorded predecessor was rewritten", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.policy = clone(facts.policy);
  facts.policy.currentVersion.previousValue = "0.1.0-alpha.0";
  expectFinding(
    parityOf(facts),
    /previous|placeholder|history/i,
    "the planning placeholder is preserved, not rewritten; erasing it erases the only evidence " +
      "that the migration happened",
  );
});

test("parity refuses a provenance path that does not exist in the tree", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.policy = clone(facts.policy);
  facts.policy.unreleasedProvenance = [
    { path: "src/application/nowhere-at-all.mjs", role: "a claim with nothing behind it" },
  ];
  facts.provenancePresent = { "src/application/nowhere-at-all.mjs": false };
  expectFinding(parityOf(facts), /provenance|path|missing/i, "an unbacked provenance path");
});

test("a drift finding always names the projection that moved, never the canonical file", () => {
  const parityOf = evaluator("parityViolations");
  const facts = consistentFacts();
  facts.packageJson.version = "0.1.0-beta.1";
  const findings = findingList(parityOf(facts), "drift direction");
  assert.ok(findings.length > 0, "expected a drift finding");
  for (const finding of findings) {
    assert.ok(
      !/policy .*(?:must|should) (?:match|equal|follow)/i.test(finding),
      `a finding invited the canonical file to be corrected to a projection: ${finding}`,
    );
  }
  assert.ok(
    findings.some((finding) => /package\.json/i.test(finding)),
    `no finding named the projection that moved:\n  - ${findings.join("\n  - ")}`,
  );
});

test("a fact set that agrees with the canonical policy everywhere is clean", () => {
  const parityOf = evaluator("parityViolations");
  expectClean(parityOf(consistentFacts()), "a consistent fact set");
});

// =====================================================================================
// 14. Authority movement — 8 rows
//
// This package moves no authority dimension. Every row below is a way of quietly moving one, and
// each must be refused by the checker rather than absorbed as configuration. The last row is the
// only one that is not a policy edit: a release-shaped tag appearing in the tree is a claim about
// the world, and it is refused for the same reason.
// =====================================================================================

const authorityRows = [
  [["authorityBinding", "releaseAllowed"], true, /release/i, "release authority"],
  [["authorityBinding", "deployAllowed"], true, /deploy/i, "deployment authority"],
  [["authorityBinding", "productionAllowed"], true, /production/i, "production authority"],
  [["authorityBinding", "kernelReady"], true, /kernelReady|ready/i, "a kernel-readiness claim"],
  [["authorityBinding", "gapClosed"], true, /gap/i, "a gap-closed claim"],
  [["release", "tagAllowed"], true, /tag/i, "tag authority"],
  [["release", "npmPublishAllowed"], true, /publish|npm/i, "publish authority"],
];

for (const [[section, flag], value, pattern, why] of authorityRows) {
  test(`the checker refuses a policy that raises ${section}.${flag} — ${why} is not this package's to move`, () => {
    const policyOf = evaluator("policyViolations");
    const tampered = clone(policy());
    tampered[section][flag] = value;
    expectFinding(policyOf(CURRENT_VERSION, tampered), pattern, `${section}.${flag} raised`);
  });
}

test("the checker refuses a release-shaped tag in the tree, and knows the activation tag is not one", () => {
  const parityOf = evaluator("parityViolations");
  const clean = consistentFacts();
  expectClean(parityOf(clean), "the activation tag alone is not a release tag");
  const fabricated = consistentFacts();
  fabricated.tags = [NON_RELEASE_TAG, "v0.1.0"];
  expectFinding(parityOf(fabricated), /tag|release/i, "a v-prefixed release tag");
});

// =====================================================================================
// 15. Wiring, and the ways it can quietly come undone — 6 rows
//
// A checker that is not run is a comment. The position matters as much as the presence: the
// compositor owns the final line of `npm run check`, so this checker runs immediately before it
// and the run still ends with the checkout-local projection.
// =====================================================================================

test(`package.json exposes ${CHECKER_SCRIPT} as exactly node ${CHECKER_PATH}`, () => {
  assert.equal(
    packageJson.scripts?.[CHECKER_SCRIPT],
    `node ${CHECKER_PATH}`,
    `${CHECKER_SCRIPT} must exist under its exact name and command`,
  );
});

test("no renamed or aliased variant stands in for the versioning script", () => {
  const names = Object.keys(packageJson.scripts ?? {});
  assert.ok(names.includes(CHECKER_SCRIPT), `${CHECKER_SCRIPT} must be present`);
  const impostors = names.filter(
    (name) =>
      name !== CHECKER_SCRIPT &&
      String(packageJson.scripts[name]).includes(CHECKER_PATH) &&
      name !== "check",
  );
  assert.deepEqual(
    impostors,
    [],
    `the checker must be exposed under one name only; found ${impostors.join(", ")}`,
  );
});

test("npm run check runs the versioning checker", () => {
  assert.ok(
    String(packageJson.scripts?.check ?? "").includes(CHECKER_PATH),
    `${CHECKER_PATH} must be wired into npm run check, not merely available under its own script`,
  );
});

test("the versioning checker runs immediately before the compositor, which stays last", () => {
  const check = String(packageJson.scripts?.check ?? "");
  const checkerAt = check.indexOf(CHECKER_PATH);
  const compositorAt = check.indexOf(COMPOSITOR_PATH);
  assert.ok(checkerAt >= 0, `${CHECKER_PATH} must appear in npm run check`);
  assert.ok(compositorAt >= 0, `${COMPOSITOR_PATH} must still appear in npm run check`);
  assert.ok(
    checkerAt < compositorAt,
    "the compositor owns the final checkout-local projection line, so the versioning checker must " +
      "run before it",
  );
  const between = check.slice(checkerAt + CHECKER_PATH.length, compositorAt);
  assert.ok(
    !/tools\/check-/.test(between),
    `nothing may be inserted between the versioning checker and the compositor; found: ${between}`,
  );
});

test("the versioning checker exists on disk as a readable module", () => {
  const text = source();
  assert.ok(text.length > 0, `${CHECKER_PATH} must not be empty`);
  assert.match(
    text,
    /invokedAsCli|import\.meta\.url/,
    "the CLI must sit behind an explicit invocation guard, so importing the module runs nothing",
  );
});

test("the checker CLI exits non-zero on a seeded violation, against an injected root", async () => {
  // Demanded before any directory is created, so a missing checker never leaves a temp tree behind.
  source();
  const document = policy();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mfk-versioning-red-"));
  try {
    const seeded = clone(document);
    seeded.currentVersion.value = FORBIDDEN_CONCEPTUAL_VERSION;
    await writeFile(path.join(temporaryRoot, POLICY_PATH), `${JSON.stringify(seeded, null, 2)}\n`);
    await writeFile(
      path.join(temporaryRoot, "package.json"),
      `${JSON.stringify({ name: packageJson.name, private: true, version: "9.9.9" }, null, 2)}\n`,
    );
    await writeFile(
      path.join(temporaryRoot, CHANGELOG_PATH),
      withExtra(["## [0.1.0] - 2026-08-07", "", "### Added", "- A release that never happened."].join("\n")),
    );

    const result = spawnSync(process.execPath, [path.join(root, CHECKER_PATH), temporaryRoot], {
      encoding: "utf8",
      cwd: root,
    });
    assert.notEqual(
      result.status,
      0,
      "a seeded ceiling escape, a drifted package version and a fabricated release section must " +
        `fail the CLI:\n${result.stdout}${result.stderr}`,
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /1\.0\.0|ceiling/i, `the CLI must name the ceiling escape:\n${output}`);
    assert.ok(
      !output.includes("CURRENT EFFECTIVE"),
      "the compositor owns that label; this checker must never print it",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// =====================================================================================
// 16. The real artifacts and the real CLI — 8 rows
//
// Everything above can be satisfied by a checker that is right about fixtures and wrong about this
// repository. These eight rows close that gap: the shipped policy, the shipped changelog, the
// shipped package version and the actual command line, on this checkout.
// =====================================================================================

test("the real repository passes checkVersioning with no findings", () => {
  const check = evaluator("checkVersioning");
  expectClean(check(root), "the real repository");
});

test("the real CHANGELOG.md is clean under the changelog evaluator", () => {
  const changelogOf = evaluator("changelogViolations");
  expectClean(changelogOf(changelog(), policy()), "the shipped CHANGELOG.md");
});

test("the real package.json version equals the canonical policy value", () => {
  const document = policy();
  assert.equal(
    packageJson.version,
    document.currentVersion?.value,
    "package.json#version is a projection of the canonical policy and must equal it exactly",
  );
  assert.equal(packageJson.version, CURRENT_VERSION);
  assert.equal(packageJson.private, true, "the package stays private; nothing here is publishable");
});

test("the real README and docs projections carry the canonical version and ceiling", () => {
  const document = policy();
  const value = String(document.currentVersion?.value);
  assert.match(readmeText, /##\s+Versioning and changelog/, "README must carry the versioning section");
  assert.ok(readmeText.includes(value), `README must state the canonical version ${value}`);
  assert.ok(readmeText.includes(CEILING), `README must state the ceiling ${CEILING}`);
  const projection = docs();
  assert.ok(projection.includes(value), `${DOCS_PATH} must state the canonical version ${value}`);
  assert.ok(projection.includes(CEILING), `${DOCS_PATH} must state the ceiling ${CEILING}`);
});

test("the checker CLI exits 0 on this checkout and prints exactly one OK line", () => {
  source();
  const result = spawnSync(process.execPath, [path.join(root, CHECKER_PATH)], {
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(result.status, 0, `the CLI must pass on this checkout:\n${result.stdout}${result.stderr}`);
  const ok = String(result.stdout)
    .split("\n")
    .filter((line) => line.startsWith("OK kernel-versioning:"));
  assert.equal(ok.length, 1, `expected exactly one OK kernel-versioning line:\n${result.stdout}`);
  assert.match(ok[0], new RegExp(`version=${CURRENT_VERSION.replace(/[.+]/g, "\\$&")}`));
  assert.match(ok[0], new RegExp(`ceiling=${CEILING.replace(/\./g, "\\.")}`));
  assert.match(ok[0], /releases=0/);
});

test("the checker CLI never prints a label the compositor owns", () => {
  source();
  const result = spawnSync(process.execPath, [path.join(root, CHECKER_PATH)], {
    encoding: "utf8",
    cwd: root,
  });
  const output = `${result.stdout}${result.stderr}`;
  for (const label of ["CURRENT EFFECTIVE", "CHECKOUT-LOCAL PROJECTION", "BRANCH CANDIDATE", "ACTIVATION BASE"]) {
    assert.ok(!output.includes(label), `the checker printed ${label}, which belongs to the compositor`);
  }
});

test("any next-version output is labelled a recommendation and never an authorization", () => {
  const check = evaluator("checkVersioning");
  expectClean(check(root), "the real repository, before reading its recommendation");
  const result = spawnSync(process.execPath, [path.join(root, CHECKER_PATH)], {
    encoding: "utf8",
    cwd: root,
  });
  const recommendations = String(result.stdout)
    .split("\n")
    .filter((line) => /recommend/i.test(line));
  assert.ok(recommendations.length > 0, `the CLI must print its permitted next values:\n${result.stdout}`);
  for (const line of recommendations) {
    assert.match(
      line,
      /RECOMMENDATION \(not authorization; a human decides\):/,
      `a recommendation must be labelled as non-authorizing: ${line}`,
    );
    assert.ok(
      !/1\.0\.0/.test(line),
      `a recommendation may never name the forbidden conceptual version: ${line}`,
    );
    assert.ok(
      !new RegExp(`(^|[^-])\\b${CEILING.replace(/\./g, "\\.")}\\b\\s*$`).test(line),
      `the completion move is a human decision and may never be recommended: ${line}`,
    );
  }
});

// Two disposable, deterministic checkouts of this exact commit, built fresh per test rather than
// relying on whichever branch this worktree happens to be on. Each is a full `git clone --local` of
// this checkout (never a linked worktree of the shared repository, so cleanup is a plain directory
// removal), sited next to it so ambient sibling discovery — the Actionplan checkout this package's
// activation base itself depends on — still resolves. Branch name alone decides admission: "main"
// mirrors exact origin/main and can be admitted; the other never can, whatever it is named.
// Deterministically simulates, inside the scratch checkout itself, the two facts an exact-main
// admission needs from the outside world — a canonical origin/main ref and a published annotated
// activation tag — so the assertion never depends on this worktree's ambient GitHub state (a stale
// origin/main, or a tag that has not actually been pushed). `refs/remotes/origin/main` is pinned to
// this checkout's own head, and the canonical remote URL is redirected, via a repository-local
// `insteadOf` rule, to the checkout itself, which already carries the tag it needs to answer
// `git ls-remote` with — no network, no ambient state, feature-vs-exact-main semantics unchanged.
const simulateExactMainActivation = (dir, headSha) => {
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", headSha], { stdio: ["ignore", "pipe", "pipe"] });
  const introduced = execFileSync(
    "git",
    ["-C", dir, "log", "--diff-filter=A", "--format=%H", "--reverse", "refs/remotes/origin/main", "--", "db/kernel-runtime-substrate-s1.json"],
    { encoding: "utf8" },
  ).trim();
  const packageCommit = introduced.split("\n")[0].trim();
  const tagMessage = [
    "KERNEL-RUNTIME-SUBSTRATE-S1-ACTIVATION",
    "packageId=kernel-runtime-substrate-s1-2026-08-06",
    `packageCommit=${packageCommit}`,
    "independentVerification=root-codex",
    "verifiedCommands=npm test|npm run check|npm run check:substrate-s1:static|npm run test:substrate-s1",
    "results=GREEN",
  ].join("\n");
  execFileSync(
    "git",
    ["-C", dir, "tag", "-f", "-a", "kernel-runtime-substrate-s1-activated", packageCommit, "-m", tagMessage],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const canonicalRemote = "git@github.com:metaframer-net/metaframer-kernel.git";
  const scratchOriginPlaceholder = `metaframer-scratch-origin-placeholder://${path.basename(dir)}`;
  // `git remote get-url` and `git ls-remote` resolve URLs through the same `insteadOf` table, so a
  // single rule redirecting the canonical remote straight to this checkout would also make
  // `remote get-url origin` report the checkout's local path instead of the canonical string the
  // checker compares against. Two rules avoid that: origin's configured URL is a placeholder that
  // resolves *to* the canonical string (so identity verification sees the real value), and the
  // canonical string separately resolves *to* this checkout (so the tag lookup runs locally).
  execFileSync("git", ["-C", dir, "remote", "set-url", "origin", scratchOriginPlaceholder], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-C", dir, "config", `url.${canonicalRemote}.insteadOf`, scratchOriginPlaceholder], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync(
    "git",
    ["-C", dir, "config", `url.${dir}.insteadOf`, canonicalRemote],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
};

const buildGitContextCheckouts = async () => {
  const headSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const canonicalRemote = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const parent = path.dirname(root);
  const build = async (branchName) => {
    const dir = await mkdtemp(path.join(parent, ".scratch-mfk-ctx-"));
    execFileSync("git", ["clone", "--quiet", "--local", root, dir], { stdio: ["ignore", "pipe", "pipe"] });
    execFileSync("git", ["remote", "set-url", "origin", canonicalRemote], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    execFileSync("git", ["checkout", "--quiet", "-B", branchName, headSha], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    if (branchName === "main") simulateExactMainActivation(dir, headSha);
    return dir;
  };
  const exactMain = await build("main");
  const featureCheckout = await build("scratch-feature-checkout");
  return {
    exactMain,
    featureCheckout,
    async cleanup() {
      await rm(exactMain, { recursive: true, force: true });
      await rm(featureCheckout, { recursive: true, force: true });
    },
  };
};

test("on a constructed feature checkout, npm run check runs the versioning checker and still ends with the checkout-local projection", async (t) => {
  const checkouts = await buildGitContextCheckouts();
  t.after(() => checkouts.cleanup());
  const result = spawnSync("npm", ["run", "check", "--silent"], { cwd: checkouts.featureCheckout, encoding: "utf8" });
  assert.equal(result.error, undefined, `npm run check could not be executed: ${result.error?.message}`);
  const lines = String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(">"));
  const context = `\n--- npm run check output ---\n${lines.join("\n")}\n---`;
  assert.equal(result.status, 0, `npm run check must stay green${context}`);
  const ok = lines.filter((line) => line.startsWith("OK kernel-versioning:"));
  assert.equal(ok.length, 1, `npm run check must carry exactly one versioning OK line${context}`);
  const projection = lines.filter((line) => line.startsWith("CHECKOUT-LOCAL PROJECTION"));
  assert.equal(projection.length, 1, `expected exactly one checkout-local projection line${context}`);
  assert.equal(lines.at(-1), projection[0], `the compositor must still own the final line${context}`);
  assert.ok(
    lines.indexOf(ok[0]) < lines.indexOf(projection[0]),
    `the versioning checker must run before the compositor${context}`,
  );
  assert.deepEqual(
    lines.filter((line) => line.startsWith("CURRENT EFFECTIVE")),
    [],
    `a feature checkout must emit zero CURRENT EFFECTIVE lines${context}`,
  );
});

test("on a constructed exact-main checkout, npm run check runs the versioning checker and still ends with the CURRENT EFFECTIVE line", async (t) => {
  const checkouts = await buildGitContextCheckouts();
  t.after(() => checkouts.cleanup());
  const result = spawnSync("npm", ["run", "check", "--silent"], { cwd: checkouts.exactMain, encoding: "utf8" });
  assert.equal(result.error, undefined, `npm run check could not be executed: ${result.error?.message}`);
  const lines = String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(">"));
  const context = `\n--- npm run check output ---\n${lines.join("\n")}\n---`;
  assert.equal(result.status, 0, `npm run check must stay green${context}`);
  const ok = lines.filter((line) => line.startsWith("OK kernel-versioning:"));
  assert.equal(ok.length, 1, `npm run check must carry exactly one versioning OK line${context}`);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("CHECKOUT-LOCAL PROJECTION")),
    [],
    `exact-main must emit zero checkout-local projection lines${context}`,
  );
  const current = lines.filter((line) => line.startsWith("CURRENT EFFECTIVE"));
  assert.equal(current.length, 1, `expected exactly one CURRENT EFFECTIVE line${context}`);
  assert.equal(lines.at(-1), current[0], `the compositor must still own the final line${context}`);
  assert.ok(
    lines.indexOf(ok[0]) < lines.indexOf(current[0]),
    `the versioning checker must run before the compositor${context}`,
  );
});

// =====================================================================================
// 17. Provenance — 1 row
//
// Per-entry provenance lives in the policy as path plus role, so the human document stays prose
// for humans and the machine still has something to check. A path that does not resolve is a claim
// with nothing behind it, which is the machine-readable form of the commit dump this package bans.
// =====================================================================================

test("every unreleased provenance path resolves in this tree", async () => {
  const { unreleasedProvenance } = policy();
  assert.ok(
    Array.isArray(unreleasedProvenance) && unreleasedProvenance.length > 0,
    "the policy must record provenance for the unreleased section",
  );
  for (const entry of unreleasedProvenance) {
    assert.equal(typeof entry?.path, "string", `a provenance entry must carry a path: ${inspectShort(entry)}`);
    assert.ok(
      typeof entry?.role === "string" && entry.role.length > 0,
      `${entry?.path} must carry a role, so the entry says what it is and not only where it is`,
    );
    await assert.doesNotReject(
      readFile(path.join(root, entry.path)).catch(async (error) => {
        // A directory is a legitimate provenance target; only an absent path is a finding.
        if (error?.code === "EISDIR") return;
        throw error;
      }),
      `provenance path ${entry.path} must exist in this tree`,
    );
  }
});

// =====================================================================================
// 18. Baseline guards — 4 rows, green from the start
//
// These four are green on this checkout and are expected to stay green. They are not achievements
// of this package; they are the properties this package must not break on its way to GREEN. A
// suite that reported 149 red rows would be claiming they were owed, and they are not.
// =====================================================================================

test("package.json declares no dependencies key", () => {
  assert.ok(
    !Object.hasOwn(packageJson, "dependencies"),
    "this package adds zero dependencies; a semver library would be the largest new attack surface here",
  );
});

test("package.json declares no devDependencies key", () => {
  assert.ok(
    !Object.hasOwn(packageJson, "devDependencies"),
    "the verification surface runs on node: builtins alone, and must keep doing so",
  );
});

test("scripts.test stays byte-exact, so a new suite is discovered rather than declared", () => {
  assert.equal(
    packageJson.scripts?.test,
    "node --test tests/*.test.mjs",
    "two existing suites assert this string exactly; a new tests/*.test.mjs file is auto-discovered",
  );
});

test("the four pre-existing checkers stay wired in npm run check", () => {
  const check = String(packageJson.scripts?.check ?? "");
  for (const existing of PRE_EXISTING_CHECKERS) {
    assert.ok(check.includes(existing), `${existing} must stay in npm run check`);
  }
  assert.ok(
    check.includes("tools/check-kernel-runtime-pilot-consumer-sync.mjs"),
    "the consumer-sync verifier must stay wrapped by the compositor",
  );
  assert.ok(check.includes(COMPOSITOR_PATH), "the compositor must stay in npm run check");
});
