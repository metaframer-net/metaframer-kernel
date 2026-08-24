import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  for (const term of ['Domain', 'Application', 'Adapters', 'Delivery', 'CreateCustomer', 'SDK', 'ASGI', 'Python host', 'PostgreSQL']) {
    assert.match(exists, new RegExp(term), `implementedPieces missing ${term}`);
  }
  const missing = t.notImplementedPieces.join(' | ');
  for (const term of ['generic contract-to-SDK', 'app-core', 'policy-as-data', 'outbox relay', 'production proof']) {
    assert.match(missing, new RegExp(term), `notImplementedPieces missing ${term}`);
  }
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

test('owner-facing fields declare capability_delta NONE and not-runnable', () => {
  const doc = loadRoadmap();
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, 'NONE');
  assert.equal(o.calistirilabilirlik, 'not-runnable');
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
