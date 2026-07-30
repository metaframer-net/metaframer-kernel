# Consolidated Human Decision Package

Status: `PLANNING_ONLY / VALID_BLOCKED / NO_GO`

Package: `kernel-bootstrap-human-decisions-2026-07-30`

Status of this package: **answered and recorded**. `user-admin` selected the recommended
response on 2026-07-30:

```text
T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A, A01-A
```

The durable machine-readable record is `response` in `planning/human-decision-request.json`.
The option text below is retained as the evidence the decision was made against.

Recording the response closes the local decision blockers only. It does not close any
canonical KGA decision, and it does not authorize Actionplan write-back, runtime
implementation, merge, release or deployment unless that exact action is separately and
explicitly authorized. Every `canonicalStatus` remains `pending`, the local lifecycle state
is `APPROVED_AWAITING_CANONICAL_WRITEBACK`, and the verdict remains `NO_GO`.

A separate exact user instruction, recorded in `planning/human-decision-request.json` under
`response.oneShotGitAuthorization`, grants one Codex-executed commit and one normal
non-force push of this exact planning package to
`refs/heads/agent/kernel-control-plane-reconcile` from expected base
`90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`. That grant is spent on the first successful push
and is not reusable, and Claude may never consume it. Pull-request creation stays
unauthorized (`pullRequest=false`).

Consumption is fenced by remote-ref state, not by the committed `consumptionStatus`:
`git ls-remote --heads origin refs/heads/agent/kernel-control-plane-reconcile` must return
no matching ref and empty output before the push. If any matching ref exists at any SHA the
grant is already spent and execution must stop. The static `unconsumed` value is snapshot
evidence only; no push has been performed.

## T01 — Canonical runtime repository and topology

**T01-A — Standalone kernel after the gate (recommended):** after canonical governance
closure, `metaframer-kernel` owns kernel runtime and public kernel contracts. Actionplan
keeps governance ownership; platform consumes versioned SDK/public ports.

**T01-B — Platform remains canonical:** runtime remains in the platform monorepo and this
repository remains planning-only.

This changes canonical ownership, dependency direction, CI/release ownership and rollback
authority, so it cannot be inferred from technical evidence.

## T02 — History and extraction strategy

**T02-A — Clean start with provenance (recommended):** copy, filter and mirror no platform
history. After the gate, create only authorized kernel packages here and maintain a
provenance ledger for source decisions and selectively reimplemented contracts.

**T02-B — Filtered history extraction:** first approve an isolated source-path audit, then
perform a reviewed filtered extraction with a commit map and rollback tag.

**T02-C — Subtree/mirror transition:** keep platform canonical during a time-boxed
transition, prohibit dual writes, and cut over through explicit validation and rollback
gates.

**T02-N — Not applicable:** valid only with T01-B. Platform remains canonical, this
repository remains planning-only, and no history extraction or runtime cutover occurs.

Selection rule: T01-A requires T02-A, T02-B or T02-C; T01-B requires T02-N.

No isolated runtime-kernel tree exists today, so choosing the history shape is a human
auditability and cutover decision.

## D01 — Code-bearing descendants

**D01-A — Defer all 33 pending parents (recommended):** record them as explicitly deferred
for this bootstrap. Invent no generic child. Each later descendant needs an approved row
with exact parent, level, owner, test and rollback evidence.

The exact approved defer set is:

```text
k-actor, k-agent-runtime, k-archetype-bayraklari, k-archetype-computation,
k-archetype-fieldtypes, k-archetype-mode-profile, k-authz, k-boyut1-ops-panel,
k-boyut2-developer-panel, k-boyut3-tenant-panel, k-bus, k-calendar-capacity,
k-computation, k-control-planes, k-edge-gateway, k-genealogy-graph, k-jurisdiction,
k-kpi-registry, k-mdm, k-mod-l, k-mode, k-party, k-plugin, k-policy-pdp, k-schema,
k-search, k-sequence, k-sozlesme, k-storage, k-surface, k-surface-consumer,
k-terminoloji, k-worker
```

**D01-B — Custom complete 33-row matrix:** in this same response, provide every parent with
either an exact descendant ID, level, owner, test and rollback contract, or explicit
defer/reject. A named subset or partial matrix is not a valid closure decision.

The 40 exports do not contain enough evidence to choose product decomposition for all 33
parents.

## D04+D09 — Unowned directives and ghost WBS identities

**D04+D09-A — Reject all 13 WBS identities (recommended):** approve the complete matrix
below. `reject` means no node or alias is created and execution references are removed or
disabled; the directive remains non-executable requirements evidence.

| Missing identity | Directive evidence | Disposition |
| --- | --- | --- |
| `archetype-agreement` | `docs/archetype-agreement-lifecycle-negotiation-directive.md` | reject |
| `archetype-document-composition` | `docs/archetype-document-composition-directive.md` | reject |
| `k-event-projection` | `docs/event-replay-projection-contract.md` | reject |
| `k-evidence` | `docs/k-evidence-seal-directive.md` | reject |
| `k-exec-context` | `docs/execution-context-envelope-directive.md` | reject |
| `k-kms` | `docs/k-kms-directive.md` | reject |
| `k-legal-hold-retention` | `docs/k-legal-hold-retention-directive.md` | reject |
| `k-migration-bridge` | `docs/k-migration-bridge-directive.md` | reject |
| `k-module-security` | `docs/marketplace-module-security-directive.md` | reject |
| `k-obligation` | `docs/k-obligation-commitment-directive.md` | reject |
| `k-provider-adapter` | `docs/k-provider-adapter-directive.md` | reject |
| `k-signature` | `docs/k-signature-trust-directive.md` | reject |
| `privacy-retention-matrix` | `docs/privacy-retention-decision-matrix.md` | reject |

**D04+D09-B — Custom 13-row matrix:** in this same response, provide `create / alias / fold /
reject`, canonical owner and rationale for every row above. A partial matrix is not a valid
decision and would leave D04/D09 open.

The two KGA decisions remain separately traceable in the canonical registry even though one
human response disposes their shared 13-row source set.

## D08 — ADR collision policy

**D08-A — Quarantine ambiguous IDs (recommended):** mark the colliding short IDs ambiguous
and deprecated, forbid them as approval references, allocate unique canonical registry IDs
to every topic and migrate all consumers atomically.

**D08-B — Preserve one legacy ID per cluster:** name the canonical topic in each of the five
clusters; give every other topic a new ID and explicit supersession alias.

| Ambiguous ID | Topics requiring disposition |
| --- | --- |
| `ADR-E1` | `event-replay-projection`, `evidence-seal` |
| `ADR-M1` | `migration-bridge`, `module-security-sandbox` |
| `ADR-S1` | `object-storage-dam`, `surface-family` |
| `ADR-X1` | `execution-contract-matrix`, `execution-context-envelope` |
| `ADR-A5/ADR-0022` | `archetype-storage`, `variant-fieldtype-extension`, `duplicate-storage-identity` |

Only the owner can select which historical identity and approval lineage is canonical.

## D10 — Tenancy storage and isolation

**D10-A — Shared schema plus RLS (recommended):** shared schema with `tenant_id` and
deny-by-default PostgreSQL RLS is the fixed topology. Threshold is
`not-applicable-fixed-topology`: there is no tenant-count threshold or automatic promotion.
Any dedicated exception is a new human-approved topology decision. Owner: `user-admin`.

**D10-B — Schema per tenant:** schema-per-tenant plus mandatory RLS defense in depth and
central migration orchestration is the fixed topology. Threshold is
`not-applicable-fixed-topology`; there is no automatic topology change. Owner: `user-admin`.

**D10-C — Hybrid:** shared schema by default. Tenant count never triggers promotion.
Promotion requires either a binding regulatory/contractual dedicated-isolation requirement
or one tenant sustaining at least 20% of the validated database resource budget for three
consecutive 15-minute windows after rate-limit/noisy-neighbor mitigations. A reversible
migration dry-run and `user-admin` approval are mandatory; the evidence owner is the
`data-reliability-owner`.

PostgreSQL RLS deny-by-default and cross-tenant negative tests are mandatory for every
option. URLP task metadata is provisional and does not decide this choice.

## A01 — Future mutation authority

**A01-A — Exact-action approvals (recommended):** keep commit, push, merge, release, deploy
and Actionplan write-back unauthorized by default. Each later action needs its own exact
target and approval.

**A01-B — Allow future local planning commits:** after required checks pass, Codex may make
local planning-only commits in this repository. Push, merge, release, deploy and Actionplan
write-back still require separate exact approval.

`A01-A` was selected, so no standing mutation authority exists under either option. Merge,
release, deploy, Actionplan write-back, pull-request creation, pushes to `main`, tags and
force pushes remain unauthorized. The only permitted Git mutation is the separately recorded
one-shot grant: one Codex-executed commit and one normal non-force push of this exact
planning package to `refs/heads/agent/kernel-control-plane-reconcile` from expected base
`90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`, spent on the first successful push,
`reuseAllowed=false` and never consumable by Claude. Runtime stays blocked and the verdict
remains `NO_GO`.
