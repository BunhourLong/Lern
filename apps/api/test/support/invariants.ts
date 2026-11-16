import type { DataSource } from 'typeorm';

const DRIVER_ACTIVE = `('driver_assigned', 'driver_arrived', 'in_progress')`;
const RIDER_ACTIVE = `('searching', 'driver_assigned', 'driver_arrived', 'in_progress')`;

// PLAN.md §6: one query per invariant (CLAUDE.md §3 and the availability machine), each returning the rows that
// break it. A healthy database returns none, however it got there.
const CHECKS: Record<string, string> = {
  'one active ride per driver': `SELECT driver_id FROM rides WHERE status IN ${DRIVER_ACTIVE} GROUP BY driver_id HAVING count(*) > 1`,
  'one active ride per rider': `SELECT rider_id FROM rides WHERE status IN ${RIDER_ACTIVE} GROUP BY rider_id HAVING count(*) > 1`,
  'one pending offer per ride': `SELECT ride_id FROM ride_offers WHERE status = 'pending' GROUP BY ride_id HAVING count(*) > 1`,
  'one pending offer per driver': `SELECT driver_id FROM ride_offers WHERE status = 'pending' GROUP BY driver_id HAVING count(*) > 1`,
  'accepted only before expires_at': `SELECT id FROM ride_offers WHERE status = 'accepted' AND responded_at >= expires_at`,
  'a ride has a driver iff its offer was accepted': `SELECT r.id FROM rides r
    WHERE (r.driver_id IS NOT NULL) <> EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = r.id AND o.status = 'accepted')
       OR EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = r.id AND o.status = 'accepted' AND o.driver_id <> r.driver_id)`,
  'searching or no_driver_found rides have no driver': `SELECT id FROM rides
    WHERE status IN ('searching', 'no_driver_found') AND driver_id IS NOT NULL
       OR status IN ${DRIVER_ACTIVE} AND driver_id IS NULL`,
  'reserved iff holding a pending offer': `SELECT user_id FROM drivers d
    WHERE (d.availability = 'reserved') <> EXISTS (SELECT 1 FROM ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'pending')`,
  'on_trip iff on an active ride': `SELECT user_id FROM drivers d
    WHERE (d.availability = 'on_trip') <> EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = d.user_id AND r.status IN ${DRIVER_ACTIVE})`,
  'one event per ride version': `SELECT r.id FROM rides r
    WHERE r.version <> (SELECT count(*) FROM ride_events e WHERE e.ride_id = r.id)
       OR r.version <> (SELECT max(seq) FROM ride_events e WHERE e.ride_id = r.id)`,
};

export async function violations(db: DataSource): Promise<{ invariant: string; id: string }[]> {
  const sql = Object.entries(CHECKS)
    .map(([name, query]) => `SELECT '${name}' AS invariant, id::text FROM (${query}) AS v(id)`)
    .join(' UNION ALL ');
  return db.query(sql);
}
