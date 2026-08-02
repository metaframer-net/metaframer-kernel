# Kernel AI Development Readiness — CANDIDATE

Human-readable projection of `planning/kernel-ai-development-readiness.json`. This is a
**CANDIDATE**: evidence submitted for review. It is not an approval, not a code-start
permit, and not a readiness claim.

## Status

- `readinessStatus`: **BLOCKED**
- `verdict`: **NO-GO** (canonical Actionplan token)
- Kernel-local token: **NO_GO** — this repository's boundary checker and `AGENTS.md` use the
  underscore form. `verdictTokenMap` records both; they denote the same denied state.
- `codeStartAllowed`: false · `runtimeCodeAllowed`: false
- `runtime.implemented` / `started` / `sdkReady` / `appBuildable` / `releaseAllowed` /
  `deployAllowed` / `kernelReady`: all false
- `successorAuthorityEffective`: **false** — the reason this stays a candidate.

## Identity and portability

`identity.absoluteKernelWorktreePathsRecorded: false` — the field is named for exactly what
it asserts: no absolute **Kernel worktree** path is recorded. Repository root is derived at
runtime from `import.meta.url`; every path is repository-relative and containment-checked
(no absolute path, no `..` traversal, must resolve inside the root, matched against a strict
canonical-ref regex).

A non-identity canonical Actionplan locator is retained under
`sourceEvidence.actionplan.localVerificationPath` with `isIdentity: false`, transparently, as
a discovery *hint* only. **Verification never reads it.** The oracles discover the Actionplan
checkout from local topology, confirm its `origin` remote normalises to
`karacaismail/actionplan`, confirm `rev-parse --show-toplevel` matches the candidate, run all
git with `GIT_NO_REPLACE_OBJECTS=1` and `--no-replace-objects`, scrub `GIT_DIR`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_REPLACE_REF_BASE`,
`GIT_CONFIG_*` and related overrides from the environment, check the repository object format
against the pinned id length, and resolve the commit with
`rev-parse --verify --end-of-options <sha>^{commit}` plus `cat-file -t`. Replacement objects,
ref substitution, path substitution and env override are all refused.

| Source | Identity | Role |
|---|---|---|
| Actionplan | `karacaismail/actionplan` @ `refs/remotes/origin/main` @ `7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d` | canonical governance source, read-only |
| Kernel | `metaframer-kernel` @ `b80f2ed0f4d968ee11d59bc3b31890f960ac9372` | planning-only control plane, read-only |
| Effective authority | EPOCH-03 `AUTHORITY-SUPERSESSION-03`, seq 3 | current authority head |

## Recorded RED evidence

The RED was observed **once, before the artifact existed**, and is recorded rather than
re-staged. No second RED is invented.

- Command: `node --test tests/kernel-ai-development-readiness.test.mjs`
- Failure token: `readiness-artifact-missing: planning/kernel-ai-development-readiness.json`
- Pre-write test SHA-256: `ee66e6fb8600d6cb61d6e445bccf455faa0999aa3bf1df62245178511a7cb260`
The checker resolves the collector ledger **fail-closed** from
`$HOME/.codex/actionplan-changelog-ledger/`, independent of any path or override the artifact
supplies, requires exactly one matching ledger file, parses it, and locates both events. Each
event is cross-validated **only on the fields it genuinely carries**:

| Event | Time | What it actually attests |
|---|---|---|
| `bc594837225bd49b449a` (original) | `2026-08-02T02:22:49.463298+00:00` | RED identity and timestamp, `phase: red`, the missing artifact path, and its own failing readiness test line. It carries **no** exact command, **no** exit-code field and **no** pre-write digest. |
| `66f8369293744c534dde` (completion) | `2026-08-02T04:04:39.577513+00:00` | The exact command with **exit 1** and the **exact token**, the pre-write test SHA-256, that **no historical file was rewritten**, and a back-reference to the original event id and timestamp. |

The artifact records this split explicitly per event, and the oracle rejects an original-event
record that claims the completion event's fields. No rerun is performed or claimed.

A projection at `/Users/karaca/DEV/mimari/actionplan-kernel/changelog.json` was inspected and
does **not** carry these two event ids, so it is not used as corroboration.

## Non-circular promotion protocol

The candidate cannot pin its own digest, so promotion is staged:

1. **Claude** produces this candidate, pinning `actionplan@7312ac0` and `kernel@b80f2ed`. State: **blocked**.
2. **Codex** commits it; **Actionplan EPOCH-04** then pins the candidate commit + artifact digest. State: **blocked**.
3. **Codex** performs final Kernel promotion, pinning the EPOCH-04 commit + chain digest. State: **ready only if authorized**.

Current step: **1**. `selfHashRecorded: false`. Terminal states are modelled explicitly:
*blocked* while successor authority, reviews or Codex verification are outstanding; *ready*
only once EPOCH-04 and the promotion are pinned **and** human runtime evidence exists.

## Blueprint

Authorized sequence, none started:

| # | Phase | Decision | Canonical ref |
|---|---|---|---|
| 1 | `db-rls-transaction-outbox-audit` | KGA-D06 | `reports/kernel-early-minimal-db-substrate-2026-08-02.json` |
| 2 | `kernel-primitives` (all 33 cards) | KGA-D01 | `reports/kernel-code-bearing-descendant-handoff-2026-07-15.json` |
| 3 | `sdk` | KGA-D05 | `reports/kernel-scaffold-walking-skeleton-exit-semantics-2026-08-01.json` |
| 4 | `walking-skeleton` | KGA-D05 | same |

**Data plane:** `db -> rls -> transaction -> outbox -> audit`. Tenancy is shared schema on
`tenant_id` under `FORCE RLS` deny-by-default (KGA-D10), recorded but **not enforced**;
executor `human-developer-only`.

**SDK public boundary (KGA-D02):** contract `Edition/App->SDK->Kernel`, scope
`governance-semantics-only`. Provisional boundary: *k-surface may publish a provisional
projection contract; consuming it never reverses the recorded direction.* Out of scope:
changing k-surface or any other edge, creating/mutating generated nodes, reordering the base
queue, deciding KGA-D03 / KGA-D05 / KGA-D07, and claiming kernel/SDK/app readiness. Exit
ceiling `scaffold-only`.

**Single-writer lease:** `CLAUDE_ONLY`, one writer, invoked as `visible Pane --agent claude`.
MCP `claude_implement` invocation is explicitly forbidden. Codex is
MASTER; no delegation, no fallback writer, no Git mutation. Account gate is exact and
fail-closed.

**Writer invocation: two records, deliberately not identical.**

*Immutable historical approval record (2026-07-30).* `codingPolicy.writer.invocation` in
`planning/bootstrap-state.json` and `response.codingPolicy.writer.invocation` in
`planning/human-decision-request.json` both read **`claude_implement`**, exactly as the
approval was given. That provenance is preserved byte-faithfully and is never rewritten to
match a later instruction.

*Additive current successor invocation.* A later direct User/Admin instruction supersedes the
**invocation mechanism only**: the current worker invocation is **`pane-visible-agent-claude`**
and MCP `claude_implement` is forbidden. It is recorded separately in this package under
`successorInvocationPolicy`, and attested by external collector event
**`37e87ad17327e4e5f004`** at `2026-08-02T04:55:48.555639+00:00`, whose own facts state that
the 2026-07-30 policy *remains byte-faithful* and that the successor policy is *additive*.
That event also carries the auth gate (`claude.ai` / `firstParty` / `max`, `claude-opus-5`,
effort high, fail-closed), Codex as MASTER read-only verifier and Git executor, and
`runtimeStarted: false`.

The oracles assert **both** records, separately: the historical mirrors must still read
`claude_implement`, and the successor invocation must read `pane-visible-agent-claude` in
`AGENTS.md`, in this package and in the collector record. `AGENTS.md` no longer claims the
active text and the historical mirrors are identical. This is **mechanism reconciliation
only, not code-start authority**: `CLAUDE_ONLY`, single active writer, bounded-worker role,
the exact account gate, the no-fallback rule and the forbidden Git/release/deploy actions are
all unchanged.

## Execution cards

33 cards, one per approved D01 module parent. Every card carries the full MASTER FAZ-3 field
set: identity and parent binding, implementation boundary, sequence phase, `nonGoals`, owner
lease, predecessor/completion evidence, `redTest`, exact test file and command, positive and
`negativeFailClosed` behaviors, `acceptanceMapping`, schema/migration/RLS `dataImpact`,
security and tenant impact, performance budget, observability, rollback
(trigger + verification + `decisionOwner: codex` + `executor: claude-via-visible-pane`,
with codex explicitly forbidden as executor), `expectedEvidence`, `shardClass`, and the
mandatory bounded write scope **`repoPath`** (`metaframer-kernel`, never absolute, never a
worktree) plus **`allowedFiles`** — an exact, non-empty, de-duplicated, containment-checked
list of the two relative files that shard may touch, which must include its planned test.

Per-card `dataImpact`, `securityImpact` and `performanceBudget` are **truthful per contract**,
not blanket constants. `plannedRuntimeDataImpact` records what each contract would hold once
phase 1 exists (from `terminology definitions only` to `durable sequence allocations` and
`object storage blobs`), while current `runtimeDataImpact` stays `none` because nothing is
built. `rlsScopeRequired` follows the planned impact. `piiHandled` is true only for the
contracts that genuinely touch personal data (party/actor context, lifecycle PII flags,
jurisdiction residency, golden records, tenant and consumer surfaces) and each such card must
carry a PII/residency/retention control; `secretsHandled` is true only where credential
material is genuinely in scope (agent tools, ops plane, edge gateway, plugin signing, object
storage) and each must carry a credential control. Performance is **tiered**, not a uniform
100 ms: `kernel-core` 100 ms, `adapter` 200 ms, `app-e2e` 400 ms, and `asynchronous` with no
request p95 at all — matching the approved crosscut budget.

All planned tests are `planned-not-run`; the checker verifies each planned test path is
**absent** from the repository.

## Quality matrix — 19 axes

`unit`, `integration`, `contract`, `e2e`, `tenant`, `rls`, `race`, `idempotency`,
`migration`, `atomicity`, `fuzz`, `scans`, `performance`, `load`, `failureInjection`,
`observability`, `compatibility`, `sdk`, `rollback`.

Each axis on each card carries its own `applicability`, `specialistRole`, a card-specific
**`risk`** and **`acceptance`**, `semanticBinding`, `boundTo`, `evidenceArtifact`,
`currentEvidence: null` and `humanRunRequired: true`.

**These sentences deliberately share axis-level frames.** No claim is made that they are
novel prose. What must be card-specific is the *bound meaning*, and that is what the oracles
measure — **semantic-binding coverage**, not uniqueness.

Each card carries an explicit `semantics` block of eight typed signals: `domain`,
`observable-signal`, `primary-threat`, `characteristic-failure`, `excluded-scope`,
`planned-data-impact`, `performance-tier` and `security-class`. Every signal is cross-checked
against the card field it describes (threat and failure against `securityImpact`, data impact
against `dataImpact`, tier against `performanceBudget`, signal name against `observability`),
rejected if it is generic or a bare identifier, and — for `excluded-scope` — required to be
derivable from that card's own recorded scope sentence. All 33 exclusions are real per-card
prose taken from each row's scope; there are no placeholder fallbacks.

Every one of the 1,254 `risk` and `acceptance` entries must bind **at least two independently
typed** signals, and each entry's recorded `semanticBinding` must match what its text actually
contains. Signal diversity is enforced per type. Every `evidenceArtifact` and path-bearing
`expectedEvidence` entry is containment-checked.

Four axes are conditionally
**not-applicable** with recorded reasons: `e2e` (no walking skeleton; D05 ceiling),
`migration` (no schema; D06 unbuilt), `load` (no runtime to load), `sdk` (later phase,
scaffold-only ceiling).

## Dependency graph — scoped

Scope is **`d01-33-subgraph` only**: 33 nodes, 50 edges, proven acyclic *within that
subgraph*. The 50 edges are compared **exactly against the canonical D01 ledger projected to
the 33-card subgraph** — the ledger is re-read from the pinned commit and its projection must
equal both the graph edge set and the flattened card edge set.

`coversRelationDirectionConflicts: false`. Per KGA-D07 there are 46 total conflicts, **8
kernel edges unrepaired**, `edgesRepaired: 0`, and 38 non-kernel edges moved to a
still-unregistered gap. **These conflicts are not disjoint from this work:** 4 of the 5 D07
kernel conflict nodes — `k-authz`, `k-schema`, `k-sozlesme`, `k-surface` — are also parents of
cards in this subgraph. The candidate does not claim otherwise. It measures acyclicity only
over the D01 dependency subgraph and repairs no edge; relation-direction repair is an
**explicitly excluded** concern that remains open. The oracles recompute the overlap from the
live card parents and reject both an understated overlap and any "outside the subgraph" or
"disjoint from" wording.

Nine predecessors fall outside the D01 ledger, each with a pinned canonical node ref whose
digest is re-derived **byte-exact** by the oracles via `git show` against
Actionplan@`7312ac0`:

- `capability-registry-contract` — **`deferred-to-pr07-pre-execution-node-rescope`** per
  KGA-D03 (`reports/kernel-module-registry-ownership-split-handoff-2026-08-01.json`);
  `graphProjectionApplied: false`, `nodeRescopeComplete: false`.
- `adr-0022`, `archetype-storage-contract`, `k-sso`, `k-tenancy`, `scale-outbox`,
  `scale-projections`, `sus-bitemporal`, `sus-conformance` —
  **`planning-predecessor-not-evaluated-for-readiness`**. This candidate makes no readiness
  claim about them either way.

## Unresolved gates — candidate gates only

| Gate | Status |
|---|---|
| successor authority | open |
| Review A acceptance | open |
| Review B acceptance | open |
| Codex verification | open |

## Deferred risks — not readiness blockers

The Actionplan decision registry is **immutable discovery history** frozen at 2026-07-15;
its pending rows are not a live blocker. Live application state is **10 applied / 0 pending
/ 10 canonical**. The following are execution risks carried forward, explicitly
`isReadinessBlocker: false`:

- human runtime test evidence (expected absent at candidate stage)
- KGA-G04 open P0 — 8 kernel conflict edges unrepaired
- KGA-G05 open P0 — directive ownership unresolved
- DB substrate unbuilt (KGA-D06 is an evidence rule only)

## Verification

```sh
node --test tests/kernel-ai-development-readiness.test.mjs
npm run check:readiness
npm test
npm run check
```

The strongest checker is wired into **both** required acceptance surfaces: `npm run check`
runs it directly, and `npm test` runs it through a spawned assertion inside the readiness
test. Neither can pass while a byte-exact digest, ledger projection or policy-mirror check
fails. `npm run check:readiness` remains available on its own, and a test asserts that
`scripts.check` really does invoke the readiness checker.

Each card also declares `fileClass: "isolated"`; the oracles assert all **66** `allowedFiles`
entries are pairwise disjoint across isolated shards.

**Canonical reference sweep.** Every canonical path anywhere in the artifact — including bare
strings inside arrays — is discovered by a recursive walk and must be among the **21**
digests actually verified at `7312ac0`; a decorative or unverified reference fails. The sweep
is itself asserted non-empty so it cannot pass vacuously. Fragment references are classified
honestly rather than counted as canonical paths:

- **Document anchors** (`docs/kernel-sdk-app-delivery-sequence.md#karar` and
  `#adr-0031-teslim-sirasi-guncellemesi`) are recorded as
  `refKind: "anchor-into-pinned-document"` with `isCanonicalPath: false` and
  `verifiedByDigest: false`. The document they point into **is** pinned byte-exact
  (`4f533e92…06113251`) and verified, and the anchors are de-duplicated onto that single
  document.
- **JSON pointers** into pinned reports (`…#/approval`, `…#/ledger/0`) are likewise not
  canonical paths, and each one's base document must be pinned and verified.

`npm run check:readiness` runs `tools/check-kernel-ai-development-readiness.mjs`, a strict
oracle that fails closed on: claimed authority or execution evidence, a materialized planned
path, an absolute or traversing path, an embedded repository root, a self-digest, an
internal id presented as external, a blanket external disposition, edge sets that are not
set-equal to the flattened card edges, an unscoped acyclicity claim, a drifted root or card
key set, a weakened RLS floor, a relaxed lease, MCP invocation, codex as rollback executor,
or a deferred risk promoted to a candidate gate.
