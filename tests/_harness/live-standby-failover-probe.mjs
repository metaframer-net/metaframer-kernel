import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// =====================================================================================
// tests/_harness/live-standby-failover-probe.mjs — P23B, one failover seam and nothing else.
//
// P23A proved this system can lose its database and get the truth back OUT OF AN ARCHIVE, with a window
// of loss and an operator in the middle. It proved nothing about a SECOND COPY already current when the
// node died, so "the node died" still meant "stop and restore". This file adds exactly the six actions
// that close that gap, BESIDE the two P22 harnesses and the P23A recovery seam and changing no byte of
// any of them: build a real physical standby of the running primary, wait for one committed write to be
// replayed onto it, destroy the primary totally, promote the copy, move the name the application writes
// to, and let the never-restarted listener carry on. It starts no environment, defines no image and
// opens no host port — every function is handed the ONE environment P22B1 already built and reads the
// names, the network, the label and the pinned image out of it — and every HTTP request, verification
// read and trusted principal on the primary is P22B2's, UNCHANGED.
//
// The replication credential is never a command-line argument and never an environment VALUE: it is
// created over the primary's own trusted socket with the statement on stdin, crosses onto this host as
// a mode-0600 file, is bound READ-ONLY into each container, and each container copies it to its own
// mode-0600 pgpass that the image is told about BY PATH — `docker inspect` hands a container's
// environment to anyone who can reach the daemon for as long as the container exists. The standby is a
// REAL pg_basebackup, so it carries the primary's own system identifier and can replay the primary's
// WAL; a logical copy is a second database that merely looks alike. And it fails closed: a backup that
// never streams, a promotion that leaves the node in recovery, a timeline that never advances or an
// alias the daemon does not report back is an exception, never a descriptor.
//
// Honest limit, stated rather than implied: this is ONE operator-driven drill. Nothing here detects a
// failure, elects a leader, fences the old primary beyond destroying it, waits for the second copy before
// acknowledging a commit or reconnects a client on its own, and replication is asynchronous — a promotion
// after a real crash can lose whatever had not yet been streamed. That is not high availability.
// =====================================================================================

// The nine surfaces P23B must leave byte-identical. The two paths this file must never reach are
// composed from their parts, so the seam can NAME what it must not disturb while holding no importable
// reference to it: it is handed an environment and can neither start one nor restore one.
const P22B1_HARNESS = `tests/_harness/${["live", "http", "postgres", "environment"].join("-")}.mjs`;
const P23A_PROBE = `tests/_harness/${["live", "recovery", "probe"].join("-")}.mjs`;

/**
 * The one frozen decision record for this probe, frozen because a mutable failover contract could be
 * edited by the very run judged against it: the one database replicated, the credential-free local
 * superuser every read goes through, the role the standby streams as, and the alias the promoted node
 * must answer on so the untouched listener still reaches it.
 */
export const HA_PROBE_CONTRACT = Object.freeze({
  database: "mfk",
  superuserRole: "postgres",
  replicationRole: "mfk_replication",
  networkAlias: "db",
  walMethod: "stream",
  hostAuthMethod: "scram-sha-256",
  // Replication only: it may open a replication connection and log in, is no superuser, may not bypass row-level security or create a role or a database, and never gets CONNECT on the business database.
  replicationRoleFlags: "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN REPLICATION",
  // The exact line appended to the primary's pg_hba.conf, and the only one: replication connections, for that one role, answered by challenge-response and by nothing weaker.
  hostAuthLine: "host replication mfk_replication all scram-sha-256",
  credentialOnCommandLine: false,
  credentialInEnvironmentValue: false,
  publishesHostPort: false,
  dataDirectory: "/var/lib/postgresql/data",
  // Where the credential is READ inside each container (a read-only bind of a host file this run owns and deletes), and the container-local mode-0600 pgpass named to the image by path.
  replicationSourceMount: "/run/replication-source/pgpass",
  replicationPassfileMount: "/run/secrets/replication.pgpass",
  secretFileMode: 0o600,
  imageEntrypoint: "/usr/local/bin/docker-entrypoint.sh",
  // Every wait is bounded by one of these, none looser than the corresponding bound of the environment this probe borrows: an unbounded wait hangs a test run instead of failing it.
  timeouts: Object.freeze({ dockerCli: 120_000, baseBackup: 300_000, promote: 120_000, replay: 120_000, ready: 300_000 }),
  preservedHashes: Object.freeze({
    [P22B1_HARNESS]: "d7f83b4d86cc440888076bce5da845d2bc9ff66843bd1dc79f8847a273695d0f",
    "tests/_harness/live-audited-write-probe.mjs": "b019d07ea91ee1af91b7487706826c6f4c5abd8ab786e3d731bf2a2ab5664f23",
    [P23A_PROBE]: "e13a0e5be9fc4066c74fb8dbc11279c1e72a2359287195865db1f08ee834c63b",
    "tests/kernel-deploy-live-audited-write-p22b2.test.mjs": "0aee9deeb1fb6491e2a67b8026f5ff3ccce4a3e1808b933087ea3be0bf63a8e4",
    "tests/kernel-disaster-recovery-backup-restore-p23a.test.mjs": "b59540ee938eac8fc18e2acd25fe98a000c231525351f73814ef347436d51d43",
    "planning/kernel-disaster-recovery-backup-restore-p23a.json": "a0cfdd49894d694b033f7537481ae178a0c879a1817851757fe491fc8a2db7e1",
    "host/deploy/Dockerfile": "e9910e31c56c20d003c8e14a31c50e5a101c29d380105f408f28d0f240cdc99c",
    "host/deploy/secret_file_runner.mjs": "d26edfede30131e6250a5df0700c540849af67105f2405ee83da02b590c5f981",
    "host/js_asgi/create_customer_asgi_runner.mjs": "64e1fc81e3b5bda0174ca35df573355aa87376493364c936af36bf2866ea2ec7",
  }),
});

const C = HA_PROBE_CONTRACT;
const LSN = /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/i;

// A credential can only be redacted by something that knows it, so the one secret this seam is handed is
// remembered HERE and stripped out of every failure it raises: a psql error carrying a connection string
// would put the replication password into a test report, a CI log and a shell history in one step.
const SECRETS = new Set();
const redact = (text) => [...SECRETS].reduce((carried, secret) => carried.replaceAll(secret, "[redacted]"), String(text));

/** One bounded child process. A timeout is a killed child and a non-zero status, never a hang. */
function run(command, args, { timeout, input = "" } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let [stdout, stderr, expired] = ["", "", false];
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: expired ? 124 : code, stdout, stderr: expired ? `${stderr}\ntimed out after ${timeout}ms` : stderr }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const docker = (args, options = {}) => run("docker", args, { timeout: C.timeouts.dockerCli, ...options });
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

/** The same call, but a non-zero status is a REDACTED error naming what was attempted. */
async function dockerOrThrow(what, args, options = {}) {
  const result = await docker(args, options);
  if (result.status !== 0) throw new Error(redact(`${what} failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`));
  return result;
}

/** Poll until true or until the bound is spent; the bound is always one of the contract's. */
async function waitUntil(what, probe, bound) {
  const deadline = Date.now() + bound;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${bound}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Everything this probe may touch comes out of the environment it was handed, plus the two names the
 * standby owns: a probe that could build a name of its own could destroy a container nobody gave it.
 * Both are a pure function of the run's OWN unique label, so no concurrent run can be reached.
 */
function standbyOf(environment) {
  const { names, label, network } = environment ?? {};
  const image = environment?.postgres?.image;
  for (const [field, value] of [["names.postgres", names?.postgres], ["names.volume", names?.volume],
    ["label.key", label?.key], ["label.value", label?.value], ["network", network], ["postgres.image", image]]) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`this probe must be handed a started environment carrying its own ${field}`);
  }
  // A replication slot name is an identifier: the run's own label with its hyphens folded away.
  return { names, label, network, image, container: `${names.postgres}-standby`,
    volume: `${names.volume}-standby`, slot: `standby_${label.value.replaceAll("-", "_")}` };
}

const quoted = (secret) => `'${String(secret).replaceAll("'", "''")}'`;

/**
 * One statement on a container's own PostgreSQL over its LOCAL trusted socket: no credential is an
 * argument of this process and no port has to exist for one to travel to. Row-returning statements are
 * projected one JSON object per line in the server's own order; everything else is executed verbatim, so
 * a refusal is PostgreSQL's own, carrying its own SQLSTATE. Failures are redacted before they are raised.
 */
async function psql(container, statement, { input = "", database = C.database } = {}) {
  const text = /^\s*select\b/i.test(statement) ? `SELECT row_to_json(t) FROM (${statement}) AS t` : statement;
  const result = await run("docker", ["exec", ...(input ? ["--interactive"] : []), container, "psql", "-X", "-q", "-A",
    "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", C.superuserRole, "-d", database,
    ...(input ? [] : ["-c", text])], { timeout: C.timeouts.dockerCli, input });
  if (result.status !== 0) {
    const matched = /^ERROR:\s+(\w{5}):\s*(.*)$/m.exec(redact(result.stderr));
    throw Object.assign(new Error(matched ? matched[2] : redact(result.stderr).trim()), { code: matched?.[1] });
  }
  return { rows: lines(result.stdout).map((line) => JSON.parse(line)) };
}

/** Ask the SECOND copy its own questions — before the promotion and after it, through one door. */
export function queryStandby(environment, statement) {
  return psql(standbyOf(environment).container, statement);
}

/** The standby exactly as the DAEMON reports it: the image, the ports, the network and the aliases. */
export async function inspectStandby(environment) {
  const inspected = await dockerOrThrow("inspecting the standby", ["container", "inspect", standbyOf(environment).container]);
  return JSON.parse(inspected.stdout)[0];
}

/**
 * Build the second copy, in the order a real standby has to be built: the replication-only role, created
 * over the primary's own socket with the password on stdin; the one pg_hba line letting exactly that role
 * open a replication connection, and a reload, so the primary is never restarted; the credential, as a
 * read-only bind each container copies to its own mode-0600 pgpass; a REAL pg_basebackup of the whole
 * cluster, holding its own permanent physical slot so the primary keeps WAL this copy has not consumed;
 * and only then the standby container, on the one internal network, opening no host port and NOT answering
 * on the alias the listener writes to — two containers behind that name is a split brain. */
export async function startStandby(environment, { replicationPassword } = {}) {
  const standby = standbyOf(environment);
  if (typeof replicationPassword !== "string" || replicationPassword.length === 0) {
    throw new TypeError("startStandby must be given the replication password the standby will stream on");
  }
  SECRETS.add(replicationPassword);
  const labelled = ["--label", `${standby.label.key}=${standby.label.value}`];
  await psql(standby.names.postgres, "", { database: "postgres", input: `CREATE ROLE ${C.replicationRole} WITH ${C.replicationRoleFlags} PASSWORD ${quoted(replicationPassword)};\n` });
  await dockerOrThrow("authorising the replication connection on the primary", ["exec", standby.names.postgres,
    "sh", "-c", `printf '%s\\n' ${JSON.stringify(C.hostAuthLine)} >> ${C.dataDirectory}/pg_hba.conf`]);
  await psql(standby.names.postgres, "SELECT pg_reload_conf() AS reloaded");
  const secrets = await mkdtemp(path.join(tmpdir(), `${standby.label.value}-replication-`));
  try {
    const passfile = path.join(secrets, path.basename(C.replicationPassfileMount));
    await writeFile(passfile, `*:*:*:${C.replicationRole}:${replicationPassword}\n`, { mode: C.secretFileMode });
    // Set again explicitly: a umask can only take permissions away from the mode above, and libpq refuses a pgpass file that anyone but its owner can read.
    await chmod(passfile, C.secretFileMode);
    // The credential's ONLY crossing: a read-only bind, copied container-locally to owner-only bytes, named to both processes by the path in PGPASSFILE and never by value.
    const carried = ["--volume", `${passfile}:${C.replicationSourceMount}:ro`, "--tmpfs", "/run/secrets",
      "--env", `PGPASSFILE=${C.replicationPassfileMount}`];
    const install = [`cp ${C.replicationSourceMount} ${C.replicationPassfileMount}`,
      `chmod 0600 ${C.replicationPassfileMount}`, `chown postgres:postgres ${C.replicationPassfileMount}`].join(" && ");
    const data = ["--volume", `${standby.volume}:${C.dataDirectory}`];
    await dockerOrThrow("creating the standby data volume", ["volume", "create", ...labelled, standby.volume]);
    // One throwaway container, removed by the daemon the moment it exits, takes the backup: the primary is asked for its own bytes and nothing on this host ever holds the cluster.
    await dockerOrThrow("taking the physical base backup of the running primary", ["run", "--rm", ...labelled,
      "--network", standby.network, ...carried, ...data, "--entrypoint", "sh", standby.image, "-c",
      `${install} && exec pg_basebackup --host=${C.networkAlias} --port=5432 --username=${C.replicationRole}` +
      ` --pgdata=${C.dataDirectory} --wal-method=${C.walMethod} --slot=${standby.slot} --create-slot` +
      " --write-recovery-conf --checkpoint=fast --no-password"], { timeout: C.timeouts.baseBackup });
    await dockerOrThrow("starting the standby", ["run", "--detach", "--name", standby.container, ...labelled,
      "--network", standby.network, ...carried, ...data, "--entrypoint", "sh", standby.image, "-c",
      `${install} && exec ${C.imageEntrypoint} postgres`]);
    await waitUntil(`the standby ${standby.container}`, async () => (await docker(["exec", standby.container,
      "pg_isready", "--quiet", "--host", "127.0.0.1", "--username", C.superuserRole])).status === 0, C.timeouts.ready);
    // Asked of BOTH ends before this returns: a receiver that believes it is streaming and a sender that has never heard of it is exactly the failure a standby must not be reported through.
    await waitUntil(`the standby ${standby.container} streaming from ${standby.names.postgres}`, async () => {
      const [receiver, sender] = await Promise.all([
        queryStandby(environment, "SELECT status AS state FROM pg_stat_wal_receiver").catch(() => ({ rows: [] })),
        psql(standby.names.postgres, `SELECT state FROM pg_stat_replication WHERE usename = '${C.replicationRole}'`).catch(() => ({ rows: [] })),
      ]);
      return receiver.rows[0]?.state === "streaming" && sender.rows[0]?.state === "streaming";
    }, C.timeouts.ready);
  } finally {
    // The host copy lives exactly as long as it takes to reach the two containers, each of which holds its own owner-only copy: nothing is withdrawn from the running standby here.
    await rm(secrets, { recursive: true, force: true });
  }
  const container = await inspectStandby(environment);
  return Object.freeze({
    // The image is read back off the RUNNING container rather than echoed from the input.
    image: container?.Config?.Image, container: standby.container, volume: standby.volume, slot: standby.slot,
    network: standby.network, database: C.database, walMethod: C.walMethod, replicationRole: C.replicationRole,
    passfileMount: C.replicationPassfileMount, startedAt: new Date().toISOString(),
  });
}

/**
 * Wait until the standby has really replayed the primary's own position at commit time: a copy that is
 * merely connected is not a copy that is current, and every comparison of the two nodes before this
 * returns would be a race rather than a proof. */
export async function awaitReplay(environment, targetLsn) {
  const standby = standbyOf(environment);
  if (!LSN.test(String(targetLsn))) {
    throw new TypeError(`awaitReplay must be given the primary's own WAL position, and got ${JSON.stringify(targetLsn)}`);
  }
  let replayedLsn = null;
  await waitUntil(`the standby replaying up to ${targetLsn}`, async () => {
    const { rows } = await queryStandby(environment, `SELECT pg_last_wal_replay_lsn()::text AS lsn, (pg_last_wal_replay_lsn() >= '${targetLsn}'::pg_lsn) AS caught`);
    replayedLsn = rows[0]?.lsn ?? null;
    return rows[0]?.caught === true;
  }, C.timeouts.replay);
  return Object.freeze({ container: standby.container, targetLsn, replayedLsn, replayedAt: new Date().toISOString() });
}

/**
 * Lose the primary totally: the container AND the data volume under it, because a container removed while
 * its volume survives is a restart, and a drill that could be undone by starting the old node again proves
 * nothing. Both absences are verified against the DAEMON, not inferred from an exit status. Nothing is
 * promoted here — whether a second copy promotes ITSELF is the next question the frozen test asks. */
export async function destroyPrimary(environment) {
  const { names } = standbyOf(environment);
  await docker(["rm", "--force", "--volumes", names.postgres]);
  await docker(["volume", "rm", "--force", names.volume]);
  const [container, volume] = await Promise.all([docker(["container", "inspect", names.postgres]), docker(["volume", "inspect", names.volume])]);
  return Object.freeze({ container: names.postgres, volume: names.volume, lostAt: new Date().toISOString(),
    removedContainer: container.status !== 0, removedVolume: volume.status !== 0 });
}

/**
 * The operator's deliberate act: end recovery on the surviving copy and take a new timeline. The timeline
 * it stood on is read BEFORE anything is asked of it, so the advance is measured against what really was;
 * PostgreSQL's own pg_promote does the work, bounded; the end of recovery is asked of the node itself; and
 * a checkpoint is forced so the new timeline is on record in the control file rather than pending. A node
 * still in recovery, or a timeline that never moved, is an exception and never a descriptor. */
export async function promoteStandby(environment) {
  const standby = standbyOf(environment);
  const timelineOf = async () => (await queryStandby(environment, "SELECT timeline_id AS id FROM pg_control_checkpoint()")).rows[0]?.id;
  const timelineBefore = await timelineOf();
  await queryStandby(environment, `SELECT pg_promote(true, ${Math.floor(C.timeouts.promote / 1000)}) AS promoted`);
  await waitUntil(`the promoted node ${standby.container} leaving recovery`, async () =>
    (await queryStandby(environment, "SELECT pg_is_in_recovery() AS recovering")).rows[0]?.recovering === false, C.timeouts.promote);
  await queryStandby(environment, "CHECKPOINT");
  const timelineAfter = await timelineOf();
  if (!(Number.isInteger(timelineAfter) && timelineAfter > timelineBefore)) {
    throw new Error(`${standby.container} left recovery on timeline ${timelineAfter}, which is no advance on ${timelineBefore}: a promotion that takes no new timeline is a restart`);
  }
  return Object.freeze({ container: standby.container, inRecovery: false, timelineBefore, timelineAfter, promotedAt: new Date().toISOString() });
}

/**
 * Move the one name the application writes to onto the promoted node. The listener holds a credential
 * naming a HOST, so moving the name is what lets a RUNNING application follow a failover without being
 * restarted, re-credentialed or re-deployed. The alias can only be added by re-attaching the container to
 * the same internal network, and it is read back off the daemon rather than inferred from an exit status:
 * a name this seam merely believed it had moved is the worst thing in this package to get wrong. */
export async function rebindPrimaryAlias(environment) {
  const standby = standbyOf(environment);
  await dockerOrThrow("detaching the promoted node from the network", ["network", "disconnect", standby.network, standby.container]);
  await dockerOrThrow(`moving the ${C.networkAlias} name onto the promoted node`,
    ["network", "connect", "--alias", C.networkAlias, standby.network, standby.container]);
  const container = await inspectStandby(environment);
  const aliases = container?.NetworkSettings?.Networks?.[standby.network]?.Aliases ?? [];
  if (!aliases.includes(C.networkAlias)) {
    throw new Error(`the daemon does not report the ${C.networkAlias} name on ${standby.container}: ${JSON.stringify(aliases)}`);
  }
  return Object.freeze({ alias: C.networkAlias, container: standby.container, network: standby.network, reboundAt: new Date().toISOString() });
}
