import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  modelFromAddendum,
  externalEvidenceReport,
} from "../tools/check-p01-closure-semantics.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function tempRoot(t, prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("modelFromAddendum returns a deep clone of the nested canonical projections negative probes cannot mutate", () => {
  const addendum = {
    phaseChainProjection: { phases: [{ id: "P1", closureEdgeIds: ["E1"] }] },
    closureEdgeProjection: { edges: [{ edgeId: "E1" }] },
    gapRegistryProjection: { gapPhase: { G1: "P1" } },
  };

  const model = modelFromAddendum(addendum);
  assert.deepEqual(model, {
    phases: addendum.phaseChainProjection.phases,
    edges: addendum.closureEdgeProjection.edges,
    gapPhase: addendum.gapRegistryProjection.gapPhase,
  });

  model.phases[0].closureEdgeIds.push("INJECTED");
  model.edges.push({ edgeId: "INJECTED" });
  model.gapPhase.G2 = "P1";

  assert.deepEqual(addendum.phaseChainProjection.phases[0].closureEdgeIds, ["E1"]);
  assert.equal(addendum.closureEdgeProjection.edges.length, 1);
  assert.deepEqual(addendum.gapRegistryProjection.gapPhase, { G1: "P1" });
});

test("modelFromAddendum defaults missing collections to empty containers", () => {
  assert.deepEqual(modelFromAddendum({}), { phases: [], edges: [], gapPhase: {} });
});

test("externalEvidenceReport reports absent when pins are well-formed but the root is missing", () => {
  const evidenceRoot = path.join(os.tmpdir(), `p01-evidence-never-created-${process.pid}`);
  const report = externalEvidenceReport({
    sourcePins: { evidenceRoot, files: [{ path: "a.txt", bytes: 3, sha256: "0".repeat(64) }] },
  });
  assert.deepEqual(report, { state: "absent", findings: [], verifiedFiles: 0, derivedProjectionMatches: null });
});

test("externalEvidenceReport verifies confined pins by exact byte length and sha256", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const bytesA = Buffer.from("hello world");
  const bytesB = Buffer.from("second file contents");
  writeFileSync(path.join(root, "a.txt"), bytesA);
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "nested", "b.txt"), bytesB);

  const report = externalEvidenceReport({
    sourcePins: {
      evidenceRoot: root,
      files: [
        { path: "a.txt", bytes: bytesA.length, sha256: sha256(bytesA) },
        { path: "nested/b.txt", bytes: bytesB.length, sha256: sha256(bytesB) },
      ],
    },
  });
  assert.deepEqual(report, { state: "verified", findings: [], verifiedFiles: 2, derivedProjectionMatches: null });
});

test("externalEvidenceReport reports drift for a byte length or sha256 mismatch", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const bytes = Buffer.from("hello world");
  writeFileSync(path.join(root, "a.txt"), bytes);

  const badBytes = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "a.txt", bytes: bytes.length + 1, sha256: sha256(bytes) }] },
  });
  assert.equal(badBytes.state, "drifted");
  assert.equal(badBytes.verifiedFiles, 0);
  assert.ok(badBytes.findings.some((f) => f.startsWith("BYTES_MISMATCH")));

  const badSha = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "a.txt", bytes: bytes.length, sha256: "f".repeat(64) }] },
  });
  assert.equal(badSha.state, "drifted");
  assert.ok(badSha.findings.some((f) => f.startsWith("SHA256_MISMATCH")));
});

test("externalEvidenceReport reports drift for an existing non-directory evidence root, not absent", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const rootFile = path.join(root, "not-a-dir");
  writeFileSync(rootFile, "x");

  const report = externalEvidenceReport({
    sourcePins: { evidenceRoot: rootFile, files: [{ path: "a.txt", bytes: 1, sha256: "0".repeat(64) }] },
  });
  assert.equal(report.state, "drifted");
  assert.equal(report.verifiedFiles, 0);
  assert.ok(report.findings.some((f) => f.startsWith("EVIDENCE_ROOT_NOT_A_DIRECTORY")));
});

test("externalEvidenceReport reports drift when a pinned file is missing inside an existing root", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const report = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "missing.txt", bytes: 1, sha256: "0".repeat(64) }] },
  });
  assert.equal(report.state, "drifted");
  assert.ok(report.findings.some((f) => f.startsWith("MISSING_FILE")));
});

test("externalEvidenceReport refuses unsafe absolute and traversal pin paths as drift, never a read outside root", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const outside = tempRoot(t, "p01-outside-");
  const secret = Buffer.from("outside-secret");
  writeFileSync(path.join(outside, "secret.txt"), secret);

  const absolute = externalEvidenceReport({
    sourcePins: {
      evidenceRoot: root,
      files: [{ path: path.join(outside, "secret.txt"), bytes: secret.length, sha256: sha256(secret) }],
    },
  });
  assert.equal(absolute.state, "drifted");
  assert.equal(absolute.verifiedFiles, 0);
  assert.ok(absolute.findings.some((f) => f.startsWith("PIN_UNSAFE_PATH")));

  const traversal = externalEvidenceReport({
    sourcePins: {
      evidenceRoot: root,
      files: [{ path: path.join("..", path.basename(outside), "secret.txt"), bytes: secret.length, sha256: sha256(secret) }],
    },
  });
  assert.equal(traversal.state, "drifted");
  assert.ok(traversal.findings.some((f) => f.startsWith("PIN_UNSAFE_PATH")));

  writeFileSync(path.join(root, "b.txt"), secret);
  const internalTraversal = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "a/../b.txt", bytes: secret.length, sha256: sha256(secret) }] },
  });
  assert.equal(internalTraversal.state, "drifted");
  assert.equal(internalTraversal.verifiedFiles, 0);
  assert.ok(internalTraversal.findings.some((f) => f.startsWith("PIN_UNSAFE_PATH")));
});

test("externalEvidenceReport refuses a symlink that escapes the evidence root as drift", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const outside = tempRoot(t, "p01-outside-");
  const secret = Buffer.from("outside-secret-3");
  const outsideFile = path.join(outside, "secret.txt");
  writeFileSync(outsideFile, secret);
  symlinkSync(outsideFile, path.join(root, "escape.txt"));

  const report = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "escape.txt", bytes: secret.length, sha256: sha256(secret) }] },
  });
  assert.equal(report.state, "drifted");
  assert.equal(report.verifiedFiles, 0);
  assert.ok(report.findings.some((f) => f.includes("PATH_ESCAPE")));
});

test("externalEvidenceReport reports drift, not a silent skip, for a malformed sha256 declaration", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const bytes = Buffer.from("hello world");
  writeFileSync(path.join(root, "a.txt"), bytes);

  const report = externalEvidenceReport({
    sourcePins: { evidenceRoot: root, files: [{ path: "a.txt", bytes: bytes.length, sha256: "not-a-hash" }] },
  });
  assert.equal(report.state, "drifted");
  assert.ok(report.findings.some((f) => f.startsWith("PIN_MALFORMED_SHA256")));
});

test("externalEvidenceReport dedupes a duplicate pinned path and stays deterministic across calls", (t) => {
  const root = tempRoot(t, "p01-evidence-");
  const addendum = {
    sourcePins: {
      evidenceRoot: root,
      files: [
        { path: "missing.txt", bytes: 1, sha256: "0".repeat(64) },
        { path: "missing.txt", bytes: 1, sha256: "0".repeat(64) },
      ],
    },
  };

  const first = externalEvidenceReport(addendum);
  const second = externalEvidenceReport(addendum);
  assert.deepEqual(first.findings, second.findings);
  assert.ok(first.findings.some((f) => f.startsWith("PIN_DUPLICATE")));
});

test("externalEvidenceReport reports drift for a malformed sourcePins shape without throwing", () => {
  const report = externalEvidenceReport({ sourcePins: { evidenceRoot: 5, files: [] } });
  assert.deepEqual(report, { state: "drifted", findings: report.findings, verifiedFiles: 0, derivedProjectionMatches: null });
  assert.equal(report.findings.length, 1);
});
