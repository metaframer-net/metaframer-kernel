// P24CR — materialize a distribution payload onto disk. The one step the external consumer intake
// handover never carried: the handed-over generators return an in-memory file map, the reference
// consumer takes a directory, and nothing between them put bytes on disk. This CLI is that step and
// nothing more. It reads a contract JSON a team wrote by following the intake document, constructs
// the exact ActionContract instance the generator demands, renders the P24A consumer diagnostics
// distribution, and writes that file map — byte for byte, unmodified — into a directory the team
// already created and left empty.
//
// Contained by construction: it never creates the target it was handed, never writes over anything
// that is already there, and checks EVERY generated path before the first byte is written, so a
// payload declaring a path that climbs out of the target leaves the target exactly as it was found.
// It reads no ambient environment and consults no clock, network or random source, so the same
// three arguments produce the same bytes and the same report every time.
//
// Every refusal exits 1, prints nothing on stdout, and emits exactly one stable
// MATERIALIZE_ERROR:<CODE> line at the start of a stderr line. It writes bytes and starts nothing:
// no host, no container, no database, no release. Materializing a payload says nothing about
// whether anyone outside this repository has used it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderConsumerDiagnosticsDistribution } from "./generate-consumer-diagnostics-distribution.mjs";

const ERROR_PREFIX = "MATERIALIZE_ERROR";
const USAGE =
  "usage: node tools/materialize-distribution-payload.mjs <contract-json> <distribution-version> <existing-empty-target-directory>";

function fail(code, detail) {
  process.stderr.write(ERROR_PREFIX + ":" + code + " " + detail + "\n");
  process.exit(1);
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// --- arguments ---------------------------------------------------------------------------------
const contractPath = process.argv[2];
const distributionVersion = process.argv[3];
const targetPath = process.argv[4];
if (!isNonEmptyString(contractPath)) fail("MISSING_ARGUMENT", "no contract JSON was supplied. " + USAGE);
if (!isNonEmptyString(distributionVersion)) fail("MISSING_ARGUMENT", "no distribution version was supplied. " + USAGE);
if (!isNonEmptyString(targetPath)) fail("MISSING_ARGUMENT", "no target directory was supplied. " + USAGE);

// --- the contract the team wrote ----------------------------------------------------------------
let contractText = null;
try {
  contractText = readFileSync(contractPath, "utf8");
} catch {
  fail("CONTRACT_UNREADABLE", "the contract JSON could not be read at the path supplied");
}

let options = null;
try {
  options = JSON.parse(contractText);
} catch {
  fail("CONTRACT_UNREADABLE", "the contract file is not valid JSON");
}
if (!isOrdinaryObject(options)) fail("CONTRACT_UNREADABLE", "the contract JSON must decode to an ordinary object");

// The type decides, not this CLI: every rule the intake document teaches is enforced here by
// constructing the instance, so a refusal is the type's own refusal and never a second opinion.
let contract = null;
try {
  contract = new ActionContract(options);
} catch (error) {
  fail("CONTRACT_REFUSED", "the contract JSON is not an acceptable action contract: " + (error?.message ?? ""));
}

// --- the target the team prepared ----------------------------------------------------------------
// It must already exist and hold nothing. An absent target is refused rather than created: a team
// that mistyped a path gets a refusal, never a payload in a directory it did not mean to fill.
let existing = null;
try {
  existing = readdirSync(targetPath);
} catch {
  fail("TARGET_NOT_EMPTY", "the target must be a directory that already exists and holds nothing");
}
if (existing.length > 0) fail("TARGET_NOT_EMPTY", "the target directory already holds " + existing.length + " entry or more");

// --- the payload, planned in full before anything is written ---------------------------------------
const payload = renderConsumerDiagnosticsDistribution(contract, distributionVersion);
const targetRoot = path.resolve(targetPath);
const planned = [];
for (const relPath of Object.keys(payload.files).sort()) {
  const resolved = path.resolve(targetRoot, relPath);
  const inside = path.relative(targetRoot, resolved);
  if (!isNonEmptyString(relPath) || path.isAbsolute(relPath) || inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    fail("PATH_ESCAPE", "the generated payload declares a path that does not stay inside the target directory");
  }
  planned.push({ relPath, resolved });
}

for (const { relPath, resolved } of planned) {
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, payload.files[relPath], "utf8");
}

// One report, in payload-relative paths: a team can read what it now holds, and there is no host
// path in it to leak.
process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    status: "materialized",
    coordinate: payload.coordinate,
    distributionVersion: payload.distributionVersion,
    files: planned.map((entry) => entry.relPath),
  }) + "\n",
);
