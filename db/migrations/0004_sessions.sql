-- Migration 0004_sessions (P4): sessions table for request-scoped persistence.
-- Idempotent: every DDL statement is IF NOT EXISTS / OR REPLACE, so re-running
-- is a no-op. Safe to apply alongside schema_migrations bookkeeping.
--
-- Procedure: psql "$SUPABASE_DB_URL" -f db/migrations/0004_sessions.sql
--
-- ------------------------------------------------- 0. pgvector guard
-- Fail fast with an actionable message when the vector extension is not
-- installed, instead of dying mid-migration on `vector(1024)`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) THEN
    RAISE EXCEPTION
      'migration 0004_sessions: pgvector extension "vector" is not available. '
      'On Supabase: Database > Extensions > enable "vector", then re-run. '
      'Nothing was applied.';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------- 1. sessions
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

-- ------------------------------------------------- 2. RLS (defense-in-depth, mirroring 0003_rls.sql conventions)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_select_own ON sessions;
CREATE POLICY sessions_select_own ON sessions
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS sessions_insert_own ON sessions;
CREATE POLICY sessions_insert_own ON sessions
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS sessions_update_own ON sessions;
CREATE POLICY sessions_update_own ON sessions
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS sessions_delete_own ON sessions;
CREATE POLICY sessions_delete_own ON sessions
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- GRANTs (additive)
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO authenticated;

-- ------------------------------------------------- 3. bookkeeping
-- FK comment: documents.owner_session has a NOT VALID FK intent toward sessions(id),
-- but this is documented only (commented, not applied) to avoid breaking pre-P4 rows.
-- See: db/schema.sql — owner_session remains NULLable, no FK constraint applied.

INSERT INTO schema_migrations (version)
VALUES ('0004_sessions')
ON CONFLICT (version) DO NOTHING;