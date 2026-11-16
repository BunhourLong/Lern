import type { Me } from '@lern/contracts';
import { createStore } from 'zustand/vanilla';

// restoring = boot is turning a stored refresh token into a session; the core does the I/O and sets the result
export type SessionState = {
  status: 'restoring' | 'signed_in' | 'signed_out';
  me: Me | null;
  signedIn(me: Me): void;
  signedOut(): void;
};

export const createSessionStore = () =>
  createStore<SessionState>()(set => ({
    status: 'restoring',
    me: null,
    signedIn: me => set({ status: 'signed_in', me }),
    signedOut: () => set({ status: 'signed_out', me: null }),
  }));
