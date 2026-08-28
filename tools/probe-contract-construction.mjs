// P24C — boundary sufficiency probe 2 of 3: contract construction.
//
// The generator the P24B protocol hands over takes one argument it never names: an instance of the
// ActionContract type, which the handover neither ships nor mentions. This probe asks whether a
// team reading only the four declared inputs could construct what that generator demands. It reads
// the six option names out of the type itself, searches the handover for them, and then — past the
// gap probe 1 measured, on the COMPLETE import closure, so nothing here is blamed on a file that
// was merely absent — hands the generator the best object a doc-following team could build and
// records the exact refusal that object earns.
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
const CONTRACT_MODULE = "src/application/action-contract.mjs";
const CONTRACT_TYPE = "ActionContract";
const CONTRACT_BASENAME = "action-contract.mjs";
const OPTION_LIST = /const OPTIONS = \[([^\]]*)\]/;
const QUOTED = /"([^"]+)"/g;
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*"([^"\n]+)"/g;
const RELATIVE = /^\.{1,2}\//;
const HARNESS_FILE = "probe-contract-construction-harness.mjs";
const READINESS_FLAGS = { kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false };
// Owner help is "unmeasured", never 0: nothing in this probe measures a person.
const NOT_COUNTED = { isP24: false, participantKind: "probe", countedTowardAcceptance: false, independentTeamCount: 0, ownerHelpCount: "unmeasured", p24Open: true, readinessFlags: READINESS_FLAGS };

// Written into the isolated tree, never copied out of the handover, and recorded as probe-supplied.
// Both specifiers are held in a constant so the loader resolves them at run time. The values are
// ordinary ones the type itself accepts — proven in the same run — so the refusal below can only be
// about the type, never about the values.
const HARNESS = [
  "const [, , ENTRY_PATH, CONTRACT_PATH, OPTIONS, TYPE_NAME] = process.argv;",
  'const ENTRY_SPECIFIER = "./" + ENTRY_PATH;',
  'const CONTRACT_SPECIFIER = "./" + CONTRACT_PATH;',
  "const generator = await import(ENTRY_SPECIFIER);",
  "const type = await import(CONTRACT_SPECIFIER);",
  'const VALUES = { kind: "command", name: "customer.create", version: 1, fields: ["customerId", "email"], outcomes: ["accepted", "rejected"], errorEnvelopeFields: ["code", "message"] };',
  "const supplied = {};",
  "for (const option of JSON.parse(OPTIONS)) supplied[option] = VALUES[option];",
  'const out = { constructedFrom: "plain-object", suppliedKeys: Object.keys(supplied), accepted: false, errorName: null, refusal: null, sameOptionsAcceptedByTheType: false };',
  "try { new type[TYPE_NAME](supplied); out.sameOptionsAcceptedByTheType = true; } catch { out.sameOptionsAcceptedByTheType = false; }",
  'try { generator.renderVersionedActionSdkDistribution(supplied, "1.0.0"); out.accepted = true; }',
  'catch (error) { out.errorName = error?.name ?? null; out.refusal = String(error?.message ?? ""); }',
  'process.stdout.write(JSON.stringify(out) + "\\n");',
].join("\n");

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

// Breadth-first over relative specifiers only, carrying each member's text: a builtin is not a file
// and belongs in no closure, and an unreadable member makes the closure unknown, not empty.
function closureOf(root, declared) {
  const sources = new Map();
  const queue = [...declared];
  while (queue.length > 0) {
    const relPath = queue.shift();
    if (sources.has(relPath)) continue;
    const source = readText(path.join(root, relPath));
    if (source === null) return null;
    sources.set(relPath, source);
    if (!relPath.endsWith(".mjs")) continue;
    for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
      if (RELATIVE.test(specifier)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier)));
    }
  }
  return sources;
}

function isolate(root, sources) {
  const isolated = realpathSync(mkdtempSync(path.join(os.tmpdir(), "p24c-contract-")));
  for (const [relPath, contents] of sources) {
    const target = path.join(isolated, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return isolated;
}

// argv[2], when present, is the repository root to measure; absent, this probe measures its own.
const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declaredInputs = declaredInputsOf(root);
if (declaredInputs === null) refuse("INTAKE_BLOCK_UNREADABLE", "the intake document declares no single readable fenced protocol block");
const sources = closureOf(root, declaredInputs);
if (sources === null) refuse("CLOSURE_UNREADABLE", "a member of the declared import closure could not be read");
const contractSource = sources.get(CONTRACT_MODULE);
const optionMatch = contractSource === undefined ? null : OPTION_LIST.exec(contractSource);
if (optionMatch === null) refuse("CLOSURE_UNREADABLE", "the required option list could not be read out of the contract module in the closure");
const options = [...optionMatch[1].matchAll(QUOTED)].map((match) => match[1]);
if (options.length === 0) refuse("CLOSURE_UNREADABLE", "the contract module declares an empty required option list");

// An option name counts as DOCUMENTED only where the handover names the type that demands it. Bare
// `kind`, `name` and `version` do occur inside a handed-over generator, as properties it reads off
// a contract it was already given; that is a consumer of the type, and it teaches a reading team
// nothing about what to construct. So the anchor is the type itself. No handed-over file names the
// type or its module at all, so the anchored set is empty and the documented count is 0.
const anchored = declaredInputs.filter((relPath) => sources.get(relPath).includes(CONTRACT_TYPE) || sources.get(relPath).includes(CONTRACT_BASENAME));
const documentedOptions = options.filter((option) => anchored.some((relPath) => sources.get(relPath).includes(option)));

const copiedFiles = [...sources.keys()];
const isolated = isolate(root, sources);
let run = null;
try {
  writeFileSync(path.join(isolated, HARNESS_FILE), HARNESS, "utf8");
  run = spawnSync(process.execPath, [path.join(isolated, HARNESS_FILE), ENTRY, CONTRACT_MODULE, JSON.stringify(options), CONTRACT_TYPE], { cwd: isolated, env: {}, encoding: "utf8" });
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
let measured = null;
try { measured = JSON.parse(run.stdout); } catch { refuse("CONSTRUCTION_UNMEASURED", "the isolated construction attempt produced no readable result"); }

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  probe: "contract-construction",
  verdict: documentedOptions.length === 0 && measured.accepted === false ? "INSUFFICIENT" : "SUFFICIENT",
  static: { options, optionCount: options.length, documentedOptions, documentedCount: documentedOptions.length, contractModuleDocumented: anchored.length > 0, searched: declaredInputs },
  dynamic: { isolatedRoot: REDACTED, copiedFiles, harness: "probe-supplied", ...measured },
  notCounted: NOT_COUNTED,
}) + "\n");
