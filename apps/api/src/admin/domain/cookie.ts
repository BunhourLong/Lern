// The admin web app's session cookie. Host-only (no Domain), HttpOnly, SameSite=Lax; CSRF is a separate header.
export const STAFF_COOKIE = 'lern_staff';
export const STAFF_COOKIE_MAX_AGE_S = 8 * 60 * 60;

// A second lern_staff (e.g. tossed from a sibling subdomain) makes the header ambiguous: read none rather than guess
export function parseStaffCookie(header: string | undefined): string | undefined {
  const values = (header ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${STAFF_COOKIE}=`))
    .map((pair) => pair.slice(STAFF_COOKIE.length + 1));
  return values.length === 1 && values[0] ? values[0] : undefined;
}

const attributes = (maxAge: number, secure: boolean) =>
  `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

export const formatStaffCookie = (rawToken: string, secure: boolean): string =>
  `${STAFF_COOKIE}=${rawToken}${attributes(STAFF_COOKIE_MAX_AGE_S, secure)}`;

export const formatClearStaffCookie = (secure: boolean): string => `${STAFF_COOKIE}=${attributes(0, secure)}`;
