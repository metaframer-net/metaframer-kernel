// P24B — reference external consumer. This is the runnable half of the external consumer intake
// protocol: one file an outside team copies out, with nothing installed and nothing configured.
//
// Usage: node reference-consumer.mjs <payload-directory> <expected-distribution-version>
//
// It consumes a materialized distribution payload the way the protocol says a consumer must. The
// payload's own shipped runner, diagnose.mjs at the payload root, is executed FIRST as a separate
// process, so the payload is checked by its own gates before anything here trusts it. Only when
// that runner reports healthy is the generated module imported, and only then is one deterministic
// sample report printed on stdout.
//
// Node builtins only. No dependency, no network, no repository path, nothing written to disk.
// Every refusal exits 1, prints nothing on stdout, and emits exactly one stable
// EXTERNAL_CONSUMER_ERROR:<CODE> line at the start of a stderr line. Where a refusal sits
// relative to that import is NOT uniform, and the difference is stated rather than smoothed over:
// MISSING_ARGUMENT and DIAGNOSTICS_FAILED are both decided strictly BEFORE the generated module
// is imported, so a payload its own runner rejects is never evaluated here. MODULE_UNUSABLE
// occurs only after the import attempt has begun, and never before it. It covers two different
// states and does not flatten them: if the import itself throws, the module may not have loaded
// at all; otherwise the module did load and export validation ran after that load. It is not a
// pre-import refusal, and it is never claimed that the module is always loaded when it fires.
// This prints bytes: it starts no host, no container and no database, and it makes no claim
// about whether anyone outside has actually used the payload.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ERROR_PREFIX = "EXTERNAL_CONSUMER_ERROR";
const DIAGNOSTICS_PATH = "diagnose.mjs";
const USAGE = "usage: node reference-consumer.mjs <payload-directory> <expected-distribution-version>";

function fail(code, detail) {
  process.stderr.write(ERROR_PREFIX + ":" + code + " " + detail + "\n");
  process.exit(1);
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// One short line, so a refusal stays readable and the shipped runner's own code survives into it.
const firstLine = (text) =>
  (typeof text === "string" ? text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) : "") ?? "";

const sampleFor = (fields) => Object.fromEntries(fields.map((field) => [field, "sample-" + field]));

// --- arguments -----------------------------------------------------------------------------
const payloadRoot = process.argv[2];
const expectedVersion = process.argv[3];
if (!isNonEmptyString(payloadRoot)) fail("MISSING_ARGUMENT", "no payload directory was supplied. " + USAGE);
if (!isNonEmptyString(expectedVersion)) fail("MISSING_ARGUMENT", "no expected distribution version was supplied. " + USAGE);

// --- the payload checks itself, in its own process, before anything here trusts it -----------
const diagnose = spawnSync(process.execPath, [DIAGNOSTICS_PATH, expectedVersion], {
  cwd: payloadRoot,
  env: {},
  encoding: "utf8",
});
if (diagnose.error || diagnose.status !== 0) {
  const reason = firstLine(diagnose.stderr) || diagnose.error?.code || "exit status " + diagnose.status;
  fail("DIAGNOSTICS_FAILED", "the shipped " + DIAGNOSTICS_PATH + " did not report a healthy payload: " + reason);
}

let diagnostics = null;
try {
  diagnostics = JSON.parse(diagnose.stdout);
} catch {
  fail("DIAGNOSTICS_FAILED", "the shipped " + DIAGNOSTICS_PATH + " did not print a JSON report");
}
if (!isOrdinaryObject(diagnostics) || diagnostics.status !== "healthy" || !isOrdinaryObject(diagnostics.module)) {
  fail("DIAGNOSTICS_FAILED", "the shipped " + DIAGNOSTICS_PATH + " did not report a healthy payload");
}
const modulePath = diagnostics.module.modulePath;
if (!isNonEmptyString(modulePath)) {
  fail("DIAGNOSTICS_FAILED", "the shipped " + DIAGNOSTICS_PATH + " reported no generated module path");
}

// --- only now, on a payload its own runner accepted, is the module imported and used ---------
// MODULE_UNUSABLE is the one refusal that cannot be decided before the import: it occurs only
// once the import attempt below has begun. A throw here means the module may not have loaded;
// past that point the module loaded and the export validation that follows runs on it.
let mod = null;
try {
  mod = await import(pathToFileURL(path.resolve(payloadRoot, modulePath)).href);
} catch {
  fail("MODULE_UNUSABLE", "the generated module could not be imported: " + modulePath);
}

let sample = null;
try {
  const outcome = mod.OUTCOMES[0];
  const errorEnvelope = sampleFor(mod.ERROR_ENVELOPE_FIELDS);
  sample = {
    request: mod.buildActionSpec(sampleFor(mod.ACTION_FIELDS)),
    outcome,
    outcomeAccepted: mod.isOutcome(outcome),
    errorEnvelope,
    errorEnvelopeAccepted: mod.isErrorEnvelope(errorEnvelope),
  };
} catch {
  fail("MODULE_UNUSABLE", "the generated module does not expose its declared action surface");
}

// One report, derived only from the payload: no host path, no timestamp, no readiness claim.
const report = {
  schemaVersion: 1,
  status: "ok",
  coordinate: diagnostics.coordinate,
  distributionVersion: diagnostics.distributionVersion,
  action: { kind: mod.ACTION_KIND, name: mod.ACTION_NAME, version: mod.ACTION_VERSION },
  diagnostics,
  sample,
};
process.stdout.write(JSON.stringify(report) + "\n");
