import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P08 — tools/generate-versioned-action-sdk-distribution.mjs must export exactly one function,
// renderVersionedActionSdkDistribution(contract, distributionVersion). Written pre-implementation.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "tools/generate-versioned-action-sdk-distribution.mjs";

async function tryImport(rel) {
  try {
    return { mod: await import(pathToFileURL(path.join(root, rel)).href), err: null };
  } catch (err) {
    return { mod: null, err };
  }
}
const { mod: distModule, err: distLoadError } = await tryImport(modulePath);
const { mod: sdkGeneratorModule } = await tryImport("tools/generate-action-sdk.mjs");
const { mod: contractModule } = await tryImport("src/application/action-contract.mjs");

function dist() {
  assert.ok(distModule !== null, `${modulePath} must exist and import cleanly: ${distLoadError?.message ?? "not imported"}`);
  return distModule;
}
function sdkGen() {
  assert.ok(sdkGeneratorModule !== null, "tools/generate-action-sdk.mjs must exist and import cleanly");
  return sdkGeneratorModule;
}
function ActionContract() {
  assert.ok(contractModule !== null, "src/application/action-contract.mjs must exist and import cleanly");
  return contractModule.ActionContract;
}

const OPTS_A = Object.freeze({ kind: "command", name: "widget.create", version: 1, fields: Object.freeze(["name", "quantity"]), outcomes: Object.freeze(["created", "rejected"]), errorEnvelopeFields: Object.freeze(["code", "message"]) });
const OPTS_B = Object.freeze({ kind: "query", name: "widget.list.byowner", version: 3, fields: Object.freeze(["ownerId", "cursor", "limit"]), outcomes: Object.freeze(["found", "empty", "invalid"]), errorEnvelopeFields: Object.freeze(["code", "message", "details"]) });

const modPathOf = (c) => `actions/${c.name}/v${c.version}.mjs`;
const coordinateOf = (c) => `${c.name}@${c.version}`;
function canonicalDigestInput(contract, distributionVersion, moduleSource) {
  return JSON.stringify({
    schemaVersion: 1,
    distributionVersion,
    coordinate: coordinateOf(contract),
    action: { kind: contract.kind, name: contract.name, version: contract.version },
    modulePath: modPathOf(contract),
    moduleSource,
  });
}
function expectedIntegrity(contract, distributionVersion, moduleSource) {
  const digest = createHash("sha256").update(canonicalDigestInput(contract, distributionVersion, moduleSource), "utf8").digest("hex");
  return `sha256:${digest}`;
}

async function readVersions() {
  const policy = JSON.parse(await readFile(path.join(root, "versioning-policy.json"), "utf8"));
  const canonicalVersion = policy?.currentVersion?.value;
  assert.equal(typeof canonicalVersion, "string");
  assert.ok(canonicalVersion.length > 0);
  const match = /^(.*\.)(\d+)$/.exec(canonicalVersion);
  assert.ok(match, `expected a trailing numeric train counter on ${canonicalVersion}`);
  const alternateVersion = `${match[1]}${Number(match[2]) + 1}`;
  return { canonicalVersion, alternateVersion };
}

test("exports exactly renderVersionedActionSdkDistribution(contract, distributionVersion), arity 2, closed capability surface", async () => {
  const mod = dist();
  assert.deepEqual(Object.keys(mod).filter((k) => k !== "default").sort(), ["renderVersionedActionSdkDistribution"]);
  assert.equal(typeof mod.renderVersionedActionSdkDistribution, "function");
  assert.equal(mod.renderVersionedActionSdkDistribution.length, 2);
  const source = await readFile(path.join(root, modulePath), "utf8");
  const imports = [...source.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
  assert.equal(imports.length, 2);
  assert.ok(imports.some((l) => /from\s+["']\.\/generate-action-sdk\.mjs["']/.test(l) && /\brenderActionSdk\b/.test(l)));
  assert.ok(imports.some((l) => /from\s+["']node:crypto["']/.test(l) && /\bcreateHash\b/.test(l)));
  const forbidden = [/\brequire\(/, /\bfetch\(/, /process\.env/, /node:fs|readFile|writeFile/, /Math\.random/, /\bDate\.(now|prototype)/];
  assert.ok(forbidden.every((re) => !re.test(source)), "no forbidden capability tokens");
});

test("renders coordinate/distributionVersion/manifestPath/modulePath/files for command+query contracts, module byte-equal to P07, manifest exact", async () => {
  const { renderVersionedActionSdkDistribution } = dist();
  const { renderActionSdk } = sdkGen();
  const Contract = ActionContract();
  const { canonicalVersion } = await readVersions();
  for (const opts of [OPTS_A, OPTS_B]) {
    const contract = new Contract(opts);
    const payload = renderVersionedActionSdkDistribution(contract, canonicalVersion);
    const modPath = modPathOf(contract);
    assert.deepEqual(Object.keys(payload).sort(), ["coordinate", "distributionVersion", "files", "manifestPath", "modulePath"].sort());
    assert.equal(payload.coordinate, coordinateOf(contract));
    assert.equal(payload.distributionVersion, canonicalVersion);
    assert.equal(payload.manifestPath, "manifest.json");
    assert.equal(payload.modulePath, modPath);
    assert.deepEqual(Object.keys(payload.files).sort(), [modPath, "manifest.json"].sort());
    assert.equal(payload.files[modPath], renderActionSdk(contract));
    const manifestText = payload.files["manifest.json"];
    assert.ok(manifestText.endsWith("\n"));
    const expectedManifest = {
      schemaVersion: 1,
      format: "esm",
      distributionVersion: canonicalVersion,
      coordinate: coordinateOf(contract),
      action: { kind: contract.kind, name: contract.name, version: contract.version },
      modulePath: modPath,
      integrity: expectedIntegrity(contract, canonicalVersion, payload.files[modPath]),
    };
    assert.equal(manifestText, `${JSON.stringify(expectedManifest)}\n`);
  }
});

test("returns a deeply frozen (payload, files), deterministic payload across repeated calls with identical inputs", async () => {
  const { renderVersionedActionSdkDistribution } = dist();
  const Contract = ActionContract();
  const contract = new Contract(OPTS_A);
  const { canonicalVersion } = await readVersions();
  const first = renderVersionedActionSdkDistribution(contract, canonicalVersion);
  const second = renderVersionedActionSdkDistribution(contract, canonicalVersion);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.files));
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.getPrototypeOf(first.files), Object.prototype);
  assert.throws(() => { first.distributionVersion = "tampered"; }, TypeError);
  assert.throws(() => { first.files[first.modulePath] = "tampered"; }, TypeError);
});

test("distributionVersion and contract.version are independent axes, sourced from the canonical versioning policy", async () => {
  const { renderVersionedActionSdkDistribution } = dist();
  const Contract = ActionContract();
  const { canonicalVersion, alternateVersion } = await readVersions();
  const contract = new Contract(OPTS_A);
  const a = renderVersionedActionSdkDistribution(contract, canonicalVersion);
  const b = renderVersionedActionSdkDistribution(contract, alternateVersion);
  assert.equal(a.distributionVersion, canonicalVersion);
  assert.equal(b.distributionVersion, alternateVersion);
  assert.equal(a.coordinate, coordinateOf(contract));
  assert.equal(b.coordinate, coordinateOf(contract));
  assert.equal(a.files[a.modulePath], b.files[b.modulePath], "module source depends only on the contract");
  assert.notEqual(a.files["manifest.json"], b.files["manifest.json"]);
  assert.notEqual(JSON.parse(a.files["manifest.json"]).integrity, JSON.parse(b.files["manifest.json"]).integrity);
});

test("integrity digest matches the documented canonical serialization and is sensitive to distributionVersion, contract and moduleSource", async () => {
  const { renderVersionedActionSdkDistribution } = dist();
  const Contract = ActionContract();
  const { canonicalVersion, alternateVersion } = await readVersions();
  const contractA = new Contract(OPTS_A);
  const contractB = new Contract(OPTS_B);
  const payload = renderVersionedActionSdkDistribution(contractA, canonicalVersion);
  const manifest = JSON.parse(payload.files["manifest.json"]);
  const moduleSource = payload.files[payload.modulePath];
  assert.equal(manifest.integrity, expectedIntegrity(contractA, canonicalVersion, moduleSource));
  const byVersion = JSON.parse(renderVersionedActionSdkDistribution(contractA, alternateVersion).files["manifest.json"]);
  assert.notEqual(byVersion.integrity, manifest.integrity);
  const byContract = JSON.parse(renderVersionedActionSdkDistribution(contractB, canonicalVersion).files["manifest.json"]);
  assert.notEqual(byContract.integrity, manifest.integrity);
  const tampered = `sha256:${createHash("sha256").update(canonicalDigestInput(contractA, canonicalVersion, `${moduleSource}x`), "utf8").digest("hex")}`;
  assert.notEqual(tampered, manifest.integrity);
});

test("fails closed on a non-exact ActionContract input and on an invalid distributionVersion, with no side effects", async () => {
  const { renderVersionedActionSdkDistribution } = dist();
  const Contract = ActionContract();
  const { canonicalVersion } = await readVersions();
  class FakeContract extends Contract {}
  const fake = new FakeContract(OPTS_A), real = new Contract(OPTS_A);
  for (const bad of [undefined, null, {}, { ...OPTS_A }, fake]) {
    assert.throws(() => renderVersionedActionSdkDistribution(bad, canonicalVersion));
  }
  for (const bad of [undefined, null, "", "   ", "\t\n", 1, true, {}, [], Symbol("v")]) {
    assert.throws(() => renderVersionedActionSdkDistribution(real, bad));
  }
  const before = renderVersionedActionSdkDistribution(real, canonicalVersion);
  assert.throws(() => renderVersionedActionSdkDistribution(fake, canonicalVersion));
  assert.throws(() => renderVersionedActionSdkDistribution(real, ""));
  const after = renderVersionedActionSdkDistribution(real, canonicalVersion);
  assert.deepEqual(before, after, "rejected calls must leave no observable side effect");
});
