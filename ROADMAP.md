# Roadmap v1 — Current Truth

This is the concise human-readable projection of the sole machine-readable owner,
[`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json). On any
disagreement between this file and that JSON, the JSON wins; repair this file to match it, never
the other way around.

## Current truth (not a readiness claim)

`runtimeImplementationStarted=true`; every stronger flag is `false`:
`kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
`productionAllowed`, `gapClosed`, `oneGoldenSliceReady`, `runnableProduct`. No SaaS user journey (form submit → save → reject → retry) is
runnable end to end. See [README.md](README.md) `## Current status` for the full authority
record this projects from.

## Fixed denominator: 25 atomic packages, 8 delivery phases/families

| Delivery phase | Packages | Definition of Done (summary) |
|---|---|---|
| F0 | P01 | Current truth + roadmap artifact, test-verified and owner-legible. |
| F1 | P02–P06 | Public contracts: Kernel primitive + policy/authorization/PDP building blocks. |
| F2 | P07–P09 | Generic SDK: generator, versioned distribution, clean consumer conformance. |
| F3 | P10–P14 | app-core plus application-owned persistence, cutover/rollback and Kernel cleanup. |
| F4 | P15–P16 | Customer product slice plus a separate Surface/UI projection, demonstrably runnable. |
| F5 | P17–P18 | Installable ASGI adapters plus the outbox relay lifecycle. |
| F6 | P19–P23 | Enterprise operations: observability/SLO, performance, security, deploy, HA/DR. |
| F7 | P24–P25 | External consumer proof plus the full promotion gate set. |

Progress is reported `completed/25` against this fixed 25-package denominator; the denominator
never moves without a newly named plan version.

## Progress

`22/25 tamamlandı, P23/25 aktif` (`roadmap.progress` in
[`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json)). Completed
packages: P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16, P17,
P18, P19, P20, P21, P22. P21 (security) is closed by seven merged sub-packages (P21A–P21G,
PRs #128–#134, CI runs 32997140154 through 33027876043 plus the separate Security workflow run
33027876143), whose full evidence is preserved in [README.md](README.md) `## Current status` and
`CHANGELOG.md`; the audit stays opt-in and default-off, the Git history is unscanned, and
`supply-chain-and-secret-scan` is not a required status check under branch protection. P22
(deploy package/staging) is closed by four merged sub-packages: P22A1 hands the deploy artifact
its database credential as a mounted file (`--config-file`, `--database-url-file`,
`host/deploy/secret_file_runner.mjs`; PR #136, CI run 33036329914); P22A2 puts that wrapper in an
input-pinned OCI image (`host/deploy/Dockerfile`, digest-pinned bases, a lock-only `npm ci`,
hash-locked Uvicorn 0.40.0; PR #137, CI run 33042126138); P22B1 stands that image up beside a
digest-pinned PostgreSQL 16.15 at migration head `0003_policy_decision_log` under the
`mfk_migration`/`mfk_runtime` role split and serves real HTTP with no published port (PR #138,
CI run 33049913914); and P22B2 sends a real `POST /customers` to that live listener, which
answers `201 COMMITTED` with exactly one `customer_records`, one `audit_log` and one
`transactional_outbox` row and refuses a foreign-tenant claim `403 CROSS_TENANT_DENY` writing
nothing (PR #139, CI run 33055438573). The environment that carried it is ephemeral and deletes
itself: no staging environment exists and no staging run was performed, no registry is contacted,
no external deployment and no production host selection happens, and the proof is one sequential
request with no restart, durability, concurrency or load evidence. P23 (HA/DR/upgrade rollback)
is the active package and the next explicit gap; none of this makes a hosted product runnable and
none of it moves any global readiness flag under [README.md](README.md) `## Current status`.

## Approved dependency DAG

```
P01 -> P02, P06
P02 -> P03
P03, P06 -> P04
P02, P04 -> P05
P03, P05, P06 -> P07
P07 -> P08
P08 -> P09
P09 -> P10
P06, P10 -> P11
P11 -> P12
P12 -> P13
P13 -> P14
P10, P14 -> P15
P15 -> P16
P09, P15 -> P17
P05, P14 -> P18
P16, P17, P18 -> P19
P19 -> P20, P21, P22
P22 -> P23
P16 -> P24
P20, P21, P23, P24 -> P25
```

## Execution model

- Maximum **3** concurrent writer lanes (independent open change packages); a single active
  writer per package, no fallback writer.
- Shared locks that serialize across lanes: `package.json`/`package-lock.json`,
  `versioning-policy.json` + `CHANGELOG.md`, canonical `planning/*.json` fields, `AGENTS.md`.
- Full per-phase Definitions of Done are in `planning/roadmap-v1-current-truth.json` under
  `roadmap.families[].dod`, referenced per phase via `dodRef`.

### Operational guardrails (process overlays, not roadmap phases)

These sit alongside the fixed 25-package plan; they never add, remove, or renumber a phase, and
the denominator above stays 25.

- **GC-02** — Pane panel cleanup is event-driven only (never a timer/cron/daemon/hook/background
  loop). Canonical source: the global Pane-garbage-collector lifecycle directive and the
  `pane-garbage-collector` skill/agent.
- **ultra-fast-v1 pilot** — an additive packaging overlay for small, bounded change packages
  (separate test writer, implementation writer, read-only reviewer). Canonical source:
  `planning/ultra-fast-v1-policy.json`, projected in
  `.claude/skills/ultra-fast-development/SKILL.md`. It claims no readiness.

## Owner-facing

`capability_delta: NONE`. `calistirilabilirlik: not-runnable`. See the `ownerFacing` block of the
JSON for `once`/`simdi`/`fark`/`kullaniciYolculugu`/`kalanEngel` in plain Turkish.
