import type { KeyValueStore, SecretStore } from './storage.service';

// Native in the app (expo-crypto); tests pass node:crypto
export type PinHasher = {
  salt(): string;
  hash(salt: string, pin: string): Promise<string>;
};
export type PinCheck =
  | { ok: true }
  | { ok: false; waitMs: number }
  | { ok: false; wiped: true };

const FAILURES = 'pin.failures';
// Wait after the n-th wrong PIN in a row; the WIPE_AT-th wipes the PIN and the caller signs out
const WAIT_MS: Record<number, number> = {
  5: 30_000,
  6: 60_000,
  7: 300_000,
  8: 900_000,
  9: 3_600_000,
};
const WIPE_AT = 10;
const FORMAT = /^\d{6}$/;

function assertFormat(pin: string): void {
  if (!FORMAT.test(pin)) throw new Error('PIN must be 6 digits');
}

// Optional app lock (PLAN.md M5.17). Only covers the screen: tokens stay valid behind it. The secret holds
// "salt:hash" (Keychain); the failure count sits in kv and survives restarts.
// elapsed is a monotonic clock (performance.now), never Date: moving the device clock must not end a wait.
export function createPinLock({
  secret,
  kv,
  hasher,
  elapsed,
}: {
  secret: SecretStore;
  kv: KeyValueStore;
  hasher: PinHasher;
  elapsed: () => number;
}) {
  const failures = () => Number(kv.get(FAILURES) ?? 0);
  // shortcut: a restart loses the monotonic start, so the full wait for the current count starts again at launch;
  // a kill can lengthen a wait, never shorten it. Persist the remaining time if users complain.
  let waitStart = WAIT_MS[failures()] ? elapsed() : 0;
  const remaining = () => {
    const wait = WAIT_MS[failures()] ?? 0;
    return Math.max(0, wait - (elapsed() - waitStart));
  };

  async function wipe(): Promise<void> {
    kv.remove(FAILURES);
    await secret.clear();
  }

  // One step at a time: concurrent tries all read and bump the count in turn, and a clear never lands mid-check
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(step: () => Promise<T>): Promise<T> {
    const run = queue.then(step);
    queue = run.catch(() => undefined);
    return run;
  }

  async function compare(pin: string, requireStoredPin: boolean): Promise<PinCheck> {
    const wait = remaining();
    if (wait > 0) return { ok: false, waitMs: wait };
    let stored: string | undefined;
    try {
      stored = await secret.get();
    } catch {
      return { ok: false, waitMs: 0 }; // can't read the PIN: stay locked, count nothing
    }
    if (stored === undefined)
      return requireStoredPin ? { ok: false, waitMs: 0 } : { ok: true };
    const [salt, hash] = stored.split(':');
    if ((await hasher.hash(salt, pin)) === hash) {
      kv.remove(FAILURES);
      return { ok: true };
    }
    const count = failures() + 1;
    if (count >= WIPE_AT) {
      // The sign-out must still happen; forget() tries the Keychain clear again
      await wipe().catch(() => undefined);
      return { ok: false, wiped: true };
    }
    kv.set(FAILURES, String(count));
    waitStart = elapsed();
    return { ok: false, waitMs: WAIT_MS[count] ?? 0 };
  }
  const check = (pin: string, requireStoredPin = false) =>
    serial(() => compare(pin, requireStoredPin));
  const clear = () => serial(wipe);

  async function store(pin: string): Promise<void> {
    const salt = hasher.salt();
    await secret.set(`${salt}:${await hasher.hash(salt, pin)}`);
  }

  return {
    isEnabled: async () => (await secret.get()) !== undefined,
    async enable(pin: string): Promise<void> {
      assertFormat(pin);
      await serial(async () => {
        if ((await secret.get()) !== undefined)
          throw new Error('PIN already set: change it with the old one');
        await store(pin);
      });
    },
    async change(old: string, next: string): Promise<PinCheck> {
      assertFormat(next);
      if ((await secret.get()) === undefined)
        throw new Error('No PIN set: enable the lock first');
      const result = await check(old);
      if (result.ok) await store(next);
      return result;
    },
    async disable(pin: string): Promise<PinCheck> {
      const result = await check(pin);
      if (result.ok) await clear();
      return result;
    },
    waitMs: remaining, // the wait still running, for the lock screen's countdown
    check,
    clear,
  };
}

export type PinLock = ReturnType<typeof createPinLock>;
