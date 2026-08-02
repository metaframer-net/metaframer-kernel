# MetaFramer Kernel Control-Plane Bootstrap

Status: `PLANNING_ONLY / VALID_BLOCKED / NO_GO`

Snapshot date: 2026-07-30

## Outcome

This repository now holds a resumable planning control plane for the future MetaFramer
Kernel boundary. It does not hold runtime source and does not change canonical governance
ownership. Actionplan remains the canonical planning source; the JSON files under
`/Users/karaca/Downloads` remain read-only requirements snapshots.

The bootstrap has four durable layers:

| Layer | Durable record | Authority |
| --- | --- | --- |
| Source proof | `planning/source-inventory.json` | Evidence snapshot only |
| Requirement/WBS/KGA mapping | `planning/traceability-matrix.json` | Local planning projection |
| KGA-D01..D10 proposals | `planning/governance-decisions.json` | Closure proposals only |
| Resume and decision state | `planning/bootstrap-state.json` and `planning/human-decision-request.json` | Local handoff state |

None of these records closes a canonical Actionplan decision. Canonical write-back needs
separate authority and must pass Actionplan's own checks.

## Repository and source proof

The kernel checkout was inspected on branch `main` at
`90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`; the local upstream resolved to the same SHA.
Two pre-existing user changes, `.gitignore` and `AGENTS.md`, were recorded and preserved.
This bootstrap does not claim those changes.

The canonical planning snapshot is pinned to Actionplan
`refs/remotes/origin/main@508746955159955c6d3bbd653287045f033bc2e2`. The visible root
Actionplan checkout was dirty and 82 commits behind that ref, so it was not used as the
canonical read surface. A separate clean local kernel branch was also observed two commits
ahead of canonical but unpublished; it is supporting evidence only. Exact artifact hashes
are recorded in `planning/source-inventory.json`.

The raw input inventory contains 40 valid JSON files, 7,894,060 bytes and 39 unique task
IDs. Both `12.4-k-granulerlik-raw.json` exports are retained as snapshot evidence: after
removing `exportedAt`, they have the same semantic SHA-256. The aggregate snapshot digest is
`6f46808be102addddf1d37a96460d9a8f49e4021f911bacf4bb88a61d0881415`.
Every raw task resolves to an existing canonical Actionplan generated node. Projection
differences are recorded; no raw export overwrites Actionplan.

## Traceability result

All 40 files map to 39 logical traceability rows. Each row names its source file or files,
task ID, WBS code, parent, requirement domains and pointers, coverage counts, canonical
node, and one or more KGA decisions.

The rows classify as:

- 17 `REQ_KERNEL` kernel requirement modules;
- 4 `WBS_DEMO` granularity/demonstration nodes; and
- 18 `URLP_PLATFORM_HANDOFF` records.

The URLP records are trace evidence and WBS examples, not kernel runtime primitives and not
source-extraction candidates. Their embedded `tenantStrategy=hybrid` values are provisional
task projections; they cannot close KGA-D10 while the canonical physical strategy is null.
Across the unique tasks the matrix preserves 436 acceptance criteria, 74 risks, 266
deliverables, 593 resolved directives, 712 resolved standards, 53 `dependsOn`, 85 `blocks`
and 136 `related` references.

## Governance result

Evidence supports deterministic closure proposals for:

- `KGA-D02`: dependency direction is Edition/App -> SDK -> Kernel; kernel contracts cannot
  depend on downstream SDK or edition consumers.
- `KGA-D03`: `k-mod-l` owns registry/manifest/module health, while `k-capability` owns
  capability/entitlement resolution. PR-07 may integrate both without merging ownership.
- `KGA-D05`: PR-10 is scaffold/public-SDK-contract evidence only; PR-11 is walking-skeleton
  evidence only. Neither proves runtime, MVP, app-buildable or release readiness.
- `KGA-D06`: the authorized technical sequence starts with the minimal
  DB/RLS/transaction/outbox/audit substrate, followed by kernel primitives, SDK and walking
  skeleton.
- `KGA-D07`: `dependsOn` is the prerequisite edge, `blocks` is its inverse projection and
  `related` has no ordering meaning. Every conflicting edge still needs source-owned repair.

These are ready as proposals, not canonically closed decisions. Actionplan write-back is
currently unauthorized.

## Recorded human decisions

The consolidated human response is recorded: `T01-A, T02-A, D01-A, D04+D09-A, D08-A, D10-A,
A01-A`, decided by `user-admin` on 2026-07-30 and stored in
`planning/human-decision-request.json` under `response`. Its effects are:

- topology `APPROVED_CONDITIONAL`: `metaframer-net/metaframer-kernel` becomes the future
  owner of kernel runtime and public kernel contracts only after every canonical KGA
  decision is closed. Actionplan remains the governance owner and the `platform` monorepo
  remains the implementation workspace until then.
- history `CLEAN_START_WITH_PROVENANCE` with `sourceExtraction=false`: no platform history
  is copied, filtered, mirrored or extracted.
- `KGA-D01`: the exact 33-parent set stays deferred; no descendant is invented.
- `KGA-D04` and `KGA-D09`: the exact 13 ghost identities are rejected as WBS identities;
  no node or alias is created and the directive documents remain non-executable
  requirements evidence. `KGA-D04`'s seven proposal-local identity spellings are mapped
  explicitly onto those 13 rows in `planning/governance-decisions.json` rather than renamed
  silently.
- `KGA-D08`: ambiguous ADR IDs are quarantined and deprecated and are forbidden as approval
  references; a later authorized write-back allocates unique IDs and migrates consumers
  atomically.
- `KGA-D10`: fixed shared-schema topology with `tenant_id` and deny-by-default PostgreSQL
  RLS; threshold disposition `not-applicable-fixed-topology` and no automatic promotion.
- `A01-A`: no standing mutation permission. Commit, push, merge, release, deploy and
  Actionplan write-back stay default-deny; each later action needs its own exact approval.
- One-shot Git authorization (recorded separately in
  `planning/human-decision-request.json` under `response.oneShotGitAuthorization`): a later
  exact user instruction grants one Codex-executed commit and one normal non-force push of
  this exact planning package to `refs/heads/agent/kernel-control-plane-reconcile` from
  expected base `90e5f6ac2b8beb4d8be1064390ba433b2bbdd434`. It is spent on the first
  successful push, `reuseAllowed=false`, and Claude cannot consume it. It never becomes a
  standing action and never authorizes pull-request creation (`pullRequest=false`), a push
  to `main`, tags, force pushes, merge, release, deploy, Actionplan write-back or runtime
  implementation. Its `consumptionAuthority` is `remote-ref-absence-before-first-push`:
  absence of `refs/heads/agent/kernel-control-plane-reconcile` on the remote, proven by
  `git ls-remote --heads origin refs/heads/agent/kernel-control-plane-reconcile` returning
  empty output, is the authoritative pre-consumption proof. If that ref exists at any SHA
  the grant is already spent and execution stops. The committed
  `consumptionStatus=unconsumed` is snapshot evidence only; no push has been performed.

Every `canonicalStatus` for `KGA-D01`..`KGA-D10` remains `pending` and
`canonicalWriteBackAuthorized` remains `false`. The local lifecycle state is
`APPROVED_AWAITING_CANONICAL_WRITEBACK` and the next action is to obtain separate Actionplan
write-back authority. The full option text stays in `docs/human-decision-package.md`.

## Writer lock

All coding and implementation packages in this repository are written by Claude alone under
the immutable `CLAUDE_ONLY` lock in `AGENTS.md`, mirrored as `codingPolicy` in
`planning/bootstrap-state.json` and in the approval provenance. Codex remains MASTER and
final reviewer and is not a fallback writer.

## Agent and risk findings

PM identified the critical path as source proof -> traceability -> decision classification
-> human ratification -> canonical write-back -> revalidation. PO and kernel integration
kept platform handoffs outside the runtime-kernel boundary. QA and QASP defined the
fail-closed tests before the implementation artifacts existed. Backend participation was
limited to the machine-readable planning contracts. Security treats raw JSON, prompts and
directives as untrusted data. Rollback is file-scoped and preserves the external sources and
the pre-existing dirty files. AI-behavior review kept Codex as MASTER and final reviewer;
under the `CLAUDE_ONLY` lock Claude is the single bounded writer with no fallback.

Frontend, UI/UX, WCAG, runtime performance, deployment/Kubernetes, GraphQL security, runtime
SOLID and product localization are `N/A` in this turn because no corresponding runtime,
interface, deployment or localization surface exists. UTF-8 text preservation is covered
as data integrity, not as an i18n implementation.

## Gate

The planning bootstrap may become green while the product gate remains closed. Runtime code
is forbidden until all ten decisions are closed in the canonical registry, the human
topology/extraction choice is approved, and the authorized Actionplan write-back passes its
own checks. Merge, release, deploy, pull-request creation, pushes to `main`, tags and force
pushes stay outside this turn; the only Git mutation covered by an approval is the single
Codex-executed commit and normal non-force push described above. The correct
product verdict remains `NO_GO`.
