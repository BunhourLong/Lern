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
