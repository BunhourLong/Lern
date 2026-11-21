import { formatClearStaffCookie, formatStaffCookie, parseStaffCookie } from './cookie';

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
