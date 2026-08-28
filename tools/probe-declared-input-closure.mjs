// P24C — boundary sufficiency probe 1 of 3: declared-input closure.
//
// The P24B intake protocol hands an outside team exactly four files and says nothing else is part
// of the handover. This probe asks one question: is that set closed under its own imports? It
// answers statically, by walking the transitive non-builtin import closure of the four declared
// paths, and then dynamically, by building a fresh tree holding ONLY those four files and running
// the generator the protocol hands over inside it. A static list of absent files is an argument; a
// generator that will not load is a measurement, and the verdict rests on the second.
//
// Builtins only, and no helper shared with the other two probes, so one bug here cannot produce
// three agreeing verdicts. One deterministic JSON line on stdout, temp tree redacted. Exit 0 means
// a measurement completed, whatever it says: INSUFFICIENT is a result, not a failure. Exit 1 is a
// refusal to measure — nothing on stdout, one BOUNDARY_PROBE_ERROR line — because a probe states
// no sufficiency verdict over facts it could not read. It starts no host, container, database or
// release, moves no readiness flag, and is not P24: a probe is on the protocol's own never-counted
// list, it measures the gap and closes nothing.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ERROR_PREFIX = "BOUNDARY_PROBE_ERROR";
const REDACTED = "<redacted>";
const INTAKE_DOC = "docs/external-consumer-intake.md";
const FENCE = "```json";
const ENTRY = "tools/generate-versioned-action-sdk-distribution.mjs";
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*"([^"\n]+)"/g;
const RELATIVE = /^\.{1,2}\//;
const ERROR_CODE = /\bError \[([A-Z][A-Z0-9_]+)\]|\bcode: '([A-Z][A-Z0-9_]+)'/;
const READINESS_FLAGS = { kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false };
// Owner help is "unmeasured", never 0: nothing in this probe measures a person.
const NOT_COUNTED = { isP24: false, participantKind: "probe", countedTowardAcceptance: false, independentTeamCount: 0, ownerHelpCount: "unmeasured", p24Open: true, readinessFlags: READINESS_FLAGS };

const readText = (absolute) => { try { return readFileSync(absolute, "utf8"); } catch { return null; } };
const refuse = (code, detail) => { process.stderr.write(ERROR_PREFIX + ":" + code + " " + detail + "\n"); process.exit(1); };

// The single fenced block is the protocol's own authority: the declared paths are read out of it,
// in its order, never out of a list copied into this probe.
function declaredInputsOf(root) {
  const source = readText(path.join(root, INTAKE_DOC));
  const parts = source === null ? [] : source.split(FENCE);
  if (parts.length !== 2) return null;
  const end = parts[1].indexOf("```");
  if (end < 0) return null;
  let declared = null;
  try { declared = JSON.parse(parts[1].slice(0, end))?.requiredInputs; } catch { return null; }
  if (!Array.isArray(declared) || declared.length === 0) return null;
  const paths = declared.map((entry) => entry?.path);
  return paths.every((value) => typeof value === "string" && value.length > 0) ? paths : null;
}

// Breadth-first over relative specifiers only: a builtin is not a file and belongs in no closure,
// and neither does a `data:` specifier. An unreadable member makes the closure unknown, not empty.
function closureOf(root, declared) {
  const closure = [];
  const queue = [...declared];
  while (queue.length > 0) {
    const relPath = queue.shift();
    if (closure.includes(relPath)) continue;
    const source = readText(path.join(root, relPath));
    if (source === null) return null;
    closure.push(relPath);
    if (!relPath.endsWith(".mjs")) continue;
    for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
      if (RELATIVE.test(specifier)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier)));
    }
  }
  return closure;
}

// A fresh tree holding exactly these paths, realpath'd so the loader's own resolved paths inside a
// failure match what this probe computes for them.
function isolate(root, files) {
  const isolated = realpathSync(mkdtempSync(path.join(os.tmpdir(), "p24c-closure-")));
  for (const relPath of files) {
    const target = path.join(isolated, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(root, relPath)));
  }
  return isolated;
}

// argv[2], when present, is the repository root to measure; absent, this probe measures its own.
const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declaredInputs = declaredInputsOf(root);
if (declaredInputs === null) refuse("INTAKE_BLOCK_UNREADABLE", "the intake document declares no single readable fenced protocol block");
const closure = closureOf(root, declaredInputs);
if (closure === null) refuse("CLOSURE_UNREADABLE", "a member of the declared import closure could not be read");
if (!declaredInputs.includes(ENTRY)) refuse("ENTRY_NOT_DECLARED", "the handover declares no versioned distribution generator to run");
const missing = closure.filter((relPath) => !declaredInputs.includes(relPath)).sort();

const isolated = isolate(root, declaredInputs);
let run = null;
let specifier = null;
try {
  const entry = path.join(isolated, ENTRY);
  run = spawnSync(process.execPath, [entry], { cwd: isolated, env: {}, encoding: "utf8" });
  // Map the loader's resolved absolute path back to the specifier as the generator wrote it. That
  // reported path is a host path and never enters the transcript; only the specifier does.
  for (const [, candidate] of readFileSync(entry, "utf8").matchAll(IMPORT_SPECIFIER)) {
    if (!RELATIVE.test(candidate) || !run.stderr.includes(path.resolve(path.dirname(entry), candidate))) continue;
    specifier = candidate;
    break;
  }
} finally {
  rmSync(isolated, { recursive: true, force: true });
}

const code = ERROR_CODE.exec(run.stderr);
const importFailed = run.status !== 0;
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  probe: "declared-input-closure",
  verdict: missing.length > 0 && importFailed ? "INSUFFICIENT" : "SUFFICIENT",
  static: { declaredInputs, closure, missing },
  dynamic: { isolatedRoot: REDACTED, copiedFiles: declaredInputs, entry: ENTRY, importFailed, exitCode: run.status, errorCode: code === null ? null : (code[1] ?? code[2]), specifier },
  notCounted: NOT_COUNTED,
}) + "\n");
