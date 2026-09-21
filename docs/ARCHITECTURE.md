# Architecture (implementation source of truth)

Compare 2–4 insurance PDFs side by side with page-level evidence. Every
comparison row carries SUPPORTED / DOES NOT APPEAR TO FIT / NOT STATED /
CONFLICTED / NEEDS VERIFICATION — never a bare yes/no. Chat answers with
citations or refuses when no evidence exists.

## Runtime shape

Browser (Next.js App Router) → API routes (`app/api/*`) → server libs
(`app/lib/*`). No background workers, no queue: ingestion is synchronous
inside `POST /api/upload` (extract → quality gate → session create, 2–4
PDFs or the whole set fails with 422).

Default state is server-local: session JSON + raw PDFs under
`os.tmpdir()/insurance-simplified-sessions/`, deleted on session close;
saving means downloading an export file. Supabase is opt-in durability,
never on the default request path.

## Data planes

- Supabase Postgres — durable source of truth when configured
  (`documents` / `pages` / `chunks`, `db/schema.sql`, migrations
  `0001_init` → `0002_object_key` → `0003_rls`, all idempotent).
  Reached only via the persistence adapters or cleanup; production
  read paths below do not query it.
- Supabase Storage (`insurance-documents`, private, PDF-only) — original
  PDF bytes, content-addressed (`docs/<aa>/<sha256>.pdf`). Best-effort on
  upload (temp bytes keep existing behavior); reads go through the
  authenticated app document route, never public URLs. Local directory
  store is the fallback.
- pgvector (`chunks.embedding vector(1024)`, HNSW) — derived retrieval
  index, repopulated by hash-diff re-embed; exact search still works
  without the ANN index.

## Ownership (two layers, different enforcers)

- `owner_session` (opaque `sess-…` id): enforced by the application seam
  (`app/lib/rag/ownership.ts` — unscoped calls throw; every DB call binds
  `filter_session`). This is what isolates V1 sessions at runtime.
- `owner_user_id` (UUID → `auth.users`): enforced by the database
  (`0003_rls.sql` policies on documents/pages/chunks, children via parent
  EXISTS). Verified live with real Auth JWTs
  (`tests/integration/rls-isolation.test.ts`).
- V1 has no login and no user JWT in any runtime path, and upload never
  writes `documents` rows — so `owner_user_id` is NULL at runtime and RLS
  is a verified database-boundary capability, not V1 end-user enforcement.
  Do not claim otherwise.

## Trust boundary

`SUPABASE_SECRET_KEY` (legacy fallback `SUPABASE_SERVICE_KEY`) is
server-only, bypasses RLS by design, and serves the opt-in persistence
adapters, storage adapter, and best-effort vector cleanup. `getSession`
scope checks happen before any store access. `/api/health` probes with the
anon key only. No secret ever reaches the browser.

## Retrieval

- Production: lexical line-overlap + semantic (chunk → embed via
  `EMBEDDING_*` endpoint → in-memory cosine), top-5, then deterministic
  answer or fixed refusal. Purely from session pages.
- `match_chunks` (pgvector) and `fts_search_chunks` (FTS): persistence
  legs used by evals/tests/cleanup, SECURITY INVOKER, still
  `filter_session`-bound. FTS is an evaluation candidate, not a
  production path.

## Evidence and deletion

Quotes resolve chunk → document → page → source text; the session evidence
registry binds opaque `&evidence=` IDs to exact quotes (URLs are never
trusted). Session delete removes metadata + temp bytes, then best-effort
object bytes and vectors; DB deletes cascade
(documents → pages/chunks); storage missing-keys are no-ops so deletes stay
retryable.

## Failure behavior

Extraction failures fail the upload set (quality gate: unreadable /
failed / unsupported / implausible-volume, plain-language messages).
Unconfigured LLM/embeddings/Supabase degrade to built-in engines, never to
fake data: persistence throws `*UnconfiguredError` (tests SKIP), FTS
resolves `[]`, unknown stays NULL (no invented defaults).

## Secrets and deployment

Server env only: `LLM_*`, `EMBEDDING_*`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `DATABASE_URL` /
`SUPABASE_DB_URL` (migrations). Not deployed anywhere (see
`docs/DEPLOY.md`); local `npm run dev` / Docker only, plain HTTP behind
the operator's TLS.

## Explicitly NOT in V1

Login/auth UX and end-user RLS enforcement in the running app; queues or
workers; active Langfuse; deployment; FTS in production; public storage
URLs; server-side saved state beyond the export download.
