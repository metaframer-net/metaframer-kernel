import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P16 — customer surface UI projection over the P15 typed customer-module-api. Written
// pre-implementation; RED is honest: consumers/customer-app-core/customer-surface.mjs does not
// exist yet at the allowed path below.
// Excludes host/DOM/DB/relay/readiness/docs: this module only wraps a pre-built customerModuleApi
// (already-real P15 recordCustomer) in a frozen {manifest,project,submit,retry} UI projection.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SURFACE_PATH = "consumers/customer-app-core/customer-surface.mjs";
const MODULE_API_PATH = "consumers/customer-app-core/customer-module-api.mjs";

async function importSurface() {
  return import(pathToFileURL(path.join(root, SURFACE_PATH)).href);
}

async function importModuleApi() {
  return import(pathToFileURL(path.join(root, MODULE_API_PATH)).href);
}

async function buildSdkModule() {
  const { ActionContract } = await import(pathToFileURL(path.join(root, "src/application/action-contract.mjs")).href);
  const { renderVersionedActionSdkDistribution } = await import(
    pathToFileURL(path.join(root, "tools/generate-versioned-action-sdk-distribution.mjs")).href
  );
  const contract = new ActionContract({
    kind: "command",
    name: "customer.create",
    version: 1,
    fields: Object.freeze(["requestId", "actorId", "tenantId", "payload", "idempotencyKey"]),
    outcomes: Object.freeze(["ok", "rejected"]),
    errorEnvelopeFields: Object.freeze(["code", "message"]),
  });
  const payload = renderVersionedActionSdkDistribution(contract, "1.0.0.0");
  const moduleSource = payload.files[payload.modulePath];
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
  const sdkModule = await import(dataUrl);
  return { sdkModule, coordinate: payload.coordinate };
}

function baseCutoverOptions(overrides = {}) {
  return {
    connectionString: "postgres://x",
    legacyInsert: async () => ({ legacy: true }),
    verifyCompatibility: async () => true,
    poolFactory: () => {
      throw new Error("must not be called before cutover");
    },
    ...overrides,
  };
}

function baseActionSpec() {
  return {
    requestId: "33333333-3333-3333-3333-333333333333",
    actorId: "44444444-4444-4444-4444-444444444444",
    tenantId: "11111111-1111-1111-1111-111111111111",
    payload: { plan: "pro" },
    idempotencyKey: "idem-1",
  };
}

function baseRecord() {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: "2026-08-24T00:00:00.000Z",
    recorded_at: "2026-08-25T00:00:00.000Z",
  };
}

function baseInsertOptions(record) {
  const correlationId = "corr-1";
  return {
    tenantId: record.tenant_id,
    audit: { action: "customer.created", correlationId },
    transactionalOutbox: { eventName: "customer.created", correlationId },
    idempotency: { fingerprint: record.id },
  };
}

async function buildRealCustomerModuleApi(overrides = {}) {
  const moduleApiMod = await importModuleApi();
  const { sdkModule, coordinate } = await buildSdkModule();
  return moduleApiMod.createCustomerModuleApi({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions(overrides),
  });
}

function assertNoRawLeak(value) {
  const seen = new Set();
  function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node instanceof Error) {
      throw new Error("surface leaked a raw Error instance");
    }
    for (const key of Object.keys(node)) {
      if (key === "message" || key === "stack") {
        throw new Error(`surface leaked a raw "${key}" field`);
      }
      walk(node[key]);
    }
  }
  walk(value);
}

test("CUSTOMER_SURFACE_MANIFEST is frozen and createCustomerSurface returns a frozen initial UI projection, refusing an invalid handle", async () => {
  const mod = await importSurface();

  assert.equal(typeof mod.CUSTOMER_SURFACE_MANIFEST, "object");
  assert.equal(Object.isFrozen(mod.CUSTOMER_SURFACE_MANIFEST), true);

  assert.equal(typeof mod.createCustomerSurface, "function");

  const customerModuleApi = await buildRealCustomerModuleApi();
  const surface = mod.createCustomerSurface({ customerModuleApi });

  assert.equal(Object.isFrozen(surface), true);
  assert.equal(surface.manifest, mod.CUSTOMER_SURFACE_MANIFEST);
  assert.equal(typeof surface.project, "function");
  assert.equal(typeof surface.submit, "function");
  assert.equal(typeof surface.retry, "function");

  const initialProjection = surface.project();
  assert.equal(Object.isFrozen(initialProjection), true);
  assert.equal(initialProjection.state, "idle");
  assertNoRawLeak(initialProjection);

  assert.throws(() => mod.createCustomerSurface({ customerModuleApi: { not: "a valid handle" } }));
  assert.throws(() => mod.createCustomerSurface({ customerModuleApi: null }));
  assert.throws(() => mod.createCustomerSurface({}));
});

test("submit against a real P15 customerModuleApi drives the projection to saved with exactly one legacyInsert call", async () => {
  const mod = await importSurface();
  let legacyCalls = 0;
  let lastLegacyArgs;
  const customerModuleApi = await buildRealCustomerModuleApi({
    legacyInsert: async (record, insertOptions) => {
      legacyCalls += 1;
      lastLegacyArgs = [record, insertOptions];
      return { legacy: true };
    },
  });

  const surface = mod.createCustomerSurface({ customerModuleApi });
  const record = baseRecord();
  const insertOptions = baseInsertOptions(record);

  const result = await surface.submit({ actionSpec: baseActionSpec(), record, insertOptions });

  assert.equal(legacyCalls, 1);
  assert.deepEqual(lastLegacyArgs[0], record);
  assert.deepEqual(lastLegacyArgs[1], insertOptions);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.state, "saved");
  assertNoRawLeak(result);

  const projected = surface.project();
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(projected.state, "saved");
  assertNoRawLeak(projected);
});

test("a real P15 legacyInsert failure sanitizes into a rejected projection, and retry with the exact prior args succeeds and saves", async () => {
  const mod = await importSurface();
  let legacyCalls = 0;
  let shouldFail = true;
  let lastLegacyArgs;
  const marker = new Error("legacy insert unavailable: secret-connection-string-details");
  const customerModuleApi = await buildRealCustomerModuleApi({
    legacyInsert: async (record, insertOptions) => {
      legacyCalls += 1;
      lastLegacyArgs = [record, insertOptions];
      if (shouldFail) {
        throw marker;
      }
      return { legacy: true };
    },
  });

  const surface = mod.createCustomerSurface({ customerModuleApi });
  const record = baseRecord();
  const insertOptions = baseInsertOptions(record);
  const args = { actionSpec: baseActionSpec(), record, insertOptions };

  const rejected = await surface.submit(args);
  assert.equal(legacyCalls, 1);
  assert.equal(Object.isFrozen(rejected), true);
  assert.equal(rejected.state, "rejected");
  assertNoRawLeak(rejected);
  assert.equal(JSON.stringify(rejected).includes("secret-connection-string-details"), false);

  const projectedAfterFailure = surface.project();
  assert.equal(projectedAfterFailure.state, "rejected");

  shouldFail = false;
  const saved = await surface.retry();

  assert.equal(legacyCalls, 2);
  assert.deepEqual(lastLegacyArgs[0], record);
  assert.deepEqual(lastLegacyArgs[1], insertOptions);
  assert.equal(Object.isFrozen(saved), true);
  assert.equal(saved.state, "saved");
  assertNoRawLeak(saved);
});

test("a pending submit is single-flight and retry from an invalid state refuses without any extra legacyInsert call", async () => {
  const mod = await importSurface();
  let legacyCalls = 0;
  let releaseLegacy;
  const pendingGate = new Promise((resolve) => {
    releaseLegacy = resolve;
  });
  const customerModuleApi = await buildRealCustomerModuleApi({
    legacyInsert: async () => {
      legacyCalls += 1;
      await pendingGate;
      return { legacy: true };
    },
  });

  const surface = mod.createCustomerSurface({ customerModuleApi });
  const record = baseRecord();
  const insertOptions = baseInsertOptions(record);
  const args = { actionSpec: baseActionSpec(), record, insertOptions };

  // retry with no prior submit is an invalid-state call: must refuse without calling legacyInsert
  await assert.rejects(() => surface.retry());
  assert.equal(legacyCalls, 0);

  const firstSubmit = surface.submit(args);
  const submittingProjection = surface.project();
  assert.equal(submittingProjection.state, "submitting");

  // a second submit while one is already in flight must not trigger a second legacyInsert call
  await assert.rejects(() => surface.submit(args));
  assert.equal(legacyCalls, 1);

  // retry while a submit is already pending is also an invalid-state call
  await assert.rejects(() => surface.retry());
  assert.equal(legacyCalls, 1);

  releaseLegacy();
  const result = await firstSubmit;
  assert.equal(result.state, "saved");
  assert.equal(legacyCalls, 1);
});
