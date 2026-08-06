#!/usr/bin/env node
// Composes the single authoritative current-effective line.
//
// The consumer-sync verifier is the activation base: it establishes what is in force before this
// package activates, and it is historical, frozen, and not ours to edit. So this tool wraps it
// rather than changing it — it runs the verifier as a subprocess, takes its output verbatim,
// relabels its CURRENT EFFECTIVE line as the activation base, and appends exactly one final
// CURRENT EFFECTIVE line of its own.
//
// The relabelling is the point. Before activation the base line *is* the current state, and after
// activation it is the state activation moved from. Leaving two lines both claiming to be current
// would make the output ambiguous at exactly the moment it matters; deleting the base line would
// throw away the comparison. Relabelling keeps both facts and leaves only one of them current.
//
// Exactly one CURRENT EFFECTIVE line is emitted in both branches. Not effective and effective are
// different values on that line, never a different number of lines.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ACTIVATION_STATE, resolveActivation } from "./check-kernel-runtime-substrate-s1.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CURRENT_PREFIX = "CURRENT EFFECTIVE:";
export const ACTIVATION_BASE_PREFIX =
  "ACTIVATION BASE (verified, non-effective; the state activation starts from):";

/** The flags the composed line reports, in a fixed order so the output is stable. */
const REPORTED_FLAGS = [
  "codeStartAllowed",
  "runtimeCodeAllowed",
  "runtimeImplementationStarted",
  "kernelReady",
  "sdkReady",
  "appBuildable",
  "releaseAllowed",
  "deployAllowed",
  "productionAllowed",
  "gapClosed",
];

export function formatCurrentEffective(state, { activationRecord = "absent" } = {}) {
  const flags = REPORTED_FLAGS.map((flag) => `${flag}=${state[flag]}`).join(" ");
  return `${CURRENT_PREFIX} verdict=${state.verdict} ${flags} activationRecord=${activationRecord}`;
}

/**
 * Compose the final output.
 *
 * `consumerSyncOutput` is consumed, never modified: the array is copied before anything touches it,
 * and every line other than the base line passes through untouched.
 */
export function composeCurrentEffective({ consumerSyncOutput = [], activation = {} } = {}) {
  const source = [...consumerSyncOutput];

  // Exactly one base line, or nothing is composed at all.
  //
  // Zero means the verifier this wraps did not say what is in force, so there is nothing to relabel
  // and appending a final line would be inventing the answer. More than one means the input already
  // disagreed with itself, and picking the first would quietly resolve a contradiction the reader
  // needs to see. Both are refusals, not defaults.
  const baseLines = source.filter((line) => line.startsWith(CURRENT_PREFIX));
  if (baseLines.length !== 1) {
    return {
      ok: false,
      lines: null,
      activationBase: null,
      effective: false,
      state: null,
      errors: [`activation-base-line-count:${baseLines.length}`],
    };
  }

  const lines = [];
  let activationBase = null;
  for (const line of source) {
    if (activationBase === null && line.startsWith(CURRENT_PREFIX)) {
      activationBase = line;
      lines.push(`${ACTIVATION_BASE_PREFIX} ${line.slice(CURRENT_PREFIX.length).trim()}`);
    } else {
      lines.push(line);
    }
  }

  const effective = activation?.effective === true;
  // Activation moves exactly one dimension. Everything stronger stays false in both branches, and
  // no flag outside this set is introduced to work around that.
  const state = { ...ACTIVATION_STATE, runtimeImplementationStarted: effective };
  lines.push(
    formatCurrentEffective(state, {
      activationRecord: effective ? "external-annotated-tag" : "absent",
    }),
  );

  return { ok: true, lines, activationBase, effective, state, errors: [] };
}

export function main(argv = process.argv.slice(2)) {
  const verifier = argv[0];
  if (!verifier) {
    console.error("FAIL compose-current-effective: no activation-base verifier was given");
    return 1;
  }
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [path.join(ROOT, verifier)], {
      encoding: "utf8",
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    // The base verifier is authoritative about itself: if it fails, so does the composition, and
    // its own output is what the reader needs to see.
    if (error?.stdout) process.stdout.write(error.stdout);
    console.error(`FAIL compose-current-effective: ${verifier} exited non-zero`);
    return typeof error?.status === "number" ? error.status : 1;
  }

  const consumerSyncOutput = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const activation = resolveActivation({ root: ROOT });
  const composed = composeCurrentEffective({ consumerSyncOutput, activation });
  if (!composed.ok) {
    // Nothing goes to stdout: a partial composition would read as an answer.
    console.error(`FAIL compose-current-effective: ${composed.errors.join(", ")}`);
    console.error(
      `  expected exactly one line beginning "${CURRENT_PREFIX}" in the output of ${verifier}`,
    );
    return 1;
  }
  for (const line of composed.lines) console.log(line);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
