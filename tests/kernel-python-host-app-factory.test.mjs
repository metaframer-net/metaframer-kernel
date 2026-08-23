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
  new URL("../planning/gj01-v15g-python-host-app-factory.json", import.meta.url),
);
const FACTORY_PATH = path.join(REPO_ROOT, "host/python_asgi/create_customer_app.py");
const BRIDGE_PATH = path.join(REPO_ROOT, "host/python_asgi/metaframer_kernel_host_bridge.py");
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const ACTOR = "factory-actor";
const TENANT = "77777777-7777-4777-8777-777777777777";

function pyScript(scenario) {
  return `
import asyncio
import sys
sys.path.insert(0, ${JSON.stringify(PACKAGE_ROOT)})
sys.path.insert(0, ${JSON.stringify(path.dirname(PACKAGE_ROOT))})
from python_asgi.create_customer_app import create_customer_app

async def main():
    ${scenario}

asyncio.run(main())
`;
}

async function runPython(script) {
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "v15g-factory-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await execFileAsync("python3", [scriptPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function postCustomersScopeLiteral() {
  return `{
        "type": "http",
        "method": "POST",
        "path": "/customers",
        "headers": [
            ["content-type", "application/json"],
            ["x-request-id", ${JSON.stringify(REQUEST_ID)}],
            ["x-actor-id", ${JSON.stringify(ACTOR)}],
            ["x-tenant-id", ${JSON.stringify(TENANT)}],
            ["idempotency-key", "order-factory-1"],
        ],
    }`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15g-python-host-app-factory-2026-08-23");
  assert.equal(planning.packageKind, "python-host-app-factory");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15f-python-bridge-real-pg-allow.json");
  assert.equal(planning.prerequisite.id, "gj01-v15f-python-bridge-real-pg-allow-2026-08-23");
  assert.equal(planning.factoryInThisPackage, true);
  assert.equal(planning.hostSelected, false);
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
  assert.match(nonGoals, /no js runner change/);
  assert.match(nonGoals, /no package\.json, dependency, lockfile, ci\/workflow\/config, pyproject or uv\.lock change/);
  assert.match(nonGoals, /no uvicorn or hypercorn import or hard selection/);
  assert.match(nonGoals, /no production or runnable product claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^PYTHON_HOST_APP_FACTORY:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("factory and bridge modules compile and import", async () => {
  await execFileAsync("python3", ["-m", "py_compile", FACTORY_PATH, BRIDGE_PATH]);
});

test("create_customer_app rejects None command", async () => {
  const script = pyScript(`
    try:
        create_customer_app(None)
        assert False, "expected ValueError"
    except ValueError:
        print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("create_customer_app rejects empty command", async () => {
  const script = pyScript(`
    try:
        create_customer_app([])
        assert False, "expected ValueError"
    except ValueError:
        print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("create_customer_app rejects a bare string command", async () => {
  const script = pyScript(`
    try:
        create_customer_app("node script.mjs")
        assert False, "expected ValueError"
    except ValueError:
        print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("create_customer_app rejects a non-string command element", async () => {
  const script = pyScript(`
    try:
        create_customer_app(["node", 42])
        assert False, "expected ValueError"
    except ValueError:
        print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("create_customer_app rejects a negative max_body_bytes", async () => {
  const script = pyScript(`
    try:
        create_customer_app(["node", "x.mjs"], max_body_bytes=-1)
        assert False, "expected ValueError"
    except ValueError:
        print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("create_customer_app returns a callable ASGI app wrapping StdioJsAsgiBridge, DENY path through the real JS runner", async () => {
  const script = pyScript(`
    app = create_customer_app(["node", ${JSON.stringify(RUNNER_PATH)}])
    assert callable(app), "app must be callable"

    scope = ${postCustomersScopeLiteral()}

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await app(scope, receive, send)
    assert sent[0]["type"] == "http.response.start", sent
    assert sent[0]["status"] == 403, sent
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("this package changes no src/**, JS runner, package/dependency/lock/CI/config/pyproject/uv.lock files relative to HEAD", async () => {
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
    /^host\/js_asgi\//,
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
