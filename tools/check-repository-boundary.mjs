import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// The repository root topology — stated once, here, and read from here by everything else
//
// The fence used to be one flat list: apps, src, packages, deploy, migrations, absent always.
// Four of those five are unchanged. `src` is not. A root `src` may exist, and `domain` is the
// only first child it may ever hold — `src/application`, `src/adapters`, `src/delivery` and
// `src/sdk` are refused by name, and any first child nobody has classified is refused too.
//
// Three limits are deliberate:
//
//   - An absent root `src` is fully compliant. The narrowing permits a root `src`; it does not
//     require one, and this repository still has none.
//   - Nothing beneath `src/domain` is classified. This is the first-child topology and no more.
//   - Nothing about authority, readiness or activation moves with it.
//
// The rule is split into a pure evaluator over injected facts and a reader that turns a real
// directory into those facts, so the same decision can be tested without a tree and enforced
// against one. Every consumer — this CLI, the control-plane checker, the substrate verifier —
// calls the reader. A second copy of the rule, however careful, is a second thing to drift.
// =====================================================================================

/** Root paths whose absence the narrowing leaves completely untouched. */
export const ROOT_ABSENT_PATHS = ["apps", "packages", "deploy", "migrations"];
/** The one root directory governed by its first children rather than by its absence. */
export const ROOT_SRC_DIRECTORY = "src";
/** The only first child a root `src` may hold. */
export const ROOT_SRC_PERMITTED_CHILDREN = ["domain"];
/** First children refused by name, so a finding says which one was added. */
export const ROOT_SRC_FORBIDDEN_CHILDREN = ["application", "adapters", "delivery", "sdk"];

/**
 * Fold A–Z to a–z and touch nothing else.
 *
 * Deliberately not `toLowerCase()`: that applies full Unicode case mapping, where a few characters
 * fold across scripts or change length, so what counts as a match would depend on characters this
 * fence has no opinion about. Every path this compares is ASCII, so an ASCII-only fold is the whole
 * rule — deterministic, locale-independent, and with no behaviour outside A–Z to reason about.
 */
const asciiLower = (value) =>
  value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/**
 * Decide the root topology from facts alone.
 *
 * `rootChildren` is the first-level entry names at the repository root. `srcChildren` is the
 * first-level entry names inside root `src`, or `null` when there is no readable root `src`.
 *
 * Fail-closed in both directions: facts this function cannot read produce a finding rather than
 * an empty list, because an empty list is an all-clear and an all-clear is the one answer that
 * must never be reachable by accident. A `src` that is listed at the root but whose children are
 * unknown is refused for the same reason — the permitted-child rule cannot be checked at all.
 */
export function rootTopologyViolations(facts) {
  const violations = [];
  if (facts === null || typeof facts !== "object" || !Array.isArray(facts.rootChildren)) {
    return ["root-topology-facts-missing"];
  }

  // The four protected roots are matched without regard to case, because on a case-insensitive
  // filesystem `Apps/` and `apps/` are one directory: an exact comparison would let the fence be
  // walked past by capitalising a letter, and the tree that results is a real root `apps`. The
  // finding always names the canonical lowercase path, so it describes the path that is fenced
  // rather than the spelling that happened to be used. A non-string entry is skipped rather than
  // folded, so malformed facts cannot throw their way out of the check.
  //
  // This applies to these four names only. First children of `src` are matched exactly, which
  // leaves an unexpected case classified as unknown — already the correct answer for them.
  for (const absent of ROOT_ABSENT_PATHS) {
    const present = facts.rootChildren.some(
      (child) => typeof child === "string" && asciiLower(child) === absent,
    );
    if (present) violations.push(`forbidden-root-path-present:${absent}`);
  }

  const { srcChildren } = facts;
  if (srcChildren === null) {
    if (facts.rootChildren.includes(ROOT_SRC_DIRECTORY)) violations.push("root-src-children-unreadable");
    return violations;
  }
  if (!Array.isArray(srcChildren)) {
    violations.push("root-src-children-malformed");
    return violations;
  }

  for (const child of srcChildren) {
    if (ROOT_SRC_PERMITTED_CHILDREN.includes(child)) continue;
    violations.push(
      ROOT_SRC_FORBIDDEN_CHILDREN.includes(child)
        ? `forbidden-root-src-child:${child}`
        : `unknown-root-src-child:${child}`,
    );
  }
  return violations;
}

/**
 * Read a real directory into the facts above.
 *
 * Every failure resolves to facts the evaluator refuses, never to facts it accepts: an unreadable
 * root yields no `rootChildren` at all, and a `src` that cannot be listed as a directory — because
 * it is a file, or because the read failed — yields `srcChildren: null` while `src` still appears
 * at the root, which the evaluator reports as unreadable.
 */
export function readRootTopologyFacts(rootDirectory = root) {
  let rootChildren;
  try {
    rootChildren = readdirSync(rootDirectory).sort();
  } catch {
    return { rootChildren: null, srcChildren: null };
  }

  const srcPath = path.join(rootDirectory, ROOT_SRC_DIRECTORY);
  try {
    if (!statSync(srcPath).isDirectory()) return { rootChildren, srcChildren: null };
    return { rootChildren, srcChildren: readdirSync(srcPath).sort() };
  } catch {
    // An absent root src lands here too, and is compliant: `src` is simply not in rootChildren.
    return { rootChildren, srcChildren: null };
  }
}

/** The rule applied to a real tree. This is what every consumer calls. */
export function checkRootTopology(rootDirectory = root) {
  return rootTopologyViolations(readRootTopologyFacts(rootDirectory));
}

// =====================================================================================
// README current/history contract
//
// This file used to require only that the README contained the strings PLANNING_ONLY,
// VALID_BLOCKED, NO_GO and "Runtime implementation: absent" somewhere. Any occurrence
// satisfied it, so a README that presented those tokens as today's verdict passed — and did,
// long after the verdict changed. The tokens are a verified historical snapshot of the
// immutable repository-status.json asserted below, not the authority in force, so the
// requirement is structural rather than lexical: *where* a token sits, and what else sits
// beside it, decides whether it reads as a live claim or as a dated record.
//
// Ways of dressing a claim up as compliance are refused explicitly, because a checker that
// can be satisfied by wording is not a fence:
//
//   - a nested heading. `### Current status` inside a historical H2 is body text to an
//     H2-only parser, so the historical section could carry a section a reader takes as the
//     current one. Any heading with that title, at any depth, is rejected unless it is the
//     one admissible `## Current status` ATX H2.
//   - a heading the parser does not see. What matters is what renders, so the parser reads
//     ATX headings indented by up to three spaces (four is code, not a heading), Setext `===`
//     and `---` underlines, and titles wearing links, code spans or emphasis. A heading the
//     reader sees and the checker does not is the whole attack.
//   - a contradictory neighbour. `productionAllowed=false` satisfies a substring search even
//     when `productionAllowed=true` sits one line below it, so every boolean dimension must
//     also be checked for the absence of its opposite.
//   - an overclaim somewhere else entirely. A well-formed `## Current status` says nothing
//     about a second section further down announcing `deployAllowed=true`, or claiming in
//     prose that the repository is production-ready.
//
// That last one used to be fenced per section, with historical sections exempt, and it cost
// four review rounds of heading forms — Setext, blockquoted, list-contained, HTML-wrapped,
// wrapper-nested — each one a fresh way to move a claim into the shelter. The exemption was
// the defect, not the parser. A historical section preserves history: PLANNING_ONLY,
// VALID_BLOCKED, NO_GO and wording that *denies* readiness. It has never had a reason to
// assert `deployAllowed=true`, and it does not get one.
//
// So the readiness fence is global. Every stronger-stage flag and every undenied readiness
// term is refused wherever it appears in non-fenced prose, and the heading a claim sits under
// stops mattering — which retires the whole class of attack rather than its current spelling.
// The heading parser survives for two much narrower jobs: finding the one canonical
// `## Current status`, and keeping bootstrap tokens inside history.
//
// The readiness fence is deliberately narrow in the other direction. It is a closed list of
// named flags and named terms, judged per semantic unit, where a denial covers the terms it
// names and nothing else. It is not a prose linter and must not become one.
//
// The validation is a pure function of the README text so every refusal can be exercised
// directly against synthetic input, without writing a file anywhere.
// =====================================================================================

const CURRENT_STATUS_TITLE = "current status";
const CURRENT_STATUS_DEPTH = 2;

/** The verdict and the activation record the current block must name. */
const CURRENT_STATUS_REQUIRED = [
  "GO-KERNEL-DEVELOPMENT-ONLY",
  "kernel-runtime-substrate-s1-activated",
];

/**
 * Every boolean dimension of the contract, with the value in force. The expected token must be
 * present and its opposite must be absent: a block that manages to say both has said nothing.
 */
const CURRENT_STATUS_FLAGS = [
  ["codeStartAllowed", true],
  ["runtimeCodeAllowed", true],
  ["runtimeImplementationStarted", true],
  ["kernelReady", false],
  ["sdkReady", false],
  ["appBuildable", false],
  ["releaseAllowed", false],
  ["deployAllowed", false],
  ["productionAllowed", false],
  ["gapClosed", false],
];

/** Bootstrap-era tokens. Verified history; never the current status. */
const HISTORICAL_ONLY_TOKENS = [
  "PLANNING_ONLY",
  "VALID_BLOCKED",
  "NO_GO",
  "Runtime implementation: absent",
];

/** The three tokens the historical section must still preserve, so history is not erased. */
const HISTORICAL_REQUIRED_TOKENS = ["PLANNING_ONLY", "VALID_BLOCKED", "NO_GO"];

/**
 * The stages nothing has opened. None of these may be asserted true in any live section —
 * not only inside the current block — because a second section claiming one of them is the
 * same overclaim wearing a different heading. `codeStartAllowed`, `runtimeCodeAllowed` and
 * `runtimeImplementationStarted` are absent by design: they are legitimately true.
 */
const STRONGER_STAGE_FLAGS = [
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

/**
 * A closed list of readiness terms. Finite on purpose; this is a fence, not a linter.
 *
 * Every occurrence of one of these is a claim unless its own character span sits inside an
 * explicit negated readiness construction below. Nothing else licenses it — not a negator
 * somewhere earlier in the sentence, not a clause boundary, not punctuation. Chasing negation
 * by conjunction was a losing game: `but` was answered with `so`, and `so` would have been
 * answered with something else. A denial has to cover the words it denies.
 */
const READINESS_TERM =
  "(?:runtime[-\\s]ready|kernel[-\\s]ready|sdk[-\\s]ready|MVP|buildable application" +
  "|releasable|deployable|pilot[-\\s]approved|production[-\\s]read(?:y|iness))";

/** A list entry may carry an article: "an MVP", "a buildable application". */
const READINESS_ITEM = `(?:(?:an?|the)\\s+)?${READINESS_TERM}`;

/** Every readiness term occurrence, with its span. */
const readinessOccurrences = () => new RegExp(`\\b${READINESS_TERM}\\b`, "gi");

/**
 * The only constructions that deny a readiness term, each covering the terms it names:
 *
 *   1. a negator introducing one readiness term or a comma-separated list of them, optionally
 *      closed with `or`/`nor` — the form the current README uses to deny all nine at once, and
 *      equally the form of a plain "not production-ready" or "no production-ready claim";
 *   2. the term-first denial, "production-ready is not claimed".
 *
 * A negation about a gate, an outbox or any other subject matches neither, so it can never
 * cover a readiness occurrence however the sentence is joined.
 */
/**
 * Where a denial list is allowed to stop.
 *
 * A negated list carries its negation across the items it enumerates, and the question is
 * where that stops. Naming the verbs that restart an assertion was a losing game — `is` was
 * answered with `became`, and `became` would have been answered with something else — so the
 * boundary is stated positively instead: a denial may end at a delimiter, at the end of the
 * text, where the list continues with another negated item, or before the noun "claim". It may
 * not end in front of arbitrary prose, because prose after a list is the sentence turning
 * round to assert something.
 *
 * Being a lookahead, this makes the engine backtrack: when the full list cannot end legally,
 * it gives back the trailing item and re-checks. So "not runtime-ready, production-ready
 * became true" ends up denying `runtime-ready` — the comma is a legal end — while leaving
 * `production-ready` uncovered and therefore claimed. No verb is enumerated anywhere.
 */
const DENIAL_BOUNDARY =
  "(?=\\s*(?:[.,;:!?)\\]]|$)" +
  "|\\s+(?:and|or|nor)\\s+(?:not|never|no)\\b" +
  "|\\s+claims?\\b)";

const READINESS_DENIALS = [
  () =>
    new RegExp(
      `\\b(?:not|never|no|nor)\\s+${READINESS_ITEM}` +
        `(?:\\s*,\\s*${READINESS_ITEM})*` +
        `(?:\\s*,?\\s*(?:or|nor)\\s+${READINESS_ITEM})?` +
        DENIAL_BOUNDARY,
      "gi",
    ),
  // The term-first denial, "production-ready is not claimed". The term has to open its clause
  // and the negator has to be one word behind it — which keeps "production-ready but not
  // cheap" out without naming a single verb.
  () =>
    new RegExp(`(?:^|[.;:,]\\s*)${READINESS_ITEM}\\s+\\w+\\s+(?:not|never)\\b`, "gi"),
  // The labelled form the historical record uses:
  // "MVP / buildable application / production readiness: not claimed".
  () =>
    new RegExp(
      `${READINESS_ITEM}(?:\\s*[/,]\\s*${READINESS_ITEM})*\\s*:\\s*(?:not|never)\\b`,
      "gi",
    ),
];

/** `flag=value`, tolerating spaces around the `=` — the rendered claim is the same either way. */
const flagPattern = (flag, value) => new RegExp(`\\b${flag}\\s*=\\s*${value}\\b`);

/** A heading is only a licence to carry those tokens if it names itself as dated and non-effective. */
const HISTORICAL_HEADING_MARKERS = [/historical/i, /non-effective/i, /bootstrap/i];

const isHistoricalHeading = (title) =>
  title !== null && HISTORICAL_HEADING_MARKERS.every((marker) => marker.test(title));

/** A fence opener or closer, itself indentable by up to three spaces. */
const FENCE = /^ {0,3}(```|~~~)/;
/** ATX: up to three spaces of indentation. A fourth space makes it an indented code block. */
const ATX = /^( {0,3})(#{1,6})[ \t]+(.*)$/;
/** A Setext underline: `===` for H1, `---` for H2. */
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
/**
 * A raw HTML heading *start*, anywhere in the line — not anchored, not parsed.
 *
 * Anchoring it was worth three separate bypasses: a tag split across lines (`<h2` then
 * `class="x">Shipping</h2>`), and the same tag wrapped in `<div>` or `<td>`. None of them
 * changes what a reader sees, so none of them may change what the fence sees. The rule is
 * deliberately crude: an `<h1`..`<h6` opening anywhere outside a fence cuts the section, and a
 * split tag cuts at the line its opening appears on. `</h2>` does not match — the `<` is
 * followed by `/` — so a closing tag never opens anything.
 *
 * This is recognition, not HTML parsing. It cannot be fooled by a wrapper because it never
 * looks at wrappers.
 */
const HTML_HEADING_START = /<h([1-6])\b/i;
/** Best-effort title when the tag opens and its text sits on the same line. */
const HTML_HEADING_TEXT = /<h[1-6]\b[^>]*>([^<]+)</i;
/** One layer of container, once leading whitespace is already gone. */
const BLOCKQUOTE_MARKER = /^>[ \t]?/;
const LIST_MARKER_PREFIX = /^(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Reduce a line to whatever it would render as: strip leading whitespace and any depth of
 * blockquote or list markers, alternating until nothing more comes off.
 *
 * Indentation used to stop this. That was the CommonMark rule — four spaces is an indented
 * code block — and it was the wrong rule for a fence whose job is what a reader sees. It cost
 * a run of residuals: a heading under a nested list, under a blockquoted list, and an indented
 * Setext, each one indented past the threshold and each one still a visible section boundary.
 * Indentation is not a fence. A code example belongs in a fence, and inside one this is never
 * reached.
 *
 * Unbounded with guaranteed progress: every iteration must consume at least one character.
 * Recognition, not a Markdown parser — the caller learns only what came off, never structure.
 */
function reduceLine(line) {
  let rest = line;
  let container = null;
  let indented = false;

  for (;;) {
    const trimmed = rest.replace(/^[ \t]+/, "");
    if (trimmed !== rest) {
      indented = true;
      rest = trimmed;
    }
    const marker = BLOCKQUOTE_MARKER.exec(rest) ?? LIST_MARKER_PREFIX.exec(rest);
    if (marker === null || marker[0].length === 0) break;
    container ??= marker[0].includes(">") ? "blockquoted" : "list-contained";
    rest = rest.slice(marker[0].length);
  }

  return { rest, container, indented };
}

/** How a finding names the heading it refuses. */
const describeHeading = (heading) =>
  heading.form === "Setext"
    ? `a Setext H${heading.depth} heading (${heading.display})`
    : `a depth-${heading.depth} ${heading.form} heading (${heading.display})`;

/**
 * Normalize a heading so a title is recognised however it is decorated: a closing `#`
 * sequence, a link wrapper, a code span, emphasis. `### [Current status](#x)` renders as the
 * same heading a reader acts on, so it must normalize to the same title.
 */
function normalizeHeadingTitle(raw) {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/!?\[([^\]]*)\]/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Recognise a heading on one line, in any of the forms a reader sees rendered: ATX (indented
 * up to three spaces), ATX inside a blockquote or a list item, and a raw HTML `<h1>`..`<h6>`.
 * Setext is handled separately because it needs the following line.
 */
function readLineHeading(line) {
  // The canonical form, and the only one the current-status rule will accept: a top-level ATX
  // heading, indented no more than three spaces, inside nothing.
  const atx = ATX.exec(line);
  if (atx && atx[3].trim() !== "") {
    return { depth: atx[2].length, form: "ATX", raw: atx[3] };
  }

  const html = HTML_HEADING_START.exec(line);
  if (html) {
    const text = HTML_HEADING_TEXT.exec(line);
    return {
      depth: Number(html[1]),
      form: "HTML",
      raw: text ? text[1] : line.trim(),
      // The line may carry more than the tag — a wrapper, or a claim sitting beside it — so it
      // stays in the body of the section it opens rather than being consumed.
      keepLine: true,
    };
  }

  // Anything that becomes an ATX heading once indentation and containers come off is still a
  // heading a reader sees — but it is a noncanonical form, and noncanonical forms may open and
  // cut a section without ever satisfying the one-canonical-heading rule.
  const { rest, container, indented } = reduceLine(line);
  if (container === null && !indented) return null;

  const reduced = ATX.exec(rest);
  if (reduced && reduced[3].trim() !== "") {
    return {
      depth: reduced[2].length,
      form: container ?? "indented ATX",
      raw: reduced[3],
    };
  }

  return null;
}

/**
 * Collect every rendered heading — ATX at any depth, indented or not, contained in a
 * blockquote or list item, written as raw HTML, or underlined Setext — and split the document
 * into one segment per heading.
 *
 * Fenced blocks are skipped: a shell comment at the start of a line inside ``` is not a
 * heading, and treating it as one would move real text into the wrong segment. The same
 * applies to every container form — a fenced `> ## Shipping` is a code sample, not a section.
 *
 * **Every heading opens a segment, at every depth and in every form.** The readiness fence no
 * longer depends on this — it is global — so what remains here is narrower: locating the one
 * canonical `## Current status`, and keeping bootstrap tokens inside history. A heading the
 * reader sees is still a heading, and a Setext underline is still recognised through whatever
 * container prefixes both of its lines carry.
 */
function parseReadme(markdown) {
  const lines = markdown.split("\n");
  const headings = [];
  const segments = [{ title: null, label: "the text before the first heading", lines: [] }];
  let fenced = false;

  const openSegment = (heading) =>
    segments.push({
      title: heading.title,
      label:
        heading.form === "ATX"
          ? `\`${"#".repeat(heading.depth)} ${heading.display}\``
          : `the ${heading.form} H${heading.depth} heading "${heading.display}"`,
      lines: [],
    });

  const record = (found) => {
    const heading = {
      depth: found.depth,
      form: found.form,
      title: normalizeHeadingTitle(found.raw),
      display: found.raw.trim(),
    };
    headings.push(heading);
    openSegment(heading);
    return heading;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (FENCE.test(line)) {
      fenced = !fenced;
      segments.at(-1).lines.push(line);
      continue;
    }
    if (fenced) {
      segments.at(-1).lines.push(line);
      continue;
    }

    const found = readLineHeading(line);
    if (found) {
      record(found);
      if (found.keepLine) segments.at(-1).lines.push(line);
      continue;
    }

    // A Setext underline is recognised through whatever indentation and containers its two
    // lines carry: `> Shipping` / `> ---`, `- Shipping` / `  ---`, `    Current status` /
    // `    ---`. Both lines are reduced the same way, so indentation cannot hide the boundary
    // any more than it can hide an ATX one.
    //
    // The one thing still refused is a container text line under a bare column-zero rule:
    // `- foo` followed by `---` is a thematic break ending the list, not a heading.
    const underline = lines[index + 1];
    if (line.trim() !== "" && underline !== undefined && !FENCE.test(underline)) {
      const text = reduceLine(line);
      const rule = reduceLine(underline);
      const textIsHeadingLike =
        text.rest.trim() !== "" && !SETEXT_UNDERLINE.test(text.rest);
      const prefixAgrees =
        text.container === null || rule.container !== null || /^\s/.test(underline);

      if (textIsHeadingLike && SETEXT_UNDERLINE.test(rule.rest) && prefixAgrees) {
        const containerForm = text.container ?? (text.indented ? "indented" : null);
        record({
          depth: rule.rest.trim().startsWith("=") ? 1 : 2,
          form: containerForm === null ? "Setext" : `${containerForm} Setext`,
          raw: text.rest,
        });
        index += 1; // the underline belongs to the heading, not to the new segment's body
        continue;
      }
    }

    segments.at(-1).lines.push(line);
  }

  return {
    headings,
    segments: segments.map(({ title, label, lines: body }) => ({
      title,
      label,
      body: body.join("\n"),
    })),
  };
}

/** The start of a list item: a bullet or an ordered marker, indentable by up to three spaces. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;

/** Split flattened text into sentences. A semicolon joins independent clauses, so it counts. */
const sentences = (text) =>
  text
    .split(/(?<=[.!?;])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

/**
 * The readiness terms asserted in one piece of text: every occurrence whose own span is not
 * covered by a denial construction. A denial that cannot end legally before an occurrence
 * never reaches it, so a reasserted term is simply an uncovered one — there is no separate
 * reassertion rule and no list of verbs to keep up to date. Duplicates collapse to one
 * finding.
 */
function undeniedReadinessTerms(text) {
  const covered = [];
  for (const build of READINESS_DENIALS) {
    const denial = build();
    for (let match = denial.exec(text); match !== null; match = denial.exec(text)) {
      covered.push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) denial.lastIndex += 1;
    }
  }

  const asserted = new Set();
  const occurrence = readinessOccurrences();
  for (let match = occurrence.exec(text); match !== null; match = occurrence.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    const denied = covered.some(([from, to]) => from <= start && end <= to);
    if (!denied) asserted.add(match[0].toLowerCase());
  }
  return [...asserted];
}

/**
 * The semantic units of a segment: the pieces a reader would judge on their own. Fenced blocks
 * are dropped, each list item becomes its own unit with its continuation lines folded in, and
 * free text is split into sentences.
 *
 * The unit is the scope of a denial, and that is the whole point of the granularity. A
 * paragraph-sized unit let one leading "Nothing here is production-ready." licence a second
 * bullet, or a second sentence, that claimed the opposite. A denial now covers the sentence or
 * the bullet it appears in and nothing further along.
 */
function semanticUnits(body) {
  const units = [];
  let block = [];
  let fenced = false;

  const flush = () => {
    if (block.length === 0) return;
    const chunks = [];
    for (const line of block) {
      if (LIST_MARKER.test(line)) chunks.push([line.replace(LIST_MARKER, "")]);
      else if (chunks.length > 0) chunks.at(-1).push(line.trim());
      else chunks.push([line.trim()]);
    }
    for (const chunk of chunks) {
      const text = chunk.join(" ").replace(/\s+/g, " ").trim();
      if (text !== "") units.push(...sentences(text));
    }
    block = [];
  };

  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      flush();
      continue;
    }
    if (fenced) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    block.push(line);
  }
  flush();
  return units;
}

/**
 * The whole README contract, as a list of findings. Empty means compliant.
 *
 * @param {string} markdown the README text
 * @returns {string[]} every violation, so one run reports the whole picture
 */
export function readmeContractViolations(markdown) {
  const { headings, segments } = parseReadme(markdown);
  const violations = [];

  // 1. Exactly one rendered heading in the document claims to be the current status, and it is
  //    the canonical ATX H2. Anything else with that title — deeper, indented, Setext,
  //    link-wrapped — reads as current to a human, so it is refused whatever the parser
  //    would otherwise have made of it.
  const currentHeadings = headings.filter((heading) => heading.title === CURRENT_STATUS_TITLE);
  for (const heading of currentHeadings) {
    if (heading.depth !== CURRENT_STATUS_DEPTH || heading.form !== "ATX") {
      violations.push(
        `${describeHeading(heading)} is titled "${CURRENT_STATUS_TITLE}"; only the single ` +
          "canonical `## Current status` ATX H2 may carry that title",
      );
    }
  }
  if (currentHeadings.length !== 1) {
    violations.push(
      `README must have exactly one \`## Current status\` heading, found ${currentHeadings.length}`,
    );
  }

  const currentSegments = segments.filter((segment) => segment.title === CURRENT_STATUS_TITLE);
  if (currentSegments.length !== 1) {
    violations.push(
      `README must have exactly one \`## Current status\` H2 section, found ${currentSegments.length}`,
    );
  } else {
    const currentBlock = currentSegments[0].body;

    // 2. The current block names the current verdict and the activation record.
    for (const token of CURRENT_STATUS_REQUIRED) {
      if (!currentBlock.includes(token)) {
        violations.push(`\`## Current status\` must state ${token}`);
      }
    }

    // 3. Every boolean dimension is stated, and its opposite is nowhere in the same block.
    for (const [flag, value] of CURRENT_STATUS_FLAGS) {
      const expected = `${flag}=${value}`;
      const contradiction = `${flag}=${!value}`;
      if (!flagPattern(flag, value).test(currentBlock)) {
        violations.push(`\`## Current status\` must state ${expected}`);
      }
      if (flagPattern(flag, !value).test(currentBlock)) {
        violations.push(
          `\`## Current status\` contradicts itself: it carries ${contradiction} beside ${expected}`,
        );
      }
    }

    // 4. ...and it states nothing bootstrap-era, which would read as the verdict in force.
    for (const token of HISTORICAL_ONLY_TOKENS) {
      if (currentBlock.includes(token)) {
        violations.push(
          `\`## Current status\` presents the historical token ${JSON.stringify(token)} as current status`,
        );
      }
    }
  }

  // 5. A clearly named historical, non-effective bootstrap section exists elsewhere and still
  //    carries the preserved tokens: reframing history is allowed, deleting it is not.
  const historicalSegments = segments.filter(
    (segment) => isHistoricalHeading(segment.title) && segment.title !== CURRENT_STATUS_TITLE,
  );
  if (historicalSegments.length === 0) {
    violations.push(
      "README must name a historical, non-effective bootstrap H2 section " +
        "(its heading must match all of: historical, non-effective, bootstrap)",
    );
  } else {
    for (const token of HISTORICAL_REQUIRED_TOKENS) {
      const carrier = historicalSegments.find((segment) => segment.body.includes(token));
      if (!carrier) {
        violations.push(
          `the historical, non-effective bootstrap section must preserve ${token} as dated history`,
        );
      }
    }
  }

  // 6. No bootstrap-era token may sit anywhere else in the README — not in the preamble, not in
  //    a section that does not declare itself historical. Placement is the whole contract.
  for (const token of HISTORICAL_ONLY_TOKENS) {
    for (const segment of segments) {
      if (!segment.body.includes(token) || isHistoricalHeading(segment.title)) continue;
      violations.push(
        `${segment.label} carries the historical token ${JSON.stringify(token)} outside a historical, non-effective section`,
      );
    }
  }

  // 7. No part of the README may open a stage nothing has opened.
  //
  //    This is global, and that is the whole point of it. Section-scoped, with history exempt,
  //    it was defeated five times over by moving the claim under a heading the parser spelled
  //    differently — Setext, blockquoted, list-contained, HTML-wrapped, wrapper-nested. There
  //    is no section of this repository's README that has business asserting a closed stage, so
  //    no section is asked. History keeps its record and its denials; it gets no licence to
  //    claim. Fenced blocks stay out, because a code sample is not a claim.
  const quote = (unit) =>
    JSON.stringify(unit.length > 120 ? `${unit.slice(0, 117)}...` : unit);

  for (const unit of semanticUnits(markdown)) {
    for (const flag of STRONGER_STAGE_FLAGS) {
      if (flagPattern(flag, true).test(unit)) {
        violations.push(
          `README asserts ${flag}=true; that stage is closed and stays false: ${quote(unit)}`,
        );
      }
    }

    // Each readiness term is judged where it stands: denied only if a denial construction
    // covers its own span. A negation about some other subject covers nothing, so no
    // conjunction, connector or punctuation can carry a claim past this.
    for (const term of undeniedReadinessTerms(unit)) {
      violations.push(
        `README claims the repository is ${term} without denying it: ${quote(unit)}`,
      );
    }
  }

  return violations;
}

/**
 * The command. Every check it ran before it had a name, it still runs, in the same order, with
 * the same output and the same exit behaviour.
 *
 * It lives behind a main guard so that importing `readmeContractViolations` — which the test
 * suite does, once, at load — neither reads the repository nor prints a line nor asserts
 * anything about the checkout it happens to be in. A contract helper should be a function.
 */
async function main() {
  const status = JSON.parse(
    await readFile(path.join(root, "repository-status.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const readme = await readFile(path.join(root, "README.md"), "utf8");

  assert.equal(status.repository, "metaframer-net/metaframer-kernel");
  assert.equal(status.visibility, "PRIVATE");
  assert.equal(status.classification, "PLANNING_ONLY");
  assert.deepEqual(status.adminOverride.scope, [
    "CREATE_REPOSITORY",
    "PUSH_PLANNING_BOOTSTRAP",
  ]);
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
  assert.equal(status.sourceTopology.futureOwner, "metaframer-net/metaframer-kernel");
  assert.equal(status.sourceTopology.activatesAfter, "all-canonical-KGA-decisions-closed");
  assert.equal(status.sourceTopology.currentImplementationWorkspace, "platform monorepo");
  assert.equal(status.sourceTopology.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
  assert.equal(status.sourceTopology.sourceExtraction, false);
  assert.equal(packageJson.private, true);

  const violations = readmeContractViolations(readme);
  assert.ok(
    violations.length === 0,
    `README current/history contract violated:\n  - ${violations.join("\n  - ")}`,
  );

  // apps, packages, deploy and root migrations stay absent because they are outside the target
  // areas of the currently authorized package, and SDK, app-core, app and module remain excluded
  // targets that no verdict so far has opened. Root `src` is no longer one of them: it is
  // constrained to `src/domain` only, and this repository still has no root `src` at all.
  //
  // The decision comes from the shared reader above, not from a second list kept down here. The
  // CLI and the exported contract cannot disagree if there is only one of them.
  const topologyViolations = checkRootTopology(root);
  assert.ok(
    topologyViolations.length === 0,
    `repository root topology violated:\n  - ${topologyViolations.join("\n  - ")}`,
  );

  // The repository-status.json and runtime-path checks above are unchanged; only their reporting
  // is labelled. These tokens are a verified historical snapshot, not the verdict in force — the
  // current one is printed last by tools/compose-current-effective.mjs.
  console.log(
    "HISTORICAL SNAPSHOT (verified, non-effective; not the current verdict): " +
      "repository boundary: PLANNING_ONLY / VALID_BLOCKED / NO_GO still byte-exact in the immutable " +
      "repository-status.json; README carries them only under its named historical/non-effective " +
      "bootstrap section, and its `## Current status` block is separately asserted to hold " +
      "GO-KERNEL-DEVELOPMENT-ONLY with every stronger flag false and no contradicting token.",
  );
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) await main();
