import { rideActionSchema, rideActorSchema, rideStatusSchema, type RideStatus } from './ride.schema';
import { rideTransition } from './ride.transitions';

// The spec, written out by hand (PLAN.md §4): every legal "from action actor" move. Everything else is illegal.
const LEGAL = new Set([
  'searching accept driver',
  'driver_assigned arrive driver',
  'driver_arrived start driver',
  'in_progress complete driver',
  'searching expire system',
  'searching cancel rider',
  'driver_assigned cancel rider',
  'driver_arrived cancel rider',
  'driver_assigned cancel driver',
  'driver_arrived cancel driver',
]);

const statuses = rideStatusSchema.options;
const actions = rideActionSchema.options;
const actors = rideActorSchema.options;
const combos = statuses.flatMap((from) => actions.flatMap((action) => actors.map((actor) => ({ from, action, actor }))));

it.each(combos)('$from --$action by $actor--> legal only if in the spec', ({ from, action, actor }) => {
  const allowed = rideTransition(action, actor)?.from.includes(from) ?? false;
  expect(allowed).toBe(LEGAL.has(`${from} ${action} ${actor}`));
});

it('follows the happy path from search to completion', () => {
  let status: RideStatus = 'searching';
  for (const action of ['accept', 'arrive', 'start', 'complete'] as const) {
    const t = rideTransition(action, 'driver')!;
    expect(t.from).toContain(status);
    status = t.to;
  }
  expect(status).toBe('completed');
});

it('ends cancel in cancelled and expire in no_driver_found', () => {
  expect(rideTransition('cancel', 'rider')?.to).toBe('cancelled');
  expect(rideTransition('cancel', 'driver')?.to).toBe('cancelled');
  expect(rideTransition('expire', 'system')?.to).toBe('no_driver_found');
});

it('has no way out of a terminal status, and no rider exit from in_progress', () => {
  const exits = (from: RideStatus, actor = actors) =>
    actions.flatMap((action) => actor.filter((a) => rideTransition(action, a)?.from.includes(from)));
  for (const terminal of ['completed', 'cancelled', 'no_driver_found'] as const) expect(exits(terminal)).toEqual([]);
  expect(exits('in_progress', ['rider'])).toEqual([]);
});
