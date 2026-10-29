import {
  type ApplyDriver,
  type DriverAvailability,
  type DriverAvailabilityAction,
  type DriverProfile,
  type DriverVerification,
  driverTransition,
} from '@lern/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

const PROFILE = 'vehicle_type AS "vehicleType", plate, verification, availability';

@Injectable()
export class DriversRepository {
  constructor(private readonly db: DataSource) {}

  // undefined when the user already has a profile (primary key), so parallel applications create one row
  async insert(tx: EntityManager, userId: string, input: ApplyDriver): Promise<DriverProfile | undefined> {
    const [row] = await tx.query<DriverProfile[]>(
      `INSERT INTO drivers (user_id, vehicle_type, plate) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING ${PROFILE}`,
      [userId, input.vehicleType, input.plate],
    );
    return row;
  }

  async find(userId: string): Promise<DriverProfile | undefined> {
    const [row] = await this.db.query<DriverProfile[]>(`SELECT ${PROFILE} FROM drivers WHERE user_id = $1`, [userId]);
    return row;
  }

  async verification(userId: string): Promise<DriverVerification | undefined> {
    const [row] = await this.db.query<{ verification: DriverVerification }[]>(
      'SELECT verification FROM drivers WHERE user_id = $1',
      [userId],
    );
    return row?.verification;
  }

  // One guarded move of the availability machine; false = the driver isn't in the move's `from` state
  async move(m: EntityManager, driverId: string, action: DriverAvailabilityAction): Promise<boolean> {
    const { from, to } = driverTransition(action);
    const [, count] = await m.query<[unknown, number]>(
      'UPDATE drivers SET availability = $3 WHERE user_id = $1 AND availability = $2',
      [driverId, from, to],
    );
    return count === 1;
  }

  async state(userId: string): Promise<{ verification: DriverVerification; availability: DriverAvailability } | undefined> {
    const [row] = await this.db.query<{ verification: DriverVerification; availability: DriverAvailability }[]>(
      'SELECT verification, availability FROM drivers WHERE user_id = $1',
      [userId],
    );
    return row;
  }
}
