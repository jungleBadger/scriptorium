// server/services/pool.js
// Singleton Postgres connection pool shared by all repositories.

import pg from "pg";
const { Pool } = pg;

let _pool = null;

export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.PGHOST || "localhost",
      port: parseInt(process.env.PGPORT || "5432", 10),
      user: process.env.PGUSER || "bible",
      password: process.env.PGPASSWORD || "bible",
      database: process.env.PGDATABASE || "bible",
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    // Without this listener, an idle-client error (e.g. server-side disconnect)
    // emits an uncaught EventEmitter error and crashes the Node process.
    _pool.on("error", (err) => {
      console.error("[pool] idle client error", err);
    });
  }
  return _pool;
}

export async function closePool() {
  if (_pool) await _pool.end();
}
