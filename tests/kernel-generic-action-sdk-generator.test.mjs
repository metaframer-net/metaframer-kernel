import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P07 — generic action SDK generator. tools/generate-action-sdk.mjs must export exactly one
// function, renderActionSdk(contract), taking a P02 ActionContract instance and returning the
// exact ESM source text of a generated SDK module as a string. Written before the module
// exists, so every assertion below is a requirement, not an observation.
//
// The generator module is allowed exactly one static import — ActionContract, needed to enforce
// exact-instance identity on its input — and nothing else: no other import, no require, no
// ambient capability. Its generated *output*, in contrast, must be entirely import-free.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = "tools/generate-action-sdk.mjs";
const contractModulePath = "src/application/action-contract.mjs";
const contractImportSpecifier = "../src/application/action-contract.mjs";

let generatorModule = null;
let generatorLoadError = null;
try {
  generatorModule = await import(pathToFileURL(path.join(root, modulePath)).href);
} catch (error) {
  generatorLoadError = error;
}

let contractModule = null;
try {
  contractModule = await import(pathToFileURL(path.join(root, contractModulePath)).href);
} catch {
  contractModule = null;
}

function generator() {
  assert.ok(
    generatorModule !== null,
    `${modulePath} must exist and import cleanly: ${generatorLoadError?.message ?? "not imported"}`,
  );
  return generatorModule;
}

function ActionContract() {
  assert.ok(contractModule !== null, `${contractModulePath} must exist and import cleanly`);
  return contractModule.ActionContract;
}

async function importGenerated(source) {
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  return import(dataUrl);
}

const CONTRACT_A_OPTIONS = Object.freeze({
  kind: "command",
  name: "widget.create",
  version: 1,
  fields: Object.freeze(["name", "quantity"]),
  outcomes: Object.freeze(["created", "rejected"]),
  errorEnvelopeFields: Object.freeze(["code", "message"]),
});
const CONTRACT_B_OPTIONS = Object.freeze({
  kind: "query",
  name: "widget.list.byowner",
  version: 3,
  fields: Object.freeze(["ownerId", "cursor", "limit"]),
  outcomes: Object.freeze(["found", "empty", "invalid"]),
  errorEnvelopeFields: Object.freeze(["code", "message", "details"]),
});

function assertRenderCarriesContract(source, contract) {
  assert.ok(source.includes(JSON.stringify(contract.name)), "rendered source must carry the action name");
  assert.ok(source.includes(String(contract.version)), "rendered source must carry the action version");
  for (const field of contract.fields) {
    assert.ok(source.includes(JSON.stringify(field)), `rendered source must carry field ${field}`);
  }
  for (const outcome of contract.outcomes) {
    assert.ok(source.includes(JSON.stringify(outcome)), `rendered source must carry outcome ${outcome}`);
  }
  for (const field of contract.errorEnvelopeFields) {
    assert.ok(source.includes(JSON.stringify(field)), `rendered source must carry error envelope field ${field}`);
  }
}

function assertGeneratedModule(generated, contract) {
  assert.equal(generated.ACTION_KIND, contract.kind);
  assert.equal(generated.ACTION_NAME, contract.name);
  assert.equal(generated.ACTION_VERSION, contract.version);
  assert.deepEqual(generated.ACTION_FIELDS, [...contract.fields]);
  assert.deepEqual(generated.OUTCOMES, [...contract.outcomes]);
  assert.deepEqual(generated.ERROR_ENVELOPE_FIELDS, [...contract.errorEnvelopeFields]);
  assert.ok(Object.isFrozen(generated.ACTION_FIELDS));
  assert.ok(Object.isFrozen(generated.OUTCOMES));
  assert.ok(Object.isFrozen(generated.ERROR_ENVELOPE_FIELDS));
  assert.equal(typeof generated.buildActionSpec, "function");
  assert.equal(typeof generated.isOutcome, "function");
  assert.equal(typeof generated.isErrorEnvelope, "function");
  const validSpec = Object.fromEntries(contract.fields.map((field, index) => [field, `value-${index}`]));
  const spec = generated.buildActionSpec(validSpec);
  assert.deepEqual(spec, validSpec);
  assert.ok(Object.isFrozen(spec));
  const missing = { ...validSpec };
  delete missing[contract.fields[0]];
  assert.throws(() => generated.buildActionSpec(missing), "missing field must be rejected");
  assert.throws(() => generated.buildActionSpec({ ...validSpec, extraField: true }), "extra field must be rejected");
  assert.throws(() => generated.buildActionSpec(null));
  assert.throws(() => generated.buildActionSpec("not an object"));
  for (const outcome of contract.outcomes) {
    assert.equal(generated.isOutcome(outcome), true);
  }
  assert.equal(generated.isOutcome("not-a-declared-outcome"), false);
  assert.equal(generated.isOutcome(123), false);
  const validEnvelope = Object.fromEntries(contract.errorEnvelopeFields.map((field) => [field, "x"]));
  assert.equal(generated.isErrorEnvelope(validEnvelope), true);
  const shortEnvelope = { ...validEnvelope };
  delete shortEnvelope[contract.errorEnvelopeFields[0]];
  assert.equal(generated.isErrorEnvelope(shortEnvelope), false, "missing field must be rejected");
  assert.equal(generated.isErrorEnvelope({ ...validEnvelope, extra: true }), false, "extra field must be rejected");
  assert.equal(generated.isErrorEnvelope(null), false);
  assert.equal(generated.isErrorEnvelope("nope"), false);

  const nullProtoSpec = Object.assign(Object.create(null), validSpec);
  assert.throws(() => generated.buildActionSpec(nullProtoSpec), "null-prototype object must be rejected");
  const customProtoSpec = Object.assign(Object.create({}), validSpec);
  assert.throws(() => generated.buildActionSpec(customProtoSpec), "custom-prototype object must be rejected");
  const symbolKeySpec = { ...validSpec, [Symbol("extra")]: true };
  assert.throws(() => generated.buildActionSpec(symbolKeySpec), "extra symbol own key must be rejected");

  const nullProtoEnvelope = Object.assign(Object.create(null), validEnvelope);
  assert.equal(generated.isErrorEnvelope(nullProtoEnvelope), false, "null-prototype envelope must be rejected");
  const customProtoEnvelope = Object.assign(Object.create({}), validEnvelope);
  assert.equal(generated.isErrorEnvelope(customProtoEnvelope), false, "custom-prototype envelope must be rejected");
  const symbolKeyEnvelope = { ...validEnvelope, [Symbol("extra")]: true };
  assert.equal(generated.isErrorEnvelope(symbolKeyEnvelope), false, "extra symbol own key envelope must be rejected");

  assert.ok(Object.isFrozen(generated.buildActionSpec), "buildActionSpec must be frozen");
  assert.ok(Object.isFrozen(generated.isOutcome), "isOutcome must be frozen");
  assert.ok(Object.isFrozen(generated.isErrorEnvelope), "isErrorEnvelope must be frozen");
}

test("exports exactly renderActionSdk(contract), which requires an exact P02 ActionContract instance", () => {
  const mod = generator();
  const keys = Object.keys(mod).filter((key) => key !== "default");
  assert.deepEqual(keys.sort(), ["renderActionSdk"]);
  assert.equal(typeof mod.renderActionSdk, "function");
  assert.equal(mod.renderActionSdk.length, 1);

  assert.throws(() => mod.renderActionSdk(undefined));
  assert.throws(() => mod.renderActionSdk(null));
  assert.throws(() => mod.renderActionSdk({}));
  assert.throws(() => mod.renderActionSdk({ ...CONTRACT_A_OPTIONS }));
  const Contract = ActionContract();
  class FakeContract extends Contract {}
  const fake = new FakeContract(CONTRACT_A_OPTIONS);
  assert.throws(() => mod.renderActionSdk(fake), "a subclass instance is not the exact class");
  const real = new Contract(CONTRACT_A_OPTIONS);
  assert.doesNotThrow(() => mod.renderActionSdk(real));
});

test("renders deterministic but meaningfully different source for two structurally distinct contracts", () => {
  const { renderActionSdk } = generator();
  const Contract = ActionContract();
  const contractA = new Contract(CONTRACT_A_OPTIONS);
  const contractB = new Contract(CONTRACT_B_OPTIONS);
  const sourceA1 = renderActionSdk(contractA);
  const sourceA2 = renderActionSdk(contractA);
  const sourceB = renderActionSdk(contractB);
  assert.equal(typeof sourceA1, "string");
  assert.equal(sourceA1, sourceA2, "rendering the same contract twice must be byte-identical");
  assert.notEqual(sourceA1, sourceB, "structurally distinct contracts must render distinct source");
  assertRenderCarriesContract(sourceA1, contractA);
  assertRenderCarriesContract(sourceB, contractB);
});

test("generated ESM for two distinct contracts exposes frozen constants and functions with exact-shape field rejection", async () => {
  const { renderActionSdk } = generator();
  const Contract = ActionContract();
  const contractA = new Contract(CONTRACT_A_OPTIONS);
  const contractB = new Contract(CONTRACT_B_OPTIONS);
  const generatedA = await importGenerated(renderActionSdk(contractA));
  const generatedB = await importGenerated(renderActionSdk(contractB));
  assertGeneratedModule(generatedA, contractA);
  assertGeneratedModule(generatedB, contractB);
});

test("generator imports only ActionContract; generated source is import-free, framework-neutral and capability-free; rendering mutates neither input nor repository", async () => {
  const { renderActionSdk } = generator();
  const Contract = ActionContract();

  const generatorSource = await readFile(path.join(root, modulePath), "utf8");
  const staticImports = [...generatorSource.matchAll(/^\s*import\s.+$/gm)];
  assert.equal(staticImports.length, 1, "generator module must have exactly one static import statement");
  const specifierPattern = new RegExp(`from\\s+["']${contractImportSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  assert.ok(specifierPattern.test(staticImports[0][0]), `the sole import must be from ${contractImportSpecifier}`);
  assert.ok(/\bActionContract\b/.test(staticImports[0][0]), "the sole import must bring in ActionContract");
  assert.ok(!/\brequire\(/.test(generatorSource), "generator module source must not use require()");
  assert.ok(!/\bfetch\(/.test(generatorSource), "generator module must perform no network access");
  assert.ok(!/process\.env/.test(generatorSource), "generator module must perform no environment read");
  assert.ok(!/node:fs|readFile|writeFile/.test(generatorSource), "generator module must perform no file I/O");
  const contract = new Contract(CONTRACT_A_OPTIONS);
  const snapshotBefore = contract.toString();
  const source = renderActionSdk(contract);
  assert.equal(contract.toString(), snapshotBefore, "rendering must not mutate the input contract");
  assert.ok(!/^\s*import\s/m.test(source), "generated source must contain no import statement");
  assert.ok(!/\brequire\(/.test(source), "generated source must not use require()");
  assert.ok(!/\bfetch\(/.test(source), "generated source must perform no network access");
  assert.ok(!/process\.env/.test(source), "generated source must perform no environment read");
  assert.ok(!/\bDate\.(now|prototype)/.test(source), "generated source must perform no clock access");
  assert.ok(!/Math\.random/.test(source), "generated source must perform no random access");
  assert.ok(!/node:fs|readFile|writeFile/.test(source), "generated source must perform no file I/O");
  const repoSnapshotBefore = await readFile(path.join(root, modulePath), "utf8");
  renderActionSdk(contract);
  renderActionSdk(contract);
  const repoSnapshotAfter = await readFile(path.join(root, modulePath), "utf8");
  assert.equal(repoSnapshotAfter, repoSnapshotBefore, "rendering must never write to the repository");
});
