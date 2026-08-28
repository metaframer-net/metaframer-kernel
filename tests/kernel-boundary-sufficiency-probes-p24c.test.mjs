import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P24C — boundary sufficiency probes. P24B froze an intake protocol whose fenced block declares exactly
// four `requiredInputs`, and a reference consumer an outside team is supposed to run from them. Nobody has
// measured whether that handover is closed. This frozen test owns every expectation for the package that
// measures it, with three independent probes and NO shared helper between them: one shared isolation
// helper would let a single bug produce three false verdicts at once, so each probe owns its own copy of
// its isolation, spawn and transcript code and imports nothing but `node:` builtins. Each probe prints
// exactly ONE deterministic JSON transcript line on stdout with its temp tree redacted, and exit 0 means
// "a measurement completed" whatever the verdict — `INSUFFICIENT` is a success, not a failure. Exit 1 is
// a refusal to measure: empty stdout and exactly one `BOUNDARY_PROBE_ERROR:<CODE>` line, because a probe
// never emits a sufficiency verdict from facts it could not read. This is NOT P24 and must never be
// laundered into it: a probe is `neverCounted` under the protocol's own list, the counted team total stays
// 0, owner help is UNMEASURED here (not zero), P24 stays open, every readiness flag stays false, and no
// host, container, database or release is started. The probes MEASURE the gap; they must not close it —
// the fenced block is pinned by a merged, frozen test and unfreezing it is not a writer's call.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_CLOSURE = "tools/probe-declared-input-closure.mjs";
const PROBE_CONTRACT = "tools/probe-contract-construction.mjs";
const PROBE_PAYLOAD = "tools/probe-payload-materialization.mjs";
const ERROR_PREFIX = "BOUNDARY_PROBE_ERROR";
const REDACTED = "<redacted>";
const INTAKE_DOC = "docs/external-consumer-intake.md";
const CONSUMER_PATH = "examples/external-consumer/reference-consumer.mjs";
const SDK_PATH = "tools/generate-versioned-action-sdk-distribution.mjs";
const DIAGNOSTICS_GENERATOR = "tools/generate-consumer-diagnostics-distribution.mjs";
// The four declared inputs, in the fenced block's own order, frozen here independently of the doc.
const DECLARED_INPUTS = Object.freeze([INTAKE_DOC, SDK_PATH, CONSUMER_PATH, DIAGNOSTICS_GENERATOR]);
// What the declared four do not carry, and without which the handover cannot even load its generator.
const MISSING_FROM_HANDOVER = Object.freeze(["src/application/action-contract.mjs", "tools/generate-action-sdk.mjs"]);
const CONTRACT_OPTIONS = Object.freeze(["kind", "name", "version", "fields", "outcomes", "errorEnvelopeFields"]);
const CONTRACT_REFUSAL = "renderActionSdk requires an exact ActionContract instance";
const READINESS_FLAGS = Object.freeze({ kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false });
// The honesty block every transcript carries verbatim: owner help is "unmeasured", never 0.
const NOT_COUNTED = Object.freeze({ isP24: false, participantKind: "probe", countedTowardAcceptance: false, independentTeamCount: 0, ownerHelpCount: "unmeasured", p24Open: true, readinessFlags: READINESS_FLAGS });
const TRANSCRIPT_KEYS = Object.freeze(["dynamic", "notCounted", "probe", "schemaVersion", "static", "verdict"]);
// A probe spawns processes and materializes temp trees; it reaches no network and no loader escape hatch.
const FORBIDDEN_BUILTINS = Object.freeze(["node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:worker_threads", "node:vm", "node:module", "node:repl"]);

// argv[2], when present, is the repository root the probe measures; absent, it measures its own repository.
const runProbe = (relPath, args = []) => spawnSync(process.execPath, [path.join(root, relPath), ...args], { cwd: root, env: {}, encoding: "utf8" });
const readProbe = async (relPath) => readFile(path.join(root, relPath), "utf8").catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));

// Purity, asserted per probe: builtins only, therefore no repository import and no shared helper module,
// and each probe carries its own isolation, spawn and environment-clearing code rather than borrowing it.
function assertPurity(source, relPath) {
  const specifiers = [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, `${relPath} must declare the builtins it uses`);
  for (const specifier of specifiers) assert.ok(specifier.startsWith("node:"), `${relPath} imports ${specifier}: a probe is builtins-only and shares no helper`);
  for (const forbidden of FORBIDDEN_BUILTINS) assert.ok(!specifiers.includes(forbidden), `${relPath} must not import ${forbidden}`);
  for (const owned of ["mkdtemp", "spawnSync", "env: {}"]) assert.ok(source.includes(owned), `${relPath} must own its own ${owned}`);
  assert.ok(!/process\.env\s*\./.test(source), `${relPath} must not read the ambient environment`);
  assert.ok(!/\bexternalUsabilityProven\b|\bproduction[- ]?ready\b|\bindependent\s+(?:consumer|team)\s+(?:proven|counted)\b/i.test(source), `${relPath} must claim no external usability`);
}

// One transcript line, exit 0, nothing on stderr, the honesty block verbatim, the temp tree redacted.
function transcriptOf(result, relPath, probeName, verdict) {
  assert.equal(result.status, 0, `${relPath} must complete its measurement and exit 0 (stderr: ${result.stderr})`);
  assert.equal(result.stderr, "", `${relPath} must print nothing on stderr when it measures`);
  assert.equal(result.stdout.split("\n").filter((line) => line.trim().length > 0).length, 1, `${relPath} must print exactly one transcript line`);
  assert.ok(result.stdout.endsWith("\n"), `${relPath} must terminate its transcript line`);
  const transcript = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(transcript).sort(), [...TRANSCRIPT_KEYS]);
  assert.equal(transcript.schemaVersion, 1);
  assert.equal(transcript.probe, probeName);
  assert.equal(transcript.verdict, verdict, `${relPath} measured ${transcript.verdict}; the frozen measured truth is ${verdict}`);
  assert.deepEqual(transcript.notCounted, NOT_COUNTED, `${relPath} must carry the notCounted block verbatim`);
  assert.equal(transcript.dynamic.isolatedRoot, REDACTED, `${relPath} must redact the isolated tree it built`);
  return transcript;
}

// Deterministic across runs and free of every host path: the same bytes twice, no repo or temp prefix.
async function assertDeterministicAndRedacted(relPath, first) {
  const second = runProbe(relPath);
  assert.equal(second.stdout, first.stdout, `${relPath} must print a byte-identical transcript on a second run`);
  const hostPaths = [root, os.tmpdir(), await realpath(os.tmpdir())];
  for (const hostPath of hostPaths) assert.ok(!first.stdout.includes(hostPath), `${relPath} leaked the host path ${hostPath}`);
}

// A refusal to measure: exit 1, empty stdout, exactly one anchored error line, and no verdict anywhere.
function assertRefusal(relPath, fixture, code) {
  const result = runProbe(relPath, [fixture]);
  assert.equal(result.status, 1, `${relPath} must refuse to measure an unreadable root`);
  assert.equal(result.stdout, "", `${relPath} must print nothing on stdout when it refuses`);
  const lines = result.stderr.split("\n").filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 1, `${relPath} must refuse with exactly one line, got ${lines.length}`);
  assert.match(lines[0], new RegExp(`^${ERROR_PREFIX}:${code}(?:\\s|$)`), `${relPath} must anchor one ${ERROR_PREFIX}:${code} line`);
  assert.ok(!/INSUFFICIENT/.test(result.stderr), `${relPath} must emit no verdict from facts it could not read`);
}

async function fixtureRoot(t, files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p24c-fixture-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [relPath, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
    await writeFile(path.join(dir, relPath), contents, "utf8");
  }
  return dir;
}

test("probe 1 measures the declared inputs as an INSUFFICIENT closure: two files are missing and the isolated handover cannot import its own generator", async (t) => {
  assertPurity(await readProbe(PROBE_CLOSURE), PROBE_CLOSURE);
  const result = runProbe(PROBE_CLOSURE);
  const transcript = transcriptOf(result, PROBE_CLOSURE, "declared-input-closure", "INSUFFICIENT");

  // Static half: the declared four, the transitive non-builtin closure they imply, and the difference.
  assert.deepEqual(transcript.static.declaredInputs, [...DECLARED_INPUTS], "the declared inputs are read from the single fenced block, in its order");
  assert.deepEqual([...transcript.static.closure].sort(), [...DECLARED_INPUTS, ...MISSING_FROM_HANDOVER].sort());
  assert.ok(!transcript.static.closure.some((entry) => entry.startsWith("node:")), "builtins are not files and belong in no closure");
  assert.deepEqual([...transcript.static.missing].sort(), [...MISSING_FROM_HANDOVER], "exactly these two files are declared nowhere in the handover");

  // Dynamic half: ONLY the declared paths are copied into a fresh tree, and the first import fails there.
  assert.deepEqual(transcript.dynamic.copiedFiles, [...DECLARED_INPUTS], "the isolated tree holds exactly what the protocol hands over");
  assert.equal(transcript.dynamic.entry, SDK_PATH);
  assert.equal(transcript.dynamic.importFailed, true, "an INSUFFICIENT verdict must rest on an observed failure, never on the static list alone");
  assert.equal(transcript.dynamic.exitCode, 1);
  assert.equal(transcript.dynamic.errorCode, "ERR_MODULE_NOT_FOUND");
  assert.equal(transcript.dynamic.specifier, "./generate-action-sdk.mjs", "the failure is the generator's own first relative import");
  await assertDeterministicAndRedacted(PROBE_CLOSURE, result);

  // Fail-closed: a root whose intake document carries no fenced block yields no verdict at all.
  assertRefusal(PROBE_CLOSURE, await fixtureRoot(t, { [INTAKE_DOC]: "# External consumer intake\n\nThis root carries no fenced block.\n" }), "INTAKE_BLOCK_UNREADABLE");
});

test("probe 2 measures contract construction as INSUFFICIENT: zero of the six option names are documented and the generator refuses the plain object a doc-following team would build", async (t) => {
  assertPurity(await readProbe(PROBE_CONTRACT), PROBE_CONTRACT);
  const result = runProbe(PROBE_CONTRACT);
  const transcript = transcriptOf(result, PROBE_CONTRACT, "contract-construction", "INSUFFICIENT");

  // Static half: what the handed-over files say about the type the generator actually demands. Nothing.
  assert.deepEqual(transcript.static.options, [...CONTRACT_OPTIONS], "the six option names ActionContract requires, in its own order");
  assert.equal(transcript.static.optionCount, CONTRACT_OPTIONS.length);
  assert.deepEqual(transcript.static.documentedOptions, [], "not one option name appears in any handed-over file");
  assert.equal(transcript.static.documentedCount, 0);
  assert.equal(transcript.static.contractModuleDocumented, false, "the module that defines the required type is named nowhere in the handover");
  assert.deepEqual(transcript.static.searched, [...DECLARED_INPUTS], "the search covers the handover and nothing beyond it");

  // Dynamic half: even the FULL closure, past probe 1's gap, refuses what the documentation permits.
  assert.deepEqual([...transcript.dynamic.copiedFiles].sort(), [...DECLARED_INPUTS, ...MISSING_FROM_HANDOVER].sort(), "this probe measures past probe 1's gap, on the complete closure");
  assert.equal(transcript.dynamic.constructedFrom, "plain-object");
  assert.equal(transcript.dynamic.accepted, false, "a plain object carrying the six correct keys is still refused");
  assert.equal(transcript.dynamic.errorName, "TypeError");
  assert.equal(transcript.dynamic.refusal, CONTRACT_REFUSAL, "the exact refusal a team would see, recorded rather than paraphrased");
  assert.deepEqual(transcript.dynamic.suppliedKeys, [...CONTRACT_OPTIONS], "the object refused is the best a doc-following team could build");
  await assertDeterministicAndRedacted(PROBE_CONTRACT, result);

  // Fail-closed: a root the closure cannot be computed from yields no verdict at all.
  assertRefusal(PROBE_CONTRACT, await fixtureRoot(t, { [INTAKE_DOC]: await readFile(path.join(root, INTAKE_DOC), "utf8") }), "CLOSURE_UNREADABLE");
});

test("probe 3 measures the payload bridge as INSUFFICIENT_BRIDGE: an out-of-band payload runs healthy while the path the handover actually produces refuses", async (t) => {
  assertPurity(await readProbe(PROBE_PAYLOAD), PROBE_PAYLOAD);
  const result = runProbe(PROBE_PAYLOAD);
  const transcript = transcriptOf(result, PROBE_PAYLOAD, "payload-materialization", "INSUFFICIENT_BRIDGE");

  // Static half: the consumer needs a materialized directory; the generators return an in-memory file map
  // and no handed-over file writes one. The deficit is a MISSING STEP, not an unsound payload.
  assert.deepEqual(transcript.static.consumerArguments, ["payload-directory", "expected-distribution-version"]);
  assert.equal(transcript.static.generatorReturns, "in-memory-file-map");
  assert.equal(transcript.static.materializerInHandover, false, "no handed-over file, and no prose step, writes the payload to disk");
  assert.equal(transcript.static.materializerStep, null);

  // Dynamic half: materialized OUT OF BAND (recorded as such, never as a handover capability) the payload
  // is sound; run the way a team actually holds it, the consumer refuses with the one overloaded code.
  assert.equal(transcript.dynamic.materializedBy, "out-of-band", "the probe supplying the missing step is not the handover supplying it");
  assert.equal(transcript.dynamic.outOfBand.exitCode, 0);
  assert.equal(transcript.dynamic.outOfBand.status, "ok");
  assert.equal(transcript.dynamic.outOfBand.stdoutLines, 1, "a sound payload prints exactly one report");
  assert.equal(transcript.dynamic.handover.exitCode, 1);
  assert.equal(transcript.dynamic.handover.stdout, "", "the refusing path prints nothing on stdout");
  assert.equal(transcript.dynamic.handover.errorLines, 1, "exactly one error line, observed complete on a pipe rather than assumed");
  assert.equal(transcript.dynamic.handover.code, "DIAGNOSTICS_FAILED");
  assert.equal(transcript.dynamic.handover.codeIsOverloaded, true, "DIAGNOSTICS_FAILED covers several distinct upstream conditions and does not name this one");
  await assertDeterministicAndRedacted(PROBE_PAYLOAD, result);

  // Fail-closed: a root without the reference consumer yields no verdict at all.
  assertRefusal(PROBE_PAYLOAD, await fixtureRoot(t, { [INTAKE_DOC]: await readFile(path.join(root, INTAKE_DOC), "utf8") }), "CONSUMER_UNREADABLE");
});
