-- Reverses migration 0008_extraction_jobs: drops the job functions and table.
-- Sessions, documents and saved results are unaffected (jobs only reference sessions).

BEGIN;

DROP FUNCTION IF EXISTS retry_extraction_jobs(TEXT);
DROP FUNCTION IF EXISTS cancel_extraction_jobs(TEXT);
DROP FUNCTION IF EXISTS finish_extraction_job(TEXT, TEXT, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS progress_extraction_job(TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS claim_extraction_job(TEXT, INTEGER);
DROP INDEX IF EXISTS extraction_jobs_claim_idx;
DROP TABLE IF EXISTS extraction_jobs;

DELETE FROM schema_migrations WHERE version = '0008_extraction_jobs';

COMMIT;
