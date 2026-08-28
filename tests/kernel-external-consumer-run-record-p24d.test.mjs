import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P24D V4 — the run record, corrected. P24B froze the intake protocol, P24CR repaired the handover and P24C's
// probes measured it SUFFICIENT. This layer is what a run is written down IN, and the arithmetic that turns
// records into the one number the acceptance bar is stated in.
//
// V3 counted distinct RECORD digests, which is the wrong arithmetic for the bar the protocol sets: that bar is
// three independent TEAMS, and a team that takes the payload twice is one team, not two. So a record carries a
// stable `teamId`, the count is taken over distinct accepted teamIds, and a record's digest goes back to being
// the identity of the record, never of the team. V3 also had a vocabulary hole — three declared outcomes and
// dispositions for one of them — so a record declaring `abandoned` or `void` was read as though it completed.
// Here only `completed` can be accepted; `abandoned` and `void` are well-formed records, each carrying an
// explicit disposition for why it was not counted, and each counting zero. A void record names one of the
// protocol's own three falsification ids and its own fields must show that falsification: a void nobody can
// see is refused, and a record claiming `completed` while those same fields falsify it is refused as before.
//
// Unchanged from V3 and re-checked here: evidence is sha256 over the file's bytes unmodified, identity is
// sha256 over one canonical serialization, help written down in full is observed and never laundered to zero,
// the four never-counted kinds are never counted, and every readiness flag stays false. Every record below is
// a fixture written seconds earlier into a temp directory: NOT P24, no external, independent or counted team
// consumed anything, the project total stays 0, owner help stays UNMEASURED rather than zero, P24 stays open,
// and no host, container, database or release is started.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTAKE_DOC = "docs/external-consumer-intake.md";
const SCHEMA_PATH = "planning/external-consumer-run-record.json";
const CHECKER = "tools/check-external-consumer-run-record.mjs";
const ERROR_PREFIX = "RUN_RECORD_ERROR";
const VERDICT = "WELL_FORMED";
const EVIDENCE_FILE = "evidence.json";
const EVIDENCE_TEXT = '{"transcript":"the team took the payload and ran it","steps":["materialize","diagnose","import"]}\n';
const HELP_EVENT = Object.freeze({ at: "2026-01-01T00:00:00Z", channel: "email", question: "which directory does the materializer want?", answer: "an existing empty one" });

// The protocol block as P24CR left it, pinned to its bytes: the prose may be extended to describe the record
// layer, the machine-readable block may not move.
const INTAKE_BLOCK_DIGEST = "cc90f1376fde4f525520ac7b22ce541569f6f45b9fecff7732c28ffa5fd7edd8";
const EXPECTED_INTAKE = Object.freeze({
  schemaVersion: 1, id: "external-consumer-intake", acceptedParticipant: "real-independent-team", neverCounted: ["agent", "employee", "probe", "worker"],
  requiredInputs: [
    { id: "docs", path: INTAKE_DOC }, { id: "sdk", path: "tools/generate-versioned-action-sdk-distribution.mjs" }, { id: "example", path: "examples/external-consumer/reference-consumer.mjs" },
    { id: "diagnostics", path: "tools/generate-consumer-diagnostics-distribution.mjs" }, { id: "contract", path: "src/application/action-contract.mjs" },
    { id: "renderer", path: "tools/generate-action-sdk.mjs" }, { id: "materializer", path: "tools/materialize-distribution-payload.mjs" },
  ],
  acceptance: { independentTeams: 3, ownerHelpCount: 0, helpEventsRequired: true },
  helpEvents: { recorded: "every", fields: ["at", "channel", "question", "answer"], omissionIsFalsification: true },
  falsification: [{ id: "hidden-owner-help", effect: "falsifies-the-run" }, { id: "non-team-participant", effect: "falsifies-the-run" }, { id: "mutated-evidence", effect: "falsifies-the-run" }],
  evidence: { immutable: true, digest: "sha256", editableAfterAcceptance: false },
  claims: { externalUsabilityProven: false, teamsCountedToDate: 0, protocolAloneIsProof: false },
});

const [COMPLETED, ABANDONED, VOIDED] = ["completed", "abandoned", "void"];
const [ACCEPTED, OBSERVED_HELP, NOT_ACCEPTED_ABANDONED] = ["accepted", "observed:owner-help", "not-accepted:abandoned"];
const [VOID_HELP, VOID_PARTICIPANT, VOID_EVIDENCE] = ["void:hidden-owner-help", "void:non-team-participant", "void:mutated-evidence"];
// Every outcome carries its own dispositions and exactly one may carry `accepted`: an outcome the vocabulary
// cannot disposition is one the count silently treats as something it is not.
const DISPOSITION_BY_OUTCOME = Object.freeze({ [COMPLETED]: [ACCEPTED, OBSERVED_HELP], [ABANDONED]: [NOT_ACCEPTED_ABANDONED], [VOIDED]: [VOID_HELP, VOID_PARTICIPANT, VOID_EVIDENCE] });
const DISPOSITIONS = Object.freeze(Object.values(DISPOSITION_BY_OUTCOME).flat());

// The run-record schema, closed and owned by one deepEqual. Protocol values are restated here so the portable
// checker needs no document; test 2 checks every restatement against the protocol itself.
const EXPECTED_SCHEMA = Object.freeze({
  schemaVersion: 1, id: "external-consumer-run-record", governedBy: "external-consumer-intake", recordClosed: true,
  recordFields: ["schemaVersion", "runId", "teamId", "participantKind", "payloadVersion", "outcome", "outcomeReason", "ownerHelpCount", "helpEvents", "evidence"],
  helpEventFields: ["at", "channel", "question", "answer"], evidenceFields: ["path", "sha256"],
  acceptedOutcome: COMPLETED, acceptedParticipant: "real-independent-team", neverCounted: ["agent", "employee", "probe", "worker"],
  // Exactly what is hashed, and in what shape: two honest implementations disagreeing about the byte input
  // would make every digest in the record store useless.
  digest: { algorithm: "sha256", encoding: "hex-lowercase", evidenceInput: "evidence-file-bytes-unmodified", recordInput: "canonical-json-utf8", canonicalJson: { keyOrder: "schema-declared", indent: 2, trailingNewline: true } },
  dispositionByOutcome: DISPOSITION_BY_OUTCOME,
  voidReasons: ["hidden-owner-help", "non-team-participant", "mutated-evidence"],
  // The derivation, exactly. A count nobody can recompute from the records is not evidence, it is a claim.
  teamsCountedToDate: { requires: ["outcome:completed", "disposition:accepted", "participantKind:real-independent-team", "ownerHelpCount:0", "evidenceDigestVerified"], distinctBy: "teamId", duplicatesCountOnce: true, derivedFromSuppliedRecordsOnly: true, projectTotal: 0 },
  failCodes: ["MISSING_ARGUMENT", "RECORD_UNREADABLE", "RECORD_SCHEMA_VIOLATION", "OUTCOME_REASON_INCOHERENT", "PARTICIPANT_NEVER_COUNTED", "HELP_EVENT_OMITTED", "HELP_COUNT_CONTRADICTION", "EVIDENCE_UNREADABLE", "EVIDENCE_DIGEST_MISMATCH"],
  checker: CHECKER,
  verdict: VERDICT,
  claims: { validationIsAcceptance: false, teamsCountedToDate: 0, recordAloneIsProof: false },
});

// What the checker carries in its own bytes and echoes in every transcript, so drift from the schema shows up.
const EXPECTED_RULES = Object.freeze(Object.fromEntries(["acceptedOutcome", "acceptedParticipant", "digest", "dispositionByOutcome", "evidenceFields", "helpEventFields", "neverCounted", "recordFields", "voidReasons"].map((key) => [key, EXPECTED_SCHEMA[key]])));
const READINESS_FLAGS = Object.freeze({ kernelReady: false, sdkReady: false, appBuildable: false, releaseAllowed: false, deployAllowed: false, productionAllowed: false, gapClosed: false, oneGoldenSliceReady: false, runnableProduct: false });
// The honesty block every transcript carries verbatim: a derivation over fixtures counts nobody and closes nothing.
const NOT_COUNTED = Object.freeze({ isP24: false, validationIsAcceptance: false, countedTowardAcceptance: false, teamsCountedToDate: 0, externalUsabilityProven: false, p24Open: true, readinessFlags: READINESS_FLAGS });
const TRANSCRIPT_KEYS = Object.freeze(["derivation", "notCounted", "records", "rules", "schemaVersion", "tool", "verdict"]);
const RECORD_KEYS = Object.freeze(["disposition", "evidenceDigestVerified", "helpEventCount", "outcome", "ownerHelpCount", "recordDigest", "runId", "teamId"]);
const DERIVATION_KEYS = Object.freeze(["acceptedRecords", "distinctAcceptedTeamIds", "recordsSupplied", "teamsCountedInSuppliedRecords"]);
// Portable means no repository import; deciding a record needs no spawn, no network, no loader escape hatch.
const FORBIDDEN_BUILTINS = Object.freeze(["node:child_process", "node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:worker_threads", "node:vm", "node:module", "node:repl"]);
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"'\n]+)["']/g;
const readRepoFile = async (relPath) => readFile(path.join(root, relPath), "utf8").catch((cause) => assert.fail(`${relPath} is absent or unreadable: ${cause?.message ?? cause}`));
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const runChecker = (args, { cwd = root, env = {}, checker = path.join(root, CHECKER) } = {}) => spawnSync(process.execPath, [checker, ...args], { cwd, env, encoding: "utf8" });

const parseJson = (text, where) => { try { return JSON.parse(text); } catch (cause) { return assert.fail(`${where} is not valid JSON: ${cause?.message ?? cause}`); } };

// The one fenced json block the protocol document carries. Several candidates, or none, is itself the failure.
async function intakeBlock() {
  const blocks = [...(await readRepoFile(INTAKE_DOC)).matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.equal(blocks.length, 1, `${INTAKE_DOC} must carry exactly one fenced json block, saw ${blocks.length}`);
  return { text: blocks[0], value: parseJson(blocks[0], `the ${INTAKE_DOC} protocol block`) };
}

// The canonicalization the schema declares, written out independently of the checker: the byte input hashed.
function canonicalRecordBytes(record) {
  const order = (value, fields) => Object.fromEntries(fields.filter((field) => field in value).map((field) => [field, value[field]]));
  const canonical = order(record, EXPECTED_SCHEMA.recordFields);
  canonical.helpEvents = record.helpEvents.map((event) => order(event, EXPECTED_SCHEMA.helpEventFields));
  canonical.evidence = order(record.evidence, EXPECTED_SCHEMA.evidenceFields);
  return Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`, "utf8");
}

// The same record as a store keeping its keys in another order would write it, nested objects included.
const reverseKeys = (value) => (Array.isArray(value) ? value.map(reverseKeys) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)])) : value);

// A fixture run record with its evidence file and the digest it declares. Nothing built here is a run.
const recordOf = ({ evidenceText = EVIDENCE_TEXT, ...overrides } = {}) => ({
  schemaVersion: 1, runId: "p24d-fixture-run", teamId: "team-alpha", participantKind: EXPECTED_SCHEMA.acceptedParticipant, payloadVersion: "1.0.0",
  outcome: COMPLETED, outcomeReason: null, ownerHelpCount: 0, helpEvents: [], evidence: { path: EVIDENCE_FILE, sha256: sha256(Buffer.from(evidenceText, "utf8")) }, ...overrides,
});

async function fixture(t, { record = {}, evidenceText = EVIDENCE_TEXT, writeEvidence = true, serialize = null } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p24d-record-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (writeEvidence) await writeFile(path.join(dir, EVIDENCE_FILE), evidenceText, "utf8");
  const value = recordOf({ evidenceText, ...record });
  const recordPath = path.join(dir, "run-record.json");
  await writeFile(recordPath, serialize ? serialize(value) : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { dir, recordPath, value };
}

// Evidence edited after its digest was taken: one byte appended, the record itself untouched.
const editEvidence = (built) => writeFile(path.join(built.dir, EVIDENCE_FILE), `${EVIDENCE_TEXT} `, "utf8");

// One transcript line, exit 0, nothing on stderr, closed key sets, rules echoed, honesty block verbatim.
function acceptOf(result, where) {
  assert.equal(result.status, 0, `${where} must be read and exit 0 (stderr: ${result.stderr})`);
  assert.equal(result.stderr, "", `${where} must print nothing on stderr when it is read`);
  assert.equal(result.stdout.split("\n").filter((line) => line.trim().length > 0).length, 1, `${where} must produce exactly one transcript line`);
  assert.ok(result.stdout.endsWith("\n"), `${where} must produce a terminated transcript line`);
  const transcript = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(transcript).sort(), [...TRANSCRIPT_KEYS], `${where} must produce the closed transcript key set`);
  assert.deepEqual(Object.keys(transcript.derivation).sort(), [...DERIVATION_KEYS]);
  assert.deepEqual([transcript.schemaVersion, transcript.tool, transcript.verdict], [1, "external-consumer-run-record-checker", VERDICT]);
  assert.deepEqual(transcript.rules, EXPECTED_RULES, `${where} must echo the rules it was judged against`);
  assert.deepEqual(transcript.notCounted, NOT_COUNTED, `${where} must carry the notCounted block verbatim: a derivation counts nobody`);
  for (const entry of transcript.records) {
    assert.deepEqual(Object.keys(entry).sort(), [...RECORD_KEYS]);
    assert.ok(DISPOSITION_BY_OUTCOME[entry.outcome]?.includes(entry.disposition), `${where}: ${entry.disposition} is not a disposition a ${entry.outcome} run may carry`);
  }
  return transcript;
}

// A refusal: exit 1, empty stdout, one anchored line, one stable code, no verdict. A record falsified while
// claiming it completed carries its void disposition there; a malformed file carries none.
function refusalOf(result, code, where, disposition = null) {
  assert.equal(result.status, 1, `${where} must be refused with exit 1 (stdout: ${result.stdout}, stderr: ${result.stderr})`);
  assert.equal(result.stdout, "", `${where} must produce nothing on stdout when it is refused`);
  const lines = result.stderr.split("\n").filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 1, `${where} must be refused with exactly one line, got ${lines.length}: ${result.stderr}`);
  const anchor = disposition ? `^${ERROR_PREFIX}:${code} ${disposition}(?:\\s|$)` : `^${ERROR_PREFIX}:${code}(?:\\s|$)`;
  assert.match(lines[0], new RegExp(anchor), `${where} must anchor one ${ERROR_PREFIX}:${code}${disposition ? ` ${disposition}` : ""} line`);
  assert.deepEqual([...result.stderr.matchAll(new RegExp(`${ERROR_PREFIX}:([A-Z_]+)`, "g"))].map((match) => match[1]), [code], `${where} must emit exactly one stable code`);
  assert.ok(!result.stderr.includes(VERDICT), `${where} must yield no verdict once refused`);
  if (!disposition) assert.ok(!/\b(?:void:|accepted|observed:|not-accepted:)/.test(result.stderr), `${where} is malformed, not a run that was falsified, and must carry no disposition`);
  return code;
}

test("the record layer is additive: the intake protocol block is unmoved to the byte, its handover is still the same seven files, and the prose beside it states the record layer's own vocabulary", async () => {
  const { text, value } = await intakeBlock();
  assert.equal(sha256(Buffer.from(text, "utf8")), INTAKE_BLOCK_DIGEST, "the fenced protocol block changed: P24D writes a record layer beside the protocol, never inside it");
  assert.deepEqual(value, EXPECTED_INTAKE, "the intake protocol block must be exactly what P24CR left");
  assert.equal(value.requiredInputs.length, 7);
  for (const input of value.requiredInputs) await access(path.join(root, input.path)).catch(() => assert.fail(`the handover declares ${input.path}, which is absent`));
  // A record is what a run produces, not an input a team is handed.
  const declared = value.requiredInputs.map((input) => input.path);
  for (const added of [SCHEMA_PATH, CHECKER]) assert.ok(!declared.includes(added), `${added} must not be appended to the handover`);

  // A disposition the document never states is vocabulary only the checker knows, and the key the count is
  // taken by is the whole arithmetic. Both belong in the prose a team actually reads.
  const prose = (await readRepoFile(INTAKE_DOC)).replace(/```json\n[\s\S]*?```/g, "");
  for (const disposition of DISPOSITIONS) assert.ok(prose.includes(disposition), `${INTAKE_DOC} must state the disposition ${disposition} a record can carry`);
  assert.ok(prose.includes("teamId"), `${INTAKE_DOC} must state teamId, the key the count is taken by`);
});

test("the schema is one closed artifact: a single deepEqual owns it, only a completed run can be accepted, every outcome carries its own dispositions, and the count is derived by teamId at the protocol's bar", async () => {
  const text = await readRepoFile(SCHEMA_PATH);
  const schema = parseJson(text, SCHEMA_PATH);
  assert.deepEqual(schema, EXPECTED_SCHEMA, `${SCHEMA_PATH} must carry exactly the closed run-record schema`);
  assert.equal(text, `${JSON.stringify(schema, null, 2)}\n`, `${SCHEMA_PATH} must be canonically formatted, two spaces and one trailing newline`);

  // Restating protocol values is safe only while the restatement is checked against the protocol itself.
  const { value: intake } = await intakeBlock();
  assert.equal(schema.governedBy, intake.id);
  assert.equal(schema.acceptedParticipant, intake.acceptedParticipant, "both must name the same one kind that counts");
  assert.deepEqual(schema.neverCounted, intake.neverCounted, "both must name the same kinds that are never counted");
  assert.deepEqual(schema.helpEventFields, intake.helpEvents.fields);
  assert.deepEqual(schema.voidReasons, intake.falsification.map((entry) => entry.id), "a record may declare itself void only for one of the protocol's own three falsification conditions");
  assert.deepEqual(schema.dispositionByOutcome[VOIDED].map((entry) => entry.slice(5)), schema.voidReasons, "each void disposition names the falsification id it was voided by");

  assert.ok(Object.hasOwn(schema.dispositionByOutcome, schema.acceptedOutcome), "the accepted outcome must be one a record may declare");
  assert.deepEqual(Object.entries(schema.dispositionByOutcome).filter(([, list]) => list.includes(ACCEPTED)).map(([outcome]) => outcome), [schema.acceptedOutcome], "only a completed run can be accepted; an abandoned or void run is recorded and counted toward nothing");
  assert.ok(schema.recordFields.includes("teamId"), "a record must carry the stable team identity the count is taken over");
  assert.deepEqual(schema.teamsCountedToDate.requires, [`outcome:${schema.acceptedOutcome}`, `disposition:${ACCEPTED}`, `participantKind:${intake.acceptedParticipant}`, `ownerHelpCount:${intake.acceptance.ownerHelpCount}`, "evidenceDigestVerified"], "the count is derived at the bar the protocol set, not at a looser one");
  assert.equal(schema.teamsCountedToDate.distinctBy, "teamId", "the bar is three independent TEAMS: one team's two runs are one team, not two");

  const checkerSource = await readRepoFile(CHECKER);
  for (const code of schema.failCodes) assert.ok(checkerSource.includes(`"${code}"`), `${CHECKER} must be able to emit the declared code ${code}`);
  for (const disposition of DISPOSITIONS) assert.ok(checkerSource.includes(`"${disposition}"`), `${CHECKER} must be able to emit the disposition ${disposition}`);
  assert.deepEqual([schema.claims.teamsCountedToDate, schema.claims.validationIsAcceptance], [0, false], "a checker never accepts a run; it says a record is well formed and derives a number from records");
});

test("digests are exact and identify the record, not the team: evidence is hashed as the file's own bytes, identity is one canonical serialization, shuffled keys are the same record and a changed value is not", async (t) => {
  const canonical = await fixture(t);
  const transcript = acceptOf(runChecker([canonical.recordPath]), "a record whose evidence matches its declared digest");
  assert.deepEqual([transcript.records[0].disposition, transcript.records[0].evidenceDigestVerified], [ACCEPTED, true], "an accepted record must have had its evidence digest actually recomputed");
  assert.equal(transcript.records[0].teamId, canonical.value.teamId, "the transcript reports the team a record belongs to, because that is what the count is taken over");
  assert.equal(canonical.value.evidence.sha256, sha256(Buffer.from(EVIDENCE_TEXT, "utf8")), "the evidence digest is sha256 over the evidence file's bytes, unmodified");
  const expectedDigest = sha256(canonicalRecordBytes(canonical.value));
  assert.equal(transcript.records[0].recordDigest, expectedDigest, "the record digest is sha256 over the canonical serialization the schema declares");
  assert.match(expectedDigest, /^[0-9a-f]{64}$/, "hex, lower case");

  // Keys in another order and different whitespace: one identity, because canonicalization is what is hashed.
  const shuffled = await fixture(t, { serialize: (value) => `${JSON.stringify(reverseKeys(value))}\n` });
  assert.equal(acceptOf(runChecker([shuffled.recordPath]), "the same record with its keys reversed").records[0].recordDigest, expectedDigest, "key order is not identity: the canonical form is");

  // One value changed is a different record — even when it is the same team running a second time.
  const second = await fixture(t, { record: { runId: "p24d-fixture-run-2" } });
  assert.notEqual(acceptOf(runChecker([second.recordPath]), "a second run by the same team").records[0].recordDigest, expectedDigest, "a changed value must change the record's identity");
  assert.equal(second.value.teamId, canonical.value.teamId, "two different records can still be one team, which is exactly why identity and counting are not the same key");
});

test("every well-formed record carries one disposition: help written down is observed, an abandoned run is recorded as not accepted, a void run names the falsification its own fields show, and a run claiming it completed while those fields falsify it is refused", async (t) => {
  // Help fully written down is a different measurement, not a malformed record, and is never laundered to zero.
  const helped = await fixture(t, { record: { ownerHelpCount: 1, helpEvents: [{ ...HELP_EVENT }] } });
  const observed = acceptOf(runChecker([helped.recordPath]), "a record whose help is fully written down").records[0];
  assert.deepEqual([observed.disposition, observed.ownerHelpCount, observed.helpEventCount], [OBSERVED_HELP, 1, 1]);

  // A team that stopped is a run that happened: kept, labelled with why, and counted toward nothing.
  const abandoned = await fixture(t, { record: { outcome: ABANDONED, outcomeReason: "the team stopped at the materializer step" } });
  const stopped = acceptOf(runChecker([abandoned.recordPath]), "a record of a run the team abandoned").records[0];
  assert.deepEqual([stopped.outcome, stopped.disposition], [ABANDONED, NOT_ACCEPTED_ABANDONED]);

  // A void run is kept and labelled void, and the label must be the falsification the record's own fields show.
  for (const [reason, disposition, overrides] of [["hidden-owner-help", VOID_HELP, { ownerHelpCount: 2, helpEvents: [{ ...HELP_EVENT }] }], ["non-team-participant", VOID_PARTICIPANT, { participantKind: "worker" }]]) {
    const declared = await fixture(t, { record: { outcome: VOIDED, outcomeReason: reason, ...overrides } });
    const entry = acceptOf(runChecker([declared.recordPath]), `a record declaring itself void for ${reason}`).records[0];
    assert.deepEqual([entry.outcome, entry.disposition], [VOIDED, disposition]);
  }
  const voided = await fixture(t, { record: { outcome: VOIDED, outcomeReason: "mutated-evidence" } });
  await editEvidence(voided);
  const mutated = acceptOf(runChecker([voided.recordPath]), "a record declaring itself void for mutated evidence").records[0];
  assert.deepEqual([mutated.disposition, mutated.evidenceDigestVerified], [VOID_EVIDENCE, false], "the record says the bytes were edited, and the checker must have looked rather than taken its word");

  // A void nothing in the record shows is a label, not a falsified run.
  const unsupported = await fixture(t, { record: { outcome: VOIDED, outcomeReason: "mutated-evidence" } });
  refusalOf(runChecker([unsupported.recordPath]), "OUTCOME_REASON_INCOHERENT", "a record declaring itself void for a falsification its own fields do not show");

  // The same three conditions under a record that claims it completed: refused, each keeping its own code.
  const { at, channel, question } = HELP_EVENT;
  const omitted = await fixture(t, { record: { ownerHelpCount: 1, helpEvents: [{ at, channel, question }] } });
  const omittedCode = refusalOf(runChecker([omitted.recordPath]), "HELP_EVENT_OMITTED", "a completed run whose help event is missing one of the four fields", VOID_HELP);
  const contradicted = await fixture(t, { record: { ownerHelpCount: 2, helpEvents: [{ ...HELP_EVENT }] } });
  assert.notEqual(omittedCode, refusalOf(runChecker([contradicted.recordPath]), "HELP_COUNT_CONTRADICTION", "a completed run whose help count disagrees with the events beside it", VOID_HELP), "an unrecorded help event and a contradicted tally must never collapse into one code");
  for (const kind of (await intakeBlock()).value.neverCounted) {
    const nonTeam = await fixture(t, { record: { participantKind: kind } });
    const result = runChecker([nonTeam.recordPath]);
    refusalOf(result, "PARTICIPANT_NEVER_COUNTED", `a completed run whose participant is "${kind}"`, VOID_PARTICIPANT);
    assert.ok(result.stderr.includes(kind), `the refusal must name the kind it refused: "${kind}"`);
  }
  const edited = await fixture(t);
  await editEvidence(edited);
  const editedCode = refusalOf(runChecker([edited.recordPath]), "EVIDENCE_DIGEST_MISMATCH", "a completed run whose evidence was edited after the digest was taken", VOID_EVIDENCE);
  const absent = await fixture(t, { writeEvidence: false });
  assert.notEqual(editedCode, refusalOf(runChecker([absent.recordPath]), "EVIDENCE_UNREADABLE", "a record pointing at evidence that does not exist"), "mutated evidence and unread evidence must not share a code");
});

test("the count is taken by team, not by record: one team's two completed runs count once, distinct teams count separately, every non-accepted disposition counts zero, and the project total stays zero", async (t) => {
  const first = await fixture(t);
  const again = await fixture(t, { record: { runId: "p24d-fixture-run-2" } });
  const duplicate = await fixture(t);
  const other = await fixture(t, { record: { teamId: "team-beta", runId: "p24d-fixture-run-3" } });
  const helped = await fixture(t, { record: { teamId: "team-gamma", ownerHelpCount: 1, helpEvents: [{ ...HELP_EVENT }] } });
  const abandoned = await fixture(t, { record: { teamId: "team-delta", outcome: ABANDONED, outcomeReason: "the team stopped before the payload was imported" } });
  const voided = await fixture(t, { record: { teamId: "team-epsilon", outcome: VOIDED, outcomeReason: "non-team-participant", participantKind: "employee" } });

  // Four accepted records from two teams — one ran twice, one of those supplied twice — plus one run measured
  // with a person in the room, one the team stopped and one voided by its own participant.
  const supplied = [first, again, duplicate, other, helped, abandoned, voided];
  const transcript = acceptOf(runChecker(supplied.map((entry) => entry.recordPath)), "seven records supplied together");
  assert.deepEqual(transcript.records.map((entry) => entry.disposition), [ACCEPTED, ACCEPTED, ACCEPTED, ACCEPTED, OBSERVED_HELP, NOT_ACCEPTED_ABANDONED, VOID_PARTICIPANT], "dispositions are reported per record, in the order supplied");
  assert.notEqual(transcript.records[0].recordDigest, transcript.records[1].recordDigest, "one team's two runs are two records, and the count must not be taken over that");
  assert.deepEqual(transcript.derivation, { recordsSupplied: 7, acceptedRecords: 4, distinctAcceptedTeamIds: 2, teamsCountedInSuppliedRecords: 2 }, "four accepted records, two teams: a team is counted once however many runs it recorded");

  // A single accepted record derives one; nothing that is not accepted derives anything at all.
  assert.equal(acceptOf(runChecker([first.recordPath]), "one accepted record").derivation.teamsCountedInSuppliedRecords, 1);
  for (const [what, record] of [["measured with owner help", helped], ["the team abandoned", abandoned], ["voided as a non-team participant", voided]]) {
    assert.equal(acceptOf(runChecker([record.recordPath]), `one record ${what}`).derivation.teamsCountedInSuppliedRecords, 0, `a run ${what} counts toward nothing`);
  }

  // None of it moves the project's total: the number of real teams that have taken this payload is still
  // zero, and no program may raise it.
  for (const records of [[first.recordPath], [first.recordPath, other.recordPath]]) {
    const derived = acceptOf(runChecker(records), "records supplied to the checker");
    assert.equal(derived.notCounted.teamsCountedToDate, 0, "fixtures count nobody: the project total is unmoved by any derivation");
    assert.equal(derived.notCounted.countedTowardAcceptance, false);
    assert.equal(derived.notCounted.isP24, false, "checking records this test wrote is not P24");
  }
});

test("the checker is portable and deterministic: builtins only, no ambient environment, byte-identical output from a copy run outside this repository, and a closed record refused where it is malformed", async (t) => {
  const source = await readRepoFile(CHECKER);
  const specifiers = [...source.matchAll(SPECIFIER)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, `${CHECKER} must declare the builtins it uses`);
  for (const specifier of specifiers) assert.ok(specifier.startsWith("node:"), `${CHECKER} imports ${specifier}: it must copy out of this repository unchanged`);
  for (const forbidden of FORBIDDEN_BUILTINS) assert.ok(!specifiers.includes(forbidden), `${CHECKER} must not import ${forbidden}`);
  assert.ok(!/process\.env\s*[.[]/.test(source), `${CHECKER} must not read the ambient environment`);
  assert.ok(!/Date\.now|new Date|Math\.random/.test(source), `${CHECKER} must consult no clock and no random source`);
  assert.ok(!/\bexternalUsabilityProven\s*:\s*true|\bproduction[- ]?ready\b/i.test(source), `${CHECKER} must claim no external usability`);

  // A team has this one file and its own records: copied away, repository out of sight, empty environment.
  const away = await mkdtemp(path.join(os.tmpdir(), "p24d-portable-"));
  t.after(() => rm(away, { recursive: true, force: true }));
  const copied = path.join(away, path.basename(CHECKER));
  await copyFile(path.join(root, CHECKER), copied);
  const record = await fixture(t);
  const portable = { cwd: away, env: {}, checker: copied };
  const firstRun = runChecker([record.recordPath], portable);
  acceptOf(firstRun, "a record checked by the copied file with an empty environment");
  assert.equal(runChecker([record.recordPath], portable).stdout, firstRun.stdout, `${CHECKER} must produce a byte-identical transcript on a second run`);
  assert.equal(runChecker([record.recordPath], { ...portable, cwd: record.dir }).stdout, firstRun.stdout, `${CHECKER} must not vary with the directory it is run from`);
  for (const hostPath of [root, away, record.dir, os.tmpdir(), await realpath(os.tmpdir())]) assert.ok(!firstRun.stdout.includes(hostPath), `${CHECKER} leaked the host path ${hostPath}`);

  // Malformed input is refused before any disposition exists; a key the checker ignored is a fact nobody checks.
  refusalOf(runChecker([], portable), "MISSING_ARGUMENT", "the checker run with no record");
  const notJson = path.join(away, "not-a-record.json");
  await writeFile(notJson, "this is not JSON\n", "utf8");
  refusalOf(runChecker([notJson], portable), "RECORD_UNREADABLE", "a file that does not decode to a run record");
  refusalOf(runChecker([path.join(away, "absent.json")], portable), "RECORD_UNREADABLE", "a record path that does not exist");
  const malformed = [
    ["an undeclared key", { teamName: "an outside team" }], ["no usable teamId", { teamId: "" }], ["an unrecognised participant kind", { participantKind: "consultant" }],
    ["an outcome outside the vocabulary", { outcome: "finished" }], ["a digest that is not a sha256", { evidence: { path: EVIDENCE_FILE, sha256: "not-a-digest" } }],
    ["a completed run carrying an outcomeReason", { outcomeReason: "it went well" }], ["an abandoned run carrying no reason", { outcome: ABANDONED, outcomeReason: null }],
    ["a void run naming a falsification the protocol never declared", { outcome: VOIDED, outcomeReason: "ran-out-of-time" }],
  ];
  for (const [what, overrides] of malformed) {
    const broken = await fixture(t, { record: overrides });
    refusalOf(runChecker([broken.recordPath], portable), "RECORD_SCHEMA_VIOLATION", `a record carrying ${what}`);
  }
});
