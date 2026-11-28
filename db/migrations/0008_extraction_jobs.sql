-- Migration 0008_extraction_jobs (WP5, owner-approved 2026-11-28): durable background
-- jobs for reading a session's documents with the engine.
--
-- One row per (session, document). Lifecycle:
--   uploaded -> parsing -> extracting -> verifying -> completed | failed | cancelled
-- A worker claims a job with a time-limited lease (claim_extraction_job, FOR UPDATE SKIP
-- LOCKED: two workers never get the same job). Every heartbeat extends the lease. A
-- worker that dies mid-job simply stops renewing it: once the lease has expired the job
-- is claimable again (attempts + 1), until max_attempts, then it is failed. Cancel and
-- retry are idempotent (cancel_extraction_jobs, retry_extraction_jobs).
--
-- Ownership (owner decision 2026-11-28): only the web app reads and writes this table,
-- with the service key, after session-capability authorization or, for the engine
-- worker, through the web app's internal job API (service token). Never PDF bytes or
-- capability material: result_json holds the engine's extraction (facts, printed words).
-- Retention mirrors the 30-day session lifetime (expires_at).
--
-- Idempotent up; reversible down (0008_extraction_jobs.down.sql).
-- Procedure (up):   psql "$SUPABASE_DB_URL" -f db/migrations/0008_extraction_jobs.sql
-- Procedure (down): psql "$SUPABASE_DB_URL" -f db/migrations/0008_extraction_jobs.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS extraction_jobs (
  id                TEXT        PRIMARY KEY,
  session_id        TEXT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  document_id       TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'uploaded'
    CONSTRAINT extraction_jobs_status_check
    CHECK (status IN ('uploaded', 'parsing', 'extracting', 'verifying',
                      'completed', 'failed', 'cancelled')),
  cloud_consent     BOOLEAN     NOT NULL DEFAULT false,
  attempts          INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts      INTEGER     NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  lease_owner       TEXT        NULL,
  lease_expires_at  TIMESTAMPTZ NULL,
  cancel_requested  BOOLEAN     NOT NULL DEFAULT false,
  result_json       JSONB       NULL,
  error_code        TEXT        NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT extraction_jobs_one_per_document UNIQUE (session_id, document_id)
);

CREATE INDEX IF NOT EXISTS extraction_jobs_claim_idx
  ON extraction_jobs (status, lease_expires_at, created_at);

-- RLS: defense-in-depth. No authenticated policies; server access uses the service key.
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;

-- Claim the oldest claimable job: uploaded, or in progress with an expired lease (its
-- worker died). Jobs that already used every attempt are failed instead.
CREATE OR REPLACE FUNCTION claim_extraction_job(p_worker TEXT, p_lease_seconds INTEGER)
RETURNS SETOF extraction_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE extraction_jobs
     SET status = 'failed', error_code = 'too_many_attempts', lease_owner = NULL,
         lease_expires_at = NULL, updated_at = now()
   WHERE status IN ('parsing', 'extracting', 'verifying')
     AND lease_expires_at < now()
     AND attempts >= max_attempts;
  UPDATE extraction_jobs
     SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE cancel_requested
     AND status IN ('parsing', 'extracting', 'verifying')
     AND lease_expires_at < now();
  RETURN QUERY
  UPDATE extraction_jobs j
     SET status = 'parsing',
         attempts = j.attempts + 1,
         lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         error_code = NULL,
         updated_at = now()
   WHERE j.id = (
     SELECT id FROM extraction_jobs
      WHERE expires_at > now()
        AND NOT cancel_requested
        AND attempts < max_attempts
        AND (status = 'uploaded'
             OR (status IN ('parsing', 'extracting', 'verifying') AND lease_expires_at < now()))
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING j.*;
END;
$$;

-- Heartbeat with the stage reached: only the lease holder of a running job may report;
-- the lease is extended. Returns the job (the caller reads cancel_requested), or nothing
-- when the lease was lost (another worker took over, or the job ended).
CREATE OR REPLACE FUNCTION progress_extraction_job(
  p_id TEXT, p_worker TEXT, p_status TEXT, p_lease_seconds INTEGER)
RETURNS SETOF extraction_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_status NOT IN ('parsing', 'extracting', 'verifying') THEN
    RAISE EXCEPTION 'progress_extraction_job: % is not a running state', p_status;
  END IF;
  RETURN QUERY
  UPDATE extraction_jobs
     SET status = p_status,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE id = p_id AND lease_owner = p_worker
     AND status IN ('parsing', 'extracting', 'verifying')
  RETURNING *;
END;
$$;

-- End a job: completed (with its result), failed (with a short code) or cancelled. Only
-- the lease holder of a running job; a second call changes nothing (idempotent).
CREATE OR REPLACE FUNCTION finish_extraction_job(
  p_id TEXT, p_worker TEXT, p_status TEXT, p_result JSONB, p_error TEXT)
RETURNS SETOF extraction_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'finish_extraction_job: % is not a final state', p_status;
  END IF;
  RETURN QUERY
  UPDATE extraction_jobs
     SET status = p_status,
         result_json = CASE WHEN p_status = 'completed' THEN p_result ELSE NULL END,
         error_code = CASE WHEN p_status = 'failed' THEN left(p_error, 64) ELSE NULL END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = now()
   WHERE id = p_id AND lease_owner = p_worker
     AND status IN ('parsing', 'extracting', 'verifying')
  RETURNING *;
END;
$$;

-- Cancel a session's jobs: waiting ones end at once, running ones when their worker next
-- reports (or when its lease expires). Finished jobs are untouched. Idempotent.
CREATE OR REPLACE FUNCTION cancel_extraction_jobs(p_session TEXT)
RETURNS SETOF extraction_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE extraction_jobs
     SET status = 'cancelled', cancel_requested = true, updated_at = now()
   WHERE session_id = p_session AND status = 'uploaded';
  UPDATE extraction_jobs
     SET cancel_requested = true, updated_at = now()
   WHERE session_id = p_session AND status IN ('parsing', 'extracting', 'verifying');
  RETURN QUERY SELECT * FROM extraction_jobs WHERE session_id = p_session ORDER BY created_at, id;
END;
$$;

-- Retry a session's failed or cancelled jobs from the start. Completed and running jobs
-- are untouched. Idempotent.
CREATE OR REPLACE FUNCTION retry_extraction_jobs(p_session TEXT)
RETURNS SETOF extraction_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE extraction_jobs
     SET status = 'uploaded', attempts = 0, cancel_requested = false, result_json = NULL,
         error_code = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE session_id = p_session AND status IN ('failed', 'cancelled');
  RETURN QUERY SELECT * FROM extraction_jobs WHERE session_id = p_session ORDER BY created_at, id;
END;
$$;

-- Server only: no execution by anon or authenticated callers.
REVOKE ALL ON FUNCTION claim_extraction_job(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION progress_extraction_job(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_extraction_job(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_extraction_jobs(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION retry_extraction_jobs(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_extraction_job(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION progress_extraction_job(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION finish_extraction_job(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_extraction_jobs(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION retry_extraction_jobs(TEXT) TO service_role;

INSERT INTO schema_migrations (version)
VALUES ('0008_extraction_jobs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
