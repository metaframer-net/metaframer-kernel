# External consumer intake

This is the intake protocol for the one moment that has never happened yet: an outside team takes
the distribution payload this repository generates and runs it without us in the room. It is a rule
set written before the fact, so that whoever runs it later cannot quietly loosen it afterwards.

It is not a result. No team has been counted to date, the counted total is 0, and publishing a
protocol changes nothing about whether anyone outside can use the payload. This document moves no
flag and starts no host, container, database or release.

The single fenced block below is the protocol in machine-readable form. It is the authority; the
prose that follows restates the same rules, in the same order, and adds no rule the block omits.

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
    { "id": "diagnostics", "path": "tools/generate-consumer-diagnostics-distribution.mjs" }
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

A team is handed exactly four inputs, in this order, and nothing else: this document, the versioned
SDK distribution generator, the reference consumer example, and the consumer diagnostics generator.
Each names a file that exists in this repository today. Nothing verbal, nothing improvised in a
call and nothing pasted into a chat window is part of the handover. If a team needed something that
is not on this list, that is a finding about the payload, and it is recorded as one.

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

## Owner help

The acceptance bar is three independent teams at an ownerHelpCount of 0. Zero means zero: the owner
answers no question, unblocks no step and fixes nothing mid-run. A run where the owner helped is
not a failed run — it is a run that measured the payload plus a person, which is a different thing
and is recorded as such.

Every help event is recorded, with four fields: `at`, `channel`, `question`, `answer`. The rule is
"every", not "every significant one", because the judgement of what counts as significant is
exactly where a measurement like this rots. Omitting a help event from the helpEvents record
falsifies the run outright.

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

## What this is not

Writing this protocol down is not evidence that anyone outside can use the payload, and the
protocol alone is proof of nothing. The honest state today: zero teams counted, owner help never
measured, external usability an open question. No readiness flag moved when this document was
added, and none may move until real independent teams have actually run the payload and their
immutable evidence says what happened.
