# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
The canonical source for every value below is `versioning-policy.json`; this document is a
projection of it and is never read back as a source.

This project is in initial development (SemVer 0.y.z). No release exists: there is no released
version, no release tag, no GitHub Release and no published package, and the package is private.
The single [Unreleased] section below describes implemented repository state, not a release. The
package version is 0.1.0-alpha.1, an entry on the prerelease train whose terminus is 0.1.0; the
planning placeholder it replaced, 0.0.0-planning, was never released either.

## [Unreleased]

### Added
- The P01-W1 architecture decision candidate: `planning/p01-architecture-decision-candidate.json`
  as the canonical candidate, `planning/p01-architecture-decision.schema.json` as its closed
  schema, `planning/p01-ring-ownership-candidate.json` as the separate ring and bounded-context
  register candidate, `docs/p01-architecture-decision-candidate.md` as the plain-Turkish human
  decision packet, and `tools/check-p01-architecture-candidate.mjs` as the fail-closed verifier
  bound into `npm run check`. Three routes are recorded on the same dimensions with rejection
  reasons and conditions: Node canonical is conditional, Python canonical with FastAPI confined to
  Delivery and Node frozen as a conformance reference is conditional and recommended, and a
  permanent dual runtime is rejected and unreachable as a recommendation at the schema level. It
  is a candidate and not a decision: `decisionState` is `HUMAN_DECISION_REQUIRED`, `effective` is
  false, `selectedOption` and the signature, signer and date fields are null, and each is pinned
  by `const` in the schema as well as checked. Four authority sources and six independent
  read-only analyses are pinned by path, byte count and SHA-256; the six P01 gaps in their
  accepted order and the five P01 closure edges are re-derived from the pinned overlays; the seven
  `src` modules are hash-pinned and compared against the tree. The data rollback drill is
  unexercised and recorded pending, and the P01 exit build-budget baseline is recorded pending
  rather than invented. No `RCPT-01`, no signature, no closed gap, no `sourceExtraction` change,
  no readiness flag movement, and EXIT-01 stays unsatisfied. Capability delta: none.
- The P01 closure-semantics package: `planning/p01-closure-semantics-addendum.json` as the
  additive forward-only successor contract, `planning/p01-closure-discharge.schema.json` as the
  append-only discharge receipt schema, `docs/p01-closure-semantics.md` as the human projection,
  and `tools/check-p01-closure-semantics.mjs` as the fail-closed verifier bound into
  `npm run check`. All 53 accepted CLOSURE edges are classified exactly once — 23 `INTRA_ATOMIC`,
  30 `FORWARD_DEFERRED`, 0 backward — with every destination graph-checked against the ownership
  overlay, which the counting check it replaces never did. The correction is forward-only: it
  separates the phase receipt from the gap's final closure so a phase receipt no longer waits on
  receipts that can only exist after it, supersedes no P00 historical artifact, preserves the
  historical exit-blocking sentence verbatim, produces no receipt, signature or closed gap, and
  moves no readiness flag. Capability delta: none.
- The token economy governance package. `token-economy-policy.json` is the canonical owner of
  every token-economy rule, threshold, model route and escalation gate; the skill at
  `.claude/skills/metaframer-token-economy/SKILL.md`, the agent at
  `.claude/agents/token-governor.md` and the README token-economy section are its projections,
  and `tools/check-token-economy.mjs` asserts parity in one direction only. What that checker
  does not compare is recorded in the policy under `checkerCoverage` rather than left implied.
  `token-economy-ledger.json` is operational state and deliberately not a projection, since the
  economics command reads it back as a source.
- `tools/token-guard.mjs`, a deterministic gate that decides nine process invariants from facts
  at zero model cost and reports PASS, DENY or ESCALATE. A bare run observes git and the
  guardian admission decision and settles four of the nine; the five orchestration-layer
  registries are reported as unobserved and escalate rather than passing, because an
  unobservable registry is not an empty one. `node tools/token-guard.mjs economics
  --ledger=<path>` computes the governor net contribution from thresholds read out of the
  canonical policy rather than from its caller.
- The `token-governor` agent is event-driven rather than per-wave, holds a read-only tool
  allowlist the checker enforces against a single canonical spelling, and receives the gate
  verdict rather than running it. A net-negative ledger produces exit 5; acting on that verdict
  belongs to an orchestration layer that is not implemented here.
- The PostgreSQL runtime substrate (stage S1) under `db/metaframer_kernel_db`, with its declared
  contract in `db/kernel-runtime-substrate-s1.json`: a single Alembic baseline, the
  `transactional_outbox` and `audit_log` tables under both ENABLE and FORCE row-level security, a
  controlled transaction boundary whose tenant context is attested with a keyed HMAC signature,
  outbox claim taken with `FOR UPDATE SKIP LOCKED`, and an append-only audit invariant enforced by
  a statement-level trigger.
- Domain identity primitives in `src/domain/identity-primitives.mjs`: `TenantId`, `CorrelationId`,
  `CausationId`, `ActorId`, `Principal` and `IdempotencyKey` — closed, frozen, framework-free value
  types with exact-class equality and canonical serialisation.
- Application action primitives in `src/application/action-primitives.mjs`: `Command`, `Query`,
  `KernelError` and `Result`.
- The use-case contract in `src/application/use-case.mjs`: `UseCase`.
- The unit-of-work port in `src/application/unit-of-work.mjs`: `UnitOfWork`, specifying only the
  begin / body / commit order and rollback on failure.
- A fail-closed governance and boundary verification surface under `tools`, run by `npm test` and
  `npm run check`: the repository boundary, the control-plane bootstrap, AI development readiness,
  the runtime substrate, the current-authority consumer-sync overlay, and the composed
  checkout-local projection.
- This versioning and changelog governance: the canonical `versioning-policy.json`, its verifier
  `tools/check-versioning-changelog.mjs`, the human projection in `docs/versioning-policy.md`, and
  this document.

### Changed
- The repository root source-topology fence was narrowed: a root `src` is permitted and may hold
  `src/domain` and `src/application` as its only first children, with `src/adapters`,
  `src/delivery` and `src/sdk` refused by name.
- Authority reporting now separates a checkout-local projection from project authority, so a
  feature checkout can no longer print a line that reads as the project's verdict.
- The package version moved from the planning placeholder 0.0.0-planning onto the prerelease train
  at 0.1.0-alpha.1. This is a train entry, not a release.
