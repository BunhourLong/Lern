import { createRawEventsStore } from './raw-events.store';

it('keeps the newest events first, at most 100, and reset empties it', () => {
  const store = createRawEventsStore();
  for (let i = 0; i < 105; i++) store.getState().add(`e${i}`, { i });
  const { events } = store.getState();
  expect(events).toHaveLength(100);
  expect(events[0]).toMatchObject({ event: 'e104', payload: { i: 104 } });
  expect(events[99].event).toBe('e5');
  store.getState().reset();
  expect(store.getState().events).toEqual([]);
});
