-- Reverses migration 0007_exact_session_match: restores the 0001 match_chunks
-- body (approximate when the planner uses the HNSW index; NULL scope searches
-- every owner). Signature and grants are unchanged by either direction.

BEGIN;

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

DELETE FROM schema_migrations
  WHERE version = '0007_exact_session_match';

COMMIT;
