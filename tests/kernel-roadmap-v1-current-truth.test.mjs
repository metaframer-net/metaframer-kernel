import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.match(missing, /P20-P25|P20–P25/);
  assert.doesNotMatch(missing, /P19-P25|P19–P25/);
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

test('owner-facing fields declare capability_delta OUTBOX_RELAY_OBSERVED_SLO_SINGLE_PASS, hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, 'OUTBOX_RELAY_OBSERVED_SLO_SINGLE_PASS');
  assert.equal(o.calistirilabilirlik, 'outbox-relay-observed-slo-single-pass-hosted-product-not-runnable');
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /hosted/i);
  assert.match(ownerText, /not-runnable|calismaz|calismiyor/i);
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

test('roadmap.progress carries the exact 19/25 completed truth with P19 closed and P20 active', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');
  assert.equal(progress.completed, 19);
  assert.equal(progress.total, 25);
  assert.deepEqual([...progress.completedPackages].sort(), ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19']);
  assert.equal(progress.completedPackages.length, progress.completed);
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length);
  assert.equal(progress.activePackage, 'P20');
  assert.equal(progress.asOfKernelMain, '9f821251a36a9bf2633236dfde67676f70d3cf05');
  assert.equal(progress.statusLine, '19/25 tamamlandı, P20/25 aktif');

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

test('currentTruth reflects P19 (observability/SLO) as implemented, anchored to real merged PR #124 evidence, and P20 (performance) as the explicit next-missing piece, with P21-P25 proof also missing, all readiness flags false, and hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;

  const implemented = t.implementedPieces.join(' | ');
  assert.match(implemented, /outbox_relay\.batch_completed/);
  assert.match(implemented, /structured (?:JSON )?outbox_relay\.batch_completed event/i);
  assert.match(implemented, /duration.*failure.?rate|failure.?rate.*duration/i);
  assert.match(implemented, /SLO/);
  assert.match(implemented, /#124/);
  assert.match(implemented, /32970268485/);
  assert.match(implemented, /P19/);

  const missing = t.notImplementedPieces.join(' | ');
  assert.doesNotMatch(missing, /\(P19\)/);
  assert.doesNotMatch(missing, /\bobservability\/SLO\b/i);
  assert.match(missing, /exporter|dashboard|alert transport|scheduler|DLQ|live host/i);
  assert.match(missing, /P20/);
  assert.match(missing, /production proof/i);
  assert.match(missing, /P20-P25|P20–P25/);

  const relayTestFile = path.join(repoRoot, 'db', 'tests', 'test_outbox_relay_observability_slo.py');
  assert.ok(existsSync(relayTestFile), 'db/tests/test_outbox_relay_observability_slo.py must exist as P19 frozen evidence');

  const frozenTestSource = readFileSync(relayTestFile, 'utf8');
  const frozenTestCount = (frozenTestSource.match(/^def test_/gm) || []).length;
  assert.equal(frozenTestCount, 3, 'P19 frozen test file must carry exactly 3 real PostgreSQL test_ scenarios');
  assert.match(frozenTestSource, /outbox_relay\.batch_completed/);

  for (const key of ['kernelReady', 'sdkReady', 'appBuildable', 'releaseAllowed', 'deployAllowed', 'productionAllowed', 'gapClosed', 'oneGoldenSliceReady', 'runnableProduct']) {
    assert.equal(t[key], false, `${key} must remain false`);
  }

  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, 'OUTBOX_RELAY_OBSERVED_SLO_SINGLE_PASS');
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /19\/25/);
  assert.match(ownerText, /P20/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.doesNotMatch(t.notRunnableProductClaim, /(?<!\bNo\b[^.]{0,80})\bis runnable end-to-end\b/i);
  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /exporter|dashboard|alert transport|scheduler|DLQ|live host/i);
});

test('ROADMAP.md, README.md and CHANGELOG.md project P19 closed / P20 active, with no runnable or readiness overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  assert.match(roadmap, /19\/25 tamamlandı, P20\/25 aktif/);
  assert.match(roadmap, /P19/);
  assert.match(roadmap, /P20/);
  assert.doesNotMatch(roadmap, /\bis runnable\b/i);

  const readme = readText('README.md');
  assert.match(readme, /19\/25 tamamlandı, P20\/25 aktif/);
  assert.doesNotMatch(readme, /\bis runnable\b/i);

  const changelog = readText('CHANGELOG.md');
  const unreleasedIdx = changelog.indexOf('## [Unreleased]');
  const unreleased = changelog.slice(unreleasedIdx);
  assert.match(unreleased, /P19/);
  assert.match(unreleased, /#124/);
  assert.match(unreleased, /32970268485/);
  assert.match(unreleased, /roadmap-v1-current-truth\.json/);
  assert.match(unreleased, /19\/25 tamamlandı, P20\/25 aktif/);
  assert.doesNotMatch(unreleased, /\bis runnable\b/i);
});
