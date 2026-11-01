import { createSessionStore } from './session.store';

it('starts restoring, then holds who is signed in until sign-out', () => {
  const store = createSessionStore();
  expect(store.getState()).toMatchObject({ status: 'restoring', me: null });
  const me = {
    id: '00000000-0000-4000-8000-000000000001',
    phone: '+85512345678',
    roles: ['rider' as const],
  };
  store.getState().signedIn(me);
  expect(store.getState()).toMatchObject({ status: 'signed_in', me });
  store.getState().signedOut();
  expect(store.getState()).toMatchObject({ status: 'signed_out', me: null });
});
