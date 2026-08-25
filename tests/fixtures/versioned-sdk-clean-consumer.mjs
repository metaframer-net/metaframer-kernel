// P09 — standalone builtins-only clean consumer fixture. Consumes a materialized P08
// versioned action SDK distribution payload from cwd, validating version, path safety,
// manifest shape, module existence, and exact integrity bytes before any dynamic import.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function fail(code, message) {
  process.stderr.write(`CLEAN_CONSUMER_ERROR:${code} ${message}\n`);
  process.exit(1);
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

function isSafeRelativePath(value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).some((segment) => segment === "..");
}

async function main() {
  const expectedVersion = process.argv[2];
  if (!isNonEmptyString(expectedVersion)) fail("VERSION_MISMATCH", "no expected distribution version supplied");

  const cwd = process.cwd();
  const manifestPath = path.join(cwd, "manifest.json");

  let manifestRaw;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    fail("MISSING_FILE", "manifest.json not found");
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    fail("MALFORMED_MANIFEST", "manifest.json is not valid JSON");
  }
  if (!isOrdinaryObject(manifest)) fail("MALFORMED_MANIFEST", "manifest.json must decode to an ordinary object");

  const { schemaVersion, format, distributionVersion, coordinate, action, modulePath, integrity } = manifest;
  if (
    schemaVersion !== 1 ||
    format !== "esm" ||
    !isNonEmptyString(distributionVersion) ||
    !isNonEmptyString(coordinate) ||
    !isOrdinaryObject(action) ||
    typeof action.kind !== "string" ||
    typeof action.name !== "string" ||
    !Number.isSafeInteger(action.version) ||
    !isNonEmptyString(modulePath) ||
    !isNonEmptyString(integrity) ||
    !integrity.startsWith("sha256:")
  ) {
    fail("MALFORMED_MANIFEST", "manifest.json is missing or has malformed required fields");
  }

  if (distributionVersion !== expectedVersion) {
    fail("VERSION_MISMATCH", `expected ${expectedVersion}, found ${distributionVersion}`);
  }
  if (!isSafeRelativePath(modulePath)) fail("UNSAFE_PATH", `unsafe module path: ${modulePath}`);

  const resolvedModulePath = path.resolve(cwd, modulePath);
  const resolvedCwd = path.resolve(cwd);
  if (resolvedModulePath !== resolvedCwd && !resolvedModulePath.startsWith(resolvedCwd + path.sep)) {
    fail("UNSAFE_PATH", `module path escapes the payload root: ${modulePath}`);
  }

  let moduleSource;
  try {
    moduleSource = await readFile(resolvedModulePath, "utf8");
  } catch {
    fail("MISSING_FILE", `module file not found: ${modulePath}`);
  }

  const digestInput = JSON.stringify({
    schemaVersion: 1,
    distributionVersion,
    coordinate,
    action: { kind: action.kind, name: action.name, version: action.version },
    modulePath,
    moduleSource,
  });
  const computedIntegrity = `sha256:${createHash("sha256").update(digestInput, "utf8").digest("hex")}`;
  if (computedIntegrity !== integrity) fail("INTEGRITY_MISMATCH", "computed integrity does not match manifest integrity");

  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
  const mod = await import(moduleUrl);

  const sampleSpec = Object.fromEntries(mod.ACTION_FIELDS.map((field) => [field, "x"]));
  let buildActionSpecOk = false;
  if (typeof mod.buildActionSpec === "function") {
    const built = mod.buildActionSpec(sampleSpec);
    const builtKeys = Reflect.ownKeys(built ?? {});
    buildActionSpecOk =
      Object.isFrozen(built) &&
      builtKeys.length === mod.ACTION_FIELDS.length &&
      mod.ACTION_FIELDS.every((field) => builtKeys.includes(field));
  }

  const report = {
    manifest: { coordinate, distributionVersion },
    action: { kind: action.kind, name: action.name, version: action.version },
    module: {
      modulePath,
      buildActionSpecOk,
      isOutcomeOk: typeof mod.isOutcome === "function" && mod.OUTCOMES.every((o) => mod.isOutcome(o)),
      isErrorEnvelopeOk:
        typeof mod.isErrorEnvelope === "function" &&
        mod.isErrorEnvelope(Object.fromEntries(mod.ERROR_ENVELOPE_FIELDS.map((field) => [field, "x"]))),
    },
  };

  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main();
