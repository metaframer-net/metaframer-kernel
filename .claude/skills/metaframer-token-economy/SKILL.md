---
name: metaframer-token-economy
description: Remove token spend that buys nothing and route the rest to the cheapest model that can carry it safely. Use when planning a wave of work, packaging a task for a worker, deciding how many workers to open, choosing a model tier, reading a worker's result, or before any commit, push or main promotion in the MetaFramer kernel repositories.
---

# MetaFramer token economy

This file is a **projection** of `token-economy-policy.json`, which is the canonical owner of
every rule, threshold, model route and escalation gate below. If the two disagree, the policy
is right and this file has drifted.

`tools/check-token-economy.mjs` catches that drift for the model routing tiers, the escalation
gates, the per-wave rule and the governor tool allowlist. It does **not** compare the packaging,
evidence-reporting or parallelism sections below — see `checkerCoverage` in the policy. Those
are prose, and prose is caught by review or not at all.

The point is not to spend less. It is to stop paying for things that buy nothing, and to move the
rest to the cheapest tier that can carry it safely. Quality is not one of the levers.

## Never trade a guarantee for a saving

These are floors, not preferences. **Never skip** a security test, **never skip** a negative test,
and **never skip** an independent review to save tokens. Never lower the model tier for a security
decision. Never claim green without evidence. Never reuse a review across a changed snapshot.
Never run two writers on one change package.

If a saving requires removing one of those, the saving is not available.

## Start from repo reality, not from memory

1. Find the existing flow before proposing a new one.
2. Use `rg` and glob first; open files second.
3. Read narrow line ranges, not whole files, when the task is narrow.
4. Do not re-read a file whose hash has not changed — that read returns bytes already in context.
5. Read a large file in the sections the task needs, not end to end.

## Package a worker task, do not hand over a conversation

The largest avoidable spend is not the model tier. It is giving a worker a conversation it does
not need. A task package carries exactly:

- objective
- exact working directory
- immutable base commit or content hash
- the allowed file list
- forbidden areas
- acceptance criteria
- the test commands to run
- the rollback path
- the expected terminal marker

It does not carry the conversation history, corpus the task will not read, raw logs, or prior
worker narration.

## A worker returns evidence, not a story

Long output stays where it was produced. Never lift a full test or build log into the main
context.

- On green: the command, its **exit code**, total/passed/failed counts, and an evidence hash.
- On red: only the failing checks, only the relevant error lines, and a short conclusion.
- Never: full log bodies, unchanged-state reports, repeated plans.

## One writer at a time

A change package has exactly one active writer. Read-only work runs in parallel freely; writing
does not. Two writers on one file set lose work, and the loss is usually discovered late.

Run in parallel: read-only analysis of different modules, security and performance reviews,
independent reviews under **different lenses**, distinct test suites, evidence inventory.

Never in parallel: writers on the same file set, phases where one consumes another's output,
schema and consumer changes, migration and rollback changes, final manifest production, two
owners of one terminal marker.

Two reviewers under the *same* lens is the same answer paid for twice. Two reviewers under
different lenses is the point of independent review.

## Model routing

Escalation follows task risk and evidence need — never cost alone, and never automatically on
failure.

| Tier | Use for | Never for |
|---|---|---|
| **haiku** | inventory, narrow deterministic classification, format/parity checks, repeated mechanical read-only checks, short log summarisation | security decisions, architectural decisions, kernel invariant decisions, adversarial review, unknown-unknown analysis, final acceptance |
| **sonnet** | well-bounded routine implementation, test authoring, small fixes with an existing canonical pattern, documentation projection, targeted regression work | adversarial security review, kernel invariant design, final acceptance |
| **fable** | requirements analysis, product and architecture synthesis, phase and dependency design, scope and gap review, security + AI-first + human-input independent review | any run where the model identity has not been verified live |
| **opus** | security-critical design, kernel invariants, adversarial review, unknown-unknown investigation, architectural contradiction resolution, final independent acceptance, anything a lower tier has failed twice | mechanical inventory a cheaper tier resolves identically |

**fable** requires a verified identity. If it cannot be verified, do not imitate it and do not
invent the name: report that, then choose sonnet or opus by task risk.

## Let the free gate answer first

`tools/token-guard.mjs` decides nine things from facts at zero model cost: duplicate worker,
duplicate file read, writer ownership, dirty snapshot, branch/worktree collision, guardian
admission, stale review, the commit/push gate, and completed panel cleanup.

```bash
node tools/token-guard.mjs --request='{"action":"open-worker","taskSignature":"p00-r1"}'
```

Exit status: `0` proceed, `3` denied by a fact, `4` escalate to the governor. Only `4` is worth a
model call. Ask the `token-governor` agent only at the declared gates — parallel worker,
writer assignment, model escalation, snapshot change, commit/push, main promotion, policy anomaly
— and never wave by wave.

## Between waves, write a manifest instead of carrying context

Record path + hash + a short conclusion. Do not re-narrate what a later reader can hash. Do not
produce a long report for unchanged state. Status updates carry: what changed, the evidence, the
next gate — nothing else.

Never poll in a loop. Wait on an event or a checkpoint.
