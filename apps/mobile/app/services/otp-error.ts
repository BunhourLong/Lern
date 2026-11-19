import { ApiError } from './api.service';

export function otpRetryAt(error: unknown, now: () => number) {
  if (!(error instanceof ApiError) || error.status !== 429) return undefined;
  const body = error.body;
  const seconds =
    body && typeof body === 'object' && 'retryAfter' in body
      ? body.retryAfter
      : undefined;
  const delay = typeof seconds === 'number' ? seconds * 1000 : 0;
  return now() + (Number.isSafeInteger(delay) && delay > 0 ? delay : 60_000);
}

export function otpRequestError(error: unknown): 'auth.offline' | 'auth.error' {
  return error instanceof ApiError && error.status === 0
    ? 'auth.offline'
    : 'auth.error';
}
