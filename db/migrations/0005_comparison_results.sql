-- Migration 0005_comparison_results (P2): durable validated comparison result.
-- Additive + reversible. Stores ONLY the validated comparison payload and a
-- document-version fingerprint so /api/export can serve the SAME authoritative
-- result the UI rendered, and can refuse stale/mismatched results.
--
-- Never stores raw session capabilities or secrets: authorization stays on the
-- existing sessions.capability_hash; this table holds no capability material.
--
-- Retention: follows the existing 30-day session lifetime (expires_at). Rows
-- past expiry are ineligible for read/export (fail-closed on load). No
-- automated purge job exists in this repository; physical cleanup of expired
-- rows is an operator concern (sessions rows are soft-deleted, so the
-- ON DELETE CASCADE below does not fire on close).
--
-- Idempotent up; reversible down.
--
-- Procedure (up):   psql "$SUPABASE_DB_URL" -f db/migrations/0005_comparison_results.sql
-- Procedure (down): psql "$SUPABASE_DB_URL" -f db/migrations/0005_comparison_results.down.sql

CREATE TABLE IF NOT EXISTS comparison_results (
  session_id            TEXT        PRIMARY KEY
    REFERENCES sessions (id) ON DELETE CASCADE,
  -- READY when a validated result is present; STALE when superseded/cleared.
  status                TEXT        NOT NULL DEFAULT 'READY'
    CONSTRAINT comparison_results_status_check
    CHECK (status IN ('READY', 'STALE')),
  -- sha256 over ordered document identities (documentId + sha256/pageCount).
  document_fingerprint  TEXT        NOT NULL,
  -- The validated comparison payload (schemaVersion/factListVersion/rows/
  -- presentationGroups/contacts/userContext). No capability/secret material.
  result_json           JSONB       NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 30-day retention boundary, mirroring session lifetime.
  expires_at            TIMESTAMPTZ NOT NULL
);

-- Retention/read guard index.
CREATE INDEX IF NOT EXISTS comparison_results_expires_at_idx
  ON comparison_results (expires_at);

-- RLS: defense-in-depth. No authenticated policies — this table is reachable
-- only via the server (service key) after session-capability authorization.
ALTER TABLE comparison_results ENABLE ROW LEVEL SECURITY;

-- GRANTs: none to authenticated. Server access uses the service role key.

INSERT INTO schema_migrations (version)
VALUES ('0005_comparison_results')
ON CONFLICT (version) DO NOTHING;
