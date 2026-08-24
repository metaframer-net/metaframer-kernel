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

`5/25 tamamlandı, P05/25 aktif` (`roadmap.progress` in
[`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json)). Completed
packages: P01, P02, P03, P04, P06. P04 (policy-as-data, batch and decision-log adapter) is
closed — its candidate resolution, sequential batch evaluation and PostgreSQL-backed
decision-log adapter are composed end to end and test-verified against PostgreSQL 16. P05 (UoW,
CommitReceipt and write envelope) is the active package and the next explicit gap; none of this
moves any readiness flag under [README.md](README.md) `## Current status`.

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
