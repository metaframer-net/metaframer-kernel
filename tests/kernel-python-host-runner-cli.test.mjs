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
  new URL("../planning/gj01-v15m-host-runner-cli-boundary.json", import.meta.url),
);
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");
const RUNNER_PATH = path.join(REPO_ROOT, "host/js_asgi/create_customer_asgi_runner.mjs");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

async function runPython(script) {
  const dir = await mkdtemp(path.join(tmpdir(), "v15m-host-runner-cli-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await execFileAsync("python3", [scriptPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runPythonExpectFailure(script) {
  const dir = await mkdtemp(path.join(tmpdir(), "v15m-host-runner-cli-fail-"));
  const scriptPath = path.join(dir, "run.py");
  await writeFile(scriptPath, script, "utf-8");
  try {
    await execFileAsync("python3", [scriptPath]);
    throw new Error("expected python3 to exit non-zero");
  } catch (error) {
    if (error.code === undefined || error.code === 0) {
      throw error;
    }
    return error;
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
sys.modules["fastapi"] = None
sys.modules["django"] = None
`;
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15m-host-runner-cli-boundary-2026-08-23");
  assert.equal(planning.packageKind, "host-runner-cli-boundary");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15l-explicit-host-runner-selector.json");
  assert.equal(planning.prerequisite.id, "gj01-v15l-explicit-host-runner-selector-2026-08-23");
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
  assert.match(nonGoals, /no direct uvicorn or hypercorn import in the cli module/);
  assert.match(nonGoals, /no default framework base selected/);
  assert.match(nonGoals, /no default runner silently chosen by the cli/);
  assert.match(nonGoals, /no production, deploy, or release claim/);
  assert.match(nonGoals, /no real network listener opened by tests/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^HOST_RUNNER_CLI_BOUNDARY:/);
  for (const key of ["once", "simdi", "fark", "kullaniciYolculugu", "kalanEngel"]) {
    assert.equal(typeof planning.userJourney[key], "string");
    assert.ok(planning.userJourney[key].length > 0);
  }
});

test("importing the CLI module has no uvicorn/hypercorn/FastAPI/Django requirement and no side effect", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi.create_customer_host_cli import parse_create_customer_host_args, main
assert callable(parse_create_customer_host_args)
assert callable(main)
print("IMPORT_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /IMPORT_OK/);
});

test("CLI module does not import uvicorn, hypercorn, FastAPI, or Django directly", async () => {
  const script = `${sysPathPrelude()}
import inspect
from python_asgi import create_customer_host_cli as mod

source = inspect.getsource(mod)
assert "import uvicorn" not in source, source
assert "import hypercorn" not in source, source
assert "from hypercorn" not in source, source
assert "import fastapi" not in source, source
assert "from fastapi" not in source, source
assert "import django" not in source, source
assert "from django" not in source, source
print("NO_DIRECT_IMPORT_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /NO_DIRECT_IMPORT_OK/);
});

test('--runner uvicorn dispatches to run_create_customer_host with command and safe options', async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

captured = {}

def fake_run_create_customer_host(command, **kwargs):
    captured["command"] = command
    captured["kwargs"] = kwargs

mod.run_create_customer_host = fake_run_create_customer_host

argv = [
    "--runner", "uvicorn",
    "--host", "127.0.0.1",
    "--port", "8331",
    "--log-level", "warning",
    "--",
    "node", ${JSON.stringify(RUNNER_PATH)},
]
rc = mod.main(argv)
assert rc == 0, rc
assert captured["command"] == ["node", ${JSON.stringify(RUNNER_PATH)}], captured["command"]
assert captured["kwargs"]["runner"] == "uvicorn", captured["kwargs"]
assert captured["kwargs"]["host"] == "127.0.0.1", captured["kwargs"]
assert captured["kwargs"]["port"] == 8331, captured["kwargs"]
assert captured["kwargs"]["log_level"] == "warning", captured["kwargs"]
print("UVICORN_CLI_DISPATCH_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /UVICORN_CLI_DISPATCH_OK/);
});

test('--runner hypercorn dispatches to run_create_customer_host with command and safe options', async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

captured = {}

def fake_run_create_customer_host(command, **kwargs):
    captured["command"] = command
    captured["kwargs"] = kwargs

mod.run_create_customer_host = fake_run_create_customer_host

argv = [
    "--runner", "hypercorn",
    "--max-body-bytes", "1024",
    "--",
    "node", ${JSON.stringify(RUNNER_PATH)}, "--flag",
]
rc = mod.main(argv)
assert rc == 0, rc
assert captured["command"] == ["node", ${JSON.stringify(RUNNER_PATH)}, "--flag"], captured["command"]
assert captured["kwargs"]["runner"] == "hypercorn", captured["kwargs"]
assert captured["kwargs"]["max_body_bytes"] == 1024, captured["kwargs"]
print("HYPERCORN_CLI_DISPATCH_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /HYPERCORN_CLI_DISPATCH_OK/);
});

test("missing --runner fails closed before dispatch", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

def fail_dispatch(command, **kwargs):
    raise AssertionError("must not dispatch without --runner")

mod.run_create_customer_host = fail_dispatch

mod.main(["--", "node", "x"])
`;
  const error = await runPythonExpectFailure(script);
  assert.match(error.stderr, /--runner/);
});

test("unknown --runner value fails closed before dispatch", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

def fail_dispatch(command, **kwargs):
    raise AssertionError("must not dispatch for an unknown runner")

mod.run_create_customer_host = fail_dispatch

mod.main(["--runner", "gunicorn", "--", "node", "x"])
`;
  const error = await runPythonExpectFailure(script);
  assert.match(error.stderr, /gunicorn/);
});

test("missing -- separator fails closed before runner dispatch", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

def fail_dispatch(command, **kwargs):
    raise AssertionError("must not dispatch without a -- separator")

mod.run_create_customer_host = fail_dispatch

mod.main(["--runner", "uvicorn", "node", "x"])
`;
  const error = await runPythonExpectFailure(script);
  assert.match(error.stderr, /--/);
});

test("empty command after -- fails closed before runner dispatch", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

def fail_dispatch(command, **kwargs):
    raise AssertionError("must not dispatch with an empty command")

mod.run_create_customer_host = fail_dispatch

mod.main(["--runner", "uvicorn", "--"])
`;
  const error = await runPythonExpectFailure(script);
  assert.match(error.stderr, /command/);
});

test("main(None) with a real sys.argv separator normalizes argv once and dispatches correctly", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

captured = {}

def fake_run_create_customer_host(command, **kwargs):
    captured["command"] = command
    captured["kwargs"] = kwargs

mod.run_create_customer_host = fake_run_create_customer_host

sys.argv = [
    "create_customer_host_cli",
    "--runner", "uvicorn",
    "--port", "8412",
    "--",
    "node", ${JSON.stringify(RUNNER_PATH)},
]
rc = mod.main(None)
assert rc == 0, rc
assert captured["command"] == ["node", ${JSON.stringify(RUNNER_PATH)}], captured["command"]
assert captured["kwargs"]["runner"] == "uvicorn", captured["kwargs"]
assert captured["kwargs"]["port"] == 8412, captured["kwargs"]
print("ARGV_NONE_WITH_SEPARATOR_DISPATCH_OK")
`;
  const { stdout } = await runPython(script);
  assert.match(stdout, /ARGV_NONE_WITH_SEPARATOR_DISPATCH_OK/);
});

test("main(None) with a real sys.argv missing the -- separator fails closed before dispatch", async () => {
  const script = `${sysPathPrelude()}
import sys
${blockHostPackages()}
from python_asgi import create_customer_host_cli as mod

def fail_dispatch(command, **kwargs):
    raise AssertionError("must not dispatch without a -- separator in sys.argv")

mod.run_create_customer_host = fail_dispatch

sys.argv = ["create_customer_host_cli", "--runner", "uvicorn", "node", "x"]
mod.main(None)
`;
  const error = await runPythonExpectFailure(script);
  assert.match(error.stderr, /--/);
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
