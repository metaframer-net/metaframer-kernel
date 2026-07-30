import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(
  await readFile(path.join(root, "planning/source-inventory.json"), "utf8"),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function gitShow(repoPath, ref, relativePath) {
  assert.match(relativePath, /^[A-Za-z0-9._/-]+$/);
  return execFileSync("git", ["-C", repoPath, "show", `${ref}:${relativePath}`], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const rawRoot = inventory.rawInputs.configuredPath;
const rawRootStat = await lstat(rawRoot);
assert.equal(rawRootStat.isDirectory(), true, `${rawRoot} must be a directory`);
assert.equal(rawRootStat.isSymbolicLink(), false, `${rawRoot} must not be a symlink`);

const actualJsonFiles = (await readdir(rawRoot))
  .filter((file) => file.endsWith(".json"))
  .sort();
const expectedJsonFiles = inventory.rawInputs.files
  .map(({ file }) => file)
  .sort();
assert.deepEqual(
  actualJsonFiles,
  expectedJsonFiles,
  "configured raw-input directory no longer matches the inventory",
);

const aggregateRecords = [];
let totalBytes = 0;
for (const expected of inventory.rawInputs.files) {
  assert.match(expected.file, /^[^/]+\.json$/);
  const absolutePath = path.join(rawRoot, expected.file);
  assert.equal(
    path.dirname(absolutePath),
    rawRoot,
    `${expected.file} must stay directly under the configured source directory`,
  );

  const sourceStat = await lstat(absolutePath);
  assert.equal(sourceStat.isFile(), true, `${expected.file} must be a regular file`);
  assert.equal(
    sourceStat.isSymbolicLink(),
    false,
    `${expected.file} must not be a symlink`,
  );

  const bytes = await readFile(absolutePath);
  totalBytes += bytes.length;
  assert.equal(bytes.length, expected.bytes, `${expected.file} byte count drifted`);
  assert.equal(sha256(bytes), expected.sha256, `${expected.file} SHA-256 drifted`);

  const parsed = JSON.parse(bytes.toString("utf8"));
  assert.equal(parsed.task?.id, expected.taskId, `${expected.file} task ID drifted`);
  assert.equal(
    parsed.references?.self?.id,
    expected.taskId,
    `${expected.file} self reference drifted`,
  );
  assert.equal(
    parsed.task?.wbsCode,
    expected.wbsCode,
    `${expected.file} WBS code drifted`,
  );
  assert.equal(parsed.task?.status, "backlog", `${expected.file} status drifted`);
  assert.equal(
    parsed.task?.phase,
    "requirements",
    `${expected.file} phase drifted`,
  );
  for (const relation of ["dependsOn", "blocks", "related"]) {
    assert.deepEqual(
      parsed.task?.[relation] ?? [],
      (parsed.references?.[relation] ?? []).map(({ id }) => id),
      `${expected.file} ${relation} reference projection drifted`,
    );
  }
  assert.equal(
    parsed.exportedAt,
    expected.exportedAt,
    `${expected.file} exportedAt drifted`,
  );
  const { exportedAt: _ignoredSnapshotTime, ...semanticBody } = parsed;
  assert.equal(
    sha256(JSON.stringify(stableValue(semanticBody))),
    expected.semanticSha256,
    `${expected.file} semantic content drifted`,
  );

  aggregateRecords.push(
    `${expected.file}\0${expected.bytes}\0${expected.sha256}`,
  );
}

assert.equal(totalBytes, inventory.rawInputs.totalBytes, "total byte count drifted");
aggregateRecords.sort();
assert.equal(
  sha256(aggregateRecords.join("\n")),
  inventory.rawInputs.aggregateSha256,
  "raw-input aggregate digest drifted",
);

const canonical = inventory.canonicalPlanningSource;
const canonicalRefSha = execFileSync(
  "git",
  ["-C", canonical.repoPath, "rev-parse", canonical.ref],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
).trim();
assert.equal(canonicalRefSha, canonical.sha, "canonical Actionplan ref drifted");

for (const artifact of canonical.artifacts) {
  assert.equal(
    sha256(gitShow(canonical.repoPath, canonical.sha, artifact.path)),
    artifact.sha256,
    `${artifact.path} canonical artifact drifted`,
  );
}

const uniqueNodes = new Map();
for (const source of inventory.rawInputs.files) {
  const previous = uniqueNodes.get(source.canonicalNodeRef);
  if (previous) {
    assert.equal(
      previous,
      source.canonicalNodeSha256,
      `${source.canonicalNodeRef} has inconsistent expected hashes`,
    );
  } else {
    uniqueNodes.set(source.canonicalNodeRef, source.canonicalNodeSha256);
  }
}

for (const [nodePath, expectedHash] of uniqueNodes) {
  assert.equal(
    sha256(gitShow(canonical.repoPath, canonical.sha, nodePath)),
    expectedHash,
    `${nodePath} canonical node drifted`,
  );
}

console.log(
  `source snapshot: ${inventory.rawInputs.fileCount} files / ${inventory.rawInputs.uniqueTaskCount} tasks / actionplan@${canonical.sha.slice(0, 7)} verified read-only`,
);
