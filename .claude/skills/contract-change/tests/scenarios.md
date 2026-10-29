# Scenarios for contract-change

## S1: a fourth vehicle type (application)
Setup: a fresh detached git worktree of this repo at the commit under test, `apps/api/.env` copied,
`pnpm install`; the private docs (CLAUDE.md, PLAN.md, PLAN-notes.md) copied in if you have them.
Prompt (fresh subagent; exercise overrides: no commit/stage, no Superpowers, no PLAN ticking, no graphify update, no Snyk):
> Add electric motos as a fourth vehicle type, `ev_moto`, priced at base 2500 riel + 1100 riel/km.
> Drivers must be able to register one, riders to quote and book one. Update every consumer in the
> monorepo in this one change.
Pass checks:
- [ ] `vehicleTypeSchema` widened in contracts; every consumer compiles (`pnpm typecheck` from the root, all workspaces)
- [ ] New migration widens all three `vehicle_type` CHECKs (drivers, quotes, rides); applied migrations untouched; up and down run
- [ ] Classifies the change: widening an enum that responses carry is breaking for clients that parse it (mobile, simulator, installed apps) and is flagged as an ask-first item (CLAUDE.md §5), not silently shipped
- [ ] Tests: register, quote and book an `ev_moto` end to end against Postgres; fare unit test for the new rates
- [ ] Simulator and mobile checked (left alone or updated, with a reason)
- [ ] Gates green from the root (lint, typecheck, test, test:integration)
Baseline (2026-10-29, no skill, sonnet): schema, fare + unit test, new migration for all three CHECKs (applied
ones untouched, down restores, `migrations.int-spec` covers up/down/up), register/quote/book integration tests,
simulator and mobile checked, root gates ✅. Failed: no compatibility classification at all — "No questions
needed (QUESTIONS.md not written)"; widening an enum every ride/quote/driver response carries shipped unflagged.
Cost: 15 tool uses, ~125 s, ~53k tokens.
With skill, round 1 (2026-10-29): every check passed except the ask: it classified correctly ("BREAKS old
readers of responses/events carrying vehicleType") but took the Ask-first default "no installed build" as
leave to ship, with no question raised. Skill fixes: the break question has no default; migration registration
in `database.ts`; greps scoped to migrations / repositories; socket test only when the projection changed.
With skill, round 2 (2026-10-29): PASSED every check; QUESTIONS.md names the break and its readers and asks
about installed builds; one integration test registers, quotes, books and accepts an `ev_moto` (fails with the
migration unregistered). Cost: ~16 tool uses, ~150 s, ~55k tokens per round (baseline 15, ~125 s, ~53k). Its
defect report added the default CHECK name to step 3.

## Trigger check
Should load: 1. "Rename `fare` to `price` in the ride schema everywhere." 2. "Allow USD as a fare currency next to KHR in the money schema." 3. "The simulator fails to parse the quote response since someone changed quoteSchema."
Should not (neighbour skill in brackets): 1. "Add a new socket event when a rider's quote expires." [socket-event] 2. "Add an index on rides.created_at." [typeorm-migration] 3. "Write a test that two riders can't book the same quote at once." [concurrency-test]
Last result (2026-10-29, sonnet, 8-skill listing, run together with socket-event's 6): 6/6
