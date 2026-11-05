import { OFFER_UPDATED_EVENT, type Offer, type Ride } from '@lern/contracts';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from './api.client';
import { SimDriver } from './sim-driver';

const at = { lat: 11.56, lng: 104.92 };
const offer = { id: '00000000-0000-4000-8000-000000000002', rideId: '00000000-0000-4000-8000-000000000001', status: 'pending' } as Offer;
const until = async (done: () => boolean) => {
  for (const end = Date.now() + 2000; !done(); await new Promise((resolve) => setTimeout(resolve, 2))) {
    if (Date.now() > end) throw new Error('condition not met within 2 s');
  }
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('SimDriver', () => {
  it('still accepts an offer that arrived while a failing tick was in flight', async () => {
    let failEmit!: (err: Error) => void;
    let push!: (o: Offer) => void;
    const emits: Promise<unknown>[] = [new Promise((_, reject) => (failEmit = reject))];
    const socket = {
      connected: true,
      on: (event: string, handler: (o: Offer) => void) => event === OFFER_UPDATED_EVENT && (push = handler),
      timeout: () => ({ emitWithAck: () => emits.shift() ?? new Promise(() => undefined) }), // later ticks hang
      disconnect: () => undefined,
    } as unknown as Socket;
    const accept = jest.fn(() => Promise.resolve({ id: offer.rideId, status: 'driver_assigned', pickup: at, dropoff: at } as Ride));
    new SimDriver({ userId: 'd', token: 't' }, socket, at, {
      api: { accept, activeRides: () => Promise.resolve({ rider: null, driver: null }) } as unknown as ApiClient,
      router: (from, to) => Promise.resolve([from, to]),
      speedMps: 1,
      tickMs: 1,
      rand: () => 0.5,
      log: () => undefined,
    });
    await flush();
    push(offer);
    failEmit(new Error('socket timeout'));
    await until(() => accept.mock.calls.length > 0);
    expect(accept).toHaveBeenCalledWith('t', offer.id);
  });

  it('forgets an offer that expired before its next tick', async () => {
    let push!: (o: Offer) => void;
    let tick!: () => void;
    const socket = {
      connected: true,
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

describe('SimDriver reconnect recovery', () => {
  const rideOf = (status: string) => ({ id: offer.rideId, status, pickup: at, dropoff: at }) as Ride;
  const build = (api: Record<string, unknown>, emit: () => Promise<unknown>, connected = true) => {
    const handlers = new Map<string, (o: unknown) => void>();
    const socket = {
      connected,
      on: (event: string, h: (o: unknown) => void) => handlers.set(event, h),
      timeout: () => ({ emitWithAck: emit }),
      disconnect: () => undefined,
    } as unknown as Socket;
    // Parks after a few routes so the loop ends instead of ticking forever
    let calls = 0;
    const router = jest.fn((from: typeof at, to: typeof at): Promise<(typeof at)[]> => (++calls > 40 ? hang() : Promise.resolve([from, to])));
    const driver = new SimDriver({ userId: 'd', token: 't' }, socket, at, {
      api: api as unknown as ApiClient,
      router,
      speedMps: 1e9, // every route is covered in one tick
      tickMs: 1,
      rand: () => 0.5,
      log: () => undefined,
    });
    return {
      driver,
      router,
      connect: () => handlers.get('connect')!(undefined),
      push: (o: Offer) => handlers.get(OFFER_UPDATED_EVENT)!(o),
    };
  };
  const hang = <T>() => new Promise<T>(() => undefined);
  const ok = () => Promise.resolve({ dropped: 0 });
  const moves = () => jest.fn((_t: string, _id: string, action: string) => Promise.resolve(rideOf(action === 'start' ? 'in_progress' : 'driver_arrived')));

  it('accepts the pending offer a reconnect snapshot carries', async () => {
    const accept = jest.fn(() => Promise.resolve(rideOf('driver_assigned')));
    const { connect } = build({ accept, activeRides: () => Promise.resolve({ rider: null, driver: null, offer }) }, ok);
    await flush();
    connect();
    await until(() => accept.mock.calls.length > 0);
    expect(accept).toHaveBeenCalledWith('t', offer.id);
  });

  it('continues a snapshot ride that is driver_arrived with start', async () => {
    const move = moves();
    const { connect } = build({ move, activeRides: () => Promise.resolve({ rider: null, driver: rideOf('driver_arrived') }) }, ok);
    await flush();
    connect();
    await until(() => move.mock.calls.length > 0);
    const actions = move.mock.calls.map((c) => c[2]);
    expect([actions[0], actions.includes('arrive')]).toEqual(['start', false]);
  });

  // Accepts a pushed offer (pickup far away), then the first emit fails with the ride held
  const heldThenFail = (snapshot: unknown, extra: Record<string, unknown> = {}) => {
    const far = { lat: 11.9, lng: 105.3 };
    const accept = jest.fn(() => Promise.resolve({ ...rideOf('driver_assigned'), pickup: far }));
    const move = jest.fn(() => Promise.resolve(rideOf('completed')));
    let failed = false;
    const emit = () => {
      if (!accept.mock.calls.length || failed) return ok();
      failed = true; // the first emit after the ride is held
      return Promise.reject(new Error('socket timeout'));
    };
    const activeRides = jest.fn(() => Promise.resolve(snapshot));
    const b = build({ accept, move, activeRides, ...extra }, emit);
    b.push(offer);
    return { ...b, move, activeRides };
  };

  it('keeps a ride whose command failed and completes it from the snapshot', async () => {
    const { move } = heldThenFail({ rider: null, driver: rideOf('in_progress') });
    await until(() => move.mock.calls.length > 0);
    expect(move).toHaveBeenCalledWith('t', offer.rideId, 'complete');
  });

  it('does not treat the ride it still holds as recovered when the snapshot agrees', async () => {
    const { driver, move, activeRides } = heldThenFail({ rider: null, driver: rideOf('driver_assigned') });
    await until(() => activeRides.mock.calls.length > 0 && move.mock.calls.length > 0); // resync done, ride went on
    expect(driver.recovered).toBe(0);
  });

  it('wanders again when the snapshot says it has no ride (no ghost ride)', async () => {
    const { move, router, activeRides } = heldThenFail({ rider: null, driver: null });
    await until(() => activeRides.mock.calls.length > 0);
    const seen = router.mock.calls.length;
    await until(() => router.mock.calls.length > seen); // wandered after the resync
    expect(move).not.toHaveBeenCalled();
  });

  it('skips the position emit while disconnected and keeps the loop running', async () => {
    const emit = jest.fn(hang);
    const { router } = build({}, emit, false);
    await until(() => router.mock.calls.length > 1);
    expect(emit).not.toHaveBeenCalled();
    expect(router).toHaveBeenCalled(); // the route ended: wandering continues
  });
});
