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
  new URL("../planning/gj01-v15l-explicit-host-runner-selector.json", import.meta.url),
);
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

async function runPython(script) {
  const dir = await mkdtemp(path.join(tmpdir(), "v15l-host-runner-selector-"));
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

function blockHostPackages() {
  return `
sys.modules["uvicorn"] = None
sys.modules["hypercorn"] = None
sys.modules["hypercorn.asyncio"] = None
sys.modules["hypercorn.config"] = None
`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15l-explicit-host-runner-selector-2026-08-23");
  assert.equal(planning.packageKind, "explicit-host-runner-selector");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15k-hypercorn-host-runner.json");
  assert.equal(planning.prerequisite.id, "gj01-v15k-hypercorn-host-runner-2026-08-23");
  assert.equal(planning.uvicornSelectedAsDevelopmentBase, false);
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
  assert.match(nonGoals, /no direct uvicorn or hypercorn import in the selector module/);
  assert.match(nonGoals, /no default framework base selected/);
  assert.match(nonGoals, /no production, deploy, or release claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^EXPLICIT_HOST_RUNNER_SELECTOR:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("importing the selector module has no uvicorn/hypercorn requirement and no side effect", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi.create_customer_host_runner import run_create_customer_host
assert callable(run_create_customer_host)
print("IMPORT_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /IMPORT_OK/);
});

test("selector module does not import uvicorn or hypercorn packages directly", async () => {
  const script = `${sysPathPrelude()}
import inspect
from python_asgi import create_customer_host_runner as mod

source = inspect.getsource(mod)
assert "import uvicorn" not in source, source
assert "import hypercorn" not in source, source
assert "from hypercorn" not in source, source
print("NO_DIRECT_IMPORT_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /NO_DIRECT_IMPORT_OK/);
});

test('runner="uvicorn" dispatches to the Uvicorn sibling runner with command and kwargs', async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_runner as mod

captured = {}

def fake_uvicorn_runner(command, **kwargs):
    captured["command"] = command
    captured["kwargs"] = kwargs

def fail_hypercorn_runner(command, **kwargs):
    raise AssertionError("hypercorn runner must not be called for runner=\\"uvicorn\\"")

mod._RUNNERS["uvicorn"] = fake_uvicorn_runner
mod._RUNNERS["hypercorn"] = fail_hypercorn_runner

command = ["node", ${JSON.stringify(RUNNER_PATH)}]
mod.run_create_customer_host(command, runner="uvicorn", host="127.0.0.1", port=8321, log_level="warning")

assert captured["command"] == command, captured["command"]
assert captured["kwargs"] == {"host": "127.0.0.1", "port": 8321, "log_level": "warning"}, captured["kwargs"]
print("UVICORN_DISPATCH_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /UVICORN_DISPATCH_OK/);
});

test('runner="hypercorn" dispatches to the Hypercorn sibling runner with command and kwargs', async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_runner as mod

captured = {}

def fail_uvicorn_runner(command, **kwargs):
    raise AssertionError("uvicorn runner must not be called for runner=\\"hypercorn\\"")

def fake_hypercorn_runner(command, **kwargs):
    captured["command"] = command
    captured["kwargs"] = kwargs

mod._RUNNERS["uvicorn"] = fail_uvicorn_runner
mod._RUNNERS["hypercorn"] = fake_hypercorn_runner

command = ["node", ${JSON.stringify(RUNNER_PATH)}]
mod.run_create_customer_host(command, runner="hypercorn", host="127.0.0.1", port=8322, log_level="critical")

assert captured["command"] == command, captured["command"]
assert captured["kwargs"] == {"host": "127.0.0.1", "port": 8322, "log_level": "critical"}, captured["kwargs"]
print("HYPERCORN_DISPATCH_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /HYPERCORN_DISPATCH_OK/);
});

test("an unknown runner value fails closed with a ValueError listing the allowed values", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi.create_customer_host_runner import run_create_customer_host

try:
    run_create_customer_host(["node", "x"], runner="gunicorn")
    raise SystemExit("expected ValueError, none raised")
except ValueError as error:
    message = str(error)
    assert "gunicorn" in message, message
    assert "uvicorn" in message, message
    assert "hypercorn" in message, message
print("UNKNOWN_RUNNER_FAILS_CLOSED_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /UNKNOWN_RUNNER_FAILS_CLOSED_OK/);
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
