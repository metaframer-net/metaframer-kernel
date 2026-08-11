# P01 closure semantics

A human projection of [`planning/p01-closure-semantics-addendum.json`](../planning/p01-closure-semantics-addendum.json),
which is the canonical owner of every value below. The schema for the discharge receipt is
[`planning/p01-closure-discharge.schema.json`](../planning/p01-closure-discharge.schema.json) and
the verifier is [`tools/check-p01-closure-semantics.mjs`](../tools/check-p01-closure-semantics.mjs).

This package opens nothing. Capability delta is `NONE`.

## The defect

The immutable P00 package accepted 53 `CLOSURE` edges and bound each one to the phase of its
source gap. Every one of those 53 destinations sits in the same phase as its source or in a later
one. Backward edges: zero — and the P00 rule `GR-CLOSURE-MINIMAL` refuses one, on the ground that
a backward closure edge would be a `PREREQ` edge wearing the wrong label.

Beside that edge set, two sentences were in force. Each phase's exit contract says

> This phase may not produce its exit receipt while any listed obligation is unsatisfied.

and each obligation says `<source> cannot reach CLOSED until <destination> publishes its phase
receipt`. Read literally and together, a phase's exit receipt waits on receipts that can only
exist after it. `noSkip` is true and every phase after P00 refuses entry without its predecessor
receipt, so nothing downstream can rescue it.

The consequence, computed rather than argued. `tools/check-p01-closure-semantics.mjs` runs the
real 53-edge chain to a fixed point under that reading and reaches exactly one receipt:

| Reading | Receipts reachable | Blocked phases |
| --- | --- | --- |
| historical literal | `RCPT-00` | 12 |
| P01 closure semantics | `RCPT-00` … `RCPT-12` | 0 |

For P01 specifically the five obligations reduce to five cycles: `E-002` and `E-003` are
self-cycles, because their destination phase *is* P01; `E-152` needs `RCPT-02`, which needs
`RCPT-01`; `E-005` needs `RCPT-03`; `E-153` needs `RCPT-05`. Every one of them is waiting on the
receipt it is blocking.

The P00 validator did not catch this because it counts rather than graph-checks. Its routine
`analyzeClosureBinding` receives each edge as `{edgeId, src, dst}` and reads `src` alone — the
destination is in hand and discarded. Rewriting all five P01 destinations to a node that does not
exist leaves its verdict unchanged. That routine is ported into this package's checker as
`legacyClosureBinding`, and the suite runs it beside the new graph check on the same mutated
input, so the blind spot stays a measurement instead of a memory.

The root finding was produced by an independent read-only deadlock audit whose transcript is
pinned by path, byte count and SHA-256 in the addendum, with verdict `REJECT`.

## The correction

Forward-only, additive, and narrow. Two facts that were conflated are separated:

- **Phase receipt.** Produced when the phase's own outputs, gates, review and human decisions are
  satisfied. This is what a successor consumes for no-skip admission.
- **Gap final closure.** A separate fact. A `CLOSURE` edge blocks its source gap reaching
  `CLOSED`. It does not block the source phase receipt because a forward destination receipt does
  not exist yet.

From that, every accepted edge classifies exactly once:

| Class | Definition | Discharge | Source gap at the source receipt |
| --- | --- | --- | --- |
| `INTRA_ATOMIC` | source and destination in the same phase | inside that one phase receipt, which carries both sides | `CLOSED` |
| `FORWARD_DEFERRED` | destination in a later phase | a separate append-only `CLOSURE_DISCHARGE` receipt, once the destination receipt is published | `CLOSURE_PENDING` |
| `BACKWARD_REFUSED` | destination in an earlier phase | not admitted; no such edge exists and none may be added | — |

Counts over the accepted set: **53 total, 23 `INTRA_ATOMIC`, 30 `FORWARD_DEFERRED`, 0 backward,
0 duplicate, 0 missing, 0 extra.** Per phase: P00 0, P01 5, P02 12, P03 5, P04 17, P05 4, P06 4,
P07 1, P08 2, P09 1, P10 1, P11 1, P12 0 — the same partition P00 accepted, unchanged.

A `FORWARD_DEFERRED` obligation is recorded in the source phase receipt as an open debt carrying
`edgeId`, `sourceGap`, `destinationGap`, `destinationPhase` and `expectedDestinationReceipt`. The
source gap stays `CLOSURE_PENDING` and may not be reported `CLOSED`. When the destination receipt
is published, a `CLOSURE_DISCHARGE` receipt binds `sourcePhaseReceiptHash`,
`destinationPhaseReceiptHash` and `edgeId`. **The source phase receipt is never rewritten** — that
is what makes this append-only rather than a retroactive edit.

Successor admission consumes the predecessor **phase** receipt and nothing else. It does not wait
on the future gap closures of the whole programme. `noSkip` is untouched.

## What the checker refuses

`npm run check` runs the verifier. It reads a real tree, writes nothing, and reports a
machine-readable summary line. Every one of these is RED:

- a destination gap that does not exist, or one whose phase disagrees with the ownership overlay
- a source or destination phase that is not in the chain
- a backward edge, or a classification that does not follow from the phase ordinals
- a duplicate edge id, an accepted edge no phase enumerates, or a phase enumerating an edge the
  accepted set does not contain
- a declared count that disagrees with the graph
- a successor that consumes anything other than its declared predecessor receipt
- a discharge claimed before its destination receipt exists, or against a hash that does not match
- a discharge that rewrites or contradicts its source receipt
- `gapStatusAfter: "CLOSED"` while another obligation of that gap is still open
- a discharge whose writer is its own reviewer
- a schema that leaves any object level open, weakens a hash pattern, or drops an immutable
  linkage field from `required`
- an addendum that claims to supersede a P00 artifact, moves a readiness flag, or declares a
  capability

External evidence is handled fail-closed in the honest direction. The pinned P00 artifacts live
outside this repository. If the evidence root is present, every pinned file must be present and
byte-exact, the audit transcript must still hash to its pin, and all 53 rows plus the 90-row
ownership registry and every phase's enumerated edge ids must be re-derivable from the overlay and
the phase chain — any drift is RED. If the whole root is absent the run reports
`externalEvidence=absent` and never reports it as verified. Absence is stated; it is never assumed
away.

## What this package does not do

It supersedes no P00 historical artifact. `RCPT-00`, its evidence, its hashes and its accepted
review stand exactly as issued, and the historical exit-blocking sentence is preserved verbatim in
the addendum rather than edited in place. The only thing corrected is the *execution reading* of
that one sentence, forward-only.

It produces no `RCPT-01`, no human signature and no `CLOSED` gap. It authorises no phase entry.
The simulation proves a receipt is *reachable* under stated assumptions, with human and external
gates modelled as satisfiable but never auto-closed; a reachable receipt is not an issued one.

No readiness flag moves. `kernelReady`, `sdkReady`, `appBuildable`, `releaseAllowed`,
`deployAllowed`, `productionAllowed` and `gapClosed` all stay false, and the checker refuses an
addendum that says otherwise. The C2C marketplace, the listing product, the collaboration
product, the PWA, the SDK and the application remain closed and unstarted.

This package makes the chain executable. It does not execute it.
