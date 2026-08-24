---
name: ultra-fast-development
description: Run a small, bounded MetaFramer kernel change package at pilot speed — separate test writer, implementation writer and read-only reviewer, one Pane, one correction wave, a timed pilot checkpoint. Use when packaging a bounded fast-turnaround change under the ultra-fast-v1 guardrails.
---

# Ultra-fast development (v1 pilot)

This skill is a **projection**. `planning/ultra-fast-v1-policy.json` is the sole canonical owner
of every speed number and semantic value it governs — scenario band, test-file ceiling,
checkpoint timing, terminal checkpoint outcomes, concurrency bound, and the full-QA budget. If
this file and the policy disagree, the policy is right and this file has drifted;
`tools/check-ultra-fast-v1-policy.mjs` catches that drift, run via `npm run check`
(`tools/check-repository-boundary.mjs`) or directly with `node tools/check-ultra-fast-v1-policy.mjs`.

This overlay is **additive**: it never replaces the external Actionplan change-package budget at
`EXTERNAL_BUDGET_REFERENCE` (see the policy file). Do not copy that budget's package-size numbers
here or into the policy.

## Roles

Three separate agents, never one doing two roles: `.claude/agents/ultra-fast-test-writer.md`
writes the frozen test file first; `.claude/agents/ultra-fast-implementation-writer.md` makes it
green without editing it; `.claude/agents/ultra-fast-reviewer.md` reviews read-only and did not
write the package. See those files for role detail.

## Package shape

A normal (`L1`) package's scenario count and test-file count stay inside the canonical band
recorded in the policy. A package outside that band needs an explicit named-risk exception with a
non-empty reason and its own ceiling, recorded in the handoff — never a silent widening of the
default band.

## Pane and concurrency

Every Pane is just-in-time and pinned to the exact target worktree; no speculative Pane creation.
Concurrency is the dynamic minimum of the Guardian's recommendation, the DAG-ready count, shared
lock capacity, and the policy's static ceiling — never a fixed number chosen ahead of that
minimum.

## Checkpoint

The pilot checkpoint fires once, at the minute recorded in the policy, and is pilot-scoped only —
it never asserts release, runtime, or production readiness. It resolves to exactly one of the
terminal outcomes the policy names. A second correction wave requires an explicit split-or-replan
marker; without one, stop at the first wave.

## Full QA budget

The managed full-QA budget (`RULES.md`, the global managed directives) stays exactly two runs per
change package: one writer-local run before CI, one CI run. Never rerun a full QA on an unchanged
snapshot, and never let this overlay drift that number — it is read from the same policy file.

## GC-02

Pane panel cleanup stays event-driven, never a timer, cron, daemon, hook, or background loop — see
the existing global Pane-garbage-collector lifecycle directive and its matching
`pane-garbage-collector` skill/agent; this overlay does not duplicate that contract.

## Browser verification

Only run browser-driven tests when a visible UI journey actually changed.
