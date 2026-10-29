import { driverAvailabilityActionSchema, driverAvailabilitySchema } from './driver.schema';
import { driverTransition } from './driver.transitions';

// The spec, written out by hand (PLAN.md §4 driver availability): every legal "from action" move
const LEGAL = new Set([
  'offline go_online',
  'available go_offline',
  'available reserve',
  'reserved release',
  'reserved assign',
  'on_trip finish',
]);

const combos = driverAvailabilitySchema.options.flatMap((from) =>
  driverAvailabilityActionSchema.options.map((action) => ({ from, action })),
);

it.each(combos)('$from --$action--> legal only if in the spec', ({ from, action }) => {
  expect(driverTransition(action).from === from).toBe(LEGAL.has(`${from} ${action}`));
});

it('goes online, holds an offer, drives the trip and is free again', () => {
  let state = 'offline';
  for (const action of ['go_online', 'reserve', 'assign', 'finish', 'go_offline'] as const) {
    expect(driverTransition(action).from).toBe(state);
    state = driverTransition(action).to;
  }
  expect(state).toBe('offline');
  expect(driverTransition('release').to).toBe('available');
});
