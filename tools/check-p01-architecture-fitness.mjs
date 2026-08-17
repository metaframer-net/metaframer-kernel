import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// P01-PKG10 — deterministic Onion import-direction fitness gate; layer order comes only from the canonical architectureContract.onion.layers.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_CONTRACT_PATH = path.join(root, "planning", "kernel-runtime-pilot-consumer-sync.json");
const SOURCE_ROOT = path.join(root, "src");

// Validates and indexes the canonical onion layer contract; fails closed on anything malformed.
export function parseCanonicalLayers(architectureContract) {
  const layers = architectureContract?.onion?.layers;
  if (!Array.isArray(layers) || layers.length === 0) return { ok: false, reason: "canonical-layer-contract-invalid: layers missing or empty" };
  const layerOrder = new Map();
  const orders = [];
  for (const layer of layers) {
    const valid =
      layer !== null && typeof layer === "object" && typeof layer.name === "string" &&
      layer.name.trim() !== "" && Number.isInteger(layer.order);
    if (!valid) return { ok: false, reason: "canonical-layer-contract-invalid: malformed layer entry" };
    const key = layer.name.toLowerCase();
    if (layerOrder.has(key)) return { ok: false, reason: `canonical-layer-contract-invalid: duplicate layer ${key}` };
    layerOrder.set(key, layer.order);
    orders.push(layer.order);
  }
  const sorted = orders.slice().sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) return { ok: false, reason: "canonical-layer-contract-invalid: layer order is not a contiguous 1..N sequence" };
  }
  return { ok: true, layerOrder };
}

// Recursive-descent lexer marking inert spans (comment/string/template text) true in `mask`; a match
// counts as real code only when unmarked. scanCode/scanTemplate mutually recurse so a `${...}`
// interpolation is lexed as nested code while anything nested inside it is re-lexed, not blindly
// unmasked. terminator "}" stops at (and consumes) the interpolation's matching close brace.
function scanCode(text, i, mask, terminator) {
  const n = text.length; let depth = 0;
  while (i < n) {
    const ch = text[i], next = text[i + 1];
    if (ch === "/" && next === "/") { while (i < n && text[i] !== "\n") { mask[i] = true; i += 1; } continue; }
    if (ch === "/" && next === "*") {
      mask[i] = true; mask[i + 1] = true; i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { mask[i] = true; i += 1; }
      if (i < n) { mask[i] = true; mask[i + 1] = true; i += 2; } continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch; mask[i] = true; i += 1;
      while (i < n && text[i] !== quote) { mask[i] = true; if (text[i] === "\\" && i + 1 < n) { i += 1; mask[i] = true; } i += 1; }
      if (i < n) { mask[i] = true; i += 1; } continue;
    }
    if (ch === "`") { mask[i] = true; i = scanTemplate(text, i + 1, mask); continue; }
    if (terminator === "}" && ch === "{") { depth += 1; i += 1; continue; }
    if (terminator === "}" && ch === "}") { if (depth === 0) return i + 1; depth -= 1; i += 1; continue; }
    i += 1;
  }
  return i;
}

// Scans a template body (just past the opening backtick): text is inert; each `${` hands off to
// scanCode as live nested code, resuming just past the matching `}`.
function scanTemplate(text, i, mask) {
  const n = text.length;
  while (i < n) {
    if (text[i] === "`") { mask[i] = true; return i + 1; }
    mask[i] = true;
    if (text[i] === "\\" && i + 1 < n) { i += 1; mask[i] = true; }
    else if (text[i] === "$" && text[i + 1] === "{") { mask[i + 1] = true; i = scanCode(text, i + 2, mask, "}"); continue; }
    i += 1;
  } return i;
}

const codeMask = (text) => { const mask = new Array(text.length).fill(false); scanCode(text, 0, mask, null); return mask; };

const STATIC_FROM_RE =
  /\bimport\s+(?:[\w$]+\s*,?\s*)?(?:\*\s+as\s+[\w$]+|\{[^{}]*\})?\s*from\s+(["'])([^"']+)\1/g;
const SIDE_EFFECT_RE = /\bimport\s+(["'])([^"']+)\1/g;
const EXPORT_FROM_RE = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^{}]*\})\s+from\s+(["'])([^"']+)\1/g;
const DYNAMIC_RE = /\bimport\s*\(\s*([^)]*?)\s*\)/g;
const LITERAL_ARG_RE = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1$/;

// Extracts every local (`.`-relative) import specifier; bare/builtin specifiers are ignored; non-literal dynamic import fails closed.
export function extractLocalImportSpecifiers(text) {
  const mask = codeMask(text);
  const isCode = (index) => mask[index] === false;
  const specifiers = new Set();
  for (const match of text.matchAll(DYNAMIC_RE)) {
    if (!isCode(match.index)) continue;
    const literal = LITERAL_ARG_RE.exec(match[1].trim());
    if (!literal) return { ok: false, reason: "non-literal-dynamic-import" };
    if (literal[2].startsWith(".")) specifiers.add(literal[2]);
  }
  for (const re of [STATIC_FROM_RE, EXPORT_FROM_RE, SIDE_EFFECT_RE]) {
    for (const match of text.matchAll(re)) {
      if (isCode(match.index) && match[2].startsWith(".")) specifiers.add(match[2]);
    }
  }
  return { ok: true, specifiers: [...specifiers] };
}

// Resolves a local specifier relative to the importer's position under the source root; refuses to escape it.
export function resolveLocalImportTarget(sourceRelPath, specifier) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(sourceRelPath), specifier));
  if (joined === ".." || joined.startsWith("../")) return { ok: false, reason: `escapes-source-root:${specifier}` };
  return { ok: true, relPath: joined };
}

const ringNameOf = (relPath) => relPath.split("/")[0]?.toLowerCase() ?? "";

// Pure evaluator. facts.files is [{ relPath, text }], text: null for an unreadable source.
// Deterministic, sorted findings; empty means GREEN.
export function evaluateArchitectureFitness(facts) {
  const parsed = parseCanonicalLayers(facts.canonicalLayerContract);
  if (!parsed.ok) return { ok: false, findings: [parsed.reason] };
  const { layerOrder } = parsed;
  const knownFiles = new Set(facts.files.map((file) => file.relPath));
  const findings = [];

  for (const file of facts.files) {
    if (file.text === null) { findings.push(`unreadable-source:${file.relPath}`); continue; }
    const sourceOrder = layerOrder.get(ringNameOf(file.relPath));
    if (sourceOrder === undefined) { findings.push(`unknown-ring:${file.relPath}`); continue; }

    const extracted = extractLocalImportSpecifiers(file.text);
    if (!extracted.ok) { findings.push(`${extracted.reason}:${file.relPath}`); continue; }

    for (const specifier of extracted.specifiers) {
      const resolved = resolveLocalImportTarget(file.relPath, specifier);
      if (!resolved.ok) { findings.push(`${resolved.reason}:${file.relPath}`); continue; }
      if (!knownFiles.has(resolved.relPath)) {
        findings.push(`missing-import-target:${file.relPath}->${resolved.relPath}`);
        continue;
      }
      const targetOrder = layerOrder.get(ringNameOf(resolved.relPath));
      if (targetOrder === undefined) { findings.push(`unknown-ring:${resolved.relPath}`); continue; }
      if (targetOrder > sourceOrder) {
        findings.push(`outward-import:${file.relPath}(ring ${sourceOrder})->${resolved.relPath}(ring ${targetOrder})`);
      }
    }
  }
  findings.sort();
  return { ok: true, findings };
}

// Recursively collects every .mjs file under sourceRoot as { relPath, text }. lstat-checked (never follows a
// symlink, including sourceRoot itself before realpath traversal); a symlink, read failure, or absent root records text: null (fail-closed).
export function readSourceFacts(sourceRoot) {
  let rootLstat, realSourceRoot;
  try { rootLstat = lstatSync(sourceRoot); } catch { return [{ relPath: ".", text: null }]; }
  if (rootLstat.isSymbolicLink()) return [{ relPath: ".", text: null }];
  try { realSourceRoot = realpathSync(sourceRoot); } catch { return [{ relPath: ".", text: null }]; }
  const files = [];
  const walk = (absoluteDir, relDir) => {
    let entries;
    try { entries = readdirSync(absoluteDir).sort(); }
    catch { files.push({ relPath: relDir || ".", text: null }); return; }

    for (const entry of entries) {
      const absoluteEntry = path.join(absoluteDir, entry);
      const relEntry = relDir ? `${relDir}/${entry}` : entry;
      let lst;
      try { lst = lstatSync(absoluteEntry); } catch { files.push({ relPath: relEntry, text: null }); continue; }
      if (lst.isSymbolicLink()) { files.push({ relPath: relEntry, text: null }); continue; }
      if (lst.isDirectory()) { walk(absoluteEntry, relEntry); continue; }
      if (!entry.endsWith(".mjs")) continue;

      try { files.push({ relPath: relEntry, text: readFileSync(absoluteEntry, "utf8") }); }
      catch { files.push({ relPath: relEntry, text: null }); }
    }
  };
  walk(realSourceRoot, "");
  return files;
}

function loadCanonicalContract() {
  try { return JSON.parse(readFileSync(CANONICAL_CONTRACT_PATH, "utf8"))?.architectureContract ?? null; }
  catch { return null; }
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const facts = { canonicalLayerContract: loadCanonicalContract(), files: readSourceFacts(SOURCE_ROOT) };
  const result = evaluateArchitectureFitness(facts);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (!result.ok || result.findings.length > 0) {
    console.error(`P01_PKG10_ARCHITECTURE_FITNESS_RED (${durationMs.toFixed(2)}ms)`);
    for (const finding of result.findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`P01_PKG10_ARCHITECTURE_FITNESS_GREEN (${durationMs.toFixed(2)}ms)`);
}

// realpath-compared (not URL string equality) so a symlinked invocation path (e.g. macOS /tmp) still matches.
function isInvokedAsCli() {
  if (process.argv[1] === undefined) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isInvokedAsCli()) await main();
