import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15b-asgi-host-boundary-truth.json", import.meta.url),
);
const SOURCE_PATH = fileURLToPath(
  new URL("../src/delivery/create-customer-asgi-composition.mjs", import.meta.url),
);
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

async function loadSource() {
  return readFile(SOURCE_PATH, "utf-8");
}

test("planning JSON carries the three official ASGI/Uvicorn/Hypercorn source links", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.sourceLinks.asgiSpecMain, "https://asgi.readthedocs.io/en/latest/specs/main.html");
  assert.equal(planning.sourceLinks.asgiSpecHttp, "https://asgi.readthedocs.io/en/latest/specs/www.html");
  assert.equal(planning.sourceLinks.uvicornAsgiConcept, "https://uvicorn.dev/concepts/asgi/");
  assert.equal(planning.sourceLinks.hypercornDocs, "https://hypercorn.readthedocs.io/");
});

test("planning JSON keeps all readiness and runnableProduct flags false", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.flags.kernelReady, false);
  assert.equal(planning.flags.appBuildable, false);
  assert.equal(planning.flags.releaseAllowed, false);
  assert.equal(planning.flags.deployAllowed, false);
  assert.equal(planning.flags.productionAllowed, false);
  assert.equal(planning.flags.runnableProduct, false);
  assert.equal(planning.runnableProduct, false);
});

test("planning JSON non-goals refuse a Python bridge, a server/listener, and Uvicorn/Hypercorn/FastAPI/Django selection or import", async () => {
  const planning = await loadPlanning();
  const nonGoals = planning.nonGoals.join(" | ").toLowerCase();
  assert.match(nonGoals, /python bridge\/shim/);
  assert.match(nonGoals, /server\/listener/);
  assert.match(nonGoals, /uvicorn\/hypercorn\/fastapi\/django/);
  assert.match(nonGoals, /import or selection/);
});

test("the old direct-call wording is gone from the source comments", async () => {
  const source = await loadSource();
  assert.doesNotMatch(
    source,
    /a host adapter \(Uvicorn, Hypercorn, \.\.\.\) can call directly/,
  );
});

test("the source comments state the ASGI host boundary truth", async () => {
  const source = await loadSource();
  assert.match(source, /ASGI-shaped/);
  assert.match(source, /host-adapter-ready at the protocol boundary/);
  const normalized = source.replace(/\/\/|\*/g, " ").replace(/\s+/g, " ");
  assert.match(
    normalized,
    /requires? a separate Python host bridge\/shim outside this package[,.]* (which is |that this package does )?not implemented/,
  );
});

test("no package.json dependency on uvicorn/hypercorn/fastapi/django", async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf-8"));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  for (const forbidden of ["uvicorn", "hypercorn", "fastapi", "django"]) {
    assert.equal(Object.keys(allDeps).some((name) => name.toLowerCase().includes(forbidden)), false);
  }
});

test("no bare import of uvicorn/hypercorn/fastapi/django in the source file", async () => {
  const source = await loadSource();
  for (const forbidden of ["uvicorn", "hypercorn", "fastapi", "django"]) {
    const importPattern = new RegExp(
      `import[^;\\n]*from\\s+["']${forbidden}["']|require\\(["']${forbidden}["']\\)`,
      "i",
    );
    assert.equal(importPattern.test(source), false, `unexpected import of ${forbidden}`);
  }
});
