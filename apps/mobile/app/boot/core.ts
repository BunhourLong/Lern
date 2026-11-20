import {
  type ActiveRides,
  type ApplyDriver,
  type CancelReason,
  type DriverVerification,
  driverVerificationSchema,
  type LocationPoint,
  type Me,
  meSchema,
  type PushData,
  type Ride,
  rideSchema,
} from '@lern/contracts';
import type { io } from 'socket.io-client';
import { createStore } from 'zustand/vanilla';
import { ApiError, createApi } from '../services/api.service';
import {
  createOfflineQueue,
  type QueuedStep,
} from '../services/offline-queue.service';
import {
  createPinLock,
  type PinCheck,
  type PinHasher,
} from '../services/pin-lock.service';
import { createPush, type PushNative } from '../services/push.service';
import { connectSocket, type RealtimeSocket } from '../services/socket.service';
import type { KeyValueStore, SecretStore } from '../services/storage.service';
import { createActiveRideStore } from '../stores/active-ride.store';
import { appGate, createAppConfigStore } from '../stores/app-config.store';
import { createConnectionStore } from '../stores/connection.store';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { createLanguageStore } from '../stores/language.store';
import { createRawEventsStore } from '../stores/raw-events.store';
import { createSecurityStore } from '../stores/security.store';
import { createSessionStore } from '../stores/session.store';
import { keepRide } from '../utils/ordering';

export type NotificationTarget =
  | { type: 'offer'; id: string }
  | { type: 'ride'; id: string; status: Ride['status'] };

export type CoreDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  io: typeof io;
  kv: KeyValueStore; // MMKV in the app
  deviceLocale: () => string;
  refreshToken: SecretStore; // Keychain in the app
  pin: SecretStore; // app-lock PIN hash, its own Keychain entry
  pinHasher: PinHasher; // expo-crypto in the app
  elapsed: () => number; // monotonic ms for PIN waits (performance.now in the app): the device clock can be moved
  push: PushNative; // React Native Firebase in the app
  appVersion: string; // this build's version, for the minimum-version gate
  sleep?: (ms: number) => Promise<void>; // backoff between offline retries
};

// MMKV (kv) is wiped on uninstall, the iOS Keychain is not: its absence marks a new install.
const INSTALL_FLAG = 'install';
const SESSION_CACHE_KEY = 'session-cache.v1';

function readCachedSession(kv: KeyValueStore) {
  try {
    const cached = JSON.parse(kv.get(SESSION_CACHE_KEY) ?? 'null') as {
      me?: unknown;
      verification?: unknown;
    } | null;
    const me = meSchema.safeParse(cached?.me);
    const verification = driverVerificationSchema
      .nullable()
      .safeParse(cached?.verification);
    if (me.success && verification.success)
      return { me: me.data, verification: verification.data };
  } catch {
    // A partial or corrupt cache is discarded below.
  }
  kv.remove(SESSION_CACHE_KEY);
}

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
  deviceLocale,
  refreshToken,
  pin,
  pinHasher,
  elapsed,
  push: pushNative,
  appVersion,
  sleep = wait,
}: CoreDeps) {
  const session = createSessionStore();
  const activeRide = createActiveRideStore();
  const notification = createStore<NotificationTarget | null>()(() => null);
  const driverMode = createDriverModeStore();
  const rawEvents = createRawEventsStore();
  const appConfig = createAppConfigStore();
  const connection = createConnectionStore();
  const security = createSecurityStore();
  const language = createLanguageStore(kv, deviceLocale);
  const pinLock = createPinLock({
    secret: pin,
    kv,
    hasher: pinHasher,
    elapsed,
  });
  let socket: RealtimeSocket | undefined;
  let verifiedPhone: string | undefined;
  let usingCachedSession = false;
  let pendingTap: PushData | undefined;
  let tapVersion = 0;
  // Bumped on sign-out: an answer to a request sent before it must not land in the next user's stores
  let epoch = 0;
  let pinAttempt = 0;
  const live = () => {
    const started = epoch;
    return () => started === epoch;
  };

  function clearTap() {
    tapVersion++;
    pendingTap = undefined;
    notification.setState(null, true);
  }

  const forget = () => {
    epoch++;
    clearTap();
    socket?.close();
    socket = undefined;
    connection.getState().setConnected(false); // close() fires disconnect only while connected; reset here so sign-out never relies on it
    push.stop();
    queue.clear();
    activeRide.getState().reset();
    driverMode.setState({
      availability: null,
      verification: null,
      locationPermission: null,
    });
    rawEvents.getState().reset(); // the next user on this phone must not see the last one's rides
    session.getState().signedOut();
    // The PIN belongs to who was signed in; a Keychain that refuses to clear keeps it until the next sign-out
    security.getState().update({ enabled: false, locked: false, waitMs: 0 });
    return pinLock.clear();
  };
  const api = createApi({
    baseUrl,
    fetch,
    refreshToken,
    onSignedOut: () => {
      forget().catch(() => undefined);
    },
  });
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
    register: (token, platform, locale) =>
      api.registerDevice(token, platform, locale),
    onWake: () => {
      resync();
    },
    onOpen: tap => {
      clearTap();
      pendingTap = tap;
      openPendingTap();
    },
  });

  function openPendingTap() {
    const { status, me } = session.getState();
    const { gate } = appConfig.getState();
    if (status === 'signed_out' || (gate && gate.status !== 'ok')) {
      clearTap();
      return;
    }
    if (usingCachedSession || !me || gate?.status !== 'ok' || !pendingTap) return;
    const tap = pendingTap;
    const version = tapVersion;
    pendingTap = undefined;
    openTap(tap, me, () => version === tapVersion);
  }

  session.subscribe((next, previous) => {
    if (next.status === 'signed_out') {
      usingCachedSession = false;
      kv.remove(SESSION_CACHE_KEY);
    }
    if (previous.me && previous.me.id !== next.me?.id) clearTap();
    openPendingTap();
  });
  appConfig.subscribe(openPendingTap);

  function cacheSession(me: Me, verification: DriverVerification | null) {
    kv.set(SESSION_CACHE_KEY, JSON.stringify({ me, verification }));
  }

  async function openTap(tap: PushData, user: Me, current: () => boolean) {
    const snapshot = await resync(current);
    if (!snapshot || !current()) return;

    if (tap.type === 'offer') {
      const { offer } = activeRide.getState();
      if (
        user.roles.includes('driver') &&
        snapshot.offer?.id === tap.offerId &&
        offer?.id === tap.offerId &&
        offer.rideId === tap.rideId &&
        offer.status === 'pending'
      )
        notification.setState({ type: 'offer', id: offer.id }, true);
      return;
    }

    const match = ({ rider, driver }: Pick<ActiveRides, 'rider' | 'driver'>) =>
      [rider, driver].find(ride => ride?.id === tap.rideId);
    const ride =
      match(snapshot) ?? (await api.ride(tap.rideId).catch(() => undefined));
    if (!current() || ride?.id !== tap.rideId) return;
    const latest = keepRide(match(activeRide.getState()) ?? null, ride);
    if (latest.version >= Number(tap.seq))
      notification.setState(
        { type: 'ride', id: latest.id, status: latest.status },
        true,
      );
  }

  // Started, never awaited: a slow or missing /app-config must not delay session restore, and any failure (offline,
  // a 5xx, a rejected body) is ok — never lock users out when the API is down
  async function checkAppConfig(): Promise<void> {
    try {
      const config = await api.appConfig();
      appConfig
        .getState()
        .setGate(appGate(config, pushNative.platform, appVersion));
    } catch {
      appConfig
        .getState()
        .setGate(appGate(null, pushNative.platform, appVersion));
    }
  }

  // After every (re)connect: what was missed is not replayed, so read the snapshot, then send what waited
  async function resync(current = live()): Promise<ActiveRides | undefined> {
    let snapshot: ActiveRides | undefined;
    try {
      snapshot = await api.activeRide();
    } catch {
      // offline again or signed out; the next connect tries again
    }
    if (!current()) return;
    if (snapshot) activeRide.getState().applySnapshot(snapshot);
    await queue.flush();
    return current() ? snapshot : undefined;
  }

  let availabilityRequest = 0;
  let availabilityWrite = 0;
  async function refreshAvailability() {
    const user = session.getState().me;
    if (usingCachedSession || !user?.roles.includes('driver')) return;
    const request = ++availabilityRequest;
    const initialWrite = availabilityWrite;
    try {
      const profile = await api.profile();
      if (request === availabilityRequest && session.getState().me === user) {
        if (driverMode.getState().verification !== profile.verification)
          cacheSession(user, profile.verification);
        driverMode.setState(state => ({
          // Keep availability from a newer toggle. Verification only comes from the profile.
          availability:
            initialWrite === availabilityWrite
              ? profile.availability
              : state.availability,
          verification: profile.verification,
        }));
      }
    } catch {
      // Keep the last known driver status. The next resume or reconnect retries.
    }
  }

  async function start(user: Me): Promise<void> {
    const previous = session.getState().me;
    if (previous && previous.id !== user.id) {
      // Queue cleanup behind any old PIN write before exposing the replacement account.
      const cleared = forget();
      const stillReplacing = live();
      try {
        await cleared;
      } catch (err) {
        if (stillReplacing()) await api.signOut();
        throw err;
      }
      if (!stillReplacing()) return;
    }
    const current = live();
    const profile = user.roles.includes('driver') ? await api.profile() : null;
    if (!current()) return;
    const verification = profile?.verification ?? null;
    cacheSession(user, verification);
    usingCachedSession = false;
    session.getState().signedIn(user);
    driverMode.setState({
      availability: profile?.availability ?? null,
      verification,
    });
    socket?.close();
    socket = connectSocket({
      url: baseUrl,
      io,
      token: api.accessToken,
      refresh: api.restore,
      sleep,
      handlers: {
        onRaw: (event, payload) => rawEvents.getState().add(event, payload),
        onConnect: () => {
          connection.getState().setConnected(true);
          refreshAvailability();
          resync();
          push.sync();
        },
        onDisconnect: () => connection.getState().setConnected(false),
        onRide: ride => activeRide.getState().applyRide(ride),
        onOffer: offer => activeRide.getState().applyOffer(offer),
        onPosition: position => activeRide.getState().applyPosition(position),
        onConnectivity: c => activeRide.getState().applyConnectivity(c),
        onRejected: event =>
          console.warn(`dropped a malformed ${event} payload`),
      },
    });
  }

  // A PIN answer: ok runs onOk, a wrong PIN shows its wait, the last allowed wrong PIN signs out
  async function pinResult(
    result: PinCheck,
    onOk: () => void,
  ): Promise<PinCheck> {
    if (result.ok) onOk();
    else if ('wiped' in result) await api.signOut();
    else security.getState().update({ waitMs: result.waitMs });
    return result;
  }

  // Runs fn and applies its result only if nobody signed out meanwhile
  async function command<T>(fn: () => Promise<T>, apply: (result: T) => void) {
    const current = live();
    const result = await fn();
    if (current()) apply(result);
  }

  return {
    stores: {
      session,
      activeRide,
      notification,
      driverMode,
      rawEvents,
      appConfig,
      connection,
      security,
      language,
    },
    api,
    queue,
    refreshAvailability,
    // App start: show the cached session while restoring with backoff. Without a cache, stay 'restoring'
    // until the server responds. Only none or refused means sign in again.
    async boot(): Promise<void> {
      push.listenForOpens();
      checkAppConfig();
      // A reinstall can still find the old token in the iOS Keychain: drop it before any restore attempt.
      // Clear first, then set the flag, so a crash in between checks again instead of keeping the stale token.
      if (kv.get(INSTALL_FLAG) === undefined) {
        await refreshToken.clear();
        await pinLock.clear();
        kv.set(INSTALL_FLAG, '1');
      }
      // A Keychain that won't answer locks: the lock fails closed
      const locked = await pinLock.isEnabled().catch(() => true);
      security
        .getState()
        .update({ enabled: locked, locked, waitMs: pinLock.waitMs() });
      const cached = readCachedSession(kv);
      if (cached) {
        usingCachedSession = true;
        driverMode.setState({ verification: cached.verification });
        session.getState().signedIn(cached.me);
      }
      const current = live();
      for (let delay = 1000; current(); delay = Math.min(delay * 2, 60_000)) {
        // A retry after /me failed keeps the access token it got: no second refresh rotation
        const restored = api.accessToken() ? 'ok' : await api.restore();
        if (restored === 'none' || restored === 'refused') {
          session.getState().signedOut();
          // A sign-out while offline couldn't delete the token: this is its next try (refused has just done it)
          if (restored === 'none') {
            if (cached) driverMode.setState({ verification: null });
            push.stop();
          }
          return;
        }
        if (restored === 'ok') {
          try {
            const user = await api.me();
            if (current()) await start(user);
            return;
          } catch (err) {
            if (!transient(err)) throw err;
          }
        }
        await sleep(delay);
      }
    },
    stopListeningForPush(): void {
      clearTap();
      push.removeListeners();
    },
    async signIn(phone: string, code: string): Promise<void> {
      // Reuse an access token only for the phone whose OTP verification completed.
      if (phone !== verifiedPhone || !api.accessToken()) {
        verifiedPhone = undefined;
        await api.verifyOtp(phone, code);
        verifiedPhone = phone;
      }
      await start(await api.me());
    },
    signOut: () => api.signOut(),
    async becomeDriver(input: ApplyDriver): Promise<void> {
      const current = live();
      try {
        await api.applyDriver(input);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
      if (!current()) return;
      const user = await api.me();
      if (current()) await start(user);
    },

    // Optional app lock: covers the screen only, the session stays valid behind it
    pinWaitMs: pinLock.waitMs,
    interruptPinCheck(): void {
      pinAttempt++;
    },
    lock(): void {
      pinAttempt++;
      if (security.getState().enabled)
        security.getState().update({ locked: true });
    },
    async unlock(pinCode: string): Promise<PinCheck> {
      const current = live();
      const user = session.getState().me?.id;
      const attempt = ++pinAttempt;
      const result = await pinLock.check(pinCode, security.getState().enabled);
      if (!current() || session.getState().me?.id !== user)
        return { ok: false, waitMs: 0 };
      if (result.ok && attempt !== pinAttempt)
        return { ok: false, waitMs: pinLock.waitMs() };
      return pinResult(result, () =>
        security.getState().update({ locked: false, waitMs: 0 }),
      );
    },
    async enableLock(pinCode: string): Promise<void> {
      const current = live();
      await pinLock.enable(pinCode);
      if (current()) security.getState().update({ enabled: true });
    },
    disableLock: async (pinCode: string) =>
      pinResult(await pinLock.disable(pinCode), () =>
        security
          .getState()
          .update({ enabled: false, locked: false, waitMs: 0 }),
      ),
    changePin: async (old: string, next: string) =>
      pinResult(await pinLock.change(old, next), () =>
        security.getState().update({ waitMs: 0 }),
      ),

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
        a => {
          availabilityWrite++;
          driverMode.getState().setAvailability(a.availability);
        },
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
