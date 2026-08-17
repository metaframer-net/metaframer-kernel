import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import {
  modelFromAddendum,
  externalEvidenceReport,
  addendumContractViolations,
} from "../tools/check-p01-closure-semantics.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const addendumPath = fileURLToPath(
  new URL("../planning/p01-closure-semantics-addendum.json", import.meta.url),
);
const canonicalAddendum = JSON.parse(readFileSync(addendumPath, "utf8"));

const CANONICAL_EVIDENCE_ROOT =
  "/Users/karaca/Documents/Codex/2026-08-08/files-mentioned-by-the-user-k";
const CANONICAL_SOURCE_PIN_FILES = [
  { path: "reports/p00-treaty-correction/RCPT-00.json", bytes: 20813, sha256: "2dbee1e439357b2848915c87739e1f8b704ffbfe9915f8bf77809c92e67ff473" },
  { path: "reports/p00-treaty-correction/07-OWNERSHIP-OVERLAY.tsv", bytes: 9365, sha256: "5a4ecba5b4cff30e10165a5dcc082b862f288475fdd19a7cb317ed31fdd63e0a" },
  { path: "reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv", bytes: 21886, sha256: "482bdba5c54f1f08fb89821c86991d7b86b23f65c6815d7b601d5ac81f8d3a30" },
  { path: "reports/kernel-development-roadmap/00-PHASE-CHAIN.json", bytes: 119950, sha256: "7794df62ef49829f134f742172eb2e6ed32cbc68a140a1ce5f70bdd4c23176c9" },
  { path: "reports/p00-treaty-correction/19-CORRECTION-NOTE.md", bytes: 138441, sha256: "201168e714160836dbe996833f1a2d7022bfb62262b6b29c781957d1ecf3e838" },
  { path: "reports/p00-treaty-correction/validate-p00-treaty-correction-final.mjs", bytes: 468170, sha256: "75efc281dcd78add736a0757ced5253052e066e9e1a6cf35c5bd6ac28bb5bd3f" },
];

const SOURCE_PIN_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_PINS_CONTAINER_KEYS = new Set(["evidenceRoot", "files"]);
const SOURCE_PIN_ENTRY_KEYS = new Set(["path", "bytes", "sha256"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Compact test-local closed-shape validator for addendum.sourcePins: exact container keys, exact
// per-entry keys, exact six canonical entries in exact order, duplicate/missing/extra path
// detection and bytes/sha256 type-and-format checks. Never throws, always returns a finding list.
function sourcePinsShapeViolations(sourcePins) {
  if (!isPlainObject(sourcePins)) return ["SOURCE_PINS_MALFORMED"];
  const violations = [];
  for (const key of Object.keys(sourcePins)) {
    if (!SOURCE_PINS_CONTAINER_KEYS.has(key)) violations.push(`SOURCE_PINS_KEY_EXTRA:${key}`);
  }
  for (const key of SOURCE_PINS_CONTAINER_KEYS) {
    if (!(key in sourcePins)) violations.push(`SOURCE_PINS_KEY_MISSING:${key}`);
  }
  if (sourcePins.evidenceRoot !== CANONICAL_EVIDENCE_ROOT) violations.push("EVIDENCE_ROOT_MISMATCH");
  if (!Array.isArray(sourcePins.files)) {
    violations.push("SOURCE_PIN_FILES_MALFORMED");
    return violations;
  }

  const seenPaths = new Set();
  sourcePins.files.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      violations.push(`SOURCE_PIN_ENTRY_MALFORMED:${index}`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!SOURCE_PIN_ENTRY_KEYS.has(key)) violations.push(`SOURCE_PIN_ENTRY_KEY_EXTRA:${index}:${key}`);
    }
    for (const key of SOURCE_PIN_ENTRY_KEYS) {
      if (!(key in entry)) violations.push(`SOURCE_PIN_ENTRY_KEY_MISSING:${index}:${key}`);
    }
    if (typeof entry.path === "string") {
      if (seenPaths.has(entry.path)) violations.push(`SOURCE_PIN_DUPLICATE:${entry.path}`);
      seenPaths.add(entry.path);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) violations.push(`SOURCE_PIN_BYTES_INVALID:${index}`);
    if (typeof entry.sha256 !== "string" || !SOURCE_PIN_SHA256_PATTERN.test(entry.sha256)) {
      violations.push(`SOURCE_PIN_SHA256_INVALID:${index}`);
    }
  });

  if (sourcePins.files.length !== CANONICAL_SOURCE_PIN_FILES.length) {
    violations.push(
      `SOURCE_PIN_COUNT_MISMATCH:${sourcePins.files.length}!=${CANONICAL_SOURCE_PIN_FILES.length}`,
    );
  }
  const canonicalPaths = new Set(CANONICAL_SOURCE_PIN_FILES.map((file) => file.path));
  for (const seenPath of seenPaths) {
    if (!canonicalPaths.has(seenPath)) violations.push(`SOURCE_PIN_PATH_EXTRA:${seenPath}`);
  }
  for (const canonical of CANONICAL_SOURCE_PIN_FILES) {
    if (!seenPaths.has(canonical.path)) violations.push(`SOURCE_PIN_PATH_MISSING:${canonical.path}`);
  }
  CANONICAL_SOURCE_PIN_FILES.forEach((canonical, index) => {
    const actual = sourcePins.files[index];
    if (!isPlainObject(actual) || actual.path !== canonical.path) {
      violations.push(`SOURCE_PIN_ORDER_MISMATCH:${index}:${canonical.path}`);
      return;
    }
    if (actual.bytes !== canonical.bytes) violations.push(`SOURCE_PIN_BYTES_MISMATCH:${canonical.path}`);
    if (actual.sha256 !== canonical.sha256) violations.push(`SOURCE_PIN_SHA256_MISMATCH:${canonical.path}`);
  });

  return [...new Set(violations)];
}

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

test("canonicalAddendum sourcePins has the exact closed six-entry shape and canonical values", () => {
  assert.deepEqual(sourcePinsShapeViolations(canonicalAddendum.sourcePins), []);
});

test("canonicalAddendum externalEvidenceReport is portable: verified/6 where the evidence root exists, honest absent/0 where it does not, never drifted either way", () => {
  const report = externalEvidenceReport(canonicalAddendum);
  assert.notEqual(report.state, "drifted");
  if (existsSync(CANONICAL_EVIDENCE_ROOT)) {
    assert.deepEqual(report, {
      state: "verified",
      findings: [],
      verifiedFiles: 6,
      derivedProjectionMatches: null,
    });
  } else {
    assert.deepEqual(report, {
      state: "absent",
      findings: [],
      verifiedFiles: 0,
      derivedProjectionMatches: null,
    });
  }
});

test("canonicalAddendum preserves capabilityDelta, nonAuthorizations, semantics and the counter fields the P00-derived projections declare", () => {
  assert.equal(canonicalAddendum.package, "PKG-05");
  assert.equal(canonicalAddendum.status, "PARTIAL_ADDITIVE");
  assert.equal(canonicalAddendum.capabilityDelta, "NONE");
  assert.deepEqual(addendumContractViolations(canonicalAddendum), []);
  assert.equal(canonicalAddendum.phaseChainProjection.phaseCount, 13);
  assert.equal(canonicalAddendum.closureEdgeProjection.edgeCount, 53);
  assert.equal(canonicalAddendum.gapRegistryProjection.gapCount, 90);
});

test("a byte or sha256 mutation on a canonical pin is reported as drift, never as verified", () => {
  const mutatedBytes = structuredClone(canonicalAddendum);
  mutatedBytes.sourcePins.files[0].bytes += 1;
  assert.equal(externalEvidenceReport(mutatedBytes).state, "drifted");

  const mutatedSha = structuredClone(canonicalAddendum);
  mutatedSha.sourcePins.files[0].sha256 = "f".repeat(64);
  assert.equal(externalEvidenceReport(mutatedSha).state, "drifted");
});

test("externalEvidenceReport reports honest absence when the evidence root is wholly unavailable", () => {
  const relocated = structuredClone(canonicalAddendum);
  relocated.sourcePins.evidenceRoot = path.join(os.tmpdir(), `p01-source-pins-absent-${process.pid}`);
  assert.deepEqual(externalEvidenceReport(relocated), {
    state: "absent",
    findings: [],
    verifiedFiles: 0,
    derivedProjectionMatches: null,
  });
});

test("an unknown key on the sourcePins container or on an entry is a shape violation", () => {
  const extraContainerKey = structuredClone(canonicalAddendum.sourcePins);
  extraContainerKey.role = "evidence";
  assert.ok(sourcePinsShapeViolations(extraContainerKey).includes("SOURCE_PINS_KEY_EXTRA:role"));

  const extraEntryKey = structuredClone(canonicalAddendum.sourcePins);
  extraEntryKey.files[0] = { ...extraEntryKey.files[0], immutable: true };
  assert.ok(
    sourcePinsShapeViolations(extraEntryKey).some((finding) => finding.startsWith("SOURCE_PIN_ENTRY_KEY_EXTRA:0:")),
  );
});

test("removing, duplicating or reordering a pinned entry is reported exactly", () => {
  const removed = structuredClone(canonicalAddendum.sourcePins);
  const removedPath = removed.files[0].path;
  removed.files.splice(0, 1);
  const removedViolations = sourcePinsShapeViolations(removed);
  assert.ok(removedViolations.includes(`SOURCE_PIN_PATH_MISSING:${removedPath}`));
  assert.ok(removedViolations.some((finding) => finding.startsWith("SOURCE_PIN_COUNT_MISMATCH")));

  const duplicated = structuredClone(canonicalAddendum.sourcePins);
  duplicated.files.push(structuredClone(duplicated.files[0]));
  const duplicatedViolations = sourcePinsShapeViolations(duplicated);
  assert.ok(duplicatedViolations.some((finding) => finding.startsWith("SOURCE_PIN_DUPLICATE:")));
  assert.ok(duplicatedViolations.some((finding) => finding.startsWith("SOURCE_PIN_COUNT_MISMATCH")));

  const reordered = structuredClone(canonicalAddendum.sourcePins);
  [reordered.files[0], reordered.files[1]] = [reordered.files[1], reordered.files[0]];
  const reorderedViolations = sourcePinsShapeViolations(reordered);
  assert.ok(reorderedViolations.some((finding) => finding.startsWith("SOURCE_PIN_ORDER_MISMATCH")));
});
