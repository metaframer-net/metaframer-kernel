# Repository Boundary

Status: `PLANNING_ONLY / VALID_BLOCKED / NO_GO`

Date: 2026-07-16

## Decision context

The previously active platform contract places kernel code inside one private `platform`
monorepo and forbids a separate code repository. The Admin's explicit instruction to create
`metaframer-net/metaframer-kernel` supersedes that prohibition only for repository creation
and this planning-only bootstrap.

The instruction is not interpreted as a silent source migration. No suitable isolated
MetaFramer runtime-kernel checkout currently exists:

- `atonota/kernel` is a separate Metawork CI/CD project and is out of scope;
- the current `platform` workspace is an integrated monorepo, not an isolated kernel tree;
- Actionplan kernel worktrees contain governance and handoff artifacts, not runtime code.

## Canonical ownership today

| Surface | Current owner |
| --- | --- |
| Governance, decisions, WBS, completion evidence | Actionplan |
| Existing implementation workspace | `platform` monorepo |
| Future standalone kernel source | This repository, conditionally, after the canonical gate |
| This repository | Reserved planning boundary only |

No content in this repository changes those ownership rules by implication.

The topology state is `APPROVED_CONDITIONAL`. The recorded human decision `T01-A` names
`metaframer-net/metaframer-kernel` as the future owner of kernel runtime and public kernel
contracts, but that ownership activates only after every canonical KGA decision is closed.
Until then Actionplan remains the governance owner and the `platform` monorepo remains the
implementation workspace. History strategy is `CLEAN_START_WITH_PROVENANCE` under `T02-A`:
no platform history is copied, filtered, mirrored or extracted, and `sourceExtraction`
remains `false`.

## Required decision before source arrives

A human-approved topology/extraction record must define at least:

1. canonical repository and package ownership;
2. whether history is moved, filtered, mirrored, or started cleanly;
3. allowed dependency direction: Edition/App -> SDK -> Kernel;
4. boundaries for DB/RLS/transaction/outbox/audit, primitives, SDK, and apps;
5. CI, release, deployment, security, and rollback ownership;
6. how Actionplan traceability and completion evidence reference the new source; and
7. the exact cutover and rollback gates.

Until that record and the ten-decision gate are complete, runtime source directories are
intentionally absent.

## Completion semantics

Documentation and repository checks can validate this boundary, but they cannot prove a
runtime, MVP, application build, release, or production deployment. The repository status
must remain fail-closed until real evidence changes it through an approved decision.
