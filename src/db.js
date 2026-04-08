import pg from "pg";
import {
  DATABASE_URL,
  PGHOST,
  PGPORT,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
  PGSSL
} from "./config.js";

const { Pool } = pg;
let pool = null;
let initPromise = null;

function resolvePassword() {
  if (typeof PGPASSWORD === "string") return PGPASSWORD;
  if (PGPASSWORD === null || PGPASSWORD === undefined) return "";
  return String(PGPASSWORD);
}

function getPoolConfig() {
  const password = resolvePassword();
  if (DATABASE_URL) {
    return {
      connectionString: DATABASE_URL,
      password,
      ssl: PGSSL ? { rejectUnauthorized: false } : undefined
    };
  }
  return {
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password,
    database: PGDATABASE,
    ssl: PGSSL ? { rejectUnauthorized: false } : undefined
  };
}

export async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    pool = new Pool(getPoolConfig());
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id integer PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  })();
  return initPromise;
}

export async function loadAppState(defaultState) {
  await initDb();
  const res = await pool.query("SELECT data FROM app_state WHERE id=1");
  if (!res.rows.length) {
    await pool.query("INSERT INTO app_state (id, data) VALUES (1, $1)", [defaultState]);
    return defaultState;
  }
  return res.rows[0].data || defaultState;
}

export async function saveAppState(state) {
  await initDb();
  await pool.query(
    "INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at",
    [state]
  );
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  initPromise = null;
}
