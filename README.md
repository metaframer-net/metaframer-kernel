# MetaFramer Kernel

Under the decisions currently in force, `metaframer-net/metaframer-kernel` is the canonical
destination — the target repository — for the MetaFramer runtime kernel and its generated
SDK. That names where this work belongs, not a claim that it has arrived: no source has been
extracted from the `platform` monorepo, that extraction stays behind a human gate, and
kernel development proceeds here only through separately scoped change packages. Development
is open under the current effective authority: the substrate is implemented and activated, the
kernel primitives and ports stage is in progress through separately scoped packages, and every
stage after it is still closed.

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

## Implemented kernel primitives and ports

Seven separately scoped, test-first change packages have landed under `src/`, in the order
below. Each entry describes the implemented `src` surface and the contract tests that cover it
on this branch; it is not a full account of every file its package touched, and it is not a
readiness claim. A primitive here is a value type and a port is the shape a boundary must have;
a port is not a boundary, not an integration, and not proof that anything behind one has been
built. None of this moves any flag under **Current status**, and none of it closes an exit
criterion.

Every module is framework-free and depends inward or not at all: `src/domain` imports only
`node:crypto`, `src/application` imports the domain ring, its own ring, or nothing, and no
module imports outward. The root source tree holds exactly those two inner rings —
`src/adapters`, `src/delivery` and `src/sdk` are refused by name in
[`tools/check-repository-boundary.mjs`](tools/check-repository-boundary.mjs) — so no adapter,
delivery or SDK ring exists. `src/application` is the permitted Application ring of the onion,
not an end-user app and not a delivery surface.

**M1-01 — identity primitives.**
[`src/domain/identity-primitives.mjs`](src/domain/identity-primitives.mjs) ·
[`tests/kernel-identity-primitives.test.mjs`](tests/kernel-identity-primitives.test.mjs)

Exports `TenantId`, `CorrelationId`, `CausationId`, `ActorId`, `Principal` and
`IdempotencyKey`: frozen value types with exact-class equality and canonical rendering. The
UUID-form identities admit one canonical spelling and refuse the nil UUID rather than
normalising anything; `ActorId` is opaque, 1–128 visible ASCII, case preserved; `Principal`
composes a `TenantId` with an `ActorId` and requires the instances, not their strings;
`IdempotencyKey` keeps only a SHA-256 fingerprint of its raw input, and the raw input is never
retained, rendered or quoted in a refusal.

*Non-goals:* no authentication, authorization, role, permission, scope or policy behaviour, and
no persistence. A `Principal` says who is acting and on whose behalf, never what they may do.

**M1-02 — action primitives.**
[`src/application/action-primitives.mjs`](src/application/action-primitives.mjs) ·
[`tests/kernel-action-primitives.test.mjs`](tests/kernel-action-primitives.test.mjs)

Exports `Command`, `Query`, `KernelError` and `Result`. A `Command` is an act that changes
state and carries a required exact `IdempotencyKey`; a `Query` is a read and refuses one. Both
are identified by `name@version` and hold a payload canonicalised by one rule — sorted keys,
frozen, no accessor, hole, cycle, non-finite number or prototype-polluting key. A `KernelError`
is a failure as a value: a code, optional details and a bounded cause chain, with no message
and no stack, and it does not extend the native error type. A `Result` has two branches and is
minted only by `Result.ok` or `Result.failure`.

*Non-goals:* no handler, dispatcher, bus or router; no port, unit of work, clock, policy, audit
or outbox; no validation boundary and no composition root. `Result` has no combinators — no
map, unwrap or fold.

**M1-03 — the use-case contract.**
[`src/application/use-case.mjs`](src/application/use-case.mjs) ·
[`tests/kernel-use-case-contract.test.mjs`](tests/kernel-use-case-contract.test.mjs)

Exports `UseCase`. One declaration — `{kind, name, version, handler}` — binds one action
coordinate to one function, and `execute` holds the gate on both sides: only an exact `Command`
or `Query` of the declared kind at the declared `name@version` reaches the handler, and only a
brand-proven genuine `Result` comes back, by identity. It is always a promise, so a refusal
arrives as a rejection; whatever the handler throws propagates unchanged.

*Non-goals:* no lookup, routing or registry — choosing between use cases is a separate concern;
no failure vocabulary of its own; no equality or rendering. Saying what a use case must be is
not the same as having built one against a database.

**M1-04 — the unit-of-work port.**
[`src/application/unit-of-work.mjs`](src/application/unit-of-work.mjs) ·
[`tests/kernel-unit-of-work-port.test.mjs`](tests/kernel-unit-of-work-port.test.mjs)

Exports `UnitOfWork`. It takes exactly `{begin, commit, rollback}` and holds exactly one
ordering: begin, then the body, then commit — and rollback instead of commit when the body
fails. The scope `begin` produced is opaque and is carried through by identity, never read. A
second run on one instance while the first is in flight is refused rather than queued.

*Non-goals:* this is a port shape, not a boundary and not proof of database integration; no
database, connection, pool or query language; no isolation level, savepoint, retry, caching or
idempotency policy. One residual is recorded rather than hidden: when the body fails and
rollback fails too, the rollback's failure is suppressed so the body's failure survives.

**M1-05 — the clock port.**
[`src/application/clock.mjs`](src/application/clock.mjs) ·
[`tests/kernel-clock-port.test.mjs`](tests/kernel-clock-port.test.mjs)

Exports `Clock`. It takes exactly `{now}`, calls that collaborator once per reading with an
undefined receiver, and either hands the reading back exactly as it arrived or refuses it. A
reading must be a canonical UTC instant spelled `YYYY-MM-DDTHH:MM:SS.sssZ`, checked by
arithmetic written in the module rather than by a host parser, so an impossible day is refused
instead of rolled forward.

*Non-goals:* it promises neither true time nor monotonic time. Nothing is compared, ordered,
deduplicated or remembered between calls, so a conforming reading may be wrong and a later one
may name an earlier instant. It reaches no host clock and reads no ambient time.

**M1-06 — the identity port.**
[`src/application/identity.mjs`](src/application/identity.mjs) ·
[`tests/kernel-identity-port.test.mjs`](tests/kernel-identity-port.test.mjs)

Exports `Identity`. It takes exactly `{current}`, calls that collaborator once, and returns the
very `Principal` it produced or refuses. Genuineness is proven by both halves of the rule:
exact prototype identity plus the domain's private brand, so a prototype lookalike and a
subclass instance are both refused.

*Non-goals:* this is not authentication. The brand proves a `Principal` was constructed through
the domain constructor and its invariants were checked; it proves nothing about whether that
principal is currently, actually the caller. No session, token, directory, cache, role, scope
or permission, and no answer to "may they".

**M1-07 — the policy port.**
[`src/application/policy.mjs`](src/application/policy.mjs) ·
[`tests/kernel-policy-port.test.mjs`](tests/kernel-policy-port.test.mjs)

Exports `Policy`. It takes exactly `{consult}`, admits only a genuine `Command` or `Query`,
forwards that action whole and unopened to the collaborator, and requires a genuine `Result`
back, returned by identity. It never reads a coordinate off the action and never reads which
branch the answer carries.

*Non-goals:* it is not a policy decision point, not authorization, and not RBAC, ReBAC or ABAC.
It holds no rule, condition, combining algorithm or default; it does not evaluate, allow, deny,
permit or enforce; it authors no answer, wraps no value or error, and remembers nothing. There
is no request type and no decision type, because those two would be the halves of a decision
protocol this kernel has not committed to.

## Authorized order and what remains closed

The authorized order is: DB / RLS / transaction / outbox / audit (S1, implemented and
activated) → kernel primitives, typed action and PDP → generated SDK → one walking-skeleton
golden slice.

The second stage is under way and is not finished. The primitives, the typed action contracts
and the ports listed above are implemented; the policy decision point that same stage names is
not — `src/application/policy.mjs` forwards a question and decides nothing. The generated SDK
and the golden slice remain closed and unstarted, and nothing here may be read as opening them.

Each stage needs its own separately scoped, test-first, single-writer change package with its
own RED/GREEN, rollback and exit criteria; runtime code written outside such a package is
unauthorized. What has landed is implementation evidence on a branch: its tests verify these
contracts and nothing further; they close no gate and activate nothing beyond S1.

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
