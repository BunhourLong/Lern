import { randomUUID } from 'node:crypto';
import {
  driverProfileSchema,
  IDEMPOTENCY_KEY_HEADER,
  meSchema,
  type Point,
  quoteSchema,
  type Ride,
  rideSchema,
  tokenPairSchema,
} from '@lern/contracts';
import { io, type Socket } from 'socket.io-client';
import type { z } from 'zod';

export type Session = { userId: string; token: string };

// The same public REST + socket API the apps use; responses are parsed with the contracts, so drift fails loudly
export class ApiClient {
  constructor(private readonly base: string) {}

  // Dev OTP provider: the fixed code works without requesting one
  async signIn(phone: string): Promise<Session> {
    const { accessToken } = await this.send('POST', '/auth/otp/verify', tokenPairSchema, undefined, {
      phone,
      code: '000000',
    }).catch((err: Error) => {
      throw new Error(`${err.message} (is the API running with OTP_PROVIDER=dev?)`);
    });
    const { id } = await this.send('GET', '/me', meSchema, accessToken);
    return { userId: id, token: accessToken };
  }

  async applyDriver(token: string): Promise<void> {
    await this.send('POST', '/drivers/me', driverProfileSchema, token, { vehicleType: 'remork', plate: 'SIM 1A-0000' });
  }

  async book(token: string, pickup: Point, dropoff: Point): Promise<Ride> {
    const quote = await this.send('POST', '/quotes', quoteSchema, token, { pickup, dropoff, vehicleType: 'remork' });
    return this.send('POST', '/rides', rideSchema, token, { quoteId: quote.id });
  }

  // accept, arrive, start, complete
  move(token: string, rideId: string, action: string): Promise<Ride> {
    return this.send('POST', `/rides/${rideId}/${action}`, rideSchema, token, {});
  }

  connect(token: string): Promise<Socket> {
    const socket = io(this.base, { auth: { token }, transports: ['websocket'] });
    return new Promise((resolve, reject) =>
      socket.once('connect', () => resolve(socket)).once('connect_error', (err) => {
        socket.disconnect();
        reject(err);
      }),
    );
  }

  private async send<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    token?: string,
    body?: object,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (method !== 'GET') headers[IDEMPOTENCY_KEY_HEADER] = randomUUID();
    const res = await fetch(this.base + path, { method, headers, body: body && JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return schema.parse(await res.json());
  }
}
