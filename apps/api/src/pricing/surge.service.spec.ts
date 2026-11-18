import { Logger } from '@nestjs/common';
import { once } from 'node:events';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { Redis } from 'ioredis';
import type { PricingConfig } from './pricing.config';
import type { PricingRepository } from './pricing.repository';
import { SurgeService } from './surge.service';

// A Redis that accepts the connection and never answers. The shared client (offline queue on, 20 retries)
// would hold the HGET for ~10 s, so without its own timeout a Redis outage would stall every quote.
let server: Server;
const sockets: Socket[] = [];
beforeAll(async () => {
  server = createServer((socket) => sockets.push(socket)).listen(0, '127.0.0.1');
  await once(server, 'listening');
});
afterAll(() => {
  for (const socket of sockets) socket.destroy();
  server.close();
});

it('prices at 1.0x after 200 ms when Redis never answers, and the late rejection of its read is handled', async () => {
  const redis = new Redis((server.address() as AddressInfo).port, '127.0.0.1', { disconnectTimeout: 200 });
  redis.on('error', () => {});
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const surge = new SurgeService({ QUEUE_PREFIX: 'unit', SURGE_CAP_BP: 20_000 } as PricingConfig, {} as PricingRepository, redis);
  try {
    const started = performance.now();
    await expect(surge.surgeBp('moto', { lat: 11.5564, lng: 104.9282 })).resolves.toBe(10_000);
    const elapsed = performance.now() - started;
    // Waited for the read, gave up on its own timer (wall clock only bounds it loosely: CI load can stall the loop)
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(2000); // not the client's ~10 s
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no answer within 200 ms'));

    // The client rejects the HGET it still queues once the socket closes (after disconnectTimeout).
    // Jest fails the test on an unhandled rejection, so reaching the end is the assertion.
    const ended = once(redis, 'end');
    redis.disconnect();
    await ended;
    await new Promise(setImmediate);
  } finally {
    redis.disconnect();
    warn.mockRestore();
  }
});
