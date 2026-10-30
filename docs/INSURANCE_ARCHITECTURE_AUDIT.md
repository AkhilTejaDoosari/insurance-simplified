# INSURANCE SIMPLIFIED — INDEPENDENT PRODUCT & ARCHITECTURE AUDIT

**Date:** 2026-10-27 · **Auditor:** Independent review (no role in prior design decisions)
**Scope:** Read-only audit of the repository at `feat/rag-core` (d17a12b, with extensive uncommitted work preserved).
**Authorization:** Inspection + this document only. No code, tests, config, or other docs modified.

Evidence labels used throughout:
**[VERIFIED FROM SOURCE]** (file/symbol inspected), **[OBSERVED FROM EXISTING TESTS]**, **[INFERRED]**, **[UNKNOWN]**.

---

## 1. Executive Verdict

The evidence-safety spine of this codebase is unusually strong and worth keeping: fail-closed citation verification, material-token grounding, session capability auth, scope-before-retrieval, and refusals that never invent. That spine is the hardest part of the product to build and this repo built it well.

The product intelligence on top of that spine is where the system falls short of its approved vision. The approved product spec says the system must **discover** what matters from the actual uploaded documents ("AI may discover and rank relevant factors", no fixed comparison inventory). The implementation instead runs every document through a **closed 43-fact regex inventory** (`app/lib/extraction/fact-list.ts:17-66`) that constrains both the deterministic and the LLM extraction engines, and recognizes plan identity through **source-specific regex patches written for exactly the three acceptance brochures** (`app/lib/extraction/plan-identity.ts:27-36`). The system can reorganize a fixed vocabulary; it cannot yet genuinely *discover* one.

The much-discussed "adaptive presentation planner" is, in the running UI, 100% deterministic: the LLM-proposal path (`validatePresentation`, `app/lib/presentation/adaptive.ts:420-543`) is **never invoked** — `app/components/AdaptiveResults.tsx:44` and `app/lib/report/pdf.ts:345` both call `buildPresentation(table, view, userContext)` with no proposal. Only tests exercise the adaptive path.

**Verdict:** PARTIAL product–architecture alignment. **Option B — targeted boundary refactor.** No rewrite is justified: the safety chain, session/storage/auth, RAG degradation ladder, V5 table, and approved frontend should be kept. The delta is concentrated in three places: (1) replace the closed fact inventory with dynamic, evidence-constrained fact discovery behind the existing table contract; (2) generalize plan-identity attestation without weakening C6; (3) restore session state client-side and finish the real-PDF vertical slice.

---

## 2. Product Vision and Non-Negotiable Requirements

Source: `AGENTS.md` product rules, `docs/PRODUCT.md`, `docs/V1_1_REVIEW_PACKAGE.md`, and the audit brief. Non-negotiables observed in code and docs:

- 1–5 PDFs per session; up to 3 plans displayed in comparison; verified-plan count ≠ PDF count.
- Documents determine facts; AI determines organization/emphasis; deterministic rules decide what may be claimed.
- Every claim carries original-page evidence; citations verify fail-closed; NOT STATED ≠ NO.
- Cross-document value differences are comparison data, never CONFLICTED (owner-approved protected semantics; `app/lib/extraction/extract.ts:512-522`, enforced again in `reconcileLlmTable`, extract.ts:819-831).
- Unassigned evidence must never become a verified plan benefit (C6; `hasPlanValueProof`, `app/lib/extraction/types.ts:117-128`; `attributePlanScope`, plan-identity.ts:144-163).
- Chat respects active document/plan/tier scope (`app/lib/rag/selection-scope.ts:73-201`); export reproduces the active view (`app/api/export/route.ts:96-169`).
- Approved visual design (Page 1 + V5 Page 2) is not to be redesigned without demonstrated need.

**Critical observation:** the approved spec's demand for discovered, document-specific dimensions is *not yet* implemented; the row inventory (`fact-list.ts`) and the five fixed sections (`app/lib/extraction/sections.ts:22-…`, titles "My Fit" / "My Costs" / "Coverage" / "Limits & Risks" / "Evidence & Actions") are a surviving artifact of the superseded fixed-layout design.

---

## 3. Current Architecture and Data Flow

### 3.1 Inventory (what actually runs) — [VERIFIED FROM SOURCE]

| Area | Implementation | Key symbols |
| --- | --- | --- |
| UI shell | Single client-side SPA state machine in `app/page.tsx` (`Page = "welcome"|"upload"|"checklist"|"results"`, lines 38, 78) | `Home`, `runExtract`, `downloadPdf` |
| Upload | `app/api/upload/route.ts` — 1–5 PDFs (lines 37-38), ≤20 MB / ≤200 pages, `unpdf` text-layer extraction (`app/lib/pdf/extract-pages.ts:5,66`), quality gate (`app/lib/ingestion/quality-gate.ts`), durable Supabase session + capability cookie w/ tmpdir fallback | `POST`, `createSessionDb` |
| Storage | Session-scoped content-addressed object store, private-by-construction (`app/lib/storage/objects.ts:56-65, 349-377`); Supabase Storage adapter over plain fetch (`:238-313`); non-overwriting `put` (`wx` flag / `x-upsert: false`) | `sessionObjectKeyFor`, `putDocumentBytes` |
| Session auth | High-entropy capability (256-bit), timing-safe hash verify, DB-first w/ tmpdir fallback (`app/lib/session-auth.ts:44-110`, `app/lib/session.ts:63-80`) | `requireSessionCapability` |
| Session state | **tmpdir JSON file** (`os.tmpdir()/insurance-simplified-sessions`, `session.ts:43-47`) holding full per-page text of every upload, plus evidence registry; Supabase DB row for durable metadata | `getSession`, `registerEvidence` |
| Extraction | Two engines: deterministic regex over `FACTS` (`app/lib/extraction/extract.ts:414-541`) and LLM constrained to the same fact list (`EXTRACTION_INSTRUCTIONS`, extract.ts:543-563); schema validation (`validateTable`, types.ts:153-287) | `extractFallback`, `extractViaLlm` |
| Plan identity | Closed regex attestation set incl. document-specific patterns (plan-identity.ts:27-36); C6 value attribution by word-boundary plan-name mention inside the value's own citations (`:99-139`) | `attestPlans`, `resolveValuePlanId` |
| Evidence safety | Fail-closed citation verification (unique normalized span, wrap-hyphen, ellipsis repair ≤600 chars) (`app/lib/evidence-verification.ts:165-201`); material-token display grounding (`:247-265`); evidence IDs minted at session boundary | `verifyEvidenceCitation`, `checkDisplayGrounding` |
| RAG chat | Deterministic scope masking → semantic retrieval (pgvector persistent or in-memory cosine, OpenAI-compatible embeddings) → lexical fallback → LLM answer with near-verbatim constraint → claim verification (a/b/c) → fixed refusal (`app/lib/rag/answer.ts:573-734`, `app/api/chat/route.ts`) | `scopeDocumentsForChat`, `answerViaLlm`, `verifyAnswerClaims` |
| Retrieval | 512-token page-preserving chunks (`app/lib/rag/chunks.ts:21-23, 94-134`), pgvector + Postgres FTS (`app/lib/rag/postgres-vector.ts`, `postgres-fts.ts`), fusion seam (`fusion.ts`) | `chunkDocument`, `retrieveFused` |
| Presentation | Deterministic block projector: 6 block types, fixed heading regexes, fixed priority bands (`app/lib/presentation/adaptive.ts:106-117, 290-298, 299-408`); unused LLM-proposal validator (`:420-543`); three overlapping grouping systems (`sections.ts`, `presentation-groups.ts`, `workspace-groups.ts`) | `deterministic`, `buildPresentation` |
| Export | Persisted-result snapshot + validated selection contract → pdf-lib projection (`app/api/export/route.ts:96-169`, `app/lib/report/pdf.ts:216`) | `buildReportPdf` |
| Tests | 100 test files (86 unit, 3 contract, 7 integration incl. env-gated real-PDF, 4 Playwright E2E flows) | `tests/` |
| Observability | Minimal timing/trace helpers (`app/lib/observability/`) | `timeAsync`, `emitTrace` |

### 3.2 Data flow diagram

```mermaid
flowchart TD
    B[Browser: page.tsx SPA] -->|POST formData| U[/api/upload]
    U --> P[unpdf text-layer extraction] --> QG[ingestion quality gate]
    QG --> SDB[(Supabase: sessions row + capability)]
    QG --> OS[(Object store: private PDF bytes)]
    QG --> TMP[/tmpdir session JSON: full page text + evidence registry/]
    B -->|POST sessionId| E[/api/extract]
    E --> ENGINE{LLM configured?}
    ENGINE -->|yes| LLM[extractViaLlm: FACTS-constrained prompt]
    ENGINE -->|no| RE[extractFallback: regex over FACTS]
    LLM --> NORM[normalizeLlmTable → dropEvidenceLessValues → reconcileLlmTable]
    NORM --> V[validateTable]
    RE --> V
    V --> PI[attestPlans regex → attributePlanScope C6]
    PI --> EV[verifyEvidenceCitation fail-closed + checkDisplayGrounding]
    EV --> PG[proposeGroups: LLM titles, sanitized]
    EV --> CR[(comparison_results table, 30-day TTL)]
    B -->|POST question + selection| C[/api/chat]
    CR --> SS[scopeDocumentsForChat: mask unselected lines]
    SS --> SEM[semantic: pgvector / in-memory cosine] --> FUS[fallback ladder → lexical]
    FUS --> CLM[LLM answer, near-verbatim constraint]
    CLM --> VA[verifyAnswerClaims a/b/c → refusal on any failure]
    B -->|POST selection| X[/api/export]
    CR --> X --> RP[buildReportPdf from frozen snapshot]
```

### 3.3 State ownership

[VERIFIED FROM SOURCE] The **authoritative working state lives in tmpdir** (`session.ts:1-7` explicitly claims file-backed state is shared across "production" servers — on stateless Cloud Run this is wrong: tmp is per-container and evictable, so page text and the evidence registry can vanish mid-session while DB rows persist). The durable copies (DB session row, object-store bytes, comparison_results) exist but the extraction path reads page text **only** from the tmpdir session (`extract/route.ts:78-93`). This is a latent Cloud Run failure mode and contradicts `AGENTS.md` §14 ("production Cloud Run is stateless compute… if a later request needs it, persist it in the approved durable owner").

---

## 4. Product–Architecture Alignment

**PARTIAL.** Aligned: evidence contract, session auth/storage, scope-safe chat, export reproducibility, V5 table, approved visual design. Misaligned:

1. **Closed comparison inventory vs. "AI may discover and rank relevant factors."** The row universe is `FACTS` (43 entries with hand-tuned regexes; fact-list.ts:17-66). The LLM engine is instructed "Facts to extract (one row each): ${FACTS.map(f => f.name)}" (extract.ts:545) — the model can never emit a fact outside the list. Any benefit concept not in the list (e.g., "trip cancellation", "concierge", "sports rider") is invisible to comparison. [VERIFIED FROM SOURCE]
2. **Plan identity is a closed regex set tuned to the acceptance documents.** plan-identity.ts:27-36 contains patterns for "Policy/Plan name:", the WorldTrips "Get X insurance from Y" title, "Seven Corners Travel Medical[...]", and the IMG "X Program℠ + Certificate of Insurance" title pair. These are patches for the three test brochures, not a discovery mechanism. A carrier that formats its title differently yields zero proven plans, and with `<2` plans the compare mode is disabled entirely (page.tsx:416). [VERIFIED FROM SOURCE; generalization gap INFERRED from the pattern set]
3. **Presentation adaptivity is dormant.** `validatePresentation` (the path that would let a model organize blocks) is only referenced from tests; the UI always uses the deterministic projector, which selects among 6 fixed block types and 5 fixed heading families derived from concept-name regexes (adaptive.ts:332-355). [VERIFIED FROM SOURCE]
4. **LLM decision surface is small and elsewhere over-policed.** The model meaningfully decides: (a) tier splitting per the very detailed tier-table prompt (extract.ts:551-555), (b) group titles/membership (presentation-groups.ts:65-102, sanitized), (c) chat answer wording, which is then forced near-verbatim by sentence-token verification (evidence-verification.ts:385-394). Everything downstream is deterministic. That is the right *direction*, but (c) over-constrains readability and (a)-(b) operate inside a fixed fact universe.

**Is the system genuinely dynamic or only partially dynamic?** Partially. It adapts *ordering*, *tier decomposition*, *group titles*, and *scope filtering*. It does not adapt the *set of facts*, the *set of proven plans*, or the *block taxonomy* to the documents.

---

## 5. Genuine Adaptivity Assessment

| Kind | Degree | Evidence |
| --- | --- | --- |
| **Fact adaptivity** (what can be extracted from unseen docs) | **MOSTLY FIXED** | Both engines enumerate `FACTS` (extract.ts:424 `FACTS.map(...)`, :545). Regex engine matches line-by-line keyword patterns (extract.ts:355-412); LLM is schema- and name-constrained. Unknown concepts have no row, no label, no section. [VERIFIED FROM SOURCE] |
| **Reasoning adaptivity** (what matters; what is comparable) | **MOSTLY FIXED, small dynamic layer** | Prioritization is regex-scored on concept names in fixed bands (`impact()`, adaptive.ts:290-298). The one genuinely adaptive reasoning step is `proposeGroups` (LLM-chosen group titles over extracted factNames; presentation-groups.ts:65-102). Qualifier compatibility for comparison is handled by scope keys (`applicabilityScopeKey`, extract.ts:66-157) — deterministic and sound. [VERIFIED FROM SOURCE] |
| **Presentation adaptivity** (novel organization) | **FIXED** (dormant LLM path exists) | `buildPresentation` w/o proposal (AdaptiveResults.tsx:44; report/pdf.ts:345). `validatePresentation` can only re-select among deterministic headings and fact IDs — even if wired up it could not invent new headings (adaptive.ts:442-443 requires `headings.has(b.heading)`). [VERIFIED FROM SOURCE] |

Do not confuse the dynamic *reordering* of a fixed row set with adaptive analysis: that is what today's "adaptive" layer does. Reordering 43 fixed rows is not document-specific intelligence.

---

## 6. AI/RAG and Evidence Safety Review

### 6.1 Extraction pipeline — [VERIFIED FROM SOURCE]

- **PDF text extraction:** text layer only via `unpdf`; no OCR (explicit: quality-gate.ts header "OCR IS NOT IMPLEMENTED"; scanned PDFs rejected as `document_unreadable`). Honest, but a real product limitation for insurance PDFs.
- **Dual-engine:** fallback regex engine is the credential-free default; LLM engine opt-in when `LLM_*` configured (extract/route.ts:83-93).
- **Schema:** `comparison-schema v1`, closed verdict vocabulary, strict evidence rules (`validateTable`); boundary reconcilers strip model-asserted interpretations (`DERIVED_ONLY_KEYS`, extract.ts:585) and coerce qualifiers. Strong.
- **Evidence verification:** excellent. Unique contiguous normalized span; conservative ellipsis repair capped at 600 chars; canonical verbatim quote stored, never model text (evidence-verification.ts:105-201). The recorded baseline (real-document plan, docs/superpowers/plans/2026-10-26-real-document-accuracy-correction.md:32-40: 446 citation checks, 72 ambiguous-span failures, 0 wrong-page) shows the verifier failing closed correctly. [OBSERVED FROM EXISTING TESTS]
- **Display grounding:** every digit-bearing display token must appear in the union of verified citations (evidence-verification.ts:230-265). Strict and deterministic; will cause legitimate NEEDS VERIFICATION rows when the LLM paraphrases numbers — the intended tradeoff.

### 6.2 The C6 attribution stack — the real bottleneck

Three layers, progressively conservative:

1. `attestPlans` — plan must be declared by regex (closed set). [VERIFIED FROM SOURCE]
2. `resolveValuePlanId` — a value joins a proven plan only when its **own cited quote** mentions exactly one proven plan name (word-boundary; plan-identity.ts:99-139).
3. `hasPlanValueProof` — any *model-claimed* planId survives validation only when a citation equals the artificial string `"plan name: {name}; {fact}: {display}"` (types.ts:117-128). Real brochures never contain that string, so on real documents the model's plan attribution is effectively always discarded, leaving mention-matching (layer 2) as the only live path.

Consequence: values whose quotes don't repeat the plan name (the common case in a narrative section after a title page) stay unassigned and are demoted to "Document evidence — applicability needs verification" blocks, excluded from comparison-table facts (adaptive.ts:462-481). The safety rule is correct — **do not weaken it** — but its *upstream ownership signal* is nearly absent, so real-document comparisons come out thin and largely unattributed. The fix belongs upstream: establish per-section plan/tier context from verified title/heading structure (see §11), not by relaxing C6.

### 6.3 RAG/chat

- **Retrieval:** deterministic scope masking first (selection-scope.ts:73-201 — genuinely strong: ineligible lines are blanked, not deleted, so every later citation still verifies); semantic leg via pgvector or in-memory cosine; lexical line-overlap fallback; fixed refusal on empty. Sensible degradation ladder. [VERIFIED FROM SOURCE]
- **Answer quality ceiling:** `verifyAnswerClaims` requires each substantive sentence to be token-covered by citations, and the prompt instructs the model to compose sentences only from cited words (answer.ts:449). The result is safe but stilted passage-collage answers, and the deterministic fallback (`answerQuestion`, answer.ts:296-321) returns raw "(docId, page N) quote" dumps — far from the "genuinely readable" requirement. Evidence safety and readability are being traded at the wrong layer (see §11.4). [VERIFIED FROM SOURCE]
- **Fragile constants:** `SEMANTIC_USEFULNESS_FLOOR = 0.43` calibrated on 4 fixture chunks (answer.ts:352-367); `MAX_CONTEXT_CHARS = 48000` with an accepted whole-document-drop risk (answer.ts:456-468). Both documented honestly; both are debt. [VERIFIED FROM SOURCE]
- **Debug residue:** production code probes for `"worldtrips", "seven corners", "5,000", "opt"` on every chat request (answer.ts:660-677). Dev-specific strings in shipped code; remove or generalize. [VERIFIED FROM SOURCE]
- **Prompt injection:** `wrapDocuments`/`STRICT RULES` boundary plus output validation and refusal-no-repair; no path reads document content as instructions. Good. [VERIFIED FROM SOURCE]
- **Caching:** chunks cached in tmpdir per session (chunks.ts:235-254); embeddings re-computed on the in-memory leg per question; extraction re-runs **fully** on every context-field update (ComparisonTable `MissingContextPrompt.apply` → POST /api/extract, ComparisonTable.tsx:88-120) — each missing-context answer triggers a complete re-extraction of all documents, with no result reuse. Cost/latency issue at 5-document scale. [VERIFIED FROM SOURCE]

### 6.4 Engineering-weight verdict per subsystem

| Subsystem | Verdict |
| --- | --- |
| Evidence verification, grounding, auth, storage | **Appropriately designed** — the strongest work in the repo |
| RAG retrieval/degradation | **Appropriately designed**, minor debt (constants, debug residue) |
| Extraction engines | **Overconstrained** (closed fact list) + **underengineered** (plan identity) simultaneously |
| Presentation layer | **Overengineered relative to what runs** — dormant validator, three grouping systems, 554 lines of adaptive.ts of which the adaptive half is unused |
| Extraction schema/reconcilers | **Appropriately designed**; slightly over-engineered pass count, but each pass is defensive and cheap |

---

## 7. Real-PDF Acceptance Failure Analysis

Historical report (unverified): 3 PDFs processed; individual reading OK; StudentSecure tiers appeared; ≥1 citation opened the right page; **Patriot Exchange did not appear as a selectable comparison plan**; 3-plan comparison not completed; chat isolation and active-view export unverified; refresh returned to Welcome/intake.

Traced failure points, with classification:

| Symptom | Most likely mechanism | Classification |
| --- | --- | --- |
| Patriot Exchange not selectable | Plan not attested: `attestPlans` regex requires the exact title-line shape `^\s*([\w...]{2,90}?\s+Program(?:SM\|℠)?)\s*$` **on lineIndex === 0** with `lines[1] === "Certificate of Insurance"` (plan-identity.ts:30-36). A title on another line, a preceding blank/watermark line, a different ℠ rendering, or any header text above it defeats the match. Alternatively the plan was attested but dropped because one of its source citations failed `verifyEvidenceCitation` (extract/route.ts:100-108 drops the whole plan when any source fails). Compare mode requires `plans.length >= 2` (page.tsx:416). | **Inferred, code-supported** — the regex works on the exact two-line fixture used in `tests/unit/plan-identity.test.ts:36-43`, but that fixture is an idealization of real page text. **[INFERRED]** |
| Thin 3-plan comparison | C6 stack (§6.2): model planIds discarded by `hasPlanValueProof`; mention-based attribution requires plan name inside each value's quote; unattributed values excluded from comparison blocks. Combined with any missing plan attestation, compare never fills. | **Confirmed implementation limitation** (evidence/attribution limitation, not a defect in the verifier) [VERIFIED FROM SOURCE] |
| Cross-document chat isolation unverified | Mechanism exists and is tested (`tests/unit/chat-selection.test.ts`); isolation depends on plan attribution quality — unattributed docs behave as shared evidence. | **Missing test coverage** against real documents [OBSERVED FROM EXISTING TESTS] |
| Active-view PDF export unverified | Mechanism exists and is heavily guarded (export route snapshot + selection validation; `tests/unit/export-pdf.test.ts`). Not exercised E2E with real data. | **Missing test coverage** [OBSERVED FROM EXISTING TESTS] |
| Refresh returns to Welcome/intake | Session id/capability live only in React state; no `localStorage` persistence of session identity (only theme, ThemeToggle.tsx:8); popstate maps a missing table to "upload" (page.tsx:133-141). The durable DB session and `sid_cap` cookie exist but nothing re-hydrates. | **Confirmed implementation behavior**; whether it's a defect or intended is a **product decision** (the UI says "closing this page deletes your documents", but a refresh isn't closing). [VERIFIED FROM SOURCE] |
| "Storage collisions addressed with non-overwriting writes" | `put` uses `wx` flag / `x-upsert:false` + race-recovery re-hash (objects.ts:143-149, 266-281, 349-377). | **Confirmed implemented** [VERIFIED FROM SOURCE] |

**Root-cause pattern:** every observed symptom traces to *one* design decision — proving plan identity through a closed regex set — amplified by a second decision — requiring plan-name mentions inside individual value quotes. The verifier, refusals, and session mechanics behaved correctly throughout.

---

## 8. Keep / Refactor / Replace / Remove Matrix

| Subsystem | Decision | Rationale & evidence | Effort | Regression risk |
| --- | --- | --- | --- | --- |
| PDF ingestion (`pdf/`, `ingestion/`) | **KEEP** | Honest quality gate, correct limits, clean rejection taxonomy (extract-pages.ts, quality-gate.ts). No OCR is a documented product limit, not a bug. | None | Low |
| Object storage (`storage/objects.ts`) | **KEEP** | Private-by-construction, session-scoped keys, race-safe non-overwrite writes; supersedes the collision patch correctly. | None | Low |
| Session auth (`session-auth.ts`, `session-db.ts`) | **KEEP** | Capability model is right; DB-first w/ tmpdir fallback is pragmatic. | Small: fix Cloud Run tmpdir durability (§3.3) | Medium |
| Session state (tmpdir JSON full page text) | **REFACTOR** | Stateless-compute violation for the *working copy*; DB row + objects exist but aren't the source of truth for extraction. Move page text/evidence registry to the durable owner (DB or objects) with tmpdir as cache only. | Medium | Medium |
| Citation verification + grounding (`evidence-verification.ts`, `evidence-ids.ts`) | **KEEP — untouchable** | The product's core trust asset. | None | Do not touch |
| Extraction schema + boundary reconcilers (`types.ts`, extract.ts boundary funcs) | **KEEP** | Validates the contract that makes dynamic facts safe; works regardless of where fact names come from. | None | Low |
| Fact inventory (`fact-list.ts` + regex fallback engine) | **REPLACE** (as the production engine; keep as offline/dev mode) | Closed inventory contradicts the approved dynamic product; regex engine's real-document semantic accuracy was never claimed (baseline plan explicitly notes citation correctness ≠ semantic correctness, plans doc:40). | **Large** — the main project of the refactor | High if rushed; mitigated by keeping the schema/verification chain |
| LLM extraction prompt + tier handling (extract.ts:543-563) | **REFACTOR** | Tier-table prompt logic is good and reusable; must be decoupled from the fixed fact list and given a discovery phase (candidate concepts → canonicalization). | Medium | Medium |
| Plan identity (`plan-identity.ts`) | **REFACTOR — highest-value change** | Closed regex set is source-specific; replace attestation with a generalized, verified title/declaration recognizer (LLM-candidate + deterministic proof), keep C6 unchanged but add upstream section-scoped ownership. | Medium | Medium |
| Adaptive presentation (`presentation/adaptive.ts`) | **REFACTOR / PARTIAL REMOVE** | Deterministic half works; the dormant `validatePresentation` proposal path (~120 lines, only tests use it) should be either wired to a real proposal source or removed. Consolidate the three grouping systems. | Small-medium | Low |
| V5 comparison table (`ComparisonTable.tsx`, 1078 lines) | **KEEP** | Approved design; dynamic rows flow from the table contract — once facts are dynamic, it inherits adaptivity for free. | None initially; later: support open-vocabulary row labels | Low |
| Individual reading (`AdaptiveResults.tsx`, `PolicyViewControls.tsx`) | **KEEP** | Approved UX; per-document readings/tiers state already works (page.tsx:300-338). | None | Low |
| Contextual chat (`rag/*`, `chat/route.ts`, `ChatPanel.tsx`) | **KEEP + small fixes** | Scope enforcement is exemplary. Fix: remove doc-specific debug probes; reconsider sentence-verbatim constraint (see §11.4); cache/reuse embeddings. | Small | Low |
| PDF export (`report/pdf.ts`, `export/route.ts`) | **KEEP** | Snapshot + selection contract is the right design; report mirrors active view. | Small: verify real-PDF active view E2E | Low |
| Eligibility / numeric validation (`eligibility.ts`, `premium.ts`, `coinsurance.ts`, `conditions.ts`) | **KEEP** | Deterministic interpretation rules are legitimate safety boundaries (e.g., `purchaseAttested` requires source attestation, types.ts:46-57). Some rules encode scoped patterns; revisit per-fact as facts go open-vocabulary. | Small ongoing | Medium |
| Tests (100 files) | **KEEP contract/security; REFACTOR unit tests tied to regex mechanics** | Many unit tests pin regex-engine behavior that Option B will replace; contract + integration + E2E tests are the durable assets. Add real-PDF acceptance as a first-class, locally runnable suite (pattern already exists: `tests/integration/real-pdf-evidence.test.ts` env-gated). | Medium | — |
| Evals (`evals/`) | **KEEP, EXTEND** | Retrieval goldens + realbench exist; extend to extraction-accuracy evals on real documents (currently absent). | Small-medium | — |

### Estimated code reuse (broad ranges, assumptions stated)

Assumptions: lines-of-code weighting by subsystem; "reuse" = kept as-is or with mechanical adaptation; extraction reuse assumes the schema/verification chain is kept while the fact-discovery engine is new.

- **Security / session / storage:** ~85–90% reuse.
- **Backend/domain plumbing (routes, selection contracts, export snapshot):** ~75–85%.
- **AI/RAG (retrieval, chat, scope):** ~75–85%.
- **Frontend (approved design, V5 table, reading):** ~85–90%.
- **Extraction domain logic:** ~40–55% (schema, reconcilers, tier handling, condition bindings kept; fact regex inventory and plan-identity regexes replaced).
- **Automated tests:** ~45–60% (regex-mechanics unit tests churn; contract/integration/E2E kept).

**Full rewrite is NOT justified.** The irreplaceable assets (verification chain, auth, storage, degradation ladder, approved UI) are the majority of the risk-weighted value, and they all survive Option B. A rewrite would re-expose the system to the security/evidence regressions this repo spent months getting right, for no benefit to the dynamic-intelligence gap.

---

## 9. Engineering Options and Tradeoffs

| Criterion | A — Incremental repair | B — Targeted boundary refactor | C — Larger replacement |
| --- | --- | --- | --- |
| Product alignment | Low (fixes symptoms; closed inventory + regex plan identity remain) | **High** (changes the two load-bearing constraints) | High |
| Code reuse | ~90% | ~70–80% | <30% |
| Evidence accuracy | Unchanged | Improved upstream (better ownership → fewer abstentions without weakening C6) | Unknown (regression-prone) |
| Maintainability | Unchanged debt | Improved (one extraction engine, one grouping system) | High churn |
| Complexity | Lowest now, highest later | Moderate | High |
| Effort | Days | **Weeks** | 1–2+ months |
| Performance / model cost | Unchanged (re-extraction cost remains) | Improvable (cache per fingerprint; single engine) | Unknown |
| Regression risk | Low | Moderate, mitigated by keeping verification chain | High — would discard battle-tested safety code |
| Testability | Same | Good (contract unchanged; new discovery stage testable against realbench-style goldens) | Poor initially |
| Speed to real V1.1 demo | Fast but demo stays thin | **Best balance** | Slowest |

**Recommendation: Option B.** A alone cannot satisfy the approved dynamic-discovery product spec (the limitation is structural, not a bug). C discards the repo's best asset. B changes exactly the two subsystems that block the vision (fact discovery, plan identity) while freezing the safety spine.

---

## 10. Recommended Target Architecture

Smallest architecture that delivers the adaptive experience — most boxes already exist; three change.

1. **What extraction produces.** Keep `comparison-schema v1` (documents, rows, values, qualifiers, evidence, verdicts, plans). Change `factName` from a closed enum to an **open vocabulary**: extraction emits `{concept, label, category?}` per discovered fact; a server-side canonicalizer maps candidate concepts to stable concept IDs (exact/normalized match against a growing registry, then embedding-similarity-assisted clustering with LLM naming, all deterministic-validated). `factListVersion` becomes a registry version. The 43 legacy facts become seed registry entries, so existing tests/UX keep working.
2. **Verified facts vs unresolved evidence.** Unchanged: verdicts (SUPPORTED / NOT STATED / CONFLICTED / NEEDS VERIFICATION / DOES NOT APPEAR TO FIT), fail-closed citations, material-token grounding. A new `unassigned` bucket already exists implicitly (values without planId) — formalize it.
3. **Documents / plans / tiers.** Documents from uploads (unchanged). Plan attestation generalized: a candidate plan name may come from the LLM **but is proven only by a deterministic check that the source explicitly names it as its own product in a title/declaration-like context on the cited page** (heading-line position, case, standalone-ness) — replacing the three hardcoded regexes with one verification function. Tiers: keep the existing tier-table logic; it is already schema-driven.
4. **Evidence ownership (C6 preserved).** Keep the rule: a value joins a plan only when its own verified evidence names the plan. **Add upstream ownership signals:** (a) section-scoped attribution — a value sits under a verified unique plan heading/TOC entry on its page; ownership is asserted from *verified structure*, not model assertion or page position alone; (b) allow the extraction prompt to emit plan-scoped values whose citations include the section heading spanning the plan title. Never relax `hasPlanValueProof`/mention rules themselves; widen what counts as proof by making more real citations *contain* the plan name legitimately (e.g., a section-heading quote block). [INFERRED — needs a small design spike against real brochures]
5. **Comparable dimensions discovered dynamically.** Canonicalized concepts across docs become rows; a value pair is comparable iff scope keys are compatible (existing `applicabilityScopeKey` logic, unchanged).
6. **Prioritization.** Keep deterministic `impact()` bands for concept families, but let the LLM propose the *top-3 findings selection* via the existing `validatePresentation` path — now actually wired, still constrained to fact IDs and validated headings.
7. **V5 table population.** Unchanged — rows come from the table; open vocabulary just means more/newer rows.
8. **Individual explanations.** Unchanged deterministic projector + (new) LLM proposal for block organization; group titles already LLM-proposable.
9. **Chat scope.** Unchanged (`scopeDocumentsForChat`). One change: relax the near-verbatim sentence constraint to a *structured answer* (rendered from verified spans) or a two-stage answer (constrained extraction → presentation synthesis with per-sentence citation mapping verified by the same token-coverage rule against its own cited span). Readability improves without allowing unsupported claims.
10. **Exports.** Unchanged; already snapshot-based and active-view faithful.
11. **Partial failures.** Existing per-value drop + row flip + 409/503 contract is fine. Add: extraction result caching keyed by `resultFingerprint` so context-field updates don't re-run the LLM when documents are unchanged (re-run only affected derivation, which is already deterministic/personalization-level).
12. **Deterministic rules that remain essential:** verdict vocabulary and its enforcement; citation verification; display grounding; C6 proof; purchase attestation; scope-before-retrieval; selection validation (≤3 plans, tier proof); context-field rule-outs; export snapshot immutability.
13. **Where model reasoning is useful:** fact/concept discovery, concept canonicalization & naming, plan-name candidates, section-structure understanding, group titles/findings selection, chat answer wording.
14. **Where it must NOT be authoritative:** verdicts, evidence truth, plan identity *proof*, numeric/eligibility interpretation, scope authorization, export content.

---

## 11. Phased Engineering Proposal

Vertical-slice goal: **three real PDFs → verified plan identities → useful dynamic comparison → original-page citations → scope-safe chat → accurate PDF export.** Approved frontend untouched.

| Phase | Goal | Modules | Risk | Acceptance |
| --- | --- | --- | --- | --- |
| **P0 — Instrument the slice** (do first; smallest uncertainty reducer) | Local, provider-free acceptance harness over the 3 real PDFs: dump attested plans, attributed/unattributed value counts, comparison-completeness, per-doc. Reuse the REAL_PDFS_DIR pattern (`real-pdf-evidence.test.ts`). | `tests/integration/`, new report script | None (read-only) | Report shows exactly where Patriot Exchange falls out (attestation vs. citation-drop vs. attribution) — converts §7's INFERRED causes to VERIFIED/UNKNOWN |
| **P1 — Generalize plan identity** | Replace regex attestation with verified title/declaration recognizer; add section-heading ownership signal upstream of C6 | `plan-identity.ts`, `types.ts` (proof), `extract/route.ts` | Medium (touching C6-adjacent code) | All 3 real PDFs yield ≥1 proven plan each; C6 tests unchanged and green; chat-selection tests green |
| **P2 — Open-vocabulary fact discovery** | LLM discovery phase (candidate concepts with citations) → canonicalizer → schema v1 output; retire the regex engine to explicit dev/fallback mode | `extract.ts`, new `discovery/` module, `fact-list.ts` → registry, presentation label fallbacks | High (broadest change) | Schema contract tests green; retrieval/chat untouched; realbench-style extraction goldens pass on the 3 docs; `npx tsc --noEmit`, `npm test`, `npm run build` |
| **P3 — Session continuity + durability** | Client re-hydrates active session after refresh (sessionId persisted client-side; server verifies capability); move working page-text state to durable owner on Cloud Run | `page.tsx`, `session.ts` vs `session-db.ts` | Medium | Refresh on /results restores workspace (E2E); no capability in logs; delete-on-close preserved |
| **P4 — Chat readability + hygiene** | Structured answer rendering (or two-stage synthesis) behind the same verification; remove doc-specific debug probes; extraction result caching per fingerprint | `rag/answer.ts`, `evidence-verification.ts` (verification unchanged), `extract/route.ts` | Medium | verifyAnswerClaims suite green; answer no longer requires cross-source token stitching; cost per context update drops to ~0 |
| **P5 — Full real-PDF acceptance** | E2E: upload 3 real PDFs → compare 3 plans → per-tier selection → chat isolation (cross-plan question refuses/stays scoped) → active-view export → refresh restore | `tests/e2e/` | Low | All 4 E2E flows + new acceptance flow pass; documented in `docs/ACCEPTANCE.md` |

**Fix immediately:** P0 (it de-risks everything else for ~1 day of work). **Defer:** presentation-proposal wiring (P2/P4 side effect), group-system consolidation. **Simplify/possibly remove:** dormant `validatePresentation` wiring decision (wire or delete); the doc-specific debug probe block; `answerQuestionHybrid`/`retrieveHybrid` if the semantic-selected path is final (check call sites before removal). **Leave untouched:** `evidence-verification.ts`, `evidence-ids.ts`, `session-auth.ts`, `selection-scope.ts`, `storage/objects.ts`, `report/pdf.ts`, `ComparisonTable.tsx`, approved CSS/design.

---

## 12. Technical Debt and Unnecessary Complexity

- **Debt #1 (threading):** the closed `FACTS` list threads through extraction, presentation, sections, labels, context-question mapping, and dozens of tests (grep `FACTS` hits fact-list, extract, adaptive, ComparisonTable, AdaptiveResults, …). Every new fact touches ~8 files. This is the single biggest maintainability threat. [VERIFIED FROM SOURCE]
- **Debt #2 (source-specific patches):** plan-identity regexes, tier-name regex (`elite|select|budget|smart|...`, extract.ts:249), care/rules display summarizers, coinsurance interpretation — a growing catalogue of brochure-shape assumptions. Each new real document adds pressure to patch again. [VERIFIED FROM SOURCE]
- **Overengineered subsystem:** the presentation stack — `adaptive.ts` (554 lines, half dormant) + `sections.ts` + `presentation-groups.ts` + `workspace-groups.ts` = four grouping/presentation layers for what currently renders as deterministic sections. Consolidate to: discovery → concepts → one grouping source → blocks. [VERIFIED FROM SOURCE]
- **Proportionality:** ~18k lines of TS, 100 test files, 8.3k lines of docs for a pre-production app with incomplete real-PDF acceptance. The test-to-product-outcome ratio is inverted: tests verify regex mechanics and fixture behavior rather than document-understanding outcomes. Less fixture-chasing, more real-document evaluation, is the right rebalancing. [INFERRED from test inventory]
- **Why hundreds of passing tests ≠ real acceptance:** the only tests that touch real PDFs are env-gated (`REAL_PDFS_DIR`, skipped in CI — real-pdf-evidence.test.ts:1-30) and cover citation repair, not extraction semantics or plan discovery; evals cover retrieval only; E2E uses synthetic fixtures. The suite verifies *mechanisms against assumptions*, not *product against reality*. [VERIFIED FROM SOURCE]

## 13. Risks, Unknowns, and Evidence Gaps

- **[UNKNOWN]** Actual real-PDF behavior of `attestPlans`/plan-drop (needs P0; do not implement P1 blind).
- **[UNKNOWN]** Whether section-heading ownership can be established reliably enough on real brochures to raise C6 coverage (design spike, small).
- **[UNKNOWN]** Whether the LLM extraction path was even active during the historical acceptance runs (engine depends on env at runtime; extract/route.ts:83-93) — may partly explain discrepancies.
- **[INFERRED]** Model-cost profile: extraction prompt ships full page text of all documents per call; with re-extraction on every context update, cost scales badly (§6.1 caching note).
- **[VERIFIED]** No OCR; scanned/image PDFs are unusable today — decide whether that's acceptable for the target user.

## 14. Owner Decisions Required

1. **Session restore after refresh:** required product behavior for V1.1, or intentional ephemerality? (Blocks P3.)
2. **Open-vocabulary fact registry:** approves changing the `factListVersion` contract semantics (rows may carry concepts beyond the v1 list). This is the core Option B authorization.
3. **Plan-identity generalization approach:** approve "LLM candidate + deterministic title/declaration proof + section-heading ownership" as the C6-compatible path before P1.
4. **Regex fallback engine's status:** keep as documented dev-mode, or remove after P2 (saves maintenance; loses credential-free operation).
5. **Scanned-PDF support:** accept as V1.1 limitation or schedule OCR.

## 15. Prioritized Recommendations

1. Run **P0** instrumentation on the three real PDFs (smallest change, largest uncertainty reduction).
2. Authorize and execute **P1** (plan identity) — directly completes the 3-plan comparison story.
3. Authorize and execute **P2** (dynamic fact discovery behind the existing contract).
4. **P3** session continuity (likely expected by any demo audience).
5. **P4** chat readability + cost hygiene.
6. Remove debug residue and consolidate grouping systems opportunistically.
7. Stop adding source-specific regexes; new document-shape problems should route into the discovery/verification design instead.

## 16. Challenge: Three Assumptions, Three Preservations, Three Reconsiderations

**Assumptions that may be wrong:**
1. *"The deterministic regex engine is the safe default."* It produces confident SUPPORTED rows from keyword matches whose semantic correctness was never validated on real documents (baseline plan, line 40). The LLM path under the same verification chain is likely *more* accurate; "no credentials" ≠ "safe".
2. *"The closed fact list protects evidence safety."* Safety is enforced downstream (verification, grounding, C6, verdicts). The closed list protects schema simplicity and costs recall; it is not load-bearing for safety.
3. *"More grouping layers improve organization."* Four overlapping grouping/presentation systems currently deliver one deterministic rendering; consolidation would lose nothing observable.

**Decisions worth preserving (as-is):** the fail-closed evidence chain; the session capability model; scope-before-retrieval chat masking; export snapshot immutability; the V5 table and approved visual design.

**Decisions worth reconsidering:** dual extraction engines (choose LLM + deterministic verification; keep regex as dev mode); full re-extraction on every context-field update; the near-verbatim chat sentence constraint (safety can be enforced at verification time without mandating collage prose).

**Shortest credible route to a V1.1 demo:** P0 → P1 → the existing E2E compare flow with 3 real PDFs → active-view export walkthrough. If P2 slips, the demo can run on the LLM engine with the legacy fact list while P2 matures — the frontend needs no redesign either way.

---

## 17. Final Human Terminal Summary

See the HUMAN TERMINAL block printed in the session transcript accompanying this document.

---

*End of audit. No implementation authorized. Awaiting owner review.*
