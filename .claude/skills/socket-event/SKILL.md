---
name: socket-event
description: Use when adding a server-to-client Socket.IO event in apps/api (notify a rider, driver or admin of something, push an offer, a ride update to a new audience, a driver position or presence signal), when adding a client-to-server socket message, or when an event must reach users reliably, carry seq/version, skip users who must not see it, or be handled by the simulator or mobile client.
---

# Socket event

A push is part of the state change it announces: it is written to `outbox_events` in the same SQL
statement, sent by `OutboxService`, and clients drop anything older than what they hold (CLAUDE.md §3,
invariants 7, 8, 11). This skill is the path from contract to client, in order. Changing an existing
event's payload: `contract-change`.

## Ask first
- **Who must receive it, and who must never?** — default: the audience the request names, else the
  ride's participants for ride data. Changes: steps 3 and 6. Ask when the request doesn't name one, or
  when it sends one user's position, pickup, dropoff or phone to someone outside the ride (PLAN.md §8
  proposed invariant); nobody to ask: write the question down and use the request's audience.

## Map
- `packages/contracts/src/ride.schema.ts`: `RIDE_UPDATED_EVENT`, `rideSchema`; `location.schema.ts`:
  `DRIVER_POSITION_EVENT`, the direct-emit example.
- `apps/api/src/rides/rides.repository.ts`: the `OUTBOX` CTE (writer); `rides.service.ts`: `kick()`.
- `apps/api/src/outbox/outbox.service.ts`: the only dispatcher; rooms are `user:{id}` only.
- `apps/api/src/location/location.gateway.ts` (client → server handler), `location.service.ts`
  (throttled direct emit).
- `apps/api/test/outbox.int-spec.ts`: `listen`, `take`, `sentinel` helpers.
- `tools/simulator/src/sim-rider.ts`: client handler that keeps the highest `version`.

## Steps
1. **Outbox or direct?** A state change (a row created, a status moved) goes through the outbox.
   A direct emit is only for data the next message supersedes within seconds (positions, presence),
   throttled like `LocationService.record`. "Best effort, they can poll" needs a poll endpoint that
   exists. Check: the reply names the path and why.
2. **Contract.** `export const <NAME>_EVENT = '<area>:<verb>'` plus its payload schema in
   `packages/contracts/src/<area>.schema.ts`, exported from `src/index.ts`. A ride event's payload is
   the full `Ride` (`version` is the seq); another entity sends its full snapshot with a field clients
   can order by, and if it has none, ask. Check: `pnpm --filter @lern/contracts typecheck`.
3. **Writer.** Add a CTE to the statement that makes the change, shaped like `OUTBOX`:
   `INSERT INTO outbox_events (topic, recipients, payload) SELECT '<event>', <uuid[]>, <jsonb> FROM <changed-row CTE> WHERE cardinality(<uuid[]>) > 0`.
   Compute recipients in that SQL: a read-only subquery on another module's table is allowed
   (`LocationRepository.record` reads `rides`); never look them up in JS after commit. A recipient
   query over many users (drivers nearby) gets an `ORDER BY` and a `LIMIT`. The `WHERE`
   matters: `recipients` has `CHECK (cardinality(recipients) > 0)`, so an empty list would fail the
   user's whole command. After the statement, the service calls `this.outbox.kick()`.
   Check: `grep -rn "<NAME>_EVENT" apps/api/src` finds no `.emit(` outside the outbox (direct path:
   only the throttled emit).
4. **Direct path only.** Emit `this.realtime.server.to(rooms).emit(...)` after
   `consume(this.redis, 'rl:<event>:<id>', 1, <s>).catch(() => 1)`. Skip the emit when `rooms` is
   empty: in Socket.IO 4.8.3 `to([])` broadcasts to every socket.
5. **Client → server message only.** Handler in `<feature>.gateway.ts` (`@WebSocketGateway({ transports: ['websocket'] })`),
   role check, `schema.safeParse(payload)` (no global pipe or guard runs on gateways), ack
   `{ error }` on failure, user id from `socket.data`, never the payload. Commands stay REST.
6. **Tests** in `apps/api/test/<feature>.int-spec.ts`, copying the helpers from `outbox.int-spec.ts`:
   - each recipient gets it within 500 ms (the kick, not the 1 s poll), `toEqual` the REST snapshot;
   - each non-recipient (list every filter: other user, too far, wrong role, wrong state) then gets a
     `sentinel` inserted after the action, and `take(1)` equals `[{ sentinel: true }]`: same ordered
     stream, so the event was never sent (direct path: emit the sentinel to the same room, as
     `location.int-spec.ts` does). No `setTimeout` waits to prove absence.
   - zero recipients: the command still succeeds;
   - other suites share the DB and Redis: record only events whose id this test created, plus sentinels.
   Check: with the CTE removed the receive test fails, with one recipient filter removed a
   non-recipient test fails, without `kick()` the 500 ms test fails.
7. **Client.** In `tools/simulator/src`, `socket.on(<NAME>_EVENT, (raw: unknown) => ...)`:
   `safeParse` with the contract schema (outbox payloads are built in SQL and nothing else checks
   them), ignore `version <=` the one held for that id, log or count rejects. Mobile has no socket
   client before M5; note the event for it there. Check: a simulator unit test feeds a stale and a
   malformed payload.

## Verify
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` from the root, and the step 6
mutations seen failing. An unexplained test failure, even once, is a finding: find its cause.

## Common mistakes
- Emitting from the service after commit → lost on a crash or a Redis blip, with no way to recover.
- Recipients queried in JS, or an outbox row with an empty array → the command fails, or a broadcast.
- Proving "nobody else got it" with a sleep → flaky and proves nothing; use the sentinel.
- `(r: Ride) => …` in a client handler → a type assertion, not a check; `safeParse`.
- A feature handler in `RealtimeGateway`, or `RealtimeModule` importing a feature → feature gateway;
  the feature imports `RealtimeModule`.

## Sources
See [references.md](references.md). Socket.IO 4.8.3 `to([])` and Zod 4.6.7 parsing were run on
2026-10-29 at commit 7755127. Scenarios: [tests/scenarios.md](tests/scenarios.md).
