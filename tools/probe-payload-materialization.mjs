// P24C — boundary sufficiency probe 3 of 3: payload materialization.
//
// The reference consumer the P24B protocol hands over takes a materialized payload DIRECTORY. The
// generators handed over alongside it return an in-memory file map and write nothing, and no
// handed-over file writes that map to disk. This probe measures the bridge between them. It runs
// the handed-over consumer twice over the same generated payload: once against a directory this
// probe materialized OUT OF BAND — recorded as out-of-band, because a probe supplying the missing
// step is not the handover supplying it — and once the way a team that followed the handover
// actually holds the payload, which is not on disk at all. A sound payload a team cannot assemble
// is a missing STEP, not an unsound payload, and the verdict says which.
//
// Builtins only, and no helper shared with the other two probes, so one bug here cannot produce
// three agreeing verdicts. One deterministic JSON line on stdout, temp tree redacted. Exit 0 means
// a measurement completed: INSUFFICIENT_BRIDGE is a result, not a failure. Exit 1 is a refusal to
// measure — nothing on stdout, one BOUNDARY_PROBE_ERROR line — because a probe states no
// sufficiency verdict over facts it could not read. It starts no host, container, database or
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
const CONSUMER = "examples/external-consumer/reference-consumer.mjs";
const GENERATOR = "tools/generate-consumer-diagnostics-distribution.mjs";
const CONTRACT_MODULE = "src/application/action-contract.mjs";
const CONTRACT_TYPE = "ActionContract";
const VERSION = "1.0.0";
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*"([^"\n]+)"/g;
const RELATIVE = /^\.{1,2}\//;
const USAGE_ARGUMENT = /<([a-z][a-z-]*)>/g;
const DECLARES_FILE_MAP = /const files = Object\.freeze\(/;
const RETURNS_FILE_MAP = /return Object\.freeze\(\{[\s\S]*?\bfiles,/;
// Every way a handed-over file could put payload bytes on disk. The document is searched too: the
// protocol admits nothing verbal into the handover, so a step a team can run is a step in a file.
const WRITE_PRIMITIVES = ["writeFileSync", "writeFile", "appendFileSync", "createWriteStream", "copyFileSync", "cpSync", "mkdirSync", "mkdir"];
const CONSUMER_ERROR = /^EXTERNAL_CONSUMER_ERROR:([A-Z][A-Z0-9_]*)/;
const HARNESS_FILE = "probe-payload-materialization-harness.mjs";
const READINESS_FLAGS = { kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false };
// Owner help is "unmeasured", never 0: nothing in this probe measures a person.
const NOT_COUNTED = { isP24: false, participantKind: "probe", countedTowardAcceptance: false, independentTeamCount: 0, ownerHelpCount: "unmeasured", p24Open: true, readinessFlags: READINESS_FLAGS };

// Written into the isolated tree, never copied out of the handover. This IS the missing step, and
// that a probe had to write it is exactly what the transcript records as out-of-band.
const HARNESS = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'import path from "node:path";',
  "const [, , GENERATOR_PATH, CONTRACT_PATH, PAYLOAD_ROOT, DISTRIBUTION_VERSION, TYPE_NAME] = process.argv;",
  'const GENERATOR_SPECIFIER = "./" + GENERATOR_PATH;',
  'const CONTRACT_SPECIFIER = "./" + CONTRACT_PATH;',
  "const generator = await import(GENERATOR_SPECIFIER);",
  "const type = await import(CONTRACT_SPECIFIER);",
  'const contract = new type[TYPE_NAME]({ kind: "command", name: "customer.create", version: 1, fields: ["customerId", "email"], outcomes: ["accepted", "rejected"], errorEnvelopeFields: ["code", "message"] });',
  "const payload = generator.renderConsumerDiagnosticsDistribution(contract, DISTRIBUTION_VERSION);",
  "for (const [relPath, contents] of Object.entries(payload.files)) {",
  "  const target = path.join(PAYLOAD_ROOT, relPath);",
  "  mkdirSync(path.dirname(target), { recursive: true });",
  '  writeFileSync(target, contents, "utf8");',
  "}",
].join("\n");

const readText = (absolute) => { try { return readFileSync(absolute, "utf8"); } catch { return null; } };
const refuse = (code, detail) => { process.stderr.write(ERROR_PREFIX + ":" + code + " " + detail + "\n"); process.exit(1); };
const lines = (text) => text.split("\n").filter((line) => line.trim().length > 0);

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

function isolate(sources) {
  const isolated = realpathSync(mkdtempSync(path.join(os.tmpdir(), "p24c-payload-")));
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
const consumerSource = readText(path.join(root, CONSUMER));
if (consumerSource === null || !declaredInputs.includes(CONSUMER)) refuse("CONSUMER_UNREADABLE", "the handover declares no readable reference consumer to run");
const consumerArguments = [...new Set([...consumerSource.matchAll(USAGE_ARGUMENT)].map((match) => match[1]))];
if (consumerArguments.length < 2) refuse("CONSUMER_UNREADABLE", "the reference consumer states no usage line naming the arguments it takes");
const generatorSource = readText(path.join(root, GENERATOR));
if (generatorSource === null || !DECLARES_FILE_MAP.test(generatorSource) || !RETURNS_FILE_MAP.test(generatorSource)) refuse("GENERATOR_UNREADABLE", "what the diagnostics distribution generator returns could not be classified");

// Which handed-over file, if any, puts payload bytes on disk. None does, so the step is absent.
let materializerStep = null;
for (const relPath of declaredInputs) {
  const text = readText(path.join(root, relPath));
  if (text === null) refuse("HANDOVER_UNREADABLE", "a declared input could not be read while searching for a materialization step");
  const primitive = WRITE_PRIMITIVES.find((name) => text.includes(name));
  if (primitive !== undefined) { materializerStep = { file: relPath, primitive }; break; }
}

const sources = closureOf(root, declaredInputs);
if (sources === null) refuse("CLOSURE_UNREADABLE", "a member of the declared import closure could not be read");
const isolated = isolate(sources);
let outOfBand = null;
let handover = null;
try {
  const consumer = path.join(isolated, CONSUMER);
  const outOfBandRoot = path.join(isolated, "payload-out-of-band");
  // The handover leaves the payload in the generator's return value and nowhere else, so the
  // directory a team can point the consumer at holds nothing. That is the measured condition.
  const handoverRoot = path.join(isolated, "payload-as-the-handover-leaves-it");
  mkdirSync(outOfBandRoot, { recursive: true });
  mkdirSync(handoverRoot, { recursive: true });
  writeFileSync(path.join(isolated, HARNESS_FILE), HARNESS, "utf8");
  const materialize = spawnSync(process.execPath, [path.join(isolated, HARNESS_FILE), GENERATOR, CONTRACT_MODULE, outOfBandRoot, VERSION, CONTRACT_TYPE], { cwd: isolated, env: {}, encoding: "utf8" });
  if (materialize.status !== 0) refuse("PAYLOAD_UNMATERIALIZED", "the out-of-band payload could not be generated, so no bridge measurement is possible");
  const sound = spawnSync(process.execPath, [consumer, outOfBandRoot, VERSION], { cwd: isolated, env: {}, encoding: "utf8" });
  const held = spawnSync(process.execPath, [consumer, handoverRoot, VERSION], { cwd: isolated, env: {}, encoding: "utf8" });
  let report = null;
  try { report = JSON.parse(sound.stdout); } catch { report = null; }
  outOfBand = { exitCode: sound.status, status: report?.status ?? null, stdoutLines: lines(sound.stdout).length };
  const errorLines = lines(held.stderr);
  const code = errorLines.length === 0 ? null : (CONSUMER_ERROR.exec(errorLines[0])?.[1] ?? null);
  // That code is raised at more than one distinct site in the consumer, so what a team sees does
  // not name which upstream condition it stands for. The sites are counted here, not assumed.
  const codeSites = code === null ? 0 : consumerSource.split('fail("' + code + '"').length - 1;
  handover = { payload: "unmaterialized", exitCode: held.status, stdout: held.stdout, errorLines: errorLines.length, code, codeIsOverloaded: codeSites > 1, codeSites };
} finally {
  rmSync(isolated, { recursive: true, force: true });
}

const bridgeMissing = materializerStep === null;
const payloadSound = outOfBand.exitCode === 0 && outOfBand.status === "ok";
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  probe: "payload-materialization",
  verdict: !bridgeMissing ? "SUFFICIENT" : payloadSound && handover.exitCode !== 0 ? "INSUFFICIENT_BRIDGE" : "INSUFFICIENT",
  static: { consumerArguments, generatorReturns: "in-memory-file-map", materializerInHandover: !bridgeMissing, materializerStep, searched: declaredInputs },
  dynamic: { isolatedRoot: REDACTED, materializedBy: "out-of-band", outOfBand, handover },
  notCounted: NOT_COUNTED,
}) + "\n");
