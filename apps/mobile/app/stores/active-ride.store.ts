import type {
  ActiveRides,
  DriverConnectivity,
  DriverPosition,
  Offer,
  Ride,
} from '@lern/contracts';
import { createStore } from 'zustand/vanilla';
import { keepNewer, keepOffer, keepRide } from '../utils/ordering';

export type Side = 'rider' | 'driver';

export type ActiveRideState = {
  rider: Ride | null; // the ride this user is riding
  driver: Ride | null; // the ride this user is driving
  offer: Offer | null; // the offer this user holds as a driver
  position: DriverPosition | null; // the rider's driver on the map
  connectivity: DriverConnectivity | null; // whether that driver went silent
  // command responses know their side (book → rider, accept → driver); events are placed by ride id
  applyRide(ride: Ride, side?: Side): void;
  applyOffer(offer: Offer): void;
  applyPosition(position: DriverPosition): void;
  applyConnectivity(connectivity: DriverConnectivity): void;
  // REST snapshot after (re)connecting: what the server holds now, unless an event already brought something newer
  applySnapshot(snapshot: ActiveRides): void;
  reset(): void; // sign-out: the next user must not see this one's rides
};

// Invariant 8 on the client: every ride kept at its highest version, events applied through utils/ordering
export const createActiveRideStore = () =>
  createStore<ActiveRideState>()((set, get) => {
    const sideOf = (ride: Ride): Side => {
      const { rider, driver, offer } = get();
      if (
        ride.id === driver?.id ||
        (ride.id !== rider?.id && ride.id === offer?.rideId)
      )
        return 'driver';
      return 'rider';
    };
    // A different rider ride (a new booking) starts with no driver position or connectivity
    const riderRide = (next: Ride | null) =>
      next?.id === get().rider?.id
        ? { rider: next }
        : { rider: next, position: null, connectivity: null };
    const snapshotRide = (held: Ride | null, snap: Ride | null) =>
      snap && held?.id === snap.id ? keepRide(held, snap) : snap;

    const empty = {
      rider: null,
      driver: null,
      offer: null,
      position: null,
      connectivity: null,
    };
    return {
      ...empty,
      reset: () => set(empty),
      // A command response (explicit side) is authoritative even for another ride: the held one's final event may
      // have been lost. Events keep the stricter rule (utils/ordering)
      applyRide: (ride, side) => {
        const to = side ?? sideOf(ride);
        const held = get()[to];
        const next = side && held?.id !== ride.id ? ride : keepRide(held, ride);
        set(to === 'driver' ? { driver: next } : riderRide(next));
      },
      applyOffer: offer => set({ offer: keepOffer(get().offer, offer) }),
      applyPosition: position => {
        if (position.rideId !== get().rider?.id) return;
        set({
          position: keepNewer(
            get().position ?? undefined,
            position,
            p => p.recordedAt,
          ),
        });
      },
      applyConnectivity: connectivity => {
        if (connectivity.rideId !== get().rider?.id) return;
        set({
          connectivity: keepNewer(
            get().connectivity ?? undefined,
            connectivity,
            c => c.lastSeenAt,
          ),
        });
      },
      applySnapshot: ({ rider, driver, offer = null }) => {
        const held = get();
        set({
          ...riderRide(snapshotRide(held.rider, rider)),
          driver: snapshotRide(held.driver, driver),
          offer:
            offer && held.offer?.id === offer.id
              ? keepOffer(held.offer, offer)
              : offer,
        });
      },
    };
  });
