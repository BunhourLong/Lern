---
name: typeorm-migration
description: Add or change a database migration in apps/api (TypeORM + PostGIS). Use whenever the schema changes, an entity is added/altered, or the user says "migration".
---

# TypeORM migration

Rules: `synchronize: false` always. Never edit a migration that has been committed/applied; write a new one.

1. **Write the migration**
   - Entity change: `pnpm --filter @lern/api migration:generate src/shared/database/migrations/<kebab-name>`
     (builds, diffs entities against the dev DB — run `pnpm infra:up` and `migration:run` first).
   - Anything else (extensions, partial indexes, triggers): hand-write
     `apps/api/src/shared/database/migrations/<Date.now()>-<kebab-name>.ts` exporting `class <Pascal><timestamp>`.
2. **Register it**: add the class to the `migrations` array in `apps/api/src/shared/database/database.ts`
   (listed, not globbed, so tests and the CLI load the same set). Generated files are not registered automatically.
3. **Review the SQL by hand**: every `up` has a matching `down` in reverse order; no data loss
   you didn't intend; indexes the plan needs (partial uniques, GiST) are there; parameters only, no
   string-built user input.
4. **Test**: `pnpm --filter @lern/api test:integration`. `test/migrations.int-spec.ts` runs all
   migrations up → down → up on a fresh DB; extend its assertions when a migration adds something an
   invariant depends on (e.g. a partial unique index).
5. **Apply to dev**: `pnpm --filter @lern/api migration:run` (revert: `migration:revert`).
6. Refresh the graph's schema view: `graphify extract --postgres "<dev DATABASE_URL from apps/api/.env>"`
   (local dev DB only; never paste the URL into committed files).
