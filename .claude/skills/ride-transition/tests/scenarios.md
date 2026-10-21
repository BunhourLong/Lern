# Scenarios for ride-transition

## S1: system expire (application)
Setup: a fresh detached git worktree of this repo at the commit under test, `apps/api/.env` copied,
`pnpm install`; the private docs (CLAUDE.md, PLAN.md, PLAN-notes.md) copied in if you have them.
Prompt (fresh subagent; exercise overrides: no commit/stage, no Superpowers, no PLAN ticking, no graphify update, no Snyk):
> Add the system transition that expires a ride nobody accepted: a `searching` ride whose search
> deadline has passed becomes `no_driver_found`. For now expose it as a service method
> `RidesService.expire(rideId)` (the M4 BullMQ job will call it later); no HTTP route. It must be safe
> against a driver accepting at the same moment.
Pass checks:
- [ ] The move goes through `RidesRepository.transition` with from/to from `rideTransition` (no other `UPDATE rides`)
- [ ] Deadline compared with DB `now()` inside the guarded statement
- [ ] Event row written in the same statement (actor `system`, actor_id NULL)
- [ ] Policy value (deadline length) raised as a question, not silently fixed in code or a migration DEFAULT
- [ ] Tests: legal move + event; each non-searching state untouched with no event; not-yet-due untouched
- [ ] Race vs accept with a proven-overlap gate and a mutation check
- [ ] Gates green
Baseline (2026-10-21, no ride-transition skill; concurrency-test was visible mid-run and partially
loaded): all checks met except policy: it added `search_deadline_at … DEFAULT now() + interval
'3 minutes'` in a migration and listed the length in QUESTIONS.md as a placeholder. Cost: 33 tool
uses, ~590 s, ~116k tokens, most of it locating the transition path.
With skill (2026-10-21): PASSED every check. Policy: 3 min kept in one `MAY_MOVE.system` fragment
(`created_at <= now() - interval '3 minutes'`), marked `shortcut:`, question in QUESTIONS.md and
PLAN.md §8; no migration. Added a `gate()` helper (LOCK TABLE rides + pg_stat_activity), races vs
accept *and* vs cancel (5 rounds each, both outcomes observed), mutations: gate asked for 3 → "not all
3 arrived", status guard removed → both win, system fragment always true → not-yet-due test fails.
Cost (harness): 28 tool uses, ~440 s, ~107k tokens (baseline 33, ~590 s, ~116k). Skill fixes from this run: what to do when nobody can be asked;
step 2 check for system moves; reuse/add `gate()`.

## Trigger check
Should load: 1. "add a no-show cancel for drivers after 5 minutes at pickup" 2. "let admins force-complete a stuck ride" 3. "the expire job must not fight a driver's accept"
Should not (neighbour in brackets): 1. "add a GET /rides history endpoint with pagination" [nest-module] 2. "add a column for the rating to rides" [typeorm-migration] 3. "write a race test for quote booking" [concurrency-test]
Last result (2026-10-21, sonnet, 5-skill listing): 6/6
