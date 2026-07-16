# MetaFramer Kernel

This private repository reserves the `metaframer-net/metaframer-kernel` identity for the
future MetaFramer runtime-kernel boundary.

## Current status

- Classification: `PLANNING_ONLY`
- Runtime: `VALID_BLOCKED`
- Release decision: `NO_GO`
- Runtime implementation: absent
- MVP / buildable application / production readiness: not claimed

The initial push contains governance and repository-boundary material only. It does not
copy or rename the unrelated `atonota/kernel` project, and it does not move the current
`platform` monorepo into this repository.

## Scope of the repository-creation override

An explicit Admin instruction on 2026-07-16 authorizes creating this repository and
pushing this planning-only bootstrap. That instruction overrides the prior prohibition on
the *existence* of a separate repository for this narrow purpose only.

It does not yet:

- select this repository as the canonical runtime source;
- authorize a code split or extraction from the `platform` monorepo;
- close the full kernel governance decision gate;
- authorize runtime, deployment, release, or production work; or
- make local, CI, runtime, or deployment evidence exist.

## Runtime entry gate

Runtime work remains blocked until all ten kernel governance decisions are closed in the
canonical decision registry and a human-approved topology/extraction decision names the
canonical source owner. Authorized implementation order after that gate is:

1. DB / RLS / transaction / outbox / audit
2. kernel primitives
3. SDK
4. walking skeleton

Production `GO` additionally requires real PR, CI, runtime, deployment, rollback, and
completion-gate evidence with exit code `0`.

## Canonical planning source

Kernel governance, decision records, WBS content, and completion-gate evidence remain in
the [Actionplan publication](https://karacaismail.github.io/actionplan/) until an explicit
human decision changes their ownership.

See [Repository Boundary](docs/repository-boundary.md) for the exact source and authority
limits of this bootstrap.

## Local verification

```sh
npm test
npm run check
```
