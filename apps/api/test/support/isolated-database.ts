import { randomUUID } from 'node:crypto';
import { createDataSource } from '../../src/shared/database/database';

// Migrated once by global-setup; nothing may connect to it, or Postgres refuses to clone it
export const TEMPLATE_DB = 'iso_template';

// A migrated database of its own in the shared container, for suites whose code scans every row (sweep,
// reconciler): run against the shared one, it would offer other suites' rides to other suites' drivers
export async function isolatedDatabase(): Promise<string> {
  const url = new URL(process.env.DATABASE_URL!);
  const admin = await createDataSource(url.toString()).initialize();
  const name = `iso_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await admin.destroy();
  }
  url.pathname = `/${name}`;
  return url.toString();
}
