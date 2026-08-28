import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderVersionedActionSdkDistribution } from "../tools/generate-versioned-action-sdk-distribution.mjs";

// P24A — consumer diagnostics. P09 proved ONE clean, builtins-only process can accept or refuse a real
// P08 distribution payload, but that fixture lives under tests/fixtures and an outside consumer never
// receives it. This frozen test owns every expectation for the package that ships it: the payload gains
// an ADDITIVE `diagnose.mjs` plus a `manifest.diagnostics` hash binding that runner's exact bytes to the
// payload, while legacy `manifest.integrity` keeps its exact P08 value and the UNCHANGED P09 fixture
// still runs GREEN. P08's own merged test freezes its manifest text byte-for-byte, so this package MUST
// NOT edit that generator: diagnostics come from a separate additive wrapper module. Frozen digest =
// sha256 over JSON.stringify in exactly this key order: {"schemaVersion":1,"distributionVersion":…,
// "coordinate":…,"integrity":…,"diagnosticsPath":…,"diagnosticsSource":…}. Refusals run in CHECK_NAMES
// order, always BEFORE the module is evaluated, print nothing on stdout, exit 1, and carry exactly one
// stable `CONSUMER_DIAGNOSTICS_ERROR:<CODE>` line on stderr. This is NOT P24: it proves no external,
// independent or counted consumer team, moves no readiness flag (all still false), starts no host,
// container or database, and the runner may emit no readiness vocabulary at all.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR_PATH = "tools/generate-consumer-diagnostics-distribution.mjs";
const GENERATOR_EXPORT = "renderConsumerDiagnosticsDistribution";
const DIAGNOSTICS_PATH = "diagnose.mjs";
const LEGACY_P09_FIXTURE = path.join(root, "tests", "fixtures", "versioned-sdk-clean-consumer.mjs");
const ERROR_PREFIX = "CONSUMER_DIAGNOSTICS_ERROR";
const TAMPER_MARKER = "P24A_TAMPER_SIDE_EFFECT_EXECUTED";

// Ordered gates, each the single named source of one code: manifest_present/module_present ->
// MISSING_FILE, manifest_parsed/manifest_shape -> MALFORMED_MANIFEST, distribution_version ->
// VERSION_MISMATCH, *_path_safety -> UNSAFE_PATH, module_integrity -> INTEGRITY_MISMATCH,
// diagnostics_integrity -> DIAGNOSTICS_MISMATCH, module_evaluation -> MODULE_EVALUATION_FAILED.
const CHECK_NAMES = Object.freeze(["manifest_present", "manifest_parsed", "manifest_shape", "distribution_version", "module_path_safety", "diagnostics_path_safety", "module_present", "module_integrity", "diagnostics_integrity", "module_evaluation"]);
const FORBIDDEN_BUILTINS = Object.freeze(["node:child_process", "node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:worker_threads", "node:vm", "node:module", "node:repl"]);
const READINESS_CLAIM = /kernelReady|sdkReady|appBuildable|releaseAllowed|deployAllowed|productionAllowed|gapClosed|runnableProduct|oneGoldenSliceReady|production[- ]?ready|independent\s+consumer|consumer\s+team/i;
const OPTS_COMMAND = Object.freeze({ kind: "command", name: "widget.create", version: 1, fields: Object.freeze(["name", "quantity"]), outcomes: Object.freeze(["created", "rejected"]), errorEnvelopeFields: Object.freeze(["code", "message"]) });
const OPTS_QUERY = Object.freeze({ kind: "query", name: "widget.list.byowner", version: 3, fields: Object.freeze(["ownerId", "cursor", "limit"]), outcomes: Object.freeze(["found", "empty", "invalid"]), errorEnvelopeFields: Object.freeze(["code", "message", "details"]) });
const assertNoClaim = (text, what) => assert.ok(!READINESS_CLAIM.test(text), `${what} must make no team or readiness claim`);
const readManifest = async (dir) => JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
const writeManifest = (dir, manifest) => writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
const editManifest = async (dir, edit) => { const manifest = await readManifest(dir); edit(manifest); await writeManifest(dir, manifest); };
const runDiagnose = (dir, args) => spawnSync(process.execPath, [DIAGNOSTICS_PATH, ...args], { cwd: dir, env: {}, encoding: "utf8" });

async function canonicalVersions() {
  const canonicalVersion = JSON.parse(await readFile(path.join(root, "versioning-policy.json"), "utf8"))?.currentVersion?.value;
  const match = /^(.*\.)(\d+)$/.exec(canonicalVersion ?? "");
  assert.ok(match, `expected a trailing numeric train counter on ${canonicalVersion}`);
  return { canonicalVersion, alternateVersion: `${match[1]}${Number(match[2]) + 1}` };
}

// Loaded lazily so each test reports its own explicit RED while the generator is still absent.
async function loadRender() {
  const mod = await import(pathToFileURL(path.join(root, GENERATOR_PATH)).href).catch((cause) => assert.fail(`${GENERATOR_PATH} is absent or fails to load: ${cause?.message ?? cause}`));
  assert.equal(typeof mod[GENERATOR_EXPORT], "function", `${GENERATOR_PATH} must export ${GENERATOR_EXPORT}`);
  assert.equal(mod[GENERATOR_EXPORT].length, 2, `${GENERATOR_EXPORT} takes (contract, distributionVersion)`);
  assert.equal(mod.default, undefined, `${GENERATOR_PATH} must have no default export`);
  return mod[GENERATOR_EXPORT];
}

// The frozen diagnostics digest formula, recomputed independently of the implementation.
function expectedDiagnosticsDigest(distributionVersion, coordinate, integrity, diagnosticsSource) {
  const digestInput = JSON.stringify({ schemaVersion: 1, distributionVersion, coordinate, integrity, diagnosticsPath: DIAGNOSTICS_PATH, diagnosticsSource });
  return `sha256:${createHash("sha256").update(digestInput, "utf8").digest("hex")}`;
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

test("diagnose.mjs and manifest.diagnostics are purely additive: the legacy P08 integrity and the P09 clean consumer both stay compatible", async (t) => {
  const render = await loadRender();
  const { canonicalVersion, alternateVersion } = await canonicalVersions();
  const dirs = cleanupAfter(t);

  for (const [opts, distributionVersion] of [[OPTS_COMMAND, canonicalVersion], [OPTS_QUERY, alternateVersion]]) {
    const contract = new ActionContract(opts);
    const legacy = renderVersionedActionSdkDistribution(contract, distributionVersion);
    const legacyManifest = JSON.parse(legacy.files["manifest.json"]);
    const payload = render(contract, distributionVersion);

    // Additive payload shape: the P08 coordinates survive verbatim and exactly one file is added.
    assert.deepEqual(Object.keys(payload).sort(), ["coordinate", "diagnosticsPath", "distributionVersion", "files", "manifestPath", "modulePath"]);
    assert.deepEqual(
      { coordinate: payload.coordinate, distributionVersion: payload.distributionVersion, manifestPath: payload.manifestPath, modulePath: payload.modulePath, diagnosticsPath: payload.diagnosticsPath },
      { coordinate: legacy.coordinate, distributionVersion, manifestPath: legacy.manifestPath, modulePath: legacy.modulePath, diagnosticsPath: DIAGNOSTICS_PATH },
    );
    assert.deepEqual(Object.keys(payload.files).sort(), [...Object.keys(legacy.files), DIAGNOSTICS_PATH].sort());
    assert.equal(payload.files[payload.modulePath], legacy.files[legacy.modulePath], "the generated module must stay byte-identical to P08");

    // The manifest is EXACTLY the legacy manifest plus the two new keys: every legacy value, integrity
    // included, is unchanged, and the new hash matches the frozen formula and is not the integrity.
    const manifestText = payload.files["manifest.json"];
    assert.ok(manifestText.endsWith("\n"), "manifest text must end with a newline");
    const manifest = JSON.parse(manifestText);
    const diagnostics = expectedDiagnosticsDigest(distributionVersion, legacyManifest.coordinate, legacyManifest.integrity, payload.files[DIAGNOSTICS_PATH]);
    assert.deepEqual(manifest, { ...legacyManifest, diagnosticsPath: DIAGNOSTICS_PATH, diagnostics });
    assert.match(manifest.diagnostics, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(manifest.diagnostics, manifest.integrity);

    // Deeply frozen and deterministic, exactly as P08 is.
    assert.ok(Object.isFrozen(payload) && Object.isFrozen(payload.files) && Object.getPrototypeOf(payload.files) === Object.prototype);
    assert.throws(() => { payload.files[DIAGNOSTICS_PATH] = "tampered"; }, TypeError);
    assert.deepEqual(render(new ActionContract(opts), distributionVersion).files, payload.files, "identical inputs must render identical bytes");

    // The UNCHANGED P09 clean-consumer fixture still runs GREEN against the augmented payload.
    const dir = await materialize("p24a-legacy-p09-", payload.files, dirs);
    await writeFile(path.join(dir, "consumer.mjs"), await readFile(LEGACY_P09_FIXTURE, "utf8"), "utf8");
    const run = spawnSync(process.execPath, ["consumer.mjs", distributionVersion], { cwd: dir, env: {}, encoding: "utf8" });
    assert.equal(run.status, 0, `P09 fixture must stay compatible, got status=${run.status} stderr=${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.manifest, { coordinate: legacy.coordinate, distributionVersion });
    assert.deepEqual(report.action, { kind: contract.kind, name: contract.name, version: contract.version });
    assert.deepEqual(report.module, { modulePath: legacy.modulePath, buildActionSpecOk: true, isOutcomeOk: true, isErrorEnvelopeOk: true });
  }
});

test("the shipped diagnose.mjs is builtins-only and emits one deterministic healthy JSON report from a clean process", async (t) => {
  const render = await loadRender();
  const { canonicalVersion, alternateVersion } = await canonicalVersions();
  const dirs = cleanupAfter(t);

  // Source purity: node builtins only, no repository coupling, no network, no subprocess, no claim.
  const source = render(new ActionContract(OPTS_COMMAND), canonicalVersion).files[DIAGNOSTICS_PATH];
  const imports = [...source.matchAll(/^\s*import\s.+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "diagnose.mjs must declare imports");
  assert.ok(imports.every((spec) => spec.startsWith("node:")), `diagnose.mjs must import only node builtins, saw ${imports.join(", ")}`);
  assert.deepEqual(imports.filter((spec) => FORBIDDEN_BUILTINS.includes(spec)), [], "diagnose.mjs must not reach the network or spawn a process");
  assert.ok(!/\.\.\//.test(source) && !source.includes(root), "diagnose.mjs must contain no repository path or relative import");
  assert.ok(!/\brequire\s*\(/.test(source), "diagnose.mjs must be ESM only");
  assertNoClaim(source, "diagnose.mjs");

  for (const [opts, distributionVersion] of [[OPTS_COMMAND, canonicalVersion], [OPTS_QUERY, alternateVersion]]) {
    const contract = new ActionContract(opts);
    const payload = render(contract, distributionVersion);
    const manifest = JSON.parse(payload.files["manifest.json"]);
    const dir = await materialize("p24a-healthy-", payload.files, dirs);

    // A clean payload root: three files, nothing installed, nothing resolved outside it.
    assert.deepEqual((await readdir(dir)).sort(), ["actions", DIAGNOSTICS_PATH, "manifest.json"]);

    const result = runDiagnose(dir, [distributionVersion]);
    assert.equal(result.status, 0, `expected a healthy exit, got status=${result.status} stderr=${result.stderr}`);
    assert.equal(result.stderr, "", "a healthy run must be silent on stderr");

    // One exact report: strict deepEqual pins every key set, every value and every type, and the frozen
    // gate order, in both directions.
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      status: "healthy",
      coordinate: payload.coordinate,
      distributionVersion,
      action: { kind: contract.kind, name: contract.name, version: contract.version },
      integrity: { declared: manifest.integrity, computed: manifest.integrity, ok: true },
      diagnostics: { declared: manifest.diagnostics, computed: manifest.diagnostics, diagnosticsPath: DIAGNOSTICS_PATH, ok: true },
      module: { modulePath: payload.modulePath, evaluated: true, exportsOk: true, outcomesOk: true, errorEnvelopeOk: true },
      checks: CHECK_NAMES.map((name) => ({ name, ok: true })),
    });

    // Portable evidence: no host path leaks, nothing is claimed, and the same payload repeats byte for byte.
    assert.ok(!result.stdout.includes(dir) && !result.stdout.includes(os.tmpdir()), "the report must not leak a host path");
    assertNoClaim(result.stdout, "the diagnostics report");
    assert.equal(runDiagnose(dir, [distributionVersion]).stdout, result.stdout, "the report must be deterministic");
  }
});

test("malformed, missing, unsafe and tampered payloads each refuse with one stable code before the module is evaluated", async (t) => {
  const render = await loadRender();
  const { canonicalVersion } = await canonicalVersions();
  const dirs = cleanupAfter(t);

  // `tamper` prepends an observable side effect to the generated module. For every case whose expected
  // gate sits BEFORE `module_integrity`, the marker proves the refusal happened without the module ever
  // being read or evaluated; for the INTEGRITY_MISMATCH case it is the tampering itself.
  const CASES = Object.freeze([
    { id: "manifest is not JSON", code: "MALFORMED_MANIFEST", tamper: true, mutate: (dir) => writeFile(path.join(dir, "manifest.json"), "{not json", "utf8") },
    { id: "manifest decodes to an array", code: "MALFORMED_MANIFEST", tamper: true, mutate: (dir) => writeFile(path.join(dir, "manifest.json"), "[]\n", "utf8") },
    { id: "manifest.diagnostics absent", code: "MALFORMED_MANIFEST", tamper: true, mutate: (dir) => editManifest(dir, (m) => delete m.diagnostics) },
    { id: "manifest.diagnosticsPath absent", code: "MALFORMED_MANIFEST", tamper: true, mutate: (dir) => editManifest(dir, (m) => delete m.diagnosticsPath) },
    { id: "manifest.diagnostics is not a sha256 digest", code: "MALFORMED_MANIFEST", tamper: true, mutate: (dir) => editManifest(dir, (m) => { m.diagnostics = `md5:${"0".repeat(32)}`; }) },
    { id: "expected distribution version differs", code: "VERSION_MISMATCH", tamper: true, args: ["0.1.0-alpha.999"] },
    { id: "no expected distribution version supplied", code: "VERSION_MISMATCH", tamper: true, args: [] },
    { id: "modulePath traverses out of the payload", code: "UNSAFE_PATH", tamper: true, mutate: (dir) => editManifest(dir, (m) => { m.modulePath = "../../etc/passwd"; }) },
    { id: "diagnosticsPath is absolute", code: "UNSAFE_PATH", tamper: true, mutate: (dir) => editManifest(dir, (m) => { m.diagnosticsPath = "/etc/passwd"; }) },
    { id: "diagnosticsPath traverses out of the payload", code: "UNSAFE_PATH", tamper: true, mutate: (dir) => editManifest(dir, (m) => { m.diagnosticsPath = "../diagnose.mjs"; }) },
    { id: "manifest.json is absent", code: "MISSING_FILE", mutate: (dir) => rm(path.join(dir, "manifest.json")) },
    { id: "the generated module file is absent", code: "MISSING_FILE", mutate: (dir, modulePath) => rm(path.join(dir, modulePath)) },
    { id: "the generated module bytes are tampered", code: "INTEGRITY_MISMATCH", tamper: true },
    { id: "the manifest coordinate is tampered", code: "INTEGRITY_MISMATCH", mutate: (dir) => editManifest(dir, (m) => { m.coordinate = `${m.coordinate}-tampered`; }) },
    { id: "manifest.diagnostics no longer matches the shipped runner", code: "DIAGNOSTICS_MISMATCH", mutate: (dir) => editManifest(dir, (m) => { m.diagnostics = `sha256:${"0".repeat(64)}`; }) },
    { id: "the shipped runner bytes no longer match the manifest", code: "DIAGNOSTICS_MISMATCH", mutate: async (dir) => { const abs = path.join(dir, DIAGNOSTICS_PATH); await writeFile(abs, `${await readFile(abs, "utf8")}\n// p24a drift\n`, "utf8"); } },
  ]);

  const payload = render(new ActionContract(OPTS_COMMAND), canonicalVersion);
  for (const { id, code, tamper, mutate, args } of CASES) {
    const dir = await materialize("p24a-refusal-", payload.files, dirs);
    if (tamper) {
      const abs = path.join(dir, payload.modulePath);
      await writeFile(abs, `console.log(${JSON.stringify(TAMPER_MARKER)});\n${await readFile(abs, "utf8")}`, "utf8");
    }
    if (mutate) await mutate(dir, payload.modulePath);

    const result = runDiagnose(dir, args ?? [canonicalVersion]);
    const where = `case: ${id}`;
    assert.equal(result.status, 1, `${where} must exit 1, got status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(result.stdout, "", `${where} must emit no report on stdout`);
    assert.deepEqual([...result.stderr.matchAll(new RegExp(`${ERROR_PREFIX}:([A-Z_]+)`, "g"))].map((m) => m[1]), [code], `${where} must emit exactly one stable code`);
    assert.match(result.stderr, new RegExp(`^${ERROR_PREFIX}:${code}\\s`, "m"), `${where} must anchor its code at the start of a stderr line`);
    assertNoClaim(result.stderr, `${where} stderr`);
    assert.ok(!(result.stdout + result.stderr).includes(TAMPER_MARKER), `${where} must refuse before the generated module is evaluated`);
  }
});
