# DB Backup & Recovery

## Overview

sugara uses Supabase PostgreSQL (v17). Supabase provides automatic daily backups on all paid plans.

- **Project ref**: `pisatmfezdsihrrpzbeh`
- **Region**: Check Supabase Dashboard > Settings > General
- **Connection**: Transaction Pooler (:6543) for app, Direct Connection (:5432) for migrations

## Automatic Backups (Supabase)

Supabase Pro plan includes:
- Daily backups with 7-day retention
- Point-in-Time Recovery (PITR) available on Team/Enterprise plans
- Backups are accessible from Supabase Dashboard > Settings > Backups

## Manual Backup

### Full dump

```bash
# Direct connection URL (not pooler)
pg_dump "postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres" \
  --no-owner --no-acl --clean --if-exists \
  -f backup_$(date +%Y%m%d).sql
```

### Schema only

```bash
pg_dump "postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres" \
  --no-owner --no-acl --schema-only \
  -f schema_$(date +%Y%m%d).sql
```

### Data only

```bash
pg_dump "postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres" \
  --no-owner --no-acl --data-only \
  -f data_$(date +%Y%m%d).sql
```

## Recovery Procedures

### Scenario 1: Restore from Supabase backup

1. Go to Supabase Dashboard > Settings > Backups
2. Select the backup to restore
3. Click "Restore" — this replaces the entire database
4. After restore, verify the app works

### Scenario 2: Restore from manual dump

```bash
# 1. Connect to the database directly
psql "postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres" \
  -f backup_YYYYMMDD.sql
```

### Scenario 3: Rebuild from scratch (migration-based)

If backups are unavailable, the database can be rebuilt from migrations. Data will be lost.

```bash
# 1. Run all migrations
MIGRATION_URL="postgresql://..." bun run db:migrate

# 2. Seed essential data
bun run db:seed-faqs

# 3. Create admin user
SEED_USER_EMAIL="..." SEED_USER_PASSWORD="..." SEED_USER_NAME="..." bun run db:seed-user
```

### Scenario 4: Fix a broken migration

If a migration fails partially on production:

1. Check Supabase Dashboard > SQL Editor to see current state
2. Check `drizzle.__drizzle_migrations` table for applied migrations
3. Manually fix the database state or roll back
4. Never use `db:push` — it breaks migration tracking

## Migration Safety

- Always use `bun run db:generate` then `bun run db:migrate`
- Use `MIGRATION_URL` with Direct Connection (:5432), never Transaction Pooler (:6543)
- Vercel build command runs migrations automatically (`apps/web/vercel.json`)
- Test migrations locally before deploying: `supabase db reset && bun run db:migrate`

## Orphaned Cover Images

Cover images live in the public Storage bucket `trip-covers`, outside the database, so deleting a user or trip row does not remove them by itself. The API deletes them right after the DB delete succeeds (account deletion, expired-guest cleanup, poll-driven trip deletion). That Storage step is best-effort: a failure is logged and leaves unreferenced objects behind. Objects left by deletions that predate this cleanup are in the same state.

`db:cleanup-orphan-covers` lists every object in the bucket, compares it with `trips.cover_image_url`, and reports (or deletes) objects no trip references.

```bash
# 1. Dry-run (default): prints orphan paths and a count, deletes nothing
bun run db:cleanup-orphan-covers

# 2. Review the paths, then delete
bun run db:cleanup-orphan-covers --apply
```

Required environment: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Safety rules:

- Environment check: the script extracts the Supabase project ref from `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` and aborts, even in dry-run, if they differ or if only one side is local (`127.0.0.1` / `localhost`). Recognised forms: API `https://<ref>.supabase.co`; database direct host `db.<ref>.supabase.co` or pooler user `postgres.<ref>` on `*.pooler.supabase.com`. If a ref cannot be extracted (custom domain, other host), dry-run runs with a warning and `--apply` is refused.
- Ratio guard: with `--apply`, the script refuses to delete when more than 50% of the eligible objects (those older than one hour) would be deleted, or when no trip references any cover image while the bucket has candidates. Both usually mean the wrong database or a failed query. `--apply --force` bypasses these two guards; use it only after reviewing the dry-run output and confirming the volume is intended. `--force` without `--apply` does nothing.
- Objects created within the last hour are never reported, so an upload that has not yet been saved to its trip is safe. Objects without a creation time are also skipped.
- Always run the dry-run first and check that the count is plausible. Deleted objects cannot be recovered.
- After restoring the database from a backup, run only the dry-run until you have confirmed the restored `trips` rows match what is in Storage.

## Important Notes

- Supabase free plan: no automatic backups. Manual dumps recommended.
- Supabase Pro plan: daily backups with 7-day retention.
- Transaction Pooler (:6543) does not support advisory locks — DDL may silently fail.
- RLS is enabled on every table in `schema.ts` (enforced by `apps/api/src/__tests__/schema-rls.test.ts`) with no policies, so the anon key is denied by default. The app connects as the `postgres` role, which bypasses RLS. Backup/restore preserves the RLS flag.
- Storage (`storage.objects`) policies are not part of the Drizzle migrations. They live in `supabase/migrations/` and must be applied manually (see `docs/development/release-flow.md`).
- Better Auth tables are included in the schema — they are managed by Drizzle migrations, not by Better Auth itself.
