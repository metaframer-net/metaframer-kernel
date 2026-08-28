// P24A — consumer diagnostics distribution. An ADDITIVE wrapper over the P08 versioned action SDK
// distribution: it reuses that payload byte for byte and ships one extra file, a builtins-only
// `diagnose.mjs`, bound to the payload by a second manifest digest alongside the untouched P08
// `integrity`. P08's own merged test freezes that generator's manifest text, so nothing here edits
// it; the legacy manifest is read back and extended, never rewritten. This produces bytes only: it
// starts no host, no container and no database, and it makes no readiness claim.

import { createHash } from "node:crypto";
import { renderVersionedActionSdkDistribution } from "./generate-versioned-action-sdk-distribution.mjs";

const DIAGNOSTICS_PATH = "diagnose.mjs";

// The shipped runner, embedded verbatim via String.raw so its own escape sequences survive. It uses
// no backtick and no interpolation, so these bytes are exactly what lands in the payload.
const DIAGNOSTICS_SOURCE = String.raw`// P24A — shipped payload diagnostics runner. Reads the materialized distribution rooted at the
// current working directory, then verifies, in one fixed gate order, that the manifest is present,
// parses, has the declared shape, carries the expected distribution version, keeps both declared
// paths inside the payload root, that both declared files are present, that the generated module
// and this runner each still match their digest, and only then that the module evaluates. Node
// builtins only: no dependency, no network, no subprocess, no repository path, nothing written.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ERROR_PREFIX = "CONSUMER_DIAGNOSTICS_ERROR";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CHECK_NAMES = Object.freeze([
  "manifest_present",
  "manifest_parsed",
  "manifest_shape",
  "distribution_version",
  "module_path_safety",
  "diagnostics_path_safety",
  "module_present",
  "module_integrity",
  "diagnostics_integrity",
  "module_evaluation",
]);

function fail(code, detail) {
  process.stderr.write(ERROR_PREFIX + ":" + code + " " + detail + "\n");
  process.exit(1);
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const digest = (value) => "sha256:" + createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

// A declared path is usable only when it is relative, stays under the payload root and is not the
// root itself. Returns the absolute path, or null when the path leaves the payload.
function resolveInsideRoot(root, value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) return null;
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === "" || path.isAbsolute(relative) || relative.startsWith("..")) return null;
  return resolved;
}

async function readOrNull(absolute) {
  try {
    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const expectedVersion = process.argv[2];
  const root = path.resolve(process.cwd());

  // manifest_present
  const manifestRaw = await readOrNull(path.join(root, "manifest.json"));
  if (manifestRaw === null) fail("MISSING_FILE", "manifest.json is not present in the payload root");

  // manifest_parsed
  let manifest = null;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    fail("MALFORMED_MANIFEST", "manifest.json is not valid JSON");
  }
  if (!isOrdinaryObject(manifest)) fail("MALFORMED_MANIFEST", "manifest.json must decode to an ordinary object");

  // manifest_shape
  const { schemaVersion, format, distributionVersion, coordinate, action, modulePath, integrity } = manifest;
  const { diagnosticsPath, diagnostics } = manifest;
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
    !isNonEmptyString(diagnosticsPath) ||
    !isNonEmptyString(integrity) ||
    !SHA256.test(integrity) ||
    !isNonEmptyString(diagnostics) ||
    !SHA256.test(diagnostics)
  ) {
    fail("MALFORMED_MANIFEST", "manifest.json is missing a required field or declares one in the wrong shape");
  }

  // distribution_version
  if (!isNonEmptyString(expectedVersion)) {
    fail("VERSION_MISMATCH", "no expected distribution version was supplied on the command line");
  }
  if (distributionVersion !== expectedVersion) {
    fail("VERSION_MISMATCH", "expected " + expectedVersion + ", the payload declares " + distributionVersion);
  }

  // module_path_safety
  const resolvedModule = resolveInsideRoot(root, modulePath);
  if (resolvedModule === null) fail("UNSAFE_PATH", "modulePath does not stay inside the payload root: " + modulePath);

  // diagnostics_path_safety
  const resolvedDiagnostics = resolveInsideRoot(root, diagnosticsPath);
  if (resolvedDiagnostics === null) {
    fail("UNSAFE_PATH", "diagnosticsPath does not stay inside the payload root: " + diagnosticsPath);
  }

  // module_present
  const moduleSource = await readOrNull(resolvedModule);
  if (moduleSource === null) fail("MISSING_FILE", "the generated module is not present: " + modulePath);
  const diagnosticsSource = await readOrNull(resolvedDiagnostics);
  if (diagnosticsSource === null) fail("MISSING_FILE", "the shipped runner is not present: " + diagnosticsPath);

  // module_integrity — the legacy P08 digest, recomputed over exactly the P08 input.
  const computedIntegrity = digest({
    schemaVersion: 1,
    distributionVersion,
    coordinate,
    action: { kind: action.kind, name: action.name, version: action.version },
    modulePath,
    moduleSource,
  });
  if (computedIntegrity !== integrity) {
    fail("INTEGRITY_MISMATCH", "the generated module bytes do not match the declared integrity digest");
  }

  // diagnostics_integrity — this runner's own bytes, bound to the payload it was shipped with.
  const computedDiagnostics = digest({
    schemaVersion: 1,
    distributionVersion,
    coordinate,
    integrity,
    diagnosticsPath,
    diagnosticsSource,
  });
  if (computedDiagnostics !== diagnostics) {
    fail("DIAGNOSTICS_MISMATCH", "the shipped runner bytes do not match the declared diagnostics digest");
  }

  // module_evaluation — only now, on verified bytes, is the module allowed to run.
  let mod = null;
  try {
    mod = await import("data:text/javascript;charset=utf-8," + encodeURIComponent(moduleSource));
  } catch {
    fail("MODULE_EVALUATION_FAILED", "the generated module could not be evaluated");
  }

  let exportsOk = false;
  let outcomesOk = false;
  let errorEnvelopeOk = false;
  try {
    const fields = mod.ACTION_FIELDS;
    const built = mod.buildActionSpec(Object.fromEntries(fields.map((field) => [field, "x"])));
    const builtKeys = Reflect.ownKeys(built);
    exportsOk =
      mod.ACTION_KIND === action.kind &&
      mod.ACTION_NAME === action.name &&
      mod.ACTION_VERSION === action.version &&
      Object.isFrozen(built) &&
      builtKeys.length === fields.length &&
      fields.every((field) => builtKeys.includes(field));
    outcomesOk = mod.OUTCOMES.length > 0 && mod.OUTCOMES.every((outcome) => mod.isOutcome(outcome));
    errorEnvelopeOk = mod.isErrorEnvelope(
      Object.fromEntries(mod.ERROR_ENVELOPE_FIELDS.map((field) => [field, "x"])),
    );
  } catch {
    exportsOk = false;
  }
  if (!exportsOk || !outcomesOk || !errorEnvelopeOk) {
    fail("MODULE_EVALUATION_FAILED", "the generated module does not expose its declared action surface");
  }

  const report = {
    schemaVersion: 1,
    status: "healthy",
    coordinate,
    distributionVersion,
    action: { kind: action.kind, name: action.name, version: action.version },
    integrity: { declared: integrity, computed: computedIntegrity, ok: true },
    diagnostics: { declared: diagnostics, computed: computedDiagnostics, diagnosticsPath, ok: true },
    module: { modulePath, evaluated: true, exportsOk: true, outcomesOk: true, errorEnvelopeOk: true },
    checks: CHECK_NAMES.map((name) => ({ name, ok: true })),
  };
  process.stdout.write(JSON.stringify(report) + "\n");
}

main();
`;

export function renderConsumerDiagnosticsDistribution(contract, distributionVersion) {
  const legacy = renderVersionedActionSdkDistribution(contract, distributionVersion);
  const legacyManifest = JSON.parse(legacy.files[legacy.manifestPath]);

  // The diagnostics digest binds the runner's exact bytes to the payload the P08 integrity already
  // covers, so tampering with either the runner or the legacy manifest is detectable separately.
  const digestInput = JSON.stringify({
    schemaVersion: 1,
    distributionVersion: legacy.distributionVersion,
    coordinate: legacyManifest.coordinate,
    integrity: legacyManifest.integrity,
    diagnosticsPath: DIAGNOSTICS_PATH,
    diagnosticsSource: DIAGNOSTICS_SOURCE,
  });
  const diagnostics = `sha256:${createHash("sha256").update(digestInput, "utf8").digest("hex")}`;

  const manifest = { ...legacyManifest, diagnosticsPath: DIAGNOSTICS_PATH, diagnostics };

  const files = Object.freeze({
    ...legacy.files,
    [legacy.manifestPath]: `${JSON.stringify(manifest)}\n`,
    [DIAGNOSTICS_PATH]: DIAGNOSTICS_SOURCE,
  });

  return Object.freeze({
    coordinate: legacy.coordinate,
    distributionVersion: legacy.distributionVersion,
    manifestPath: legacy.manifestPath,
    modulePath: legacy.modulePath,
    diagnosticsPath: DIAGNOSTICS_PATH,
    files,
  });
}
