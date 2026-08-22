import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// kernel-generated-sdk-generation-determinism
//
// Proves a deterministic generator exists that renders src/sdk/create-customer.mjs
// byte-identically from the frozen protocol contract in
// planning/gj01-generated-sdk-protocol-readiness.json. The generator module exports a
// pure render function only: no network, no environment read, no clock, no random value,
// no file I/O in the render path. This test never writes to the repository; it only
// compares the generator's in-memory output against the committed artifact on disk.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorRelative = "tools/generate-create-customer-sdk.mjs";
const generatorUrl = pathToFileURL(path.join(root, generatorRelative)).href;
const sdkRelative = "src/sdk/create-customer.mjs";
const protocolPath = "planning/gj01-generated-sdk-protocol-readiness.json";

const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));

test("the generator module exists and exports a pure renderCreateCustomerSdk function", async () => {
  const generator = await import(generatorUrl);
  assert.equal(typeof generator.renderCreateCustomerSdk, "function");
});

test("renderCreateCustomerSdk regenerates src/sdk/create-customer.mjs byte-identically from the pinned protocol", async () => {
  const { renderCreateCustomerSdk } = await import(generatorUrl);
  const protocol = await readJson(protocolPath);
  const committed = await readFile(path.join(root, sdkRelative), "utf8");

  const rendered = renderCreateCustomerSdk(protocol);

  assert.equal(typeof rendered, "string");
  assert.equal(rendered, committed, "generator output must be byte-identical to the committed artifact");
});

test("renderCreateCustomerSdk is deterministic across repeated calls", async () => {
  const { renderCreateCustomerSdk } = await import(generatorUrl);
  const protocol = await readJson(protocolPath);

  const first = renderCreateCustomerSdk(protocol);
  const second = renderCreateCustomerSdk(protocol);
  const third = renderCreateCustomerSdk(JSON.parse(JSON.stringify(protocol)));

  assert.equal(first, second);
  assert.equal(first, third);
});

test("the generator module performs no capability access; CLI-only Node stdlib imports are allowed", async () => {
  const source = await readFile(path.join(root, generatorRelative), "utf8");
  const forbiddenTokens = [
    "fetch(", "XMLHttpRequest", "Math.random", "Date.now", "new Date(",
    "fastapi", "FastAPI", "django", "Django", "uvicorn", "hypercorn", "asgi", "ASGI",
    "writeFile", "createWriteStream",
  ];
  for (const token of forbiddenTokens) {
    assert.ok(!source.includes(token), `${generatorRelative} must not contain forbidden token ${token}`);
  }
});

test("running the generator does not modify src/sdk/create-customer.mjs on disk", async () => {
  const before = await readFile(path.join(root, sdkRelative), "utf8");
  const { renderCreateCustomerSdk } = await import(generatorUrl);
  const protocol = await readJson(protocolPath);
  renderCreateCustomerSdk(protocol);
  const after = await readFile(path.join(root, sdkRelative), "utf8");
  assert.equal(after, before, "the render path must never write to the repository");
});
