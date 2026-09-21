-- Migration 0003_rls (P3): defense-in-depth row-level security.
--
-- The existing owner_session scoping MUST remain: every app query still binds
-- its opaque session id as the filter_session predicate of match_chunks /
-- fts_search_chunks (app/lib/rag/ownership.ts). RLS is an additional
-- database-side backstop keyed on auth.uid(), never a replacement for the
-- scoped application queries. service_role bypasses RLS by design and keeps
-- serving the server-side scoped flows exactly as before.
--
-- Mapping (smallest correct): documents.owner_user_id UUID REFERENCES
-- auth.users (id) ON DELETE CASCADE, NULLABLE so pre-RLS rows keep working
-- (NULL owner = invisible to authenticated users, still fully visible to
-- service_role). Child tables (pages, chunks) inherit ownership through
-- their parent documents row — every child policy re-checks the parent, so
-- a forgotten parent relationship can never leak a child row.
--
-- RPCs match_chunks / fts_search_chunks are SECURITY INVOKER (verified in
-- pg_proc): RLS applies to the caller's rows, and the filter_session
-- predicate still applies on top. No SECURITY DEFINER bypass exists.
--
-- Additive only: one NULLABLE column, policies, GRANTs. No backfill, no
-- defaults invented, no DROP/TRUNCATE. Safe to re-run (IF NOT EXISTS guards,
-- DROP POLICY IF EXISTS + CREATE, idempotent GRANTs and bookkeeping).
--
-- Procedure: psql "$SUPABASE_DB_URL" -f db/migrations/0003_rls.sql

-- ------------------------------------------------- 0. ownership column
ALTER TABLE IF EXISTS documents
  ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES auth.users (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS documents_owner_user_id_idx
  ON documents (owner_user_id);

-- ------------------------------------------------- 1. enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------- 2. documents policies
DROP POLICY IF EXISTS documents_select_own ON documents;
CREATE POLICY documents_select_own ON documents
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS documents_insert_own ON documents;
CREATE POLICY documents_insert_own ON documents
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS documents_update_own ON documents;
CREATE POLICY documents_update_own ON documents
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS documents_delete_own ON documents;
CREATE POLICY documents_delete_own ON documents
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- ------------------------------------------------- 3. pages policies
DROP POLICY IF EXISTS pages_select_own ON pages;
CREATE POLICY pages_select_own ON pages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pages_insert_own ON pages;
CREATE POLICY pages_insert_own ON pages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pages_update_own ON pages;
CREATE POLICY pages_update_own ON pages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pages_delete_own ON pages;
CREATE POLICY pages_delete_own ON pages
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = pages.document_id AND d.owner_user_id = auth.uid()
    )
  );

-- ------------------------------------------------- 4. chunks policies
DROP POLICY IF EXISTS chunks_select_own ON chunks;
CREATE POLICY chunks_select_own ON chunks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chunks_insert_own ON chunks;
CREATE POLICY chunks_insert_own ON chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chunks_update_own ON chunks;
CREATE POLICY chunks_update_own ON chunks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chunks_delete_own ON chunks;
CREATE POLICY chunks_delete_own ON chunks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.owner_user_id = auth.uid()
    )
  );

-- ------------------------------------------------- 5. grants (additive)
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE pages_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION match_chunks(vector, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fts_search_chunks(text, integer, text, text) TO authenticated;

-- ------------------------------------------------- 6. bookkeeping
INSERT INTO schema_migrations (version)
VALUES ('0003_rls')
ON CONFLICT (version) DO NOTHING;
