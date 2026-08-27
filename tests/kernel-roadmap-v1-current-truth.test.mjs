import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_EDGES = {
  P01: [], P02: ['P01'], P03: ['P02'], P04: ['P03', 'P06'], P05: ['P02', 'P04'], P06: ['P01'],
  P07: ['P03', 'P05', 'P06'], P08: ['P07'], P09: ['P08'], P10: ['P09'], P11: ['P06', 'P10'],
  P12: ['P11'], P13: ['P12'], P14: ['P13'], P15: ['P10', 'P14'], P16: ['P15'],
  P17: ['P09', 'P15'], P18: ['P05', 'P14'], P19: ['P16', 'P17', 'P18'], P20: ['P19'],
  P21: ['P19'], P22: ['P19'], P23: ['P22'], P24: ['P16'], P25: ['P20', 'P21', 'P23', 'P24'],
};

const EXPECTED_FAMILIES = {
  F0: ['P01'], F1: ['P02', 'P03', 'P04', 'P05', 'P06'], F2: ['P07', 'P08', 'P09'],
  F3: ['P10', 'P11', 'P12', 'P13', 'P14'], F4: ['P15', 'P16'], F5: ['P17', 'P18'],
  F6: ['P19', 'P20', 'P21', 'P22', 'P23'], F7: ['P24', 'P25'],
};

const EXPECTED_PACKAGE_NAMES = {
  P01: 'Current Truth & Roadmap', P02: 'Action Contract IR', P03: 'PDP Request/Decision',
  P04: 'policy-as-data, batch and decision-log adapter', P05: 'UoW, CommitReceipt and write envelope',
  P06: 'persistence ownership guard', P07: 'generic generator', P08: 'versioned SDK distribution',
  P09: 'clean consumer conformance', P10: 'app-core', P11: 'app-owned customer schema',
  P12: 'app-owned adapter', P13: 'data cutover and rollback', P14: 'Kernel cleanup and parity',
  P15: 'Customer module typed API', P16: 'separate Surface/UI projection',
  P17: 'installable ASGI host adapters', P18: 'outbox relay lifecycle',
  P19: 'observability/SLO', P20: 'performance', P21: 'security', P22: 'deploy package/staging',
  P23: 'HA/DR/upgrade rollback', P24: 'three independent consumer teams', P25: 'promotion gates',
};

function loadRoadmap() {
  return JSON.parse(readFileSync(path.join(repoRoot, 'planning', 'roadmap-v1-current-truth.json'), 'utf8'));
}
function readText(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

// P21A-G merged security evidence. Each entry binds one sub-package to its merged pull request,
// the passing CI run for that merge commit, and the frozen test file its manifest froze by SHA-256.
const P21_SECURITY_EVIDENCE = [
  {
    pkg: 'P21A',
    pr: '#128',
    ciRun: '32997140154',
    manifest: 'planning/kernel-host-trusted-identity-boundary-p21a.json',
    frozenTestPath: 'tests/kernel-python-host-bridge-real-pg-allow.test.mjs',
    frozenTestSha256: '97a8691cfe78c9a9c19f964cf2b0d0bbce0089b424fe2e0a1b5a835586e2b18e',
  },
  {
    pkg: 'P21B',
    pr: '#129',
    ciRun: '33003288720',
    manifest: 'planning/kernel-boundary-authz-deny-zero-write-p21b.json',
    frozenTestPath: 'tests/kernel-create-customer-asgi-composition.test.mjs',
    frozenTestSha256: '8c5acc5ef32b961b9491bf7f503439dfae35c71f48b1653ab5857c185c84f2ac',
  },
  {
    pkg: 'P21C',
    pr: '#130',
    ciRun: '33010709401',
    manifest: 'planning/kernel-boundary-decision-audit-p21c.json',
    frozenTestPath: 'tests/kernel-boundary-decision-audit-p21c.test.mjs',
    frozenTestSha256: '5bc3a259631776b05a18d7f91276815e6e3d522d9f8e2b69f64c73ef3bd54cab',
  },
  {
    pkg: 'P21D',
    pr: '#131',
    ciRun: '33015412681',
    manifest: 'planning/kernel-audited-asgi-boundary-composition-p21d.json',
    frozenTestPath: 'tests/kernel-audited-asgi-boundary-composition-p21d.test.mjs',
    frozenTestSha256: 'b96cf79eb60010f0d81052da35064d219ac35dae5d5905e3c726be6c32c316e2',
  },
  {
    pkg: 'P21E',
    pr: '#132',
    ciRun: '33019320390',
    manifest: 'planning/kernel-identity-guard-decision-audit-p21e.json',
    frozenTestPath: 'tests/kernel-identity-guard-decision-audit-p21e.test.mjs',
    frozenTestSha256: '8c62e044e5e7d52f48b9df74f9426552e99f30a3984f8612ad56fef72815c135',
  },
  {
    pkg: 'P21F',
    pr: '#133',
    ciRun: '33023129130',
    manifest: 'planning/kernel-audited-host-runner-p21f.json',
    frozenTestPath: 'tests/kernel-audited-host-runner-p21f.test.mjs',
    frozenTestSha256: '06de7a1a7e0a441ce2ac422b1af90fd555cb409e6781aece57a9145acccb7fca',
  },
  {
    pkg: 'P21G',
    pr: '#134',
    ciRun: '33027876043',
    manifest: 'planning/kernel-security-dependency-secret-scan-p21g.json',
    frozenTestPath: 'tests/kernel-security-dependency-secret-scan-p21g.test.mjs',
    frozenTestSha256: '70e5a6bdbcb32452a8ef867ddff8a904cc1831efb637de1b60fec4579d146cbf',
  },
];

// The separate Security-workflow run on the #134 merge commit, distinct from that merge's ci.yml run.
const P21G_SECURITY_WORKFLOW_RUN = '33027876143';

function sha256File(rel) {
  return createHash('sha256').update(readFileSync(path.join(repoRoot, rel))).digest('hex');
}

// ---------------------------------------------------------------------------
// P22C shared constants.
//
// This closure package advances the single roadmap counter from 21/25 to 22/25.
// The counter-bound assertions that already existed in this file and the seven
// P22C scenarios below read the same constants, so the counter, the capability
// delta and the remaining-proof range cannot drift between them.
// ---------------------------------------------------------------------------

const P22C_COMPLETED = 22;
const P22C_TOTAL = 25;
const P22C_COMPLETED_PACKAGES = Array.from({ length: P22C_COMPLETED }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
const P22C_ACTIVE_PACKAGE = 'P23';
const P22C_AS_OF_KERNEL_MAIN = 'baf59d2ad158cc83f15c06bd6d9358cbfd9280a9';
const P22C_STATUS_LINE = '22/25 tamamlandı, P23/25 aktif';
const P22C_CAPABILITY_DELTA = 'DEPLOY_ARTIFACT_PROVEN_BY_EPHEMERAL_LIVE_AUDITED_WRITE';
const P22C_CALISTIRILABILIRLIK = 'ephemeral-live-audited-deploy-artifact-proven-hosted-product-not-runnable';
const P22C_CLOSURE_MANIFEST = 'planning/kernel-p22-current-truth-closure-p22c.json';

// The production-proof range that remains once P22 closes, and the stale range it replaces.
const REMAINING_PROOF_RANGE = /P23-P25|P23–P25/;
const STALE_P22_PROOF_RANGE = /P22-P25|P22–P25/;

// The nine stronger readiness flags. P22C introduces no new true flag into currentTruth:
// closing a package named "deploy" is neither deploy authority nor product readiness.
const STRONGER_READINESS_FLAGS = [
  'kernelReady', 'sdkReady', 'appBuildable', 'releaseAllowed', 'deployAllowed',
  'productionAllowed', 'gapClosed', 'oneGoldenSliceReady', 'runnableProduct',
];

// P22A1-P22B2 merged deploy evidence. Each entry binds one sub-package to its merged pull
// request, the passing ci.yml run on that merge commit as it ran on main, and the frozen
// test file its manifest froze by SHA-256.
const P22_DEPLOY_EVIDENCE = [
  {
    pkg: 'P22A1',
    pr: '#136',
    ciRun: '33036329914',
    manifest: 'planning/kernel-deploy-secret-boundary-p22a1.json',
    frozenTestPath: 'tests/kernel-deploy-secret-boundary-p22a1.test.mjs',
    frozenTestSha256: 'a5a0ede969cbf091c61c399573868f3fe1b2b615a24d0411861126691ac6c1e1',
  },
  {
    pkg: 'P22A2',
    pr: '#137',
    ciRun: '33042126138',
    manifest: 'planning/kernel-deploy-oci-image-p22a2.json',
    frozenTestPath: 'tests/kernel-deploy-oci-image-p22a2.test.mjs',
    frozenTestSha256: 'fd3faecefa4547b0d600c47661738980f970600720634b7cd3272a542820a0bf',
  },
  {
    pkg: 'P22B1',
    pr: '#138',
    ciRun: '33049913914',
    manifest: 'planning/kernel-deploy-ephemeral-environment-p22b1.json',
    frozenTestPath: 'tests/kernel-deploy-ephemeral-environment-p22b1.test.mjs',
    frozenTestSha256: 'aef0f0ca2eb34147f75725f8ef302d2c60ec61da2e8ca9921c8075fac69873e9',
  },
  {
    pkg: 'P22B2',
    pr: '#139',
    ciRun: '33055438573',
    manifest: 'planning/kernel-deploy-live-audited-write-p22b2.json',
    frozenTestPath: 'tests/kernel-deploy-live-audited-write-p22b2.test.mjs',
    frozenTestSha256: '0aee9deeb1fb6491e2a67b8026f5ff3ccce4a3e1808b933087ea3be0bf63a8e4',
  },
];

// Overclaim shapes the three markdown projections must never carry. Each pattern is written
// so the honest denial ("no staging environment exists", "not ... releasable, deployable ...
// or production-ready") does not trip it; only a positive claim does.
const OVERCLAIM_PATTERNS = [
  [/\bis runnable\b/i, 'a runnable-product claim'],
  [/\bdeploy(ment)?\s+is\s+allowed\b/i, 'a deploy-authority claim'],
  [/\b(is|are|now)\s+(releasable|deployable|production[- ]ready)\b/i, 'a release or production-readiness claim'],
  [/(?<!\bno\s)(?<!\bnot\s)\bstaging environment (now )?exists\b/i, 'a staging-environment-exists claim'],
  [/(?<!\bno\s)(?<!\bnot\s)\bstaging run (was|is|were) (performed|executed)\b/i, 'a staging-run claim'],
  [/\b(blocks|blocking|prevents) (the )?merges?\b/i, 'a merge-blocking claim'],
  [/merges? (is|are) blocked\b/i, 'a merge-blocking claim'],
];

function currentTruthText(t) {
  return [t.implementedPieces.join(' | '), t.notImplementedPieces.join(' | '), t.notRunnableProductClaim].join(' | ');
}

function changelogUnreleased() {
  const text = readText('CHANGELOG.md');
  const idx = text.indexOf('## [Unreleased]');
  assert.ok(idx >= 0, 'CHANGELOG.md must carry a ## [Unreleased] section');
  return text.slice(idx);
}

// The Unreleased section is cumulative: every earlier closure bullet stays as written history,
// stale ranges included. The newest entry is therefore everything above the preserved P21h
// bullet, and only that slice is held to the new truth.
function changelogNewestEntry() {
  const unreleased = changelogUnreleased();
  const idx = unreleased.indexOf('- P21h ');
  assert.ok(idx >= 0, 'the preserved P21h Unreleased bullet delimits the newest CHANGELOG entry');
  return unreleased.slice(0, idx);
}

test('roadmap is 25 atomic packages across 8 delivery phases/families, never called "25 phases", across all four projections', () => {
  const doc = loadRoadmap();
  assert.equal(doc.roadmap.denominator, 25);
  assert.equal(doc.roadmap.phases.length, 25);
  assert.equal(doc.roadmap.families.length, 8);

  const roadmapText = readText('ROADMAP.md');
  assert.doesNotMatch(roadmapText, /25 phases/i);
  assert.doesNotMatch(roadmapText, /25-phase/i);
  assert.match(roadmapText, /25 atomic packages/i);
  assert.match(roadmapText, /8 delivery (phases|families)/i);

  const readmeText = readText('README.md');
  assert.doesNotMatch(readmeText, /25-phase/i);
  assert.doesNotMatch(readmeText, /\b25 phases\b/i);
  assert.match(readmeText, /25 atomic packages across 8 delivery phases\/families/i);

  const changelogText = readText('CHANGELOG.md');
  assert.doesNotMatch(changelogText, /25-phase denominator/i);
  assert.doesNotMatch(changelogText, /\b25 phases\b/i);
  assert.match(changelogText, /25-package denominator/i);

  const ownerFacing = JSON.stringify(doc.ownerFacing);
  assert.doesNotMatch(ownerFacing, /25 fazlik/i);
  assert.doesNotMatch(ownerFacing, /25-phase/i);
  assert.match(ownerFacing, /25 paketlik/i);
});

test('package ids are unique, sequential P01..P25, each carrying its exact approved name', () => {
  const doc = loadRoadmap();
  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  const ids = doc.roadmap.phases.map((p) => p.id);
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
  for (const [id, name] of Object.entries(EXPECTED_PACKAGE_NAMES)) {
    assert.equal(byId[id].name, name, `${id} name mismatch`);
  }
});

test('each package belongs to the approved family grouping', () => {
  const doc = loadRoadmap();
  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  for (const [family, ids] of Object.entries(EXPECTED_FAMILIES)) {
    for (const id of ids) assert.equal(byId[id].family, family, `${id} should belong to ${family}`);
  }
  assert.deepEqual(new Set(doc.roadmap.families.map((f) => f.id)), new Set(Object.keys(EXPECTED_FAMILIES)));
});

test('dependency DAG matches the approved edges exactly (unchanged)', () => {
  const doc = loadRoadmap();
  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  for (const [id, deps] of Object.entries(EXPECTED_EDGES)) {
    assert.deepEqual([...byId[id].dependsOn].sort(), [...deps].sort(), `dependsOn mismatch for ${id}`);
  }
});

test('global readiness truth is all false and current truth names real existing and missing pieces', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;
  assert.equal(t.runtimeImplementationStarted, true);
  for (const key of ['kernelReady', 'sdkReady', 'appBuildable', 'releaseAllowed', 'deployAllowed', 'productionAllowed', 'gapClosed', 'oneGoldenSliceReady', 'runnableProduct']) {
    assert.equal(t[key], false, `${key} must be false`);
  }
  const exists = t.implementedPieces.join(' | ');
  for (const term of ['Domain', 'Application', 'Adapters', 'Delivery', 'CreateCustomer', 'SDK', 'ASGI', 'Python host', 'PostgreSQL', 'app-core']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['app-owned customer schema', 'CUSTOMER_RECORDS_SCHEMA', 'canonicalizeCustomerRecord']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['consumers/customer-app-core/customer-records-adapter\\.mjs', 'createCustomerRecordsAdapter', 'app-owned.*adapter']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['consumers/customer-app-core/customer-data-cutover\\.mjs', 'createCustomerDataCutover', 'P13']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['customer-module-api', 'createCustomerModuleApi', 'CUSTOMER_MODULE_API_MANIFEST']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['consumers/customer-app-core/customer-surface\\.mjs', 'createCustomerSurface', 'CUSTOMER_SURFACE_MANIFEST']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  for (const term of ['run_outbox_relay_once', 'OutboxRelayResult', 'db/metaframer_kernel_db/outbox_relay\\.py']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }

  const missing = t.notImplementedPieces.join(' | ');
  for (const term of ['live entrypoint|host', 'production proof']) {
    assert.match(missing, new RegExp(term), `notImplementedPieces missing ${term}`);
  }
  assert.doesNotMatch(missing, /\binstallable ASGI host adapters\b/i);
  assert.doesNotMatch(missing, /\(P17\)/);
  assert.doesNotMatch(missing, /clean consumer conformance/i);
  assert.doesNotMatch(missing, /\(P09\)/);
  assert.doesNotMatch(missing, /app-core/i);
  assert.doesNotMatch(missing, /\(P10\)/);
  assert.doesNotMatch(missing, /\bapp-owned customer schema\b/i);
  assert.doesNotMatch(missing, /\(P11\)/);
  assert.doesNotMatch(missing, /\bapp-owned adapter\b/i);
  assert.doesNotMatch(missing, /\(P12\)/);
  assert.doesNotMatch(missing, /\(P13\)/);
  assert.doesNotMatch(missing, /\(P14\)/);
  assert.doesNotMatch(missing, /Kernel cleanup and parity/i);
  assert.doesNotMatch(missing, /\(P15\)/);
  assert.doesNotMatch(missing, /Customer module typed API/i);
  assert.doesNotMatch(missing, /\(P16\)/);
  assert.doesNotMatch(missing, /separate Surface\/UI projection/i);
  assert.doesNotMatch(missing, /\boutbox relay\b/i);
  assert.doesNotMatch(missing, /\(P18\)/);
  assert.match(missing, /scheduler|loop|retry policy|dead-letter|DLQ/i);
  assert.match(missing, REMAINING_PROOF_RANGE);
  assert.doesNotMatch(missing, /P20-P25|P20–P25/);
  assert.doesNotMatch(t.notRunnableProductClaim, /only the S1.*and isolated ASGI/i);
  assert.doesNotMatch(t.notRunnableProductClaim, /no SDK, app, module or delivery ring/i);
});

test('source metadata distinguishes the pinned authority commit from the clean design/budget snapshot', () => {
  const doc = loadRoadmap();
  assert.equal(doc.sourceClasses.actionplan.sha, '811505b0229705cf39edbf0d6b60248c46a72091');
  assert.equal(doc.sourceClasses.actionplan.ref, 'pinned-authority-commit');
  assert.notEqual(doc.sourceClasses.actionplan.ref, 'origin/main');
  assert.equal(doc.sourceClasses.actionplanDesignBudget.sha, 'c3d9e47ececdf1092c36c1a6bf5f7a8ec098aaf3');
  assert.notEqual(doc.sourceClasses.actionplan.sha, doc.sourceClasses.actionplanDesignBudget.sha);
  assert.doesNotMatch(doc.sourceClasses.kernel.role, /planning-only control plane/i);
});

test('family DoDs match the approved future roadmap shape', () => {
  const doc = loadRoadmap();
  const dodById = Object.fromEntries(doc.roadmap.families.map((f) => [f.id, f.dod]));
  assert.match(dodById.F1, /public contract/i);
  assert.match(dodById.F2, /generic SDK/i);
  assert.match(dodById.F3, /application-owned persistence/i);
  assert.match(dodById.F4, /real product slice|Surface/i);
  assert.match(dodById.F5, /installable delivery|events/i);
  assert.match(dodById.F6, /enterprise operation/i);
  assert.match(dodById.F7, /external proof|promotion/i);
});

test('ROADMAP.md table/flags are correct and src/delivery vs host/python_asgi paths are accurate', () => {
  const roadmap = readText('ROADMAP.md');
  assert.match(roadmap, /\|\s*Delivery phase\s*\|\s*Packages\s*\|/);
  for (const row of [
    /F0 \| P01 \| Current truth \+ roadmap/, /F1 \| P02–P06 \| Public contracts/,
    /F2 \| P07–P09 \| Generic SDK/, /F3 \| P10–P14 \| app-core plus application-owned persistence/,
    /F4 \| P15–P16 \| Customer product slice plus a separate Surface\/UI projection/,
    /F5 \| P17–P18 \| Installable ASGI adapters plus the outbox relay lifecycle/,
    /F6 \| P19–P23 \| Enterprise operations/,
    /F7 \| P24–P25 \| External consumer proof plus the full promotion gate set/,
  ]) assert.match(roadmap, row);
  assert.match(roadmap, /oneGoldenSliceReady/);
  assert.match(roadmap, /runnableProduct/);

  const exists = loadRoadmap().currentTruth.implementedPieces.join(' | ');
  assert.doesNotMatch(exists, /Delivery layer \(src\/delivery\)[^|]*host runner CLI/i);
  assert.match(exists, /src\/delivery.*(framework-neutral|HTTP\/ASGI\/router)/i);
  assert.match(exists, /host\/python_asgi/);
});

test('execution model caps writer lanes at 3 and declares shared locks', () => {
  const doc = loadRoadmap();
  assert.equal(doc.execution.maxWriterLanes, 3);
  assert.ok(Array.isArray(doc.execution.sharedLocks) && doc.execution.sharedLocks.length > 0);
});

test('owner-facing fields declare the current capability_delta at 22/25 with P23 active, hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, P22C_CAPABILITY_DELTA);
  assert.equal(o.calistirilabilirlik, P22C_CALISTIRILABILIRLIK);
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /22\/25/);
  assert.match(ownerText, /P23/);
  assert.match(ownerText, /hosted/i);
  assert.match(ownerText, /not-runnable|calismaz|calismiyor|çalışmıyor/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);
});

test('ROADMAP.md and README.md project the same corrected structure', () => {
  const roadmap = readText('ROADMAP.md');
  assert.match(roadmap, /P01/);
  assert.match(roadmap, /P25/);
  assert.match(roadmap, /roadmap-v1-current-truth\.json/);
  const readme = readText('README.md');
  assert.match(readme, /ROADMAP\.md/);
});

test('README no longer carries an unqualified stale denial that src/adapters, src/delivery, src/sdk do not exist', () => {
  const readme = readText('README.md');
  const staleDenial = /src\/adapters,\s*src\/delivery and src\/sdk are refused by name[\s\S]{0,200}no adapter, delivery or SDK ring exists/i;
  assert.doesNotMatch(readme, staleDenial);
  assert.match(readme, /src\/adapters.*exist|src\/delivery.*exist|src\/sdk.*exist/is);
});

test('CHANGELOG records the P01 correction under Unreleased', () => {
  const text = readText('CHANGELOG.md');
  const unreleasedIdx = text.indexOf('## [Unreleased]');
  assert.ok(unreleasedIdx >= 0);
  assert.match(text.slice(unreleasedIdx), /roadmap-v1-current-truth/);
});

test('roadmap.progress carries the exact 22/25 completed truth with P22 closed and P23 active', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');
  assert.equal(progress.completed, P22C_COMPLETED);
  assert.equal(progress.total, P22C_TOTAL);
  assert.deepEqual([...progress.completedPackages].sort(), [...P22C_COMPLETED_PACKAGES].sort());
  assert.equal(progress.completedPackages.length, progress.completed);
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length);
  assert.equal(progress.activePackage, P22C_ACTIVE_PACKAGE);
  assert.equal(progress.asOfKernelMain, P22C_AS_OF_KERNEL_MAIN);
  assert.equal(progress.statusLine, P22C_STATUS_LINE);

  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  const completedSet = new Set(progress.completedPackages);
  for (const id of progress.completedPackages) {
    for (const dep of byId[id].dependsOn) {
      assert.ok(completedSet.has(dep), `completed package ${id} depends on incomplete ${dep}`);
    }
  }
  for (const dep of byId[progress.activePackage].dependsOn) {
    assert.ok(completedSet.has(dep), `active package ${progress.activePackage} depends on incomplete ${dep}`);
  }
});

test('currentTruth reflects P21 (security) as implemented through the merged P21A-G evidence bound to its frozen manifests, with P23-P25 production proof still missing, all readiness flags false, and hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;
  const implemented = t.implementedPieces.join(' | ');

  // Each P21 sub-package is bound to its merged pull request, the passing CI run for that merge,
  // and the frozen test file its manifest froze by SHA-256.
  for (const e of P21_SECURITY_EVIDENCE) {
    assert.ok(implemented.includes(e.pkg), `implementedPieces must name ${e.pkg}`);
    assert.ok(implemented.includes(e.pr), `implementedPieces must cite ${e.pkg} PR ${e.pr}`);
    assert.ok(implemented.includes(e.ciRun), `implementedPieces must cite the ${e.pr} CI run ${e.ciRun}`);
    assert.ok(implemented.includes(e.frozenTestPath), `implementedPieces must cite ${e.pkg} frozen test ${e.frozenTestPath}`);

    const manifestFile = path.join(repoRoot, e.manifest);
    assert.ok(existsSync(manifestFile), `${e.pkg} manifest ${e.manifest} must exist as frozen evidence`);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.frozenTestPath, e.frozenTestPath, `${e.pkg} manifest frozenTestPath mismatch`);
    assert.equal(manifest.frozenTestSha256, e.frozenTestSha256, `${e.pkg} manifest frozenTestSha256 mismatch`);
    assert.ok(existsSync(path.join(repoRoot, e.frozenTestPath)), `${e.pkg} frozen test ${e.frozenTestPath} must exist`);
    assert.equal(sha256File(e.frozenTestPath), e.frozenTestSha256, `${e.pkg} frozen test ${e.frozenTestPath} has drifted from its manifest SHA-256`);
  }
  assert.ok(implemented.includes(P21G_SECURITY_WORKFLOW_RUN), `implementedPieces must cite the Security workflow run ${P21G_SECURITY_WORKFLOW_RUN}`);

  // The security substance itself, not only the package labels.
  for (const [term, label] of [
    [/--trusted-tenant-id/, 'P21A trusted tenant input'],
    [/--trusted-actor-id/, 'P21A trusted actor input'],
    [/default deny/i, 'P21B closed default deny'],
    [/zero.?write/i, 'P21B deny zero-write proof'],
    [/policy_decision_log/, 'P21C decision log table'],
    [/prev_hash|hash.?chain/i, 'P21C hash chain'],
    [/createAuditedCustomerAsgiComposition/, 'P21D audited ASGI composition'],
    [/createAuditedCustomerComposition/, 'P21E audited composition'],
    [/identity guard/i, 'P21E identity-guard refusal audit'],
    [/--audit on/, 'P21F opt-in audit flag'],
    [/host runner/i, 'P21F audited host runner'],
    [/\.github\/workflows\/security\.yml/, 'P21G security workflow'],
    [/npm audit/i, 'P21G npm dependency audit'],
    [/pip-audit/i, 'P21G Python dependency audit'],
    [/trufflehog|digest-pinned scanner/i, 'P21G pinned secret scanner'],
    [/tracked (tree|snapshot)/i, 'P21G current-tree secret scan'],
    [/PostgreSQL 16|real PostgreSQL/i, 'real-substrate proof'],
    [/P20/, 'P20 performance baseline must remain named'],
  ]) {
    assert.match(implemented, term, `implementedPieces missing ${label}`);
  }

  const missing = t.notImplementedPieces.join(' | ');
  assert.doesNotMatch(missing, /\(P21\)/, 'P21 is closed and must not be listed as not implemented');
  assert.doesNotMatch(missing, /P21-P25|P21–P25/, 'the P21-P25 range claim is stale at 21/25');
  assert.doesNotMatch(missing, /P20-P25|P20–P25/);
  assert.match(missing, REMAINING_PROOF_RANGE, 'the remaining production-proof range is P23-P25');
  for (const [term, label] of [
    [/deploy package|staging/i, 'P22 deploy package/staging'],
    [/HA\/DR|upgrade rollback/i, 'P23 HA/DR/upgrade rollback'],
    [/consumer teams|external proof/i, 'P24 external consumer proof'],
    [/promotion gate/i, 'P25 promotion gates'],
    [/production proof/i, 'production proof'],
    [/live entrypoint|live host|host wiring/i, 'live entrypoint/host wiring'],
  ]) {
    assert.match(missing, term, `notImplementedPieces missing ${label}`);
  }

  // The explicit P21 residuals: what the closed security package still does not do.
  for (const [term, label] of [
    [/opt-in|--audit on|default(-| )off/i, 'the audit is opt-in and default-off'],
    [/login|session/i, 'no real login or session surface'],
    [/managed policy/i, 'no managed policy source'],
    [/from the caller|caller-supplied|process input/i, 'caller/process-supplied identity and policy candidates'],
    [/no host server is selected|network listener/i, 'no selected host and no listener'],
    [/query|reporting|retention|export/i, 'no decision-log query/report/retention/export'],
    [/tracked tree only|current tracked (tree|snapshot)/i, 'current-tree-only scan'],
    [/Git history/i, 'the Git history is unscanned'],
    [/runtime secret|environment variable|deployment configuration/i, 'runtime secrets are uncovered'],
    [/secret store/i, 'no CI secret store coverage'],
    [/detector/i, 'detector blind spot'],
    [/advisory databas|moving floor|published tomorrow/i, 'advisory blind spot'],
    [/development-only depend|dev depend|omit=dev/i, 'npm development-dependency blind spot'],
    [/pre-commit|local[^|]{0,60}(secret|scan)/i, 'no local secret gate'],
    [/branch.?protection/i, 'supply-chain-and-secret-scan is not a required branch-protection context'],
    [/required (status )?(check|context)/i, 'not a required merge check'],
    [/DAST|dynamic application security testing/i, 'no DAST until a host exists'],
    [/Actionplan/i, 'no Actionplan node writeback'],
    [/writeback|write-back|write back/i, 'no Actionplan node writeback'],
  ]) {
    assert.match(missing, term, `notImplementedPieces missing residual: ${label}`);
  }

  for (const key of ['kernelReady', 'sdkReady', 'appBuildable', 'releaseAllowed', 'deployAllowed', 'productionAllowed', 'gapClosed', 'oneGoldenSliceReady', 'runnableProduct']) {
    assert.equal(t[key], false, `${key} must remain false`);
  }

  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, P22C_CAPABILITY_DELTA);
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /22\/25/);
  assert.match(ownerText, /P23/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.doesNotMatch(t.notRunnableProductClaim, /(?<!\bNo\b[^.]{0,80})\bis runnable end-to-end\b/i);
  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /no host server is selected|live host|listener|live entrypoint/i);
  assert.match(t.notRunnableProductClaim, REMAINING_PROOF_RANGE);
});

test('ROADMAP.md projects the current status line while README.md and CHANGELOG.md preserve the P21A-G closure evidence, with no runnable, readiness or merge-blocking overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  assert.ok(roadmap.includes(P22C_STATUS_LINE), 'ROADMAP.md must project the current status line');
  assert.match(roadmap, /P21/);
  assert.match(roadmap, /P22/);
  assert.doesNotMatch(roadmap, /\bis runnable\b/i);

  const readme = readText('README.md');
  assert.ok(readme.includes(P22C_STATUS_LINE), 'README.md must project the current status line');
  assert.doesNotMatch(readme, /\bis runnable\b/i);

  const changelog = readText('CHANGELOG.md');
  const unreleasedIdx = changelog.indexOf('## [Unreleased]');
  assert.ok(unreleasedIdx >= 0);
  const unreleased = changelog.slice(unreleasedIdx);
  assert.match(unreleased, /P21/);
  for (const e of P21_SECURITY_EVIDENCE) {
    assert.ok(unreleased.includes(e.pr), `CHANGELOG Unreleased must cite ${e.pkg} PR ${e.pr}`);
    assert.ok(unreleased.includes(e.ciRun), `CHANGELOG Unreleased must cite the ${e.pr} CI run ${e.ciRun}`);
  }
  assert.ok(unreleased.includes(P21G_SECURITY_WORKFLOW_RUN), `CHANGELOG Unreleased must cite the Security workflow run ${P21G_SECURITY_WORKFLOW_RUN}`);
  assert.match(unreleased, /\.github\/workflows\/security\.yml/);
  assert.match(unreleased, /roadmap-v1-current-truth\.json/);
  assert.match(unreleased, /21\/25 tamamlandı, P22\/25 aktif/);
  assert.doesNotMatch(unreleased, /\bis runnable\b/i);
  assert.doesNotMatch(unreleased, /\b(blocks|blocking|prevents) (the )?merges?\b/i, 'the security workflow is not a required merge gate today');
  assert.doesNotMatch(unreleased, /merges? (is|are) blocked\b/i, 'the security workflow is not a required merge gate today');
});

// ===========================================================================
// P22C - current-truth closure for P22 (deploy package/staging).
// Seven focused scenarios. Each fails at base baf59d2a and passes only after
// the implementation writer syncs the five non-test allowed files.
// ===========================================================================

test('P22C-1: roadmap.progress advances to 22/25 with P22 completed, P23 active, and every dependency of a completed or active package already completed', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');

  assert.equal(progress.completed, P22C_COMPLETED);
  assert.equal(progress.total, P22C_TOTAL);
  assert.equal(doc.roadmap.denominator, P22C_TOTAL, 'the fixed 25-package denominator never moves');

  assert.deepEqual([...progress.completedPackages].sort(), [...P22C_COMPLETED_PACKAGES].sort(),
    'completedPackages must be exactly P01..P22');
  assert.equal(progress.completedPackages.length, progress.completed,
    'completedPackages length must equal the counter');
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length,
    'completedPackages must be unique');

  assert.equal(progress.activePackage, P22C_ACTIVE_PACKAGE);
  assert.equal(progress.asOfKernelMain, P22C_AS_OF_KERNEL_MAIN);
  assert.equal(progress.statusLine, P22C_STATUS_LINE);

  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  const completedSet = new Set(progress.completedPackages);
  for (const id of progress.completedPackages) {
    for (const dep of byId[id].dependsOn) {
      assert.ok(completedSet.has(dep), `completed package ${id} depends on incomplete ${dep}`);
    }
  }
  assert.deepEqual([...byId[P22C_ACTIVE_PACKAGE].dependsOn].sort(), ['P22'],
    'P23 depends on P22 and the DAG edge is unchanged');
  for (const dep of byId[P22C_ACTIVE_PACKAGE].dependsOn) {
    assert.ok(completedSet.has(dep), `active package ${P22C_ACTIVE_PACKAGE} depends on incomplete ${dep}`);
  }
});

test('P22C-2: currentTruth binds each merged P22 sub-package to its PR, its main ci.yml run and its manifest-frozen test, and every frozen test still hashes to the SHA-256 its manifest froze', () => {
  const doc = loadRoadmap();
  const implemented = doc.currentTruth.implementedPieces.join(' | ');

  for (const e of P22_DEPLOY_EVIDENCE) {
    assert.ok(implemented.includes(e.pkg), `implementedPieces must name ${e.pkg}`);
    assert.ok(implemented.includes(e.pr), `implementedPieces must cite ${e.pkg} PR ${e.pr}`);
    assert.ok(implemented.includes(e.ciRun), `implementedPieces must cite the ${e.pr} CI run ${e.ciRun}`);
    assert.ok(implemented.includes(e.frozenTestPath), `implementedPieces must cite ${e.pkg} frozen test ${e.frozenTestPath}`);

    const manifestFile = path.join(repoRoot, e.manifest);
    assert.ok(existsSync(manifestFile), `${e.pkg} manifest ${e.manifest} must exist as frozen evidence`);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.frozenTestPath, e.frozenTestPath, `${e.pkg} manifest frozenTestPath mismatch`);
    assert.equal(manifest.frozenTestSha256, e.frozenTestSha256, `${e.pkg} manifest frozenTestSha256 mismatch`);
    assert.ok(existsSync(path.join(repoRoot, e.frozenTestPath)), `${e.pkg} frozen test ${e.frozenTestPath} must exist`);
    assert.equal(sha256File(e.frozenTestPath), e.frozenTestSha256,
      `${e.pkg} frozen test ${e.frozenTestPath} has drifted from its manifest SHA-256`);
  }
});

test('P22C-3: currentTruth names the delivered P22 substance, not only the sub-package labels, and keeps P21 and P20 named', () => {
  const implemented = loadRoadmap().currentTruth.implementedPieces.join(' | ');
  for (const [term, label] of [
    [/--config-file/, 'P22A1 config-file argv boundary'],
    [/--database-url-file/, 'P22A1 database-url-file argv boundary'],
    [/host\/deploy\/secret_file_runner\.mjs/, 'P22A1 secret-file runner'],
    [/host\/deploy\/Dockerfile/, 'P22A2 deploy Dockerfile'],
    [/digest.?pin/i, 'P22A2 digest-pinned base'],
    [/npm ci/, 'P22A2 lock-only npm ci install'],
    [/uvicorn/i, 'P22A2 selected host server'],
    [/0\.40\.0/, 'P22A2 uvicorn 0.40.0'],
    [/hash.?lock/i, 'P22A2 hash-locked requirement set'],
    [/PostgreSQL 16\.15/, 'P22B1 pinned real PostgreSQL 16.15'],
    [/0003_policy_decision_log/, 'P22B1 migration head'],
    [/mfk_migration/, 'P22B1 migration role'],
    [/mfk_runtime/, 'P22B1 NOBYPASSRLS runtime role'],
    [/--read-only/, 'P22B1 read-only container filesystem'],
    [/--cap-drop ALL/, 'P22B1 dropped capabilities'],
    [/no-new-privileges/, 'P22B1 no-new-privileges'],
    [/no published port|publishes no port|unpublished|no port is published/i, 'P22B1 no published port'],
    [/POST \/customers/, 'P22B2 live business write route'],
    [/\b201\b/, 'P22B2 201 response'],
    [/COMMITTED/, 'P22B2 committed outcome'],
    [/CommitReceipt/, 'P22B2 commit receipt'],
    [/exactly one|one row/i, 'P22B2 exactly-one row counts'],
    [/customer_records/, 'P22B2 single customer_records row'],
    [/audit_log/, 'P22B2 single audit_log row'],
    [/transactional_outbox/, 'P22B2 single transactional_outbox row'],
    [/genesis/i, 'P22B2 independently recomputed decision genesis'],
    [/policy_decision_log/, 'P22B2 decision chain'],
    [/\b403\b/, 'P22B2 cross-tenant refusal status'],
    [/CROSS_TENANT_DENY/, 'P22B2 cross-tenant deny reason'],
    [/P21/, 'P21 security closure must remain named'],
    [/P20/, 'P20 performance baseline must remain named'],
  ]) {
    assert.match(implemented, term, `implementedPieces missing ${label}`);
  }
});

test('P22C-4: the stale P22 missing claim, the P22-P25 range and the unqualified no-host-server denial are retired, while P23, P24 and P25 stay named as missing', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;
  const missing = t.notImplementedPieces.join(' | ');
  const truthText = currentTruthText(t);

  assert.doesNotMatch(missing, /no deployable package/i,
    'the P22 missing claim is retired: a deployable package exists and was proven live');
  assert.doesNotMatch(missing, /no deploy or staging run exists yet/i,
    'the P22 missing claim is retired: a live audited run of the frozen artifact exists');

  assert.doesNotMatch(truthText, STALE_P22_PROOF_RANGE, 'the P22-P25 range claim is stale once P22 closes');
  assert.doesNotMatch(JSON.stringify(doc.ownerFacing), STALE_P22_PROOF_RANGE);
  assert.match(missing, REMAINING_PROOF_RANGE, 'the remaining production-proof range is P23-P25');

  // ROADMAP.md and README.md carry no historical range claim, so they are checked whole.
  assert.doesNotMatch(readText('ROADMAP.md'), STALE_P22_PROOF_RANGE);
  assert.doesNotMatch(readText('README.md'), STALE_P22_PROOF_RANGE);
  assert.doesNotMatch(changelogNewestEntry(), STALE_P22_PROOF_RANGE);

  for (const [term, label] of [
    [/P23/, 'P23 HA/DR/upgrade rollback still missing'],
    [/HA\/DR|upgrade rollback/i, 'P23 substance still missing'],
    [/P24/, 'P24 external consumer proof still missing'],
    [/consumer teams|external proof/i, 'P24 substance still missing'],
    [/P25/, 'P25 promotion gates still missing'],
    [/promotion gate/i, 'P25 substance still missing'],
    [/production proof/i, 'production proof still missing'],
  ]) {
    assert.match(missing, term, `notImplementedPieces missing ${label}`);
  }

  // The deploy artifact does select Uvicorn 0.40.0 and does start a listener, inside an
  // ephemeral environment only, so the unqualified denial is no longer true anywhere in
  // currentTruth. What stays missing is hosted live entrypoint/host wiring for real traffic.
  assert.doesNotMatch(truthText, /no host server is selected/i,
    'the unqualified "no host server is selected" denial must be replaced by the qualified truth');
  assert.match(missing, /live entrypoint\/host wiring/i,
    'live entrypoint/host wiring for real hosted traffic stays named as missing');
});

test('P22C-5: notImplementedPieces carries the explicit P22 residuals, the sub-package manifests still record no staging environment and no staging run, and every P21 residual stays asserted', () => {
  const doc = loadRoadmap();
  const missing = doc.currentTruth.notImplementedPieces.join(' | ');

  for (const [term, label] of [
    [/ephemeral/i, 'the environment is ephemeral'],
    [/deletes itself|deleted itself|removed before the run exits/i, 'the environment deletes itself'],
    [/per-run image tag/i, 'the per-run image tag is removed'],
    [/temporary host secret director/i, 'the temporary host secret directory is removed'],
    [/no staging environment exists/i, 'no staging environment exists'],
    [/no staging run/i, 'no staging run was performed'],
    [/registry/i, 'no registry is contacted or pushed to'],
    [/local build cache/i, 'the image exists only in a local build cache'],
    [/no external deployment/i, 'no external deployment or promotion'],
    [/production host/i, 'no production host selection'],
    [/releasable|production-ready/i, 'nothing here makes the artifact releasable or production-ready'],
    [/proven once|works once|once, sequentially/i, 'proven once, sequentially'],
    [/restart/i, 'no restart proof'],
    [/durabilit/i, 'no durability proof'],
    [/concurrency/i, 'no concurrency proof'],
    [/sustained.?load/i, 'no sustained-load proof'],
    [/noisy.?neighbor/i, 'no noisy-neighbor proof'],
    [/monitor/i, 'no monitoring'],
    [/superuser/i, 'the verification reads run as the database superuser'],
    [/row-level security|RLS/, 'the verification reads bypass RLS'],
    [/read path/i, 'the verification reads are not the application own read path'],
    [/no authentication/i, 'no authentication anywhere in the path'],
    [/session/i, 'no session'],
    [/token/i, 'no token'],
    [/claims a test process makes|identity headers/i, 'the identity headers are claims a test process makes'],
    [/mounted config file/i, 'the trusted principal is a mounted config file'],
    [/--audit on/, 'the audit is still opt-in and default-off'],
    [/docker/i, 'Docker is a hard requirement'],
    [/daemon/i, 'the proof reruns only where a daemon exists'],
    [/security update/i, 'digest pins freeze security updates along with versions'],
    [/amd64/, 'amd64 is a different artifact'],
    [/arm64/, 'arm64 is a different artifact'],
    [/byte.?reproducible/i, 'output digests are not byte-reproducible between rebuilds'],
    [/mount permission/i, 'mount permissions are a deployment-time responsibility'],
    [/rotation/i, 'credential rotation is a deployment-time responsibility'],
    [/deployment.?time/i, 'deployment-time responsibilities outside this package'],
    [/orchestration/i, 'no orchestration'],
    [/ingress/i, 'no ingress'],
    [/TLS/, 'no TLS'],
    [/DNS/, 'no DNS'],
    [/load balancer/i, 'no load balancer'],
    [/secret store/i, 'no secret store'],
    [/rollout|rollback drill/i, 'no rollout/rollback drill'],
  ]) {
    assert.match(missing, term, `notImplementedPieces missing P22 residual: ${label}`);
  }

  // Read-back evidence: the merged sub-packages themselves still record no staging.
  for (const e of P22_DEPLOY_EVIDENCE) {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, e.manifest), 'utf8'));
    assert.equal(manifest.readinessFlags.stagingEnvironmentExists, false,
      `${e.pkg} must still record stagingEnvironmentExists=false`);
    assert.equal(manifest.readinessFlags.stagingRunPerformed, false,
      `${e.pkg} must still record stagingRunPerformed=false`);
  }

  // Regression: the P21 residuals asserted at base are never dropped by this closure.
  for (const [term, label] of [
    [/opt-in|default(-| )off/i, 'the audit is opt-in and default-off'],
    [/login/i, 'no real login surface'],
    [/managed policy/i, 'no managed policy source'],
    [/Git history/i, 'the Git history is unscanned'],
    [/detector/i, 'the secret-scan detector blind spot'],
    [/advisory databas|moving floor/i, 'the advisory blind spot'],
    [/omit=dev|development-only depend|dev depend/i, 'the npm development-dependency blind spot'],
    [/branch.?protection/i, 'the scan is not a required branch-protection context'],
    [/DAST|dynamic application security testing/i, 'no DAST'],
    [/Actionplan/i, 'no Actionplan node writeback'],
    [/writeback|write-back|write back/i, 'no Actionplan node writeback'],
  ]) {
    assert.match(missing, term, `notImplementedPieces dropped P21 residual: ${label}`);
  }
});

test('P22C-6: closing P22 moves no readiness flag - deployAllowed and productionAllowed stay false by name - and the owner-facing fields declare the ephemeral live audited write without a runnable claim', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;

  for (const key of STRONGER_READINESS_FLAGS) {
    assert.equal(t[key], false, `${key} must remain false`);
  }
  assert.equal(t.deployAllowed, false, 'closing a package named "deploy" is not deploy authority');
  assert.equal(t.productionAllowed, false, 'closing a package named "deploy" is not production authority');

  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].trim().length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, P22C_CAPABILITY_DELTA);
  assert.equal(o.calistirilabilirlik, P22C_CALISTIRILABILIRLIK);

  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /22\/25/);
  assert.match(ownerText, /P23/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /live entrypoint|hosted/i,
    'the not-runnable claim still names the missing hosted/live entrypoint');
  assert.match(t.notRunnableProductClaim, REMAINING_PROOF_RANGE,
    'the not-runnable claim ends at the remaining P23-P25 range');
});

test('P22C-7: ROADMAP.md, README.md and the newest CHANGELOG entry project 22/25 with the full P22 evidence and no runnable, deploy-authority, staging or merge-blocking overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  const readme = readText('README.md');
  const newestEntry = changelogNewestEntry();

  for (const [name, text] of [['ROADMAP.md', roadmap], ['README.md', readme], ['the newest CHANGELOG entry', newestEntry]]) {
    assert.ok(text.includes(P22C_STATUS_LINE), `${name} must project '${P22C_STATUS_LINE}'`);
  }

  for (const e of P22_DEPLOY_EVIDENCE) {
    assert.ok(newestEntry.includes(e.pr), `the newest CHANGELOG entry must cite ${e.pkg} PR ${e.pr}`);
    assert.ok(newestEntry.includes(e.ciRun), `the newest CHANGELOG entry must cite the ${e.pr} CI run ${e.ciRun}`);
  }
  assert.match(newestEntry, /host\/deploy\/Dockerfile/, 'the newest CHANGELOG entry must name the deploy Dockerfile');
  assert.match(newestEntry, /secret[- ]file/i, 'the newest CHANGELOG entry must name the mounted secret-file boundary');
  assert.match(newestEntry, /mount/i, 'the newest CHANGELOG entry must name the mounted secret-file boundary');
  assert.ok(newestEntry.includes(P22C_CLOSURE_MANIFEST), `the newest CHANGELOG entry must reference ${P22C_CLOSURE_MANIFEST}`);
  assert.match(newestEntry, /roadmap-v1-current-truth\.json/, 'the newest CHANGELOG entry must reference the sole machine-readable source');
  assert.ok(existsSync(path.join(repoRoot, P22C_CLOSURE_MANIFEST)), `${P22C_CLOSURE_MANIFEST} must exist, not be a dangling reference`);

  for (const [name, text] of [['ROADMAP.md', roadmap], ['README.md', readme], ['the newest CHANGELOG entry', newestEntry]]) {
    for (const [pattern, label] of OVERCLAIM_PATTERNS) {
      assert.doesNotMatch(text, pattern, `${name} must not carry ${label}`);
    }
  }
});
