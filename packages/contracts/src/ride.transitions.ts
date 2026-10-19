import type { RideAction, RideActor, RideStatus } from './ride.schema';

type Transition = { action: RideAction; actor: RideActor; from: readonly RideStatus[]; to: RideStatus };

// Single source of the ride state machine (PLAN.md §4). The API turns each entry into one guarded
// `UPDATE … SET status = to WHERE status = ANY(from)`; clients use it to show what's possible.
// Driver cancel after assignment cancels the ride (re-search is an open question for M4).
const RIDE_TRANSITIONS: readonly Transition[] = [
  { action: 'accept', actor: 'driver', from: ['searching'], to: 'driver_assigned' },
  { action: 'arrive', actor: 'driver', from: ['driver_assigned'], to: 'driver_arrived' },
  { action: 'start', actor: 'driver', from: ['driver_arrived'], to: 'in_progress' },
  { action: 'complete', actor: 'driver', from: ['in_progress'], to: 'completed' },
  { action: 'expire', actor: 'system', from: ['searching'], to: 'no_driver_found' },
  { action: 'cancel', actor: 'rider', from: ['searching', 'driver_assigned', 'driver_arrived'], to: 'cancelled' },
  { action: 'cancel', actor: 'driver', from: ['driver_assigned', 'driver_arrived'], to: 'cancelled' },
];

// undefined = this actor can never do this action
export function rideTransition(action: RideAction, actor: RideActor): Pick<Transition, 'from' | 'to'> | undefined {
  return RIDE_TRANSITIONS.find((t) => t.action === action && t.actor === actor);
}
