import { createStore } from 'zustand/vanilla';

// Optional app lock (M5.17). The core does the I/O (pin-lock.service) and sets the result; waitMs is the wait the
// last wrong PIN started, for the lock screen's countdown
export type SecurityState = {
  enabled: boolean;
  locked: boolean;
  waitMs: number;
  update(
    patch: Partial<Pick<SecurityState, 'enabled' | 'locked' | 'waitMs'>>,
  ): void;
};

export const createSecurityStore = () =>
  createStore<SecurityState>()(set => ({
    enabled: false,
    locked: false,
    waitMs: 0,
    update: patch => set(patch),
  }));
