import type { Ride } from '@lern/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { Actor } from './actors';

// A pending offer of the ride to `driver`, made the way matching makes one (driver online, then reserved),
// without depending on where the driver is. Returns the offer id.
export async function offer(app: INestApplication<App>, driver: Actor, rideId: string): Promise<string> {
  await request(app.getHttpServer()).put('/drivers/me/availability').set(driver.auth).send({ online: true }).expect(200);
  const [{ id }] = await app.get(DataSource).query<{ id: string }[]>(
    `WITH o AS (
       INSERT INTO ride_offers (ride_id, driver_id, distance_m, expires_at)
       VALUES ($1, $2, 0, now() + interval '15 seconds') RETURNING id
     ), d AS (
       UPDATE drivers SET availability = 'reserved' WHERE user_id = $2
     )
     SELECT id FROM o`,
    [rideId, driver.id],
  );
  return id;
}

// The ride assigned to `driver` through a real accept
export async function assign(app: INestApplication<App>, driver: Actor, rideId: string): Promise<Ride> {
  const offerId = await offer(app, driver, rideId);
  return (await request(app.getHttpServer()).post(`/offers/${offerId}/accept`).set(driver.auth).expect(200)).body as Ride;
}
