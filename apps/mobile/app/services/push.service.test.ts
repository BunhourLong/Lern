import { createPush, type PushNative } from './push.service';

function fakeNative(overrides: Partial<PushNative> = {}) {
  const refresh: ((token: string) => void)[] = [];
  const message: (() => void)[] = [];
  const unsubscribed = { refresh: 0, message: 0 };
  const native: PushNative = {
    platform: 'android',
    requestPermission: jest.fn(async () => true),
    getToken: jest.fn(async () => 'token-1'),
    deleteToken: jest.fn(async () => undefined),
    onTokenRefresh: cb => {
      refresh.push(cb);
      return () => unsubscribed.refresh++;
    },
    onMessage: cb => {
      message.push(cb);
      return () => unsubscribed.message++;
    },
    ...overrides,
  };
  return { native, refresh, message, unsubscribed };
}
const setup = (overrides: Partial<PushNative> = {}) => {
  const fake = fakeNative(overrides);
  const register = jest.fn(async (_token: string, _platform: string) => undefined);
  const onWake = jest.fn();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { ...fake, register, onWake, warn, push: createPush({ native: fake.native, register, onWake }) };
};
afterEach(() => jest.restoreAllMocks());

it('registers the token once, however often the socket reconnects', async () => {
  const { push, register } = setup();
  await push.sync();
  await push.sync();
  expect(register.mock.calls).toEqual([['token-1', 'android']]);
});

it('does not ask for a token when the user refused notifications', async () => {
  const { push, native, register } = setup({ requestPermission: async () => false });
  await push.sync();
  expect(native.getToken).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

// iOS without an APNs key (no Apple membership yet) fails right here; the app must carry on without push
it('survives having no token and tries again on the next sync', async () => {
  const getToken = jest.fn<Promise<string>, []>().mockRejectedValueOnce(new Error('no APNs')).mockResolvedValue('token-1');
  const { push, register } = setup({ getToken });
  await expect(push.sync()).resolves.toBeUndefined();
  expect(register).not.toHaveBeenCalled();
  await push.sync();
  expect(register).toHaveBeenCalledTimes(1);
});

it('tries a failed registration again on the next sync', async () => {
  const { push, register } = setup();
  register.mockRejectedValueOnce(new Error('offline'));
  await expect(push.sync()).resolves.toBeUndefined();
  await push.sync();
  expect(register).toHaveBeenCalledTimes(2);
});

it('registers a refreshed token, and survives that failing', async () => {
  const { push, refresh, register } = setup();
  await push.sync();
  register.mockRejectedValueOnce(new Error('offline'));
  refresh[0]('token-bad');
  refresh[0]('token-2');
  await new Promise(setImmediate);
  expect(register).toHaveBeenLastCalledWith('token-2', 'android');
});

it('tries a failed refresh again on the next sync, or this phone stays silent until a restart', async () => {
  const getToken = jest.fn(async () => 'token-1');
  const { push, refresh, register } = setup({ getToken });
  await push.sync();
  register.mockRejectedValueOnce(new Error('offline'));
  getToken.mockResolvedValue('token-2');
  refresh[0]('token-2');
  await new Promise(setImmediate);
  await push.sync();
  expect(register).toHaveBeenLastCalledWith('token-2', 'android');
  expect(register).toHaveBeenCalledTimes(3);
});

it('waits for a running stop before the next sync, or it could register the token being deleted', async () => {
  let deleted: () => void = () => undefined;
  const deleteToken = () => new Promise<void>(resolve => (deleted = resolve));
  const { push, native, register } = setup({ deleteToken });
  await push.sync();
  const stopped = push.stop();
  const next = push.sync();
  await new Promise(setImmediate);
  expect(native.getToken).toHaveBeenCalledTimes(1);
  deleted();
  await Promise.all([stopped, next]);
  expect(native.getToken).toHaveBeenCalledTimes(2);
  expect(register).toHaveBeenCalledTimes(2);
});

it('a sync waiting for a stop gives up when another stop follows', async () => {
  const releases: (() => void)[] = [];
  const deleteToken = () => new Promise<void>(resolve => releases.push(resolve));
  const { push, native, register } = setup({ deleteToken });
  await push.sync();
  const first = push.stop();
  const waiting = push.sync();
  const second = push.stop(); // the user signed in and out again before the first delete finished
  releases.forEach(release => release());
  await Promise.all([first, waiting, second]);
  expect(native.getToken).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledTimes(1);
});

it('subscribes once and wakes the app for a message in the foreground', async () => {
  const { push, message, onWake } = setup();
  await push.sync();
  await push.sync();
  expect(message).toHaveLength(1);
  message[0]();
  expect(onWake).toHaveBeenCalledTimes(1);
});

it('stop unsubscribes and deletes the token, so this phone stops getting that user\'s pushes', async () => {
  const { push, native, unsubscribed } = setup();
  await push.sync();
  await push.stop();
  expect(native.deleteToken).toHaveBeenCalledTimes(1);
  expect(unsubscribed).toEqual({ refresh: 1, message: 1 });
});

it('stop survives being offline', async () => {
  const { push } = setup({ deleteToken: async () => Promise.reject(new Error('offline')) });
  await push.sync();
  await expect(push.stop()).resolves.toBeUndefined();
});

it('registers again for the next user after a stop', async () => {
  const { push, register } = setup();
  await push.sync();
  await push.stop();
  await push.sync();
  expect(register).toHaveBeenCalledTimes(2);
});

it('a sync still running at sign-out neither registers nor counts for the next user', async () => {
  let token: (t: string) => void = () => undefined;
  const getToken = jest.fn(() => new Promise<string>(resolve => (token = resolve)));
  const { push, register } = setup({ getToken });
  const old = push.sync();
  await new Promise(setImmediate);
  await push.stop();
  token('token-old');
  await old;
  expect(register).not.toHaveBeenCalled();

  getToken.mockResolvedValue('token-new');
  await push.sync();
  expect(register.mock.calls).toEqual([['token-new', 'android']]);
});
