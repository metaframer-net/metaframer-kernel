import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const SKILL_REL = ".claude/skills/metaframer-token-economy/SKILL.md";
const AGENT_REL = ".claude/agents/token-governor.md";

const readText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

// One canonical spelling, and everything else is unreadable.
//
// Three rounds of review found three different YAML spellings that slipped a forbidden tool
// past a hand-written parser: bracketed flow lists, quoted scalars, block scalars (`>` and
// `|`), trailing comments, and an empty list. Each fix closed the spelling in front of it and
// left the next one open, because recognising every YAML dialect correctly is a much harder
// problem than the check needs to solve.
//
// So the contract inverts. Exactly one form is accepted — `tools: Name, Name, Name`, bare
// identifiers, comma-separated, nothing else on the line — and every other form returns null,
// which is a finding. A parser that must understand YAML to be safe can be wrong in the
// direction that grants a tool. A matcher that accepts one shape can only be wrong in the
// direction that reports RED, and a false RED costs a sentence in a review rather than a
// shell in an auditor.
export const CANONICAL_TOOLS_FORM = "tools: Name, Name, Name";

export function frontmatterTools(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text ?? "");
  if (!fm) return null;
  // Exactly one `tools:` line. Two of them parsed as the first and ignored the second, so an
  // agent could declare a narrow allowlist and grant Bash on the next line. Which one a YAML
  // loader honours — first, last, or an error — is precisely the guess this matcher exists to
  // refuse to make.
  const declarations = fm[1].match(/^tools:/gm) ?? [];
  if (declarations.length !== 1) return null;
  const line = /^tools:(.*)$/m.exec(fm[1]);
  if (!line) return null;

  // Bare identifiers only. Any bracket, quote, comment, block-scalar indicator or continuation
  // means this is not the canonical form, and an unrecognised form is unreadable rather than
  // empty. `tools:` with nothing after it lands here too: an absent allowlist inherits every
  // tool, so it is the widest grant and must never read as the narrowest.
  const value = line[1];
  if (!/^ [A-Za-z][A-Za-z0-9_-]*(, [A-Za-z][A-Za-z0-9_-]*)*$/.test(value)) return null;
  return value.trim().split(",").map((s) => s.trim());
}

// A governor that can run a shell can write, commit and push, whichever sentence its own prose
// contains. `Bash` is on this list because "read-only auditor" has to mean something a checker
// can verify, not something a paragraph asserts.
const FORBIDDEN_GOVERNOR_TOOLS = [
  "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "BashOutput",
  // Both spellings. The subagent tool is `Task` in Claude Code and `Agent` in the SDK, and a
  // list naming only one of them lets an auditor spawn auditors.
  "Agent", "Task",
];

const REQUIRED_POLICY_SECTIONS = [
  "projections", "qualityFloors", "deterministicChecks", "modelRouting", "governor",
];

// Presence was checked at depth one only, so a section could be reduced to a single key and
// still score GREEN — `qualityFloors` from seven floors to one, `modelRouting` from four tiers
// to one. Two floors were named by neither the checker nor any test, so deleting them was
// invisible. The members that must exist are therefore enumerated.
const REQUIRED_QUALITY_FLOORS = [
  "mayDropSecurityTest", "mayDropNegativeTest", "mayDropIndependentReview",
  "mayLowerModelForSecurityDecision", "mayClaimGreenWithoutEvidence",
  "mayReuseReviewAcrossSnapshots", "mayRunTwoWritersOnOneChangePackage",
];
const REQUIRED_MODEL_TIERS = ["haiku", "sonnet", "fable", "opus"];
const REQUIRED_PROJECTIONS = [
  ".claude/skills/metaframer-token-economy/SKILL.md",
  ".claude/agents/token-governor.md",
  "README.md#token-economy",
];

export function evaluate({ policy, skill, agent, readme, guardGates, guardCheckIds, guardImportFailed }) {
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
  // The presence-first rule, applied to the fourth section too. An empty projections array
  // scored GREEN and also silenced the README parity check that is guarded by it, so
  // emptying one array disabled two families of comparison at once.
  if (!Array.isArray(policy.projections) || policy.projections.length === 0) {
    add("projections-empty", "projections is absent or empty");
  } else {
    for (const rel of REQUIRED_PROJECTIONS) {
      if (!policy.projections.includes(rel)) {
        add("projection-undeclared", `a required projection is no longer declared: ${rel}`);
      }
    }
  }
  for (const floor of REQUIRED_QUALITY_FLOORS) {
    if (policy.qualityFloors?.[floor] === undefined) {
      add("quality-floor-missing", `a required quality floor is no longer declared: ${floor}`);
    }
  }
  for (const tier of REQUIRED_MODEL_TIERS) {
    if (policy.modelRouting?.[tier] === undefined) {
      add("model-tier-missing", `a required model tier is no longer declared: ${tier}`);
    }
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
      // Use the injected text rather than re-reading the file, so evaluate() stays pure and a
      // test that supplies a mutated README is actually testing that README.
      // Every injected body, not just the README, so a test that supplies a mutated
      // projection is testing that projection rather than the file on disk.
      const injected = { "README.md": readme, [SKILL_REL]: skill, [AGENT_REL]: agent };
      const body = file in injected ? injected[file] : readText(P(...file.split("/")));
      if (!new RegExp(`^#{2,3}\\s+${heading}\\s*$`, "im").test(body ?? "")) {
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
    if (!new RegExp(`\\b${tier}\\b`, "i").test(readme)) {
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
    add("agent-tools-unreadable",
      `the agent's tool allowlist is not in the canonical form "${CANONICAL_TOOLS_FORM}". An `
      + "unrecognised form is treated as unreadable, and an absent or empty allowlist inherits "
      + "every tool, so it is the widest grant rather than the narrowest");
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
  // Tie the declared ids to the evaluators that exist. Without this, a policy listing one
  // invented check scored GREEN while the guard ran nine, and nine could shrink to one
  // without the policy noticing.
  // An absent export skipped the whole tie and scored GREEN, which is the same fail-open the
  // escalation-gate comparison already refuses two blocks up.
  if (!Array.isArray(guardCheckIds) || guardCheckIds.length === 0) {
    add("guard-check-ids-unavailable",
      "the guard exports no deterministic check ids; the declared set cannot be verified");
  } else {
    const declared = new Set((policy.deterministicChecks ?? []).map((c) => c.id));
    for (const id of guardCheckIds) {
      if (!declared.has(id)) add("deterministic-check-undeclared", `the guard runs ${id}, the policy does not declare it`);
    }
    for (const id of declared) {
      if (!guardCheckIds.includes(id)) add("deterministic-check-unimplemented", `the policy declares ${id}, no evaluator emits it`);
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
  let guardCheckIds = [];
  let guardImportFailed = false;
  try {
    const mod = await import(P("tools", "token-guard.mjs"));
    guardGates = mod.ESCALATION_GATES;
    guardCheckIds = mod.DETERMINISTIC_CHECK_IDS;
  } catch {
    guardImportFailed = true;
  }

  const findings = evaluate({
    policy, skill: readText(SKILL), agent: readText(AGENT), readme: readText(README),
    guardGates, guardCheckIds, guardImportFailed,
  });

  if (findings.length === 0) {
    console.log("check-token-economy: GREEN — canonical policy and every projection agree");
    return 0;
  }
  console.error("check-token-economy: RED");
  for (const x of findings) console.error(`  ${x.id}: ${x.message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
