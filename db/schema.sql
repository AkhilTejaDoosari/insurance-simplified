-- P2 production persistence schema (todo 56): Supabase Postgres + pgvector.
--
-- Canonical schema for document/page/chunk persistence behind the
-- VectorStore seam (app/lib/rag/embeddings.ts). The in-memory cosine index
-- (app/lib/rag/cosine-index.ts) stays the default runtime; these tables back
-- the additive PostgresVectorStore adapter (app/lib/rag/postgres-vector.ts)
-- and the FTS candidate leg (app/lib/rag/postgres-fts.ts) only.
--
-- Conventions:
--   * Unknown stays unknown: every metadata column that is not always known
--     at upload time is NULLABLE. No invented defaults, no placeholder text.
--   * Chunk IDs are stable content hashes produced by the app
--     (chunkIdFor(doc, page, order, sha16(text)) in app/lib/rag/chunks.ts),
--     never database-generated.
--   * Embeddings are qwen3-embedding:0.6b, 1024 dims (evals/BASELINE.md).
--     Dimension is enforced in the adapter (DimensionError, never coerced),
--     not by silent truncation here.
--   * NO row-level security in this file's original P2 scope: scope gating
--     lives in the app seam (queryTopK / retrieveFtsCandidate require an
--     opaque session scope, always bound as the filter_session predicate
--     below; unscoped calls throw rather than search all owners). RLS is
--     applied separately and additively by db/migrations/0003_rls.sql
--     (defense-in-depth on auth.uid(); service_role keeps serving the
--     server-side scoped flows). See db/README.md.
--
-- Apply via db/migrations/0001_init.sql + 0002_object_key.sql + 0003_rls.sql
-- (each idempotent), not by hand-editing a live database. No secrets here.

-- pgvector provides the vector(1024) type + <=> cosine-distance operator.
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------- documents
-- One row per uploaded PDF. owner_session scopes a document to the session
-- that uploaded it (app/lib/session.ts sessionId); NULL means unscoped
-- (e.g. seeded eval fixtures). Versioning is pointer-based: a superseding
-- upload inserts a new row and sets the old row's superseded_by + status.
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT        PRIMARY KEY,
  owner_session TEXT        NULL,
  -- P3 defense-in-depth owner: Supabase Auth user id. NULL = pre-RLS or
  -- server-seeded rows (invisible to authenticated users, fully visible to
  -- service_role). Set at upload time for signed-in users.
  owner_user_id UUID        NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  filename      TEXT        NOT NULL,
  sha256        TEXT        NOT NULL,
  -- P3-A durable object pointer: stable content-addressed key from
  -- app/lib/storage/objects.ts objectKeyFor(sha256). NULL = bytes live only
  -- in session-temp (pre-P3-A rows). Applied via
  -- db/migrations/0002_object_key.sql (idempotent), not by hand-editing.
  object_key    TEXT        NULL,
  source_type   TEXT        NULL,
  plan_key      TEXT        NULL,
  version_label TEXT        NULL,
  effective_from DATE       NULL,
  effective_to   DATE       NULL,
  authority_rank INTEGER    NULL,
  status        TEXT        NOT NULL DEFAULT 'active',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by TEXT        NULL REFERENCES documents (id)
);

CREATE INDEX IF NOT EXISTS documents_owner_session_idx
  ON documents (owner_session);
CREATE INDEX IF NOT EXISTS documents_owner_user_id_idx
  ON documents (owner_user_id);
CREATE INDEX IF NOT EXISTS documents_plan_key_idx
  ON documents (plan_key);

-- -------------------------------------------------------------------- pages
-- Extracted page text, one row per (document, 1-based page_number).
-- text_hash = sha16(normalizeChunkText(page text)): lets the adapter detect
-- re-uploads/changed pages without re-reading bytes.
CREATE TABLE IF NOT EXISTS pages (
  id          BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  text        TEXT NOT NULL,
  text_hash   TEXT NOT NULL,
  UNIQUE (document_id, page_number)
);

CREATE INDEX IF NOT EXISTS pages_document_id_idx
  ON pages (document_id);

-- ------------------------------------------------------------------- chunks
-- Page-preserving chunks (app/lib/rag/chunks.ts). chunk_id is the stable
-- app-computed hash; embedding is NULL until embedded; fts is a generated
-- tsvector kept in sync by Postgres itself (no app trigger code to drift).
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id    TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  chunk_order INTEGER NOT NULL CHECK (chunk_order >= 0),
  text        TEXT NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count >= 0),
  char_start  INTEGER NOT NULL CHECK (char_start >= 0),
  char_end    INTEGER NOT NULL CHECK (char_end > char_start),
  section     TEXT NULL,
  text_hash   TEXT NOT NULL,
  embedding   vector(1024) NULL,
  fts         tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  UNIQUE (document_id, page_number, chunk_order)
);

CREATE INDEX IF NOT EXISTS chunks_document_page_idx
  ON chunks (document_id, page_number);
CREATE INDEX IF NOT EXISTS chunks_fts_idx
  ON chunks USING GIN (fts);

-- Cosine-similarity ANN index. HNSW needs pgvector >= 0.7; fall back to
-- IVFFLAT is a DBA decision at provision time — either way this statement
-- is safe to re-run (IF NOT EXISTS) and safe to skip on small corpora
-- (exact search via <=> still works, just slower).
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------- 5. sessions (P4)
-- Request-scoped persistence sessions. Idempotent: every statement is
-- IF NOT EXISTS / OR REPLACE. owner_user_id FK to auth.users is NULLABLE
-- so pre-P4 rows stay visible to service_role. RLS policies below enforce
-- authenticated-scoped ownership; service_role bypasses RLS by design.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT        PRIMARY KEY,
  status        TEXT        NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT sessions_status_check
    CHECK (status IN ('DRAFT', 'PROCESSING', 'READY', 'PARTIAL', 'FAILED', 'DELETING', 'DELETED')),
  context_json  JSONB       NOT NULL DEFAULT '{}',
  capability_hash TEXT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ NULL,
  owner_user_id UUID        NULL REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_status_idx
  ON sessions (status);

-- ------------------------------------------------------- retrieval helpers
-- Cosine match over chunk embeddings with optional document / session
-- scoping. Score is cosine similarity (1 = identical direction). Ordering
-- here is score-only; the adapter applies the deterministic tie-break
-- (score DESC, chunkId ASC) client-side so DB and in-memory legs agree.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_count INTEGER DEFAULT 10,
  filter_document_id TEXT DEFAULT NULL,
  filter_session TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  document_id TEXT,
  page_number INTEGER,
  quote TEXT,
  score DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.chunk_id,
    c.document_id,
    c.page_number,
    c.text AS quote,
    1 - (c.embedding <=> query_embedding) AS score
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND (filter_document_id IS NULL OR c.document_id = filter_document_id)
    AND (filter_session IS NULL OR d.owner_session = filter_session)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Full-text candidate leg (todo 58, evaluation ONLY): exact-term friendly
-- ranking via websearch_to_tsquery (no app-side tsquery escaping to get
-- wrong) + ts_rank. Targets surface forms the stemmer would otherwise
-- mangle: F-1, OPT, PPO, precertification, amounts, %, plan names, visa
-- codes, dates.
CREATE OR REPLACE FUNCTION fts_search_chunks(
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  filter_document_id TEXT DEFAULT NULL,
  filter_session TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  document_id TEXT,
  page_number INTEGER,
  quote TEXT,
  rank REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.chunk_id,
    c.document_id,
    c.page_number,
    c.text AS quote,
    ts_rank(c.fts, websearch_to_tsquery('english', query_text)) AS rank
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.fts @@ websearch_to_tsquery('english', query_text)
    AND (filter_document_id IS NULL OR c.document_id = filter_document_id)
    AND (filter_session IS NULL OR d.owner_session = filter_session)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

-- ------------------------------------------------------- row-level security
-- P3 defense-in-depth (db/migrations/0003_rls.sql is what operators run;
-- this section keeps the canonical reference in sync). Both RPCs above are
-- SECURITY INVOKER, so these policies apply to the caller; the app seam
-- still binds filter_session on every call. service_role bypasses RLS and
-- keeps serving the server-side scoped flows unchanged.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_select_own ON documents;
CREATE POLICY documents_select_own ON documents
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS documents_insert_own ON documents;
CREATE POLICY documents_insert_own ON documents
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
DROP POLICY IF EXISTS documents_update_own ON documents;
CREATE POLICY documents_update_own ON documents
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
DROP POLICY IF EXISTS documents_delete_own ON documents;
CREATE POLICY documents_delete_own ON documents
  FOR DELETE TO authenticated USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS pages_select_own ON pages;
CREATE POLICY pages_select_own ON pages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS pages_insert_own ON pages;
CREATE POLICY pages_insert_own ON pages
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS pages_update_own ON pages;
CREATE POLICY pages_update_own ON pages
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM documents d
    WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM documents d
    WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS pages_delete_own ON pages;
CREATE POLICY pages_delete_own ON pages
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS chunks_select_own ON chunks;
CREATE POLICY chunks_select_own ON chunks
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS chunks_insert_own ON chunks;
CREATE POLICY chunks_insert_own ON chunks
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS chunks_update_own ON chunks;
CREATE POLICY chunks_update_own ON chunks
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM documents d
    WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM documents d
    WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()));
DROP POLICY IF EXISTS chunks_delete_own ON chunks;
CREATE POLICY chunks_delete_own ON chunks
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE pages_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION match_chunks(vector, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fts_search_chunks(text, integer, text, text) TO authenticated;

-- ------------------------------------------------- comparison_results (P2)
-- Durable validated comparison result (additive; canonical form in
-- db/migrations/0005_comparison_results.sql). Stores ONLY the validated
-- payload + a document-version fingerprint; authorization stays on
-- sessions.capability_hash. Server-only (no authenticated grants).
CREATE TABLE IF NOT EXISTS comparison_results (
  session_id           TEXT        PRIMARY KEY
    REFERENCES sessions (id) ON DELETE CASCADE,
  status               TEXT        NOT NULL DEFAULT 'READY'
    CONSTRAINT comparison_results_status_check
    CHECK (status IN ('READY', 'STALE')),
  document_fingerprint TEXT        NOT NULL,
  result_json          JSONB       NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS comparison_results_expires_at_idx
  ON comparison_results (expires_at);

ALTER TABLE comparison_results ENABLE ROW LEVEL SECURITY;
