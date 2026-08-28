// P24D — check external consumer run records. The executable half of the record layer: one
// builtins-only file a team copies out of this repository unchanged and runs on its own records,
// wherever it keeps them. It reads nothing but the record files it is handed and the evidence each
// one points at; it imports no repository module, reads no ambient environment, and consults no
// clock, network or random source, so the same records produce the same transcript every time.
//
// It validates and derives; it never accepts. Acceptance is not a program's decision. Three
// outcomes can be recorded and only `completed` can be accepted: `abandoned` and `void` are
// well-formed records of runs that happened, each carrying an explicit disposition for why it was
// not counted, and each counting zero. A void record names one of the protocol's own three
// falsification ids and its own fields must show that falsification, because a void nobody can see
// is a label rather than a falsified run. The count is taken over distinct accepted teamIds — the
// bar is three independent TEAMS, so one team's two runs are one team — and over the records
// supplied on the command line, never the project's total, which stays 0 and which none may raise.
//
// Every refusal exits 1, prints nothing on stdout and emits exactly one stable
// RUN_RECORD_ERROR:<CODE> line at the start of a stderr line. A run falsified while claiming it
// completed carries its void disposition there; a malformed file carries none, because it is not a
// record of a run.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ERROR_PREFIX = "RUN_RECORD_ERROR";
const USAGE = "usage: node tools/check-external-consumer-run-record.mjs <run-record.json> [<run-record.json> ...]";

const [COMPLETED, ABANDONED, VOIDED] = ["completed", "abandoned", "void"];
const [ACCEPTED, OBSERVED_HELP, NOT_ACCEPTED_ABANDONED] = ["accepted", "observed:owner-help", "not-accepted:abandoned"];
const [VOID_HELP, VOID_PARTICIPANT, VOID_EVIDENCE] = ["void:hidden-owner-help", "void:non-team-participant", "void:mutated-evidence"];

// The rules this checker judges by, carried here rather than read out of the repository, because a
// copied-away file has no repository to read. Every transcript echoes them, so drift shows up.
const RULES = {
  acceptedOutcome: COMPLETED,
  acceptedParticipant: "real-independent-team",
  digest: { algorithm: "sha256", encoding: "hex-lowercase", evidenceInput: "evidence-file-bytes-unmodified", recordInput: "canonical-json-utf8", canonicalJson: { keyOrder: "schema-declared", indent: 2, trailingNewline: true } },
  dispositionByOutcome: { [COMPLETED]: [ACCEPTED, OBSERVED_HELP], [ABANDONED]: [NOT_ACCEPTED_ABANDONED], [VOIDED]: [VOID_HELP, VOID_PARTICIPANT, VOID_EVIDENCE] },
  evidenceFields: ["path", "sha256"],
  helpEventFields: ["at", "channel", "question", "answer"],
  neverCounted: ["agent", "employee", "probe", "worker"],
  recordFields: ["schemaVersion", "runId", "teamId", "participantKind", "payloadVersion", "outcome", "outcomeReason", "ownerHelpCount", "helpEvents", "evidence"],
  voidReasons: ["hidden-owner-help", "non-team-participant", "mutated-evidence"],
};

// Carried verbatim in every transcript: a derivation over records handed to a program counts nobody
// and closes nothing.
const NOT_COUNTED = {
  isP24: false, validationIsAcceptance: false, countedTowardAcceptance: false, teamsCountedToDate: 0,
  externalUsabilityProven: false, p24Open: true,
  readinessFlags: { kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false },
};

function fail(code, disposition, detail) {
  process.stderr.write(ERROR_PREFIX + ":" + code + (disposition === null ? "" : " " + disposition) + " " + detail + "\n");
  process.exit(1);
}

const violation = (detail) => fail("RECORD_SCHEMA_VIOLATION", null, "a run record " + detail);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isOrdinaryObject = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const recordPaths = process.argv.slice(2).filter((value) => isNonEmptyString(value));
if (recordPaths.length === 0) fail("MISSING_ARGUMENT", null, "no run record was supplied. " + USAGE);

function readRecord(recordPath) {
  let text = null;
  try {
    text = readFileSync(recordPath, "utf8");
  } catch {
    fail("RECORD_UNREADABLE", null, "a run record could not be read at the path supplied");
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    fail("RECORD_UNREADABLE", null, "a run record file does not decode as JSON");
  }
  if (!isOrdinaryObject(value)) fail("RECORD_UNREADABLE", null, "a run record must decode to an ordinary object");
  return value;
}

// The closed shape. A key nobody checked is a fact nobody is checking, so an undeclared key is
// refused rather than ignored, and a declared field that is absent is refused rather than defaulted.
function validateShape(record) {
  for (const key of Object.keys(record)) if (!RULES.recordFields.includes(key)) violation("carries the undeclared key " + key);
  for (const field of RULES.recordFields) if (!has(record, field)) violation("omits the declared field " + field);
  if (record.schemaVersion !== 1) violation("declares a schemaVersion this checker does not know");
  if (!isNonEmptyString(record.runId)) violation("carries no usable runId");
  if (!isNonEmptyString(record.teamId)) violation("carries no usable teamId, the identity the count is taken over");
  if (!isNonEmptyString(record.payloadVersion)) violation("carries no usable payloadVersion");
  if (!isNonEmptyString(record.participantKind) || (record.participantKind !== RULES.acceptedParticipant && !RULES.neverCounted.includes(record.participantKind))) violation("declares a participantKind this protocol does not recognise");
  if (!Number.isSafeInteger(record.ownerHelpCount) || record.ownerHelpCount < 0) violation("carries an ownerHelpCount that is not a whole count of zero or more");
  if (!Array.isArray(record.helpEvents)) violation("carries a helpEvents that is not a list");
  for (const event of record.helpEvents) {
    if (!isOrdinaryObject(event)) violation("carries a help event that is not an ordinary object");
    for (const key of Object.keys(event)) if (!RULES.helpEventFields.includes(key)) violation("carries a help event with the undeclared key " + key);
  }
  if (!isOrdinaryObject(record.evidence)) violation("carries no evidence object");
  for (const key of Object.keys(record.evidence)) if (!RULES.evidenceFields.includes(key)) violation("carries evidence with the undeclared key " + key);
  if (!isNonEmptyString(record.evidence.path)) violation("carries evidence naming no file");
  if (!/^[0-9a-f]{64}$/.test(record.evidence.sha256)) violation("carries an evidence digest that is not a lower-case sha256");

  // Three outcomes, and each says something different about its reason: a completed run has none, a
  // run the team stopped says why in its own words, and a void run may only name one of the
  // protocol's own three falsification ids.
  if (!has(RULES.dispositionByOutcome, record.outcome)) violation("declares an outcome outside the closed vocabulary");
  if (record.outcome === COMPLETED && record.outcomeReason !== null) violation("carries an outcomeReason where its outcome allows none");
  if (record.outcome === ABANDONED && !isNonEmptyString(record.outcomeReason)) violation("was stopped by the team without saying why");
  if (record.outcome === VOIDED && !RULES.voidReasons.includes(record.outcomeReason)) violation("names a falsification this protocol never declared");
}

// The one serialization identity is computed over: schema-declared key order, two-space indent, one
// trailing newline, UTF-8. Two stores holding the same run must agree that it is one run. Identity
// is the record's and never the team's, because one team can record more than one run.
function canonicalRecordBytes(record) {
  const order = (value, fields) => {
    const ordered = {};
    for (const field of fields) if (has(value, field)) ordered[field] = value[field];
    return ordered;
  };
  const canonical = order(record, RULES.recordFields);
  canonical.helpEvents = record.helpEvents.map((event) => order(event, RULES.helpEventFields));
  canonical.evidence = order(record.evidence, RULES.evidenceFields);
  return Buffer.from(JSON.stringify(canonical, null, 2) + "\n", "utf8");
}

// Help hidden keeps two codes that must never collapse into one: an event missing a field, and a
// tally that disagrees with the events written beside it. Help written down in full is neither.
function hiddenHelp(record) {
  for (const event of record.helpEvents) {
    for (const field of RULES.helpEventFields) {
      if (!isNonEmptyString(event[field])) return { code: "HELP_EVENT_OMITTED", detail: "a help event omits the required field " + field };
    }
  }
  if (record.ownerHelpCount !== record.helpEvents.length) {
    return { code: "HELP_COUNT_CONTRADICTION", detail: "the ownerHelpCount does not agree with the " + record.helpEvents.length + " help event(s) recorded beside it" };
  }
  return null;
}

// Evidence is resolved against the record's own directory, never the working directory, so one
// record decides the same way whatever the checker was launched from. Evidence that cannot be read
// is not a falsified run, it is a record nothing can be checked against; edited bytes are.
function evidenceMatches(recordPath, record) {
  try {
    return sha256(readFileSync(path.resolve(path.dirname(path.resolve(recordPath)), record.evidence.path))) === record.evidence.sha256;
  } catch {
    return fail("EVIDENCE_UNREADABLE", null, "the evidence file a record points at could not be read");
  }
}

function decide(recordPath) {
  const record = readRecord(recordPath);
  validateShape(record);
  const evidenceDigestVerified = evidenceMatches(recordPath, record);
  const help = hiddenHelp(record);
  const nonTeam = RULES.neverCounted.includes(record.participantKind);

  let disposition = null;
  if (record.outcome === VOIDED) {
    // The record says it was falsified; the checker looks rather than taking its word for it.
    const shown = { "hidden-owner-help": help !== null, "non-team-participant": nonTeam, "mutated-evidence": !evidenceDigestVerified };
    if (!shown[record.outcomeReason]) fail("OUTCOME_REASON_INCOHERENT", null, "a run record declares itself falsified by " + record.outcomeReason + ", which its own fields do not show");
    disposition = "void:" + record.outcomeReason;
  } else {
    // A run still claiming it happened as recorded: each falsification refuses, keeping its own code.
    if (nonTeam) fail("PARTICIPANT_NEVER_COUNTED", VOID_PARTICIPANT, 'the record declares participantKind "' + record.participantKind + '", which is never counted');
    if (help !== null) fail(help.code, VOID_HELP, help.detail);
    if (!evidenceDigestVerified) fail("EVIDENCE_DIGEST_MISMATCH", VOID_EVIDENCE, "the evidence bytes do not hash to the digest the record declares");
    disposition = record.outcome === ABANDONED ? NOT_ACCEPTED_ABANDONED : record.ownerHelpCount === 0 ? ACCEPTED : OBSERVED_HELP;
  }

  return {
    runId: record.runId, teamId: record.teamId, outcome: record.outcome, disposition,
    ownerHelpCount: record.ownerHelpCount, helpEventCount: record.helpEvents.length,
    evidenceDigestVerified, recordDigest: sha256(canonicalRecordBytes(record)),
  };
}

// Distinct accepted teamIds, one team counted once however many runs it recorded. A count nobody
// can recompute from the records is a claim, not evidence.
const records = recordPaths.map((recordPath) => decide(recordPath));
const accepted = records.filter((entry) => entry.disposition === ACCEPTED);
const distinctTeams = new Set(accepted.map((entry) => entry.teamId));
const derivation = { recordsSupplied: recordPaths.length, acceptedRecords: accepted.length, distinctAcceptedTeamIds: distinctTeams.size, teamsCountedInSuppliedRecords: distinctTeams.size };

process.stdout.write(
  JSON.stringify({ schemaVersion: 1, tool: "external-consumer-run-record-checker", verdict: "WELL_FORMED", rules: RULES, records, derivation, notCounted: NOT_COUNTED }) + "\n",
);
