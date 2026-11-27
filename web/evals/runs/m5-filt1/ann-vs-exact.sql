-- FILT-1 companion measurement (roadmap M5): HNSW + session post-filter vs
-- exact per-session search on 1,000 seeded sessions (synthetic vectors only).
-- Run against a LOCAL stack only, inside one transaction that rolls back:
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < evals/runs/m5-filt1/ann-vs-exact.sql
-- Leaves no rows behind (ROLLBACK at the end).
BEGIN;
SELECT setseed(0.42);

INSERT INTO documents (id, owner_session, filename, sha256, status)
SELECT format('filt1sql-s%s-d%s', s, d), format('filt1sql-s%s', s),
       'synthetic.pdf', repeat('0', 64), 'active'
FROM generate_series(0, 999) s, generate_series(0, 1) d;

INSERT INTO chunks (chunk_id, document_id, page_number, chunk_order, text,
                    token_count, char_start, char_end, text_hash, embedding)
SELECT format('filt1sql-s%s-d%s-c%s', s, d, c), format('filt1sql-s%s-d%s', s, d),
       1, c, 'synthetic', 1, 0, 9, repeat('0', 16),
       (SELECT array_agg(random() * 2 - 1) FROM generate_series(1, 1024) WHERE s >= 0 AND d >= 0 AND c >= 0)::vector(1024)
FROM generate_series(0, 999) s, generate_series(0, 1) d, generate_series(0, 4) c;

ANALYZE documents;
ANALYZE chunks;

CREATE TEMP TABLE filt1_queries AS
SELECT t AS target, format('filt1sql-s%s', t * 40 + 7) AS session,
       (SELECT array_agg(random() * 2 - 1) FROM generate_series(1, 1024) WHERE t >= 0)::vector(1024) AS q
FROM generate_series(0, 24) t;

-- Three paths per target session and k:
--   ann      legacy 0001 match_chunks body with the index-ordered (HNSW) scan
--            forced, i.e. what happens whenever the planner picks the index;
--   planner  the same legacy body with the planner's own choice;
--   deployed the match_chunks function currently installed;
--   deployed-forced  the installed function under the same index-forcing
--            settings as `ann` (exactness must not depend on the plan).
CREATE TEMP TABLE filt1_hits (path text, target int, k int, chunk_id text);

DO $$
DECLARE r record; kk int;
BEGIN
  FOREACH kk IN ARRAY ARRAY[5, 10, 40] LOOP
    FOR r IN SELECT * FROM filt1_queries LOOP
      SET LOCAL enable_seqscan = off;
      SET LOCAL enable_bitmapscan = off;
      SET LOCAL enable_sort = off;
      INSERT INTO filt1_hits
      SELECT 'ann', r.target, kk, x.chunk_id FROM (
        SELECT c.chunk_id
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL AND d.owner_session = r.session
        ORDER BY c.embedding <=> r.q
        LIMIT kk) x;
      INSERT INTO filt1_hits
      SELECT 'deployed-forced', r.target, kk, m.chunk_id FROM match_chunks(r.q, kk, NULL, r.session) m;
      RESET enable_seqscan; RESET enable_bitmapscan; RESET enable_sort;
      INSERT INTO filt1_hits
      SELECT 'planner', r.target, kk, x.chunk_id FROM (
        SELECT c.chunk_id
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL AND d.owner_session = r.session
        ORDER BY c.embedding <=> r.q
        LIMIT kk) x;
      INSERT INTO filt1_hits
      SELECT 'deployed', r.target, kk, m.chunk_id FROM match_chunks(r.q, kk, NULL, r.session) m;
    END LOOP;
  END LOOP;
END $$;

-- Truth: brute force per session in a fence the index cannot serve.
CREATE TEMP TABLE filt1_truth AS
SELECT q.target, k.k, x.chunk_id
FROM filt1_queries q CROSS JOIN (VALUES (5), (10), (40)) k(k)
CROSS JOIN LATERAL (
  SELECT s.chunk_id FROM (
    SELECT c.chunk_id, (c.embedding <=> q.q) + 0 AS dist
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE d.owner_session = q.session) s
  ORDER BY s.dist, s.chunk_id LIMIT k.k) x;

SELECT p.path, t.k,
       count(*) AS expected,
       count(h.chunk_id) AS found,
       round(100.0 * count(h.chunk_id) / count(*), 1) AS completeness_pct
FROM filt1_truth t
CROSS JOIN (VALUES ('ann'), ('planner'), ('deployed'), ('deployed-forced')) p(path)
LEFT JOIN filt1_hits h
  ON h.path = p.path AND h.target = t.target AND h.k = t.k AND h.chunk_id = t.chunk_id
GROUP BY p.path, t.k ORDER BY p.path, t.k;

-- Foreign chunks returned by any path (must be 0 everywhere).
SELECT h.path, count(*) AS foreign_rows
FROM filt1_hits h JOIN filt1_queries q ON q.target = h.target
WHERE h.chunk_id NOT LIKE q.session || '-%'
GROUP BY h.path;

ROLLBACK;
