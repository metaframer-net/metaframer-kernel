# MetaFramer Kernel

This private repository reserves the `metaframer-net/metaframer-kernel` identity for the
future MetaFramer runtime-kernel boundary.

## Current status

- Classification: `PLANNING_ONLY`
- Runtime: `VALID_BLOCKED`
- Release decision: `NO_GO`
- Runtime implementation: absent
- MVP / buildable application / production readiness: not claimed

The initial push contains governance and repository-boundary material only. It does not
copy or rename the unrelated `atonota/kernel` project, and it does not move the current
`platform` monorepo into this repository.

## Scope of the repository-creation override

An explicit Admin instruction on 2026-07-16 authorizes creating this repository and
pushing this planning-only bootstrap. That instruction overrides the prior prohibition on
the *existence* of a separate repository for this narrow purpose only.

It does not yet:

- select this repository as the canonical runtime source;
- authorize a code split or extraction from the `platform` monorepo;
- close the full kernel governance decision gate;
- authorize runtime, deployment, release, or production work; or
- make local, CI, runtime, or deployment evidence exist.

## Runtime entry gate

Runtime work remains blocked until all ten kernel governance decisions are closed in the
canonical decision registry and a human-approved topology/extraction decision names the
canonical source owner. Authorized implementation order after that gate is:

1. DB / RLS / transaction / outbox / audit
2. kernel primitives
3. SDK
4. walking skeleton

Production `GO` additionally requires real PR, CI, runtime, deployment, rollback, and
completion-gate evidence with exit code `0`.

## Canonical planning source

Kernel governance, decision records, WBS content, and completion-gate evidence remain in
the [Actionplan publication](https://karacaismail.github.io/actionplan/) until an explicit
human decision changes their ownership.

See [Repository Boundary](docs/repository-boundary.md) for the exact source and authority
limits of this bootstrap.

## Persistent planning control plane

The planning-only bootstrap keeps an auditable, resumable snapshot without copying runtime
source or changing Actionplan:

- [Control-plane status](docs/control-plane-bootstrap.md)
- [Consolidated human decision package](docs/human-decision-package.md)
- [Resume runbook](docs/resume-runbook.md)
- `planning/source-inventory.json` — exact hashes for 40 raw JSON snapshots and pinned
  Actionplan evidence
- `planning/traceability-matrix.json` — 40 files mapped to 39 WBS/requirements records and
  KGA-D01..D10
- `planning/governance-decisions.json` — closure proposals with risk, acceptance criteria
  and rollback
- `planning/bootstrap-state.json` — machine-readable current state, blockers, next action,
  authorization and test evidence

- `planning/human-decision-request.json` — the consolidated decision request and its
  recorded `response`, coding policy, remote audit and one-shot publish grant

The consolidated human response `T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A, A01-A` was
recorded on 2026-07-30 by `user-admin`. The local lifecycle state is therefore
`APPROVED_AWAITING_CANONICAL_WRITEBACK` and the next action is to obtain separate Actionplan
write-back authority. Topology is `APPROVED_CONDITIONAL` and history is
`CLEAN_START_WITH_PROVENANCE` with `sourceExtraction=false`.

These records are local planning projections. Every `KGA-D01`..`KGA-D10` `canonicalStatus`
remains `pending`. They do not close the canonical governance
registry and do not authorize Actionplan write-back, runtime source, merge, release or
deploy.

`A01-A` denies standing mutation authority, so no action is permitted by default. A later
exact user instruction grants one Codex-executed commit and one normal non-force push of
this exact planning package to `refs/heads/agent/kernel-control-plane-reconcile` from base
`90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`, recorded in
`planning/human-decision-request.json` under `response.oneShotGitAuthorization`. The grant
is spent on the first successful push and is not reusable; Claude may never consume it.
Pull-request creation (`pullRequest=false`), any push to `main`, tags, force pushes, merge,
release, deploy, Actionplan write-back and runtime implementation remain unauthorized.

Consumption is fenced by remote-ref state, not by the committed `consumptionStatus` field:
before the push, `git ls-remote --heads origin refs/heads/agent/kernel-control-plane-reconcile`
must return no matching ref and empty output. If that ref exists at any SHA the grant is
already spent and execution must stop. The static `unconsumed` value is snapshot evidence
only. No push has been performed by this planning package.

## Writer lock

Coding and implementation packages in this repository are written by Claude alone under the
immutable `CLAUDE_ONLY` lock in [`AGENTS.md`](AGENTS.md), mirrored as `codingPolicy` in
`planning/bootstrap-state.json`. Codex is MASTER and final reviewer and is not a fallback
writer.

## Local verification

```sh
npm test
npm run check
```

When the recorded read-only external sources are available, their exact snapshot can be
revalidated separately:

```sh
npm run check:sources
```
