# Versioning and changelog policy

This is a human-readable projection of `versioning-policy.json`. That file is canonical; this
one explains it. Where the two ever disagree, the JSON is right and this document is the thing
that drifted.

## 1. One canonical owner, one direction

`versioning-policy.json` at the repository root is the only place a version or policy value is
decided. Four documents project it:

```
versioning-policy.json                        (canonical — the only place a value is decided)
        │
        ├──► package.json # version           (the npm-visible identity)
        ├──► CHANGELOG.md                     (the Keep a Changelog 1.1.0 human document)
        ├──► README.md # Versioning and changelog   (current-authority prose)
        └──► docs/versioning-policy.md        (this narrative)
```

Parity runs one way only. `tools/check-versioning-changelog.mjs` reads the canonical values and
asserts each projection equals them, and every drift finding names the projection that moved:
`parity-drift:package.json#version: projection reads … restore the projection`. The reverse
repair — editing the canonical file until it agrees with a copy — is never the fix, because it
turns a projection into a second source, and two sources is how a version becomes a matter of
opinion.

The policy lives at the repository root rather than under `planning/`, because the README frames
`planning/` as a historical bootstrap snapshot. A live policy filed there would inherit the wrong
reading.

## 2. The current value, and why it is not a release

The current version is `0.1.0-alpha.1`. The value it replaced, `0.0.0-planning`, is recorded in
the policy as `currentVersion.previousValue` and is preserved rather than erased.

- `0.0.0-planning` is syntactically valid Semantic Versioning: the version core `0.0.0` plus the
  alphanumeric pre-release identifier `planning`. It was therefore always a pre-release of a
  version that was never released — a planning placeholder, never a release.
- `0.1.0-alpha.1` is likewise a pre-release. SemVer rule 9 says a pre-release version is unstable
  and may not satisfy the intended compatibility requirements.
- The move is a pointer change on an unpublished, private package identity. It publishes nothing,
  tags nothing, produces no artifact, and creates no version section in `CHANGELOG.md`. The
  correct word is *train entry*. It is not a release, a cut, a ship or a bump.
- It is precedence-forward: `0.0.0` ranks below `0.1.0` on the version core before any pre-release
  identifier is consulted, so nothing in the recorded history is reordered or rewritten.

`alpha.1` and not something else, because the counter starts at one, leading zeroes are refused,
and a bare `0.1.0-alpha` would leave the very first transition ambiguous — by SemVer rule 11 a
larger set of pre-release fields ranks higher, so `0.1.0-alpha` sits below `0.1.0-alpha.1`.

## 3. Two gates, deliberately separate

Syntactic validity and this project's policy are independent, and conflating them is how a
ceiling gets escaped by a string that "looks fine".

| Version string | SemVer 2.0.0 syntax | This project | Why |
|---|---|---|---|
| `0.1.0-alpha.1` | valid | permitted | on the train, counter ≥ 1 |
| `0.1.0-rc.11` | valid | permitted | on the train, final stage |
| `0.1.0` | valid | **refused as a current value** | the terminus; reaching it is a human completion decision |
| `0.1.0-alpha.01` | **invalid** | refused | rule 9: numeric identifier with a leading zero |
| `01.1.0` | **invalid** | refused | rule 2: leading zero in the version core |
| `0.1.0-alpha.0a` | valid | refused | `0a` is alphanumeric, so no leading-zero rule fires — but the counter must be numeric |
| `0.1.0-alpha.1+001` | valid | refused | build metadata is ignored for precedence, so it breaks the one-current-version property |
| `0.1.0-alpha.1.2` | valid | refused | an extra identifier; the shape is `<stage>.<N>` |
| `0.1.0-alpha` | valid | refused | a bare stage; ambiguous first transition |
| `0.1.0-Alpha.1` | valid | refused | stage names are lowercase |
| `0.1.0-gamma.1` | valid | refused | not a stage on this train |
| `0.1.1`, `0.2.0`, `1.0.0`, `1.0.0-rc.1` | valid | refused | above the ceiling |
| `0.0.0-planning` | valid | refused going forward | the preserved placeholder, not a train value |

The checker reports these as two finding families, `semver-`-shaped parse failures and `policy-`
findings, so a reviewer can tell "malformed" from "forbidden here" without reading the rule.

Precedence follows SemVer rule 11 exactly, including the two orderings that a lexical comparator
gets wrong: `0.1.0-alpha.9` ranks below `0.1.0-alpha.10`, and a numeric identifier always ranks
below an alphanumeric one. Build metadata is ignored (rule 10), which is why it is banned outright
here: two distinct strings with identical precedence destroy the determinism of "the one current
version".

## 4. Transitions

From a current value `V`, the only moves an agent or a checker may recommend are:

1. the same stage with the counter forward by one — `alpha.1 → alpha.2`;
2. the next adjacent stage with the counter reset to one — `alpha.N → beta.1`, `beta.N → rc.1`.

Everything else is refused: a no-op, a backward counter, a counter jump, a backward stage, a
stage skip, and every value above the ceiling.

Stage skipping is refused on purpose. It is precedence-forward and would be harmless under a
looser policy, but the moment a stage can be skipped silently, "which prereleases actually
happened" stops being answerable from the version alone. A human may skip a stage. An agent may
not.

`rc.N → 0.1.0` is **also refused**, and this is the one place where the terminus and the ceiling
part company. `0.1.0` is where the train ends, but reaching it is the completion decision itself,
and completion and release authority are false: `releaseAllowed=false`, `gapClosed=false`. It
becomes eligible only through a fresh, explicit human completion and release decision. No final
transition is automated by anything in this repository.

## 5. The ceiling, and the honest limit of it

`ceiling.maxVersion` and `ceiling.agentAuthorizedMax` are both `0.1.0`. No current value and no
recommendation may rank above it — `0.1.0.`-adjacent escapes like `0.1.1`, `0.2.0`, `1.0.0` and
`1.0.0-rc.1` are all unreachable by any automated path.

The ceiling moves only when a human writes `ceiling.humanDecisionRecord` with a `decisionId`,
`date`, `authorizedBy`, `newCeiling` and `rationale`, and the checker refuses a raised ceiling
whose record is absent, incomplete, or names a `newCeiling` that disagrees with `maxVersion`.

**This is a review tripwire, not a cryptographic gate.** The test suite pins the literal `0.1.0`
and a null decision record, so an agent that edits the policy alone turns the suite red, and an
agent that edits both makes a two-file, high-salience change that review sees. No in-repo
mechanism can bind an actor who can edit every file, and claiming otherwise would be the exact
kind of overclaim the checkers in this repository exist to prevent.

## 6. The conceptual milestone maps to 0.1.0, never to 1.0.0

"Kernel 1.0 complete" is a milestone in a plan. `1.0.0` is a promise about a public API that
SemVer rule 5 defines and that nobody here has made. The policy records the mapping in machine
form — `conceptualMapping.packageVersion` is `0.1.0`, `conceptualMapping.forbiddenPackageVersion`
is `1.0.0` — and the checker refuses a policy that maps the milestone onto the forbidden version
or that deletes the forbidden entry. Absence fails closed; it is never read as permission.

## 7. Changelog rules

`CHANGELOG.md` follows Keep a Changelog 1.1.0.

| Rule | Enforcement |
|---|---|
| Title | exactly one H1, text `Changelog` |
| Preamble | names both specifications and their versions, as KAC principle 7 asks |
| `[Unreleased]` | exactly one, spelled `## [Unreleased]`, and the first H2 |
| Version sections | **zero**; any other H2 carrying a version token is a fabricated release |
| Categories | only `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, at H3, unique, and in canonical order |
| Empty categories | omitted; an empty `### Security` reads as "audited, nothing found", a claim nobody made |
| Dates | permitted only on an actual release heading, and there are none, so any date in a heading is refused |
| Tags and `[YANKED]` | refused; both presume a release exists |
| Link definitions | refused while no first release exists — every `…/compare/v0.1.0...HEAD` link names a tag that does not exist, and a dangling link is a fabricated release wearing a URL |
| Heading form | canonical column-zero ATX only; setext, indented, HTML, blockquoted and list-contained headings are findings rather than parsing challenges |
| Git-log derivation | no raw commit hash, no `Merge pull request` subject, no conventional-commit prefix |
| Version tokens | only the two specification versions, the ceiling, the current value and the preserved placeholder, each in its expected role |

Fenced code blocks are ignored entirely, so a documented example of a release heading is
documentation rather than a claim.

Per-entry provenance lives in the canonical policy as `unreleasedProvenance` — a path and a role
for each claim — and the checker asserts every listed path exists in the tree. That keeps
traceability on the machine side while the human document stays what Keep a Changelog asks for:
prose for people, not a commit log.

**Naming collision, stated once.** The external Codex event-collector ledger under
`$HOME/.codex/actionplan-changelog-ledger/` is unrelated to `CHANGELOG.md`. It is an
orchestration-side event record outside this repository, it is not a Keep a Changelog document,
and nothing here reads from it or writes to it. The two must never be wired together.

## 8. Recommendation only

`agentAuthority.mayRecommendNextVersion` is true and everything else in that block is false:
`mayWriteVersion`, `mayTag`, `mayRelease`, `mayPublish`, `mayRaiseCeiling` and
`mayFabricateReleaseSection`.

This is enforced structurally as well as declaratively. The checker opens no file for writing and
spawns nothing but a fixed-argv `git tag -l`, and its suggestion is printed behind an explicit
label:

```
RECOMMENDATION (not authorization; a human decides): from 0.1.0-alpha.1 the permitted next values
are 0.1.0-alpha.2 or 0.1.0-beta.1. The completion move needs a fresh explicit human decision that
no automation makes.
```

Running the checker never changes a version. `npm version` and `npm publish` are forbidden
commands, named as such in `AGENTS.md` and in `release.forbiddenCommands`.

## 9. Release, tags and authority

Every release dimension is false: `authorized`, `tagAllowed`, `githubReleaseAllowed`,
`npmPublishAllowed`, `deployAllowed` and `productionAllowed`. The package is private, the release
count is zero, and no first release exists.

Exactly one tag exists in this repository, `kernel-runtime-substrate-s1-activated`. It is an
activation record whose message names a package id and its verified commands. It is not a release
tag, and the policy names it under `release.knownNonReleaseTags` so that no reader and no checker
can mistake it for one. Any tag shaped like `v0.1.0` is refused.

The authority binding recorded in the policy is the one in force —
`GO-KERNEL-DEVELOPMENT-ONLY`, with `codeStartAllowed`, `runtimeCodeAllowed` and
`runtimeImplementationStarted` true, and `kernelReady`, `sdkReady`, `appBuildable`,
`releaseAllowed`, `deployAllowed`, `productionAllowed` and `gapClosed` false. This package moves
none of them; it records the binding so a version decision can never be taken against a stronger
authority than the one that exists.

**Tag-visibility residual.** Tags are read from the local clone with `git tag -l`. A remote-only
fabricated release tag that this clone never fetched is invisible here. That can under-report and
can never produce a false accusation, and remote tag governance stays outside this repository.

## 10. Verification and rollback

```sh
npm run check:versioning   # this policy alone; exit 0 and one OK line
npm test                   # the full suite, including the versioning matrix
npm run check              # the whole chain; still ends with the checkout-local projection
```

The checker runs immediately before `tools/compose-current-effective.mjs` in `npm run check`, so
the compositor still owns the final line and this checker never prints a label the compositor
owns.

Rollback is fully local and file-scoped; nothing leaves the machine, so there is nothing to
un-publish:

1. delete `versioning-policy.json`, `CHANGELOG.md`, `tools/check-versioning-changelog.mjs`,
   `docs/versioning-policy.md` and `tests/kernel-versioning-changelog.test.mjs`;
2. restore `package.json` — version back to `0.0.0-planning`, remove `check:versioning`, remove
   the checker from `check`;
3. restore the `README.md` section and the `AGENTS.md` subsection.

Partial rollback is safe in one direction only, and loudly: reverting the `package.json` version
while leaving the policy in place turns the suite red at the parity rows rather than passing
silently. That is the correct failure mode.
