# MetaFramer Kernel

Under the decisions currently in force, `metaframer-net/metaframer-kernel` is the canonical
destination — the target repository — for the MetaFramer runtime kernel and its generated
SDK. That names where this work belongs, not a claim that it has arrived: no source has been
extracted from the `platform` monorepo, that extraction stays behind a human gate, and
kernel development proceeds here only through separately scoped change packages. Development
is open under the current effective authority; every stage beyond the implemented substrate
is still closed.

## Current status

Current effective authority: `GO-KERNEL-DEVELOPMENT-ONLY`, chain head seq 4
(`AUTHORITY-SUPERSESSION-04`), read from `karacaismail/actionplan` at commit
`811505b0229705cf39edbf0d6b60248c46a72091`.

- `codeStartAllowed=true`
- `runtimeCodeAllowed=true`
- `runtimeImplementationStarted=true`
- `kernelReady=false`
- `sdkReady=false`
- `appBuildable=false`
- `releaseAllowed=false`
- `deployAllowed=false`
- `productionAllowed=false`
- `gapClosed=false`

The record of activation is external to this repository and is one published annotated Git
tag, never an in-repository status flip:

- tag `kernel-runtime-substrate-s1-activated`, tag object
  `c34fabc84aaeac80b61d27c777fcc6db0cc8f99b`, published on the canonical origin
- tag target: substrate commit `89528cd0b815711e49553682f457326e9b171b03`, merged into and
  reachable from canonical `main`

Both hashes are immutable objects. The commit `main` currently points at is deliberately not
pinned here: it moves whenever anything lands, so a SHA written into this file would be false
by the time it was read. Read it from the canonical origin instead.

`runtimeImplementationStarted=true` records that one authorized change package started
runtime work and was activated externally. It moves that one dimension and nothing else. It
is not a readiness claim: this repository is not runtime-ready, kernel-ready, SDK-ready, an
MVP, a buildable application, releasable, deployable, pilot-approved, or production-ready,
and nothing here may be read as such a claim.

The activation reader consults the published tag only from an exact `origin/main` checkout.
Run from a branch or worktree it short-circuits before any network call and reports
`activationRecord=absent`; that is a statement about the checkout in hand, not a denial of
the published tag.

## Implemented substrate (S1)

Stage S1 — the PostgreSQL substrate — is implemented in `db/metaframer_kernel_db` and
activated. Its contract is `db/kernel-runtime-substrate-s1.json`.

- one cohesive Alembic baseline at head revision `0001_runtime_substrate`, proven by a real
  upgrade → downgrade → re-upgrade round trip against PostgreSQL 16
- the runtime tables `transactional_outbox` and `audit_log` under `ENABLE` **and** `FORCE`
  row-level security
- a controlled transaction boundary whose tenant context is attested with a keyed
  HMAC-SHA256 signature, so the raw setting the runtime role can write is not sufficient for
  access and an untrusted context denies
- the transactional outbox claim taken with `FOR UPDATE SKIP LOCKED`
- an append-only audit invariant enforced by a statement-level trigger

Everything after S1 remains closed. The authorized order is: DB / RLS / transaction / outbox
/ audit (S1, implemented) → kernel primitives, typed action and PDP → generated SDK → one
walking-skeleton golden slice. Each stage needs its own separately scoped, test-first,
single-writer change package with its own RED/GREEN, rollback and exit criteria; runtime code
written outside such a package is unauthorized.

`GO-RUNTIME-PILOT` is a separate contract needing 10/10 GREEN gates, an independent verifier
and a human countersign — `GRP-01` is RED and is evaluated externally. Production is a
separate post-pilot stage and is not reachable from that contract.

## Current-authority consumer overlay

`planning/kernel-runtime-pilot-consumer-sync.json` is the additive overlay that binds this
repository to the current effective authority, verified by
`tools/check-kernel-runtime-pilot-consumer-sync.mjs` against the pinned Actionplan commit. It
binds the chain-head `GO-KERNEL-DEVELOPMENT-ONLY` verdict, rewrites no historical artifact,
and is not edited by this or any later package.

One field needs reading with care. The overlay's embedded `runtimeImplementationStarted=false`
is pre-activation package evidence — the state the substrate package started from, recorded
before it was activated — and not the current value. The published activation tag, not the
overlay, supplies the current `runtimeImplementationStarted=true`. `npm run check` shows the
distinction directly: the overlay's line is relabelled `ACTIVATION BASE`, and the composed
`CURRENT EFFECTIVE` line printed last is the authoritative one.

## Boundaries in force

- This repository does not copy or rename `atonota/kernel`; that is an unrelated Metawork
  CI/CD project.
- It does not copy, move, split, or extract the current `platform` monorepo.
  `sourceExtraction=false`, and topology or extraction changes stay human-gated.
- The [Actionplan publication](https://karacaismail.github.io/actionplan/) remains the
  canonical governance and decision owner — decision records, WBS content, and
  completion-gate evidence live there until an explicit human decision changes ownership.

## Versioning and changelog

The canonical owner of every version and versioning-policy value is
[`versioning-policy.json`](versioning-policy.json) at the repository root. `package.json`,
[`CHANGELOG.md`](CHANGELOG.md), this section and
[`docs/versioning-policy.md`](docs/versioning-policy.md) are projections of it; parity is
checked one way only, canonical to projection, and a drift finding always names the projection
that moved.

- Current version: `0.1.0-alpha.1`. It is a pre-release entry on the `0.1.0` train, not a
  release: nothing is published, tagged, or cut.
- Previous value: `0.0.0-planning`. That was a planning placeholder — syntactically a
  pre-release of a version that was never released — and it is preserved as history rather
  than erased.
- Ceiling: `0.1.0`, which is also the cap on anything an agent may recommend. `0.1.1`, `0.2.0`
  and `1.0.0` are all refused, and raising the ceiling takes a fresh explicit human decision
  recorded in the policy.
- The eventual Kernel-complete milestone maps to package version `0.1.0` and never to `1.0.0`:
  SemVer rule 5 makes `1.0.0` a definition of a public API, and no decision has authorized
  one. `0.1.0` is the terminus of the train, not a value anything may sit at today — reaching
  it is itself a human completion decision.
- No release exists. There is no released version, no release tag, no GitHub Release and no
  published package, and `private` stays `true`. The one tag in this repository,
  `kernel-runtime-substrate-s1-activated`, is an activation record and not a release tag.
- An agent may recommend the next value and may do nothing else. The permitted moves are the
  counter forward by one inside a stage, or the next adjacent stage with the counter reset;
  `npm version` and `npm publish` are forbidden.

The two specifications this follows are
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) and
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). `CHANGELOG.md` carries exactly
one `[Unreleased]` section and zero version sections, dates, release links or yank markers,
because every one of those is a claim that a release happened.

## Historical bootstrap record (2026-07-16 to 2026-07-30, historical and non-effective)

Everything in this section is a dated record of the authority in force during the
planning-only bootstrap, taken at `actionplan@7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d`. It
is preserved verbatim in `repository-status.json` and the `planning/` artifacts, which are
immutable and are never rewritten. It is **not** the current status; the current status is
the section above.

The bootstrap-era classification was:

- Classification: `PLANNING_ONLY`
- Runtime: `VALID_BLOCKED`
- Release decision: `NO_GO`
- Runtime implementation: absent
- MVP / buildable application / production readiness: not claimed

An explicit Admin instruction on 2026-07-16 authorized creating this repository and pushing
that bootstrap. As recorded then, it did not yet select this repository as the canonical
runtime source, authorize a code split or extraction, close the governance decision gate, or
authorize runtime, deployment, release or production work. The bootstrap-era entry gate held
runtime work until all ten kernel governance decisions were closed and a human-approved
topology decision named the canonical source owner.

The consolidated human response `T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A, A01-A` was
recorded on 2026-07-30 by `user-admin`; topology became `APPROVED_CONDITIONAL` and history
`CLEAN_START_WITH_PROVENANCE`.

[Repository Boundary](docs/repository-boundary.md) belongs to this record. It is preserved
unchanged and is dated, historical and non-effective: it states the source and authority
limits of the bootstrap, in the vocabulary of that period, and it is **not** the boundary in
force. For the current boundary read **Current status** and **Boundaries in force** above.

Later authority superseded the bootstrap verdict on the code-start dimension only. The
stronger flags listed under **Current status** remain false, and these historical tokens must
never be presented as the verdict in force — `tools/check-repository-boundary.mjs` asserts
that separation structurally.

## Planning control plane — historical bootstrap snapshot, non-effective

The planning control plane is the auditable, resumable snapshot taken during the bootstrap
period. It copied no runtime source and changed no Actionplan artifact. Everything in this
section is dated snapshot evidence recorded on or before 2026-07-30, not the state in force;
the state in force is under **Current status** above. The artifacts themselves are immutable
and are never rewritten:

- [Control-plane status](docs/control-plane-bootstrap.md)
- [Consolidated human decision package](docs/human-decision-package.md)
- [Resume runbook](docs/resume-runbook.md)
- `planning/source-inventory.json` — exact hashes for 40 raw JSON snapshots and pinned
  Actionplan evidence
- `planning/traceability-matrix.json` — 40 files mapped to 39 WBS/requirements records and
  KGA-D01..D10
- `planning/governance-decisions.json` — closure proposals with risk, acceptance criteria
  and rollback
- `planning/bootstrap-state.json` — machine-readable snapshot state, blockers, recorded next
  action, authorization and test evidence
- `planning/human-decision-request.json` — the consolidated decision request and its
  recorded `response`, coding policy, remote audit and one-shot publish grant

As recorded in that snapshot, every `KGA-D01`..`KGA-D10` `canonicalStatus` was `pending`, the
local lifecycle state was `APPROVED_AWAITING_CANONICAL_WRITEBACK`, and the recorded next
action was to obtain separate Actionplan write-back authority. Those values are the snapshot's
own projections as of 2026-07-30; they closed nothing in the canonical governance registry and
authorized no Actionplan write-back, merge, release or deploy. Read the canonical registry, not
this section, for what any `KGA` decision says today.

`A01-A` denied standing mutation authority, so no action was permitted by default. A later
exact user instruction granted one Codex-executed commit and one normal non-force push of that
planning package to `refs/heads/agent/kernel-control-plane-reconcile` from base
`90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`, recorded in
`planning/human-decision-request.json` under `response.oneShotGitAuthorization`. The grant was
single-use: spent on the first successful push, never reusable, and never consumable by Claude.

**That grant is now spent.** Consumption was always fenced by remote-ref state rather than by
the committed `consumptionStatus` field, and the fence now reads consumed: the canonical origin
publishes `refs/heads/agent/kernel-control-plane-reconcile` at
`2abf6c910fd11d53c4f28e23d64f7c9c9abb446b`, and that commit is an ancestor of `main`. The
committed `unconsumed` value and the snapshot's "no push has been performed" wording are
therefore pre-push evidence only, not current truth. The fence command stays the way to read
this, and it now returns a ref rather than empty output:

```sh
git ls-remote --heads origin refs/heads/agent/kernel-control-plane-reconcile
```

Nothing about that grant is revivable. Pull-request creation (`pullRequest=false`), any push to
`main`, tags, force pushes, merge, release, deploy and Actionplan write-back were never
authorized by it and remain unauthorized.

## Writer lock

Coding and implementation packages in this repository are written by Claude alone under the
immutable `CLAUDE_ONLY` lock in [`AGENTS.md`](AGENTS.md), mirrored as `codingPolicy` in
`planning/bootstrap-state.json`. Codex is MASTER and final reviewer and is not a fallback
writer.

## Local verification

Governance and boundary checks, required before accepting any change:

```sh
npm test
npm run check
```

`npm run check` prints the labelled historical snapshots first and exactly one authoritative
`CURRENT EFFECTIVE` line last.

The versioning and changelog policy has its own command, and also runs inside `npm run check`
immediately before the compositor:

```sh
npm run check:versioning
```

The S1 substrate has its own checks. The behavioural suite needs a Docker daemon and a real
PostgreSQL 16 container, so it stays out of `npm test`:

```sh
npm run check:substrate-s1          # the substrate contract and its declared surface
npm run check:substrate-s1:static   # pinned lock, ruff lint/format, bytecode compile
npm run test:substrate-s1           # behavioural suite against real PostgreSQL 16
```

When the recorded read-only external sources are available, their exact snapshot can be
revalidated separately:

```sh
npm run check:sources
```
