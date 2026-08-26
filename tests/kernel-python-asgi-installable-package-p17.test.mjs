import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// P17: installable ASGI host adapters. The Python host bridge/runners/CLI already exist
// under host/python_asgi as importable modules, but there is no packaging metadata making
// that directory an installable distribution yet. These three scenarios exercise the
// installable-package boundary end to end, fully offline (uv --offline / --no-index), with
// no network access and no server/listener ever actually started:
//
//   1) an offline wheel build carries correct metadata, contents and a console-script entry
//      point;
//   2) installing that wheel into an isolated venv lets code outside this checkout publicly
//      import the package without uvicorn/hypercorn/fastapi/django present, side-effect-free;
//   3) the installed console-script CLI answers --help and fails closed (no listener) when
//      the runner or command is missing.
//
// This is a packaging/installability contract only; it makes no production, deploy or
// release claim, and it starts no ASGI server.

const HOST_DIR = fileURLToPath(new URL("../host", import.meta.url));

const EXPECTED_PACKAGE_NAME = "metaframer-kernel-asgi-host";
const EXPECTED_IMPORT_PACKAGE = "python_asgi";
const EXPECTED_CONSOLE_SCRIPT = "metaframer-kernel-customer-host";
const EXPECTED_ENTRY_POINT_TARGET = "python_asgi.create_customer_host_cli:main";
const FORBIDDEN_HOST_PACKAGES = ["uvicorn", "hypercorn", "fastapi", "django"];

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function buildOfflineWheel(outDir) {
  return run("uv", ["build", "--offline", "--wheel", "-o", outDir, HOST_DIR]);
}

async function findWheel(outDir) {
  const entries = await readdir(outDir);
  return entries.find((name) => name.endsWith(".whl"));
}

function readWheelEntry(wheelPath, entrySuffix) {
  // Wheels are plain zip archives; python3's zipfile module is offline, stdlib and
  // available in this environment, so it is used as the extraction tool instead of adding
  // a network-fetched dependency.
  const list = run("python3", [
    "-c",
    "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); " +
      "names = z.namelist(); " +
      "match = next((n for n in names if n.endswith(sys.argv[2])), None); " +
      "print('\\n'.join(names)); " +
      "print('---ENTRY---'); " +
      "print(z.read(match).decode('utf-8') if match else '')",
    wheelPath,
    entrySuffix,
  ]);
  if (list.status !== 0) {
    throw new Error(`failed to inspect wheel ${wheelPath}: ${list.stderr}`);
  }
  const [namesBlock, entryBlock] = list.stdout.split("---ENTRY---\n");
  return {
    names: namesBlock.trim().split("\n").filter(Boolean),
    entryText: entryBlock,
  };
}

test("an offline uv build of host/ produces a wheel with correct metadata, module contents and a console-script entry point", async () => {
  await withTempDir("p17-wheel-build-", async (outDir) => {
    const build = buildOfflineWheel(outDir);
    assert.equal(
      build.status,
      0,
      `expected an offline wheel build of host/ to succeed; got exit ${build.status}\nstdout: ${build.stdout}\nstderr: ${build.stderr}`,
    );

    const wheelName = await findWheel(outDir);
    assert.ok(wheelName, `expected a .whl file in ${outDir}, found: ${(await readdir(outDir)).join(", ")}`);
    const wheelPath = join(outDir, wheelName);

    const metadata = readWheelEntry(wheelPath, ".dist-info/METADATA");
    assert.match(
      metadata.entryText,
      new RegExp(`^Name:\\s*${EXPECTED_PACKAGE_NAME}\\s*$`, "m"),
      `wheel METADATA should declare Name: ${EXPECTED_PACKAGE_NAME}`,
    );

    assert.ok(
      metadata.names.some((n) => n === `${EXPECTED_IMPORT_PACKAGE}/create_customer_host_cli.py`),
      `wheel should contain ${EXPECTED_IMPORT_PACKAGE}/create_customer_host_cli.py, contents were: ${metadata.names.join(", ")}`,
    );
    assert.ok(
      metadata.names.some((n) => n === `${EXPECTED_IMPORT_PACKAGE}/metaframer_kernel_host_bridge.py`),
      `wheel should contain ${EXPECTED_IMPORT_PACKAGE}/metaframer_kernel_host_bridge.py`,
    );
    assert.ok(
      metadata.names.some((n) => n === `${EXPECTED_IMPORT_PACKAGE}/__init__.py`),
      `wheel should contain ${EXPECTED_IMPORT_PACKAGE}/__init__.py`,
    );

    const entryPoints = readWheelEntry(wheelPath, ".dist-info/entry_points.txt");
    assert.match(
      entryPoints.entryText,
      new RegExp(`^${EXPECTED_CONSOLE_SCRIPT}\\s*=\\s*${EXPECTED_ENTRY_POINT_TARGET.replace(":", "\\:")}\\s*$`, "m"),
      `entry_points.txt should declare a [console_scripts] entry ${EXPECTED_CONSOLE_SCRIPT} = ${EXPECTED_ENTRY_POINT_TARGET}, got:\n${entryPoints.entryText}`,
    );
  });
});

test("installing the wheel into an isolated venv lets code outside this checkout publicly import the package, side-effect-free and without any host ASGI server package", async () => {
  await withTempDir("p17-wheel-build-", async (outDir) => {
    const build = buildOfflineWheel(outDir);
    assert.equal(build.status, 0, `precondition failed: offline wheel build did not succeed\nstderr: ${build.stderr}`);
    const wheelName = await findWheel(outDir);
    assert.ok(wheelName, "precondition failed: no wheel produced to install");
    const wheelPath = join(outDir, wheelName);

    await withTempDir("p17-venv-", async (venvDir) => {
      const venvPath = join(venvDir, "venv");
      const venvCreate = run("uv", ["venv", "--offline", venvPath]);
      assert.equal(
        venvCreate.status,
        0,
        `expected an offline venv creation to succeed\nstdout: ${venvCreate.stdout}\nstderr: ${venvCreate.stderr}`,
      );

      const venvPython = join(venvPath, "bin", "python3");
      const install = run("uv", ["pip", "install", "--offline", "--python", venvPython, wheelPath]);
      assert.equal(
        install.status,
        0,
        `expected an offline install of the built wheel to succeed with no other dependencies\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
      );

      for (const forbidden of FORBIDDEN_HOST_PACKAGES) {
        const probe = run(venvPython, ["-c", `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("${forbidden}") is None else 1)`]);
        assert.equal(
          probe.status,
          0,
          `installing the package must not pull in ${forbidden}: it was importable inside the venv`,
        );
      }

      await withTempDir("p17-outside-checkout-", async (importCwd) => {
        const before = (await readdir(importCwd)).sort();

        const script = [
          "import sys, os",
          `assert os.path.realpath(os.getcwd()) == os.path.realpath(${JSON.stringify(importCwd)})`,
          `assert os.path.realpath(${JSON.stringify(HOST_DIR)}) not in [os.path.realpath(p) for p in sys.path]`,
          "import python_asgi",
          `assert os.path.realpath(${JSON.stringify(HOST_DIR)}) not in os.path.realpath(python_asgi.__file__ or '.')`,
          "assert 'uvicorn' not in sys.modules",
          "assert 'hypercorn' not in sys.modules",
          "assert 'fastapi' not in sys.modules",
          "assert 'django' not in sys.modules",
          "from python_asgi import StdioJsAsgiBridge, create_customer_app, run_create_customer_host",
          "assert StdioJsAsgiBridge is not None",
          "assert callable(create_customer_app)",
          "assert callable(run_create_customer_host)",
          "print('P17_IMPORT_OK')",
        ].join("\n");

        const importRun = run(venvPython, ["-c", script], { cwd: importCwd });
        assert.equal(
          importRun.status,
          0,
          `expected the installed package to publicly import cleanly from outside the checkout with no host ASGI packages loaded\nstdout: ${importRun.stdout}\nstderr: ${importRun.stderr}`,
        );
        assert.match(importRun.stdout, /P17_IMPORT_OK/);

        const after = (await readdir(importCwd)).sort();
        assert.deepEqual(
          after,
          before,
          "importing the installed package must be side-effect-free: it must not write any file into the caller's working directory",
        );
      });
    });
  });
});

test("the installed console-script CLI answers --help, and fails closed with no listener when the runner or command is missing", async () => {
  await withTempDir("p17-wheel-build-", async (outDir) => {
    const build = buildOfflineWheel(outDir);
    assert.equal(build.status, 0, `precondition failed: offline wheel build did not succeed\nstderr: ${build.stderr}`);
    const wheelName = await findWheel(outDir);
    assert.ok(wheelName, "precondition failed: no wheel produced to install");
    const wheelPath = join(outDir, wheelName);

    await withTempDir("p17-venv-", async (venvDir) => {
      const venvPath = join(venvDir, "venv");
      const venvCreate = run("uv", ["venv", "--offline", venvPath]);
      assert.equal(venvCreate.status, 0, `precondition failed: venv creation did not succeed\nstderr: ${venvCreate.stderr}`);

      const venvPython = join(venvPath, "bin", "python3");
      const install = run("uv", ["pip", "install", "--offline", "--python", venvPython, wheelPath]);
      assert.equal(install.status, 0, `precondition failed: wheel install did not succeed\nstderr: ${install.stderr}`);

      const consoleScript = join(venvPath, "bin", EXPECTED_CONSOLE_SCRIPT);

      const helpRun = run(consoleScript, ["--help"]);
      assert.equal(helpRun.status, 0, `expected ${EXPECTED_CONSOLE_SCRIPT} --help to exit 0\nstderr: ${helpRun.stderr}`);
      assert.match(helpRun.stdout, /--runner/);

      const missingRunner = run(consoleScript, ["--", "node", "create_customer_asgi_runner.mjs"]);
      assert.notEqual(missingRunner.status, 0, "omitting --runner must fail closed, not dispatch to a default runner");
      assert.match(missingRunner.stderr, /--runner/);

      const missingCommand = run(consoleScript, ["--runner", "uvicorn"]);
      assert.notEqual(missingCommand.status, 0, "omitting a -- command must fail closed before any runner dispatch");
      assert.match(missingCommand.stderr, /--/);

      // Fail-closed means both invocations must have exited on their own before any runner
      // dispatch, rather than hanging as a live listener process. spawnSync only returns once
      // the child has already terminated, so a non-null status/signal here is itself the
      // network-free evidence that no ASGI server ever started or kept running.
      assert.notEqual(missingRunner.status, null, "the --runner-missing invocation must have exited on its own, not be left running as a listener");
      assert.equal(missingRunner.signal, null, "the --runner-missing invocation must exit normally, not be killed while serving");
      assert.notEqual(missingCommand.status, null, "the missing-command invocation must have exited on its own, not be left running as a listener");
      assert.equal(missingCommand.signal, null, "the missing-command invocation must exit normally, not be killed while serving");
    });
  });
});
