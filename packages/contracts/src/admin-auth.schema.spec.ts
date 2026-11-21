import { staffEmailSchema, staffLoginResponseSchema, staffLoginSchema, staffMfaCallbackSchema } from './admin-auth.schema';
import { roleSchema } from './user.schema';

it('trims and lowercases a staff email', () => {
  expect(staffEmailSchema.parse('  Ops@Lern.Example ')).toBe('ops@lern.example');
});

it('rejects a staff email that is invalid, holds a NUL byte, or is over 254 characters', () => {
  expect(staffEmailSchema.safeParse('not-an-email').success).toBe(false);
  expect(staffEmailSchema.safeParse('ops\u0000@lern.example').success).toBe(false);
  expect(staffEmailSchema.safeParse(`${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`).success).toBe(false);
});

it('takes a password of 1–128 characters without a NUL byte', () => {
  const login = (password: string) => staffLoginSchema.safeParse({ email: 'ops@lern.example', password }).success;
  expect(login('x')).toBe(true);
  expect(login('x'.repeat(128))).toBe(true);
  expect(login('')).toBe(false);
  expect(login('x'.repeat(129))).toBe(false);
  expect(login('pass\u0000word')).toBe(false);
});

it('answers a login with either a session or an MFA redirect, never both shapes mixed', () => {
  const staff = { id: '6f1c2a5e-8d1b-4c1e-9a43-2b1f7c9d0e11', email: 'ops@lern.example', displayName: 'Ops', isSuperAdmin: true };
  expect(staffLoginResponseSchema.safeParse({ status: 'authenticated', staff, csrfToken: 'c' }).success).toBe(true);
  expect(staffLoginResponseSchema.safeParse({ status: 'mfa_required', redirectUrl: 'https://duo.example/auth' }).success).toBe(true);
  expect(staffLoginResponseSchema.safeParse({ status: 'authenticated', redirectUrl: 'https://duo.example/auth' }).success).toBe(false);
});

it('has no admin role for app users: staff are a separate identity', () => {
  expect(roleSchema.safeParse('admin').success).toBe(false);
  expect(roleSchema.options).toEqual(['rider', 'driver']);
});

it('takes an MFA callback with a 22–1024 character state and a 1–2048 character code, without NUL bytes', () => {
  const ok = (state: string, code: string) => staffMfaCallbackSchema.safeParse({ state, code }).success;
  expect(ok('s'.repeat(22), 'c')).toBe(true);
  expect(ok('s'.repeat(1024), 'c'.repeat(2048))).toBe(true);
  expect(ok('s'.repeat(21), 'c')).toBe(false);
  expect(ok('s'.repeat(1025), 'c')).toBe(false);
  expect(ok('s'.repeat(22), '')).toBe(false);
  expect(ok('s'.repeat(22), 'c'.repeat(2049))).toBe(false);
  expect(ok(`${'s'.repeat(22)}\u0000`, 'c')).toBe(false);
  expect(ok('s'.repeat(22), 'c\u0000')).toBe(false);
  expect(staffMfaCallbackSchema.safeParse({ state: 's'.repeat(22) }).success).toBe(false);
});
