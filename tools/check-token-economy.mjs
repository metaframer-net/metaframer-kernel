import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// =====================================================================================
// Token economy governance — canonical-to-projection parity
//
// `token-economy-policy.json` is the only place a token-economy rule, threshold, model route or
// escalation gate is decided. The skill, the agent definition and the README section are
// projections. Parity is asserted in one direction only, so every finding below names the
// projection that moved and never invites the canonical file to be "corrected" to match a copy.
// The reverse repair turns a projection into a second source, and two sources is how a governance
// rule becomes a matter of opinion.
//
// The escalation gate list is checked against the guard's own exported constant rather than
// against a copy of it. A policy that lists gates the guard cannot escalate would read as
// enforcement while enforcing nothing, which is the failure mode this whole package exists to
// avoid in the first place.
//
// Fail-closed: an unreadable file is a finding, never a silent pass. An empty finding list is an
// all-clear, and an all-clear must never be reachable by accident.

const P = (...s) => path.join(root, ...s);
const POLICY = P("token-economy-policy.json");
const SKILL = P(".claude", "skills", "metaframer-token-economy", "SKILL.md");
const AGENT = P(".claude", "agents", "token-governor.md");

const readText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

export function evaluate({ policy, skill, agent, guardGates }) {
  const f = [];
  const add = (id, message) => f.push({ id, message });

  if (!policy) {
    add("canonical-unreadable", `${POLICY} could not be read or parsed`);
    return f;
  }
  if (policy.canonicalOwner !== "token-economy-policy.json") {
    add("canonical-owner-drift", "the policy no longer declares itself the canonical owner");
  }

  for (const [label, text, file] of [["skill", skill, SKILL], ["agent", agent, AGENT]]) {
    if (text === null) add(`${label}-missing`, `${file} could not be read`);
  }
  if (skill === null || agent === null) return f;

  for (const rel of policy.projections ?? []) {
    if (rel.startsWith("README")) continue;
    if (!existsSync(P(...rel.split("/")))) add("projection-missing", `declared projection absent: ${rel}`);
  }

  // Escalation gates: policy and guard must agree exactly.
  const declared = [...(policy.governor?.escalationGates ?? [])].sort();
  const enforced = [...guardGates].sort();
  if (JSON.stringify(declared) !== JSON.stringify(enforced)) {
    add("escalation-gate-drift",
      `policy gates ${declared.join(",")} do not match the guard's ${enforced.join(",")}`);
  }
  for (const gate of policy.governor?.escalationGates ?? []) {
    if (!new RegExp(gate.replace(/-/g, "[- ]"), "i").test(agent)) {
      add("agent-gate-drift", `the agent does not describe the declared gate: ${gate}`);
    }
  }

  // Model routing: every canonical tier must appear in the skill.
  for (const tier of Object.keys(policy.modelRouting ?? {})) {
    if (!new RegExp(`\\b${tier}\\b`, "i").test(skill)) {
      add("model-route-drift", `the skill omits the canonical model tier: ${tier}`);
    }
  }

  // The governor must remain event-driven and read-only in every projection.
  if (policy.governor?.invokedPerWave !== false) {
    add("governor-per-wave", "the policy allows per-wave governor invocation");
  }
  if (/before and after (every|each) wave/i.test(agent)) {
    add("agent-per-wave", "the agent describes a per-wave loop the policy forbids");
  }
  const toolLine = /\ntools:\s*(.+)/.exec(agent)?.[1] ?? "";
  for (const forbidden of ["Write", "Edit", "NotebookEdit", "Agent"]) {
    if (toolLine.includes(forbidden)) {
      add("agent-tool-drift", `the governor holds a forbidden tool: ${forbidden}`);
    }
  }

  // Quality floors must stay shut. A saving that needs one of these open is not available.
  for (const [k, v] of Object.entries(policy.qualityFloors ?? {})) {
    if (k === "note") continue;
    if (v !== false) add("quality-floor-open", `quality floor ${k} is no longer false`);
  }

  // Deterministic checks must stay free. A check that costs model tokens belongs on the other
  // side of the split, and silently moving one across is how the free gate stops being free.
  for (const c of policy.deterministicChecks ?? []) {
    if (c.modelTokens !== 0) {
      add("deterministic-check-cost", `${c.id} declares a non-zero model token cost`);
    }
  }

  return f;
}

async function main() {
  let policy = null;
  try {
    policy = JSON.parse(readFileSync(POLICY, "utf8"));
  } catch { /* reported as a finding */ }

  let guardGates = [];
  try {
    ({ ESCALATION_GATES: guardGates } = await import(P("tools", "token-guard.mjs")));
  } catch {
    guardGates = [];
  }

  const findings = evaluate({
    policy, skill: readText(SKILL), agent: readText(AGENT), guardGates,
  });

  if (findings.length === 0) {
    console.log("check-token-economy: GREEN — canonical policy and every projection agree");
    return 0;
  }
  console.error("check-token-economy: RED");
  for (const x of findings) console.error(`  ${x.id}: ${x.message}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
