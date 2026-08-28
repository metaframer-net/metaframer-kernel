import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P24C — boundary sufficiency probes. P24B froze an intake protocol whose fenced block declared exactly
// four `requiredInputs`, and a reference consumer an outside team is supposed to run from them. Nobody had
// measured whether that handover is closed. This frozen test owns every expectation for the three probes
// that measure it, with NO shared helper between them: one shared isolation helper would let a single bug
// produce three false verdicts at once, so each probe owns its own copy of its isolation, spawn and
// transcript code and imports nothing but `node:` builtins. Each probe prints exactly ONE deterministic
// JSON transcript line on stdout with its temp tree redacted, and exit 0 means "a measurement completed"
// whatever the verdict. Exit 1 is a refusal to measure: empty stdout and exactly one
// `BOUNDARY_PROBE_ERROR:<CODE>` line, because a probe never emits a sufficiency verdict from facts it
// could not read.
//
// P24CR — handover repair. The three probes measured INSUFFICIENT, INSUFFICIENT and INSUFFICIENT_BRIDGE:
// two files were missing from the handover, no handed-over file named the type the generator demands, and
// no handed-over file ever put payload bytes on disk. MASTER authorized an ADDITION-ONLY amendment whose
// only change to the protocol block is three entries APPENDED to `requiredInputs` — the contract type, its
// renderer and one materializer CLI. The block gains no key; the type's six rules, the payload layout and
// the CLI's usage are written in the document's PROSE, and the P24B package's own frozen test pins them
// there. This test now freezes the REPAIRED measurement: all three verdicts are
// SUFFICIENT, measured by the same three probes, unchanged. That is the whole point of the sha256 pin on
// each probe below — a probe edited to agree with the thing it measures measures nothing, so the probes
// are frozen bytes here and the repair has to move the HANDOVER to move the verdict.
//
// What is still NOT claimed, and must never be laundered: this is not P24. A probe is `neverCounted`
// under the protocol's own list, the counted team total stays 0, owner help is UNMEASURED here (not
// zero), P24 stays open, every readiness flag stays false, no host, container, database or release is
// started, and SUFFICIENT means the handover loads and materializes — never that anyone outside has used
// it. The one thing that changed is that a team following the protocol can now reach the payload at all.

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
const CONTRACT_MODULE = "src/application/action-contract.mjs";
const RENDERER_PATH = "tools/generate-action-sdk.mjs";
const MATERIALIZER_PATH = "tools/materialize-distribution-payload.mjs";
// The seven declared inputs, in the amended block's own order, frozen here independently of the doc. The
// first four are the merged P24B four, unmoved; the last three are the amendment.
const DECLARED_INPUTS = Object.freeze([INTAKE_DOC, SDK_PATH, CONSUMER_PATH, DIAGNOSTICS_GENERATOR, CONTRACT_MODULE, RENDERER_PATH, MATERIALIZER_PATH]);
const CONTRACT_OPTIONS = Object.freeze(["kind", "name", "version", "fields", "outcomes", "errorEnvelopeFields"]);
const CONTRACT_REFUSAL = "renderActionSdk requires an exact ActionContract instance";
const READINESS_FLAGS = Object.freeze({ kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false });
// The honesty block every transcript carries verbatim: owner help is "unmeasured", never 0, and gapClosed
// stays false even now that the three verdicts read SUFFICIENT.
const NOT_COUNTED = Object.freeze({ isP24: false, participantKind: "probe", countedTowardAcceptance: false, independentTeamCount: 0, ownerHelpCount: "unmeasured", p24Open: true, readinessFlags: READINESS_FLAGS });
const TRANSCRIPT_KEYS = Object.freeze(["dynamic", "notCounted", "probe", "schemaVersion", "static", "verdict"]);
// A probe spawns processes and materializes temp trees; it reaches no network and no loader escape hatch.
const FORBIDDEN_BUILTINS = Object.freeze(["node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:worker_threads", "node:vm", "node:module", "node:repl"]);
// The measuring instrument, pinned to the byte. These are the digests of the three probes as merged, and
// the repair may not touch one of them: a verdict is only worth reading if the thing that produced it did
// not move to produce it.
const PROBE_DIGESTS = Object.freeze({
  [PROBE_CLOSURE]: "41e7919251809e21989c6df3e449195c9015df60f0bcb6fcd417032403d95fe2",
  [PROBE_CONTRACT]: "10125096a9d0006e7db9e248a7cfab7f3f02daac232a834e6ba64a478201287a",
  [PROBE_PAYLOAD]: "e73f320c67774707fdf32b68fd1a81e74d26587930841f47d8a5b4bac001d0d4",
});

// argv[2], when present, is the repository root the probe measures; absent, it measures its own repository.
const runProbe = (relPath, args = []) => spawnSync(process.execPath, [path.join(root, relPath), ...args], { cwd: root, env: {}, encoding: "utf8" });
const readProbe = async (relPath) => readFile(path.join(root, relPath), "utf8").catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));

// The probe is the instrument, not the subject: its bytes are the ones that measured the gap.
async function assertFrozen(relPath) {
  const bytes = await readFile(path.join(root, relPath)).catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PROBE_DIGESTS[relPath], `${relPath} changed: the repair moves the handover, never the probe that measures it`);
}

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
  assert.ok(!/SUFFICIENT/.test(result.stderr), `${relPath} must emit no verdict from facts it could not read`);
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

test("probe 1 measures the declared inputs as a SUFFICIENT closure: nothing is missing and the isolated handover loads its own generator", async (t) => {
  await assertFrozen(PROBE_CLOSURE);
  assertPurity(await readProbe(PROBE_CLOSURE), PROBE_CLOSURE);
  const result = runProbe(PROBE_CLOSURE);
  const transcript = transcriptOf(result, PROBE_CLOSURE, "declared-input-closure", "SUFFICIENT");

  // Static half: the declared seven, the transitive non-builtin closure they imply, and the difference.
  // The closure is now exactly the declared set — that is what "closed under its own imports" means.
  assert.deepEqual(transcript.static.declaredInputs, [...DECLARED_INPUTS], "the declared inputs are read from the single fenced block, in its order");
  assert.deepEqual([...transcript.static.closure].sort(), [...DECLARED_INPUTS].sort());
  assert.ok(!transcript.static.closure.some((entry) => entry.startsWith("node:")), "builtins are not files and belong in no closure");
  assert.deepEqual(transcript.static.missing, [], "the handover declares every file its own imports reach");

  // Dynamic half: ONLY the declared paths are copied into a fresh tree, and the generator loads there.
  // A SUFFICIENT verdict rests on that observed load, never on the static list alone.
  assert.deepEqual(transcript.dynamic.copiedFiles, [...DECLARED_INPUTS], "the isolated tree holds exactly what the protocol hands over");
  assert.equal(transcript.dynamic.entry, SDK_PATH);
  assert.equal(transcript.dynamic.importFailed, false, "the handed-over generator must load from the handover alone");
  assert.equal(transcript.dynamic.exitCode, 0);
  assert.equal(transcript.dynamic.errorCode, null);
  assert.equal(transcript.dynamic.specifier, null, "no unresolved relative specifier is left to report");
  await assertDeterministicAndRedacted(PROBE_CLOSURE, result);

  // Fail-closed: a root whose intake document carries no fenced block yields no verdict at all.
  assertRefusal(PROBE_CLOSURE, await fixtureRoot(t, { [INTAKE_DOC]: "# External consumer intake\n\nThis root carries no fenced block.\n" }), "INTAKE_BLOCK_UNREADABLE");
});

test("probe 2 measures contract construction as SUFFICIENT: all six option names are documented in the handover, while the generator still refuses a plain object", async (t) => {
  await assertFrozen(PROBE_CONTRACT);
  assertPurity(await readProbe(PROBE_CONTRACT), PROBE_CONTRACT);
  const result = runProbe(PROBE_CONTRACT);
  const transcript = transcriptOf(result, PROBE_CONTRACT, "contract-construction", "SUFFICIENT");

  // Static half: what the handed-over files now say about the type the generator actually demands. The
  // type and its module are named in the handover, so all six of its options are anchored and documented.
  assert.deepEqual(transcript.static.options, [...CONTRACT_OPTIONS], "the six option names ActionContract requires, in its own order");
  assert.equal(transcript.static.optionCount, CONTRACT_OPTIONS.length);
  assert.deepEqual(transcript.static.documentedOptions, [...CONTRACT_OPTIONS], "every option a team must supply is named in a handed-over file");
  assert.equal(transcript.static.documentedCount, CONTRACT_OPTIONS.length);
  assert.equal(transcript.static.contractModuleDocumented, true, "the module that defines the required type is named in the handover");
  assert.deepEqual(transcript.static.searched, [...DECLARED_INPUTS], "the search covers the handover and nothing beyond it");

  // Dynamic half: the type is now reachable, and the refusal that remains is the type's own boundary, not
  // a gap. A plain object is still refused, and that is recorded exactly rather than paraphrased away:
  // the handover teaches a team to construct the instance, it does not weaken what the generator demands.
  assert.deepEqual([...transcript.dynamic.copiedFiles].sort(), [...DECLARED_INPUTS].sort(), "the complete closure is the declared set");
  assert.equal(transcript.dynamic.harness, "probe-supplied");
  assert.equal(transcript.dynamic.constructedFrom, "plain-object");
  assert.equal(transcript.dynamic.accepted, false, "a plain object carrying the six correct keys is still refused");
  assert.equal(transcript.dynamic.errorName, "TypeError");
  assert.equal(transcript.dynamic.refusal, CONTRACT_REFUSAL, "the exact refusal a team would see, recorded rather than paraphrased");
  assert.deepEqual(transcript.dynamic.suppliedKeys, [...CONTRACT_OPTIONS], "the object refused is the best a doc-following team could build");
  assert.equal(transcript.dynamic.sameOptionsAcceptedByTheType, true, "the very same values construct the type: what is refused is the plain object, never the values");
  await assertDeterministicAndRedacted(PROBE_CONTRACT, result);

  // Fail-closed: a root the closure cannot be computed from yields no verdict at all.
  assertRefusal(PROBE_CONTRACT, await fixtureRoot(t, { [INTAKE_DOC]: await readFile(path.join(root, INTAKE_DOC), "utf8") }), "CLOSURE_UNREADABLE");
});

test("probe 3 measures the payload bridge as SUFFICIENT: a handed-over file now carries the step that puts payload bytes on disk", async (t) => {
  await assertFrozen(PROBE_PAYLOAD);
  assertPurity(await readProbe(PROBE_PAYLOAD), PROBE_PAYLOAD);
  const result = runProbe(PROBE_PAYLOAD);
  const transcript = transcriptOf(result, PROBE_PAYLOAD, "payload-materialization", "SUFFICIENT");

  // Static half: the consumer still needs a materialized directory and the generators still return an
  // in-memory file map — neither was changed. What changed is that one handed-over file now writes that
  // map to disk, so the missing STEP is in the handover and is named here as a file and a primitive.
  assert.deepEqual(transcript.static.consumerArguments, ["payload-directory", "expected-distribution-version"]);
  assert.equal(transcript.static.generatorReturns, "in-memory-file-map");
  assert.equal(transcript.static.materializerInHandover, true, "a handed-over file, not a spoken step, writes the payload to disk");
  assert.deepEqual(transcript.static.materializerStep, { file: MATERIALIZER_PATH, primitive: "writeFileSync" });
  assert.deepEqual(transcript.static.searched, [...DECLARED_INPUTS], "the search covers the handover and nothing beyond it");

  // Dynamic half, unchanged and still honest: this probe materializes its own payload OUT OF BAND and
  // records it as out-of-band, then runs the consumer against the empty directory it did NOT materialize.
  // That leg still refuses, and it is not evidence against the repair: the probe never runs the new step,
  // and the verdict above rests on the step existing in the handover. Test 4 of the P24B package is where
  // the CLI is actually run end to end. The refusing leg's code remains overloaded and is recorded as is.
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
