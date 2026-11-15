# Insurance Simplified — Product Capability, UX and Technology Feasibility Review

Nov 15, 2026 · @Akhil Teja Doosari

## The decision

**Mostly the right technologies, with a few weak approaches inside them.** The frameworks are not what holds the product back: Next.js, TypeScript, Postgres on Supabase with pgvector, pdf.js and pdf-lib all earn their place. What holds it back is how some of that technology is used, plus two capabilities that do not exist yet:

1. **A fixed list of 48 regex-defined facts drives the dashboard**, and "NOT STATED" is derived from regex misses. That cannot give a dynamic dashboard or trustworthy absence. *Replace* it with a versioned concept registry behind the verifier. This is a change of approach, not of technology.
2. **Retrieval is configured on almost no evidence.** The chat path uses semantic-only search, chosen on MRR measured over about 8 answerable questions and two synthetic PDFs. The keyword leg uses `ts_rank`, which is not BM25. There is no reranker. The single global HNSW index is filtered by session *after* the index scan, which can drop results as more sessions accumulate. *Improve in place:* exact per-session search, hybrid search on, and a reranker benchmark. **FAISS or a dedicated vector database would not fix any of these.**
3. **No OCR.** Scanned PDFs are rejected, honestly, and partly scanned PDFs may pass with pages silently missing. *Benchmark* one open and one hosted OCR engine.
4. **Verification and LLM output are weak** for a product that makes coverage claims. Claim checks look only at numbers, and output uses `json_object` rather than a strict schema. *Improve* both.
5. **The evaluation and delivery basics are missing:** 2 committed fixture PDFs, 3 local real PDFs, 8 real-document questions and no CI. This is the biggest risk, and the cheapest to fix.

**Do not adopt:**

- FAISS, Qdrant, Milvus or Weaviate;
- a new frontend framework or a dynamic-form library;
- a RAG framework (LangChain or LlamaIndex);
- a Python service, unless an OCR or layout benchmark winner requires one.

## What this review is based on

**Only the GitHub snapshot.** The newest branch is `feat/p2-document-generalization` at `15f8cc2`, committed 2026-11-14; every other branch is older and behind it. **Your local recovery tree was not visible**, because this session has no link to your computer and nothing new was pushed. Every "implemented" below means *present in the code at `15f8cc2`*. ADRs, the reference-contract ZIPs and `docs/` plans are **not** counted as implemented.

Each claim carries one of these labels:

| Label | Meaning |
| --- | --- |
| **\[Code\]** | Read in the repository at `15f8cc2`, with file path |
| **\[Repo-measured\]** | A number the repository itself reports (eval files, `BASELINE.md`) |
| **\[Fact\]** | Official documentation or release notes |
| **\[Vendor\]** | A vendor's own claim or benchmark, never measured on our documents |
| **\[Independent\]** | A third-party benchmark or review |
| **\[Estimate\]** | My judgement; not measured |
| **\[Untested\]** | An experiment not yet run |

No dependency was installed, no file was changed, and no paid API was called.

## 1. Current implementation versus intended experience

Status key:

- **Implemented:** in the request path at `15f8cc2`.
- **Partial:** present but limited in a way users will hit.
- **Designed only:** in ADRs or experiments, not in the request path.
- **Missing:** neither.

"Tested" means tests exist in `tests/`; it does **not** mean measured on real insurance documents. That happens only for the 3-PDF `evals/realbench`, run locally.

| Capability | Status | Evidence \[Code\] unless marked |
| --- | --- | --- |
| Upload of 1 to 5 PDFs | Implemented | `app/api/upload/route.ts`: `MIN_FILES = 1`, `MAX_FILES = 5` |
| Native-text PDF reading with page text and table layout | Implemented | `app/lib/pdf/extract-pages.ts`, `layout-tables.ts` (pdf.js) |
| Scanned or image-only PDFs | **Missing** (rejected with a clear message) | `ingestion/quality-gate.ts`: "OCR IS NOT IMPLEMENTED" |
| Partly scanned PDFs (some image pages) | **Risk: unreported** | The gate checks total characters only. A search found no per-page unreadable detection; to confirm on the recovery tree |
| Plan identity, plan names and network tiers | Implemented | `extraction/plan-identity.ts`, `plan-names.ts`, `tiers.ts` |
| Benefit, cost and limit rows | Partial | A fixed inventory of 48 regex facts (`extraction/fact-list.ts`) plus an LLM path given the same fact names. Anything outside the list is invisible |
| Open-vocabulary fact discovery | Designed only | `docs/P2_FACT_DISCOVERY_EXPERIMENT.md`: "experiment complete, NOT implemented in production" |
| Exclusions as provisions, with applicability to each benefit | Designed only | ADR-003.x; no exclusion-applicability code in `app/lib` |
| Eligibility rules | Partial | `extraction/eligibility.ts`: interpretations against user context; no AND/OR/NOT tree |
| Personalized overview from user context (age, residency, visa, dates) | Implemented | `components/ContextInputs.tsx`, `PersonalizedOverview.tsx` |
| Single-plan "understand" mode | Implemented | `presentation/adaptive.ts`: `mode: "understand"` |
| Multi-plan "compare" mode | Implemented | `presentation/adaptive.ts`: `mode: "compare"`, `ComparisonTable.tsx` |
| Same-scope contradiction detection | Implemented | `extraction/contradictions.ts` (scope keys include tier, period, age band, conditions); never compares across documents |
| Document relations (certificate, rider, amendment, supersession) | **Missing** in extraction; a stub exists in RAG | `rag/doc-version.ts` has `superseded_by`; `plan-identity.ts` *excludes* rider and endorsement text rather than relating it |
| "Not stated" / absence | Unsafe | Emitted on a regex miss (`extract.ts:502`, `:831`) |
| Source citations with page | Implemented | Evidence on every displayed value; the export cites "file, page N" |
| PDF highlighting | Implemented (honest) | `PdfEvidenceViewer.tsx`: rectangles only for a *unique* text match, otherwise an explicit message |
| Claim verification | Partial | `evidence-verification.ts:235` checks only tokens with digits; wording is unchecked |
| Grounded chat over the uploaded PDFs | Implemented | `rag/answer.ts`: retrieval, quote-in-page check, refusal when evidence is empty, cross-document questions |
| Retrieval | Implemented; selection weakly evidenced | Semantic-only selected (`answer.ts:394`). Hybrid RRF exists but is not selected (section 9) |
| Downloadable report | Implemented | `report/pdf.ts` (pdf-lib), a projection of one validated snapshot; `api/export` replays it and checks fingerprints |
| Session deletion of bytes, rows and comparison results | Implemented, with ordering caveats | `upload/route.ts:303–331` |
| Durable storage | Implemented, with a non-durable fallback | Postgres and storage via Supabase REST; tmpdir fallback (`upload/route.ts:72–88`, `:179`) |
| CI | **Missing** | No `.github/workflows` |
| Automated tests | Implemented | 109 unit-test files, plus contract, integration and e2e suites |
| Real-document evaluation | Partial (smoke-test scale) | `evals/realbench`: 3 uncommitted PDFs, 8 questions \[Repo-measured\] |
| Observability | Partial | `observability/trace.ts`, `timing.ts`; console logging, which includes filenames (`upload/route.ts:135`) |
| Health check matches the running server | **Defect** | `next start -p 3333` versus compose and health check on port 3000 |

## 2. Single-PDF understanding

**Feasible, and largely present.** One PDF already yields a useful, cited overview for the facts in the fixed list. The gap is everything outside that list, and how missing or conditional information is labelled.

| Question | Status | What closes it |
| --- | --- | --- |
| Identify plan, benefits, costs, limits | Partial: plan identity yes; benefits and costs only for the 48 listed facts | Concept registry plus candidate proposer plus verifier (ADR-003.2 C1); see section 4 |
| Exclusions and limitations | Partial: "excluded services" rows only where a fact pattern hits; no exclusion-to-benefit applicability | Exclusion provisions and the applicability resolver (C2) |
| Eligibility | Partial | Eligibility tree and dated evaluation (C3, R8) |
| Governing conditions ("subject to", "see section") | Partial: `conditions.ts` and `qualifier-evidence.ts` attach qualifiers; no cross-reference following | Cross-reference following to the cited section; the verifier keeps conditions attached (R4) |
| Complete overview without a second PDF | Partial: an overview exists, but only of listed facts | The registry makes the overview concept-driven, not list-driven |
| Natural-language questions | Implemented (grounded RAG with refusal) | Retrieval upgrades (section 9); answers must use verified provisions first (ADR-003 chat contract) |
| Every material answer cites passage and page | Implemented for table values and chat quotes | Keep. Extend highlighting to non-unique matches using stored coordinates (from the layout parser) instead of text search |
| Plain-language explanation without changing meaning | **Risk.** The code comments record that keyword-proximity paraphrases "invert or invent meaning", so the current code shows verbatim text | Keep verbatim as the authority, with any explanation as a separate, labelled layer generated only from verified fields with a fixed template per concept. Never paraphrase conditions or exclusions freely |
| Verified / conditional / contradictory / missing / unreadable | Partial: verdicts exist (`verdicts.ts`), but "missing" comes from regex misses and "unreadable" exists only at whole-document level | The ADR-003.1 status set, with per-page coverage and "not found in read pages" instead of "not stated" |
| Incomplete document, or one that refers to another | Missing: no detection of "see your certificate" or "premium provided separately" | A family registry of concepts expected per document type (SBC: premium comes from a separate document); show "refers to: certificate (not uploaded)" |

**Bottom line.** Single-PDF understanding is the most complete part of the product. Making it trustworthy needs no new technology: it needs the concept registry, honest absence, and exclusion applicability.

## 3. Multi-document and multi-plan comparison

**Feasible, but the hard parts are missing.** Comparing two *different plans*, each from its own SBC, works today within the fixed fact list, and same-scope contradictions are caught. What does not exist is any understanding of *several documents describing one plan*: brochure, certificate, rider, rate sheet.

| Question | Status | Required mechanism |
| --- | --- | --- |
| Different plans versus several documents for one plan | Partial: each document is treated as its own plan; riders and endorsements are filtered out of plan names | Session registry with verified plan identity (plan number plus issuer), period and family (R2-4, R3-1). Documents with the same identity group under one plan; others stay separate. Ask the user only when identity is unresolved |
| Associate brochures, certificates, amendments, rate sheets | Missing | Authority decisions with proof (C4): governing statements and amendment clauses scoped to sections (R6); a rate sheet attaches premium only |
| Normalize terminology across insurers | Partial: fact labels normalize 48 concepts by regex synonyms | Versioned concept registry with aliases per concept and family. An unknown term stays a *discovered, unverified* concept until reviewed, rather than being forced into a known concept |
| Compare deductibles, out-of-pocket limits, coverage, exclusions, eligibility | Partial: values compare; exclusions and eligibility only as text | Typed provisions (C1) with structured values; exclusion applicability (C2); eligibility evaluated per plan for the user (C3) |
| Prevent incompatible comparisons (tier, period, coverage level, cost-share role) | Partial: scope keys exist for contradictions (`contradictions.ts` SCOPE\_KEYS); the comparison grid does not enforce them | Comparison cells keyed by full scope (R5). Incompatible scopes show side by side with a scope label, never as "better or worse" |
| One document has a benefit, another does not mention it | Unsafe today ("not stated") | "Not found in the pages read", plus whether that family is *expected* to state it. Never treat "not mentioned" as "not covered" |
| Questions comparing plans | Implemented in chat (multi-document retrieval); answers are not tied to the verified grid | Comparison answers read the verified grid first; retrieval only adds supporting text |
| Contradictions and superseding amendments | Contradiction within a document: implemented. Supersession: missing | Authority proof (C4, R6); without proof, show both values as a conflict |

**What makes a comparison trustworthy.** Four mechanisms, all specified in ADR-003.2 and none in the code yet:

1. Plan identity grouping.
2. Scope-keyed cells.
3. Expected-concept-aware absence.
4. Proof-carrying supersession.

**No new external technology is required.**

## 4. A genuinely dynamic dashboard

**Today \[Code\].** The rows are the 48 entries of `FACTS`, which `presentation/adaptive.ts` projects into groups; empty sections hide. That is adaptive *presentation* over a *fixed vocabulary*. A new insurer concept, such as a "wellness reimbursement" or a "pre-existing condition waiting period buy-down", cannot appear without a code change.

**Recommendation: schema-driven rendering over a versioned concept registry, with our own React components.** No new framework.

1. **Concept registry (data, versioned).** Each concept has:
   - an id and display label;
   - its category (cost, coverage, exclusion, eligibility, administrative);
   - the provision kind it maps to;
   - aliases per family;
   - priority per user context (a student sees eligibility and waiting periods first);
   - the families expected to state it.

   It ships as JSON in the repository, and every result records its version. Unknown concepts get a provisional id and the status **discovered, unverified**.
2. **A view model built on the server from verified provisions plus resolutions.** Sections, then rows, then cells. Each cell holds the value, its scope key, its conclusion, its evidence ids and its conditions. The UI renders whatever the view model contains; **the frontend never knows concept names**.
3. **A small set of reusable renderers, chosen by provision kind, not by concept:**
   - money with network tiers;
   - percentage;
   - limit;
   - yes/no with conditions;
   - verbatim text;
   - eligibility checklist.

   Seven provision kinds means seven renderers.
4. **Table mechanics: TanStack Table** (MIT, headless) for filter, search, group, expand, collapse and column visibility, if hand-written logic grows past simple sorting. It supports sorting, column and global filtering, grouping, aggregation, row expansion and column visibility ([TanStack docs](https://tanstack.com/table/latest/docs/guide/features)) \[Fact\]. Its headless design keeps our markup and accessibility. *Optional*: adopt only when we need grouping and faceting.
5. **Not recommended:** JSON-Schema form libraries such as react-jsonschema-form and JSON Forms. They render *input forms*, not evidence displays, and would add a second schema language.

**Avoiding hundreds of rows:**

- default to the **priority set** for the user's context (about 12 to 20 rows);
- collapse the rest into categories with counts ("Other covered services: 14");
- in compare mode, show rows **that differ** first;
- never create a row for a concept found in no plan.

**Cell display contract:**

- **Verified:** value plus a citation chip that opens the PDF at the highlighted span.
- **Conditional:** value, a condition badge and the condition text on expand.
- **Exclusion applies:** a warning, with both quotes.
- **Undetermined:** "cannot be confirmed" with the reason.
- **Not found in read pages:** grey, with an "expected in this document type?" hint.
- **Discovered, unverified:** a separate collapsed section, "Mentioned but not verified", never mixed into verified rows.
- **Conflict:** both values with their sources.

The same view model drives single-plan mode (one column) and compare mode (N columns), so layouts stay consistent across very different PDFs.

## 5. Reusable evidence core versus domain modules

| Layer | Domain-independent? | Notes |
| --- | --- | --- |
| PDF reading, OCR, layout, coordinates, page coverage | **Yes** | Region and reading provenance (ADR-003.1) is domain-free |
| Block index, ownership, snapshots, session registry | **Yes** |  |
| Retrieval, chunking, hybrid search, reranking | **Yes** | Tuning (chunk boundaries at headings) is per family but generic |
| Verifier boundary, seal, authoritative store, issued resolutions | **Yes** |  |
| Grounded chat contract, rendering surfaces, export | **Yes** (templates per domain) |  |
| Concept registry, provision kinds, field grammars | **Domain adapter** | Health today |
| Materiality map, applicability rules, family expectations (SBC) | **Domain adapter** | Health-specific |
| Eligibility criteria types (visa, enrollment, dependent age) | Partly: the tree and Kleene evaluation are generic; criteria are per domain |  |
| Current code | Mostly health-coupled | `fact-list.ts`, `tiers.ts` and the `eligibility.ts` contexts are hard-wired health concepts inside `extraction/` |

**Boundary worth preserving now (cheap):** keep domain concepts in registry data and typed adapters, outside the verifier, store and renderer. **Defer:** a plugin system, domain packaging, and a multi-domain UI.

## 6. Auto and pet expansion

The seven provision kinds generalize, but each new domain needs its own concepts, value types and verifiers.

| Need | Auto | Pet |
| --- | --- | --- |
| New value types | Per-coverage limits written as split limits, such as 100/300/50 (per person, per accident, property) | Reimbursement percentage, annual limit, per-condition limit |
| New scope dimensions | Vehicle, driver, state or territory | Pet (species, breed, age at enrollment) |
| Time rules | Policy period, endorsement effective dates | Waiting periods per condition class (accident, illness, orthopedic), enrollment-age caps |
| Exclusions | Named-driver exclusions, business use | Pre-existing conditions, hereditary conditions by breed, "curable" versus "incurable" definitions |
| Documents | Declarations page plus policy form plus endorsements: authority and amendment proof is central | Policy plus declarations; vet-record dependence for pre-existing rules |

**Does the current architecture limit expansion?** Not structurally. The limits are the health-specific `FACTS` list and its regex grammar; replacing them with the registry (section 4) is the same work that makes the health dashboard dynamic. **V1 stays health-only.**

## 7. End-user experience: two scenarios

### Scenario A: a student uploads one health plan PDF

| Step | Ideal | Delivered today \[Code\] |
| --- | --- | --- |
| 1. Upload | Drop one PDF; optional context (age, visa, school, dates) | Yes: one to five PDFs; `ContextInputs` |
| 2. Progress | Named stages (reading pages, finding the plan, checking each benefit) and pages read out of total | A "Processing…" spinner; the lifecycle has four states (`ingestion/lifecycle.ts`) |
| 3. Identification | "Patriot Exchange, 2026–27, brochure. Refers to a certificate you did not upload" | Plan name and tiers yes; document type and missing references no |
| 4. Overview | Plain summary: costs, top exclusions, eligibility verdict for *you*, warnings | Personalized overview over the 48 facts |
| 5. Personalization | Eligibility checked against the user's facts at the right date; rows reprioritized | Eligibility interpretations; no date-aware or tree logic |
| 6. Sections and rows | Concept-driven; unknown concepts in "Mentioned, not verified" | Fixed sections from the fact list |
| 7. Citations | Every value opens the PDF at a highlighted span | Yes, for unique matches; otherwise a message |
| 8. Chat | "Is physiotherapy covered after a sports injury?" answered from verified provisions, with exclusions considered and quotes shown | Grounded RAG with quotes and refusal; not tied to verified provisions or exclusions |
| 9. Warnings | "An exclusion may apply"; "this page could not be read"; "example, not coverage" | Contradictions and verify-before-enrolling actions; no page-level unreadable warning; examples handled only by filtering |
| 10. Report | One-plan summary with citations | The export is comparison-centred and works for one plan |

### Scenario B: a user uploads three plans to compare

| Step | Ideal | Delivered today |
| --- | --- | --- |
| 1–2 | As above, with per-document progress | Same spinner for the batch |
| 3. Identification | "3 documents, 2 plans: A (SBC plus certificate), B (brochure)"; the user confirms only uncertain groupings | Each document is its own plan |
| 4. Dashboard | Differences first; scope-matched cells; eligibility verdict per plan | Compare mode with plan and tier selection (`PolicyViewControls`) over the fact list |
| 5–7 | As in A, per column | As in A |
| 8. Chat | "Which plan is cheaper for an ER visit in network?" answered from the grid with scope labels | Multi-document RAG answers, not grid-backed |
| 9. Warnings | "Plan B: deductible applies to ER"; "Plan C does not mention maternity (not expected in a brochure)" | Same-scope contradictions only |
| 10. Report | Scoped comparison with citations and unresolved items listed | Implemented over the fixed facts, with fingerprint check |

### Minimum genuinely useful product

For SBCs, plus the one or two student plan families you choose:

- correct plan grouping;
- the 15 to 20 priority concepts verified with citations;
- exclusions that can block a "covered" answer;
- honest absence;
- a page-level unreadable warning;
- eligibility verdicts for the user;
- chat that answers from the verified grid first.

**OCR, open-vocabulary discovery and authority across documents can follow**, as long as the UI says when they are missing.

## 8. Current stack inventory and alternatives

Vendor and library facts below were verified on 2026-11-14 or 2026-11-15; links are in Sources. Prices are list prices, not quotes. **No alternative has been run on our documents** \[Untested\].

### A. Document ingestion and PDF understanding

**Current \[Code\]:** pdfjs-dist text extraction, a custom `layout-tables.ts` and `table-notes.ts`, and a whole-document quality gate. **Limitation:**

- no OCR;
- no per-page coverage;
- table and reading-order quality unmeasured on real layouts;
- highlighting by text search, not stored coordinates.

| Option | Capabilities | Evidence | Performance and cost | Licence and privacy | Integration | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| **Keep pdf.js + custom** | Native text; our own table heuristics, which are fail-closed (`table-notes.ts`) | Repo tests only | In-process, free | Apache-2.0; no data leaves | None | **Keep** for native-text pages |
| Docling | Layout, reading order, TableFormer tables, OCR engines pluggable | \[Fact\] report; \[Independent\] comparisons | CPU-capable; seconds per page **\[Estimate\]** | MIT; local | Python service | **Benchmark** (PARSE-1) |
| PaddleOCR (PP-OCRv6 / PP-StructureV3) | OCR plus layout and tables; confidence scores | \[Fact\] docs | CPU or GPU; local | Apache-2.0; local | Python service | **Benchmark** (OCR-1), open option |
| Mistral OCR 4 | Hosted OCR with boxes and confidence | \[Vendor\] | About $4 per 1,000 pages \[Vendor\] | Data sent to Mistral; check DPA and retention | HTTP from Node | **Benchmark** (OCR-1), hosted option |
| Google Document AI (Layout Parser, Custom Extractor) | Layout and OCR; trainable extractor | \[Vendor\] | Custom Extractor about $30 per 1,000 pages \[Vendor\] | Google Cloud, same cloud as Cloud Run | HTTP | **Benchmark** only if the hosted OCR or extraction gap opens |
| Azure Content Understanding | Layout, OCR, field extraction (GA) | \[Vendor\] | Per-page pricing \[Vendor\] | Second cloud | HTTP | **Defer** |
| MinerU 4 | Strong parsing | \[Independent\] | GPU preferred | Custom licence with thresholds; needs legal review | Python | **Defer** (licence) |
| Marker | Strong parsing | \[Independent\] |  | Weights restricted for commercial use | Python | **Reject** (licence) |
| olmOCR | VLM OCR | \[Independent\] | GPU | Apache-2.0 | Python | Defer (GPU cost) |

**Smallest adoption:** add per-page character counts and an image-coverage check to the quality gate now (pdf.js already exposes this, no new dependency). Then benchmark one open and one hosted OCR engine on the scanned-page cases, and add the winner only for pages that fail the check.

### B. Structured extraction

**Current \[Code\]:** regex FACTS engine plus an LLM path using `response_format: json_object` (`llm/client.ts:49`). **Limitation:** a fixed vocabulary; JSON mode does not enforce a schema.

| Option | Capabilities | Evidence | Cost | Licence and privacy | Decision |
| --- | --- | --- | --- | --- | --- |
| **Strict structured outputs** (JSON Schema) on the current LLM endpoint | Guaranteed shape, not correctness | \[Fact\] OpenAI docs | No added cost | Same provider | **Improve now**: replace `json_object` where the endpoint supports it; keep the runtime validator either way |
| Per-section candidate proposer feeding the verifier (ADR-003.2) | Open vocabulary, typed by provision kind | Design plus reference tests only | LLM tokens |  | **Build** (V1 core) |
| LangExtract | Chunked multi-pass extraction with source offsets | \[Fact\] repository; "not an officially supported Google product" |  | Apache-2.0 | **Benchmark** only if long-document candidate recall is the measured gap |
| Document AI Custom Extractor | Trainable extractor | \[Vendor\] | About $30 per 1,000 pages | Google Cloud | Defer |
| Regex FACTS engine | Deterministic, cheap | Repo eval | Free |  | **Demote** to a fallback proposer; never a source of absence |

### C. Evidence verification

**Current \[Code\]:** span or quote checks, with numeric tokens only (`evidence-verification.ts:235`). **Limitation:** wording, conditions and negation are unchecked.

| Approach | Can establish | Cannot establish | Decision |
| --- | --- | --- | --- |
| Deterministic span, number and grammar checks | The quote exists; numbers, dates and enumerations match | Meaning, scope, negation in free text | **Keep and extend**: add field grammars per provision kind and negation and qualifier tokens |
| Rules (materiality map, applicability, authority) | Explicit, reviewable decisions | Anything the rules do not cover | **Build** (ADR-003.2) |
| Entailment model: HHEM-2.1-Open (Apache-2.0) or MiniCheck-RoBERTa | A sentence-level "supported or not" score | Calibrated truth without our own calibration; long cross-page context | **Benchmark** (SEM-1); enable per field only if calibrated |
| Independent LLM judge (a different model family) | Flexible semantic checks | Guarantees; it is costly and can share errors | Benchmark alongside SEM-1 |
| MiniCheck Bespoke-7B | Strong checker | (CC BY-NC: not commercial) | **Reject** |

### E. Backend, data and processing

**Current \[Code\]:**

- Next.js 15 API routes, run on Cloud Run per `docs/DEPLOYMENT.md`;
- Supabase Postgres and Storage through REST `fetch` (no client library);
- a four-state ingestion lifecycle;
- processing inside the request;
- a tmpdir fallback.

| Component | Limitation | Decision |
| --- | --- | --- |
| Next.js API routes | None demonstrated | **Keep** |
| Supabase Postgres + Storage | None demonstrated; RLS present (`0003_rls.sql`) | **Keep** |
| In-request processing | Long documents and an added OCR step may exceed request budgets **\[Estimate\]** | **Measure** p95 processing time; move to a background job (Cloud Tasks or a Cloud Run job) only if needed |
| tmpdir fallback | Non-durable; inconsistent state | **Remove** in production |
| Python document service | Justified only by an OCR or layout benchmark winner that is Python-only | **Decide after OCR-1 and PARSE-1** |
| Port and health-check mismatch | The health probe hits the wrong port | **Fix** |

### F. Frontend

**Current \[Code\]:** React and Next.js with custom components (`AdaptiveResults`, `ComparisonTable`, `PdfEvidenceViewer`). **Decision: keep.** Add the view-model renderer (section 4), with TanStack Table optional. No framework change.

### G. Evaluation, testing and monitoring

**Current \[Code\]:**

- Vitest: 109 unit files, plus contract and integration suites;
- Playwright end-to-end tests;
- `evals/run.mjs` gold sets (10/10/10 and 36/12/12 questions);
- the realbench (3 PDFs, 8 questions);
- trace and timing modules;
- **no CI**.

| Tool | Benefit for us | Cost | Decision |
| --- | --- | --- | --- |
| **CI (GitHub Actions)** running Vitest, the trust-boundary tests and the synthetic evals | Catches regressions | Low | **Add now** |
| **A larger labelled corpus** | The only way to make any decision in this review | Annotation time | **Required** (section 12) |
| Promptfoo (MIT; being acquired by OpenAI) | Red-team and regression suites for prompts | Low to medium | Defer; our own harness suffices for now |
| Langfuse or OpenTelemetry | LLM traces, cost, latency | Medium; privacy review needed (traces contain document text) | **Defer** until production traffic; if adopted, prefer OpenTelemetry with redaction |

## 9. FAISS versus pgvector versus other retrieval systems

### What the repository actually implements \[Code\]

- **Chunks:** 512-token windows with overlap per page, an optional detected section heading, and character offsets (`rag/chunks.ts`).
- **Storage:** a `chunks` table with `embedding vector(1024)` and a generated `fts tsvector` (English); a **global HNSW cosine index** and a GIN index (`db/migrations/0001_init.sql`).
- **Semantic leg:** the `match_chunks` RPC orders by `<=>`, filtered by `documents.owner_session` *in the same query* (`postgres-vector.ts`). If Postgres is not configured, it falls back to **exact brute-force cosine in process memory** (`rag/cosine-index.ts`).
- **Keyword leg:** `fts_search_chunks` with `websearch_to_tsquery` and `ts_rank`. `ts_rank` is a frequency-based rank, **not BM25**: no length normalization and no corpus statistics.
- **Hybrid:** `rag/fusion.ts` implements RRF (k = 60, top 10 per leg, top 5 fused).
- **Selected path:** **semantic-only.** Lexical line-overlap is used only as a fallback, and a cosine "usefulness floor" of 0.43 decides refusal (`answer.ts:352–394`). The selection comment cites semantic MRR@10 = 0.8438 versus RRF 0.6875 \[Repo-measured\].
- **Embeddings:** an OpenAI-compatible endpoint; the floor was calibrated on `qwen3-embedding:0.6b` (1024 dimensions).
- **Reranking:** none.
- **Post-check:** each returned quote must appear verbatim on its page.

### Measurable weaknesses

1. **The evidence for semantic-only is too small to choose a retriever.** The gold partitions have 10 questions each (8 answerable), over 2 synthetic fixture PDFs. On VALIDATION, the paraphrase subset scored recall@5 = 0 \[Repo-measured\]. A difference of 0.84 versus 0.69 MRR on about 8 questions is within noise.
2. **Exact-term recall is at risk.** Insurance questions turn on exact tokens: "pre-existing", "waiting period", "Tier 1", plan codes, CPT-like terms. Semantic-only retrieval with a floor tuned on four chunks will miss some of these; this is a known hybrid-search motivation \[Independent\]. Not yet measured on our corpus \[Untested\].
3. **Filtered approximate search can drop results.** pgvector's documentation states that with approximate indexes, *filtering is applied after the index is scanned*. With HNSW at the default `hnsw.ef_search` of 40 and a condition matching 10% of rows, only about 4 rows match on average ([pgvector docs, mirrored](https://docs.pgedge.com/pgvector/v0-8-2/filtering/)) \[Fact\]. Our session filter will match far less than 1% of rows once many sessions exist. Iterative scans (pgvector 0.8.0 and later) fix this, but are **off by default** ([PostgreSQL announcement](https://www.postgresql.org/about/news/pgvector-0.8.0-released-2952/)) \[Fact\]. Whether our planner chooses the HNSW path depends on table size \[Untested\].
4. **No reranker, and the fused top 5 is tight** for questions whose answer and restriction live in different chunks.
5. **Restrictions are left to retrieval.** Nothing guarantees an exclusion or footnote is retrieved alongside the benefit. This is the critical failure mode, and **no retrieval engine solves it alone** (see the verification note below).

### Workload

One session holds at most 5 PDFs. A 60-page certificate is roughly 60 to 120 chunks, so **about 100 to 600 vectors per session** \[Estimate\]. Exact cosine over 600 vectors of 1024 dimensions is about 0.6 million multiply-adds: **sub-millisecond on a CPU, about 2.4 MB in memory** \[Estimate\]. Approximate indexing buys nothing *within* a session; it only matters for searching *across* all sessions, which we never do.

### Comparison

| Option | Fits the workload | Filtering, ownership, deletion | Quality levers | Infrastructure and maintenance | Licence | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| **pgvector, exact per session** (filter first, no ANN) | Ideal: perfect recall, sub-ms per session **\[Estimate\]** | Same rows as documents; RLS; one `DELETE` removes text, vectors and FTS together | Combine with FTS and a reranker in SQL or the app | None new | PostgreSQL licence | **Adopt (improve in place)** |
| pgvector HNSW with iterative scan | Works if the extension is 0.8.0 or later | As above | As above | Must confirm the Supabase extension version | Same | Acceptable alternative; adds tuning |
| Postgres FTS (`ts_rank`) | Fine for scale | Same | Exact terms, but weak ranking | None | Same | **Keep**, then benchmark against BM25 |
| BM25 inside Postgres (ParadeDB `pg_search`; others) | Fits | Same | True BM25 \[Fact\] | Extension must be available on our Postgres host (unverified for Supabase) | AGPL for `pg_search` (verify) | **Benchmark only if** FTS is the measured weak leg |
| **FAISS** | Overkill: built for billion-scale similarity search, with GPU options ([FAISS](https://github.com/facebookresearch/faiss)) \[Fact\] | A library: vectors keyed by integers; **no metadata store, no access control, no transactions with Postgres**. Deletion means a separate `remove_ids` plus index files to purge | None beyond pgvector exact search at our size | A second store to keep in sync, back up, and **delete from for privacy**; Python or C++ (Node bindings are unofficial) | MIT \[Fact\] | **Reject**: no accuracy gain (exact search is already exact), no meaningful speed gain at 600 vectors, and a new privacy surface |
| Qdrant | Fits | Strong payload filtering; multitenancy via an `is_tenant` keyword index, with points stored per tenant ([Qdrant docs](https://qdrant.tech/documentation/deploy-and-scale/multitenant-search/)) \[Fact\] | Built-in sparse BM25 and hybrid | A new service, network hop and second deletion path | Apache-2.0 | **Reject for V1** |
| Milvus | Built for tens of billions of vectors | Partition key for millions of tenants \[Vendor\] | Server-side BM25 \[Vendor\] | Heaviest to operate | Apache-2.0 | **Reject** |
| Weaviate | Fits | Native multi-tenancy, a shard per tenant \[Vendor\] | Hybrid search and modules | New service | BSD-3 core, with a commercially licensed directory \[Vendor\] | **Reject for V1** |
| Reranker: bge-reranker-v2-m3 (568M, Apache-2.0) or a hosted reranker | Re-scores the top 20 to 50 | n/a | Cross-encoder precision | A model to host, or an API call | Apache-2.0 ([model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)) | **Benchmark** (RET-1) |
| Contextual retrieval (a chunk-context prefix written by an LLM at indexing time) | Fits | n/a | Anthropic reports top-20 retrieval failure falling 35% with contextual embeddings, 49% adding contextual BM25, and 67% with reranking, on its own datasets ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)) \[Vendor\] | LLM cost per indexed document | n/a | **Benchmark** after hybrid and reranking |

### Recommendation

**pgvector stays, but not as configured.** The smallest changes, in order:

1. **Make the semantic leg exact per session.** Filter by the session's document ids first, then `ORDER BY embedding <=> q`. Drop or bypass the global HNSW index; or, if it stays, run `SET LOCAL hnsw.iterative_scan = strict_order` after confirming `extversion` is 0.8.0 or later. Write a test that seeds 1,000 sessions and asserts complete top-k for one of them.
2. **Re-enable hybrid search (FTS plus semantic, RRF) as the candidate generator, and over-fetch:** 30 to 50 per leg, not 10.
3. **Benchmark a reranker** on the fused candidates (RET-1).
4. **Section-aware chunking.** Chunk at headings; keep exclusion lists and benefit tables with their footnotes; store section role and page coordinates.
5. **Expand queries** with concept-registry aliases ("ER" to "emergency room").

**Change technology only if RET-1 shows the Postgres keyword leg is the bottleneck.** Then try a BM25 extension in the same database before any external engine.

**Retrieval cannot replace verification.** Higher recall makes it *likelier* that an exclusion reaches the model. It never establishes that a benefit is covered. Coverage answers must come from verified provisions plus a resolver-issued resolution, which **always pulls every exclusion in the plan's inventory**, retrieved or not.

## 10. Shortlist and technology decision matrix

**Shortlist one engineer can evaluate.** At most two candidates per question, each run only when a measured gap calls for it.

| Question | Candidates | Run when |
| --- | --- | --- |
| OCR for scanned pages | PaddleOCR (open) versus Mistral OCR 4 (hosted) | Now: scanned pages are a known gap |
| Layout and table parsing | Current pdf.js + custom versus Docling | If table or reading-order errors are at least 25% of misses in the first error analysis |
| Retrieval | Exact semantic versus FTS versus hybrid RRF, each with and without bge-reranker-v2-m3 | Now: cheap, and it decides the chat path |
| Semantic verification | HHEM-2.1-Open versus an independent LLM judge | After the deterministic verifier and grammars exist |
| Candidate proposer for long documents | Our per-section proposer versus LangExtract | Only if candidate recall is the measured gap |

**Decision matrix:**

| Component | Current | Decision | Why |
| --- | --- | --- | --- |
| Next.js 15, React, TypeScript | Yes | **Keep** | No demonstrated limitation |
| Cloud Run | Yes | **Keep**; fix the port and health check | Defect, not a platform issue |
| Supabase Postgres + Storage + RLS | Yes | **Keep** | One store for text, vectors and deletion |
| pgvector | HNSW global, filtered | **Improve**: exact per session, or iterative scan | Documented post-filter behaviour |
| Postgres FTS | `ts_rank`, unselected | **Improve**: use in hybrid; benchmark BM25 later | Exact-term recall |
| FAISS | No | **Reject** | No gain at our size; adds a privacy surface |
| Qdrant, Milvus, Weaviate | No | **Reject for V1** | Workload does not justify a service |
| Reranker | No | **Benchmark** | Likely the largest cheap quality gain **\[Estimate\]** |
| pdf.js text extraction | Yes | **Keep** | Correct for native text |
| Custom layout and table code | Yes | **Keep**, then benchmark against Docling | Unmeasured on real layouts |
| OCR | None | **Benchmark, then add** | Known gap |
| Regex FACTS inventory | Drives rows and absence | **Replace** (approach): concept registry plus proposer plus verifier | Fixed vocabulary; unsafe absence |
| LLM output mode | `json_object` | **Improve**: strict schema plus the runtime validator | Shape guarantee |
| Numeric-only claim checks | Yes | **Improve**: field grammars, qualifiers, negation | Wording unchecked |
| Semantic checker | No | **Benchmark** (SEM-1) | Only if calibrated |
| pdf-lib report | Yes | **Keep** | Works |
| Vitest and Playwright | Yes | **Keep**; add CI |  |
| Promptfoo, Langfuse | No | **Defer** | Not yet justified |
| Python service | No | **Decide after OCR-1 and PARSE-1** | Only if the winner needs it |
| LangChain / LlamaIndex | No | **Reject** | Our boundary is custom by necessity |

## 11. Critical gaps, risks and V1 scope

**Critical gaps and risks, highest first:**

1. **The evaluation corpus is too small to make any decision**: 2 fixture PDFs, 3 local PDFs, 8 real questions. Every "benchmark" decision above depends on fixing this.
2. **Absence from regex misses** produces false "not stated" answers.
3. **No exclusion applicability**, so "covered" can be shown while an exclusion applies.
4. **Filtered ANN drops results** as sessions accumulate \[Fact, untested on our DB\].
5. **Partly scanned PDFs may lose pages silently.**
6. **No CI**, so regressions go unnoticed.
7. **Your recovery tree is unseen**, so some of the above may already be fixed.
8. **Privacy:** filenames in logs; the tmpdir fallback.

**V1 scope:**

| V1 Required | V1 Improvement | Future platform |
| --- | --- | --- |
| Single-plan overview and multi-plan compare for SBCs plus 1 to 2 student plan families | OCR for scanned pages (if OCR-1 is not ready by V1, a clear page-level warning instead) | Auto, pet, home and renters adapters |
| Concept registry plus verifier; 15 to 20 priority concepts verified per family | Docling or layout upgrade (if PARSE-1 wins) | Open-vocabulary discovery beyond "mentioned, unverified" |
| Honest absence; per-page coverage warnings | Reranker (if RET-1 wins) | Cross-document authority across many amendments |
| Exclusion inventory and applicability; a "cannot be confirmed" state | Semantic checker per field (if SEM-1 is calibrated) | User-confirmed document relations |
| Eligibility verdicts with dates for user facts | TanStack Table grouping and faceting | Multilingual SBCs |
| Plan grouping by verified identity | Contextual retrieval | Observability stack |
| Grid-first chat answers with citations | Background processing (if p95 requires it) |  |
| Exact per-session hybrid retrieval |  |  |
| The three trust-boundary tests passing in the app; CI |  |  |
| Deletion of bytes, rows and vectors; no document text or filenames in logs |  |  |

**Measurable V1 acceptance criteria** (held-out set; statistics per ADR-003.1 section 4):

| Criterion | Target |
| --- | --- |
| S1 errors (a wrong value, wrong coverage, or a missed applying exclusion shown as verified) | **0** on at least 59 held-out documents, giving a 95% upper bound of at most 5% |
| Verified recall of priority concepts per family | At least 80%, with no family below 70% |
| False "not found" where the document states the concept | At most 2% of priority cells |
| Plan-grouping accuracy | 100% on the held-out multi-document sessions |
| Evidence recall@10 (all gold passages, including restrictions) | At least 95%; restriction recall at least 95% |
| Citation fidelity (the cited span supports the value) | 100% of verified cells |
| Chat: unsupported material claims | 0 on the chat set; refusal precision at least 90% |
| p95 end-to-end processing per document | Set from measurement; at most 60 s target **\[Estimate\]** |
| p95 chat latency | At most 6 s **\[Estimate\]** |
| Privacy | Deletion test passes; log scan finds no document text or filenames |

## 12. Bounded benchmark plan

**Corpus (one engineer, about 3 to 4 weeks of labelling)** \[Estimate\]. About 70 documents, split 25 dev / 15 validation / 30 held-out, grouped by document so no document crosses splits:

| Slice | Documents | Covers |
| --- | --- | --- |
| SBCs, at least 6 insurers | 30 | Standard template; network tiers; "excluded services" lists; coverage examples (must not count as coverage) |
| Student / international plan brochures and certificates | 20 | Long benefit tables; cross-page footnotes; eligibility; general exclusions; visa rules |
| Multi-document sets (SBC + certificate, certificate + rider, rate sheet) | 10 sets | Grouping; amendments; conflicting clauses |
| Scanned or partly scanned | 8 | OCR; page-level unreadable warnings |
| Adversarial | 5 | Hypothetical examples; "see certificate"; prompt-injection text |

**Labels:**

- per document: plan identity, family and relations;
- per priority concept and scope: value, conclusion, evidence span, conditions;
- every exclusion, with the services it reaches;
- about 150 questions with gold passages, of which **at least 40 require a restriction or exclusion passage**;
- page readability.

**Rules for every experiment:** the same inputs, labels, questions and resource limits for every option. Compare **end-to-end** results (verified cells, S1, chat claims), not parser or retrieval scores in isolation. Dev is used for tuning, validation is used once for selection, and held-out is looked at once.

| ID | Compares | Primary metrics | Would change a decision? |
| --- | --- | --- | --- |
| **RET-1** | Exact semantic / FTS / hybrid RRF, each with and without a reranker; top-k 5 versus 10 | Evidence recall@10, **restriction recall@10**, MRR, p50/p95 latency | **Yes**: selects the chat retriever and the reranker |
| **OCR-1** | PaddleOCR versus Mistral OCR 4 on scanned pages | Character error rate on money and percent tokens; S1 downstream; cost per page | **Yes**: decides OCR and whether a Python service is needed |
| **PARSE-1** | pdf.js + custom versus Docling on tables and footnotes | Table cell accuracy; verified recall; S1 | **Yes**, if layout errors dominate misses |
| **SEM-1** | HHEM-2.1-Open versus an LLM judge, per field | Conditional false-accept rate; over-refusal | **Yes**: enables or disables the semantic tier per field |
| **FILT-1** | HNSW plus session filter versus exact, with 1,000 seeded sessions | Completeness of top-k | **Yes**: confirms the pgvector change (cheap) |
| EXT-1 | Our proposer versus LangExtract | Candidate recall on long documents | Only if candidate recall is the measured gap |

**Not worth running now:** vector-DB speed benchmarks (FAISS, Qdrant, Milvus, Weaviate), since the workload is about 600 vectors per session; GPU OCR models; Azure versus Google bake-offs; more embedding-model sweeps before RET-1 shows the embedding is the bottleneck.

## 13. Prioritized implementation sequence

1. **Reconcile the recovery tree** (sanitized patch), then re-confirm each code finding above against it.
2. **Add CI**, the three trust-boundary tests, the port and health fix, and remove the tmpdir fallback and the filename logging.
3. **Build the corpus and labels** (section 12) in parallel with steps 4 to 6.
4. **Retrieval fixes:** exact per-session semantic search, hybrid on, over-fetching; then RET-1 and FILT-1.
5. **Per-page coverage and unreadable warnings** in the quality gate. Replace "not stated" with "not found in read pages".
6. **Strict structured outputs** plus the runtime validator.
7. **Concept registry plus view model plus renderers** (section 4), with the regex engine demoted to a fallback proposer.
8. **Verifier and store boundary** (ADR-003.2): field grammars, the seal, the registry, identity binding.
9. **Exclusion inventory and applicability**, eligibility trees, and plan grouping.
10. **Grid-first chat answers** and render-only-issued resolutions on every surface.
11. **OCR-1**, and add the winner. Then **PARSE-1** and **SEM-1** only if the error analysis calls for them.
12. **Held-out run** against the V1 acceptance criteria, then release.

Steps 1, 2 and 4 are days of work, not weeks **\[Estimate\]**, and remove the most risk per hour.

## Sources

Repository: GitHub `AkhilTejaDoosari/insurance-simplified` at `15f8cc2`; branch refs via `git ls-remote` (2026-11-15). Code paths are cited inline.

**Retrieval** (accessed 2026-11-15):

- [pgvector filtering, mirrored docs](https://docs.pgedge.com/pgvector/v0-8-2/filtering/) and [iterative index scans](https://docs.pgedge.com/pgvector/v0-8-5/iterative-index-scans/)
- [pgvector 0.8.0 release announcement](https://www.postgresql.org/about/news/pgvector-0.8.0-released-2952/)
- [Crunchy Data: hybrid search patterns with pgvector](https://www.crunchydata.com/blog/hybrid-vector-search)
- [Supabase hybrid search guide](https://supabase.com/docs/guides/ai/hybrid-search)
- [FAISS repository](https://github.com/facebookresearch/faiss)
- [Qdrant multitenancy design](https://qdrant.tech/documentation/deploy-and-scale/multitenant-search/)
- [Milvus vs Weaviate (Milvus-authored)](https://milvus.io/compare/milvus-vs-weaviate)
- [Weaviate multi-tenancy architecture](https://weaviate.io/blog/weaviate-multi-tenancy-architecture-explained)
- [ParadeDB RRF docs (pg\_search)](https://api.pgxn.org/src/pg_search/pg_search-0.25.7/docs/documentation/hybrid/rrf.mdx)
- [bge-reranker-v2-m3 model card](https://huggingface.co/BAAI/bge-reranker-v2-m3/blame/main/README.md)
- [Anthropic: Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)

**Frontend** (accessed 2026-11-15): [TanStack Table features](https://tanstack.com/table/latest/docs/guide/features)

**Document AI, extraction and verification** (accessed 2026-11-14; full list in ADR-003):

- [Docling technical report](https://arxiv.org/html/2408.09869v1)
- [PaddleOCR](https://www.paddleocr.ai/latest/en/index.html)
- [MinerU 4.0 release](https://newreleases.io/project/github/opendatalab/MinerU/release/mineru-4.0.0-released)
- [Datalab / Marker licence terms](https://documentation.datalab.to/docs/on-prem/overview)
- [Mistral OCR 4](https://mistral.ai/news/ocr-4)
- [Azure Content Understanding](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/overview)
- [Google Document AI pricing](https://cloud.google.com/products/document-ai/pricing)
- [LangExtract](https://github.com/google/langextract)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [HHEM-2.1-Open](https://huggingface.co/vectara/hallucination_evaluation_model)
- [Bespoke-MiniCheck-7B licence](https://huggingface.co/bespokelabs/Bespoke-MiniCheck-7B)
- [OpenAI to acquire Promptfoo](https://openai.com/blog/openai-to-acquire-promptfoo)

**Related records:** [ADR-003](https://claude.ai/artifact/Jyg3m5Er2tmsTC3waRcPDf), [ADR-003.1](https://claude.ai/artifact/9pw2oWrj347rchbwTtpgLn), [ADR-003.2](https://claude.ai/artifact/4SmeLVYaYHSeaRqvVjpqvf)
