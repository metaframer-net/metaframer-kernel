import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import test from "node:test";
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

test("repository status stays fail-closed until the runtime decision gate is complete", async () => {
  const status = JSON.parse(
    await readFile(path.join(root, "repository-status.json"), "utf8"),
  );

  assert.equal(status.repository, "metaframer-net/metaframer-kernel");
  assert.equal(status.classification, "PLANNING_ONLY");
  assert.equal(status.runtime.status, "VALID_BLOCKED");
  assert.equal(status.runtime.releaseDecision, "NO_GO");
  assert.equal(status.runtime.implemented, false);
  assert.equal(status.runtime.mvp, false);
  assert.equal(status.runtime.productionReady, false);
  assert.equal(status.decisionGate.requiredClosedDecisions, 10);
  assert.equal(status.decisionGate.state, "INCOMPLETE");
  assert.equal(status.sourceTopology.state, "PENDING_HUMAN_DECISION");
});

test("planning bootstrap contains no runtime source tree", async () => {
  for (const runtimePath of ["apps", "src", "packages", "deploy", "migrations"]) {
    assert.equal(
      await exists(runtimePath),
      false,
      `${runtimePath} must not exist in the planning-only bootstrap`,
    );
  }
});
