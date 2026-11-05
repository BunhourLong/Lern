import { createStore } from 'zustand/vanilla';

// Debug side channel (PLAN.md M5.9): `at` is display only and decides nothing
export type RawEvent = { at: string; event: string; payload?: unknown };
const CAP = 100;

export type RawEventsState = {
  events: RawEvent[]; // newest first
  add(event: string, payload?: unknown): void;
  reset(): void;
};

export const createRawEventsStore = () =>
  createStore<RawEventsState>()(set => ({
    events: [],
    add: (event, payload) =>
      set(s => ({
        events: [
          { at: new Date().toISOString(), event, payload },
          ...s.events,
        ].slice(0, CAP),
      })),
    reset: () => set({ events: [] }),
  }));
