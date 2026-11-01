import type { DriverAvailability } from '@lern/contracts';
import type { StoreApi } from 'zustand/vanilla';
import type { LocationService, Permission } from '../services/location.service';
import type { DriverModeState } from '../stores/driver-mode.store';

// Tracking runs exactly while the server says the driver is online (available, holding an offer, on a trip).
// The server can end that on its own (presence time-out), so this follows the store, not the toggle.
// onStart gets each start's outcome: 'denied' or 'failed' means not tracking (the caller can't keep the driver
// online without it), and the next availability change tries again.
export function followAvailability(
  driverMode: StoreApi<DriverModeState>,
  location: Pick<LocationService, 'start' | 'stop'>,
  onStart: (result: Permission | 'failed') => void,
): () => void {
  const online = (a: DriverAvailability | null) =>
    a !== null && a !== 'offline';
  let tracking = false;
  let latest = 0; // the newest availability change; only its failed start may reset `tracking`
  let chain = Promise.resolve(); // start and stop run in the order the availability changed
  const run = (job: () => Promise<unknown>) => {
    chain = chain.then(job).then(
      () => undefined,
      () => undefined,
    );
  };
  const follow = (availability: DriverAvailability | null) => {
    const want = online(availability);
    if (want === tracking) return;
    tracking = want;
    const request = ++latest;
    run(async () => {
      if (!want) return location.stop();
      let result: Permission | 'failed';
      try {
        result = await location.start();
      } catch {
        result = 'failed';
      }
      // A newer change already set `tracking` for itself: an older failure must not overwrite it
      if ((result === 'denied' || result === 'failed') && request === latest)
        tracking = false;
      onStart(result);
    });
  };
  // iOS restores location updates a previous run left on: stop them until the driver is online again
  run(() => location.stop());
  follow(driverMode.getState().availability);
  return driverMode.subscribe(s => follow(s.availability));
}
