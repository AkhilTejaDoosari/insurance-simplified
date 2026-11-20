FILT-1 (docs/quality.md §4, roadmap M5) — 1,000 seeded sessions, synthetic
deterministic vectors (1024 dims), no provider calls, no document text.
Local stack: Supabase CLI, PostgreSQL 17.11, pgvector 0.8.2, HNSW index
chunks_embedding_hnsw_idx (default ef_search 40, iterative scan off).

1. Adapter test (asserting): tests/integration/m5-filt1.test.ts
   1,000 sessions x 2 documents x 5 chunks = 10,000 chunks; 25 target
   sessions; k = 5, 10, 40 through PostgresVectorStore.queryTopK ->
   match_chunks. Asserts the exact per-session top-k (ids + scores, ranked)
   and zero foreign chunks.
     after 0007:  k=5 125/125, k=10 250/250, k=40 250/250, foreign=0, PASS
                  p50 1.4-3.2 ms, p95 2.4-5.4 ms per query
     before 0007: also 125/125 and 250/250 — the planner chose the
                  owner_session index (filter first) on this seed, so the
                  legacy body was complete by plan choice, not by construction.

2. Path comparison (measurement): ann-vs-exact.sql, run in one transaction
   that rolls back. "ann" = legacy 0001 body with the HNSW index-ordered scan
   forced; "deployed-forced" = installed match_chunks under the same forcing.
   See sql-before-0007.txt / sql-after-0007.txt.
     ann (legacy, HNSW path)        k=5 0.8 %   k=10 0.4 %   k=40 0.4 %
                                    (0.4-2.4 % across runs; HNSW build is
                                    randomized)
     legacy match_chunks, forced    k=5 0.8 %   k=10 0.4 %   k=40 0.4 %
     0007 match_chunks, forced      100 % at every k
     planner choice (both bodies)   100 % at every k
     foreign rows on any path       0

Gap: up to 99.6 % of a session's true top-k is missed whenever the planner
serves the legacy query from the HNSW index; 0007 removes the dependence on
the plan (MATERIALIZED session-scoped CTE, exact cosine order, NULL scope
raises). Not dependent on pgvector >= 0.8 iterative scan.

Reproduce:
  E2E_SUPABASE_WORKDIR=<dir> scripts/e2e-local-supabase.sh
  set -a; . <dir>/e2e.env; set +a
  npx vitest run tests/integration/m5-filt1.test.ts
  docker exec -i supabase_db_<project_id> psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < evals/runs/m5-filt1/ann-vs-exact.sql
  E2E_SUPABASE_WORKDIR=<dir> scripts/e2e-local-supabase.sh stop
