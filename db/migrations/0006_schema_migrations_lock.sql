-- 0006_schema_migrations_lock.sql — LOCK AND HARDEN the migration ledger.
--
-- Context and verified findings: docs/SECURITY.md §6.1 and docs/DECISIONS.md
-- D-026. Direct-SQL + PostgREST audit (2026-10-22) confirmed
-- `schema_migrations` is RLS-disabled and readable/updatable/deletable by the
-- anon role through PostgREST, and that anon/authenticated hold excess
-- TRUNCATE/REFERENCES/TRIGGER grants on all public tables.
--
-- This migration:
--   1. enables RLS on schema_migrations with a single service_role SELECT
--      policy (row operations by anon/authenticated then default-deny);
--   2. revokes the unused TRUNCATE, REFERENCES, TRIGGER privileges from
--      anon and authenticated on every public table.
--
-- Compatibility:
--   - The migration runner is `psql "$SUPABASE_DB_URL"` connecting as the
--     table owner (postgres): owners bypass non-FORCED RLS, so this run and
--     future psql migrations keep their effective permissions.
--   - Supabase service_role carries BYPASSRLS, so server-side service-key
--     access is unaffected; the explicit SELECT policy is defense in depth
--     in case the role ever loses BYPASSRLS and keeps PostgREST parity.
--   - No application runtime path queries schema_migrations
--     (grep `app/` + `tests/` verified 2026-10-22; see HUMAN TERMINAL).
--
-- Idempotency: ENABLE RLS / CREATE POLICY with IF NOT EXISTS-style guards.
-- Note: PostgREST never exposes TRUNCATE, so revoking it closes a purely
-- theoretical surface (direct-SQL sessions as anon do not exist on
-- hosted Supabase); REFERENCES/TRIGGER have no REST surface either.
-- Procedure (up):   psql "$SUPABASE_DB_URL" -f db/migrations/0006_schema_migrations_lock.sql
-- Procedure (down): psql "$SUPABASE_DB_URL" -f db/migrations/0006_schema_migrations_lock.down.sql

BEGIN;

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schema_migrations_select_service ON schema_migrations;
CREATE POLICY schema_migrations_select_service ON schema_migrations
  FOR SELECT TO service_role
  USING (true);

DO $$
DECLARE
  tbl text;
BEGIN
  -- Only TRUNCATE/REFERENCES/TRIGGER are revoked; SELECT/INSERT/UPDATE/
  -- DELETE stay so owner-scoped RLS keeps governing the data plane exactly
  -- as verified by the 2026-10-22 audit.
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('documents', 'pages', 'chunks', 'sessions',
                        'comparison_results', 'schema_migrations')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %I FROM anon', tbl);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %I FROM authenticated', tbl);
  END LOOP;
END $$;

INSERT INTO schema_migrations (version)
  VALUES ('0006_schema_migrations_lock')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
