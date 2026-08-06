import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const status = JSON.parse(
  await readFile(path.join(root, "repository-status.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const readme = await readFile(path.join(root, "README.md"), "utf8");

assert.equal(status.repository, "metaframer-net/metaframer-kernel");
assert.equal(status.visibility, "PRIVATE");
assert.equal(status.classification, "PLANNING_ONLY");
assert.deepEqual(status.adminOverride.scope, [
  "CREATE_REPOSITORY",
  "PUSH_PLANNING_BOOTSTRAP",
]);
assert.equal(status.runtime.status, "VALID_BLOCKED");
assert.equal(status.runtime.releaseDecision, "NO_GO");
assert.equal(status.runtime.implemented, false);
assert.equal(status.runtime.mvp, false);
assert.equal(status.runtime.productionReady, false);
assert.equal(status.decisionGate.requiredClosedDecisions, 10);
assert.equal(status.decisionGate.state, "INCOMPLETE");
assert.equal(status.sourceTopology.state, "APPROVED_CONDITIONAL");
assert.equal(
  status.sourceTopology.standaloneKernelSource,
  "CONDITIONALLY_SELECTED_AFTER_CANONICAL_GATE",
);
assert.equal(status.sourceTopology.futureOwner, "metaframer-net/metaframer-kernel");
assert.equal(status.sourceTopology.activatesAfter, "all-canonical-KGA-decisions-closed");
assert.equal(status.sourceTopology.currentImplementationWorkspace, "platform monorepo");
assert.equal(status.sourceTopology.historyStrategy, "CLEAN_START_WITH_PROVENANCE");
assert.equal(status.sourceTopology.sourceExtraction, false);
assert.equal(packageJson.private, true);

for (const requiredClaim of [
  "PLANNING_ONLY",
  "VALID_BLOCKED",
  "NO_GO",
  "Runtime implementation: absent",
]) {
  assert.ok(readme.includes(requiredClaim), `README must include ${requiredClaim}`);
}

for (const runtimePath of ["apps", "src", "packages", "deploy", "migrations"]) {
  assert.equal(
    await exists(runtimePath),
    false,
    `${runtimePath} must not exist before the runtime decision gate is complete`,
  );
}

// The checks above are unchanged; only their reporting is labelled. These tokens are a verified
// historical snapshot, not the verdict in force — the current one is printed last by
// tools/check-kernel-runtime-pilot-consumer-sync.mjs.
console.log(
  "HISTORICAL SNAPSHOT (verified, non-effective; not the current verdict): " +
    "repository boundary: PLANNING_ONLY / VALID_BLOCKED / NO_GO",
);
