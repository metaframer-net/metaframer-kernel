import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("repository status stays fail-closed until the runtime decision gate is complete", async () => {
  const status = JSON.parse(
    await readFile(path.join(root, "repository-status.json"), "utf8"),
  );

  assert.equal(status.repository, "metaframer-net/metaframer-kernel");
  assert.equal(status.classification, "PLANNING_ONLY");
  assert.equal(status.runtime.status, "VALID_BLOCKED");
  assert.equal(status.runtime.releaseDecision, "NO_GO");
  assert.equal(status.runtime.implemented, false);
  assert.equal(status.runtime.mvp, false);
  assert.equal(status.runtime.productionReady, false);
  assert.equal(status.decisionGate.requiredClosedDecisions, 10);
  assert.equal(status.decisionGate.state, "INCOMPLETE");
  assert.equal(status.sourceTopology.state, "APPROVED_CONDITIONAL");
  assert.equal(
    status.sourceTopology.standaloneKernelSource,
    "CONDITIONALLY_SELECTED_AFTER_CANONICAL_GATE",
  );
  assert.equal(status.sourceTopology.activatesAfter, "all-canonical-KGA-decisions-closed");
  assert.equal(status.sourceTopology.currentImplementationWorkspace, "platform monorepo");
  assert.equal(status.sourceTopology.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
  assert.equal(status.sourceTopology.sourceExtraction, false);
});

// `src` is deliberately not in this list any more. It is the one root path whose absence is no
// longer the rule — see the root first-child topology section at the end of this file, which
// states what the narrowed rule actually is and separately asserts the compliant root `src/domain`
// and `src/application` this checkout now materializes.
test("planning bootstrap contains no runtime source tree", async () => {
  for (const runtimePath of ["apps", "packages", "deploy", "migrations"]) {
    assert.equal(
      await exists(runtimePath),
      false,
      `${runtimePath} must not exist in the planning-only bootstrap`,
    );
  }
});

// =====================================================================================
// README current/history contract — the persisted regression matrix
//
// Eight review rounds each found a way to present a live claim as compliant, each was fixed,
// and each fix was proven only by probes that vanished with the session. This file is where
// that evidence stops being disposable. Every payload below is one that leaked at some point,
// or one a reviewer named as the next place to try.
//
// The matrix is table-driven on purpose: adding the next attack is adding a row, not writing a
// test, so there is no reason to skip it.
//
// The invariant the rows encode: a historical section preserves history — PLANNING_ONLY,
// VALID_BLOCKED, NO_GO and wording that *denies* readiness. It licenses nothing positive. No
// heading, container, wrapper or spelling of a heading may move a live claim into its shelter,
// because the claim is refused wherever it stands.
// =====================================================================================

const checkerRelative = "tools/check-repository-boundary.mjs";
const checkerUrl = pathToFileURL(path.join(root, checkerRelative)).href;
const boundary = await import(checkerUrl);
const { readmeContractViolations } = boundary;
const README = await readFile(path.join(root, "README.md"), "utf8");

/** The four live claims every heading attack tries to shelter. */
const CLAIMS = [
  "productionAllowed=true",
  "deployAllowed=true",
  "kernelReady=true",
  "This repository is production-ready.",
].join("\n");

/** Each of those claims must be named in its own finding. Never a bare "not empty". */
const CLAIM_FINDINGS = [
  /productionAllowed=true/,
  /deployAllowed=true/,
  /kernelReady=true/,
  /production-ready/,
];

const HISTORY_H2 = "## Historical non-effective bootstrap extra";
const BOOTSTRAP_TOKENS = "PLANNING_ONLY VALID_BLOCKED NO_GO";

/** The claims parked under a historical H2, optionally behind a heading of some form. */
const underHistory = (heading) =>
  `${README}\n${HISTORY_H2}\n${heading === null ? "" : `${heading}\n`}${CLAIMS}\n`;

/** The same payload sealed in a fence, where it is a code sample and must be ignored. */
const fenced = (heading) =>
  `${README}\n${HISTORY_H2}\n\n\`\`\`html\n${heading === null ? "" : `${heading}\n`}${CLAIMS}\n\`\`\`\n`;

/** A heading that duplicates the current-status title, followed by preserved history. */
const duplicateTitle = (heading) => `${README}\n${HISTORY_H2}\n${heading}\n${BOOTSTRAP_TOKENS}\n`;

/** An ordinary live section. */
const live = (body) => `${README}\n## Release readiness\n\n${body}\n`;

function findingsFor(markdown) {
  return readmeContractViolations(markdown);
}

function expectFindings(markdown, patterns, label) {
  const found = findingsFor(markdown);
  const rendered = found.map((finding) => `  - ${finding}`).join("\n") || "  (none)";
  assert.ok(found.length > 0, `${label}: expected findings, got none`);
  for (const pattern of patterns) {
    assert.ok(
      found.some((finding) => pattern.test(finding)),
      `${label}: no finding matched ${pattern}\n${rendered}`,
    );
  }
}

function expectClean(markdown, label) {
  const found = findingsFor(markdown);
  assert.deepEqual(found, [], `${label}: expected no findings, got:\n${found.join("\n")}`);
}

// -------------------------------------------------------------------------------------
// A. The core case. No nested heading at all: the claims sit directly under a historical
//    H2. History licenses preserved bootstrap tokens and denials — never a live claim.
// -------------------------------------------------------------------------------------

test("live claims directly under a historical H2 are never licensed by history", () => {
  expectFindings(underHistory(null), CLAIM_FINDINGS, "claims directly under history");
});

// -------------------------------------------------------------------------------------
// B + C. Every heading spelling a reviewer has reached for, each sheltering the same
//        claims. The heading form must not matter to the outcome.
// -------------------------------------------------------------------------------------

const HEADING_FORMS = [
  ["blockquoted ATX", "> ## Shipping"],
  ["nested blockquote ATX", ">> ## Shipping"],
  ["blockquote + list ATX", "> - ## Shipping"],
  ["four-layer blockquote ATX", "> > > > ## Shipping"],
  ["list ATX", "- ## Shipping"],
  ["ordered list ATX", "1. ## Shipping"],
  ["four-space list-continuation ATX", "- item\n    ## Shipping"],
  ["plain ATX H1", "# Shipping"],
  ["plain ATX H3", "### Shipping"],
  ["three-space ATX H2", "   ## Shipping"],
  ["blockquoted Setext", "> Shipping\n> ---"],
  ["list Setext", "- Shipping\n  ---"],
  ["ordered Setext", "1. Shipping\n   ---"],
  ["deep container Setext", "> > > > Shipping\n> > > > ---"],
  ["plain Setext H2", "Shipping\n--------"],
  ["plain Setext H1", "Shipping\n========"],
  ["inline HTML h2", "<h2>Shipping</h2>"],
  ["HTML multiline body", "<h2>\nShipping\n</h2>"],
  ["split raw opener", '<h2\nclass="x">Shipping</h2>'],
  ["div wrapper", "<div><h2>Shipping</h2></div>"],
  ["td wrapper", "<td><h2>Shipping</h2></td>"],
  ["blockquoted div wrapper", "> <div><h2>Shipping</h2></div>"],
  ["section wrapper h3", "<section><h3>Shipping</h3></section>"],
  ["uppercase HTML tag", "<H2>Shipping</H2>"],
  ["HTML with attributes", '<h2 id="ship" class="x">Shipping</h2>'],
  ["raw HTML h1", "<h1>Shipping</h1>"],
  ["raw HTML h4", "<h4>Shipping</h4>"],
  ["raw HTML h6", "<h6>Shipping</h6>"],
  ["bare split opener alone", "<h4"],
];

for (const [name, heading] of HEADING_FORMS) {
  test(`heading form does not shelter live claims: ${name}`, () => {
    expectFindings(underHistory(heading), CLAIM_FINDINGS, name);
  });
}

// -------------------------------------------------------------------------------------
// F. The same payloads inside a fence are code samples. Every one must stay clean.
// -------------------------------------------------------------------------------------

for (const [name, heading] of HEADING_FORMS) {
  test(`fenced control stays clean: ${name}`, () => {
    expectClean(fenced(heading), `fenced ${name}`);
  });
}

test("fenced control stays clean: claims with no heading", () => {
  expectClean(fenced(null), "fenced bare claims");
});

// -------------------------------------------------------------------------------------
// B. A second heading that reads as the current status, however it is spelled. Only the
//    one canonical `## Current status` ATX H2 may carry that title.
// -------------------------------------------------------------------------------------

const DUPLICATE_TITLE_FORMS = [
  ["plain ATX H3", "### Current status"],
  ["three-space ATX H3", "   ### Current status"],
  ["link-decorated ATX H3", "### [Current status](#x)"],
  ["emphasis-decorated ATX H4", "#### **Current status**"],
  ["code-decorated ATX H3", "### `Current status`"],
  ["four-layer blockquote ATX", "> > > > ## Current status"],
  ["four-space list-continuation ATX", "- item\n    ## Current status"],
  ["blockquoted Setext", "> Current status\n> ---"],
  ["list Setext", "- Current status\n  ---"],
  ["ordered Setext", "1. Current status\n   ---"],
  ["deep container Setext", "> > > > Current status\n> > > > ---"],
  ["plain Setext H2", "Current status\n--------------"],
  ["plain Setext H1", "Current status\n=============="],
  ["inline HTML h2", "<h2>Current status</h2>"],
  ["div-wrapped HTML h2", "<div><h2>Current status</h2></div>"],
];

for (const [name, heading] of DUPLICATE_TITLE_FORMS) {
  test(`a second current-status heading is refused: ${name}`, () => {
    expectFindings(
      duplicateTitle(heading),
      [/current status/i],
      `duplicate current status via ${name}`,
    );
  });
}

for (const [name, heading] of DUPLICATE_TITLE_FORMS) {
  test(`fenced duplicate current-status heading stays clean: ${name}`, () => {
    expectClean(
      `${README}\n${HISTORY_H2}\n\n\`\`\`md\n${heading}\n${BOOTSTRAP_TOKENS}\n\`\`\`\n`,
      `fenced duplicate ${name}`,
    );
  });
}

test("the canonical current-status H2 is admitted at every legal ATX indent", () => {
  for (const indent of ["", " ", "  ", "   "]) {
    const doc = `${README}\n${HISTORY_H2}\n${indent}## Current status\n${BOOTSTRAP_TOKENS}\n`;
    expectFindings(doc, [/exactly one/], `duplicate at indent ${JSON.stringify(indent)}`);
  }
});

// -------------------------------------------------------------------------------------
// D. Every stronger-stage flag, one at a time, in an ordinary live section.
// -------------------------------------------------------------------------------------

const STRONGER_FLAGS = [
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

for (const flag of STRONGER_FLAGS) {
  test(`a live section may not assert ${flag}=true`, () => {
    expectFindings(live(`${flag}=true`), [new RegExp(`${flag}=true`)], flag);
  });

  test(`a historical section may not assert ${flag}=true either`, () => {
    expectFindings(
      `${README}\n${HISTORY_H2}\n\n${flag}=true\n`,
      [new RegExp(`${flag}=true`)],
      `${flag} under history`,
    );
  });

  test(`spacing around = does not hide ${flag}=true`, () => {
    expectFindings(live(`${flag} = true`), [new RegExp(`${flag}=true`)], `${flag} spaced`);
  });
}

test("the current block may not carry a flag and its opposite", () => {
  const doc = README.replace(
    "- `productionAllowed=false`",
    "- `productionAllowed=false`\n- `productionAllowed=true`",
  );
  expectFindings(doc, [/contradicts itself/, /productionAllowed=true/], "contradiction");
});

// -------------------------------------------------------------------------------------
// Loose list continuation. A top-level list item stays open across blank lines and across
// continuation text, and a heading indented to its content column renders inside the item.
// The whitespace in these payloads is the payload: shifting one space changes what renders.
// -------------------------------------------------------------------------------------

const LOOSE_LIST_PAYLOADS = [
  [
    "top-level four-space ATX",
    ["    ## Current status", "    PLANNING_ONLY VALID_BLOCKED NO_GO"].join("\n"),
  ],
  [
    "nested list residual",
    [
      "- outer",
      "  - inner",
      "      text",
      "        ## Current status",
      "        PLANNING_ONLY VALID_BLOCKED NO_GO",
    ].join("\n"),
  ],
  [
    "blockquoted list continuation",
    [
      "> - note",
      ">   text",
      ">     ## Current status",
      ">     PLANNING_ONLY VALID_BLOCKED NO_GO",
    ].join("\n"),
  ],
  [
    "four-space indented Setext",
    ["    Current status", "    ---", "    PLANNING_ONLY VALID_BLOCKED NO_GO"].join("\n"),
  ],
  [
    "ordinary continuation",
    ["- note", "  text", "    ## Current status", "    PLANNING_ONLY VALID_BLOCKED NO_GO"].join("\n"),
  ],
  [
    "blank-line continuation",
    [
      "- note",
      "",
      "  text",
      "",
      "    ## Current status",
      "",
      "    PLANNING_ONLY VALID_BLOCKED NO_GO",
    ].join("\n"),
  ],
  [
    "fully nested labelled decision line",
    [
      "- note",
      "  text",
      "    ## Current status",
      "    Classification: PLANNING_ONLY / Runtime: VALID_BLOCKED / Release decision: NO_GO",
    ].join("\n"),
  ],
];

for (const [name, payload] of LOOSE_LIST_PAYLOADS) {
  test(`an indented current-status heading is refused: ${name}`, () => {
    expectFindings(
      `${README}\n${HISTORY_H2}\n${payload}\n`,
      [/exactly one .*Current status/i, /PLANNING_ONLY/, /VALID_BLOCKED/, /NO_GO/],
      `indented heading: ${name}`,
    );
  });

  // Indentation is not a fence. A code example belongs in a fence, and there it is ignored.
  test(`the same payload inside a fence is ignored: ${name}`, () => {
    expectClean(
      `${README}\n${HISTORY_H2}\n\n\`\`\`md\n${payload}\n\`\`\`\n`,
      `fenced indented heading: ${name}`,
    );
  });
}

// -------------------------------------------------------------------------------------
// Reassertion after a denial. A comma-separated denial list carries its negation across the
// terms it enumerates — but not past the point where the sentence turns and asserts one of
// them again. "not runtime-ready, production-ready is achieved today" denies the first and
// claims the second.
// -------------------------------------------------------------------------------------

// The verb doing the reasserting is not the point and must not be enumerated. What ends a
// denial is structural: the denial list runs to a delimiter, another negated item, the noun
// "claim", or the end — and anything else after it is the sentence turning around.
const REASSERTED_CLAIMS = [
  ["became-true reassertion", "This repository is not runtime-ready, production-ready became true."],
  ["achieved-today reassertion", "This repository is not runtime-ready, production-ready achieved today."],
  ["is-achieved reassertion", "This repository is not runtime-ready, production-ready is achieved today."],
  ["now-true reassertion", "It is not releasable, deployable, or production-ready is now true."],
];

for (const [name, body] of REASSERTED_CLAIMS) {
  test(`a readiness term reasserted after a denial is refused: ${name}`, () => {
    expectFindings(live(body), [/production-ready/], `reassertion: ${name}`);
  });
}

// -------------------------------------------------------------------------------------
// E. Term-specific negation. A denial covers the terms it names and nothing else.
// -------------------------------------------------------------------------------------

const UNDENIED_CLAIMS = [
  ["contrast but", "This repository is not runtime-ready but it is production-ready.", /production-ready/],
  ["unrelated closed gate", "A separate gate is closed, but this repository is production-ready.", /production-ready/],
  ["so-connector", "No gate is open so this repository is production-ready.", /production-ready/],
  ["outbox-specific denial", "The outbox is not claimed, and this repository is production-ready.", /production-ready/],
  ["therefore-connector", "No gate is open therefore this repository is deployable.", /deployable/],
  ["bullet isolation", "- Nothing here is closed.\n- This repository is production-ready.", /production-ready/],
  ["sentence isolation", "The gate is shut. This repository is production-ready.", /production-ready/],
  ["semicolon isolation", "Nothing is releasable; this repository is production-ready.", /production-ready/],
  ["broad word: closed", "The gate is closed and this repository is production-ready.", /production-ready/],
  ["broad word: false", "The flag is false and this repository is releasable.", /releasable/],
  ["broad word: absent", "Evidence is absent and this repository is deployable.", /deployable/],
  ["broad word: blocked", "Runtime is blocked and the kernel is SDK-ready.", /sdk-ready/i],
  ["denial of a different term", "This repository is not releasable and it is production-ready.", /production-ready/],
];

for (const [name, body, pattern] of UNDENIED_CLAIMS) {
  test(`an undenied readiness claim is refused: ${name}`, () => {
    expectFindings(live(body), [pattern], name);
  });
}

const DENIED_CLAIMS = [
  ["simple not", "This repository is not production-ready."],
  ["simple never", "This repository is never production-ready."],
  ["simple no", "There is no production-ready claim here."],
  ["term-first denial", "production-ready is not claimed."],
  ["repeated simple denials", "This repository is not production-ready, not releasable and not deployable."],
  ["nor-closed list", "It is not releasable, deployable, nor production-ready."],
  [
    "the exact current multi-term denial",
    "It is not a readiness claim: this repository is not runtime-ready, kernel-ready, " +
      "SDK-ready, an MVP, a buildable application, releasable, deployable, pilot-approved, " +
      "or production-ready, and nothing here may be read as such a claim.",
  ],
];

for (const [name, body] of DENIED_CLAIMS) {
  test(`a denied readiness claim is allowed: ${name}`, () => {
    expectClean(live(body), name);
  });
}

test("the activation-base explanation is allowed", () => {
  expectClean(
    `${README}\n## Overlay note\n\nThe overlay embeds runtimeImplementationStarted=false as ` +
      "pre-activation evidence, and it is not a readiness claim.\n",
    "activation base",
  );
});

test("historical sections may still deny readiness in words", () => {
  expectClean(
    `${README}\n${HISTORY_H2}\n\nMVP / buildable application / production readiness: not claimed\n`,
    "historical denial",
  );
});

// -------------------------------------------------------------------------------------
// Bootstrap-token placement stays where it was: history keeps its record, live text may
// not present it as the verdict in force.
// -------------------------------------------------------------------------------------

test("bootstrap tokens outside a historical section are refused", () => {
  expectFindings(
    `${README}\n## Shipping notes\n\n${BOOTSTRAP_TOKENS}\n`,
    [/PLANNING_ONLY/, /VALID_BLOCKED/, /NO_GO/],
    "tokens in a live section",
  );
});

test("bootstrap tokens inside a historical section are preserved", () => {
  expectClean(`${README}\n${HISTORY_H2}\n\n${BOOTSTRAP_TOKENS}\n`, "tokens under history");
});

test("the current block may not present bootstrap tokens as current status", () => {
  const doc = README.replace(
    "- `gapClosed=false`",
    "- `gapClosed=false`\n- Classification: PLANNING_ONLY",
  );
  expectFindings(doc, [/PLANNING_ONLY/], "tokens in the current block");
});

// -------------------------------------------------------------------------------------
// Indentation is not a fence, and the real README is the thing all of this exists to
// protect.
//
// This row used to assert the opposite — that a four-space indented heading is an indented
// code block and therefore clean. That is what CommonMark renders, but it is the wrong rule
// for this fence: a reader skimming the file sees a heading, and "it was indented" is not a
// reason to let a second Current status through. A code example belongs in a fence, where it
// is still ignored. The paired fenced controls above prove that half.
// -------------------------------------------------------------------------------------

test("an indented heading is not excused as code", () => {
  expectFindings(
    `${README}\n${HISTORY_H2}\n\n    ### Current status\n\n${BOOTSTRAP_TOKENS}\n`,
    [/exactly one .*Current status/i, /PLANNING_ONLY/, /VALID_BLOCKED/, /NO_GO/],
    "indented heading is not code",
  );
});

// History may record that a claim was *denied*, never restate the claim itself. "It was once
// called production-ready" reads as an assertion wherever it sits, and a reader skimming a
// historical section is exactly who it would mislead.
test("historical prose may not restate a positive readiness claim", () => {
  expectFindings(
    `${README}\n${HISTORY_H2}\n\nIt was once called production-ready, but that is not the case now.\n`,
    [/production-ready/],
    "positive readiness wording under history",
  );
});

test("historical prose may record that readiness was denied", () => {
  expectClean(
    `${README}\n${HISTORY_H2}\n\nThat bootstrap was not production-ready, not releasable and not deployable.\n`,
    "negative readiness wording under history",
  );
});

test("the real README satisfies the contract", () => {
  expectClean(README, "the real README");
});

// -------------------------------------------------------------------------------------
// G. Importing the contract helper must be free of side effects: no output, and none of
//    the CLI's repository assertions. The CLI keeps them; the module does not run them.
// -------------------------------------------------------------------------------------

test("importing the contract helper produces no output and runs no CLI assertion", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(checkerUrl)});\n` +
        "if (typeof m.readmeContractViolations !== 'function') process.exit(3);\n",
    ],
    { encoding: "utf8", cwd: root },
  );

  assert.equal(result.status, 0, `import failed: ${result.stderr}`);
  assert.equal(
    result.stdout,
    "",
    `importing the module wrote to stdout:\n${result.stdout}`,
  );
  assert.equal(
    result.stderr,
    "",
    `importing the module wrote to stderr:\n${result.stderr}`,
  );
});

test("the checker CLI still runs its assertions and reports the historical snapshot", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "tools/check-repository-boundary.mjs")],
    { encoding: "utf8", cwd: root },
  );

  assert.equal(result.status, 0, `the CLI must pass on the real repository: ${result.stderr}`);
  assert.match(result.stdout, /HISTORICAL SNAPSHOT/);
  assert.match(result.stdout, /repository boundary/);
});

// =====================================================================================
// P-M1-00/P-M1-02 — the root first-child topology
//
// The old fence was one flat list — apps, src, packages, deploy, migrations, absent always. Four
// of those five are unchanged. `src` is not: a root `src` may exist, and it may hold exactly the
// two inner onion rings, `domain` and `application`, in that order. `adapters`, `delivery` and
// `sdk` stay refused by name — they are the outer rings, and opening them is a separate decision
// no package has taken. An absent root `src` stays fully compliant — opening a door is not walking
// through it — and the kernel now walks through it exactly twice: P-M1-01 materialized `src/domain`
// and P-M1-02 materializes `src/application`. What each ring may hold is a closed manifest named
// below, so a ring grows only by a package that says which module it added and why.
// Nothing beneath either ring is classified here, and no authority or readiness state moves: a
// materialized source package is a source file, not a readiness claim.
//
// Why `application` moves from the forbidden list to the permitted one rather than being tolerated
// as an unknown: the onion says Application is a ring, so it is a name this fence has classified.
// Leaving it unclassified would mean the fence refuses it for the one reason that is untrue — that
// nobody knows what it is.
//
// Rows are injected facts, so the matrix states the rule rather than describing this tree; the
// reader rows prove a real directory reaches the same verdict. An unclassified first child fails
// closed and names itself, because a name nobody classified is where guessing costs most.
// =====================================================================================

const {
  ROOT_ABSENT_PATHS, ROOT_SRC_PERMITTED_CHILDREN, ROOT_SRC_FORBIDDEN_CHILDREN,
  rootTopologyViolations, checkRootTopology,
} = boundary;

const ABSENT_ROOTS = ["apps", "packages", "deploy", "migrations"];
/**
 * Onion order, innermost first, plus the boundary-only `sdk` slot. `domain` and `application`
 * are materialized rings; `sdk` is a permitted-but-not-yet-materialized boundary opened by
 * `planning/gj01-src-sdk-boundary-authority.json` for a future, separately authorized generation
 * package. None of the three is required to exist.
 */
const SRC_PERMITTED = ["domain", "application", "sdk"];
/** The two rings this package does not open. Opening either is a separate decision. */
const SRC_FORBIDDEN = ["adapters", "delivery"];
/** The one name this package moves across the line, named once so both attacks can cite it. */
const MOVED_CHILD = "sdk";
/**
 * Rings actually materialized as real directories in this checkout. `sdk` joins `domain` and
 * `application` once the separately authorized generated-SDK generation package
 * (`planning/gj01-generated-sdk-generation.json`) writes its first artifact — the boundary this
 * package opened is walked through, not merely kept open.
 */
const MATERIALIZED_RINGS = ["domain", "application", "sdk"];
/**
 * The closed per-ring module manifest: which flat modules each materialized ring may hold.
 *
 * A first child of `src` is classified by the root topology rule; what lives *inside* a ring is
 * not, so it is closed here instead. The list is exhaustive in both directions — a listed module
 * that is missing is a finding, and an unlisted third file is a finding — because "which module
 * owns this" stops being answerable from the tree the moment a ring can grow without saying so.
 * P-M1-01 entered `identity-primitives.mjs`, P-M1-02 entered `action-primitives.mjs`, and P-M1-03
 * enters `use-case.mjs` beside it. The generated-SDK generation package enters
 * `create-customer.mjs` as the first `src/sdk` module.
 */
const RING_MODULE_MANIFEST = [
  ["domain", ["identity-primitives.mjs"]],
  ["application", ["action-primitives.mjs", "authorization-evaluator.mjs", "clock.mjs", "create-customer-pipeline.mjs", "identity.mjs", "policy-decision-point.mjs", "policy-decision.mjs", "policy.mjs", "unit-of-work.mjs", "use-case.mjs"]],
  ["sdk", ["create-customer.mjs"]],
];
const sortedNames = (values) => [...(values ?? [])].sort();
const refuseChild = (child) => [`forbidden-root-src-child:${child}`];
const refuseRoot = (name) => [`forbidden-root-path-present:${name}`];

// A protected root spelled with a different case is the same directory. On the case-insensitive
// filesystems this repository is developed on, `Apps/` and `apps/` are one directory, so a fence
// that compares names exactly can be walked straight past by capitalising a single letter — and
// the tree that results is a real root `apps`, not a near-miss. The finding must still name the
// canonical lowercase path, because that is the path the fence is about; reporting `Apps` would
// make the finding depend on how the offender spelled it.
//
// This is about the four protected roots only. A first child of `src` in an unexpected case is
// already refused as unclassified, which is the correct answer for it.
const CASE_VARIANT_ROOTS = ABSENT_ROOTS.map((name) => [
  `${name[0].toUpperCase()}${name.slice(1)}`,
  name,
]);

/** `srcChildren`: null means root src is absent; an array means it holds exactly those children. */
const facts = (srcChildren, extraRoots = []) => ({
  rootChildren: ["db", "tools", ...(srcChildren === null ? [] : ["src"]), ...extraRoots],
  srcChildren,
});

/** [label, injected facts, findings that must be present — `[]` means the row must be clean]. */
const TOPOLOGY_ROWS = [
  ["absent root src", facts(null), []],
  ["empty root src", facts([]), []],
  ["root src holding only domain", facts(["domain"]), []],
  ["root src holding only application", facts(["application"]), []],
  // Permitted is not required, and no permitted child depends on another being present for the
  // first-child rule to answer. `sdk` is a boundary opened by this package, not a materialized
  // ring — it is permitted exactly like domain and application, and never required to exist.
  ["root src holding only sdk", facts([MOVED_CHILD]), []],
  ["root src holding all three permitted children in onion order", facts(SRC_PERMITTED), []],
  ["root src holding all three permitted children in listing order", facts(sortedNames(SRC_PERMITTED)), []],
  ...SRC_FORBIDDEN.map((c) => [`src/${c} beside domain`, facts(["domain", c]), refuseChild(c)]),
  ...SRC_FORBIDDEN.map((c) => [`src/${c} beside sdk`, facts([MOVED_CHILD, c]), refuseChild(c)]),
  ["every forbidden sibling at once", facts(SRC_FORBIDDEN), SRC_FORBIDDEN.flatMap(refuseChild)],
  ["an unknown first child", facts(["infra"]), ["unknown-root-src-child:infra"]],
  ["domain beside an unknown child", facts(["domain", "infra"]), ["unknown-root-src-child:infra"]],
  ["sdk beside an unknown child", facts([MOVED_CHILD, "infra"]), ["unknown-root-src-child:infra"]],
  // Case is not folded for src children, so a differently-spelled ring stays unclassified rather
  // than quietly admitted. That is the same answer the narrowing gave before application moved.
  ["a cased application is unclassified", facts(["Application"]), ["unknown-root-src-child:Application"]],
  ...ABSENT_ROOTS.map((p) => [`root ${p} beside a compliant src`, facts(["domain"], [p]), refuseRoot(p)]),
  // Malformed facts fail closed: answering "no findings" to input it cannot read would be an
  // all-clear, which is worse than having no evaluator at all.
  ["absent facts", undefined, ["root-topology-facts-missing"]],
  ["src facts omitted", { rootChildren: ["db"] }, ["root-src-children-malformed"]],
  ["src listed but unread", { rootChildren: ["db", "src"], srcChildren: null }, ["root-src-children-unreadable"]],
  ...CASE_VARIANT_ROOTS.map(([variant, canonical]) => [
    `root ${variant} is root ${canonical}`, facts(["domain"], [variant]), refuseRoot(canonical),
  ]),
];

/** [label, scratch layout, findings that must be present — `[]` means the row must be clean]. */
const READER_ROWS = [
  ["no root src", { db: "dir" }, []],
  ["empty root src", { src: "dir" }, []],
  // Depth stays unclassified: whatever sits under either ring changes nothing here.
  ["src/domain with nested content", { "src/domain/order/order.ts": "file" }, []],
  ["src/application with nested content", { "src/application/use-case/place.ts": "file" }, []],
  ["src/application beside domain", { "src/domain": "dir", "src/application": "dir" }, []],
  // `sdk` is a permitted boundary opened by this package, not a materialized ring — an empty
  // scratch `src/sdk` is clean, exactly like an empty `src/domain` or `src/application` would be.
  ["src/sdk beside domain", { "src/domain": "dir", "src/sdk": "dir" }, []],
  ["src/sdk beside both materialized rings", { "src/domain": "dir", "src/application": "dir", "src/sdk": "dir" }, []],
  ["src/adapters beside both rings", { "src/domain": "dir", "src/application": "dir", "src/adapters": "dir" }, refuseChild("adapters")],
  ["src/delivery beside both rings", { "src/domain": "dir", "src/application": "dir", "src/delivery": "dir" }, refuseChild("delivery")],
  ["an unknown first child", { "src/domain": "dir", "src/infra": "dir" }, ["unknown-root-src-child:infra"]],
  ["root apps", { apps: "dir" }, refuseRoot("apps")],
  ["root migrations", { migrations: "dir" }, refuseRoot("migrations")],
  ...CASE_VARIANT_ROOTS.map(([variant, canonical]) => [
    `root ${variant} is root ${canonical}`, { [variant]: "dir" }, refuseRoot(canonical),
  ]),
];

/** A scratch tree outside this checkout, removed by the calling test's own after hook. */
function scratchTree(t, layout) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kernel-root-topology-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [relative, kind] of Object.entries(layout)) {
    const full = path.join(dir, relative);
    mkdirSync(kind === "dir" ? full : path.dirname(full), { recursive: true });
    if (kind !== "dir") writeFileSync(full, "");
  }
  return dir;
}

function assertRow(found, expected, label) {
  const seen = JSON.stringify(found);
  if (expected.length === 0) return assert.deepEqual(found, [], `${label}: expected no findings, got ${seen}`);
  for (const one of expected) assert.ok(found.includes(one), `${label}: expected ${one}, got ${seen}`);
  // Neither permitted ring may ever appear in a finding, whatever else the row is about. A rule
  // that blamed a permitted name while correctly refusing a forbidden one beside it would read as
  // enforcement and would in fact be the fence closing on the ring it was opened for.
  for (const permitted of SRC_PERMITTED) {
    assert.ok(
      !found.some((f) => f.endsWith(`:${permitted}`)),
      `${label}: ${permitted} is a permitted first child and must never be blamed, got ${seen}`,
    );
  }
}

test("the checker names the boundary-opened root topology, and drops the flat five-path fence", async () => {
  assert.deepEqual(sortedNames(ROOT_ABSENT_PATHS), sortedNames(ABSENT_ROOTS), `${checkerRelative} must export ROOT_ABSENT_PATHS holding the four paths whose absence is unchanged`);
  assert.ok(!(ROOT_ABSENT_PATHS ?? []).includes("src"), "root src is no longer absent-by-fence: its permitted first child governs it instead");
  assert.deepEqual(sortedNames(ROOT_SRC_PERMITTED_CHILDREN), sortedNames(SRC_PERMITTED), `${checkerRelative} must export ROOT_SRC_PERMITTED_CHILDREN naming exactly domain, application and the sdk boundary`);
  assert.deepEqual(sortedNames(ROOT_SRC_FORBIDDEN_CHILDREN), sortedNames(SRC_FORBIDDEN), `${checkerRelative} must export ROOT_SRC_FORBIDDEN_CHILDREN naming each still-refused outer ring`);
  // The two attacks on this package's one move, stated separately from the list comparison above
  // so a failure says which direction the fence drifted rather than only that it drifted.
  assert.ok(
    (ROOT_SRC_PERMITTED_CHILDREN ?? []).includes(MOVED_CHILD),
    `${MOVED_CHILD} was dropped from ROOT_SRC_PERMITTED_CHILDREN: the sdk boundary is permitted, and a fence that forgets it refuses the boundary this package exists to open`,
  );
  assert.ok(
    !(ROOT_SRC_FORBIDDEN_CHILDREN ?? []).includes(MOVED_CHILD),
    `${MOVED_CHILD} was re-added to ROOT_SRC_FORBIDDEN_CHILDREN: it may not be permitted and refused at once, and the refusal is the half that wins`,
  );
  // Stated order: the two materialized rings first, innermost first, then the sdk boundary this
  // package opens. It is not decorative: the list is the one place the dependency direction and
  // the boundary-vs-materialized distinction are written down as data rather than as prose.
  assert.deepEqual([...(ROOT_SRC_PERMITTED_CHILDREN ?? [])], SRC_PERMITTED, "ROOT_SRC_PERMITTED_CHILDREN must be stated as domain, application, sdk in that order");
  const source = await readFile(path.join(root, checkerRelative), "utf8");
  assert.ok(!source.includes('["apps", "src", "packages", "deploy", "migrations"]'), "the CLI still carries the pre-narrowing five-path literal, so it and the constants would disagree about whether a root src is permitted");
  assert.ok(!source.includes('["domain", "application"]'), "the checker still carries the pre-boundary-authority permitted-children literal, so it would refuse src/sdk by name");
  assert.match(source, /src\/sdk/, "the checker must name src/sdk as a permitted (boundary, not materialized) first child, beside src/domain and src/application");
});

test("the narrowed root topology is decided from injected facts", () => {
  assert.equal(typeof rootTopologyViolations, "function", `${checkerRelative} must export rootTopologyViolations({ rootChildren, srcChildren }) — the narrowed root first-child topology is not expressed as a pure evaluator yet`);
  for (const [label, given, expected] of TOPOLOGY_ROWS) assertRow(rootTopologyViolations(given), expected, label);
});

test("a real tree reaches the same verdict, and this checkout materializes domain, application and sdk", (t) => {
  assert.equal(typeof checkRootTopology, "function", `${checkerRelative} must export checkRootTopology(rootDirectory) — nothing reads a real tree into the narrowed root first-child facts yet`);
  for (const [label, layout, expected] of READER_ROWS) assertRow(checkRootTopology(scratchTree(t, layout)), expected, `scratch: ${label}`);
  // The narrowing permitted a root src; P-M1-01 created `domain`, P-M1-02 created `application`,
  // and the separately authorized generated-SDK generation package now materializes `sdk` with its
  // first artifact — the boundary this package opened is walked through, not merely kept open.
  const src = path.join(root, "src");
  assert.ok(existsSync(src) && statSync(src).isDirectory(), "this checkout must carry a real root src directory");
  assert.deepEqual(readdirSync(src).sort(), sortedNames(MATERIALIZED_RINGS), "domain, application and sdk must be the only first children materialized in root src");
  for (const [ring, manifest] of RING_MODULE_MANIFEST) {
    const dir = path.join(src, ring);
    assert.ok(existsSync(dir) && statSync(dir).isDirectory(), `src/${ring} must exist as a real directory`);
    for (const moduleName of manifest) {
      const modulePath = path.join(dir, moduleName);
      assert.ok(existsSync(modulePath) && statSync(modulePath).isFile(), `src/${ring} must hold ${moduleName} as a file`);
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      assert.ok(entry.isFile() && entry.name.endsWith(".mjs"), `src/${ring} may hold only flat .mjs modules, found ${entry.name}`);
    }
    // The manifest is closed, so an unlisted third file is refused here — the first-child topology
    // classifies nothing at this depth, and a ring that could grow silently is a ring where "which
    // module owns this" is answered by convention rather than by the tree.
    assert.deepEqual(
      entries.map((e) => e.name).sort(), sortedNames(manifest),
      `src/${ring} must hold exactly ${manifest.join(", ")} and nothing beside them`,
    );
  }
  // The four protected roots are untouched by the materialization.
  for (const absent of ABSENT_ROOTS) assert.equal(existsSync(path.join(root, absent)), false, `${absent} must stay absent`);
  assertRow(checkRootTopology(root), [], "the real checkout");
});
