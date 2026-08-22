import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// =====================================================================================
// kernel-generated-sdk-generation
//
// Proves the first generated-SDK artifact, src/sdk/create-customer.mjs, is byte-derived from the
// frozen protocol contract in planning/gj01-generated-sdk-protocol-readiness.json and stays
// framework-neutral: no network, no environment read, no clock, no random value, no file I/O, no
// import of application runtime or any framework/delivery package. It proves a static artifact
// exists and matches its pin; it starts nothing and claims no readiness.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRelative = "src/sdk/create-customer.mjs";
const sdkUrl = pathToFileURL(path.join(root, sdkRelative)).href;
const protocolPath = "planning/gj01-generated-sdk-protocol-readiness.json";

const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));

test("the generated SDK module exists and exports the pinned CreateCustomer@1 surface", async () => {
  const sdk = await import(sdkUrl);
  const protocol = await readJson(protocolPath);
  const typed = protocol.protocolContract.typedAction.createCustomerV1;
  const envelope = protocol.protocolContract.errorEnvelope;

  assert.equal(sdk.ACTION_NAME, typed.actionName);
  assert.equal(sdk.ACTION_VERSION, typed.actionVersion);
  assert.deepEqual([...sdk.ACTION_SPEC_FIELDS], typed.actionSpecFields);
  assert.deepEqual([...sdk.OUTCOMES], typed.outcomes);
  assert.deepEqual([...sdk.ERROR_ENVELOPE_FIELDS], envelope.fields);

  assert.ok(Object.isFrozen(sdk.ACTION_SPEC_FIELDS), "ACTION_SPEC_FIELDS must be frozen");
  assert.ok(Object.isFrozen(sdk.OUTCOMES), "OUTCOMES must be frozen");
  assert.ok(Object.isFrozen(sdk.ERROR_ENVELOPE_FIELDS), "ERROR_ENVELOPE_FIELDS must be frozen");
});

test("buildCreateCustomerActionSpec accepts exactly the pinned fields and freezes its output", async () => {
  const { buildCreateCustomerActionSpec, ACTION_SPEC_FIELDS } = await import(sdkUrl);
  const input = {
    requestId: "req-1",
    actorId: "actor-1",
    tenantId: "tenant-1",
    payload: { name: "Ada" },
    idempotencyKey: "idem-1",
  };
  const spec = buildCreateCustomerActionSpec(input);
  assert.deepEqual(Reflect.ownKeys(spec).sort(), [...ACTION_SPEC_FIELDS].sort());
  assert.ok(Object.isFrozen(spec), "the built ActionSpec must be frozen");
  assert.equal(spec.requestId, "req-1");

  assert.throws(() => buildCreateCustomerActionSpec(null), TypeError);
  assert.throws(() => buildCreateCustomerActionSpec({ ...input, extra: 1 }), TypeError);
  const { requestId, ...missingRequestId } = input;
  assert.throws(() => buildCreateCustomerActionSpec(missingRequestId), TypeError);
});

test("isCreateCustomerOutcome recognizes exactly the four pinned outcomes", async () => {
  const { isCreateCustomerOutcome, OUTCOMES } = await import(sdkUrl);
  for (const outcome of OUTCOMES) assert.equal(isCreateCustomerOutcome(outcome), true);
  assert.equal(isCreateCustomerOutcome("ALLOW"), false);
  assert.equal(isCreateCustomerOutcome(123), false);
  assert.equal(isCreateCustomerOutcome(null), false);
});

test("isCreateCustomerErrorEnvelope recognizes exactly the pinned envelope shape", async () => {
  const { isCreateCustomerErrorEnvelope } = await import(sdkUrl);
  assert.equal(
    isCreateCustomerErrorEnvelope({ code: "X", message: "m", requestId: "r", retryable: false }),
    true,
  );
  assert.equal(isCreateCustomerErrorEnvelope({ code: "X", message: "m", requestId: "r" }), false);
  assert.equal(
    isCreateCustomerErrorEnvelope({ code: "X", message: "m", requestId: "r", retryable: false, extra: 1 }),
    false,
  );
  assert.equal(isCreateCustomerErrorEnvelope(null), false);
  assert.equal(isCreateCustomerErrorEnvelope("nope"), false);
});

test("the artifact is a flat framework-neutral ESM module with no capability access", async () => {
  const source = await readFile(path.join(root, sdkRelative), "utf8");
  const forbiddenTokens = [
    "fetch(", "XMLHttpRequest", "process.env", "process.argv", "readFile", "writeFile",
    "require(", "fastapi", "FastAPI", "django", "Django", "uvicorn", "hypercorn", "asgi", "ASGI",
    "Math.random", "Date.now", "new Date(",
  ];
  for (const token of forbiddenTokens) {
    assert.ok(!source.includes(token), `${sdkRelative} must not contain forbidden token ${token}`);
  }
  assert.ok(!/^\s*import\b/m.test(source), `${sdkRelative} must import nothing, including application runtime`);
});

test("importing the artifact produces no output and no side effect", async () => {
  const { spawnSync } = await import("node:child_process");
  const { execPath } = await import("node:process");
  const result = spawnSync(
    execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(sdkUrl)});`],
    { encoding: "utf8", cwd: root },
  );
  assert.equal(result.status, 0, `import failed: ${result.stderr}`);
  assert.equal(result.stdout, "", `importing the module wrote to stdout:\n${result.stdout}`);
  assert.equal(result.stderr, "", `importing the module wrote to stderr:\n${result.stderr}`);
});
