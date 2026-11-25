import { Client } from '@duosecurity/duo_universal';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DuoStaffMfaProvider } from './duo-staff-mfa.provider';

const CLIENT_ID = 'DIXXXXXXXXXXXXXXXXXX';
const CLIENT_SECRET = 'deadbeef'.repeat(5);
const API_HOST = 'api-12345678.duosecurity.com';
const REDIRECT_URL = 'https://admin.lern.example/admin/mfa/callback';
const EMAIL = 'ops@lern.example';
const STATE = `${'s'.repeat(40)}.sig`;
const STAFF = { id: '6f1c2a5e-8d1b-4c1e-9a43-2b1f7c9d0e11', email: EMAIL };

let client: Client;
let provider: DuoStaffMfaProvider;
beforeEach(() => {
  client = new Client({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, apiHost: API_HOST, redirectUrl: REDIRECT_URL });
  provider = new DuoStaffMfaProvider(client, 50);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}); // every failure warns; one test reads them
});
afterEach(() => jest.restoreAllMocks());

type DuoResult = Awaited<ReturnType<Client['exchangeAuthorizationCodeFor2FAResult']>>;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtPayload = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
// An id_token as Duo signs it (HS512 with the client secret), so the SDK's real verification runs
function idToken(claims: object): string {
  const now = Math.floor(Date.now() / 1000);
  const signing = `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64({ iss: `https://${API_HOST}/oauth/v1/token`, aud: CLIENT_ID, iat: now, exp: now + 300, ...claims })}`;
  return `${signing}.${createHmac('sha512', CLIENT_SECRET).update(signing).digest('base64url')}`;
}
const allow = { result: 'allow', status: 'allow', status_msg: 'Login Successful' };

// The SDK's own HTTP layer: stubbing it keeps the SDK's real error wrapping in the path
const duoHttp = () => jest.spyOn((client as unknown as { axios: { post: () => Promise<unknown> } }).axios, 'post');
const axiosError = (response?: { status: number; data?: unknown }) =>
  Object.assign(new Error('Request failed'), { isAxiosError: true, code: response ? 'ERR_BAD_RESPONSE' : 'ECONNREFUSED', response });
const never = () => new Promise<never>(() => {});
const lateFailure = () => new Promise<never>((_, reject) => setTimeout(() => reject(axiosError()), 80));

describe('begin', () => {
  it('checks Duo’s health, then redirects to a signed authorize URL for this staff member and state', async () => {
    const post = duoHttp().mockResolvedValue({ data: { stat: 'OK', response: { timestamp: 1 } } });
    const step = await provider.begin(STAFF, STATE);
    expect(post).toHaveBeenCalledWith('/oauth/v1/health_check', expect.anything());

    if (step.status !== 'redirect') throw new Error('expected a redirect');
    const url = new URL(step.redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`https://${API_HOST}/oauth/v1/authorize`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URL);
    const request = url.searchParams.get('request')!;
    const [header, payload, sig] = request.split('.');
    expect(createHmac('sha512', CLIENT_SECRET).update(`${header}.${payload}`).digest('base64url')).toBe(sig);
    expect(jwtPayload(request)).toMatchObject({ duo_uname: EMAIL, state: STATE, use_duo_code_attribute: true, redirect_uri: REDIRECT_URL });
  });

  it.each([
    ['Duo reports itself unhealthy', () => duoHttp().mockResolvedValue({ data: { stat: 'FAIL', message: 'down', message_detail: 'x' } })],
    ['the health check answers 401', () => duoHttp().mockRejectedValue(axiosError({ status: 401, data: { stat: 'FAIL' } }))],
    ['the network fails', () => duoHttp().mockRejectedValue(axiosError())],
    ['Duo answers 503', () => duoHttp().mockRejectedValue(axiosError({ status: 503 }))],
    ['Duo never answers', () => duoHttp().mockReturnValue(never())],
    ['the health check resolves non-OK', () => jest.spyOn(client, 'healthCheck').mockResolvedValue({ stat: 'FAIL', response: { timestamp: 1 } })],
  ])('fails closed with 503 when %s, and builds no URL', async (_, arrange) => {
    arrange();
    const authUrl = jest.spyOn(client, 'createAuthUrl');
    await expect(provider.begin(STAFF, STATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(authUrl).not.toHaveBeenCalled();
  });

  it('times out cleanly when the health check fails late: no unhandled rejection after the 503', async () => {
    duoHttp().mockReturnValue(lateFailure());
    await expect(provider.begin(STAFF, STATE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe('complete', () => {
  const token = (claims: object) => ({ data: { id_token: idToken(claims), access_token: 'a', expires_in: 300, token_type: 'Bearer' } });

  it('is true only for an allowed Duo login of the expected user (real SDK verification)', async () => {
    const post = duoHttp().mockResolvedValue(token({ preferred_username: EMAIL, auth_result: allow }));
    await expect(provider.complete('duo-code', EMAIL)).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith('/oauth/v1/token', expect.anything());
  });

  it.each([
    ['a deny', { preferred_username: EMAIL, auth_result: { ...allow, result: 'deny', status: 'deny' } }],
    ['another user (SDK check)', { preferred_username: 'other@lern.example', auth_result: allow }],
  ])('is false for %s through the real SDK', async (_, claims) => {
    duoHttp().mockResolvedValue(token(claims));
    await expect(provider.complete('duo-code', EMAIL)).resolves.toBe(false);
  });

  it.each([
    ['result is not allow', { preferred_username: EMAIL, auth_result: { ...allow, result: 'deny' } }],
    ['status is not allow', { preferred_username: EMAIL, auth_result: { ...allow, status: 'fraud' } }],
    ['auth_result is missing', { preferred_username: EMAIL }],
    ['the username is another user’s', { preferred_username: 'other@lern.example', auth_result: allow }],
    ['the username is missing', { auth_result: allow }],
  ])('is false when %s, even if the SDK let it through', async (_, result) => {
    jest.spyOn(client, 'exchangeAuthorizationCodeFor2FAResult').mockResolvedValue(result as unknown as DuoResult);
    await expect(provider.complete('duo-code', EMAIL)).resolves.toBe(false);
  });

  it.each([
    ['Duo refuses the code (400)', () => duoHttp().mockRejectedValue(axiosError({ status: 400, data: { error: 'invalid_grant', error_description: 'bad code' } }))],
    ['the id_token signature is wrong', () => duoHttp().mockResolvedValue({ data: { id_token: `${idToken({ preferred_username: EMAIL, auth_result: allow })}x`, access_token: 'a', expires_in: 300, token_type: 'Bearer' } })],
    ['the response is malformed', () => duoHttp().mockResolvedValue({ data: { token_type: 'Bearer' } })],
  ])('is false (401) when %s', async (_, arrange) => {
    arrange();
    await expect(provider.complete('duo-code', EMAIL)).resolves.toBe(false);
  });

  it.each([
    ['the network fails', () => duoHttp().mockRejectedValue(axiosError())],
    ['Duo answers 502', () => duoHttp().mockRejectedValue(axiosError({ status: 502 }))],
    ['Duo never answers', () => duoHttp().mockReturnValue(never())],
  ])('fails closed with 503 when %s', async (_, arrange) => {
    arrange();
    await expect(provider.complete('duo-code', EMAIL)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('times out cleanly when the exchange fails late: no unhandled rejection after the 503', async () => {
    duoHttp().mockReturnValue(lateFailure());
    await expect(provider.complete('duo-code', EMAIL)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await new Promise((r) => setTimeout(r, 100));
  });

  it('never logs the code, the state or the client secret', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn'); // the silent spy from beforeEach
    duoHttp().mockRejectedValue(Object.assign(axiosError({ status: 400 }), { config: { data: `code=duo-code&secret=${CLIENT_SECRET}` } }));
    await provider.complete('duo-code', EMAIL);
    duoHttp().mockRejectedValue(axiosError({ status: 503 }));
    await expect(provider.begin(STAFF, STATE)).rejects.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/duo-code|deadbeef|sssss/);
  });
});
