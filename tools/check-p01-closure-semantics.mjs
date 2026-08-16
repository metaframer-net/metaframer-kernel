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
