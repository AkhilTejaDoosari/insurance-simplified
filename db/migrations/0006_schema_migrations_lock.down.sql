-- 0006_schema_migrations_lock.down.sql — restore the pre-0006 state exactly.
--
-- Restores: RLS disabled on schema_migrations (its verified 2026-10-22
-- state), the service SELECT policy removed, and the three extra
-- privileges re-granted to anon/authenticated (returning the baseline the
-- audit measured, clearly noted as the unsafe configuration in
-- docs/SECURITY.md §6.1 — re-running UP immediately undoes a down).
--
-- Procedure (up):   psql "$SUPABASE_DB_URL" -f db/migrations/0006_schema_migrations_lock.sql
-- Procedure (down): psql "$SUPABASE_DB_URL" -f db/migrations/0006_schema_migrations_lock.down.sql

BEGIN;

DROP POLICY IF EXISTS schema_migrations_select_service ON schema_migrations;
ALTER TABLE schema_migrations NO ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('documents', 'pages', 'chunks', 'sessions',
                        'comparison_results', 'schema_migrations')
  LOOP
    EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER ON %I TO anon', tbl);
    EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER ON %I TO authenticated', tbl);
  END LOOP;
END $$;

DELETE FROM schema_migrations
  WHERE version = '0006_schema_migrations_lock';

COMMIT;
