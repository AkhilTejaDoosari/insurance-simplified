-- Migration 0001_init (todo 56): idempotent init for the P2 persistence schema.
-- Mirrors db/schema.sql statement-for-statement; schema.sql stays the
-- canonical readable reference, this file is what operators actually run.
--
-- Safe to re-run: every DDL statement is IF NOT EXISTS / OR REPLACE, so
-- re-applying is a no-op (verify with: schema_migrations should contain
-- exactly one '0001_init' row afterwards).
--
-- Procedure: psql "$SUPABASE_DB_URL" -f db/migrations/0001_init.sql
-- (see db/README.md for the full env contract + backup note).
-- No secrets in this file. No RLS here (todo 62 is separate).

-- ------------------------------------------------- 0. pgvector guard
-- Fail fast with an actionable message when the vector extension is not
-- installed, instead of dying mid-migration on `vector(1024)`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) THEN
    RAISE EXCEPTION
      'migration 0001_init: pgvector extension "vector" is not available. '
      'On Supabase: Database > Extensions > enable "vector", then re-run. '
      'Nothing was applied.';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------- 1. documents
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

-- ------------------------------------------------- 2. pages
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

-- ------------------------------------------------- 3. chunks
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
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------- 4. helper functions
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

-- ------------------------------------------------- 5. bookkeeping
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version)
VALUES ('0001_init')
ON CONFLICT (version) DO NOTHING;
