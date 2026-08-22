import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = "planning/gj01-generated-sdk-protocol-readiness.json";

async function loadContract() {
  const raw = await readFile(path.join(root, CONTRACT_PATH), "utf8");
  return JSON.parse(raw);
}

// The exact typed-action fields CreateCustomerPipeline already validates on a raw ActionSpec.
// This package pins them as the protocol surface a future generated SDK must target; it may not
// invent a field the pipeline does not already accept, and it may not drop one.
const ACTION_SPEC_FIELDS = ["requestId", "actorId", "tenantId", "payload", "idempotencyKey"];
const OUTCOME_VALUES = ["ALLOW_COMMIT", "DENY", "INVALID", "CROSS_TENANT_DENY"];
const ERROR_ENVELOPE_FIELDS = ["code", "message", "requestId", "retryable"];

const STRONGER_FLAGS = [
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

test("the generated-SDK protocol readiness contract file exists and parses", async () => {
  const contract = await loadContract();
  assert.equal(typeof contract, "object");
  assert.notEqual(contract, null);
});

test("the contract identifies itself as a protocol/readiness package, not a generation package", async () => {
  const contract = await loadContract();
  assert.equal(contract.id, "gj01-generated-sdk-protocol-readiness-2026-08-22");
  assert.equal(contract.packageKind, "generated-sdk-protocol-readiness");
  assert.equal(contract.implementsSdkGeneration, false);
});

test("every stronger-stage flag stays false", async () => {
  const contract = await loadContract();
  for (const flag of STRONGER_FLAGS) {
    assert.equal(contract.flags?.[flag], false, `flags.${flag} must be false`);
  }
});

test("capability delta is none runtime-visible", async () => {
  const contract = await loadContract();
  assert.equal(contract.capabilityDelta, "NONE");
  assert.equal(contract.runnableProduct, false);
});

test("V5 ASGI/Uvicorn/Hypercorn delivery stays blocked on the generated-SDK closure and one-golden-slice", async () => {
  const contract = await loadContract();
  const blockedUntil = contract.v5DeliveryBlockedUntil ?? [];
  assert.ok(blockedUntil.some((entry) => /generated-sdk/i.test(entry)), "must name generated-sdk closure");
  assert.ok(blockedUntil.some((entry) => /golden-slice/i.test(entry)), "must name one-golden-slice");
});

test("the pinned typed-action protocol matches CreateCustomerPipeline's raw ActionSpec fields exactly", async () => {
  const contract = await loadContract();
  const fields = contract.protocolContract?.typedAction?.createCustomerV1?.actionSpecFields;
  assert.deepEqual([...fields].sort(), [...ACTION_SPEC_FIELDS].sort());
});

test("the pinned outcome enum matches the closed CreateCustomerPipeline outcomes exactly", async () => {
  const contract = await loadContract();
  const outcomes = contract.protocolContract?.typedAction?.createCustomerV1?.outcomes;
  assert.deepEqual([...outcomes].sort(), [...OUTCOME_VALUES].sort());
});

test("the pinned error envelope shape matches the closed non-allow envelope exactly", async () => {
  const contract = await loadContract();
  const fields = contract.protocolContract?.errorEnvelope?.fields;
  assert.deepEqual([...fields].sort(), [...ERROR_ENVELOPE_FIELDS].sort());
});

test("non-goals explicitly refuse SDK generation, src/sdk, and every named delivery framework", async () => {
  const contract = await loadContract();
  const nonGoals = (contract.nonGoals ?? []).join("\n");
  assert.match(nonGoals, /src\/sdk/);
  assert.match(nonGoals, /generat(e|or|ion)/i);
  assert.match(nonGoals, /ASGI/);
  assert.match(nonGoals, /Uvicorn/);
  assert.match(nonGoals, /Hypercorn/);
  assert.match(nonGoals, /FastAPI/);
});

test("no version value is touched by this package", async () => {
  const contract = await loadContract();
  assert.equal(contract.versionBump, false);
});

test("allowedFiles has exact parity with the three-file shard this package writes", async () => {
  const contract = await loadContract();
  assert.deepEqual(
    [...contract.allowedFiles].sort(),
    [
      "CHANGELOG.md",
      "planning/gj01-generated-sdk-protocol-readiness.json",
      "tests/kernel-generated-sdk-protocol-readiness.test.mjs",
    ].sort(),
  );
});

test("rollback reverts exactly this shard and leaves substrate, primitives and the pipeline untouched", async () => {
  const contract = await loadContract();
  assert.equal(contract.rollback?.blastRadius, "planning-and-tests-only");
  assert.equal(contract.rollback?.runtimeDataImpact, "none");
});
