import { DataSource, type DataSourceOptions } from 'typeorm';
import { EnablePostgis1792383670000 } from './migrations/1792383670000-enable-postgis';
import { CreateUsersAndRefreshTokens1792391315000 } from './migrations/1792391315000-create-users-and-refresh-tokens';
import { CreateUserRoles1792391999000 } from './migrations/1792391999000-create-user-roles';
import { CreateDrivers1792392447000 } from './migrations/1792392447000-create-drivers';
import { CreateQuotes1792483200000 } from './migrations/1792483200000-create-quotes';
import { CreateRides1792486800000 } from './migrations/1792486800000-create-rides';
import { CreateIdempotencyKeys1792486900000 } from './migrations/1792486900000-create-idempotency-keys';

// Migrations are listed, not globbed, so the same list works from ts (tests) and dist (CLI)
export const migrations = [
  EnablePostgis1792383670000,
  CreateUsersAndRefreshTokens1792391315000,
  CreateUserRoles1792391999000,
  CreateDrivers1792392447000,
  CreateQuotes1792483200000,
  CreateRides1792486800000,
  CreateIdempotencyKeys1792486900000,
];

export function dataSourceOptions(url: string): DataSourceOptions {
  return { type: 'postgres', url, synchronize: false, migrations };
}

export function createDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}
