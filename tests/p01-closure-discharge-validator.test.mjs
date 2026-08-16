import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema, schemaViolations } from "../tools/check-p01-closure-semantics.mjs";

// =====================================================================================
// PKG-01B — reusable fail-closed JSON-Schema-subset validator for the merged
// CLOSURE_DISCHARGE schema (planning/p01-closure-discharge.schema.json).
//
// Scope: only the two exports above. No cross-field discharge decision, no graph/state
// logic, no receipt append. See /tmp/p01-pkg01b-synthesized-scope-20260817.txt.
// =====================================================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, "..", "planning", "p01-closure-discharge.schema.json");

function readMergedSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
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

test("validateAgainstSchema: a well-formed discharge receipt passes against the merged schema", () => {
  const schema = readMergedSchema();
  assert.deepEqual(validateAgainstSchema(schema, validDischarge()), []);
});

test("validateAgainstSchema: an unknown top-level property fails", () => {
  const schema = readMergedSchema();
  const value = { ...validDischarge(), notInSchema: true };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("notInSchema")));
});

test("validateAgainstSchema: an unknown nested property fails", () => {
  const schema = readMergedSchema();
  const value = {
    ...validDischarge(),
    readinessFlagMutation: { mutatesAnyFlag: false, movesFlag: "kernelReady" },
  };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("movesFlag")));
});

test("validateAgainstSchema: a missing required field fails", () => {
  const schema = readMergedSchema();
  const value = validDischarge();
  delete value.destinationPhaseReceiptHash;
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("destinationPhaseReceiptHash")));
});

test("validateAgainstSchema: a type mismatch fails", () => {
  const schema = readMergedSchema();
  const value = { ...validDischarge(), appendOnly: "true" };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("appendOnly")));
});

test("validateAgainstSchema: a non-enum value fails", () => {
  const schema = readMergedSchema();
  const value = { ...validDischarge(), classification: "BACKWARD" };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("classification")));
});

test("validateAgainstSchema: a pattern mismatch fails", () => {
  const schema = readMergedSchema();
  const value = { ...validDischarge(), dischargeId: "not-a-discharge-id" };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("dischargeId")));
});

test("validateAgainstSchema: a const mismatch fails", () => {
  const schema = readMergedSchema();
  const value = { ...validDischarge(), appendOnly: false };
  const violations = validateAgainstSchema(schema, value);
  assert.ok(violations.some((v) => v.includes("appendOnly")));
});

test("validateAgainstSchema: an unsupported schema keyword fails closed", () => {
  const schema = { type: "string", format: "date-time" };
  const violations = validateAgainstSchema(schema, "2026-08-17T00:00:00Z");
  assert.ok(violations.some((v) => v.includes("format")));
});

test("validateAgainstSchema: an unsupported nested schema keyword fails closed", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      value: { type: "number", minimum: 0 },
    },
  };
  const violations = validateAgainstSchema(schema, { value: 1 });
  assert.ok(violations.some((v) => v.includes("minimum")));
});

test("validateAgainstSchema: an unsupported schema type is rejected", () => {
  const schema = { type: "number" };
  const violations = validateAgainstSchema(schema, 1);
  assert.ok(violations.some((v) => v.includes("unsupported schema type") && v.includes("number")));
});

test("validateAgainstSchema: an array item violation is reported", () => {
  const schema = {
    type: "array",
    items: { type: "string", minLength: 1 },
  };
  const violations = validateAgainstSchema(schema, ["ok", ""]);
  assert.ok(violations.length > 0);
});

test("schemaViolations: the merged CLOSURE_DISCHARGE schema has no violations", () => {
  const schema = readMergedSchema();
  assert.deepEqual(schemaViolations(schema), []);
});

test("schemaViolations: a schema missing a stable required field is flagged", () => {
  const schema = readMergedSchema();
  const broken = { ...schema, required: schema.required.filter((f) => f !== "appendOnly") };
  const violations = schemaViolations(broken);
  assert.ok(violations.some((v) => v.includes("appendOnly")));
});

test("schemaViolations: an object schema without additionalProperties:false is not closed", () => {
  const schema = readMergedSchema();
  const broken = { ...schema, additionalProperties: true };
  const violations = schemaViolations(broken);
  assert.ok(violations.some((v) => v.toLowerCase().includes("closed")));
});

test("schemaViolations: a nested object schema without additionalProperties:false is not closed", () => {
  const schema = readMergedSchema();
  const broken = {
    ...schema,
    properties: {
      ...schema.properties,
      readinessFlagMutation: {
        ...schema.properties.readinessFlagMutation,
        additionalProperties: true,
      },
    },
  };
  const violations = schemaViolations(broken);
  assert.ok(violations.some((v) => v.toLowerCase().includes("closed") && v.includes("readinessFlagMutation")));
});
