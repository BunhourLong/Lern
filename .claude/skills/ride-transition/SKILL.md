---
name: ride-transition
description: Use when adding or changing a ride state transition in apps/api (a new ride action or status, who may move a ride, a system or timer move such as expire, cancel or no-show rules), or when a ride move needs its event row, outbox row, 409 snapshot or a race test against a competing move.
---

# Ride transition

Every ride move is one guarded SQL statement driven by the transition table in `packages/contracts`
(CLAUDE.md §3, invariants 1, 2, 7, 8, 11). This skill is the map of every place a transition
touches, in the order to change them.

## Ask first
Ask only what CLAUDE.md, PLAN.md and the conversation don't already answer.
- **Does the move need a new policy value** (deadline length, grace period, fee, who may act when)? —
  default: none. If yes, ask, and record the answer in PLAN.md §4 (or §8 while open). Never settle
  it silently as a migration `DEFAULT` or a constant. If nobody can be asked (subagent, CI), use a
  placeholder in exactly one place (the `MAY_MOVE` fragment), mark it `shortcut:`, and add the
  question to PLAN.md §8.
- **Who triggers it: a person (HTTP route) or the system (job/timer)?** — default: route for a
  person, service method returning `Ride | undefined` for the system. Changes: steps 4–5.
- **Which moves compete from the same `from` status?** (accept vs cancel vs expire vs no-show) —
  default: every other move out of that status in the table. Changes: step 6 race tests.

## Map (read in this order)
1. `packages/contracts/src/ride.schema.ts`: status, action and actor enums.
2. `packages/contracts/src/ride.transitions.ts` + `ride.transitions.spec.ts`: the table and its matrix test.
3. `apps/api/src/rides/rides.repository.ts`: `MAY_MOVE` fragments and `transition()`, the one CTE
   that runs the guarded `UPDATE` and inserts the `ride_events` row.
4. `apps/api/src/rides/rides.service.ts`: `move()` (tries each actor side; 409 + snapshot for a
   participant, 404 for anyone else) and the public use-cases.
5. `apps/api/src/rides/rides.controller.ts`: routes. Specific `/:id/<action>` routes are declared
   before `/:id/:action`.
6. `apps/api/test/rides.int-spec.ts`: helpers `book`, `accept`, `step`, `cancel`, `assignedRide`,
   `searchingRide`, `verifiedDriver`, `events`, `stored`.
7. PLAN-notes.md, entry "Guarded UPDATE transitions", when the file exists.

## Steps
1. **Table.** Add or adjust the entry `{ action, actor, from[], to }`; update the hand-written legal
   list in the spec. A new status also needs: a migration for the `rides.status` CHECK, and every
   status list in SQL (partial uniques `rides_one_active_per_rider` / `_per_driver`,
   `RidesRepository.findActive`). Check: `pnpm --filter @lern/contracts test` passes.
2. **Who may move.** A constant `MAY_MOVE` fragment with `$1` = caller. Time rules compare to SQL
   `now()` in the fragment, never a JS date. Check: a person's move by a non-participant matches no
   row; a system move on a ride that isn't due yet matches no row.
3. **Statement.** Use `RidesRepository.transition` only; columns the move sets go in its `SET`. Once
   an `outbox_events` table exists (M3), insert the outbox row in the same statement. Check:
   `grep -rn "UPDATE rides" apps/api/src` finds only `transition()` and migrations.
4. **Service.** A person's move goes through `move()`. The first system move (as of c671438
   `transition()` takes `userId: string` and `actor: 'rider' | 'driver'`) widens it to
   `userId: string | null` and `actor: RideActor`, and adds a `system` fragment to `MAY_MOVE`. The
   event row then gets `actor_id NULL`, which the `ride_events` CHECK requires for `system`. A system
   use-case returns `Ride | undefined` and doesn't throw.
5. **Route** (person only): `@HttpCode(HttpStatus.OK)`, `@Idempotent()`, `@ZodSerializerDto(RideDto)`, `@Roles`
   for the actor (no `@Roles` when either side may act, as with cancel). Leave `@VerifiedDriver` off
   moves that end a driver's active ride. Declare it before `/:id/:action`.
6. **Tests** in `rides.int-spec.ts`:
   - the legal move from each `from` status: snapshot, `version + 1`, one new `ride_events` row;
   - every other status: 409 + snapshot (participant) or `undefined` (system), with no new event;
   - IDOR for routes: another rider and another driver get 404, and the ride is unchanged;
   - a move that ends a ride frees the partial uniques (rider books again, driver accepts again);
   - a race against each competing move. **REQUIRED SUB-SKILL:** concurrency-test (gate + mutation
     check). Reuse a `gate()` helper in the spec if one exists; otherwise add one there (a
     `LOCK TABLE rides` gate, per concurrency-test's Postgres file).
   Check: removing the new `MAY_MOVE` fragment or the status guard fails at least one test.
7. **Docs.** Tick the PLAN.md box, add a PLAN-notes entry, and add a §9 gotcha if one bit you.

## Verify
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` all pass, and the mutation from
step 6 has been seen failing.

## Common mistakes
- An `UPDATE rides` outside `transition()` → no guard, no event, no seq.
- A policy value buried in a migration `DEFAULT` → ask, and record it in PLAN.md.
- Load-then-compare for ownership → put the rule in the `MAY_MOVE` fragment.
- A route declared after `/:id/:action` → swallowed (400 from `ParseEnumPipe`, or 403).
- Changing only one status list → partial uniques and `findActive` drift apart.
- Setting `cancel_reason` on a non-cancel move → CHECK violation (it is set if and only if `cancelled`).

## Sources
CLAUDE.md §3 and §4; the code at the files above. Last verified: 2026-10-21 at commit c671438.
Scenarios: [tests/scenarios.md](tests/scenarios.md).
