// Deterministic generator for src/sdk/create-customer.mjs.
//
// Exports a pure render function, renderCreateCustomerSdk(protocol), that takes the parsed
// contents of planning/gj01-generated-sdk-protocol-readiness.json and returns the exact source
// text of the generated SDK artifact as a string. The render path performs no network, no
// environment read, no clock, no random value and no file I/O: it is a pure string template over
// its input. File reading/printing/checking is confined to the CLI entry point below, which never
// writes to the repository.

/** Pure: build the generated SDK source text from the pinned protocol contract. */
export function renderCreateCustomerSdk(protocol) {
  const typed = protocol.protocolContract.typedAction.createCustomerV1;
  const envelope = protocol.protocolContract.errorEnvelope;

  const actionName = JSON.stringify(typed.actionName);
  const actionSpecFields = typed.actionSpecFields.map((field) => `  ${JSON.stringify(field)},`).join("\n");
  const outcomes = typed.outcomes.map((outcome) => JSON.stringify(outcome)).join(", ");
  const errorEnvelopeFields = envelope.fields.map((field) => JSON.stringify(field)).join(", ");
  const assignments = typed.actionSpecFields.map((field) => `    ${field}: input.${field},`).join("\n");

  return `// Generated SDK artifact for CreateCustomer@1.
//
// Byte-derived from the frozen protocol contract in
// planning/gj01-generated-sdk-protocol-readiness.json, which itself pins the ActionSpec fields,
// outcomes and error envelope fields already closed by src/application/create-customer-pipeline.mjs.
// This module imports nothing — not the application runtime, not a framework, not a delivery
// package — and performs no capability access: no network, no environment read, no clock, no
// random value, no file I/O. It is a generated data/behavior artifact only, not a runtime.

export const ACTION_NAME = ${actionName};
export const ACTION_VERSION = ${typed.actionVersion};

export const ACTION_SPEC_FIELDS = Object.freeze([
${actionSpecFields}
]);

export const OUTCOMES = Object.freeze([${outcomes}]);

export const ERROR_ENVELOPE_FIELDS = Object.freeze([${errorEnvelopeFields}]);

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Build a CreateCustomer@1 ActionSpec carrying exactly the pinned fields, or throw on the first
 * missing or extra one. Pure: no defaulting and no coercion beyond the exact-shape check itself.
 */
export function buildCreateCustomerActionSpec(input) {
  if (!isOrdinaryObject(input)) {
    throw new TypeError("CreateCustomer@1 ActionSpec needs an ordinary object");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== ACTION_SPEC_FIELDS.length || ACTION_SPEC_FIELDS.some((key) => !keys.includes(key))) {
    throw new TypeError(\`CreateCustomer@1 ActionSpec must carry exactly these keys: \${ACTION_SPEC_FIELDS.join(", ")}\`);
  }
  return Object.freeze({
${assignments}
  });
}

/** True only for one of the four pinned CreateCustomer@1 outcomes. */
export function isCreateCustomerOutcome(value) {
  return typeof value === "string" && OUTCOMES.includes(value);
}

/** True only for an ordinary object carrying exactly the pinned error-envelope fields. */
export function isCreateCustomerErrorEnvelope(value) {
  if (!isOrdinaryObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === ERROR_ENVELOPE_FIELDS.length
    && ERROR_ENVELOPE_FIELDS.every((field) => keys.includes(field));
}

Object.freeze(buildCreateCustomerActionSpec);
Object.freeze(isCreateCustomerOutcome);
Object.freeze(isCreateCustomerErrorEnvelope);
`;
}

// ---------------------------------------------------------------------------------------
// CLI entry point. Reads the protocol contract and either prints the rendered SDK source to
// stdout (default) or checks it against the committed artifact without writing anything
// (--check). Never writes to the repository.
// ---------------------------------------------------------------------------------------
async function runCli() {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const protocolPath = path.join(root, "planning/gj01-generated-sdk-protocol-readiness.json");
  const sdkPath = path.join(root, "src/sdk/create-customer.mjs");

  const protocol = JSON.parse(await readFile(protocolPath, "utf8"));
  const rendered = renderCreateCustomerSdk(protocol);

  if (process.argv.includes("--check")) {
    const committed = await readFile(sdkPath, "utf8");
    if (rendered !== committed) {
      process.stderr.write("generated SDK output does not match src/sdk/create-customer.mjs\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write("src/sdk/create-customer.mjs matches the deterministic generator output\n");
    return;
  }

  process.stdout.write(rendered);
}

const isDirectCliInvocation = () => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  return import.meta.url === new URL(process.argv[1], "file://").href
    || import.meta.url === `file://${process.argv[1]}`;
};

if (isDirectCliInvocation()) {
  await runCli();
}
