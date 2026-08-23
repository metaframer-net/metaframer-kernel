import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15k-hypercorn-host-runner.json", import.meta.url),
);
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

async function runPython(script) {
  const dir = await mkdtemp(path.join(tmpdir(), "v15k-hypercorn-runner-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await execFileAsync("python3", [scriptPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sysPathPrelude() {
  return `
import sys
sys.path.insert(0, ${JSON.stringify(PACKAGE_ROOT)})
sys.path.insert(0, ${JSON.stringify(path.dirname(PACKAGE_ROOT))})
`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15k-hypercorn-host-runner-2026-08-23");
  assert.equal(planning.packageKind, "hypercorn-host-runner");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15j-uvicorn-host-runner.json");
  assert.equal(planning.prerequisite.id, "gj01-v15j-uvicorn-host-runner-2026-08-23");
  assert.equal(planning.hypercornSelectedAsDevelopmentBase, false);
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
  assert.match(nonGoals, /no host\/js_asgi change/);
  assert.match(nonGoals, /no package\.json, dependency, lockfile, ci\/workflow\/config, pyproject or uv\.lock change/);
  assert.match(nonGoals, /no fastapi or django import/);
  assert.match(nonGoals, /no uvicorn import/);
  assert.match(nonGoals, /no production, deploy, or release claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^HYPERCORN_HOST_RUNNER:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("importing the runner module has no hypercorn requirement and no side effect", async () => {
  const script = `${sysPathPrelude()}
import sys
sys.modules["hypercorn"] = None  # simulate hypercorn absent even if it is installed here
sys.modules["hypercorn.asyncio"] = None
sys.modules["hypercorn.config"] = None
from python_asgi.create_customer_hypercorn_runner import run_create_customer_hypercorn
assert callable(run_create_customer_hypercorn)
print("IMPORT_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /IMPORT_OK/);
});

test("absent hypercorn fails closed with a wrapped RuntimeError and no fallback host", async () => {
  const script = `${sysPathPrelude()}
import sys
sys.modules["hypercorn"] = None  # simulate hypercorn absent
sys.modules["hypercorn.asyncio"] = None
sys.modules["hypercorn.config"] = None
from python_asgi.create_customer_hypercorn_runner import run_create_customer_hypercorn

try:
    run_create_customer_hypercorn(["node", ${JSON.stringify(RUNNER_PATH)}])
    raise SystemExit("expected RuntimeError, none raised")
except RuntimeError as error:
    assert isinstance(error.__cause__, ImportError), error.__cause__
    print("FAILS_CLOSED_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /FAILS_CLOSED_OK/);
});

test("fake hypercorn captures serve called with the factory app and explicit Config, no listener opened", async () => {
  const script = `${sysPathPrelude()}
import sys
import types

captured = {}

class FakeConfig:
    def __init__(self):
        self.bind = None
        self.loglevel = None

async def fake_serve(app, config):
    captured["app"] = app
    captured["bind"] = config.bind
    captured["loglevel"] = config.loglevel

fake_hypercorn = types.ModuleType("hypercorn")
fake_hypercorn_asyncio = types.ModuleType("hypercorn.asyncio")
fake_hypercorn_asyncio.serve = fake_serve
fake_hypercorn_config = types.ModuleType("hypercorn.config")
fake_hypercorn_config.Config = FakeConfig
sys.modules["hypercorn"] = fake_hypercorn
sys.modules["hypercorn.asyncio"] = fake_hypercorn_asyncio
sys.modules["hypercorn.config"] = fake_hypercorn_config

from python_asgi.create_customer_hypercorn_runner import run_create_customer_hypercorn
from python_asgi.create_customer_app import create_customer_app

command = ["node", ${JSON.stringify(RUNNER_PATH)}]
run_create_customer_hypercorn(command, host="127.0.0.1", port=8123, log_level="critical")

assert callable(captured["app"]), "serve must receive the create_customer_app callable"
assert captured["bind"] == ["127.0.0.1:8123"], captured["bind"]
assert captured["loglevel"] == "critical", captured["loglevel"]
print("CAPTURED_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /CAPTURED_OK/);
});

test("invalid command and max_body_bytes validation still comes from create_customer_app, not the runner", async () => {
  const script = `${sysPathPrelude()}
import sys
import types

class FakeConfig:
    def __init__(self):
        self.bind = None
        self.loglevel = None

async def fake_serve(app, config):
    return None

fake_hypercorn = types.ModuleType("hypercorn")
fake_hypercorn_asyncio = types.ModuleType("hypercorn.asyncio")
fake_hypercorn_asyncio.serve = fake_serve
fake_hypercorn_config = types.ModuleType("hypercorn.config")
fake_hypercorn_config.Config = FakeConfig
sys.modules["hypercorn"] = fake_hypercorn
sys.modules["hypercorn.asyncio"] = fake_hypercorn_asyncio
sys.modules["hypercorn.config"] = fake_hypercorn_config

from python_asgi.create_customer_hypercorn_runner import run_create_customer_hypercorn

try:
    run_create_customer_hypercorn([])
    raise SystemExit("expected ValueError for empty command, none raised")
except ValueError as error:
    assert "command must be an explicit non-empty sequence of strings" in str(error), str(error)

try:
    run_create_customer_hypercorn(["node", "x"], max_body_bytes=-1)
    raise SystemExit("expected ValueError for negative max_body_bytes, none raised")
except ValueError as error:
    assert "max_body_bytes must be a non-negative int or None" in str(error), str(error)

print("VALIDATION_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /VALIDATION_OK/);
});

test("this package changes no forbidden files relative to HEAD", async () => {
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
