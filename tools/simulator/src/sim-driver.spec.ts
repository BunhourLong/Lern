import type { Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from './api.client';
import { SimDriver } from './sim-driver';

const at = { lat: 11.56, lng: 104.92 };
const ride = { id: '00000000-0000-4000-8000-000000000001', status: 'searching', pickup: at, dropoff: at } as Ride;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SimDriver', () => {
  it('stays busy with a ride assigned while a failing tick was in flight', async () => {
    let failEmit!: (err: Error) => void;
    const emits: Promise<unknown>[] = [
      new Promise((_, reject) => (failEmit = reject)),
      new Promise(() => undefined), // later ticks hang: the test looks at the state right after the failure
    ];
    const socket = { timeout: () => ({ emitWithAck: () => emits.shift() }), disconnect: () => undefined } as unknown as Socket;
    const onIdle = jest.fn();
    const driver = new SimDriver({ userId: 'd', token: 't' }, socket, at, {
      api: { move: () => Promise.resolve({ ...ride, status: 'driver_assigned' }) } as unknown as ApiClient,
      router: (from, to) => Promise.resolve([from, to]),
      speedMps: 1,
      tickMs: 1,
      rand: () => 0.5,
      log: () => undefined,
      onIdle,
    });
    await flush();
    driver.assign(ride);
    failEmit(new Error('socket timeout'));
    await flush();
    expect(driver.idle).toBe(false);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
