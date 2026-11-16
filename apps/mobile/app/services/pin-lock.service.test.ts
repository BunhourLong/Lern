import { createPinLock, type PinHasher } from './pin-lock.service';
import type { KeyValueStore, SecretStore } from './storage.service';

// Deterministic stand-in for SHA-256: depends on salt and PIN, never contains the PIN's digits as written
const fakeHash = async (salt: string, pin: string) =>
  Array.from(`${salt}:${pin}`, c => c.charCodeAt(0).toString(16)).join('');

const PIN = '123456';
const WRONG = '000000';

function harness() {
  const m = new Map<string, string>();
  const kv: KeyValueStore = {
    get: k => m.get(k),
    set: (k, v) => {
      m.set(k, v);
    },
    remove: k => {
      m.delete(k);
    },
  };
  let stored: string | undefined;
  const secret: SecretStore = {
    get: async () => stored,
    set: async v => {
      stored = v;
    },
    clear: async () => {
      stored = undefined;
    },
  };
  let salts = 0;
  const hasher: PinHasher = {
    salt: () => `salt-${++salts}`,
    hash: fakeHash,
  };
  const clock = { t: 0 };
  const make = () =>
    createPinLock({ secret, kv, hasher, elapsed: () => clock.t });
  return { make, kv, secret, stored: () => stored, clock };
}

const wrongTimes = async (
  lock: ReturnType<ReturnType<typeof harness>['make']>,
  n: number,
) => {
  let last;
  for (let i = 0; i < n; i++) last = await lock.check(WRONG);
  return last;
};

it('is off until a PIN is set, and stores a salted hash, never the PIN', async () => {
  const h = harness();
  const lock = h.make();
  expect(await lock.isEnabled()).toBe(false);
  await lock.enable(PIN);
  expect(await lock.isEnabled()).toBe(true);
  expect(h.stored()).toBeDefined();
  expect(h.stored()).not.toContain(PIN);
  expect(await lock.check(PIN)).toEqual({ ok: true });
});

it('salts each enrolment, so the same PIN stores differently', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  const first = h.stored();
  await lock.change(PIN, PIN);
  expect(h.stored()).not.toBe(first);
  expect(await lock.check(PIN)).toEqual({ ok: true });
});

it.each(['12345', '1234567', '12345a', ' 123456', ''])(
  'rejects a PIN that is not 6 digits: %j',
  async pin => {
    const h = harness();
    await expect(h.make().enable(pin)).rejects.toThrow();
    expect(h.stored()).toBeUndefined();
  },
);

it('refuses to enable over an existing PIN: changing it needs the old one', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await expect(lock.enable('654321')).rejects.toThrow();
  expect(await lock.check(PIN)).toEqual({ ok: true });
});

it('lets 4 wrong PINs through without a wait, then waits 30 s on the 5th', async () => {
  const lock = harness().make();
  await lock.enable(PIN);
  expect(await wrongTimes(lock, 4)).toEqual({ ok: false, waitMs: 0 });
  expect(await lock.check(WRONG)).toEqual({ ok: false, waitMs: 30_000 });
});

it('escalates the wait: 1 min, 5 min, 15 min, 1 h, then the 10th wrong PIN wipes it', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await wrongTimes(lock, 5);
  for (const wait of [60_000, 300_000, 900_000, 3_600_000]) {
    h.clock.t += 10_000_000; // past any wait
    expect(await lock.check(WRONG)).toEqual({ ok: false, waitMs: wait });
    // The wait runs from this try, not from an earlier one
    expect(await lock.check(PIN)).toEqual({ ok: false, waitMs: wait });
  }
  h.clock.t += 10_000_000;
  expect(await lock.check(WRONG)).toEqual({ ok: false, wiped: true });
  expect(h.stored()).toBeUndefined();
  expect(await lock.isEnabled()).toBe(false);
});

it('during a wait refuses even the right PIN, without counting it', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await wrongTimes(lock, 5);
  h.clock.t += 29_999;
  expect(await lock.check(PIN)).toEqual({ ok: false, waitMs: 1 });
  expect(await lock.check(WRONG)).toEqual({ ok: false, waitMs: 1 });
  h.clock.t += 1;
  // The refused tries didn't count: the next wrong one is the 6th, not the 7th
  expect(await lock.check(WRONG)).toEqual({ ok: false, waitMs: 60_000 });
});

it('measures the wait only on the monotonic clock: moving the wall clock skips nothing', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await wrongTimes(lock, 5);
  jest.useFakeTimers({ now: Date.now() });
  try {
    jest.setSystemTime(Date.now() + 24 * 3_600_000); // the user moves the device clock a day ahead
    expect(await lock.check(PIN)).toEqual({ ok: false, waitMs: 30_000 });
  } finally {
    jest.useRealTimers();
  }
});

it('a restart keeps the count and imposes the full wait again', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await wrongTimes(lock, 5);
  h.clock.t += 20_000;
  h.clock.t = 5; // new process: the monotonic clock starts over
  const relaunched = h.make();
  expect(await relaunched.check(PIN)).toEqual({ ok: false, waitMs: 30_000 });
  h.clock.t += 30_000;
  expect(await relaunched.check(WRONG)).toEqual({ ok: false, waitMs: 60_000 });
});

it('the right PIN resets the count', async () => {
  const lock = harness().make();
  await lock.enable(PIN);
  await wrongTimes(lock, 4);
  expect(await lock.check(PIN)).toEqual({ ok: true });
  expect(await wrongTimes(lock, 4)).toEqual({ ok: false, waitMs: 0 });
});

it('change and disable need the right PIN, and a wrong one counts as a try', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  expect(await lock.change(WRONG, '222222')).toEqual({ ok: false, waitMs: 0 });
  expect(await lock.disable(WRONG)).toEqual({ ok: false, waitMs: 0 });
  await wrongTimes(lock, 2);
  expect(await lock.disable(WRONG)).toEqual({ ok: false, waitMs: 30_000 });
  h.clock.t += 30_000;
  expect(await lock.change(PIN, '222222')).toEqual({ ok: true });
  expect(await lock.check('222222')).toEqual({ ok: true });
  expect(await lock.disable('222222')).toEqual({ ok: true });
  expect(await lock.isEnabled()).toBe(false);
});

it('rejects a malformed new PIN before checking the old one', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await expect(lock.change(WRONG, '12')).rejects.toThrow();
  expect(await wrongTimes(lock, 4)).toEqual({ ok: false, waitMs: 0 }); // the bad change cost no try
});

it('clear removes the PIN, the count and the wait', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  await wrongTimes(lock, 5);
  await lock.clear();
  expect(h.stored()).toBeUndefined();
  await lock.enable(PIN);
  expect(await lock.check(PIN)).toEqual({ ok: true });
});

it('never unlocks when the Keychain rejects, and does not count the try', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  const get = jest
    .spyOn(h.secret, 'get')
    .mockRejectedValue(new Error('locked'));
  expect(await lock.check(PIN)).toEqual({ ok: false, waitMs: 0 });
  await expect(lock.isEnabled()).rejects.toThrow();
  get.mockRestore();
  expect(await wrongTimes(lock, 4)).toEqual({ ok: false, waitMs: 0 });
});

it('a burst of tries cannot slip past a wait: they run one at a time', async () => {
  const lock = harness().make();
  await lock.enable(PIN);
  await wrongTimes(lock, 4);
  // Sent together: the 5th wrong starts a wait, so every try after it is refused, the right PIN included
  const results = await Promise.all([
    lock.check(WRONG),
    ...Array.from({ length: 6 }, () => lock.check(WRONG)),
    lock.check(PIN),
  ]);
  expect(results[0]).toEqual({ ok: false, waitMs: 30_000 });
  for (const r of results.slice(1))
    expect(r).toEqual({ ok: false, waitMs: 30_000 });
});

it('with no PIN set, checking unlocks: the lock is off', async () => {
  expect(await harness().make().check(PIN)).toEqual({ ok: true });
});

it('the 10th wrong PIN still reports the wipe when the Keychain refuses to clear', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  jest.spyOn(h.secret, 'clear').mockRejectedValue(new Error('keychain'));
  let last;
  for (let i = 0; i < 10; i++) {
    h.clock.t += 10_000_000;
    last = await lock.check(WRONG);
  }
  expect(last).toEqual({ ok: false, wiped: true });
});

it('change refuses when no PIN is set: enabling is a separate step', async () => {
  const h = harness();
  await expect(h.make().change(PIN, '222222')).rejects.toThrow();
  expect(h.stored()).toBeUndefined();
});

it('a clear during a check in flight leaves no count behind for the next PIN', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const before = h.stored(); // the check read the PIN before the clear landed
  const get = jest.spyOn(h.secret, 'get').mockImplementationOnce(async () => {
    await gate;
    return before;
  });
  const inFlight = lock.check(WRONG);
  const cleared = lock.clear(); // a sign-out lands meanwhile
  release();
  await Promise.all([inFlight, cleared]);
  get.mockRestore();
  await lock.enable(PIN);
  expect(await wrongTimes(lock, 4)).toEqual({ ok: false, waitMs: 0 });
});

it('reports the wait still running, after a restart too', async () => {
  const h = harness();
  const lock = h.make();
  await lock.enable(PIN);
  expect(lock.waitMs()).toBe(0);
  await wrongTimes(lock, 5);
  h.clock.t += 10_000;
  expect(lock.waitMs()).toBe(20_000);
  expect(h.make().waitMs()).toBe(30_000);
});
