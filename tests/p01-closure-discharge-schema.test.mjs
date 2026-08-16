import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// =====================================================================================
// CLOSURE_DISCHARGE schema — focused structural/negative RED specification
//
// Scope: PKG-01A introduces only the append-only CLOSURE_DISCHARGE JSON Schema at
// planning/p01-closure-discharge.schema.json. It asserts that the schema is a closed
// (additionalProperties: false) object contract at every object level, including its nested
// readinessFlagMutation and createdAtSource objects, carrying the full stable receipt shape
// evidenced in 900b19d: the exact linkage/gap/phase/hash fields that bind a discharge to its
// source and destination phase receipts, the fixed enums/consts that make a discharge
// non-negotiable (receiptKind, appendOnly, sourceReceiptRewritten, gapStatusAfter,
// capabilityDelta, readinessFlagMutation.mutatesAnyFlag, classification), and that it refuses
// unknown properties (top-level and nested) and malformed hash/id shapes. No validator engine,
// checker script or runtime wiring is in scope here; the hand-rolled `validate` helper below
// exists only to exercise this one schema file in this one test.
// =====================================================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, "..", "planning", "p01-closure-discharge.schema.json");

function readSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

// Minimal structural validator: only what this schema uses (type/object, additionalProperties,
// required, const, enum, pattern). Not a general JSON Schema engine.
function validate(schema, value) {
  const errors = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push("not an object");
      return errors;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`missing required: ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`unknown property: ${key}`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(sub, value[key]).map((e) => `${key}: ${e}`));
    }
    return errors;
  }
  if ("const" in schema) {
    if (value !== schema.const) errors.push(`expected const ${JSON.stringify(schema.const)}`);
  }
  if ("enum" in schema) {
    if (!schema.enum.includes(value)) errors.push(`expected enum member of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type === "string") {
    if (typeof value !== "string") errors.push("not a string");
    else if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`does not match pattern ${schema.pattern}`);
    }
  }
  return errors;
}

const HASH = "a".repeat(64);
const UUID_A = "00000000-0000-0000-0000-000000000001";
const UUID_B = "00000000-0000-0000-0000-000000000002";

function validDischarge() {
  return {
    receiptKind: "CLOSURE_DISCHARGE",
    dischargeId: "DSCH-E-001",
    edgeId: "E-001",
    classification: "INTRA_ATOMIC",
    sourceGap: "KG-001",
    destinationGap: "KG-002",
    sourcePhase: "P01",
    destinationPhase: "P02",
    sourcePhaseReceiptId: "RCPT-01",
    sourcePhaseReceiptHash: HASH,
    destinationPhaseReceiptId: "RCPT-02",
    destinationPhaseReceiptHash: HASH,
    appendOnly: true,
    sourceReceiptRewritten: false,
    gapStatusAfter: "CLOSURE_PENDING",
    capabilityDelta: "NONE",
    readinessFlagMutation: { mutatesAnyFlag: false },
    writerId: UUID_A,
    reviewerId: UUID_B,
    createdAtSource: { source: "closure-ledger", value: "2026-08-17T00:00:00Z" },
  };
}

test("schema file exists and is a closed object schema", () => {
  const schema = readSchema();
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
});

test("schema requires the exact linkage and hash fields", () => {
  const schema = readSchema();
  for (const field of [
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
  ]) {
    assert.ok(schema.required.includes(field), `expected ${field} to be required`);
  }
});

test("schema pins the non-negotiable consts and enums", () => {
  const schema = readSchema();
  assert.equal(schema.properties.receiptKind.const, "CLOSURE_DISCHARGE");
  assert.equal(schema.properties.appendOnly.const, true);
  assert.equal(schema.properties.sourceReceiptRewritten.const, false);
  assert.equal(schema.properties.capabilityDelta.const, "NONE");
  assert.deepEqual(schema.properties.classification.enum, ["INTRA_ATOMIC", "FORWARD_DEFERRED"]);
  assert.deepEqual(schema.properties.gapStatusAfter.enum, ["CLOSED", "CLOSURE_PENDING"]);
  assert.equal(schema.properties.readinessFlagMutation.properties.mutatesAnyFlag.const, false);
});

test("nested readinessFlagMutation and createdAtSource objects are closed", () => {
  const schema = readSchema();
  assert.equal(schema.properties.readinessFlagMutation.additionalProperties, false);
  assert.equal(schema.properties.createdAtSource.additionalProperties, false);
  assert.equal(schema.properties.evidenceRefs.items.additionalProperties, false);
});

test("a well-formed discharge object validates", () => {
  const schema = readSchema();
  assert.deepEqual(validate(schema, validDischarge()), []);
});

test("an unknown property is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), notInSchema: true };
  assert.ok(validate(schema, value).some((e) => e.includes("unknown property: notInSchema")));
});

test("a missing required linkage field is refused", () => {
  const schema = readSchema();
  const value = validDischarge();
  delete value.destinationPhaseReceiptHash;
  assert.ok(validate(schema, value).some((e) => e.includes("missing required: destinationPhaseReceiptHash")));
});

test("a malformed receipt hash is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), sourcePhaseReceiptHash: "not-a-hash" };
  assert.ok(
    validate(schema, value).some((e) => e.includes("sourcePhaseReceiptHash") && e.includes("pattern")),
  );
});

test("a forged appendOnly=false is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), appendOnly: false };
  assert.ok(validate(schema, value).some((e) => e.includes("appendOnly") && e.includes("const")));
});

test("a rewritten-source claim is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), sourceReceiptRewritten: true };
  assert.ok(validate(schema, value).some((e) => e.includes("sourceReceiptRewritten") && e.includes("const")));
});

test("a non-enum classification is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), classification: "BACKWARD" };
  assert.ok(validate(schema, value).some((e) => e.includes("classification") && e.includes("enum")));
});

test("a non-NONE capabilityDelta is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), capabilityDelta: "OPENS_SOMETHING" };
  assert.ok(validate(schema, value).some((e) => e.includes("capabilityDelta") && e.includes("const")));
});

test("a readiness-flag mutation claim is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), readinessFlagMutation: { mutatesAnyFlag: true } };
  assert.ok(
    validate(schema, value).some(
      (e) => e.includes("readinessFlagMutation") && e.includes("mutatesAnyFlag") && e.includes("const"),
    ),
  );
});

test("an unknown property nested inside readinessFlagMutation is refused", () => {
  const schema = readSchema();
  const value = {
    ...validDischarge(),
    readinessFlagMutation: { mutatesAnyFlag: false, movesFlag: "kernelReady" },
  };
  assert.ok(
    validate(schema, value).some(
      (e) => e.includes("readinessFlagMutation") && e.includes("unknown property: movesFlag"),
    ),
  );
});

test("a non-CLOSED/CLOSURE_PENDING gapStatusAfter is refused", () => {
  const schema = readSchema();
  const value = { ...validDischarge(), gapStatusAfter: "OPEN" };
  assert.ok(validate(schema, value).some((e) => e.includes("gapStatusAfter") && e.includes("enum")));
});
