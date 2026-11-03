import {
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
  type Ride,
} from '@lern/contracts';
import { ApiError, createApi } from './api.service';
import type { SecretStore } from './storage.service';

const ride = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'driver_arrived',
  version: 3,
  vehicleType: 'remork',
  pickup: { lat: 11.55, lng: 104.92 },
  dropoff: { lat: 11.54, lng: 104.92 },
  fare: { amountMinor: 4000, currency: 'KHR' },
} as unknown as Ride;
const tokens = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `r${String(n).padStart(42, '0')}`,
});

type Call = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};
type Reply = { status: number; body?: unknown } | 'offline';

// A server that answers in order and records what it was sent
function server(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? 'GET',
      path: url.replace('http://api.test', ''),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = replies.shift() ?? { status: 500 };
    if (reply === 'offline') throw new TypeError('Network request failed');
    return {
      status: reply.status,
      ok: reply.status < 300,
      text: async () =>
        reply.body === undefined ? '' : JSON.stringify(reply.body),
    };
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}
function secret(initial?: string) {
  let value = initial;
  const store: SecretStore = {
    get: async () => value,
    set: async v => {
      value = v;
    },
    clear: async () => {
      value = undefined;
    },
  };
  return { store, now: () => value };
}
const api = (
  s: ReturnType<typeof server>,
  refresh = secret(),
  onSignedOut = jest.fn(),
) => ({
  api: createApi({
    baseUrl: 'http://api.test',
    fetch: s.fetch,
    refreshToken: refresh.store,
    onSignedOut,
  }),
  refresh,
  onSignedOut,
});

it('signs in with a code, keeps the refresh token in the secret store, and sends the access token', async () => {
  const s = server(
    { status: 200, body: tokens(1) },
    { status: 200, body: ride },
  );
  const { api: client, refresh } = api(s);
  await client.verifyOtp('+85512345678', '000000');
  expect(refresh.now()).toBe(tokens(1).refreshToken);
  expect(await client.step(ride.id, 'arrive')).toEqual(ride);
  expect(s.calls[1]).toMatchObject({
    method: 'POST',
    path: `/rides/${ride.id}/arrive`,
    headers: { authorization: 'Bearer access-1' },
  });
});

it('registers this phone for pushes, with a key, and accepts the empty 204', async () => {
  const s = server({ status: 200, body: tokens(1) }, { status: 204 });
  const { api: client } = api(s);
  await client.verifyOtp('+85512345678', '000000');
  await expect(client.registerDevice('fcm-token', 'android')).resolves.toBeUndefined();
  expect(s.calls[1]).toMatchObject({
    method: 'PUT',
    path: '/me/device-token',
    body: { token: 'fcm-token', platform: 'android' },
  });
  expect(
    idempotencyKeySchema.safeParse(s.calls[1].headers[IDEMPOTENCY_KEY_HEADER]).success,
  ).toBe(true);
});

it('sends an Idempotency-Key on a mutating call: the caller’s on a retry, a fresh one otherwise', async () => {
  const s = server(
    { status: 200, body: tokens(1) },
    { status: 200, body: ride },
    { status: 200, body: ride },
  );
  const { api: client } = api(s);
  await client.verifyOtp('+85512345678', '000000');
  await client.step(ride.id, 'arrive', '11111111-1111-4111-8111-111111111111');
  await client.step(ride.id, 'arrive');
  expect(s.calls[1].headers[IDEMPOTENCY_KEY_HEADER]).toBe(
    '11111111-1111-4111-8111-111111111111',
  );
  expect(
    idempotencyKeySchema.safeParse(s.calls[2].headers[IDEMPOTENCY_KEY_HEADER])
      .success,
  ).toBe(true);
  expect(s.calls[2].headers[IDEMPOTENCY_KEY_HEADER]).not.toBe(
    s.calls[1].headers[IDEMPOTENCY_KEY_HEADER],
  );
});

it('tells offline (status 0), a refusal (its status and body) and a malformed body apart', async () => {
  const s = server(
    'offline',
    { status: 409, body: { code: 'INVALID_TRANSITION', ride } },
    { status: 200, body: { id: 'nope' } },
  );
  const { api: client } = api(s);
  await expect(client.activeRide()).rejects.toEqual(new ApiError(0, null));
  await expect(client.step(ride.id, 'start')).rejects.toEqual(
    new ApiError(409, { code: 'INVALID_TRANSITION', ride }),
  );
  await expect(client.activeRide()).rejects.toMatchObject({
    status: 200,
    body: { error: 'BAD_RESPONSE' },
  });
});

it('on a 401 refreshes once, keeps the rotated refresh token, and retries with the new access token', async () => {
  const s = server(
    { status: 401 },
    { status: 200, body: tokens(2) },
    { status: 200, body: { rider: null, driver: null, offer: null } },
  );
  const { api: client, refresh } = api(s, secret(tokens(1).refreshToken));
  expect(await client.activeRide()).toEqual({
    rider: null,
    driver: null,
    offer: null,
  });
  expect(s.calls.map(c => c.path)).toEqual([
    '/me/active-ride',
    '/auth/refresh',
    '/me/active-ride',
  ]);
  expect(s.calls[1].body).toEqual({ refreshToken: tokens(1).refreshToken });
  expect(s.calls[2].headers.authorization).toBe('Bearer access-2');
  expect(refresh.now()).toBe(tokens(2).refreshToken);
});

it('runs one refresh for several requests that hit a 401 at once', async () => {
  const empty = {
    status: 200,
    body: { rider: null, driver: null, offer: null },
  };
  const s = server(
    { status: 401 },
    { status: 401 },
    { status: 200, body: tokens(2) },
    empty,
    empty,
  );
  const { api: client } = api(s, secret(tokens(1).refreshToken));
  await Promise.all([client.activeRide(), client.activeRide()]);
  expect(s.calls.filter(c => c.path === '/auth/refresh')).toHaveLength(1);
});

it('signs out when the server refuses the refresh token, and not when the phone is offline', async () => {
  const refused = api(
    server({ status: 401 }, { status: 401 }),
    secret(tokens(1).refreshToken),
  );
  await expect(refused.api.activeRide()).rejects.toMatchObject({ status: 401 });
  expect([
    refused.refresh.now(),
    refused.onSignedOut.mock.calls.length,
  ]).toEqual([undefined, 1]);

  const offline = api(
    server({ status: 401 }, 'offline'),
    secret(tokens(1).refreshToken),
  );
  await expect(offline.api.activeRide()).rejects.toEqual(new ApiError(0, null));
  expect([
    offline.refresh.now(),
    offline.onSignedOut.mock.calls.length,
  ]).toEqual([tokens(1).refreshToken, 0]);
});

it('retries a refresh whose answer was lost with the same Idempotency-Key, so the server replays it', async () => {
  const s = server('offline', { status: 200, body: tokens(2) });
  const { api: client } = api(s, secret(tokens(1).refreshToken));
  expect(await client.restore()).toBe('offline');
  expect(await client.restore()).toBe('ok');
  expect(s.calls[0].headers[IDEMPOTENCY_KEY_HEADER]).toBe(
    s.calls[1].headers[IDEMPOTENCY_KEY_HEADER],
  );
  expect(s.calls[0].body).toEqual(s.calls[1].body);
});

it('restores a session at boot only when a refresh token is stored', async () => {
  const none = api(server());
  expect(await none.api.restore()).toBe('none');
  expect(none.api.accessToken()).toBeUndefined();
  const stored = api(
    server({ status: 200, body: tokens(2) }),
    secret(tokens(1).refreshToken),
  );
  expect(await stored.api.restore()).toBe('ok');
  expect(stored.api.accessToken()).toBe('access-2');
});

it('keeps the real status of a non-JSON error page (a proxy 502), instead of calling it offline', async () => {
  const fetch = jest.fn(async () => ({
    status: 502,
    ok: false,
    text: async () => '<html>Bad Gateway</html>',
  }));
  const client = createApi({
    baseUrl: 'http://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
    refreshToken: secret().store,
    onSignedOut: jest.fn(),
  });
  await expect(client.activeRide()).rejects.toEqual(new ApiError(502, null));
});

it('tells boot why a session could not be restored: none stored, refused, or offline', async () => {
  expect(await api(server()).api.restore()).toBe('none');
  expect(
    await api(server('offline'), secret(tokens(1).refreshToken)).api.restore(),
  ).toBe('offline');
  expect(
    await api(
      server({ status: 401 }),
      secret(tokens(1).refreshToken),
    ).api.restore(),
  ).toBe('refused');
  expect(
    await api(
      server({ status: 200, body: tokens(2) }),
      secret(tokens(1).refreshToken),
    ).api.restore(),
  ).toBe('ok');
});

it('keeps the session when a refresh answer breaks the contract (a mangled 200), and signs out only on a refusal', async () => {
  const mangled = api(
    server({ status: 200, body: { accessToken: 1 } }),
    secret(tokens(1).refreshToken),
  );
  expect(await mangled.api.restore()).toBe('offline');
  expect([
    mangled.refresh.now(),
    mangled.onSignedOut.mock.calls.length,
  ]).toEqual([tokens(1).refreshToken, 0]);
  for (const status of [400, 401, 403, 404]) {
    const refused = api(server({ status }), secret(tokens(1).refreshToken));
    expect(await refused.api.restore()).toBe('refused');
  }
});
