# Quality — testing, benchmarks, release criteria

Status: Authoritative · Consolidated 2026-11-15 from `ACCEPTANCE` (gate run),
`RELIABILITY` §13 (SLOs), `DEPLOYMENT` §4, `ENGINEERING_STATE` (evaluation
contract) and the 2026-11-15 feasibility review §§11–12 (all in
git history `79be9a5:docs/archive/`).

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
| Unit | `tests/unit/` | `npm test` (Vitest, all layers below except e2e) | Real-document suites skip without `REAL_FIXTURES_DIR` |
| Contract | `tests/contract/` (comparison schema, chat API, verdict enum) | `npm test` | — |
| Integration | `tests/integration/` | `npm test` | Some suites skip without Supabase credentials or `REAL_PDFS_DIR` |
| E2E | `tests/e2e/` (Playwright) | `npm run test:e2e` | Browsers installed |
| Types / build | — | `npx tsc --noEmit`, `npm run build` | — |
| Retrieval eval | `evals/` (`golden-*`, frozen `v2-*` 36/12/12, `realbench`) | `npm run eval` | Embedding endpoint for semantic legs |
| Real-PDF extraction eval | `scripts/p2-experiment/` | `REAL_PDFS_DIR=<local corpus> REAL_FIXTURES_DIR=<labels> npm run eval:extraction` | Local licensed PDFs and labels (never committed) |
| Live acceptance | `scripts/acceptance-chat-live.ts`, `scripts/acceptance-pdf-export.ts` | `REAL_FIXTURES_DIR=<labels> npx tsx <script>` | Paid LLM — owner approval each run |
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
(the local corpus folders and `data/` are git-ignored; the preserved corpus is
a local directory passed via `REAL_PDFS_DIR`). Real-document test data —
quotes, adjudicated labels, real file names — lives in the git-ignored
`real-fixtures/` folder passed via `REAL_FIXTURES_DIR`; suites that need it
report SKIPPED without it. Never commit PDFs, page text or
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

### 5.1 Manifest and splits

The corpus is registered in a tracked manifest, `evals/manifests/corpus-v1.json`.
For each document it holds only a neutral id (`doc-001`…), sha256, byte size, page count, a
generic family (closed list in `scripts/corpus/corpus.ts`: `sbc`, `nonstandard`,
`certificate`, `brochure`, `rider`, `rate-sheet`, `scanned`, `adversarial`) and
its split. The id → filename mapping is private, at
`REAL_FIXTURES_DIR/corpus/corpus-v1.mapping.json`.

```bash
# register / re-verify (new documents go to --split; changed bytes are an error)
REAL_PDFS_DIR=<root> REAL_FIXTURES_DIR=<private dir> npx tsx scripts/corpus/build-manifest.ts \
  --source SBCs=sbc --source nonstandard=nonstandard [--split dev]
npx tsx scripts/corpus/split.ts assign <split> <doc-id>...   # whole documents only
npx tsx scripts/corpus/split.ts freeze <split>               # makes the split immutable
npx tsx scripts/corpus/split.ts check
```

The tools enforce these rules: a document belongs to exactly one split (never split
by page); identical bytes (sha256) may not appear twice; a frozen split cannot
gain, lose or change a document; changed bytes for a registered file are an
error, never an overwrite. Labels and questions refer to documents by id only.

### 5.2 Labelling guide

**A label** is one record per (document, concept, scope). It records:

| Field | Content | In git? |
| --- | --- | --- |
| `doc` | Manifest id (`doc-007`) | yes |
| `page` | 1-based page of the original PDF (a list for cross-page spans and footnotes) | yes |
| `span` | Verbatim text supporting the label, copied exactly from the page (no paraphrase, no normalising) | **no**, kept outside git |
| `spanSha256` | sha256 of the verbatim span, so committed results can be checked against it | yes |
| `concept` | Priority concept id (deductible, out-of-pocket maximum, specialist visit, …) | yes |
| `scope` | What the value applies to: network tier, individual/family, plan variant, member group | yes |
| `value` | The value or coverage conclusion the span states, with its conditions (prior authorisation, limits, waiting periods) | quoted text **no**; its category (copay, coinsurance, covered, not covered) yes |
| `handling` | Expected product behaviour. `display`: verifiable, shown with its citation. `withhold`: present, but must not be shown as the plan's value (a coverage example, a hypothetical, "see certificate"). `needs-verification`: ambiguous, conditional or cross-document, so it is shown with a prompt to confirm | yes |
| `readability` | Per page: `readable`, `partly-readable` or `unreadable` (scanned without text, garbled) | yes |

**Absence.** If the pages that were read do not state a concept, label it
`not-found-in-read-pages` and list the pages read and their readability.
Never label absence as `no`, `not covered` or `$0`. A silent document is NOT
STATED, not NO (`product.md` DOM-3). A label says "not covered" only when the
document states it explicitly, with its span. Different values in different
plans are separate labels per scope, not a conflict.

**Exclusions.** Label every exclusion as its own record with `doc`, `page`,
`span` (outside git), `kind: exclusion`, the services or concepts it reaches,
its scope (whole plan, one benefit, one member group), and whether it is
general (applies everywhere) or local (one table row or footnote). When an
exclusion reaches a labelled benefit, link it to that benefit's label. The
benefit's expected handling must reflect the restriction.

**Questions** (~150, written after the labels; ≥40 need a restriction or
exclusion passage). Each question has:

- `id`;
- `doc`, or a set of ids for a multi-document question;
- the question text, written fresh and never pasted from the document;
- `expected`: either `answer` with gold passage(s) as (doc, page,
  spanSha256), or `refuse` / `ask-for-context` for an unanswerable or
  under-specified question;
- the labels it depends on.

A question belongs to the split of its document(s). A question may not span
documents in two splits.

**What may be committed:** manifest ids, sha256 values (of files and spans),
byte sizes, page numbers, generic families, concept and scope ids, handling
categories, question ids, aggregate metrics and run summaries (`evals/runs/`).

**What stays outside git** (`REAL_FIXTURES_DIR`): document text, verbatim
spans and the values quoted from them, question texts that quote a document,
real filenames, insurer and product names, and the id → filename mapping.
When in doubt, keep it outside git.

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
