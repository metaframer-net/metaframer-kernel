// P07 — generic action SDK generator. Renders a deterministic, import-free ESM SDK module
// from a P02 ActionContract instance. The only capability this module has beyond string
// templating is reading the contract's own public shape; it performs no I/O.

import { ActionContract } from "../src/application/action-contract.mjs";

const isExactContract = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === ActionContract.prototype;

export function renderActionSdk(contract) {
  if (!isExactContract(contract)) {
    throw new TypeError("renderActionSdk requires an exact ActionContract instance");
  }
  const fields = JSON.stringify([...contract.fields]);
  const outcomes = JSON.stringify([...contract.outcomes]);
  const errorFields = JSON.stringify([...contract.errorEnvelopeFields]);
  return `export const ACTION_KIND = ${JSON.stringify(contract.kind)};
export const ACTION_NAME = ${JSON.stringify(contract.name)};
export const ACTION_VERSION = ${contract.version};
export const ACTION_FIELDS = Object.freeze(${fields});
export const OUTCOMES = Object.freeze(${outcomes});
export const ERROR_ENVELOPE_FIELDS = Object.freeze(${errorFields});

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

export function buildActionSpec(spec) {
  if (!isOrdinaryObject(spec)) {
    throw new TypeError("buildActionSpec needs an ordinary object");
  }
  const keys = Reflect.ownKeys(spec);
  if (keys.length !== ACTION_FIELDS.length || !ACTION_FIELDS.every((field) => keys.includes(field))) {
    throw new TypeError("buildActionSpec needs exactly the declared fields");
  }
  const out = {};
  for (const field of ACTION_FIELDS) out[field] = spec[field];
  return Object.freeze(out);
}

export function isOutcome(value) {
  return typeof value === "string" && OUTCOMES.includes(value);
}

export function isErrorEnvelope(value) {
  if (!isOrdinaryObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === ERROR_ENVELOPE_FIELDS.length && ERROR_ENVELOPE_FIELDS.every((field) => keys.includes(field));
}

Object.freeze(buildActionSpec);
Object.freeze(isOutcome);
Object.freeze(isErrorEnvelope);
`;
}
