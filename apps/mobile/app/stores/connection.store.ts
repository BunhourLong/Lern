import { createStore } from 'zustand/vanilla';

// The socket's own events, not NetInfo: offers arrive over the socket, so a down API with working internet is
// disconnected too
export type ConnectionState = {
  connected: boolean;
  setConnected(connected: boolean): void;
};

export const createConnectionStore = () =>
  createStore<ConnectionState>()(set => ({
    connected: false,
    setConnected: connected => set({ connected }),
  }));
