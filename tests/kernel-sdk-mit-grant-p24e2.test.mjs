import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderActionSdk } from "../tools/generate-action-sdk.mjs";
import { renderVersionedActionSdkDistribution } from "../tools/generate-versioned-action-sdk-distribution.mjs";
import { renderConsumerDiagnosticsDistribution } from "../tools/generate-consumer-diagnostics-distribution.mjs";

// P24E2 — the MIT grant, actually applied to the bytes. P24E1 stated the boundary and stopped: MIT was
// `pending`, DECIDED BUT NOT GRANTED, and the SDK an external consumer received carried no license text at
// all, so a team holding those bytes still had nothing in the bytes telling them what they may do. Here the
// grant lands where it can be read without asking anyone: the generated action SDK module opens with the
// verbatim OSI MIT text, an SPDX id and one copyright line, frozen by digest so no later edit may reword,
// reflow or quietly widen it. Exactly one file receives it. The repository itself stays AGPL-3.0-only and is
// not relicensed; `diagnose.mjs` and `manifest.json` stay OUTSIDE the grant, deliberately and recorded as
// follow-up, not forgotten. The P08 file layout, the P24A manifest schema and both digest formulas are
// preserved byte for byte, so the notice rides INSIDE the integrity envelope rather than beside it. NOT P24:
// no consumer ran anything, no team was counted, no CLA opened, no readiness flag, version or release moved.

const at = (rel) => new URL(`../${rel}`, import.meta.url);
const [read, sha256] = [(rel) => readFile(at(rel), "utf8"), (text) => createHash("sha256").update(text, "utf8").digest("hex")];
const [ARTIFACT, P24E1_ARTIFACT] = ["planning/kernel-sdk-mit-grant-p24e2.json", "planning/kernel-license-boundary-p24e1.json"];
const [VERSION, FOLLOW_UP_ID] = ["1.0.0", "p24e2-followup-diagnostics-runner-grant"];
const COPYRIGHT = "Copyright (c) 2026 İsmail Karaca"; // U+0130, the dotted capital I; an ASCII "Ismail" is a different name
// The OSI/SPDX MIT text, verbatim and in its canonical 21-line wrap, with the placeholders filled in once.
const MIT_LINES = Object.freeze([
  "MIT License", "", COPYRIGHT, "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:", "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.", "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
]);
const MIT_TEXT = `${MIT_LINES.join("\n")}\n`;
const NOTICE_LINES = Object.freeze(["// SPDX-License-Identifier: MIT", "//", ...MIT_LINES.map((line) => (line === "" ? "//" : `// ${line}`))]);
const NOTICE = `${NOTICE_LINES.join("\n")}\n`;
const [MIT_TEXT_SHA256, NOTICE_SHA256] = ["c8bdc24951cb22dcdf57d99734b7dcf63b55d94b8256c6ee3136be2dbe539ac2", "2c9869efaf80d6be1a4c9795f33081b2640b63714c3445124b1b13ed0a002b96"];
const EXPECTED_GRANT = Object.freeze({ // one deepEqual: no later edit may widen the grant, relicense the repository or open a CLA
  repository: { spdx: "AGPL-3.0-only", file: "LICENSE", relicensedByThisPackage: false },
  sdkModuleBytes: { spdx: "MIT", status: "granted", granted: true, appliedToBytes: true, licenseTextInBytes: "osi-mit-verbatim", licenseTextSha256: MIT_TEXT_SHA256, noticeSha256: NOTICE_SHA256, copyright: COPYRIGHT, carriedIn: "generated-action-sdk-module", supersedes: "kernel-license-boundary-p24e1" },
  outsideGrant: { diagnosticsRunner: { path: "diagnose.mjs", spdx: null, licenseTextInBytes: "none", followUp: true }, manifest: { path: "manifest.json", spdx: null, licenseTextInBytes: "none", followUp: false } },
  cla: { status: "inactive", active: false, requiredToday: false, file: null, signedCount: 0, openedByThisPackage: false },
  claims: { externalUsabilityProven: false, consumerRunProven: false, relicensesRepositoryBytes: false, isLegalAdvice: false },
});
const options = (over) => ({ kind: "command", name: "widget.create", version: 1, fields: ["name", "quantity"], outcomes: ["created", "rejected"], errorEnvelopeFields: ["code", "message"], ...over });
const [CONTRACT, OTHER_CONTRACT] = [new ActionContract(options()), new ActionContract(options({ kind: "query", name: "widget.list.byowner", version: 3, fields: ["ownerId", "cursor"], outcomes: ["found", "empty"], errorEnvelopeFields: ["code", "message", "details"] }))];
const noticeOf = (source) => `${source.split("\n").slice(0, NOTICE_LINES.length).join("\n")}\n`;
const bodyOf = (source) => source.slice(NOTICE.length + 1); // the notice, then exactly one blank line, then the module
const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

test("P24E2-1 the generated module opens with the verbatim OSI MIT text, one SPDX id and one copyright line, frozen by digest", () => {
  assert.deepEqual([sha256(MIT_TEXT), sha256(NOTICE)], [MIT_TEXT_SHA256, NOTICE_SHA256], "this test's own frozen copy must stay the verbatim OSI text; a reworded grant is a different grant");
  const source = renderActionSdk(CONTRACT);
  assert.ok(source.startsWith(`${NOTICE}\n`), "the module must open with the frozen notice followed by exactly one blank line");
  assert.deepEqual(noticeOf(source).split("\n").slice(2, -1).map((line) => line.replace(/^\/\/ ?/, "")), [...MIT_LINES], "the shipped text must be the OSI wording line for line: no paraphrase, no reflow, no omitted warranty disclaimer");
  assert.equal(source.match(/SPDX-License-Identifier/g).length, 1, "exactly one SPDX id, and it is MIT");
  assert.ok(source.includes(COPYRIGHT) && !/\[year\]|\[fullname\]|<year>|<copyright/.test(source), "the copyright line must be filled in, never left as an OSI placeholder");
  assert.ok(!/Copyright \(c\) 2026 Ismail/.test(source), "the holder is İsmail Karaca with U+0130; an ASCII-folded name grants nothing to that person");
  assert.equal(bodyOf(source).split("\n")[0], 'export const ACTION_KIND = "command";', "the notice is a header on the existing module, not a rewrite of it");
});

test("P24E2-2 the grant is applied to the bytes deterministically and changes no behaviour the module already had", async () => {
  const [a1, a2, b] = [renderActionSdk(CONTRACT), renderActionSdk(CONTRACT), renderActionSdk(OTHER_CONTRACT)];
  assert.equal(a1, a2, "rendering the same contract twice must stay byte-identical after the grant");
  assert.deepEqual([noticeOf(a1), noticeOf(b)], [NOTICE, NOTICE], "every consumer of every contract receives the same grant, not a per-contract one");
  assert.notEqual(bodyOf(a1), bodyOf(b), "the notice is identical; the modules under it still differ by contract");
  assert.ok(!/^\s*import\s/m.test(a1) && !/\brequire\(/.test(a1), "a license header may not smuggle in an import or a dependency");
  const generated = await import(`data:text/javascript;base64,${Buffer.from(b, "utf8").toString("base64")}`);
  const spec = generated.buildActionSpec({ ownerId: "o", cursor: "c" });
  assert.deepEqual([generated.ACTION_KIND, generated.ACTION_NAME, generated.ACTION_VERSION], ["query", "widget.list.byowner", 3], "the module still evaluates and still declares its own action");
  assert.ok(Object.isFrozen(spec) && generated.isOutcome("found") && generated.isErrorEnvelope({ code: "c", message: "m", details: "d" }), "the declared surface behaves exactly as it did before the grant");
});

test("P24E2-3 the P08 layout, the P24A manifest schema and both digest formulas are preserved, and the notice rides inside the integrity envelope", () => {
  const [p08, p24a] = [renderVersionedActionSdkDistribution(CONTRACT, VERSION), renderConsumerDiagnosticsDistribution(CONTRACT, VERSION)];
  assert.deepEqual([Object.keys(p08.files).sort(), Object.keys(p24a.files).sort()], [["actions/widget.create/v1.mjs", "manifest.json"], ["actions/widget.create/v1.mjs", "diagnose.mjs", "manifest.json"]], "the grant ships no new file and moves none");
  const [m08, m24a] = [JSON.parse(p08.files[p08.manifestPath]), JSON.parse(p24a.files[p24a.manifestPath])];
  assert.deepEqual([Object.keys(m08), Object.keys(m24a)], [["schemaVersion", "format", "distributionVersion", "coordinate", "action", "modulePath", "integrity"], ["schemaVersion", "format", "distributionVersion", "coordinate", "action", "modulePath", "integrity", "diagnosticsPath", "diagnostics"]], "the manifest schema gains no license field: the grant lives in the module bytes, where a consumer reads it");
  const moduleSource = p08.files[p08.modulePath];
  assert.equal(noticeOf(moduleSource), NOTICE, "the grant must reach the payload a consumer materializes, not only the renderer's return value");
  const input = { schemaVersion: 1, distributionVersion: VERSION, coordinate: m08.coordinate, action: { kind: CONTRACT.kind, name: CONTRACT.name, version: CONTRACT.version }, modulePath: p08.modulePath, moduleSource };
  assert.deepEqual([digest(input), m24a.integrity], [m08.integrity, m08.integrity], "the P08 formula is unchanged and the P24A wrapper still reuses the legacy digest byte for byte");
  assert.notEqual(digest({ ...input, moduleSource: bodyOf(moduleSource) }), m08.integrity, "stripping the notice must break the digest: the grant is covered by integrity, not attached beside it");
  assert.equal(digest({ schemaVersion: 1, distributionVersion: VERSION, coordinate: m24a.coordinate, integrity: m24a.integrity, diagnosticsPath: m24a.diagnosticsPath, diagnosticsSource: p24a.files[m24a.diagnosticsPath] }), m24a.diagnostics, "the P24A diagnostics formula is unchanged and still binds the shipped runner to this payload");
});

test("P24E2-4 diagnose.mjs and manifest.json stay outside the grant on purpose, and the ungranted runner is recorded as open follow-up", async () => {
  const payload = renderConsumerDiagnosticsDistribution(CONTRACT, VERSION);
  for (const rel of [payload.manifestPath, payload.diagnosticsPath]) {
    assert.equal(payload.files[rel].match(/SPDX|MIT|licen[cs]e|copyright/gi), null, `${rel} is outside the grant, so it must state no grant at all rather than an unreviewed one`);
  }
  assert.deepEqual(JSON.parse(await read(ARTIFACT)).followUps, [FOLLOW_UP_ID], "the ungranted runner is named as open follow-up work, not silently left behind");
});

test("P24E2-5 the canonical artifact projects the grant once, rewrites no history and moves nothing else", async () => {
  const [artifact, pkg] = [JSON.parse(await read(ARTIFACT)), JSON.parse(await read("package.json"))];
  assert.equal(artifact.id, "kernel-sdk-mit-grant-p24e2");
  assert.deepEqual(artifact.grant, EXPECTED_GRANT, "the artifact is the single authority for the grant");
  assert.equal(artifact.grant.sdkModuleBytes.noticeSha256, sha256(noticeOf(renderActionSdk(CONTRACT))), "the record must be digest-bound to the bytes actually rendered, not to an intention");
  assert.deepEqual([pkg.license, pkg.private, pkg.version], ["AGPL-3.0-only", true, "0.1.0-alpha.1"], "granting MIT over distributed SDK bytes relicenses no repository byte, unprivates nothing and moves no version");
  assert.deepEqual(JSON.parse(await read(P24E1_ARTIFACT)).boundary.sdkDistributedBytes, { intendedSpdx: "MIT", status: "pending", granted: false, appliedToBytes: false, licenseTextInBytes: "none" }, "P24E1 is history: it recorded a pending grant and must still read pending, superseded rather than rewritten");
  assert.ok(Object.values(artifact.readinessFlags).every((flag) => flag === false), "granting a license moves no readiness flag");
  assert.deepEqual([artifact.p24Truth.independentTeamCount, artifact.p24Truth.requiredIndependentTeams, artifact.p24Truth.p24Open], [0, 3, true], "permission to use the bytes is not a team using them; P24 stays 0 of 3 and open");
});
