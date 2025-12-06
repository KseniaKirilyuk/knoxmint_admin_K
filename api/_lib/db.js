import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export { pool };
