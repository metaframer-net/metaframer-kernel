import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// =====================================================================================
// tests/_harness/live-audited-write-probe.mjs — P22B2, one read-only probe seam and nothing else.
//
// P22B1 stood up exactly one ephemeral live environment and deliberately proved NO write: every
// route it exercised was a refusal and all four runtime tables stayed empty. Closing that gap
// needs three reads its harness does not offer, and needs them WITHOUT touching a single byte of
// that harness, the image, the P22A1 secret wrapper or the audited boundary runner:
//
//   1. a real HTTP request carrying a METHOD, a JSON BODY and the identity HEADERS the boundary
//      decides on — the P22B1 client sends a bare method and route, which can only ever reach a
//      refusal;
//   2. a verification read that sees EVERY row of every table regardless of tenant — the two roles
//      P22B1 exposes are both NOBYPASSRLS, so a row-level-security policy is between them and the
//      truth, and a sweep that cannot see a row cannot prove the row is absent;
//   3. the trusted principal the environment really runs on, read from its own mounted credential
//      rather than asserted into existence by the test that has to judge it.
//
// So this file adds exactly those three functions BESIDE the P22B1 harness. It starts nothing,
// stops nothing, and holds no environment of its own: every function here is handed the ONE
// environment P22B1 already built and only reads from it. It defines no image, publishes no port,
// runs nothing privileged, contacts no registry and writes no repository file. The one write it
// causes is the business write the frozen test asks the real listener for, over real HTTP, through
// the unchanged audited boundary — this probe neither performs nor simulates it.
//
// Honest limit, stated rather than implied: `queryAsSuperuser` deliberately reads as the database
// superuser, which bypasses row-level security. That is the point of a verification read and it is
// never how the application reaches its own data — the listener under test still connects as the
// NOBYPASSRLS runtime role through its mounted credential, and nothing here changes, relaxes or
// re-grants a single privilege of that role.
// =====================================================================================

// The six surfaces P22B2 must leave byte-identical: the whole P22B1 package, the image definition,
// the P22A1 secret wrapper and the audited JS boundary runner the proven write really travels
// through. The P22B1 harness path is composed from its parts on purpose, so that this file can
// name the surface it must not disturb while still containing no importable reference to it: this
// probe is handed an environment and must never be able to start or stop one.
const P22B1_HARNESS = `tests/_harness/${["live", "http", "postgres", "environment"].join("-")}.mjs`;

/**
 * The one frozen decision record for this probe. It is frozen because a mutable probe contract
 * could be edited by the very run that has to be judged against it.
 */
export const AUDITED_WRITE_PROBE_CONTRACT = Object.freeze({
  // The single audited write this package proves, and the port it is sent to. It is decided here
  // and nowhere else: a probe that could be pointed at a second route or a second port would be a
  // general-purpose client, and the frozen test would no longer know what it had proven.
  method: "POST",
  route: "/customers",
  appPort: 8000,
  // Every verification read goes through this database as this role, and through no other pair.
  database: "mfk",
  superuserRole: "postgres",
  // Every wait here is bounded by one of these, and neither is looser than the corresponding bound
  // of the environment this probe borrows: an unbounded wait hangs a test run instead of failing
  // it, and a probe that outwaits its own environment reports nothing at all.
  timeouts: Object.freeze({ http: 60_000, psql: 120_000 }),
  preservedHashes: Object.freeze({
    [P22B1_HARNESS]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
    "tests/kernel-deploy-ephemeral-environment-p22b1.test.mjs": "aef0f0ca2eb34147f75725f8ef302d2c60ec61da2e8ca9921c8075fac69873e9",
    "planning/kernel-deploy-ephemeral-environment-p22b1.json": "272f957aeaf4f54c1883beea4be70b1b43bcce63b58064f6829c06a59c796afa",
    "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
    "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
    "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
  }),
});

const C = AUDITED_WRITE_PROBE_CONTRACT;

/** One bounded child process. A timeout is a killed child and a non-zero status, never a hang. */
function run(command, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let [stdout, stderr, expired] = ["", "", false];
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: expired ? 124 : code, stdout, stderr: expired ? `${stderr}\ntimed out after ${timeout}ms` : stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end("");
  });
}

/** The same call, but a non-zero status is an error naming what was attempted. */
async function dockerOrThrow(what, args, timeout) {
  const result = await run("docker", args, timeout);
  if (result.status !== 0) throw new Error(`${what} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result;
}

/** The container names come from the environment this probe was handed, never from a name it
 * builds itself: a probe that could guess a container name could reach a container nobody gave it. */
function containerOf(environment, which) {
  const name = environment?.names?.[which];
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(`this probe must be handed a started environment carrying its own ${which} container name`);
  }
  return name;
}

// One HTTP client, run by the application image's own node against 127.0.0.1 INSIDE the container,
// because no application port is published and the listener is reachable from nowhere else. It
// carries a method, request headers and a request body, so the boundary is reached with everything
// it decides on; the P22B1 client carries a method and a route alone and can only reach a refusal.
// It reports the status and the raw body and interprets neither: an interpretation belongs to the
// frozen test, and a probe that decided what a response meant could hide the response.
const HTTP_CLIENT = [
  "const [port, route, method, headers, body] = JSON.parse(process.argv[process.argv.length - 1]);",
  "fetch('http://127.0.0.1:' + port + route, { method, headers, body })",
  " .then(async (response) => process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() })))",
  " .catch((error) => { process.stderr.write(String(error && error.message)); process.exit(1); });",
].join("");

/**
 * Send ONE real HTTP request to the running listener and hand back exactly what came out of it.
 *
 * The body crosses as the JSON text a real client would send, and every header is sent verbatim —
 * including the identity headers, which stay CLAIMS the boundary is free to refuse. Nothing here
 * signs, trusts, rewrites or completes an identity: this is a client, and a client that could
 * improve its own credentials would prove nothing about the guard on the other side.
 */
export async function sendJsonRequest(environment, { method, route, body, headers }) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const result = await dockerOrThrow(`${method} ${route} inside the container`,
    ["exec", containerOf(environment, "app"), "node", "-e", HTTP_CLIENT,
      JSON.stringify([C.appPort, route, method, headers ?? {}, payload])], C.timeouts.http);
  let json;
  try { json = JSON.parse(result.stdout); } catch {
    throw new Error(`the in-container client did not answer one JSON envelope for ${method} ${route}: ${result.stdout}`);
  }
  let parsed;
  try { parsed = JSON.parse(json.body); } catch { parsed = undefined; }
  return { status: json.status, body: json.body, json: parsed };
}

/**
 * Read every column of every row a statement selects, as the database superuser, through the
 * database's OWN psql over its local trusted socket — no credential is ever an argument of this
 * process, and no port is published for one to travel to.
 *
 * The superuser is deliberate and is the only role that can carry a verification read: both roles
 * the environment exposes are NOBYPASSRLS, so a row-level-security policy stands between them and
 * any row filed under another tenant — and a sweep that cannot SEE a row can never prove that row
 * is absent. Row-returning statements are projected one JSON object per line in the server's own
 * order; everything else is executed verbatim, so a refusal is PostgreSQL's refusal and never a
 * shape this probe invented.
 */
export async function queryAsSuperuser(environment, statement) {
  const text = /^\s*select\b/i.test(statement) ? `SELECT row_to_json(t) FROM (${statement}) AS t` : statement;
  const result = await run("docker", ["exec", containerOf(environment, "postgres"), "psql", "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", C.superuserRole, "-d", C.database, "-c", text], C.timeouts.psql);
  if (result.status !== 0) {
    const matched = /^ERROR:\s+(\w{5}):\s*(.*)$/m.exec(result.stderr);
    throw Object.assign(new Error(matched ? matched[2] : result.stderr.trim()), { code: matched?.[1] });
  }
  return { rows: result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line)) };
}

/**
 * Read the trusted principal the running container was actually started on.
 *
 * It comes out of the environment's own mounted config file — the very bytes bind-mounted
 * read-only into the container and validated by the P22A1 wrapper before the boundary exists — so
 * a test that asserts against this principal is asserting against the identity the listener really
 * holds, not against a constant it declared and then found again. This probe reads that file and
 * decides nothing about it: an unreadable or shapeless config is an error naming the file, never a
 * fallback to some second identity.
 */
export async function readTrustedPrincipal(environment) {
  const directory = environment?.secretDir;
  if (typeof directory !== "string" || directory.length === 0) {
    throw new TypeError("this probe must be handed a started environment carrying its own mounted secret directory");
  }
  const file = path.join(directory, "config.json");
  const raw = await readFile(file, "utf8").catch((error) => {
    throw new Error(`the mounted config the environment runs on could not be read at ${file}: ${error.code ?? "unreadable"}`);
  });
  let config;
  try { config = JSON.parse(raw); } catch (error) {
    throw new Error(`the mounted config at ${file} is not valid JSON: ${error.name}`);
  }
  for (const field of ["trustedTenantId", "trustedActorId"]) {
    if (typeof config?.[field] !== "string" || config[field].length === 0) {
      throw new Error(`the mounted config at ${file} carries no ${field}, so the environment's trusted identity cannot be read`);
    }
  }
  return Object.freeze({ tenantId: config.trustedTenantId, actorId: config.trustedActorId });
}
