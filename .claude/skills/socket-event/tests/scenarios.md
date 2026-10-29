# Scenarios for socket-event

## S1: ride:requested to nearby drivers (application)
Setup: a fresh detached git worktree of this repo at the commit under test, `apps/api/.env` copied,
`pnpm install`; the private docs (CLAUDE.md, PLAN.md, PLAN-notes.md) copied in if you have them.
Prompt (fresh subagent; exercise overrides: no commit/stage, no Superpowers, no PLAN ticking, no graphify update, no Snyk):
> Add a server push so drivers don't have to poll for work: when a rider books (`POST /rides`), every
> verified driver of the ride's vehicle type who has a fresh position within 3 km of the pickup and no
> active ride gets a `ride:requested` socket event carrying the ride. Booking must keep working when no
> driver is nearby. Make the simulator's drivers log the event they receive (keep its in-process
> hand-off).
Pass checks:
- [ ] Event name constant and payload schema in `packages/contracts`, exported from `index.ts`
- [ ] Outbox row written in the same statement/transaction as the ride insert, not a direct emit after commit
- [ ] Zero nearby drivers: booking still 201, no outbox row with empty recipients, no broadcast; tested
- [ ] Payload is the full ride snapshot with `version` (same projection as REST), asserted against the REST body
- [ ] Socket test: the nearby driver receives it; a far, other-vehicle, busy or unverified driver and the rider don't, with absence proven (sentinel or equivalent), not a sleep
- [ ] Simulator handler parses the payload with the contract schema
- [ ] A mutation (drop a recipient filter or the outbox write) seen failing a test
- [ ] Gates green
Baseline (2026-10-29, no skill, sonnet): constant ✅ (payload reuses `Ride`), full snapshot `toEqual` REST ✅,
zero recipients guarded in JS (`if (drivers.length)`) ✅, gates ✅. Failed: emitted from `RidesService.book` after
commit, fire-and-forget via `LocationService.nearby` — "Best effort and not in the outbox: a driver who misses it
finds the ride by polling" (no such endpoint exists); absence proven by `settle()` = 500 ms sleep; simulator handler
`(r: Ride) =>` without parse; mutation "one test failed", not tied to the recipients test; one unexplained
integration failure, "likely timing or the shared test DB". Cost: 19 tool uses, ~235 s, ~76k tokens.
With skill (2026-10-29): PASSED every check. `requested` CTE in `RidesRepository.insert` (recipients in a LATERAL
subquery, `WHERE cardinality(...) > 0`, nearest 50), `ride-requested.int-spec.ts`: receive < 500 ms `toEqual` REST,
six non-recipients proven by sentinel, zero-driver booking 201; simulator `safeParse` + stale + malformed unit test;
mutations: no CTE, each filter, no kick, no cardinality guard each failed a named test; 137/137 twice. Privacy
assumptions (pickup/dropoff to 50 drivers) in QUESTIONS.md. Cost: 23 tool uses, ~400 s, ~76k tokens (baseline 19,
~235 s, ~76k). Skill fixes from its defect report (not re-run, wording only): record own ids *plus* sentinels;
`LIMIT` on many-user recipient queries; Ask first defaults to the request's audience.

## Trigger check
Should load: 1. "Send the driver a socket event when they get a new ride offer." 2. "Push `driver:connectivity {stale: true}` to the rider when the driver's heartbeat lapses." 3. "Admins should get a live feed of every ride change in an admin socket room."
Should not (neighbour skill in brackets): 1. "Add a `cancelledBy` field to the ride:updated payload." [contract-change] 2. "Add the driver no-show cancel move after 5 minutes at pickup." [ride-transition] 3. "Add GET /rides/history with keyset pagination." [nest-module]
Last result (2026-10-29, sonnet, 8-skill listing, run together with contract-change's 6): 6/6
