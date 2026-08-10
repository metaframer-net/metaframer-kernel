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

test("skill: instructs returning exit status and failing checks instead of full logs", async () => {
  // Named for what it can actually verify. The previous title claimed the skill "keeps large
  // output out of the main context", which no string search can establish.
  const text = (await readText(SKILL)).toLowerCase();
  assert.ok(text.includes("exit code") || text.includes("exit status"));
  assert.ok(text.includes("failing"));
  assert.ok(text.includes("never lift") || text.includes("stays where it was produced"));
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

test("agent: carries frontmatter with a name, description and a canonical tool allowlist", async () => {
  // `/\ntools:\s*\S/` matched a block list too, so it could not tell the canonical form from
  // the forms the matcher refuses.
  const { frontmatterTools } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const text = await readText(AGENT);
  assert.match(text, /^---\n/);
  assert.match(text, /\nname:\s*token-governor\n/);
  const tools = frontmatterTools(text);
  assert.ok(Array.isArray(tools) && tools.length > 0,
    "the agent must declare its allowlist in the canonical form");
});

test("agent: has no write tools and no shell — it is an auditor, not an author", async () => {
  // Bash belongs on this list. A shell can write, commit and push whatever the prose claims,
  // so an earlier version of this row read "no write tools" while the agent held one.
  const { frontmatterTools } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const tools = frontmatterTools(await readText(AGENT));
  assert.ok(Array.isArray(tools) && tools.length > 0, "the agent declares no readable allowlist");
  for (const forbidden of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]) {
    assert.ok(!tools.includes(forbidden), `token-governor must not hold ${forbidden}`);
  }
});

test("frontmatterTools accepts exactly one canonical form", async () => {
  const { frontmatterTools, CANONICAL_TOOLS_FORM } =
    await import(path.join(root, "tools", "check-token-economy.mjs"));
  assert.equal(CANONICAL_TOOLS_FORM, "tools: Name, Name, Name");
  const doc = (tools) => `---\nname: x\n${tools}\nmodel: sonnet\n---\nbody`;
  assert.deepEqual(frontmatterTools(doc("tools: Read, Grep, Glob")), ["Read", "Grep", "Glob"]);
  assert.deepEqual(frontmatterTools(doc("tools: Read")), ["Read"]);
});

test("policy: the reader observability limit is recorded rather than implied", async () => {
  const policy = await readJson(POLICY);
  const o = policy.readerObservability;
  assert.ok(Array.isArray(o?.unobservableWithoutFacts) && o.unobservableWithoutFacts.length >= 5,
    "the registries readFacts cannot see must be named");
  assert.ok(Array.isArray(o?.observedByReader) && o.observedByReader.length > 0);
});

test("checker: deleting a whole policy section is RED, not GREEN", async () => {
  // The reported blindness. Every loop iterated a key that could simply be absent, so the
  // strongest possible drift produced an empty finding list.
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const base = await readJson(POLICY);
  const fixed = {
    skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  };
  assert.deepEqual(evaluate({ policy: base, ...fixed }), [], "the live package must be clean");
  // Deleted AND emptied. `projections: []` used to score GREEN and, because the README
  // parity check was guarded by it, emptying that one array disabled two families of
  // comparison at once.
  for (const section of ["qualityFloors", "deterministicChecks", "modelRouting", "projections"]) {
    for (const [how, mutate] of [["deleting", (p) => { delete p[section]; }],
                                 ["emptying", (p) => { p[section] = Array.isArray(p[section]) ? [] : {}; }]]) {
      const mutated = JSON.parse(JSON.stringify(base));
      mutate(mutated);
      assert.ok(evaluate({ policy: mutated, ...fixed }).length > 0,
        `${how} ${section} was not detected`);
    }
  }
});

test("checker: an unimportable guard is a finding, not two empty lists agreeing", async () => {
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard2 = await import(path.join(root, "tools", "token-guard.mjs"));
  const findings = evaluate({
    policy: await readJson(POLICY), skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: [], guardCheckIds: guard2.DETERMINISTIC_CHECK_IDS, guardImportFailed: true,
  });
  assert.ok(findings.some((f) => f.id === "guard-unimportable"));
});

test("agent: cannot spawn further agents, under either tool spelling", async () => {
  // The previous row used the very single-line regex the parser replaced, so a block list
  // hid everything after the first entry from it.
  const { frontmatterTools } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const tools = frontmatterTools(await readText(AGENT));
  for (const spelling of ["Agent", "Task"]) {
    assert.ok(!tools.includes(spelling), `token-governor must not hold ${spelling}`);
  }
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

// -------------------------------------------------------------------------------------
// Second-round regression rows
// -------------------------------------------------------------------------------------

test("frontmatterTools refuses every non-canonical spelling rather than guessing", async () => {
  // Three review rounds each found a YAML spelling that slipped a forbidden tool past a
  // hand-written parser: flow lists, quoted scalars, block scalars, trailing comments, empty
  // lists. Recognising YAML correctly is a harder problem than this check needs to solve, so
  // anything but the canonical form is unreadable — which is a finding, never a clean parse.
  const { frontmatterTools } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const doc = (tools) => `---\nname: x\n${tools}\nmodel: sonnet\n---\nbody`;
  const refused = [
    "tools: [Read, Bash]",
    "tools: [Read, Bash] # audit",
    'tools: "Read, Bash"',
    "tools: Read, Bash #ok",
    "tools: >\n  Read, Bash",
    "tools: |\n  Read, Bash",
    "tools:\n  - Read\n  - Bash",
    "tools: []",
    "tools:",
    "tools: Read,Bash",
  ];
  for (const spelling of refused) {
    assert.equal(frontmatterTools(doc(spelling)), null,
      `non-canonical spelling was parsed instead of refused: ${JSON.stringify(spelling)}`);
  }
});

test("frontmatterTools reports an empty tool list as unreadable, not as narrow", async () => {
  // An absent or empty `tools` inherits every tool, so the widest possible grant must never
  // be the one case that scores clean.
  const { frontmatterTools } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  assert.equal(frontmatterTools("---\nname: x\ntools:\nmodel: sonnet\n---\nbody"), null);
});

test("checker: a governor with a forbidden tool in any YAML spelling is RED", async () => {
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const agent = await readText(AGENT);
  const fixed = {
    policy: await readJson(POLICY), skill: await readText(SKILL),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  };
  const cases = [
    ["tools: [Read, Bash]", "agent-tools-unreadable"],
    ['tools: "Read, Bash"', "agent-tools-unreadable"],
    ["tools: >\n  Read, Bash", "agent-tools-unreadable"],
    ["tools: Read, Bash #ok", "agent-tools-unreadable"],
    ["tools: []", "agent-tools-unreadable"],
    ["tools:", "agent-tools-unreadable"],
    ["tools: Read, Bash", "agent-tool-drift"],
    ["tools: Read, Task", "agent-tool-drift"],
  ];
  for (const [spelling, expectedId] of cases) {
    const mutated = agent.replace("tools: Read, Grep, Glob", spelling);
    const findings = evaluate({ ...fixed, agent: mutated });
    assert.ok(findings.some((f) => f.id === expectedId),
      `${JSON.stringify(spelling)} produced ${JSON.stringify(findings.map((f) => f.id))}, `
      + `expected ${expectedId}`);
  }
});

test("policy: the production caller it names is a command that actually runs", async () => {
  // Grepping the source for the string proved only that the string was there. Replacing an
  // honest silence with a specific false statement is worse than the silence, so the command
  // is executed.
  const { execFileSync } = await import("node:child_process");
  const policy = await readJson(POLICY);
  assert.match(policy.governor.economics.productionCaller, /token-guard\.mjs economics/);
  const out = execFileSync(process.execPath,
    [path.join(root, "tools", "token-guard.mjs"), "economics"], { encoding: "utf8" });
  const verdict = JSON.parse(out);
  assert.equal(typeof verdict.autoInvocationEnabled, "boolean");
  assert.equal(verdict.deterministicGateEnabled, true);
  assert.ok(verdict.ledgerFile.endsWith("token-economy-ledger.json"));
});

test("guard: GUARD_EMITTED_GATES is derived from what the evaluators actually emit", async () => {
  // Previously this compared one hand-maintained list to another, so a gate that stopped
  // being emitted stayed green. The set is now observed by driving facts through decide().
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const shapes = [
    { requested: { taskSignature: "t" } },
    { requested: { changePackage: "cp" } },
    { requested: { changePackage: "cp", sessionId: "s" }, activeWriters: [{ changePackage: "cp", sessionId: "x" }] },
    { requested: { role: "reviewer", worktree: "/w" }, worktrees: [{ path: "/w", dirty: null }] },
    { requested: { branch: "b" } },
    { requested: { useReviewFrom: "r" } },
    { requested: { path: "a", sha256: "x" } },
    { requested: { opensWorker: true }, guardian: null },
    { requested: { action: "main-promotion" } },
    { requested: { action: "merge" } },
  ];
  const observed = new Set();
  for (const facts of shapes) {
    for (const f of guard.decide(facts).findings) if (f.gate) observed.add(f.gate);
  }
  assert.deepEqual([...observed].sort(), [...guard.GUARD_EMITTED_GATES].sort(),
    "the declared emitted-gate set no longer matches what the evaluators produce");
  for (const gate of observed) {
    assert.ok(guard.ESCALATION_GATES.includes(gate), `undeclared emitted gate: ${gate}`);
  }
  const masterEntered = guard.ESCALATION_GATES.filter((g) => !observed.has(g));
  assert.deepEqual(masterEntered.sort(), ["commit-push", "model-escalation"]);
});

test("policy: the ledger is operational state, not a declared projection", async () => {
  // The policy says a projection is never read back as a source; the economics command reads
  // the ledger as its primary input, so listing it as a projection made the canonical file
  // contradict itself.
  const policy = await readJson(POLICY);
  assert.ok(!policy.projections.includes("token-economy-ledger.json"));
  assert.equal(policy.governor.economics.ledgerFile, "token-economy-ledger.json");
});

test("policy: what the checker does NOT compare is written down", async () => {
  const policy = await readJson(POLICY);
  const cov = policy.checkerCoverage;
  assert.ok(Array.isArray(cov?.compared) && cov.compared.length > 0);
  for (const section of ["workerPackaging", "resultReporting", "parallelism"]) {
    assert.ok(cov.notCompared.includes(section),
      `${section} is unchecked and must be recorded as unchecked`);
  }
});

test("checker: a duplicate tools key is refused rather than read first-wins", async () => {
  // A narrow allowlist on one line and Bash on the next scored GREEN. Which line a YAML
  // loader honours is exactly the guess the canonical-form matcher exists to refuse.
  const { evaluate, frontmatterTools } =
    await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const agent = await readText(AGENT);
  const mutated = agent.replace("tools: Read, Grep, Glob",
    "tools: Read, Grep, Glob\ntools: Bash, Write, Task");
  assert.equal(frontmatterTools(mutated), null);
  const findings = evaluate({
    policy: await readJson(POLICY), skill: await readText(SKILL), agent: mutated,
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  });
  assert.ok(findings.some((f) => f.id === "agent-tools-unreadable"));
});

test("checker: the declared deterministic checks are the ones the guard implements", async () => {
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const fixed = {
    skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  };
  const base = await readJson(POLICY);
  assert.deepEqual(evaluate({ policy: base, ...fixed }), []);
  // A policy that declares one invented check used to score GREEN while the guard ran nine.
  const invented = JSON.parse(JSON.stringify(base));
  invented.deterministicChecks = [{ id: "not-a-real-check", modelTokens: 0 }];
  const findings = evaluate({ policy: invented, ...fixed });
  assert.ok(findings.some((f) => f.id === "deterministic-check-unimplemented"));
  assert.ok(findings.some((f) => f.id === "deterministic-check-undeclared"));
});

test("checker: evaluate is pure — an injected README is the one that is checked", async () => {
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const findings = evaluate({
    policy: await readJson(POLICY), skill: await readText(SKILL), agent: await readText(AGENT),
    readme: "# a README with no token economy section and no model tiers",
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  });
  assert.ok(findings.some((f) => f.id === "projection-anchor-missing"),
    "the injected README was ignored in favour of the one on disk");
});

test("checker: an absent guard export is a finding, not a skipped check", async () => {
  // The tie between declared and implemented checks used to be skipped silently when the export
  // was missing, so deleting it disabled the comparison it exists for.
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const findings = evaluate({
    policy: await readJson(POLICY), skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: undefined, guardImportFailed: false,
  });
  assert.ok(findings.some((f) => f.id === "guard-check-ids-unavailable"));
});

test("checker: thinning a section to one member is RED, not only deleting it", async () => {
  // Presence was checked at depth one, so seven quality floors could become one and score GREEN.
  // Two floors were named by neither the checker nor any test, so deleting them was invisible.
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const base = await readJson(POLICY);
  const fixed = {
    skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  };
  const thin = [
    ["qualityFloors", (p) => { p.qualityFloors = { note: "x", mayDropSecurityTest: false }; },
      "quality-floor-missing"],
    ["a single named floor", (p) => { delete p.qualityFloors.mayReuseReviewAcrossSnapshots; },
      "quality-floor-missing"],
    ["the other named floor", (p) => { delete p.qualityFloors.mayRunTwoWritersOnOneChangePackage; },
      "quality-floor-missing"],
    ["modelRouting", (p) => { p.modelRouting = { haiku: p.modelRouting.haiku }; },
      "model-tier-missing"],
    ["projections", (p) => { p.projections = ["README.md#token-economy"]; },
      "projection-undeclared"],
  ];
  // The id matters, not the count: a row satisfied by some unrelated finding proves nothing
  // about the check it is named for.
  for (const [label, mutate, expectedId] of thin) {
    const mutated = JSON.parse(JSON.stringify(base));
    mutate(mutated);
    const findings = evaluate({ policy: mutated, ...fixed });
    assert.ok(findings.some((f) => f.id === expectedId),
      `thinning ${label} produced ${JSON.stringify(findings.map((f) => f.id))}, `
      + `expected ${expectedId}`);
  }
});

test("checker: an injected body is checked by the comparison that reads it", async () => {
  // The previous version asserted only `findings.length > 0` and was satisfied entirely by
  // model-route-drift, an unrelated pre-existing check — so it certified an injection path
  // that was in fact unreachable. Each injected body is now asserted through the specific
  // finding that reads it.
  const { evaluate } = await import(path.join(root, "tools", "check-token-economy.mjs"));
  const guard = await import(path.join(root, "tools", "token-guard.mjs"));
  const base = {
    policy: await readJson(POLICY), skill: await readText(SKILL), agent: await readText(AGENT),
    readme: await readText(path.join(root, "README.md")),
    guardGates: guard.ESCALATION_GATES, guardCheckIds: guard.DETERMINISTIC_CHECK_IDS,
    guardImportFailed: false,
  };
  assert.deepEqual(evaluate(base), [], "the live package must be clean");

  // skill -> model-route-drift
  assert.ok(evaluate({ ...base, skill: "# an empty skill" })
    .some((f) => f.id === "model-route-drift"));
  // agent -> agent-gate-drift and the tool allowlist
  assert.ok(evaluate({ ...base, agent: "---\nname: token-governor\ntools: Read\n---\nempty" })
    .some((f) => f.id === "agent-gate-drift"));
  // readme -> the anchor, which is the one projection body read in the anchor branch
  assert.ok(evaluate({ ...base, readme: "# a README with no token economy section" })
    .some((f) => f.id === "projection-anchor-missing"));
});
