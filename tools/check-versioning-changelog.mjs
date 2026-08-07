import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// Versioning and changelog governance — one canonical owner, two independent gates
//
// `versioning-policy.json` at the repository root is the only place a version or policy value is
// decided. `package.json#version`, `CHANGELOG.md`, the README's versioning section and
// `docs/versioning-policy.md` are projections of it. Every parity finding below names the
// projection that moved and never the canonical file, so a drift fix has exactly one legal shape:
// restore the copy. The reverse repair — editing the policy until it agrees with a copy — turns a
// projection into a source, and two sources is how a version becomes a matter of opinion.
//
// Two gates, kept apart on purpose. The first is Semantic Versioning 2.0.0 as written: a grammar
// and a precedence order this repository does not get to reinterpret. `parseSemVer` and
// `comparePrecedence` implement that and nothing else, so `1.0.0` and `0.1.0-alpha.1+001` both
// parse cleanly here. The second is this project's much narrower train — `0.1.0-alpha.N`,
// `0.1.0-beta.N`, `0.1.0-rc.N` — and it refuses most of what the first gate accepts. Findings
// carry separate prefixes (`semver-`/`policy-`) so a reviewer can tell "malformed" from "forbidden
// here" without reading the rule.
//
// The ceiling is `0.1.0`, and it is the conceptual terminus rather than a legal value. The
// eventual Kernel-complete milestone maps to package `0.1.0` and never to `1.0.0`: SemVer rule 5
// makes `1.0.0` a public-API definition, and no decision has authorized one. While completion and
// release authority are false, `0.1.0` itself is refused as a current value and as a
// recommendation, so `rc.N -> 0.1.0` fails here and becomes reachable only through a fresh,
// explicit human completion decision. No final transition is automated by this file.
//
// Structure follows the house pattern in `tools/check-repository-boundary.mjs`: pure evaluators
// over injected facts, then one reader that turns a real tree into those facts, then a CLI behind
// an invocation guard. Importing this module reads nothing, prints nothing and asserts nothing.
// The evaluators are what make 145 adversarial rows testable without writing a file anywhere.
//
// Fail-closed in both directions. Every evaluator returns a finding — never an empty list — for
// facts it could not read. An empty list is an all-clear, and an all-clear is the one answer that
// must never be reachable by accident.
//
// Two limits are recorded rather than papered over. The ceiling is a review tripwire, not a
// cryptographic gate: an actor who can edit every file can edit both the policy and its test. And
// tag reading is bounded by the local clone, so a remote-only fabricated release tag is invisible
// here — that can under-report and can never produce a false accusation.
//
// This file writes nothing, and spawns nothing but a fixed-argv, shell-free `git tag -l`.
// =====================================================================================

// -------------------------------------------------------------------------------------
// Semantic Versioning 2.0.0 — the specification, unmodified
// -------------------------------------------------------------------------------------

/**
 * The official BNF, transcribed. Every quantifier is anchored to a fixed start, and the pre-release
 * alternation is a plain three-way choice over a bounded identifier, so a pathological identifier
 * costs a linear scan rather than a catastrophic one.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A numeric identifier: rule 9 forbids leading zeroes, so `01` is not one. */
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/;

/**
 * Parse a version string, or return null.
 *
 * Numeric pre-release identifiers come back as numbers and alphanumeric ones as strings. That
 * distinction is not decoration: rule 11 orders numeric identifiers numerically and below every
 * alphanumeric one, and a parser that flattens both to text cannot implement it.
 *
 * @param {unknown} value
 * @returns {null | {major:number, minor:number, patch:number, prerelease:Array<string|number>, build:string[]}}
 */
export function parseSemVer(value) {
  if (typeof value !== "string") return null;
  const match = SEMVER.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease:
      match[4] === undefined
        ? []
        : match[4]
            .split(".")
            .map((identifier) => (NUMERIC_IDENTIFIER.test(identifier) ? Number(identifier) : identifier)),
    build: match[5] === undefined ? [] : match[5].split("."),
  };
}

/** A short, safe rendering for a finding or an error message. */
function describe(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
}

const sign = (difference) => (difference < 0 ? -1 : difference > 0 ? 1 : 0);

/** Rule 11 for one pair of pre-release identifiers. */
function compareIdentifier(left, right) {
  const leftNumeric = typeof left === "number";
  const rightNumeric = typeof right === "number";
  if (leftNumeric && rightNumeric) return sign(left - right);
  // "Numeric identifiers always have lower precedence than non-numeric identifiers."
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Compare two versions by SemVer 2.0.0 rule 11. Build metadata is ignored (rule 10).
 *
 * Fails closed on an operand it cannot parse. Returning 0 for an unreadable string would report
 * "equal precedence", which is an answer, and there is no answer to give.
 *
 * @returns {-1|0|1}
 */
export function comparePrecedence(left, right) {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  if (a === null) throw new TypeError(`not a valid SemVer 2.0.0 version: ${describe(left)}`);
  if (b === null) throw new TypeError(`not a valid SemVer 2.0.0 version: ${describe(right)}`);

  for (const field of ["major", "minor", "patch"]) {
    const core = sign(a[field] - b[field]);
    if (core !== 0) return core;
  }

  // "A pre-release version has lower precedence than the associated normal version."
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const identifier = compareIdentifier(a.prerelease[index], b.prerelease[index]);
    if (identifier !== 0) return identifier;
  }
  // "A larger set of pre-release fields has a higher precedence than a smaller set."
  return sign(a.prerelease.length - b.prerelease.length);
}

// -------------------------------------------------------------------------------------
// The canonical policy's own integrity
// -------------------------------------------------------------------------------------

/** Every section the policy must declare. A missing one is an unanswerable question. */
const REQUIRED_POLICY_FIELDS = [
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
];

/** The two specifications, pinned by name, version and URL so a silent re-point is a finding. */
const SPECIFICATION_PINS = {
  semver: {
    name: "Semantic Versioning",
    version: "2.0.0",
    url: "https://semver.org/spec/v2.0.0.html",
  },
  keepAChangelog: {
    name: "Keep a Changelog",
    version: "1.1.0",
    url: "https://keepachangelog.com/en/1.1.0/",
  },
};

/** The authority in force. This package moves no dimension of it. */
const EXPECTED_AUTHORITY = {
  verdict: "GO-KERNEL-DEVELOPMENT-ONLY",
  codeStartAllowed: true,
  runtimeCodeAllowed: true,
  runtimeImplementationStarted: true,
  kernelReady: false,
  sdkReady: false,
  appBuildable: false,
  releaseAllowed: false,
  deployAllowed: false,
  productionAllowed: false,
  gapClosed: false,
};

/** Every release dimension, all shut, plus the private flag that keeps them shut in practice. */
const EXPECTED_RELEASE = {
  authorized: false,
  tagAllowed: false,
  githubReleaseAllowed: false,
  npmPublishAllowed: false,
  deployAllowed: false,
  productionAllowed: false,
  packagePrivate: true,
};

/** Recommendation is the only thing an agent may do with a version here. */
const EXPECTED_AGENT_AUTHORITY = {
  mayRecommendNextVersion: true,
  mayWriteVersion: false,
  mayTag: false,
  mayRelease: false,
  mayPublish: false,
  mayRaiseCeiling: false,
  mayFabricateReleaseSection: false,
};

const CANONICAL_PATH = "versioning-policy.json";
const CHANGELOG_PATH = "CHANGELOG.md";
const DOCS_PATH = "docs/versioning-policy.md";
const README_SECTION_TITLE = "Versioning and changelog";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Findings in evaluator order, then source order, with exact repeats collapsed. */
const dedupe = (findings) => [...new Set(findings)];

/**
 * The canonical document judged against itself and against the authority in force.
 *
 * Every version decision downstream reads these fields, so a policy that has drifted is not a
 * smaller problem than a version that has — it is the same problem one level up.
 *
 * @param {unknown} policy
 * @returns {string[]}
 */
export function policyIntegrityViolations(policy) {
  if (!isPlainObject(policy)) return [`policy-facts-missing:${describe(policy)}`];
  const findings = [];

  for (const field of REQUIRED_POLICY_FIELDS) {
    if (!Object.hasOwn(policy, field)) findings.push(`policy-field-missing:${field}`);
  }

  for (const [key, pin] of Object.entries(SPECIFICATION_PINS)) {
    const declared = policy.specifications?.[key];
    for (const field of ["name", "version", "url"]) {
      if (declared?.[field] !== pin[field]) {
        findings.push(`policy-specification-drift:specifications.${key}.${field}=${describe(declared?.[field])}`);
      }
    }
  }

  if (policy.developmentStage !== "initial-development") {
    findings.push(`policy-development-stage:${describe(policy.developmentStage)}`);
  }

  // The conceptual milestone and the forbidden version it must never become. Deleting the
  // forbidden entry is refused rather than read as permission: absence fails closed.
  const mapping = policy.conceptualMapping;
  if (!isPlainObject(mapping)) {
    findings.push(`policy-conceptual-mapping-missing:${describe(mapping)}`);
  } else {
    if (typeof mapping.forbiddenPackageVersion !== "string") {
      findings.push(
        `policy-conceptual-mapping-forbidden-version-absent:${describe(mapping.forbiddenPackageVersion)}`,
      );
    }
    if (typeof mapping.packageVersion !== "string") {
      findings.push(`policy-conceptual-mapping-package-version-absent:${describe(mapping.packageVersion)}`);
    } else if (mapping.packageVersion === mapping.forbiddenPackageVersion) {
      findings.push(`policy-conceptual-mapping-forbidden:${mapping.packageVersion}`);
    }
  }

  // The ceiling is anchored to the train's terminus and to the conceptual mapping, so raising it
  // is never a one-field edit. Raising it at all needs a human record that agrees with itself.
  const ceiling = policy.ceiling;
  const train = policy.train;
  if (!isPlainObject(ceiling) || !isPlainObject(train)) {
    findings.push(`policy-ceiling-or-train-missing:${describe(ceiling)}/${describe(train)}`);
  } else {
    if (ceiling.maxVersion !== train.finalVersion) {
      findings.push(`policy-ceiling-detached-from-train:${describe(ceiling.maxVersion)}`);
    }
    if (ceiling.agentAuthorizedMax !== ceiling.maxVersion) {
      findings.push(`policy-agent-cap-above-ceiling:${describe(ceiling.agentAuthorizedMax)}`);
    }
    if (ceiling.raiseRequires !== "explicit-human-decision") {
      findings.push(`policy-ceiling-raise-rule:${describe(ceiling.raiseRequires)}`);
    }
    const record = ceiling.humanDecisionRecord;
    if (record === null || record === undefined) {
      if (isPlainObject(mapping) && ceiling.maxVersion !== mapping.packageVersion) {
        findings.push(
          `policy-ceiling-raised-without-human-decision-record:${describe(ceiling.maxVersion)}`,
        );
      }
    } else if (!isPlainObject(record)) {
      findings.push(`policy-ceiling-human-decision-record-malformed:${describe(record)}`);
    } else {
      for (const field of ["decisionId", "date", "authorizedBy", "newCeiling", "rationale"]) {
        if (typeof record[field] !== "string" || record[field] === "") {
          findings.push(`policy-ceiling-human-decision-record-incomplete:${field}`);
        }
      }
      if (record.newCeiling !== ceiling.maxVersion) {
        findings.push(`policy-ceiling-human-decision-record-disagrees:${describe(record.newCeiling)}`);
      }
    }
    if (!Array.isArray(train.stages) || train.stages.length === 0) {
      findings.push(`policy-train-stages-missing:${describe(train.stages)}`);
    }
    if (train.counterMin !== 1) findings.push(`policy-train-counter-min:${describe(train.counterMin)}`);
    for (const flag of [
      "leadingZeroesAllowed",
      "bareStageAllowed",
      "extraIdentifiersAllowed",
      "buildMetadataAllowed",
      "stageSkipAllowed",
    ]) {
      if (train[flag] !== false) findings.push(`policy-train-relaxed:train.${flag}=${describe(train[flag])}`);
    }
  }

  const current = policy.currentVersion;
  if (!isPlainObject(current)) {
    findings.push(`policy-current-version-missing:${describe(current)}`);
  } else {
    if (typeof current.value !== "string") {
      findings.push(`policy-current-version-value-missing:${describe(current.value)}`);
    }
    if (current.isRelease !== false) findings.push(`policy-current-version-claims-release:${describe(current.isRelease)}`);
    if (current.previousWasRelease !== false) {
      findings.push(`policy-previous-version-claims-release:${describe(current.previousWasRelease)}`);
    }
    if (current.releaseCount !== 0) findings.push(`policy-release-count:${describe(current.releaseCount)}`);
    if (current.firstReleaseExists !== false) {
      findings.push(`policy-first-release-claimed:${describe(current.firstReleaseExists)}`);
    }
  }

  for (const [flag, expected] of Object.entries(EXPECTED_RELEASE)) {
    const actual = policy.release?.[flag];
    if (actual !== expected) {
      findings.push(`policy-authority-overreach:release.${flag}=${describe(actual)} (must stay ${expected})`);
    }
  }
  if (!Array.isArray(policy.release?.knownNonReleaseTags)) {
    findings.push(`policy-known-non-release-tags-missing:${describe(policy.release?.knownNonReleaseTags)}`);
  }

  for (const [flag, expected] of Object.entries(EXPECTED_AUTHORITY)) {
    const actual = policy.authorityBinding?.[flag];
    if (actual !== expected) {
      findings.push(
        `policy-authority-overreach:authorityBinding.${flag}=${describe(actual)} (must stay ${describe(expected)})`,
      );
    }
  }

  for (const [flag, expected] of Object.entries(EXPECTED_AGENT_AUTHORITY)) {
    const actual = policy.agentAuthority?.[flag];
    if (actual !== expected) {
      findings.push(`policy-agent-authority:agentAuthority.${flag}=${describe(actual)} (must stay ${expected})`);
    }
  }

  if (policy.parity?.canonical !== CANONICAL_PATH) {
    findings.push(`policy-parity-canonical:${describe(policy.parity?.canonical)}`);
  }
  if (policy.parity?.direction !== "one-way-canonical-to-projection") {
    findings.push(`policy-parity-direction:${describe(policy.parity?.direction)}`);
  }

  const changelogPolicy = policy.changelog;
  if (!isPlainObject(changelogPolicy)) {
    findings.push(`policy-changelog-section-missing:${describe(changelogPolicy)}`);
  } else {
    if (!Array.isArray(changelogPolicy.categories) || changelogPolicy.categories.length === 0) {
      findings.push(`policy-changelog-categories-missing:${describe(changelogPolicy.categories)}`);
    }
    if (!Array.isArray(changelogPolicy.requiredPreambleTokens)) {
      findings.push(`policy-changelog-preamble-tokens-missing:${describe(changelogPolicy.requiredPreambleTokens)}`);
    }
    if (changelogPolicy.unreleasedCount !== 1) {
      findings.push(`policy-changelog-unreleased-count:${describe(changelogPolicy.unreleasedCount)}`);
    }
    if (changelogPolicy.versionSectionCount !== 0) {
      findings.push(`policy-changelog-version-section-count:${describe(changelogPolicy.versionSectionCount)}`);
    }
    for (const flag of ["linkDefinitionsAllowed", "yankedAllowed", "derivedFromGitLog"]) {
      if (changelogPolicy[flag] !== false) {
        findings.push(`policy-changelog-relaxed:changelog.${flag}=${describe(changelogPolicy[flag])}`);
      }
    }
  }

  if (!Array.isArray(policy.unreleasedProvenance) || policy.unreleasedProvenance.length === 0) {
    findings.push(`policy-provenance-missing:${describe(policy.unreleasedProvenance)}`);
  } else {
    for (const entry of policy.unreleasedProvenance) {
      if (typeof entry?.path !== "string" || entry.path === "") {
        findings.push(`policy-provenance-entry-malformed:${describe(entry)}`);
      } else if (typeof entry?.role !== "string" || entry.role === "") {
        findings.push(`policy-provenance-role-missing:${entry.path}`);
      }
    }
  }

  if (!Array.isArray(policy.nonGoals) || policy.nonGoals.length === 0) {
    findings.push(`policy-non-goals-missing:${describe(policy.nonGoals)}`);
  }

  return findings;
}

// -------------------------------------------------------------------------------------
// The narrow project train
// -------------------------------------------------------------------------------------

/** A leading zero in a numeric position, used only to explain a string the grammar rejected. */
const LEADING_ZERO_HINT = /(?:^|[-.])0\d/;

/**
 * One candidate version judged against the policy. Syntax first, then the train.
 *
 * @param {unknown} version
 * @param {unknown} policy
 * @returns {string[]}
 */
export function policyViolations(version, policy) {
  const findings = policyIntegrityViolations(policy);
  if (findings.length > 0) return dedupe(findings);
  return dedupe(versionAgainstTrain(version, policy));
}

function versionAgainstTrain(version, policy) {
  const findings = [];
  const parsed = parseSemVer(version);
  if (parsed === null) {
    findings.push(`policy-version-refused:${describe(version)}:not-valid-semver-2.0.0`);
    if (typeof version === "string" && LEADING_ZERO_HINT.test(version)) {
      findings.push(`policy-version-refused:${version}:numeric-identifier-leading-zero`);
    }
    return findings;
  }

  const { ceiling, train, currentVersion } = policy;
  const final = parseSemVer(train.finalVersion);

  // 1. The ceiling. Nothing an agent or a checker can reach may rank above it.
  try {
    if (comparePrecedence(version, ceiling.maxVersion) > 0) {
      findings.push(`policy-version-above-ceiling:${version} ranks above the ceiling ${ceiling.maxVersion}`);
    }
  } catch (error) {
    findings.push(`policy-version-uncomparable:${describe(version)}:${error.message}`);
    return findings;
  }

  // 2. The historical planning placeholder is preserved as history and never used going forward.
  if (version === currentVersion.previousValue) {
    findings.push(
      `policy-version-is-historical-planning-placeholder:${version} is the preserved planning ` +
        "placeholder and is not on the train",
    );
  }

  // 3. The train core. Everything on the train shares one version core.
  if (final === null) {
    findings.push(`policy-train-final-version-malformed:${describe(train.finalVersion)}`);
    return findings;
  }
  if (parsed.major !== final.major || parsed.minor !== final.minor || parsed.patch !== final.patch) {
    findings.push(`policy-version-off-train-core:${version} is not on the ${train.finalVersion} train`);
    return findings;
  }

  // 4. The terminus. It is where the train ends, not a value anything may sit at today: reaching
  //    it is a completion decision, and completion authority is false.
  if (parsed.prerelease.length === 0) {
    if (policy.release.authorized !== true || policy.authorityBinding.gapClosed !== true) {
      findings.push(
        `policy-version-terminal-requires-human-completion-decision:${version} is the conceptual ` +
          "terminal version; reaching it needs a fresh explicit human completion and release " +
          "decision, and release authority is false",
      );
    }
    return findings;
  }

  // 5. The shape: <stage>.<N>, and nothing else.
  if (parsed.build.length > 0 && train.buildMetadataAllowed !== true) {
    findings.push(
      `policy-version-build-metadata-refused:${version} carries build metadata, which is ignored ` +
        "for precedence and so destroys the one-current-version property",
    );
  }
  if (parsed.prerelease.length === 1) {
    findings.push(`policy-version-bare-stage-refused:${version} names a bare stage with no counter`);
    return findings;
  }
  if (parsed.prerelease.length > 2) {
    findings.push(`policy-version-extra-identifier-refused:${version} carries more identifiers than <stage>.<N>`);
    return findings;
  }

  const [stage, counter] = parsed.prerelease;
  const stages = train.stages;
  if (typeof stage !== "string" || !stages.includes(stage)) {
    const lowered = typeof stage === "string" ? stage.toLowerCase() : null;
    if (lowered !== null && stages.includes(lowered)) {
      findings.push(`policy-version-stage-wrong-case:${version} spells the stage ${describe(stage)}`);
    } else {
      findings.push(`policy-version-unknown-stage:${version} names the stage ${describe(stage)}`);
    }
    return findings;
  }

  if (typeof counter !== "number") {
    findings.push(`policy-version-counter-not-numeric:${version} has a non-numeric counter ${describe(counter)}`);
    return findings;
  }
  if (counter < train.counterMin) {
    findings.push(`policy-version-counter-below-minimum:${version} counter is under ${train.counterMin}`);
  }

  return findings;
}

/**
 * The move from one version to the next, judged deterministically and forward-only.
 *
 * The permitted set is deliberately tiny: the counter forward by one inside a stage, or the next
 * adjacent stage with the counter reset. Stage skipping is precedence-forward and still refused,
 * because the moment a stage can be skipped silently, "which prereleases actually happened" stops
 * being answerable from the version alone.
 *
 * @returns {string[]}
 */
export function transitionViolations(from, to, policy) {
  const integrity = policyIntegrityViolations(policy);
  if (integrity.length > 0) return dedupe(integrity);

  const findings = [];
  const a = parseSemVer(from);
  const b = parseSemVer(to);
  if (a === null) findings.push(`transition-source-malformed:${describe(from)}`);
  if (b === null) findings.push(`transition-target-malformed:${describe(to)}`);
  if (a === null || b === null) return dedupe(findings);

  for (const finding of versionAgainstTrain(from, policy)) {
    findings.push(`transition-source-refused:${finding}`);
  }
  for (const finding of versionAgainstTrain(to, policy)) {
    findings.push(`transition-target-refused:${finding}`);
  }
  if (findings.length > 0) return dedupe(findings);

  const stages = policy.train.stages;
  const fromStage = stages.indexOf(a.prerelease[0]);
  const toStage = stages.indexOf(b.prerelease[0]);
  const fromCounter = a.prerelease[1];
  const toCounter = b.prerelease[1];

  if (toStage === fromStage) {
    if (toCounter === fromCounter) {
      findings.push(`transition-no-op:${from} -> ${to} leaves the version unchanged`);
    } else if (toCounter < fromCounter) {
      findings.push(`transition-counter-backward:${from} -> ${to} moves the counter backward`);
    } else if (toCounter > fromCounter + 1) {
      findings.push(`transition-counter-jump:${from} -> ${to} jumps the counter`);
    }
    return dedupe(findings);
  }

  if (toStage < fromStage) {
    findings.push(`transition-stage-backward:${from} -> ${to} moves the stage backward`);
    return dedupe(findings);
  }
  if (toStage > fromStage + 1) {
    findings.push(`transition-stage-skip:${from} -> ${to} skips a stage; a human may, an agent may not`);
    return dedupe(findings);
  }
  if (toCounter !== policy.train.counterMin) {
    findings.push(`transition-stage-counter-not-reset:${from} -> ${to} must reset the counter to ${policy.train.counterMin}`);
  }
  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// Keep a Changelog 1.1.0 — strict by construction, not by parser sophistication
//
// This is a format the project fully controls, so canonical column-zero ATX headings are the whole
// grammar. Setext, indented, HTML, blockquoted and list-contained headings are findings rather than
// parsing challenges, which is why this reader is short and why the hardened README parser next
// door is left alone: widening a frozen fence to serve a file that does not need it costs more
// than the twenty lines it would save.
// -------------------------------------------------------------------------------------

const FENCE = /^ {0,3}(?:```|~~~)/;
const ATX_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const INDENTED_HEADING = /^[ \t]+#{1,6}[ \t]+\S/;
const BLOCKQUOTED_HEADING = /^[ \t]*>[ \t]*#{1,6}[ \t]+\S/;
const LIST_HEADING = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+#{1,6}[ \t]+\S/;
const HTML_HEADING = /<h[1-6]\b/i;
const SETEXT_UNDERLINE = /^[ \t]*(?:=+|-{2,})[ \t]*$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/;
const LINK_DEFINITION = /^\[([^\]]+)\]:[ \t]*\S/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const RELEASE_TAG_SHAPE = /\bv\d+\.\d+\.\d+/;
const MERGE_SUBJECT = /\bMerge (?:pull request|branch|remote-tracking)\b/i;
const CONVENTIONAL_COMMIT = /^[ \t]*[-*+][ \t]+[a-z]+(?:\([^)]*\))?!?:[ \t]/;
const HEX_TOKEN = /\b[0-9a-f]{7,40}\b/g;
const URL = /https?:\/\/\S+/g;
const VERSION_TOKEN = /(?<![\w.-])\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\w-])/g;

/** Every version-shaped token in a text, with URLs removed first so a spec link is not a claim. */
function versionTokens(text) {
  return [...text.replace(URL, " ").matchAll(VERSION_TOKEN)].map((match) => match[0]);
}

/** The versions a projection is allowed to name, each in its own expected role. */
function expectedVersionTokens(policy) {
  return new Set(
    [
      policy.currentVersion?.value,
      policy.currentVersion?.previousValue,
      policy.train?.finalVersion,
      policy.ceiling?.maxVersion,
      policy.specifications?.semver?.version,
      policy.specifications?.keepAChangelog?.version,
    ].filter((value) => typeof value === "string"),
  );
}

/**
 * The changelog document, judged against the policy.
 *
 * @param {unknown} markdown
 * @param {unknown} policy
 * @returns {string[]}
 */
export function changelogViolations(markdown, policy) {
  if (!isPlainObject(policy) || !isPlainObject(policy.changelog) || !isPlainObject(policy.currentVersion)) {
    return [`changelog-policy-facts-missing:${describe(policy)}`];
  }
  if (typeof markdown !== "string") {
    return [`changelog-missing-or-unreadable:${describe(markdown)}`];
  }

  const findings = [];
  const changelogPolicy = policy.changelog;
  const categories = changelogPolicy.categories;
  const categoryDepth = changelogPolicy.categoryDepth ?? 3;
  const unreleasedText = "[Unreleased]";

  const lines = markdown.split("\n");
  const outside = [];
  const headings = [];
  let fenced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    if (HTML_HEADING.test(line)) findings.push(`changelog-html-heading:${line.trim()}`);
    if (BLOCKQUOTED_HEADING.test(line)) findings.push(`changelog-blockquoted-heading:${line.trim()}`);
    else if (LIST_HEADING.test(line)) findings.push(`changelog-heading-in-list:${line.trim()}`);
    else if (INDENTED_HEADING.test(line)) findings.push(`changelog-indented-heading:${line.trim()}`);

    const previous = outside.at(-1);
    if (
      SETEXT_UNDERLINE.test(line) &&
      previous !== undefined &&
      previous.trim() !== "" &&
      !LIST_ITEM.test(previous) &&
      !ATX_HEADING.test(previous)
    ) {
      findings.push(`changelog-setext-heading:${previous.trim()} — only column-zero ATX headings are read`);
    }

    const definition = LINK_DEFINITION.exec(line);
    if (definition !== null && changelogPolicy.linkDefinitionsAllowed !== true) {
      findings.push(
        `changelog-link-definition:[${definition[1]}] names a comparison or release target that ` +
          "does not exist",
      );
    }

    const atx = ATX_HEADING.exec(line);
    if (atx !== null) headings.push({ depth: atx[1].length, text: atx[2], at: outside.length });

    outside.push(line);
  }

  const outsideText = outside.join("\n");

  // 1. Exactly one H1, titled by the policy.
  const titles = headings.filter((heading) => heading.depth === 1);
  if (titles.length === 0) findings.push("changelog-title-h1-missing");
  if (titles.length > 1) findings.push(`changelog-duplicate-title-h1:${titles.length}`);
  for (const title of titles) {
    if (title.text !== changelogPolicy.title) {
      findings.push(`changelog-title-text:${describe(title.text)} (expected ${describe(changelogPolicy.title)})`);
    }
  }

  // 2. The preamble states which specifications the document follows (KAC principle 7).
  for (const token of changelogPolicy.requiredPreambleTokens ?? []) {
    if (!outsideText.includes(token)) findings.push(`changelog-preamble-missing-token:${token}`);
  }

  // 3. Exactly one `## [Unreleased]`, and it is the first H2. Every other H2 is a claim that a
  //    release exists, whether it spells one out or only carries a date.
  const sections = headings.filter((heading) => heading.depth === 2);
  const unreleased = sections.filter((heading) => heading.text === unreleasedText);
  if (unreleased.length !== changelogPolicy.unreleasedCount) {
    findings.push(
      unreleased.length === 0
        ? "changelog-unreleased-section-missing"
        : `changelog-duplicate-unreleased-section:${unreleased.length}`,
    );
  }
  if (sections.length > 0 && sections[0].text !== unreleasedText) {
    findings.push(`changelog-unreleased-not-first-h2:${sections[0].text}`);
  }
  for (const section of sections) {
    if (section.text === unreleasedText) continue;
    const versions = versionTokens(section.text);
    if (versions.length > 0) {
      findings.push(`changelog-fabricated-version-section:${versions[0]} — no release exists`);
    } else {
      findings.push(`changelog-unknown-section:${section.text}`);
    }
  }
  for (const heading of headings) {
    const date = ISO_DATE.exec(heading.text);
    if (date !== null) {
      findings.push(`changelog-date-without-release:${date[0]} dates a heading, and no release exists`);
    }
  }

  // 4. Categories: the canonical six, at one depth, unique, in canonical order, never empty.
  const seen = [];
  let lastCanonical = -1;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!categories.includes(heading.text)) {
      if (heading.depth === categoryDepth) findings.push(`changelog-unknown-category:${heading.text}`);
      continue;
    }
    if (heading.depth !== categoryDepth) {
      findings.push(`changelog-category-wrong-depth:${heading.text}:h${heading.depth}`);
      continue;
    }
    if (seen.includes(heading.text)) findings.push(`changelog-duplicate-category:${heading.text}`);
    else seen.push(heading.text);

    const canonical = categories.indexOf(heading.text);
    if (canonical < lastCanonical) findings.push(`changelog-category-out-of-order:${heading.text}`);
    else lastCanonical = canonical;

    // The group's body runs from its own heading line to the next heading of any depth. A group
    // that carries no list item states nothing, and an empty `### Security` in particular reads
    // as "audited, nothing found" — a claim nobody here has made.
    const next = headings[index + 1];
    const body = outside.slice(heading.at + 1, next === undefined ? outside.length : next.at);
    if (!body.some((line) => LIST_ITEM.test(line))) {
      findings.push(
        `changelog-empty-category:${heading.text} — an empty group reads as a claim nobody made`,
      );
    }
  }

  // 5. Yank markers, tag references and release-shaped tags: each presumes a release.
  if (outsideText.includes("[YANKED]") && changelogPolicy.yankedAllowed !== true) {
    findings.push("changelog-yanked-marker — a yank presumes a release existed to withdraw");
  }
  const withoutUrls = outsideText.replace(URL, " ");
  for (const tag of policy.release?.knownNonReleaseTags ?? []) {
    if (withoutUrls.includes(tag)) {
      findings.push(`changelog-tag-reference:${tag} is an activation record, never a release`);
    }
  }
  const releaseTag = RELEASE_TAG_SHAPE.exec(withoutUrls);
  if (releaseTag !== null) {
    findings.push(`changelog-release-tag-reference:${releaseTag[0]} names a release tag that does not exist`);
  }

  // 6. Commit-log derivation. Keep a Changelog names the log dump as the first thing that makes a
  //    changelog bad; here it is also the quickest way to fabricate provenance.
  if (changelogPolicy.derivedFromGitLog !== true) {
    for (const token of withoutUrls.match(HEX_TOKEN) ?? []) {
      if (/\d/.test(token)) findings.push(`changelog-raw-commit-hash:${token}`);
    }
    if (MERGE_SUBJECT.test(withoutUrls)) findings.push("changelog-merge-commit-entry");
    for (const line of outside) {
      if (CONVENTIONAL_COMMIT.test(line)) {
        findings.push(`changelog-conventional-commit-entry:${line.trim()}`);
      }
    }
  }

  // 7. Version tokens, read in context: the two specification versions, the ceiling, the current
  //    value and the preserved placeholder are expected. Anything else is a version this document
  //    has no standing to name.
  const expected = expectedVersionTokens(policy);
  for (const token of versionTokens(outsideText)) {
    if (!expected.has(token)) {
      findings.push(`changelog-unexpected-version-token:${token} is not a version this document may name`);
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// Parity — one direction, always
// -------------------------------------------------------------------------------------

/** Drift is always reported as a projection that moved, never as a canonical file to correct. */
function drift(projection, actual, canonical) {
  return (
    `parity-drift:${projection}: projection reads ${describe(actual)}; the canonical value in ` +
    `${CANONICAL_PATH} is ${describe(canonical)}; restore the projection`
  );
}

/**
 * Every projection judged against the canonical policy.
 *
 * `facts.provenancePresent` is optional: the real-tree reader always supplies it, and an injected
 * fact set may omit it when it is exercising a different rule. Everything else is required, and a
 * missing fact is a finding rather than a silently skipped check.
 *
 * @param {unknown} facts
 * @returns {string[]}
 */
export function parityViolations(facts) {
  if (!isPlainObject(facts)) return [`parity-facts-missing:${describe(facts)}`];

  const integrity = policyIntegrityViolations(facts.policy);
  if (integrity.length > 0) return dedupe(integrity);

  const policy = facts.policy;
  const findings = [];
  const canonical = policy.currentVersion.value;
  const ceiling = policy.ceiling.maxVersion;

  // 1. The recorded predecessor. The planning placeholder is preserved, never rewritten: erasing
  //    it erases the only evidence that the migration happened at all.
  const previous = parseSemVer(policy.currentVersion.previousValue);
  const final = parseSemVer(policy.train.finalVersion);
  if (previous === null || final === null) {
    findings.push(`parity-previous-placeholder-unreadable:${describe(policy.currentVersion.previousValue)}`);
  } else if (
    previous.prerelease.length === 0 ||
    !(previous.major < final.major || (previous.major === final.major && previous.minor < final.minor) ||
      (previous.major === final.major && previous.minor === final.minor && previous.patch < final.patch))
  ) {
    findings.push(
      `parity-previous-placeholder-rewritten:${policy.currentVersion.previousValue} is not the ` +
        "pre-train planning placeholder this policy replaced",
    );
  }

  // 2. package.json — the npm-visible identity.
  if (!isPlainObject(facts.packageJson)) {
    findings.push(`parity-facts-missing:package.json:${describe(facts.packageJson)}`);
  } else {
    if (facts.packageJson.version !== canonical) {
      findings.push(drift("package.json#version", facts.packageJson.version, canonical));
    }
    if (facts.packageJson.private !== true) {
      findings.push(`parity-package.json-not-private:${describe(facts.packageJson.private)}`);
    }
  }

  // 3. CHANGELOG.md — the human document.
  if (typeof facts.changelog !== "string") {
    findings.push(`parity-facts-missing:${CHANGELOG_PATH}:${describe(facts.changelog)}`);
  } else {
    if (!facts.changelog.includes(canonical)) {
      findings.push(drift(CHANGELOG_PATH, "no canonical version token", canonical));
    }
    const expected = expectedVersionTokens(policy);
    for (const token of versionTokens(facts.changelog)) {
      if (!expected.has(token)) findings.push(drift(CHANGELOG_PATH, token, canonical));
    }
  }

  // 4. The README section and the docs projection.
  for (const [label, text] of [
    [`README.md#${README_SECTION_TITLE.toLowerCase().replaceAll(" ", "-")}`, facts.readme],
    [DOCS_PATH, facts.docs],
  ]) {
    if (typeof text !== "string") {
      findings.push(`parity-facts-missing:${label}:${describe(text)}`);
      continue;
    }
    if (!text.includes(canonical)) findings.push(drift(label, "no canonical version token", canonical));
    if (!text.includes(ceiling)) findings.push(drift(label, "no ceiling token", ceiling));
  }

  // 5. Provenance: a path with nothing behind it is the machine-readable form of the commit dump
  //    this package refuses.
  if (facts.provenancePresent !== undefined && facts.provenancePresent !== null) {
    if (!isPlainObject(facts.provenancePresent)) {
      findings.push(`parity-provenance-facts-malformed:${describe(facts.provenancePresent)}`);
    } else {
      for (const entry of policy.unreleasedProvenance) {
        if (facts.provenancePresent[entry.path] !== true) {
          findings.push(`parity-provenance-path-missing:${entry.path}`);
        }
      }
    }
  }

  // 6. Tags. Release authority is false and the release count is zero, so a release-shaped tag is
  //    a claim about the world that no decision supports. The activation tag is named in the
  //    policy precisely so it can never be mistaken for one.
  if (!Array.isArray(facts.tags)) {
    findings.push(`parity-tags-unreadable:${describe(facts.tags)}`);
  } else {
    const known = policy.release.knownNonReleaseTags;
    const prefix = policy.release.releaseTagPrefix ?? "v";
    for (const tag of facts.tags) {
      if (typeof tag !== "string" || known.includes(tag)) continue;
      if (new RegExp(`^${prefix}?\\d+\\.\\d+\\.\\d+`).test(tag)) {
        findings.push(`parity-release-shaped-tag:${tag} — no release exists and no tag is authorized`);
      }
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// The reader: a real tree, turned into facts. The only part that touches a filesystem.
// -------------------------------------------------------------------------------------

function readText(base, relative) {
  try {
    return readFileSync(path.join(base, relative), "utf8");
  } catch {
    return null;
  }
}

function readJson(base, relative) {
  const text = readText(base, relative);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The README's versioning section alone: parity judges the projection, not the whole document. */
function readmeVersioningSection(markdown) {
  if (typeof markdown !== "string") return null;
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^##[ \t]+${README_SECTION_TITLE}[ \t]*$`).test(line));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##[ \t]/.test(line));
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join("\n");
}

/**
 * Local tags, read with a fixed argument vector and no shell.
 *
 * Bounded on purpose: a remote-only tag this clone never fetched is invisible here. That can only
 * under-report, never accuse, and remote tag governance sits outside this repository.
 */
function readTags(base) {
  try {
    return execFileSync("git", ["tag", "-l"], {
      cwd: base,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
  } catch {
    return null;
  }
}

/**
 * Every fact the evaluators need, read once from a real tree.
 *
 * @param {string} rootDirectory
 */
export function readVersioningFacts(rootDirectory) {
  const base = typeof rootDirectory === "string" && rootDirectory !== "" ? rootDirectory : root;
  const policy = readJson(base, CANONICAL_PATH);
  const provenancePresent = {};
  if (isPlainObject(policy) && Array.isArray(policy.unreleasedProvenance)) {
    for (const entry of policy.unreleasedProvenance) {
      if (typeof entry?.path === "string" && entry.path !== "") {
        provenancePresent[entry.path] = existsSync(path.join(base, entry.path));
      }
    }
  }
  return {
    root: base,
    policy,
    packageJson: readJson(base, "package.json"),
    changelog: readText(base, CHANGELOG_PATH),
    readme: readmeVersioningSection(readText(base, "README.md")),
    docs: readText(base, DOCS_PATH),
    tags: readTags(base),
    provenancePresent,
  };
}

/**
 * The whole decision for one tree: the reader composed with the evaluators.
 *
 * @param {string} rootDirectory
 * @returns {string[]}
 */
export function checkVersioning(rootDirectory) {
  const facts = readVersioningFacts(rootDirectory);
  const findings = [...policyViolations(facts.policy?.currentVersion?.value, facts.policy)];
  if (isPlainObject(facts.policy)) {
    findings.push(...changelogViolations(facts.changelog, facts.policy));
  }
  findings.push(...parityViolations(facts));
  return dedupe(findings);
}

/**
 * The permitted next values from a version. A recommendation, and never anything more.
 *
 * The terminus is deliberately absent: reaching it is a completion decision, and no automation
 * here makes one.
 */
export function recommendedNextVersions(version, policy) {
  const parsed = parseSemVer(version);
  if (parsed === null || !isPlainObject(policy) || versionAgainstTrain(version, policy).length > 0) return [];
  const [stage, counter] = parsed.prerelease;
  const stages = policy.train.stages;
  const index = stages.indexOf(stage);
  const core = policy.train.finalVersion;
  const next = [`${core}-${stage}.${counter + 1}`];
  if (index >= 0 && index + 1 < stages.length) {
    next.push(`${core}-${stages[index + 1]}.${policy.train.counterMin}`);
  }
  return next;
}

// -------------------------------------------------------------------------------------
// The command. It reads, it decides, it prints. It never writes and never releases.
// -------------------------------------------------------------------------------------

function main(argv) {
  const target = argv[2] === undefined ? root : path.resolve(argv[2]);
  const findings = checkVersioning(target);

  if (findings.length > 0) {
    for (const finding of findings) console.error(`FINDING ${finding}`);
    console.error(`FAILED kernel-versioning: ${findings.length} finding(s) under ${target}`);
    process.exitCode = 1;
    return;
  }

  const facts = readVersioningFacts(target);
  const policy = facts.policy;
  const categories = (facts.changelog.match(/^###[ \t]+\S/gm) ?? []).length;
  console.log(
    `OK kernel-versioning: version=${policy.currentVersion.value} ` +
      `previous=${policy.currentVersion.previousValue} ceiling=${policy.ceiling.maxVersion} ` +
      `releases=${policy.currentVersion.releaseCount} unreleased=${policy.changelog.unreleasedCount} ` +
      `categories=${categories} releaseTags=0 private=${policy.release.packagePrivate}`,
  );
  const next = recommendedNextVersions(policy.currentVersion.value, policy);
  console.log(
    "RECOMMENDATION (not authorization; a human decides): " +
      `from ${policy.currentVersion.value} the permitted next values are ${next.join(" or ")}. ` +
      "The completion move needs a fresh explicit human decision that no automation makes.",
  );
}

const invokedAsCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) main(process.argv);
