import { DataSource } from 'typeorm';
import { EnablePostgis1792383670000 } from './migrations/1792383670000-enable-postgis';

// Migrations are listed, not globbed, so the same list works from ts (tests) and dist (CLI)
export const migrations = [EnablePostgis1792383670000];

export function createDataSource(url: string): DataSource {
  return new DataSource({ type: 'postgres', url, synchronize: false, migrations });
}
