import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANNING_PATH = fileURLToPath(
  new URL("../planning/gj01-v15d-python-host-bridge-envelope.json", import.meta.url),
);
const BRIDGE_MODULE_PATH = path.join(REPO_ROOT, "host/python_asgi/metaframer_kernel_host_bridge.py");
const PACKAGE_ROOT = path.join(REPO_ROOT, "host/python_asgi");

async function loadPlanning() {
  return JSON.parse(await readFile(PLANNING_PATH, "utf-8"));
}

const JS_ECHO_FIXTURE = `
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const envelope = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const bodyBase64 = envelope.bodyBase64;
  const path = envelope.scope.path;
  const events = [
    { type: "http.response.start", status: 200, headers: [[Buffer.from("content-type").toString("base64"), Buffer.from("text/plain").toString("base64")]] },
    { type: "http.response.body", bodyBase64: Buffer.from("echo:" + path + ":" + Buffer.from(bodyBase64, "base64").toString("utf-8")).toString("base64"), more_body: false },
  ];
  // headers here use raw arrays already base64; convert to headersBase64 form expected by decoder
  events[0].headersBase64 = events[0].headers;
  delete events[0].headers;
  process.stdout.write(JSON.stringify(events));
});
`;

const JS_FAIL_FIXTURE = `process.stderr.write("boom"); process.exit(1);`;
const JS_MALFORMED_FIXTURE = `process.stdout.write("not json{{{");`;

let tmpDir;

test.before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "v15d-envelope-"));
});

test.after(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(name, contents) {
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, contents, "utf-8");
  return filePath;
}

function pyScript(fixturePath, scenario) {
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
  const scriptPath = path.join(tmpDir, `run-${Math.random().toString(36).slice(2)}.py`);
  await writeFile(scriptPath, script, "utf-8");
  return execFileAsync("python3", [scriptPath]);
}

test("planning JSON identifies itself with the expected id, prerequisite, flags, and non-goals", async () => {
  const planning = await loadPlanning();
  assert.equal(planning.id, "gj01-v15d-python-host-bridge-envelope-2026-08-23");
  assert.equal(planning.packageKind, "python-host-bridge-envelope-primitive");
  assert.equal(planning.type, "python-host-bridge-envelope-primitive");
  assert.equal(planning.prerequisite.path, "planning/gj01-v15c-python-host-bridge-contract.json");
  assert.equal(planning.prerequisite.id, "gj01-v15c-python-host-bridge-contract-2026-08-23");
  assert.equal(planning.bridgeInThisPackage, true);
  assert.equal(planning.hostSelected, false);
  assert.equal(planning.interopMechanism, "subprocess-stdio-envelope");
  assert.equal(planning.runnableProduct, false);
  assert.equal(planning.flags.runnableProduct, false);
  assert.equal(planning.flags.kernelReady, false);
  assert.equal(planning.flags.appBuildable, false);
  assert.equal(planning.flags.releaseAllowed, false);
  assert.equal(planning.flags.deployAllowed, false);
  assert.equal(planning.flags.productionAllowed, false);

  const nonGoals = planning.nonGoals.join(" | ").toLowerCase();
  assert.match(nonGoals, /no src\/\*\* change/);
  assert.match(nonGoals, /no package\.json, dependency, lockfile, ci\/workflow\/config, pyproject or uv\.lock change/);
  assert.match(nonGoals, /no network listener, socket server, http server, docker, fastapi, django, uvicorn or hypercorn/);
  assert.match(nonGoals, /no real postgresql test/);
  assert.match(nonGoals, /no production or runnable product claim/);
  assert.match(nonGoals, /no commit, push, or merge/);

  assert.match(planning.capabilityDelta, /^PYTHON_ASGI_SUBPROCESS_ENVELOPE_PRIMITIVE:/);
});

test("Python module compiles cleanly", async () => {
  await execFileAsync("python3", ["-m", "py_compile", BRIDGE_MODULE_PATH]);
});

test("collects multi-chunk body, preserves scope, base64-encodes body, and sends decoded response events", async () => {
  const fixturePath = await writeFixture("echo.js", JS_ECHO_FIXTURE);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}])
    scope = {"type": "http", "path": "/hello", "method": "POST"}
    chunks = [b"hel", b"lo ", b"world"]

    async def receive():
        if chunks:
            c = chunks.pop(0)
            return {"type": "http.request", "body": c, "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 200
    assert sent[1]["type"] == "http.response.body"
    assert sent[1]["body"] == b"echo:/hello:hello world", sent[1]["body"]
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("missing more_body is treated as final; false is final; true continues", async () => {
  const fixturePath = await writeFixture("echo2.js", JS_ECHO_FIXTURE);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}])
    scope = {"type": "http", "path": "/x", "method": "GET"}

    async def receive():
        return {"type": "http.request", "body": b"abc"}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[1]["body"] == b"echo:/x:abc", sent[1]["body"]
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("present non-bool more_body returns a deterministic error without invoking the JS command", async () => {
  const fixturePath = await writeFixture("should-not-run.js", `throw new Error("must not be invoked")`);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}])
    scope = {"type": "http", "path": "/x", "method": "GET"}

    async def receive():
        return {"type": "http.request", "body": b"abc", "more_body": "yes"}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 500, sent
    import json
    payload = json.loads(sent[1]["body"])
    assert payload["error"] == "malformed_more_body", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("max_body_bytes rejects an over-limit request before subprocess invocation", async () => {
  const fixturePath = await writeFixture("should-not-run2.js", `throw new Error("must not be invoked")`);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}], max_body_bytes=4)
    scope = {"type": "http", "path": "/x", "method": "GET"}
    chunks = [b"abcde"]

    async def receive():
        c = chunks.pop(0) if chunks else b""
        return {"type": "http.request", "body": c, "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 413, sent
    import json
    payload = json.loads(sent[1]["body"])
    assert payload["error"] == "body_too_large", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("subprocess non-zero exit returns a deterministic error event", async () => {
  const fixturePath = await writeFixture("fail.js", JS_FAIL_FIXTURE);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}])
    scope = {"type": "http", "path": "/x", "method": "GET"}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 502, sent
    import json
    payload = json.loads(sent[1]["body"])
    assert payload["error"] == "subprocess_failed", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("subprocess malformed stdout returns a deterministic error event", async () => {
  const fixturePath = await writeFixture("malformed.js", JS_MALFORMED_FIXTURE);
  const script = pyScript(fixturePath, `
    bridge = StdioJsAsgiBridge(["node", ${JSON.stringify(fixturePath)}])
    scope = {"type": "http", "path": "/x", "method": "GET"}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    sent = []
    async def send(event):
        sent.append(event)

    await bridge(scope, receive, send)
    assert sent[0]["status"] == 502, sent
    import json
    payload = json.loads(sent[1]["body"])
    assert payload["error"] == "subprocess_failed", payload
    print("OK")
  `);
  const { stdout } = await runPython(script);
  assert.match(stdout, /OK/);
});

test("this package changes no src/**, package/dependency/lock/CI/config/pyproject/uv.lock files relative to HEAD", async () => {
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
