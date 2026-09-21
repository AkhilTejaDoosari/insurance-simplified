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
saving means downloading an export file. When Supabase is configured, the
same request path additionally persists durably (fail-closed: the upload
fails explicitly instead of going READY without durability); when it is
not, the server-local path is the whole story.

## Data planes

- Supabase Postgres — durable source of truth when configured
  (`documents` / `pages` / `chunks`, `db/schema.sql`, migrations
  `0001_init` → `0002_object_key` → `0003_rls`, all idempotent).
  Upload writes documents/pages/chunks rows (durable IDs
  `<sessionId>--<documentId>`); chat reads via `match_chunks`; delete
  removes by `owner_session` (cascades to pages/chunks).
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

- Production semantic: persistent pgvector first when configured
  (`match_chunks` scoped by `owner_session`, mapped back to session
  documentIds); persistent errors fall back to the in-memory cosine leg,
  then lexical line-overlap; empty evidence refuses. Unconfigured →
  in-memory semantic → lexical → refusal, as before. FTS stays an
  evaluation candidate, never a production path.

## Evidence and deletion

Quotes resolve chunk → document → page → source text; the session evidence
registry binds opaque `&evidence=` IDs to exact quotes (URLs are never
trusted). Citations are verified against session documents before any
answer is returned. Session delete removes durable vectors/objects first
(identifiers preserved for retry; explicit 503 otherwise), session
metadata last; DB deletes cascade (documents → pages/chunks); storage
missing-keys are no-ops so deletes stay retryable.

## Failure behavior

Extraction failures fail the upload set (quality gate: unreadable /
failed / unsupported / implausible-volume, plain-language messages).
Durable-write failures fail the upload explicitly (503, retryable, session
removed so nothing is READY without durability). Unconfigured
LLM/embeddings/Supabase degrade to built-in engines, never to fake data:
persistence throws `*UnconfiguredError` (tests SKIP), FTS resolves `[]`,
unknown stays NULL (no invented defaults).

## Secrets and deployment

Server env only: `LLM_*`, `EMBEDDING_*`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `DATABASE_URL` /
`SUPABASE_DB_URL` (migrations). Not deployed anywhere (see
`docs/DEPLOY.md`); local `npm run dev` / Docker only, plain HTTP behind
the operator's TLS.

## Explicitly NOT in V1

Login/auth UX and end-user RLS enforcement in the running app; queues or
workers; active Langfuse; deployment; FTS in production; public storage
URLs; any saved state beyond the session (local temp, or the durable
Supabase rows/objects when configured) plus the export download.
