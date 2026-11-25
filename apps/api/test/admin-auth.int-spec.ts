import { createHash, randomUUID } from 'node:crypto';
import { Client, DuoException } from '@duosecurity/duo_universal';
import { Controller, Get, HttpStatus, type INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AdminRoute } from '../src/admin/admin.decorators';
import { createSuperAdmin } from '../src/admin/create-super-admin';
import { verifyMfaState } from '../src/admin/domain/mfa-state';
import { DUO_CLIENT } from '../src/admin/duo-staff-mfa.provider';
import { StaffAuthRepository } from '../src/admin/staff-auth.repository';
import { MFA_STATE_KEY, StaffAuthService } from '../src/admin/staff-auth.service';
import { StaffMfaProvider } from '../src/admin/staff-mfa.provider';
import { bootApp, signIn } from './support/actors';

const PASSWORD = 'correct horse battery';
const INVALID = { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' };
const ROUTES = [
  ['post', '/admin/auth/login'],
  ['get', '/admin/auth/me'],
  ['post', '/admin/auth/logout'],
  ['post', '/admin/auth/logout-all'],
  ['post', '/admin/auth/mfa/callback'],
] as const;

// An admin route mounted in an app with admin off: the app guard must still refuse it
@AdminRoute()
@Controller('admin/probe')
class AdminProbeController {
  @Get()
  probe(): string {
    return 'ok';
  }
}

let app: INestApplication<App>;
const http = () => request(app.getHttpServer());
const db = () => app.get(DataSource);
const sql = <T = unknown>(query: string, params: unknown[] = []) => db().query<T>(query, params);

const email = () => `staff-${randomUUID()}@lern.example`;
async function staff(password = PASSWORD): Promise<{ id: string; email: string }> {
  const address = email();
  const { id } = await createSuperAdmin(db(), { email: address, displayName: 'Ops Person', password });
  return { id, email: address };
}
const login = (address: string, password = PASSWORD) => http().post('/admin/auth/login').send({ email: address, password });
const cookiesOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
const cookieOf = (res: request.Response) => cookiesOf(res).at(0);
// A signed-in browser: its cookie pair and CSRF token
async function session(address: string) {
  const res = await login(address);
  expect(res.status).toBe(HttpStatus.OK);
  return { cookie: cookieOf(res)!.split(';')[0], csrf: (res.body as { csrfToken: string }).csrfToken };
}
const me = (cookie?: string) => (cookie ? http().get('/admin/auth/me').set('cookie', cookie) : http().get('/admin/auth/me'));
const credentials = (id: string) =>
  sql<{ failed_attempts: number; locked: boolean | null }[]>(
    `SELECT failed_attempts, locked_until > now() AS locked FROM staff_credentials WHERE staff_user_id = $1`,
    [id],
  ).then((rows) => rows[0]);
const sessionCount = (id: string) =>
  sql<{ n: number }[]>(`SELECT count(*)::int AS n FROM staff_sessions WHERE staff_user_id = $1`, [id]).then((r) => r[0].n);

const pendingMfaKeys = () => app.get(Redis).keys('mfa:pending:*');

// Every request here comes from loopback, so the per-IP window would fill across tests: each test starts with clean
// admin windows and no pending MFA logins. Only this suite uses rl:admin:* and mfa:pending:*.
async function clearAdminRedis(): Promise<void> {
  const redis = app.get(Redis);
  const keys = [...(await redis.keys('rl:admin:*')), ...(await pendingMfaKeys())];
  if (keys.length) await redis.del(...keys);
}

beforeAll(async () => {
  app = await (await bootApp({}, { ADMIN_ENABLED: true, STAFF_MFA_PROVIDER: 'dev', ADMIN_COOKIE_SECURE: true })).init();
});
beforeEach(clearAdminRedis);
afterEach(() => jest.restoreAllMocks());
afterAll(() => app.close());

describe('ADMIN_ENABLED=false', () => {
  it('404s every admin route, even one mounted by mistake', async () => {
    const off = await (await bootApp({ controllers: [AdminProbeController] }, { ADMIN_ENABLED: false })).init();
    try {
      for (const [method, path] of ROUTES) {
        expect((await request(off.getHttpServer())[method](path).send({})).status).toBe(HttpStatus.NOT_FOUND);
      }
      expect((await request(off.getHttpServer()).get('/admin/probe')).status).toBe(HttpStatus.NOT_FOUND);
      expect(() => off.get(StaffAuthService)).toThrow(); // not mounted at all, not just hidden by the guard
    } finally {
      await off.close();
    }
  });
});

describe('createSuperAdmin', () => {
  it('creates an active super admin with a scrypt hash', async () => {
    const { id, email: address } = await staff();
    expect(await sql(`SELECT email, display_name, status, is_super_admin, disabled_at FROM staff_users WHERE id = $1`, [id])).toEqual([
      { email: address, display_name: 'Ops Person', status: 'active', is_super_admin: true, disabled_at: null },
    ]);
    const [{ password_hash }] = await sql<{ password_hash: string }[]>(
      `SELECT password_hash FROM staff_credentials WHERE staff_user_id = $1`,
      [id],
    );
    expect(password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
  });

  it('rejects a short password and a taken email in any case, without echoing the password', async () => {
    const short = createSuperAdmin(db(), { email: email(), displayName: 'Ops', password: 'elevenchars' });
    await expect(short).rejects.toThrow(/password/i);
    await expect(short).rejects.not.toThrow(/elevenchars/);
    await expect(createSuperAdmin(db(), { email: email(), displayName: '  ', password: PASSWORD })).rejects.toThrow(/display/i);

    const { email: address } = await staff();
    const dup = createSuperAdmin(db(), { email: address.toUpperCase(), displayName: 'Ops', password: 'another long secret' });
    await expect(dup).rejects.toThrow(/already exists/);
    await expect(dup).rejects.not.toThrow(/another long secret|scrypt/);
  });
});

describe('POST /admin/auth/login', () => {
  it('starts a session in a host-only HttpOnly Secure cookie; /admin/auth/me reads it back', async () => {
    const { id, email: address } = await staff();
    const res = await login(` ${address.toUpperCase()} `);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(cookieOf(res)).toMatch(/^lern_staff=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/);
    const summary = { id, email: address, displayName: 'Ops Person', isSuperAdmin: true };
    expect(res.body).toEqual({ status: 'authenticated', staff: summary, csrfToken: expect.stringMatching(/^[\w-]{43}$/) as string });

    // The database holds only the token's hash
    const raw = cookieOf(res)!.split(';')[0].slice('lern_staff='.length);
    const [row] = await sql<{ token_hash: string; csrf_token: string; live: boolean }[]>(
      `SELECT token_hash, csrf_token, expires_at BETWEEN now() + interval '7 hours 59 minutes' AND now() + interval '8 hours' AS live
       FROM staff_sessions WHERE staff_user_id = $1`,
      [id],
    );
    expect(row).toEqual({ token_hash: createHash('sha256').update(raw).digest('hex'), csrf_token: (res.body as { csrfToken: string }).csrfToken, live: true });

    const ok = await me(`lern_staff=${raw}`);
    expect(ok.status).toBe(HttpStatus.OK);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body).toEqual({ staff: summary, csrfToken: (res.body as { csrfToken: string }).csrfToken });
  });

  it('keeps staff and app identities apart: no cookie, a forged or duplicated cookie, or a Bearer token is 401', async () => {
    const { email: address } = await staff();
    const { cookie } = await session(address);
    const rider = await signIn(app);

    expect((await me()).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(`lern_staff=${'A'.repeat(43)}`)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(`${cookie}; ${cookie}`)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(`${cookie}; lern_staff=${'A'.repeat(43)}`)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await http().get('/admin/auth/me').set(rider.auth)).status).toBe(HttpStatus.UNAUTHORIZED);
    // The mobile API takes no staff cookie either
    expect((await http().get('/me').set('cookie', cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('answers a wrong password, an unknown email and a disabled account alike, with no cookie and no MFA step', async () => {
    const { email: address } = await staff();
    const disabled = await staff();
    await sql(`UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`, [disabled.id]);
    const begin = jest.spyOn(app.get(StaffMfaProvider), 'begin');

    for (const res of [await login(address, 'wrong password'), await login(email()), await login(disabled.email)]) {
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(cookieOf(res)).toBeUndefined();
    }
    expect(begin).not.toHaveBeenCalled();
    expect(await sessionCount(disabled.id)).toBe(0);
  });

  // A cross-site <form method=POST> can only send form or text bodies; JSON needs a CORS preflight
  it('refuses a form-encoded login with 415, even with the right password: no login CSRF', async () => {
    const { id, email: address } = await staff();
    const res = await http().post('/admin/auth/login').type('form').send({ email: address, password: PASSWORD });
    expect(res.status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(cookieOf(res)).toBeUndefined();
    expect(await sessionCount(id)).toBe(0);
  });

  it('rejects a malformed body with 400 before any check', async () => {
    expect((await http().post('/admin/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(HttpStatus.BAD_REQUEST);
    expect((await http().post('/admin/auth/login').send({ email: email(), password: '' })).status).toBe(HttpStatus.BAD_REQUEST);
  });
});

describe('lockout', () => {
  it('locks after 5 wrong passwords; then even the right one is refused until the lock lapses', async () => {
    const { id, email: address } = await staff();
    for (let i = 0; i < 5; i++) expect((await login(address, 'wrong password')).status).toBe(HttpStatus.UNAUTHORIZED);
    expect(await credentials(id)).toEqual({ failed_attempts: 5, locked: true });

    // The right password on a locked account never reaches the second factor (no push to the real owner's phone)
    const begin = jest.spyOn(app.get(StaffMfaProvider), 'begin');
    const locked = await login(address);
    expect(locked.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(locked.body).toEqual(INVALID);
    expect(cookieOf(locked)).toBeUndefined();
    expect(begin).not.toHaveBeenCalled();
    expect(await sessionCount(id)).toBe(0);

    // Lapsed lock: a wrong password starts a new count, the right one clears it
    await sql(`UPDATE staff_credentials SET locked_until = now() - interval '1 second' WHERE staff_user_id = $1`, [id]);
    expect((await login(address, 'wrong password')).status).toBe(HttpStatus.UNAUTHORIZED);
    expect(await credentials(id)).toEqual({ failed_attempts: 1, locked: null });
    expect((await login(address)).status).toBe(HttpStatus.OK);
    expect(await credentials(id)).toEqual({ failed_attempts: 0, locked: null });
  });

  it('still locks when 6 wrong passwords arrive at once, and the right one after them is refused', async () => {
    const { id, email: address } = await staff();
    const results = await Promise.all(Array.from({ length: 6 }, () => login(address, 'wrong password')));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(HttpStatus.UNAUTHORIZED));
    const after = await credentials(id);
    expect(after.failed_attempts).toBeGreaterThanOrEqual(5);
    expect(after.locked).toBe(true);

    const right = await login(address);
    expect(right.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(cookieOf(right)).toBeUndefined();
    expect(await sessionCount(id)).toBe(0);

    await sql(`UPDATE staff_credentials SET locked_until = now() - interval '1 second' WHERE staff_user_id = $1`, [id]);
    expect((await login(address)).status).toBe(HttpStatus.OK);
    expect(await credentials(id)).toEqual({ failed_attempts: 0, locked: null });
  });

  it('refuses the session when the account is locked or disabled while the password check and MFA run', async () => {
    for (const change of [
      `UPDATE staff_credentials SET locked_until = now() + interval '15 minutes' WHERE staff_user_id = $1`,
      `UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`,
    ]) {
      const { id, email: address } = await staff();
      jest.spyOn(app.get(StaffMfaProvider), 'begin').mockImplementationOnce(async () => {
        await sql(change, [id]);
        return { status: 'approved' };
      });
      const res = await login(address);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(cookieOf(res)).toBeUndefined();
      expect(await sessionCount(id)).toBe(0);
    }
  });
});

describe('lockout and disable racing a login', () => {
  const changes = [
    `UPDATE staff_credentials SET locked_until = now() + interval '15 minutes' WHERE staff_user_id = $1`,
    `UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`,
  ];

  it('never begins MFA when the account is locked or disabled while scrypt runs', async () => {
    const repo = app.get(StaffAuthRepository);
    const find = repo.findAccountByEmail.bind(repo);
    for (const change of changes) {
      const { id, email: address } = await staff();
      // The login reads an active, unlocked account; the change lands before the password check ends
      jest.spyOn(repo, 'findAccountByEmail').mockImplementationOnce(async (e) => {
        const account = await find(e);
        await sql(change, [id]);
        return account;
      });
      const begin = jest.spyOn(app.get(StaffMfaProvider), 'begin');
      const res = await login(address);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(begin).not.toHaveBeenCalled();
      expect(await sessionCount(id)).toBe(0);
      jest.restoreAllMocks();
    }
  });

  it('does not answer mfa_required when the account is locked or disabled while MFA redirect begins', async () => {
    for (const change of changes) {
      const { id, email: address } = await staff();
      jest.spyOn(app.get(StaffMfaProvider), 'begin').mockImplementationOnce(async () => {
        await sql(change, [id]);
        return { status: 'redirect', redirectUrl: 'https://duo.example/auth' };
      });
      const res = await login(address);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(cookieOf(res)).toBeUndefined();
      expect(await pendingMfaKeys()).toEqual([]);
      expect(await sessionCount(id)).toBe(0);
    }
  });

  // Gate: a disable held open on its own connection. The session insert must wait for it and then see 'disabled'.
  it('creates no session when a disable commits while the session is being created (5 rounds)', async () => {
    const repo = app.get(StaffAuthRepository);
    for (let round = 0; round < 5; round++) {
      const { id, email: address } = await staff();
      const account = (await repo.findAccountByEmail(address))!;
      await sql(`UPDATE staff_credentials SET failed_attempts = 3 WHERE staff_user_id = $1`, [id]);
      const disabler = db().createQueryRunner();
      await disabler.connect();
      try {
        await disabler.startTransaction();
        const [{ pid }] = (await disabler.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
        await disabler.query(`UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`, [id]);

        let settled = false;
        const creating = repo
          .createSessionIfEligible({
            staffUserId: id,
            expectedEmail: address,
            expectedPasswordUpdatedAt: account.passwordUpdatedAt,
            tokenHash: randomUUID(),
            csrfToken: 'c',
            ip: undefined,
            userAgent: undefined,
          })
          .finally(() => (settled = true));
        // Proof of overlap from the database's side: some backend is waiting on the disabler's lock
        let blocked = false;
        for (let waited = 0; waited < 2000 && !settled && !blocked; waited += 20) {
          const [{ n }] = await sql<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
            [pid],
          );
          blocked = n > 0;
          if (!blocked) await new Promise((r) => setTimeout(r, 20));
        }
        await disabler.commitTransaction();

        expect(await creating).toBeNull();
        expect(blocked).toBe(true);
        expect(await sessionCount(id)).toBe(0);
        expect((await credentials(id)).failed_attempts).toBe(3); // the reset didn't happen either
      } finally {
        if (disabler.isTransactionActive) await disabler.rollbackTransaction();
        await disabler.release();
      }
    }
  });

  it('a wrong password that lands on an already-locked account neither extends the lock nor counts', async () => {
    const { id } = await staff();
    await sql(`UPDATE staff_credentials SET failed_attempts = 5, locked_until = now() + interval '10 minutes' WHERE staff_user_id = $1`, [id]);
    const lockOf = () =>
      sql<{ failed_attempts: number; locked_until: Date }[]>(
        `SELECT failed_attempts, locked_until FROM staff_credentials WHERE staff_user_id = $1`,
        [id],
      ).then((r) => r[0]);
    const before = await lockOf();
    await app.get(StaffAuthRepository).recordFailedLogin(id);
    expect(await lockOf()).toEqual(before);
  });
});

describe('rate limits', () => {
  it('allows 10 attempts per email per 15 minutes, then 429 with retryAfter', async () => {
    const address = email();
    for (let i = 0; i < 10; i++) expect((await login(address, 'wrong password')).status).toBe(HttpStatus.UNAUTHORIZED);
    const res = await login(address, 'wrong password');
    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.body).toMatchObject({ statusCode: 429, message: 'Too many login attempts' });
    expect((res.body as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it('allows 20 attempts per IP per 15 minutes across emails, then 429', async () => {
    for (let i = 0; i < 20; i++) expect((await login(email(), 'wrong password')).status).toBe(HttpStatus.UNAUTHORIZED);
    const res = await login(email(), 'wrong password');
    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((res.body as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it('clears the email window on success, so a user who mistyped is not held back', async () => {
    const { email: address } = await staff();
    for (let i = 0; i < 4; i++) await login(address, 'wrong password');
    expect((await login(address)).status).toBe(HttpStatus.OK);
    expect(await app.get(Redis).exists(`rl:admin:login:email:${address}`)).toBe(0);
  });
});

describe('session lifetime (database clock)', () => {
  it('ends after 30 idle minutes without sliding; within them each request slides it', async () => {
    const { id, email: address } = await staff();
    const { cookie } = await session(address);
    const idle = (minutes: number) =>
      sql(`UPDATE staff_sessions SET last_seen_at = now() - $2 * interval '1 minute' WHERE staff_user_id = $1`, [id, minutes]);
    const lastSeenAgo = () =>
      sql<{ s: number }[]>(`SELECT extract(epoch FROM now() - last_seen_at)::int AS s FROM staff_sessions WHERE staff_user_id = $1`, [
        id,
      ]).then((r) => r[0].s);

    await idle(29);
    expect((await me(cookie)).status).toBe(HttpStatus.OK);
    expect(await lastSeenAgo()).toBeLessThan(5);

    await idle(31);
    expect((await me(cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect(await lastSeenAgo()).toBeGreaterThanOrEqual(31 * 60);
  });

  it('ends at expires_at even while in use', async () => {
    const { id, email: address } = await staff();
    const { cookie } = await session(address);
    await sql(`UPDATE staff_sessions SET expires_at = now() - interval '1 second', last_seen_at = now() WHERE staff_user_id = $1`, [id]);
    expect((await me(cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('ends at once when the staff member is disabled', async () => {
    const { id, email: address } = await staff();
    const { cookie, csrf } = await session(address);
    await sql(`UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`, [id]);
    expect((await me(cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
    const logout = await http().post('/admin/auth/logout').set('cookie', cookie).set('x-csrf-token', csrf);
    expect(logout.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('CSRF and logout', () => {
  it('refuses a mutating request without the session CSRF token: missing, wrong length or another session’s', async () => {
    const { email: address } = await staff();
    const mine = await session(address);
    const other = await session((await staff()).email);

    for (const path of ['/admin/auth/logout', '/admin/auth/logout-all']) {
      const post = () => http().post(path).set('cookie', mine.cookie);
      expect((await post()).status).toBe(HttpStatus.FORBIDDEN);
      expect((await post().set('x-csrf-token', 'short')).status).toBe(HttpStatus.FORBIDDEN);
      expect((await post().set('x-csrf-token', `${mine.csrf}é`)).status).toBe(HttpStatus.FORBIDDEN);
      expect((await post().set('x-csrf-token', other.csrf)).status).toBe(HttpStatus.FORBIDDEN);
    }
    expect((await me(mine.cookie)).status).toBe(HttpStatus.OK);
  });

  it('logout ends only this browser’s session and clears its cookie', async () => {
    const { email: address } = await staff();
    const first = await session(address);
    const second = await session(address);

    const res = await http().post('/admin/auth/logout').set('cookie', first.cookie).set('x-csrf-token', first.csrf);
    expect(res.status).toBe(HttpStatus.NO_CONTENT);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(cookieOf(res)).toBe('lern_staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    expect((await me(first.cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(second.cookie)).status).toBe(HttpStatus.OK);
  });

  it('logout-all ends every session of the staff member at once, and only theirs', async () => {
    const { id, email: address } = await staff();
    const first = await session(address);
    const second = await session(address);
    const bystander = await session((await staff()).email);

    const res = await http().post('/admin/auth/logout-all').set('cookie', first.cookie).set('x-csrf-token', first.csrf);
    expect(res.status).toBe(HttpStatus.NO_CONTENT);
    expect(cookieOf(res)).toBe('lern_staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    expect((await me(first.cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(second.cookie)).status).toBe(HttpStatus.UNAUTHORIZED);
    expect((await me(bystander.cookie)).status).toBe(HttpStatus.OK);
    expect(await sql(`SELECT count(*)::int AS n FROM staff_sessions WHERE staff_user_id = $1 AND revoked_at IS NULL`, [id])).toEqual([{ n: 0 }]);
  });
});

describe('StaffMfaProvider seam', () => {
  it('sends the browser to the provider with only a binding cookie, no session, when MFA asks for a redirect', async () => {
    const { id, email: address } = await staff();
    const begin = jest
      .spyOn(app.get(StaffMfaProvider), 'begin')
      .mockResolvedValue({ status: 'redirect', redirectUrl: 'https://duo.example/auth' });

    const res = await login(address);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ status: 'mfa_required', redirectUrl: 'https://duo.example/auth' });
    expect(cookiesOf(res)).toEqual([expect.stringMatching(/^__Host-lern_staff_mfa=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300; Secure$/)]);
    expect(begin).toHaveBeenCalledWith({ id, email: address }, expect.stringMatching(/^[\w-]+\.[\w-]{43}$/));
    expect(await sessionCount(id)).toBe(0);
    // The binding cookie is no session
    expect((await me(cookieOf(res)!.split(';')[0])).status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('refuses the MFA callback while the dev provider is on: it never redirects, so nothing is pending', async () => {
    const res = await http().post('/admin/auth/mfa/callback').send({ state: 'x'.repeat(40), code: 'c' });
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(res.body).toEqual(INVALID);
  });

  it('fails closed when the provider throws', async () => {
    const { id, email: address } = await staff();
    jest.spyOn(app.get(StaffMfaProvider), 'begin').mockRejectedValue(new Error('provider down'));

    const res = await login(address);
    expect(res.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(cookieOf(res)).toBeUndefined();
    expect(await sessionCount(id)).toBe(0);
  });
});

// The real Duo SDK builds the authorize URL; only its two network calls are stubbed
describe('Duo MFA (STAFF_MFA_PROVIDER=duo)', () => {
  const DUO = {
    STAFF_MFA_PROVIDER: 'duo',
    DUO_CLIENT_ID: 'DIXXXXXXXXXXXXXXXXXX',
    DUO_CLIENT_SECRET: 'deadbeef'.repeat(5),
    DUO_API_HOST: 'api-12345678.duosecurity.com',
    DUO_REDIRECT_URL: 'https://admin.lern.example/admin/mfa/callback',
  } as const;
  type DuoResult = Awaited<ReturnType<Client['exchangeAuthorizationCodeFor2FAResult']>>;
  const ALLOW = { result: 'allow', status: 'allow', status_msg: 'Login Successful' };
  const duoResult = (username: string, authResult: object | undefined) =>
    ({ preferred_username: username, auth_result: authResult }) as unknown as DuoResult;
  const duoFailure = (response?: { status: number }) =>
    new DuoException('Request failed', Object.assign(new Error('Request failed'), { isAxiosError: true, code: 'ECONNREFUSED', response }));

  let duoApp: INestApplication<App>;
  let client: Client;
  let exchange: jest.SpiedFunction<Client['exchangeAuthorizationCodeFor2FAResult']>;
  const duoHttp = () => request(duoApp.getHttpServer());
  beforeAll(async () => {
    duoApp = await (await bootApp({}, { ADMIN_ENABLED: true, ADMIN_COOKIE_SECURE: true, ...DUO })).init();
    client = duoApp.get<Client>(DUO_CLIENT);
  });
  afterAll(() => duoApp.close());
  beforeEach(() => {
    jest.spyOn(client, 'healthCheck').mockResolvedValue({ stat: 'OK', response: { timestamp: 1 } });
    exchange = jest.spyOn(client, 'exchangeAuthorizationCodeFor2FAResult').mockImplementation((_code, username) => Promise.resolve(duoResult(username, ALLOW)));
  });

  const duoLoginRaw = (address: string, password = PASSWORD) => duoHttp().post('/admin/auth/login').send({ email: address, password });
  // Password accepted: the redirect URL's signed request carries the state Duo will hand back to the browser
  async function duoLogin(address: string) {
    const res = await duoLoginRaw(address);
    expect(res.status).toBe(HttpStatus.OK);
    const url = new URL((res.body as { redirectUrl: string }).redirectUrl);
    const claims = JSON.parse(Buffer.from(url.searchParams.get('request')!.split('.')[1], 'base64url').toString()) as {
      state: string;
      duo_uname: string;
    };
    return { res, url, claims, state: claims.state, binding: cookieOf(res)!.split(';')[0] };
  }
  const callback = (body: object, cookie?: string) => {
    const req = duoHttp().post('/admin/auth/mfa/callback');
    return (cookie === undefined ? req : req.set('cookie', cookie)).send(body);
  };
  const pendingKey = (state: string) => `mfa:pending:${verifyMfaState(state, duoApp.get<Buffer>(MFA_STATE_KEY), 0)!.pendingId}`;
  const CLEAR_MFA = '__Host-lern_staff_mfa=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure';

  it('signs in: password → mfa_required with only a binding cookie → callback → session; then clears the lock count and email window', async () => {
    const { id, email: address } = await staff();
    for (let i = 0; i < 2; i++) expect((await duoLoginRaw(address, 'wrong password')).status).toBe(HttpStatus.UNAUTHORIZED);

    const { res, url, claims, state, binding } = await duoLogin(address);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ status: 'mfa_required', redirectUrl: expect.any(String) as string });
    expect(`${url.origin}${url.pathname}`).toBe(`https://${DUO.DUO_API_HOST}/oauth/v1/authorize`);
    expect(claims).toMatchObject({ duo_uname: address, use_duo_code_attribute: true });
    expect(cookiesOf(res)).toEqual([expect.stringMatching(/^__Host-lern_staff_mfa=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300; Secure$/)]);
    // Nothing is granted yet: no session, the lock count and email window stand, the binding cookie is no session
    expect(await sessionCount(id)).toBe(0);
    expect(await credentials(id)).toEqual({ failed_attempts: 2, locked: null });
    expect(await app.get(Redis).exists(`rl:admin:login:email:${address}`)).toBe(1);
    expect((await duoHttp().get('/admin/auth/me').set('cookie', binding)).status).toBe(HttpStatus.UNAUTHORIZED);
    const ttl = await app.get(Redis).ttl(pendingKey(state));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    const done = await callback({ state, code: 'duo-code' }, binding);
    expect(done.status).toBe(HttpStatus.OK);
    expect(done.headers['cache-control']).toBe('no-store');
    const summary = { id, email: address, displayName: 'Ops Person', isSuperAdmin: true };
    expect(done.body).toEqual({ staff: summary, csrfToken: expect.stringMatching(/^[\w-]{43}$/) as string });
    expect(cookiesOf(done)).toEqual([
      expect.stringMatching(/^lern_staff=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/),
      CLEAR_MFA,
    ]);
    expect(exchange).toHaveBeenCalledWith('duo-code', address);
    expect(await sessionCount(id)).toBe(1);
    expect(await credentials(id)).toEqual({ failed_attempts: 0, locked: null });
    expect(await app.get(Redis).exists(`rl:admin:login:email:${address}`)).toBe(0);
    expect(await pendingMfaKeys()).toEqual([]);

    const ok = await duoHttp().get('/admin/auth/me').set('cookie', cookieOf(done)!.split(';')[0]);
    expect(ok.status).toBe(HttpStatus.OK);
    expect(ok.body).toEqual({ staff: summary, csrfToken: (done.body as { csrfToken: string }).csrfToken });
  });

  describe('fails closed', () => {
    it.each([
      ['Duo is down', () => jest.spyOn(client, 'healthCheck').mockRejectedValue(duoFailure())],
      ['Duo answers 503', () => jest.spyOn(client, 'healthCheck').mockRejectedValue(duoFailure({ status: 503 }))],
    ])('login answers 503 with no cookie, nothing pending and no session when %s', async (_, arrange) => {
      const { id, email: address } = await staff();
      arrange();
      const res = await duoLoginRaw(address);
      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(cookiesOf(res)).toEqual([]);
      expect(await pendingMfaKeys()).toEqual([]);
      expect(await sessionCount(id)).toBe(0);
    });

    it.each([
      ['the network to Duo fails', duoFailure()],
      ['Duo answers 502', duoFailure({ status: 502 })],
    ])('the callback answers 503, clears the binding cookie and starts no session when %s', async (_, failure) => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      exchange.mockRejectedValueOnce(failure);
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(cookiesOf(res)).toEqual([CLEAR_MFA]);
      expect(await sessionCount(id)).toBe(0);
    });

    it.each([
      ['a deny', { result: 'deny', status: 'deny', status_msg: 'Login denied' }],
      ['a non-allow status', { ...ALLOW, status: 'fraud' }],
      ['a non-allow result', { ...ALLOW, result: 'deny' }],
      ['no auth_result', undefined],
    ])('refuses %s from Duo with 401 and no session', async (_, authResult) => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      exchange.mockResolvedValueOnce(duoResult(address, authResult));
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(cookiesOf(res)).toEqual([CLEAR_MFA]);
      expect(await sessionCount(id)).toBe(0);
    });

    it('refuses an allow for another Duo user', async () => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      exchange.mockResolvedValueOnce(duoResult('someone-else@lern.example', ALLOW));
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(await sessionCount(id)).toBe(0);
    });
  });

  describe('replay and race', () => {
    it('redeems a callback once: a replay is 401 and never reaches Duo', async () => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      expect((await callback({ state, code: 'duo-code' }, binding)).status).toBe(HttpStatus.OK);
      const replay = await callback({ state, code: 'duo-code' }, binding);
      expect(replay.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(cookiesOf(replay)).toEqual([]);
      expect(exchange).toHaveBeenCalledTimes(1);
      expect(await sessionCount(id)).toBe(1);
    });

    // Decided by the Lua HMGET+DEL in StaffAuthService.consumePending; Redis has no gate, so overlap is shown by the
    // mutation check (a GET-then-DEL lets several win)
    it('of 5 identical callbacks at once, exactly one signs in (5 rounds)', async () => {
      for (let round = 0; round < 5; round++) {
        await clearAdminRedis(); // 25 callbacks from one IP would pass its window of 20
        const { id, email: address } = await staff();
        const { state, binding } = await duoLogin(address);
        exchange.mockClear();
        const results = await Promise.all(Array.from({ length: 5 }, () => callback({ state, code: 'duo-code' }, binding)));
        expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401, 401, 401]);
        expect(exchange).toHaveBeenCalledTimes(1);
        expect(await sessionCount(id)).toBe(1);
      }
    });
  });

  describe('binding to the browser and the login', () => {
    it('refuses a tampered state before Redis and Duo; the real one still works', async () => {
      const { state, binding } = await duoLogin((await staff()).email);
      const [payload, sig] = state.split('.');
      const tampered = `${payload.slice(0, -2)}${payload.endsWith('AA') ? 'BB' : 'AA'}.${sig}`;
      expect((await callback({ state: tampered, code: 'duo-code' }, binding)).status).toBe(HttpStatus.UNAUTHORIZED);
      expect(exchange).not.toHaveBeenCalled();
      expect((await callback({ state, code: 'duo-code' }, binding)).status).toBe(HttpStatus.OK);
    });

    it('refuses a missing, wrong, duplicated or other login’s binding cookie (login CSRF), leaving the real login redeemable', async () => {
      const a = await staff();
      const mine = await duoLogin(a.email);
      const theirs = await duoLogin((await staff()).email);
      for (const cookie of [
        undefined,
        `__Host-lern_staff_mfa=${'A'.repeat(43)}`,
        `${mine.binding}; ${mine.binding}`,
        `${mine.binding}; __Host-lern_staff_mfa=${'A'.repeat(43)}`,
        // The real token under the name without __Host-: a sibling subdomain could have set that one
        mine.binding.replace('__Host-', ''),
        theirs.binding,
      ]) {
        const res = await callback({ state: mine.state, code: 'duo-code' }, cookie);
        expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
        expect(res.body).toEqual(INVALID);
        expect(cookiesOf(res)).toEqual([]);
      }
      expect(exchange).not.toHaveBeenCalled();
      expect(await sessionCount(a.id)).toBe(0);
      expect((await callback({ state: mine.state, code: 'duo-code' }, mine.binding)).status).toBe(HttpStatus.OK);
    });

    it('refuses an expired state (server clock) even while the login is still pending, without calling Duo', async () => {
      const { state, binding } = await duoLogin((await staff()).email);
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 301_000);
      const res = await callback({ state, code: 'duo-code' }, binding);
      clock.mockRestore();
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(exchange).not.toHaveBeenCalled();
      expect(await app.get(Redis).exists(pendingKey(state))).toBe(1);
    });

    it('refuses a valid state whose pending login is gone (expired from Redis), without calling Duo', async () => {
      const { state, binding } = await duoLogin((await staff()).email);
      await app.get(Redis).del(pendingKey(state));
      expect((await callback({ state, code: 'duo-code' }, binding)).status).toBe(HttpStatus.UNAUTHORIZED);
      expect(exchange).not.toHaveBeenCalled();
    });

    it.each([
      ['disabled', `UPDATE staff_users SET status = 'disabled', disabled_at = now() WHERE id = $1`],
      ['locked', `UPDATE staff_credentials SET locked_until = now() + interval '15 minutes' WHERE staff_user_id = $1`],
      ['given a new password', `UPDATE staff_credentials SET password_updated_at = password_updated_at + interval '1 microsecond' WHERE staff_user_id = $1`],
      ['given a new email', `UPDATE staff_users SET email = 'renamed-' || id || '@lern.example' WHERE id = $1`],
    ])('starts no session when the account is %s between login and callback', async (_, change) => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      await sql(change, [id]);
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toEqual(INVALID);
      expect(cookiesOf(res)).toEqual([CLEAR_MFA]);
      expect(await sessionCount(id)).toBe(0);
    });
  });

  describe('pending login in Redis', () => {
    it('refuses a callback whose state no longer matches the pending login, leaving it untouched', async () => {
      const { state, binding } = await duoLogin((await staff()).email);
      const redis = app.get(Redis);
      const stateHash = await redis.hget(pendingKey(state), 'stateHash');
      await redis.hset(pendingKey(state), 'stateHash', 'deadbeef');
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(cookiesOf(res)).toEqual([]);
      expect(exchange).not.toHaveBeenCalled();
      await redis.hset(pendingKey(state), 'stateHash', stateHash!);
      expect((await callback({ state, code: 'duo-code' }, binding)).status).toBe(HttpStatus.OK);
    });

    it('refuses a pending login for another staff member than the state names, before Duo', async () => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      await app.get(Redis).hset(pendingKey(state), 'staffUserId', randomUUID());
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(cookiesOf(res)).toEqual([CLEAR_MFA]);
      expect(exchange).not.toHaveBeenCalled();
      expect(await sessionCount(id)).toBe(0);
    });

    it('still signs in when clearing the email window fails after the session is created', async () => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      jest.spyOn(duoApp.get(Redis), 'del').mockRejectedValueOnce(new Error('redis down'));
      const res = await callback({ state, code: 'duo-code' }, binding);
      expect(res.status).toBe(HttpStatus.OK);
      expect(cookiesOf(res)).toEqual([expect.stringMatching(/^lern_staff=[\w-]{43};/), CLEAR_MFA]);
      expect(await sessionCount(id)).toBe(1);
    });
  });

  describe('callback guards', () => {
    it('refuses a form-encoded callback with 415 before touching the pending login', async () => {
      const { id, email: address } = await staff();
      const { state, binding } = await duoLogin(address);
      const form = await duoHttp().post('/admin/auth/mfa/callback').set('cookie', binding).type('form').send({ state, code: 'duo-code' });
      expect(form.status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(form.headers['cache-control']).toBe('no-store');
      expect(cookiesOf(form)).toEqual([]);
      expect(exchange).not.toHaveBeenCalled();
      expect(await sessionCount(id)).toBe(0);
      expect((await callback({ state, code: 'duo-code' }, binding)).status).toBe(HttpStatus.OK);
    });

    it('rejects a malformed body with 400', async () => {
      expect((await callback({ state: 'short', code: 'c' })).status).toBe(HttpStatus.BAD_REQUEST);
      expect((await callback({ state: 'x'.repeat(40) })).status).toBe(HttpStatus.BAD_REQUEST);
      expect((await callback({ state: 'x'.repeat(40), code: '' })).status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('allows 20 callbacks per IP per 15 minutes, then 429 with retryAfter', async () => {
      for (let i = 0; i < 20; i++) expect((await callback({ state: 'x'.repeat(40), code: 'c' })).status).toBe(HttpStatus.UNAUTHORIZED);
      const res = await callback({ state: 'x'.repeat(40), code: 'c' });
      expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((res.body as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    });
  });
});
