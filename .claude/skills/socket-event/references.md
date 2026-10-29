# References for socket-event

- `to([])` emits to every socket, `to('<empty room>')` to none — ran 2026-10-29, socket.io 4.8.3 (server `to([]).emit` + `to('room-nobody').emit`, one connected client received 1 event)
- Outbox writer pattern, recipients `array_remove(...)`, payload = REST projection — `apps/api/src/rides/rides.repository.ts` `OUTBOX` (commit 7755127)
- `outbox_events.recipients CHECK (cardinality(recipients) > 0)` — `apps/api/src/shared/database/migrations/1792629104815-create-outbox-events.ts`
- Dispatcher, `kick()`, `canFanOut()` gate, at-least-once — `apps/api/src/outbox/outbox.service.ts`, PLAN-notes "Outbox table + dispatcher" (private)
- Direct emit + `consume()` throttle + Redis failure = not shared — `apps/api/src/location/location.service.ts`, `apps/api/src/shared/redis/rate-limit.ts`
- Gateways skip global guards/pipes; feature gateways share the server; feature imports `RealtimeModule` — `apps/api/src/realtime/realtime.gateway.ts` header comment, PLAN.md §9 (private)
- Sentinel absence proof (outbox and direct) — `apps/api/test/outbox.int-spec.ts` `sentinel`, `apps/api/test/location.int-spec.ts` L402–410
- No driver endpoint lists searching rides (so "drivers can poll" is false) — `grep -rn "@Get" apps/api/src/rides` → only `active-ride` and `:id` (participants), ran 2026-10-29
- Zod 4.6.7 `safeParse` rejects a payload with an unknown enum value or a missing required key — ran 2026-10-29
- Baseline failures — tests/scenarios.md S1 (2026-10-29)
