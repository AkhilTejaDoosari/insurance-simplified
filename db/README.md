# P2 persistence DB (todo 56)

Supabase Postgres + pgvector backing for the additive persistence adapters
(`app/lib/rag/postgres-vector.ts`, `app/lib/rag/postgres-fts.ts`). The
in-memory cosine index stays the default runtime — this database is opt-in
persistence, never on the request path unless explicitly constructed.

## Env contract

| Variable               | Required for | Notes                                                        |
| ---------------------- | ------------ | ------------------------------------------------------------ |
| `SUPABASE_URL`         | DB access    | Project URL, e.g. `https://xyzcompany.supabase.co`.          |
| `SUPABASE_SECRET_KEY`  | DB access    | **Secret key, server-side only.** Never `NEXT_PUBLIC_`, never committed, never logged. Legacy fallback `SUPABASE_SERVICE_KEY` is also accepted. |
| `SUPABASE_DB_URL`      | Migrations   | Direct Postgres connection string for `psql` (migration only). |

Rules:

- Adapters resolve credentials **lazily at call time**; importing them never
  throws when credentials are absent.
- Without `SUPABASE_URL` / `SUPABASE_SECRET_KEY`, persistence methods throw
  `PostgresUnconfiguredError`, integration tests **SKIP** (never fake-green),
  and the eval FTS leg prints `SKIP` (never fake zeros).
- No `RLS` bypass claims: row-level security is enforced by
  `migrations/0003_rls.sql` (defense-in-depth on `auth.uid()`; proven by
  `tests/integration/rls-isolation.test.ts`). The `SECRET_KEY` stays a
  full-access server secret — do not expose it to the browser.

## Migration procedure

```sh
# 1. Enable pgvector first: Supabase dashboard > Database > Extensions > vector.
# 2. Apply in order (each idempotent — safe to re-run):
psql "$SUPABASE_DB_URL" -f db/migrations/0001_init.sql
psql "$SUPABASE_DB_URL" -f db/migrations/0002_object_key.sql
psql "$SUPABASE_DB_URL" -f db/migrations/0003_rls.sql
# 3. Verify:
psql "$SUPABASE_DB_URL" -c "SELECT version FROM schema_migrations;"
#    expect three rows: 0001_init, 0002_object_key, 0003_rls
```

`db/schema.sql` is the canonical readable reference; `db/migrations/*.sql`
are what operators run in order. Keep them in sync (same tables/indexes/functions/policies).

## Backup note

Point-in-time recovery (PITR) and scheduled backups live in the Supabase
dashboard per project — see the Supabase docs for the project's plan. The
canonical restore unit here is the `documents` row plus its `pages`/`chunks`
(via `ON DELETE CASCADE`); re-embedding after a restore is unnecessary
because `chunks.embedding` is stored, but any chunk whose `text_hash` no
longer matches its text must be re-embedded (the adapter's hash-skip logic
handles this automatically on next upsert).

## Layout

- `schema.sql` — canonical schema (tables `documents`/`pages`/`chunks`,
  `match_chunks` + `fts_search_chunks` RPC helpers).
- `migrations/0001_init.sql` — idempotent base (pgvector guard + same
  DDL + `schema_migrations` bookkeeping).
- `migrations/0002_object_key.sql` — additive `documents.object_key` pointer.
- `migrations/0003_rls.sql` — additive `documents.owner_user_id` + RLS
  policies/grants (defense-in-depth; app seam scoping unchanged).
