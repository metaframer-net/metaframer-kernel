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
- P21h `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `21/25 tamamlandı, P22/25 aktif`, closing P21 (security)
  with the seven real merged sub-packages — P21A binding the host boundary's real-database ALLOW
  path to trusted process inputs `--trusted-tenant-id` / `--trusted-actor-id`
  (PR #128 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/32997140154)),
  P21B proving the authorization deny path writes nothing on a real PostgreSQL 16 substrate
  (PR #129 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33003288720)),
  P21C appending every boundary decision to the append-only, `prev_hash`-chained
  `policy_decision_log` before the invariant stage
  (PR #130 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33010709401)),
  P21D carrying that audited boundary to the ASGI callable via
  `createAuditedCustomerAsgiComposition`
  (PR #131 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33015412681)),
  P21E auditing identity-guard refusals via `createAuditedCustomerComposition`
  (PR #132 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33019320390)),
  P21F adding the opt-in `--audit on` audited host runner
  (PR #133 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33023129130)),
  and P21G adding `.github/workflows/security.yml` with `npm audit`, `pip-audit` and a
  digest-pinned TruffleHog scan of the current tracked tree
  (PR #134 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33027876043)
  plus its own separate [passing Security workflow run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/33027876143))
  — with P22 (deploy package/staging) active and P22-P25 production proof named as the explicit
  next-missing pieces. This truth-sync adds the
  `KERNEL_BOUNDARY_SECURITY_AUDIT_AND_SUPPLY_CHAIN_GATE` capability delta; the audit stays opt-in
  and default-off, no host server is selected, no network listener is started, the Git history is
  unscanned, runtime secrets and any CI secret store stay outside the gate, and
  `supply-chain-and-secret-scan` is not yet a required status check under branch protection, so it
  stays advisory today. No global readiness flag moves and a hosted product remains not-runnable.
  See `planning/kernel-p21-current-truth-closure-p21h.json`.
- P20b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `20/25 tamamlandı, P21/25 aktif`, closing P20
  (performance) with real merged evidence — `db/metaframer_kernel_db/performance.py`'s
  `summarize_relay_performance`, computing a deterministic `RelayPerformanceBaseline` (nearest-rank
  p95/p99 duration, published/failed totals, a measured seconds-per-published proxy, sorted
  per-tenant p95 and a measured fairness ratio) over caller-supplied relay samples, test-verified
  against real PostgreSQL 16 across 3 scenarios (`db/tests/test_outbox_relay_performance_baseline.py`,
  PR #126 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/32982906594))
  — with P21 (security) active and P21-P25 production proof all still named as the explicit
  next-missing pieces. This truth-sync adds the `OUTBOX_RELAY_PERFORMANCE_BASELINE_PURE_SUMMARY`
  capability delta, wires no calibrated SLA/threshold, sustained load/concurrency/noisy-neighbor
  proof, dollar-cost/optimizer proof, exporter, dashboard, alert transport, scheduler/loop,
  retry policy, dead-letter queue or live entrypoint, and moves no global readiness flag; a
  hosted product remains not-runnable. See `planning/kernel-p20-current-truth-closure-p20b.json`.
- P19b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `19/25 tamamlandı, P20/25 aktif`, closing P19
  (observability/SLO) with real merged evidence — `db/metaframer_kernel_db/observability.py`'s
  `run_observed_outbox_relay_once`, wrapping P18's `run_outbox_relay_once` with a `RelaySlo`
  threshold and emitting exactly one structured `outbox_relay.batch_completed` event per call
  carrying a duration/failure-rate verdict, test-verified against real PostgreSQL 16 across 3
  scenarios (`db/tests/test_outbox_relay_observability_slo.py`, PR #124 with [a passing CI run](https://github.com/metaframer-net/metaframer-kernel/actions/runs/32970268485))
  — with P20 (performance) and P21-P25 production proof all still named as the
  explicit next-missing pieces. This truth-sync adds the `OUTBOX_RELAY_OBSERVED_SLO_SINGLE_PASS`
  capability delta, wires no exporter, dashboard, alert transport, scheduler/loop, retry policy,
  dead-letter queue or live entrypoint, and moves no global readiness flag; a hosted product
  remains not-runnable. See `planning/kernel-p19-current-truth-closure-p19b.json`.
- P18b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `18/25 tamamlandı, P19/25 aktif`, closing P18 (outbox
  relay lifecycle) with real merged evidence — `db/metaframer_kernel_db/outbox_relay.py`'s
  `run_outbox_relay_once(sqlalchemy_url, tenant_id, deliver, *, limit, lease_seconds)`, composing
  the existing `claim_batch`/`publish_claim`/`release_claim` substrate primitives into one
  single-pass, fenced drain returning a frozen `OutboxRelayResult(published, failed)`,
  test-verified against real PostgreSQL 16 across 3
  scenarios (`db/tests/test_outbox_relay_lifecycle.py`, PR #122 with a passing CI run) —
  with P19
  (observability/SLO) and P20-P25 production proof all still named as the explicit next-missing
  pieces. This truth-sync adds the `POSTGRES_OUTBOX_RELAY_FENCED_RUN_ONCE`
  run-once-only capability delta, wires no scheduler/loop, retry policy, dead-letter queue or
  live entrypoint, and moves no global readiness flag; a hosted product remains not-runnable.
  See `planning/kernel-p18-current-truth-closure-p18b.json`.
- P17 `host/pyproject.toml`: makes `host/` an installable, offline-buildable pure-Python
  distribution via `uv_build` (`module-root=""`, `module-name="python_asgi"`).
  Package `metaframer-kernel-asgi-host`, version `0.1.0a1`, `requires-python >= 3.12`, no
  dependencies; console-script `metaframer-kernel-customer-host =
  python_asgi.create_customer_host_cli:main`. `host/python_asgi/__init__.py` now publicly
  re-exports exactly three names — `StdioJsAsgiBridge`, `create_customer_app`,
  `run_create_customer_host` — importable from outside the checkout with no
  uvicorn/hypercorn/fastapi/django installed or imported. Packaging/installability contract
  only: no Python bridge/server behavior change, no listener started, no production, deploy
  or release claim.
- P15 `consumers/customer-app-core/customer-module-api.mjs`: typed customer-module-api boundary
  reusing `createCustomerAppCoreWithPersistence` (P14a), `sdk.buildActionSpec` (P08) and
  `canonicalizeCustomerRecord` (P11). Manifest carries frozen `actionCoordinate: customer.create@1`
  and frozen `operations: ["recordCustomer"]`; factory rejects unless sdk is exactly that
  coordinate. `recordCustomer` requires exactly `{actionSpec, record, insertOptions}` with
  `insertOptions.audit`/`transactionalOutbox`/`idempotency` each an ordinary object, fails closed
  before touching `legacyInsert` on a tenant mismatch (built/canonical/insertOptions), any empty
  `audit.action`/`audit.correlationId`/`transactionalOutbox.eventName`/`transactionalOutbox.correlationId`/
  `idempotency.fingerprint` (so two missing correlation ids can never pass as undefined==undefined),
  or an audit/outbox correlation-id mismatch; inserts the canonical record exactly once; returns
  frozen `{ok:true, record: canonical}`; propagates a rejection by
  identity. Residual: built `requestId` is not equated to the correlation ids — the frozen test's
  fixture (UUID requestId vs literal `"corr-1"`) would fail that check; deliberate, known gap. No
  Surface/host/relay/DB/readiness change; no runnable/readiness claim. See
  `planning/kernel-customer-module-typed-api-p15.json`.
- P16 `consumers/customer-app-core/customer-surface.mjs`: customer surface UI projection wrapping
  a pre-built, ready P15 `customerModuleApi` handle in a frozen `{manifest,project,submit,retry}`
  handle. `CUSTOMER_SURFACE_MANIFEST` is frozen with states `["idle","submitting","saved",
  "rejected"]`; the factory refuses unless the handle is `status:"ready"`, carries
  `manifest.actionCoordinate === "customer.create@1"`, and exposes a `recordCustomer` function.
  Every projection exposes `state` plus `submitEnabled`/`retryVisible` (initial:
  `{state:"idle", submitEnabled:true, retryVisible:false}`). `submit({actionSpec, record,
  insertOptions})` passes the exact given args to `recordCustomer`, is single-flight (refuses a
  second concurrent submit), resolves a frozen `{state:"saved", submitEnabled:false,
  retryVisible:false, record}` carrying the P15 canonical record on success, and on failure
  resolves (never rejects) a frozen `{state:"rejected", submitEnabled:false, retryVisible:true,
  alertCode:"CUSTOMER_SURFACE_SUBMIT_REJECTED"}` — a stable alert code only, never
  reason/message/stack/Error — while remembering the exact args for `retry()`. `retry()` refuses
  outside the `"rejected"` state or while a submit is in flight, otherwise resubmits the exact
  prior args. No DOM/host/DB/relay/deps/cache/readiness-flag change; no runnable/readiness claim.
  See `planning/kernel-customer-surface-ui-projection-p16.json`.
- P17b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `17/25 tamamlandı, P18/25 aktif`, closing P17 (installable
  ASGI host adapters) with real merged evidence — `host/pyproject.toml` (`uv_build`, package
  `metaframer-kernel-asgi-host`, version `0.1.0a1`, no dependencies), `host/python_asgi/__init__.py`
  publicly re-exporting `StdioJsAsgiBridge`/`create_customer_app`/`run_create_customer_host`,
  frozen `tests/kernel-python-asgi-installable-package-p17.test.mjs` (3/3 GREEN), merged via
  PR #120 with a passing CI run — with P18 (outbox relay lifecycle) and P19-P25 production proof
  all still named as the explicit next-missing pieces. This truth-sync adds the
  `PYTHON_ASGI_HOST_ADAPTERS_INSTALLABLE_PACKAGE` packaging/installability-only capability delta,
  wires no live entrypoint, and moves no global readiness flag; a hosted product remains
  not-runnable. See `planning/kernel-p17-current-truth-closure-p17b.json`.
- P16b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `16/25 tamamlandı, P17/25 aktif`, closing P16 (separate
  Surface/UI projection) with real merged evidence — `consumers/customer-app-core/customer-surface.mjs`
  (`createCustomerSurface`, `CUSTOMER_SURFACE_MANIFEST`), frozen
  `tests/kernel-customer-surface-p16.test.mjs` (4/4 GREEN), merged via PR #118 with a passing CI
  run — with P17 (installable ASGI host adapters), P18 (outbox relay lifecycle) and P19-P25
  production proof all still named as the explicit next-missing pieces. This truth-sync adds the
  `CUSTOMER_SURFACE_IN_PROCESS_SUBMIT_REJECT_RETRY` in-process-only capability delta, wires no
  live entrypoint, and moves no global readiness flag; a hosted product remains not-runnable.
  See `planning/kernel-p16-current-truth-closure-p16b.json`.
- P15b `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `15/25 tamamlandı, P16/25 aktif`, closing P15 (Customer
  module typed API) with real merged evidence — `consumers/customer-app-core/customer-module-api.mjs`
  (`createCustomerModuleApi`, `CUSTOMER_MODULE_API_MANIFEST`, `recordCustomer`), frozen
  `tests/kernel-customer-module-api-p15.test.mjs` (5/5 GREEN), merged via PR #116 with a passing CI run — with
  P16 (separate Surface/UI projection), live entrypoint/host wiring, P18 (outbox relay lifecycle)
  and P19-P25 production proof all still named as the explicit next-missing pieces. This
  truth-sync adds no runtime capability, wires no live entrypoint, and moves no readiness flag.
  See `planning/kernel-p15-current-truth-closure-p15b.json`.
- P14f `planning/roadmap-v1-current-truth.json`, `ROADMAP.md`, `README.md`: syncs the sole
  machine-readable roadmap counter to `14/25 tamamlandı, P15/25 aktif`, closing P14 (Kernel
  cleanup and parity) with real merged evidence from its five sub-packages — P14a app-core
  cutover composition (`createCustomerAppCoreWithPersistence`), P14b/P14e app-owned persistence
  parity (`createCustomerPersistenceAdapter`), P14c/P14d1/P14d2a/P14d2b transitional Kernel
  ownership cleanup and retirement of `src/adapters/postgres-commit-adapter.mjs`, and P14e's
  isolated real PostgreSQL 16 proof — with P15 (Customer module typed API) as the active
  package. This truth-sync adds no runtime capability, wires no live entrypoint, and moves no
  readiness flag. See `planning/kernel-p14-current-truth-closure-p14f.json`.
- P14e `consumers/customer-app-core/customer-data-cutover.mjs`: the application-path insert now
  synthesizes Kernel-parity `audit`/`transactionalOutbox`/`idempotency` metadata only when all
  three are absent from the caller's options; if any one is explicitly supplied, all explicit
  parity fields pass through unchanged so `createCustomerPersistenceAdapter` fail-closed rejects a
  partial explicit set before any table write, closing a targeted real-PostgreSQL RED where a
  partially explicit set was previously silently completed instead of rejected. Legacy default,
  explicit cutover wiring, transaction/context/commit/rollback/release behavior, complete explicit
  metadata pass-through and every existing default value are unchanged. See
  `planning/kernel-app-postgres-composition-p14e.json`.
- P14d1 `src/adapters/postgres-write-envelope-write.mjs` directly owns and exports
  `IdempotencyConflictError`, `isDuplicateIdempotencyFingerprintError`, `checkPreparedChangeSet`
  and `checkTenantId`, along with their private constants and validation helpers, moved verbatim
  (unchanged error messages, frozen shapes, SQL, `createPostgresWrite` behavior and CommitReceipt
  behavior) out of the transitional `src/adapters/postgres-commit-adapter.mjs`. The surviving
  write module no longer imports the transitional adapter. `postgres-commit-adapter.mjs` now
  imports and re-exports those same four names from the surviving module so its own public
  API/identity, `PostgresCommitAdapter`'s SQL/transaction behavior and the unchanged
  `tests/postgres-commit-adapter.test.mjs` stay compatible; the transitional adapter still exists
  and is not physically removed. See
  `planning/kernel-postgres-write-contract-decoupling-p14d1.json`.
- P14c `tools/check-kernel-persistence-ownership.mjs`: retires the combined `transitionalInKernel`
  manifest record (its presence, correct or not, now denies fail-closed) and replaces it with two
  independently frozen facts checked in code, not merely restated in the manifest. The migration
  half, `applicationOwnedHistoricalMigrations`, is required and preserved — `0002_customer_records.py`
  stays application-owned history that `0003_policy_decision_log.py`'s `down_revision` still
  depends on, so it can be missing, relabelled, or grown but never simply admitted. The adapter
  half, `transitionalKernelAdapters`, may state the one frozen `postgres-commit-adapter.mjs`
  retirement-pending record, or be the empty array only once that physical adapter file is also
  gone (admissible convergence); any unknown adapter entry still denies by name, and an orphaned
  physical adapter with no declaration still denies. `planning/kernel-persistence-ownership.json`
  now carries the split declaration. No migration, adapter, consumer, or live wiring changed; this
  is a governance-only build-time guard update. See
  `planning/kernel-transitional-persistence-history-p14c.json`.
- P14b `consumers/customer-app-core/customer-persistence-adapter.mjs` (`createCustomerPersistenceAdapter`,
  `CustomerIdempotencyConflictError`): fail-closed validates tenantId/audit/transactionalOutbox/
  idempotency metadata before any query, delegates the unchanged P12 `createCustomerRecordsAdapter`
  for the canonical `customer_records` insert, then writes `audit_log` and `transactional_outbox`
  with the same SQL/param shape as the Kernel's `postgres-write-envelope-write.mjs`, and maps the
  one known pg 23505 `transactional_outbox_tenant_dedup_key` violation to the new
  `CustomerIdempotencyConflictError` (retryable false) while every other error identity propagates
  unchanged. The P13 application branch of `consumers/customer-app-core/customer-data-cutover.mjs`
  now calls this adapter instead of the bare P12 one, filling in Kernel-parity default metadata
  only when the caller supplies no metadata object at all; explicit metadata passes through
  unchanged and partial explicit metadata is rejected. Legacy path and P12 source untouched; not
  wired into any live entrypoint. See `planning/kernel-customer-app-persistence-parity-p14b.json`.
- P14a `consumers/customer-app-core/customer-app-core.mjs` (`createCustomerAppCoreWithPersistence`):
  an explicit opt-in composition that reuses `createCustomerAppCore`'s public-SDK-contract and
  `customer:core` fail-closed validation unchanged, then constructs the real P13
  `createCustomerDataCutover` from injected `cutoverOptions` and returns a frozen
  `{sdkCoordinate, status, persistence}` result. Default persistence writer stays `legacy`;
  construction never touches the pool; there is no automatic cutover; validation and cutover
  errors propagate unchanged. `createCustomerAppCore` itself is unchanged. Not wired into any
  live entrypoint. See `planning/kernel-customer-app-core-cutover-p14a.json`.
- P13 `consumers/customer-app-core/customer-data-cutover.mjs` (`createCustomerDataCutover`):
  a frozen, legacy-default controller with a gated `cutover()` (verifies compatibility against
  a real pg client before switching `activeWriter` to `application`), a single-transaction
  application insert path (BEGIN / `mfk_begin_tenant_context` / P12 adapter insert / COMMIT,
  rollback-on-failure), and `rollback()`/`close()`. No live traffic moved; not yet wired into
  app-core. See `planning/kernel-customer-data-cutover-p13.json`.
- P13b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p13-current-truth-closure-p13b.json`): synced the roadmap current-truth
  artifact — a 25-package denominator — to P13's real merged evidence — the frozen,
  default-legacy data cutover/rollback controller (`consumers/customer-app-core/customer-data-cutover.mjs`,
  `createCustomerDataCutover`) — is now recorded as implemented, removing P13 from
  `notImplementedPieces` and replacing it with P14 (Kernel cleanup and parity) as the explicit
  next-missing piece. Progress moves from `12/25 tamamlandı, P13/25 aktif` to
  `13/25 tamamlandı, P14/25 aktif` (completed: P01–P13; active: P14, Kernel cleanup and parity),
  with every readiness flag (`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`,
  `deployAllowed`, `productionAllowed`, `gapClosed`, `oneGoldenSliceReady`, `runnableProduct`)
  held `false` and `capability_delta: NONE`. This is a documentation/current-truth sync only; it
  adds no runtime capability and moves no readiness flag. No npm release.
- P12b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p12-current-truth-closure-p12b.json`): synced the roadmap current-truth
  artifact to P12's real merged evidence — the application-owned, query-injected
  `customer_records` adapter (`consumers/customer-app-core/customer-records-adapter.mjs`,
  `createCustomerRecordsAdapter`) — is now recorded as implemented, removing the prior
  "app-owned adapter (P12)... not yet" claim and replacing it with P13 (data cutover and
  rollback) as the explicit next-missing piece. Progress moves from
  `11/25 tamamlandı, P12/25 aktif` to `12/25 tamamlandı, P13/25 aktif` (completed: P01–P12;
  active: P13, data cutover and rollback), with every readiness flag (`kernelReady`, `sdkReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`,
  `oneGoldenSliceReady`, `runnableProduct`) held `false` and `capability_delta: NONE`. This is a
  documentation/current-truth sync only; it adds no runtime capability and moves no readiness
  flag. No npm release.
- P12 `consumers/customer-app-core/customer-records-adapter.mjs`
  (`createCustomerRecordsAdapter({query})`, plus `planning/kernel-customer-app-owned-adapter-p12.json`):
  an app-owned, query-injectable adapter that canonicalizes a P11 customer record, requires a
  matching `tenantId`, issues exactly one parameterized INSERT against `CUSTOMER_RECORDS_SCHEMA`,
  and returns the single frozen canonical row. No real database connection, migration, or
  cutover exists; `capability_delta: APPLICATION_OWNED_CUSTOMER_RECORDS_QUERY_ADAPTER_ONLY`.
- P11b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p11-current-truth-closure-p11b.json`): synced the roadmap current-truth
  artifact to P11's real merged evidence — the app-owned, immutable `customer_records` schema
  and validator contract (`consumers/customer-app-core/customer-records-schema.mjs`,
  `CUSTOMER_RECORDS_SCHEMA` plus `canonicalizeCustomerRecord`) — is now recorded as implemented,
  removing the prior "app-owned customer schema (P11)... not yet" claim and replacing it with
  P12 (app-owned adapter) as the explicit next-missing piece. Progress moves from
  `10/25 tamamlandı, P11/25 aktif` to `11/25 tamamlandı, P12/25 aktif` (completed: P01–P11;
  active: P12, app-owned adapter), with every readiness flag (`kernelReady`, `sdkReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`,
  `oneGoldenSliceReady`, `runnableProduct`) held `false` and `capability_delta: NONE`. This is a
  documentation/current-truth sync only; it adds no runtime capability and moves no readiness
  flag. No npm release.
- P11 `consumers/customer-app-core/customer-records-schema.mjs`: a pure, zero-import,
  application-owned `customer_records` schema contract (`CUSTOMER_RECORDS_SCHEMA` plus
  `canonicalizeCustomerRecord`) that deep-freezes its six-field/index/RLS/runtime-grant
  descriptor, agrees with `planning/kernel-persistence-ownership.json`'s transitional
  `customer_records` entry and the `0002_customer_records.py` migration shape, and
  canonicalizes/validates an exact-six-key record fail-closed with no SQL, migration,
  adapter, CRUD, or cutover behavior. See
  `tests/kernel-customer-app-owned-schema-p11.test.mjs` and
  `planning/kernel-customer-app-owned-schema-p11.json`.
- P10b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p10-current-truth-closure-p10b.json`): synced the roadmap current-truth
  artifact to P10's real merged evidence — the app-owned Customer app-core public-SDK consumer
  boundary (`consumers/customer-app-core/customer-app-core.mjs`) — is now recorded as
  implemented, removing the prior "app-core (P10)... not yet" claim and replacing it with P11
  (app-owned customer schema) as the explicit next-missing piece. Progress moves from
  `9/25 tamamlandı, P10/25 aktif` to `10/25 tamamlandı, P11/25 aktif` (completed: P01–P10;
  active: P11, app-owned customer schema), with every readiness flag (`kernelReady`, `sdkReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`,
  `oneGoldenSliceReady`, `runnableProduct`) held `false` and `capability_delta: NONE`. This is a
  documentation/current-truth sync only; it adds no runtime capability and moves no readiness
  flag. No npm release.
- P10 `consumers/customer-app-core/customer-app-core.mjs`: an app-owned Customer app-core
  public-SDK consumer boundary (`CUSTOMER_APP_CORE_MANIFEST` plus `createCustomerAppCore`)
  that composes a P08-generated public action SDK module only through its public contract
  surface, fails closed on a missing/malformed/wrong-coordinate SDK or a missing/near-match
  `customer:core` capability grant, and exposes no schema/adapter/CRUD/Surface/UI/host/
  release/readiness behavior. This is an implementation candidate only: not wired to any
  route, host, or release path, and not a runnable product.
- P09b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p09-current-truth-closure-p09b.json`): synced the roadmap current-truth
  artifact to P09's real evidence — the standalone clean consumer fixture
  (`tests/fixtures/versioned-sdk-clean-consumer.mjs`) copying P08's real versioned SDK
  distribution payload into a temp directory, emptying the environment and validating
  version/path/manifest/file existence and the recomputed SHA-256 before import — is now
  recorded as implemented, removing the prior "clean consumer conformance (P09)... not yet"
  claim and replacing it with P10 (app-core) as the explicit next-missing piece. Progress moves
  from `8/25 tamamlandı, P09/25 aktif` to `9/25 tamamlandı, P10/25 aktif` (completed: P01–P09;
  active: P10, app-core), with every readiness flag (`kernelReady`, `sdkReady`, `appBuildable`,
  `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`, `oneGoldenSliceReady`,
  `runnableProduct`) held `false` and `capability_delta: NONE`. This is a
  documentation/current-truth sync only; it adds no runtime capability and moves no readiness
  flag. No npm release.
- P09 `tests/fixtures/versioned-sdk-clean-consumer.mjs`: a standalone, builtins-only clean
  consumer fixture for the P08 versioned SDK distribution payload. Run as
  `node consumer.mjs EXPECTED_DISTRIBUTION_VERSION` with `cwd` inside a materialized temp
  payload and `env={}`, it validates expected distribution version, a safe contained
  `modulePath`, manifest shape, module file existence, and exact recomputed P08 SHA-256
  integrity bytes before ever dynamically importing the generated module, failing closed with
  deterministic `CLEAN_CONSUMER_ERROR:{VERSION_MISMATCH,UNSAFE_PATH,MALFORMED_MANIFEST,
  MISSING_FILE,INTEGRITY_MISMATCH}` codes. See
  `planning/kernel-clean-consumer-conformance-p09.json`; targeted 3/3 GREEN, full QA/CI/reviewer
  pending, all readiness flags `false`.
- P08b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p08-current-truth-closure-p08b.json`): synced the roadmap current-truth
  artifact to P08's real evidence — the versioned SDK distribution wrapper
  `renderVersionedActionSdkDistribution(contract, distributionVersion)`
  (`tools/generate-versioned-action-sdk-distribution.mjs`) is now recorded as implemented,
  removing the prior "versioned SDK distribution (P08)... not yet" claim and replacing it with
  P09 (clean consumer conformance) as the explicit next-missing piece. Progress moves from
  `7/25 tamamlandı, P08/25 aktif` to `8/25 tamamlandı, P09/25 aktif` (completed: P01–P08; active:
  P09, clean consumer conformance), with every readiness flag (`kernelReady`, `sdkReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`,
  `oneGoldenSliceReady`, `runnableProduct`) held `false` and `capability_delta: NONE`. This is a
  documentation/current-truth sync only; it adds no runtime capability and moves no readiness
  flag.
- P08 `tools/generate-versioned-action-sdk-distribution.mjs`
  (`renderVersionedActionSdkDistribution(contract, distributionVersion)`): wraps P07's
  `renderActionSdk` with a caller-supplied version into a coordinate-addressed, integrity-checked
  manifest+module file set. See `planning/kernel-versioned-sdk-distribution-p08.json`; targeted
  27/27 GREEN, full QA/CI pending, all readiness flags `false`.
- P07 `tools/generate-action-sdk.mjs` (generic `renderActionSdk(contract)`) plus
  `tests/kernel-generic-action-sdk-generator.test.mjs`: a pure, capability-free generator that
  renders a framework-neutral, import-free ESM SDK module from an arbitrary P02 `ActionContract`
  instance, generalizing the existing pinned CreateCustomer generator without changing it. See
  `planning/kernel-generic-generator-p07.json` for scope hashes, allowed files, and gate status.
  Targeted combined run (`kernel-generic-action-sdk-generator`, `kernel-action-contract`,
  `kernel-generated-sdk-generation`, `kernel-generated-sdk-generation-determinism`) is 32/32
  GREEN; full local QA and CI remain pending. Every readiness flag (`kernelReady`, `sdkReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`, `gapClosed`,
  `oneGoldenSliceReady`, `runnableProduct`) stays `false`; `capability_delta:
  GENERIC_SDK_GENERATOR_ONLY`.
- P07b `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections and
  `planning/kernel-p07-current-truth-closure-p07b.json`): synced the roadmap current-truth
  artifact to P07's real evidence — the generic `renderActionSdk(contract)` generator
  (`tools/generate-action-sdk.mjs`), consuming an exact P02 `ActionContract` instance, is now
  recorded as implemented, removing the prior "generic contract-to-SDK generator... not yet"
  claim. Progress moves from `6/25 tamamlandı, P07/25 aktif` to
  `7/25 tamamlandı, P08/25 aktif` (completed: P01–P07; active: P08, versioned SDK distribution),
  with every readiness flag (`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`,
  `deployAllowed`, `productionAllowed`, `gapClosed`, `oneGoldenSliceReady`, `runnableProduct`)
  held `false` and `capability_delta: NONE`. This is a documentation/current-truth sync only; it
  adds no runtime capability and moves no readiness flag.
- P05f `planning/roadmap-v1-current-truth.json` (plus its ROADMAP.md/README.md projections):
  synced the roadmap current-truth artifact to P05's real evidence — `UnitOfWork` (UoW), the
  canonical `CommitReceipt` and the write envelope are now recorded as implemented and composed
  end to end into the CreateCustomer commit-boundary composition chain, removing the prior "P05
  UoW composition... missing" claim. Progress moves from `5/25 tamamlandı, P05/25 aktif` to
  `6/25 tamamlandı, P07/25 aktif` (completed: P01–P06; active: P07, the generic generator), with
  every readiness flag (`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`,
  `deployAllowed`, `productionAllowed`, `gapClosed`, `oneGoldenSliceReady`, `runnableProduct`)
  held `false` and `capability_delta: NONE`. Also corrects two stale comments in
  `src/delivery/create-customer-asgi-composition.mjs` that described the commit boundary as "the
  underlying PostgresCommitAdapter" / "the composed PostgresCommitAdapter" — now described as the
  UnitOfWork-backed commit resource actually wired since P05e — with zero runtime behavior
  change. This is a documentation/current-truth sync only; it adds no runtime capability and
  moves no readiness flag.
- P05e `src/delivery/create-customer-composition.mjs`: `createCustomerComposition`'s *use* of the
  `PostgresCommitAdapter` collaborator (the adapter module itself is untouched) was removed and
  replaced with one `createPostgresUnitOfWork` resource. The commit port is now a closure that, on
  each invocation, constructs a fresh `UnitOfWork(resource.port)`, a fresh `createPostgresWrite`,
  a fresh `WriteEnvelope`, and returns `envelope.commit(preparedChangeSet)`. `close` now closes the
  `createPostgresUnitOfWork` resource. Constructor options and the public `{ handler, close }`
  result shape are unchanged; per-request commit independence under concurrency, already proven by
  the per-request-transaction design, is preserved (not newly introduced) by giving each
  `ALLOW_COMMIT` request its own fresh `UnitOfWork` off the same shared `resource.port`, so no
  shared `UnitOfWork` in-flight state is introduced. See
  `planning/kernel-create-customer-composition-p05e.json`.
- P05d `src/application/create-customer-commit-service.mjs`: on `ALLOW_COMMIT`, the service now
  builds one fresh, frozen ordinary context carrying exactly `requestId` (the validated pipeline
  outcome), `tenantId` (`preparedChangeSet.intents.customer.tenantId`) and `idempotencyKey` (the
  already-admitted raw `actionSpec.idempotencyKey`), replacing the prior unfrozen `{tenantId}`-only
  context passed to the injected commit port; the port is still awaited exactly once as
  `commit(preparedChangeSet, context)` and its returned `CommitReceipt` still passes through by
  identity. Constructor options, non-`ALLOW_COMMIT` paths and public result shapes are unchanged.
  **Reviewer P1 TOCTOU correction (same P05d package):** the raw `idempotencyKey` used to build
  that ALLOW_COMMIT context was being read from `actionSpec.idempotencyKey` *after* the pipeline's
  awaited `run()` returned, so a caller mutation of `actionSpec` while the pipeline was suspended
  on its first internal `await` was observed by the commit context instead of the value admitted
  before suspension. Fixed by capturing the idempotency key synchronously as the first statement of
  `handle()`, before `await this.#pipeline.run(actionSpec)`, into a `let capturedIdempotencyKey`
  wrapped in `try`/`catch`, guarded by the module's existing `isOrdinaryObject(actionSpec)` helper
  (reading `actionSpec.idempotencyKey` only when `actionSpec` is an ordinary object, defaulting to
  `undefined` when it is not or when the property read throws) so the capture is non-throwing and
  cannot regress the pipeline's existing frozen `INVALID` outcome for null/non-ordinary/throwing
  input; and building the frozen `ALLOW_COMMIT` context from that captured value instead of
  re-reading `actionSpec.idempotencyKey` after the await. No caller-side `ActionSpec` freeze is
  required. The frozen test file `tests/kernel-create-customer-commit-service.test.mjs`
  (SHA-256 `9e09e42dc4ae1e3d77e1a7a20e73b5b35df9631e1b867c9b8909a5766b38902d`) gained one added TOCTOU
  scenario for this; P05d now totals 4 changed/added scenarios across 1 changed test file. Targeted
  `node --test tests/kernel-create-customer-commit-service.test.mjs` was run three times as the
  capture was tightened: 8/8 PASS after the initial TOCTOU capture, 8/8 PASS after the follow-up
  non-throwing guard, and 8/8 PASS after the final `isOrdinaryObject` substitution, each rerun
  because the prior targeted run predated that source edit. Full-package base-to-working-tree
  against the immutable P05d base snapshot across all four allowed files:
  `CHANGELOG.md` +48/-0,
  `planning/kernel-create-customer-commit-context-p05d.json`
  +117/-0,
  `src/application/create-customer-commit-service.mjs`
  +12/-1, and the frozen
  `tests/kernel-create-customer-commit-service.test.mjs`
  +81/-6 (not authored by this writer) — gross
  +258/-7, net 251, 4 files, class `default`,
  gate `GREEN_NET_LE_400`. The original clean candidate snapshot's full
  `npm test` (1485/1485 PASS) and `npm run check` (exit 0) count as this package's one used full
  QA1 run (`validFullQa1Used: 1`), valid as historical evidence against that pre-correction
  snapshot but not for the current, corrected snapshot (`currentSnapshotValidFullQa1Used: 0`): the
  snapshot changed after that run under this reviewer correction, and again under this targeted
  QA-governance correction, so one additional local full QA1 run against the current snapshot is
  pending, authorized only under reason `SNAPSHOT_CHANGED_AFTER_TARGETED_CORRECTION`; CI remains
  QA2 pending. No adapter, UnitOfWork,
  WriteEnvelope, CommitReceipt, composition, delivery, host, database or schema change beyond this
  service commit-context seam; `createCustomerComposition` is not yet wired to this service
  (deferred to P05e). `capability_delta` is `NONE`; every readiness/product/release/deploy flag
  stays `false`, P05 stays active, and the P05e/P05f residual is unchanged; the product is not
  runnable from this change alone.
- P05c `src/adapters/postgres-unit-of-work.mjs`, `src/adapters/postgres-write-envelope-write.mjs`:
  a lazy `createPostgresUnitOfWork({connectionString})` owning one `pg.Pool`, returning a frozen
  `{port, close}` whose port is a frozen ordinary `{begin, commit, rollback}` (BEGIN/COMMIT with
  best-effort ROLLBACK-on-COMMIT-failure/ROLLBACK, always releasing the client), shareable across
  fresh application `UnitOfWork` instances; and `createPostgresWrite({requestId, idempotencyKey})`
  building the `WriteEnvelope` `write(scope, preparedChangeSet)` collaborator, committing all four
  write intents inside the caller's own transaction scope against the same S1 substrate
  `PostgresCommitAdapter` targets and resolving to a canonical `CommitReceipt`, reusing its exact
  helpers (`checkPreparedChangeSet`, `checkTenantId`, `isDuplicateIdempotencyFingerprintError`, now
  exported, zero public `commit` behavior change). Registered in the closed `src/adapters`
  `RING_MODULE_MANIFEST` and, separately, admitted into
  `planning/kernel-persistence-ownership.json` via a new frozen, opt-in
  `p05CompositionAdapterFiles` manifest field (`tools/check-kernel-persistence-ownership.mjs`) —
  inventory admission only, granting no persistence ownership/capability/readiness/release; the
  one transitional `customer_records` record is unchanged. Composed end to end against a real
  PostgreSQL 16 container: a lazy, shareable port; `WriteEnvelope` committing all four intents to
  a canonical `CommitReceipt`; rollback with no partial rows on body failure; a repeated
  fingerprint rejecting with `IdempotencyConflictError`. Component-level evidence only;
  `capability_delta` is `POSTGRES_UOW_WRITE_ENVELOPE_COMPONENT_EVIDENCED`, every readiness/release
  flag stays `false`.
- P05b `src/application/write-envelope.mjs`: the frozen `WriteEnvelope` class composing
  `UnitOfWork` with `CommitReceipt` by exact prototype — runs one write inside `UnitOfWork.run`,
  rolls back an inexact receipt, returns the exact receipt only after commit settles. No
  adapter/database/SDK/delivery coupling; `capability_delta` stays `NONE`. Registers
  `write-envelope.mjs` in the closed `src/application` manifest
  (`tests/repository-boundary.test.mjs`).
- P05a `src/application/commit-receipt.mjs`: the frozen `CommitReceipt` Application-ring value
  class holding exactly the canonical eight fields (`requestId`, `tenantId`, `resourceId`,
  `outcome`, `committedAt`, `auditId`, `outboxEventIds`, `idempotencyKey`) per the frozen
  Actionplan contract report `reports/gj01-v2-contract-freeze-2026-08-22.json`, with no
  ambient clock, id generator, random, I/O, adapter, UoW or delivery coupling. No
  readiness/runnable-product claim; `capability_delta` stays `NONE`.
- P04h roadmap current-truth sync (`planning/roadmap-v1-current-truth.json`,
  `tests/kernel-roadmap-v1-current-truth.test.mjs`, this file, `ROADMAP.md`, `README.md`): adds
  `roadmap.progress` (`completed=5`, `total=25`, `completedPackages=[P01,P02,P03,P04,P06]`,
  `activePackage=P05`, `statusLine="5/25 tamamlandı, P05/25 aktif"`), moves P04 (policy-as-data,
  batch and decision-log adapter, composed end to end against a real PostgreSQL decision-log)
  from `notImplementedPieces` to `implementedPieces`, and adds P05 (UoW, CommitReceipt, write
  envelope) as the explicit next-missing piece. Every readiness/product flag
  (`kernelReady`/`sdkReady`/`appBuildable`/`releaseAllowed`/`deployAllowed`/`productionAllowed`/
  `gapClosed`/`oneGoldenSliceReady`/`runnableProduct`) stays `false` and `capability_delta`
  stays `NONE`/`calistirilabilirlik` stays `not-runnable`; this package makes no readiness or
  runnable-product claim and adds no runtime capability.
- P04g `PostgresDecisionLogAdapter#chainHead(tenantId)` and `policyDecisionLogComposition`
  (`src/adapters/postgres-decision-log-adapter.mjs`,
  `src/delivery/policy-decision-log-composition.mjs`,
  `tests/postgres-decision-log-adapter.test.mjs`): `chainHead(tenantId)` is a real prototype
  method, additionally installed per instance in the constructor via `Object.defineProperty(this,
  "chainHead", { value: Object.freeze(this.chainHead.bind(this)) })` — a bare-handoff,
  bound-safe instance collaborator while the prototype method itself remains defined — requiring
  an exact genuine `TenantId` (brand-checked via a captured `TenantId.prototype.toString`, exact
  prototype and canonical-UUID result, never an untrusted getter). It enters the same attested
  tenant transaction `append` uses and answers the unique terminal same-tenant row — the row no
  same-tenant successor's `prev_hash` names, via `NOT EXISTS`, never `recorded_at` ordering — or
  `null` for an empty tenant, rolling back on error and always releasing the pooled client.
  `policyDecisionLogComposition(options)` is a new frozen composition root admitting exactly
  `{connectionString, statements, idGenerator, now}`, constructing a genuine
  `PolicyCandidateResolver`, `Clock`, `PostgresDecisionLogAdapter`, `DecisionLogPort` and
  `DecisionLoggingPolicyDecisionPoint`, and returning synchronously — no eager I/O, `idGenerator`
  or `now` call — one frozen bound-safe `{ decide, decideAll, close }` facade. The facade itself
  is exercised end-to-end against a real PostgreSQL 16 database: allow and default-deny
  decisions, second same-tenant chaining, multi-tenant `decideAll`, and a mid-batch failure that
  leaves the already-persisted prefix persisted and never runs later requests. Preserves
  sequential, non-atomic batch semantics. Non-goals: policy store, migration,
  HTTP/UI/SDK/PEP/product caller, retry/queue/cache, concurrency locking, new dependency, atomic
  batch rollback. `planning/kernel-policy-decision-log-composition-p04g.json` records scope,
  targeted results (`node --test tests/postgres-decision-log-adapter.test.mjs
  tests/repository-boundary.test.mjs` is 173/173 pass, 0 fail, real exit 0 at frozen test hashes
  `tests/postgres-decision-log-adapter.test.mjs`
  `e6cbc16dfaf563ea2ba1f39f48c277fa0e314f8bf7cc14d979d98a2432b737f7` (657 lines) and
  `tests/repository-boundary.test.mjs`
  `5099a8165f5e9192158ab1fd6f1e55c9993c8829253bbb6435bc74b3c0a5b923` (814 lines); an earlier
  173/173 GREEN at test hash `05e9695c6179386d4659cc43ac57d24f99822cbff7924c4357d1865ffcbd1143`
  is SUPERSEDED_BY_CHANGED_SOURCE_AND_TEST_SNAPSHOT, not authoritative, after a MASTER review
  found a real-composition coverage gap and a detached-`chainHead` gap and the test writer
  rewrote the same three scenarios) and rollback.
- P04f `DecisionLoggingPolicyDecisionPoint` (`src/application/decision-logging-policy-decision-point.mjs`,
  `tests/kernel-decision-logging-policy-decision-point.test.mjs`): wires `AuthorizationEvaluator`
  to `DecisionLogPort` behind a frozen ordinary constructor `{candidatesFor, decisionLog,
  idGenerator, clock, chainHead}`. `decide(request)` makes exactly one `candidatesFor` call and
  one `AuthorizationEvaluator.decide` call, derives `layerResolved` by locating the winning
  `matchedPolicyId` back in the already-fetched candidates (v2 layer, `"tenant"` for a legacy
  three-key winner, `null` for default-deny), builds one genuine `DecisionLogEntry` from
  `idGenerator()`, `clock.now()` and `chainHead(tenantId)`, and awaits `decisionLog.append` before
  resolving with the exact `PolicyDecision`. `decideAll(requests)` fully preflights the whole
  batch before touching any collaborator, evaluates sequentially in input order, reads
  `chainHead` once per tenant per batch, chains later same-tenant entries from the prior
  successfully appended entry's own `entryHash`, and stops at the first failure with no partial
  result ever observed. `planning/kernel-decision-log-wiring-p04f.json` records scope, targeted
  GREEN and rollback.
- P04e1 `policy_decision_log` DB substrate (`db/metaframer_kernel_db/alembic/versions/0003_policy_decision_log.py`,
  `db/tests/test_policy_decision_log.py`): a third Alembic revision (`down_revision =
  "0002_customer_records"`) adding a dedicated append-only hash-chain table, never a reuse of
  `audit_log`. Columns mirror P04d's payload shape (`id` canonical-uppercase ULID, `tenant_id`
  uuid, `entry_hash`/`prev_hash` lowercase 64-hex, `payload` jsonb, `recorded_at`); CHECK
  constraints bind `payload.id`/`payload.prevHash`/`payload.requestActor.tenantId` to their
  columns and reject a self-link. An inline unique `(tenant_id, entry_hash)` plus a self-FK on
  `(tenant_id, prev_hash)` chain each row to its same-tenant predecessor; two partial unique
  indexes cap each tenant to one genesis row and each predecessor to one successor. FORCE
  row-level security keyed off `mfk_current_tenant()`, `mfk_runtime` granted SELECT/INSERT only,
  and a dedicated statement trigger refuses UPDATE/DELETE/TRUNCATE for the owner too.
  `db/metaframer_kernel_db/schema.py` adds `POLICY_DECISION_LOG_TABLE` and a
  `policy_decision_log_table` schema-contract key without touching `RUNTIME_TABLES`.
  `db/metaframer_kernel_db/migrations.py`'s `HEAD_REVISION` now points at
  `0003_policy_decision_log`. `db/kernel-runtime-substrate-s1.json` and
  `tools/check-kernel-runtime-substrate-s1.mjs` advance to three physical revisions
  (0001/0002/0003) and cross-bind the new revision's RLS and trigger source.
  `tools/check-kernel-persistence-ownership.mjs` gains a `kernelCapabilityMigrations` manifest
  field, code-frozen to exactly `0003_policy_decision_log.py`/`policy_decision_log` and inert
  unless the manifest declares it; `planning/kernel-persistence-ownership.json` activates it.
  `planning/kernel-decision-log-db-p04e1.json` records scope, RED/GREEN and rollback.
- P04e2 `PostgresDecisionLogAdapter` (`src/adapters/postgres-decision-log-adapter.mjs`,
  `tests/postgres-decision-log-adapter.test.mjs`): `append(entry)` derives tenant only from
  `entry.request.tenantId`, and `adapter.append` is a bound-safe instance field so
  `new DecisionLogPort({ append: adapter.append })` needs no `.bind(adapter)`. One transaction —
  `BEGIN`; `SELECT mfk_begin_tenant_context($1::uuid)`; `INSERT ... RETURNING id, tenant_id,
  entry_hash, prev_hash, payload`; verify; `COMMIT` — writes into `policy_decision_log`, rolling
  back and always releasing the client on failure. The three known chain-integrity SQLSTATE
  violations (duplicate genesis `policy_decision_log_one_genesis_per_tenant`, fork
  `policy_decision_log_one_successor_per_predecessor`, orphan predecessor
  `policy_decision_log_prev_hash_same_tenant_fk`) surface as one frozen, non-retryable
  `DecisionLogChainConflictError` (`DECISION_LOG_CHAIN_CONFLICT`, fields `tenantId`/`entryId`/
  `prevHash`); every other database error propagates unmasked. The exported pure
  `verifyPersistedDecisionLogRow` never trusts `entry.entryHash`: it recomputes P04d's canonical
  SHA-256 from the row's own payload using the fixed root key order and the same recursive
  descending-key-order rule applied to `requestResource`/`requestContext`, after undoing whatever
  order a JSONB round-trip left the payload in, and binds `id`/`tenant_id`/`prev_hash` to it,
  refusing hash mismatch, binding drift, or any missing/extra/mistyped field with a
  `DecisionLogIntegrityError`. `tools/check-kernel-persistence-ownership.mjs` gains an analogous
  `kernelCapabilityAdapterFiles` manifest field, code-frozen to exactly
  `["postgres-decision-log-adapter.mjs"]` and inert unless declared;
  `planning/kernel-persistence-ownership.json` activates it.
  `planning/kernel-decision-log-adapter-p04e2.json` records scope, GREEN and rollback.
- P04d `DecisionLogEntry` and `DecisionLogPort` (`src/application/decision-log-entry.mjs`,
  `src/application/decision-log-port.mjs`, `tests/kernel-decision-log.test.mjs`): adds one
  append-only, hash-chained record of a single policy decision, and a pure one-function
  forwarding seam over an append-only collaborator. `DecisionLogEntry` fixes a canonical ULID
  `id`, the genuine `PolicyRequest`/`PolicyDecision` pair it covers, a `layerResolved` bound to
  the decision's `matchedPolicyId` (non-null only for `"system"`/`"platform"`/`"tenant"`, `null`
  only for a default-deny), a canonical UTC millisecond ISO `ts`, and a `prevHash` (`null` or
  lowercase 64-hex) into one fixed JSON payload, and requires `decision.traceId` to be the exact
  same `CorrelationId` instance as `request.action.correlationId` by identity, not merely
  value-equal. `entryHash` is the `node:crypto` SHA-256 of that fixed payload with no ambient
  clock, id, random or I/O. `DecisionLogPort` exposes exactly `append(entry)`: a hostile options
  accessor is never invoked while checking admission, a counterfeit entry built on the genuine
  prototype is refused before its collaborator is ever reached, and a genuine call forwards to
  the collaborator with an undefined receiver, preserving its resolved or rejected identity
  unchanged. No persisted-row verifier, DB/RLS/WORM, PDP/batch wiring, read/update/delete API,
  retry/queue/cache, SDK/UI/config/version/release/deploy/readiness claim is introduced. See
  `planning/kernel-decision-log-p04d.json`.
- P04c `PolicyBatchEvaluator` (`src/application/policy-batch-evaluator.mjs`,
  `tests/kernel-policy-batch-evaluator.test.mjs`): adds a sequential batch orchestrator whose
  constructor delegates exact `{candidatesFor}` validation to one internal `PolicyDecisionPoint`.
  `decideAll(requests)` preflights an ordinary dense array of exact genuine `PolicyRequest`
  values before any collaborator call, admits an empty array without ever calling the
  collaborator, then sequentially awaits one PDP decision per request in exact input order,
  stopping and rejecting with the first collaborator failure with no partial result, and answers
  with a new ordinary frozen decision array. No candidate/combining logic is duplicated; no
  decision log, persistence, PEP, SDK, UI, config, release or deploy surface is introduced. See
  `planning/kernel-policy-batch-evaluator-p04c.json`.
- P04b2 `PolicyCandidateResolver` (`src/application/policy-candidate-resolver.mjs`,
  `tests/kernel-policy-candidate-resolver.test.mjs`): adds a pure, synchronous resolver that
  turns a frozen array of genuine `PolicyStatement` rows into the exact ordinary v2 candidate
  array (`{policyId, effect, applies, priority, layer}`) already accepted unchanged by
  `AuthorizationEvaluator` and `PolicyDecisionPoint`. `candidatesFor(request)` requires a genuine
  `PolicyRequest`; a lookalike built on the real prototype but missing its private state is
  refused with a `TypeError` before any of its own-property getters are ever invoked (proven
  against a hostile `action` getter). Matching grammar: `targetActor` is an ordinary object
  admitting only the optional `tenantId`/`actorId` string keys, compared via `.toString()` — any
  other key is a malformed selector and fails closed; `targetAction` and `targetResourceType`
  must equal the request's action name / resource type exactly; an empty `condition` object is
  unconditional, any non-empty condition is unsupported and fails closed (`applies=false`, never
  evaluated, never thrown); a disabled statement's candidate always carries `applies=false`
  regardless of every other axis. Resolving is deterministic, order-independent and mutates
  neither the supplied statements array, any `PolicyStatement`, nor the `PolicyRequest` passed
  in. `tests/repository-boundary.test.mjs`'s closed `src/application` module manifest is
  extended with `policy-candidate-resolver.mjs`. See
  `planning/kernel-policy-candidate-resolver-p04b2.json`.
  `capability_delta: POLICY_CANDIDATE_DERIVATION_ONLY`; every stronger readiness flag (including
  `runnableProduct`) stays `false`. Targeted GREEN only
  (`node --test tests/kernel-policy-candidate-resolver.test.mjs tests/repository-boundary.test.mjs`);
  `npm test`, `npm run check`, the required CI QA2 run and a fresh independent review are not yet
  recorded, so no readiness or release claim is made here.
- P04b1 `AuthorizationEvaluator` v2 candidate precedence (`src/application/authorization-evaluator.mjs`):
  `decide` now admits either the exact ordinary legacy `{policyId, effect, applies}` candidate
  shape or the exact ordinary v2 `{policyId, effect, applies, priority, layer}` shape (`priority`
  a safe integer, `layer` exactly `system`/`platform`/`tenant`), refusing every other shape, with
  duplicate `policyId` still refused across shapes. A legacy candidate normalizes internally only,
  to priority `0` and layer `tenant`, without mutating the caller or changing the public
  `PolicyDecision`. Applicable deny still overrides every applicable allow absolutely; the winner
  within the deciding effect is now priority descending, then layer `system` > `platform` >
  `tenant`, then canonical `policyId` ascending, order-independent. Default-deny, null
  `matchedPolicyId`, the fixed reason text, `traceId` identity, synchronous purity and no I/O are
  unchanged. Targeted GREEN only (`node --test tests/kernel-authorization-evaluator.test.mjs`);
  `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh independent review are not
  yet recorded, so no readiness or release claim is made here.
- P04a `PolicyStatement` immutable policy-as-data row (`src/application/policy-statement.mjs`,
  `tests/kernel-policy-statement.test.mjs`): adds the first serial P04 subpackage, one inert
  value carrying exactly the ten fields of a declarative policy row — `id`, `effect`,
  `targetActor`, `targetAction`, `targetResourceType`, `condition`, `priority`, `layer`,
  `version`, `enabled`. `effect` is exactly `allow`/`deny`; `layer` is exactly
  `system`/`platform`/`tenant`; `priority` is a safe integer; `enabled` is a primitive boolean;
  `version` is an exact SemVer 2.0.0 string retained verbatim; `id`/`targetAction`/
  `targetResourceType` are bounded canonical lowercase scalars. `targetActor` and `condition`
  are defensive, deterministic, deeply frozen JSON-data values that fail closed on cycles,
  shared references, holes, accessors, symbols, hostile keys, non-finite numbers and exotic
  prototypes. Deterministic `toJSON()`/`toString()`/`equals()`; zero imports; no clock, random,
  environment, filesystem or network effect. It is inert: no matcher, wildcard, condition
  evaluation, record set, candidate resolver, combining algorithm, batch, decision log,
  persistence or RLS is added, and the existing `Policy`, `PolicyRequest`, `PolicyDecision`,
  `AuthorizationEvaluator` and `PolicyDecisionPoint` are untouched.
  `tests/repository-boundary.test.mjs`'s closed `src/application` module manifest is extended
  with `policy-statement.mjs`. See `planning/kernel-policy-statement-p04a.json`.
  `capability_delta: IMMUTABLE_POLICY_AS_DATA_REPRESENTATION_ONLY`; every stronger readiness
  flag (including `runnableProduct`) stays `false`.
- P06 kernel persistence-ownership admission guard (`planning/kernel-persistence-ownership.json`,
  `tools/check-kernel-persistence-ownership.mjs`, `tests/kernel-persistence-ownership.test.mjs`):
  an additive, read-only, dependency-free build-time check, composed once into `npm run check`
  and exposed standalone as `npm run check:persistence-ownership`. It classifies this checkout's
  Alembic migrations and `src/adapters` files against a closed declaration: the runtime substrate
  (`mfk_context_key`, `transactional_outbox`, `audit_log`) is kernel-owned; `customer_records`
  (`0002_customer_records.py`, `src/adapters/postgres-commit-adapter.mjs`) is recorded as a
  current `transitional-in-kernel` fact with target owner `application` and retirement path
  P11-P14, never as already app-owned. Any undeclared migration, table, or adapter file denies;
  removing the transitional exception is admissible convergence; malformed, case-variant,
  traversal, absolute-path, or symlinked declarations deny; unsupported/ambiguous DDL shapes deny
  rather than being guessed at; and editing the manifest alone, without the matching real file
  content already present on disk, cannot self-authorize new persistence growth. It adds no
  runtime `src/application` port, no database/schema/adapter change, and no readiness movement;
  `capability_delta` is `NONE` and product remains not-runnable. Governance-only:
  `packageState: "writer-candidate-awaiting-external-gates"`; a full local/CI QA pass and an
  independent reviewer accept are recorded as pending external gates, not yet claimed here.
- P02 handler-free ActionContract IR (`src/application/action-contract.mjs`,
  `tests/kernel-action-contract.test.mjs`): adds one immutable declarative value describing an
  action's shape — exactly `kind` ("command" or "query"), the dotted-lowercase `name`, a safe
  integer `version` >= 1, and three caller-ordered identifier lists (`fields`, `outcomes`,
  `errorEnvelopeFields`). Each list admits only an ordinary dense array of unique, safe
  `[A-Za-z][A-Za-z0-9_]*` identifiers (1-64 characters); every entry is validated, cloned and
  deeply frozen with caller-declared order preserved rather than sorted, since order is part of
  the contract. The top-level options argument must be an ordinary `Object.prototype` object
  carrying exactly the six declared own enumerable data properties — a custom or null
  prototype, a symbol-keyed or non-enumerable member, or an accessor property (checked by
  descriptor, never invoked) is refused before any field is read. Construction refuses any
  unknown or missing top-level option, sparse holes, extra array properties, foreign array
  prototypes, accessor elements, symbol values, duplicate identifiers, and the unsafe
  identifiers `__proto__`, `constructor` and `prototype` in any of the three lists. `toJSON()`/
  `toString()` render the fixed key order deterministically;
  `equals()` is exact-class and structural. The module is framework-free, capability-free, and
  imports nothing — Command and Query in `src/application/action-primitives.mjs` remain the
  sole effect boundary and are untouched. It describes an action; it renders no code and
  executes no handler. `tests/repository-boundary.test.mjs`'s closed `src/application` module
  manifest is extended with `action-contract.mjs`. See
  `planning/kernel-action-contract-ir-p02.json`. `capability_delta:
  PUBLIC_ACTION_CONTRACT_IR_ONLY`; every stronger readiness flag (including `runnableProduct`)
  stays `false`.
- P01 current-truth + roadmap v1 (`planning/roadmap-v1-current-truth.json`, `ROADMAP.md`,
  `tests/kernel-roadmap-v1-current-truth.test.mjs`): adds the sole machine-readable owner of
  Roadmap v1 state — source classes, current implemented/not-implemented truth with every
  stronger readiness flag `false`, the fixed 25-package denominator across 8 delivery
  phases/families F0–F7 (P01–P25), the approved dependency DAG, a 3-lane writer cap with
  shared locks, per-phase Definitions of Done, and owner-facing
  `once`/`simdi`/`fark`/`kullaniciYolculugu`/`kalanEngel` fields with `capability_delta: NONE`.
  `ROADMAP.md` is its concise human projection; `README.md` gains a pointer to both.
- GJ-01 V15M host-runner CLI boundary (`host/python_asgi/create_customer_host_cli.py`,
  `tests/kernel-python-host-runner-cli.test.mjs`): adds the smallest explicit Python CLI/argv
  boundary over the existing V15L `run_create_customer_host` selector. The new module exposes
  `parse_create_customer_host_args(argv)` and `main(argv=None)`, which require an explicit
  `--runner uvicorn|hypercorn` choice and an explicit `--` separator before the application-side
  JS command, then dispatch `command` plus safe options (`--host`, `--port`,
  `--max-body-bytes`, `--log-level`) to the unchanged `run_create_customer_host` selector. The
  CLI module imports neither `uvicorn`, `hypercorn`, `fastapi`, nor `django` directly — it only
  imports `run_create_customer_host` from the sibling selector module. There is no default
  runner: a missing `--runner`, an unknown `--runner` value, a missing `--` separator, or an
  empty command after `--` all fail closed via `argparse`/`SystemExit` before any dispatch.
  Tests prove the no-import-side-effect behavior, that the module contains no direct
  `uvicorn`/`hypercorn`/`fastapi`/`django` import, that each `--runner` value dispatches to the
  selector with `command` and the parsed safe options, and that every fail-closed path raises
  before dispatch. See `planning/gj01-v15m-host-runner-cli-boundary.json`.
- GJ-01 V15L explicit host-runner selector (`host/python_asgi/create_customer_host_runner.py`,
  `tests/kernel-python-host-runner-selector.test.mjs`): adds the smallest explicit selection
  boundary over the existing V15J Uvicorn and V15K Hypercorn runners. The new module exposes
  `run_create_customer_host(command, runner="uvicorn", **kwargs)`, which requires an explicit
  `runner="uvicorn"` or `runner="hypercorn"` choice and dispatches `command`/`kwargs` to the
  matching sibling runner (`run_create_customer_uvicorn` or `run_create_customer_hypercorn`)
  unchanged. The selector module imports neither `uvicorn` nor `hypercorn` directly — it only
  imports the two sibling runner functions, which keep their own lazy package imports — so
  importing the selector has no host-package requirement and no side effect. An unknown
  `runner` value fails closed with a `ValueError` listing the allowed values. Tests prove the
  no-import-side-effect behavior, that the module contains no direct `uvicorn`/`hypercorn`
  import, that each `runner` value dispatches to its matching sibling with `command` and
  `kwargs` intact and never calls the other sibling, and that an unknown value fails closed (no
  real listener is ever opened). This adds an explicit launch-selection boundary only, not app
  or production readiness: no default framework base is selected and the Kernel remains
  framework-independent. Adds no server to product code, touches no `src/**` or `host/js_asgi`
  file, imports no FastAPI/Django/Uvicorn/Hypercorn, reads no env, and keeps every stronger
  readiness flag (`kernelReady`, `oneGoldenSliceReady`, `walkingSkeletonReady`, `appBuildable`,
  `releaseAllowed`, `deployAllowed`, `productionAllowed`, `runnableProduct`, `gapClosed`) false.

- GJ-01 V15K Hypercorn host-runner boundary (`host/python_asgi/create_customer_hypercorn_runner.py`,
  `tests/kernel-python-host-hypercorn-runner.test.mjs`): adds the smallest optional Hypercorn
  host-runner boundary around the existing, unchanged `host/python_asgi/create_customer_app.py`
  factory, analogous to the existing V15J Uvicorn runner. The new module exposes
  `run_create_customer_hypercorn(command, host, port, max_body_bytes, log_level)`, which builds
  the ASGI app via `create_customer_app` and calls `hypercorn.asyncio.serve(app, Config())` via
  `asyncio.run` only when the function is explicitly invoked. Hypercorn is imported lazily inside
  the function only, so importing the module has no Hypercorn dependency and no side effect; if
  Hypercorn is absent, the function fails closed with a wrapped `RuntimeError` and performs no
  fallback host. Tests prove the no-import-side-effect and fail-closed behavior, capture the
  injected `serve` call's app/bind/loglevel arguments via a fake injected `hypercorn` module (no
  real listener is ever opened), and confirm command/`max_body_bytes` validation still originates
  from `create_customer_app`. This adds an optional launch boundary only, not app or production
  readiness: Hypercorn is selected here only as the second optional ASGI host runner, the Kernel
  remains framework-independent, and Uvicorn remains a separate, compatible candidate — imported
  nowhere in this package. Adds no server to product code, touches no `src/**` or `host/js_asgi`
  file, imports no FastAPI/Django/Uvicorn, reads no env, and keeps every stronger readiness flag
  (including `runnableProduct`) `false`. See `planning/gj01-v15k-hypercorn-host-runner.json` and
  prerequisite `planning/gj01-v15j-uvicorn-host-runner.json`.
- GJ-01 V15J Uvicorn host-runner boundary (`host/python_asgi/create_customer_uvicorn_runner.py`,
  `tests/kernel-python-host-uvicorn-runner.test.mjs`): adds the smallest optional Uvicorn
  host-runner boundary around the existing, unchanged `host/python_asgi/create_customer_app.py`
  factory. The new module exposes `run_create_customer_uvicorn(command, host, port,
  max_body_bytes, log_level, lifespan)`, which builds the ASGI app via `create_customer_app` and
  calls `uvicorn.run` only when the function is explicitly invoked. Uvicorn is imported lazily
  inside the function only, so importing the module has no Uvicorn dependency and no side effect;
  if Uvicorn is absent, the function fails closed with a wrapped `RuntimeError` and performs no
  fallback host. Tests prove the no-import-side-effect and fail-closed behavior, capture
  `uvicorn.run` arguments via a fake injected `uvicorn` module (no real listener is ever opened),
  and confirm command/`max_body_bytes` validation still originates from `create_customer_app`.
  This adds an optional launch boundary only, not app or production readiness: Uvicorn is
  selected here only as the first optional ASGI host runner, the Kernel remains
  framework-independent, and Hypercorn remains a separate, compatible candidate — imported
  nowhere in this package. Adds no server to product code, touches no `src/**` or `host/js_asgi`
  file, imports no FastAPI/Django/Hypercorn, reads no env, and keeps every stronger readiness
  flag (including `runnableProduct`) `false`. See `planning/gj01-v15j-uvicorn-host-runner.json`
  and prerequisite `planning/gj01-v15g-python-host-app-factory.json`.
- GJ-01 V15I Hypercorn availability smoke (`tests/kernel-python-host-hypercorn-availability-smoke.test.mjs`):
  a bounded evidence test proving the existing, unchanged V15G `host/python_asgi/create_customer_app.py`
  ASGI callable can be bound into Hypercorn's own programmatic `Config` object (`config.app = app`) when
  Hypercorn is present in the running environment, and a direct ASGI call through the real JS runner still
  returns a `403` DENY response. No Hypercorn serve entrypoint is ever called and no real listener is
  opened. If Hypercorn is unavailable in the environment, the test asserts the planning-recorded
  `"hypercorn-unavailable"` evidence instead of any runnable claim. Adds no server to product code, touches
  no `src/**`, `host/python_asgi`, or `host/js_asgi` file, imports no Uvicorn/FastAPI/Django, reads no env,
  and does not select Hypercorn as the development base; keeps every stronger readiness flag (including
  `runnableProduct`) `false`. Complementary to `planning/gj01-v15h-uvicorn-programmatic-smoke.json`;
  references `planning/gj01-v15g-python-host-app-factory.json` as its prerequisite. See
  `planning/gj01-v15i-hypercorn-availability-smoke.json` and
  `tests/kernel-python-host-hypercorn-availability-smoke.test.mjs`.
- GJ-01 V15H Uvicorn programmatic smoke (`tests/kernel-python-host-uvicorn-programmatic-smoke.test.mjs`):
  a bounded evidence test proving the existing, unchanged V15G `host/python_asgi/create_customer_app.py`
  ASGI callable can be accepted by Uvicorn programmatically when Uvicorn is present in the running
  environment: `uvicorn.Config(app=create_customer_app(...), host=<loopback address>, port=0, lifespan="off",
  log_level="critical")` and `uvicorn.Server(config)` accept the callable unchanged, and a direct ASGI
  call through the real JS runner still returns a `403` DENY response. No `uvicorn.Server.serve()` is
  called and no real listener is opened. If Uvicorn is unavailable in the environment, the test asserts
  the planning-recorded `"uvicorn-unavailable"` evidence instead of any runnable claim. Adds no server to
  product code, touches no `src/**`, `host/python_asgi`, or `host/js_asgi` file, imports no Hypercorn/
  FastAPI/Django, reads no env, and does not select Uvicorn as the development base; keeps every
  stronger readiness flag (including `runnableProduct`) `false`. References
  `planning/gj01-v15g-python-host-app-factory.json` as its prerequisite. See
  `planning/gj01-v15h-uvicorn-programmatic-smoke.json` and
  `tests/kernel-python-host-uvicorn-programmatic-smoke.test.mjs`.
- GJ-01 V15G Python host app factory (`host/python_asgi/create_customer_app.py`): a
  standard-library-only `create_customer_app(command, max_body_bytes=None)` factory that
  validates `command` is an explicit non-empty sequence of strings (rejects `None`, a bare
  string/bytes, an empty sequence, and any non-string element) and that `max_body_bytes` is
  `None` or a non-negative int, then returns `StdioJsAsgiBridge(command, max_body_bytes=
  max_body_bytes)` unchanged from V15D as a callable ASGI app. `host/python_asgi/__init__.py`
  is unchanged; callers import `create_customer_app` directly from
  `host/python_asgi/create_customer_app.py`. Selects no host server, imports no Uvicorn/Hypercorn/
  FastAPI/Django, reads no env, touches no `src/**`, no JS runner file, and no dependency/
  lockfile/CI/config/pyproject/uv.lock file; keeps every stronger readiness flag (including
  `runnableProduct`) `false`. References `planning/gj01-v15f-python-bridge-real-pg-allow.json`
  as its prerequisite. See `planning/gj01-v15g-python-host-app-factory.json` and
  `tests/kernel-python-host-app-factory.test.mjs`.
- GJ-01 V15F real PostgreSQL ALLOW smoke through the Python bridge
  (`host/js_asgi/create_customer_asgi_runner.mjs` extended): the same runner V15E added now
  accepts explicit CLI args, `--policy deny|allow` (default `deny`, identical to V15E's
  never-connected behavior) and `--connection-string <postgres-url>` (required only with
  `--policy allow`, read only from the CLI arg, never from `process.env`). In `allow` mode the
  runner injects a deterministic ALLOW policy candidate and constructs the composition with the
  real connection string, proving V15D's unchanged `StdioJsAsgiBridge` can drive an
  ALLOW+invariants-ok `POST /customers` request through the real JS Kernel
  `createCustomerAsgiComposition.app` boundary to a real PostgreSQL 16 commit: a `201` response
  carrying a `CommitReceipt` with all four committed intents (`audit`, `customer`, `idempotency`,
  `transactionalOutbox`), rows verified directly in `customer_records`, `audit_log`, and
  `transactional_outbox`, and a duplicate identical request returning a deterministic `409
  IDEMPOTENCY_CONFLICT` with no second row. Malformed CLI args (unrecognized flag, missing flag
  value, invalid `--policy` value, or `--policy allow` without `--connection-string`) exit
  non-zero with deterministic stderr before the composition is constructed. Sets
  `realPostgresThroughPythonBridge: true`, `hostSelected: false`, `smokePath:
  "ALLOW_REAL_POSTGRES"`, references `planning/gj01-v15e-real-js-boundary-runner-deny.json` as its
  prerequisite, touches no `src/**`, no Python bridge code, no dependency/lockfile/CI/config/
  pyproject/uv.lock file, and keeps every stronger readiness flag (including `runnableProduct`)
  `false`. See `planning/gj01-v15f-python-bridge-real-pg-allow.json` and
  `tests/kernel-python-host-bridge-real-pg-allow.test.mjs`.
- GJ-01 V15E real JS boundary runner DENY smoke (`host/js_asgi/create_customer_asgi_runner.mjs`):
  the smallest Node standard-library-only command that lets V15D's `StdioJsAsgiBridge` delegate
  to the real JS Kernel `createCustomerAsgiComposition.app` boundary. It reads one `{ scope,
  bodyBase64 }` JSON envelope from stdin, replays it through the real composition's
  `app(scope, receive, send)`, and writes the resulting ASGI response events back to stdout as
  `bodyBase64`/`headersBase64` fields V15D's bridge decodes. It always injects a deterministic
  DENY policy candidate, so no database connection is ever touched (`connectionString` is a
  never-connected placeholder, safe only because DENY short-circuits before any commit). A
  malformed envelope or non-base64 body exits non-zero with deterministic stderr before the
  composition is constructed, which V15D's bridge maps to its existing `502 subprocess_failed`
  error. Sets `realJsBoundaryRunner: true`, `hostSelected: false`, `smokePath: "DENY_NO_DB"`,
  references `planning/gj01-v15d-python-host-bridge-envelope.json` as its prerequisite, touches no
  `src/**`, no Python bridge code, no dependency/lockfile/CI/config/pyproject/uv.lock file, and
  keeps every stronger readiness flag (including `runnableProduct`) `false`. See
  `planning/gj01-v15e-real-js-boundary-runner-deny.json` and
  `tests/kernel-python-host-bridge-real-js-runner.test.mjs`.
- GJ-01 V15D Python host bridge envelope primitive
  (`host/python_asgi/metaframer_kernel_host_bridge.py`, `host/python_asgi/__init__.py`): the
  smallest standard-library-only implementation of the interop mechanism V15C left unselected.
  `StdioJsAsgiBridge(command, max_body_bytes=None)` is an ASGI-callable `(scope, receive, send)`
  object that collects `http.request` body chunks until `more_body` is false or missing
  (rejecting a present non-bool `more_body` deterministically before any subprocess call),
  optionally rejects an over-limit body against `max_body_bytes` before subprocess invocation,
  serializes scope and base64-encoded body into a JSON envelope written to an injected
  subprocess command's stdin, decodes the JSON list of ASGI response events the command writes
  to stdout (base64 body/header fields converted back to bytes), and replays them through
  `send`. Subprocess non-zero exit and malformed stdout JSON both map to a deterministic
  `502 subprocess_failed` error response. The command is caller-injected (no hardcoded node
  path, no environment read), so a later package can point it at the real JS Kernel runner; this
  package tests only against a temporary JS fixture command. It selects
  `interopMechanism: "subprocess-stdio-envelope"`, sets `bridgeInThisPackage: true` and
  `hostSelected: false`, references `planning/gj01-v15c-python-host-bridge-contract.json` as its
  prerequisite, touches no `src/**`, no dependency/lockfile/CI/config/pyproject/uv.lock file, and
  keeps every stronger readiness flag (including `runnableProduct`) `false`. See
  `planning/gj01-v15d-python-host-bridge-envelope.json` and
  `tests/kernel-python-host-bridge-envelope.test.mjs`.
- GJ-01 V15C Python host bridge contract (`planning/gj01-v15c-python-host-bridge-contract.json`):
  a contract-only planning package that pins the interface, ownership, non-goals, risks, and a
  finite acceptance list for a future Python host bridge/shim, without implementing it. It
  requires the future bridge to be an application-owned delivery adapter (not Kernel domain or
  application core) that exposes a Python ASGI `(scope, receive, send)` callable to Uvicorn or
  Hypercorn while delegating to the existing JS Kernel ASGI boundary
  (`src/delivery/create-customer-asgi-composition.mjs`) through a small, explicit, reversible
  interop mechanism selected in a later implementation package, preserving tenant/PDP/invariant/
  idempotency/CommitReceipt behavior as externally observable response evidence. It explicitly
  references `planning/gj01-v15b-asgi-host-boundary-truth.json` as its prerequisite, since V15B
  established that direct Uvicorn/Hypercorn hosting needs this still-unimplemented bridge. This
  package sets `bridgeInThisPackage: false` and `hostSelected: false`, touches no `src/**`, no
  Python file, no dependency, and no CI/config, and every stronger readiness flag
  (`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed`, `runnableProduct`) stays `false`. See
  `tests/kernel-python-host-bridge-contract.test.mjs`.
- GJ-01 V15A one-golden-slice step closure (`planning/gj01-v15a-one-golden-slice-step-closure.json`):
  a package-local, evidence-only closure record proving step 4 (`one-golden-slice`) of the pinned
  runtime-start sequence in `planning/kernel-runtime-pilot-consumer-sync.json` is closed for
  CreateCustomer@1, by composing five already-GREEN upstream evidence records (the generated-sdk
  step closure, the atomic four-intent customer commit receipt, the framework-neutral composition
  root, the ASGI composition body-limit conformance package, and the ASGI receive `more_body`
  conformance package) together with the Docker-backed real PostgreSQL 16 test
  `createCustomerAsgiComposition.app carries an ALLOW+invariants-ok POST /customers request to a
  real PostgreSQL 16 commit` in `tests/kernel-create-customer-asgi-composition.test.mjs`. This
  package writes no production code, edits none of the composed evidence, and every stronger
  readiness flag (`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed`, `oneGoldenSliceReady`, `runnableProduct`) stays `false`. See
  `tests/kernel-one-golden-slice-step-closure.test.mjs`.
- GJ-01 V14Y ASGI receive `more_body` conformance (`planning/gj01-v14y-asgi-receive-more-body-conformance.json`):
  `AsgiCoreProfileAdapter.callFromReceive` in `src/delivery/asgi-core-profile.mjs` now validates
  the `more_body` property on each `http.request` receive event: if present, it must be the
  boolean `true` or `false`; a present non-boolean value (e.g. `"yes"`, `1`, `null`, `{}`, `[]`)
  short-circuits to the existing deterministic 400 profile response via `sendErrorEvents` without
  calling the router. An omitted `more_body` is still treated as the final chunk, `false` is the
  final chunk, and `true` continues to the next receive as before.
- GJ-01 V14X evidence parity correction (`planning/gj01-v14w-asgi-composition-body-limit.json`):
  updated V14W's planning record so its red/green targeted-evidence commands and results match
  the final merged test names and count -- the four-required-plus-known-optional-key test, the
  valid `maxBodyBytes: 0` acceptance test, the invalid-`maxBodyBytes`-rejection test, the frozen
  `app` test, the empty-body test, the over-limit test, and the exact-boundary test -- 7/7 GREEN,
  replacing the earlier 5/5 targeted-evidence text written before that final naming/wording
  correction. No source or test changed; this is a planning-record-only correction.
- GJ-01 V14W ASGI composition body limit (`planning/gj01-v14w-asgi-composition-body-limit.json`):
  `createCustomerAsgiComposition` in `src/delivery/create-customer-asgi-composition.mjs` now
  accepts an optional `maxBodyBytes` option alongside its existing four required options. When
  provided, it must be a non-negative safe integer, otherwise the composition factory throws
  `TypeError` before `app`/`asgi`/`router`/`close` are ever constructed. When provided, `app`
  passes `maxBodyBytes` through to the underlying `AsgiCoreProfileAdapter.callFromReceive`
  (GJ-01 V14V): an over-limit request now returns the existing deterministic 400 profile response
  without reaching the `createCustomerComposition` commit path, and an exact-boundary body still
  dispatches through the normal route path unchanged. When `maxBodyBytes` is omitted, `app`'s
  behavior is unchanged. This is a framework-neutral option only: no server/host/framework is
  selected or imported.
- GJ-01 V14V ASGI receive body byte limit (`planning/gj01-v14v-asgi-receive-body-limit.json`):
  `AsgiCoreProfileAdapter.callFromReceive` in `src/delivery/asgi-core-profile.mjs` now accepts an
  optional `maxBodyBytes` option. When provided, it must be a non-negative safe integer, otherwise
  `callFromReceive` throws `TypeError` before `receive` or the router are ever invoked. While
  collecting `http.request` chunks, a running cumulative-byte count is checked after each chunk;
  once it exceeds `maxBodyBytes`, `callFromReceive` returns the existing deterministic 400 profile
  response via `sendErrorEvents` without calling the router. A body whose cumulative bytes exactly
  equal `maxBodyBytes` still dispatches normally. When `maxBodyBytes` is omitted, behavior is
  unchanged. This is a framework-neutral option only: no server/host/framework is selected or
  imported, and `createCustomerAsgiComposition`'s default body-limit behavior is unchanged.
- GJ-01 V14U ASGI callable immutability (`planning/gj01-v14u-asgi-callable-immutability.json`):
  `createCustomerAsgiComposition` in `src/delivery/create-customer-asgi-composition.mjs` now
  freezes the `app` ASGI callable function itself, immediately before constructing the frozen
  `{ asgi, router, app, close }` object it returns. Previously the outer composition object and
  the `asgi`/`router` instances were frozen, but `app` was an ordinary mutable function: a caller
  could assign own properties onto it, redefine its properties, or change its prototype.
  `composition.app` is now itself frozen, carries no own enumerable keys, and rejects an
  own-property assignment, `Object.defineProperty`, or `Object.setPrototypeOf` with `TypeError`.
  Callable behavior is unchanged. Not a server/host selection.
- GJ-01 V14T ASGI response header value conformance (`planning/gj01-v14t-asgi-response-header-value-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response header value that is not a printable-ASCII string, throwing a `TypeError` before
  `toResponseEvents()` builds any outgoing ASGI response event, so a malformed value (CR, LF,
  CRLF, other control characters, or a non-string such as a number, `null`, or a `Uint8Array`) is
  never sent from `handle()` or `call()`/`callFromReceive()`. Previously `toResponseEvents()`
  coerced every header value with `String(...)`, so an unsafe value such as
  `"v\r\nSet-Cookie: evil=1"` was silently emitted onto the `http.response.start` event. Valid
  printable ASCII string values, including the empty string and the boundary characters space and
  `~`, keep their existing behavior and deterministic sorted output. Not a server/host selection.
- GJ-01 V14S ASGI response status conformance (`planning/gj01-v14s-asgi-response-status-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response status that is not an integer in the inclusive ASGI/HTTP range 100..599, throwing a
  `TypeError` before `toResponseEvents()` builds any outgoing ASGI response event, so a malformed
  status is never sent from `handle()` or `call()`/`callFromReceive()`. Previously any status that
  passed `typeof status === "number"` was accepted, so a non-integer such as `200.5`, `NaN`, or
  `Infinity`, or an out-of-range integer such as `99`, `0`, `-1`, or `600`, was silently emitted
  onto the `http.response.start` event. Valid statuses, including the boundaries `100`, `204`, and
  `599`, keep their existing behavior. Not a server/host selection.
- GJ-01 V14R ASGI response header name conformance (`planning/gj01-v14r-asgi-response-header-name-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response header name that is empty, upper-case, whitespace-bearing, colon-bearing, or
  control-character-bearing, throwing a `TypeError` before `toResponseEvents()` builds any
  outgoing ASGI response event, so a malformed name is never sent from `handle()` or `call()`.
  Previously any router response header key, however malformed, was silently lower-cased,
  sorted, and placed into the `http.response.start` event. Valid lower-case HTTP token header
  names keep their existing sorted, deterministic behavior. Not a server/host selection.
- GJ-01 V14Q ASGI header name token conformance (`planning/gj01-v14q-asgi-header-name-token-conformance.json`):
  `decodeHeaders()` in `src/delivery/asgi-core-profile.mjs` now rejects a decoded header name that
  is empty, upper-case, whitespace-bearing, colon-bearing, or control-character-bearing, returning
  the profile boundary's existing frozen 400 `PROFILE_SCOPE_INVALID` response before
  `StandardRouter` or `receive()` ever run; `callFromReceive()` checks header names before entering
  its `receive()` loop, matching the existing before-`receive()` placement for scope shape and
  method token. Previously any decoded header name, however malformed, was silently lower-cased
  and inserted into the header map. Valid lower-case HTTP token header names are unaffected. Not a
  server/host selection.
- GJ-01 V14P ASGI HTTP method token conformance (`planning/gj01-v14p-asgi-method-token-conformance.json`):
  `isValidScope()` in `src/delivery/asgi-core-profile.mjs` now rejects a `method` that is not a
  well-formed upper-case HTTP token, throwing the profile boundary's existing frozen 400
  `PROFILE_SCOPE_INVALID` response before `StandardRouter` or `receive()` ever run. Previously a
  lower-case (`post`), whitespace-bearing (`GE T`), or control-character-bearing (`GET\n`) method
  passed the non-empty-string check and reached `StandardRouter`, returning as an ordinary
  404/405 router response instead of the profile boundary's 400. Valid upper-case methods such as
  `GET`/`POST`/`OPTIONS` are unaffected. Not a server/host selection.
- GJ-01 V14O ASGI encoder return conformance (`planning/gj01-v14o-asgi-encoder-return-conformance.json`):
  `encodeEvents()` in `src/delivery/asgi-core-profile.mjs` now requires each value returned by a
  caller-provided `encodeResponseBody`/`encodeResponseHeader` to be a `Uint8Array`, throwing a
  `TypeError` before the encoded event is built or `send()` is ever called. Previously a returned
  string or object was placed directly into the outgoing `http.response.start`/`http.response.body`
  event, letting a misbehaving encoder send a malformed host-facing event. An encoder that throws
  still propagates its own error unchanged, and the internal unencoded profile path (no encoder
  provided) is unchanged. Not a server/host selection.
- GJ-01 V14N ASGI scope structural conformance (`planning/gj01-v14n-asgi-scope-conformance.json`):
  `isValidScope()` in `src/delivery/asgi-core-profile.mjs` now rejects an empty `method`, an empty
  `path`, and a `path` without a leading `/` at the profile boundary, before `StandardRouter` or
  `receive()` ever run. Previously these shapes passed the structural check and reached
  `StandardRouter`, producing an ordinary 404/405 instead of the frozen 400 `PROFILE_SCOPE_INVALID`
  profile response every other malformed-scope shape already gets. Valid-scope routing, response
  encoding, and `query_string`-ignored behavior are unchanged. Not a server/host selection.
- GJ-01 V14M ASGI event conformance hardening (`planning/gj01-v14m-asgi-event-conformance.json`):
  `profileErrorEvents()` in `src/delivery/asgi-core-profile.mjs` now freezes its inner
  `["content-type", "application/json"]` header pair tuple, matching the per-pair freezing the
  success response path already applied. The 400 `PROFILE_SCOPE_INVALID` profile-error event tree
  is now as deeply immutable as a success event tree across all layers (events array, event
  objects, headers array, and each header pair). No status code, error code, header value or event
  shape changed. Not a server/host selection.
- GJ-01 V14L idempotency-conflict delivery mapping (`planning/gj01-v14l-idempotency-retry-envelope.json`):
  `PostgresCommitAdapter.commit` now catches the one known duplicate tenant-scoped idempotency
  conflict — a PostgreSQL `23505` unique violation on `transactional_outbox_tenant_dedup_key` —
  and throws a new frozen `IdempotencyConflictError` (`code: "IDEMPOTENCY_CONFLICT"`,
  `retryable: false`, `tenantId`, `fingerprint`) instead of leaking the raw pg error; every other
  database failure still propagates unchanged. `CreateCustomerRequestHandler.handle` now wraps its
  call to the commit service and duck-types that one error shape (never importing the Postgres
  adapter, preserving the handler's existing framework-free/Postgres-free-import contract), mapping
  it to a frozen `409` response with `body.error.code: "IDEMPOTENCY_CONFLICT"`, `retryable: false`
  and the original request's `requestId` preserved; any other thrown error still rejects
  `handle()` unmasked. A real-PostgreSQL Docker-backed test in
  `tests/kernel-create-customer-asgi-composition.test.mjs` now issues the same `POST /customers`
  request twice through the full ASGI callable and proves the second request returns 409 with no
  second `customer_records`/`audit_log`/`transactional_outbox` row; `tests/postgres-commit-adapter.test.mjs`
  proves the adapter's exact error shape and exports it; `tests/kernel-create-customer-request-handler.test.mjs`
  proves the handler's 409 mapping and that a non-matching error still propagates unmasked.
- GJ-01 V14K evidence package (`planning/gj01-v14k-asgi-postgres-slice.json`): a new Docker-backed
  test in `tests/kernel-create-customer-asgi-composition.test.mjs` proves the existing
  framework-neutral `createCustomerAsgiComposition.app(scope, receive, send)` callable, given an
  ALLOW policy candidate and an invariants-ok evaluation, carries a POST `/customers` request all
  the way to a real PostgreSQL 16 commit: a 201 `http.response.start`, a body decoding to a frozen
  `CommitReceipt` with all four intents (customer, audit, transactionalOutbox, idempotency)
  committed and none deferred, and matching rows actually persisted in `customer_records`,
  `audit_log` and `transactional_outbox` for the same tenant. Three new DB-connectionless tests in
  `tests/postgres-commit-adapter.test.mjs` cover the adapter fix below: a null-prototype
  `customer.payload` with a non-empty name passes shape checks (proved via a
  reachable-but-refusing connection string, so the resulting rejection is a connection failure,
  not the payload-shape check); a payload with no `name` is still refused whether ordinary or
  null-prototype; and an array/class-instance/function payload is still refused. No schema,
  migration or dependency changes; no server, framework or host adapter is introduced.
- Optional `encodeResponseHeader` parameter on `AsgiCoreProfileAdapter#call` and
  `#callFromReceive` in `src/delivery/asgi-core-profile.mjs`: when supplied (and validated as a
  function), it encodes every `http.response.start` header name and value before send/return,
  including the deterministic 400 profile events raised on invalid scope, a malformed receive
  event, or a `decodeBody` failure; an encoder throw propagates rather than being caught, and
  `send` is not called after a header-encoder failure. Omitting `encodeResponseHeader` leaves
  existing `call`/`callFromReceive`/`handle` behavior — including the internal string header-pair
  shape — unchanged. `createCustomerAsgiComposition.app` in
  `src/delivery/create-customer-asgi-composition.mjs` now also passes a default UTF-8 response
  header encoder alongside the existing JSON request decoder and JSON response body encoder, so a
  host adapter calling `app(scope, receive, send)` receives `Uint8Array` header name/value pairs
  in addition to `Uint8Array` body chunks. Neither module adds a server, framework, network or
  Python ASGI dependency. `tests/kernel-asgi-core-profile.test.mjs` and
  `tests/kernel-create-customer-asgi-composition.test.mjs` add targeted coverage for the
  no-encoder default, encoder success/error-path application, and encoder-throw propagation. See
  `planning/gj01-v14j-asgi-header-bytes.json`.
- Optional `encodeResponseBody` parameter on `AsgiCoreProfileAdapter#call` and `#callFromReceive`
  in `src/delivery/asgi-core-profile.mjs`: when supplied (and validated as a function), it encodes
  every `http.response.body` event's body before send/return, including the deterministic 400
  profile events raised on invalid scope, a malformed receive event, or a `decodeBody` failure; an
  encoder throw propagates rather than being caught. Omitting `encodeResponseBody` leaves existing
  `call`/`callFromReceive`/`handle` behavior — including the internal JS-object response body
  shape — unchanged. `createCustomerAsgiComposition.app` in
  `src/delivery/create-customer-asgi-composition.mjs` now passes a default JSON response encoder
  (`JSON.stringify` + UTF-8 bytes) alongside the existing JSON request decoder, so a host adapter
  calling `app(scope, receive, send)` receives `Uint8Array` response body chunks. Neither module
  adds a server, framework, network or Python ASGI dependency.
  `tests/kernel-asgi-core-profile.test.mjs` and `tests/kernel-create-customer-asgi-composition.test.mjs`
  add targeted coverage for the no-encoder default, encoder success/error-path application, and
  encoder-throw propagation. See `planning/gj01-v14i-asgi-response-bytes.json`.
- `app(scope, receive, send)` on the frozen object returned by `createCustomerAsgiComposition` in
  `src/delivery/create-customer-asgi-composition.mjs` — the smallest framework-neutral ASGI
  callable entrypoint, so a host adapter (Uvicorn, Hypercorn, ...) can call one async function
  with `(scope, receive, send)` without this module selecting or importing any server/framework.
  `app` delegates to `asgi.callFromReceive({ scope, receive, send, decodeBody })` with a default
  JSON body decoder: empty bytes decode to `{}` (the existing accepted empty-body shape used by
  `CreateCustomerHttpMessageAdapter`); non-empty bytes decode as UTF-8 JSON to an ordinary object,
  and invalid JSON (or a non-ordinary-object result) throws inside `decodeBody`, which
  `callFromReceive` turns into the existing deterministic 400 profile response without ever
  calling the router or application pipeline. The returned object is now frozen
  `{ asgi, router, app, close }`; `asgi`, `router` and `close` behavior are unchanged. It is not a
  Python ASGI app and adds no Uvicorn, Hypercorn, FastAPI or Django dependency.
  `tests/kernel-create-customer-asgi-composition.test.mjs` adds targeted coverage for the
  frozen `{ asgi, router, app, close }` shape; `app` delivering a decoded JSON body all the way to
  the application pipeline's invariant stage (an allow policy decision, `evaluateInvariants`
  asserting `command.payload.name`, and an `ok: false` answer closing the outcome as
  `INVALID`/400 `INVARIANT_VIOLATION` before the Postgres commit path, proving the decoded body
  reaches the pipeline rather than stopping at a policy deny); the empty-body case; and invalid
  JSON short-circuiting to the 400 profile response without touching the pipeline. See
  `planning/gj01-v14h-asgi-callable-composition.json`.
- `AsgiCoreProfileAdapter#callFromReceive({ scope, receive, send, decodeBody })` in
  `src/delivery/asgi-core-profile.mjs`, a framework-neutral receive-driven ASGI profile method
  that lets a host supply `receive()`/`send()` functions: it validates both are functions before
  any router call, awaits `http.request` events from `receive` in order, concatenates their
  `body` byte chunks until `more_body` is not `true`, optionally passes the merged bytes through
  a caller-supplied deterministic `decodeBody` function, and then dispatches through the existing
  `call` method unchanged. An invalid scope, a malformed/non-`http.request` receive event, a
  non-`Uint8Array` chunk, or a `decodeBody` failure each short-circuit deterministically to the
  existing frozen 400 profile events without ever calling the router. It adds no server,
  framework, network or Python ASGI dependency. `tests/kernel-asgi-core-profile.test.mjs` adds
  targeted coverage for multi-chunk body collection, invalid `receive`/`send`/`decodeBody`
  short-circuiting, malformed receive event responses, receive rejection propagation, `decodeBody`
  success and failure paths, and confirms existing `call`/`handle` behavior is unchanged.
- `createCustomerAsgiComposition(options)` in `src/delivery/create-customer-asgi-composition.mjs`,
  a framework-neutral composition root that wires a real `createCustomerComposition` handler to a
  real `CreateCustomerHttpMessageAdapter`, a real `StandardRouter` (its only route: `POST
  /customers`) and a real `AsgiCoreProfileAdapter`. It accepts exactly the same four keys as
  `createCustomerComposition` (`connectionString`, `current`, `candidatesFor`,
  `evaluateInvariants`) and returns a frozen `{ asgi, router, close }` object; `close` delegates to
  the composed `PostgresCommitAdapter` close. It is not an HTTP server and adds no Python ASGI app,
  Uvicorn, Hypercorn, FastAPI or Django dependency.
  `tests/kernel-create-customer-asgi-composition.test.mjs` proves the four-key options exactness,
  the frozen `{ asgi, router, close }` shape, a DENY outcome traversing `POST /customers` through
  `asgi.call` without ever touching the database, wrong-method/wrong-path short-circuiting before
  the handler runs, `close` delegation, and the absence of any forbidden import.
  `tests/repository-boundary.test.mjs`'s `src/delivery` module manifest is extended with
  `create-customer-asgi-composition.mjs`. See
  `planning/gj01-v14f-create-customer-asgi-composition.json`.
- `AsgiCoreProfileAdapter#call({ scope, body, send })` in `src/delivery/asgi-core-profile.mjs`,
  a framework-neutral ASGI send/call boundary around the existing `handle` method. It requires
  `send` to be a function (throws `TypeError` otherwise, without calling the router), computes
  the response events via the unchanged `handle({ scope, body })`, then `await`s `send` once
  per event in order (`http.response.start` then `http.response.body`), returning the same
  frozen event array `handle` would have returned. A rejecting `send` propagates and stops
  further sends. It is not an HTTP server and adds no Python ASGI app, Uvicorn, Hypercorn,
  FastAPI or Django dependency. `tests/kernel-asgi-core-profile.test.mjs` proves the
  non-function `send` rejection, in-order awaited dispatch with events equal to `handle`'s
  output, and propagation of a rejecting `send`. See
  `planning/gj01-v14e-asgi-send-boundary.json`.
- `src/delivery/asgi-core-profile.mjs`, `AsgiCoreProfileAdapter`, the smallest
  framework-neutral ASGI Core Profile boundary around `StandardRouter`. It is not a Python
  ASGI app and not a server. Constructor takes exactly `{ router }`, requires an exact
  `StandardRouter` instance by prototype identity, and freezes instance/class/prototype.
  `handle({ scope, body })` accepts an ordinary profile request; a malformed `scope`
  (wrong `type`, non-string `method`/`path`, malformed ASGI-style `headers` pairs) returns
  frozen 400 profile events without ever calling the router. A valid scope decodes
  string-or-`Uint8Array` header pairs (lowercase UTF-8 names, UTF-8 values, last value wins
  on duplicates) into a frozen plain header object, calls `router.handle` exactly once with
  a frozen `{ method, path, headers, body }` message, and converts the router's
  `{ status, headers, body }` response into two frozen events: `http.response.start` with
  lowercase `[name, value]` header pairs sorted by name, and `http.response.body` carrying
  the body unchanged with `more_body: false`. A malformed router response throws
  `TypeError`. No Node `http`/`net`/`fs`/`fetch`, no ASGI/FastAPI/Django/Uvicorn/Hypercorn
  dependency, no clock/random/env access.
  `tests/kernel-asgi-core-profile.test.mjs` proves constructor exactness, frozen surfaces,
  the 400 short-circuit, exactly-once dispatch, `Uint8Array` header decoding, deterministic
  header sorting, the `TypeError` on a malformed router response and forbidden-import
  checks. `tests/repository-boundary.test.mjs` now admits `asgi-core-profile.mjs` in the
  closed `src/delivery` ring module manifest. See
  `planning/gj01-v14c-asgi-core-profile.json`.
- `src/delivery/standard-router.mjs`, `StandardRouter`, the smallest framework-neutral route
  table in the delivery ring. Constructor takes exactly `{ routes }` (non-empty
  `{ method, path, handler }` records; duplicate `method`+`path` refused); router/class/
  prototype/records frozen. `handle({ method, path })` dispatches to the exact-match handler
  once, returning its response unchanged (throws `TypeError` on a non-object response);
  malformed shape -> 400, unknown path -> 404, unsupported method -> 405, no handler call. No
  body/header parsing, no framework/server import. See `planning/gj01-v14b-standard-router.json`.
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
- `src/delivery/standard-router.mjs`, `StandardRouter.handle` is now an `async` method. It
  awaits exactly one call to `route.handler.handle(message)`, whether the handler returns a
  plain object synchronously or a Promise, so `StandardRouter` composes with async delivery
  handlers (e.g. `CreateCustomerHttpMessageAdapter.handle`) without a synchronous-shape
  mismatch. Short-circuit responses (`400 MESSAGE_SHAPE_INVALID`, `404 ROUTE_NOT_FOUND`,
  `405 METHOD_NOT_SUPPORTED`) remain the same deterministic frozen objects, only now
  delivered through the async method; a non-ordinary-object response (sync or resolved by
  an async handler) still causes the returned promise to reject with `TypeError`.
  `src/delivery/asgi-core-profile.mjs`, `AsgiCoreProfileAdapter.handle` is now `async` and
  awaits `router.handle` before converting the response into frozen ASGI-profile events; a
  malformed scope still short-circuits without ever calling the router.
  `tests/kernel-standard-router.test.mjs` and `tests/kernel-asgi-core-profile.test.mjs` now
  await every `handle` call, and add coverage proving `handle` returns a Promise, an async
  handler resolving a response is awaited and its response returned, and a malformed
  response (sync or from an async handler) rejects with `TypeError` instead of throwing
  synchronously. See `planning/gj01-v14d-async-standard-router.json`.
- The repository root source-topology fence was widened again: a root `src` is permitted and may
  hold `src/domain`, `src/application` and `src/sdk` as its only first children — `src/domain` and
  `src/application` materialized, `src/sdk` a permitted-but-not-yet-materialized boundary — with
  `src/adapters` and `src/delivery` refused by name.
- Authority reporting now separates a checkout-local projection from project authority, so a
  feature checkout can no longer print a line that reads as the project's verdict.
- The package version moved from the planning placeholder 0.0.0-planning onto the prerelease train
  at 0.1.0-alpha.1. This is a train entry, not a release.

### Removed
- P14D2B deletes the transitional `src/adapters/postgres-commit-adapter.mjs` (133 lines) now that
  `postgres-write-envelope-write.mjs` owns its API directly; `planning/kernel-persistence-ownership.json`'s
  `transitionalKernelAdapters` is now the empty array, the adapters ring module manifest in
  `tests/repository-boundary.test.mjs` drops the retired filename, and the one remaining
  current-filename backlink comment in `postgres-write-envelope-write.mjs` is corrected (comment
  only; no runtime/error-message byte changed). See
  `planning/kernel-postgres-adapter-retirement-p14d2b.json`.
- P14d2a deletes the legacy `tests/postgres-commit-adapter.test.mjs` (343 lines, 10 test cases).
  `tests/postgres-unit-of-work-write-envelope.test.mjs` (authored by closed test writer; not
  edited by implementation writer) retains key
  surviving-path coverage — module export shape, `IdempotencyConflictError` shape, missing-tenantId
  pre-DB rejection, null-prototype/array/class/function customer-payload shape rejection, and the
  real-PostgreSQL four-intent atomic commit plus duplicate-idempotency-fingerprint rollback — and
  already asserted the legacy file's absence. This is not a like-for-like 10/10 replacement: 5 of
  the 10 legacy cases are directly covered, 3 are obsolete adapter-only behavior with no surviving
  equivalent (the module-existence case, the import/class-side-effect surface case, and the
  cross-tenantId options-mismatch rejection case), and 2 are no longer separately asserted by any
  surviving test (non-`pending` `persistenceState` rejection, and rejection of a nameless customer
  payload). No product code changed; `src/adapters/postgres-commit-adapter.mjs` still exists and
  is unmodified. Full coverage disposition, per-case classification and numstat in
  `planning/kernel-postgres-legacy-test-retirement-p14d2a.json`.

### Fixed
- GJ-01 V15N CLI argv=None separator fix (`host/python_asgi/create_customer_host_cli.py`,
  `tests/kernel-python-host-runner-cli.test.mjs`): fixes `parse_create_customer_host_args(argv)`
  to normalize `argv` to a single list once — `sys.argv[1:]` when `argv is None`, otherwise
  `list(argv)` — and to use that same normalized list for both `parser.parse_args` and the `--`
  separator/empty-command validation. Previously, when `argv` was `None`, `parser.parse_args(None)`
  correctly parsed the real `sys.argv`, but the separator check inspected the raw `argv` parameter
  (`None`), so it always failed closed and falsely rejected a valid `python -m ... -- ...`
  invocation. `main(argv=None)` called with an explicit argv list is unaffected. Tests prove
  `main(None)` against a monkeypatched `sys.argv` containing `--runner ... -- command` now
  dispatches correctly, and `main(None)` against a `sys.argv` missing `--` still fails closed
  before dispatch; all prior V15M CLI tests continue to pass unchanged. See
  `planning/gj01-v15n-cli-argv-none-separator-fix.json`.
- GJ-01 V15B ASGI host boundary claim correction (`planning/gj01-v15b-asgi-host-boundary-truth.json`):
  corrected comment wording in `src/delivery/create-customer-asgi-composition.mjs` that could be
  read as claiming Uvicorn or Hypercorn (Python ASGI servers) can call the returned `app` callable
  directly. The comments now state precisely that `app` is an ASGI-shaped, host-adapter-ready
  JavaScript async `(scope, receive, send)` callable at the protocol boundary, and that direct
  Uvicorn/Hypercorn hosting requires a separate Python host bridge/shim outside this package, which
  is not implemented here. This is a claim-boundary correction only: no executable behavior, export
  shape, dependency, or host selection changed, and every stronger readiness flag stays `false`. See
  `tests/kernel-asgi-host-boundary-truth.test.mjs`.
- `PostgresCommitAdapter.commit` in `src/adapters/postgres-commit-adapter.mjs` now accepts a
  `customer.payload` that is either an ordinary `Object.prototype` record or a null-prototype safe
  record (e.g. `Object.create(null)`), instead of only the former. RED evidence for GJ-01 V14K
  showed the real ASGI-\>pipeline path decoding a JSON body into a null-prototype safe record,
  which the adapter's prior `isOrdinaryObject`-only check refused before any DB work with
  `intents.customer.payload.name must be a non-empty string` — a genuine product gap, not a test
  artifact. The `payload.name` non-empty-string requirement is unchanged, arrays/class
  instances/functions/other exotic objects are still refused, every other intent/option strictness
  check is untouched, and the DB payload column is still written via `JSON.stringify(payload)`.
