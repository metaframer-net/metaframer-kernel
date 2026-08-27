import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// =====================================================================================
// tests/_harness/live-recovery-probe.mjs — P23A, one recovery seam and nothing else.
//
// P22 ended with a real POST /customers committing over live HTTP inside the frozen deploy
// artifact, and with the database that carried it deleted at the end of the run. Nothing had ever
// been taken OUT of that database and put back, so the one question every business asks about its
// own data — if we lose it, does it come back — had no answer here at all. This file adds exactly
// the three actions that answer it, BESIDE the two P22 harnesses and without changing a byte of
// either: take a verified backup, destroy the database totally, and restore it. It starts no
// environment, defines no image, publishes no port and holds no environment of its own — every
// function is handed the ONE environment P22B1 already built and reads the names, the network, the
// label, the pinned image and the mounted credential out of it rather than guessing any of them —
// and every HTTP request, verification read and trusted principal in this package belongs to the
// UNCHANGED P22B2 probe, re-implemented nowhere here.
//
// Three deliberate properties, because a recovery seam that lies is worse than none. No credential
// is ever a command-line argument, and none is ever an environment variable: the dump is taken by the
// local superuser over the container's OWN socket, the restored role passwords cross on psql's stdin,
// and the fresh cluster's own password is a mode-0600 file bound read-only and named by path, never value.
// It dumps exactly ONE DATABASE and never the cluster: a cluster-wide dump would carry every role's
// password hash, and a backup file at rest must carry no credential at all. And it fails closed —
// an empty archive, an archive whose sha256 no longer matches, a restore reporting an error, or a
// database that never becomes reachable is an exception naming what was attempted, never a
// descriptor claiming a recovery that did not happen.
//
// Honest limit, stated rather than implied: a one-database dump cannot carry roles, so the two
// non-superuser roles are re-created on the restored cluster before the archive is loaded, with the
// runtime password read from the credential file the listener is still holding. That is the real
// recovery procedure for this shape of backup, and it is why the restored roles are asserted by the
// frozen test rather than assumed here. This is one backup, one loss and one restore: not high
// availability, not point-in-time recovery, not a migration rollback, and no agreed objective.
// =====================================================================================

// The six surfaces P23A must leave byte-identical. The P22B1 harness path is composed from its
// parts on purpose, so this file can name the surface it must not disturb while still holding no
// importable reference to it: it is handed an environment and must never be able to start one.
const P22B1_HARNESS = `tests/_harness/${["live", "http", "postgres", "environment"].join("-")}.mjs`;
const P22B2_PROBE = "tests/_harness/live-audited-write-probe.mjs";

/**
 * The one frozen decision record for this probe. It is frozen because a mutable recovery contract
 * could be edited by the very run that has to be judged against it.
 */
export const RECOVERY_PROBE_CONTRACT = Object.freeze({
  // The one database dumped, the credential-free local role that dumps it, the archive format and
  // the owner-only mode its bytes are written under. Decided here and nowhere else.
  database: "mfk",
  backupRole: "postgres",
  backupFormat: "custom",
  backupFileMode: 0o600,
  credentialOnCommandLine: false,
  publishesHostPort: false,
  // The alias the restored database must answer on, so the untouched listener reaches it through
  // the credential it already holds, and the two roles it must be reachable through.
  networkAlias: "db",
  migrationRole: "mfk_migration",
  runtimeRole: "mfk_runtime",
  // Identical to the flags the environment created these roles with: neither is a superuser and
  // neither may bypass row-level security, create a role or create a database.
  roleFlags: "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION",
  dataDirectory: "/var/lib/postgresql/data",
  // The restored cluster is told WHERE its superuser password is, never what it is.
  passwordFileMount: "/run/secrets/postgres-password",
  // Every wait here is bounded by one of these, and none is looser than the corresponding bound of
  // the environment this probe borrows: an unbounded wait hangs a test run instead of failing it.
  timeouts: Object.freeze({ dockerCli: 120_000, backup: 300_000, restore: 300_000, ready: 300_000 }),
  preservedHashes: Object.freeze({
    [P22B1_HARNESS]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
    [P22B2_PROBE]: "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
    "tests/kernel-deploy-live-audited-write-p22b2.test.mjs": "0aee9deeb1fb6491e2a67b8026f5ff3ccce4a3e1808b933087ea3be0bf63a8e4",
    "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
    "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
    "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
  }),
});

const C = RECOVERY_PROBE_CONTRACT;

/**
 * One bounded child process. A timeout is a killed child and a non-zero status, never a hang.
 * Standard output is collected as BYTES: one of these children hands back a binary archive, and a
 * string round-trip would silently corrupt exactly the file this package has to verify.
 */
function run(command, args, { timeout, input = "" } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    const chunks = [];
    let [stderr, expired] = ["", false];
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 127, stdout: Buffer.alloc(0), stderr: `${stderr}${error.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: expired ? 124 : code, stdout: Buffer.concat(chunks), stderr: expired ? `${stderr}\ntimed out after ${timeout}ms` : stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const docker = (args, options = {}) => run("docker", args, { timeout: C.timeouts.dockerCli, ...options });

/** The same call, but a non-zero status is an error naming what was attempted. */
async function dockerOrThrow(what, args, options = {}) {
  const result = await docker(args, options);
  if (result.status !== 0) throw new Error(`${what} failed (status ${result.status}):\n${result.stdout.toString("utf8")}\n${result.stderr}`);
  return result;
}

/** Poll until true or until the bound is spent; the bound is always one of the contract's. */
async function waitUntil(what, probe, bound) {
  const deadline = Date.now() + bound;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not become ready within ${bound}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Everything this probe may touch comes out of the environment it was handed — the container names,
 * the network, the run's unique label, the pinned image the lost database really ran and the
 * mounted secret directory. A probe that could build a name of its own could destroy a container
 * nobody gave it.
 */
function requireEnvironment(environment) {
  const { names, label, network, secretDir } = environment ?? {};
  const image = environment?.postgres?.image;
  for (const [field, value] of [["names.postgres", names?.postgres], ["names.volume", names?.volume],
    ["label.key", label?.key], ["label.value", label?.value], ["network", network], ["secretDir", secretDir], ["postgres.image", image]]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`this probe must be handed a started environment carrying its own ${field}`);
    }
  }
  return { names, label, network, secretDir, image };
}

const quoted = (secret) => `'${String(secret).replaceAll("'", "''")}'`;

/**
 * The runtime credential the listener is STILL holding, read from the very file bind-mounted into
 * its container: the restored role must answer exactly this password or the untouched listener
 * could never reach the recovered database. Nothing here invents, rotates or logs it.
 */
async function readRuntimeCredential(secretDir) {
  const file = path.join(secretDir, "database-url.txt");
  const raw = await readFile(file, "utf8").catch((error) => {
    throw new Error(`the mounted credential the listener still holds could not be read at ${file}: ${error.code ?? "unreadable"}`);
  });
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { throw new Error(`the mounted credential at ${file} is not a connection URL`); }
  if (parsed.username !== C.runtimeRole || parsed.password.length === 0) {
    throw new Error(`the mounted credential at ${file} is not the ${C.runtimeRole} credential the restored database must answer`);
  }
  return decodeURIComponent(parsed.password);
}

/**
 * Is the database really answering? One bounded readiness check over the container's own loopback,
 * carrying no credential — the precondition of the disaster and the proof that the loss was real,
 * so it is deliberately the same question asked before and after it.
 */
export async function databaseReachable(environment) {
  const { names } = requireEnvironment(environment);
  const result = await docker(["exec", names.postgres, "pg_isready", "--quiet", "--host", "127.0.0.1", "--username", C.backupRole]);
  return result.status === 0;
}

/**
 * Take ONE verified backup of exactly the mfk database. The dump runs inside the database's own
 * container as the local superuser over its trusted socket, so no password is an argument of any
 * process and no port has to exist for one to travel to. The bytes come back over stdout and are
 * written into the directory the caller owns, for its owner alone, and the descriptor records the
 * digest of the bytes really written: a backup nobody can verify is a backup nobody can rely on.
 */
export async function captureBackup(environment, { directory } = {}) {
  const { names } = requireEnvironment(environment);
  if (typeof directory !== "string" || directory.length === 0) {
    throw new TypeError("captureBackup must be given the directory its caller owns and will delete");
  }
  const dumped = await dockerOrThrow(`dumping the ${C.database} database`, ["exec", names.postgres, "pg_dump",
    "--username", C.backupRole, "--format", C.backupFormat, "--dbname", C.database], { timeout: C.timeouts.backup });
  const bytes = dumped.stdout;
  if (bytes.length === 0) throw new Error(`the ${C.database} dump came back empty: an empty archive is never written as a backup`);
  const file = path.join(directory, `${C.database}-${randomUUID()}.dump`);
  await writeFile(file, bytes, { mode: C.backupFileMode });
  // Set again explicitly: a umask can only take permissions away from the creation mode above, and
  // a business database must never land in a world-readable file.
  await chmod(file, C.backupFileMode);
  return Object.freeze({
    database: C.database, role: C.backupRole, format: C.backupFormat, mode: C.backupFileMode,
    path: file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    capturedAt: new Date().toISOString(),
  });
}

/**
 * Lose the database totally: the container AND the data volume under it. A container removed while
 * its volume survives is a restart, not a disaster, so both are removed and both absences are then
 * verified against the daemon rather than inferred from an exit status. The application container
 * is deliberately left running and still holding its credential: what a lost database does to a
 * live listener is exactly what the frozen test has to see.
 */
export async function destroyDatabase(environment) {
  const { names } = requireEnvironment(environment);
  await docker(["rm", "--force", "--volumes", names.postgres]);
  await docker(["volume", "rm", "--force", names.volume]);
  const [container, volume] = await Promise.all([
    docker(["container", "inspect", names.postgres]), docker(["volume", "inspect", names.volume]),
  ]);
  return Object.freeze({
    container: names.postgres, volume: names.volume,
    removedContainer: container.status !== 0, removedVolume: volume.status !== 0,
    lostAt: new Date().toISOString(),
  });
}

/**
 * Restore the archive into a FRESH volume served by the SAME pinned image.
 *
 * The archive is re-hashed before a single container is created: an archive that no longer matches
 * the digest taken with it is never restored. The cluster is then rebuilt in the order a real
 * recovery has to use — a new empty cluster on a new volume under the run's own label, so the
 * unchanged P22B1 teardown still removes it; the two non-superuser roles a one-database archive
 * cannot carry, re-created over the container's own socket with the runtime password the listener
 * is still holding; the database itself, owned by the migration role exactly as it was; and only
 * then the archive, loaded with --exit-on-error so a partial restore is never reported as a
 * recovery. Nothing the container is given could hand a credential back to a later reader.
 */
export async function restoreDatabase(environment, backup) {
  const { names, label, network, secretDir, image } = requireEnvironment(environment);
  if (typeof backup?.path !== "string" || typeof backup?.sha256 !== "string") {
    throw new TypeError("restoreDatabase must be handed the frozen descriptor captureBackup returned");
  }
  const bytes = await readFile(backup.path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== backup.sha256) {
    throw new Error(`the archive at ${backup.path} now hashes to ${digest} and not to ${backup.sha256}: an unverified archive is never restored`);
  }
  const runtimeCredential = await readRuntimeCredential(secretDir);
  const labelled = ["--label", `${label.key}=${label.value}`];
  // A fresh volume, and never the destroyed name: reusing it would prove nothing was destroyed.
  const volume = `${names.volume}-restored-${randomUUID().slice(0, 8)}`;
  await dockerOrThrow("creating the fresh data volume", ["volume", "create", ...labelled, volume]);
  const secrets = await mkdtemp(path.join(tmpdir(), `${label.value}-restore-`));
  try {
    // The new cluster's own superuser password is written RAW into a mode-0600 file, bound in read-only
    // and named to the image BY PATH. --env-file is no safer here than --env: the CLI reads it and copies
    // its contents into Config.Env, where `docker inspect` hands the password to anyone who can reach the
    // daemon for as long as the container exists — long after the file itself is gone. Only a path is recorded.
    const passwordFile = path.join(secrets, path.basename(C.passwordFileMount));
    await writeFile(passwordFile, randomUUID(), { mode: C.backupFileMode });
    await dockerOrThrow("starting the restored database", ["run", "--detach", "--name", names.postgres, ...labelled,
      "--network", network, "--network-alias", C.networkAlias, "--env", `POSTGRES_PASSWORD_FILE=${C.passwordFileMount}`,
      "--volume", `${passwordFile}:${C.passwordFileMount}:ro`, "--volume", `${volume}:${C.dataDirectory}`, image],
      { timeout: C.timeouts.restore });
    // Deleted only once the cluster it initialised really answers: the entrypoint reads the file during
    // initdb, so removing it any earlier is a restore that never starts rather than a secret withdrawn.
    await waitUntil(`the restored database ${names.postgres}`, () => databaseReachable(environment), C.timeouts.ready);
  } finally {
    await rm(secrets, { recursive: true, force: true });
  }
  // Every statement below crosses on stdin, so neither role password is ever an argument.
  await dockerOrThrow("re-creating the roles and the database on the restored cluster",
    ["exec", "--interactive", names.postgres, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", C.backupRole, "-d", "postgres"],
    { timeout: C.timeouts.restore, input: [
      `CREATE ROLE ${C.migrationRole} WITH ${C.roleFlags} INHERIT LOGIN PASSWORD ${quoted(randomUUID())};`,
      `CREATE ROLE ${C.runtimeRole} WITH ${C.roleFlags} NOINHERIT LOGIN PASSWORD ${quoted(runtimeCredential)};`,
      `CREATE DATABASE ${C.database} OWNER ${C.migrationRole};`,
      `REVOKE ALL ON DATABASE ${C.database} FROM PUBLIC;`,
      `GRANT CONNECT ON DATABASE ${C.database} TO ${C.runtimeRole};`,
    ].join("\n") + "\n" });
  const restored = await run("docker", ["exec", "--interactive", names.postgres, "pg_restore", "--username", C.backupRole,
    "--dbname", C.database, "--no-password", "--exit-on-error"], { timeout: C.timeouts.restore, input: bytes });
  if (restored.status !== 0) {
    throw new Error(`restoring the archive into ${C.database} failed (status ${restored.status}):\n${restored.stdout.toString("utf8")}\n${restored.stderr}`);
  }
  // The image is read back off the running container rather than echoed from the input.
  const inspected = await dockerOrThrow("inspecting the restored database", ["container", "inspect", names.postgres]);
  return Object.freeze({
    image: JSON.parse(inspected.stdout.toString("utf8"))[0]?.Config?.Image,
    container: names.postgres, database: C.database, volume,
    archive: backup.path, sha256: digest, restoredAt: new Date().toISOString(),
  });
}
