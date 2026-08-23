import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import path from "node:path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15f-python-bridge-real-pg-allow.json", import.meta.url),
);
const V15E_PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15e-real-js-boundary-runner-deny.json", import.meta.url),
);
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");

async function loadJson(p) {
  return JSON.parse(await readFile(p, "utf-8"));
}

const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR = "runner-actor";
const TENANT = "55555555-5555-4555-8555-555555555555";

function pyScript(scenario) {
  return `
import asyncio
import sys
sys.path.insert(0, ${JSON.stringify(PACKAGE_ROOT)})
sys.path.insert(0, ${JSON.stringify(path.dirname(PACKAGE_ROOT))})
from python_asgi import StdioJsAsgiBridge

async def main():
    ${scenario}

asyncio.run(main())
`;
}

async function runPython(script) {
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "v15f-runner-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await execFileAsync("python3", [scriptPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function postCustomersScopeLiteral({ tenant = TENANT, actor = ACTOR, requestId = REQUEST_ID, idempotencyKey = "order-runner-1" } = {}) {
  return `{
        "type": "http",
        "method": "POST",
        "path": "/customers",
        "headers": [
            ["content-type", "application/json"],
            ["x-request-id", ${JSON.stringify(requestId)}],
            ["x-actor-id", ${JSON.stringify(actor)}],
            ["x-tenant-id", ${JSON.stringify(tenant)}],
            ["idempotency-key", ${JSON.stringify(idempotencyKey)}],
        ],
    }`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadJson(PLANNING_PATH);
  assert.equal(planning.id, "gj01-v15f-python-bridge-real-pg-allow-2026-08-23");
  assert.equal(planning.packageKind, "python-bridge-real-pg-allow-smoke");
  assert.equal(planning.type, "python-bridge-real-pg-allow-smoke");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15e-real-js-boundary-runner-deny.json");
  assert.equal(planning.prerequisite.id, "gj01-v15e-real-js-boundary-runner-deny-2026-08-23");
  assert.equal(planning.bridgeInThisPackage, true);
  assert.equal(planning.realJsBoundaryRunner, true);
  assert.equal(planning.realPostgresThroughPythonBridge, true);
  assert.equal(planning.hostSelected, false);
  assert.equal(planning.interopMechanism, "subprocess-stdio-envelope");
  assert.equal(planning.smokePath, "ALLOW_REAL_POSTGRES");
  assert.equal(planning.runnableProduct, false);
  assert.equal(planning.flags.runnableProduct, false);
  assert.equal(planning.flags.kernelReady, false);
  assert.equal(planning.flags.oneGoldenSliceReady, false);
  assert.equal(planning.flags.walkingSkeletonReady, false);
  assert.equal(planning.flags.appBuildable, false);
  assert.equal(planning.flags.releaseAllowed, false);
  assert.equal(planning.flags.deployAllowed, false);
  assert.equal(planning.flags.productionAllowed, false);
  assert.equal(planning.flags.gapClosed, false);

  const nonGoals = planning.nonGoals.join(" | ").toLowerCase();
  assert.match(nonGoals, /no src\/\*\* change/);
  assert.match(nonGoals, /no python host bridge code change/);
  assert.match(nonGoals, /no package\.json, dependency, lockfile, ci\/workflow\/config, pyproject or uv\.lock change/);
  assert.match(nonGoals, /no network listener, socket server, http server, docker config, fastapi, django, uvicorn or hypercorn/);
  assert.match(nonGoals, /no release, deploy, production, or runnable product claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^PYTHON_BRIDGE_REAL_JS_BOUNDARY_REAL_POSTGRES_ALLOW_SMOKE:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }

  const v15ePlanning = await loadJson(V15E_PLANNING_PATH);
  assert.equal(v15ePlanning.id, planning.prerequisite.id);
});

test("runner module has valid syntax", async () => {
  await execFileAsync("node", ["--check", RUNNER_PATH]);
});

test("default DENY runner behavior still works without a database (V15E path preserved)", async () => {
  const script = pyScript(`
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER_PATH)}])
    scope = ${postCustomersScopeLiteral()}

    async def receive():
        return {"type": "http.request", "body": b'{"name": "Ada Lovelace"}', "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 403, sent
    import json
    payload = json.loads(sent[1]["body"])
    assert payload["error"]["code"] == "POLICY_DENY", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("explicit --policy deny runner behavior is identical to the no-args default", async () => {
  const script = pyScript(`
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER_PATH)}, "--policy", "deny"])
    scope = ${postCustomersScopeLiteral()}

    async def receive():
        return {"type": "http.request", "body": b'{"name": "Ada Lovelace"}', "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 403, sent
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("malformed CLI args exit non-zero with deterministic stderr: --policy allow without --connection-string", () => {
  const result = spawnSync("node", [RUNNER_PATH, "--policy", "allow"], {
    input: JSON.stringify({ scope: { type: "http", method: "POST", path: "/customers", headers: [] }, bodyBase64: "" }),
    encoding: "utf-8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create_customer_asgi_runner: malformed CLI args/);
});

test("malformed CLI args exit non-zero with deterministic stderr: invalid --policy value", () => {
  const result = spawnSync("node", [RUNNER_PATH, "--policy", "nope"], {
    input: JSON.stringify({ scope: { type: "http", method: "POST", path: "/customers", headers: [] }, bodyBase64: "" }),
    encoding: "utf-8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create_customer_asgi_runner: malformed CLI args/);
});

test("malformed CLI args exit non-zero with deterministic stderr: unrecognized flag", () => {
  const result = spawnSync("node", [RUNNER_PATH, "--bogus", "x"], {
    input: JSON.stringify({ scope: { type: "http", method: "POST", path: "/customers", headers: [] }, bodyBase64: "" }),
    encoding: "utf-8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create_customer_asgi_runner: malformed CLI args/);
});

test("malformed envelope sent directly to the runner exits non-zero with deterministic stderr", () => {
  const result = spawnSync("node", [RUNNER_PATH], {
    input: "not json{{{",
    encoding: "utf-8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create_customer_asgi_runner:/);
});

test("this package changes no src/**, Python bridge, package/dependency/lock/CI/config/pyproject/uv.lock files relative to HEAD", async () => {
  const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO_ROOT });
  const { stdout: stagedStdout } = await execFileAsync("git", ["diff", "--name-only", "--cached", "HEAD"], { cwd: REPO_ROOT });
  const { stdout: untrackedStdout } = await execFileAsync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT },
  );
  const changedFiles = [
    ...stdout.split("\n"),
    ...stagedStdout.split("\n"),
    ...untrackedStdout.split("\n"),
  ].map((f) => f.trim()).filter(Boolean);

  const forbiddenPatterns = [
    /^src\//,
    /^host\/python_asgi\//,
    /^package\.json$/,
    /^package-lock\.json$/,
    /^npm-shrinkwrap\.json$/,
    /^yarn\.lock$/,
    /^pnpm-lock\.yaml$/,
    /^\.github\//,
    /^\.gitlab-ci\.yml$/,
    /pyproject\.toml$/,
    /^uv\.lock$/,
  ];

  for (const file of changedFiles) {
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(file, pattern, `unexpected forbidden-path change: ${file}`);
    }
  }
});

// =====================================================================================
// GJ-01 V15F — real PostgreSQL ALLOW commit through the Python bridge + real JS runner.
//
// Reuses the Docker/Postgres/migration helper shape from tests/kernel-create-customer-asgi-
// composition.test.mjs and tests/postgres-commit-adapter.test.mjs, but drives the request
// through the Python StdioJsAsgiBridge -> subprocess JS runner path instead of calling the
// JS composition directly in-process.
// =====================================================================================

const IMAGE = "postgres:16-alpine";
const SUPERUSER_PASSWORD = crypto.randomUUID();
const MIGRATION_PASSWORD = crypto.randomUUID();
const RUNTIME_PASSWORD = crypto.randomUUID();
const MIGRATION_ROLE = "mfk_migration";
const RUNTIME_ROLE = "mfk_runtime";
const DATABASE = "mfk_v15f_bridge_allow";

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  return result.status === 0;
}

function startContainer() {
  const name = `mfk-v15f-bridge-allow-${crypto.randomBytes(6).toString("hex")}`;
  execFileSync("docker", [
    "run", "-d", "--rm",
    "--name", name,
    "-e", `POSTGRES_PASSWORD=${SUPERUSER_PASSWORD}`,
    "-p", "127.0.0.1::5432",
    IMAGE,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return name;
}

function publishedPort(name) {
  const mapping = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim();
  const line = mapping.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("["));
  return Number(line.split(":").at(-1));
}

function waitReady(name, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const result = spawnSync("docker", [
      "exec", name, "pg_isready", "--quiet", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres",
    ], { timeout: 5000 });
    if (result.status === 0) return;
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

function runMigration(host, port) {
  const url = `postgresql+psycopg://${MIGRATION_ROLE}:${MIGRATION_PASSWORD}@${host}:${port}/${DATABASE}`;
  const code = [
    "from metaframer_kernel_db.migrations import alembic_config",
    "from alembic import command",
    `command.upgrade(alembic_config(${JSON.stringify(url)}, runtime_role=${JSON.stringify(RUNTIME_ROLE)}), 'head')`,
  ].join("\n");
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", code], {
    cwd: path.join(REPO_ROOT, "db"),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`alembic upgrade failed:\n${result.stdout}\n${result.stderr}`);
  }
}

test("Python StdioJsAsgiBridge + real JS runner --policy allow carries POST /customers to a real PostgreSQL 16 commit, with duplicate-request 409 proof", async (t) => {
  if (!dockerAvailable()) {
    throw new Error(
      "docker is not available in this environment: this is an environment failure, not a " +
        "bridge/runner capability gap, and must be reported separately",
    );
  }

  const container = startContainer();
  t.after(() => stopContainer(container));
  waitReady(container, 60000);
  const port = publishedPort(container);
  const host = "127.0.0.1";

  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, "postgres", async (client) => {
    await client.query(
      `CREATE ROLE ${MIGRATION_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT LOGIN PASSWORD '${MIGRATION_PASSWORD}'`,
    );
    await client.query(
      `CREATE ROLE ${RUNTIME_ROLE} WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT LOGIN PASSWORD '${RUNTIME_PASSWORD}'`,
    );
    await client.query(`CREATE DATABASE ${DATABASE} OWNER ${MIGRATION_ROLE}`);
    await client.query(`REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${RUNTIME_ROLE}`);
  });
  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
    await client.query(`ALTER SCHEMA public OWNER TO ${MIGRATION_ROLE}`);
    await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await client.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${RUNTIME_ROLE}`);
  });

  runMigration(host, port);

  const connectionString = `postgresql://${RUNTIME_ROLE}:${encodeURIComponent(RUNTIME_PASSWORD)}@${host}:${port}/${DATABASE}`;
  const tenantId = crypto.randomUUID();
  const actorId = "actor-real-pg-bridge";
  const requestId = crypto.randomUUID();
  const idempotencyKey = `idem-${requestId}`;

  const scopeLiteral = postCustomersScopeLiteral({ tenant: tenantId, actor: actorId, requestId, idempotencyKey });

  const script = pyScript(`
    import json

    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER_PATH)}, "--policy", "allow", "--connection-string", ${JSON.stringify(connectionString)}])
    scope = ${scopeLiteral}
    body_bytes = json.dumps({"name": "Ada Lovelace"}).encode("utf-8")

    async def receive():
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)

    assert len(sent) == 2, sent
    assert sent[0]["type"] == "http.response.start", sent
    assert sent[0]["status"] == 201, sent
    for name, value in sent[0]["headers"]:
        assert isinstance(name, (bytes, bytearray)), sent
        assert isinstance(value, (bytes, bytearray)), sent

    payload = json.loads(sent[1]["body"])
    receipt = payload["commitReceipt"]
    assert receipt["receiptType"] == "CommitReceipt", receipt
    assert sorted(receipt["committedIntents"]) == ["audit", "customer", "idempotency", "transactionalOutbox"], receipt
    assert isinstance(receipt["customerRecordId"], str), receipt
    assert isinstance(receipt["auditLogId"], str), receipt
    assert isinstance(receipt["outboxId"], str), receipt

    print("RECEIPT_JSON_START")
    print(json.dumps(receipt))
    print("RECEIPT_JSON_END")

    # Duplicate identical request, same tenant/idempotency fingerprint, through a fresh bridge
    # call: must be a deterministic 409 IDEMPOTENCY_CONFLICT, never a leaked raw PostgreSQL
    # error, and never a second row (proved from the Node side below).
    async def receive2():
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    sent2 = []
    async def send2(event):
        sent2.append(event)

    await bridge(scope, receive2, send2)
    assert sent2[0]["status"] == 409, sent2
    retry_payload = json.loads(sent2[1]["body"])
    assert retry_payload["error"]["code"] == "IDEMPOTENCY_CONFLICT", retry_payload
    assert retry_payload["error"]["requestId"] == ${JSON.stringify(requestId)}, retry_payload
    assert retry_payload["error"]["retryable"] == False, retry_payload

    print("OK")
  `);

  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);

  const receiptMatch = stdout.match(/RECEIPT_JSON_START\n([\s\S]*?)\nRECEIPT_JSON_END/);
  assert.ok(receiptMatch, `expected receipt JSON in python stdout, got: ${stdout}`);
  const receipt = JSON.parse(receiptMatch[1]);

  await withPg(host, port, "postgres", SUPERUSER_PASSWORD, DATABASE, async (client) => {
    const customer = await client.query(
      "SELECT tenant_id, name FROM customer_records WHERE id = $1",
      [receipt.customerRecordId],
    );
    assert.equal(customer.rows.length, 1);
    assert.equal(customer.rows[0].tenant_id, tenantId);
    assert.equal(customer.rows[0].name, "Ada Lovelace");

    const audit = await client.query(
      "SELECT tenant_id, event_type FROM audit_log WHERE id = $1",
      [receipt.auditLogId],
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].tenant_id, tenantId);
    assert.equal(audit.rows[0].event_type, "customer.create");

    const outbox = await client.query(
      "SELECT tenant_id, event_type FROM transactional_outbox WHERE id = $1",
      [receipt.outboxId],
    );
    assert.equal(outbox.rows.length, 1);
    assert.equal(outbox.rows[0].tenant_id, tenantId);
    assert.equal(outbox.rows[0].event_type, "customer.created");

    const customerCount = await client.query("SELECT count(*) FROM customer_records WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(customerCount.rows[0].count), 1, "the duplicate request must not insert a second customer row");
    const auditCount = await client.query("SELECT count(*) FROM audit_log WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(auditCount.rows[0].count), 1, "the duplicate request must not insert a second audit row");
    const outboxCount = await client.query("SELECT count(*) FROM transactional_outbox WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(outboxCount.rows[0].count), 1, "the duplicate request must not enqueue a second outbox row");
  });
});
