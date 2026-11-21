import type {
  DriverAvailability,
  DriverVerification,
  LocationPoint,
} from '@lern/contracts';
import { createStore } from 'zustand/vanilla';
import type { Permission } from '../services/location.service';
import { keepNewer } from '../utils/ordering';

// The driver's availability as the server last said it (PUT /drivers/me/availability, GET /drivers/me): the server
// can change it too (offers, trips, the presence time-out), so it is read back, never assumed from the toggle
export type DriverModeState = {
  availability: DriverAvailability | null; // null = not a driver, or not loaded yet
  verification: DriverVerification | null; // null = not a driver, or not loaded yet
  locationPermission: Permission | 'failed' | null;
  position: LocationPoint | null;
  applyPosition(position: LocationPoint): void;
  setAvailability(availability: DriverAvailability | null): void;
};

export const createDriverModeStore = () =>
  createStore<DriverModeState>()(set => ({
    availability: null,
    verification: null,
    locationPermission: null,
    position: null,
    applyPosition: position =>
      set(state => ({
        position: keepNewer(
          state.position ?? undefined,
          position,
          p => p.recordedAt,
        ),
      })),
    setAvailability: availability => set({ availability }),
  }));
