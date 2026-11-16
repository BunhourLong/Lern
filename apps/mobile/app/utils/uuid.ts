// RFC 4122 v4. An Idempotency-Key must be unique per action, not secret (the server scopes keys per user), so
// Math.random is enough where Hermes has no crypto.randomUUID.
export function uuid(): string {
  return (
    (
      globalThis as { crypto?: { randomUUID?: () => string } }
    ).crypto?.randomUUID?.() ?? uuidFrom(Math.random)
  );
}

export function uuidFrom(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16));
  hex[12] = 4; // version
  hex[16] = 8 + (hex[16] % 4); // variant 10xx
  const s = hex.map(n => n.toString(16)).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(
    16,
    20,
  )}-${s.slice(20)}`;
}
