// The admin web app's cookies. Host-only (no Domain), HttpOnly, SameSite=Lax; CSRF is a separate header.
export const STAFF_COOKIE = 'lern_staff';
export const STAFF_COOKIE_MAX_AGE_S = 8 * 60 * 60;
// Binds a pending Duo login to the browser that typed the password; it is no session. The signed state and the
// pending login in Redis share its 5 minutes. When Secure it carries the __Host- prefix, so a sibling subdomain can
// neither set nor shadow it; plain local http can't use that prefix.
export const STAFF_MFA_COOKIE = 'lern_staff_mfa';
export const HOST_STAFF_MFA_COOKIE = '__Host-lern_staff_mfa';
export const staffMfaCookieName = (secure: boolean) => (secure ? HOST_STAFF_MFA_COOKIE : STAFF_MFA_COOKIE);
export const STAFF_MFA_COOKIE_MAX_AGE_S = 5 * 60;

// A second cookie of the name (e.g. tossed from a sibling subdomain) makes the header ambiguous: read none rather
// than guess
function parseCookie(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  return values.length === 1 && values[0] ? values[0] : undefined;
}

export const parseStaffCookie = (header: string | undefined) => parseCookie(header, STAFF_COOKIE);
export const parseStaffMfaCookie = (header: string | undefined, secure: boolean) => parseCookie(header, staffMfaCookieName(secure));

const attributes = (maxAge: number, secure: boolean) =>
  `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

export const formatStaffCookie = (rawToken: string, secure: boolean): string =>
  `${STAFF_COOKIE}=${rawToken}${attributes(STAFF_COOKIE_MAX_AGE_S, secure)}`;

export const formatClearStaffCookie = (secure: boolean): string => `${STAFF_COOKIE}=${attributes(0, secure)}`;

export const formatStaffMfaCookie = (bindingToken: string, secure: boolean): string =>
  `${staffMfaCookieName(secure)}=${bindingToken}${attributes(STAFF_MFA_COOKIE_MAX_AGE_S, secure)}`;

export const formatClearStaffMfaCookie = (secure: boolean): string => `${staffMfaCookieName(secure)}=${attributes(0, secure)}`;
