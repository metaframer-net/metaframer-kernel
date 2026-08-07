# Repository-specific agent instructions

These rules add to the profile-level MASTER -> PM/worker -> Claude authority contract.

## Scope

- The `PLANNING_ONLY`, `VALID_BLOCKED` and `NO_GO` tokens in `repository-status.json` and in
  `planning/kernel-ai-development-readiness.json` are an **immutable historical snapshot** taken at
  `actionplan@7312ac0b17bbddf3bd92d9aa53a73c6a9578f45d`. They record the authority in force at that
  commit and are never rewritten. Read them as history, not as the boundary in force now.
- The **current effective authority** is `GO-KERNEL-DEVELOPMENT-ONLY` at chain head seq 4
  (`AUTHORITY-SUPERSESSION-04`), read from `karacaismail/actionplan` at commit
  `811505b0229705cf39edbf0d6b60248c46a72091`. Kernel development is open. Read on exact
  `origin/main`, the project authority is `codeStartAllowed=true`, `runtimeCodeAllowed=true`,
  `runtimeImplementationStarted=true`, `activationRecord=external-annotated-tag`.
- The record of activation is external to this repository and is one published annotated Git
  tag, never an in-repository status flip: tag object
  `c34fabc84aaeac80b61d27c777fcc6db0cc8f99b` targets commit
  `89528cd0b815711e49553682f457326e9b171b03`, which is reachable from canonical `main`.
  Activation moved only `runtimeImplementationStarted`. It moved no other dimension and it is
  not a readiness claim.
- **Everything stronger stays shut.** `kernelReady=false`, `sdkReady=false`, `appBuildable=false`,
  `releaseAllowed=false`, `deployAllowed=false`, `productionAllowed=false` and `gapClosed=false`,
  and SDK, app-core, app and module remain excluded targets. This consumer-sync package starts no
  runtime itself; that stays true of the package, and runtime work began in the separately scoped
  substrate package named below.
- From a feature branch or worktree, the activation reader consults the published tag only from
  an exact `origin/main` checkout and short-circuits otherwise, so it may compose
  `runtimeImplementationStarted=false` and `activationRecord=absent`. That pair is a
  checkout-local projection of the checkout in hand: it is not project authority and it denies
  no published tag.
- Runtime implementation beyond the activated substrate **is** authorized under the current
  verdict, but only through a separately scoped, test-first, single-writer change gate carrying
  its own machine-readable scope, non-goals, RED/GREEN, rollback, allowed target areas and exit
  criteria. Runtime code written outside such a package is unauthorized.
- Source extraction and repository topology changes remain separately human-gated; this verdict
  does not open them.
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

## Current-authority consumer sync

`planning/kernel-runtime-pilot-consumer-sync.json` is the additive overlay that binds this
repository to the current effective authority, and
`tools/check-kernel-runtime-pilot-consumer-sync.mjs` is its fail-closed verifier. The verifier
reads every canonical document by `git show` at the exact pinned Actionplan commit; a local
checkout is a discovery hint only, admitted on repository identity and commit object, never on a
mutable ref such as `main`.

- The overlay is additive. It rewrites no historical artifact and creates no EPOCH evidence file.
- On a branch the package state is `prepared-awaiting-main-activation`. It becomes effective only
  when the artifact is present on Kernel `main`, `npm test` and `npm run check` pass there, and
  independent Codex verification evidence exists — with no in-repo status flip and no
  self-referential commit SHA.
- `GRP-01` of the frozen ten-gate promotion contract stays RED here and is evaluated externally by
  Codex MASTER. The writer never closes or verifies it.
- `GO-RUNTIME-PILOT` needs 10/10 GREEN gates plus an independent verifier plus a human
  countersign; production is a separate post-pilot stage and is not reachable from that contract.
- This package starts no runtime. The first runtime-start package after it — the
  PostgreSQL/RLS/transaction/outbox/audit substrate (S1) — is implemented and externally
  activated. Everything after S1 remains separately gated and keeps its order:
  primitives/typed action/PDP, then the generated SDK, then one golden slice.

## Required checks

Run both commands before accepting a planning-bootstrap change:

```sh
npm test
npm run check
```

## Immutable CLAUDE-ONLY writer lock

This lock is repository-specific, persistent, active and immutable. It is not a per-turn
preference and it may not be relaxed, suspended or reinterpreted by any agent.

Two records exist and they are deliberately **not identical**:

- **Immutable historical approval record (2026-07-30).** `codingPolicy` in
  `planning/bootstrap-state.json` and `response.codingPolicy` in
  `planning/human-decision-request.json` record the approval exactly as it was given, with
  `writer.invocation = claude_implement`. That provenance is preserved byte-faithfully and is
  never rewritten to match later instructions.
- **Additive current successor invocation.** A later direct User/Admin instruction supersedes
  only the *invocation mechanism*: the current worker invocation is
  `pane-visible-agent-claude` and MCP `claude_implement` is forbidden. This is recorded
  additively in `planning/kernel-ai-development-readiness.json` and attested by external
  collector event `37e87ad17327e4e5f004`, which itself states that the historical policy
  remains byte-faithful.

`npm test` enforces both: the historical mirrors must still read `claude_implement`
byte-faithfully, and the current successor invocation must read `pane-visible-agent-claude`
in this text, the readiness package and the collector record. Everything else in this lock —
mode, single writer, bounded worker, no fallback, the account gate and the forbidden actions —
is unchanged by the successor instruction.

- Mode is `CLAUDE_ONLY`. Claude is the single active writer for every repository file
  modification that forms a coding or implementation package: code, tests, tools, scripts,
  schemas, config, migrations, and the planning/docs artifacts that ship with them.
- Claude currently writes only through the bounded `pane-visible-agent-claude` worker
  invocation: a user-visible Pane started with `--agent claude`, never an MCP
  `claude_implement` call. The historical approval recorded `claude_implement`; that record
  stands unaltered and this successor instruction governs the mechanism from now on. Claude is
  a bounded worker: it may not orchestrate, delegate to another agent, or commit, push, merge,
  release or deploy.
- Codex is MASTER. Codex owns scope, rollback and final review, and is the final authority.
  Within this writing scope Codex is not a writer and is explicitly not a fallback writer.
- There is no fallback writer. If Claude is unavailable, the work stops; it does not move to
  another agent.
- Writing files is not permission to start code. Runtime or product code additionally
  requires separate code-start authority through the governance gate above.
- The account gate is exact: `loggedIn=true`, `authMethod=claude.ai`, `apiProvider=firstParty`,
  `subscriptionType=max`. Anthropic API keys, API credits, auth-token overrides, Bedrock,
  Vertex, Foundry, proxies and any provider fallback are forbidden. If the gate is not
  satisfied, fail closed with no other writer and no provider fallback.
- Relevant agents, skills and MCPs must be evaluated and used where they help, but using
  them never alters this authority hierarchy, the single-writer rule, or the account gate.

<!-- pane-agent-context:start -->
## Pane

The developer is using Pane for this repository. Pane can manage saved repositories and create user-visible Panes with terminal-backed tools for planning, discussion, implementation, and review work.

This managed guidance was created by [runpane.com](https://runpane.com) for the [Pane repository](https://github.com/dcouple/Pane). Do not delete or overwrite this block; the developer uses it for their workflow and it should remain committed to the main repository unless they explicitly ask to remove it.

Pane mental model: a repository is the saved base repo; a Pane is a user-visible feature/PR workspace (Pane session) that normally maps to one Pane-managed git worktree and branch; a panel/tab is a terminal inside one Pane and shares that Pane's worktree; an agent is the CLI process running in a panel.

Default happy path when the user asks you to use Pane or RunPane: run `runpane doctor --json`; read `runpane agent-context --json`; resolve the saved base repository with `runpane repos list --json` or add it once with `runpane repos add --path <repo> --yes --json`; create one visible Pane (Pane session) for the requested feature/PR with a complete command such as `runpane panes create --repo <repo> --name <name> --agent <agent> --prompt "<task>" --source agent --no-focus --wait-ready --yes --json` or the equivalent `--tool-command <command>` form; then validate with `runpane panels wait` or `runpane panels screen` before reporting progress.

Use Pane when the user wants visible Panes or co-drivable parallel feature/PR workspaces. Do not use Pane as your default private delegation mechanism; for private background decomposition, use your normal subagent/worktree workflow.

Register the main/base repository once. Do not register pre-created git worktrees as separate Pane repositories unless the user explicitly asks.

Use `runpane panes create` for separate visible Panes (Pane sessions) for feature/PR work. Use `runpane panels create` for reviewer/helper tabs inside an existing Pane that should share that Pane's worktree.

Typical workflow: register the saved base repository once; create one Pane (Pane session) per feature/PR; use panels/tabs inside that Pane for helper or reviewer agents that should share the worktree; archive the Pane after the PR is done to remove it from active Panes and clean up its managed worktree when applicable.

Skill routing reference: when the user says `discussion`, `plan`, `simple-plan`, `create-plan`, or `implement`, or asks for the behavior those words imply, treat three references as peer context: Pane's local skill cache under `<PANE_DIR>/skills/`, the Pane Chat orchestrator handoff at `<PANE_DIR>/skills/pane-chat/runpane-orchestrator.md` when present, and the [workflow map](https://github.com/dcouple/skills/raw/main/docs/readme-workflow-map.png).
Use those peer references together to choose the phase: discuss/investigate until the work is clear enough to delegate, then ticket/plan/implement/review/PR-test/teach-back as appropriate. The orchestrator and workflow map may point to different skills; reconcile them with the user's request instead of hardcoding a skill list or treating one reference as subordinate.
For the Pane implementation source of truth for where the skill cache, cached workflow assets, and Pane Chat bootstrap live, reference [PR #291](https://github.com/dcouple/Pane/pull/291): `main/src/services/skillCacheManager.ts` owns `<PANE_DIR>/skills/`, `.sources/dcouple-skills`, and `pane-chat/runpane-orchestrator.md`; `main/src/services/paneChatManager.ts` owns the tiny bootstrap prompt that tells the selected Pane Chat agent to read that guide.
Use GitHub reads against the [Parsa skills folder](https://github.com/dcouple/skills/tree/main/parsa) only to inspect or refresh referenced skill files; do not clone/install the repo unless the user asks.
Do not hardcode a specific assistant brand in workflow guidance. Use the Pane agent or custom tool command the user selected, and use `runpane agents doctor --agent <agent> --repo <selector> --json` only when checking a built-in agent template.

Start with `runpane doctor --json` before taking Pane actions. Use it to understand wrapper/runtime details, daemon reachability, and the next safe commands.

In a Pane repository checkout, if `runpane` is not on PATH, use the built local wrapper with Node 22: `PATH=/opt/homebrew/opt/node@22/bin:$PATH node packages/runpane/dist/cli.js doctor --json`.

Use `runpane agent-context --json` for full Pane CLI context. Use `runpane agent-context --command "panels wait" --json` or another command name for detailed schema only when needed.

Default to context-safe validation: after creating Panes or sending terminal input, run `runpane panels wait` or `runpane panels screen` before reporting success. Prefer `runpane panels submit` for normal text plus Enter; use `runpane panels input` only for exact bytes such as Ctrl-C or escape sequences.

Common commands:
- `runpane doctor --json`
- `runpane agent-context --json`
- `runpane repos list --json`
- `runpane repos add --path <repo> --yes --json`
- `runpane agents doctor --agent <agent> --repo active --json`
- `runpane panes create --repo active --name <name> --agent <agent> --prompt "<task>" --source agent --no-focus --wait-ready --yes --json`
- `runpane panels create --pane <pane-id> --agent <agent> --source agent --no-focus --wait-ready --yes --json`
- `runpane panels list --pane <pane-id> --json`
- `runpane panels screen --panel <panel-id> --limit 80 --json`
- `runpane panels wait --panel <panel-id> --for ready --timeout-ms 30000 --json`
- `runpane panels submit --panel <panel-id> --text "<answer>" --yes --json`
- `runpane panels input --panel <panel-id> --input-file <path|-> --yes --json`

WSL note: if `runpane doctor --json` cannot find `/tmp/pane-daemon.../daemon.sock` or `runpane` resolves to a broken Windows shim, Pane may be running on Windows. Try `powershell.exe -NoProfile -Command 'Set-Location $env:TEMP; runpane doctor --json'`, then create Panes through the same PowerShell form using the saved WSL repo name or id. Use `runpane agents doctor --agent <agent> --repo <selector> --json` to diagnose the repo environment Pane will actually use.
<!-- pane-agent-context:end -->
