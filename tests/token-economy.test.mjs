import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(root, ...s);

const POLICY = p("token-economy-policy.json");
const SKILL = p(".claude", "skills", "metaframer-token-economy", "SKILL.md");
const AGENT = p(".claude", "agents", "token-governor.md");

// =====================================================================================
// Token economy governance — the frozen RED specification
//
// One canonical owner, as everywhere else in this repository. `token-economy-policy.json` is the
// only place a token-economy rule, threshold, model route or escalation gate is decided. The
// skill and the agent file are projections of it, and parity is asserted in one direction only —
// canonical to projection — so a drift finding always names the copy that moved. The reverse
// repair, editing the policy until it agrees with a prose file, is how a governance document
// becomes a matter of opinion.
//
// What this package refuses to do is as important as what it does. A token budget is a very
// short distance from "skip the test", "skip the review", "one reviewer is enough", and each of
// those trades a real guarantee for a saving that does not show up in any ledger. So the rows
// below assert the prohibitions with the same force as the savings: the skill must forbid
// dropping a security test, a negative test or an independent review, and the agent must be
// unable to authorize it even if asked.
//
// The governor is deliberately not a wave-by-wave observer. An agent that runs before and after
// every wave spends tokens on every wave, including the ones whose answer two file hashes already
// settled. It is reached only at the declared gates, and it is required to pay for itself: the
// economics rows assert that a net-negative governor turns its own automatic invocation off and
// that doing so never disables the deterministic gate underneath it.
//
// Limit recorded rather than papered over: these rows check that the contract is written down and
// internally consistent. They cannot check that a model obeys prose. What is actually enforced
// mechanically lives in `tools/token-guard.mjs`, and that is the point of keeping the deterministic
// gate separate from the document that describes it.

const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
const readText = (f) => readFile(f, "utf8");

// -------------------------------------------------------------------------------------
// Canonical source
// -------------------------------------------------------------------------------------

test("policy: the canonical file exists and declares itself the sole owner", async () => {
  const policy = await readJson(POLICY);
  assert.equal(policy.canonicalOwner, "token-economy-policy.json");
  assert.equal(typeof policy.schemaVersion, "number");
});

test("policy: every projection is declared, and the skill and agent are among them", async () => {
  const policy = await readJson(POLICY);
  assert.ok(Array.isArray(policy.projections));
  for (const rel of [".claude/skills/metaframer-token-economy/SKILL.md",
                     ".claude/agents/token-governor.md"]) {
    assert.ok(policy.projections.includes(rel), `undeclared projection: ${rel}`);
  }
});

test("policy: the model routing table covers every tier and states when NOT to use it", async () => {
  const policy = await readJson(POLICY);
  const routes = policy.modelRouting;
  for (const tier of ["haiku", "sonnet", "fable", "opus"]) {
    assert.ok(routes[tier], `missing model route: ${tier}`);
    assert.ok(Array.isArray(routes[tier].use) && routes[tier].use.length > 0, `${tier}.use empty`);
    assert.ok(Array.isArray(routes[tier].doNotUse), `${tier}.doNotUse missing`);
  }
  // The cheap tiers must be explicitly barred from the decisions that must not be cheap.
  const haikuBar = routes.haiku.doNotUse.join(" ").toLowerCase();
  for (const forbidden of ["security", "architect", "unknown-unknown", "final"]) {
    assert.match(haikuBar, new RegExp(forbidden));
  }
});

test("policy: fable is conditional on a verified identity and never assumed", async () => {
  const policy = await readJson(POLICY);
  assert.equal(policy.modelRouting.fable.requiresVerifiedIdentity, true);
  assert.match(policy.modelRouting.fable.ifUnavailable, /report|bildir/i);
});

test("policy: escalation gates are declared and match the guard's exported list", async () => {
  const policy = await readJson(POLICY);
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  assert.deepEqual([...policy.governor.escalationGates].sort(),
                   [...guard.ESCALATION_GATES].sort());
});

test("policy: the governor is explicitly NOT invoked per wave", async () => {
  const policy = await readJson(POLICY);
  assert.equal(policy.governor.invokedPerWave, false);
  assert.equal(policy.governor.eventDriven, true);
});

test("policy: the governor must pay for itself and the rule is machine-readable", async () => {
  const policy = await readJson(POLICY);
  const e = policy.governor.economics;
  assert.equal(typeof e.minimumInvocations, "number");
  assert.equal(typeof e.minimumNetSaving, "number");
  assert.equal(e.disableAutoInvocationWhenNetNegative, true);
  assert.equal(e.deterministicGateAlwaysOn, true);
});

test("policy: the deterministic checks are declared and cost no model tokens", async () => {
  const policy = await readJson(POLICY);
  const ids = policy.deterministicChecks.map((c) => c.id);
  for (const required of ["duplicate-worker", "duplicate-file-read", "writer-ownership",
                          "dirty-snapshot", "branch-worktree-collision", "guardian-admission",
                          "stale-review", "commit-push-gate", "completed-panel-cleanup"]) {
    assert.ok(ids.includes(required), `missing deterministic check: ${required}`);
  }
  for (const c of policy.deterministicChecks) {
    assert.equal(c.modelTokens, 0, `${c.id} claims to spend model tokens`);
  }
});

test("policy: quality floors are non-negotiable and named", async () => {
  const policy = await readJson(POLICY);
  const floors = policy.qualityFloors;
  assert.equal(floors.mayDropSecurityTest, false);
  assert.equal(floors.mayDropNegativeTest, false);
  assert.equal(floors.mayDropIndependentReview, false);
  assert.equal(floors.mayLowerModelForSecurityDecision, false);
  assert.equal(floors.mayClaimGreenWithoutEvidence, false);
});

// -------------------------------------------------------------------------------------
// Skill projection
// -------------------------------------------------------------------------------------

test("skill: carries frontmatter with a name and a description", async () => {
  const text = await readText(SKILL);
  assert.match(text, /^---\n/);
  assert.match(text, /\nname:\s*metaframer-token-economy\n/);
  assert.match(text, /\ndescription:\s*\S/);
});

test("skill: the description is specific enough to trigger, not a generic label", async () => {
  const text = await readText(SKILL);
  const desc = /\ndescription:\s*(.+)/.exec(text)[1];
  assert.ok(desc.length > 80, "description too short to discriminate");
  assert.match(desc, /token/i);
});

test("skill: declares it is a projection and names its canonical owner", async () => {
  const text = await readText(SKILL);
  assert.match(text, /token-economy-policy\.json/);
  assert.match(text, /projection/i);
});

test("skill: forbids trading a guarantee for a saving, in words a reader cannot miss", async () => {
  const text = (await readText(SKILL)).toLowerCase();
  for (const phrase of ["never skip", "security", "negative test", "independent review"]) {
    assert.ok(text.includes(phrase), `skill does not mention: ${phrase}`);
  }
});

test("skill: keeps large output out of the main context", async () => {
  const text = (await readText(SKILL)).toLowerCase();
  assert.ok(text.includes("exit code") || text.includes("exit status"));
  assert.ok(text.includes("failing"));
});

test("skill: preserves the single-writer invariant rather than parallelising writes", async () => {
  const text = (await readText(SKILL)).toLowerCase();
  assert.ok(text.includes("single writer") || text.includes("one writer"));
});

test("skill: model routing in the skill matches the canonical table", async () => {
  const policy = await readJson(POLICY);
  const text = await readText(SKILL);
  for (const tier of Object.keys(policy.modelRouting)) {
    assert.match(text, new RegExp(`\\b${tier}\\b`, "i"), `skill omits model tier ${tier}`);
  }
});

// -------------------------------------------------------------------------------------
// Agent projection
// -------------------------------------------------------------------------------------

test("agent: carries frontmatter with a name, description and an explicit tool allowlist", async () => {
  const text = await readText(AGENT);
  assert.match(text, /^---\n/);
  assert.match(text, /\nname:\s*token-governor\n/);
  assert.match(text, /\ntools:\s*\S/);
});

test("agent: has no write tools — it is an auditor, not an author", async () => {
  const text = await readText(AGENT);
  const tools = /\ntools:\s*(.+)/.exec(text)[1];
  for (const forbidden of ["Write", "Edit", "NotebookEdit"]) {
    assert.ok(!tools.includes(forbidden), `token-governor must not hold ${forbidden}`);
  }
});

test("agent: cannot spawn further agents", async () => {
  const text = await readText(AGENT);
  const tools = /\ntools:\s*(.+)/.exec(text)[1];
  assert.ok(!tools.includes("Agent"), "token-governor must not spawn agents");
});

test("agent: states plainly that it advises and never commands", async () => {
  const text = (await readText(AGENT)).toLowerCase();
  assert.ok(text.includes("advis") || text.includes("recommend"));
  assert.ok(text.includes("never") && text.includes("master"));
});

test("agent: forbids commit, push, merge, release and policy change", async () => {
  const text = (await readText(AGENT)).toLowerCase();
  for (const forbidden of ["commit", "push", "merge", "release"]) {
    assert.ok(text.includes(forbidden), `agent does not address: ${forbidden}`);
  }
});

test("agent: is event-driven and says so, with the same gates as the policy", async () => {
  const policy = await readJson(POLICY);
  const text = await readText(AGENT);
  for (const gate of policy.governor.escalationGates) {
    assert.match(text, new RegExp(gate.replace(/-/g, "[- ]"), "i"), `agent omits gate ${gate}`);
  }
});

test("agent: does not describe a per-wave loop", async () => {
  const text = (await readText(AGENT)).toLowerCase();
  assert.ok(!/before and after (every|each) wave/.test(text),
    "a per-wave governor is exactly the cost this package exists to avoid");
});
