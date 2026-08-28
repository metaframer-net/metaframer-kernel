# External consumer intake

This is the intake protocol for the one moment that has never happened yet: an outside team takes
the distribution payload this repository generates and runs it without us in the room. It is a rule
set written before the fact, so that whoever runs it later cannot quietly loosen it afterwards.

It is not a result. No team has been counted to date, the counted total is 0, and publishing a
protocol changes nothing about whether anyone outside can use the payload. This document moves no
flag and starts no host, container, database or release.

The single fenced block below is the protocol in machine-readable form. It is the authority on who
counts, what acceptance requires, what falsifies a run and how evidence is held; for those the prose
restates the block, in the same order, and adds nothing to it. It is not the whole document. The
block declares WHICH files a team is handed; what a team must know to USE them — the contract type
it constructs, that type's six rules, and how the materializer is run — is prose here and is
deliberately not a key in the block. Where the two could ever disagree about a participant, an
acceptance number, a falsification condition or evidence, the block wins.

```json
{
  "schemaVersion": 1,
  "id": "external-consumer-intake",
  "acceptedParticipant": "real-independent-team",
  "neverCounted": ["agent", "employee", "probe", "worker"],
  "requiredInputs": [
    { "id": "docs", "path": "docs/external-consumer-intake.md" },
    { "id": "sdk", "path": "tools/generate-versioned-action-sdk-distribution.mjs" },
    { "id": "example", "path": "examples/external-consumer/reference-consumer.mjs" },
    { "id": "diagnostics", "path": "tools/generate-consumer-diagnostics-distribution.mjs" },
    { "id": "contract", "path": "src/application/action-contract.mjs" },
    { "id": "renderer", "path": "tools/generate-action-sdk.mjs" },
    { "id": "materializer", "path": "tools/materialize-distribution-payload.mjs" }
  ],
  "acceptance": { "independentTeams": 3, "ownerHelpCount": 0, "helpEventsRequired": true },
  "helpEvents": {
    "recorded": "every",
    "fields": ["at", "channel", "question", "answer"],
    "omissionIsFalsification": true
  },
  "falsification": [
    { "id": "hidden-owner-help", "effect": "falsifies-the-run" },
    { "id": "non-team-participant", "effect": "falsifies-the-run" },
    { "id": "mutated-evidence", "effect": "falsifies-the-run" }
  ],
  "evidence": { "immutable": true, "digest": "sha256", "editableAfterAcceptance": false },
  "claims": { "externalUsabilityProven": false, "teamsCountedToDate": 0, "protocolAloneIsProof": false }
}
```

## Who counts

Exactly one kind of participant counts: a real, independent team. Independent means the team
decides on its own what to build, is not employed by or contracted to this project for this run,
and would still have taken the payload if nobody had asked them to.

Four kinds of participant are never counted, whatever they produce: an agent, an employee, a probe
and a worker. An automated run is a smoke test, not a team. A colleague walked through the payload
is a demo, not a team. Counting any of them is the single easiest way to fake this milestone, which
is why the exclusion is written down before the first run rather than argued about after it.

## Required inputs

A team is handed exactly seven inputs, in this order, and nothing else: this document, the versioned
SDK distribution generator, the reference consumer example, the consumer diagnostics generator, the
action contract type at `src/application/action-contract.mjs`, the SDK renderer at
`tools/generate-action-sdk.mjs` that demands that type, and the materializer CLI at
`tools/materialize-distribution-payload.mjs` that turns a rendered payload into files on disk. Each
names a file that exists in this repository today. Nothing verbal, nothing improvised in a call and
nothing pasted into a chat window is part of the handover. If a team needed something that is not
on this list, that is a finding about the payload, and it is recorded as one.

The last three entries were appended after the first four were measured and found not to be enough:
a tree holding only those four could not load the generator the protocol hands over, no handed-over
file named the type that generator demands, and no handed-over file ever put payload bytes on disk.
Appending them changes what a team is given. It changes no acceptance number, counts no team and
settles nothing about whether an outside team can actually use the payload.

The reference consumer is the runnable half of the handover. It is a single builtins-only file that
copies out of this repository unchanged, takes a materialized payload directory and the expected
distribution version, runs the payload's own `diagnose.mjs` as a separate process first, and only
then imports the generated module and prints one sample report. Every refusal exits 1, prints
nothing on stdout, and carries exactly one `EXTERNAL_CONSUMER_ERROR:<CODE>` line on stderr.

Two of its three refusals — a missing argument, and a payload the shipped runner rejects — are
decided before this consumer imports the generated module, so a payload that fails its own gates
is never imported or evaluated by THIS reference consumer. That property is scoped to this
consumer's own process and is not a claim that the module was never evaluated anywhere: the
shipped runner carries its own module evaluation gate and runs it inside its own process. The
third refusal, a module that will not import or does not expose its declared action surface, is by
definition decided at or after that import. It refuses in exactly the same shape, but it is not a
pre-import refusal and is not described here as one.

### The contract a team writes

Nothing in this section or the next is a key in the fenced block, and neither section changes what
the block says. The block names the files; these two sections are what a team reads to use them.

The handed-over generator does not take a plain object. It takes one instance of the
`ActionContract` type defined in `src/application/action-contract.mjs`, and the renderer inside
`tools/generate-action-sdk.mjs` refuses anything else with the message `renderActionSdk requires an
exact ActionContract instance`. A team writes its action as a small JSON file, and the materializer
below constructs the instance from that file, so the type itself decides what is acceptable.

That object carries exactly these six options and no other. An unknown option, a missing one, an
accessor, a symbol key or a non-enumerable member is refused rather than quietly ignored:

- `kind` — exactly one of two strings, `command` or `query`, and nothing else.
- `name` — a dotted lowercase name of at least two segments, such as `widget.create`, each segment
  starting with a letter, at most 128 characters long.
- `version` — a safe integer of at least 1; zero, a negative number, a fraction and a numeric string
  are all refused.
- `fields` — an ordered array of unique safe identifier strings, the fields the action carries. The
  order is the team's own declaration and is never sorted.
- `outcomes` — an ordered array of unique safe identifiers, at least one of them. The first is the
  outcome the reference consumer samples in its report.
- `errorEnvelopeFields` — an ordered array of unique safe identifier strings, the fields the
  action's error envelope carries.

A safe identifier matches `^[A-Za-z][A-Za-z0-9_]*$` and is 1 to 64 characters long. Three names are
refused by name even where the grammar would admit them, because each is a key a consumer's
prototype chain would honour: `constructor`, `prototype` and `__proto__`.

### Turning that contract into a payload

The generators return a payload in memory. The reference consumer takes a directory. One
handed-over file is the step between them, and this is how a team runs it:

`node tools/materialize-distribution-payload.mjs <contract-json> <distribution-version> <existing-empty-target-directory>`

The target must be a directory the team already made and left empty. What lands in it is the
generated payload byte for byte: `manifest.json`, describing the distribution; `diagnose.mjs`, the
runner the payload checks itself with; and the generated module at `actions/<name>/v<version>.mjs`.
The step then prints one JSON line naming those three payload-relative paths, and the reference
consumer is run against that same directory.

Every refusal exits 1, prints nothing on stdout and carries exactly one `MATERIALIZE_ERROR:<CODE>`
line on stderr. There are five codes: `MISSING_ARGUMENT`, when one of the three arguments is absent;
`CONTRACT_UNREADABLE`, when the contract file cannot be read or does not decode to a JSON object;
`CONTRACT_REFUSED`, when the contract breaks one of the six rules above; `TARGET_NOT_EMPTY`, when
the target does not exist or already holds something; and `PATH_ESCAPE`, when the rendered payload
declares a path that would leave the target. A refusal leaves the target exactly as it was found,
so a team is never left holding half a payload it might mistake for a whole one.

## Owner help

The acceptance bar is three independent teams at an ownerHelpCount of 0. Zero means zero: the owner
answers no question, unblocks no step and fixes nothing mid-run. A run where the owner helped is
not a failed run — it is a run that measured the payload plus a person, which is a different thing
and is recorded as such.

Every help event is recorded, with four fields: `at`, `channel`, `question`, `answer`. The rule is
"every", not "every significant one", because the judgement of what counts as significant is
exactly where a measurement like this rots. Omitting a help event from the helpEvents record
falsifies the run outright.

Where a run is written down, `planning/external-consumer-run-record.json` is the closed shape it is
written in, and `tools/check-external-consumer-run-record.mjs` is the file that reads it. A record
names the run it is (`runId`) and the team that ran it (`teamId`), and it declares one of three
outcomes. A run the team finished is `completed`; a run the team stopped is `abandoned`, kept with
its reason and labelled `not-accepted:abandoned`; a run one of the three falsification conditions
below destroyed is `void`, kept and labelled with the id it was falsified by. Only a `completed`
run can be `accepted`, and only when nobody helped it. A completed run whose help is fully written
down is well formed and is labelled `observed:owner-help` — kept as the different measurement it is,
never rounded down to zero. A help event missing one of its four fields, and a tally that disagrees
with the events beside it, are both `void:hidden-owner-help`, and each keeps its own distinct code
so the two are never collapsed into one; a run by a participant the protocol never counts is
`void:non-team-participant`, and evidence edited after its digest was taken is
`void:mutated-evidence`. A record declaring itself void must show that falsification in its own
fields: a void nobody can see is refused, not believed. Neither the schema nor the checker joins the
seven required inputs above: a record is what a run produces, not something a team is handed. The
checker says a record is well formed and derives a number from records; it accepts nothing, because
acceptance is not a program's decision.

## Falsification

Three conditions falsify a run, meaning the run is void and cannot be counted, repaired or
partially credited:

- hidden owner help — the owner helped and the event was not recorded;
- non-team participant — an agent, employee, probe or worker was counted as a team;
- mutated evidence — accepted evidence was edited after the fact.

A void run is kept and labelled void. It is not deleted, because the record of what was tried is
worth more than a tidy tally.

## Evidence

Evidence is immutable. Each accepted run's evidence is digested with sha256 at acceptance and is
not editable afterwards. A correction is a new record that references the old one; it never
overwrites it. If a digest no longer matches its evidence, that evidence is mutated evidence and
falls under falsification above.

What is hashed is exact, so two honest record stores cannot disagree about it. A run's evidence is
sha256 over the evidence file's own bytes, unmodified. A record's identity is sha256 over one
canonical serialization of the record — the schema's declared key order, a two-space indent, one
trailing newline, UTF-8 — so the same record with its keys shuffled is the same record, while one
changed value is a different one. That identity is the record's, never the team's. The bar this
protocol sets is three independent TEAMS, so the count is taken over distinct `teamId` values among
the accepted records handed to the checker: one team that runs twice is one team, and every run
that was helped, abandoned or voided counts zero. That derivation is over those records only. It is
never the project's total, which is still 0, and no program may raise it.

## What this is not

Writing this protocol down is not evidence that anyone outside can use the payload, and the
protocol alone is proof of nothing. Widening the handover from four inputs to seven is not evidence
either: it removes obstacles a measurement found, and an obstacle removed is not a team served. The
honest state today: zero teams counted, owner help never measured, external usability an open
question. No readiness flag moved when this document was added or amended, and none may move until
real independent teams have actually run the payload and their immutable evidence says what
happened.
