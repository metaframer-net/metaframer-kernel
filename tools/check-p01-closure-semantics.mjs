import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================================
// P01 closure semantics — the fail-closed verifier for an executable phase chain
//
// The P00 package accepted 53 CLOSURE edges and bound each to the phase of its source gap. Its
// validator counts them, enumerates them per phase and checks the filter text. What it never
// does is look at where an edge points: `analyzeClosureBinding` takes each edge as
// `{edgeId, src, dst}` and reads `src` alone. Rewriting all five P01 destinations to a node that
// does not exist left its verdict unchanged, which is the measurement this file was written
// after.
//
// Counting is not the same as being executable, and the difference had a consequence. Every one
// of the 53 destinations sits in the same phase as its source or in a later one — zero point
// backwards — while every phase's exit contract says it "may not produce its exit receipt while
// any listed obligation is unsatisfied" and every obligation says the source "cannot reach
// CLOSED until <destination> publishes its phase receipt". Under that literal reading a phase
// receipt waits on receipts that only exist after it. `noSkip` is true and every successor
// refuses entry without its predecessor receipt, so the chain stops at RCPT-00 and no later
// phase is ever admitted. `simulateExecution(model, {semantics: HISTORICAL_LITERAL})` computes
// exactly that fixed point, and the suite asserts it, so the defect stays measured rather than
// remembered.
//
// The correction is forward-only and deliberately small. It rewrites no P00 byte: RCPT-00, its
// evidence and its hashes stand exactly as issued, and the historical sentence is carried
// verbatim in the addendum rather than edited in place. What moves is the execution reading of
// one sentence:
//
//   PHASE RECEIPT      the phase's own outputs, gates, review and human decisions. This is what
//                      a successor consumes for no-skip admission.
//   GAP FINAL CLOSURE  a separate fact. A CLOSURE edge blocks its source gap reaching CLOSED. It
//                      does not block the source phase receipt because a forward destination
//                      receipt does not exist yet.
//
//   INTRA_ATOMIC       source and destination in one phase; discharged inside that one receipt.
//   FORWARD_DEFERRED   destination later; recorded as an append-only open debt, source gap stays
//                      CLOSURE_PENDING, and a separate CLOSURE_DISCHARGE receipt binds the two
//                      receipt hashes when the destination receipt is published.
//
// What this file will not do:
//
//   - it writes nothing, anywhere, under any argument. Every function here is a pure function
//     over data or a reader, and the suite asserts that no write API is even named in this
//     source. A checker that can change the thing it judges is not a checker.
//   - it issues no receipt, signs nothing, answers no human decision and closes no gap. The
//     simulation proves a receipt is *reachable* under stated assumptions. Human and external
//     gates are modelled as satisfiable but never auto-closed, which is the whole distance
//     between "the chain can run" and "the chain ran".
//   - it does not become the dependency source of truth. `08-DEPENDENCY-OVERLAY.tsv` is, and
//     when that overlay is readable this file re-derives all 53 rows from it and refuses any
//     drift between the overlay and the addendum's projection.
//
// External evidence is handled fail-closed in the direction that matters. The pinned P00
// artifacts live outside this repository. If the evidence root is present, every pinned file
// must be present and byte-exact or the run is RED; if the whole root is absent the run reports
// `externalEvidence=absent` and never reports it as verified. Absence is stated, never assumed
// away — the one thing a checker must not do is print a verification it did not perform.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HISTORICAL_LITERAL = "HISTORICAL_LITERAL";
export const P01_CLOSURE_SEMANTICS_V1 = "P01_CLOSURE_SEMANTICS_V1";

export const ADDENDUM_PATH = "planning/p01-closure-semantics-addendum.json";
export const SCHEMA_PATH = "planning/p01-closure-discharge.schema.json";

const INTRA_ATOMIC = "INTRA_ATOMIC";
const FORWARD_DEFERRED = "FORWARD_DEFERRED";
const CLOSED = "CLOSED";
const CLOSURE_PENDING = "CLOSURE_PENDING";

const SHA256 = /^[0-9a-f]{64}$/;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const dedupe = (values) => [...new Set(values)];

// -------------------------------------------------------------------------------------
// 1. The P00 routine, ported faithfully
//
// This is `analyzeClosureBinding` as it stands in the P00 validator, translated to this file's
// model shape and nothing more. It is here to be run beside the graph check on the same input,
// so the blind spot is a measurement rather than a claim about somebody else's code. It is not
// used to decide anything.
// -------------------------------------------------------------------------------------

export function legacyClosureBinding(phases, edges, gapPhase) {
  const owned = new Map(phases.map((phase) => [phase.id, []]));
  for (const edge of edges) {
    const phase = gapPhase[edge.sourceGap];
    if (phase && owned.has(phase)) owned.get(phase).push(edge.edgeId);
  }

  const omissions = [];
  const extras = [];
  const countMismatch = [];
  let reachable = 0;

  for (const phase of phases) {
    const expected = (owned.get(phase.id) ?? []).slice().sort();
    const declared = (phase.closureEdgeIds ?? []).slice().sort();
    if (declared.length !== expected.length) countMismatch.push(phase.id);
    for (const id of expected) if (!declared.includes(id)) omissions.push(`${phase.id}:${id}`);
    for (const id of declared) if (!expected.includes(id)) extras.push(`${phase.id}:${id}`);
    reachable += declared.filter((id) => expected.includes(id)).length;
  }

  return {
    reachable,
    omissions,
    extras,
    countMismatch,
    violations: [
      ...omissions.map((value) => `OMISSION:${value}`),
      ...extras.map((value) => `EXTRA:${value}`),
      ...countMismatch.map((value) => `COUNT:${value}`),
    ],
  };
}

// -------------------------------------------------------------------------------------
// 2. The graph check — everything the count check cannot see
// -------------------------------------------------------------------------------------

/**
 * The closure graph, judged as a graph.
 *
 * Every destination must be a gap that exists; both endpoints must agree with the ownership
 * registry; both phases must be in the chain; the classification must follow from the phase
 * ordinals rather than be asserted; and the per-phase enumeration must be a partition of the
 * accepted set with no duplicate, no omission and no extra.
 *
 * @param {{phases: object[], edges: object[], gapPhase: Record<string, string>}} model
 */
export function analyzeClosureGraph(model) {
  const violations = [];
  const phases = model.phases ?? [];
  const edges = model.edges ?? [];
  const gapPhase = model.gapPhase ?? {};

  const ordinal = new Map(phases.map((phase) => [phase.id, phase.ordinal]));
  const receiptOf = new Map(phases.map((phase) => [phase.id, phase.receiptId]));

  const seen = new Set();
  for (const edge of edges) {
    if (seen.has(edge.edgeId)) violations.push(`DUPLICATE_EDGE:${edge.edgeId}`);
    seen.add(edge.edgeId);
  }

  let intraAtomic = 0;
  let forwardDeferred = 0;
  let backward = 0;

  for (const edge of edges) {
    const id = edge.edgeId;

    if (!Object.hasOwn(gapPhase, edge.destinationGap)) {
      violations.push(`DESTINATION_GAP_UNKNOWN:${id}:${edge.destinationGap}`);
      continue;
    }
    if (!Object.hasOwn(gapPhase, edge.sourceGap)) {
      violations.push(`SOURCE_GAP_UNKNOWN:${id}:${edge.sourceGap}`);
      continue;
    }
    if (gapPhase[edge.destinationGap] !== edge.destinationPhase) {
      violations.push(
        `DESTINATION_PHASE_MISMATCH:${id}:${edge.destinationPhase}!=${gapPhase[edge.destinationGap]}`,
      );
      continue;
    }
    if (gapPhase[edge.sourceGap] !== edge.sourcePhase) {
      violations.push(
        `SOURCE_PHASE_MISMATCH:${id}:${edge.sourcePhase}!=${gapPhase[edge.sourceGap]}`,
      );
      continue;
    }
    if (!ordinal.has(edge.sourcePhase)) {
      violations.push(`SOURCE_PHASE_UNKNOWN:${id}:${edge.sourcePhase}`);
      continue;
    }
    if (!ordinal.has(edge.destinationPhase)) {
      violations.push(`DESTINATION_PHASE_UNKNOWN:${id}:${edge.destinationPhase}`);
      continue;
    }

    const source = ordinal.get(edge.sourcePhase);
    const destination = ordinal.get(edge.destinationPhase);

    if (destination < source) {
      violations.push(`BACKWARD_EDGE:${id}:${edge.sourcePhase}->${edge.destinationPhase}`);
      backward += 1;
      continue;
    }

    const derived = destination === source ? INTRA_ATOMIC : FORWARD_DEFERRED;
    if (edge.classification !== derived) {
      violations.push(`CLASSIFICATION_MISMATCH:${id}:${edge.classification}!=${derived}`);
      continue;
    }
    if (edge.expectedDestinationReceipt !== receiptOf.get(edge.destinationPhase)) {
      violations.push(
        `EXPECTED_RECEIPT_MISMATCH:${id}:${edge.expectedDestinationReceipt}!=${receiptOf.get(edge.destinationPhase)}`,
      );
      continue;
    }
    if (edge.owningPhase !== undefined && edge.owningPhase !== edge.sourcePhase) {
      violations.push(`OWNING_PHASE_MISMATCH:${id}:${edge.owningPhase}!=${edge.sourcePhase}`);
      continue;
    }

    if (derived === INTRA_ATOMIC) intraAtomic += 1;
    else forwardDeferred += 1;
  }

  const accepted = new Set(edges.map((edge) => edge.edgeId));
  const enumerated = [];
  for (const phase of phases) {
    for (const id of phase.closureEdgeIds ?? []) {
      enumerated.push(id);
      if (!accepted.has(id)) {
        violations.push(`EXTRA_EDGE:${phase.id}:${id}`);
        continue;
      }
      const edge = edges.find((candidate) => candidate.edgeId === id);
      if (edge.sourcePhase !== phase.id) {
        violations.push(`OWNERSHIP_MISPLACED:${phase.id}:${id}:${edge.sourcePhase}`);
      }
    }
    if (
      phase.closureEdgeCount !== undefined &&
      phase.closureEdgeCount !== (phase.closureEdgeIds ?? []).length
    ) {
      violations.push(
        `PHASE_COUNT_MISMATCH:${phase.id}:${phase.closureEdgeCount}!=${(phase.closureEdgeIds ?? []).length}`,
      );
    }
  }

  const enumeratedSet = new Set(enumerated);
  for (const id of accepted) {
    if (!enumeratedSet.has(id)) violations.push(`MISSING_EDGE:${id}`);
  }
  if (enumerated.length !== enumeratedSet.size) {
    violations.push(`ENUMERATION_DUPLICATE:${enumerated.length}!=${enumeratedSet.size}`);
  }
  if (enumerated.length !== edges.length) {
    violations.push(`EDGE_COUNT:${enumerated.length}!=${edges.length}`);
  }

  return {
    violations: dedupe(violations),
    counts: {
      totalEdges: edges.length,
      intraAtomic,
      forwardDeferred,
      backward,
      duplicate: edges.length - seen.size,
      missing: [...accepted].filter((id) => !enumeratedSet.has(id)).length,
      extra: enumerated.filter((id) => !accepted.has(id)).length,
    },
  };
}

/**
 * The chain itself: one ordered spine, each phase consuming its own predecessor's receipt.
 *
 * A successor that consumes anything other than its declared predecessor receipt is a skip
 * wearing a different name, and `noSkip` is the one property the correction must not spend.
 */
export function analyzeChainIntegrity(model) {
  const violations = [];
  const phases = [...(model.phases ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  const byId = new Map(phases.map((phase) => [phase.id, phase]));

  phases.forEach((phase, index) => {
    const previous = index === 0 ? null : phases[index - 1];

    if (index === 0) {
      if (phase.predecessor !== null) {
        violations.push(`ROOT_HAS_PREDECESSOR:${phase.id}:${phase.predecessor}`);
      }
      if (phase.predecessorReceiptId !== null) {
        violations.push(`ROOT_CONSUMES_RECEIPT:${phase.id}:${phase.predecessorReceiptId}`);
      }
    } else {
      if (phase.predecessor !== previous.id) {
        violations.push(`SUCCESSOR_SKIP:${phase.id}:${phase.predecessor}!=${previous.id}`);
      }
      if (phase.predecessorReceiptId !== byId.get(phase.predecessor)?.receiptId) {
        violations.push(
          `PREDECESSOR_RECEIPT_MISMATCH:${phase.id}:${phase.predecessorReceiptId}!=${byId.get(phase.predecessor)?.receiptId}`,
        );
      }
      if (phase.predecessorReceiptRequired === false) {
        violations.push(`PREDECESSOR_RECEIPT_NOT_REQUIRED:${phase.id}`);
      }
    }

    const successor = index === phases.length - 1 ? null : phases[index + 1].id;
    if (phase.successor !== undefined && phase.successor !== successor) {
      violations.push(`SUCCESSOR_MISMATCH:${phase.id}:${phase.successor}!=${successor}`);
    }
    if (phase.noSkip === false) violations.push(`NO_SKIP_DROPPED:${phase.id}`);
    if (phase.mutatesAnyFlag === true) violations.push(`READINESS_FLAG_MUTATION:${phase.id}`);
  });

  return dedupe(violations);
}

// -------------------------------------------------------------------------------------
// 3. The execution simulation
// -------------------------------------------------------------------------------------

/**
 * Run the chain to a fixed point under one reading of the closure obligations.
 *
 * `HISTORICAL_LITERAL` is the reading in force before this package: an obligation is satisfied
 * only once the destination phase's receipt exists, and an unsatisfied obligation blocks the
 * source phase receipt. `P01_CLOSURE_SEMANTICS_V1` is the correction: intra-phase obligations
 * discharge inside the one receipt that carries both sides, forward obligations become open
 * debts that hold the source gap at CLOSURE_PENDING without holding the receipt.
 *
 * Nothing is issued. Every "reached" receipt is a reachability result under the stated gate
 * policy, and the gate policy is that human and external gates are satisfiable but never closed
 * by this function.
 */
export function simulateExecution(model, options = {}) {
  const semantics = options.semantics ?? P01_CLOSURE_SEMANTICS_V1;
  const phases = [...(model.phases ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  const edgeById = new Map((model.edges ?? []).map((edge) => [edge.edgeId, edge]));

  const issued = new Map();
  const order = [];
  const admitted = [];
  const consumed = {};
  const discharges = [];
  const debtsRecordedAt = {};
  const gapStatusAt = {};
  const violations = [];
  const openDebts = new Map();
  const dischargedEdgeIds = new Set();

  const owedBy = new Map();
  for (const edge of model.edges ?? []) {
    if (!owedBy.has(edge.sourceGap)) owedBy.set(edge.sourceGap, []);
    owedBy.get(edge.sourceGap).push(edge.edgeId);
  }

  const gapStatusSnapshot = () =>
    Object.fromEntries(
      [...owedBy.entries()].map(([gap, ids]) => [
        gap,
        ids.every((id) => dischargedEdgeIds.has(id)) ? CLOSED : CLOSURE_PENDING,
      ]),
    );

  const dischargeReadyDebts = (atReceipt) => {
    for (const [edgeId, debt] of [...openDebts.entries()]) {
      if (!issued.has(debt.destinationPhase)) continue;
      openDebts.delete(edgeId);
      dischargedEdgeIds.add(edgeId);
      discharges.push({
        edgeId,
        classification: FORWARD_DEFERRED,
        sourceGap: debt.sourceGap,
        destinationGap: debt.destinationGap,
        sourcePhaseReceipt: debt.sourcePhaseReceipt,
        destinationPhaseReceipt: issued.get(debt.destinationPhase),
        recordedAtReceipt: atReceipt,
        atomic: false,
      });
    }
  };

  let progress = true;
  while (progress) {
    progress = false;

    for (const phase of phases) {
      if (issued.has(phase.id)) continue;
      if (phase.predecessor !== null && !issued.has(phase.predecessor)) continue;
      if (!admitted.includes(phase.id)) admitted.push(phase.id);

      const obligations = (phase.closureEdgeIds ?? []).map((id) => edgeById.get(id));
      if (obligations.some((edge) => edge === undefined)) {
        violations.push(`UNKNOWN_OBLIGATION:${phase.id}`);
        continue;
      }

      let blocked = false;
      if (semantics === HISTORICAL_LITERAL) {
        blocked = obligations.some((edge) => !issued.has(edge.destinationPhase));
      } else {
        for (const edge of obligations) {
          if (edge.classification === INTRA_ATOMIC) {
            if (edge.destinationPhase !== phase.id) {
              violations.push(`INTRA_ATOMIC_OFF_PHASE:${edge.edgeId}`);
              blocked = true;
            }
          } else if (edge.classification === FORWARD_DEFERRED) {
            if (edge.destinationPhase === phase.id) {
              violations.push(`FORWARD_DEFERRED_ON_PHASE:${edge.edgeId}`);
              blocked = true;
            }
          } else {
            violations.push(`UNCLASSIFIED_EDGE:${edge.edgeId}:${edge.classification}`);
            blocked = true;
          }
        }
      }
      if (blocked) continue;

      if (phase.predecessor !== null) consumed[phase.id] = issued.get(phase.predecessor);
      issued.set(phase.id, phase.receiptId);
      order.push(phase.receiptId);
      progress = true;

      if (semantics !== HISTORICAL_LITERAL) {
        const debts = [];
        for (const edge of obligations) {
          if (edge.classification === INTRA_ATOMIC) {
            dischargedEdgeIds.add(edge.edgeId);
            discharges.push({
              edgeId: edge.edgeId,
              classification: INTRA_ATOMIC,
              sourceGap: edge.sourceGap,
              destinationGap: edge.destinationGap,
              sourcePhaseReceipt: phase.receiptId,
              destinationPhaseReceipt: phase.receiptId,
              recordedAtReceipt: phase.receiptId,
              atomic: true,
            });
          } else {
            const debt = {
              edgeId: edge.edgeId,
              sourceGap: edge.sourceGap,
              destinationGap: edge.destinationGap,
              destinationPhase: edge.destinationPhase,
              expectedDestinationReceipt: edge.expectedDestinationReceipt,
            };
            debts.push(debt);
            openDebts.set(edge.edgeId, { ...debt, sourcePhaseReceipt: phase.receiptId });
          }
        }
        debtsRecordedAt[phase.receiptId] = debts;
        dischargeReadyDebts(phase.receiptId);
        gapStatusAt[phase.receiptId] = gapStatusSnapshot();
      }
    }
  }

  const blockedPhases = phases.filter((phase) => !issued.has(phase.id)).map((phase) => phase.id);
  const blockedBy = {};
  for (const phase of phases) {
    if (issued.has(phase.id)) continue;
    const open = (phase.closureEdgeIds ?? []).filter(
      (id) => edgeById.has(id) && !issued.has(edgeById.get(id).destinationPhase),
    );
    if (open.length > 0) blockedBy[phase.id] = open;
  }

  for (const [gap, status] of Object.entries(gapStatusSnapshot())) {
    if (status !== CLOSED) continue;
    const open = owedBy.get(gap).filter((id) => !dischargedEdgeIds.has(id));
    if (open.length > 0) violations.push(`CLOSED_WITH_PENDING_FORWARD:${gap}:${open.join(",")}`);
  }

  return {
    semantics,
    gatePolicy: "SATISFIABLE_BUT_NOT_AUTO_CLOSED",
    reachedPhaseReceipts: order,
    admitted,
    consumed,
    blockedPhases,
    blockedBy,
    selfCycles: (model.edges ?? [])
      .filter((edge) => edge.sourcePhase === edge.destinationPhase)
      .map((edge) => edge.edgeId),
    deadlocked: blockedPhases.length > 0,
    discharges,
    debtsRecordedAt,
    gapStatusAt,
    gapStatusFinal: gapStatusSnapshot(),
    openDebts: [...openDebts.keys()],
    violations: dedupe(violations),
    receiptsIssued: 0,
    signaturesProduced: 0,
    humanDecisionsClosed: 0,
  };
}

// -------------------------------------------------------------------------------------
// 4. The append-only discharge receipt
// -------------------------------------------------------------------------------------

/**
 * One discharge receipt, judged against the accepted edge set and the receipts issued so far.
 *
 * The schema settles shape. This settles the four things a schema cannot: that the destination
 * receipt actually exists and hashes to what is claimed, that the source receipt was not
 * rewritten, that CLOSED is only claimed when this discharge is the source gap's last
 * outstanding obligation, and that the writer is not its own reviewer.
 */
export function validateDischargeReceipt(document, model, state) {
  const findings = [];
  if (!isPlainObject(document)) return [`DISCHARGE_MALFORMED:${typeof document}`];

  const edge = (model.edges ?? []).find((candidate) => candidate.edgeId === document.edgeId);
  if (edge === undefined) return [`UNKNOWN_EDGE:${document.edgeId}`];

  const issued = state?.issuedReceipts ?? {};
  const alreadyDischarged = new Set(state?.dischargedEdgeIds ?? []);

  for (const [field, expected] of [
    ["sourceGap", edge.sourceGap],
    ["destinationGap", edge.destinationGap],
    ["sourcePhase", edge.sourcePhase],
    ["destinationPhase", edge.destinationPhase],
    ["classification", edge.classification],
    ["destinationPhaseReceiptId", edge.expectedDestinationReceipt],
  ]) {
    if (document[field] !== expected) {
      findings.push(`EDGE_FIELD_MISMATCH:${document.edgeId}:${field}:${document[field]}!=${expected}`);
    }
  }

  const sourcePhase = (model.phases ?? []).find((phase) => phase.id === edge.sourcePhase);
  if (document.sourcePhaseReceiptId !== sourcePhase?.receiptId) {
    findings.push(
      `SOURCE_RECEIPT_MISMATCH:${document.edgeId}:${document.sourcePhaseReceiptId}!=${sourcePhase?.receiptId}`,
    );
  }

  if (document.sourceReceiptRewritten !== false) {
    findings.push(`SOURCE_RECEIPT_REWRITTEN:${document.edgeId}`);
  }
  if (document.appendOnly !== true) findings.push(`NOT_APPEND_ONLY:${document.edgeId}`);
  if (document.capabilityDelta !== "NONE") {
    findings.push(`CAPABILITY_DELTA:${document.edgeId}:${document.capabilityDelta}`);
  }
  if (document.readinessFlagMutation?.mutatesAnyFlag !== false) {
    findings.push(`READINESS_FLAG_MUTATION:${document.edgeId}`);
  }
  if (document.writerId === document.reviewerId) {
    findings.push(`SELF_REVIEW:${document.edgeId}:${document.writerId}`);
  }

  const sourceHash = issued[document.sourcePhaseReceiptId];
  if (sourceHash === undefined) {
    findings.push(`SOURCE_RECEIPT_ABSENT:${document.edgeId}:${document.sourcePhaseReceiptId}`);
  } else if (document.sourcePhaseReceiptHash !== sourceHash) {
    findings.push(`SOURCE_RECEIPT_HASH_MISMATCH:${document.edgeId}:${document.sourcePhaseReceiptId}`);
  }

  const destinationHash = issued[document.destinationPhaseReceiptId];
  if (destinationHash === undefined) {
    findings.push(
      `DESTINATION_RECEIPT_ABSENT:${document.edgeId}:${document.destinationPhaseReceiptId}`,
    );
  } else if (document.destinationPhaseReceiptHash !== destinationHash) {
    findings.push(
      `DESTINATION_RECEIPT_HASH_MISMATCH:${document.edgeId}:${document.destinationPhaseReceiptId}`,
    );
  }

  if (document.gapStatusAfter === CLOSED) {
    const outstanding = (model.edges ?? [])
      .filter((candidate) => candidate.sourceGap === edge.sourceGap)
      .map((candidate) => candidate.edgeId)
      .filter((id) => id !== document.edgeId && !alreadyDischarged.has(id));
    if (outstanding.length > 0) {
      findings.push(`CLOSED_WITH_PENDING_FORWARD:${edge.sourceGap}:${outstanding.join(",")}`);
    }
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 5. A JSON Schema subset, and the schema's own fail-closed shape
//
// No dependency is added for this. The subset is exactly what the discharge schema uses —
// type, const, enum, pattern, minLength, required, properties, additionalProperties, items —
// and an unknown keyword is reported rather than skipped, so the validator cannot quietly
// under-enforce a schema that grew a keyword it does not implement.
// -------------------------------------------------------------------------------------

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "required",
  "properties",
  "additionalProperties",
  "items",
]);

const TYPE_OF = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

export function validateAgainstSchema(schema, instance, pointer = "") {
  const findings = [];
  if (!isPlainObject(schema)) return [`schema:${pointer || "/"}`];

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) findings.push(`unsupportedKeyword:${pointer}/${keyword}`);
  }

  if (schema.type !== undefined && TYPE_OF(instance) !== schema.type) {
    if (!(schema.type === "number" && typeof instance === "number")) {
      findings.push(`type:${pointer || "/"}`);
      return findings;
    }
  }
  if (schema.const !== undefined && instance !== schema.const) {
    findings.push(`const:${pointer || "/"}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(instance)) {
    findings.push(`enum:${pointer || "/"}`);
  }
  if (schema.pattern !== undefined && typeof instance === "string") {
    if (!new RegExp(schema.pattern).test(instance)) findings.push(`pattern:${pointer || "/"}`);
  }
  if (schema.minLength !== undefined && typeof instance === "string") {
    if (instance.length < schema.minLength) findings.push(`minLength:${pointer || "/"}`);
  }

  if (isPlainObject(instance)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(instance, name)) findings.push(`required:${pointer}/${name}`);
    }
    const properties = schema.properties ?? {};
    for (const [name, value] of Object.entries(instance)) {
      if (Object.hasOwn(properties, name)) {
        findings.push(...validateAgainstSchema(properties[name], value, `${pointer}/${name}`));
      } else if (schema.additionalProperties === false) {
        findings.push(`additionalProperties:${pointer}/${name}`);
      }
    }
  }

  if (Array.isArray(instance) && isPlainObject(schema.items)) {
    instance.forEach((value, index) => {
      findings.push(...validateAgainstSchema(schema.items, value, `${pointer}/${index}`));
    });
  }

  return findings;
}

/**
 * The schema document itself.
 *
 * A schema that forgets `additionalProperties: false` on one nested object is a schema with a
 * door in it, so every object level is checked rather than the root alone. The immutable linkage
 * fields are required by name here, because "required" is the only thing standing between an
 * append-only receipt and a receipt that quietly omits the destination it claims to discharge.
 */
export function schemaViolations(schema) {
  const findings = [];
  if (!isPlainObject(schema)) return ["SCHEMA_MALFORMED"];

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    findings.push(`SCHEMA_DIALECT:${schema.$schema}`);
  }
  if (typeof schema.$id !== "string" || schema.$id === "") findings.push("SCHEMA_ID_MISSING");
  if (schema.type !== "object") findings.push(`SCHEMA_ROOT_TYPE:${schema.type}`);

  const walk = (node, pointer) => {
    if (!isPlainObject(node)) return;
    for (const keyword of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) findings.push(`SCHEMA_UNSUPPORTED:${pointer}/${keyword}`);
    }
    if (node.type === "object" || isPlainObject(node.properties)) {
      if (node.additionalProperties !== false) {
        findings.push(`SCHEMA_OPEN_OBJECT:${pointer || "/"}`);
      }
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        walk(child, `${pointer}/${name}`);
      }
    }
    if (isPlainObject(node.items)) walk(node.items, `${pointer}/items`);
  };
  walk(schema, "");

  const required = new Set(schema.required ?? []);
  for (const field of [
    "receiptKind",
    "edgeId",
    "classification",
    "sourcePhaseReceiptId",
    "sourcePhaseReceiptHash",
    "destinationPhaseReceiptId",
    "destinationPhaseReceiptHash",
    "appendOnly",
    "sourceReceiptRewritten",
    "gapStatusAfter",
    "capabilityDelta",
    "readinessFlagMutation",
  ]) {
    if (!required.has(field)) findings.push(`SCHEMA_LINKAGE_NOT_REQUIRED:${field}`);
  }

  const properties = schema.properties ?? {};
  for (const field of ["sourcePhaseReceiptHash", "destinationPhaseReceiptHash"]) {
    if (properties[field]?.pattern !== "^[0-9a-f]{64}$") {
      findings.push(`SCHEMA_HASH_PATTERN:${field}:${properties[field]?.pattern}`);
    }
  }
  if (properties.receiptKind?.const !== "CLOSURE_DISCHARGE") {
    findings.push(`SCHEMA_RECEIPT_KIND:${properties.receiptKind?.const}`);
  }
  if (properties.appendOnly?.const !== true) findings.push("SCHEMA_APPEND_ONLY");
  if (properties.sourceReceiptRewritten?.const !== false) {
    findings.push("SCHEMA_SOURCE_RECEIPT_REWRITTEN");
  }
  if (properties.capabilityDelta?.const !== "NONE") findings.push("SCHEMA_CAPABILITY_DELTA");

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 6. The addendum, and the external evidence it pins
// -------------------------------------------------------------------------------------

/**
 * The model the graph check and the simulation both run on.
 *
 * Deep-copied on purpose. Handing a caller live references into the canonical document would
 * let anything that probes the contract — a negative fixture, a what-if — quietly rewrite the
 * contract it was probing, and a document that mutates under the checks judging it is exactly
 * the failure this package was written about.
 */
export function modelFromAddendum(addendum) {
  return structuredClone({
    phases: addendum.phaseChainProjection.phases,
    edges: addendum.closureEdgeProjection.edges,
    gapPhase: addendum.gapRegistryProjection.gapPhase,
  });
}

function tsvRows(text) {
  const lines = text.split("\n").filter((line) => line !== "");
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(header.map((name, index) => [name, cells[index]]));
  });
}

/**
 * The pinned P00 artifacts, verified or honestly reported absent.
 *
 * Present-and-different is RED. Wholly absent is `absent` and is never printed as verified. When
 * the overlay and the phase chain are readable the 53-edge projection is re-derived from them
 * and compared field by field, so the addendum stays a checked projection of the source of truth
 * rather than a copy that drifted.
 */
export function externalEvidenceReport(addendum) {
  const pins = addendum?.sourcePins;
  if (!isPlainObject(pins) || !Array.isArray(pins.files)) {
    return { state: "absent", findings: ["EVIDENCE_PINS_MALFORMED"], verifiedFiles: 0 };
  }

  const evidenceRoot = pins.evidenceRoot;
  if (typeof evidenceRoot !== "string" || !existsSync(evidenceRoot)) {
    return { state: "absent", findings: [], verifiedFiles: 0, derivedProjectionMatches: null };
  }

  const findings = [];
  let verifiedFiles = 0;
  for (const file of pins.files) {
    const absolute = path.join(evidenceRoot, file.path);
    if (!existsSync(absolute)) {
      findings.push(`EVIDENCE_FILE_ABSENT:${file.path}`);
      continue;
    }
    const bytes = readFileSync(absolute);
    if (bytes.length !== file.bytes) {
      findings.push(`EVIDENCE_BYTES:${file.path}:${bytes.length}!=${file.bytes}`);
      continue;
    }
    if (sha256(bytes) !== file.sha256) {
      findings.push(`EVIDENCE_SHA256:${file.path}`);
      continue;
    }
    verifiedFiles += 1;
  }

  const audit = pins.independentDeadlockAudit;
  if (isPlainObject(audit) && typeof audit.path === "string" && existsSync(audit.path)) {
    const bytes = readFileSync(audit.path);
    if (bytes.length !== audit.bytes || sha256(bytes) !== audit.sha256) {
      findings.push("EVIDENCE_AUDIT_TRANSCRIPT_DRIFT");
    }
  }

  let derivedProjectionMatches = null;
  if (findings.length === 0) {
    derivedProjectionMatches = true;
    const overlay = tsvRows(
      readFileSync(path.join(evidenceRoot, addendum.dependencySourceOfTruth), "utf8"),
    ).filter((row) => row.dep_type === "CLOSURE");
    const ownership = tsvRows(
      readFileSync(path.join(evidenceRoot, addendum.ownershipSourceOfTruth), "utf8"),
    );
    const chain = JSON.parse(
      readFileSync(path.join(evidenceRoot, addendum.phaseChainSourceOfTruth), "utf8"),
    );

    if (overlay.length !== addendum.closureEdgeProjection.edges.length) {
      findings.push(
        `DERIVED_EDGE_COUNT:${overlay.length}!=${addendum.closureEdgeProjection.edges.length}`,
      );
      derivedProjectionMatches = false;
    }
    if (ownership.length !== addendum.gapRegistryProjection.rowCount) {
      findings.push(`DERIVED_OWNERSHIP_ROWS:${ownership.length}`);
      derivedProjectionMatches = false;
    }
    for (const row of ownership) {
      if (addendum.gapRegistryProjection.gapPhase[row.kg_id] !== row.phase) {
        findings.push(`DERIVED_GAP_PHASE:${row.kg_id}`);
        derivedProjectionMatches = false;
      }
    }
    const receiptOf = new Map(
      chain.phases.map((phase) => [phase.id, phase.receiptSchema.receiptId]),
    );
    for (const row of overlay) {
      const projected = addendum.closureEdgeProjection.edges.find(
        (edge) => edge.edgeId === row.edge_id,
      );
      if (projected === undefined) {
        findings.push(`DERIVED_EDGE_ABSENT:${row.edge_id}`);
        derivedProjectionMatches = false;
        continue;
      }
      const expected = {
        sourceGap: row.src_kg,
        destinationGap: row.dst,
        sourcePhase: row.src_phase,
        destinationPhase: row.dst_phase,
        historicalObligationText: row.closure_obligation,
        expectedDestinationReceipt: receiptOf.get(row.dst_phase),
      };
      for (const [field, value] of Object.entries(expected)) {
        if (projected[field] !== value) {
          findings.push(`DERIVED_EDGE_FIELD:${row.edge_id}:${field}`);
          derivedProjectionMatches = false;
        }
      }
    }
    for (const phase of chain.phases) {
      const projected = addendum.phaseChainProjection.phases.find(
        (candidate) => candidate.id === phase.id,
      );
      if (projected === undefined) {
        findings.push(`DERIVED_PHASE_ABSENT:${phase.id}`);
        derivedProjectionMatches = false;
        continue;
      }
      const declared = phase.closureObligations.edgeIds ?? [];
      if (JSON.stringify(projected.closureEdgeIds) !== JSON.stringify(declared)) {
        findings.push(`DERIVED_PHASE_EDGE_IDS:${phase.id}`);
        derivedProjectionMatches = false;
      }
      if (projected.historicalExitBlockingSentence !== phase.closureObligations.rule) {
        findings.push(`DERIVED_PHASE_RULE_TEXT:${phase.id}`);
        derivedProjectionMatches = false;
      }
    }
  }

  return {
    state: findings.length === 0 ? "verified" : "drifted",
    findings: dedupe(findings),
    verifiedFiles,
    derivedProjectionMatches,
  };
}

// -------------------------------------------------------------------------------------
// 7. The canonical semantics block, bound to this gate
//
// Everything above judges projections: counts, endpoints, ordinals, receipt order, schema shape.
// None of it reads `semantics`, and `semantics` is the block the docs call the canonical owner of
// every value below it. An independent reviewer measured what that costs. Applied together to the
// addendum, all four of these left this command printing `OK … capabilityDelta=NONE`:
//
//   separation.rule                        -> a forward edge blocks the source phase receipt
//   separation.gapFinalClosure             -> closure is implied by the phase receipt
//   appendOnly.sourcePhaseReceiptRewritten -> true
//   successorAdmission.noSkip              -> false
//
// The document could restore the deadlock this package exists to remove, re-conflate the two
// facts it exists to separate, deny append-only and abandon no-skip, and the gate would agree
// with it. That is the same shape as the P00 defect recorded at the top of this file: a validator
// that counts what it can enumerate and never reads the statement carrying the meaning.
//
// The canonical statements are bound by equality. A substring test asks whether some words are
// present, and each mutation above is fluent English that keeps the words and inverts the claim;
// only equality refuses a rewording nobody anticipated. This does not make the checker a second
// owner of the semantics — the addendum stays the one place these values are declared and the one
// place every other surface reads them from. What lives here is the refusal, in the same idiom as
// the pinned dialect, receipt kind and hash pattern in section 5.
// -------------------------------------------------------------------------------------

export const SEMANTICS_ID = "P01-CLOSURE-SEMANTICS-V1";

/** The separation this package exists to state, verbatim. The addendum owns it; this refuses drift. */
export const CANONICAL_SEPARATION = {
  phaseReceipt:
    "Produced when the phase's outputs, gates, review and human decisions are satisfied. It is " +
    "what a successor consumes for no-skip admission.",
  gapFinalClosure:
    "A gap reaches CLOSED only when every CLOSURE obligation originating at it is discharged. " +
    "This is a separate fact from the phase receipt and is never implied by it.",
  rule:
    "A CLOSURE edge blocks the source gap's final CLOSED state. It never blocks the source phase " +
    "receipt on the ground that a forward destination receipt does not exist yet.",
};

export const HUMAN_GATE_REQUIRED_DECISION_STATE = "SATISFIED";

/** Every state in which a decision is unanswered, and so every state that withholds a discharge. */
export const HUMAN_GATE_BLOCKING_DECISION_STATES = [
  "OPEN",
  "HUMAN_DECISION_REQUIRED",
  "UNANSWERED",
  "UNSATISFIED",
];

/**
 * The canonical semantics block, judged as a contract.
 *
 * Pure, total and read-only: it takes the block and returns findings. Nothing here consults the
 * projections, because the point is that the statement must hold on its own terms even when every
 * count is right.
 *
 * @param {unknown} semantics the `semantics` block of the addendum
 * @returns {string[]} one stable machine finding per broken clause
 */
export function semanticContractViolations(semantics) {
  const findings = [];
  if (!isPlainObject(semantics)) return [`SEMANTICS_BLOCK_ABSENT:${TYPE_OF(semantics)}`];

  if (semantics.id !== SEMANTICS_ID) findings.push(`SEMANTICS_ID:${semantics.id}`);

  const separation = semantics.separation;
  if (!isPlainObject(separation)) {
    findings.push(`SEMANTICS_SEPARATION_ABSENT:${TYPE_OF(separation)}`);
  } else {
    for (const [field, canonical] of Object.entries(CANONICAL_SEPARATION)) {
      if (separation[field] !== canonical) findings.push(`SEMANTICS_SEPARATION:${field}`);
    }
  }

  // The C1 correction: the state a real discharge requires, and the assumption a run may make,
  // are two different facts. An OPEN decision is one nobody has answered, so it withholds a
  // discharge; it is never the ground for granting one.
  const policy = semantics.humanGatePolicy;
  if (!isPlainObject(policy)) {
    findings.push(`SEMANTICS_HUMAN_GATE_ABSENT:${TYPE_OF(policy)}`);
  } else {
    if (policy.realDischargeRequiredDecisionState !== HUMAN_GATE_REQUIRED_DECISION_STATE) {
      findings.push(
        `SEMANTICS_HUMAN_GATE_REQUIRED_STATE:${policy.realDischargeRequiredDecisionState}`,
      );
    }
    if (policy.decisionAuthority !== "authorized human") {
      findings.push(`SEMANTICS_DECISION_AUTHORITY:${policy.decisionAuthority}`);
    }

    const blocking = policy.realDischargeBlockingDecisionStates;
    if (!Array.isArray(blocking)) {
      findings.push(`SEMANTICS_HUMAN_GATE_BLOCKING_STATES:${TYPE_OF(blocking)}`);
    } else {
      const expected = new Set(HUMAN_GATE_BLOCKING_DECISION_STATES);
      const actual = new Set(blocking);
      if (blocking.length !== actual.size) {
        findings.push(`SEMANTICS_HUMAN_GATE_BLOCKING_DUPLICATE:${blocking.length}!=${actual.size}`);
      }
      for (const state of HUMAN_GATE_BLOCKING_DECISION_STATES) {
        if (!actual.has(state)) findings.push(`SEMANTICS_HUMAN_GATE_BLOCKING_MISSING:${state}`);
      }
      // SATISFIED is not in the expected set, so listing the one permitting state among the
      // blocking ones is reported here rather than needing a rule of its own.
      for (const state of dedupe(blocking)) {
        if (!expected.has(state)) findings.push(`SEMANTICS_HUMAN_GATE_BLOCKING_EXTRA:${state}`);
      }
    }

    for (const [field, expected] of [
      ["simulationMayAssumeGateSatisfiable", true],
      ["simulationAssumptionCountsAsSatisfaction", false],
      ["simulationSignsAnything", false],
      ["simulationClosesAnyHumanDecision", false],
      ["simulationProducesRealReceipt", false],
    ]) {
      if (policy[field] !== expected) findings.push(`SEMANTICS_HUMAN_GATE:${field}:${policy[field]}`);
    }
  }

  const intra = semantics.classifications?.INTRA_ATOMIC;
  if (!isPlainObject(intra)) {
    findings.push(`SEMANTICS_INTRA_ATOMIC_ABSENT:${TYPE_OF(intra)}`);
  } else {
    const discharge = typeof intra.discharge === "string" ? intra.discharge : "";
    if (!discharge.includes(HUMAN_GATE_REQUIRED_DECISION_STATE)) {
      findings.push("SEMANTICS_INTRA_ATOMIC_DISCHARGE_STATE");
    }
    if (/gate is open rather than closed/i.test(discharge)) {
      findings.push("SEMANTICS_INTRA_ATOMIC_OPEN_GATE");
    }
  }

  const appendOnly = semantics.appendOnly;
  if (!isPlainObject(appendOnly)) {
    findings.push(`SEMANTICS_APPEND_ONLY_ABSENT:${TYPE_OF(appendOnly)}`);
  } else {
    if (appendOnly.sourcePhaseReceiptRewritten !== false) {
      findings.push(
        `SEMANTICS_SOURCE_PHASE_RECEIPT_REWRITTEN:${appendOnly.sourcePhaseReceiptRewritten}`,
      );
    }
    if (appendOnly.dischargeReceiptsAreSeparateArtifacts !== true) {
      findings.push(
        `SEMANTICS_DISCHARGE_RECEIPTS_NOT_SEPARATE:${appendOnly.dischargeReceiptsAreSeparateArtifacts}`,
      );
    }
    if (appendOnly.schema !== SCHEMA_PATH) {
      findings.push(`SEMANTICS_APPEND_ONLY_SCHEMA:${appendOnly.schema}`);
    }
  }

  const successorAdmission = semantics.successorAdmission;
  if (!isPlainObject(successorAdmission)) {
    findings.push(`SEMANTICS_SUCCESSOR_ADMISSION_ABSENT:${TYPE_OF(successorAdmission)}`);
  } else if (successorAdmission.noSkip !== true) {
    findings.push(`SEMANTICS_NO_SKIP:${successorAdmission.noSkip}`);
  }

  return dedupe(findings);
}

// -------------------------------------------------------------------------------------
// 8. The whole decision, as a pure function of read facts
// -------------------------------------------------------------------------------------

export function evaluate(facts) {
  const findings = [];
  const summary = {
    edges: 0,
    intraAtomic: 0,
    forwardDeferred: 0,
    backward: 0,
    duplicate: 0,
    missing: 0,
    extra: 0,
    phases: 0,
    discharges: 0,
    historicalLiteralReceipts: 0,
    externalEvidence: facts.externalEvidence?.state ?? "absent",
    capabilityDelta: "UNKNOWN",
    supersedesHistoricalP00Artifacts: null,
  };

  const { addendum, schema } = facts;

  if (!isPlainObject(addendum)) {
    findings.push(`ADDENDUM_UNREADABLE:${ADDENDUM_PATH}`);
  }
  if (!isPlainObject(schema)) {
    findings.push(`SCHEMA_UNREADABLE:${SCHEMA_PATH}`);
  } else {
    findings.push(...schemaViolations(schema));
  }
  findings.push(...(facts.externalEvidence?.findings ?? []));

  if (!isPlainObject(addendum)) return { findings: dedupe(findings), summary };

  // The package must keep saying what it is not, or it stops being additive.
  if (addendum.supersedesHistoricalP00Artifacts !== false) {
    findings.push("SUPERSESSION_CLAIMED");
  }
  if (addendum.rewritesAnyHistoricalArtifact !== false) findings.push("REWRITE_CLAIMED");
  if (addendum.capabilityDelta !== "NONE") {
    findings.push(`CAPABILITY_DELTA:${addendum.capabilityDelta}`);
  }
  if ((addendum.newlyBuildableProducts ?? []).length !== 0) findings.push("NEW_CAPABILITY_CLAIMED");
  if (addendum.readinessFlagBinding?.mutatesAnyFlag !== false) findings.push("FLAG_MUTATION_CLAIMED");
  for (const flag of [
    "kernelReady",
    "sdkReady",
    "appBuildable",
    "releaseAllowed",
    "deployAllowed",
    "productionAllowed",
    "gapClosed",
  ]) {
    if (addendum.readinessFlagBinding?.values?.[flag] !== false) {
      findings.push(`READINESS_FLAG:${flag}`);
    }
  }
  if (addendum.correctedSentence?.scopeOfCorrection !== "execution-interpretation-only") {
    findings.push("CORRECTION_SCOPE");
  }
  if (addendum.correctedSentence?.historicalTextPreserved !== true) {
    findings.push("HISTORICAL_TEXT_NOT_PRESERVED");
  }
  if (addendum.dependencySourceOfTruth !== "reports/p00-treaty-correction/08-DEPENDENCY-OVERLAY.tsv") {
    findings.push("DEPENDENCY_SOURCE_OF_TRUTH");
  }
  if (addendum.executionProjection?.producesNoReceipt !== true) findings.push("RECEIPT_CLAIMED");
  if (addendum.executionProjection?.producesNoSignature !== true) findings.push("SIGNATURE_CLAIMED");
  if (addendum.executionProjection?.producesNoClosedGap !== true) findings.push("CLOSED_GAP_CLAIMED");

  // The canonical statement itself, not only its projections. Without this line every check below
  // can pass while the document says the opposite of what the package was written to say.
  findings.push(...semanticContractViolations(addendum.semantics));

  for (const file of addendum.sourcePins?.files ?? []) {
    if (!SHA256.test(file.sha256 ?? "")) findings.push(`PIN_SHAPE:${file.path}`);
  }
  if (!SHA256.test(addendum.sourcePins?.independentDeadlockAudit?.sha256 ?? "")) {
    findings.push("PIN_SHAPE:independentDeadlockAudit");
  }

  const model = modelFromAddendum(addendum);
  summary.phases = model.phases.length;
  summary.supersedesHistoricalP00Artifacts = addendum.supersedesHistoricalP00Artifacts;
  summary.capabilityDelta = addendum.capabilityDelta;

  const graph = analyzeClosureGraph(model);
  findings.push(...graph.violations);
  Object.assign(summary, {
    edges: graph.counts.totalEdges,
    intraAtomic: graph.counts.intraAtomic,
    forwardDeferred: graph.counts.forwardDeferred,
    backward: graph.counts.backward,
    duplicate: graph.counts.duplicate,
    missing: graph.counts.missing,
    extra: graph.counts.extra,
  });

  const declared = addendum.closureEdgeProjection?.counts ?? {};
  for (const [field, actual] of Object.entries({
    totalEdges: graph.counts.totalEdges,
    intraAtomic: graph.counts.intraAtomic,
    forwardDeferred: graph.counts.forwardDeferred,
    backward: graph.counts.backward,
    duplicate: graph.counts.duplicate,
    missing: graph.counts.missing,
    extra: graph.counts.extra,
  })) {
    if (declared[field] !== actual) {
      findings.push(`DECLARED_COUNT:${field}:${declared[field]}!=${actual}`);
    }
  }

  findings.push(...analyzeChainIntegrity(model));

  const literal = simulateExecution(model, { semantics: HISTORICAL_LITERAL });
  summary.historicalLiteralReceipts = literal.reachedPhaseReceipts.length;
  if (!literal.deadlocked) findings.push("HISTORICAL_LITERAL_NOT_DEADLOCKED");

  const corrected = simulateExecution(model, { semantics: P01_CLOSURE_SEMANTICS_V1 });
  findings.push(...corrected.violations);
  summary.discharges = corrected.discharges.length;

  const expectedOrder = addendum.executionProjection?.expectedReceiptOrder ?? [];
  if (JSON.stringify(corrected.reachedPhaseReceipts) !== JSON.stringify(expectedOrder)) {
    findings.push(
      `RECEIPT_ORDER:${corrected.reachedPhaseReceipts.length}!=${expectedOrder.length}`,
    );
  }
  if (corrected.deadlocked) findings.push(`CORRECTED_DEADLOCK:${corrected.blockedPhases.join(",")}`);
  if (corrected.openDebts.length !== 0) {
    findings.push(`UNDISCHARGED_DEBT:${corrected.openDebts.join(",")}`);
  }
  if (corrected.discharges.length !== graph.counts.totalEdges) {
    findings.push(`DISCHARGE_COUNT:${corrected.discharges.length}!=${graph.counts.totalEdges}`);
  }
  if (corrected.receiptsIssued !== 0 || corrected.signaturesProduced !== 0) {
    findings.push("SIMULATION_ISSUED_SOMETHING");
  }

  return { findings: dedupe(findings), summary };
}

function readJson(base, relative) {
  const absolute = path.join(base, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

/** The reader composed with the evaluators. Reads a real tree; changes nothing in it. */
export function runCheck(rootDirectory) {
  const base = typeof rootDirectory === "string" && rootDirectory !== "" ? rootDirectory : root;
  const addendum = readJson(base, ADDENDUM_PATH);
  const schema = readJson(base, SCHEMA_PATH);
  const externalEvidence = isPlainObject(addendum)
    ? externalEvidenceReport(addendum)
    : { state: "absent", findings: [], verifiedFiles: 0 };
  return evaluate({ addendum, schema, externalEvidence });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = runCheck(root);
  if (report.findings.length > 0) {
    console.error(`p01-closure-semantics: RED\n  - ${report.findings.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    const { summary } = report;
    console.log(
      `OK p01-closure-semantics: edges=${summary.edges}/${summary.edges} ` +
        `intraAtomic=${summary.intraAtomic} forwardDeferred=${summary.forwardDeferred} ` +
        `backward=${summary.backward} duplicate=${summary.duplicate} missing=${summary.missing} ` +
        `extra=${summary.extra} phases=${summary.phases} discharges=${summary.discharges} ` +
        `historicalLiteralReceipts=${summary.historicalLiteralReceipts} ` +
        `externalEvidence=${summary.externalEvidence} ` +
        `supersedesP00=${summary.supersedesHistoricalP00Artifacts} ` +
        `capabilityDelta=${summary.capabilityDelta}`,
    );
    console.log(
      "P01 closure semantics is an additive forward-only successor contract: it corrects the " +
        "execution reading of one exit-blocking sentence, supersedes no P00 historical artifact, " +
        "moves no readiness flag, and issues no receipt.",
    );
  }
}
