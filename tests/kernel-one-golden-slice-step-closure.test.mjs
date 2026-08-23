import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// =====================================================================================
// kernel-one-golden-slice-step-closure
//
// Proves that step 4 (`one-golden-slice`) of the pinned runtime-start sequence in
// planning/kernel-runtime-pilot-consumer-sync.json is closed for CreateCustomer@1 by
// composing five already-GREEN upstream evidence records:
//   - the generated-sdk step closure in planning/gj01-v11-generated-sdk-step-closure.json
//   - the atomic four-intent commit receipt in planning/gj01-v12b2b-customer-commit-receipt.json
//   - the framework-neutral composition root in planning/gj01-v13c-framework-neutral-composition.json
//   - the ASGI composition body-limit conformance in planning/gj01-v14w-asgi-composition-body-limit.json
//   - the ASGI receive more_body conformance in planning/gj01-v14y-asgi-receive-more-body-conformance.json
// plus the Docker-backed real PostgreSQL 16 test in
// tests/kernel-create-customer-asgi-composition.test.mjs.
//
// This package writes no production code and edits none of the upstream records. It asserts a
// package-local closure only: oneGoldenSliceStepClosed=true while every stronger readiness flag
// stays false, runnableProduct is false, and no server/host/framework is selected.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLOSURE_PATH = "planning/gj01-v15a-one-golden-slice-step-closure.json";
const ASGI_COMPOSITION_TEST_PATH = "tests/kernel-create-customer-asgi-composition.test.mjs";

const UPSTREAM = {
  generatedSdkStepClosure: {
    path: "planning/gj01-v11-generated-sdk-step-closure.json",
    id: "gj01-v11-generated-sdk-step-closure-2026-08-22",
  },
  customerCommitReceipt: {
    path: "planning/gj01-v12b2b-customer-commit-receipt.json",
    id: "gj01-v12b2b-customer-commit-receipt-2026-08-22",
  },
  frameworkNeutralComposition: {
    path: "planning/gj01-v13c-framework-neutral-composition.json",
    id: "gj01-v13c-framework-neutral-composition-2026-08-22",
  },
  asgiCompositionBodyLimit: {
    path: "planning/gj01-v14w-asgi-composition-body-limit.json",
    id: "gj01-v14w-asgi-composition-body-limit-2026-08-23",
  },
  asgiReceiveMoreBodyConformance: {
    path: "planning/gj01-v14y-asgi-receive-more-body-conformance.json",
    id: "gj01-v14y-asgi-receive-more-body-conformance-2026-08-23",
  },
};

const DOCKER_TEST_NAME =
  "createCustomerAsgiComposition.app carries an ALLOW+invariants-ok POST /customers request to a real PostgreSQL 16 commit";

const STRONGER_FLAGS = [
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "oneGoldenSliceReady",
];

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function readText(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function loadClosure() {
  return readJson(CLOSURE_PATH);
}

test("the closure record exists and parses", async () => {
  const closure = await loadClosure();
  assert.equal(typeof closure, "object");
  assert.notEqual(closure, null);
});

test("the closure record identifies itself as a one-golden-slice-step-closure package", async () => {
  const closure = await loadClosure();
  assert.equal(closure.packageKind, "one-golden-slice-step-closure");
  assert.equal(closure.sequenceReference.id, "one-golden-slice");
});

test("the closure record references every upstream evidence file and id by exact path", async () => {
  const closure = await loadClosure();
  for (const [key, expected] of Object.entries(UPSTREAM)) {
    const entry = closure.composedEvidence[key];
    assert.ok(entry, `expected composedEvidence.${key} to exist`);
    assert.equal(entry.path, expected.path);
    assert.equal(entry.id, expected.id);

    const upstreamExists = await readJson(expected.path);
    assert.equal(upstreamExists.id, expected.id, `upstream id at ${expected.path} must match`);
  }
});

test("the closure record references the Docker-backed ASGI composition commit test by exact name and path", async () => {
  const closure = await loadClosure();
  const entry = closure.composedEvidence.asgiCompositionDockerCommitTest;
  assert.ok(entry, "expected composedEvidence.asgiCompositionDockerCommitTest to exist");
  assert.equal(entry.path, ASGI_COMPOSITION_TEST_PATH);
  assert.equal(entry.testName, DOCKER_TEST_NAME);
});

test("the named Docker-backed test is actually present in tests/kernel-create-customer-asgi-composition.test.mjs", async () => {
  const source = await readText(ASGI_COMPOSITION_TEST_PATH);
  assert.ok(
    source.includes(DOCKER_TEST_NAME),
    "expected the ASGI composition test file to contain the named Docker-backed PostgreSQL commit test",
  );
});

test("flags.oneGoldenSliceStepClosed, generatedSdkStepClosed and gapClosed are true for this package-local closure", async () => {
  const closure = await loadClosure();
  assert.equal(closure.flags.oneGoldenSliceStepClosed, true);
  assert.equal(closure.flags.generatedSdkStepClosed, true);
  assert.equal(closure.flags.gapClosed, true);
});

test("every stronger readiness flag stays false, including oneGoldenSliceReady", async () => {
  const closure = await loadClosure();
  for (const flag of STRONGER_FLAGS) {
    assert.equal(closure.flags[flag], false, `expected flags.${flag} to be false`);
  }
});

test("runnableProduct is false at both the top level and inside flags", async () => {
  const closure = await loadClosure();
  assert.equal(closure.runnableProduct, false);
  assert.equal(closure.flags.runnableProduct, false);
});

test("non-goals explicitly refuse server/framework selection and any src/db/tools/package/CI/version change", async () => {
  const closure = await loadClosure();
  const nonGoals = closure.nonGoals.join(" | ").toLowerCase();
  assert.match(nonGoals, /no src\/\*\* change/);
  assert.match(nonGoals, /no db\/\*\* change/);
  assert.match(nonGoals, /no tools\/\*\* change/);
  assert.match(nonGoals, /no ci\/config\/package\/version change/);
  assert.match(nonGoals, /no http server/);
  assert.match(nonGoals, /no asgi host\/runtime/);
  assert.match(nonGoals, /uvicorn/);
  assert.match(nonGoals, /hypercorn/);
  assert.match(nonGoals, /fastapi/);
  assert.match(nonGoals, /django/);
  assert.match(nonGoals, /no release\/deploy\/production\/app-buildable\/kernel-ready claim/);
});

test("versionBump is false: this package does not bump the package version", async () => {
  const closure = await loadClosure();
  assert.equal(closure.versionBump, false);
});

test("optionally runs the Docker-backed real PostgreSQL commit test when Docker is available", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync("docker", ["info"], { timeout: 5000 });
  } catch {
    t.skip("docker is not available in this environment; closure itself does not require Docker");
    return;
  }

  await execFileAsync(
    "node",
    [
      "--test",
      "--test-name-pattern",
      "ALLOW\\+invariants-ok",
      ASGI_COMPOSITION_TEST_PATH,
    ],
    { cwd: root, timeout: 120000 },
  );
});
