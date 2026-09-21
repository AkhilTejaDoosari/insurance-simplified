# RAG Gap Analysis: Current Implementation vs. Target Architecture

**Date**: 2026-09-17 | **Scope**: audit only — no code, no dependencies, no production changes.

**Bottom line up front**: the repo has no vector/embedding/hybrid/rerank infrastructure at all.
The only real retrieval is line-level keyword overlap in `app/lib/rag/answer.ts`,
used solely by the deterministic fallback. The LLM chat path performs **no retrieval** —
it sends whole documents into the prompt. The citation/highlight layer is
**IN PROGRESS and BLOCKING** (Phase C0): the viewer embeds the source PDF and marks
extracted text below it, but nothing yet highlights the passage ON the rendered PDF.

Constitutional constraints that bind any implementation (`.specify/memory/constitution.md`,
`specs/001-insurance-plan-comparison/research.md` Decision 3, `plan.md` principle II):
fact extraction and RAG Q&A are separate paths — new retrieval code must live in the
RAG path (`app/lib/rag/`, `app/api/chat/`) and must not import `app/lib/extraction/*`.

Scale note that shapes every recommendation: the corpus is 2–4 PDFs per session
(FR-001), max 15 MB / 200 pages each (`extract-pages.ts`), session-scoped in tmpdir,
deleted on close (FR-019). No persistent vector database is required for V1 at this
ephemeral-document/session scale; use a `Retriever` / `VectorIndex` (`VectorStore`)
abstraction so a pgvector or other persistent adapter can be added later without
changing retrieval consumers.

---

## 0. Explicit verification: does the LLM chat path retrieve before generating?

**No.** `answerViaLlm()` (`app/lib/rag/answer.ts:92-105`) sends **all pages of all
session documents** into one prompt via `wrapDocuments()` (`app/lib/llm/safe-prompt.ts:9-32`,
`[Page N]`-tagged blocks) with a `cantAnswer` escape hatch, then `validateChatResponse()`
checks response *shape* (≥1 citation with documentId/page/quote) — not grounding truth.
The model self-selects citations from the full corpus in-context.

Retrieval-before-generation exists **only** in the deterministic fallback:
`answerQuestion()` (`answer.ts:71-83`) calls `retrieve()` first; zero passages returns
the fixed refusal without any generation. The two engines therefore have opposite
architectures: fallback = retrieve-then-extract; LLM = whole-corpus-generate.

## Complete inventory of current retrieval implementations

There is exactly one: `retrieve()` in `app/lib/rag/answer.ts:47-68` — splits each page
on blank lines, counts shared non-stopword tokens (`tokens()`, lines 33-40) with the
question, sorts by overlap, returns top 3. No TF-IDF/BM25, no stemming, no cosine,
no index of any kind (it re-scans on every call). Everything else matching retrieval
keywords is a false positive: `embedFont` (pdf-lib fixture generation), `<iframe>`
"embeds" (viewer UI/comments), `semantics` substring matches, and spec prose
(`research.md` Decision 6, `plan.md` principle IV describe retrieval-gating as a
requirement, and `plan.md:118` labels `rag/` "chunking, retrieval" aspirationally —
no chunker exists).

---

## Layer 1 — PDF intake

1. **Current**: `POST /api/upload` (`app/api/upload/route.ts:20-95`) accepts 2–4 PDFs,
   validates per file via `extractPages()` (`app/lib/pdf/extract-pages.ts:30-86`),
   rejects non-PDF/unreadable/encrypted/non-English/over-limit with per-file reasons
   (FR-018), persists raw bytes via `saveDocumentFile()` for citation serving.
2. **Files**: `app/api/upload/route.ts`, `app/lib/pdf/extract-pages.ts`, `app/lib/session.ts:47-68`.
3. **Reusable**: validation taxonomy (`RejectionReason`), size/page caps, raw-byte
   persistence, per-file failure reporting — all directly reusable.
4. **Missing**: nothing at this layer for RAG purposes, except that downstream
   structure is discarded here (see Layer 3).
5. **Replace**: nothing.
6. **Do NOT change**: acceptance rules, caps, failure semantics.
7. **Dependencies**: none (unpdf already present).
8. **Tests covering it**: E2E upload flows; invalid-file handling (check `tests/` for
   upload-validation coverage before touching).
9. **Tests needed**: none for RAG.
10. **Order**: prerequisite, already done — no work.

## Layer 2 — Page-aware parsing

1. **Current**: `extractPages()` uses unpdf (`getDocumentProxy` + `extractText` with
   `mergePages: false`) → `{ pageCount, pages: string[] }`, 1-based page alignment
   preserved by construction.
2. **Files**: `app/lib/pdf/extract-pages.ts`.
3. **Reusable**: page segmentation and alignment guarantee — the foundation chunk
   metadata (`documentId`, `page`) builds on. `SessionDocument.pages` is the corpus
   representation everything downstream consumes.
4. **Missing**: layout awareness — headings, tables, lists, reading order beyond raw
   extraction order, and any bounding-box/offset information.
5. **Replace**: nothing; extend, don't replace.
6. **Do NOT change**: return shape `{pageCount, pages}` — extraction, session
   storage, viewer, and tests depend on it.
7. **Dependencies**: none.
8. **Tests covering it**: integration evidence tests load real fixture PDFs through it.
9. **Tests needed**: none for RAG (structure extraction is Layer 3 work).
10. **Order**: prerequisite, already done — no work.

## Layer 3 — Structure-aware chunks

1. **Current**: does not exist. The only text unit is a whole page string; retrieval
   re-splits pages into lines at query time (`answer.ts:57`). Brochure comparison
   tables arrive flattened, which is why the extraction prompt carries positional
   tier-mapping instructions instead of relying on structure.
2. **Files**: none (gap spans `app/lib/rag/` and secondarily `app/lib/pdf/`).
3. **Reusable**: `pages[]` as chunk source material; tier-table flattening knowledge
   in `app/lib/extraction/extract.ts` EXTRACTION_INSTRUCTIONS documents the failure
   mode to fix.
4. **Missing**: a chunker (paragraph/list/table-row aware, sliding window with
   overlap), chunk records `{chunkId, documentId, page, order, section?}`,
   deterministic chunk IDs.
5. **Replace**: the ad-hoc `split(/\n+/)` inside `retrieve()` — chunking must happen
   once at index time, not per query.
6. **Do NOT change**: `pages[]` itself; chunking layers on top.
7. **Dependencies**: none (pure string processing).
8. **Tests covering it**: none.
9. **Tests needed**: chunker unit tests (boundaries, overlap, determinism, page
   attribution preserved for every chunk).
10. **Order**: first retrieval work (Phase R1), after C0 and R0.

## Layer 4 — Chunk metadata

1. **Current**: only `{documentId, page}` propagated implicitly (retrieval output) plus
   `filename/pageCount` in session docs. No chunk IDs, no section labels, no offsets.
2. **Files**: `app/lib/session.ts:13-26` (`SessionDocument`), `app/lib/rag/answer.ts:42-44`.
3. **Reusable**: session document model; evidence registry pattern
   (`app/lib/evidence-ids.ts`, `session.ts` registry) is the template for
   chunk-identity handling.
4. **Missing**: `{chunkId, order, section/heading, char offsets}` on a chunk record;
   decision on where chunk records live (recommend: derived at session creation
   alongside `pages[]`, or built lazily per session and cached in tmpdir).
5. **Replace**: nothing.
6. **Do NOT change**: `SessionDocument` shape for existing consumers; add, don't alter.
7. **Dependencies**: none.
8. **Tests covering it**: none.
9. **Tests needed**: metadata completeness tests (every chunk traceable to
   document+page; ordering stable across runs).
10. **Order**: with Phase R1.

## Layer 5 — Embeddings

1. **Current**: none. Zero embedding calls, zero keys, zero stored vectors
   (verified: no matches repo-wide for embedding/vector providers).
2. **Files**: none.
3. **Reusable**: the provider-agnostic pattern of `app/lib/llm/client.ts`
   (env-configured base URL + key, retry with backoff, no vendor SDK) should be
   mirrored, not reused directly (different endpoint shape).
4. **Missing**: an embeddings client (OpenAI-compatible `POST /embeddings`),
   model selection, batching, failure behavior (degrade to lexical-only, mirroring
   the existing LLM/fallback engine-selection pattern in `app/api/chat/route.ts:30-31`).
5. **Replace**: nothing.
6. **Do NOT change**: `app/lib/llm/client.ts` (generation client stays as-is).
7. **Dependencies**: none required if using a compatible HTTP endpoint via fetch
   (same zero-SDK approach as generation). A local-model dep would be heavy and is
   NOT recommended — session corpora are tiny and ephemeral.
8. **Tests covering it**: none.
9. **Tests needed**: client unit tests with mocked fetch (batching, retry,
   dimension validation, unconfigured → clean skip).
10. **Order**: Phase R3, after eval baselines exist to measure its value.

## Layer 6 — Semantic vector retrieval

1. **Current**: none. No index, no cosine search, no stored vectors.
2. **Files**: none.
3. **Reusable**: `retrieve()`'s call signature `(documents, question, maxPassages)`
   is the seam to preserve — new retrievers should plug in behind an equivalent
   interface returning ranked passages with documentId/page.
4. **Missing**: vector computation + ranking over chunk embeddings.
5. **Replace**: nothing yet (lexical path stays as the fallback leg).
6. **Do NOT change**: refusal-gating semantics in `answerQuestion()` — any retriever
   must still be able to return zero passages.
7. **Dependencies**: none beyond Layer 5 — hide the index behind a
   `VectorIndex`/`VectorStore` abstraction consumed through a `Retriever`
   interface, so a pgvector or other persistent adapter can be added later
   without changing retrieval consumers. The V1 implementation behind that
   abstraction is an in-memory brute-force cosine matrix (per session,
   deleted with it) — sufficient at 2–4 ephemeral documents and trivially
   delete-on-close compliant.
8. **Tests covering it**: none.
9. **Tests needed**: ranking unit tests on synthetic vectors; determinism tests.
10. **Order**: Phase R3, behind the Layer 5 client.

## Layer 7 — Lexical retrieval

1. **Current**: `retrieve()` + `tokens()` (`answer.ts:33-68`) — hand-rolled stopword
   list, no stemming, raw overlap count, top-3, rescans corpus per call. Used ONLY
   by the fallback engine.
2. **Files**: `app/lib/rag/answer.ts:33-68`.
3. **Reusable**: session-only corpus discipline, line→(documentId, page) attribution,
   top-K + refusal-on-empty contract.
4. **Missing**: term weighting (TF-IDF minimum, BM25 preferred), stemming/
   normalization, operation over Layer-3 chunks instead of raw lines, any index.
5. **Replace**: the overlap counter with BM25-over-chunks (Phase R2); keep function
   shape and the zero-result contract.
6. **Do NOT change**: the refusal gate that consumes its output; stopword behavior
   relied upon by `refusal.test.ts` expectations must keep passing or be updated
   deliberately with measured justification.
7. **Dependencies**: none (implement BM25 in ~40 lines; no search library needed
   at this corpus size).
8. **Tests covering it**: `tests/unit/refusal.test.ts` (gating behavior),
   E2E Flow 3 (one answerable + one refusal question).
9. **Tests needed**: BM25 ranking unit tests; regression that current refusal
   fixtures still refuse; recall@k on the golden set (R0 harness).
10. **Order**: Phase R2, measured by the R0 harness.

## Layer 8 — Hybrid fusion

1. **Current**: none — single lexical leg, and only on one engine.
2. **Files**: none.
3. **Reusable**: the `retrieve()` seam (Layer 6); engine-selection precedent in the
   chat route for graceful degradation (hybrid → lexical-only when embeddings
   unconfigured).
4. **Missing**: reciprocal-rank fusion (or weighted combine) over lexical + vector
   legs, per-leg configurability, fusion weights.
5. **Replace**: direct consumption of single-leg results in `answerQuestion()`.
6. **Do NOT change**: the `ChatResponse` contract or refusal semantics.
7. **Dependencies**: none (RRF is dependency-free arithmetic).
8. **Tests covering it**: none.
9. **Tests needed**: fusion unit tests (known-answer ranking fixtures, weight
   sensitivity, single-leg degradation).
10. **Order**: Phase R4, after both legs are measured independently.

## Layer 9 — Reranking

1. **Current**: none — `retrieve()` sorts by raw overlap count.
2. **Files**: none (sort at `answer.ts:67` is the placeholder to replace).
3. **Reusable**: top-K truncation pattern.
4. **Missing**: a second-stage scorer over a wider candidate set (cross-encoder
   via HTTP like Layer 5, or LLM-as-reranker through the existing client, or
   deferred entirely — at this corpus size, BM25+RRF may already saturate).
5. **Replace**: the overlap-count sort, once measured.
6. **Do NOT change**: anything until the eval harness shows ranking headroom —
   explicit risk of over-engineering; candidate for deferral past MVP.
7. **Dependencies**: only if LLM-rerank chosen (reuse `app/lib/llm/client.ts`);
   no new dep for heuristic rerank.
8. **Tests covering it**: none.
9. **Tests needed**: rerank uplift tests on the golden set (must beat Phase R4
   baseline or be dropped).
10. **Order**: Phase R4-stretch, gated on measured need.

## Layer 10 — Top evidence context

1. **Current**: fallback concatenates retrieved passages into `answerText`
   (extractive, fully grounded, `answer.ts:81-82`). LLM path has no context
   selection — full corpus in prompt.
2. **Files**: `app/lib/rag/answer.ts:71-105`.
3. **Reusable**: extractive concatenation as the no-LLM baseline; `maxPassages`
   top-K pattern.
4. **Missing**: top-K chunk context assembly for the LLM prompt (replacing whole
   documents), context budgeting (token/char caps), page-tag preservation in
   assembled context.
5. **Replace**: whole-document `wrapDocuments()` input on the chat path with
   retrieved-chunk context (Phase R5) — the single highest-leverage change for
   cost, latency, and citation precision.
6. **Do NOT change**: `wrapDocuments()` itself (still used by extraction);
   `cantAnswer` escape hatch; refusal path.
7. **Dependencies**: none (consumes Phase R4 output).
8. **Tests covering it**: `refusal.test.ts`, `chat-route-engine.test.ts`,
   E2E Flow 3.
9. **Tests needed**: prompt-assembly tests (chunk inclusion order, page tags
   intact, budget enforcement, empty-context → refusal without LLM call).
10. **Order**: Phase R5.

## Layer 11 — Grounded answer generation

1. **Current**: dual — deterministic extractive fallback (grounded by construction)
   vs. LLM generation constrained only by instructions + output-schema validation
   (`CHAT_INSTRUCTIONS`, `validateChatResponse`, temperature 0, `response_format`
   json_object).
2. **Files**: `app/lib/rag/answer.ts:85-135`, `app/lib/llm/client.ts`.
3. **Reusable**: instruction set, JSON-object enforcement, temperature 0, retry
   policy, engine override (`engine: llm|fallback`, relied upon by tests).
4. **Missing**: citation-to-context enforcement (every cited page/quote must occur
   in the supplied context — checkable deterministically post-generation),
   claim-level grounding checks.
5. **Replace**: nothing in the generator; add a post-generation citation verifier.
6. **Do NOT change**: generation parameters, refusal text, validation strictness.
7. **Dependencies**: none.
8. **Tests covering it**: `chat-api.test.ts` (shape), `chat-route-engine.test.ts`
   (selection), `llm-client-retry.test.ts` (transport).
9. **Tests needed**: verifier unit tests (valid citations pass; hallucinated
   page/quote → flagged/refused); prompt tests that instructions reference
   chunk context once Phase R5 lands.
10. **Order**: Phase R5 (verifier) — extend in R6 with faithfulness scoring.

## Layer 12 — Nuanced answer state

1. **Current**: binary — `ChatResponse` is `answer | refusal`
   (`answer.ts:21-23`), contract in `contracts/chat-api.md`.
2. **Files**: `app/lib/rag/answer.ts:21-26`, `specs/.../contracts/chat-api.md`,
   `app/components/ChatPanel.tsx` (renders the two states).
3. **Reusable**: refusal shape/text (constitutional-level requirement, FR-013);
   citation-bearing answer shape.
4. **Missing**: partial-answer (some sub-questions unsupported), conflicting-source,
   and low-confidence states — all spec/contract/UI changes, not just code.
5. **Replace**: nothing yet.
6. **Do NOT change**: the existing two states or refusal text — additions only,
   and only after retrieval quality justifies them (a weak retriever makes
   "partial" meaningless).
7. **Dependencies**: none.
8. **Tests covering it**: `chat-api.test.ts`, `refusal.test.ts`, E2E Flow 3.
9. **Tests needed**: per new state — contract tests, panel rendering tests,
   refusal-calibration tests (new states must not cannibalize true refusals).
10. **Order**: Phase R6, last — needs mature retrieval + eval first.

## Layer 13 — Citations / evidence registry

1. **Current**: PARTIAL — the corrected boundary (deterministic opaque IDs in
   `app/lib/evidence-ids.ts`, session registry in `app/lib/session.ts`,
   boundary-only enrichment in the routes, core citations untouched) exists
   **locally on `fix/citation-navigation` but is uncommitted/unpushed**. It must
   not be called complete until: core extraction/RAG citations remain
   `{documentId, page, quote}`; `evidenceId` is added only at the API/session
   presentation boundary; tests are green; the work is committed and pushed.
2. **Files**: `app/lib/evidence-ids.ts`, `app/lib/session.ts`, `app/api/chat/route.ts`,
   `app/api/extract/route.ts`, `app/lib/rag/answer.ts` (core `ChatCitation` only).
3. **Reusable**: the design (not yet the committed code) — future chunk-level
   citations should reuse the same registry and `withEvidenceId` rather than
   inventing identity.
4. **Missing**: committed/pushed boundary code; chunk→citation linkage (chunk IDs
   in citations once chunks exist); multi-chunk citations for answers synthesized
   across passages.
5. **Replace**: nothing.
6. **Do NOT change**: session-agnostic engine boundary; ID determinism.
7. **Dependencies**: none.
8. **Tests covering it**: `tests/unit/evidence-ids.test.ts` (determinism,
   round-trip, cross-session isolation), `citation-panels.test.ts`,
   `chat-api.test.ts` — locally, pending the push.
9. **Tests needed**: chunk-ID linkage tests (Phase R1 follow-through).
10. **Order**: finishes inside Phase C0 — consume, don't rebuild, afterwards.

## Layer 14 — Highlighted original source

**Status: IN PROGRESS / BLOCKING (Phase C0 — must finish before any RAG work).**

1. **Current**: the viewer (`/view/...?page=N&evidence=ev-…`) embeds the actual
   one-page source PDF (`/api/document?...?page=N` via pdf-lib copy) in an
   iframe, and `locatePassage()` marks the passage in the extracted text
   rendered BELOW the PDF, with an honest no-highlight fallback plus a
   restricted-file fallback to the full document. What is NOT done: nothing
   highlights the passage ON the rendered PDF itself — `SourceFrame` has no
   PDF text-layer highlight implementation; the raw `?page` path still depends
   on the one-page PDF transformation; encrypted/restricted PDFs (verified
   failure on OPTima) still hit the fallback path instead of full provenance.
2. **Files**: `app/view/.../page.tsx`, `app/components/SourceFrame.tsx`,
   `app/api/document/.../route.ts`, `app/lib/citation.ts`, `app/lib/pdf/single-page.ts`.
3. **Reusable**: registry resolution + doc/page validation (`isMatchingEvidence`),
   one-page PDF endpoint, invalid-page explicitness, restricted-file explicit
   fallback, `locatePassage` as the match-decision primitive.
4. **Missing**: on-PDF text-layer highlight when confidently matchable; completion
   criteria below.
5. **Replace**: nothing yet — text-marking stays as the fallback presentation.
6. **Do NOT change**: explicit invalid-page behavior; render-path pdf-lib ban
   (pdf-lib over multi-MB uploads inside server-component render stack-overflows;
   it stays in the API route only); honest-fallback principle.
7. **Dependencies**: none decided — text-layer options to evaluate in C0.
8. **Tests covering it**: `citation-route.test.ts`, `citation-panels.test.ts`,
   `comparison-links.test.ts`, E2E viewer assertions.
9. **Tests needed**: on-PDF highlight tests (match → highlighted; ambiguous →
   fallback); real Patriot Exchange + OPTima validation runs.
10. **Order**: Phase C0, blocking everything below.

**Phase C0 completion criteria**:
- one-click comparison value → source viewer
- corrected session-bound evidenceId architecture (committed/pushed)
- original PDF remains usable for restricted/encrypted documents
- correct cited page opens
- exact passage highlighted ON THE RENDERED PDF when confidently matchable,
  otherwise honest no-highlight fallback
- real Patriot Exchange + OPTima validation

## Layer 15 — Retrieval + answer evaluation

1. **Current**: none. No relevance judgments, no recall@k/MRR, no faithfulness or
   citation-precision scoring, no golden Q/A set. `SC-005` ("100% refusal on
   evidence-absence set") references a measurement set that does not exist;
   E2E Flow 3 checks exactly one answerable + one unanswerable question.
2. **Files**: none (closest: `tests/unit/refusal.test.ts`, E2E Flow 3 — behavior
   spot-checks, not measurement).
3. **Reusable**: fixture PDFs (`tests/fixtures/plan-a/b.pdf`) as the first eval
   corpus; refusal fixtures as the seed of the evidence-absence set.
4. **Missing**: golden set (questions + expected passages/answers + must-refuse
   questions), recall@k/MRR harness for retrievers, citation-precision +
   refusal-calibration checks for answers, a runnable `npm run eval` entry.
5. **Replace**: nothing.
6. **Do NOT change**: existing tests; eval lives alongside (e.g. `evals/`), not
   in the unit suite, since LLM-judged checks must not gate unit CI.
7. **Dependencies**: none for harness + retrieval metrics (pure TS). An
   LLM-as-judge for faithfulness would reuse the existing client — optional,
   Phase R6.
8. **Tests covering it**: none (this is the gap).
9. **Tests needed**: the harness itself + a baseline run committed as the
   reference numbers every later phase must beat.
10. **Order**: Phase R0 — BEFORE any retrieval change, so all later work is measured.

---

## Dependency-ordered implementation plan

Dependency graph: C0 → R0 → R1 (+ chunk-based second baseline) → R2 → R3 → R4 → R5 → R6.
No RAG phase starts before C0 completes; no retrieval change lands before R0 measures it.

### Phase C0 — Citation provenance completion (BLOCKING, before all RAG work)
- **Objective**: finish the citation/highlight layer: one-click value → viewer,
  corrected session-bound evidenceId architecture committed/pushed, original PDF
  usable for restricted/encrypted documents, correct cited page, exact passage
  highlighted ON the rendered PDF when confidently matchable with honest
  no-highlight fallback, real Patriot Exchange + OPTima validation.
- **Files likely affected**: viewer + SourceFrame + document route + session
  evidence boundary (work already local on `fix/citation-navigation`).
- **Acceptance criteria**: the six C0 completion criteria in Layer 14; unit +
  E2E + build + tsc green; branch committed and pushed.
- **Tests**: existing citation/viewer suites green; on-PDF highlight tests;
  real-document validation runs.
- **Prerequisite**: none (in progress).

### Phase R0 — Current-system eval baseline
- **Objective**: measure the CURRENT line-overlap retriever before changing
  retrieval in any way.
- **Files likely affected**: NEW `evals/` (golden set JSON + runner script);
  `package.json` (`eval` script only); golden questions derived from
  `tests/fixtures/`; baseline numbers recorded in `evals/BASELINE.md`.
- **Acceptance criteria**: `npm run eval` reports recall@k/MRR for the current
  overlap retriever and refusal accuracy on the must-refuse set; results are
  deterministic without LLM calls.
- **Tests**: harness self-tests (metric correctness on synthetic rankings).
- **Prerequisite**: C0 (frozen citation contract to measure against).

### Phase R1 — Chunking + chunk metadata
- **Objective**: deterministic, structure-aware chunks with full provenance, no
  behavior change anywhere; then record a second, chunk-based baseline so
  chunking itself is measured.
- **Files likely affected**: NEW `app/lib/rag/chunks.ts` (+ types);
  `app/lib/rag/answer.ts` untouched (still consumes lines); NEW
  `tests/unit/chunks.test.ts`; second baseline appended to `evals/BASELINE.md`.
- **Acceptance criteria**: no source text is lost; every chunk maps to
  `documentId` + `page` + stable order; chunking is deterministic; overlap is
  bounded/configured; duplicated overlap is intentional and testable; page
  attribution is preserved; chunks do not cross page boundaries unless
  explicitly justified. Chunk-based baseline recorded.
- **Tests**: chunker unit tests (boundaries, overlap, determinism, attribution).
- **Prerequisite**: R0.

### Phase R2 — BM25 lexical retrieval over chunks
- **Objective**: replace the overlap counter with a real lexical ranker.
- **Files likely affected**: `app/lib/rag/answer.ts` (`retrieve()` internals only —
  signature and zero-result contract preserved); `tests/unit/refusal.test.ts`
  expectations verified, not weakened.
- **Acceptance criteria**: recall@k on the R0 golden set strictly beats the
  line-overlap baseline; all existing refusal/E2E behavior unchanged.
- **Tests**: BM25 unit tests; golden-set recall regression; existing suite green.
- **Prerequisite**: R0 (must prove uplift); R1 (chunks are the ranked unit).

### Phase R3 — Embeddings + semantic retrieval
- **Objective**: add the semantic leg behind a `Retriever`/`VectorIndex`
  abstraction with zero new infrastructure.
- **Files likely affected**: NEW `app/lib/rag/embeddings.ts` (fetch-based client
  mirroring `llm/client.ts` conventions); NEW in-memory per-session cosine ranker
  behind the index abstraction; `app/api/chat/route.ts` (engine degradation:
  unconfigured → lexical-only).
- **Acceptance criteria**: works with embeddings configured; cleanly degrades to
  R2 lexical when not; no persistent store (vectors in memory or session tmpdir
  only); recall@k measured per-leg; a future pgvector adapter would not change
  retrieval consumers.
- **Tests**: client tests (mocked fetch, batching, failure → skip); ranking
  determinism tests; degradation tests.
- **Prerequisite**: R0 (per-leg measurement); new env keys documented, no SDK deps.

### Phase R4 — Hybrid fusion (+ optional measured rerank)
- **Objective**: combine legs with RRF; rerank only if measured headroom exists.
- **Files likely affected**: NEW `app/lib/rag/fusion.ts`; `answerQuestion()` wiring
  to fused results; rerank deferred unless RRF leaves headroom on the golden set.
- **Acceptance criteria**: fused recall@k beats the best single leg; single-leg
  degradation covered; rerank lands only with proven uplift or is dropped.
- **Tests**: fusion unit tests (fixtures, weights, degradation); rerank uplift
  tests if attempted.
- **Prerequisite**: R2 + R3 measured independently.

### Phase R5 — Retrieval-fed LLM + citation verifier
- **Objective**: top-K chunk context replaces whole-document prompts; add a
  deterministic citation verifier.
- **Files likely affected**: `app/lib/rag/answer.ts` (`answerViaLlm` context
  assembly, `maxPassages` budgeting, NEW citation-vs-context verifier);
  `CHAT_INSTRUCTIONS` wording; prompt-assembly tests NEW.
- **Acceptance criteria**: LLM prompts contain only retrieved chunks with intact
  page tags; empty retrieval never calls the LLM; every emitted citation is
  verified present in the supplied context (failures → refusal/repair, never
  silent); E2E Flow 3 green; cost/latency down vs whole-doc baseline.
- **Tests**: assembly tests (order, tags, budget); verifier tests (valid pass,
  hallucinated page/quote flagged); refusal-calibration on the golden set.
- **Prerequisite**: R4 (retrieval worth wiring); R0 (calibration measurement).

### Phase R6 — Nuanced states + faithfulness eval
- **Objective**: partial/conflicting/low-confidence states (spec + contract + UI),
  plus faithfulness scoring, only once retrieval earns it.
- **Files likely affected**: `app/lib/rag/answer.ts` (response union),
  `specs/.../contracts/chat-api.md`, `app/components/ChatPanel.tsx`,
  eval harness (faithfulness dimension, optional LLM-judge via existing client).
- **Acceptance criteria**: new states specified, contracted, panel-tested, and
  provably not cannibalizing true refusals on the golden set.
- **Tests**: per-state contract/panel tests; faithfulness regression gate.
- **Prerequisite**: R5 stable + measured.

---

## Layer status summary

| Layer | Status | Phase |
| --- | --- | --- |
| 1 PDF intake | DONE | — |
| 2 Page-aware parsing | DONE | — |
| 3 Structure-aware chunks | MISSING | R1 |
| 4 Chunk metadata | MISSING | R1 |
| 5 Embeddings | MISSING | R3 |
| 6 Semantic vector retrieval | MISSING | R3 |
| 7 Lexical retrieval | PARTIAL (line overlap only) | R2 |
| 8 Hybrid fusion | MISSING | R4 |
| 9 Reranking | MISSING (defer unless measured) | R4-stretch |
| 10 Top evidence context | PARTIAL (fallback only; LLM path whole-doc) | R5 |
| 11 Grounded generation | PARTIAL (instructions + shape validation only) | R5 |
| 12 Nuanced answer state | MISSING (binary answer/refusal) | R6 |
| 13 Citations / evidence registry | PARTIAL (boundary local, uncommitted) | C0 |
| 14 Highlighted original source | IN PROGRESS / BLOCKED | C0 |
| 15 Retrieval + answer evaluation | MISSING | R0 |
