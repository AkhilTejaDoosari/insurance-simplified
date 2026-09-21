# Data retention & deletion (P3-FG)

Status: operational notes for this repo. No legal or compliance claims are
made here — this file describes what the code deletes, not what any law
requires. (No GDPR/HIPAA/compliance statements.)

Persistence is opt-in (P2): the default runtime is server-local temporary
sessions plus an in-memory vector index. Postgres/Supabase persistence,
Langfuse tracing, and LLM/embedding endpoints activate only when their
environment variables are set (see `docs/DEPLOY.md`, `db/README.md`).

## 1. User-data inventory (app-owned ACTIVE copies)

| # | Copy | Where it lives | What it holds | Deleted by |
|---|------|----------------|---------------|------------|
| 1 | Session metadata + page text | `$TMPDIR/insurance-simplified-sessions/<sessionId>.json` (`app/lib/session.ts`) | documentId, filename, pageCount, extracted page strings, userContext, evidence registry | `deleteSession()` (whole session) or `deleteSessionDocument()` (one document) |
| 2 | Original PDF bytes | `$TMPDIR/insurance-simplified-sessions/<sessionId>/<documentId>.pdf` (`saveDocumentFile`) | Raw uploaded bytes, served back for page links | Same two functions (bytes file removed alongside the JSON entry) |
| 3 | Chunk cache (derived) | `$TMPDIR/insurance-simplified-chunks/<sessionId>.json` (`app/lib/rag/chunks.ts`) | Cached `TextChunk[]` + content-hash key; pure derivation of copy 1 | `clearCachedSessionChunks()`; also invalidated by `deleteSessionDocument()`; whole-dir removal is via session close |
| 4 | In-memory vectors (derived) | Process memory, `InMemoryCosineIndex` (`app/lib/rag/cosine-index.ts`) | Normalized vectors + quotes per session; `clear()` drops them | `clear()` on session close; per-document removal is NOT supported — clear + re-add survivors (see §3) |
| 5 | Postgres rows (opt-in only) | Supabase tables `documents` / `pages` / `chunks` (`db/schema.sql`) incl. `chunks.embedding` | Same content as copies 1–4, persisted; active only when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set | `PostgresVectorStore.deleteDocument()` (one document) / `deleteSession()` (whole session scope, `ON DELETE CASCADE`) |
| 6 | Traces | In-memory `LocalTraceSink` (`app/lib/observability/trace.ts`); Langfuse forward only when `LANGFUSE_*` keys are set | Sanitized metadata ONLY (ids, pages, scores, latencies, counts, token counts when reported). By construction there are NO fields for raw user text, prompts, document text, or API keys — such fields do not exist on `TraceEvent` | `getTraceSink().clear()` (process-global; not per-session scoped) |
| 7 | External AI providers | Prompts may transit Ollama/LLM endpoints per env config (`LLM_BASE_URL`, `EMBEDDING_BASE_URL`) | Whatever the request carried (prompt text, embedding inputs) | NOT app-owned: governed by the provider/endpoint operator, not deletable from this repo |
| 8 | Provider backups | Supabase PITR / scheduled backups (dashboard per project, see `db/README.md`) | Snapshots of copy 5 | NOT purged by app-level deletes (see honesty paragraph §4) |

Notes:

- There is NO `app/lib/storage/objects.ts` / `LocalFileObjectStore` in this
  repo — copies 1–2 (the session tmpdir) ARE the object store. The deletion
  flow below names the real seams, not a missing abstraction.
- Temp files: upload extraction holds raw bytes in memory (`app/api/upload/route.ts`
  `rawFiles` map, request-scoped) before `saveDocumentFile`; no other temp
  copies exist.
- Logs/traces redaction note: `TraceEvent` is metadata-only by type
  construction; cost fields report `UNKNOWN` / `NOT MEASURED` unless the
  provider reports usage + pricing. The global sink is process-wide — clearing
  it affects all sessions, so it is an admin action, not a per-user delete.

## 2. Deletion flow

Whole session (default path, `DELETE /api/upload?sessionId=`):

1. `deleteSession(sessionId)` removes `<sessionId>.json` + the whole
   `<sessionId>/` bytes directory → copies 1–2 gone.
2. Caller drops derived state: `InMemoryCosineIndex.clear()` (copy 4),
   `clearCachedSessionChunks(sessionId)` (copy 3).
3. If Postgres persistence was used: `PostgresVectorStore.deleteSession(sessionId)`
   deletes `documents` rows for the scope; `pages`/`chunks` follow via
   `ON DELETE CASCADE` → copy 5 gone (subject to §4).
4. Traces (copy 6) are NOT touched by session close — they hold no user text
   by construction; clear the global sink explicitly if needed.

Single document (added P3-FG, `deleteSessionDocument(sessionId, documentId)`):

1. Document entry (metadata + page text) removed from the session JSON.
2. `<sessionId>/<documentId>.pdf` bytes file removed.
3. Evidence-registry entries citing that document removed.
4. Session chunk-cache file invalidated (copy 3 cannot outlive its source).
5. Caller obligations for vectors: `PostgresVectorStore.deleteDocument(documentId)`
   for copy 5; `InMemoryCosineIndex` has no per-document removal — clear +
   re-add survivors or rebuild from canonical (§3).
6. Post-delete proof: `tests/unit/retention.test.ts` ("makes the deleted
   document unreachable") asserts metadata, bytes, and evidence for the
   deleted document are unreachable while survivors stay intact.

Derived-data policy: vectors/chunks MUST NOT outlive their source. Delete
cascades source → derived: removing a document or session always removes (or
invalidates for rebuild) its chunks, vectors, cache entries, and evidence
records. Re-creating derived state is always possible from canonical (§3).

## 3. Canonical vs derived

| Canonical (source of truth) | Derived (rebuildable, never authoritative) |
|-----------------------------|--------------------------------------------|
| Original PDFs (copy 2, or the user's own files) | `TextChunk[]` from `chunkDocument` (copy 3) |
| Relational metadata + evidence state: session JSON documents/pages/evidence (copy 1); Postgres `documents`/`pages` rows when persistence is on (copy 5, non-embedding columns) | Embeddings / vector index: `InMemoryCosineIndex` entries (copy 4), `chunks.embedding` (copy 5) |
| | Search state: FTS `tsvector` (generated by Postgres itself), match rankings |
| | Traces/admin aggregates (copy 6) |

Rebuild procedure (from canonical only):

1. Take canonical pages (session JSON `documents[].pages`, or re-extract
   from the original PDFs).
2. Re-chunk: `chunkDocument(documentId, pages)` — chunk IDs are stable
   content hashes (`chunkIdFor`), so identical text yields identical IDs.
3. Re-embed: compute vectors for the fresh chunks and `add()` them to a new
   `InMemoryCosineIndex` (or `upsertChunks` for Postgres; its `text_hash`
   skip logic reuses stored embeddings whose text is unchanged).
4. Verify: chunk IDs match the pre-wipe set; a fixed query returns the same
   ranked chunk order (retrieval parity).

Scratch test: `tests/unit/retention.test.ts` → "wipe + rebuild yields
identical chunkIds and retrieval parity" (wipes the in-memory index,
rebuilds from canonical fixture pages, asserts identical chunkIds +
identical top-K order). Verdict: **PASS** (2026-09-19, `npx vitest run
tests/unit/retention.test.ts`).

Provider-backup restores are NOT covered by this test: restoring Supabase
from a dashboard backup was not exercised here, so no readiness is claimed
for that path — see §4.

## 4. Backups honesty paragraph

App-level deletes (§2) remove ACTIVE copies listed in §1. Provider backups
may retain deleted data until retention expiry: Supabase point-in-time
recovery snapshots and scheduled backups (dashboard per project) keep
historical copies of the `documents`/`pages`/`chunks` tables outside this
repo's control, and this repo issues no purge against them. A delete here
therefore means "unreachable from the app", not "erased from provider
backups". No purge of provider backups is claimed.
