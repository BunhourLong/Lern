import {
  type ActiveRides,
  activeRidesSchema,
  type AppConfig,
  appConfigSchema,
  type Availability,
  availabilitySchema,
  type CancelReason,
  type CreateQuote,
  type DriverProfile,
  driverProfileSchema,
  IDEMPOTENCY_KEY_HEADER,
  type LocationPoint,
  type LocationResult,
  locationResultSchema,
  type Me,
  meSchema,
  type Offer,
  type PushLocale,
  type PushPlatform,
  offerSchema,
  type Quote,
  quoteSchema,
  type Ride,
  rideSchema,
  tokenPairSchema,
} from '@lern/contracts';
import { uuid } from '../utils/uuid';
import type { SecretStore } from './storage.service';

// status 0 = no answer (offline, timeout); otherwise the server's status and body. A 2xx with a body the contract
// rejects is { error: 'BAD_RESPONSE' } with that status.
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API ${status}`);
  }
}

export type ApiDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  refreshToken: SecretStore;
  onSignedOut: () => void;
  timeoutMs?: number;
};
type Send = { body?: unknown; key?: string; auth?: boolean };
export type Refreshed = 'ok' | 'none' | 'refused' | 'offline';
// Any contracts schema (Zod), without depending on Zod here
type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};
const empty: Parser<undefined> = {
  safeParse: v =>
    v === undefined ? { success: true, data: undefined } : { success: false },
};

export type Api = ReturnType<typeof createApi>;

// The contracts-typed REST client. The access token lives only in memory; the refresh token in the SecretStore.
export function createApi(deps: ApiDeps) {
  let accessToken: string | undefined;
  let refreshing: Promise<Refreshed> | undefined;
  // One refresh action keeps its key until it gets an answer: a lost response retried with a new key would look
  // like a reused refresh token to the server, which then revokes the whole session
  let refreshKey: string | undefined;

  async function raw(
    method: string,
    path: string,
    { body, key, auth = true }: Send,
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (key) headers[IDEMPOTENCY_KEY_HEADER] = key;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? 10_000);
    let res: Response;
    let text: string;
    try {
      res = await deps.fetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      text = await res.text();
    } catch {
      throw new ApiError(0, null);
    } finally {
      clearTimeout(timer);
    }
    // A proxy's HTML error page is still that status, not "offline"
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {}
    return { status: res.status, ok: res.ok, json };
  }

  async function send<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    opts: Send = {},
  ): Promise<T> {
    let res = await raw(method, path, opts);
    if (res.status === 401 && opts.auth !== false) {
      const refreshed = await refresh();
      // Offline is not "unauthorized": callers (the offline queue) must keep the request, not drop it
      if (refreshed === 'offline') throw new ApiError(0, null);
      if (refreshed === 'ok') res = await raw(method, path, opts);
    }
    if (!res.ok) throw new ApiError(res.status, res.json ?? null);
    const parsed = schema.safeParse(res.json);
    if (!parsed.success)
      throw new ApiError(res.status, { error: 'BAD_RESPONSE' });
    return parsed.data;
  }

  // Single-flight: requests that hit a 401 together wait for one refresh. Only a refusal from the server signs out;
  // being offline doesn't
  function refresh(): Promise<Refreshed> {
    refreshing ??= (async (): Promise<Refreshed> => {
      try {
        const token = await deps.refreshToken.get();
        if (!token) return 'none';
        refreshKey ??= uuid();
        const pair = await send('POST', '/auth/refresh', tokenPairSchema, {
          body: { refreshToken: token },
          key: refreshKey,
          auth: false,
        });
        refreshKey = undefined;
        accessToken = pair.accessToken;
        await deps.refreshToken.set(pair.refreshToken);
        return 'ok';
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        // Only a clear refusal ends the session: 401 rotated/reused/revoked, or a token the server can't read.
        // Anything else (offline, 5xx, 429, a mangled 2xx, 409 still running) keeps it for another try.
        if ([400, 401, 403, 404].includes(status)) {
          await forget();
          return 'refused';
        }
        if (status === 422) refreshKey = undefined; // the key met another token: start a new action
        return 'offline';
      }
    })().finally(() => (refreshing = undefined));
    return refreshing;
  }

  // The local half of sign-out: the session is gone from this phone whatever the server says
  async function forget(): Promise<void> {
    accessToken = undefined;
    refreshKey = undefined;
    // A Keychain that refuses to clear must not keep the session alive; the token expires on the server instead
    await deps.refreshToken.clear().catch(() => undefined);
    deps.onSignedOut();
  }

  // Local sign-out first, so an offline sign-out is instant and core's session epoch already drops late answers;
  // then tell the server to revoke the family. A lost logout is not retried (see the catch below).
  async function signOut(): Promise<void> {
    // A Keychain that refuses to hand over the token must not block sign-out; with no token there is nothing to revoke
    const token = await deps.refreshToken.get().catch(() => undefined);
    await forget();
    if (!token) return;
    try {
      await send('POST', '/auth/logout', empty, {
        body: { refreshToken: token },
        auth: false,
      });
    } catch {
      // shortcut: a lost logout is not retried; the token is already gone from this phone, so the family just expires. Retry from the offline queue if forced logout must be guaranteed.
    }
  }

  return {
    accessToken: () => accessToken,
    // Boot and socket re-auth: a stored refresh token becomes a session. offline = try again later (the token is
    // kept); none or refused = sign in again
    restore: refresh,
    signOut,
    appConfig: (): Promise<AppConfig> =>
      send('GET', '/app-config', appConfigSchema, { auth: false }),
    requestOtp: (phone: string) =>
      send('POST', '/auth/otp/request', empty, {
        body: { phone },
        auth: false,
      }),
    async verifyOtp(phone: string, code: string): Promise<void> {
      const pair = await send('POST', '/auth/otp/verify', tokenPairSchema, {
        body: { phone, code },
        auth: false,
      });
      accessToken = pair.accessToken;
      refreshKey = undefined;
      await deps.refreshToken.set(pair.refreshToken);
    },
    me: (): Promise<Me> => send('GET', '/me', meSchema),
    activeRide: (): Promise<ActiveRides> =>
      send('GET', '/me/active-ride', activeRidesSchema),
    quote: (trip: CreateQuote): Promise<Quote> =>
      send('POST', '/quotes', quoteSchema, { body: trip, key: uuid() }),
    book: (quoteId: string, key = uuid()): Promise<Ride> =>
      send('POST', '/rides', rideSchema, { body: { quoteId }, key }),
    cancel: (
      rideId: string,
      reason: CancelReason,
      key = uuid(),
    ): Promise<Ride> =>
      send('POST', `/rides/${rideId}/cancel`, rideSchema, {
        body: { reason },
        key,
      }),
    step: (
      rideId: string,
      action: 'arrive' | 'start' | 'complete',
      key = uuid(),
    ): Promise<Ride> =>
      send('POST', `/rides/${rideId}/${action}`, rideSchema, { key }),
    accept: (offerId: string, key = uuid()): Promise<Ride> =>
      send('POST', `/offers/${offerId}/accept`, rideSchema, { key }),
    decline: (offerId: string, key = uuid()): Promise<Offer> =>
      send('POST', `/offers/${offerId}/decline`, offerSchema, { key }),
    profile: (): Promise<DriverProfile> =>
      send('GET', '/drivers/me', driverProfileSchema),
    setAvailability: (online: boolean, key = uuid()): Promise<Availability> =>
      send('PUT', '/drivers/me/availability', availabilitySchema, {
        body: { online },
        key,
      }),
    registerDevice: (
      token: string,
      platform: PushPlatform,
      locale: PushLocale,
      key = uuid(),
    ): Promise<void> =>
      send('PUT', '/me/device-token', empty, {
        body: { token, platform, locale },
        key,
      }),
    // No key: the server keeps only points newer than the stored one, so a replayed batch changes nothing
    recordLocations: (points: LocationPoint[]): Promise<LocationResult> =>
      send('POST', '/drivers/me/locations', locationResultSchema, {
        body: { points },
      }),
  };
}
