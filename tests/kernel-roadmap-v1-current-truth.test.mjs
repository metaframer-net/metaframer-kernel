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
  assert.match(missing, /P22-P25|P22–P25/);
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

test('owner-facing fields declare capability_delta KERNEL_BOUNDARY_SECURITY_AUDIT_AND_SUPPLY_CHAIN_GATE at 21/25 with P22 active, hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, 'KERNEL_BOUNDARY_SECURITY_AUDIT_AND_SUPPLY_CHAIN_GATE');
  assert.equal(o.calistirilabilirlik, 'kernel-boundary-security-audited-hosted-product-not-runnable');
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /21\/25/);
  assert.match(ownerText, /P22/);
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

test('roadmap.progress carries the exact 21/25 completed truth with P21 closed and P22 active', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');
  assert.equal(progress.completed, 21);
  assert.equal(progress.total, 25);
  assert.deepEqual([...progress.completedPackages].sort(), ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21']);
  assert.equal(progress.completedPackages.length, progress.completed);
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length);
  assert.equal(progress.activePackage, 'P22');
  assert.equal(progress.asOfKernelMain, 'cc86cf6385d9c66ef50e72c10618c6f496e71732');
  assert.equal(progress.statusLine, '21/25 tamamlandı, P22/25 aktif');

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

test('currentTruth reflects P21 (security) as implemented through the merged P21A-G evidence bound to its frozen manifests, with P22-P25 production proof still missing, all readiness flags false, and hosted SaaS still not-runnable', () => {
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
  assert.match(missing, /P22-P25|P22–P25/, 'the remaining production-proof range is P22-P25');
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
  assert.equal(o.capability_delta, 'KERNEL_BOUNDARY_SECURITY_AUDIT_AND_SUPPLY_CHAIN_GATE');
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /21\/25/);
  assert.match(ownerText, /P22/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.doesNotMatch(t.notRunnableProductClaim, /(?<!\bNo\b[^.]{0,80})\bis runnable end-to-end\b/i);
  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /no host server is selected|live host|listener|live entrypoint/i);
  assert.match(t.notRunnableProductClaim, /P22-P25|P22–P25/);
});

test('ROADMAP.md, README.md and CHANGELOG.md project P21 closed / P22 active, with no runnable, readiness or merge-blocking overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  assert.match(roadmap, /21\/25 tamamlandı, P22\/25 aktif/);
  assert.match(roadmap, /P21/);
  assert.match(roadmap, /P22/);
  assert.doesNotMatch(roadmap, /\bis runnable\b/i);

  const readme = readText('README.md');
  assert.match(readme, /21\/25 tamamlandı, P22\/25 aktif/);
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
