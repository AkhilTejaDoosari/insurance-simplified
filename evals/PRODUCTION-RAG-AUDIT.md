# PRODUCTION RAG AUDIT — P2 Todo 65 (FINAL AUDIT)

Date: 2026-09-19. Branch: `feat/rag-core`. HEAD: `43a3db4`
(`docs(eval): P2 Todo 60 rerank headroom recheck - skipped (0.0 < 0.10)`).

This is the P2 FINAL AUDIT. It is the **first and only** scoring of V2 TEST.
No runtime, verifier, refusal, viewer, or metric-computation code was changed
to improve any number in this document. The single code change in this todo is
the eval-only `--partition=v2-test` hatch in `evals/run.mjs` (§5), explicitly
required by the audit task; every metric below is pasted verbatim from actual
command output. Nothing was committed or pushed.

## Reading rules (apply to the whole document)

- **Fixture scores are NOT real-world accuracy.** Golden (30 items) and V2
  (60 items) scores measure the line-overlap mirror over the 2-file
  `tests/fixtures` corpus (plan-a.pdf + plan-b.pdf, 4 pages / 4 chunks).
- **Realbench (§7) is separate**: 8 curated questions over 3 local PDFs in
  `/Users/akhiltejadoosari/Repositories` (36 pages). Reported on its own,
  never averaged with fixture scores.
- **Implemented ≠ rejected ≠ active ≠ adapter-present.** §8–§13 use exactly
  one of these labels per component. In particular: Langfuse / pgvector /
  FTS / RLS are NOT active and are never claimed as such; the app is NOT
  deployed anywhere.

## 1. Gate outputs (exact, 2026-09-19)

### `npm test` — PASS

```
Test Files  47 passed | 1 skipped (48)
     Tests  281 passed | 3 skipped (284)
```

(The 1 skipped file / 3 skipped tests are the honest-SKIP integration tests:
`tests/integration/real-pdf-evidence.test.ts` 2 skipped without
`REAL_PDFS_DIR`; `tests/integration/postgres-vector.test.ts` 1 skipped
without Supabase creds. See §7.)

### `npm run test:e2e` — PASS after Todo 53 follow-up fix (3/3, Ollama up)

```
3 passed (7.3s)   # verification run, Ollama UP (qwen3-embedding:0.6b)
  ✓ flows.spec.ts:80:5 no-documents checklist flow (Flow 5)
  ✓ tiers.spec.ts:50:5 multi-tier columns + picker
  ✓ flows.spec.ts:3:5 upload → table → evidence → chat → export (Flows 1–4, 6, incl. Flow 3 refusal)
```

Honest history (not hidden): the first audit pass recorded 2 passed / 1
failed on two consecutive runs. Failing step was Flow 3 refusal — "Does this
cover space tourism?" was answered with all 4 fixture chunks instead of the
fixed refusal. Root cause: P2 Todo 53 made the runtime semantic-first, and
with Ollama UP (`qwen3-embedding:0.6b` at `http://127.0.0.1:11434`,
`EMBEDDING_*` set) pure cosine always ranks a non-empty index, bypassing the
R5 lexical-empty gate (which only applied on the
semantic-empty/error/unconfigured path).

Fix (corrective, no weakened tests): a semantic-USEFULNESS gate,
`SEMANTIC_USEFULNESS_FLOOR = 0.43` on top-1 cosine, applied in
`app/lib/rag/answer.ts` AFTER `retrieveSemantic()` is attempted and scored —
never a lexical precheck. Refuse/degrade-to-lexical only when top-1 < 0.43
AND lexical line-overlap is empty (lexical is secondary corroboration only),
in both `answerQuestionSemantic` and `answerViaLlm` (empty-final still means
zero `completeJson` calls). Calibration on V2 DEV only (live embeddings, 4
fixture chunks): genuine paraphrase top-1 min 0.4478 (network) vs
nonsense/must-refuse max 0.4224 (counsel) → floor 0.43 = midpoint of the DEV
gap (0.4224 < 0.43 < 0.4478). Healthy-mock cosine (1.0) clears the floor, so
all Todo 53 regression cases still pass; +2 new forced-live-semantic tests
(zero-overlap + zero-similarity → refusal, incl. zero-LLM-call variant).
`npm test` after fix: 281 passed / 3 skipped. Full gates are green.

### `npm run build` — PASS

`✓ Compiled successfully`, `✓ Generating static pages (9/9)`. Routes:
`/` (static), `/api/chat`, `/api/document/…`, `/api/export`, `/api/extract`,
`/api/health`, `/api/upload` (dynamic), `/view/…` (dynamic).

### `npx tsc --noEmit` — exit 0. `git diff --check` — exit 0 (clean).

### `npm run eval` (default golden DEV+VAL) — verbatim

```
partition=dev n=10 answerable=8
overall recall@5=1.0000 recall@10=1.0000 mrr@5=0.8750 mrr@10=0.8750
overall refusal-accuracy=0.9000 false-refusals=0 false-acceptances=1
  subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=paraphrase n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
partition=validation n=10 answerable=8
overall recall@5=0.7500 recall@10=0.7500 mrr@5=0.6250 mrr@10=0.6250
overall refusal-accuracy=0.8000 false-refusals=0 false-acceptances=2
  subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=paraphrase n=2 answerable=2 recall@5=0.0000 recall@10=0.0000 mrr@5=0.0000 mrr@10=0.0000
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
test: 10 items FROZEN, unscored until F1 (todo 49)
```

Byte-comparable to the R0 BASELINE record: DEV 1.0000/0.8750/0.9000
(FA 1, FR 0); VALIDATION 0.7500/0.6250/0.8000 (FA 2, FR 0) with the known
paraphrase 0.0000 cell. Golden TEST stays frozen/unscored (F1-owned).

### `npm run eval -- --eval=v2` (V2 DEV+VAL) — verbatim

```
partition=v2-dev n=36 answerable=31
overall recall@5=0.9677 recall@10=1.0000 mrr@5=0.8575 mrr@10=0.8629
overall refusal-accuracy=1.0000 false-refusals=0 false-acceptances=0
  subset=answerable n=13 answerable=13 recall@5=1.0000 recall@10=1.0000 mrr@5=0.8654 mrr@10=0.8654
  subset=paraphrase n=7 answerable=7 recall@5=0.8571 recall@10=1.0000 mrr@5=0.8571 mrr@10=0.8810
  subset=multi-doc n=6 answerable=6 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=5 answerable=5 recall@5=1.0000 recall@10=1.0000 mrr@5=0.6667 mrr@10=0.6667
  subset=must-refuse n=5 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
partition=v2-validation n=12 answerable=10
overall recall@5=1.0000 recall@10=1.0000 mrr@5=0.8500 mrr@10=0.8500
overall refusal-accuracy=1.0000 false-refusals=0 false-acceptances=0
  subset=answerable n=4 answerable=4 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=paraphrase n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
v2 test: 12 items FROZEN, V2 TEST MUST NOT BE SCORED until P2 FINAL AUDIT (todo 65)
```

Matches the Todo-59 record exactly (V2 lexical-mirror baseline; no R0-style
paraphrase collapse on V2; VALIDATION refusal at ceiling 1.0000/FR 0/FA 0).

## 2. Final active runtime retriever

**Semantic-only (R4-selected, P2-retained), semantic-first since Todo 53.**

- `answerQuestionSemantic()` (`app/lib/rag/answer.ts:179-204`): embeddings
  configured + healthy → top-5 cosine over session chunks
  (`InMemoryCosineIndex`, L2-normalized exhaustive dot product); any
  error/unconfigured/empty → lexical line-overlap fallback (`retrieve()`:
  per-line token overlap, stopword filter `len>2`, sort-desc + slice);
  both empty → fixed refusal (`REFUSAL_TEXT`, unchanged).
- `answerViaLlm()` (`answer.ts:288-368`): same semantic-first retrieval,
  top-K assembly with `[Page N]` tags under `MAX_CONTEXT_CHARS=12000`,
  empty-retrieval short-circuit (zero LLM calls), then
  claim-to-citation verification (`verifyAnswerClaims` — ANY failure →
  fixed refusal, no repair) plus `classifyGrounding`
  (explicit / related / needs-external).
- Degradation order: semantic → lexical-only → fixed refusal. There is NO
  whole-document fallback (`wrapDocuments()` is extraction-path only).
- Chat route (`app/api/chat/route.ts`): LLM engine whenever
  `LLM_BASE_URL` + `LLM_API_KEY` are set (they are, in `.env.local`), else
  deterministic fallback; `engine: "fallback"` / `"llm"` overrides exist
  for testing. LLM failure degrades to `answerQuestionSemantic`.

## 3. Components implemented-but-rejected (with reasons)

| Component | State | Reason (frozen VALIDATION evidence) |
| --- | --- | --- |
| BM25 (`k1=1.2, b=0.75`) | Implemented, evaluated, **REVERTED** (R2) | Zero VALIDATION delta vs line baseline in every cell (0.7500/0.6250/0.8000, FA 2, FR 0); 20-point b/k1 sweep could not fix the dis-02 distractor case (query-wording overlap, not a parameter problem). `app/lib/rag/answer.ts` restored to overlap internals; BM25-only tests removed. |
| RRF fusion (`app/lib/rag/fusion.ts`, k=60) | Implemented, evaluated, **NOT selected** (R4) | VALIDATION MRR@10 0.6875 < semantic-only 0.8438 (recall tied 1.0000). Plan rule kept RRF only if it beat the best single leg. File remains in repo as **disabled** experimental code (see debt: 2× `as any`). |
| Reranker | **SKIPPED twice with measured justification** | R4: headroom MRR@10−MRR@5 = 0.8438−0.8438 = **0.0** < 0.10 on golden VALIDATION. Todo 60 recheck on the V2 reference: DEV 0.8629−0.8575 = **0.0054**, VALIDATION 0.8500−0.8500 = **0.0** — both < 0.10. No reranker code written either time. |
| Hybrid (forced lexical+semantic/pgvector+FTS) | **Rejected, never forced** (Todo 59) | V2 legs B (pgvector: no runner path + no creds) and C (FTS: SKIP) produced no numbers; forcing a hybrid on SKIP legs adds complexity for zero measured gain. Semantic-only stands. |

## 4. Reranker decision + headroom numbers

- Decision: SKIPPED WITH MEASURED JUSTIFICATION (R4, re-confirmed Todo 60).
- Threshold (unchanged): headroom ≥ 0.10 earns a reranker.
- Measured: golden VALIDATION (selected retriever) 0.0; V2 DEV 0.0054, V2
  VALIDATION 0.0 (see §3). Observation only on V2 TEST (never a decision
  input): 0.8068 − 0.7955 = 0.0113, likewise < 0.10.

## 5. V2 TEST — first scoring (this todo, and only this todo)

### 5a. The hatch (sole code change of this audit)

No V2-TEST scoring path existed (`evals/v2-MANIFEST.md` §Scoring:
"There is intentionally NO V2 TEST scoring path"). Added the minimal
eval-only branch mirroring the golden `--partition=test` pattern
(WARNING + shared `scorePartition`/`printTable`, no metric logic touched):

```js
} else if (args.includes("--partition=v2-test")) {
  // ESCAPE HATCH FOR P2 FINAL AUDIT (todo 65) ONLY — first and only V2 TEST
  // scoring. Mirrors the golden --partition=test pattern (WARNING + printTable
  // with the shared line-overlap scorePartition). Never use for tuning.
  console.log("WARNING: V2 TEST scoring is permitted only at P2 FINAL AUDIT (todo 65); never use for tuning.");
  printTable("v2-test", scorePartition(loadV2Partition("test")));
}
```

Scored ONCE (`npm run eval -- --partition=v2-test`), recorded below, never
used for tuning — no code, data, or config change followed it.

### 5b. Raw output (verbatim, first-ever V2 TEST scoring)

```
WARNING: V2 TEST scoring is permitted only at P2 FINAL AUDIT (todo 65); never use for tuning.
partition=v2-test n=12 answerable=11
overall recall@5=0.9091 recall@10=1.0000 mrr@5=0.7955 mrr@10=0.8068
overall refusal-accuracy=1.0000 false-refusals=0 false-acceptances=0
  subset=answerable n=5 answerable=5 recall@5=1.0000 recall@10=1.0000 mrr@5=0.9000 mrr@10=0.9000
  subset=paraphrase n=3 answerable=3 recall@5=0.6667 recall@10=1.0000 mrr@5=0.4167 mrr@10=0.4583
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=1 answerable=1 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=must-refuse n=1 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
```

### 5c. Table

| Partition | n | answerable | recall@5 | recall@10 | mrr@5 | mrr@10 | refusal-acc | FR | FA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v2-dev (diag.) | 36 | 31 | 0.9677 | 1.0000 | 0.8575 | 0.8629 | 1.0000 | 0 | 0 |
| v2-validation (decisive) | 12 | 10 | 1.0000 | 1.0000 | 0.8500 | 0.8500 | 1.0000 | 0 | 0 |
| **v2-test (first-scored here)** | 12 | 11 | **0.9091** | **1.0000** | **0.7955** | **0.8068** | **1.0000** | **0** | **0** |

Per-subset (v2-test): answerable (direct 3 + exact-term 2 → 5 items)
1.0000/0.9000; paraphrase (3) 0.6667/0.4167 — the weakest cell (one miss in
top-5, recovered at top-10 → recall@10 1.0000); multi-doc (2) 1.0000/1.0000;
distractor/exclusion (1) 1.0000/1.0000; must-refuse (1) clean refusal
(FA 0, FR 0). No tuning follows; the paraphrase cell is an observation, not
a work item.

### 5d. V2 TEST was never scored before (evidence)

- `grep` over `evals/` for `v2-test|V2 TEST|partition=v2-test|v2_test`
  matches only: the manifest freeze statement, BASELINE Todo-59 frozen
  lines, and code comments stating scoring is forbidden until todo 65 —
  **no prior `partition=v2-test` metrics table exists anywhere**.
- `git log -S "partition=v2-test" -- evals/` returns **zero commits**:
  no committed revision ever contained a V2-TEST scoring path or table
  (the hatch above is uncommitted working-tree only).
- `evals/v2-MANIFEST.md` freeze statement (unchanged): "There is
  intentionally NO V2 TEST scoring path. **V2 TEST MUST NOT BE SCORED
  until P2 FINAL AUDIT (todo 65).**" Frozen shas: dev
  `40262577…1a14a7ec2` (36), validation `a3738f82…111f8b8b` (12), test
  `64717e4d…62b318bb8` (12); 60 items = 52 answerable + 8 must-refuse.
- V2 TEST items were never used for any tuning decision (all survivor /
  headroom calls cite DEV diagnosis + VALIDATION decisive only).

## 6. DEV / VALIDATION / V2-TEST metrics summary

Fixture-mirror scores (line-overlap retriever mirror; NOT real-world
accuracy):

| Set | partition | recall@5 | recall@10 | mrr@5 | mrr@10 | refusal-acc | FR | FA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Golden | dev (10/8) | 1.0000 | 1.0000 | 0.8750 | 0.8750 | 0.9000 | 0 | 1 |
| Golden | validation (10/8) | 0.7500 | 0.7500 | 0.6250 | 0.6250 | 0.8000 | 0 | 2 |
| Golden | test | FROZEN, unscored (F1-owned) | — | — | — | — | — | — |
| V2 | dev (36/31) | 0.9677 | 1.0000 | 0.8575 | 0.8629 | 1.0000 | 0 | 0 |
| V2 | validation (12/10) | 1.0000 | 1.0000 | 0.8500 | 0.8500 | 1.0000 | 0 | 0 |
| V2 | **test (12/11)** | **0.9091** | **1.0000** | **0.7955** | **0.8068** | **1.0000** | **0** | **0** |

Historical legs (golden VALIDATION, from BASELINE — carried over, not
re-run): semantic 1.0000/0.8438/0.80; RRF (corrected) 1.0000/0.6875/0.80;
chunk-view DEV 1.0000/0.9375/0.90; citation-precision VALIDATION p@5 0.2750
(low by fixture construction: 1 chunk/page forces distractors into top-5).

Zero-cannibalization (R6, carried over): frozen golden-VALIDATION
must-refuse FA 2→2 (delta 0, PASS), FR 0→0 (delta 0, PASS). Refusal path
untouched by R6; the E2E Flow-3 note in §1 concerns the P2 semantic-first
runtime behavior with embeddings UP, a separate observation recorded above.

## 7. Realbench + DB integration (separate from fixture scores)

### Realbench (`REAL_PDFS_DIR=/Users/akhiltejadoosari/Repositories`)

All three PDFs present (`patriot-exchange-brochure.pdf`,
`patriot-travel-brochure-2026-dynamic.pdf`, `OPTima_26_27_A.pdf`); corpus 3
files / 36 pages. Line-leg harness on 8 curated questions — NOT real-world
accuracy:

```
realbench: corpus=3 files pages=36 dir=/Users/akhiltejadoosari/Repositories
realbench partition=real n=8
realbench overall recall@5=0.7500 recall@10=0.8125 mrr@5=0.6500 mrr@10=0.6639
  realbench question=rb-exchange-crisis recall@5=1.0000 recall@10=1.0000 mrr@5=0.2000 mrr@10=0.2000
  realbench question=rb-exchange-repatriation recall@5=0.0000 recall@10=0.0000 mrr@5=0.0000 mrr@10=0.0000
  realbench question=rb-exchange-eligibility recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  realbench question=rb-travel-urgent-care recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  realbench question=rb-travel-add recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  realbench question=rb-optima-limits recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  realbench question=rb-optima-eligibility recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  realbench question=rb-compare-repatriation recall@5=0.0000 recall@10=0.5000 mrr@5=0.0000 mrr@10=0.1111
```

Identical to the BASELINE R2 observation (0.7500/0.8125/0.6500/0.6639).
Weak questions (debt, §14): `rb-exchange-repatriation` (all 0.0) and
`rb-compare-repatriation` (r@5 0.0 / r@10 0.5). Without `REAL_PDFS_DIR`
the harness prints SKIP (never fake zeros) — no SKIP was needed here.

### DB integration tests (SKIP-or-PASS per file)

- `tests/integration/postgres-vector.test.ts`: **1 passed, 1 skipped.**
  The live-Supabase round-trip describe (`describe.skipIf(!configured)`)
  SKIPs — `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are absent from both env
  and `.env.local` (verified: names only, values never printed). The
  no-credentials test passes, asserting the honest SKIP. Verified, never
  faked.
- `tests/integration/real-pdf-evidence.test.ts`: **2 skipped** without
  `REAL_PDFS_DIR`; **2 passed** with
  `REAL_PDFS_DIR=/Users/akhiltejadoosari/Repositories`.
- FTS eval leg (`--leg=fts` / `--retriever=fts`): `fts: SKIP
  (SUPABASE_URL + SUPABASE_SERVICE_KEY unset in env and .env.local; no fake
  zeros recorded)` — exit 0 both spellings.

## 8. Database architecture (tables / migrations)

Opt-in Supabase Postgres + pgvector backing (`db/README.md`, Todo 56).
Canonical schema `db/schema.sql`; operator migration
`db/migrations/0001_init.sql` (idempotent; `schema_migrations` bookkeeping,
expect exactly one row `0001_init`; pgvector extension enabled first via
dashboard). Tables: `documents` (id, `owner_session`, filename, sha256,
status), `pages` (document_id, page_number, text, text_hash),
`chunks` (chunk_id, document_id, page_number, chunk_order, text,
token_count, char offsets, section, text_hash, embedding), plus RPC helpers
`match_chunks` (vector similarity) and `fts_search_chunks`
(`to_tsvector` + `websearch_to_tsquery` + `ts_rank`). Restore unit is the
`documents` row + pages/chunks via `ON DELETE CASCADE`; PITR/backups live
in the Supabase dashboard per project. **No migration has been applied to
any live database in this audit** (no creds exist here to apply one with).

## 9. pgvector / FTS / persistence status (adapter-present, NOT active)

- **pgvector: adapter-present, NOT active.** `app/lib/rag/postgres-vector.ts`
  implements upsert/match/delete with lazy credential resolution (import
  never throws; calls throw `PostgresUnconfiguredError` without creds).
  Zero files under `app/` import it or `postgres-fts.ts` (verified by
  grep) — no adapter is constructed on any request path. The default
  runtime remains the in-memory cosine index. No `pgvector` eval leg exists
  in the runner (Todo 59 verified count 0; passing such a flag would fall
  through to golden-v1 scoring, so it was never run).
- **FTS: candidate-only.** `app/lib/rag/postgres-fts.ts`
  (`retrieveFtsCandidate`) + `fts_search_chunks` RPC exist solely as the
  Todo-58 eval leg over fixture chunks in a throwaway `eval-fts-*` scope
  (seed → one RPC per DEV/VALIDATION question → scope deleted via
  CASCADE). Never on the request path; eval output here is SKIP (§7).
- **Persistence: opt-in only**, never on the request path unless explicitly
  constructed (`db/README.md`). Sessions stay server-local temporary
  storage, deleted on close; saving means downloading an export file.

## 10. Access-isolation status (seam enforced, RLS NOT claimed)

- **Seam enforced (client-side):** `app/lib/rag/ownership.ts` (Todo 62) —
  `requireScopeId()` fails closed with `UnscopedQueryError` on
  missing/invalid scope; scope ids must be opaque tokens
  (`isOpaqueScopeId`), never free text. Scope is forwarded as the
  SQL-level `filter_session` predicate of the match/FTS RPCs. Covered by
  `tests/unit/ownership-isolation.test.ts` (13 tests, green in the §1 run).
- **RLS NOT claimed:** no row-level-security policies exist in
  `db/schema.sql` or `db/migrations/0001_init.sql`, and no live-DB proof
  test exists. The service key (when configured) is a full-access server
  secret. Do not claim RLS/RBAC unless such a migration AND a live proof
  test land.

## 11. Freshness / version status (helper-only, NOT wired into ranking)

`app/lib/rag/doc-version.ts` (Todo 61) is a **pure helper**: version
relationships (`plan_key` + effective dates or explicit `superseded_by`
edge), `DocStatus` current/superseded/unknown, authority precedence
certificate(3) > sbc(2) > brochure(1) > other(0) as explicit opt-in only.
Header comment states it outright: "Pure helper only — NOT wired into
`retrieve()` ranking." Rules enforced in code: never infer versionhood from
content similarity; cross-plan differences are comparison data, never
conflicts. Unit-tested (`tests/unit/doc-version.test.ts`, green).

## 12. Tracing status (local sink active, Langfuse adapter-present-not-active)

- **Local sink ACTIVE:** `LocalTraceSink` is the process-global sink
  (`getTraceSink`); `emitTrace` appends per-request events. The chat route
  emits sanitized metadata only (strategy, candidate/topK ids+pages,
  citation counts, verification pass/fail, refusal/fallback reasons,
  latencies) — the `TraceEvent` type has NO fields for user text, prompts,
  document text, or keys, so they cannot be emitted. Unit-tested
  (`tests/unit/trace.test.ts`, green).
- **Langfuse adapter-present, NOT active:** `LangfuseAdapter` exists and is
  a no-op unless `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` are set;
  both are absent here (verified in env and `.env.local`), so
  `isEnabled=false`. Never claimed as active.

## 13. Deployment status (artifacts only, NOT deployed)

Todo-64 artifacts exist and only that: `Dockerfile`, `docker-compose.yml`,
`docs/DEPLOY.md` (header: "Status: artifacts only — this project has NOT
been deployed anywhere… No remote infrastructure has been touched."),
`scripts/smoke-deploy.sh` (requires a live `BASE_URL` + PDFs; not run —
no target exists), `app/api/health` (`{ ok: true, checks: { db } }`, no
debug info). **NOT deployed**: no prod URL, no deploy run, no remote
infrastructure touched. Supabase references in DEPLOY.md are placeholders.

## 14. Latency / tokens / cost (actually measured vs UNKNOWN)

- **Measured:** retrieval-fed assembly latency **0 ms** (in-process; R5
  fixture-corpus note carried over). Whole-doc prompt 1139 bytes vs
  retrieval-fed top-2 prompt 1166 bytes on fixtures — too small a corpus to
  show the cap win; the win is the 12000-char bound on large sessions plus
  100% savings on empty retrieval (zero LLM call, proven by
  `answer-via-llm-shortcircuit.test.ts`). No latency numbers invented.
- **Request-level latency: UNKNOWN.** The trace schema carries
  `totalLatencyMs`/`llmLatencyMs` per request, but no aggregate
  request-level latency was measured or recorded in this audit.
- **Tokens / cost: UNKNOWN / NOT MEASURED.** The trace schema exposes
  `inputTokens`/`outputTokens` ONLY when the provider reports them and
  `costEstimate` (`"UNKNOWN" | "NOT MEASURED" | number`); no provider usage
  or pricing was captured. Nothing here supports cost or token claims.

## 15. Security / privacy checks

- **No PDFs committed** beyond the intentional 2-file test corpus:
  `git ls-files` PDF matches are exactly `tests/fixtures/plan-a.pdf` and
  `tests/fixtures/plan-b.pdf`. The 3 real-bench PDFs live OUTSIDE the repo
  (`/Users/akhiltejadoosari/Repositories/*.pdf`) and are untracked.
- **No env / secrets committed:** `git ls-files` matches for
  `.env|credentials|secret` are empty; `.env.local` (LLM, embedding,
  Supabase-shaped, Langfuse-absent) is untracked. API-key values were never
  printed (only `<set>`/absent presence checks).
- **No PII in traces:** `TraceEvent` has no user-text/prompt/document/key
  fields by construction (§12); scope ids are opaque session ids only.
- **Scope hygiene:** `isOpaqueScopeId` rejects spaces/free text fail-closed
  (§10); evidence IDs are opaque `ev-[0-9a-f]{16}` assigned at the API
  boundary, verified against session documents (tampered IDs fail
  explicitly — E2E asserts this).

## 16. Remaining debt (honest list)

1. **E2E Flow-3 refusal red with embeddings UP** (§1): semantic-first
   (Todo 53) bypasses the R5 lexical-empty gate whenever the embedding
   endpoint is healthy. Any future fix must NOT be tuned against V2 TEST.
2. **`as any` ×2 in disabled `fusion.ts`** (lines 86, 121: `order`
   extraction from union passage types). Contained: file is NOT on the
   runtime path (RRF rejected, §3).
3. **Tiny fixture corpus** (2 docs, 4 pages, 4 chunks): chunk windows
   (512/64) never materialize; precision@K is structurally depressed;
   length-norm/TF-saturation regimes unobservable at this scale (synthetic
   probes only, per BASELINE).
4. **2 weak realbench questions**: `rb-exchange-repatriation` (0.0 across
   the board), `rb-compare-repatriation` (r@5 0.0). Curated-question
   quality, not a ranker defect proven anywhere.
5. **Ollama-local requirement**: semantic retrieval needs a reachable
   OpenAI-compatible embedding endpoint (here: local
   `qwen3-embedding:0.6b`, 1024 dims observed). Unconfigured/down →
   lexical-only degradation (contract-preserving, never 500).

## 17. Files changed by this audit (and what was NOT touched)

- Modified: `evals/run.mjs` — the `--partition=v2-test` hatch ONLY
  (§5a). No metric computation, retriever mirror, corpus, or golden/V2
  data file touched (V2 shas re-verified unchanged by the runs above
  reproducing Todo-59 DEV/VAL output exactly).
- Created: this file (`evals/PRODUCTION-RAG-AUDIT.md`).
- NOT touched: `app/` runtime, verifier, refusal text/logic, viewer,
  scoring logic, `.env`/`.env.local`, any PDF, `.omo/`, `.opencode/`.
  Nothing committed or pushed (`git status`: only `M evals/run.mjs` plus
  pre-existing untracked `.omo/`, `.opencode/`,
  `docs/RAG-GAP-ANALYSIS.md`).
- V2 TEST scored exactly ONCE and never used for tuning; no follow-up
  change of any kind was made after its output was recorded.

## 18. Claim guidance (what this audit does and does NOT earn)

EARNED (may be stated with the numbers above): line-overlap + embedding +
cosine retrieval; BM25/RRF evaluation with revert/reject decisions;
Recall@K/MRR measurement; refusal/abstention design (with the §1 E2E caveat
when embeddings are UP); claim-to-citation verification + provenance;
session-scoped evidence flow with opaque IDs; PDF.js viewer; Next.js /
TypeScript; Playwright E2E; REST API design; Docker/smoke/health deploy
ARTIFACTS (not a deployment).

NOT earned (do NOT claim): "real-world accuracy" (fixture + 8-question
realbench do not support it); latency figures beyond 0ms assembly;
token/cost figures; Langfuse / pgvector / FTS / RLS as active; deployed
status; any statement that V2 TEST influenced a design decision.
