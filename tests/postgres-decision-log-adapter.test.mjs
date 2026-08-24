import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "../src/application/action-primitives.mjs";
import {
  ActorId, CorrelationId, IdempotencyKey, Principal, TenantId,
} from "../src/domain/identity-primitives.mjs";
import { PolicyRequest, PolicyDecision } from "../src/application/policy-decision.mjs";
import { DecisionLogEntry } from "../src/application/decision-log-entry.mjs";
import { PolicyStatement } from "../src/application/policy-statement.mjs";

// =====================================================================================
// PostgresDecisionLogAdapter — P04e2, R2 correction. append(entry) is the whole surface: tenant
// is derived from entry.request.tenantId, never a caller-supplied option, matching
// DecisionLogPort's one-function `append(entry)` seam exactly -- `new DecisionLogPort({ append:
// adapter.append })`, a bare, bound-safe handoff with no .bind(adapter) anywhere. verifyPersistedDecisionLogRow and adapter.append both return
// the identical frozen receipt shape: { receiptType: "DecisionLogAppendReceipt", entryId,
// tenantId, entryHash, prevHash }. Every one of the DB's three chain-integrity violations
// (duplicate genesis, fork, orphan predecessor) surfaces as the same frozen, non-retryable
// DecisionLogChainConflictError code "DECISION_LOG_CHAIN_CONFLICT", distinguished only by its
// fields -- never by a per-violation code.
//
// Every test resolves the missing production module *inside its own body*, never at collection,
// so a fresh checkout without src/adapters/postgres-decision-log-adapter.mjs fails each of the
// three scenarios below on its own terms.
// =====================================================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterPath = "src/adapters/postgres-decision-log-adapter.mjs";
const adapterUrl = pathToFileURL(path.join(root, adapterPath)).href;

let loaded = null;
let loadError = null;
try {
  loaded = await import(adapterUrl);
} catch (error) {
  loadError = error;
}

function adapterMod(scenario, ...names) {
  assert.ok(loaded !== null, `[${scenario}] ${adapterPath} must exist and import cleanly: ${loadError?.message ?? "unknown import failure"}`);
  for (const name of names) assert.equal(typeof loaded[name], "function", `[${scenario}] ${adapterPath} must export ${name}`);
  return loaded;
}

// ---------------------------------------------------------------------------------------------
// Shared fixtures and canonicalization oracle.
// ---------------------------------------------------------------------------------------------

function makeEntry({ id, tenantUuid, prevHash, ts, note }) {
  const tenant = new TenantId(tenantUuid);
  const principal = new Principal(tenant, new ActorId("svc-billing-worker"));
  const correlation = new CorrelationId(crypto.randomUUID());
  const action = new Command({
    name: "billing.invoice.issue", version: 1, principal, correlationId: correlation,
    causationId: null, idempotencyKey: new IdempotencyKey(`key-${id}`), payload: { amount: 100, note },
  });
  const request = new PolicyRequest({ action, resource: { type: "invoice", id }, context: { channel: "api" } });
  const decision = new PolicyDecision({ effect: "allow", reason: "policy matched", matchedPolicyId: "pol-billing-issue", traceId: correlation });
  return new DecisionLogEntry({ id, request, decision, layerResolved: "tenant", ts, prevHash });
}

function expectedReceipt(entry) {
  return Object.freeze({
    receiptType: "DecisionLogAppendReceipt",
    entryId: entry.id,
    tenantId: entry.request.tenantId.toString(),
    entryHash: entry.entryHash,
    prevHash: entry.prevHash,
  });
}

// The same canonical field order and recursive descending-key rule
// src/application/decision-log-entry.mjs applies before hashing, reimplemented independently as
// the oracle a JSONB round-trip must still satisfy however Postgres reorders stored keys.
function descendingKeyOrder(value) {
  if (Array.isArray(value)) return value.map(descendingKeyOrder);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort().reverse()) out[key] = descendingKeyOrder(value[key]);
    return out;
  }
  return value;
}

// Simulates a JSONB round-trip's key reordering at every level -- ascending, the opposite of the
// entry's own canonicalization -- so a verifier trusting incoming order rather than recomputing
// canonically would see a different string and a different hash.
function ascendingKeyOrder(value) {
  if (Array.isArray(value)) return value.map(ascendingKeyOrder);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = ascendingKeyOrder(value[key]);
    return out;
  }
  return value;
}

function rowFor(entry) {
  const { entryHash, ...payload } = entry.toJSON();
  return {
    id: entry.id,
    tenant_id: entry.request.tenantId.toString(),
    entry_hash: entryHash,
    prev_hash: entry.prevHash,
    payload: ascendingKeyOrder(payload),
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Pure verifier matrix -- no DB, no Docker.
// ---------------------------------------------------------------------------------------------

test("PostgresDecisionLogAdapter contract: verifyPersistedDecisionLogRow's JSONB-order-independent matrix, and admission through append(entry)", async () => {
  const { PostgresDecisionLogAdapter, verifyPersistedDecisionLogRow } = adapterMod("1", "PostgresDecisionLogAdapter", "verifyPersistedDecisionLogRow");

  const genesis = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", tenantUuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis" });
  const successor = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", tenantUuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", prevHash: genesis.entryHash, ts: "2026-08-24T10:00:01.000Z", note: "successor" });

  const genesisRow = rowFor(genesis);
  assert.notDeepEqual(genesisRow.payload, genesis.toJSON(), "the fixture actually reorders keys, or this proves nothing");
  const genesisVerified = verifyPersistedDecisionLogRow(genesisRow);
  assert.deepEqual(genesisVerified, expectedReceipt(genesis), "a genuine, untampered genesis row verifies to the exact frozen receipt shape");
  assert.ok(Object.isFrozen(genesisVerified));

  const successorVerified = verifyPersistedDecisionLogRow(rowFor(successor));
  assert.deepEqual(successorVerified, expectedReceipt(successor));

  const cases = {
    "wrong hash": { ...genesisRow, entry_hash: "0".repeat(64) },
    "wrong id binding": { ...genesisRow, payload: { ...genesisRow.payload, id: "01ARZ3NDEKTSV4RRFFQ69G5FAX" } },
    "wrong tenant binding": { ...genesisRow, tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
    "wrong prevHash binding": { ...rowFor(successor), payload: { ...rowFor(successor).payload, prevHash: "0".repeat(64) } },
    "missing field": (() => { const { ts, ...rest } = genesisRow.payload; return { ...genesisRow, payload: rest }; })(),
    "extra field": { ...genesisRow, payload: { ...genesisRow.payload, unexpected: true } },
    "wrong type": { ...genesisRow, payload: { ...genesisRow.payload, ts: 1756029600000 } },
  };
  for (const [label, row] of Object.entries(cases)) {
    assert.throws(() => verifyPersistedDecisionLogRow(row), loaded.DecisionLogIntegrityError, `[${label}] must be refused`);
  }

  // Admission through append(entry): a genuine entry required, before any DB work reachable —
  // an unroutable port fails fast at connection, so anything but a shape-admission rejection here
  // would prove DB was reached.
  const adapter = new PostgresDecisionLogAdapter({ connectionString: "postgresql://user:pass@127.0.0.1:1/does-not-matter" });
  await assert.rejects(
    () => adapter.append({ id: genesis.id, request: genesis.request, decision: genesis.decision }),
    TypeError,
    "a plain object standing in for a DecisionLogEntry must be refused before any DB work",
  );
  await adapter.close?.();
});

// ---------------------------------------------------------------------------------------------
// Compact real-Postgres harness, shared by scenarios 2 and 3.
// ---------------------------------------------------------------------------------------------

const IMAGE = "postgres:16-alpine";
const MIGRATION_ROLE = "mfk_migration";
const RUNTIME_ROLE = "mfk_runtime";
const DATABASE = "mfk_p04e2_decision_log";

function dockerAvailable() {
  return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
}

function startContainer(superuserPassword) {
  const name = `mfk-p04e2-decision-log-${crypto.randomBytes(6).toString("hex")}`;
  execFileSync("docker", ["run", "-d", "--rm", "--name", name, "-e", `POSTGRES_PASSWORD=${superuserPassword}`, "-p", "127.0.0.1::5432", IMAGE], { stdio: ["ignore", "pipe", "pipe"] });
  return name;
}

function publishedPort(name) {
  const mapping = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim();
  return Number(mapping.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("[")).split(":").at(-1));
}

function waitReady(name, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (spawnSync("docker", ["exec", name, "pg_isready", "--quiet", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres"], { timeout: 5000 }).status === 0) return;
  }
  throw new Error(`${name} did not become ready in time`);
}

function stopContainer(name) {
  spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" });
}

async function withPg(host, port, user, password, database, fn) {
  const pgModule = await import("pg");
  const { Client } = pgModule.default ?? pgModule;
  const client = new Client({ host, port, user, password, database, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function runMigration(host, port, migrationPassword) {
  const url = `postgresql+psycopg://${MIGRATION_ROLE}:${migrationPassword}@${host}:${port}/${DATABASE}`;
  const code = [
    "from metaframer_kernel_db.migrations import alembic_config",
    "from alembic import command",
    `command.upgrade(alembic_config(${JSON.stringify(url)}, runtime_role=${JSON.stringify(RUNTIME_ROLE)}), 'head')`,
  ].join("\n");
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", code], { cwd: path.join(root, "db"), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`alembic upgrade failed:\n${result.stdout}\n${result.stderr}`);
}

async function bringUpSubstrate(t) {
  if (!dockerAvailable()) {
    throw new Error("docker is not available in this environment: this is an environment failure, not a PostgresDecisionLogAdapter capability gap, and must be reported separately");
  }
  const superuserPassword = crypto.randomUUID();
  const migrationPassword = crypto.randomUUID();
  const runtimePassword = crypto.randomUUID();
  const container = startContainer(superuserPassword);
  t.after(() => stopContainer(container));
  waitReady(container, 60000);
  const port = publishedPort(container);
  const host = "127.0.0.1";
  await withPg(host, port, "postgres", superuserPassword, "postgres", async (client) => {
    await client.query(`CREATE ROLE ${MIGRATION_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN PASSWORD '${migrationPassword}'`);
    await client.query(`CREATE ROLE ${RUNTIME_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT LOGIN PASSWORD '${runtimePassword}'`);
    await client.query(`CREATE DATABASE ${DATABASE} OWNER ${MIGRATION_ROLE}`);
    await client.query(`REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${RUNTIME_ROLE}`);
  });
  await withPg(host, port, "postgres", superuserPassword, DATABASE, async (client) => {
    await client.query(`ALTER SCHEMA public OWNER TO ${MIGRATION_ROLE}`);
    await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await client.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${RUNTIME_ROLE}`);
  });
  runMigration(host, port, migrationPassword);
  const connectionString = `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(runtimePassword)}@${host}:${port}/${DATABASE}`;
  return { host, port, runtimePassword, connectionString };
}

// A NOBYPASSRLS mfk_runtime-role query, entering the tenant's attested context exactly as
// db/metaframer_kernel_db/session.py does -- BEGIN, then SELECT mfk_begin_tenant_context(...) in
// the same transaction. Never the superuser: a superuser connection bypasses row-level security
// outright, which would prove nothing about tenant isolation. The runtime role is the only role
// this helper ever reads through, so a leak past FORCE RLS is genuinely observable.
async function withTenantRows(host, port, runtimePassword, tenantUuid, fn) {
  return withPg(host, port, RUNTIME_ROLE, runtimePassword, DATABASE, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT mfk_begin_tenant_context($1::uuid)", [tenantUuid]);
      return await fn(client);
    } finally {
      await client.query("COMMIT");
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Real round-trip through DecisionLogPort: tenant-isolated genesis and successor.
// ---------------------------------------------------------------------------------------------

test("the adapter round-trips tenant-isolated genesis and successor entries through DecisionLogPort against a real PostgreSQL 16 policy_decision_log, with frozen receipts, stored hash and predecessor proof", async (t) => {
  const { PostgresDecisionLogAdapter } = adapterMod("2", "PostgresDecisionLogAdapter");
  const { DecisionLogPort } = await import(pathToFileURL(path.join(root, "src/application/decision-log-port.mjs")).href);

  const { host, port, runtimePassword, connectionString } = await bringUpSubstrate(t);
  const adapter = new PostgresDecisionLogAdapter({ connectionString });
  // A bare, bound-safe direct handoff -- no .bind(adapter) -- proving append never depends on
  // its receiver identity, the same requirement DecisionLogPort's admission already assumes.
  const logPort = new DecisionLogPort({ append: adapter.append });

  try {
    const tenantAUuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const tenantBUuid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    const genesisA = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", tenantUuid: tenantAUuid, prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis-a" });
    const genesisReceipt = await logPort.append(genesisA);
    assert.deepEqual(genesisReceipt, expectedReceipt(genesisA));

    const successorA = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", tenantUuid: tenantAUuid, prevHash: genesisA.entryHash, ts: "2026-08-24T10:00:01.000Z", note: "successor-a" });
    const successorReceipt = await logPort.append(successorA);
    assert.deepEqual(successorReceipt, expectedReceipt(successorA));
    assert.equal(successorReceipt.prevHash, genesisA.entryHash, "the successor receipt's predecessor proof is genesis's own stored hash");

    const genesisB = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FBV", tenantUuid: tenantBUuid, prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis-b" });
    const genesisBReceipt = await logPort.append(genesisB);
    assert.deepEqual(genesisBReceipt, expectedReceipt(genesisB));

    const rowsA = await withTenantRows(host, port, runtimePassword, tenantAUuid, (client) =>
      client.query('SELECT "id", "tenant_id", "entry_hash", "prev_hash" FROM "policy_decision_log" ORDER BY "recorded_at"'));
    assert.deepEqual(rowsA.rows.map((r) => r.id), [genesisA.id, successorA.id]);
    assert.equal(rowsA.rows[0].entry_hash, genesisA.entryHash);
    assert.equal(rowsA.rows[0].prev_hash, null);
    assert.equal(rowsA.rows[1].prev_hash, genesisA.entryHash);

    const rowsB = await withTenantRows(host, port, runtimePassword, tenantBUuid, (client) =>
      client.query('SELECT "id" FROM "policy_decision_log" ORDER BY "recorded_at"'));
    assert.deepEqual(rowsB.rows.map((r) => r.id), [genesisB.id], "tenant B's attested context must never see tenant A's rows");
  } finally {
    await adapter.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Real duplicate genesis, fork and orphan predecessor conflicts, with rollback.
// ---------------------------------------------------------------------------------------------

test("the adapter refuses a real duplicate genesis, fork and orphan predecessor as the same frozen typed conflict, rolling back so the valid chain is left unchanged", async (t) => {
  const { PostgresDecisionLogAdapter, DecisionLogChainConflictError } = adapterMod("3", "PostgresDecisionLogAdapter");

  const { host, port, runtimePassword, connectionString } = await bringUpSubstrate(t);
  const adapter = new PostgresDecisionLogAdapter({ connectionString });

  try {
    const tenantUuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const genesis = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", tenantUuid, prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis" });
    await adapter.append(genesis);
    const successor = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", tenantUuid, prevHash: genesis.entryHash, ts: "2026-08-24T10:00:01.000Z", note: "successor" });
    await adapter.append(successor);

    async function rowsForTenant() {
      return withTenantRows(host, port, runtimePassword, tenantUuid, (client) =>
        client.query('SELECT "id", "entry_hash", "prev_hash" FROM "policy_decision_log" ORDER BY "recorded_at"'));
    }
    const validAfterSetup = await rowsForTenant();
    assert.deepEqual(validAfterSetup.rows.map((r) => r.id), [genesis.id, successor.id]);

    async function rejectsAsChainConflict(entry, expectedFields) {
      await assert.rejects(
        () => adapter.append(entry),
        (error) => {
          assert.ok(error instanceof DecisionLogChainConflictError);
          assert.ok(Object.isFrozen(error));
          assert.equal(error.code, "DECISION_LOG_CHAIN_CONFLICT");
          assert.equal(error.retryable, false);
          for (const [field, value] of Object.entries(expectedFields)) assert.equal(error[field], value);
          return true;
        },
      );
    }

    // Duplicate genesis: a second prevHash-null row for the same tenant.
    const secondGenesis = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAX", tenantUuid, prevHash: null, ts: "2026-08-24T10:00:02.000Z", note: "second-genesis" });
    await rejectsAsChainConflict(secondGenesis, { tenantId: tenantUuid, entryId: secondGenesis.id, prevHash: null });

    // Fork: a second row also claiming the already-succeeded genesis as its predecessor.
    const fork = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAY", tenantUuid, prevHash: genesis.entryHash, ts: "2026-08-24T10:00:03.000Z", note: "fork" });
    await rejectsAsChainConflict(fork, { tenantId: tenantUuid, entryId: fork.id, prevHash: genesis.entryHash });

    // Orphan: prevHash naming a hash that was never written.
    const orphan = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ", tenantUuid, prevHash: "f".repeat(64), ts: "2026-08-24T10:00:04.000Z", note: "orphan" });
    await rejectsAsChainConflict(orphan, { tenantId: tenantUuid, entryId: orphan.id, prevHash: "f".repeat(64) });

    const validAfterConflicts = await rowsForTenant();
    assert.deepEqual(validAfterConflicts.rows, validAfterSetup.rows, "the valid chain must be exactly unchanged after every rejected append");
  } finally {
    await adapter.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 4. policyDecisionLogComposition — strict admission, frozen bound-safe facade, no eager I/O.
// No DB, no Docker: construction alone must never reach the network.
// ---------------------------------------------------------------------------------------------

const compositionRelative = "src/delivery/policy-decision-log-composition.mjs";
const compositionUrl = pathToFileURL(path.join(root, compositionRelative)).href;

function genuineStatement(overrides = {}) {
  return new PolicyStatement({
    id: "pol-billing-issue",
    effect: "allow",
    targetActor: {},
    targetAction: "billing.invoice.issue",
    targetResourceType: "invoice",
    condition: {},
    priority: 100,
    layer: "tenant",
    version: "1.0.0",
    enabled: true,
    ...overrides,
  });
}

test("policyDecisionLogComposition admits strict composition options, hands back a frozen bound-safe {decide, decideAll, close} facade, and performs no eager I/O", async () => {
  let compositionLoaded = null;
  let compositionLoadError = null;
  try {
    compositionLoaded = await import(compositionUrl);
  } catch (error) {
    compositionLoadError = error;
  }
  assert.ok(
    compositionLoaded !== null && typeof compositionLoaded.policyDecisionLogComposition === "function",
    `${compositionRelative} must exist, import cleanly and export policyDecisionLogComposition: `
      + `${compositionLoadError?.message ?? "policyDecisionLogComposition export missing"}`,
  );
  const { policyDecisionLogComposition } = compositionLoaded;

  const untouchable = (label) => () => { throw new Error(`${label} must not run during composition construction`); };
  const validOptions = () => ({
    connectionString: "postgresql://user:pass@127.0.0.1:1/does-not-matter",
    statements: [genuineStatement()],
    idGenerator: untouchable("idGenerator"),
    now: untouchable("now"),
  });

  for (const bad of [
    undefined,
    null,
    "connectionString",
    {},
    { ...validOptions(), extra: 1 },
    (() => { const { connectionString, ...rest } = validOptions(); return rest; })(),
    (() => { const { statements, ...rest } = validOptions(); return rest; })(),
    (() => { const { idGenerator, ...rest } = validOptions(); return rest; })(),
    (() => { const { now, ...rest } = validOptions(); return rest; })(),
    { ...validOptions(), connectionString: "" },
    { ...validOptions(), connectionString: 1 },
    { ...validOptions(), statements: "not-an-array" },
    { ...validOptions(), statements: [{ id: "not-genuine" }] },
    { ...validOptions(), idGenerator: "not-a-function" },
    { ...validOptions(), now: "not-a-function" },
  ]) {
    assert.throws(() => policyDecisionLogComposition(bad), TypeError, `expected a refusal for ${JSON.stringify(bad)}`);
  }

  // Construction is synchronous and reaches no network: an unroutable connectionString and
  // idGenerator/now collaborators wired to throw the moment they are ever called must both
  // survive composition untouched.
  const composition = policyDecisionLogComposition(validOptions());
  assert.ok(!(composition instanceof Promise), "policyDecisionLogComposition must return synchronously, never a Promise");

  try {
    assert.ok(Object.isFrozen(composition), "the composition result must be frozen");
    assert.deepEqual(Reflect.ownKeys(composition).sort(), ["close", "decide", "decideAll"], "the composition must hand back exactly { decide, decideAll, close } and nothing else");
    for (const key of ["decide", "decideAll", "close"]) assert.equal(typeof composition[key], "function", `composition.${key} must be a function`);

    // Bound-safe: destructuring must not strip a receiver dependency. A private-field access
    // failure ("Cannot read private member ... from an object whose class did not declare it")
    // would surface as a TypeError with no mention of the collaborator being validated; the
    // genuine admission failure below names PolicyRequest/array explicitly, so asserting the
    // message distinguishes the two.
    const { decide, decideAll } = composition;
    await assert.rejects(
      () => decide({}),
      (error) => error instanceof TypeError && /PolicyRequest/.test(error.message),
      "decide must be bound-safe: called detached from the composition object, it must still reach its own admission check rather than fail on receiver identity",
    );
    await assert.rejects(
      () => decideAll("not-an-array"),
      (error) => error instanceof TypeError && /array/i.test(error.message),
      "decideAll must be bound-safe likewise",
    );
  } finally {
    await composition.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 5. PostgresDecisionLogAdapter#chainHead(tenantId) against a real PostgreSQL 16
// policy_decision_log: empty, genesis, successor and tenant isolation.
// ---------------------------------------------------------------------------------------------

test("adapter.chainHead(tenantId) answers null on an empty tenant, the genesis hash after one append, the successor hash once a same-tenant successor exists, and stays tenant-isolated", async (t) => {
  const { PostgresDecisionLogAdapter } = adapterMod("5", "PostgresDecisionLogAdapter");
  assert.equal(typeof PostgresDecisionLogAdapter.prototype.chainHead, "function", "PostgresDecisionLogAdapter must expose an instance method chainHead(tenantId)");

  const { connectionString } = await bringUpSubstrate(t);
  const adapter = new PostgresDecisionLogAdapter({ connectionString });
  // A bare, bound-safe direct handoff -- no .bind(adapter) -- proving chainHead never depends on
  // its receiver identity. Every chain-head read below goes through this detached function.
  const { chainHead } = adapter;

  try {
    const tenantAUuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const tenantBUuid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const tenantA = new TenantId(tenantAUuid);
    const tenantB = new TenantId(tenantBUuid);

    assert.equal(await chainHead(tenantA), null, "an empty tenant has no chain head");

    const genesis = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FCV", tenantUuid: tenantAUuid, prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis" });
    await adapter.append(genesis);
    assert.equal(await chainHead(tenantA), genesis.entryHash, "with only a genesis row, its own entry_hash is the chain head -- no same-tenant successor references it yet");

    assert.equal(await chainHead(tenantB), null, "tenant B still has no chain head after tenant A's genesis append");

    const successor = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FCW", tenantUuid: tenantAUuid, prevHash: genesis.entryHash, ts: "2026-08-24T10:00:01.000Z", note: "successor" });
    await adapter.append(successor);
    assert.equal(
      await chainHead(tenantA),
      successor.entryHash,
      "once a same-tenant successor references genesis's entry_hash as its own prev_hash, genesis is no longer terminal -- the successor's own entry_hash is the new chain head",
    );

    const genesisB = makeEntry({ id: "01ARZ3NDEKTSV4RRFFQ69G5FDV", tenantUuid: tenantBUuid, prevHash: null, ts: "2026-08-24T10:00:00.000Z", note: "genesis-b" });
    await adapter.append(genesisB);
    assert.equal(await chainHead(tenantB), genesisB.entryHash, "tenant B's own genesis becomes its own chain head, independent of tenant A's chain");
    assert.equal(await chainHead(tenantA), successor.entryHash, "tenant A's chain head must be unaffected by tenant B's append");
  } finally {
    await adapter.close();
  }
});

// ---------------------------------------------------------------------------------------------
// 6. Real resolver -> policy decision -> append composition: allow/default-deny, second
// same-tenant chaining, multi-tenant decideAll, and mid-batch failure semantics (a persisted
// prefix stays persisted; later requests never run -- this is NOT atomic rollback).
// ---------------------------------------------------------------------------------------------

function policyRequestFor({ tenantUuid, resourceId, actionName = "billing.invoice.issue" }) {
  const tenant = new TenantId(tenantUuid);
  const principal = new Principal(tenant, new ActorId("svc-billing-worker"));
  const correlation = new CorrelationId(crypto.randomUUID());
  const action = new Command({
    name: actionName, version: 1, principal, correlationId: correlation,
    causationId: null, idempotencyKey: new IdempotencyKey(`key-${resourceId}`), payload: { amount: 100 },
  });
  return new PolicyRequest({ action, resource: { type: "invoice", id: resourceId }, context: { channel: "api" } });
}

function sequentialIdGenerator(ids) {
  let i = 0;
  return () => ids[i++];
}

function sequentialNow(startSeconds) {
  let s = startSeconds;
  return async () => {
    const ts = `2026-08-24T11:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000Z`;
    s += 1;
    return ts;
  };
}

test("real resolver -> policy decision -> append composition: allow and default-deny, second same-tenant chaining, multi-tenant decideAll, and mid-batch failure leaves the persisted prefix and never runs later requests", async (t) => {
  let compositionLoaded = null;
  let compositionLoadError = null;
  try {
    compositionLoaded = await import(compositionUrl);
  } catch (error) {
    compositionLoadError = error;
  }
  assert.ok(
    compositionLoaded !== null && typeof compositionLoaded.policyDecisionLogComposition === "function",
    `${compositionRelative} must exist, import cleanly and export policyDecisionLogComposition: `
      + `${compositionLoadError?.message ?? "policyDecisionLogComposition export missing"}`,
  );
  const { policyDecisionLogComposition } = compositionLoaded;

  const { host, port, runtimePassword, connectionString } = await bringUpSubstrate(t);

  async function rowsForTenant(tenantUuid) {
    return withTenantRows(host, port, runtimePassword, tenantUuid, (client) =>
      client.query('SELECT "id", "entry_hash", "prev_hash" FROM "policy_decision_log" ORDER BY "recorded_at"'));
  }

  const tenantAUuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const tenantBUuid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  // -- allow, then default-deny, chaining as the second entry for the same tenant, then
  // multi-tenant decideAll -- all through the real facade, never the manually wired collaborators. --
  const facade1 = policyDecisionLogComposition({
    connectionString,
    statements: [genuineStatement()],
    idGenerator: sequentialIdGenerator(["01ARZ3NDEKTSV4RRFFQ69G5FEA", "01ARZ3NDEKTSV4RRFFQ69G5FEB", "01ARZ3NDEKTSV4RRFFQ69G5FEC", "01ARZ3NDEKTSV4RRFFQ69G5FED"]),
    now: sequentialNow(0),
  });

  try {
    const allowRequest = policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-allow" });
    const allowDecision = await facade1.decide(allowRequest);
    assert.equal(allowDecision.effect, "allow");
    assert.equal(allowDecision.matchedPolicyId, "pol-billing-issue");

    const denyRequest = policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-deny", actionName: "billing.invoice.void" });
    const denyDecision = await facade1.decide(denyRequest);
    assert.equal(denyDecision.effect, "deny");
    assert.equal(denyDecision.matchedPolicyId, null, "no statement targets billing.invoice.void, so this is a genuine default-deny");

    const rowsAfterPair = await rowsForTenant(tenantAUuid);
    assert.equal(rowsAfterPair.rows.length, 2);
    assert.equal(rowsAfterPair.rows[0].prev_hash, null, "the allow decision is genesis for this tenant");
    assert.equal(rowsAfterPair.rows[1].prev_hash, rowsAfterPair.rows[0].entry_hash, "the default-deny decision chains as this tenant's second entry, from the allow entry's own stored hash");

    // -- multi-tenant decideAll: independent per-tenant chains in one batch. --
    const batchRequests = [
      policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-batch-a" }),
      policyRequestFor({ tenantUuid: tenantBUuid, resourceId: "inv-batch-b" }),
    ];
    const batchDecisions = await facade1.decideAll(batchRequests);
    assert.equal(batchDecisions.length, 2);
    assert.equal(batchDecisions[0].effect, "allow");
    assert.equal(batchDecisions[1].effect, "allow");

    const rowsAAfterBatch = await rowsForTenant(tenantAUuid);
    assert.equal(rowsAAfterBatch.rows.length, 3, "tenant A's chain grows by exactly one more entry");
    assert.equal(rowsAAfterBatch.rows[2].prev_hash, rowsAAfterBatch.rows[1].entry_hash);

    const rowsBAfterBatch = await rowsForTenant(tenantBUuid);
    assert.equal(rowsBAfterBatch.rows.length, 1, "tenant B's batch entry is a genesis, independent of tenant A's chain");
    assert.equal(rowsBAfterBatch.rows[0].prev_hash, null);
  } finally {
    await facade1.close();
  }

  // -- mid-batch failure: a second real composition on the same DB whose idGenerator hands back
  // one id and then throws the exact sentinel on its second call. The first, already-decided
  // request stays persisted -- this is NOT atomic rollback -- and the third request must never
  // reach idGenerator at all. --
  const sentinel = new Error("mid-batch idGenerator exploded");
  let idGeneratorCalls = 0;
  const explodingIdGenerator = () => {
    idGeneratorCalls += 1;
    if (idGeneratorCalls === 2) throw sentinel;
    return ["01ARZ3NDEKTSV4RRFFQ69G5FEE", "01ARZ3NDEKTSV4RRFFQ69G5FEF"][idGeneratorCalls - 1];
  };
  const facade2 = policyDecisionLogComposition({
    connectionString,
    statements: [genuineStatement()],
    idGenerator: explodingIdGenerator,
    now: sequentialNow(20),
  });

  try {
    const rowsABeforeMidBatch = await rowsForTenant(tenantAUuid);
    const midBatchRequests = [
      policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-mid-1" }),
      policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-mid-2" }),
      policyRequestFor({ tenantUuid: tenantAUuid, resourceId: "inv-mid-3" }),
    ];
    await assert.rejects(() => facade2.decideAll(midBatchRequests), (error) => error === sentinel);
    assert.equal(idGeneratorCalls, 2, "the third request must never reach idGenerator once the second one's idGenerator call throws");

    const rowsAAfterMidBatch = await rowsForTenant(tenantAUuid);
    assert.equal(
      rowsAAfterMidBatch.rows.length,
      rowsABeforeMidBatch.rows.length + 1,
      "the first mid-batch request's entry was already persisted before the second one failed, and stays persisted -- decideAll is not atomic rollback",
    );
    assert.equal(
      rowsAAfterMidBatch.rows[rowsAAfterMidBatch.rows.length - 1].prev_hash,
      rowsABeforeMidBatch.rows[rowsABeforeMidBatch.rows.length - 1].entry_hash,
      "the one persisted mid-batch entry chains from the last entry already in place before this composition ran",
    );
  } finally {
    await facade2.close();
  }
});
