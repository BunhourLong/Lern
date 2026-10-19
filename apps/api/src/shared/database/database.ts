import { DataSource, type DataSourceOptions } from 'typeorm';
import { EnablePostgis1792383670000 } from './migrations/1792383670000-enable-postgis';
import { CreateUsersAndRefreshTokens1792391315000 } from './migrations/1792391315000-create-users-and-refresh-tokens';

// Migrations are listed, not globbed, so the same list works from ts (tests) and dist (CLI)
export const migrations = [EnablePostgis1792383670000, CreateUsersAndRefreshTokens1792391315000];

export function dataSourceOptions(url: string): DataSourceOptions {
  return { type: 'postgres', url, synchronize: false, migrations };
}

export function createDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}
