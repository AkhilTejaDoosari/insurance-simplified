-- Migration 0002_object_key (P3-A): durable object-storage pointer on documents.
-- Additive only: one NULLABLE column, no backfill, no defaults invented.
--
-- `object_key` holds the stable content-addressed key from
-- app/lib/storage/objects.ts objectKeyFor(sha256) (`docs/<aa>/<sha256>.pdf`).
-- NULL means "bytes live only in session-temp" (pre-P3-A rows, unknown stays
-- unknown). The DB row stays authoritative for metadata (object_key + sha256);
-- the bytes themselves live in the object store (local durable dir by default,
-- private Supabase Storage bucket when configured — never a public bucket).
-- Safe to re-run (IF NOT EXISTS guard + bookkeeping upsert).
--
-- Procedure: psql "$SUPABASE_DB_URL" -f db/migrations/0002_object_key.sql

ALTER TABLE IF EXISTS documents
  ADD COLUMN IF NOT EXISTS object_key TEXT NULL;

INSERT INTO schema_migrations (version)
VALUES ('0002_object_key')
ON CONFLICT (version) DO NOTHING;
