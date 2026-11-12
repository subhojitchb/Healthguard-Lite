
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await query("SELECT NOW() AS current_time");
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  testConnection
};
