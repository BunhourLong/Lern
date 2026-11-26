import type { Core } from './core';
import { isDriverOnline } from './driver-location';

type IdleCore = Pick<Core, 'lock' | 'interruptPinCheck'> & {
  stores: Pick<Core['stores'], 'session' | 'security' | 'driverMode'>;
};
const IDLE_MS = 5 * 60_000;

export function followIdleLock(
  core: IdleCore,
  elapsed: () => number,
  active: boolean,
) {
  const { session, security, driverMode } = core.stores;
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout>;
  function check() {
    clearTimeout(timer);
    if (!active || !deadline) return;
    const remaining = deadline - elapsed();
    if (remaining <= 0) core.lock();
    else timer = setTimeout(check, remaining);
  }
  function reconcile() {
    const { enabled, locked } = security.getState();
    const eligible =
      session.getState().status === 'signed_in' &&
      enabled &&
      !locked &&
      !isDriverOnline(driverMode.getState().availability);
    if (!eligible) deadline = 0;
    else if (!deadline) deadline = elapsed() + IDLE_MS;
    check();
  }
  const subscriptions = [
    session.subscribe(reconcile),
    security.subscribe(reconcile),
    driverMode.subscribe(reconcile),
  ];
  reconcile();
  return {
    deadline: () => deadline,
    interact() {
      if (!active) return false;
      if (!deadline)
        return (
          session.getState().status !== 'signed_in' ||
          !security.getState().locked
        );
      const now = elapsed();
      if (now >= deadline) {
        core.lock();
        return false;
      }
      deadline = now + IDLE_MS;
      check();
      return true;
    },
    foreground(next: boolean) {
      active = next;
      if (!active) core.interruptPinCheck();
      reconcile();
    },
    stop() {
      clearTimeout(timer);
      subscriptions.forEach(unsubscribe => unsubscribe());
    },
  };
}
