import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15c-python-host-bridge-contract.json", import.meta.url),
);

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

test("planning JSON identifies itself with the expected id and packageKind", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15c-python-host-bridge-contract-2026-08-23");
  assert.equal(planning.packageKind, "python-host-bridge-contract");
  assert.equal(planning.type, "python-host-bridge-contract");
});

test("prerequisite references V15B by exact path and id", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.prerequisite.path, "planning/gj01-v15b-asgi-host-boundary-truth.json");
  assert.equal(planning.prerequisite.id, "gj01-v15b-asgi-host-boundary-truth-2026-08-23");
});

test("bridgeInThisPackage, hostSelected, runnableProduct, and all stronger readiness flags are false", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.bridgeInThisPackage, false);
  assert.equal(planning.hostSelected, false);
  assert.equal(planning.runnableProduct, false);
  assert.equal(planning.flags.runnableProduct, false);
  assert.equal(planning.flags.kernelReady, false);
  assert.equal(planning.flags.sdkReady, undefined);
  assert.equal(planning.flags.appBuildable, false);
  assert.equal(planning.flags.releaseAllowed, false);
  assert.equal(planning.flags.deployAllowed, false);
  assert.equal(planning.flags.productionAllowed, false);
});

test("future boundary is described as an application-owned delivery adapter, not Kernel core", async () => {
  const planning = await loadPlanning();
  const ownership = planning.futureBridgeContract.ownership.toLowerCase();
  assert.match(ownership, /application-owned delivery adapter/);
  assert.match(ownership, /not part of the kernel domain or application core/);
});

test("future bridge exposes a Python ASGI (scope, receive, send) callable and delegates via an explicit reversible interop chosen later", async () => {
  const planning = await loadPlanning();
  const shape = planning.futureBridgeContract.pythonCallableShape;
  assert.match(shape, /\(scope, receive, send\)/);
  const delegation = planning.futureBridgeContract.delegationToKernel.toLowerCase();
  assert.match(delegation, /small, explicit, reversible interop mechanism/);
  assert.match(delegation, /this package does not choose that interop mechanism/);
});

test("non-goals forbid src change, Python implementation, dependency/CI/config change, server/listener/network, and framework/server selection or import", async () => {
  const planning = await loadPlanning();
  const nonGoals = planning.nonGoals.join(" | ").toLowerCase();
  assert.match(nonGoals, /no src\/\*\* change/);
  assert.match(nonGoals, /no python bridge\/shim implementation/);
  assert.match(nonGoals, /no dependency, package\/version, ci, or config change/);
  assert.match(nonGoals, /no server, listener, or network binding/);
  assert.match(nonGoals, /no uvicorn\/hypercorn\/fastapi\/django import, selection, or preference/);
});

test("acceptance list includes Uvicorn and Hypercorn smoke compatibility later while excluding FastAPI/Django as base", async () => {
  const planning = await loadPlanning();
  const smoke = planning.acceptance.serverSmokeCompatibilityLater.toLowerCase();
  assert.match(smoke, /uvicorn/);
  assert.match(smoke, /hypercorn/);
  assert.match(smoke, /without either one being made the development base/);
  const noFramework = planning.acceptance.noFrameworkBase.toLowerCase();
  assert.match(noFramework, /fastapi/);
  assert.match(noFramework, /django/);
});
