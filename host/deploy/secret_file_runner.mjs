import { writeSync } from "node:fs";
import { readFile } from "node:fs/promises";

// =====================================================================================
// secret_file_runner.mjs — P22A1, the secret-file argv boundary and nothing else.
//
// A deploy artifact must reach its database credential without that credential ever being typed
// on a command line, exported as an environment variable or baked into an image layer. So this
// wrapper takes exactly two mounted FILE PATHS, validates what it reads out of them, rewrites
// only its OWN in-process JS process.argv, and dynamically imports the EXISTING host/js_asgi
// runner — which this package neither modifies nor reimplements.
//
// Honest limit, stated rather than implied: assigning to this process's process.argv does not and
// cannot rewrite the OS command line the kernel already recorded for this pid at exec time. The
// claim proven here is the narrower, true one — the credential VALUE is never an OS-visible
// argument, because only the two mounted PATHS are ever exec'd with. No environment read, no
// shell fallback, no inline credential argument, no database contact, no listener, no image.
// =====================================================================================

const [FLAG_CONFIG, FLAG_DB] = ["--config-file", "--database-url-file"];
const CONFIG_FIELDS = Object.freeze(["audit", "policy", "trustedActorId", "trustedTenantId"]);
const TRUSTED_UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TRUSTED_ACTOR_FORM = /^[\x21-\x7e]{1,128}$/;
const EXISTING_RUNNER = "../js_asgi/create_customer_asgi_runner.mjs";

/** Fail closed. A refusal may name a flag, a mounted path or a config field, never a byte read
 * out of a mount. The write is synchronous so no refusal is lost to an unflushed pipe on exit. */
function fail(message) {
  writeSync(2, `secret_file_runner: ${message}\n`);
  process.exit(1);
}

/** Exactly two closed flags, each with one mandatory value. Unknown, duplicated, incomplete and
 * missing arguments are refused without echoing the argument: an inline credential offered in the
 * wrong place must not be disclosed by the very check that rejects it. */
function parsePaths(argv) {
  const paths = { [FLAG_CONFIG]: undefined, [FLAG_DB]: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== FLAG_CONFIG && flag !== FLAG_DB) {
      return { error: `unrecognized argument at position ${i + 1}; only ${FLAG_CONFIG} and ${FLAG_DB} are accepted` };
    }
    if (paths[flag] !== undefined) return { error: `${flag} may be given only once` };
    const value = argv[i + 1];
    if (value === undefined || value.length === 0) return { error: `${flag} requires a mounted file path` };
    paths[flag] = value;
  }
  for (const flag of [FLAG_CONFIG, FLAG_DB]) {
    if (paths[flag] === undefined) return { error: `${flag} is required` };
  }
  return { paths };
}

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

/** The fixed identity contract a mounted config must carry, checked in full before delegation:
 * policy and audit are stated explicitly, and the trusted principal is canonical, non-nil and
 * visible ASCII, in the same forms the existing runner enforces. */
function checkConfig(config) {
  if (!isOrdinaryObject(config)) return "the mounted config must be an ordinary JSON object";
  const fields = Object.keys(config).sort();
  if (fields.length !== CONFIG_FIELDS.length || !CONFIG_FIELDS.every((field, at) => fields[at] === field)) {
    return `the mounted config must carry exactly the fields ${CONFIG_FIELDS.join(", ")}`;
  }
  if (config.policy !== "allow") return 'config field "policy" must be exactly "allow"';
  if (config.audit !== "on") return 'config field "audit" must be exactly "on"';
  if (typeof config.trustedTenantId !== "string" || !TRUSTED_UUID_FORM.test(config.trustedTenantId)) {
    return 'config field "trustedTenantId" must be a canonical lowercase hyphenated UUID in 8-4-4-4-12 form';
  }
  if (config.trustedTenantId === NIL_UUID) return 'config field "trustedTenantId" must not be the nil UUID';
  if (typeof config.trustedActorId !== "string" || !TRUSTED_ACTOR_FORM.test(config.trustedActorId)) {
    return 'config field "trustedActorId" must be 1-128 visible ASCII characters';
  }
  return undefined;
}

/** Read one mount as UTF-8, fail-closed: an absent or unreadable mount is a refusal naming the
 * path and the errno, never a fallback to some second credential source. */
async function readMounted(label, file) {
  return readFile(file, "utf8").catch((error) =>
    fail(`the mounted ${label} at ${file} could not be read: ${error.code ?? "unreadable"}`));
}

const parsed = parsePaths(process.argv.slice(2));
if (parsed.error !== undefined) fail(parsed.error);
const configPath = parsed.paths[FLAG_CONFIG];
const dbPath = parsed.paths[FLAG_DB];

const rawConfig = await readMounted("config file", configPath);
let config;
try {
  config = JSON.parse(rawConfig);
} catch (error) {
  fail(`the mounted config file at ${configPath} is not valid JSON: ${error.name}`);
}
const problem = checkConfig(config);
if (problem !== undefined) fail(`${problem}; mounted config file at ${configPath}`);

// A mounted secret file conventionally ends in one newline, so exactly one is removed. What is
// left must be non-empty; an empty mount is a refusal, never an empty credential handed onward.
const rawDatabaseUrl = await readMounted("database-url file", dbPath);
const connectionString = rawDatabaseUrl.endsWith("\n") ? rawDatabaseUrl.slice(0, -1) : rawDatabaseUrl;
if (connectionString.length === 0) fail(`the mounted database-url file at ${dbPath} is empty`);

// The single hand-off: only this process's own in-process JS process.argv is rewritten, and only
// into the argument contract the existing runner already owns. The OS command line for this pid
// is untouched and still carries just the two mounted paths.
process.argv = [
  process.argv[0], process.argv[1],
  "--policy", "allow",
  "--connection-string", connectionString,
  "--trusted-tenant-id", config.trustedTenantId,
  "--trusted-actor-id", config.trustedActorId,
  "--audit", "on",
];

await import(EXISTING_RUNNER);
