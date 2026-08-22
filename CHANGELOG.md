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
- `src/delivery/create-customer-http-message-adapter.mjs`, `CreateCustomerHttpMessageAdapter`,
  the smallest framework-neutral HTTP message adapter for GJ-01 Create Customer. Constructor
  accepts exactly `{ handler }`, requires an exact `CreateCustomerRequestHandler` instance by
  prototype identity, and freezes instance/class/prototype. `handle(message)` accepts an
  ordinary `{ method, path, headers, body }`; a malformed shape, non-`POST` method or path
  other than `/customers` returns a frozen generic 400/405/404 without ever calling the
  handler. A valid `POST /customers` message extracts `requestId`/`actorId`/`tenantId`/
  `idempotencyKey` from the `x-request-id`/`x-actor-id`/`x-tenant-id`/`idempotency-key`
  headers (case-insensitive), sets `payload` to `body`, calls the handler exactly once, and
  maps its response to a frozen `{ status, headers, body }` carrying `content-type` and
  `x-request-id`. No Node `http`/`net`/`fs`/`fetch`, no ASGI/FastAPI/Django/Uvicorn/Hypercorn
  dependency, no clock/random/env access — proves the boundary a future host could call
  without selecting one. `tests/kernel-create-customer-http-message-adapter.test.mjs` proves
  option exactness, frozen response shapes, case-insensitive headers, the 400/404/405
  short-circuits and forbidden-import checks. `tests/repository-boundary.test.mjs` now admits
  `src/delivery` holding the new module alongside the composition root and request handler.
  `planning/gj01-v14a-framework-neutral-http-message.json` records scope and evidence.
  `flags.runnableProduct` stays `false`.
- `src/delivery/create-customer-composition.mjs`, `createCustomerComposition(options)`, the
  smallest framework-neutral composition root wiring the existing
  `CreateCustomerRequestHandler` to a real `CreateCustomerCommitService` and the existing
  `PostgresCommitAdapter`. Accepts exactly
  `{ connectionString, current, candidatesFor, evaluateInvariants }`; constructs
  `Identity({ current })`, `PolicyDecisionPoint({ candidatesFor })`,
  `CreateCustomerPipeline({ identity, policyDecisionPoint, evaluateInvariants })`,
  `PostgresCommitAdapter({ connectionString })` and
  `CreateCustomerCommitService({ pipeline, commit: adapter.commit.bind(adapter) })`, then
  `CreateCustomerRequestHandler({ service })`, and returns exactly one frozen
  `{ handler, close }` object — never the adapter, service, pipeline, identity or policy
  decision point. `close()` closes the composed `PostgresCommitAdapter`. No HTTP server, no
  ASGI runtime — FastAPI, Django, Uvicorn and Hypercorn are named only as non-goals — no
  clock/random/env/fs/net access; a composition root, not a server.
  `tests/kernel-create-customer-composition.test.mjs` proves option exactness, the frozen
  `{ handler, close }` shape, a DENY outcome mapping to 403 without ever touching the
  database, and that the module imports no forbidden capability or framework/runtime
  dependency. `tests/repository-boundary.test.mjs` now admits `src/delivery` holding exactly
  `create-customer-composition.mjs` and `create-customer-request-handler.mjs`.
  `planning/gj01-v13c-framework-neutral-composition.json` records scope, RED/GREEN evidence
  and rollback. `flags.runnableProduct` stays `false` — no HTTP server or ASGI runtime wires
  this composition to anything yet.
- `src/delivery/create-customer-request-handler.mjs`, `CreateCustomerRequestHandler`, a
  framework-neutral Delivery-ring handler materializing the `src/delivery` boundary opened by
  `planning/gj01-v12-src-adapters-delivery-boundary-authority.json`. The constructor accepts
  exactly `{ service }`, requires an exact `CreateCustomerCommitService` instance by prototype
  identity (not `instanceof`), and freezes the instance; the class and its prototype are frozen
  too. `handle(request)` accepts an ordinary object carrying exactly `requestId`, `actorId`,
  `tenantId`, `payload`, `idempotencyKey`, builds the ActionSpec via
  `buildCreateCustomerActionSpec` from `src/sdk/create-customer.mjs`, and calls
  `service.handle(actionSpec)` exactly once. `COMMITTED` maps to a frozen
  `{ status: 201, requestId, outcome: "COMMITTED", body: { commitReceipt } }`; `INVALID` maps to
  `status: 400`; `DENY` and `CROSS_TENANT_DENY` map to `status: 403`, both with
  `body: { error }`; an unknown service outcome throws `TypeError`. If
  `buildCreateCustomerActionSpec` throws, `handle` returns a frozen `400`
  `{ outcome: "INVALID", body: { error: { code: "ACTION_SPEC_INVALID", ... } } }` response without
  ever calling the service, using the raw string `requestId` (or `""`) from the malformed
  request. No HTTP/ASGI import, dependency or runtime coupling — FastAPI, Django, Uvicorn and
  Hypercorn are named only as non-goals, never imported, depended on or coupled to a runtime
  handle — no Postgres import, no clock/random/env/socket/file access — a delivery-shaped
  adapter, not a server.
  `tests/kernel-create-customer-request-handler.test.mjs` proves constructor exactness, service
  prototype-identity exactness, an invalid request maps to 400 without calling the service,
  `COMMITTED` maps to 201 and calls the service exactly once with a frozen ActionSpec,
  `DENY`/`CROSS_TENANT_DENY` map to 403, an unknown outcome throws, and the module imports no
  forbidden capability or framework/runtime dependency. `tests/repository-boundary.test.mjs`,
  `tests/kernel-one-golden-slice-boundary-authority.test.mjs` and
  `tests/kernel-runtime-substrate-s1.test.mjs` now admit `src/delivery` as a materialized ring
  holding exactly `create-customer-request-handler.mjs`, alongside `domain`, `application`,
  `sdk` and `adapters`. `planning/gj01-v13b-framework-neutral-delivery-handler.json` records
  scope, RED/GREEN evidence and rollback. `flags.runnableProduct` stays `false` — no HTTP server
  or ASGI runtime wires this handler to anything yet.
- `src/application/create-customer-commit-service.mjs`, `CreateCustomerCommitService`, a small
  framework-neutral Application-ring service composing one exact `CreateCustomerPipeline`
  instance with one injected `commit` port function. `handle(actionSpec)` runs
  `pipeline.run(actionSpec)`; a non-`ALLOW_COMMIT` outcome is returned frozen with its
  `outcome`/`requestId`/`error` preserved and `commitReceipt: null`, and the injected `commit`
  port is never called. An `ALLOW_COMMIT` outcome calls `commit(preparedChangeSet, { tenantId })`
  exactly once, awaits the frozen `CommitReceipt` the injected port returns, and answers a frozen
  result with `outcome: "COMMITTED"`, `requestId`, `error: null`, `preparedChangeSet: null` and
  `commitReceipt`. The constructor accepts exactly `{ pipeline, commit }`, requires an exact
  `CreateCustomerPipeline` instance and a function, and freezes the instance. No HTTP/ASGI/
  delivery import, no Postgres adapter import, no clock/random/env/socket/file access.
  `tests/kernel-create-customer-commit-service.test.mjs` proves the module/service existed only
  after this change, that a non-allow outcome never calls `commit`, that `ALLOW_COMMIT` calls
  `commit` exactly once with the `preparedChangeSet` and `{ tenantId }`, and that the constructor
  rejects a wrong-shaped `pipeline` or `commit`. `planning/gj01-v13a-application-commit-service.json`
  records scope, RED/GREEN evidence and rollback. `flags.runnableProduct` stays `false` — no
  delivery/HTTP layer wires this service to anything yet.
- `src/adapters/postgres-commit-adapter.mjs` now commits the `customer` write intent into
  `customer_records` (added by `0002_customer_records.py`) inside the same attested tenant
  transaction as `audit` and `transactionalOutbox`, and mints a full `CommitReceipt` — all four
  ALLOW_COMMIT intents (`customer`, `audit`, `transactionalOutbox`, `idempotency`) committed, no
  deferred intents, `receiptType: "CommitReceipt"`, `customerRecordId`/`auditLogId`/`outboxId`
  returned frozen. `intents.customer` is validated as an ordinary object with a non-empty
  `payload.name`; `intents.customer.tenantId` is mandatory — a non-empty string that must exactly
  match `options.tenantId` — and a missing or mismatched `tenantId` is rejected before any DB
  work. A duplicate
  idempotency fingerprint still rolls back the whole transaction, so no partial customer row can
  ever be left behind. `tests/postgres-commit-adapter.test.mjs` proves this against a real
  disposable Docker-backed PostgreSQL 16 instance. `planning/gj01-v12b2b-customer-commit-receipt.json`
  records scope, RED/GREEN evidence and rollback; this closes the declared V12B2A-ii follow-up.
  `flags.gapClosed` is `true`; `kernelReady`, `oneGoldenSliceReady`, `walkingSkeletonReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed` and `runnableProduct`
  all stay `false` — no delivery/HTTP layer calls this adapter yet.
- `db/metaframer_kernel_db/alembic/versions/0002_customer_records.py`, a second Alembic revision
  (`down_revision = "0001_runtime_substrate"`) adding `customer_records`, the S1 substrate's first
  tenant-owned domain table — `id`, `tenant_id`, `name`, `payload`, `created_at`, `recorded_at` —
  under `ENABLE`/`FORCE ROW LEVEL SECURITY` with a `tenant_id = mfk_current_tenant()` policy reusing
  0001's attestation function, and a runtime-role grant limited to `SELECT, INSERT, UPDATE, DELETE`
  with no DDL or control-plane access. `downgrade()` drops only `customer_records`, leaving
  `transactional_outbox`, `audit_log` and every object 0001 owns untouched.
  `db/metaframer_kernel_db/schema.py` gained `CUSTOMER_TABLE` and a `customer_table` contract key;
  `db/metaframer_kernel_db/migrations.py`'s `HEAD_REVISION` now points at `0002_customer_records`.
  `db/tests/test_customer_records.py` proves, against a real disposable Docker-backed PostgreSQL 16
  instance, that migrating to head creates the table under forced RLS, a tenant reads only its own
  rows, a missing tenant context denies both reads and writes, and downgrading to 0001 removes only
  `customer_records`. `planning/gj01-v12b2a-i-customer-migration.json` records scope, RED/GREEN
  evidence and rollback. This package deliberately leaves `db/kernel-runtime-substrate-s1.json`,
  its checker and its test, `src/adapters/postgres-commit-adapter.mjs` and `CommitReceipt` untouched
  — that JS-oracle drift is a declared follow-up, V12B2A-ii. `flags.kernelReady`,
  `oneGoldenSliceReady`, `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed` and `gapClosed` all stay `false`, and `runnableProduct` is `false`.
- Closed the V12B2A-i JS-oracle drift. `db/kernel-runtime-substrate-s1.json`,
  `tools/check-kernel-runtime-substrate-s1.mjs` and `tests/kernel-runtime-substrate-s1.test.mjs`
  now acknowledge Alembic head `0002_customer_records`, chained onto the baseline
  `0001_runtime_substrate` via `down_revision`. The checker gains `BASE_REVISION` (the baseline,
  still required to carry no predecessor) alongside `HEAD_REVISION` (now the head), and a new
  `CUSTOMER_DOMAIN_TABLES` constant (`["customer_records"]`) checked against the 0002 revision's
  source and kept structurally separate from `PHYSICAL_RUNTIME_TABLES`/`RUNTIME_TABLES`, which
  stays exactly `[transactional_outbox, audit_log]`; the S1 substrate's own two-table shape is
  unchanged. `productionSurface.revisionCount` moves from `1` to `2` and `productionSurface.modules`
  gains the 0002 revision file. `planning/gj01-v12b2a-ii-customer-oracle.json` records RED (21
  failing assertions against the working tree V12B2A-i already shipped), scope, non-goals and
  rollback. This package touches no Python module, migration or table, no
  `src/adapters/postgres-commit-adapter.mjs`, and mints no `CommitReceipt`. `flags.kernelReady`,
  `oneGoldenSliceReady`, `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed` and `gapClosed` all stay `false`, and `runnableProduct` is `false`.
- `src/adapters/postgres-commit-adapter.mjs`, materializing the `src/adapters` boundary opened by
  `planning/gj01-v12-src-adapters-delivery-boundary-authority.json` with `PostgresCommitAdapter`: a
  JS application-owned persistence port that commits a `CreateCustomerPipeline` `ALLOW_COMMIT`
  `preparedChangeSet` against the real PostgreSQL S1 substrate inside one attested tenant
  transaction, using the `pg` driver. `planning/gj01-v12b1-postgres-adapter.json` records the
  package's scope, non-goals and rollback. The S1 substrate owns exactly two runtime tables
  (`transactional_outbox`, `audit_log`) and no customer-owning table, so the adapter commits three
  of the pipeline's four write intents for real — `audit` as an `audit_log` row, `transactionalOutbox`
  as a `transactional_outbox` row, and `idempotency` realized as that row's `dedup_key`, enforced by
  the substrate's own per-tenant unique index — and honestly defers `customer`, minting no
  `CommitReceipt`. `tests/postgres-commit-adapter.test.mjs` proves this against a real, disposable
  Docker-backed PostgreSQL 16 instance, never a mock. `flags.kernelReady`, `oneGoldenSliceReady`,
  `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed` and
  `gapClosed` all stay `false`, `capabilityDelta` is `NONE` and `runnableProduct` is `false`. A
  narrow follow-up added an `npm ci` step to the `node-checks` CI job, which had no dependency-install
  step and so failed importing `pg`; no other job or action changed. This
  introduces no HTTP/ASGI/Uvicorn/Hypercorn/FastAPI/Django delivery surface, no `src/delivery`
  content and no change to `db/metaframer_kernel_db`.
- `planning/gj01-v12-src-adapters-delivery-boundary-authority.json`, a repository-boundary-authority
  package moving `src/adapters` and `src/delivery` from the repository root's forbidden
  first-children-of-`src` set to its permitted set, the way `src/sdk` was opened by
  `planning/gj01-src-sdk-boundary-authority.json`. `tools/check-repository-boundary.mjs` now
  exports `ROOT_SRC_PERMITTED_CHILDREN` as `["domain", "application", "sdk", "adapters",
  "delivery"]` with an empty `ROOT_SRC_FORBIDDEN_CHILDREN`; `db/kernel-runtime-substrate-s1.json`'s
  `rootSourceTopology` clause re-exports the same widened boundary. No `src/adapters` or
  `src/delivery` directory or file is created. `flags.kernelReady`, `oneGoldenSliceReady`,
  `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`
  and `gapClosed` all stay `false`, `capabilityDelta` is `NONE` and `runnableProduct` is `false`.
  This does not narrow, close or execute step 4 (one-golden-slice / walking-skeleton) of the
  pinned runtime-start sequence, and implements no HTTP, ASGI, Uvicorn, Hypercorn, FastAPI or
  Django delivery surface, no persistence or DB runtime change, and no CommitReceipt or
  outbox/audit runtime behaviour. A future, separately scoped Package B may target `src/adapters`
  and `src/delivery` once this package is GREEN and separately approved.
- `planning/gj01-v11-generated-sdk-step-closure.json`, a package-local closure record proving
  step 3 (`generated-sdk`) of the pinned runtime-start sequence is closed for CreateCustomer@1 by
  composing four already-GREEN evidence records: the `src/sdk` boundary opened by
  `planning/gj01-src-sdk-boundary-authority.json`, the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`, the materialized artifact in
  `planning/gj01-generated-sdk-generation.json` / `src/sdk/create-customer.mjs`, and the
  deterministic generator in `planning/gj01-v10-deterministic-sdk-generator.json` /
  `tools/generate-create-customer-sdk.mjs`. It writes no new production code and edits none of
  the composed evidence, the artifact, or the generator. `flags.generatedSdkStepClosed` is `true`
  while `kernelReady`, `sdkReady`, `generatedSdkReady`, `appBuildable`, `releaseAllowed`,
  `deployAllowed`, `productionAllowed` and `gapClosed` all stay `false`, `capabilityDelta` is
  `NONE` and `runnableProduct` is `false`. This does not open step 4 (one-golden-slice /
  walking-skeleton) of the sequence.
- `tools/generate-create-customer-sdk.mjs`, a deterministic generator exporting a pure
  `renderCreateCustomerSdk(protocol)` function that renders `src/sdk/create-customer.mjs`
  byte-identically from the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`. `planning/gj01-v10-deterministic-sdk-generator.json`
  records the package's scope, non-goals and rollback. The render path performs no network,
  environment read, clock, random value or file I/O; the CLI entry point may read the protocol
  file and print or check output but never writes to the repository, and the committed artifact
  stays byte-identical to its prior content throughout. This introduces no HTTP/ASGI delivery
  surface, no persistence and no runtime; every stronger-stage readiness flag stays false.
- The first generated-SDK artifact, `src/sdk/create-customer.mjs`, materializing the `src/sdk`
  boundary opened by `planning/gj01-src-sdk-boundary-authority.json` with a framework-neutral,
  capability-free module for CreateCustomer@1, byte-derived from the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`. `planning/gj01-generated-sdk-generation.json`
  records the package's scope, non-goals and rollback, including a narrow architecture-fitness
  supplement that `tools/check-p01-architecture-fitness.mjs` merges at runtime to admit `src/sdk`
  as a generated-boundary onion layer (order 3, after Application, before Adapters) without editing
  the pinned, byte-immutable `planning/kernel-runtime-pilot-consumer-sync.json` activation-base
  artifact, which stays byte-identical to its historical content throughout. This introduces no
  generator, no HTTP/ASGI delivery surface, no persistence and no runtime; every stronger-stage
  readiness flag stays false.
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

- The `src/sdk` boundary-authority package in
  `planning/gj01-src-sdk-boundary-authority.json`: moves `sdk` from the repository root
  source-topology fence's forbidden first children to its permitted first children, so a future,
  separately authorized generation package has a boundary to write into. `src/sdk` is permitted to
  exist and is never required to; this package creates no directory, no generator and no generated
  client code under it. `src/adapters` and `src/delivery` remain refused by name. `sdkReady`,
  `generatedSdkReady`, `implementsSdkGeneration` and every other stronger-stage flag stay `false`;
  `capabilityDelta` is `NONE` and `runnableProduct` is `false`. The shared fence is read by both
  `tools/check-repository-boundary.mjs` and `tools/check-kernel-runtime-substrate-s1.mjs`
  (via `db/kernel-runtime-substrate-s1.json#rootSourceTopology`), so both moved together as one
  package rather than drifting apart.

### Changed
- The repository root source-topology fence was widened again: a root `src` is permitted and may
  hold `src/domain`, `src/application` and `src/sdk` as its only first children — `src/domain` and
  `src/application` materialized, `src/sdk` a permitted-but-not-yet-materialized boundary — with
  `src/adapters` and `src/delivery` refused by name.
- Authority reporting now separates a checkout-local projection from project authority, so a
  feature checkout can no longer print a line that reads as the project's verdict.
- The package version moved from the planning placeholder 0.0.0-planning onto the prerelease train
  at 0.1.0-alpha.1. This is a train entry, not a release.
