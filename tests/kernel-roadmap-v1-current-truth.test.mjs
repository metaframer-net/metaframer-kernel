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

// P23D shared constants: this closure advances the single counter from 22/25 to 23/25, and every
// counter-bound assertion in this file reads them, so the counter, the capability delta and the
// remaining-proof range cannot drift apart. P22C_* below is preserved history, not a stale alias.

const P23D_COMPLETED = 23;
const P23D_TOTAL = 25;
const P23D_COMPLETED_PACKAGES = Array.from({ length: P23D_COMPLETED }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
const P23D_ACTIVE_PACKAGE = 'P24';
const P23D_AS_OF_KERNEL_MAIN = 'c5f7e210f4f896ce606b351333bf9c08d49840f1';
const P23D_STATUS_LINE = '23/25 tamamlandı, P24/25 aktif';
const P23D_CAPABILITY_DELTA = 'MANUAL_EPHEMERAL_RECOVERY_FAILOVER_AND_MIGRATION_ROLLBACK_DRILLED';
const P23D_CALISTIRILABILIRLIK = 'manual-ephemeral-dr-failover-and-migration-rollback-drilled-hosted-product-not-runnable';
const P23D_CLOSURE_MANIFEST = 'planning/kernel-p23-current-truth-closure-p23d.json';

// Preserved history from the closure this one supersedes.
const P22C_STATUS_LINE = '22/25 tamamlandı, P23/25 aktif';
const P22C_CLOSURE_MANIFEST = 'planning/kernel-p22-current-truth-closure-p22c.json';

// The production-proof range that remains once P23 closes, and the two stale ranges it replaces.
const REMAINING_PROOF_RANGE = /P24-P25|P24–P25/;
const STALE_P22_PROOF_RANGE = /P22-P25|P22–P25/;
const STALE_P23_PROOF_RANGE = /P23-P25|P23–P25/;

// The nine stronger readiness flags. Neither P22C nor P23D introduces a new true flag into
// currentTruth: closing a package named "deploy" is not deploy authority, and closing a package
// named "HA/DR/upgrade rollback" is neither high availability nor a disaster-recovery plan.
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

// P23A-P23C merged HA/DR/upgrade-rollback evidence: sub-package -> pull request, the merge commit
// it produced on main, the base it was cut from, the ci.yml and Security runs on that merge, its
// manifest, and the two files that manifest froze by SHA-256. `probeBy` is the second, independent
// witness for the probe hash - the NEXT package's preservedHashes, or 'self' for the one manifest
// that carries its own probeSha256 - so a probe cannot be edited after the fact without
// contradicting a record its author did not write.
const P23_EVIDENCE = [
  { pkg: 'P23A', pr: '#141', merge: '738a42511ff62481e5a92e9a6e4ed2a78b666d34', base: 'aa15580462d6d261e693c0c617fcac15f75be593',
    ci: '33072032144', sec: '33072032056', manifest: 'planning/kernel-disaster-recovery-backup-restore-p23a.json',
    test: 'tests/kernel-disaster-recovery-backup-restore-p23a.test.mjs', testSha: 'b59540ee938eac8fc18e2acd25fe98a000c231525351f73814ef347436d51d43',
    probe: 'tests/_harness/live-recovery-probe.mjs', probeSha: 'e13a0e5be9fc4066c74fb8dbc11279c1e72a2359287195865db1f08ee834c63b',
    probeBy: 'planning/kernel-high-availability-standby-failover-p23b.json' },
  { pkg: 'P23B', pr: '#142', merge: '8cf90a6ec7cef16e0b65050bed8199c1b56049c6', base: '738a42511ff62481e5a92e9a6e4ed2a78b666d34',
    ci: '33081640429', sec: '33081640670', manifest: 'planning/kernel-high-availability-standby-failover-p23b.json',
    test: 'tests/kernel-high-availability-standby-failover-p23b.test.mjs', testSha: '4706927aa718a58980f2944768d5b52bf003f9a6ed039190efac76acd76d689e',
    probe: 'tests/_harness/live-standby-failover-probe.mjs', probeSha: '3bef68f7e35c530404025678c48fc47ec3c29a501a6f66ea231d833b5d26cf23',
    probeBy: 'planning/kernel-migration-rollback-p23c.json' },
  { pkg: 'P23C', pr: '#143', merge: 'c5f7e210f4f896ce606b351333bf9c08d49840f1', base: '8cf90a6ec7cef16e0b65050bed8199c1b56049c6',
    ci: '33152068364', sec: '33152068502', manifest: 'planning/kernel-migration-rollback-p23c.json',
    test: 'tests/kernel-migration-rollback-p23c.test.mjs', testSha: '547b0561eae2bd215887701d21f66e048a59241d678e4dc02527afe9d70e6c90',
    probe: 'tests/_harness/live-migration-rollback-probe.mjs', probeSha: 'da5d822cfbd4a5de29f786d5e78724dfd884ef5b0e8390a76898cd7e09846d94',
    probeBy: 'self' },
];

// Flags every merged P23 manifest must still record false; the second list is checked only where a
// manifest declares it, because a package that never made the claim does not have to deny it.
const P23_FALSE_FLAGS = ['highAvailabilityProven', 'pointInTimeRecoveryProven', 'offsiteBackupExists',
  'automatedBackupScheduleExists', 'recoveryObjectivesAgreed', 'stagingEnvironmentExists', 'stagingRunPerformed',
  'productionHostSelected', 'registryPushed', 'externalDeploymentPerformed', 'p23Complete'];
const P23_FALSE_IF_DECLARED = ['automaticFailoverProven', 'splitBrainProtectionProven', 'synchronousReplicationProven',
  'zeroDowntimeMigrationProven', 'backwardCompatibleMigrationProven', 'dataMigrationRollbackProven', 'disasterRecoveryPlanExists'];

// P23C's manifest tells the owner the maintenance-window refusal shows neither the password nor the
// missing table's name. Only the first half is proven: the unchanged bridge answers a generic
// subprocess_failed 502 built from the runner's raw stderr. Affirmative shapes only, so an accurate
// negated sentence still passes. Turkish carries the claim in two shapes: a negative verb
// ("gostermiyor", "gizliyor"), and the paired "ne ... ne de ..." frame, which negates a POSITIVE
// verb - "ne parolayi ne de eksik tablonun adini gosteriyor" asserts the hiding just as strongly.
// The frozen P23C sentence uses the second, so a negative-verb-only guard would read it as honest.
const TABLE_NAME_HIDING = [
  /(?<!\b(?:not|never|no|neither|nor)\b[^.]{0,40})\b(hides?|hid|conceals?|masks?|redacts?|suppresses?)\b[^.]{0,60}\btable(?:'s)? name\b/i,
  /\b(does not|do not|never)\s+(show|reveal|disclose|expose|leak|include|contain|carry|name)\b[^.]{0,60}\btable(?:'s)? name\b/i,
  /tablo(?:nun)?\s+ad[\u0131i]n[\u0131i][^.]{0,60}(g[o\u00f6]stermiyor|gizliyor|sakl[\u0131i]yor|a[c\u00e7][\u0131i]klam[\u0131i]yor)|\bne\b(?=[^.]{0,120}\bne de\b)[^.]{0,120}tablo(?:nun)?\s+ad[\u0131i]n[\u0131i][^.]{0,60}(g[o\u00f6]steriyor|gizliyor|sakl[\u0131i]yor|a[c\u00e7][\u0131i]kl[\u0131i]yor)/i,
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
  // P23-specific overclaims. Every pattern is a positive claim shape, so the honest denials this
  // closure must carry ("no high availability exists", "no automatic failover", "no zero-downtime
  // migration and no online migration", "no RPO and no RTO is agreed") do not trip them.
  [/(?<!\bno\s)\bhigh availability (exists|is (proven|achieved|in place|ready))\b/i, 'a high-availability claim'],
  [/(?<!\bno\s)\bautomatic failover (exists|is (proven|implemented|configured|available))\b/i, 'an automatic-failover claim'],
  [/(?<!\bno\s)\bpoint[- ]in[- ]time recovery (exists|is (proven|available|configured|supported))\b/i, 'a point-in-time-recovery claim'],
  [/(?<!\bno\s)\bzero[- ]downtime\b[^.]{0,60}\b(is|was) (?!not\b)(proven|achieved|supported|guaranteed)\b/i, 'a zero-downtime claim'],
  [/(?<!\bno\s)\b(RPO|RTO)\b[^.]{0,60}\b(is|are|was|were) (?!not\b)(agreed|met|guaranteed|measured)\b/i, 'an agreed recovery-objective claim'],
  [/(?<!\bno\s)\bdisaster[- ]recovery plan (exists|is in place)\b/i, 'a disaster-recovery-plan claim'],
  [/(?<!\bno\s)\bbackups? (are|is) (scheduled|automated|monitored)\b/i, 'a backup-schedule claim'],
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

// The Unreleased section is cumulative: every earlier closure bullet stays as written history, stale
// ranges included, so each closure is held only to the slice above the first preserved bullet below it.
function changelogSince(marker) {
  const unreleased = changelogUnreleased();
  const idx = unreleased.indexOf(marker);
  assert.ok(idx >= 0, `the preserved ${marker.trim()} Unreleased bullet must delimit the newer CHANGELOG slice`);
  return unreleased.slice(0, idx);
}
const changelogP22cAndNewer = () => changelogSince('- P21h ');
const changelogNewestEntry = () => changelogSince('- P22c ');

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

test('owner-facing fields declare the current capability_delta at 23/25 with P24 active, hosted SaaS still not-runnable', () => {
  const doc = loadRoadmap();
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, P23D_CAPABILITY_DELTA);
  assert.equal(o.calistirilabilirlik, P23D_CALISTIRILABILIRLIK);
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /23\/25/);
  assert.match(ownerText, /P24/);
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

test('roadmap.progress carries the exact 23/25 completed truth with P23 closed and P24 active', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');
  assert.equal(progress.completed, P23D_COMPLETED);
  assert.equal(progress.total, P23D_TOTAL);
  assert.deepEqual([...progress.completedPackages].sort(), [...P23D_COMPLETED_PACKAGES].sort());
  assert.equal(progress.completedPackages.length, progress.completed);
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length);
  assert.equal(progress.activePackage, P23D_ACTIVE_PACKAGE);
  assert.equal(progress.asOfKernelMain, P23D_AS_OF_KERNEL_MAIN);
  assert.equal(progress.statusLine, P23D_STATUS_LINE);

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

test('currentTruth reflects P21 (security) as implemented through the merged P21A-G evidence bound to its frozen manifests, with P24-P25 production proof still missing, all readiness flags false, and hosted SaaS still not-runnable', () => {
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
  assert.match(missing, REMAINING_PROOF_RANGE, 'the remaining production-proof range is P24-P25');
  for (const [term, label] of [
    // P22's and P23's own residuals keep the deploy/staging and recovery vocabulary alive here;
    // the closed-package claims themselves are retired by P22C-4 and P23D-4.
    [/deploy package|staging/i, 'P22 deploy package/staging residual vocabulary'],
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
  assert.equal(o.capability_delta, P23D_CAPABILITY_DELTA);
  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /23\/25/);
  assert.match(ownerText, /P24/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.doesNotMatch(t.notRunnableProductClaim, /(?<!\bNo\b[^.]{0,80})\bis runnable end-to-end\b/i);
  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /no host server is selected|live host|listener|live entrypoint/i);
  assert.match(t.notRunnableProductClaim, REMAINING_PROOF_RANGE);
});

test('ROADMAP.md projects the current status line while README.md and CHANGELOG.md preserve the P21A-G closure evidence, with no runnable, readiness or merge-blocking overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  assert.ok(roadmap.includes(P23D_STATUS_LINE), 'ROADMAP.md must project the current status line');
  assert.ok(!roadmap.includes(P22C_STATUS_LINE), 'ROADMAP.md projects exactly one counter, so the 22/25 line is gone');
  assert.match(roadmap, /P21/);
  assert.match(roadmap, /P22/);
  assert.doesNotMatch(roadmap, /\bis runnable\b/i);

  const readme = readText('README.md');
  assert.ok(readme.includes(P23D_STATUS_LINE), 'README.md must project the current status line');
  assert.ok(readme.includes(P22C_STATUS_LINE), 'README.md is cumulative: the 22/25 paragraph stays as written history');
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
// Seven scenarios, preserved through the P23D closure. Their P22-specific
// substance - the merged sub-package evidence, the delivered deploy substance,
// the retired stale claims and the explicit deploy residuals - is unchanged
// written proof and stays asserted here forever. Only the parts that were
// counter-bound have moved onto the P23D constants, because the counter this
// file owns is single and now reads 23/25.
// ===========================================================================

test('P22C-1 (preserved at 23/25): P22 stays completed inside the single counter, the P23->P22 DAG edge is unchanged, and every dependency of a completed or active package is itself completed', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');

  assert.equal(progress.completed, P23D_COMPLETED);
  assert.equal(progress.total, P23D_TOTAL);
  assert.equal(doc.roadmap.denominator, P23D_TOTAL, 'the fixed 25-package denominator never moves');

  assert.deepEqual([...progress.completedPackages].sort(), [...P23D_COMPLETED_PACKAGES].sort(),
    'completedPackages must be exactly P01..P22');
  assert.equal(progress.completedPackages.length, progress.completed,
    'completedPackages length must equal the counter');
  assert.equal(new Set(progress.completedPackages).size, progress.completedPackages.length,
    'completedPackages must be unique');

  assert.equal(progress.activePackage, P23D_ACTIVE_PACKAGE);
  assert.equal(progress.asOfKernelMain, P23D_AS_OF_KERNEL_MAIN);
  assert.equal(progress.statusLine, P23D_STATUS_LINE);

  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  const completedSet = new Set(progress.completedPackages);
  assert.ok(completedSet.has('P22'), 'P22 was closed by P22C and stays closed');
  for (const id of progress.completedPackages) {
    for (const dep of byId[id].dependsOn) {
      assert.ok(completedSet.has(dep), `completed package ${id} depends on incomplete ${dep}`);
    }
  }
  assert.deepEqual([...byId.P23.dependsOn].sort(), ['P22'],
    'P23 depends on P22 and the DAG edge P22C asserted is unchanged');
  for (const dep of byId[P23D_ACTIVE_PACKAGE].dependsOn) {
    assert.ok(completedSet.has(dep), `active package ${P23D_ACTIVE_PACKAGE} depends on incomplete ${dep}`);
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

test('P22C-4 (preserved at 23/25): the stale P22 missing claim, the P22-P25 range and the unqualified no-host-server denial stay retired, while P24 and P25 stay named as missing', () => {
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
  assert.match(missing, REMAINING_PROOF_RANGE, 'the remaining production-proof range is P24-P25');

  // ROADMAP.md and README.md carry no historical range claim, so they are checked whole.
  assert.doesNotMatch(readText('ROADMAP.md'), STALE_P22_PROOF_RANGE);
  assert.doesNotMatch(readText('README.md'), STALE_P22_PROOF_RANGE);
  assert.doesNotMatch(changelogP22cAndNewer(), STALE_P22_PROOF_RANGE);

  for (const [term, label] of [
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

test('P22C-6 (preserved at 23/25): closing P22 moved no readiness flag - deployAllowed and productionAllowed stay false by name - and the owner-facing fields still carry the five plain-Turkish fields with no runnable claim', () => {
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
  assert.equal(o.capability_delta, P23D_CAPABILITY_DELTA);
  assert.equal(o.calistirilabilirlik, P23D_CALISTIRILABILIRLIK);

  const ownerText = JSON.stringify(o);
  assert.match(ownerText, /23\/25/);
  assert.match(ownerText, /P24/);
  assert.match(ownerText, /hosted/i);
  assert.doesNotMatch(ownerText, /\bis runnable\b/i);

  assert.match(t.notRunnableProductClaim, /No SaaS user journey.*runnable end-to-end/is);
  assert.match(t.notRunnableProductClaim, /live entrypoint|hosted/i,
    'the not-runnable claim still names the missing hosted/live entrypoint');
  assert.match(t.notRunnableProductClaim, REMAINING_PROOF_RANGE,
    'the not-runnable claim ends at the remaining P24-P25 range');
});

test('P22C-7 (preserved at 23/25): README.md and the preserved P22c CHANGELOG entry still carry the full P22 evidence and its closure manifest, with no runnable, deploy-authority, staging or merge-blocking overclaim', () => {
  const roadmap = readText('ROADMAP.md');
  const readme = readText('README.md');
  const newestEntry = changelogP22cAndNewer();

  // ROADMAP.md projects only the current counter; the cumulative README and CHANGELOG keep P22C's line.
  assert.ok(roadmap.includes(P23D_STATUS_LINE), `ROADMAP.md must project '${P23D_STATUS_LINE}'`);
  for (const [name, text] of [['README.md', readme], ['the preserved P22c CHANGELOG entry', newestEntry]]) {
    assert.ok(text.includes(P22C_STATUS_LINE), `${name} must preserve '${P22C_STATUS_LINE}'`);
  }

  for (const e of P22_DEPLOY_EVIDENCE) {
    assert.ok(newestEntry.includes(e.pr), `the preserved P22c CHANGELOG entry must cite ${e.pkg} PR ${e.pr}`);
    assert.ok(newestEntry.includes(e.ciRun), `the preserved P22c CHANGELOG entry must cite the ${e.pr} CI run ${e.ciRun}`);
  }
  assert.match(newestEntry, /host\/deploy\/Dockerfile/, 'the preserved P22c CHANGELOG entry must name the deploy Dockerfile');
  assert.match(newestEntry, /secret[- ]file/i, 'the preserved P22c CHANGELOG entry must name the mounted secret-file boundary');
  assert.match(newestEntry, /mount/i, 'the preserved P22c CHANGELOG entry must name the mounted secret-file boundary');
  assert.ok(newestEntry.includes(P22C_CLOSURE_MANIFEST), `the preserved P22c CHANGELOG entry must reference ${P22C_CLOSURE_MANIFEST}`);
  assert.match(newestEntry, /roadmap-v1-current-truth\.json/, 'the preserved P22c CHANGELOG entry must reference the sole machine-readable source');
  assert.ok(existsSync(path.join(repoRoot, P22C_CLOSURE_MANIFEST)), `${P22C_CLOSURE_MANIFEST} must exist, not be a dangling reference`);

  for (const [name, text] of [['ROADMAP.md', roadmap], ['README.md', readme], ['the preserved P22c CHANGELOG entry', newestEntry]]) {
    for (const [pattern, label] of OVERCLAIM_PATTERNS) {
      assert.doesNotMatch(text, pattern, `${name} must not carry ${label}`);
    }
  }
});

// ===========================================================================
// P23D - current-truth closure for P23 (HA/DR/upgrade rollback). Seven scenarios, each failing at
// base c5f7e210 / tree baaefeb1 and passing only once the non-test allowed files are synced. All
// three merged sub-packages are DRILLS: a lost database restored, a lost node failed over from, a
// bad revision taken back out - each once, by hand, in an environment that deletes itself. None is
// high availability, a DR plan, PITR, a zero-downtime migration or an agreed recovery objective.
// ===========================================================================

const need = (text, patterns, ctx) => { for (const re of patterns) assert.match(text, re, `${ctx} must carry ${re}`); };
const deny = (text, patterns, ctx) => { for (const re of patterns) assert.doesNotMatch(text, re, `${ctx} must not carry ${re}`); };
function readManifest(rel) {
  const file = path.join(repoRoot, rel);
  assert.ok(existsSync(file), `${rel} must exist as frozen evidence`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
const projectionsOf = (doc) => [['currentTruth', currentTruthText(doc.currentTruth)], ['ownerFacing', JSON.stringify(doc.ownerFacing)],
  ['ROADMAP.md', readText('ROADMAP.md')], ['README.md', readText('README.md')], ['the newest CHANGELOG entry', changelogNewestEntry()]];

test('P23D-1: roadmap.progress advances to 23/25 with P23 completed and P24 active, the fixed denominator unmoved, P24 depending only on the already-completed P16, and the three merged sub-package manifests still recording the counter they deliberately did not move', () => {
  const doc = loadRoadmap();
  const progress = doc.roadmap.progress;
  assert.ok(progress, 'roadmap.progress must exist');
  assert.equal(progress.completed, P23D_COMPLETED);
  assert.equal(progress.total, P23D_TOTAL);
  assert.equal(doc.roadmap.denominator, P23D_TOTAL, 'the fixed 25-package denominator never moves');
  assert.deepEqual([...progress.completedPackages].sort(), [...P23D_COMPLETED_PACKAGES].sort(), 'completedPackages must be exactly P01..P23');
  assert.equal(new Set(progress.completedPackages).size, progress.completed, 'completedPackages must be unique and match the counter');
  assert.equal(progress.activePackage, P23D_ACTIVE_PACKAGE);
  assert.equal(progress.asOfKernelMain, P23D_AS_OF_KERNEL_MAIN, 'the counter is read as of the P23C merge, the newest commit on main');
  assert.equal(progress.statusLine, P23D_STATUS_LINE);

  const byId = Object.fromEntries(doc.roadmap.phases.map((p) => [p.id, p]));
  const completed = new Set(progress.completedPackages);
  for (const id of [...progress.completedPackages, P23D_ACTIVE_PACKAGE]) {
    for (const dep of byId[id].dependsOn) assert.ok(completed.has(dep), `${id} depends on incomplete ${dep}`);
  }
  // P24 leaves the F6 enterprise-operations chain entirely: it hangs off P16, not off P23.
  assert.deepEqual([...byId[P23D_ACTIVE_PACKAGE].dependsOn], ['P16'], 'the approved P24 edge is unchanged by this closure');
  assert.equal(byId[P23D_ACTIVE_PACKAGE].family, 'F7', 'the active package moves out of F6 into the external-proof family');

  // None of the three merged sub-packages moved the counter itself; each left the closure to this package.
  for (const e of P23_EVIDENCE) {
    const m = readManifest(e.manifest);
    assert.equal(m.splitEvidence.counter, '22/25', `${e.pkg} froze the counter at 22/25 and never advanced it`);
    assert.equal(m.readinessFlags.p23Complete, false, `${e.pkg} must still record p23Complete=false`);
  }
});

test('P23D-2: currentTruth binds each merged P23 sub-package to its PR, its merge commit, its main ci.yml run and its Security-workflow run, and every manifest-frozen test and probe still hashes to the SHA-256 two independent frozen records agree on', () => {
  const implemented = loadRoadmap().currentTruth.implementedPieces.join(' | ');
  const closure = JSON.stringify(readManifest(P23D_CLOSURE_MANIFEST));
  for (const e of P23_EVIDENCE) {
    for (const v of [e.pkg, e.pr, e.ci, e.sec, e.test, e.probe]) {
      assert.ok(implemented.includes(v), `implementedPieces must cite ${e.pkg} evidence ${v}`);
    }
    for (const v of [e.pkg, e.pr, e.merge, e.ci, e.sec, e.testSha, e.probeSha]) {
      assert.ok(closure.includes(v), `${P23D_CLOSURE_MANIFEST} must record ${e.pkg} evidence ${v}`);
    }
    const m = readManifest(e.manifest);
    assert.equal(m.base, e.base, `${e.pkg} manifest base mismatch`);
    assert.equal(m.frozenTestPath, e.test, `${e.pkg} manifest frozenTestPath mismatch`);
    assert.equal(m.frozenTestSha256, e.testSha, `${e.pkg} manifest frozenTestSha256 mismatch`);
    assert.equal(sha256File(e.test), e.testSha, `${e.pkg} frozen test ${e.test} has drifted from its manifest SHA-256`);
    assert.ok(m.allowedFiles.includes(e.probe), `${e.pkg} must have declared ${e.probe} in its allowed files`);
    assert.equal(sha256File(e.probe), e.probeSha, `${e.pkg} probe ${e.probe} has drifted from the SHA-256 its package froze`);
    const witness = e.probeBy === 'self' ? m.probeSha256 : readManifest(e.probeBy).preservedHashes[e.probe];
    assert.equal(witness, e.probeSha, `${e.probeBy} must independently re-freeze ${e.probe} at the same SHA-256`);
  }
  // The merge order is checkable, not claimed: each package was cut from the commit the previous merged as.
  const [a, b, c] = P23_EVIDENCE;
  assert.equal(b.base, a.merge, 'P23B was cut from the commit P23A merged as');
  assert.equal(c.base, b.merge, 'P23C was cut from the commit P23B merged as');
  assert.equal(c.merge, P23D_AS_OF_KERNEL_MAIN, 'P23C is the merge this counter is read as of');
});

test('P23D-3: currentTruth names the delivered P23 substance - a real verified backup and restore, a real streaming standby and promotion, a real reverse and re-apply of the head revision - and not only the sub-package labels, while P22, P21 and P20 stay named', () => {
  const implemented = loadRoadmap().currentTruth.implementedPieces.join(' | ');
  need(implemented, [/pg_dump|custom[- ]format/i, /sha256|recomputed digest/i, /0600|owner-only/i, /data volume/i, /fails? closed/i,
    /0003_policy_decision_log/, /mfk_migration/, /mfk_runtime/, /forced/i, /prev_hash|chains? onto|one chain/i],
    'implementedPieces (P23A backup, total loss, restore)');
  need(implemented, [/pg_basebackup/i, /system identifier/i, /replication (role|slot)|streams? from/i, /promot/i, /alias/i,
    /never[- ]restarted/i], 'implementedPieces (P23B streaming standby and manual promotion)');
  need(implemented, [/alembic/i, /downgrade|backwards|reverse/i, /0002_customer_records/, /re-?upgrade|re-?appl/i, /append-only/i,
    /new genesis|new chain|fresh genesis/i], 'implementedPieces (P23C rollback and re-upgrade)');
  need(implemented, [/P22/, /P21/, /P20/], 'implementedPieces (earlier closures still named)');
});

test('P23D-4: the stale P23 missing claim and the P23-P25 range are retired everywhere this closure writes, the P22-P25 range stays retired, and P24 and P25 stay named as missing', () => {
  const doc = loadRoadmap();
  const missing = doc.currentTruth.notImplementedPieces.join(' | ');
  deny(missing, [/no high-availability, disaster-recovery or upgrade rollback drill exists yet/i, /\(P23\)/,
    /P23 HA\/DR\/upgrade rollback production proof/i], 'notImplementedPieces (retired P23 claims)');
  for (const [name, text] of projectionsOf(doc)) deny(text, [STALE_P23_PROOF_RANGE, STALE_P22_PROOF_RANGE], `${name} (stale ranges)`);
  // Retiring the claim is not retiring the vocabulary: what P23 did NOT deliver keeps its own names,
  // or this closure would read as if high availability and disaster recovery were now solved.
  need(missing, [REMAINING_PROOF_RANGE, /P24/, /consumer teams|external proof/i, /P25/, /promotion gate/i, /production proof/i,
    /live entrypoint\/host wiring/i, /high[- ]availability/i, /disaster[- ]recovery/i], 'notImplementedPieces (what stays missing)');
});

test('P23D-5: notImplementedPieces carries the explicit P23 residuals - including the anonymous raw-stderr 502 that does NOT hide the missing table name - the merged manifests still record every resilience flag false, and no P21 residual is dropped', () => {
  const doc = loadRoadmap();
  const pieces = doc.currentTruth.notImplementedPieces;
  const missing = pieces.join(' | ');
  need(missing, [/ephemeral/i, /deletes itself|removed before the run exits/i, /once, by hand|proven once|manual|operator/i, /monitor/i,
    /docker/i, /one host|single host|same machine|one node/i], 'notImplementedPieces (shared drill residuals)');
  need(missing, [/backup schedule|no schedule/i, /retention/i, /offsite|off-site/i, /point-in-time|PITR/i, /WAL archiv/i, /\bRPO\b/,
    /\bRTO\b/, /recovery objective/i, /cluster-level role|re-created on the restored/i, /superuser/i], 'notImplementedPieces (P23A residuals)');
  need(missing, [/asynchronous|async replication/i, /automatic failover/i, /detect/i, /split.?brain|quorum|fencing|witness/i,
    /synchronous replication/i, /connection pooler|virtual IP|client-side failover/i], 'notImplementedPieces (P23B residuals)');
  need(missing, [/zero.?downtime|online migration/i, /expand and contract|backward.?compatible/i, /data migration/i,
    /maintenance window|outage/i, /decision history|audit history/i,
    /structure, never the rows|not one of those (audit )?rows|re-?upgrade (brings|restores)/i], 'notImplementedPieces (P23C residuals)');

  // The one residual this closure must get RIGHT rather than inherit: the refused write really answers the
  // unchanged bridge's generic subprocess_failed 502, whose message is the runner's raw stderr, so
  // PostgreSQL's own "relation ... does not exist" text - the missing table's name - can reach the client.
  const stderr502 = pieces.find((piece) => /\b502\b/.test(piece));
  assert.ok(stderr502, 'notImplementedPieces must carry the residual for the 502 the refused write really answers with');
  need(stderr502, [/subprocess_failed/, /stderr/i, /anonymous|generic|undifferentiated|says nothing about/i,
    /table name|name of the missing table|relation/i, /not hidden|is not concealed|can reach|reaches the (HTTP )?client|may appear|is disclosed/i,
    /credential|password|connection string/i], 'the raw-stderr 502 residual');
  for (const [name, text] of projectionsOf(doc)) deny(text, TABLE_NAME_HIDING, `${name} (the false table-name-hiding claim)`);
  // Read-back proving this is a correction and not an invention: P23C's frozen manifest really carries it.
  assert.match(readManifest(P23_EVIDENCE[2].manifest).userJourney.kullaniciYolculugu, TABLE_NAME_HIDING[2],
    'the P23C manifest is the frozen source of the false sentence this closure corrects');

  for (const e of P23_EVIDENCE) {
    const flags = readManifest(e.manifest).readinessFlags;
    for (const f of P23_FALSE_FLAGS) assert.equal(flags[f], false, `${e.pkg} must still record ${f}=false`);
    for (const f of P23_FALSE_IF_DECLARED) if (f in flags) assert.equal(flags[f], false, `${e.pkg} declares ${f} and must record it false`);
  }
  // P22C-5 owns the P22 residual set and the P22 manifest read-back; these are the P21 residuals no closure may drop.
  need(missing, [/--audit on/, /login/i, /managed policy/i, /Git history/i, /detector/i, /advisory databas|moving floor/i,
    /omit=dev|development-only depend/i, /branch.?protection/i, /DAST/i, /Actionplan/i, /writeback|write-back|write back/i],
    'notImplementedPieces (P21 residuals preserved)');
});

test('P23D-6: closing P23 moves no readiness flag - every stronger flag stays false and no high-availability, point-in-time-recovery or zero-downtime flag is introduced true - and the owner-facing fields declare the drilled capability without a runnable claim', () => {
  const doc = loadRoadmap();
  const t = doc.currentTruth;
  for (const key of STRONGER_READINESS_FLAGS) assert.equal(t[key], false, `${key} must remain false`);
  assert.equal(t.runtimeImplementationStarted, true, 'the one true flag is unchanged by this closure');
  // A drill is not a capability flag: one of these introduced true would make the roadmap read as if
  // the system were highly available, recoverable to a point in time, or migratable live.
  for (const f of [...P23_FALSE_IF_DECLARED, ...P23_FALSE_FLAGS]) {
    if (f in t) assert.equal(t[f], false, `${f} must be false if currentTruth declares it at all`);
  }
  const o = doc.ownerFacing;
  for (const key of ['once', 'simdi', 'fark', 'kullaniciYolculugu', 'kalanEngel']) {
    assert.ok(typeof o[key] === 'string' && o[key].trim().length > 0, `owner field ${key} missing`);
  }
  assert.equal(o.capability_delta, P23D_CAPABILITY_DELTA);
  assert.equal(o.calistirilabilirlik, P23D_CALISTIRILABILIRLIK);
  // The owner must be told the cost, not only the capability: a schema rollback over the audit table
  // destroys the decision history, and every drill was one manual, operator-driven run.
  need(JSON.stringify(o), [/23\/25/, /P24/, /hosted/i, /karar (gecmisi|geçmişi)|decision history/i, /elle|manuel|operat[oö]r|by hand/i], 'ownerFacing');
  deny(JSON.stringify(o), [/\bis runnable\b/i], 'ownerFacing');
  need(t.notRunnableProductClaim, [/No SaaS user journey.*runnable end-to-end/is, /live entrypoint|hosted/i, /P23/, REMAINING_PROOF_RANGE],
    'the not-runnable claim');
  deny(t.notRunnableProductClaim, [STALE_P23_PROOF_RANGE], 'the not-runnable claim');
});

test('P23D-7: ROADMAP.md, README.md and the newest CHANGELOG entry project 23/25 with the full P23 evidence and its closure manifest, and carry no runnable, readiness, high-availability, recovery-objective or merge-blocking overclaim', () => {
  const [roadmap, readme, newestEntry] = [readText('ROADMAP.md'), readText('README.md'), changelogNewestEntry()];
  const projections = [['ROADMAP.md', roadmap], ['README.md', readme], ['the newest CHANGELOG entry', newestEntry]];
  for (const [name, text] of projections) assert.ok(text.includes(P23D_STATUS_LINE), `${name} must project '${P23D_STATUS_LINE}'`);
  assert.match(newestEntry, /^\s*-\s*P23d\s/m, 'the newest CHANGELOG entry must be one P23d bullet, keeping the section append-only');
  for (const e of P23_EVIDENCE) {
    for (const [name, text, values] of [['ROADMAP.md', roadmap, [e.pr]], ['README.md', readme, [e.pr, e.ci, e.sec]],
      ['the newest CHANGELOG entry', newestEntry, [e.pr, e.ci]]]) {
      for (const v of values) assert.ok(text.includes(v), `${name} must cite ${e.pkg} evidence ${v}`);
    }
  }
  need(newestEntry, [/backup/i, /restore/i, /standby/i, /failover/i, /rollback/i, /roadmap-v1-current-truth\.json/], 'the newest CHANGELOG entry');
  assert.ok(newestEntry.includes(P23D_CLOSURE_MANIFEST), `the newest CHANGELOG entry must reference ${P23D_CLOSURE_MANIFEST}`);
  assert.ok(existsSync(path.join(repoRoot, P23D_CLOSURE_MANIFEST)), `${P23D_CLOSURE_MANIFEST} must exist, not be a dangling reference`);
  // The honest denial must be present, not merely absent by luck.
  for (const [name, text] of [['ROADMAP.md', roadmap], ['the newest CHANGELOG entry', newestEntry]]) {
    need(text, [/ephemeral|deletes itself/i, /no (high availability|automatic failover)|manual|operator/i], name);
  }
  for (const [name, text] of projections) {
    for (const [pattern, label] of OVERCLAIM_PATTERNS) assert.doesNotMatch(text, pattern, `${name} must not carry ${label}`);
  }
});
