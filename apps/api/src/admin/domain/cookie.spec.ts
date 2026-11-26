import { formatClearStaffCookie, formatClearStaffMfaCookie, formatStaffCookie, formatStaffMfaCookie, parseStaffCookie, parseStaffMfaCookie } from './cookie';

it('reads the staff cookie among others', () => {
  expect(parseStaffCookie('a=1; lern_staff=tok-123; b=2')).toBe('tok-123');
  expect(parseStaffCookie('lern_staff=tok-123')).toBe('tok-123');
});

it('reads nothing when the header, the cookie or its value is missing', () => {
  expect(parseStaffCookie(undefined)).toBeUndefined();
  expect(parseStaffCookie('')).toBeUndefined();
  expect(parseStaffCookie('other=1')).toBeUndefined();
  expect(parseStaffCookie('lern_staff=')).toBeUndefined();
  expect(parseStaffCookie('xlern_staff=tok')).toBeUndefined();
});

it('refuses a duplicated staff cookie instead of picking one (cookie tossing from a sibling host)', () => {
  expect(parseStaffCookie('lern_staff=a; lern_staff=b')).toBeUndefined();
  expect(parseStaffCookie('lern_staff=a; x=1; lern_staff=a')).toBeUndefined();
});

it('sets a host-only HttpOnly Lax cookie for 8 hours, Secure when asked', () => {
  expect(formatStaffCookie('tok', true)).toBe('lern_staff=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure');
  expect(formatStaffCookie('tok', false)).toBe('lern_staff=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800');
});

it('clears it with the same attributes and Max-Age=0', () => {
  expect(formatClearStaffCookie(true)).toBe('lern_staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  expect(formatClearStaffCookie(false)).toBe('lern_staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
});

describe('MFA binding cookie (browser binding while Duo runs)', () => {
  it('is __Host-lern_staff_mfa when Secure, so a sibling subdomain can neither set nor shadow it', () => {
    expect(formatStaffMfaCookie('b', true)).toBe('__Host-lern_staff_mfa=b; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure');
    expect(formatClearStaffMfaCookie(true)).toBe('__Host-lern_staff_mfa=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    expect(parseStaffMfaCookie('a=1; __Host-lern_staff_mfa=bind-1; b=2', true)).toBe('bind-1');
    expect(parseStaffMfaCookie('lern_staff_mfa=bind-1', true)).toBeUndefined();
    expect(parseStaffMfaCookie('__Host-lern_staff_mfa=a; __Host-lern_staff_mfa=a', true)).toBeUndefined();
    expect(parseStaffMfaCookie('__Host-lern_staff_mfa=', true)).toBeUndefined();
  });

  it('is lern_staff_mfa on local http (no Secure), ignoring the __Host- name', () => {
    expect(formatStaffMfaCookie('b', false)).toBe('lern_staff_mfa=b; Path=/; HttpOnly; SameSite=Lax; Max-Age=300');
    expect(formatClearStaffMfaCookie(false)).toBe('lern_staff_mfa=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    expect(parseStaffMfaCookie('a=1; lern_staff_mfa=bind-1; b=2', false)).toBe('bind-1');
    expect(parseStaffMfaCookie('__Host-lern_staff_mfa=bind-1', false)).toBeUndefined();
    expect(parseStaffMfaCookie('lern_staff_mfa=a; lern_staff_mfa=b', false)).toBeUndefined();
    expect(parseStaffMfaCookie(undefined, false)).toBeUndefined();
  });

  it('is never read as the session cookie, nor the reverse', () => {
    expect(parseStaffCookie('lern_staff_mfa=bind-1; __Host-lern_staff_mfa=bind-1')).toBeUndefined();
    expect(parseStaffMfaCookie('lern_staff=tok', false)).toBeUndefined();
    expect(parseStaffMfaCookie('lern_staff=tok; lern_staff_mfa=bind-1', false)).toBe('bind-1');
  });
});
