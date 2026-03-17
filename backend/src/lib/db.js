import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

// ── Connection pool ───────────────────────────────────────────────────────────
// Railway injects DATABASE_URL automatically when you add a Postgres plugin.
// ssl: rejectUnauthorized false is required for Railway/Render hosted Postgres.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
})

// Convenience wrapper — always releases the client
export async function query(text, params) {
  const start = Date.now()
  const res = await pool.query(text, params)
  const duration = Date.now() - start
  if (process.env.NODE_ENV !== 'production') {
    console.log('[db]', { text: text.slice(0, 80), duration, rows: res.rowCount })
  }
  return res
}

// Single-row helper
export async function queryOne(text, params) {
  const res = await query(text, params)
  return res.rows[0] ?? null
}

export default { query, queryOne, pool }