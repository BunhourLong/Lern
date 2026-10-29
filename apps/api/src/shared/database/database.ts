import { DataSource, type DataSourceOptions } from 'typeorm';
import { EnablePostgis1792383670000 } from './migrations/1792383670000-enable-postgis';
import { CreateUsersAndRefreshTokens1792391315000 } from './migrations/1792391315000-create-users-and-refresh-tokens';
import { CreateUserRoles1792391999000 } from './migrations/1792391999000-create-user-roles';
import { CreateDrivers1792392447000 } from './migrations/1792392447000-create-drivers';
import { CreateQuotes1792483200000 } from './migrations/1792483200000-create-quotes';
import { CreateRides1792486800000 } from './migrations/1792486800000-create-rides';
import { CreateIdempotencyKeys1792486900000 } from './migrations/1792486900000-create-idempotency-keys';
import { RidesOneActivePerDriver1792573200000 } from './migrations/1792573200000-rides-one-active-per-driver';
import { CreateRideEvents1792576800000 } from './migrations/1792576800000-create-ride-events';
import { RidesCancelReason1792583685644 } from './migrations/1792583685644-rides-cancel-reason';
import { CreateDriverLocations1792591652004 } from './migrations/1792591652004-create-driver-locations';
import { CreateTripPoints1792593369866 } from './migrations/1792593369866-create-trip-points';
import { CreateOutboxEvents1792629104815 } from './migrations/1792629104815-create-outbox-events';
import { DriversAvailability1793241466000 } from './migrations/1793241466000-drivers-availability';
import { CreateRideOffers1793241933000 } from './migrations/1793241933000-create-ride-offers';
import { CreateDriverAvailabilityEvents1793255695994 } from './migrations/1793255695994-create-driver-availability-events';

// Migrations are listed, not globbed, so the same list works from ts (tests) and dist (CLI)
export const migrations = [
  EnablePostgis1792383670000,
  CreateUsersAndRefreshTokens1792391315000,
  CreateUserRoles1792391999000,
  CreateDrivers1792392447000,
  CreateQuotes1792483200000,
  CreateRides1792486800000,
  CreateIdempotencyKeys1792486900000,
  RidesOneActivePerDriver1792573200000,
  CreateRideEvents1792576800000,
  RidesCancelReason1792583685644,
  CreateDriverLocations1792591652004,
  CreateTripPoints1792593369866,
  CreateOutboxEvents1792629104815,
  DriversAvailability1793241466000,
  CreateRideOffers1793241933000,
  CreateDriverAvailabilityEvents1793255695994,
];

export function dataSourceOptions(url: string): DataSourceOptions {
  return { type: 'postgres', url, synchronize: false, migrations };
}

export function createDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}
