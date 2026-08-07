#!/usr/bin/env node
// Composes the single final state line, and decides which kind of line it is.
//
// On the admitted path — activation resolved effective — that line is the project's authority,
// labelled CURRENT EFFECTIVE. On every other path it is a checkout-local, explicitly
// non-effective projection, and no CURRENT EFFECTIVE line is emitted at all.
//
// The consumer-sync verifier is the activation base: it establishes what is in force before this
// package activates, and it is historical, frozen, and not ours to edit. So this tool wraps it
// rather than changing it — it runs the verifier as a subprocess, takes its output verbatim,
// relabels its CURRENT EFFECTIVE line as the activation base, and appends exactly one final line
// of its own, under whichever of the two labels the activation verdict earns.
//
// The relabelling is the point, and it holds on both paths. The base line arrives claiming to be
// current, because that is the only thing the frozen verifier knows how to say about itself. On
// the admitted path it is the state activation moved from, and leaving two lines both claiming to
// be current would make the output ambiguous at exactly the moment it matters. On the unadmitted
// path it must lose that claim too, because nothing this run produces is entitled to it. Deleting
// the base line would throw away the comparison, so it is relabelled either way: the facts survive
// and the claim to be current does not travel with them.
//
// Exactly one final line is emitted in both branches, and which label it carries is the other half
// of the same idea. `CURRENT EFFECTIVE:` is the project-authority label: it says what is in force
// for the project, and only the admitted activated path may carry it. A checkout that is not
// admitted still has something true to report, but what it reports is a fact about that working
// copy, so it carries the checkout-local projection label instead.
//
// The distinction matters because the unactivated values are not a weaker version of the
// authoritative ones. Printing `CURRENT EFFECTIVE: ... runtimeImplementationStarted=false
// activationRecord=absent` from a feature checkout would state, in the project's own vocabulary,
// that runtime implementation has not started and no activation record exists — denying a
// published activation record rather than reporting a local reading of it. So the two branches
// differ in label as well as in values, never in the number of lines.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ACTIVATION_STATE, resolveActivation } from "./check-kernel-runtime-substrate-s1.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CURRENT_PREFIX = "CURRENT EFFECTIVE:";
export const CHECKOUT_LOCAL_PROJECTION_PREFIX =
  "CHECKOUT-LOCAL PROJECTION (non-effective; not project authority):";
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

/**
 * Format the final line.
 *
 * The values are the same computation either way; `prefix` selects which of the two kinds of line
 * they are being reported as. The default is the checkout-local projection, never the
 * project-authority label: a caller that says nothing about admission has not established any, so
 * the safe reading of silence is that this line speaks only for the checkout it was produced in.
 * Authority has to be asked for by name, and `composeCurrentEffective` below is the only place
 * that asks — and only when activation resolved effective.
 */
export function formatCurrentEffective(
  state,
  { activationRecord = "absent", prefix = CHECKOUT_LOCAL_PROJECTION_PREFIX } = {},
) {
  const flags = REPORTED_FLAGS.map((flag) => `${flag}=${state[flag]}`).join(" ");
  return `${prefix} verdict=${state.verdict} ${flags} activationRecord=${activationRecord}`;
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
  // Admitted or not admitted decides the label as well as the values: authority for the one path
  // that was actually activated, a checkout-local projection for every other.
  lines.push(
    formatCurrentEffective(state, {
      prefix: effective ? CURRENT_PREFIX : CHECKOUT_LOCAL_PROJECTION_PREFIX,
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
