import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderConsumerDiagnosticsDistribution } from "../tools/generate-consumer-diagnostics-distribution.mjs";

// P24B — external consumer intake protocol plus the reference consumer an outside team actually runs.
// P24A shipped diagnose.mjs INSIDE the payload; nothing yet says who may be counted as an external team,
// what they are handed, or what invalidates a run, and no runnable example consumes the payload end to
// end. This frozen test owns every expectation for the package that adds both. It is BOUNDARY WORK, not
// P24: no external, independent or counted team consumed anything here, teamsCountedToDate stays 0, no
// readiness flag moves, and no host, container, database or release is started. The intake protocol is
// carried by exactly ONE fenced json block in docs/external-consumer-intake.md so it is machine-readable
// and cannot drift from its prose; the reference consumer is builtins-only, imports nothing from this
// repository, runs the materialized P24A diagnose.mjs as its own process FIRST, and only then imports the
// generated module and prints one deterministic sample report. Every refusal exits 1, prints nothing on
// stdout, carries exactly one stable `EXTERNAL_CONSUMER_ERROR:<CODE>` line on stderr, and happens before
// the generated module is ever imported.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTAKE_DOC = "docs/external-consumer-intake.md";
const EXAMPLE_PATH = "examples/external-consumer/reference-consumer.mjs";
const ERROR_PREFIX = "EXTERNAL_CONSUMER_ERROR";
const TAMPER_MARKER = "P24B_TAMPER_SIDE_EFFECT_EXECUTED";
const DIAGNOSTICS_PATH = "diagnose.mjs";

// The whole intake protocol, frozen. Free prose lives outside the block, so this record is closed and is
// compared with one strict deepEqual: only real independent teams count, the four handed-over inputs are
// exact and ordered, ownerHelpCount must be 0 with every help event recorded, hiding owner help falsifies
// the run, and accepted evidence is immutable.
const EXPECTED_INTAKE = Object.freeze({
  schemaVersion: 1,
  id: "external-consumer-intake",
  acceptedParticipant: "real-independent-team",
  neverCounted: ["agent", "employee", "probe", "worker"],
  requiredInputs: [
    { id: "docs", path: INTAKE_DOC },
    { id: "sdk", path: "tools/generate-versioned-action-sdk-distribution.mjs" },
    { id: "example", path: EXAMPLE_PATH },
    { id: "diagnostics", path: "tools/generate-consumer-diagnostics-distribution.mjs" },
  ],
  acceptance: { independentTeams: 3, ownerHelpCount: 0, helpEventsRequired: true },
  helpEvents: { recorded: "every", fields: ["at", "channel", "question", "answer"], omissionIsFalsification: true },
  falsification: [
    { id: "hidden-owner-help", effect: "falsifies-the-run" },
    { id: "non-team-participant", effect: "falsifies-the-run" },
    { id: "mutated-evidence", effect: "falsifies-the-run" },
  ],
  evidence: { immutable: true, digest: "sha256", editableAfterAcceptance: false },
  claims: { externalUsabilityProven: false, teamsCountedToDate: 0, protocolAloneIsProof: false },
});
const REQUIRED_HEADINGS = Object.freeze(["## Who counts", "## Required inputs", "## Owner help", "## Falsification", "## Evidence", "## What this is not"]);
const READINESS_CLAIM = /kernelReady|sdkReady|appBuildable|releaseAllowed|deployAllowed|productionAllowed|gapClosed|runnableProduct|oneGoldenSliceReady|production[- ]?ready/i;
// child_process is REQUIRED here (the reference consumer must run diagnose.mjs as its own process); the
// network, the loader escape hatches and worker threads are not.
const FORBIDDEN_BUILTINS = Object.freeze(["node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:worker_threads", "node:vm", "node:module", "node:repl"]);
const OPTS = Object.freeze({ kind: "command", name: "widget.create", version: 1, fields: Object.freeze(["name", "quantity"]), outcomes: Object.freeze(["created", "rejected"]), errorEnvelopeFields: Object.freeze(["code", "message"]) });

const sampleOf = (fields) => Object.fromEntries(fields.map((field) => [field, `sample-${field}`]));
const readRepoFile = async (relPath) => readFile(path.join(root, relPath), "utf8").catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));
const runExample = (exampleFile, args, cwd) => spawnSync(process.execPath, [exampleFile, ...args], { cwd, env: {}, encoding: "utf8" });

async function canonicalVersion() {
  const value = JSON.parse(await readFile(path.join(root, "versioning-policy.json"), "utf8"))?.currentVersion?.value;
  assert.ok(typeof value === "string" && value.length > 0, "versioning-policy.json must carry a current version");
  return value;
}

async function materialize(prefix, files, dirs) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf8");
  }
  return dir;
}

function cleanupAfter(t) {
  const dirs = [];
  t.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
  return dirs;
}

test("the intake protocol admits only real independent teams, at ownerHelpCount=0 with recorded help events, immutable evidence and no readiness claim", async () => {
  const docText = await readRepoFile(INTAKE_DOC);

  // Exactly one machine-readable block, and it IS the protocol: one closed comparison pins every rule,
  // every value and every key set, in both directions.
  const blocks = [...docText.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, `${INTAKE_DOC} must carry exactly one fenced json protocol block, saw ${blocks.length}`);
  const record = JSON.parse(blocks[0]);
  assert.deepEqual(record, EXPECTED_INTAKE);

  // The four handed-over inputs are not aspirational: each names a file that exists in this repository.
  for (const { id, path: relPath } of record.requiredInputs) {
    assert.ok(existsSync(path.join(root, relPath)), `the ${id} input names ${relPath}, which does not exist in this repository`);
  }

  // The prose carries the same rules in the same order, and claims nothing.
  const prose = docText.replace(/```json\n[\s\S]*?```/g, "");
  let cursor = -1;
  for (const heading of REQUIRED_HEADINGS) {
    const occurrences = prose.split(`\n${heading}\n`).length - 1;
    assert.equal(occurrences, 1, `${INTAKE_DOC} must carry the heading ${heading} exactly once, saw ${occurrences}`);
    const at = prose.indexOf(`\n${heading}\n`);
    assert.ok(at > cursor, `${heading} must appear after ${REQUIRED_HEADINGS[REQUIRED_HEADINGS.indexOf(heading) - 1] ?? "the document start"}`);
    cursor = at;
  }
  for (const token of ["ownerHelpCount", "helpEvents", "falsif", "immutable", "independent"]) {
    assert.ok(prose.includes(token), `${INTAKE_DOC} prose must state ${token} outside the protocol block`);
  }
  assert.ok(!READINESS_CLAIM.test(prose), `${INTAKE_DOC} must move and claim no readiness flag`);
  assert.ok(!/\bproven\b/i.test(prose) || /not\s+prove|is\s+not\s+proof|no\s+team/i.test(prose), `${INTAKE_DOC} must not present the protocol itself as proof`);
});

test("the reference consumer is builtins-only, imports nothing from this repository, runs the materialized P24A diagnose first and prints one deterministic sample report", async (t) => {
  const dirs = cleanupAfter(t);
  const source = await readRepoFile(EXAMPLE_PATH);

  // Source purity: an outside team can copy this one file and run it with nothing installed.
  const imports = [...source.matchAll(/^\s*import\s.+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "the reference consumer must declare imports");
  assert.ok(imports.every((spec) => spec.startsWith("node:")), `the reference consumer must import only node builtins, saw ${imports.join(", ")}`);
  assert.deepEqual(imports.filter((spec) => FORBIDDEN_BUILTINS.includes(spec)), [], "the reference consumer must not reach the network or escape the loader");
  assert.ok(imports.includes("node:child_process"), "the reference consumer must run diagnose.mjs as its own process");
  assert.ok(!/from\s+["'](?!node:)/.test(source), "the reference consumer must resolve no non-builtin specifier");
  assert.ok(!/\.\.\//.test(source) && !source.includes(root), "the reference consumer must contain no repository path");
  assert.ok(!/\brequire\s*\(/.test(source), "the reference consumer must be ESM only");

  const distributionVersion = await canonicalVersion();
  const contract = new ActionContract(OPTS);
  const payload = renderConsumerDiagnosticsDistribution(contract, distributionVersion);
  const payloadDir = await materialize("p24b-payload-", payload.files, dirs);

  // The example is copied OUT of the repository and run from an unrelated working directory, so the
  // payload can only be reached through its argument.
  const exampleDir = await materialize("p24b-example-", { "reference-consumer.mjs": source }, dirs);
  const exampleFile = path.join(exampleDir, "reference-consumer.mjs");
  const neutralCwd = await materialize("p24b-cwd-", {}, dirs);

  // The diagnose report the shipped runner produces on its own, computed here independently.
  const diagnose = spawnSync(process.execPath, [DIAGNOSTICS_PATH, distributionVersion], { cwd: payloadDir, env: {}, encoding: "utf8" });
  assert.equal(diagnose.status, 0, `the P24A runner must be healthy on a clean payload, stderr=${diagnose.stderr}`);
  const diagnostics = JSON.parse(diagnose.stdout);

  const run = runExample(exampleFile, [payloadDir, distributionVersion], neutralCwd);
  assert.equal(run.status, 0, `expected a healthy consumer run, got status=${run.status} stderr=${run.stderr}`);
  assert.equal(run.stderr, "", "a healthy run must be silent on stderr");

  // One exact report: the embedded diagnostics section is the runner's own report byte for byte, which is
  // only obtainable by having run it, and the sample is derived deterministically from the contract.
  assert.deepEqual(JSON.parse(run.stdout), {
    schemaVersion: 1,
    status: "ok",
    coordinate: payload.coordinate,
    distributionVersion,
    action: { kind: contract.kind, name: contract.name, version: contract.version },
    diagnostics,
    sample: {
      request: sampleOf(contract.fields),
      outcome: contract.outcomes[0],
      outcomeAccepted: true,
      errorEnvelope: sampleOf(contract.errorEnvelopeFields),
      errorEnvelopeAccepted: true,
    },
  });
  assert.ok(run.stdout.endsWith("\n"), "the report must end with a newline");
  assert.ok(!run.stdout.includes(os.tmpdir()) && !run.stdout.includes(root), "the report must not leak a host path");
  assert.ok(!READINESS_CLAIM.test(run.stdout), "the report must make no readiness claim");
  assert.equal(runExample(exampleFile, [payloadDir, distributionVersion], neutralCwd).stdout, run.stdout, "the report must be deterministic");
});

test("missing arguments, a failing diagnostics run and a tampered module each refuse with one stable code before the generated module is imported", async (t) => {
  const dirs = cleanupAfter(t);
  const source = await readRepoFile(EXAMPLE_PATH);
  const distributionVersion = await canonicalVersion();
  const payload = renderConsumerDiagnosticsDistribution(new ActionContract(OPTS), distributionVersion);
  const exampleDir = await materialize("p24b-refusal-example-", { "reference-consumer.mjs": source }, dirs);
  const exampleFile = path.join(exampleDir, "reference-consumer.mjs");

  // Every case ships a module whose first statement is an observable side effect. The marker can only
  // appear if the generated module was imported, so its absence proves each refusal came first.
  const CASES = Object.freeze([
    { id: "no arguments at all", code: "MISSING_ARGUMENT", args: () => [] },
    { id: "a payload directory with no expected distribution version", code: "MISSING_ARGUMENT", args: (dir) => [dir] },
    { id: "the payload directory does not exist", code: "DIAGNOSTICS_FAILED", args: (dir) => [`${dir}-absent`, distributionVersion] },
    { id: "the shipped diagnostics runner is absent", code: "DIAGNOSTICS_FAILED", args: (dir) => [dir, distributionVersion], mutate: (dir) => rm(path.join(dir, DIAGNOSTICS_PATH)) },
    { id: "the expected distribution version differs", code: "DIAGNOSTICS_FAILED", args: (dir) => [dir, "0.1.0-alpha.999"] },
    { id: "the manifest diagnostics digest no longer matches the runner", code: "DIAGNOSTICS_FAILED", args: (dir) => [dir, distributionVersion], mutate: async (dir) => {
      const abs = path.join(dir, "manifest.json");
      const manifest = JSON.parse(await readFile(abs, "utf8"));
      manifest.diagnostics = `sha256:${"0".repeat(64)}`;
      await writeFile(abs, `${JSON.stringify(manifest)}\n`, "utf8");
    } },
    { id: "the generated module bytes are tampered", code: "DIAGNOSTICS_FAILED", args: (dir) => [dir, distributionVersion] },
  ]);

  for (const { id, code, args, mutate } of CASES) {
    const dir = await materialize("p24b-refusal-", payload.files, dirs);
    const abs = path.join(dir, payload.modulePath);
    await writeFile(abs, `console.log(${JSON.stringify(TAMPER_MARKER)});\n${await readFile(abs, "utf8")}`, "utf8");
    if (mutate) await mutate(dir);

    const result = runExample(exampleFile, args(dir), dir);
    const where = `case: ${id}`;
    assert.equal(result.status, 1, `${where} must exit 1, got status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(result.stdout, "", `${where} must emit no report on stdout`);
    assert.deepEqual([...result.stderr.matchAll(new RegExp(`${ERROR_PREFIX}:([A-Z_]+)`, "g"))].map((m) => m[1]), [code], `${where} must emit exactly one stable code`);
    assert.match(result.stderr, new RegExp(`^${ERROR_PREFIX}:${code}\\s`, "m"), `${where} must anchor its code at the start of a stderr line`);
    assert.ok(!(result.stdout + result.stderr).includes(TAMPER_MARKER), `${where} must refuse before the generated module is imported`);
  }
});
