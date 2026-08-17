import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCanonicalLayers, extractLocalImportSpecifiers, resolveLocalImportTarget,
  evaluateArchitectureFitness, readSourceFacts,
} from "../tools/check-p01-architecture-fitness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolPath = path.join(root, "tools", "check-p01-architecture-fitness.mjs");
const LAYERS = [
  { order: 1, name: "Domain", dependsOn: [] },
  { order: 2, name: "Application", dependsOn: ["Domain"] },
  { order: 3, name: "Adapters", dependsOn: ["Application"] },
  { order: 4, name: "Delivery", dependsOn: ["Adapters"] },
];
const contract = (layers) => ({ onion: { layers } });

test("parseCanonicalLayers accepts a well-formed onion contract", () => {
  const result = parseCanonicalLayers(contract(LAYERS));
  assert.equal(result.ok, true); assert.equal(result.layerOrder.get("domain"), 1); assert.equal(result.layerOrder.get("delivery"), 4);
});

test("parseCanonicalLayers fails closed on missing/malformed contract", () => {
  assert.equal(parseCanonicalLayers(null).ok, false);
  assert.equal(parseCanonicalLayers({}).ok, false);
  assert.equal(parseCanonicalLayers(contract(undefined)).ok, false);
  assert.equal(parseCanonicalLayers(contract([])).ok, false);
  assert.equal(parseCanonicalLayers(contract([{ order: 1, name: "Domain" }, { order: 1, name: "Application" }])).ok, false);
  assert.equal(parseCanonicalLayers(contract([{ order: 1, name: "Domain" }, { order: 3, name: "Application" }])).ok, false);
});

test("extractLocalImportSpecifiers covers static, side-effect, export-from and literal dynamic import", () => {
  const source = `
import { Principal } from "../domain/identity-primitives.mjs";
import "./bootstrap-side-effect.mjs";
export { Thing } from "./thing.mjs";
export * from "./everything.mjs";
const p = import("./lazy.mjs");
`;
  const result = extractLocalImportSpecifiers(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.specifiers.slice().sort(), [
    "../domain/identity-primitives.mjs", "./bootstrap-side-effect.mjs", "./everything.mjs", "./lazy.mjs", "./thing.mjs",
  ].sort());
});

test("extractLocalImportSpecifiers refuses non-literal dynamic import", () => {
  const result = extractLocalImportSpecifiers(`const mod = import(target);`);
  assert.equal(result.ok, false); assert.match(result.reason, /non-literal-dynamic-import/);
});

test("extractLocalImportSpecifiers does not misread comment or string lookalikes", () => {
  const source = `
// import "./commented-out.mjs";
/* export { X } from "./also-commented.mjs"; */
const s = "import './looks-like-import.mjs' from 'nowhere'";
import { Real } from "./real.mjs";
`;
  const result = extractLocalImportSpecifiers(source);
  assert.equal(result.ok, true); assert.deepEqual(result.specifiers, ["./real.mjs"]);
});

// Regression: a dynamic import written inside a template literal's `${...}` interpolation is live
// executable code, not inert template text — it must still be detected; plain template text must
// not, and a `${...}`-shaped lookalike inside a plain "..." string must stay inert too.
test("extractLocalImportSpecifiers detects a dynamic import inside template-literal interpolation only", () => {
  const found = extractLocalImportSpecifiers('const mod = `${import("./outside.mjs")}`;');
  assert.equal(found.ok, true); assert.deepEqual(found.specifiers, ["./outside.mjs"]);
  const inert = extractLocalImportSpecifiers('// import("./commented.mjs")\nconst s = `plain ${1 + 1} template`;');
  assert.equal(inert.ok, true); assert.deepEqual(inert.specifiers, []);
  const stringLookalike = extractLocalImportSpecifiers('const s = "${import(\\"./fake.mjs\\")}";');
  assert.equal(stringLookalike.ok, true); assert.deepEqual(stringLookalike.specifiers, []);
});

// Regression: a string/comment nested in a template interpolation is re-lexed (not blindly unmasked)
// and stays inert; a real import nested inside a nested interpolation is still detected.
test("extractLocalImportSpecifiers re-lexes nested string/comment/template inside an interpolation", () => {
  const nestedString = extractLocalImportSpecifiers('const s = `${"import(\\"./fake.mjs\\")"}`;');
  const nestedComment = extractLocalImportSpecifiers('const s = `${/* import("./fake.mjs") */ 1}`;');
  const nestedTemplate = extractLocalImportSpecifiers('const s = `${`${import("./nested.mjs")}`}`;');
  assert.deepEqual(nestedString.specifiers, []); assert.deepEqual(nestedComment.specifiers, []); assert.deepEqual(nestedTemplate.specifiers, ["./nested.mjs"]);
  assert.ok(nestedString.ok && nestedComment.ok && nestedTemplate.ok);
});

test("extractLocalImportSpecifiers ignores bare package and built-in specifiers", () => {
  const source = `
import { createHash } from "node:crypto";
import { readFileSync } from "fs";
import something from "some-package";
import { Real } from "./real.mjs";
`;
  const result = extractLocalImportSpecifiers(source);
  assert.equal(result.ok, true); assert.deepEqual(result.specifiers, ["./real.mjs"]);
});

test("resolveLocalImportTarget refuses escape past the source root", () => {
  const result = resolveLocalImportTarget("domain/identity-primitives.mjs", "../../outside.mjs");
  assert.equal(result.ok, false); assert.match(result.reason, /escapes-source-root/);
});

test("resolveLocalImportTarget resolves an in-tree relative specifier", () => {
  const result = resolveLocalImportTarget("application/policy.mjs", "./action-primitives.mjs");
  assert.equal(result.ok, true); assert.equal(result.relPath, "application/action-primitives.mjs");
});

test("evaluateArchitectureFitness passes same-ring and inward local imports", () => {
  const result = evaluateArchitectureFitness({ canonicalLayerContract: contract(LAYERS), files: [
    { relPath: "domain/a.mjs", text: `export const a = 1;` },
    { relPath: "application/b.mjs", text: `import { a } from "../domain/a.mjs";\nexport const b = a;` },
    { relPath: "application/c.mjs", text: `import { b } from "./b.mjs";\nexport const c = b;` },
  ] });
  assert.equal(result.ok, true); assert.deepEqual(result.findings, []);
});

test("evaluateArchitectureFitness fails an outward local import", () => {
  const result = evaluateArchitectureFitness({ canonicalLayerContract: contract(LAYERS), files: [
    { relPath: "domain/a.mjs", text: `import { b } from "../application/b.mjs";\nexport const a = 1;` },
    { relPath: "application/b.mjs", text: `export const b = 1;` },
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0], /outward-import/); assert.match(result.findings[0], /domain\/a\.mjs/); assert.match(result.findings[0], /application\/b\.mjs/);
});

test("evaluateArchitectureFitness fails closed on missing canonical contract", () => {
  const result = evaluateArchitectureFitness({ canonicalLayerContract: null, files: [{ relPath: "domain/a.mjs", text: `export const a = 1;` }] });
  assert.equal(result.ok, false); assert.equal(result.findings.length, 1); assert.match(result.findings[0], /canonical-layer-contract-invalid/);
});

test("evaluateArchitectureFitness fails closed on unknown ring, missing target and unreadable source", () => {
  const result = evaluateArchitectureFitness({ canonicalLayerContract: contract(LAYERS), files: [
    { relPath: "unknownring/a.mjs", text: `export const a = 1;` },
    { relPath: "domain/b.mjs", text: `import { x } from "./missing.mjs";` },
    { relPath: "domain/c.mjs", text: null },
  ] });
  assert.equal(result.ok, true);
  const joined = result.findings.join("\n");
  assert.match(joined, /unknown-ring/); assert.match(joined, /missing-import-target/); assert.match(joined, /unreadable-source/);
});

test("evaluateArchitectureFitness produces deterministic sorted findings", () => {
  const result = evaluateArchitectureFitness({ canonicalLayerContract: contract(LAYERS), files: [
    { relPath: "domain/z.mjs", text: `import { b } from "../application/b.mjs";\nexport const z = 1;` },
    { relPath: "domain/a.mjs", text: `import { b } from "../application/b.mjs";\nexport const a = 1;` },
    { relPath: "application/b.mjs", text: `export const b = 1;` },
  ] });
  assert.deepEqual(result.findings, result.findings.slice().sort());
});

test("readSourceFacts fails closed on an absent source root, a symlinked sourceRoot itself, and symlinked descendant dirs", () => {
  assert.deepEqual(readSourceFacts(path.join(root, "does-not-exist-p01-pkg10-source-root")), [{ relPath: ".", text: null }]);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "p01-pkg10-"));
  try {
    mkdirSync(path.join(tmp, "real")); writeFileSync(path.join(tmp, "real", "inner.mjs"), "export const x = 1;");
    symlinkSync(path.join(tmp, "real"), path.join(tmp, "loop"), "dir"); symlinkSync(tmp, path.join(tmp, "real", "up"), "dir"); // "up" loops forever if followed
    const byPath = Object.fromEntries(readSourceFacts(tmp).map((f) => [f.relPath, f.text]));
    assert.deepEqual(byPath, { loop: null, "real/inner.mjs": "export const x = 1;", "real/up": null });
    symlinkSync(path.join(tmp, "real"), path.join(tmp, "src-link"), "dir"); // sourceRoot itself as a symlink must fail closed, not be followed
    assert.deepEqual(readSourceFacts(path.join(tmp, "src-link")), [{ relPath: ".", text: null }]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI exits zero with the GREEN marker on the real current src", () => {
  const startedAt = Date.now();
  const real = spawnSync(process.execPath, [toolPath], { cwd: root, encoding: "utf8" });
  const durationMs = Date.now() - startedAt;
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.match(real.stdout, /P01_PKG10_ARCHITECTURE_FITNESS_GREEN/);
  assert.ok(durationMs < 5000, `expected the real CLI run under 5s, took ${durationMs}ms`);
});

// The evaluator-only RED tests above never spawn the real process; this proves the actual CLI
// (own tool copy, own canonical contract, own invalid src) exits non-zero with a stable finding.
test("CLI exits non-zero with a stable RED finding on a fixture repo with an outward import", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "p01-pkg10-cli-red-"));
  try {
    mkdirSync(path.join(tmp, "tools"));
    mkdirSync(path.join(tmp, "planning"));
    mkdirSync(path.join(tmp, "src", "domain"), { recursive: true });
    mkdirSync(path.join(tmp, "src", "application"), { recursive: true });
    const fixtureToolPath = path.join(tmp, "tools", "check-p01-architecture-fitness.mjs");
    writeFileSync(fixtureToolPath, readFileSync(toolPath, "utf8"));
    writeFileSync(path.join(tmp, "planning", "kernel-runtime-pilot-consumer-sync.json"), JSON.stringify({ architectureContract: contract(LAYERS) }));
    writeFileSync(path.join(tmp, "src", "domain", "a.mjs"), 'import { b } from "../application/b.mjs";\nexport const a = 1;\n');
    writeFileSync(path.join(tmp, "src", "application", "b.mjs"), "export const b = 1;\n");
    const run = spawnSync(process.execPath, [fixtureToolPath], { cwd: tmp, encoding: "utf8" });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stderr, /P01_PKG10_ARCHITECTURE_FITNESS_RED/);
    assert.match(run.stderr, /outward-import:domain\/a\.mjs\(ring 1\)->application\/b\.mjs\(ring 2\)/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
