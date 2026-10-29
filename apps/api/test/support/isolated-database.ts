import { randomUUID } from 'node:crypto';
import { createDataSource } from '../../src/shared/database/database';

// A migrated database of its own in the shared container, for suites whose code scans every row (sweep,
// reconciler): run against the shared one, it would offer other suites' rides to other suites' drivers
export async function isolatedDatabase(): Promise<string> {
  const url = new URL(process.env.DATABASE_URL!);
  const admin = await createDataSource(url.toString()).initialize();
  const name = `iso_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.destroy();
  }
  url.pathname = `/${name}`;
  const ds = await createDataSource(url.toString()).initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
  return url.toString();
}
