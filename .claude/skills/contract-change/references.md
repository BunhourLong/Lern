# References for contract-change

- Zod 4.6.7: `z.object` strips unknown keys; an old `z.enum` rejects a new value; a missing required (even `.nullable()`) key is rejected — ran 2026-10-29 (`old.parse({v:'moto',extra:1})` → `{v:'moto'}`; `safeParse({v:'ev_moto'})` → false; missing nullable key → false)
- nestjs-zod 5.5.0: a response failing `@ZodSerializerDto` throws `ZodSerializationException extends InternalServerErrorException` (500) — `node_modules/nestjs-zod/dist/index.cjs`, read 2026-10-29
- Enum values mirrored in DB CHECKs: `vehicle_type` in create-drivers/quotes/rides, `status` in create-rides, `cancel_reason`, `verification`, `role`, `currency` — `grep -rn "CHECK (" apps/api/src/shared/database/migrations`, ran 2026-10-29
- `RIDE` projection feeds REST and the `ride:updated` outbox payload — `apps/api/src/rides/rides.repository.ts` (commit 7755127)
- Root scripts run every workspace (`pnpm -r`) — `package.json`
- Mobile resolves contracts from source (`react-native` export condition) — `packages/contracts/package.json`
- Simulator parses REST responses with contract schemas, socket events only by type assertion — `tools/simulator/src/api.client.ts`, `sim-rider.ts` L35–36
- `migrations.int-spec.ts` runs every migration up, down, up — `apps/api/test/migrations.int-spec.ts` L19
- Contract break = ask first — CLAUDE.md §5 (private)
- Baseline failure (enum widening shipped unflagged) — tests/scenarios.md S1 (2026-10-29)
