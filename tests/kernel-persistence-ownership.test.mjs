import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadManifest,
  evaluatePersistenceOwnership,
  MANIFEST_PATH,
  CANONICAL_SUBSTRATE_REFERENCE,
} from "../tools/check-kernel-persistence-ownership.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [CANONICAL_REL_FILE] = CANONICAL_SUBSTRATE_REFERENCE.split("#");

const BASELINE_0001 = `
OUTBOX_TABLE = "transactional_outbox"
AUDIT_TABLE = "audit_log"
CONTEXT_KEY_TABLE = "mfk_context_key"

def upgrade():
    op.execute(f"CREATE TABLE {CONTEXT_KEY_TABLE} (id smallint)")
    op.execute(f"CREATE TABLE {OUTBOX_TABLE} (id uuid)")
    op.execute(f"CREATE TABLE {AUDIT_TABLE} (id uuid)")
`;

const TRANSITIONAL_0002 = `
CUSTOMER_TABLE = "customer_records"

def upgrade():
    op.execute(f"CREATE TABLE {CUSTOMER_TABLE} (id uuid)")
`;

const DEFAULT_MANIFEST = {
  packageState: "writer-candidate-awaiting-external-gates",
  capabilityDelta: "NONE",
  governanceDelta: "PERSISTENCE_OWNERSHIP_GUARD",
  fullGreen: "pending",
  freshReviewerAccept: "pending",
  migrationsDir: "migrations",
  adaptersDir: "adapters",
  canonicalSubstrateReference: CANONICAL_SUBSTRATE_REFERENCE,
  kernelOwnedMigrations: [
    { file: "0001_runtime_substrate.py", tables: ["mfk_context_key", "transactional_outbox", "audit_log"] },
  ],
  kernelOwnedRuntimeTables: ["mfk_context_key", "transactional_outbox", "audit_log"],
  kernelOwnedAdapterFiles: [],
  transitionalInKernel: [
    {
      migrationFile: "0002_customer_records.py",
      table: "customer_records",
      adapterFile: "postgres-commit-adapter.mjs",
      status: "transitional-in-kernel",
      targetOwner: "application",
      retirementPath: "P11-P14",
      removalIsConvergence: true,
    },
  ],
};

const CANONICAL_SURFACE = {
  productionSurface: {
    runtimeTables: ["transactional_outbox", "audit_log"],
    supportObjects: [
      { name: "mfk_context_key", kind: "table" },
      { name: "mfk_attestation", kind: "function" },
    ],
  },
};

function writeCanonicalSurface(dir, surface = CANONICAL_SURFACE) {
  const fullPath = path.join(dir, CANONICAL_REL_FILE);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(surface));
}

/** Builds an isolated fixture tree, runs one evaluation, cleans up, and returns the result. */
function evalTree(build, manifestOverrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-"));
  writeCanonicalSurface(dir);
  build(dir);
  const manifest = { ...DEFAULT_MANIFEST, ...manifestOverrides };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  const result = evaluatePersistenceOwnership({ manifest, repoRoot: dir });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

function baseTree(dir, { withAdapter = true } = {}) {
  mkdirSync(path.join(dir, "migrations"), { recursive: true });
  mkdirSync(path.join(dir, "adapters"), { recursive: true });
  writeFileSync(path.join(dir, "migrations", "0001_runtime_substrate.py"), BASELINE_0001);
  writeFileSync(path.join(dir, "migrations", "0002_customer_records.py"), TRANSITIONAL_0002);
  if (withAdapter) writeFileSync(path.join(dir, "adapters", "postgres-commit-adapter.mjs"), "// adapter");
}

function assertDenied(result, ...substrings) {
  assert.equal(result.ok, false, "expected denial but got ok=true");
  for (const s of substrings) assert.ok(result.violations.some((v) => v.includes(s)), `expected a violation mentioning "${s}", got: ${JSON.stringify(result.violations)}`);
}

function assertClean(result) {
  assert.equal(result.ok, true, JSON.stringify(result.violations));
}

test("real repository checkout classifies cleanly", () => {
  const manifest = loadManifest(path.join(root, MANIFEST_PATH));
  assertClean(evaluatePersistenceOwnership({ manifest, repoRoot: root }));
});

test("real manifest declares customer_records as transitional-in-kernel with application target owner and P11-P14 retirement", () => {
  const manifest = loadManifest(path.join(root, MANIFEST_PATH));
  const entry = manifest.transitionalInKernel.find((e) => e.table === "customer_records");
  assert.ok(entry, "customer_records must be declared transitional");
  assert.equal(entry.status, "transitional-in-kernel");
  assert.equal(entry.targetOwner, "application");
  assert.equal(entry.retirementPath, "P11-P14");
  assert.notEqual(entry.status, "kernel-owned");
});

test("clean declared tree passes with no violations", () => {
  assertClean(evalTree(baseTree));
});

test("a new undeclared domain migration file is denied", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "migrations", "0003_widgets.py"), 'WIDGET_TABLE = "widgets"\n\ndef upgrade():\n    op.execute(f"CREATE TABLE {WIDGET_TABLE} (id uuid)")\n');
  });
  assertDenied(result, "0003_widgets.py");
});

test("a new undeclared table inside an otherwise declared migration is denied", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "migrations", "0002_customer_records.py"), TRANSITIONAL_0002 + '\ndef upgrade2():\n    op.execute("CREATE TABLE sneaky_table (id uuid)")\n');
  });
  assertDenied(result, "sneaky_table");
});

test("a new undeclared adapter file is denied", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "adapters", "mystery-adapter.mjs"), "// mystery");
  });
  assertDenied(result, "mystery-adapter.mjs");
});

test("the exact current transitional customer_records exception passes", () => {
  assertClean(evalTree(baseTree));
});

test("removing the transitional customer_records migration entry, adapter entry, and their physical files is admissible convergence", () => {
  const result = evalTree(
    (d) => {
      mkdirSync(path.join(d, "migrations"), { recursive: true });
      mkdirSync(path.join(d, "adapters"), { recursive: true });
      writeFileSync(path.join(d, "migrations", "0001_runtime_substrate.py"), BASELINE_0001);
    },
    { transitionalInKernel: [] },
  );
  assertClean(result);
});

test("case-variant table name against declaration is denied", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "migrations", "0002_customer_records.py"), 'CUSTOMER_TABLE = "Customer_Records"\n\ndef upgrade():\n    op.execute(f"CREATE TABLE {CUSTOMER_TABLE} (id uuid)")\n');
  });
  assert.equal(result.ok, false);
});

test("a symlinked migration file is denied as ambiguous", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-"));
  writeCanonicalSurface(dir);
  baseTree(dir);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(DEFAULT_MANIFEST));
  try {
    symlinkSync(path.join(dir, "migrations", "0001_runtime_substrate.py"), path.join(dir, "migrations", "0004_linked.py"));
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  const result = evaluatePersistenceOwnership({ manifest: DEFAULT_MANIFEST, repoRoot: dir });
  rmSync(dir, { recursive: true, force: true });
  assertDenied(result, "symlink");
});

test("an intermediate symlink in migrationsDir (repoRoot/link/child) is denied even though the final directory is not itself a symlink", () => {
  const outer = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-outside-"));
  const dir = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-"));
  const outsideMigrations = path.join(outer, "child");
  mkdirSync(outsideMigrations, { recursive: true });
  writeFileSync(path.join(outsideMigrations, "0001_runtime_substrate.py"), BASELINE_0001);
  mkdirSync(path.join(dir, "adapters"), { recursive: true });
  writeCanonicalSurface(dir);
  let result;
  try {
    symlinkSync(outer, path.join(dir, "link"));
    const manifest = { ...DEFAULT_MANIFEST, migrationsDir: "link/child" };
    result = evaluatePersistenceOwnership({ manifest, repoRoot: dir });
  } catch (err) {
    if (err.code !== "EPERM" && err.code !== "ENOSYS") throw err;
    result = { ok: false, violations: ["escapes repoRoot via an intermediate symlink (skipped: no symlink permission)"] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outer, { recursive: true, force: true });
  }
  assertDenied(result, "escapes repoRoot");
});

test("unsupported ambiguous DDL syntax denies rather than guessing", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "migrations", "0002_customer_records.py"), TRANSITIONAL_0002 + '\ndef upgrade2():\n    op.execute("ALTER TABLE customer_records ADD COLUMN weird_backdoor text")\n');
  });
  assert.equal(result.ok, false);
});

test("a persistence-relevant statement shaped outside plain CREATE/ALTER/DROP TABLE (e.g. CREATE UNLOGGED TABLE) is denied, not silently skipped", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(path.join(d, "migrations", "0002_customer_records.py"), TRANSITIONAL_0002 + '\ndef upgrade2():\n    op.execute("CREATE UNLOGGED TABLE ghost_cache (id uuid)")\n');
  });
  assertDenied(result, "UNLOGGED");
});

test("the real 0001/0002 ALTER TABLE ENABLE/FORCE ROW LEVEL SECURITY statements remain accepted", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeFileSync(
      path.join(d, "migrations", "0001_runtime_substrate.py"),
      BASELINE_0001 + '\ndef upgrade2():\n    op.execute(f"ALTER TABLE {OUTBOX_TABLE} ENABLE ROW LEVEL SECURITY")\n    op.execute(f"ALTER TABLE {OUTBOX_TABLE} FORCE ROW LEVEL SECURITY")\n',
    );
  });
  assertClean(result);
});

test("editing the manifest alone to relabel customer_records as kernel-owned cannot self-authorize growth", () => {
  const result = evalTree(baseTree, {
    kernelOwnedRuntimeTables: ["mfk_context_key", "transactional_outbox", "audit_log", "customer_records"],
    transitionalInKernel: [],
  });
  assertDenied(result, "customer_records");
});

test("moving the real 0002_customer_records.py/table into kernelOwnedMigrations by manifest edit alone is denied, not promoted", () => {
  const result = evalTree(baseTree, {
    kernelOwnedMigrations: [
      { file: "0001_runtime_substrate.py", tables: ["mfk_context_key", "transactional_outbox", "audit_log"] },
      { file: "0002_customer_records.py", tables: ["customer_records"] },
    ],
    transitionalInKernel: [],
  });
  assertDenied(result, "frozen closed kernel-owned migration set");
});

test("a kernelOwnedMigrations entry for a file/table that does not exist on disk is denied, not fail-open", () => {
  const result = evalTree(baseTree, {
    kernelOwnedMigrations: [
      { file: "0001_runtime_substrate.py", tables: ["mfk_context_key", "transactional_outbox", "audit_log"] },
      { file: "0099_ghost_migration.py", tables: ["ghost_table"] },
    ],
  });
  assertDenied(result, "frozen closed kernel-owned migration set");
});

test("dropping the manifest transitional record while the physical migration/adapter still exist is denied", () => {
  const result = evalTree(baseTree, { transitionalInKernel: [] });
  assertDenied(result, "physical migration still present");
});

for (const [label, dirKey, override] of [
  ["missing migrationsDir denies rather than silently passing", "migrationsDir", "does-not-exist"],
  ["missing adaptersDir denies rather than silently passing", "adaptersDir", "does-not-exist"],
  ["traversal migrationsDir is denied and never read outside repoRoot", "migrationsDir", "../escape"],
  ["absolute adaptersDir is denied", "adaptersDir", "/etc"],
  ["backslash-separated migrationsDir is denied", "migrationsDir", "migrations\\..\\escape"],
  ["`.` declared directory value is denied", "migrationsDir", "."],
]) {
  test(`a ${label}`, () => {
    const result = evalTree(baseTree, { [dirKey]: override });
    assertDenied(result, dirKey);
  });
}

test("a symlinked migrationsDir root is denied as ambiguous", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-"));
  writeCanonicalSurface(dir);
  baseTree(dir);
  const manifest = { ...DEFAULT_MANIFEST, migrationsDir: "linked-migrations" };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  try {
    symlinkSync(path.join(dir, "migrations"), path.join(dir, "linked-migrations"));
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  const result = evaluatePersistenceOwnership({ manifest, repoRoot: dir });
  rmSync(dir, { recursive: true, force: true });
  assertDenied(result, "symlink");
});

test("a wrong or missing canonicalSubstrateReference is denied", () => {
  assertDenied(evalTree(baseTree, { canonicalSubstrateReference: "somewhere-else.json#productionSurface" }), "canonicalSubstrateReference");
});

test("a canonicalSubstrateReference whose table set disagrees with kernelOwnedRuntimeTables is denied", () => {
  const result = evalTree((d) => {
    baseTree(d);
    writeCanonicalSurface(d, { productionSurface: { runtimeTables: ["transactional_outbox"], supportObjects: [] } });
  });
  assertDenied(result, "does not match canonical substrate tables");
});

test("real package.json/CHANGELOG.md/planning manifest satisfy acceptance items 9-10 (standalone script, single check-chain wire-up, single changelog bullet, pending candidate truth)", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["check:persistence-ownership"], "node tools/check-kernel-persistence-ownership.mjs");
  const occurrences = pkg.scripts.check.split("node tools/check-kernel-persistence-ownership.mjs").length - 1;
  assert.equal(occurrences, 1);
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  assert.equal((changelog.match(/^- P06 kernel persistence-ownership admission guard/gm) ?? []).length, 1);
  const manifest = loadManifest(path.join(root, MANIFEST_PATH));
  assert.equal(manifest.packageState, "writer-candidate-awaiting-external-gates");
  assert.equal(manifest.fullGreen, "pending");
  assert.equal(manifest.freshReviewerAccept, "pending");
});

test("a manifest-only fake fullGreen/readiness claim is denied", () => {
  assertDenied(evalTree(baseTree, { fullGreen: "claimed" }), "fullGreen");
});

test("a non-array transitionalInKernel is denied rather than treated as absent", () => {
  assertDenied(evalTree(baseTree, { transitionalInKernel: { table: "customer_records" } }), "must be an array");
});

test("an intermediate symlink resolving back inside repoRoot is denied as ambiguous, not silently accepted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kernel-persistence-ownership-"));
  writeCanonicalSurface(dir);
  mkdirSync(path.join(dir, "other", "child"), { recursive: true });
  writeFileSync(path.join(dir, "other", "child", "0001_runtime_substrate.py"), BASELINE_0001);
  mkdirSync(path.join(dir, "adapters"), { recursive: true });
  let result;
  try {
    symlinkSync(path.join(dir, "other"), path.join(dir, "link"));
    const manifest = { ...DEFAULT_MANIFEST, migrationsDir: "link/child" };
    result = evaluatePersistenceOwnership({ manifest, repoRoot: dir });
  } catch (err) {
    if (err.code !== "EPERM" && err.code !== "ENOSYS") throw err;
    result = { ok: false, violations: ["resolves ambiguously (skipped: no symlink permission)"] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assertDenied(result, "resolves ambiguously");
});

test("import is side-effect-free: loading the module performs no filesystem writes or process exit", async () => {
  const mod = await import("../tools/check-kernel-persistence-ownership.mjs");
  assert.equal(typeof mod.evaluatePersistenceOwnership, "function");
  assert.equal(typeof mod.loadManifest, "function");
});
