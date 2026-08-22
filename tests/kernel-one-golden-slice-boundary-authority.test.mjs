import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planningPath = "planning/gj01-v12-src-adapters-delivery-boundary-authority.json";
const boundaryPath = "tools/check-repository-boundary.mjs";
const substratePath = "db/kernel-runtime-substrate-s1.json";

const MOVED_CHILDREN = ["adapters", "delivery"];
const PERMITTED_AFTER = ["domain", "application", "sdk", "adapters", "delivery"];

const sortedNames = (values) => [...(values ?? [])].sort();

let planning;
let boundary;
let substrate;

test.before(async () => {
  planning = JSON.parse(await readFile(path.join(root, planningPath), "utf8"));
  boundary = await import(pathToFileURL(path.join(root, boundaryPath)).href);
  substrate = JSON.parse(await readFile(path.join(root, substratePath), "utf8"));
});

test("the planning record states a boundary-authority package, not a golden-slice implementation", () => {
  assert.equal(planning.packageKind, "repository-boundary-authority");
  assert.equal(planning.packageState, "boundary-opened-one-golden-slice-not-started");
  assert.equal(planning.sequenceReference.order, 4);
  assert.equal(planning.sequenceReference.id, "one-golden-slice");
  assert.equal(planning.capabilityDelta, "NONE");
  assert.equal(planning.runnableProduct, false);
  for (const [flag, value] of Object.entries(planning.flags ?? {})) {
    assert.equal(value, false, `flag ${flag} must be false — this package opens a boundary and claims no readiness`);
  }
  assert.ok(planning.userJourney && typeof planning.userJourney === "object", "planning record must carry a userJourney before/after clause");
  assert.match(String(planning.userJourney.before ?? ""), /[şığüöçİĞÜÖÇ]|kullanıcı|form/i, "userJourney.before must be stated in plain Turkish terms");
  assert.match(String(planning.userJourney.after ?? ""), /[şığüöçİĞÜÖÇ]|kullanıcı|form/i, "userJourney.after must be stated in plain Turkish terms");
  const nonGoals = (planning.nonGoals ?? []).join(" ").toLowerCase();
  for (const forbidden of ["fastapi", "django", "asgi", "uvicorn", "hypercorn"]) {
    assert.match(nonGoals, new RegExp(forbidden), `nonGoals must explicitly rule out ${forbidden}`);
  }
  assert.ok(planning.nextPackage && typeof planning.nextPackage === "object", "planning record must name a separately scoped next package for Package B");
});

test("the boundary change record matches the checker's before/after shape", () => {
  const { before, after } = planning.boundaryChange;
  assert.deepEqual(sortedNames(before.rootSrcPermittedChildren), sortedNames(["domain", "application", "sdk"]));
  assert.deepEqual(sortedNames(before.rootSrcForbiddenChildren), sortedNames(MOVED_CHILDREN));
  assert.deepEqual(sortedNames(after.rootSrcPermittedChildren), sortedNames(PERMITTED_AFTER));
  assert.deepEqual(after.rootSrcForbiddenChildren, []);
});

test("the checker now permits src/adapters and src/delivery and forbids nothing by name", () => {
  assert.deepEqual(
    sortedNames(boundary.ROOT_SRC_PERMITTED_CHILDREN),
    sortedNames(PERMITTED_AFTER),
    `${boundaryPath} must export ROOT_SRC_PERMITTED_CHILDREN including adapters and delivery`,
  );
  assert.deepEqual(
    boundary.ROOT_SRC_FORBIDDEN_CHILDREN ?? [],
    [],
    `${boundaryPath} must export an empty ROOT_SRC_FORBIDDEN_CHILDREN once adapters and delivery are opened`,
  );
  for (const child of MOVED_CHILDREN) {
    assert.equal(
      boundary.rootTopologyViolations({ rootChildren: ["src"], srcChildren: [child] }).length,
      0,
      `src/${child} alone must be clean once the boundary is opened`,
    );
  }
});

test("this package does not materialize src/adapters or src/delivery", () => {
  for (const child of MOVED_CHILDREN) {
    assert.equal(
      existsSync(path.join(root, "src", child)),
      false,
      `src/${child} must not exist — this package opens the boundary only, it does not walk through it`,
    );
  }
});

test("the substrate mirror re-exports the same widened boundary", () => {
  const topology = substrate.rootSourceTopology;
  assert.ok(topology && typeof topology === "object", `${substratePath} must carry a rootSourceTopology clause`);
  assert.deepEqual(sortedNames(topology.permittedFirstChildren), sortedNames(PERMITTED_AFTER));
  assert.deepEqual(topology.forbiddenFirstChildren ?? [], []);
});

test("the boundary checker itself names no delivery framework or runtime term", async () => {
  const forbiddenTerms = /fastapi|django|uvicorn|hypercorn|\basgi\b|commitreceipt/i;
  const source = await readFile(path.join(root, boundaryPath), "utf8");
  assert.doesNotMatch(source, forbiddenTerms, `${boundaryPath} must not name a delivery framework or runtime term this package does not implement`);
});
