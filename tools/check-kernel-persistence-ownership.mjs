import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// P06 — kernel persistence-ownership admission guard
//
// A read-only, dependency-free, deterministic build-time check. It classifies every table this
// checkout's Alembic migrations create and every adapter file under `src/adapters` against a
// closed set pinned here in code, not merely in the editable manifest, and denies anything that
// set does not name. It is not a general SQL parser: any DDL shape it does not recognize denies
// rather than guessing. The manifest may only restate this closed set (or drop the one
// transitional record once its physical artifacts are also gone, which is convergence); it can
// never grow or relabel it. Support-object/table representation for the kernel runtime substrate
// is bound to the existing canonical source rather than duplicated here.
// =====================================================================================

export const MANIFEST_PATH = "planning/kernel-persistence-ownership.json";

// The one closed kernel-owned migration and its exact table set. Frozen in code: no manifest edit
// can add, remove, or relabel a table here.
const FROZEN_KERNEL_MIGRATIONS = [
  { file: "0001_runtime_substrate.py", tables: ["mfk_context_key", "transactional_outbox", "audit_log"] },
];
const FROZEN_KERNEL_ADAPTER_FILES = [];

// The one closed transitional-in-kernel fact. Present exactly as-is, or wholly absent once its
// physical migration and adapter are also gone — never edited into something else.
const FROZEN_TRANSITIONAL = {
  migrationFile: "0002_customer_records.py",
  table: "customer_records",
  adapterFile: "postgres-commit-adapter.mjs",
  status: "transitional-in-kernel",
  targetOwner: "application",
  retirementPath: "P11-P14",
  removalIsConvergence: true,
};

// The one canonical source this checker cross-checks its runtime-substrate table set against,
// instead of duplicating that representation. Format: "<repo-relative-file>#<top-level-key>".
export const CANONICAL_SUBSTRATE_REFERENCE = "db/kernel-runtime-substrate-s1.json#productionSurface";

// This is a governance-only build-time guard: it can never itself become evidence of a full-green
// QA pass, an independent reviewer accept, or any readiness/capability movement. Pinning these
// values in code closes the gap where a manifest edit alone could fake that claim.
const FROZEN_GOVERNANCE_FIELDS = {
  packageState: "writer-candidate-awaiting-external-gates",
  capabilityDelta: "NONE",
  governanceDelta: "PERSISTENCE_OWNERSHIP_GUARD",
  fullGreen: "pending",
  freshReviewerAccept: "pending",
};

export function loadManifest(absPath) {
  return JSON.parse(readFileSync(absPath, "utf8"));
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function frozenMigrationsMatch(declared) {
  if (!Array.isArray(declared) || declared.length !== FROZEN_KERNEL_MIGRATIONS.length) return false;
  return FROZEN_KERNEL_MIGRATIONS.every((frozen, i) => {
    const d = declared[i];
    return d && d.file === frozen.file && sameSet(d.tables ?? [], frozen.tables);
  });
}

/**
 * A declared path must be repository-relative and confined: no empty/`.`/`..` value, no absolute
 * root, no backslash separator, and no `.` or `..` path segment anywhere in it.
 */
function isConfinedRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value === "." || value === "..") return false;
  if (path.isAbsolute(value)) return false;
  if (value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * Resolves a declared repository-relative path against `repoRoot` using real-path confinement, so
 * an intermediate symlink (`repoRoot/link/child`, where `child` itself is an ordinary directory)
 * cannot smuggle the resolution outside `repoRoot` even though the final path segment is not
 * itself a symlink. The final segment is still separately denied if it is a symlink. Returns
 * `{ realPath, violation }`; `realPath` is null whenever `violation` is set, so callers never read
 * a path this rejected.
 */
function resolveConfined(repoRoot, relValue, label, kind) {
  if (!isConfinedRelativePath(relValue)) {
    return { realPath: null, violation: `invalid ${label} (must be a confined repository-relative path): "${relValue}"` };
  }
  const repoRootAbs = path.resolve(repoRoot);
  let repoRootReal;
  try {
    repoRootReal = realpathSync(repoRootAbs);
  } catch {
    return { realPath: null, violation: `repoRoot is unreadable while resolving ${label}` };
  }
  const lexicalAbs = path.resolve(repoRootAbs, relValue);
  let lexicalStat;
  try {
    lexicalStat = lstatSync(lexicalAbs);
  } catch {
    return { realPath: null, violation: `${label} is missing or unreadable: "${relValue}"` };
  }
  if (lexicalStat.isSymbolicLink()) {
    return { realPath: null, violation: `${label} root is an ambiguous symlink: "${relValue}"` };
  }
  let real;
  try {
    real = realpathSync(lexicalAbs);
  } catch {
    return { realPath: null, violation: `${label} is missing or unreadable: "${relValue}"` };
  }
  const expected = path.join(repoRootReal, ...relValue.split("/"));
  if (real !== expected) {
    return {
      realPath: null,
      violation: `${label} escapes repoRoot or resolves ambiguously via an intermediate symlink: "${relValue}"`,
    };
  }
  const finalStat = statSync(real);
  if (kind === "directory" && !finalStat.isDirectory()) {
    return { realPath: null, violation: `${label} is not a directory: "${relValue}"` };
  }
  if (kind === "file" && !finalStat.isFile()) {
    return { realPath: null, violation: `${label} is not a file: "${relValue}"` };
  }
  return { realPath: real, violation: null };
}

// Statements this checker actively recognizes. Anything else that mentions TABLE after a
// CREATE/ALTER keyword is treated as an unsupported, persistence-relevant shape and denied rather
// than silently ignored — this is a conservative fence, not a SQL parser.
const RECOGNIZED_TABLE_STATEMENT = /\b(CREATE|ALTER|DROP)\s+((?:[A-Z]+\s+){0,3}TABLE)\s+([^\n(]+)/gi;
const ALTER_RLS_ALLOWED = /^(\{(\w+)\}|[A-Za-z_]\w*)\s+(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i;
const VAR_ASSIGNMENT = /^(\w+)\s*=\s*"([A-Za-z0-9_]+)"\s*$/gm;
const LEADING_TOKEN = /^(\{(\w+)\}|([A-Za-z_]\w*))/;

/**
 * Extracts every table name a migration file's source text creates via a plain `CREATE TABLE`,
 * resolving `{VAR}` f-string placeholders against that file's own `VAR = "literal"` assignments.
 * Any CREATE/ALTER/DROP-TABLE-shaped statement this cannot confidently classify is reported as a
 * violation rather than silently skipped or guessed.
 */
function extractCreatedTables(content, fileLabel) {
  const varMap = new Map();
  for (const match of content.matchAll(VAR_ASSIGNMENT)) varMap.set(match[1], match[2]);

  const tables = [];
  const violations = [];

  for (const match of content.matchAll(RECOGNIZED_TABLE_STATEMENT)) {
    const verb = match[1].toUpperCase();
    const modifier = match[2].replace(/\s+/g, " ").trim().toUpperCase();
    const rest = match[3].trim();

    if (verb === "DROP") continue; // removal is admissible convergence, any modifier

    if (modifier !== "TABLE") {
      violations.push(`unsupported ambiguous DDL in ${fileLabel}: "${verb} ${modifier}" is not a recognized table statement shape ("${rest}")`);
      continue;
    }

    if (verb === "ALTER") {
      if (!ALTER_RLS_ALLOWED.test(rest)) {
        violations.push(`unsupported ambiguous DDL in ${fileLabel}: ALTER TABLE construct is not recognized: "${rest}"`);
      }
      continue;
    }

    const tokenMatch = LEADING_TOKEN.exec(rest);
    if (!tokenMatch) {
      violations.push(`unsupported ambiguous DDL in ${fileLabel}: cannot resolve table name in "${rest}"`);
      continue;
    }
    if (tokenMatch[2] !== undefined) {
      const resolved = varMap.get(tokenMatch[2]);
      if (resolved === undefined) {
        violations.push(`unsupported ambiguous DDL in ${fileLabel}: unresolved f-string variable {${tokenMatch[2]}}`);
        continue;
      }
      tables.push(resolved);
    } else {
      tables.push(tokenMatch[3]);
    }
  }

  return { tables, violations };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function validateCanonicalReference(manifest, repoRoot, violations) {
  if (manifest.canonicalSubstrateReference !== CANONICAL_SUBSTRATE_REFERENCE) {
    violations.push(`canonicalSubstrateReference must be exactly "${CANONICAL_SUBSTRATE_REFERENCE}"`);
    return;
  }
  const [filePart, pointer] = CANONICAL_SUBSTRATE_REFERENCE.split("#");
  const { realPath, violation } = resolveConfined(repoRoot, filePart, "canonicalSubstrateReference file", "file");
  if (violation) {
    violations.push(violation);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(realPath, "utf8"));
  } catch {
    violations.push(`canonicalSubstrateReference file is not valid JSON: "${filePart}"`);
    return;
  }
  const surface = parsed?.[pointer];
  if (surface === undefined) {
    violations.push(`canonicalSubstrateReference does not resolve "${pointer}" in "${filePart}"`);
    return;
  }
  const canonicalTables = [
    ...(surface.runtimeTables ?? []),
    ...(surface.supportObjects ?? []).filter((o) => o.kind === "table").map((o) => o.name),
  ];
  if (!sameSet(canonicalTables, manifest.kernelOwnedRuntimeTables ?? [])) {
    violations.push(
      `kernelOwnedRuntimeTables [${(manifest.kernelOwnedRuntimeTables ?? []).join(", ")}] does not match canonical substrate tables [${canonicalTables.join(", ")}]`,
    );
  }
}

/**
 * Evaluates the persistence-ownership manifest against a real filesystem tree. `repoRoot` is the
 * root to resolve `manifest.migrationsDir` / `manifest.adaptersDir` against — the real repository
 * checkout in production use, or an isolated fixture tree in tests. Never reads outside
 * `repoRoot` (verified by real-path confinement, not lexical resolution alone).
 */
export function evaluatePersistenceOwnership({ manifest, repoRoot }) {
  const violations = [];

  for (const [field, expected] of Object.entries(FROZEN_GOVERNANCE_FIELDS)) {
    if (manifest[field] !== expected) {
      violations.push(`manifest field "${field}" must be exactly "${expected}", found ${JSON.stringify(manifest[field])}`);
    }
  }

  if (!frozenMigrationsMatch(manifest.kernelOwnedMigrations)) {
    violations.push("kernelOwnedMigrations does not match the frozen closed kernel-owned migration set");
  }
  if (!deepEqual([...(manifest.kernelOwnedAdapterFiles ?? [])].sort(), FROZEN_KERNEL_ADAPTER_FILES)) {
    violations.push("kernelOwnedAdapterFiles does not match the frozen closed kernel-owned adapter set");
  }

  let declaredTransitional = manifest.transitionalInKernel;
  if (!Array.isArray(declaredTransitional)) {
    violations.push("transitionalInKernel must be an array");
    declaredTransitional = [];
  }
  const transitionalPresent =
    declaredTransitional.length === 1 && deepEqual(declaredTransitional[0], FROZEN_TRANSITIONAL);
  if (declaredTransitional.length > 0 && !transitionalPresent) {
    violations.push("transitionalInKernel does not match the one frozen transitional record");
  }

  const declaredMigrations = new Map(); // filename -> { tables: Set, kind: 'kernel'|'transitional' }
  const declaredAdapterFiles = new Map(); // filename -> 'kernel'|'transitional'

  for (const entry of FROZEN_KERNEL_MIGRATIONS) {
    declaredMigrations.set(entry.file, { tables: new Set(entry.tables), kind: "kernel" });
  }
  for (const file of FROZEN_KERNEL_ADAPTER_FILES) declaredAdapterFiles.set(file, "kernel");
  if (transitionalPresent) {
    declaredMigrations.set(FROZEN_TRANSITIONAL.migrationFile, {
      tables: new Set([FROZEN_TRANSITIONAL.table]),
      kind: "transitional",
    });
    declaredAdapterFiles.set(FROZEN_TRANSITIONAL.adapterFile, "transitional");
  }

  validateCanonicalReference(manifest, repoRoot, violations);

  const { realPath: migrationsDir, violation: migrationsDirViolation } = resolveConfined(
    repoRoot,
    manifest.migrationsDir,
    "migrationsDir",
    "directory",
  );
  if (migrationsDirViolation) violations.push(migrationsDirViolation);

  const foundMigrations = scanDeclaredDir(migrationsDir, declaredMigrations, ".py", "migration", violations);
  for (const filename of foundMigrations) {
    const fullPath = path.join(migrationsDir, filename);
    const content = readFileSync(fullPath, "utf8");
    const { tables, violations: extractViolations } = extractCreatedTables(content, filename);
    violations.push(...extractViolations);

    const expected = [...declaredMigrations.get(filename).tables];
    if (!sameSet(tables, expected)) {
      violations.push(`table set mismatch in ${filename}: found [${tables.join(", ")}], expected [${expected.join(", ")}]`);
    }
  }
  requireKernelFilesFound(declaredMigrations, foundMigrations, "migration", violations);
  denyOrphanedTransitionalFile(migrationsDir, FROZEN_TRANSITIONAL.migrationFile, "migration", transitionalPresent, violations);

  const { realPath: adaptersDir, violation: adaptersDirViolation } = resolveConfined(
    repoRoot,
    manifest.adaptersDir,
    "adaptersDir",
    "directory",
  );
  if (adaptersDirViolation) violations.push(adaptersDirViolation);

  const foundAdapters = scanDeclaredDir(adaptersDir, declaredAdapterFiles, null, "adapter", violations);
  requireKernelFilesFound(declaredAdapterFiles, foundAdapters, "adapter", violations);
  denyOrphanedTransitionalFile(adaptersDir, FROZEN_TRANSITIONAL.adapterFile, "adapter", transitionalPresent, violations);

  return { ok: violations.length === 0, violations };
}

function existsIgnoringSymlinkErrors(candidatePath) {
  try {
    lstatSync(candidatePath);
    return true;
  } catch {
    return false;
  }
}

/** Lists a declared directory's real files, denying symlink entries and anything undeclared. */
function scanDeclaredDir(dir, declaredMap, extFilter, kindLabel, violations) {
  const found = new Set();
  if (dir === null) return found;
  for (const filename of readdirSync(dir)) {
    const stat = lstatSync(path.join(dir, filename));
    if (stat.isSymbolicLink()) {
      violations.push(`ambiguous symlink ${kindLabel} entry denied: "${filename}"`);
      continue;
    }
    if (!stat.isFile() || (extFilter && !filename.endsWith(extFilter))) continue;
    if (!declaredMap.has(filename)) {
      violations.push(`undeclared ${kindLabel} file: ${filename}`);
      continue;
    }
    found.add(filename);
  }
  return found;
}

/** A kernel-owned declaration must match a real observed file; only transitional may be absent. */
function requireKernelFilesFound(declaredMap, found, kindLabel, violations) {
  for (const [filename, entry] of declaredMap) {
    const kind = entry.kind ?? entry;
    if (kind === "kernel" && !found.has(filename)) {
      violations.push(`kernel-owned ${kindLabel} file declared but missing or unreadable: ${filename}`);
    }
  }
}

/** A transitional record may vanish from the manifest only once its physical file is also gone. */
function denyOrphanedTransitionalFile(dir, filename, kindLabel, transitionalPresent, violations) {
  if (transitionalPresent || dir === null) return;
  if (existsIgnoringSymlinkErrors(path.join(dir, filename))) {
    violations.push(`transitional record removed from manifest but physical ${kindLabel} still present: ${filename}`);
  }
}

function main() {
  const manifest = loadManifest(path.join(root, MANIFEST_PATH));
  const result = evaluatePersistenceOwnership({ manifest, repoRoot: root });
  assert.ok(result.ok, `kernel persistence ownership guard denied this checkout:\n  - ${result.violations.join("\n  - ")}`);
  console.log("kernel persistence ownership: current checkout classifies cleanly (build-time guard only).");
}

const invokedAsCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) main();
