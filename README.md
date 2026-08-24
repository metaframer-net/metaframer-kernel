# MetaFramer Kernel

Under the decisions currently in force, `metaframer-net/metaframer-kernel` is the canonical
destination — the target repository — for the MetaFramer runtime kernel and its generated
SDK. That names where this work belongs, not a claim that it has arrived: no source has been
extracted from the `platform` monorepo, that extraction stays behind a human gate, and
kernel development proceeds here only through separately scoped change packages. Development
is open under the current effective authority: the substrate is implemented and activated, the
kernel primitives and ports stage is in progress through separately scoped packages, and every
stage after it is still closed.

## Vision / Vizyon

Direction, not description: nothing in this section is an implemented-state claim, and
nothing here changes a flag under **Current status**.

MetaFramer's target identity is an AI-native enterprise application kernel: a deterministic execution core, a governed control-plane, and a generated SDK/Surface ecosystem. It is not a general web-framework replacement and not a current readiness claim.
Django, FastAPI, Flask, Symfony and Frappe stay delivery hosts, reference implementations,
adapters or comparison baselines, never substitutes for the semantic Kernel.

AI proposes, plans, classifies, and explains; the deterministic Kernel validates, authorizes, applies, and commits. AI-off critical SaaS remains safe.
No business invariant is decided by a model and no model call happens inside a Kernel
transaction, so critical flows keep working with AI switched off entirely.

The 90 named gaps are a finite evidence program, not 1,000 applications or domain code loaded into Kernel.
Ownership stays separated and machine-enforced:

- Kernel — identity/tenancy, policy/capability, the deterministic action pipeline,
  invariants, unit-of-work/change/audit/outbox/event contracts, the ArcheType IR contract.
- platform — generated SDK, control plane, Surface and PWA projections, delivery hosts,
  adapters, workflow and connector runtimes, developer tooling.
- application — domain rules, aggregates, screens and product integrations, never touching
  Kernel internal types and never bypassing the policy, unit-of-work and audit path.
- external engines — search, OLAP/warehouse, media, model serving, route optimization and
  payment switches, behind typed adapters, never copied inward.

A capability serving one family belongs to platform or application, not to Kernel.

The program requires a strong ArcheType IR as the single canonical source, a machine-readable self-documenting contract graph an agent can search for the nearest correct reference or example before proposing code, one canonical implementation path per operation type, and negative tests for every forbidden alternative, with no hidden magic and no second parallel architecture; the only exit is an explicit ADR carrying evidence, migration and rollback.

Multi-LLM combine is governed, provenanced, and budgeted; model output never directly produces side effects.
A model may only propose a request that the deterministic path then validates and authorizes.

Security and performance are promotion gates: tenant isolation, policy/capability, audit/outbox, P95/P99/cost/fairness, and HA/DR claims require evidence.
Each needs reproducible evidence, independent review and a human decision; invented
thresholds are refused, and budgets are calibrated from a first clean baseline.

PWA/offline foundation uses generated/protocol Surface; MetaFramer is not a native-mobile framework.
Native UI toolkits, mobile lifecycle frameworks, device drivers, navigation and general
component frameworks, and store publishing are declared non-goals.

External usability is proven only by at least three independent teams working from published
docs, generated SDK, reference examples and diagnostics, with ownerHelpCount=0 in the
accepted run; owner help hidden from the evidence is falsification.

This vision does not make MetaFramer frameworkCompetitive, current/up-to-date, or ready.
Each dimension keeps its own evidence package, independent review and human decision.

In the living specification authority split, human governance controls permission, scope, and promotion; implemented semantics are code, types, schemas, and executable tests.
Those outrank any intent sentence in any document, including this one, and generated
projections are repaired one way only, projection corrected to source.

Brand tokens must not rename semantic/security types; they create no callable aliases and no code.

## Current status

For the fixed-denominator (25 atomic packages across 8 delivery phases/families) roadmap, the
approved dependency DAG, the execution model and the sole machine-readable current-truth
source, see [ROADMAP.md](ROADMAP.md) and
[`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json). Neither
document moves any flag below; they only project the state already recorded here.

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
module imports outward. `src/adapters`, `src/delivery` and `src/sdk` exist as separately
authorized, permitted-but-not-required boundaries under
[`tools/check-repository-boundary.mjs`](tools/check-repository-boundary.mjs); each currently
holds only the CreateCustomer-specific golden-slice pieces (a Postgres commit adapter, ASGI
host-boundary composition, and a generated client), not a generic ring. `src/application` is
the permitted Application ring of the onion, not an end-user app and not a delivery surface.

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

**M1-08 — the PolicyDecision protocol values.**
[`src/application/policy-decision.mjs`](src/application/policy-decision.mjs) ·
[`tests/kernel-policy-decision.test.mjs`](tests/kernel-policy-decision.test.mjs) ·
change gate: [`planning/kernel-policy-decision-protocol-pkg11.json`](planning/kernel-policy-decision-protocol-pkg11.json)
(`p01-pkg11-policy-decision-protocol`, status `implementation-complete-external-evidence-pending` —
targeted 8/8 GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a
fresh independent review are not yet recorded. The in-repo package status is immutable and is
never flipped in-repo after QA; completion of QA1, QA2 and the fresh independent review is
recorded externally, so no readiness or release claim is made here)

Exports `PolicyRequest` and `PolicyDecision`: the two halves of a decision protocol M1-07 named
but deliberately did not build. A `PolicyRequest` takes exactly `{action, resource, context}`;
`action` must be an exact genuine `Command` or `Query`, kept by reference, and `tenantId` /
`actorId` are read off `action.principal` on every access rather than stored. `resource` and
`context` are canonicalised by the same rule `Command` and `Query` already apply to a payload —
sorted keys, deep freeze, and a refusal for a custom or null prototype, an unsafe key, an
accessor, a symbol key, a non-finite number, a cycle or a value repeated by reference. A
`PolicyDecision` takes exactly `{effect, reason, matchedPolicyId, traceId}`: `effect` is exactly
`"allow"` or `"deny"`; `reason` is bounded, trimmed, nonempty, control-character-free text;
`matchedPolicyId` is `null` only where a deny stands for no match found, otherwise a bounded
lowercase canonical id, and is required and non-null once `effect` is `"allow"`; `traceId` must
be an exact genuine `CorrelationId`. Both types are frozen, exact-class values with stable
JSON/string forms and no default export.

*Non-goals:* still no evaluator, no policy decision point or enforcement point, no rule
matching, no combining algorithm, no RBAC, ReBAC or ABAC, no row-level access story, no audit
log, no cache, and no generated client. Naming these two value types is not the same as
building the thing that produces or consumes them: nothing here evaluates a `PolicyRequest`
into a `PolicyDecision`, and no substrate row-level-security integration exists or is claimed.

**M1-09 — the AuthorizationEvaluator.**
[`src/application/authorization-evaluator.mjs`](src/application/authorization-evaluator.mjs) ·
[`tests/kernel-authorization-evaluator.test.mjs`](tests/kernel-authorization-evaluator.test.mjs) ·
change gate: [`planning/kernel-authorization-evaluator-pkg12.json`](planning/kernel-authorization-evaluator-pkg12.json)
(`p01-pkg12-authorization-decision`, status `implementation-complete-external-evidence-pending` —
targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded. The in-repo package status is immutable and is never
flipped in-repo after QA; completion of QA1, QA2 and the fresh independent review is recorded
externally, so no readiness or release claim is made here)

Exports `AuthorizationEvaluator`, a frozen, stateless, no-arg class. Its one method,
`decide({request, candidates})`, is entirely synchronous and pure: `request` must be an exact
genuine `PolicyRequest`; `candidates` must be an exact, dense array of candidates, each either the
exact ordinary legacy `{policyId, effect, applies}` shape or the exact ordinary v2
`{policyId, effect, applies, priority, layer}` shape (every other shape refused), each `policyId` a
bounded lowercase canonical id, each `effect` exactly `"allow"` or `"deny"`, each `applies` a
primitive boolean, each v2 `priority` a safe integer, each v2 `layer` exactly `"system"`,
`"platform"` or `"tenant"`, with no duplicate `policyId` across the array regardless of shape. A
legacy candidate is normalized internally only, to priority `0` and layer `"tenant"`, without
mutating the caller's object or altering the public `PolicyDecision` shape. It combines the
already-scoped candidates it is given, and derives no candidate of its own: no applicable
candidate defaults to deny with `matchedPolicyId` `null`; an applicable deny always outranks every
applicable allow, whatever its priority or layer; the winner within the deciding effect is chosen
by priority descending, then layer `system` > `platform` > `tenant`, then canonical `policyId`
ascending, independent of array order. The returned `PolicyDecision` carries
`request.action.correlationId` as `traceId`, by identity, and neither the request nor the
candidates are ever mutated.

*Non-goals:* still no rule or condition evaluated against `resource`/`context`, no
role/permission/grant model, no row-level access story, no record of a decision once made, no
lookup, no I/O, and no generated client. `AuthorizationEvaluator` combines candidate outcomes it
is handed; it is not the central policy decision point that produces those candidates, and
naming it does not open one.

**M1-10 — the PolicyDecisionPoint.**
[`src/application/policy-decision-point.mjs`](src/application/policy-decision-point.mjs) ·
[`tests/kernel-policy-decision-point.test.mjs`](tests/kernel-policy-decision-point.test.mjs) ·
change gate: [`planning/kernel-policy-decision-point-pkg13.json`](planning/kernel-policy-decision-point-pkg13.json)
(`p01-pkg13-central-policy-decision-point`, status `implementation-complete-external-evidence-pending` —
targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded. The in-repo package status is immutable and is never
flipped in-repo after QA; completion of QA1, QA2 and the fresh independent review is recorded
externally, so no readiness or release claim is made here)

Exports `PolicyDecisionPoint`, a frozen class carrying one injected `{candidatesFor}`
collaborator and one internal, private `AuthorizationEvaluator` instance constructed per
`PolicyDecisionPoint`. Its one method, `decide(request)`, is async: it rejects an exact genuine
`PolicyRequest` check before ever touching the collaborator, calls `candidatesFor` exactly once
with an undefined receiver and the request by identity, awaits its ordinary resolution once, and
passes whatever it resolved — unchanged, alongside the exact request — into the internal
`AuthorizationEvaluator`, answering with its exact `PolicyDecision`. A thrown or rejected error
from `candidatesFor` surfaces by identity as `decide`'s rejection; nothing is mutated, cached,
retried, timed out, queued, defaulted or evaluated a second time.

*Non-goals:* this is central orchestration of already-scoped candidate outcomes and nothing
more. It derives no candidate and matches no rule or policy statement of its own — `candidatesFor`
is supplied by the caller; no RBAC, ABAC or ReBAC model is introduced; no row-level-security
integration exists or is claimed; there is no enforcement point, no SDK, app, module or delivery
surface, and no readiness or release claim is made.

**P04b2 — the PolicyCandidateResolver.**
[`src/application/policy-candidate-resolver.mjs`](src/application/policy-candidate-resolver.mjs) ·
[`tests/kernel-policy-candidate-resolver.test.mjs`](tests/kernel-policy-candidate-resolver.test.mjs) ·
change gate: [`planning/kernel-policy-candidate-resolver-p04b2.json`](planning/kernel-policy-candidate-resolver-p04b2.json)
(targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded, so no readiness or release claim is made here)

Exports `PolicyCandidateResolver`, a frozen class carrying a fixed array of genuine
`PolicyStatement` rows. Its one method, `candidatesFor(request)`, is synchronous: it refuses a
non-genuine `PolicyRequest` with a `TypeError` before any of its own-property getters are ever
touched, then maps each statement to the exact ordinary v2 candidate shape `PolicyDecisionPoint`
and `AuthorizationEvaluator` already accept unchanged — `{policyId, effect, applies, priority,
layer}`. A candidate's `applies` requires the statement enabled, its `targetAction` and
`targetResourceType` to equal the request's exactly, its `targetActor` (only the optional
`tenantId`/`actorId` string keys) to match, and its `condition` to be empty; any grammar
violation or unsupported condition fails closed to `applies=false`, never thrown, never
evaluated. Resolving is deterministic, order-independent, and mutates neither the supplied
statements, any `PolicyStatement`, nor the `PolicyRequest` passed in.

*Non-goals:* no combining algorithm, deny-overrides execution or decision — that is
`AuthorizationEvaluator`/`PolicyDecisionPoint`'s job, unchanged; no condition evaluator beyond
the empty-object unconditional case; no persistence, statement store, cache or batch; no
enforcement point, SDK, app, module or delivery surface, and no readiness or release claim is
made.

**P04c — the PolicyBatchEvaluator.**
[`src/application/policy-batch-evaluator.mjs`](src/application/policy-batch-evaluator.mjs) ·
[`tests/kernel-policy-batch-evaluator.test.mjs`](tests/kernel-policy-batch-evaluator.test.mjs) ·
change gate: [`planning/kernel-policy-batch-evaluator-p04c.json`](planning/kernel-policy-batch-evaluator-p04c.json)
(targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded, so no readiness or release claim is made here)

Exports `PolicyBatchEvaluator`, a frozen class whose constructor delegates exact
`{candidatesFor}` validation to one internal `PolicyDecisionPoint`. Its one method,
`decideAll(requests)`, is async: it preflights an ordinary dense array of exact genuine
`PolicyRequest` values — refusing a non-array, sparse, or counterfeit-element input with a
`TypeError` before any collaborator or hostile getter is ever touched — admits an empty array as
ordinary input without ever calling the collaborator, then sequentially awaits one PDP decision
per request in exact input order, stopping and rejecting with the collaborator's own error on the
first failure with no partial result produced, and answers with a new ordinary frozen decision
array. Deterministic and non-mutating: neither the input array nor any `PolicyRequest` inside it
is altered.

*Non-goals:* no candidate derivation or combining logic beyond what `PolicyDecisionPoint` already
does; no decision log, persistence, PEP, SDK, UI, config, release or deploy surface, and no
readiness or release claim is made.

**P04d — DecisionLogEntry and the DecisionLogPort.**
[`src/application/decision-log-entry.mjs`](src/application/decision-log-entry.mjs) ·
[`src/application/decision-log-port.mjs`](src/application/decision-log-port.mjs) ·
[`tests/kernel-decision-log.test.mjs`](tests/kernel-decision-log.test.mjs) ·
change gate: [`planning/kernel-decision-log-p04d.json`](planning/kernel-decision-log-p04d.json)
(targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded, so no readiness or release claim is made here)

Exports `DecisionLogEntry`, a frozen value type carrying one policy decision's fixed, hashable
record — a canonical ULID `id`, the genuine `PolicyRequest`/`PolicyDecision` pair it covers, a
`layerResolved` (`"system"`/`"platform"`/`"tenant"`, `null` only for a default-deny), a canonical
UTC millisecond ISO `ts`, and a `prevHash` (`null` or lowercase 64-hex). It refuses a
`decision.traceId` that is merely value-equal to `request.action.correlationId` and admits only
the exact same `CorrelationId` instance by identity. Every covered field is fixed at construction
into one JSON payload, and `entryHash` is the `node:crypto` SHA-256 of exactly that payload — no
ambient clock, id, random or I/O anywhere in the module. `DecisionLogPort` is a one-method
forwarding seam: `append(entry)` refuses anything but a genuine `DecisionLogEntry` before its
collaborator is ever called, then forwards to it with an undefined receiver, preserving the
collaborator's resolved or rejected identity unchanged.

*Non-goals:* no persisted-row verifier, no DB/RLS/WORM, no PDP/batch wiring, no read/update/
delete/latest/replay/query method or API, no retry/queue/cache, and no readiness or release
claim is made.

**P04e1 — the `policy_decision_log` DB substrate.**
[`db/metaframer_kernel_db/alembic/versions/0003_policy_decision_log.py`](db/metaframer_kernel_db/alembic/versions/0003_policy_decision_log.py) ·
[`db/tests/test_policy_decision_log.py`](db/tests/test_policy_decision_log.py) ·
change gate: [`planning/kernel-decision-log-db-p04e1.json`](planning/kernel-decision-log-db-p04e1.json)
(targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded, so no readiness or release claim is made here)

A third Alembic revision, chained onto `0002_customer_records`, adds a dedicated table for
P04d's hash-chain payload — never a reuse of `audit_log`. FORCE row-level security, a runtime
role limited to SELECT/INSERT, and a table-specific append-only trigger match the rest of the S1
substrate; CHECK constraints additionally bind `payload.id`/`payload.prevHash`/
`payload.requestActor.tenantId` to their columns and reject a self-link, and a self-referencing
foreign key plus two partial unique indexes cap each tenant to one genesis row and each
predecessor to one successor.

*Non-goals:* no canonical hash recomputation or verification (P04e2), no read/query API, no PEP/
PDP wiring, and no readiness or release claim is made.

**P04e2 — the `PostgresDecisionLogAdapter`.**
[`src/adapters/postgres-decision-log-adapter.mjs`](src/adapters/postgres-decision-log-adapter.mjs) ·
[`tests/postgres-decision-log-adapter.test.mjs`](tests/postgres-decision-log-adapter.test.mjs) ·
change gate: [`planning/kernel-decision-log-adapter-p04e2.json`](planning/kernel-decision-log-adapter-p04e2.json)
(targeted GREEN locally against a real Docker PostgreSQL 16; `npm test`, `npm run check`, QA1, the
required CI QA2 run and a fresh independent review are not yet recorded, so no readiness or
release claim is made here)

Exports `PostgresDecisionLogAdapter`, whose `append(entry)` is the whole surface: tenant is
derived only from `entry.request.tenantId`, and `adapter.append` is a bound-safe instance field,
so `new DecisionLogPort({ append: adapter.append })` needs no `.bind(adapter)`. One transaction —
`BEGIN`; `SELECT mfk_begin_tenant_context($1::uuid)`; `INSERT ... RETURNING id, tenant_id,
entry_hash, prev_hash, payload`; verify the returned row; `COMMIT` — writes into P04e1's
`policy_decision_log`, rolling back and releasing the client on any failure. The three known
chain-integrity SQLSTATE violations (duplicate genesis, fork, orphan predecessor) surface as one
frozen, non-retryable `DecisionLogChainConflictError` (`DECISION_LOG_CHAIN_CONFLICT`); every other
database error propagates unmasked. The pure, exported `verifyPersistedDecisionLogRow` never
trusts `entry.entryHash` as an oracle: it recomputes P04d's canonical SHA-256 from the row's own
payload — after undoing whatever key order a JSONB round-trip left it in and binding
id/tenant_id/prev_hash to that payload — refusing hash mismatch, binding drift, or any missing,
extra or mistyped field with a `DecisionLogIntegrityError`.

`tools/check-kernel-persistence-ownership.mjs` gained one analogous optional field,
`kernelCapabilityAdapterFiles` — inert unless a manifest opts in, and then only to restate the
frozen `["postgres-decision-log-adapter.mjs"]` declaration exactly, exactly as
`kernelCapabilityMigrations` already worked for `0003_policy_decision_log.py`.

*Non-goals:* no PDP/batch wiring, no read/query/replay API, no retry/queue/cache, no application
caller of this adapter, and no readiness or release claim is made.

**P04f — the `DecisionLoggingPolicyDecisionPoint`.**
[`src/application/decision-logging-policy-decision-point.mjs`](src/application/decision-logging-policy-decision-point.mjs) ·
[`tests/kernel-decision-logging-policy-decision-point.test.mjs`](tests/kernel-decision-logging-policy-decision-point.test.mjs) ·
change gate: [`planning/kernel-decision-log-wiring-p04f.json`](planning/kernel-decision-log-wiring-p04f.json)
(targeted GREEN locally; `npm test`, `npm run check`, QA1, the required CI QA2 run and a fresh
independent review are not yet recorded, so no readiness or release claim is made here)

Exports `DecisionLoggingPolicyDecisionPoint`, a frozen ordinary constructor
`{candidatesFor, decisionLog, idGenerator, clock, chainHead}` wiring `AuthorizationEvaluator` to
`DecisionLogPort`. `decide(request)` calls `candidatesFor` once, calls
`AuthorizationEvaluator.decide` once against the already-fetched candidates, derives
`layerResolved` by locating the winning `matchedPolicyId` back in those same candidates (a v2
candidate's own `layer`, `"tenant"` for a winning legacy three-key candidate, `null` for a
default-deny), and builds one genuine `DecisionLogEntry` from `idGenerator()`, `clock.now()` and
`chainHead(tenantId)` before awaiting `decisionLog.append` and resolving with the exact
`PolicyDecision`. `decideAll(requests)` fully preflights every request before touching any
collaborator, processes sequentially in input order, reads `chainHead` once per tenant per batch,
links every later same-tenant entry from the prior successfully appended entry's own `entryHash`,
and stops at the first failure with no partial result ever observed.

*Non-goals:* concurrent-call locking, a concrete chain-head reader, retry/queue/cache/replay/PEP/
HTTP/SDK/UI/simulation, and no readiness or release claim is made.

## Authorized order and what remains closed

The authorized order is: DB / RLS / transaction / outbox / audit (S1, implemented and
activated) → kernel primitives, typed action and PDP → generated SDK → one walking-skeleton
golden slice.

The second stage is under way and is not finished. The primitives, the typed action contracts,
the ports, the PolicyDecision protocol values, the candidate-outcome combining rule and the
central `PolicyDecisionPoint` orchestration listed above are implemented; what that stage still
lacks is the piece that scopes candidates in the first place — `src/application/policy.mjs`
forwards a question and decides nothing, `src/application/policy-decision.mjs` names the shape
of a question and an answer without evaluating either, `src/application/authorization-evaluator.mjs`
combines candidate outcomes it is given without deriving any of them from a rule, and
`src/application/policy-decision-point.mjs` orchestrates that combining step around a
caller-supplied `candidatesFor` without deriving a candidate itself. Rule/candidate derivation
and RLS integration remain unimplemented, so the typed-action/PDP stage is not yet complete. The
generated SDK and the golden slice remain closed and unstarted, and nothing here may be read as
opening them.

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

## Token economy

A projection of `token-economy-policy.json`, which is the canonical owner of every rule,
threshold, model route and escalation gate named here. Two surfaces implement it:

- `tools/token-guard.mjs` — a deterministic gate that decides nine things from facts at **zero
  model cost**: duplicate worker, duplicate file read, writer ownership, dirty snapshot,
  branch/worktree collision, guardian admission, stale review, the commit/push gate, and
  completed panel cleanup. Exit `0` proceed, `3` denied by a fact, `4` escalate.
- `.claude/agents/token-governor.md` — a read-only auditor with no write tools, reached only at
  the declared gates and never wave by wave. It advises; it never commands, and it is required to
  pay for itself: a net-negative ledger switches its automatic invocation off while the
  deterministic gate stays on.

Quality is not one of the levers. The policy states plainly that a security test, a negative
test and an independent review may never be dropped to save tokens, and
`tools/check-token-economy.mjs` fails if those declarations change. What that enforces is
document drift, not the act itself: the skill and the agent are prose a model may or may not
obey. Only `tools/token-guard.mjs` decides anything mechanically.

Model routing escalates `haiku` → `sonnet` → `fable` → `opus` by task risk and evidence need,
never by cost alone and never automatically on failure. The per-tier `use` and `doNotUse` lists
live in `token-economy-policy.json` and are projected in full into the skill rather than copied
here; `fable` additionally requires a live identity check and is never assumed.

**What the live reader can and cannot observe.** A bare CLI run sees the git worktrees and the
guardian admission decision, so it decides four of the nine checks on its own. It cannot observe
the session read log, the live worker registry, writer ownership, prior reviews or open panels —
those live in the orchestration layer and must be supplied through `--facts`. When they are
absent the gate escalates rather than passing, because an unobservable registry is not an
empty one — except completed-panel cleanup, which advises instead, since a leaked panel is a
cost report rather than a blocking fact. `readGuardian` also shells out to `guardianctl`, a machine-local binary outside this
repository; when it is missing the guardian check escalates.

```sh
npm run check:token-economy         # canonical policy and every projection agree
node tools/token-guard.mjs --request='{"action":"open-worker","taskSignature":"x","opensWorker":true}'
```
