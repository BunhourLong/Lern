import { createDriverModeStore } from './driver-mode.store';

it('holds the availability the server last reported', () => {
  const store = createDriverModeStore();
  expect(store.getState()).toMatchObject({
    availability: null,
    verification: null,
  });
  store.setState({ verification: 'verified' });
  store.getState().setAvailability('available');
  expect(store.getState()).toMatchObject({
    availability: 'available',
    verification: 'verified',
  });
});

test('holds the newest driver location and ignores older or equal timestamps', () => {
  const store = createDriverModeStore();
  const { applyPosition } = store.getState();
  const point = { lat: 11.55, lng: 104.92, recordedAt: '2026-11-21T10:00:00Z' };
  const newest = { ...point, lat: 11.56, recordedAt: '2026-11-21T10:00:04Z' };

  expect(store.getState().position).toBeNull();
  applyPosition(point);
  expect(store.getState().position).toEqual(point);
  applyPosition(newest);
  applyPosition(point);
  applyPosition({ ...newest, lat: 11.58 });
  expect(store.getState().position).toEqual(newest);
});
