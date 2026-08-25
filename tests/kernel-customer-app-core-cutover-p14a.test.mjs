import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P14a — customer-app-core composes the real P13 cutover controller behind an explicit
// opt-in export. Written pre-implementation; RED is honest: createCustomerAppCoreWithPersistence
// does not exist yet at the allowed path below.

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

test("createCustomerAppCoreWithPersistence reuses public-SDK and customer:core fail-closed validation before composing cutover", async () => {
  const mod = await importAppCore();
  assert.equal(typeof mod.createCustomerAppCoreWithPersistence, "function");
  const { sdkModule, coordinate } = await buildSdkModule();

  assert.throws(() =>
    mod.createCustomerAppCoreWithPersistence({
      sdk: sdkModule,
      coordinate: "wrong.coordinate@9",
      grantedCapabilities: ["customer:core"],
      cutoverOptions: baseCutoverOptions(),
    })
  );
  assert.throws(() =>
    mod.createCustomerAppCoreWithPersistence({
      sdk: sdkModule,
      coordinate,
      grantedCapabilities: [],
      cutoverOptions: baseCutoverOptions(),
    })
  );
});

test("createCustomerAppCoreWithPersistence returns a frozen composition with sdkCoordinate/status/persistence and touches no pool at construction", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();
  let poolFactoryCalls = 0;
  const appCore = mod.createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      poolFactory: () => {
        poolFactoryCalls += 1;
        return {};
      },
    }),
  });

  assert.equal(Object.isFrozen(appCore), true);
  assert.equal(appCore.sdkCoordinate, coordinate);
  assert.equal(appCore.status, "ready");
  assert.ok(appCore.persistence);
  assert.equal(appCore.persistence.activeWriter, "legacy");
  assert.equal(poolFactoryCalls, 0);
});

test("legacy default delegates insert with zero DB access, and a compatibility failure propagates without switching writers", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();
  let legacyCalls = 0;
  let poolFactoryCalls = 0;
  const marker = new Error("incompatible");
  const appCore = mod.createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      legacyInsert: async () => {
        legacyCalls += 1;
        return { legacy: true };
      },
      verifyCompatibility: async () => {
        throw marker;
      },
      poolFactory: () => {
        poolFactoryCalls += 1;
        return { connect: async () => ({ query: async () => ({}), release: () => {} }) };
      },
    }),
  });

  const record = { id: "1", tenant_id: "t1" };
  const result = await appCore.persistence.insert(record, { tenantId: "t1" });
  assert.deepEqual(result, { legacy: true });
  assert.equal(legacyCalls, 1);
  assert.equal(poolFactoryCalls, 0);

  await assert.rejects(() => appCore.persistence.cutover(), (err) => err === marker);
  assert.equal(appCore.persistence.activeWriter, "legacy");
});

test("explicit successful cutover then rollback/close route through the real P13 controller end to end", async () => {
  const mod = await importAppCore();
  const { sdkModule, coordinate } = await buildSdkModule();
  let legacyCalls = 0;
  let connects = 0;
  let ended = 0;
  const client = {
    query: async (sql) => {
      if (/INSERT INTO customer_records/i.test(sql)) {
        return {
          rows: [{
            id: "22222222-2222-2222-2222-222222222222",
            tenant_id: "11111111-1111-1111-1111-111111111111",
            name: "Ada Lovelace",
            payload: { plan: "pro" },
            created_at: new Date("2026-08-24T00:00:00.000Z"),
            recorded_at: new Date("2026-08-25T00:00:00.000Z"),
          }],
        };
      }
      return {};
    },
    release: () => {},
  };
  const pool = { connect: async () => { connects += 1; return client; }, end: async () => { ended += 1; } };

  const appCore = mod.createCustomerAppCoreWithPersistence({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      legacyInsert: async () => { legacyCalls += 1; },
      verifyCompatibility: async () => true,
      poolFactory: () => pool,
    }),
  });

  await appCore.persistence.cutover();
  assert.equal(appCore.persistence.activeWriter, "application");

  const record = {
    id: "22222222-2222-2222-2222-222222222222",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    name: "Ada Lovelace",
    payload: { plan: "pro" },
    created_at: "2026-08-24T00:00:00.000Z",
    recorded_at: "2026-08-25T00:00:00.000Z",
  };
  const inserted = await appCore.persistence.insert(record, { tenantId: record.tenant_id });
  assert.equal(legacyCalls, 0);
  assert.equal(Object.isFrozen(inserted), true);

  appCore.persistence.rollback();
  assert.equal(appCore.persistence.activeWriter, "legacy");
  await appCore.persistence.insert(record, { tenantId: record.tenant_id });
  assert.equal(legacyCalls, 1);

  await appCore.persistence.close();
  assert.equal(ended, 1);
  assert.ok(connects >= 1);

  const legacyAppCore = mod.createCustomerAppCore({ sdk: sdkModule, coordinate, grantedCapabilities: ["customer:core"] });
  assert.equal(legacyAppCore.status, "ready");
  assert.equal(legacyAppCore.persistence, undefined);
});
