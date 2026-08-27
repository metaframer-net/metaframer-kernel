import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P21G — supply-chain and secret scanning. Every P21 package so far closed a boundary gap inside
// the kernel's own code; none of them ever asked what the kernel *depends on*, and none of them
// ever asked whether a credential had been committed into the tree. This frozen test owns every
// fixed expectation for one new, blocking, least-privilege .github/workflows/security.yml that
// (a) audits the npm and the Python dependency sets against pinned tooling and (b) scans the
// current tracked snapshot — never Git history — for secrets, together with the two labelled
// negative fixtures that scan is allowed to walk past.
//
// This file is the only oracle. Expected values live here and are never read back out of the
// manifest; the manifest is a load-bearing gate that must agree with them. No raw credential is
// embedded or printed anywhere below: the two known-bad fixture lines are matched by shape.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST_PATH = "planning/kernel-security-dependency-secret-scan-p21g.json";
const FROZEN_TEST_PATH = "tests/kernel-security-dependency-secret-scan-p21g.test.mjs";
const WORKFLOW_PATH = ".github/workflows/security.yml";
const FIXTURE_TEST_PATH = "tests/kernel-runtime-pilot-consumer-sync.test.mjs";
const ALLOWED_FILES = Object.freeze([MANIFEST_PATH, FROZEN_TEST_PATH, WORKFLOW_PATH, FIXTURE_TEST_PATH]);
const SCENARIO_IDS = Object.freeze(["P21G-1", "P21G-2", "P21G-3", "P21G-4"]);

// Stable RED tokens. A checkout without the workflow, or without the manifest, fails on exactly
// one of these two and on nothing else, so a missing seam can never be confused with a real
// finding, a network failure or a missing tool.
const MISSING_WORKFLOW_TOKEN = `p21g-security-workflow-missing: ${WORKFLOW_PATH}`;
const MISSING_MANIFEST_TOKEN = `p21g-manifest-missing: ${MANIFEST_PATH}`;

const PACKAGE_NAME = "P21G-security-dependency-secret-scan";
const BASE_COMMIT = "1390aeb35ed8b756c49aec9d2375459f3e29f25f";
const BASE_TREE = "1f4f1b91a179b1aa2f702a190f2cc1a08a1ed902";
const MASTER_SCOPE_SHA256 = "037943b34f950da16ea36e3b2a058a251252a234b818cc32880883984e4c71f2";
const BLIND_SCOPE_SHA256 = "ef66e4a5dfed6275566cdae20bba6f721118ed0997acabd650f2edbd96090dd3";
const SYNTHESIS_SCOPE_SHA256 = "d91a3e23cd0d7c08413ce908fb313bf2a3f803243229d2e5bb60400518858ba1";
const ACTIONPLAN_PIN = "actionplan@f25018d937557381cf8f8dd1012c29a2e48ba374:src/data/standards/short-code.json#changePackageBudget";

// The three pinned tools. The digest and the pip-audit version are fixed here, by this test.
const TRUFFLEHOG_DIGEST = "sha256:deb2af10659a488a14d262a323addcde099d99827a1cf1dc4e93c17915c39f08";
const PIP_AUDIT_VERSION = "2.10.1";
const PIP_AUDIT_PIN = `pip-audit==${PIP_AUDIT_VERSION}`;
const NPM_AUDIT_COMMAND = "npm audit --omit=dev --audit-level=high";

// Assembled at runtime so this file itself never carries the literal marker it counts.
const IGNORE_MARKER = ["trufflehog", "ignore"].join(":");
const IGNORE_COMMENT = new RegExp(`//\\s*${IGNORE_MARKER}\\s*$`);

// The two labelled negative fixtures, matched by shape only. A URL carrying userinfo before
// github.com is exactly what a secret scanner is supposed to shout about, and exactly why these
// two lines — and only these two — may carry an inline ignore.
const EMBEDDED_CREDENTIAL_FIXTURE = /\[\s*"embedded[- ]credentials"\s*,\s*"https:\/\/[^\s"@/]+:[^\s"@/]+@github\.com\/[^"]+"\s*\]/;

// ---------------------------------------------------------------------------------------------
// Readers. Comment-only lines are stripped before every workflow assertion, so an explanatory
// comment can neither satisfy a positive requirement nor trip a negative one.
// ---------------------------------------------------------------------------------------------

const stripComments = (text) => text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
const countOf = (text, pattern) => (text.match(pattern) ?? []).length;

function requireWorkflow(scenario) {
  const workflowPath = path.join(root, WORKFLOW_PATH);
  if (!existsSync(workflowPath)) {
    assert.fail(`[${scenario}] ${MISSING_WORKFLOW_TOKEN}`);
  }
  return stripComments(readFileSync(workflowPath, "utf8"));
}

/** Load-bearing contract read: no P21G scenario may run before its package manifest exists. */
async function requireContract(scenario) {
  const manifestPath = path.join(root, MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    assert.fail(`[${scenario}] ${MISSING_MANIFEST_TOKEN}`);
  }
  const contract = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual((contract.acceptanceScenarios ?? []).map((entry) => entry?.id), [...SCENARIO_IDS],
    `[${scenario}] ${MANIFEST_PATH} must declare exactly the four P21G scenario ids, in order`);
  return contract;
}

/** The `key:` line plus every line indented under it. */
function topLevelBlock(text, key) {
  return text.match(new RegExp(`^${key}:[^\\n]*\\n(?:[ \\t]+\\S[^\\n]*\\n?)+`, "m"))?.[0] ?? "";
}

/** Job id -> job body, split at two-space indentation inside the jobs: block. */
function jobsOf(workflow) {
  const block = topLevelBlock(workflow, "jobs");
  const marks = [...block.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  return marks.map((mark, index) => ({
    id: mark[1],
    body: block.slice(mark.index + mark[0].length, index + 1 < marks.length ? marks[index + 1].index : block.length),
  }));
}

/** Each `- name:` step as its own chunk, the repository's existing CI-shape reading convention. */
const stepsOf = (workflow) => workflow.split(/^\s*-\s+name:/m).slice(1);

/** One logical shell command, backslash continuations folded onto a single line. */
function logicalCommand(text, needle) {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.includes(needle));
  if (at < 0) return "";
  let start = at;
  while (start > 0 && /\\\s*$/.test(lines[start - 1])) start -= 1;
  let end = at;
  while (end + 1 < lines.length && /\\\s*$/.test(lines[end])) end += 1;
  return lines.slice(start, end + 1).map((line) => line.replace(/\\\s*$/, " ")).join(" ");
}

/** Every tracked file, read as text. Read-only: `git ls-files` mutates nothing. */
function trackedFiles() {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

// =============================================================================================
// P21G-1 — the workflow's trigger surface and its supply-chain posture: fork-safe, read-only,
// secretless, and pinned to immutable action commits.
// =============================================================================================

test("P21G-1: the security workflow triggers only on pull_request and push to main, and runs read-only, secretless and commit-pinned", async () => {
  const workflow = requireWorkflow("P21G-1");
  await requireContract("P21G-1");

  // Exactly two triggers, and exactly the two fork-safe ones. A pull_request_target or a
  // schedule would run this workflow with a different, more privileged token or outside the
  // change that is being reviewed.
  const onBlock = topLevelBlock(workflow, "on");
  assert.ok(onBlock.length > 0, "P21G-1: the workflow must declare a top-level on: trigger block");
  const triggers = [...onBlock.matchAll(/^ {2}([A-Za-z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual([...triggers].sort(), ["pull_request", "push"],
    `P21G-1: the trigger set must be exactly pull_request and push, found: ${triggers.join(", ")}`);
  assert.match(onBlock, /push:\s*\n\s*branches:\s*\n\s*-\s*main\s*$/m,
    "P21G-1: push must be restricted to the main branch");

  // Least privilege at the top level, and no job may widen it.
  const permissions = topLevelBlock(workflow, "permissions");
  assert.ok(permissions.length > 0, "P21G-1: a top-level permissions block must be declared");
  assert.match(permissions, /^\s+contents:\s*read\s*$/m, "P21G-1: top-level permissions must grant contents: read");
  assert.deepEqual([...permissions.matchAll(/^\s+([a-z-]+):/gm)].map((match) => match[1]), ["contents"],
    `P21G-1: contents: read must be the only permission granted:\n${permissions}`);

  // A scanner that can write, or that can read a secret, is a scanner an untrusted pull request
  // can turn into an exfiltration path. Neither is available here.
  const forbidden = [
    [/pull_request_target/, "pull_request_target must never be used"],
    [/^\s*schedule:/m, "the workflow must not run on a schedule"],
    [/workflow_run/, "workflow_run must not be used"],
    [/repository_dispatch/, "repository_dispatch must not be used"],
    [/merge_group/, "merge_group must not be used"],
    [/:\s*write\b/, "no permission may be granted as write"],
    [/write-all/, "write-all must never be granted"],
    [/secrets\./, "the workflow must not reference any secret"],
    [/GITHUB_TOKEN/, "the workflow must not reference the workflow token"],
    [/continue-on-error/, "no step may continue on error"],
    [/\|\|\s*true\b/, "no command may be suppressed with || true"],
    [/\|\|\s*:\s*$/m, "no command may be suppressed with || :"],
    [/set\s+\+e\b/, "no step may disable errexit"],
  ];
  for (const [pattern, why] of forbidden) {
    assert.ok(!pattern.test(workflow), `P21G-1: ${why}`);
  }

  // Every action is pinned to an immutable 40-hex commit, never to a movable tag or branch.
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, "P21G-1: the workflow must use at least one action");
  for (const step of uses) {
    assert.match(step, /^[^@\s]+@[0-9a-f]{40}$/,
      `P21G-1: every uses: step must be pinned to a full lowercase 40-hex commit SHA, found: ${step}`);
  }

  // The three actions this workflow needs are present, each pinned.
  for (const action of ["actions/checkout", "actions/setup-node", "astral-sh/setup-uv"]) {
    const pinned = uses.filter((step) => step.startsWith(`${action}@`));
    assert.ok(pinned.length > 0, `P21G-1: the workflow must use ${action}`);
    for (const step of pinned) {
      assert.match(step, new RegExp(`^${action.replace("/", "\\/")}@[0-9a-f]{40}$`),
        `P21G-1: ${action} must be pinned to an exact 40-hex commit, found: ${step}`);
    }
  }

  // Every job checks the repository out; nothing scans an empty or inherited workspace.
  const jobs = jobsOf(workflow);
  assert.ok(jobs.length > 0, "P21G-1: the workflow must declare at least one job");
  for (const job of jobs) {
    assert.match(job.body, /uses:\s*actions\/checkout@/, `P21G-1: job ${job.id} must check out the repository`);
    assert.ok(!/:\s*write\b/.test(job.body), `P21G-1: job ${job.id} must not grant itself a write permission`);
  }
});

// =============================================================================================
// P21G-2 — the dependency audits block. Both ecosystems are audited against pinned tooling, the
// Python side against a hash-locked export, and no finding may be waved through.
// =============================================================================================

test("P21G-2: the npm and Python dependency audits are pinned, hash-locked and blocking", async () => {
  const workflow = requireWorkflow("P21G-2");
  await requireContract("P21G-2");

  // npm: the exact audit invocation, and no other. A second, looser `npm audit` would make the
  // strict one decorative.
  assert.ok(workflow.includes(NPM_AUDIT_COMMAND), `P21G-2: the workflow must run exactly \`${NPM_AUDIT_COMMAND}\``);
  assert.equal(countOf(workflow, /npm audit/g), countOf(workflow, new RegExp(NPM_AUDIT_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
    `P21G-2: every npm audit invocation must be exactly \`${NPM_AUDIT_COMMAND}\``);
  assert.ok(!/npm audit fix/.test(workflow), "P21G-2: the audit reports, it never rewrites the lockfile");

  // Python: the locked environment is exported frozen, without dev dependencies, without the
  // project itself, and with its hashes intact — an export without hashes would let pip-audit
  // resolve a different artifact than the one the lockfile pinned.
  const exportStep = stepsOf(workflow).find((step) => step.includes("uv export"));
  assert.ok(exportStep !== undefined, "P21G-2: the workflow must export the locked db environment with uv export");
  const exportCommand = logicalCommand(exportStep, "uv export");
  for (const flag of ["--frozen", "--no-dev", "--no-emit-project"]) {
    assert.ok(exportCommand.includes(flag), `P21G-2: uv export must pass ${flag}, found: ${exportCommand.trim()}`);
  }
  assert.match(exportStep, /\bdb\b/, "P21G-2: the export must target the db package");
  assert.match(exportStep, /RUNNER_TEMP/, "P21G-2: the export must be written under RUNNER_TEMP, outside the checked-out tree");
  assert.ok(!/--no-hashes/.test(exportStep), "P21G-2: the export must keep its hashes");

  // pip-audit: pinned to an exact version, run through uvx so it never enters the project
  // environment, required to verify hashes, and forbidden from resolving anything itself.
  const auditStep = stepsOf(workflow).find((step) => step.includes("pip-audit"));
  assert.ok(auditStep !== undefined, "P21G-2: the workflow must run pip-audit over the exported requirements");
  const auditCommand = logicalCommand(auditStep, "pip-audit");
  assert.ok(auditCommand.includes("uvx"), "P21G-2: pip-audit must run through uvx, never installed into the project environment");
  assert.ok(auditCommand.includes(`--from ${PIP_AUDIT_PIN}`), `P21G-2: pip-audit must be pinned as --from ${PIP_AUDIT_PIN}`);
  for (const flag of ["--require-hashes", "--disable-pip"]) {
    assert.ok(auditCommand.includes(flag), `P21G-2: pip-audit must pass ${flag}, found: ${auditCommand.trim()}`);
  }
  assert.match(auditStep, /RUNNER_TEMP/, "P21G-2: pip-audit must read the export written under RUNNER_TEMP");
  assert.equal(countOf(workflow, /pip-audit==/g), countOf(workflow, new RegExp(PIP_AUDIT_PIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
    `P21G-2: every pip-audit pin must be exactly ${PIP_AUDIT_PIN}`);

  // Nothing may be excused. An allow-listed advisory id, an ignore flag or a suppressed exit code
  // each turn a blocking gate into a report nobody reads.
  const suppressions = [
    [/--ignore-vuln/, "no vulnerability may be ignored"],
    [/\bGHSA-[0-9a-zA-Z-]+/, "no GHSA advisory may be allow-listed in the workflow"],
    [/\bCVE-\d{4}-\d+/, "no CVE may be allow-listed in the workflow"],
    [/audit\s*=\s*false/, "npm auditing must not be switched off"],
    [/--audit-level=(low|moderate|critical|none)/, `the audit level is fixed by ${NPM_AUDIT_COMMAND}`],
    [/exit\s+0\b/, "no audit step may exit 0 unconditionally"],
  ];
  for (const [pattern, why] of suppressions) {
    assert.ok(!pattern.test(workflow), `P21G-2: ${why}`);
  }
});

// =============================================================================================
// P21G-3 — the secret scan. It reads the current tracked snapshot, extracted outside the
// repository, and never the Git history; it is pinned by image digest; and the only two findings
// it is allowed to walk past are the two labelled negative fixtures.
// =============================================================================================

test("P21G-3: the secret scan covers the current tracked snapshot only, is digest-pinned, redacts its output, and excludes nothing", async () => {
  const workflow = requireWorkflow("P21G-3");
  await requireContract("P21G-3");

  // The snapshot: `git archive HEAD` unpacked under RUNNER_TEMP. The scanner therefore sees the
  // tree as it stands, with no .git directory and no history to walk.
  const archiveStep = stepsOf(workflow).find((step) => step.includes("git archive"));
  assert.ok(archiveStep !== undefined, "P21G-3: the workflow must materialise the tracked snapshot with git archive");
  assert.match(logicalCommand(archiveStep, "git archive"), /git archive\s+(--[^\s]+\s+)*HEAD\b/,
    "P21G-3: the snapshot must be taken from HEAD");
  assert.match(archiveStep, /RUNNER_TEMP/, "P21G-3: the snapshot must be extracted under RUNNER_TEMP, outside the checkout");
  assert.match(archiveStep, /\btar\b/, "P21G-3: the archive must be extracted before it is scanned");

  const historyModes = [
    [/trufflehog\s+git\b/, "the scan must not run in git mode"],
    [/--since-commit/, "the scan must not walk commit history"],
    [/--branch\b/, "the scan must not target a branch history"],
    [/file:\/\//, "the scan must not be pointed at a local git repository URL"],
    [/\.git\b/, "the scan must never be pointed at a .git directory"],
    [/fetch-depth:\s*0/, "the secret scan needs no history, so no checkout may deepen for it"],
  ];
  for (const [pattern, why] of historyModes) {
    assert.ok(!pattern.test(workflow), `P21G-3: ${why}`);
  }

  // The scanner itself: one step, pinned by image digest, never by a tag.
  const scanStep = stepsOf(workflow).find((step) => step.includes(TRUFFLEHOG_DIGEST));
  assert.ok(scanStep !== undefined, `P21G-3: the workflow must run the TruffleHog image pinned at ${TRUFFLEHOG_DIGEST}`);
  const imagePins = [...workflow.matchAll(/[^\s"']*trufflesecurity\/trufflehog[^\s"']*/gi)].map((match) => match[0]);
  assert.ok(imagePins.length > 0, "P21G-3: the workflow must name the canonical trufflesecurity/trufflehog image");
  for (const ref of imagePins) {
    assert.ok(ref.includes(`@${TRUFFLEHOG_DIGEST}`),
      `P21G-3: every TruffleHog image reference must be pinned to ${TRUFFLEHOG_DIGEST}, found: ${ref}`);
  }
  assert.ok(!/trufflehog[^\s@]*:(latest|v?\d)/i.test(workflow), "P21G-3: the TruffleHog image must never be pinned by tag");
  assert.match(scanStep, /\bfilesystem\b/, "P21G-3: the scan must run in filesystem mode over the extracted snapshot");
  assert.match(scanStep, /RUNNER_TEMP/, "P21G-3: the scan must read the snapshot extracted under RUNNER_TEMP");

  // Verification is off, so every result is unverified — and unverified results are exactly what
  // must still fail the job. Asking for verified results with verification off would silently
  // report nothing at all.
  for (const flag of ["--no-verification", "--fail", "--fail-on-scan-errors", "--no-update", "--json"]) {
    assert.ok(scanStep.includes(flag), `P21G-3: the scan must pass ${flag}`);
  }
  const results = scanStep.match(/--results=(\S+)/)?.[1]?.replace(/["']/g, "").split(",") ?? [];
  assert.ok(results.includes("unverified"), "P21G-3: the scan must report unverified results");
  assert.ok(!results.includes("verified"), "P21G-3: with verification off, narrowing to verified results would report nothing");

  // The pipeline into jq must fail on the scanner's own exit code, and the projection may carry
  // only the four non-disclosing fields. A CI log is a published artifact; a raw secret printed
  // into one is a second disclosure on top of the first.
  assert.match(scanStep, /set\s+-[a-zA-Z]*o\s+pipefail/, "P21G-3: the scan pipeline must run under pipefail");
  assert.match(scanStep, /\bjq\b/, "P21G-3: the scan output must be projected through jq");
  for (const field of [/\.DetectorName\b/, /\.Redacted\b/, /\bfile\b/, /\bline\b/]) {
    assert.match(scanStep, field, `P21G-3: the jq projection must carry ${field.source}`);
  }
  for (const disclosing of [/\bRawV2\b/, /\bRaw\b/, /\bSecretParts\b/]) {
    assert.ok(!disclosing.test(workflow), `P21G-3: the workflow must never project ${disclosing.source} — a CI log must not republish a secret`);
  }

  // Nothing is excluded. A detector filter or a path filter is an invisible blind spot.
  for (const exclusion of ["--exclude-detectors", "--include-detectors", "--exclude-paths", "--exclude_paths", "--config"]) {
    assert.ok(!workflow.includes(exclusion), `P21G-3: the scan must not narrow its own coverage with ${exclusion}`);
  }

  // The only sanctioned findings: exactly two inline ignores in the whole tracked tree, both on
  // the same line as a labelled embedded-credential negative fixture in the consumer-sync test.
  const hits = [];
  for (const file of trackedFiles()) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (!text.includes(IGNORE_MARKER)) continue;
    text.split("\n").forEach((line, index) => {
      if (line.includes(IGNORE_MARKER)) hits.push({ file, line: index + 1, text: line });
    });
  }
  assert.equal(hits.length, 2,
    `P21G-3: exactly two ${IGNORE_MARKER} comments may exist in the whole tracked tree, found ${hits.length}: ${hits.map((hit) => `${hit.file}:${hit.line}`).join(", ")}`);
  for (const hit of hits) {
    assert.equal(hit.file, FIXTURE_TEST_PATH,
      `P21G-3: a ${IGNORE_MARKER} comment may live only in ${FIXTURE_TEST_PATH}, found one in ${hit.file}:${hit.line}`);
    assert.equal(countOf(hit.text, new RegExp(IGNORE_MARKER, "g")), 1, `P21G-3: ${hit.file}:${hit.line} must carry exactly one ignore marker`);
    assert.match(hit.text.trimEnd(), IGNORE_COMMENT,
      `P21G-3: ${hit.file}:${hit.line} must end with a same-line // ${IGNORE_MARKER} comment, never a block or a preceding line`);
    assert.match(hit.text, EMBEDDED_CREDENTIAL_FIXTURE,
      `P21G-3: ${hit.file}:${hit.line} must be a labelled embedded-credential negative fixture — an ignore may only sit on the known-bad line it explains`);
  }

  // And the fixtures themselves are still there: exactly the two known-bad lines, both ignored.
  const fixtureLines = (await readFile(path.join(root, FIXTURE_TEST_PATH), "utf8")).split("\n");
  const fixtures = fixtureLines
    .map((text, index) => ({ line: index + 1, text }))
    .filter((entry) => EMBEDDED_CREDENTIAL_FIXTURE.test(entry.text));
  assert.equal(fixtures.length, 2,
    `P21G-3: ${FIXTURE_TEST_PATH} must keep exactly its two embedded-credential negative fixtures — the ignore comments are a labelling change, never a deletion`);
  assert.deepEqual(fixtures.map((entry) => entry.line), hits.map((hit) => hit.line),
    "P21G-3: both embedded-credential fixtures, and only those two lines, carry the inline ignore");
});

// =============================================================================================
// P21G-4 — the planning manifest binds this package, this base, the three frozen scope hashes,
// its exactly four allowed files and its discovery evidence, and claims no readiness.
// =============================================================================================

test("P21G-4: the planning manifest binds this package, its base, its scope hashes, its four allowed files and its discovery evidence", async () => {
  const contract = await requireContract("P21G-4");

  assert.equal(contract.package, PACKAGE_NAME);
  assert.equal(contract.base, BASE_COMMIT);
  assert.equal(contract.baseTree, BASE_TREE);
  assert.equal(contract.actionplanPin, ACTIONPLAN_PIN);

  // All three scope hashes, and the blind-determination provenance that makes them meaningful.
  assert.equal(contract.provenance.masterScopeSha256, MASTER_SCOPE_SHA256);
  assert.equal(contract.provenance.blindScopeSha256, BLIND_SCOPE_SHA256);
  assert.equal(contract.provenance.scopeSynthesisSha256, SYNTHESIS_SCOPE_SHA256);
  assert.equal(contract.provenance.blindScopeDetermination, true);
  assert.equal(contract.provenance.singleWriter, true);
  assert.equal(contract.provenance.reviewerMustBeSeparateSession, true);
  assert.equal(contract.provenance.testAuthoring, "claude-only");

  // The frozen test binds to this exact file, and the package may touch exactly four files.
  assert.equal(contract.frozenTestPath, FROZEN_TEST_PATH);
  assert.equal(contract.frozenTestSha256, crypto.createHash("sha256").update(await readFile(path.join(root, FROZEN_TEST_PATH))).digest("hex"),
    "P21G-4: frozenTestSha256 must be the content hash of this exact test file");
  assert.deepEqual([...contract.allowedFiles].sort(), [...ALLOWED_FILES].sort(),
    "P21G-4: P21G may touch only its manifest, this frozen test, the new security workflow and the consumer-sync fixture file");

  // Discovery evidence: the pinned tooling this package depends on is recorded, with how it was
  // resolved, so a later reader can re-derive the pins instead of trusting them.
  const discovery = contract.discoveryEvidence;
  assert.equal(discovery.truffleHogImageDigest, TRUFFLEHOG_DIGEST);
  assert.equal(discovery.pipAuditVersion, PIP_AUDIT_VERSION);
  assert.equal(discovery.npmAuditCommand, NPM_AUDIT_COMMAND);
  for (const key of ["truffleHogImage", "method"]) {
    assert.ok(typeof discovery[key] === "string" && discovery[key].trim().length > 0, `P21G-4: discoveryEvidence.${key} must be a non-empty string`);
  }

  // The current-tree boundary is stated as a boundary, not implied by the workflow's shape.
  assert.equal(contract.scanBoundary.currentTrackedTreeOnly, true);
  assert.equal(contract.scanBoundary.gitHistoryScanned, false);
  assert.equal(contract.scanBoundary.extractedUnder, "RUNNER_TEMP");
  assert.ok(typeof contract.scanBoundary.note === "string" && contract.scanBoundary.note.trim().length > 0,
    "P21G-4: scanBoundary.note must say what a current-tree scan cannot see");

  // Rollback is known before the package starts.
  assert.equal(contract.rollback.compensatingStepRequired, false);
  for (const key of ["mechanism", "blastRadius"]) {
    assert.ok(typeof contract.rollback[key] === "string" && contract.rollback[key].trim().length > 0, `P21G-4: rollback.${key} must be a non-empty string`);
  }

  // Nothing here is readiness. A GREEN scan gate is a gate, not a product.
  for (const flag of ["kernelReady", "releaseAllowed", "productionAllowed", "runnableProduct", "deployAllowed", "hostSelected", "gapClosed", "p21Complete"]) {
    assert.equal(contract.readinessFlags[flag], false, `P21G-4: readinessFlags.${flag} must stay false`);
  }

  // capability_delta, in the repository's own spelling, and a not-runnable claim beside it.
  assert.match(contract.capabilityDelta, /^SUPPLY_CHAIN_AND_SECRET_SCAN_GATE:/,
    "P21G-4: capabilityDelta must state the gate this package adds, under its fixed prefix");
  assert.ok(typeof contract.productClaim.runnable === "string" && contract.productClaim.runnable.trim().length > 0,
    "P21G-4: productClaim.runnable must state exactly what this package makes runnable");
  assert.match(contract.productClaim.notRunnable, /hosted/i,
    "P21G-4: productClaim.notRunnable must keep saying that no hosted product journey is runnable");

  // The owner-facing Turkish user journey, in full.
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.ok(typeof contract.userJourney[key] === "string" && contract.userJourney[key].trim().length > 0,
      `P21G-4: userJourney.${key} must be a non-empty string`);
  }

  // The non-goals that keep this package from growing into the ones next to it.
  const nonGoals = contract.nonGoals.join(" | ").toLowerCase();
  for (const required of [
    /no src\/\*\* change/,
    /no package\.json, lockfile, pyproject or uv\.lock change/,
    /no ignored vulnerability/,
    /git history is not scanned/,
    /no release, deploy/,
    /no hosted/,
    /no p21 completion claim/,
    /no commit, push/,
  ]) {
    assert.match(nonGoals, required, `P21G-4: nonGoals must state: ${required.source}`);
  }

  for (const scenario of contract.acceptanceScenarios) {
    for (const key of ["name", "given", "then"]) {
      assert.ok(typeof scenario[key] === "string" && scenario[key].trim().length > 0, `P21G-4: ${scenario.id} needs a ${key}`);
    }
  }
});
