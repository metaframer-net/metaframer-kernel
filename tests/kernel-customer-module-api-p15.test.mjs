import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// P15 — typed customer-module-api consumer boundary. Written pre-implementation; RED is honest:
// consumers/customer-app-core/customer-module-api.mjs does not exist yet at the allowed path below.
// Excludes Surface/host/relay/DB/readiness: cutoverOptions default to the legacy writer, and
// poolFactory throws if the application-writer/DB path is ever touched.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_API_PATH = "consumers/customer-app-core/customer-module-api.mjs";

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

test("CUSTOMER_MODULE_API_MANIFEST is frozen and createCustomerModuleApi returns a frozen ready handle for a valid config", async () => {
  const mod = await importModuleApi();

  assert.equal(typeof mod.CUSTOMER_MODULE_API_MANIFEST, "object");
  assert.equal(Object.isFrozen(mod.CUSTOMER_MODULE_API_MANIFEST), true);
  assert.equal(mod.CUSTOMER_MODULE_API_MANIFEST.appSlug, "customer");
  assert.ok(Array.isArray(mod.CUSTOMER_MODULE_API_MANIFEST.requiredCapabilities));
  assert.ok(mod.CUSTOMER_MODULE_API_MANIFEST.requiredCapabilities.includes("customer:core"));
  assert.equal(mod.CUSTOMER_MODULE_API_MANIFEST.defaultDeny, true);

  assert.equal(typeof mod.createCustomerModuleApi, "function");
  const { sdkModule, coordinate } = await buildSdkModule();

  const api = mod.createCustomerModuleApi({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions(),
  });

  assert.equal(Object.isFrozen(api), true);
  assert.equal(api.sdkCoordinate, coordinate);
  assert.equal(api.status, "ready");
  assert.equal(typeof api.recordCustomer, "function");
});

test("createCustomerModuleApi fails closed on an invalid SDK, wrong coordinate, or missing capability, touching no pool", async () => {
  const mod = await importModuleApi();
  const { sdkModule, coordinate } = await buildSdkModule();
  let poolFactoryCalls = 0;
  const cutoverOptions = baseCutoverOptions({
    poolFactory: () => {
      poolFactoryCalls += 1;
      return {};
    },
  });

  assert.throws(() =>
    mod.createCustomerModuleApi({
      sdk: { not: "a valid sdk" },
      coordinate,
      grantedCapabilities: ["customer:core"],
      cutoverOptions,
    })
  );
  assert.throws(() =>
    mod.createCustomerModuleApi({
      sdk: sdkModule,
      coordinate: "wrong.coordinate@9",
      grantedCapabilities: ["customer:core"],
      cutoverOptions,
    })
  );
  assert.throws(() =>
    mod.createCustomerModuleApi({
      sdk: sdkModule,
      coordinate,
      grantedCapabilities: [],
      cutoverOptions,
    })
  );

  assert.equal(poolFactoryCalls, 0);
});

test("recordCustomer rejects a tenant or audit/outbox correlation mismatch before ever calling legacyInsert", async () => {
  const mod = await importModuleApi();
  const { sdkModule, coordinate } = await buildSdkModule();
  let legacyCalls = 0;
  const api = mod.createCustomerModuleApi({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      legacyInsert: async () => {
        legacyCalls += 1;
        return { legacy: true };
      },
    }),
  });

  const record = baseRecord();

  // malformed: missing actionSpec entirely
  await assert.rejects(() => api.recordCustomer({ record, insertOptions: baseInsertOptions(record) }));

  // tenant mismatch: insertOptions.tenantId does not match record.tenant_id
  await assert.rejects(() =>
    api.recordCustomer({
      actionSpec: baseActionSpec(),
      record,
      insertOptions: { ...baseInsertOptions(record), tenantId: "99999999-9999-9999-9999-999999999999" },
    })
  );

  // correlation mismatch: audit.correlationId does not match transactionalOutbox.correlationId
  const mismatchedOptions = baseInsertOptions(record);
  mismatchedOptions.transactionalOutbox = { ...mismatchedOptions.transactionalOutbox, correlationId: "corr-2" };
  await assert.rejects(() =>
    api.recordCustomer({
      actionSpec: baseActionSpec(),
      record,
      insertOptions: mismatchedOptions,
    })
  );

  assert.equal(legacyCalls, 0);
});

test("recordCustomer validates the actionSpec via the P08 SDK, delegates to legacyInsert exactly once, and returns a frozen {ok:true,record}", async () => {
  const mod = await importModuleApi();
  const { sdkModule, coordinate } = await buildSdkModule();
  let legacyCalls = 0;
  let lastLegacyArgs;
  const api = mod.createCustomerModuleApi({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      legacyInsert: async (record, insertOptions) => {
        legacyCalls += 1;
        lastLegacyArgs = [record, insertOptions];
        return { legacy: true };
      },
    }),
  });

  const record = baseRecord();
  const insertOptions = baseInsertOptions(record);
  const result = await api.recordCustomer({ actionSpec: baseActionSpec(), record, insertOptions });

  assert.equal(legacyCalls, 1);
  assert.deepEqual(lastLegacyArgs[0], record);
  assert.deepEqual(lastLegacyArgs[1], insertOptions);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.record, record);

  // an actionSpec missing a required P08 field must fail closed before legacyInsert is touched
  const { requestId, ...incompleteActionSpec } = baseActionSpec();
  await assert.rejects(() =>
    api.recordCustomer({ actionSpec: incompleteActionSpec, record, insertOptions: baseInsertOptions(record) })
  );
  assert.equal(legacyCalls, 1);
});

test("recordCustomer propagates a legacyInsert rejection by identity without swallowing it", async () => {
  const mod = await importModuleApi();
  const { sdkModule, coordinate } = await buildSdkModule();
  const marker = new Error("legacy insert unavailable");
  const api = mod.createCustomerModuleApi({
    sdk: sdkModule,
    coordinate,
    grantedCapabilities: ["customer:core"],
    cutoverOptions: baseCutoverOptions({
      legacyInsert: async () => {
        throw marker;
      },
    }),
  });

  const record = baseRecord();
  await assert.rejects(
    () => api.recordCustomer({ actionSpec: baseActionSpec(), record, insertOptions: baseInsertOptions(record) }),
    (err) => err === marker
  );
});
