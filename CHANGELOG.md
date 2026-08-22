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
- The `CreateCustomer@1` Application pipeline in `src/application/create-customer-pipeline.mjs`:
  `CreateCustomerPipeline`, a deterministic, framework-free stage sequence from raw `ActionSpec`
  fields to one closed outcome — `ALLOW_COMMIT`, `DENY`, `INVALID` or `CROSS_TENANT_DENY` — built
  entirely from the existing `Identity`, `PolicyDecisionPoint`, `Command`, `PolicyRequest` and
  `KernelError` surfaces plus one injected pure `evaluateInvariants` collaborator.
  `ALLOW_COMMIT` means allowed-to-commit only: it returns a frozen `PreparedChangeSet` with
  `persistenceState: "pending"` and exactly four write intents, and mints no `CommitReceipt`.
- The generated-SDK protocol readiness contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`: a declarative pin of the
  `customer.create@1` typed-action fields, outcome enum and error-envelope shape, read off the
  already-closed `CreateCustomerPipeline` rather than invented. It narrows step 3
  (`generated-sdk`) of the pinned runtime-start sequence to a protocol contract only —
  `sdkReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`,
  `gapClosed` and `kernelReady` all stay `false`, `capabilityDelta` is `NONE` and
  `runnableProduct` is `false`. It introduces no `src/sdk`, no generator, no generated client and
  no ASGI/Uvicorn/Hypercorn/FastAPI delivery surface; V5 delivery stays blocked on both the
  generated-SDK step and the one-golden-slice step of that sequence closing GREEN.

### Changed
- The repository root source-topology fence was narrowed: a root `src` is permitted and may hold
  `src/domain` and `src/application` as its only first children, with `src/adapters`,
  `src/delivery` and `src/sdk` refused by name.
- Authority reporting now separates a checkout-local projection from project authority, so a
  feature checkout can no longer print a line that reads as the project's verdict.
- The package version moved from the planning placeholder 0.0.0-planning onto the prerelease train
  at 0.1.0-alpha.1. This is a train entry, not a release.
