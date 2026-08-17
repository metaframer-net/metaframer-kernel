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
