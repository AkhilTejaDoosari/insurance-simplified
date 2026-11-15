# Audit Ledger — Insurance Simplified Flagship (C0 → F1)

Tracked artifact (todo 51). The `.omo` plan file itself is never committed
per guardrails; this ledger is the committed record.

## Critical path

C0 → H1 → R0 → R1 → R2 → R3 → R4 → R5 → (R6 → P1 → F1)
H1 = human merge of PR #3 + feat/rag-core cut. First executable todo = C0 todo 1.
Todo numbers are stable IDs (no todo 2 per revision; todo 52 = R0 realbench).

## Phase states

| Phase | Status | Evidence |
|-------|--------|----------|
| C0 real-doc citation proof | DONE | tests/integration/real-pdf-evidence.test.ts (2 passed with REAL_PDFS_DIR) |
| R0 line baseline | DONE | evals/BASELINE.md R0 section; VALIDATION 0.75/0.625 |
| R1 chunk baseline | DONE | evals/BASELINE.md R1 section; 4 chunks, no ranker change |
| R2 BM25 | DONE | Implemented, evaluated, **REVERTED** (no uplift on VALIDATION) |
| R3 embeddings + cosine + degradation | DONE | Local Ollama qwen3-embedding:0.6b; semantic VALIDATION 1.00/0.8438 |
| R4 fusion + survivor | DONE | RRF implemented/evaluated but **NOT selected** (MRR 0.6875 < 0.8438); **semantic-only selected**; reranker **SKIPPED** (headroom 0.0) |
| R5 retrieval-fed generation | DONE | Top-K assembly + budget + short-circuit + verifier; E2E Flow 3 green; citation precision VALIDATION p@5 0.2750 |
| R6 nuanced states | DONE | FR-020 grounding explicit/related/not-found/needs-external; zero-cannibalization PASS (FA delta 0) |
| P1 product polish | DONE | Tabs/compact preserved; verdict semantics green; Path B honest; contact guard test; E2E 3 passed |
| F1 final audit | DONE | Full gate green; TEST first-scored; realbench PASS; docs honest |

## Final retrieval metrics (fixture golden sets)

| Partition | Retriever | recall@5 | recall@10 | mrr@5 | mrr@10 | refusal-acc |
|-----------|-----------|----------|-----------|-------|--------|-------------|
| DEV | lexical | 1.0000 | 1.0000 | 0.8750 | 0.8750 | 0.90 |
| DEV | semantic | 1.0000 | 1.0000 | 0.8750 | 0.8750 | 0.80 |
| DEV | RRF (corr.) | 1.0000 | 1.0000 | 0.7292 | 0.7292 | 0.80 |
| VALIDATION | lexical | 0.7500 | 0.7500 | 0.6250 | 0.6250 | 0.80 |
| VALIDATION | semantic | 1.0000 | 1.0000 | 0.8438 | 0.8438 | 0.80 |
| VALIDATION | RRF (corr.) | 1.0000 | 1.0000 | 0.6875 | 0.6875 | 0.80 |
| TEST (first-scored F1) | lexical line | 0.9375 | 0.9375 | 0.7813 | 0.7813 | 0.90 |

TEST scored for the FIRST time in F1 (todo 49). Never tuned against.

## Real-document benchmark (separate from fixture scores)

`REAL_PDFS_DIR=/Users/akhiltejadoosari/Repositories`, corpus 3 files / 36 pages.
NOT real-world accuracy — line-leg harness on 8 curated questions.

| Metric | Value |
|--------|-------|
| recall@5 | 0.7500 |
| recall@10 | 0.8125 |
| mrr@5 | 0.6500 |
| mrr@10 | 0.6639 |

Real-pdf-evidence suite with DIR: 2 passed. Without DIR: SKIP (never fail).

## Explicit records

- BM25 was implemented, evaluated on frozen VALIDATION, and REVERTED (zero uplift).
- RRF was implemented, evaluated with corrected recall logic, and NOT selected (lost to semantic-only on VALIDATION MRR).
- Reranker was SKIPPED: headroom MRR@10−MRR@5 = 0.0 < 0.10 on the selected retriever.
- Semantic-only was the selected retriever after R4 (VALIDATION MRR@10 0.8438), with lexical-empty refusal gating added in R5 (preserves refusal; E2E Flow 3 green).
- Runtime degradation: semantic → line-overlap lexical → fixed refusal. No whole-document fallback.

## Grounding / faithfulness / refusal

- Citation precision@5 VALIDATION: 0.2750 (low by fixture construction: 1 chunk/page).
- `verifyAnswerClaims`: 6 adversarial unit tests green (hallucinated/unsupported/mixed refused).
- Zero-cannibalization: VALIDATION must-refuse FA 2→2, FR 0→0 (delta 0/0, PASS).
- Refusal text fixed and unchanged throughout.

## Test / build gates (F1)

- Unit + contract + integration: 226 passed, 2 skipped (real-pdf skips without DIR).
- Real-pdf-evidence with DIR: 2 passed.
- E2E (Playwright chromium): 3 passed.
- Build: compiled successfully. TypeScript: clean. Diff-check: clean.

## Resume-safe claims (earned only)

RAG retrieval (line-overlap + embeddings + cosine), BM25 evaluation, RRF
evaluation, Recall@K / MRR measurement, abstention/refusal design, citation
verification + provenance, PDF.js viewer, Next.js/TypeScript, Playwright E2E,
REST API design, session-scoped HITL evidence flow.

## NOT resume-safe (unmeasured — do not claim)

Latency numbers, user counts, scale figures, cost savings, "real-world
accuracy" (fixture scores are NOT real-world accuracy; realbench is 8 curated
questions on 3 local PDFs, reported separately with corpus size).
