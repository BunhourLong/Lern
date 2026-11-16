import { createDriverModeStore } from './driver-mode.store';

it('holds the availability the server last reported', () => {
  const store = createDriverModeStore();
  expect(store.getState().availability).toBeNull();
  store.getState().setAvailability('available');
  expect(store.getState().availability).toBe('available');
});
