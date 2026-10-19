---
name: nest-module
description: Add a NestJS feature module or a new endpoint in apps/api (controller, service, Zod DTOs from packages/contracts, tests first). Use when a milestone task needs a new module (auth, rides, offers, ...) or a new REST endpoint.
---

# NestJS feature module

Layout and boundaries are in CLAUDE.md §2 (API layout, module boundaries). `apps/api/src/auth/` is the
reference module.

1. **Tests first** (red for the right reason, then green):
   - Pure rules → `src/<feature>/domain/*.spec.ts` (unit, no Nest/TypeORM imports).
   - Endpoints, SQL, Redis → `test/<feature>[-<topic>].int-spec.ts`. Use `test/support/actors.ts`:
     `bootApp({ imports, controllers })` boots the real app (add probe routes there), and `signIn(app)`
     returns an actor `{ id, phone, tokens, auth }` through the real OTP flow. Hit it with supertest;
     spy on or override only external edges (e.g. `jest.spyOn(app.get(OtpProvider), 'send')`).
     Never mock Postgres or Redis.
   - Cover: happy path, 401 without a token, a 400 for invalid input that has no side effects,
     the role/verification 403s, and every limit or race the feature has (use
     `Promise.all`/`allSettled` for "exactly N succeed").
   - **IDOR test (every endpoint that touches a resource)**: sign in actors A and B; A creates the
     resource; B tries every route on it (read, update, delete, list) by its id → **404, not 403**
     (don't reveal that it exists), and A's data is unchanged afterwards. Also send `userId`/owner
     fields in B's body and assert they're ignored. Example: `ownership` in `test/drivers.int-spec.ts`.
     In code: load by `id AND owner = caller` in the same query (or the guarded UPDATE's WHERE), never
     load-then-compare.
   - Integration files share one Postgres and Redis: get phone numbers from `uniquePhone(app)`, key
     other data by unique ids, and reset only your own keys (`rl:<feature>:*`), never FLUSHDB.
   - Build a supertest request only after its awaited inputs exist (`const t = await signIn(app)`
     first): an `await` inside `.set(...)` lets another request close the shared server.
2. **Contract**: request/response schemas go in `packages/contracts/src/<name>.schema.ts` and are
   exported from `src/index.ts`. Changing an existing schema → follow `contract-change` (ask first
   if it breaks a consumer).
3. **DTO**: `src/<feature>/dto/<verb>-<name>.dto.ts` =
   `export class XDto extends createZodDto(xSchema) {}`. The global `ZodValidationPipe` validates
   request DTOs. A response is only checked when the handler has `@ZodSerializerDto(XDto)`; add it to
   any endpoint whose body clients parse.
4. **Code**: controller is thin (parse → service → return); set the status with `@HttpCode`.
   The global `AuthGuard` denies by default: mark open routes `@Public()`, restrict with
   `@Roles('driver')`, and read the caller with `@CurrentUser()` (`src/auth/auth.decorators.ts`).
   Roles only say what *kind* of caller this is; per-resource ownership still needs its own check
   and an IDOR test. The service owns use-cases and transactions. Swappable externals (SMS, push, maps) are an
   `abstract class` used as the DI token, plus a dev implementation. Env-driven choices are validated
   in `shared/config/env.ts`, and anything unsafe for production has no default.
5. **Wire**: import the module in `app.module.ts` (composition only). New env keys go in `env.ts`,
   `env.spec.ts`, `.env.example` and `test/global-setup.ts`.
6. **Limits**: throttle with `consume()` from `shared/redis/rate-limit.ts` (fixed window, atomic).
   Count an attempt before checking it, so parallel requests can't slip past. Return 429 with
   `retryAfter`.
7. **Done**: run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` from the root,
   then `/ponytail-review` plus a correctness/security pass (auth guard, IDOR, transaction
   boundaries, unbounded queries).
