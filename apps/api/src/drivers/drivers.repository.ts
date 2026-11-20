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
// What the driver owes in KHR (negative = owes). KHR only: cents never add to riel.
const KHR_BALANCE = `(SELECT coalesce(sum(amount_minor), 0) FROM driver_ledger_entries WHERE driver_id = $1 AND currency = 'KHR')`;

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

  // One guarded move of the availability machine, logged in the same statement; false = the driver isn't in
  // the move's `from` state, or (with limitMinor) owes more than it. The debt guard sits in the UPDATE's own snapshot,
  // so a ride end committing its debit and debt_stop together is seen whole or not at all.
  async move(m: EntityManager, driverId: string, action: DriverAvailabilityAction, limitMinor?: number): Promise<boolean> {
    const { from, to } = driverTransition(action);
    const debt = limitMinor === undefined ? '' : ` AND ${KHR_BALANCE} >= -$5::bigint`;
    const rows = await m.query<unknown[]>(
      `WITH moved AS (
         UPDATE drivers SET availability = $3 WHERE user_id = $1 AND availability = $2${debt} RETURNING user_id
       )
       INSERT INTO driver_availability_events (driver_id, action, from_state, to_state)
       SELECT user_id, $4, $2, $3 FROM moved
       RETURNING id`,
      limitMinor === undefined ? [driverId, from, to, action] : [driverId, from, to, action, limitMinor],
    );
    return rows.length === 1;
  }

  // SUM over bigint is numeric (a string in node-pg), so the comparison stays in SQL.
  // Inside a ride's transaction pass its manager: another connection can't see the debit that ride just wrote.
  async withinDebtLimit(driverId: string, limitMinor: number, m: EntityManager = this.db.manager): Promise<boolean> {
    const [{ ok }] = await m.query<{ ok: boolean }[]>(`SELECT ${KHR_BALANCE} >= -$2::bigint AS ok`, [driverId, limitMinor]);
    return ok;
  }

  async state(userId: string): Promise<{ verification: DriverVerification; availability: DriverAvailability } | undefined> {
    const [row] = await this.db.query<{ verification: DriverVerification; availability: DriverAvailability }[]>(
      'SELECT verification, availability FROM drivers WHERE user_id = $1',
      [userId],
    );
    return row;
  }
}
