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
| Future standalone kernel source | Pending explicit human topology decision |
| This repository | Reserved planning boundary only |

No content in this repository changes those ownership rules by implication.

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
