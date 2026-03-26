const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

async function query(text, params) {
  const client = await pool.connect();
  try { const result = await client.query(text, params); return result; } finally { client.release(); }
}
async function queryOne(text, params) { const result = await query(text, params); return result.rows[0] || null; }
async function queryAll(text, params) { const result = await query(text, params); return result.rows; }

module.exports = { pool, query, queryOne, queryAll };
