import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P10 — Customer app-core consumer. Written pre-implementation; RED is honest per scenario.
// No implementation exists yet at the allowed path below.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_CORE_PATH = "consumers/customer-app-core/customer-app-core.mjs";

async function importAppCore() {
  return import(pathToFileURL(path.join(root, APP_CORE_PATH)).href);
}

async function buildSdkModule() {
  const { ActionContract } = await import(pathToFileURL(path.join(root, "src/application/action-contract.mjs")).href);
  const { renderVersionedActionSdkDistribution } = await import(
    pathToFileURL(path.join(root, "tools/generate-versioned-action-sdk-distribution.mjs")).href
  );
  const contract = new ActionContract({
    kind: "command",
    name: "customer.core.ping",
    version: 1,
    fields: Object.freeze(["id"]),
    outcomes: Object.freeze(["ok", "rejected"]),
    errorEnvelopeFields: Object.freeze(["code", "message"]),
  });
  const payload = renderVersionedActionSdkDistribution(contract, "1.0.0.0");
  const moduleSource = payload.files[payload.modulePath];
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
  const sdkModule = await import(dataUrl);
  return { sdkModule, coordinate: payload.coordinate };
}

test("app-core declares immutable identity/manifest metadata: customer/customer-core, customer:core capability, customer.* events, default deny, minimum modules", async () => {
  const mod = await importAppCore();
  assert.ok(typeof mod.createCustomerAppCore === "function" || typeof mod.CUSTOMER_APP_CORE_MANIFEST === "object");
  const manifest = mod.CUSTOMER_APP_CORE_MANIFEST;
  assert.equal(manifest.appSlug, "customer");
  assert.equal(manifest.moduleSlug, "customer-core");
  assert.ok(manifest.requiredCapabilities.includes("customer:core"));
  assert.equal(manifest.eventNamespace, "customer.*");
  assert.equal(manifest.defaultDeny, true);
  assert.ok(Array.isArray(manifest.modules) && manifest.modules.length >= 1);
  assert.ok(Object.isFrozen(manifest));
  assert.equal(manifest.route, undefined);
  assert.equal(manifest.ui, undefined);
});

test("app-core composes a real P08-generated public SDK module only through its public contract surface", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();
  const appCore = mod.createCustomerAppCore({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
  });
  assert.equal(appCore.sdkCoordinate, coordinate);
  assert.equal(appCore.status, "ready");
});

test("missing, malformed, or wrong-coordinate SDK public surface fails closed", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();

  assert.throws(() => mod.createCustomerAppCore({ sdk: undefined, coordinate, grantedCapabilities: ["customer:core"] }));
  assert.throws(() =>
    mod.createCustomerAppCore({ sdk: { ACTION_NAME: "not-a-real-sdk" }, coordinate, grantedCapabilities: ["customer:core"] })
  );
  assert.throws(() =>
    mod.createCustomerAppCore({ sdk: sdkModule, coordinate: "wrong.coordinate@9", grantedCapabilities: ["customer:core"] })
  );
});

test("customer:core capability gate defaults to deny and only the exact capability activates it", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();

  assert.throws(() => mod.createCustomerAppCore({ sdk: sdkModule, coordinate, grantedCapabilities: [] }));
  assert.throws(() =>
    mod.createCustomerAppCore({ sdk: sdkModule, coordinate, grantedCapabilities: ["customer:other"] })
  );
  const appCore = mod.createCustomerAppCore({ sdk: sdkModule, coordinate, grantedCapabilities: ["customer:core"] });
  assert.equal(appCore.status, "ready");
});

test("app-core source and public output carry no Kernel-internal import and no schema/adapter/CRUD/Surface/UI/host/release/readiness behavior", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, APP_CORE_PATH), "utf8");
  const forbiddenImportPatterns = [/from\s+["']\.\.\/\.\.\/kernel\//, /from\s+["'].*\/delivery\//, /from\s+["'].*\/host\//];
  assert.ok(forbiddenImportPatterns.every((re) => !re.test(source)));
  const forbiddenTokens = [/\bSCHEMA\b/, /\bAdapter\b/, /\bCRUD\b/, /\bSurface\b/i, /\bUI\b/, /\bHostRunner\b/, /\breadiness\b/i, /\brelease\b/i];
  assert.ok(forbiddenTokens.every((re) => !re.test(source)));
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();
  const appCore = mod.createCustomerAppCore({ sdk: sdkModule, coordinate, grantedCapabilities: ["customer:core"] });
  const publicKeys = Object.keys(appCore);
  assert.ok(!publicKeys.some((k) => /schema|adapter|crud|surface|ui|host|release|readiness/i.test(k)));
});
