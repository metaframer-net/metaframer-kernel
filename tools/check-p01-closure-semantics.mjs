import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// PKG-01B — reusable fail-closed JSON-Schema-subset validator and structural inspector for the
// merged CLOSURE_DISCHARGE schema (planning/p01-closure-discharge.schema.json).
//
// Scope is intentionally narrow: only the keywords exercised by that schema are implemented.
// Any other schema keyword is a violation, never a silent no-op, so an unsupported constraint
// cannot be mistaken for a satisfied one. No cross-field discharge decision, no graph/state
// logic and no receipt append happen here.

const KNOWN_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "required",
  "additionalProperties",
  "properties",
  "items",
  "const",
  "enum",
  "pattern",
  "minLength",
]);

const SUPPORTED_SCHEMA_TYPES = new Set(["object", "array", "string", "boolean"]);

const STABLE_CLOSURE_DISCHARGE_FIELDS = [
  "receiptKind",
  "dischargeId",
  "edgeId",
  "classification",
  "sourceGap",
  "destinationGap",
  "sourcePhase",
  "destinationPhase",
  "sourcePhaseReceiptId",
  "sourcePhaseReceiptHash",
  "destinationPhaseReceiptId",
  "destinationPhaseReceiptHash",
  "appendOnly",
  "sourceReceiptRewritten",
  "gapStatusAfter",
  "capabilityDelta",
  "readinessFlagMutation",
  "writerId",
  "reviewerId",
  "createdAtSource",
];

function describe(pointer) {
  return pointer || "<root>";
}

// Validates `instance` against `schema`, restricted to the keyword subset above. Returns a
// (possibly empty) list of human-readable violations; never throws on malformed instance data.
export function validateAgainstSchema(schema, instance, pointer = "") {
  const violations = [];

  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    violations.push(`${describe(pointer)}: schema node is not an object`);
    return violations;
  }

  for (const keyword of Object.keys(schema)) {
    if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
      violations.push(`${describe(pointer)}: unsupported schema keyword "${keyword}"`);
    }
  }

  if ("type" in schema && !SUPPORTED_SCHEMA_TYPES.has(schema.type)) {
    violations.push(`${describe(pointer)}: unsupported schema type "${schema.type}"`);
    return violations;
  }

  if ("const" in schema && instance !== schema.const) {
    violations.push(
      `${describe(pointer)}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(instance)}`,
    );
  }

  if ("enum" in schema && !(Array.isArray(schema.enum) && schema.enum.includes(instance))) {
    violations.push(
      `${describe(pointer)}: expected enum member of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(instance)}`,
    );
  }

  if (schema.type === "object") {
    if (typeof instance !== "object" || instance === null || Array.isArray(instance)) {
      violations.push(`${describe(pointer)}: expected object, got ${JSON.stringify(instance)}`);
      return violations;
    }
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in instance)) {
        violations.push(`${describe(pointer)}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in properties)) {
          violations.push(`${describe(pointer)}: unknown property "${key}"`);
        }
      }
    }
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in instance) {
        violations.push(...validateAgainstSchema(subSchema, instance[key], `${pointer}/${key}`));
      }
    }
    return violations;
  }

  if (schema.type === "array") {
    if (!Array.isArray(instance)) {
      violations.push(`${describe(pointer)}: expected array, got ${JSON.stringify(instance)}`);
      return violations;
    }
    if (schema.items) {
      instance.forEach((item, index) => {
        violations.push(...validateAgainstSchema(schema.items, item, `${pointer}/${index}`));
      });
    }
    return violations;
  }

  if (schema.type === "string") {
    if (typeof instance !== "string") {
      violations.push(`${describe(pointer)}: expected string, got ${JSON.stringify(instance)}`);
      return violations;
    }
    if (typeof schema.minLength === "number" && instance.length < schema.minLength) {
      violations.push(`${describe(pointer)}: shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(instance)) {
      violations.push(`${describe(pointer)}: "${instance}" does not match pattern ${schema.pattern}`);
    }
    return violations;
  }

  if (schema.type === "boolean" && typeof instance !== "boolean") {
    violations.push(`${describe(pointer)}: expected boolean, got ${JSON.stringify(instance)}`);
  }

  return violations;
}

const INTRA_ATOMIC = "INTRA_ATOMIC";
const FORWARD_DEFERRED = "FORWARD_DEFERRED";

const dedupe = (values) => [...new Set(values)];

// Ports the source-only closure binding a prior validator used: it enumerates each phase's
// declared closure edges against edges owned by the phase of the edge's *source* gap alone. It
// never reads a destination, so a rewritten/unknown destination gap is invisible to it. Kept
// source-only by design as an executable characterization of that blind spot.
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

// Graph-aware classifier: judges the closure edges as a graph rather than a source-only count.
// Refuses an unknown endpoint, an endpoint/phase mismatch, a backward edge, an asserted
// classification that disagrees with the derived one, a destination-receipt mismatch, an
// ownership mistake, and a per-phase enumeration that duplicates, omits, adds or miscounts.
// Classification is derived, never trusted: same ordinal -> INTRA_ATOMIC, later ->
// FORWARD_DEFERRED, earlier -> BACKWARD_EDGE (always refused).
export function analyzeClosureGraph({ phases = [], edges = [], gapPhase = {} } = {}) {
  const violations = [];
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
      violations.push(`SOURCE_PHASE_MISMATCH:${id}:${edge.sourcePhase}!=${gapPhase[edge.sourceGap]}`);
      continue;
    }
    if (!ordinal.has(edge.sourcePhase) || !ordinal.has(edge.destinationPhase)) {
      violations.push(`PHASE_UNKNOWN:${id}:${edge.sourcePhase}->${edge.destinationPhase}`);
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

function collectUnclosedObjectLevels(schema, pointer, violations) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      violations.push(`${describe(pointer)}: object schema is not closed (additionalProperties must be false)`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      collectUnclosedObjectLevels(subSchema, `${pointer}/${key}`, violations);
    }
  } else if (schema.type === "array" && schema.items) {
    collectUnclosedObjectLevels(schema.items, `${pointer}/items`, violations);
  }
}

// PKG-03 — pure fixed-point execution simulator that contrasts the historical literal reading
// of a closure obligation with the corrected P01 semantics on the same compact synthetic chain.
// Never mutates its inputs, never writes a file and never issues, signs or closes anything:
// `receiptsIssued`/`signaturesProduced`/`humanDecisionsClosed` are always 0. An unsupported
// semantics value fails closed with an explicit violation and claims no phase reachable.

export const HISTORICAL_LITERAL = "HISTORICAL_LITERAL";
export const P01_CLOSURE_SEMANTICS_V1 = "P01_CLOSURE_SEMANTICS_V1";
const SUPPORTED_EXECUTION_SEMANTICS = new Set([HISTORICAL_LITERAL, P01_CLOSURE_SEMANTICS_V1]);
const CLOSED = "CLOSED";
const CLOSURE_PENDING = "CLOSURE_PENDING";

/**
 * Run the chain to a fixed point under one reading of the closure obligations.
 *
 * `HISTORICAL_LITERAL` is the reading in force before this package: an obligation blocks the
 * source phase receipt until its destination phase receipt exists, which exposes the
 * self-cycle/deadlock. `P01_CLOSURE_SEMANTICS_V1` is the correction: a same-phase INTRA_ATOMIC
 * obligation discharges within the reached phase receipt, while a later FORWARD_DEFERRED
 * obligation becomes an open debt that keeps the source gap CLOSURE_PENDING and discharges only
 * once the destination phase receipt becomes reachable. Reachability is not issuance.
 */
export function simulateExecution(model, options = {}) {
  const semantics = options.semantics ?? P01_CLOSURE_SEMANTICS_V1;
  const phases = [...(model.phases ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  const edgeById = new Map((model.edges ?? []).map((edge) => [edge.edgeId, edge]));
  const ordinalByPhaseId = new Map(phases.map((phase) => [phase.id, phase.ordinal]));
  const allPhaseIds = phases.map((phase) => phase.id);
  const selfCycles = (model.edges ?? [])
    .filter((edge) => edge.sourcePhase === edge.destinationPhase)
    .map((edge) => edge.edgeId);

  if (!SUPPORTED_EXECUTION_SEMANTICS.has(semantics)) {
    return {
      semantics,
      reachedPhaseReceipts: [],
      admittedPhases: [],
      consumed: {},
      intraDischarges: [],
      forwardDebts: [],
      debtsRecordedAt: {},
      dischargeTimings: [],
      gapStatusAt: {},
      gapStatusFinal: {},
      blockedPhases: allPhaseIds,
      blockedBy: {},
      selfCycles,
      deadlocked: allPhaseIds.length > 0,
      violations: [`SEMANTICS_UNSUPPORTED:${String(semantics)}`],
      receiptsIssued: 0,
      signaturesProduced: 0,
      humanDecisionsClosed: 0,
    };
  }

  const issued = new Map();
  const admittedPhases = [];
  const consumed = {};
  const reachedPhaseReceipts = [];
  const intraDischarges = [];
  const dischargeTimings = [];
  const violations = [];
  const openDebts = new Map();
  const dischargedEdgeIds = new Set();
  const gapStatusAt = {};
  const debtsRecordedAt = {};

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
      dischargeTimings.push({
        edgeId,
        classification: FORWARD_DEFERRED,
        sourceGap: debt.sourceGap,
        destinationGap: debt.destinationGap,
        sourcePhaseReceipt: debt.sourcePhaseReceipt,
        destinationPhaseReceipt: issued.get(debt.destinationPhase),
        recordedAtReceipt: atReceipt,
      });
    }
  };

  let progress = true;
  while (progress) {
    progress = false;

    for (const phase of phases) {
      if (issued.has(phase.id)) continue;
      const predecessor = phase.predecessor ?? null;
      if (predecessor !== null && !issued.has(predecessor)) continue;
      if (!admittedPhases.includes(phase.id)) admittedPhases.push(phase.id);

      const obligations = [];
      let structurallyBlocked = false;
      for (const id of phase.closureEdgeIds ?? []) {
        const edge = edgeById.get(id);
        if (edge === undefined) {
          violations.push(`UNKNOWN_OBLIGATION:${phase.id}:${id}`);
          structurallyBlocked = true;
          continue;
        }
        if (edge.sourcePhase !== phase.id) {
          violations.push(`SOURCE_PHASE_MISMATCH:${phase.id}:${edge.edgeId}:${edge.sourcePhase}`);
          structurallyBlocked = true;
          continue;
        }
        if (!ordinalByPhaseId.has(edge.destinationPhase)) {
          violations.push(`DESTINATION_PHASE_UNKNOWN:${edge.edgeId}:${edge.destinationPhase}`);
          structurallyBlocked = true;
          continue;
        }
        const destinationOrdinal = ordinalByPhaseId.get(edge.destinationPhase);
        if (edge.classification === INTRA_ATOMIC && destinationOrdinal !== phase.ordinal) {
          violations.push(`INTRA_ATOMIC_OFF_PHASE:${edge.edgeId}`);
          structurallyBlocked = true;
          continue;
        }
        if (edge.classification === FORWARD_DEFERRED && destinationOrdinal === phase.ordinal) {
          violations.push(`FORWARD_DEFERRED_ON_PHASE:${edge.edgeId}`);
          structurallyBlocked = true;
          continue;
        }
        if (edge.classification === FORWARD_DEFERRED && destinationOrdinal < phase.ordinal) {
          violations.push(`FORWARD_DEFERRED_BACKWARD:${edge.edgeId}`);
          structurallyBlocked = true;
          continue;
        }
        if (edge.classification !== INTRA_ATOMIC && edge.classification !== FORWARD_DEFERRED) {
          violations.push(`UNCLASSIFIED_EDGE:${edge.edgeId}:${edge.classification}`);
          structurallyBlocked = true;
          continue;
        }
        obligations.push(edge);
      }
      if (structurallyBlocked) continue;

      if (semantics === HISTORICAL_LITERAL) {
        if (obligations.some((edge) => !issued.has(edge.destinationPhase))) continue;
      }

      if (predecessor !== null) consumed[phase.id] = issued.get(predecessor);
      issued.set(phase.id, phase.receiptId);
      reachedPhaseReceipts.push(phase.receiptId);
      progress = true;

      if (semantics === P01_CLOSURE_SEMANTICS_V1) {
        const recordedHere = [];
        for (const edge of obligations) {
          if (edge.classification === INTRA_ATOMIC) {
            dischargedEdgeIds.add(edge.edgeId);
            intraDischarges.push({
              edgeId: edge.edgeId,
              sourceGap: edge.sourceGap,
              destinationGap: edge.destinationGap,
              receiptId: phase.receiptId,
            });
          } else {
            const debt = Object.freeze({
              edgeId: edge.edgeId,
              sourceGap: edge.sourceGap,
              destinationGap: edge.destinationGap,
              destinationPhase: edge.destinationPhase,
              sourcePhaseReceipt: phase.receiptId,
            });
            openDebts.set(edge.edgeId, debt);
            recordedHere.push(debt);
          }
        }
        if (recordedHere.length > 0) debtsRecordedAt[phase.receiptId] = recordedHere;
        dischargeReadyDebts(phase.receiptId);
        gapStatusAt[phase.receiptId] = gapStatusSnapshot();
      }
    }
  }

  const blockedPhases = phases.filter((phase) => !issued.has(phase.id)).map((phase) => phase.id);
  const blockedBy = {};
  for (const phase of phases) {
    if (issued.has(phase.id)) continue;
    const open = (phase.closureEdgeIds ?? []).filter((id) => edgeById.has(id));
    if (open.length > 0) blockedBy[phase.id] = open;
  }

  return {
    semantics,
    reachedPhaseReceipts,
    admittedPhases,
    consumed,
    intraDischarges,
    forwardDebts: [...openDebts.values()],
    debtsRecordedAt,
    dischargeTimings,
    gapStatusAt,
    gapStatusFinal: gapStatusSnapshot(),
    blockedPhases,
    blockedBy,
    selfCycles,
    deadlocked: blockedPhases.length > 0,
    violations: dedupe(violations),
    receiptsIssued: 0,
    signaturesProduced: 0,
    humanDecisionsClosed: 0,
  };
}

// Structural inspector for the CLOSURE_DISCHARGE schema shape: flags a missing stable field and
// any object level (including nested) that is not closed. Does not validate any instance data.
export function schemaViolations(schema) {
  const violations = [];

  if (!schema || typeof schema !== "object" || schema.type !== "object") {
    violations.push("<root>: schema root must be a closed object schema");
    return violations;
  }

  const required = new Set(schema.required ?? []);
  for (const field of STABLE_CLOSURE_DISCHARGE_FIELDS) {
    if (!required.has(field)) {
      violations.push(`<root>: missing stable required field "${field}"`);
    }
  }

  collectUnclosedObjectLevels(schema, "", violations);

  return violations;
}

// PKG-04 — pure projection adapter and fail-closed external evidence pin verifier.
//
// `modelFromAddendum` hands out a deep clone so a negative probe run against the returned model
// can never mutate a future canonical addendum. `externalEvidenceReport` verifies every present
// pinned file by exact relative path confinement (realpath-checked within the real evidence
// root, so a traversal, absolute path or symlink escape can never cause a read outside it),
// byte length and sha256, and honestly distinguishes absent evidence (root missing) from
// verified evidence (every pin confined, present and exact) from drift (anything else,
// including a malformed pin declaration or a filesystem error).

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Returns a normalized, root-relative path, or null if `raw` is empty, absolute, or carries any
// raw ".." segment — refused before normalization so a path like "a/../b.txt" that would
// normalize back inside the root is still treated as unsafe.
function normalizeConfinedRelativePath(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (path.isAbsolute(raw)) return null;
  if (raw.split(/[/\\]/).includes("..")) return null;
  const normalized = path.normalize(raw);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return null;
  }
  return normalized;
}

/**
 * Deep-clones the closure model `{phases, edges, gapPhase}` out of the canonical nested
 * projection fields `addendum.phaseChainProjection.phases`,
 * `addendum.closureEdgeProjection.edges` and `addendum.gapRegistryProjection.gapPhase`. The
 * clone shares no references with the source, so callers (including negative probes) can freely
 * mutate the returned model without ever touching a future canonical addendum.
 */
export function modelFromAddendum(addendum) {
  const phases = Array.isArray(addendum?.phaseChainProjection?.phases)
    ? addendum.phaseChainProjection.phases
    : [];
  const edges = Array.isArray(addendum?.closureEdgeProjection?.edges)
    ? addendum.closureEdgeProjection.edges
    : [];
  const gapPhase = isPlainObject(addendum?.gapRegistryProjection?.gapPhase)
    ? addendum.gapRegistryProjection.gapPhase
    : {};
  return structuredClone({ phases, edges, gapPhase });
}

/**
 * Verifies the external evidence pinned by `addendum.sourcePins = {evidenceRoot, files}`.
 *
 * - `absent`: pins are well-formed but `evidenceRoot` does not exist at all.
 * - `verified`: `evidenceRoot` exists as a directory and every unique pin is confined, present,
 *   exact-byte and exact-sha256.
 * - `drifted`: malformed pins/root, an existing but non-directory or unreadable root, a
 *   duplicate path, an unsafe absolute/traversal path, a symlink escape, a file missing inside
 *   an existing root, or a bytes/sha256 mismatch.
 *
 * Never reads a target outside the real (symlink-resolved) evidence root. A filesystem error
 * while reading a confined, present target becomes an explicit drift finding, never a silent
 * skip or an uncontrolled success.
 */
export function externalEvidenceReport(addendum) {
  const drifted = (findings) => ({
    state: "drifted",
    findings: dedupe(findings),
    verifiedFiles: 0,
    derivedProjectionMatches: null,
  });

  const pins = isPlainObject(addendum) ? addendum.sourcePins : undefined;
  if (!isPlainObject(pins)) return drifted(["PINS_MALFORMED:sourcePins"]);
  if (!Array.isArray(pins.files)) return drifted(["PINS_MALFORMED:files"]);
  if (typeof pins.evidenceRoot !== "string" || pins.evidenceRoot.length === 0) {
    return drifted(["PINS_MALFORMED:evidenceRoot"]);
  }

  const shapeFindings = [];
  const seenPaths = new Set();
  const entries = [];
  for (const file of pins.files) {
    if (!isPlainObject(file)) {
      shapeFindings.push("PIN_MALFORMED:entry");
      continue;
    }
    const relativePath = normalizeConfinedRelativePath(file.path);
    if (relativePath === null) {
      shapeFindings.push(`PIN_UNSAFE_PATH:${JSON.stringify(file.path ?? null)}`);
      continue;
    }
    if (!Number.isInteger(file.bytes) || file.bytes < 0) {
      shapeFindings.push(`PIN_MALFORMED_BYTES:${relativePath}`);
      continue;
    }
    if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256)) {
      shapeFindings.push(`PIN_MALFORMED_SHA256:${relativePath}`);
      continue;
    }
    if (seenPaths.has(relativePath)) {
      shapeFindings.push(`PIN_DUPLICATE:${relativePath}`);
      continue;
    }
    seenPaths.add(relativePath);
    entries.push({ relativePath, bytes: file.bytes, sha256: file.sha256 });
  }
  if (shapeFindings.length > 0) return drifted(shapeFindings);

  if (!existsSync(pins.evidenceRoot)) {
    return { state: "absent", findings: [], verifiedFiles: 0, derivedProjectionMatches: null };
  }

  let rootStat;
  try {
    rootStat = statSync(pins.evidenceRoot);
  } catch {
    return drifted(["EVIDENCE_ROOT_UNREADABLE"]);
  }
  if (!rootStat.isDirectory()) {
    return drifted(["EVIDENCE_ROOT_NOT_A_DIRECTORY"]);
  }

  let realRoot;
  try {
    realRoot = realpathSync(pins.evidenceRoot);
  } catch {
    return drifted(["EVIDENCE_ROOT_UNREADABLE"]);
  }

  const driftFindings = [];
  let verifiedFiles = 0;

  for (const entry of entries) {
    const resolved = path.resolve(realRoot, entry.relativePath);

    let realTarget;
    try {
      realTarget = realpathSync(resolved);
    } catch {
      driftFindings.push(`MISSING_FILE:${entry.relativePath}`);
      continue;
    }

    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
      driftFindings.push(`PATH_ESCAPE:${entry.relativePath}`);
      continue;
    }

    let stat;
    try {
      stat = statSync(realTarget);
    } catch {
      driftFindings.push(`UNREADABLE_FILE:${entry.relativePath}`);
      continue;
    }
    if (!stat.isFile()) {
      driftFindings.push(`NOT_A_FILE:${entry.relativePath}`);
      continue;
    }

    let bytes;
    try {
      bytes = readFileSync(realTarget);
    } catch {
      driftFindings.push(`UNREADABLE_FILE:${entry.relativePath}`);
      continue;
    }

    if (bytes.length !== entry.bytes) {
      driftFindings.push(`BYTES_MISMATCH:${entry.relativePath}`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      driftFindings.push(`SHA256_MISMATCH:${entry.relativePath}`);
      continue;
    }

    verifiedFiles += 1;
  }

  if (driftFindings.length > 0) return drifted(driftFindings);

  return { state: "verified", findings: [], verifiedFiles, derivedProjectionMatches: null };
}

// PKG-05 — pure, total, deterministic validators for the canonical, deliberately partial
// planning/p01-closure-semantics-addendum.json, binding P01-CLOSURE-SEMANTICS-V1 (commit
// 900b19d). Never mutate the input; malformed/missing/unknown is a violation, never a throw.
export const SEMANTICS_ID = "P01-CLOSURE-SEMANTICS-V1";
export const BACKWARD_REFUSED = "BACKWARD_REFUSED";
export const HUMAN_GATE_REQUIRED_DECISION_STATE = "SATISFIED";
export const HUMAN_GATE_BLOCKING_DECISION_STATES = Object.freeze(["OPEN", "HUMAN_DECISION_REQUIRED", "UNANSWERED", "UNSATISFIED"]);
export const CANONICAL_SEPARATION = Object.freeze({
  phaseReceipt:
    "Produced when the phase's outputs, gates, review and human decisions are satisfied. It is what a successor consumes for no-skip admission.",
  gapFinalClosure:
    "A gap reaches CLOSED only when every CLOSURE obligation originating at it is discharged. This is a separate fact from the phase receipt and is never implied by it.",
  rule: "A CLOSURE edge blocks the source gap's final CLOSED state. It never blocks the source phase receipt on the ground that a forward destination receipt does not exist yet.",
});
const CANONICAL_CLASSIFICATIONS = Object.freeze({
  [INTRA_ATOMIC]: Object.freeze({
    definition: "sourcePhase == destinationPhase",
    discharge:
      "Discharged atomically inside the same phase receipt only when both the source and the destination evidence are present in that receipt and every human decision gating either side has been recorded SATISFIED by the authorized human; a decision still OPEN or otherwise unanswered leaves this obligation undischarged, and the reachability simulation's assumption that such a gate is satisfiable is a statement about a decision not yet made rather than that decision, so it signs nothing, answers nothing, closes nothing and produces no receipt.",
    sourceGapStatusAtSourceReceipt: "CLOSED",
  }),
  [FORWARD_DEFERRED]: Object.freeze({
    definition: "destinationPhase ordinal > sourcePhase ordinal",
    discharge:
      "Recorded in the source phase receipt as an append-only open debt carrying edgeId, sourceGap, destinationGap, destinationPhase and expectedDestinationReceipt. The source gap stays CLOSURE_PENDING and may not be reported CLOSED.",
    sourceGapStatusAtSourceReceipt: "CLOSURE_PENDING",
    dischargedBy:
      "A separate append-only CLOSURE_DISCHARGE receipt issued when the destination phase receipt is published. It binds sourcePhaseReceiptHash, destinationPhaseReceiptHash and edgeId. The source phase receipt is never rewritten.",
  }),
  [BACKWARD_REFUSED]: Object.freeze({
    definition: "destinationPhase ordinal < sourcePhase ordinal",
    admitted: false,
    reason:
      "No such edge exists in the accepted set, and the P00 rule GR-CLOSURE-MINIMAL already refuses one. A backward closure edge would be a PREREQ edge mislabelled.",
  }),
});
const HUMAN_GATE_DECISION_AUTHORITY = "authorized human";
const HUMAN_GATE_SIMULATION_FLAGS = Object.freeze({
  simulationMayAssumeGateSatisfiable: true,
  simulationAssumptionCountsAsSatisfaction: false,
  simulationSignsAnything: false,
  simulationClosesAnyHumanDecision: false,
  simulationProducesRealReceipt: false,
});
const SUCCESSOR_ADMISSION = Object.freeze({
  consumes: "the predecessor PHASE receipt only",
  doesNotWaitFor: "the future gap closures of the whole programme",
  noSkip: true,
  humanGateHandling:
    "Human and external gates are treated as satisfiable but never auto-closed. The simulation shows a receipt is reachable; it never signs one.",
});
const APPEND_ONLY = Object.freeze({
  sourcePhaseReceiptRewritten: false,
  dischargeReceiptsAreSeparateArtifacts: true,
  schema: "planning/p01-closure-discharge.schema.json",
});
const CANONICAL_NON_AUTHORIZATIONS = Object.freeze([
  "No RCPT-01 is produced, and this package does not authorise P01 entry.",
  "No human decision is answered, retyped, signed or closed.",
  "No kernel gap reaches CLOSED because of this package.",
  "No readiness, SDK, app, release, deploy or production flag moves.",
  "No historical P00 artifact is rewritten, copied or superseded.",
  "This package is not reviewed by the session that wrote it.",
]);

function classificationFieldViolations(key, canonical, actual, violations) {
  if (!isPlainObject(actual)) {
    violations.push(`CLASSIFICATION_MISSING:${key}`);
    return;
  }
  for (const field of Object.keys(canonical)) {
    if (!(field in actual)) violations.push(`CLASSIFICATION_FIELD_MISSING:${key}:${field}`);
    else if (actual[field] !== canonical[field]) violations.push(`CLASSIFICATION_FIELD_MISMATCH:${key}:${field}`);
  }
  for (const field of Object.keys(actual)) {
    if (!(field in canonical)) violations.push(`CLASSIFICATION_FIELD_EXTRA:${key}:${field}`);
  }
}
// Symmetric exact-field check: canonical fields must match; `extra` also flags any unknown key.
function exactFieldViolations(canonical, actual, code, violations, extra) {
  for (const field of Object.keys(canonical)) {
    if (actual[field] !== canonical[field]) violations.push(`${code}_MISMATCH:${field}`);
  }
  if (extra) {
    for (const field of Object.keys(actual)) {
      if (!(field in canonical)) violations.push(`${code}_EXTRA:${field}`);
    }
  }
}
const ALLOWED_HUMAN_GATE_KEYS = new Set(["realDischargeRequiredDecisionState", "realDischargeBlockingDecisionStates", "decisionAuthority", ...Object.keys(HUMAN_GATE_SIMULATION_FLAGS)]);
// Validates the blocks nested under `addendum.semantics` (everything but nonAuthorizations).
export function semanticContractViolations(semantics) {
  if (!isPlainObject(semantics)) return ["SEMANTICS_CONTAINER_MALFORMED"];
  const violations = [];
  if (semantics.id !== SEMANTICS_ID) violations.push("SEMANTICS_ID_MISMATCH");
  if (!isPlainObject(semantics.separation)) violations.push("SEPARATION_MISSING");
  else exactFieldViolations(CANONICAL_SEPARATION, semantics.separation, "SEPARATION_FIELD", violations, true);
  if (!isPlainObject(semantics.classifications)) {
    violations.push("CLASSIFICATIONS_MISSING");
  } else {
    for (const key of Object.keys(CANONICAL_CLASSIFICATIONS)) {
      classificationFieldViolations(key, CANONICAL_CLASSIFICATIONS[key], semantics.classifications[key], violations);
    }
    for (const key of Object.keys(semantics.classifications)) {
      if (!(key in CANONICAL_CLASSIFICATIONS)) violations.push(`CLASSIFICATION_EXTRA:${key}`);
    }
  }
  const gate = semantics.humanGatePolicy;
  if (!isPlainObject(gate)) {
    violations.push("HUMAN_GATE_POLICY_MISSING");
  } else {
    if (gate.realDischargeRequiredDecisionState !== HUMAN_GATE_REQUIRED_DECISION_STATE) violations.push("HUMAN_GATE_REQUIRED_DECISION_STATE_MISMATCH");
    if (gate.decisionAuthority !== HUMAN_GATE_DECISION_AUTHORITY) violations.push("HUMAN_GATE_DECISION_AUTHORITY_MISMATCH");
    if (!Array.isArray(gate.realDischargeBlockingDecisionStates)) {
      violations.push("HUMAN_GATE_BLOCKING_STATES_MISSING");
    } else {
      const canonicalSet = new Set(HUMAN_GATE_BLOCKING_DECISION_STATES);
      const seen = new Set();
      for (const state of gate.realDischargeBlockingDecisionStates) {
        if (seen.has(state)) violations.push(`HUMAN_GATE_BLOCKING_STATE_DUPLICATE:${state}`);
        seen.add(state);
        if (!canonicalSet.has(state)) violations.push(`HUMAN_GATE_BLOCKING_STATE_EXTRA:${state}`);
      }
      for (const state of canonicalSet) if (!seen.has(state)) violations.push(`HUMAN_GATE_BLOCKING_STATE_MISSING:${state}`);
    }
    exactFieldViolations(HUMAN_GATE_SIMULATION_FLAGS, gate, "HUMAN_GATE_SIMULATION_FIELD", violations, false);
    for (const field of Object.keys(gate)) {
      if (!ALLOWED_HUMAN_GATE_KEYS.has(field)) violations.push(`HUMAN_GATE_POLICY_FIELD_EXTRA:${field}`);
    }
  }
  if (!isPlainObject(semantics.successorAdmission)) violations.push("SUCCESSOR_ADMISSION_MISSING");
  else exactFieldViolations(SUCCESSOR_ADMISSION, semantics.successorAdmission, "SUCCESSOR_ADMISSION_FIELD", violations, true);
  if (!isPlainObject(semantics.appendOnly)) violations.push("APPEND_ONLY_MISSING");
  else exactFieldViolations(APPEND_ONLY, semantics.appendOnly, "APPEND_ONLY_FIELD", violations, true);
  return dedupe(violations);
}

// Exact ordered match against the canonical six-entry list; missing/extra/reorder/reword/duplicate all reported; never throws.
export function nonAuthorizationViolations(nonAuthorizations) {
  if (!Array.isArray(nonAuthorizations)) return ["NON_AUTHORIZATIONS_MALFORMED"];
  const violations = [];
  if (nonAuthorizations.length !== CANONICAL_NON_AUTHORIZATIONS.length) {
    violations.push(`NON_AUTHORIZATIONS_LENGTH_MISMATCH:${nonAuthorizations.length}!=${CANONICAL_NON_AUTHORIZATIONS.length}`);
  }
  const limit = Math.max(nonAuthorizations.length, CANONICAL_NON_AUTHORIZATIONS.length);
  for (let index = 0; index < limit; index += 1) {
    if (nonAuthorizations[index] !== CANONICAL_NON_AUTHORIZATIONS[index]) violations.push(`NON_AUTHORIZATION_MISMATCH:${index}`);
  }
  const seen = new Set();
  for (const entry of nonAuthorizations) {
    if (seen.has(entry)) violations.push(`NON_AUTHORIZATION_DUPLICATE:${JSON.stringify(entry)}`);
    seen.add(entry);
  }
  return dedupe(violations);
}

const CAPABILITY_DELTA = "NONE";
// Composes the two above and refuses a non-"NONE" capabilityDelta. Does not exact-close every
// top-level addendum key: later packages append projections/pins under their own gates.
export function addendumContractViolations(addendum) {
  if (!isPlainObject(addendum)) return ["ADDENDUM_MALFORMED"];
  const violations = [...semanticContractViolations(addendum.semantics), ...nonAuthorizationViolations(addendum.nonAuthorizations)];
  if (addendum.capabilityDelta !== CAPABILITY_DELTA) violations.push("CAPABILITY_DELTA_MISMATCH");
  return dedupe(violations);
}
