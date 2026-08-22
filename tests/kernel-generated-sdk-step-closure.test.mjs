import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// =====================================================================================
// kernel-generated-sdk-step-closure
//
// Proves that step 3 (`generated-sdk`) of the pinned runtime-start sequence in
// planning/kernel-runtime-pilot-consumer-sync.json is closed for CreateCustomer@1 by
// composing four already-GREEN upstream evidence records:
//   - the src/sdk boundary opened by planning/gj01-src-sdk-boundary-authority.json
//   - the frozen protocol contract in planning/gj01-generated-sdk-protocol-readiness.json
//   - the materialized artifact in planning/gj01-generated-sdk-generation.json / src/sdk/create-customer.mjs
//   - the deterministic generator in planning/gj01-v10-deterministic-sdk-generator.json / tools/generate-create-customer-sdk.mjs
//
// This package writes no production code and edits none of the upstream records. It asserts a
// package-local closure only: generatedSdkStepClosed=true while every stronger-stage readiness
// flag stays false, capabilityDelta is NONE, runnableProduct is false, and the one-golden-slice
// step of the sequence remains unopened.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLOSURE_PATH = "planning/gj01-v11-generated-sdk-step-closure.json";

const UPSTREAM = {
  boundaryAuthority: "planning/gj01-src-sdk-boundary-authority.json",
  protocolReadiness: "planning/gj01-generated-sdk-protocol-readiness.json",
  generation: "planning/gj01-generated-sdk-generation.json",
  generator: "planning/gj01-v10-deterministic-sdk-generator.json",
};

const STRONGER_FLAGS = [
  "kernelReady",
  "sdkReady",
  "generatedSdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function loadClosure() {
  return readJson(CLOSURE_PATH);
}

test("the closure record exists and parses", async () => {
  const closure = await loadClosure();
  assert.equal(typeof closure, "object");
  assert.notEqual(closure, null);
});

test("the closure record identifies itself as a generated-sdk-step-closure package", async () => {
  const closure = await loadClosure();
  assert.equal(closure.id, "gj01-v11-generated-sdk-step-closure-2026-08-22");
  assert.equal(closure.packageKind, "generated-sdk-step-closure");
});

test("the closure record names step 3 (generated-sdk) of the pinned sequence as what it closes", async () => {
  const closure = await loadClosure();
  assert.equal(closure.sequenceReference?.source, "planning/kernel-runtime-pilot-consumer-sync.json");
  assert.equal(closure.sequenceReference?.field, "nextRuntimeStartPackage.sequence");
  assert.equal(closure.sequenceReference?.order, 3);
  assert.equal(closure.sequenceReference?.id, "generated-sdk");
});

test("the closure record composes exactly the four upstream evidence records by id/path", async () => {
  const closure = await loadClosure();
  const boundary = await readJson(UPSTREAM.boundaryAuthority);
  const protocol = await readJson(UPSTREAM.protocolReadiness);
  const generation = await readJson(UPSTREAM.generation);
  const generator = await readJson(UPSTREAM.generator);

  const composed = closure.composedEvidence;
  assert.ok(composed, "closure.composedEvidence must exist");

  assert.equal(composed.boundaryAuthority?.path, UPSTREAM.boundaryAuthority);
  assert.equal(composed.boundaryAuthority?.id, boundary.id);

  assert.equal(composed.protocolReadiness?.path, UPSTREAM.protocolReadiness);
  assert.equal(composed.protocolReadiness?.id, protocol.id);

  assert.equal(composed.artifactGeneration?.path, UPSTREAM.generation);
  assert.equal(composed.artifactGeneration?.id, generation.id);
  assert.equal(composed.artifactGeneration?.artifactPath, "src/sdk/create-customer.mjs");

  assert.equal(composed.deterministicGenerator?.path, UPSTREAM.generator);
  assert.equal(composed.deterministicGenerator?.id, generator.id);
  assert.equal(composed.deterministicGenerator?.generatorPath, "tools/generate-create-customer-sdk.mjs");
});

test("generatedSdkStepClosed is true while every stronger-stage flag stays false", async () => {
  const closure = await loadClosure();
  assert.equal(closure.flags?.generatedSdkStepClosed, true);
  for (const flag of STRONGER_FLAGS) {
    assert.equal(closure.flags?.[flag], false, `flags.${flag} must be false`);
  }
});

test("capability delta is none runtime-visible and no readiness is claimed", async () => {
  const closure = await loadClosure();
  assert.equal(closure.capabilityDelta, "NONE");
  assert.equal(closure.runnableProduct, false);
});

test("the one-golden-slice step of the sequence remains unopened by this closure", async () => {
  const closure = await loadClosure();
  const nonGoals = (closure.nonGoals ?? []).join("\n");
  assert.match(nonGoals, /one-golden-slice/i);
  assert.match(nonGoals, /walking-skeleton/i);
});

test("non-goals explicitly refuse runtime, HTTP/ASGI delivery, DB/persistence and adapters/delivery", async () => {
  const closure = await loadClosure();
  const nonGoals = (closure.nonGoals ?? []).join("\n");
  assert.match(nonGoals, /HTTP/);
  assert.match(nonGoals, /ASGI/);
  assert.match(nonGoals, /(database|persistence)/i);
  assert.match(nonGoals, /adapters/i);
  assert.match(nonGoals, /delivery/i);
});

test("this package edits none of the four upstream evidence files", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const relative of Object.values(UPSTREAM)) {
    const diff = execFileSync("git", ["diff", "--name-only", "HEAD", "--", relative], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(diff.trim(), "", `${relative} must not be modified by this package`);
  }
});

test("this package does not touch the generated artifact or generator source files", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const relative of ["src/sdk/create-customer.mjs", "tools/generate-create-customer-sdk.mjs"]) {
    const diff = execFileSync("git", ["diff", "--name-only", "HEAD", "--", relative], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(diff.trim(), "", `${relative} must not be modified by this package`);
  }
});

test("allowedFiles has exact parity with the three-file shard this package writes", async () => {
  const closure = await loadClosure();
  assert.deepEqual(
    [...closure.allowedFiles].sort(),
    [
      "CHANGELOG.md",
      "planning/gj01-v11-generated-sdk-step-closure.json",
      "tests/kernel-generated-sdk-step-closure.test.mjs",
    ].sort(),
  );
});

test("rollback reverts exactly this shard with no runtime data impact", async () => {
  const closure = await loadClosure();
  assert.equal(closure.rollback?.blastRadius, "planning-and-tests-only");
  assert.equal(closure.rollback?.runtimeDataImpact, "none");
});

test("no version value is touched by this package", async () => {
  const closure = await loadClosure();
  assert.equal(closure.versionBump, false);
});
