import { createStore } from 'zustand/vanilla';

export type ConnectionState = {
  connected: boolean;
  network: boolean | null;
  setConnected(connected: boolean): void;
  setNetwork(network: boolean | null): void;
};

export const createConnectionStore = () =>
  createStore<ConnectionState>()(set => ({
    connected: false,
    network: null,
    setConnected: connected => set({ connected }),
    setNetwork: network => set({ network }),
  }));
