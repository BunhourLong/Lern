import { followIdleLock } from './idle-lock';
import { createDriverModeStore } from '../stores/driver-mode.store';
import { createSessionStore } from '../stores/session.store';
import { createSecurityStore } from '../stores/security.store';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  let time = 0;
  const security = createSecurityStore();
  const driverMode = createDriverModeStore();
  const session = createSessionStore();
  session
    .getState()
    .signedIn({ id: '1', phone: '+85512345678', roles: ['driver'] });
  security.getState().update({ enabled: true });
  const lock = jest.fn(() => security.getState().update({ locked: true }));
  const interruptPinCheck = jest.fn();
  const follow = followIdleLock(
    { stores: { session, security, driverMode }, lock, interruptPinCheck },
    () => time,
    true,
  );
  const advance = (ms: number) => {
    time += ms;
    jest.advanceTimersByTime(ms);
  };
  return {
    advance,
    sleep: (ms: number) => {
      time += ms;
    },
    driverMode,
    security,
    lock,
    interruptPinCheck,
    follow,
  };
}

it('locks at five minutes from the most recent interaction', () => {
  const s = setup();
  s.advance(299999);
  s.follow.interact();
  s.advance(299999);
  expect(s.lock).not.toHaveBeenCalled();
  s.advance(1);
  expect(s.lock).toHaveBeenCalledTimes(1);
  s.follow.stop();
});
it('accounts for time asleep and interrupts pending PIN success', () => {
  const s = setup();
  s.follow.foreground(false);
  s.sleep(300000);
  s.follow.foreground(true);
  expect(s.lock).toHaveBeenCalledTimes(1);
  expect(s.interruptPinCheck).toHaveBeenCalled();
  s.follow.stop();
});
it.each(['available', 'reserved', 'on_trip'] as const)(
  'exempts %s until five minutes after going offline',
  status => {
    const s = setup();
    s.advance(299999);
    s.driverMode.getState().setAvailability(status);
    s.advance(300001);
    s.follow.foreground(false);
    s.sleep(600000);
    s.follow.foreground(true);
    expect(s.lock).not.toHaveBeenCalled();
    s.driverMode.getState().setAvailability('offline');
    s.advance(299999);
    expect(s.lock).not.toHaveBeenCalled();
    s.advance(1);
    expect(s.lock).toHaveBeenCalledTimes(1);
    s.follow.stop();
  },
);

it('rejects an interaction at the deadline even when the timer is delayed', () => {
  const s = setup();
  s.sleep(300000);
  expect(s.follow.interact()).toBe(false);
  expect(s.lock).toHaveBeenCalledTimes(1);
  s.follow.stop();
});

it('ignores activity in the background and starts a fresh period after unlock', () => {
  const s = setup();
  s.follow.foreground(false);
  s.sleep(200000);
  s.follow.interact();
  s.sleep(100000);
  s.follow.foreground(true);
  expect(s.lock).toHaveBeenCalledTimes(1);
  s.sleep(600000);
  s.security.getState().update({ locked: false });
  s.advance(299999);
  expect(s.lock).toHaveBeenCalledTimes(1);
  s.advance(1);
  expect(s.lock).toHaveBeenCalledTimes(2);
  s.follow.stop();
});
