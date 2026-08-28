import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
//
// P24CR — handover repair. P24C measured that handover and found it not closed: the four declared inputs
// do not carry the type the generator demands, nor the renderer that generator imports, and no declared
// file ever puts payload bytes on disk, so a team following the protocol could not reach the reference
// consumer at all. MASTER authorized an ADDITION-ONLY amendment, and its shape is deliberately narrow:
// the fenced protocol block changes in exactly ONE way — three entries are APPENDED to `requiredInputs`,
// for the contract type, its renderer and one materializer CLI. No key is added to that block, none is
// removed, reworded or reordered, and no acceptance number moves. Everything a team must LEARN — the type
// it constructs, the six rules that type enforces, the payload layout and the CLI's usage — is written in
// the document's PROSE, where the protocol has always said the prose restates and adds no rule the block
// omits. teamsCountedToDate is still 0, external usability is still unproven, and the amendment starts no
// host, container, database or release. Test 1 pins the amended block and the prose that carries the
// rules, tests 2 and 3 are the merged P24B expectations preserved byte for byte, and test 4 is the
// repair's own proof: seven declared files, a contract JSON, the CLI, then the consumer — nothing else in
// the tree, and nothing verbal.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTAKE_DOC = "docs/external-consumer-intake.md";
const EXAMPLE_PATH = "examples/external-consumer/reference-consumer.mjs";
const SDK_PATH = "tools/generate-versioned-action-sdk-distribution.mjs";
const DIAGNOSTICS_GENERATOR = "tools/generate-consumer-diagnostics-distribution.mjs";
const CONTRACT_MODULE = "src/application/action-contract.mjs";
const RENDERER_PATH = "tools/generate-action-sdk.mjs";
const MATERIALIZER_PATH = "tools/materialize-distribution-payload.mjs";
const ERROR_PREFIX = "EXTERNAL_CONSUMER_ERROR";
const MATERIALIZE_PREFIX = "MATERIALIZE_ERROR";
const TAMPER_MARKER = "P24B_TAMPER_SIDE_EFFECT_EXECUTED";
const DIAGNOSTICS_PATH = "diagnose.mjs";

// The whole intake protocol, frozen. Free prose lives outside the block, so this record is closed and is
// compared with one strict deepEqual: only real independent teams count, the seven handed-over inputs are
// exact and ordered, ownerHelpCount must be 0 with every help event recorded, hiding owner help falsifies
// the run, and accepted evidence is immutable. The amendment is visible here as append-only and nothing
// else: the first four requiredInputs entries and every other key carry exactly the values the merged
// P24B test froze, and the block gains no new key.
const EXPECTED_INTAKE = Object.freeze({
  schemaVersion: 1,
  id: "external-consumer-intake",
  acceptedParticipant: "real-independent-team",
  neverCounted: ["agent", "employee", "probe", "worker"],
  requiredInputs: [
    { id: "docs", path: INTAKE_DOC },
    { id: "sdk", path: SDK_PATH },
    { id: "example", path: EXAMPLE_PATH },
    { id: "diagnostics", path: DIAGNOSTICS_GENERATOR },
    { id: "contract", path: CONTRACT_MODULE },
    { id: "renderer", path: RENDERER_PATH },
    { id: "materializer", path: MATERIALIZER_PATH },
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

// --- what the PROSE must teach, because the block may not carry it -----------------------------------
// The type the handed-over generator demands, its six rules, the payload layout and the CLI's usage are
// documentation, not protocol record: they belong to the prose. Each rule is one bullet naming the option
// it governs, the six bullets appear in the type's own declared order, and each states what it requires.
// A bullet whose tokens went missing is a rule a reading team cannot follow.
const CONTRACT_TYPE = "ActionContract";
const CONTRACT_RULE_TOKENS = Object.freeze({
  kind: Object.freeze(["command", "query"]),
  name: Object.freeze(["dotted", "two segments", "128"]),
  version: Object.freeze(["safe integer", "at least 1"]),
  fields: Object.freeze(["ordered", "unique", "identifier"]),
  outcomes: Object.freeze(["ordered", "unique", "at least one"]),
  errorEnvelopeFields: Object.freeze(["ordered", "unique", "identifier"]),
});
const IDENTIFIER_GRAMMAR = "^[A-Za-z][A-Za-z0-9_]*$";
const REFUSED_IDENTIFIERS = Object.freeze(["__proto__", "constructor", "prototype"]);
const EXACT_OPTIONS_PHRASE = "exactly these six options";
const MATERIALIZE_USAGE = "node tools/materialize-distribution-payload.mjs <contract-json> <distribution-version> <existing-empty-target-directory>";
const PAYLOAD_LAYOUT = Object.freeze(["manifest.json", "diagnose.mjs", "actions/<name>/v<version>.mjs"]);
const MATERIALIZE_CODES = Object.freeze(["MISSING_ARGUMENT", "CONTRACT_UNREADABLE", "CONTRACT_REFUSED", "TARGET_NOT_EMPTY", "PATH_ESCAPE"]);
// The type's own declared option list, read out of the module rather than copied, so the documented rules
// are checked against the type instead of against a second copy of the same belief.
const OPTION_LIST = /const OPTIONS = \[([^\]]*)\]/;
const QUOTED = /"([^"]+)"/g;
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"'\n]+)["']/g;

// An adversarial stand-in for the diagnostics generator, written ONLY into a copied temp handover so the
// path-escape refusal can be measured at all. This repository's own generator is never touched, and this
// stand-in never lands anywhere but a temporary directory this test removes.
const ESCAPING_GENERATOR = [
  "export function renderConsumerDiagnosticsDistribution(contract, distributionVersion) {",
  "  return Object.freeze({",
  '    coordinate: contract.name + "@" + contract.version,',
  "    distributionVersion,",
  '    manifestPath: "manifest.json",',
  '    modulePath: "actions/" + contract.name + "/v" + contract.version + ".mjs",',
  '    diagnosticsPath: "diagnose.mjs",',
  '    files: Object.freeze({ "../escaped-outside-the-target.mjs": "export const escaped = true;\\n" }),',
  "  });",
  "}",
].join("\n");
const ESCAPED_FILE = "escaped-outside-the-target.mjs";

const sampleOf = (fields) => Object.fromEntries(fields.map((field) => [field, `sample-${field}`]));
const readRepoFile = async (relPath) => readFile(path.join(root, relPath), "utf8").catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));
const runExample = (exampleFile, args, cwd) => spawnSync(process.execPath, [exampleFile, ...args], { cwd, env: {}, encoding: "utf8" });
const runCli = (cli, args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, env: {}, encoding: "utf8" });

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

// One rule bullet, read out of the prose: from its own marker to the next bullet or the end of the list.
function ruleBulletOf(prose, option) {
  const marker = `\n- \`${option}\` — `;
  const occurrences = prose.split(marker).length - 1;
  assert.equal(occurrences, 1, `${INTAKE_DOC} must carry exactly one rule bullet for ${option}, saw ${occurrences}`);
  const at = prose.indexOf(marker);
  const rest = prose.slice(at + 1);
  const nextBullet = rest.indexOf("\n- ");
  const endOfList = rest.indexOf("\n\n");
  const ends = [nextBullet, endOfList].filter((index) => index >= 0);
  return { at, text: rest.slice(0, ends.length === 0 ? rest.length : Math.min(...ends)) };
}

test("the intake protocol admits only real independent teams, at ownerHelpCount=0 with recorded help events, immutable evidence and no readiness claim", async () => {
  const docText = await readRepoFile(INTAKE_DOC);

  // Exactly one machine-readable block, and it IS the protocol: one closed comparison pins every rule,
  // every value and every key set, in both directions. The amendment is append-only inside requiredInputs
  // and adds no key here, so a rule that grew in the prose cannot quietly become protocol record.
  const blocks = [...docText.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, `${INTAKE_DOC} must carry exactly one fenced json protocol block, saw ${blocks.length}`);
  const record = JSON.parse(blocks[0]);
  assert.deepEqual(record, EXPECTED_INTAKE);

  // The seven handed-over inputs are not aspirational: each names a file that exists in this repository.
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

  // The type a team must construct, named in the prose along with the module that defines it and the
  // renderer that demands it. A handover that ships a type nobody is told about ships a puzzle.
  assert.ok(prose.includes(CONTRACT_TYPE), `${INTAKE_DOC} prose must name the ${CONTRACT_TYPE} type the generator demands`);
  for (const relPath of [CONTRACT_MODULE, RENDERER_PATH, MATERIALIZER_PATH]) {
    assert.ok(prose.includes(relPath), `${INTAKE_DOC} prose must name the appended input ${relPath}`);
  }

  // All six rules, in the type's OWN declared order, read out of the module rather than copied here: a
  // documented rule set that drifted from the type would be documentation of nothing.
  const contractSource = await readRepoFile(CONTRACT_MODULE);
  const declaredOptions = [...(OPTION_LIST.exec(contractSource)?.[1] ?? "").matchAll(QUOTED)].map((m) => m[1]);
  assert.deepEqual(declaredOptions, Object.keys(CONTRACT_RULE_TOKENS), `${CONTRACT_MODULE} must declare exactly the six options this document teaches, in this order`);
  let ruleCursor = -1;
  for (const option of declaredOptions) {
    const { at, text } = ruleBulletOf(prose, option);
    assert.ok(at > ruleCursor, `the ${option} rule must appear in the type's own option order`);
    ruleCursor = at;
    for (const token of CONTRACT_RULE_TOKENS[option]) {
      assert.ok(text.includes(token), `the ${option} rule must state ${token}, saw: ${text.trim()}`);
    }
  }
  assert.ok(prose.includes(IDENTIFIER_GRAMMAR), `${INTAKE_DOC} prose must state the identifier grammar the three lists enforce`);
  for (const refused of REFUSED_IDENTIFIERS) {
    assert.ok(prose.includes(refused), `${INTAKE_DOC} prose must state that ${refused} is refused as an identifier`);
  }
  assert.ok(prose.includes(EXACT_OPTIONS_PHRASE), `${INTAKE_DOC} prose must state that the object carries ${EXACT_OPTIONS_PHRASE} and no other`);

  // The exact payload layout a team ends up holding, and the exact command that produces it.
  for (const entry of PAYLOAD_LAYOUT) {
    assert.ok(prose.includes(entry), `${INTAKE_DOC} prose must state that the materialized payload carries ${entry}`);
  }
  assert.equal(prose.split(MATERIALIZE_USAGE).length - 1, 1, `${INTAKE_DOC} prose must carry the materializer usage line exactly once, verbatim`);
  assert.ok(prose.includes(`${MATERIALIZE_PREFIX}:<CODE>`), `${INTAKE_DOC} prose must state the ${MATERIALIZE_PREFIX}:<CODE> refusal shape`);
  for (const code of MATERIALIZE_CODES) {
    assert.ok(prose.includes(code), `${INTAKE_DOC} prose must name the stable refusal code ${code}`);
  }

  // Documenting a handover is still not evidence that anyone outside used it.
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

test("a team holding only the seven declared inputs writes a contract JSON, materializes the payload into an empty directory with the handed-over CLI, and the reference consumer accepts exactly what that CLI wrote", async (t) => {
  const dirs = cleanupAfter(t);
  const distributionVersion = await canonicalVersion();
  const cliSource = await readRepoFile(MATERIALIZER_PATH);
  const declaredPaths = EXPECTED_INTAKE.requiredInputs.map((input) => input.path);

  // CLI purity. The materializer is the one handed-over file that touches the disk, so what it may reach
  // is stated exactly: node builtins, and relative specifiers that resolve to OTHER declared inputs and to
  // nothing else. A step that quietly imported an eighth repository file would move the gap, not close it.
  // It reads no ambient environment, so its behaviour is its three arguments and nothing besides.
  const specifiers = [...cliSource.matchAll(SPECIFIER)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, `${MATERIALIZER_PATH} must declare the modules it uses`);
  assert.deepEqual(specifiers.filter((spec) => FORBIDDEN_BUILTINS.includes(spec)), [], `${MATERIALIZER_PATH} must not reach the network or escape the loader`);
  const relative = specifiers.filter((spec) => !spec.startsWith("node:"));
  for (const spec of relative) {
    assert.match(spec, /^\.{1,2}\//, `${MATERIALIZER_PATH} must resolve no bare specifier, saw ${spec}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(MATERIALIZER_PATH), spec));
    assert.ok(declaredPaths.includes(resolved), `${MATERIALIZER_PATH} imports ${resolved}, which the protocol does not hand over`);
  }
  assert.ok(relative.some((spec) => path.posix.normalize(path.posix.join("tools", spec)) === DIAGNOSTICS_GENERATOR), `${MATERIALIZER_PATH} must materialize the diagnostics distribution, not a payload of its own`);
  assert.ok(!/\brequire\s*\(/.test(cliSource), `${MATERIALIZER_PATH} must be ESM only`);
  assert.ok(!/process\.env\s*\./.test(cliSource), `${MATERIALIZER_PATH} must not read the ambient environment`);
  assert.ok(!cliSource.includes(root), `${MATERIALIZER_PATH} must contain no absolute repository path`);
  assert.ok(!READINESS_CLAIM.test(cliSource), `${MATERIALIZER_PATH} must claim no readiness`);

  // The team's whole world: exactly the seven declared files, copied byte for byte out of this repository
  // at their declared paths, and nothing else. No node_modules, no package.json, no repository around it.
  const handover = {};
  for (const relPath of declaredPaths) handover[relPath] = await readRepoFile(relPath);
  const teamDir = await materialize("p24cr-handover-", handover, dirs);
  const cli = path.join(teamDir, MATERIALIZER_PATH);
  const consumer = path.join(teamDir, EXAMPLE_PATH);
  const neutralCwd = await materialize("p24cr-cwd-", {}, dirs);

  // The contract JSON a doc-following team writes, carrying exactly the six documented options.
  const contractFile = path.join(teamDir, "widget-create.contract.json");
  await writeFile(contractFile, `${JSON.stringify({ ...OPTS }, null, 2)}\n`, "utf8");

  // The target already exists and is empty: the CLI is handed a directory, it does not invent one.
  const payloadDir = path.join(teamDir, "payload");
  await mkdir(payloadDir, { recursive: true });
  const materializeRun = runCli(cli, [contractFile, distributionVersion, payloadDir], teamDir);
  assert.equal(materializeRun.status, 0, `the materializer must complete, got status=${materializeRun.status} stderr=${materializeRun.stderr}`);
  assert.equal(materializeRun.stderr, "", "a completed materialization must be silent on stderr");

  // One deterministic line naming what it wrote, in payload-relative paths sorted lexicographically: a
  // team can read it, and it carries no host path to leak.
  assert.deepEqual(JSON.parse(materializeRun.stdout), {
    schemaVersion: 1,
    status: "materialized",
    coordinate: "widget.create@1",
    distributionVersion,
    files: ["actions/widget.create/v1.mjs", "diagnose.mjs", "manifest.json"],
  });
  assert.ok(materializeRun.stdout.endsWith("\n"), "the materializer report must end with a newline");
  assert.ok(!materializeRun.stdout.includes(teamDir) && !materializeRun.stdout.includes(os.tmpdir()) && !materializeRun.stdout.includes(root), "the materializer must not leak a host path");
  assert.ok(!READINESS_CLAIM.test(materializeRun.stdout), "the materializer must make no readiness claim");

  // What landed on disk is the generator's own file map, byte for byte. The CLI supplies the missing
  // STEP; it does not get to supply a payload of its own.
  const expected = renderConsumerDiagnosticsDistribution(new ActionContract(OPTS), distributionVersion);
  for (const [relPath, contents] of Object.entries(expected.files)) {
    assert.equal(await readFile(path.join(payloadDir, relPath), "utf8"), contents, `${relPath} must be the generated bytes, unmodified`);
  }

  // Deterministic: the same contract JSON into a second empty directory produces the same report.
  const againDir = path.join(teamDir, "payload-again");
  await mkdir(againDir, { recursive: true });
  assert.equal(runCli(cli, [contractFile, distributionVersion, againDir], teamDir).stdout, materializeRun.stdout, "the materializer report must be deterministic");

  // The handover is closed: the reference consumer, run from an unrelated working directory over what the
  // CLI wrote, is healthy and prints one report. Nothing verbal, nothing improvised, no owner in the room.
  const run = runExample(consumer, [payloadDir, distributionVersion], neutralCwd);
  assert.equal(run.status, 0, `the consumer must accept the materialized payload, got status=${run.status} stderr=${run.stderr}`);
  assert.equal(run.stderr, "", "a healthy consumer run must be silent on stderr");
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, "ok");
  assert.equal(report.coordinate, "widget.create@1");
  assert.equal(report.distributionVersion, distributionVersion);
  assert.deepEqual(report.action, { kind: "command", name: "widget.create", version: 1 });
  assert.deepEqual(report.sample, {
    request: sampleOf(OPTS.fields),
    outcome: OPTS.outcomes[0],
    outcomeAccepted: true,
    errorEnvelope: sampleOf(OPTS.errorEnvelopeFields),
    errorEnvelopeAccepted: true,
  });
  assert.ok(!run.stdout.includes(teamDir) && !run.stdout.includes(root), "the consumer report must not leak a host path");
  assert.ok(!READINESS_CLAIM.test(run.stdout), "the consumer report must make no readiness claim");

  // Stable refusals, in the same shape the reference consumer already uses: exit 1, nothing on stdout,
  // exactly one anchored code, and NOTHING written — a refused run leaves no half-payload behind for a
  // team to mistake for a good one, and it never touches a target that already holds something. Each case
  // is decided by one condition only: where a case is not about the target, it is handed a real empty one.
  const SENTINEL = "keep-me\n";
  const CASES = Object.freeze([
    { id: "no arguments at all", code: "MISSING_ARGUMENT", argv: () => [] },
    { id: "a contract with no distribution version", code: "MISSING_ARGUMENT", argv: (contract) => [contract] },
    { id: "a contract and a version with no target directory", code: "MISSING_ARGUMENT", argv: (contract) => [contract, distributionVersion] },
    { id: "the contract file does not exist", code: "CONTRACT_UNREADABLE", argv: (contract, target) => [`${contract}-absent`, distributionVersion, target] },
    { id: "the contract file is not JSON", code: "CONTRACT_UNREADABLE", contract: "this is not json\n" },
    { id: "the contract JSON is not an object", code: "CONTRACT_UNREADABLE", contract: '["widget.create"]\n' },
    { id: "the contract breaks the name rule", code: "CONTRACT_REFUSED", contract: JSON.stringify({ ...OPTS, name: "widget" }) },
    { id: "the contract breaks the identifier rule", code: "CONTRACT_REFUSED", contract: JSON.stringify({ ...OPTS, fields: ["name", "constructor"] }) },
    { id: "the contract carries an option the type does not have", code: "CONTRACT_REFUSED", contract: JSON.stringify({ ...OPTS, extra: true }) },
    { id: "the contract omits a required option", code: "CONTRACT_REFUSED", contract: JSON.stringify({ ...OPTS, outcomes: undefined }) },
    { id: "the target directory already holds a file", code: "TARGET_NOT_EMPTY", occupied: true },
    { id: "the target directory does not exist", code: "TARGET_NOT_EMPTY", absentTarget: true },
  ]);

  for (const { id, code, argv, contract, occupied, absentTarget } of CASES) {
    const caseDir = await materialize("p24cr-refusal-", { "contract.json": contract ?? JSON.stringify({ ...OPTS }) }, dirs);
    const caseContract = path.join(caseDir, "contract.json");
    const target = path.join(caseDir, "target");
    if (!absentTarget) await mkdir(target, { recursive: true });
    if (occupied) await writeFile(path.join(target, "keep-me.txt"), SENTINEL, "utf8");

    const result = runCli(cli, argv ? argv(caseContract, target) : [caseContract, distributionVersion, target], caseDir);
    const where = `case: ${id}`;
    assert.equal(result.status, 1, `${where} must exit 1, got status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(result.stdout, "", `${where} must emit no report on stdout`);
    assert.deepEqual([...result.stderr.matchAll(new RegExp(`${MATERIALIZE_PREFIX}:([A-Z_]+)`, "g"))].map((m) => m[1]), [code], `${where} must emit exactly one stable code`);
    assert.match(result.stderr, new RegExp(`^${MATERIALIZE_PREFIX}:${code}\\s`, "m"), `${where} must anchor its code at the start of a stderr line`);
    if (absentTarget) {
      assert.ok(!existsSync(target), `${where} must not create the directory it was told already exists`);
    } else {
      assert.deepEqual(await readdir(target), occupied ? ["keep-me.txt"] : [], `${where} must leave the target exactly as it found it`);
    }
  }

  // PATH_ESCAPE, measured on a COPIED handover whose diagnostics generator is replaced by an adversarial
  // stand-in returning a payload-relative path that climbs out of the target. This repository's own
  // generator is never touched; the stand-in exists only inside a temporary directory. Every path is
  // checked BEFORE any byte is written, so a payload that would escape leaves the target untouched.
  const escapeDir = await materialize("p24cr-escape-", { ...handover, [DIAGNOSTICS_GENERATOR]: ESCAPING_GENERATOR, "contract.json": JSON.stringify({ ...OPTS }) }, dirs);
  const escapeTarget = path.join(escapeDir, "target");
  await mkdir(escapeTarget, { recursive: true });
  const escaped = runCli(path.join(escapeDir, MATERIALIZER_PATH), [path.join(escapeDir, "contract.json"), distributionVersion, escapeTarget], escapeDir);
  assert.equal(escaped.status, 1, `an escaping payload path must exit 1, got status=${escaped.status} stdout=${escaped.stdout} stderr=${escaped.stderr}`);
  assert.equal(escaped.stdout, "", "an escaping payload path must emit no report on stdout");
  assert.deepEqual([...escaped.stderr.matchAll(new RegExp(`${MATERIALIZE_PREFIX}:([A-Z_]+)`, "g"))].map((m) => m[1]), ["PATH_ESCAPE"], "an escaping payload path must emit exactly one stable code");
  assert.match(escaped.stderr, new RegExp(`^${MATERIALIZE_PREFIX}:PATH_ESCAPE\\s`, "m"), "the escape refusal must anchor its code at the start of a stderr line");
  assert.deepEqual(await readdir(escapeTarget), [], "an escaping payload path must leave the target empty");
  assert.ok(!existsSync(path.join(escapeDir, ESCAPED_FILE)), "nothing may be written outside the target the CLI was handed");
});
