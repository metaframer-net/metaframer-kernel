// P07 — generic action SDK generator. Renders a deterministic, import-free ESM SDK module
// from a P02 ActionContract instance. The only capability this module has beyond string
// templating is reading the contract's own public shape; it performs no I/O.
//
// P24E2 — every module rendered here opens with the MIT grant, verbatim. P24E1 stated the
// boundary and left MIT `pending`: decided, not granted, and the bytes an external consumer
// received carried no license text at all. The grant now travels in the bytes themselves, so a
// team holding a materialized payload can read what it may do without asking anyone. The text
// below is the OSI/SPDX MIT wording in its canonical 21-line wrap with the placeholders filled
// in once; it is frozen by digest in the P24E2 test, so it may not be reworded, reflowed or
// widened here. It rides inside the P08 integrity envelope because it is part of the module
// source the digest covers. The repository itself stays AGPL-3.0-only and is not relicensed;
// `diagnose.mjs` and `manifest.json` stay outside this grant, deliberately and on record.

import { ActionContract } from "../src/application/action-contract.mjs";

const MIT_LINES = Object.freeze([
  "MIT License",
  "",
  "Copyright (c) 2026 İsmail Karaca", // U+0130, the dotted capital I; an ASCII "Ismail" is a different name
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
]);

// One SPDX id, then the verbatim text as line comments. A blank license line becomes a bare `//`
// so no trailing space ever enters the rendered bytes and the digest stays stable.
const LICENSE_NOTICE = `${[
  "// SPDX-License-Identifier: MIT",
  "//",
  ...MIT_LINES.map((line) => (line === "" ? "//" : `// ${line}`)),
].join("\n")}\n`;

const isExactContract = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === ActionContract.prototype;

export function renderActionSdk(contract) {
  if (!isExactContract(contract)) {
    throw new TypeError("renderActionSdk requires an exact ActionContract instance");
  }
  const fields = JSON.stringify([...contract.fields]);
  const outcomes = JSON.stringify([...contract.outcomes]);
  const errorFields = JSON.stringify([...contract.errorEnvelopeFields]);
  return `${LICENSE_NOTICE}
export const ACTION_KIND = ${JSON.stringify(contract.kind)};
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
