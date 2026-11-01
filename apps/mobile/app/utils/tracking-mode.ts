// Battery-aware tracking for an online driver (PLAN.md M5 background location spike): report often while moving,
// less while standing still, and never slower than the server's presence check, which flags a driver stale
// after 30 s without a point (DRIVER_STALE_SECONDS).

export type Mode = 'moving' | 'stationary';
export type Fix = {
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null; // horizontal accuracy the OS reports for the fix
  at: number;
}; // at = ms since epoch

export const REPORT_EVERY_MS: Record<Mode, number> = {
  moving: 4000,
  stationary: 15_000,
};

const STILL_MPS = 1; // below: standing (traffic light, waiting for a ride)
const MOVING_MPS = 2; // above: driving again; the gap between the two stops flapping
const STILL_FOR_MS = 120_000; // a red light is not "stationary"

export type Tracking = {
  mode: Mode;
  stillSince: number | null;
  last: Fix | null;
  speedMps: number | null;
};

export const startTracking = (): Tracking => ({
  mode: 'moving',
  stillSince: null,
  last: null,
  speedMps: null,
});

// Flat-earth distance: exact enough over the few hundred metres between two fixes
function metres(a: Fix, b: Fix): number {
  const k = 111_320;
  const dy = (b.lat - a.lat) * k;
  const dx = (b.lng - a.lng) * k * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

// From two fixes: a move no larger than their accuracy is GPS jitter, not motion (a standing phone wanders metres)
function estimate(last: Fix, fix: Fix): number {
  const moved = metres(last, fix);
  return moved <= Math.max(last.accuracyM ?? 0, fix.accuracyM ?? 0)
    ? 0
    : moved / ((fix.at - last.at) / 1000);
}

export function track(state: Tracking, fix: Fix): Tracking {
  const { last } = state;
  // The OS's speed when it has one (iOS reports -1 for unknown); otherwise from the previous fix
  const speedMps =
    fix.speedMps !== null && fix.speedMps >= 0
      ? fix.speedMps
      : last && fix.at > last.at
      ? estimate(last, fix)
      : null;
  if (speedMps === null) return { ...state, last: fix, speedMps };
  if (speedMps >= MOVING_MPS)
    return { mode: 'moving', stillSince: null, last: fix, speedMps };
  if (speedMps >= STILL_MPS)
    return { mode: state.mode, stillSince: null, last: fix, speedMps };
  const stillSince = state.stillSince ?? fix.at;
  const mode = fix.at - stillSince >= STILL_FOR_MS ? 'stationary' : state.mode;
  return { mode, stillSince, last: fix, speedMps };
}
