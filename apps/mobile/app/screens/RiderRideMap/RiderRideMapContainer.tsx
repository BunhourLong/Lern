import { useReducer } from 'react';
import { useStore } from 'zustand';
import type { createActiveRideStore } from '../../stores/active-ride.store';
import {
  hasAssignedDriver,
  isEndedRiderRide,
} from '../RiderBooking/rider-ride';
import { RiderRideMapScreen } from './RiderRideMapScreen';

export default function RiderRideMapContainer({
  activeRide,
  onDone,
}: {
  activeRide: ReturnType<typeof createActiveRideStore>;
  onDone: () => void;
}) {
  const rider = useStore(activeRide, state => state.rider);
  const position = useStore(activeRide, state => state.position);
  const connectivity = useStore(activeRide, state => state.connectivity);
  const [cameraKey, recenter] = useReducer(key => key + 1, 0);
  const showDriver = rider !== null && hasAssignedDriver(rider.status);

  return (
    <RiderRideMapScreen
      ride={
        rider
          ? {
              ...rider,
              ended: isEndedRiderRide(rider.status),
              driverPosition:
                showDriver && position?.rideId === rider.id ? position : null,
              driverStale:
                showDriver &&
                connectivity?.rideId === rider.id &&
                connectivity.stale,
            }
          : undefined
      }
      cameraKey={cameraKey}
      onRecenter={recenter}
      onDone={onDone}
    />
  );
}
