import { OFFER_UPDATED_EVENT, type Offer, type Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from './api.client';
import { SimDriver } from './sim-driver';

const at = { lat: 11.56, lng: 104.92 };
const offer = { id: '00000000-0000-4000-8000-000000000002', rideId: '00000000-0000-4000-8000-000000000001', status: 'pending' } as Offer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('SimDriver', () => {
  it('still accepts an offer that arrived while a failing tick was in flight', async () => {
    let failEmit!: (err: Error) => void;
    let push!: (o: Offer) => void;
    const emits: Promise<unknown>[] = [new Promise((_, reject) => (failEmit = reject))];
    const socket = {
      on: (event: string, handler: (o: Offer) => void) => event === OFFER_UPDATED_EVENT && (push = handler),
      timeout: () => ({ emitWithAck: () => emits.shift() ?? new Promise(() => undefined) }), // later ticks hang
      disconnect: () => undefined,
    } as unknown as Socket;
    const accept = jest.fn(() => Promise.resolve({ id: offer.rideId, status: 'driver_assigned', pickup: at, dropoff: at } as Ride));
    new SimDriver({ userId: 'd', token: 't' }, socket, at, {
      api: { accept } as unknown as ApiClient,
      router: (from, to) => Promise.resolve([from, to]),
      speedMps: 1,
      tickMs: 1,
      rand: () => 0.5,
      log: () => undefined,
    });
    await flush();
    push(offer);
    failEmit(new Error('socket timeout'));
    await flush();
    expect(accept).toHaveBeenCalledWith('t', offer.id);
  });

  it('forgets an offer that expired before its next tick', async () => {
    let push!: (o: Offer) => void;
    let tick!: () => void;
    const socket = {
      on: (event: string, handler: (o: Offer) => void) => event === OFFER_UPDATED_EVENT && (push = handler),
      timeout: () => ({ emitWithAck: () => new Promise((resolve) => (tick = () => resolve({ dropped: 0 }))) }),
      disconnect: () => undefined,
    } as unknown as Socket;
    const accept = jest.fn();
    new SimDriver({ userId: 'd', token: 't' }, socket, at, {
      api: { accept } as unknown as ApiClient,
      router: (from, to) => Promise.resolve([from, to]),
      speedMps: 1,
      tickMs: 1,
      rand: () => 0.5,
      log: () => undefined,
    });
    await flush();
    push(offer);
    push({ ...offer, status: 'expired' });
    tick();
    await flush();
    expect(accept).not.toHaveBeenCalled();
  });
});
