import { createConnectionStore } from './connection.store';

it('starts disconnected and follows what the socket says', () => {
  const store = createConnectionStore();
  expect(store.getState().connected).toBe(false);
  store.getState().setConnected(true);
  expect(store.getState().connected).toBe(true);
  store.getState().setConnected(false);
  expect(store.getState().connected).toBe(false);
});
