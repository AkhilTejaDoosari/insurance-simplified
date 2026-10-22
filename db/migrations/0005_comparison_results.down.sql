-- Reverses migration 0005_comparison_results.
-- Drops the durable validated-result table and its retention index.
-- Session rows are unaffected (comparison_results only references them).

DROP INDEX IF EXISTS comparison_results_expires_at_idx;
DROP TABLE IF EXISTS comparison_results;

DELETE FROM schema_migrations
WHERE version = '0005_comparison_results';
