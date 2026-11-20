-- 0007_exact_session_match.sql — exact per-session semantic search (roadmap
-- M5, quality.md §4 FILT-1).
--
-- Problem: the 0001 match_chunks body orders the JOIN by
-- `embedding <=> query` with the session predicate in the same WHERE clause.
-- When the planner serves that ORDER BY from the HNSW index, the index
-- returns the globally nearest ~ef_search rows and the owner_session filter
-- runs afterwards, so a session's own best chunks can be missing (measured on
-- 1,000 seeded sessions: 0.8–1.6 % completeness on the forced HNSW path,
-- evals/runs/m5-filt1/). Whether the planner picks that path depends on
-- statistics, so completeness was an accident of the plan, not a guarantee.
--
-- Fix: session scope first. The session's chunks are selected in a
-- MATERIALIZED CTE (an optimization fence the HNSW index cannot see through),
-- then ranked exactly by cosine distance. This is version-independent — it
-- does not rely on pgvector >= 0.8 iterative scans. A session holds a handful
-- of documents, so the exact scan is small.
--
-- Fail closed: filter_session is now mandatory. A NULL scope raises instead of
-- searching every owner (the app seam already rejects unscoped calls; this is
-- the same rule at the database). Signature, return type, SECURITY INVOKER
-- (RLS still applies) and the authenticated EXECUTE grant are unchanged.
-- Ordering adds chunk_id ASC as the deterministic tie-break the adapter uses.
--
-- Expand-only: no table, column or index changes; the HNSW index stays for
-- any future cross-session use and costs nothing here.
-- Procedure (up):   psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f db/migrations/0007_exact_session_match.sql
-- Procedure (down): psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f db/migrations/0007_exact_session_match.down.sql

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
LANGUAGE plpgsql STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF filter_session IS NULL OR btrim(filter_session) = '' THEN
    RAISE EXCEPTION 'match_chunks: filter_session is required'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH scoped AS MATERIALIZED (
    SELECT
      c.chunk_id,
      c.document_id,
      c.page_number,
      c.text,
      c.embedding <=> query_embedding AS distance
    FROM documents d
    JOIN chunks c ON c.document_id = d.id
    WHERE d.owner_session = filter_session
      AND (filter_document_id IS NULL OR d.id = filter_document_id)
      AND c.embedding IS NOT NULL
  )
  SELECT
    s.chunk_id,
    s.document_id,
    s.page_number,
    s.text AS quote,
    1 - s.distance AS score
  FROM scoped s
  ORDER BY s.distance, s.chunk_id
  LIMIT match_count;
END;
$$;

INSERT INTO schema_migrations (version)
  VALUES ('0007_exact_session_match')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
