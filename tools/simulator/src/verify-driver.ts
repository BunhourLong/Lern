import { Client } from 'pg';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

// Stand-in for M7's admin verify, as the api tests do it. Dev database only: the URL is checked before any
// connection, so a production DATABASE_URL in the env can never get simulated drivers verified. No query string
// at all: pg reads host/hostaddr from it over the authority (`localhost/db?host=prod` connects to prod).
export async function verifyDriver(databaseUrl: string, userId: string): Promise<void> {
  const url = URL.parse(databaseUrl);
  if (!url || url.search || !LOCAL.includes(url.hostname)) {
    throw new Error('refusing to verify drivers outside a local database');
  }
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(`UPDATE drivers SET verification = 'verified' WHERE user_id = $1`, [userId]);
  } finally {
    await db.end();
  }
}
