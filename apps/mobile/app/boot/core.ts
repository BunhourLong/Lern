import {
  type CancelReason,
  type LocationPoint,
  type Me,
  rideSchema,
} from '@lern/contracts';
import type { io } from 'socket.io-client';
import { ApiError, createApi } from '../services/api.service';
import {
  createOfflineQueue,
  type QueuedStep,
} from '../services/offline-queue.service';
import { createPush, type PushNative } from '../services/push.service';
import { connectSocket, type RealtimeSocket } from '../services/socket.service';
import type { KeyValueStore, SecretStore } from '../services/storage.service';
import { createActiveRideStore } from '../stores/active-ride.store';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { createSessionStore } from '../stores/session.store';

export type CoreDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  io: typeof io;
  kv: KeyValueStore; // MMKV in the app
  refreshToken: SecretStore; // Keychain in the app
  push: PushNative; // React Native Firebase in the app
  sleep?: (ms: number) => Promise<void>; // backoff between offline retries
};

const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
// Worth retrying at boot: no answer or a server failure, not a refusal
const transient = (err: unknown) =>
  err instanceof ApiError && (err.status === 0 || err.status >= 500);

// The headless app (PLAN.md M5): services and stores wired together, no UI. Native pieces come in through deps,
// so the whole flow runs in Jest. Reconnect flow: socket connects → REST snapshot → queue flush; events then apply
// only when newer than what the stores hold.
export function createCore({
  baseUrl,
  fetch,
  io,
  kv,
  refreshToken,
  push: pushNative,
  sleep = wait,
}: CoreDeps) {
  const session = createSessionStore();
  const activeRide = createActiveRideStore();
  const driverMode = createDriverModeStore();
  let socket: RealtimeSocket | undefined;
  // Bumped on sign-out: an answer to a request sent before it must not land in the next user's stores
  let epoch = 0;
  const live = () => {
    const started = epoch;
    return () => started === epoch;
  };

  const forget = () => {
    epoch++;
    socket?.close();
    socket = undefined;
    push.stop();
    queue.clear();
    activeRide.getState().reset();
    driverMode.getState().setAvailability(null);
    session.getState().signedOut();
  };
  const api = createApi({ baseUrl, fetch, refreshToken, onSignedOut: forget });
  const queue = createOfflineQueue({
    store: kv,
    api,
    onStepDone: ride => activeRide.getState().applyRide(ride, 'driver'),
    // A refused step (409) brings the ride as the server has it
    onRejected: (_: QueuedStep, err) => {
      const ride = rideSchema.safeParse(
        (err.body as { ride?: unknown } | null)?.ride,
      );
      if (ride.success) activeRide.getState().applyRide(ride.data, 'driver');
    },
  });

  const push = createPush({
    native: pushNative,
    register: (token, platform) => api.registerDevice(token, platform),
    onWake: () => {
      resync();
    },
  });

  // After every (re)connect: what was missed is not replayed, so read the snapshot, then send what waited
  async function resync(): Promise<void> {
    const current = live();
    try {
      const snapshot = await api.activeRide();
      if (current()) activeRide.getState().applySnapshot(snapshot);
    } catch {
      // offline again or signed out; the next connect tries again
    }
    if (current()) await queue.flush();
  }

  async function start(user: Me): Promise<void> {
    const current = live();
    const availability = user.roles.includes('driver')
      ? (await api.profile()).availability
      : null;
    if (!current()) return;
    session.getState().signedIn(user);
    driverMode.getState().setAvailability(availability);
    socket = connectSocket({
      url: baseUrl,
      io,
      token: api.accessToken,
      refresh: api.restore,
      sleep,
      handlers: {
        onConnect: () => {
          resync();
          push.sync();
        },
        onRide: ride => activeRide.getState().applyRide(ride),
        onOffer: offer => activeRide.getState().applyOffer(offer),
        onPosition: position => activeRide.getState().applyPosition(position),
        onConnectivity: c => activeRide.getState().applyConnectivity(c),
        onRejected: event =>
          console.warn(`dropped a malformed ${event} payload`),
      },
    });
  }

  // Runs fn and applies its result only if nobody signed out meanwhile
  async function command<T>(fn: () => Promise<T>, apply: (result: T) => void) {
    const current = live();
    const result = await fn();
    if (current()) apply(result);
  }

  return {
    stores: { session, activeRide, driverMode },
    api,
    queue,
    // App start: a stored refresh token becomes a session. Offline keeps the session 'restoring' (the token stays,
    // the queue keeps filling) and tries again with backoff; only none or refused means sign in again.
    async boot(): Promise<void> {
      const current = live();
      for (let delay = 1000; current(); delay = Math.min(delay * 2, 60_000)) {
        // A retry after /me failed keeps the access token it got: no second refresh rotation
        const restored = api.accessToken() ? 'ok' : await api.restore();
        if (restored === 'none' || restored === 'refused') {
          session.getState().signedOut();
          // A sign-out while offline couldn't delete the token: this is its next try (refused has just done it)
          if (restored === 'none') push.stop();
          return;
        }
        if (restored === 'ok') {
          try {
            return await start(await api.me());
          } catch (err) {
            if (!transient(err)) throw err;
          }
        }
        await sleep(delay);
      }
    },
    async signIn(phone: string, code: string): Promise<void> {
      await api.verifyOtp(phone, code);
      await start(await api.me());
    },
    signOut: () => api.signOut(),

    // Time-bound decisions: straight to the server, the caller shows the result or the error now
    book: (quoteId: string) =>
      command(
        () => api.book(quoteId),
        ride => activeRide.getState().applyRide(ride, 'rider'),
      ),
    cancel: (rideId: string, reason: CancelReason) =>
      command(
        () => api.cancel(rideId, reason),
        ride => activeRide.getState().applyRide(ride),
      ),
    accept: (offerId: string) =>
      command(
        () => api.accept(offerId),
        ride => activeRide.getState().applyRide(ride, 'driver'),
      ),
    decline: (offerId: string) =>
      command(
        () => api.decline(offerId),
        offer => activeRide.getState().applyOffer(offer),
      ),
    setOnline: (online: boolean) =>
      command(
        () => api.setAvailability(online),
        a => driverMode.getState().setAvailability(a.availability),
      ),
    // Trip steps survive a dead zone: queued with their key, sent now if the network allows
    async step(rideId: string, action: QueuedStep['action']): Promise<void> {
      queue.enqueueStep(rideId, action);
      await queue.flush();
    },
    // Foreground position over the socket; anything it can't deliver waits for an HTTP batch.
    // shortcut: points queued while the socket is up but its acks fail wait for the next connect or step to be
    // flushed (bounded by the queue's 2000-point cap); flush on a timer if that shows up in practice
    async reportPosition(point: LocationPoint): Promise<void> {
      if (!(await socket?.sendLocation(point))) queue.enqueuePoint(point);
    },
  };
}

export type Core = ReturnType<typeof createCore>;
