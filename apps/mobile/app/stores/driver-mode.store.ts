import type { DriverAvailability } from '@lern/contracts';
import { createStore } from 'zustand/vanilla';

// The driver's availability as the server last said it (PUT /drivers/me/availability, GET /drivers/me): the server
// can change it too (offers, trips, the presence time-out), so it is read back, never assumed from the toggle
export type DriverModeState = {
  availability: DriverAvailability | null; // null = not a driver, or not loaded yet
  setAvailability(availability: DriverAvailability | null): void;
};

export const createDriverModeStore = () =>
  createStore<DriverModeState>()(set => ({
    availability: null,
    setAvailability: availability => set({ availability }),
  }));
