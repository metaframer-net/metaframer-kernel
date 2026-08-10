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
//
// Presence is checked before content, and that ordering is the correction that matters here. An
// earlier version of this file iterated `policy.qualityFloors`, `policy.deterministicChecks` and
// `policy.modelRouting` directly, so deleting any of those sections outright produced an empty
// finding list and a GREEN verdict: the strongest possible drift was the one it could not see.
// A section that must exist is asserted to exist first; only then is its content compared.
//
// The escalation gate list is compared against the guard's own exported constant rather than a
// copy of it, and a failed guard import is a finding rather than an empty list. Two empty lists
// agreeing with each other is not parity.
//
// Fail-closed: an unreadable file, an absent required section and a failed import are all
// findings. An empty finding list is an all-clear, and an all-clear must never be reachable by
// accident.

const P = (...s) => path.join(root, ...s);
const POLICY = P("token-economy-policy.json");
const SKILL = P(".claude", "skills", "metaframer-token-economy", "SKILL.md");
const AGENT = P(".claude", "agents", "token-governor.md");
const README = P("README.md");

const readText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

// Tools may be written inline (`tools: Read, Grep`) or as a YAML block list. A regex that reads
// only the first line sees `Read` and misses everything under it, which is how a forbidden tool
// hides in plain sight.
export function frontmatterTools(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text ?? "");
  if (!fm) return null;
  const line = /^tools:[ \t]*(.*)$/m.exec(fm[1]);
  if (!line) return null;
  if (line[1].trim()) return line[1].split(",").map((s) => s.trim()).filter(Boolean);
  const after = fm[1].slice(line.index + line[0].length);
  const items = [];
  for (const l of after.split("\n")) {
    const m = /^[ \t]+-[ \t]*(\S.*)$/.exec(l);
    if (m) items.push(m[1].trim());
    else if (l.trim()) break;
  }
  return items;
}

// A governor that can run a shell can write, commit and push, whichever sentence its own prose
// contains. `Bash` is on this list because "read-only auditor" has to mean something a checker
// can verify, not something a paragraph asserts.
const FORBIDDEN_GOVERNOR_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Agent", "Bash"];

const REQUIRED_POLICY_SECTIONS = [
  "projections", "qualityFloors", "deterministicChecks", "modelRouting", "governor",
];

export function evaluate({ policy, skill, agent, readme, guardGates, guardImportFailed }) {
  const f = [];
  const add = (id, message) => f.push({ id, message });

  if (!policy || typeof policy !== "object") {
    add("canonical-unreadable", `${POLICY} could not be read or parsed`);
    return f;
  }
  if (policy.canonicalOwner !== "token-economy-policy.json") {
    add("canonical-owner-drift", "the policy no longer declares itself the canonical owner");
  }

  // Presence first. A deleted section must not read as a section with nothing wrong in it.
  for (const key of REQUIRED_POLICY_SECTIONS) {
    if (policy[key] === undefined || policy[key] === null) {
      add("policy-section-missing", `required policy section absent: ${key}`);
    }
  }
  if (!Array.isArray(policy.deterministicChecks) || policy.deterministicChecks.length === 0) {
    add("deterministic-checks-empty", "deterministicChecks is absent or empty");
  }
  if (!policy.modelRouting || Object.keys(policy.modelRouting).length === 0) {
    add("model-routing-empty", "modelRouting is absent or empty");
  }
  if (!policy.qualityFloors || Object.keys(policy.qualityFloors).length <= 1) {
    add("quality-floors-empty", "qualityFloors is absent or carries no floors");
  }

  if (guardImportFailed) {
    add("guard-unimportable", "tools/token-guard.mjs could not be imported; gate parity is unverifiable");
  }

  for (const [label, text, file] of [["skill", skill, SKILL], ["agent", agent, AGENT],
                                     ["readme", readme, README]]) {
    if (text === null) add(`${label}-missing`, `${file} could not be read`);
  }
  if (skill === null || agent === null || readme === null) return f;

  for (const rel of policy.projections ?? []) {
    const [file, anchor] = rel.split("#");
    if (!existsSync(P(...file.split("/")))) {
      add("projection-missing", `declared projection absent: ${rel}`);
    } else if (anchor) {
      // A declared projection that is never compared to anything is not a projection.
      const heading = anchor.replace(/-/g, "[ -]");
      if (!new RegExp(`^#{2,3}\\s+${heading}\\s*$`, "im").test(readText(P(...file.split("/"))) ?? "")) {
        add("projection-anchor-missing", `${file} has no section matching #${anchor}`);
      }
    }
  }

  const declared = [...(policy.governor?.escalationGates ?? [])].sort();
  const enforced = [...(guardGates ?? [])].sort();
  if (declared.length === 0) {
    add("escalation-gates-empty", "the policy declares no escalation gates");
  } else if (JSON.stringify(declared) !== JSON.stringify(enforced)) {
    add("escalation-gate-drift",
      `policy gates [${declared.join(",")}] do not match the guard's [${enforced.join(",")}]`);
  }
  for (const gate of policy.governor?.escalationGates ?? []) {
    if (!new RegExp(gate.replace(/-/g, "[- ]"), "i").test(agent)) {
      add("agent-gate-drift", `the agent does not describe the declared gate: ${gate}`);
    }
  }

  for (const tier of Object.keys(policy.modelRouting ?? {})) {
    if (!new RegExp(`\\b${tier}\\b`, "i").test(skill)) {
      add("model-route-drift", `the skill omits the canonical model tier: ${tier}`);
    }
    if (!new RegExp(`\\b${tier}\\b`, "i").test(readme) && policy.projections?.some((x) => x.startsWith("README"))) {
      // The README section is a declared projection of the same table.
      add("readme-model-route-drift", `the README section omits the canonical model tier: ${tier}`);
    }
  }

  if (policy.governor?.invokedPerWave !== false) {
    add("governor-per-wave", "the policy allows per-wave governor invocation");
  }
  if (/before and after (every|each) wave/i.test(agent)) {
    add("agent-per-wave", "the agent describes a per-wave loop the policy forbids");
  }

  const tools = frontmatterTools(agent);
  if (tools === null) {
    add("agent-tools-unreadable", "the agent declares no readable tool allowlist");
  } else {
    for (const forbidden of FORBIDDEN_GOVERNOR_TOOLS) {
      if (tools.includes(forbidden)) {
        add("agent-tool-drift", `the governor holds a forbidden tool: ${forbidden}`);
      }
    }
  }
  if (policy.governor?.readOnly !== true || policy.governor?.mayWriteFiles !== false) {
    add("governor-not-read-only", "the policy no longer declares the governor read-only");
  }

  for (const [k, v] of Object.entries(policy.qualityFloors ?? {})) {
    if (k === "note") continue;
    if (v !== false) add("quality-floor-open", `quality floor ${k} is no longer false`);
  }

  for (const c of policy.deterministicChecks ?? []) {
    if (c.modelTokens !== 0) {
      add("deterministic-check-cost", `${c.id} declares a non-zero model token cost`);
    }
  }

  // The reader cannot observe every registry the evaluators can judge. That limit has to be
  // written down where a reader of the package will meet it, or the package overclaims.
  if (!Array.isArray(policy.readerObservability?.unobservableWithoutFacts)
      || policy.readerObservability.unobservableWithoutFacts.length === 0) {
    add("observability-undeclared",
      "the policy does not record which registries readFacts cannot observe");
  }
  if (!/cannot observe|unobserv/i.test(readme)) {
    add("readme-observability-overclaim",
      "the README does not state which checks the live reader cannot perform on its own");
  }

  return f;
}

async function main() {
  let policy = null;
  try {
    policy = JSON.parse(readFileSync(POLICY, "utf8"));
  } catch { /* reported as a finding */ }

  let guardGates = [];
  let guardImportFailed = false;
  try {
    ({ ESCALATION_GATES: guardGates } = await import(P("tools", "token-guard.mjs")));
  } catch {
    guardImportFailed = true;
  }

  const findings = evaluate({
    policy, skill: readText(SKILL), agent: readText(AGENT), readme: readText(README),
    guardGates, guardImportFailed,
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
