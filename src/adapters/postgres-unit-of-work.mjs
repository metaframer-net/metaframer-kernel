import pg from "pg";

// =====================================================================================
// createPostgresUnitOfWork
//
// Lazy factory for the PostgreSQL UnitOfWork port (src/application/unit-of-work.mjs). Owns
// exactly one pg.Pool, created on first use rather than at call time, and hands back a frozen
// {port, close} resource whose port is a frozen ordinary {begin, commit, rollback} object. The
// port is shareable: every fresh `new UnitOfWork(resource.port)` drives its own client from the
// same pool, so concurrent UnitOfWork instances never contend with each other.
// =====================================================================================

export function createPostgresUnitOfWork({ connectionString }) {
  if (typeof connectionString !== "string" || !connectionString) {
    throw new TypeError("createPostgresUnitOfWork needs a connectionString string");
  }

  let pool;
  function ensurePool() {
    if (pool === undefined) {
      pool = new pg.Pool({ connectionString });
    }
    return pool;
  }

  const port = Object.freeze({
    async begin() {
      const client = await ensurePool().connect();
      try {
        await client.query("BEGIN");
      } catch (error) {
        client.release();
        throw error;
      }
      return client;
    },

    async commit(client) {
      try {
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async rollback(client) {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  });

  return Object.freeze({
    port,
    async close() {
      if (pool !== undefined) {
        await pool.end();
      }
    },
  });
}
