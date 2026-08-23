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
  new URL("../planning/gj01-v15h-uvicorn-programmatic-smoke.json", import.meta.url),
);
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

async function uvicornAvailable() {
  try {
    await execFileAsync("python3", ["-c", "import uvicorn"]);
    return true;
  } catch {
    return false;
  }
}

const REQUEST_ID = "88888888-8888-4888-8888-888888888888";
const ACTOR = "uvicorn-smoke-actor";
const TENANT = "99999999-9999-4999-9999-999999999999";

async function runPython(script) {
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "v15h-uvicorn-smoke-"));
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
            ["idempotency-key", "order-uvicorn-smoke-1"],
        ],
    }`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15h-uvicorn-programmatic-smoke-2026-08-23");
  assert.equal(planning.packageKind, "uvicorn-programmatic-smoke");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15g-python-host-app-factory.json");
  assert.equal(planning.prerequisite.id, "gj01-v15g-python-host-app-factory-2026-08-23");
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
  assert.match(nonGoals, /no host\/python_asgi or host\/js_asgi code change/);
  assert.match(nonGoals, /no package\.json, dependency, lockfile, ci\/workflow\/config, pyproject or uv\.lock change/);
  assert.match(nonGoals, /no listener or product server script/);
  assert.match(nonGoals, /no hypercorn import/);
  assert.match(nonGoals, /no uvicorn hard-selection as (the )?development base/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^UVICORN_PROGRAMMATIC_SMOKE:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("Uvicorn programmatic acceptance of create_customer_app, or a clear unavailable evidence assertion", async () => {
  const planning = await loadPlanning();
  const available = await uvicornAvailable();

  assert.equal(
    planning.evidence.environment,
    "runtime-conditional",
    "planning must record Uvicorn availability as detected at runtime, not a hard-coded environment fact",
  );
  assert.ok(
    Array.isArray(planning.evidence.allowedOutcomes) &&
      planning.evidence.allowedOutcomes.includes("uvicorn-available") &&
      planning.evidence.allowedOutcomes.includes("uvicorn-unavailable"),
    "planning must explicitly allow both the available and unavailable outcomes",
  );
  assert.equal(planning.runnableProduct, false);

  if (!available) {
    // Uvicorn absent in this environment: the planning record already permits
    // this outcome above, and no runnable-product claim is made.
    return;
  }

  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(PACKAGE_ROOT)})
sys.path.insert(0, ${JSON.stringify(path.dirname(PACKAGE_ROOT))})
import asyncio
import uvicorn
from python_asgi.create_customer_app import create_customer_app

app = create_customer_app(["node", ${JSON.stringify(RUNNER_PATH)}])
assert callable(app), "app must be callable"

# Programmatic acceptance only: build a Config bound to the app without
# opening a real listener (port=0, lifespan off). No server.serve() call.
config = uvicorn.Config(app=app, host="127.0.0.1", port=0, lifespan="off", log_level="critical")
server = uvicorn.Server(config)
assert server.config.app is app, "Uvicorn Config/Server must accept the factory app unchanged"

scope = ${postCustomersScopeLiteral()}

async def receive():
    return {"type": "http.request", "body": b"{}", "more_body": False}

sent = []
async def send(event):
    sent.append(event)

async def main():
    await app(scope, receive, send)

asyncio.run(main())
assert sent[0]["type"] == "http.response.start", sent
assert sent[0]["status"] == 403, sent
print("OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("this package changes no src/**, host/python_asgi, host/js_asgi, package/dependency/lock/CI/config/pyproject/uv.lock files relative to HEAD", async () => {
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
