import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderVersionedActionSdkDistribution } from "../tools/generate-versioned-action-sdk-distribution.mjs";

// P09 — clean-consumer conformance for the P08 versioned SDK distribution. A standalone
// builtin-only CLI fixture (tests/fixtures/versioned-sdk-clean-consumer.mjs, not yet written)
// is copied into an OS temp root alongside a generated (manifest.json, actions/**) payload and
// run there as `node consumer.mjs EXPECTED_DISTRIBUTION_VERSION` with cwd=temp and env={}.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "versioned-sdk-clean-consumer.mjs");
const TAMPER_MARKER = "TAMPER_SIDE_EFFECT_EXECUTED";

const OPTS_COMMAND = Object.freeze({ kind: "command", name: "widget.create", version: 1, fields: Object.freeze(["name", "quantity"]), outcomes: Object.freeze(["created", "rejected"]), errorEnvelopeFields: Object.freeze(["code", "message"]) });
const OPTS_QUERY = Object.freeze({ kind: "query", name: "widget.list.byowner", version: 3, fields: Object.freeze(["ownerId", "cursor", "limit"]), outcomes: Object.freeze(["found", "empty", "invalid"]), errorEnvelopeFields: Object.freeze(["code", "message", "details"]) });

async function canonicalVersions() {
  const policy = JSON.parse(await readFile(path.join(root, "versioning-policy.json"), "utf8"));
  const canonicalVersion = policy?.currentVersion?.value;
  assert.equal(typeof canonicalVersion, "string");
  const match = /^(.*\.)(\d+)$/.exec(canonicalVersion);
  assert.ok(match, `expected a trailing numeric train counter on ${canonicalVersion}`);
  const alternateVersion = `${match[1]}${Number(match[2]) + 1}`;
  return { canonicalVersion, alternateVersion };
}

async function readFixtureSourceOrFail() {
  const source = await readFile(fixturePath, "utf8");
  const imports = [...source.matchAll(/^\s*import\s.+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "fixture must declare imports");
  assert.ok(imports.every((spec) => spec.startsWith("node:")), "fixture must import only node builtins");
  assert.ok(!/\.\.\//.test(source) && !source.includes(root), "fixture must contain no repository path or import");
  return source;
}

async function materialize(prefix, contract, distributionVersion) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const payload = renderVersionedActionSdkDistribution(contract, distributionVersion);
  const fixtureSource = await readFixtureSourceOrFail();
  await writeFile(path.join(dir, "consumer.mjs"), fixtureSource, "utf8");
  for (const [relPath, contents] of Object.entries(payload.files)) {
    const abs = path.join(dir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf8");
  }
  return { dir, payload };
}

function runConsumer(dir, expectedVersion) {
  return spawnSync(process.execPath, ["consumer.mjs", expectedVersion], { cwd: dir, env: {}, encoding: "utf8" });
}

test("command payload materializes its exact files and the copied consumer runs cleanly", async (t) => {
  const { canonicalVersion } = await canonicalVersions();
  const contract = new ActionContract(OPTS_COMMAND);
  const { dir, payload } = await materialize("p09-clean-consumer-cmd-", contract, canonicalVersion);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const manifestOnDisk = JSON.parse(await readFile(path.join(dir, payload.manifestPath), "utf8"));
  assert.equal(manifestOnDisk.distributionVersion, canonicalVersion);
  assert.equal(manifestOnDisk.coordinate, payload.coordinate);
  const moduleOnDisk = await readFile(path.join(dir, payload.modulePath), "utf8");
  assert.equal(moduleOnDisk, payload.files[payload.modulePath]);

  const result = runConsumer(dir, canonicalVersion);
  assert.equal(result.status, 0, `expected clean exit, got status=${result.status} stderr=${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.manifest.coordinate, payload.coordinate);
  assert.deepEqual(report.action, { kind: contract.kind, name: contract.name, version: contract.version });
  assert.equal(report.module.modulePath, payload.modulePath);
  assert.equal(report.module.buildActionSpecOk, true);
  assert.equal(report.module.isOutcomeOk, true);
  assert.equal(report.module.isErrorEnvelopeOk, true);
});

test("a structurally distinct query contract and an alternate distribution version stay independent in a clean process", async (t) => {
  const { alternateVersion } = await canonicalVersions();
  const contract = new ActionContract(OPTS_QUERY);
  const { dir, payload } = await materialize("p09-clean-consumer-qry-", contract, alternateVersion);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = runConsumer(dir, alternateVersion);
  assert.equal(result.status, 0, `expected clean exit, got status=${result.status} stderr=${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(typeof report.manifest.distributionVersion, "string");
  assert.equal(report.manifest.distributionVersion, alternateVersion);
  assert.equal(typeof report.action.version, "number");
  assert.ok(Number.isSafeInteger(report.action.version));
  assert.equal(report.action.version, contract.version);
  assert.equal(report.module.modulePath, payload.modulePath);
  assert.equal(report.module.isOutcomeOk, true);
});

test("adversarial payloads fail closed before the generated module is ever evaluated", async (t) => {
  const { canonicalVersion } = await canonicalVersions();
  const dirs = [];
  t.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

  async function freshPayload() {
    const contract = new ActionContract(OPTS_COMMAND);
    const result = await materialize("p09-clean-consumer-adv-", contract, canonicalVersion);
    dirs.push(result.dir);
    return result;
  }

  // Case: tampered module content trips integrity and never evaluates its side effect.
  {
    const { dir } = await freshPayload();
    const modulePath = path.join(dir, "actions", "widget.create", "v1.mjs");
    const original = await readFile(modulePath, "utf8");
    await writeFile(modulePath, `console.log(${JSON.stringify(TAMPER_MARKER)});\n${original}`, "utf8");
    const result = runConsumer(dir, canonicalVersion);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:INTEGRITY_MISMATCH/);
    assert.ok(!(result.stdout + result.stderr).includes(TAMPER_MARKER), "tampered module must never be evaluated");
  }

  // Case: tampered manifest trips integrity.
  {
    const { dir } = await freshPayload();
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.coordinate = `${manifest.coordinate}-tampered`;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    const result = runConsumer(dir, canonicalVersion);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:INTEGRITY_MISMATCH/);
  }

  // Case: expected-version mismatch fails closed.
  {
    const { dir } = await freshPayload();
    const result = runConsumer(dir, "0.1.0-alpha.999");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:VERSION_MISMATCH/);
  }

  // Case: unsafe traversal in modulePath fails closed.
  {
    const { dir } = await freshPayload();
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.modulePath = "../../etc/passwd";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    const result = runConsumer(dir, canonicalVersion);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:UNSAFE_PATH/);
  }

  // Case: missing module file fails closed.
  {
    const { dir } = await freshPayload();
    await rm(path.join(dir, "actions", "widget.create", "v1.mjs"));
    const result = runConsumer(dir, canonicalVersion);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:MISSING_FILE/);
  }

  // Case: malformed manifest JSON fails closed.
  {
    const { dir } = await freshPayload();
    await writeFile(path.join(dir, "manifest.json"), "{not json", "utf8");
    const result = runConsumer(dir, canonicalVersion);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLEAN_CONSUMER_ERROR:MALFORMED_MANIFEST/);
  }
});
