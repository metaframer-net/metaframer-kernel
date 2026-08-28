import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import test from "node:test";
import { ActionContract } from "../src/application/action-contract.mjs";
import { renderVersionedActionSdkDistribution } from "../tools/generate-versioned-action-sdk-distribution.mjs";
import { renderConsumerDiagnosticsDistribution } from "../tools/generate-consumer-diagnostics-distribution.mjs";

// P24E1 — the license boundary, stated once and enforced from both sides. The repository carried no LICENSE
// file and no `license` key, so "what may an outside team legally do with this?" had no answer in the
// repository itself. The answer is AGPL-3.0-only, proven by the FSF's verbatim agpl-3.0.txt bytes, a real
// regular file and never a symlink pointing somewhere unreviewed, carrying Section 13 — the remote-network
// clause that is the entire reason this is AGPL and not GPL. The other side is the commercial one: the SDK
// bytes an external consumer receives carried NO license text at all, because the MIT grant intended for
// those bytes was `pending` — DECIDED, NOT GRANTED — so this package relicensed nothing and the CLA is
// `inactive` the same way. That `pending` was later granted by P24E2, which owns the MIT text now in the
// generated module; this record stays historical and unrewritten, and what it still enforces is that the
// repository's own copyleft never reached a consumer. NOT P24: no team, no readiness flag, no release.

const at = (rel) => new URL(`../${rel}`, import.meta.url);
const [read, sha256] = [(rel) => readFile(at(rel), "utf8"), (text) => createHash("sha256").update(text, "utf8").digest("hex")];
const [ARTIFACT, SPDX] = ["planning/kernel-license-boundary-p24e1.json", "AGPL-3.0-only"];
const LICENSE_SHA256 = "0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0";
const SECTION_13 = "  13. Remote Network Interaction; Use with the GNU General Public License.";
const CLA_PATHS = Object.freeze(["CLA.md", "CLA.txt", "CLA", "docs/cla.md", ".github/CLA.md", "CONTRIBUTOR_LICENSE_AGREEMENT.md"]);
const FROZEN = Object.freeze({ // tools/generate-action-sdk.mjs left this map when P24E2 became its authorized editor; the two wrappers stay pinned
  "tools/generate-versioned-action-sdk-distribution.mjs": "5218cd717caa5fc96b0fef6223d11cc3aeb0bcfad521ac069a8330e7a06b85c1",
  "tools/generate-consumer-diagnostics-distribution.mjs": "93a605945bc8f341a86016a8588f58f51271d3a70da4fb06d11d5acae804bce2",
});
const EXPECTED_BOUNDARY = Object.freeze({ // one deepEqual: no later edit adds a grant, activates a CLA or flips `pending`
  repository: { spdx: SPDX, file: "LICENSE", sha256: LICENSE_SHA256, sectionThirteenPresent: true, symlinkAllowed: false },
  sdkDistributedBytes: { intendedSpdx: "MIT", status: "pending", granted: false, appliedToBytes: false, licenseTextInBytes: "none" },
  cla: { status: "inactive", active: false, requiredToday: false, file: null, signedCount: 0, openedByThisPackage: false },
  claims: { externalUsabilityProven: false, relicensesAnyByte: false, isLegalAdvice: false },
});
const CONTRACT = new ActionContract({ kind: "command", name: "widget.create", version: 1, fields: ["name", "quantity"], outcomes: ["created", "rejected"], errorEnvelopeFields: ["code", "message"] });

test("LICENSE is the FSF's verbatim AGPL-3.0 text, present as a regular file", async () => {
  const [stat, text] = [await lstat(at("LICENSE")), await read("LICENSE")];
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "LICENSE must be a real regular file, never a symlink");
  assert.equal(sha256(text), LICENSE_SHA256, "LICENSE bytes must be the verbatim upstream agpl-3.0.txt");
  assert.deepEqual([Buffer.byteLength(text, "utf8"), text.split("\n").length - 1], [34523, 661], "verbatim byte and line count");
  assert.deepEqual(text.split("\n", 2).map((line) => line.trim()), ["GNU AFFERO GENERAL PUBLIC LICENSE", "Version 3, 19 November 2007"]);
  assert.ok(text.includes(SECTION_13), "Section 13 is why this is AGPL and not GPL; it must be present verbatim");
});

test("package.json states the SPDX id, stays private and moves no version", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.deepEqual([pkg.license, pkg.private], [SPDX, true], "the grant must be machine-readable, and a private package is still unpublished");
  assert.deepEqual([pkg.name, pkg.version], ["@metaframer/kernel", "0.1.0-alpha.1"], "stating a license is not a release and moves no version");
});

test("the canonical artifact projects the boundary, MIT pending and the CLA inactive", async () => {
  const [artifact, pkg, license] = [JSON.parse(await read(ARTIFACT)), JSON.parse(await read("package.json")), await read("LICENSE")];
  assert.equal(artifact.id, "kernel-license-boundary-p24e1");
  assert.deepEqual(artifact.boundary, EXPECTED_BOUNDARY, "the artifact is the single authority for the boundary");
  assert.deepEqual([artifact.boundary.repository.sha256, artifact.boundary.repository.spdx], [sha256(license), pkg.license], "the projection must match the shipped LICENSE bytes and package.json's one grant");
  assert.ok(Object.values(artifact.readinessFlags).every((flag) => flag === false), "stating a license moves no readiness flag");
});

test("no CLA exists, and nothing claims one is signed or in force", async () => {
  for (const rel of CLA_PATHS) await assert.rejects(lstat(at(rel)), /ENOENT/, `${rel} must not exist`);
  assert.equal(JSON.parse(await read(ARTIFACT)).boundary.cla.signedCount, 0, "nobody signed a CLA, because there is none to sign");
  assert.ok(!/\bCLA\b/.test(await read("LICENSE")), "the AGPL text is verbatim and mentions no CLA");
});

test("stating the repository's copyleft leaked none of it into consumer bytes, and the generator surfaces this package froze stay frozen", async () => {
  for (const [rel, digest] of Object.entries(FROZEN)) assert.equal(sha256(await read(rel)), digest, `${rel} must not be edited by the license package`);
  const bytes = [renderVersionedActionSdkDistribution(CONTRACT, "1.0.0"), renderConsumerDiagnosticsDistribution(CONTRACT, "1.0.0")].flatMap((payload) => Object.values(payload.files)).join("\n");
  assert.equal(bytes.match(/affero|AGPL|GPL|copyleft/gi), null, "the repository is AGPL-3.0-only and that copyleft must never reach a consumer's bytes");
  assert.match(bytes, /^\/\/ SPDX-License-Identifier: MIT$/m, "the `pending` this package recorded was later granted by P24E2, which owns those bytes; nothing here relicensed them and this record stays historical");
});
