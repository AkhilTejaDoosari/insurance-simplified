# Quality — testing, benchmarks, release criteria

Status: Authoritative · Consolidated 2026-11-15 from `ACCEPTANCE` (gate run),
`RELIABILITY` §13 (SLOs), `DEPLOYMENT` §4, `ENGINEERING_STATE` (evaluation
contract) and the 2026-11-15 feasibility review §§11–12 (all in
`docs/archive/`).

## 1. Evidence levels

Every status claim in `roadmap.md` uses exactly one of these, with evidence:

| Level | Meaning | Evidence required |
| --- | --- | --- |
| Not started | No code | — |
| Partial | Some acceptance criteria met | Which criteria, which files |
| Implemented | Code is in the request path | File paths |
| Tested | Automated tests for the criteria pass | Test files + commit + command output |
| Verified | Acceptance met on **real documents** where the requirement needs it | Evaluation run (dataset, split, metrics vs gate) at a commit |

Design records (ADRs), reference implementations, plans and screenshots are
never evidence of Implemented, Tested or Verified. A skipped test is reported
as SKIPPED, never as a pass. Test assertions are never weakened to get green.

## 2. Test layers and commands

| Layer | Location | Command | Needs |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | `npm test` (Vitest, all layers below except e2e) | — |
| Contract | `tests/contract/` (comparison schema, chat API, verdict enum) | `npm test` | — |
| Integration | `tests/integration/` | `npm test` | Some suites skip without Supabase credentials or `REAL_PDFS_DIR` |
| E2E | `tests/e2e/` (Playwright) | `npm run test:e2e` | Browsers installed |
| Types / build | — | `npx tsc --noEmit`, `npm run build` | — |
| Retrieval eval | `evals/` (`golden-*`, frozen `v2-*` 36/12/12, `realbench`) | `npm run eval` | Embedding endpoint for semantic legs |
| Real-PDF extraction eval | `scripts/p2-experiment/` | `REAL_PDFS_DIR=<local corpus> npm run eval:extraction` | Local licensed PDFs (never committed) |
| Live acceptance | `scripts/acceptance-chat-live.ts`, `scripts/acceptance-pdf-export.ts` | `npx tsx <script>` | Paid LLM — owner approval each run |
| Container | `Dockerfile` | `docker build .` | Docker |

**Default gate for any change:** focused tests → `npm test` →
`npx tsc --noEmit` → `npm run build`; add `npm run test:e2e` when a user flow
changes and `docker build` when runtime/deployment files change.

**Baseline at `15f8cc2` (2026-11-15, this cleanup):** `npm test` 116 files
passed / 3 skipped, 1324 tests passed / 8 skipped; `tsc` clean; build passes.
E2E last recorded 56 passing (2026-11-14).

**Fixtures.** `tests/fixtures/plan-a.pdf` and `plan-b.pdf` are synthetic and
generated (`npm run gen-fixtures`; truth table in `tests/fixtures/README.md`).
Real insurance PDFs are licensed material and live only outside the repository
(`SBCs/`, `nonstandard/`, `data/` are git-ignored; the preserved corpus is a
local directory passed via `REAL_PDFS_DIR`). Never commit PDFs, page text or
document-derived JSON from real documents.

**Real-PDF extraction evaluation contract.** `claim-inventory.ts` records the
actual emissions of a tree (requires the full six-document corpus; exits 2
otherwise) → `claim-diff.ts` compares two inventories (superseded ≠ lost+new)
→ `provision-score.ts` scores against hand-written `gold-provisions.ts`
(concept, value, scope, restrictions, polarity, evidence, presentation).
`completeness-audit.ts` independently checks that attributed rows carry their
full source lines.

## 3. Correctness invariants (zero tolerance, every release)

- Cross-session evidence exposure: 0.
- Displayed invalid citations: 0.
- Supported material claims without verified evidence: 0.
- The four trust-boundary tests (`evidence-core.md` §5) pass in the application.
- Deletion test passes; a log scan finds no document text, quotes or filenames.

## 4. Benchmarks that decide technology

No technology changes without one of these runs on the labelled corpus, using
the same inputs, labels and limits for every option, compared **end-to-end**
(verified cells, S1, chat claims). Dev tunes, validation selects once,
held-out is looked at once.

| ID | Compares | Primary metrics | Decides |
| --- | --- | --- | --- |
| FILT-1 | HNSW + session filter vs exact per-session search, 1,000 seeded sessions | Top-k completeness | Whether the pgvector query changes (cheap, run first) |
| RET-1 | Exact semantic / Postgres FTS / hybrid RRF, each ± reranker (e.g. bge-reranker-v2-m3); top-k 5 vs 10 | Evidence recall@10, **restriction recall@10**, MRR, p50/p95 latency | Chat retriever; revisits D-013 |
| OCR-1 | One open (PaddleOCR) vs one hosted OCR engine on scanned pages | Character error on money/percent tokens; downstream S1; cost/page | Whether and which OCR; whether a Python service is needed |
| PARSE-1 | pdf.js + custom layout vs Docling on tables/footnotes | Table-cell accuracy, verified recall, S1 | Only if layout errors are ≥25 % of misses |
| SEM-1 | HHEM-2.1-Open vs an independent LLM judge, per field | Conditional false-accept, over-refusal | Whether a semantic check tier is enabled per field |
| EXT-1 | Our proposer vs LangExtract | Candidate recall on long documents | Only if candidate recall is the measured gap |

**Alternative retrieval stores (FAISS, Qdrant, Milvus, Weaviate) are
benchmark-dependent and not adopted.** The workload is ~100–600 vectors per
session; the analysis in the feasibility review found no accuracy or speed gain
over exact pgvector search and an extra privacy/deletion surface. They are
reconsidered only if FILT-1/RET-1 show a gap that pgvector (exact, iterative
scan, or a Postgres BM25 extension) cannot close. A paid run needs owner
approval (D-020).

## 5. Evaluation corpus (to build, roadmap M6)

About 70 documents grouped by document (no document crosses splits):
25 dev / 15 validation / 30 held-out initially.

| Slice | Docs | Covers |
| --- | --- | --- |
| SBCs, ≥6 insurers | 30 | Standard template, network tiers, excluded-services lists, coverage examples (must not count as coverage) |
| Student / international brochures and certificates | 20 | Long benefit tables, cross-page footnotes, eligibility, general exclusions, visa rules |
| Multi-document sets (SBC + certificate, certificate + rider, rate sheet) | 10 sets | Grouping, amendments, conflicting clauses |
| Scanned or partly scanned | 8 | OCR, page-level unreadable warnings |
| Adversarial | 5 | Hypotheticals, "see certificate", prompt-injection text |

Labels: plan identity, family and relations per document; value, conclusion,
evidence span and conditions per priority concept and scope; every exclusion
with the services it reaches; ~150 questions with gold passages (≥40 needing a
restriction or exclusion passage); page readability. At least 10 held-out
documents per supported family.

Current real-document evidence (not sufficient for any gate): six-document
scored corpus with 22 gold provisions, 15-PDF layout corpus, 3-PDF
`evals/realbench` with 8 questions, retrieval eval over 2 synthetic PDFs.

## 6. Release gates (V1, health insurance)

**S1 error:** a wrong value, wrong coverage, or a missed applying exclusion
shown as verified. With zero failures in *n* held-out documents the 95 % upper
bound on the per-document S1 rate is `1 − 0.05^(1/n)`.

| Gate | Limited pilot | General release |
| --- | --- | --- |
| Held-out documents | ≥30 (≥10 per supported family) | ≥60 (≥10 per family) |
| S1 errors on held-out | 0 → public claim "no incorrect verified claims in 30 unseen documents; 95 % bound ≤ 9.5 %" | 0 → 95 % bound ≤ 5 % |
| Verified recall of priority concepts | ≥80 % overall, no family <70 % | same |
| False "not found" where the document states the concept | ≤2 % of priority cells | same |
| Plan-grouping accuracy (multi-document sessions) | 100 % | 100 % |
| Evidence recall@10 / restriction recall@10 | ≥95 % / ≥95 % | same |
| Citation fidelity (cited span supports the value) | 100 % of verified cells | same |
| Chat unsupported material claims / refusal precision | 0 / ≥90 % | same |
| Correctness invariants (§3) | all | all |
| Comprehension gate (UX-25) | ≥1 first-time user, recorded | small study, recorded |
| Production smoke (`operations.md` §4) | pass | pass |

The pilot is explicitly labelled limited, and makes only the 30-document claim.
General release requires growing the held-out set to ≥60 before claiming ≤5 %.

**Latency targets** (starting points; measurements may revise latency, never
correctness): workspace load from durable state p95 < 2 s; chat p95 < 6 s
target (< 15 s ceiling with healthy providers); processing p95 ≤ 60 s per
document target (< 120 s for a 1–4 PDF session ceiling).
