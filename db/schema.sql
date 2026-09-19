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
--   * NO row-level security in this file: RLS is todo 62 (separate). Until
--     then, access is gated by the SERVICE_KEY server-side contract
--     (see db/README.md). Do NOT claim RLS from this schema.
--
-- Apply via db/migrations/0001_init.sql (idempotent), not by hand-editing
-- a live database. No secrets in this file.

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
  filename      TEXT        NOT NULL,
  sha256        TEXT        NOT NULL,
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
