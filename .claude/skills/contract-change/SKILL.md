---
name: contract-change
description: Use when changing an existing Zod schema, enum, event name or event payload in packages/contracts (add, remove or rename a field, add an enum value such as a vehicle type, status or cancel reason, tighten a bound, change a type), or when a contracts change has to reach api, simulator and mobile in one change, or a client fails to parse a body or socket payload after one.
---

# Contract change

`packages/contracts` is read by the api, the simulator and the mobile app, and some of it is mirrored
in SQL that Zod never sees. A change is done when every consumer moved with it, and when you know
which readers it breaks before you ship it. New endpoint: `nest-module`. New event: `socket-event`.
New ride status or action: `ride-transition` (it also covers the table).

## Ask first
- **The change has a "breaks" cell in step 1: may it ship?** — no default: always ask (CLAUDE.md §5),
  even when no client is released yet. Name the readers it breaks, and ask whether a mobile build is
  installed outside this repo (store, TestFlight, a tester's phone): then it also needs a rollout plan
  (tolerant client parse first, server change after), which you ask for rather than design. Nobody
  to ask (subagent, CI): write the question to QUESTIONS.md (or the report), do the change, and repeat
  the question in the reply.

## Steps
1. **Classify before editing.** For each schema you touch, find who writes and who parses it
   (contracts' readers: the api's request pipe, `@ZodSerializerDto` responses, `tools/simulator`'s
   `api.client.ts`, mobile). Zod 4 objects strip unknown keys and enums reject unknown values, so:

   | Change | Request (client writes) | Response or event (server writes) |
   |---|---|---|
   | add optional field | safe | safe |
   | add required field | **breaks** old clients (400) | **breaks** new readers of old data* |
   | add enum value | safe | **breaks** every old reader: the whole body fails to parse |
   | remove, rename, retype, tighten | **breaks** | **breaks** |

   *old data = outbox rows queued by the previous build, snapshots a client persisted.
   A **breaks** cell is a contract break: raise the Ask first question. Check: the reply names the
   class of every touched schema, and each break has its question.
2. **Contracts.** Edit `packages/contracts/src/<name>.schema.ts`; a new export goes in `src/index.ts`.
   Add or update its spec when it holds logic (bounds, refinements, transition table).
   Check: `pnpm --filter @lern/contracts test` passes.
3. **SQL mirrors.** An enum's values are repeated in DB CHECKs, and some response JSON is built in SQL:
   - `grep -rln "'<an existing value>'" apps/api/src/shared/database/migrations` (e.g. `'remork'`):
     every CHECK found gets a **new** migration that drops and re-adds it (inline CHECKs carry
     Postgres's default name `<table>_<column>_check`) and whose `down` restores the old list, written with
     `typeorm-migration` steps 1–4 (never edit an applied one; register the class in
     `apps/api/src/shared/database/database.ts`, or every test that writes the value gets a 500).
   - `grep -rn "'<an existing value>'" apps/api/src --include='*.repository.ts'`: status lists in
     queries (partial uniques, `findActive`) change with the enum too. Records keyed by the enum
     (`Record<VehicleType, …>`) are caught by typecheck in step 4.
   - A field of `Ride` → the `RIDE` projection in `apps/api/src/rides/rides.repository.ts`. It
     feeds REST and the `ride:updated` outbox payload, which no Zod schema checks on the way out.
   Check: the grep finds no CHECK or status list without the new value (or with the removed one).
4. **Consumers.** api (`dto/`, services, `domain/` records keyed by the enum), `tools/simulator/src`,
   `apps/mobile` (`grep -rn "<schemaName>\|<TypeName>" apps/mobile --exclude-dir=node_modules`), and
   test fixtures with literal bodies. Check: `pnpm typecheck` from the root is green (all workspaces;
   `--filter @lern/api` alone skips simulator and mobile).
5. **Tests.** Each new value or field goes through the real path once: an integration test that sends
   it and reads it back (REST body; the socket payload too when the step 3 projection changed), plus the unit test
   for any domain rule it changes. Check: the test fails with the step 3 migration or projection
   change reverted.

## Verify
From the root: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
(`migrations.int-spec.ts` runs every migration up, down and up). The reply states the class from step 1.

## Common mistakes
- Treating "add an enum value" as additive → it breaks every old reader of responses that carry it.
- Editing the original `CREATE TABLE` migration's CHECK → a new migration instead.
- Testing only `--filter @lern/api` → the simulator and mobile compile against the change too.
- Changing `rideSchema` but not the `RIDE` projection → REST 500s (serializer) while the socket
  payload silently lacks the field.

## Sources
See [references.md](references.md). Zod 4.6.7 parse behaviour and the grep targets were run on
2026-10-29 at commit 7755127. Scenarios: [tests/scenarios.md](tests/scenarios.md).
