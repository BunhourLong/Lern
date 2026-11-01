import {
  type Fix,
  REPORT_EVERY_MS,
  startTracking,
  track,
} from './tracking-mode';

const at = (s: number) => s * 1000;
// metres north of a Phnom Penh point
const fix = (
  s: number,
  northM: number,
  speedMps: number | null = null,
  accuracyM: number | null = 5,
): Fix => ({
  lat: 11.5564 + northM / 111_320,
  lng: 104.9282,
  speedMps,
  accuracyM,
  at: at(s),
});

it('keeps reporting faster than the server’s 30 s stale threshold in either mode', () => {
  expect(REPORT_EVERY_MS.moving).toBeLessThanOrEqual(5000);
  expect(REPORT_EVERY_MS.stationary).toBeLessThanOrEqual(15000);
});

it('turns stationary only after 2 min below 1 m/s, and moving again as soon as above 2 m/s', () => {
  let s = startTracking();
  for (let t = 0; t <= 110; t += 10) s = track(s, fix(t, 0, 0.3));
  expect(s.mode).toBe('moving'); // 110 s still: not yet
  s = track(s, fix(120, 0, 0.3));
  expect(s.mode).toBe('stationary');
  s = track(s, fix(125, 0, 1.5)); // between the thresholds: no flapping
  expect(s.mode).toBe('stationary');
  s = track(s, fix(130, 0, 3));
  expect(s.mode).toBe('moving');
});

it('restarts the 2 min wait whenever the driver moves in between', () => {
  let s = startTracking();
  s = track(s, fix(0, 0, 0.2));
  s = track(s, fix(100, 0, 1.5)); // not still any more
  s = track(s, fix(110, 0, 0.2));
  s = track(s, fix(200, 0, 0.2));
  expect(s.mode).toBe('moving'); // still since 110 s: 90 s
  s = track(s, fix(230, 0, 0.2));
  expect(s.mode).toBe('stationary');
});

it('estimates speed from the last fix when the OS gives none (iOS reports -1 as unknown)', () => {
  let s = startTracking();
  s = track(s, fix(0, 0, null));
  s = track(s, fix(10, 100, -1, null)); // 100 m in 10 s = 10 m/s
  expect(s.speedMps).toBeCloseTo(10, 0);
  s = track(s, fix(20, 101, null, null)); // 1 m in 10 s, no accuracy reported
  expect(s.speedMps).toBeCloseTo(0.1, 1);
});

it('takes a move no larger than the fixes’ accuracy for GPS jitter, not motion', () => {
  let s = startTracking();
  s = track(s, fix(0, 0, null, 10));
  s = track(s, fix(4, 8, -1, 10)); // 8 m in 4 s = 2 m/s on paper, inside 10 m accuracy
  expect(s.speedMps).toBe(0);
  s = track(s, fix(8, 40, -1, 10)); // 32 m: real movement
  expect(s.speedMps).toBeCloseTo(8, 0);
});
