# Repository-specific agent instructions

These rules add to the profile-level MASTER -> PM/worker -> Claude authority contract.

## Scope

- This repository is `PLANNING_ONLY`, `VALID_BLOCKED`, and `NO_GO`.
- Repository creation is authorized; runtime implementation and source extraction are not.
- Do not describe this repository as runtime-ready, MVP, buildable, releasable, or
  production-ready.
- Do not copy `atonota/kernel`; it is an unrelated Metawork CI/CD project.
- Do not copy, move, or split the current `platform` monorepo without an explicit,
  human-approved topology/extraction decision.
- Actionplan remains the canonical governance and decision source until ownership is
  explicitly changed.

## Change gate

Before adding runtime code, all ten kernel governance decisions must be closed and the
canonical source owner, extraction boundary, history strategy, dependency direction, and
rollback plan must be approved. Runtime work must then follow the authorized sequence:
DB/RLS/transaction/outbox/audit -> kernel primitives -> SDK -> walking skeleton.

Every change is test-first, uses a single active writer, preserves user changes, and is
independently verified by Codex. Commit, push, merge, release, deployment, destructive Git,
and human decisions require explicit authority.

## Required checks

Run both commands before accepting a planning-bootstrap change:

```sh
npm test
npm run check
```
