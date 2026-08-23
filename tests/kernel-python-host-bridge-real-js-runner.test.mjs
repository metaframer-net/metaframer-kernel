import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15e-real-js-boundary-runner-deny.json", import.meta.url),
);
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
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
  const dir = await mkdtemp(path.join(tmpdir(), "v15e-runner-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await execFileAsync("python3", [scriptPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function postCustomersScopeLiteral(extraHeadersPy = "") {
  return `{
        "type": "http",
        "method": "POST",
        "path": "/customers",
        "headers": [
            ["content-type", "application/json"],
            ["x-request-id", ${JSON.stringify(REQUEST_ID)}],
            ["x-actor-id", ${JSON.stringify(ACTOR)}],
            ["x-tenant-id", ${JSON.stringify(TENANT)}],
            ["idempotency-key", "order-runner-1"],
            ${extraHeadersPy}
        ],
    }`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15e-real-js-boundary-runner-deny-2026-08-23");
  assert.equal(planning.packageKind, "python-bridge-real-js-runner-deny-smoke");
  assert.equal(planning.type, "python-bridge-real-js-runner-deny-smoke");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15d-python-host-bridge-envelope.json");
  assert.equal(planning.prerequisite.id, "gj01-v15d-python-host-bridge-envelope-2026-08-23");
  assert.equal(planning.bridgeInThisPackage, true);
  assert.equal(planning.realJsBoundaryRunner, true);
  assert.equal(planning.hostSelected, false);
  assert.equal(planning.interopMechanism, "subprocess-stdio-envelope");
  assert.equal(planning.smokePath, "DENY_NO_DB");
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
  assert.match(nonGoals, /no network listener, socket server, http server, docker, fastapi, django, uvicorn or hypercorn/);
  assert.match(nonGoals, /no allow or real postgresql commit/);
  assert.match(nonGoals, /no production or runnable product claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^PYTHON_BRIDGE_REAL_JS_BOUNDARY_DENY_SMOKE:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("runner module has valid syntax", async () => {
  await execFileAsync("node", ["--check", RUNNER_PATH]);
});

test("real JS Kernel boundary DENY path returns 403/POLICY_DENY through the Python bridge, multi-chunk body, never-connected DB", async () => {
  const script = pyScript(`
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER_PATH)}])
    scope = ${postCustomersScopeLiteral()}

    import json
    body_full = json.dumps({"name": "Ada Lovelace"}).encode("utf-8")
    mid = len(body_full) // 2
    chunks = [body_full[:mid], body_full[mid:]]

    async def receive():
        if chunks:
            c = chunks.pop(0)
            return {"type": "http.request", "body": c, "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)

    assert len(sent) == 2, sent
    assert sent[0]["type"] == "http.response.start", sent
    assert sent[0]["status"] == 403, sent
    for name, value in sent[0]["headers"]:
        assert isinstance(name, (bytes, bytearray)), sent
        assert isinstance(value, (bytes, bytearray)), sent

    assert sent[1]["type"] == "http.response.body", sent
    payload = json.loads(sent[1]["body"])
    assert payload["error"]["code"] == "POLICY_DENY", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("runner does not need a real database: DENY still succeeds against a never-connected connection string", async () => {
  const script = pyScript(`
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(RUNNER_PATH)}])
    scope = ${postCustomersScopeLiteral()}

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    # No real PostgreSQL is running anywhere in this test process/environment; the runner
    # never attempts to connect because DENY short-circuits before any commit.
    await bridge(scope, receive, send)
    assert sent[0]["status"] == 403, sent
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("malformed envelope sent directly to the runner exits non-zero with deterministic stderr", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("node", [RUNNER_PATH], {
    input: "not json{{{",
    encoding: "utf-8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /create_customer_asgi_runner:/);
});

test("malformed envelope missing bodyBase64 exits non-zero with deterministic stderr", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("node", [RUNNER_PATH], {
    input: JSON.stringify({ scope: { type: "http", method: "POST", path: "/customers", headers: [] } }),
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
