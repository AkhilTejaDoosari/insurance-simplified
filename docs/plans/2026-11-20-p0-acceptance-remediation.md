# P0 Acceptance Remediation — Investigation and Implementation Plan

> **Status: PROPOSAL FOR OWNER REVIEW. Do not implement until the root causes
> and the approval gates below are accepted.** This file is a working plan, not
> an authoritative rule; `docs/roadmap.md`, `docs/product.md`,
> `docs/evidence-core.md` and `docs/operations.md` remain authoritative.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the five P0 acceptance failures observed with five real
insurance PDFs without weakening the evidence contract or changing the approved
architecture.

**Architecture:** Correct the existing deterministic extraction, presentation
and retrieval boundaries in place. No new runtime component, store, framework,
dependency or provider. Two additive contract extensions (a presentation claim
layer and a structured chat answer) need owner approval because they touch
EC-7 and `chat-api` v1.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Playwright,
Postgres/pgvector, pdf.js.

**Spec:** `docs/product.md` A-012B, A-024/A-025, DOM-1…DOM-13;
`docs/evidence-core.md` EC-1…EC-13; `docs/experience.md` §§1–3;
this audit (Part A).

## Global Constraints

- Never weaken EC-1…EC-13: provenance, citation re-verification, evidence ids,
  original-PDF viewer, fail-closed attribution. NOT STATED ≠ NO.
- Scope before retrieval or model access. A caller-supplied id is never
  authorization.
- No real insurance PDFs, page text or derived labels in git. Real suites use
  `REAL_PDFS_DIR` / `REAL_FIXTURES_DIR` and report SKIPPED, never PASS, when
  absent.
- No new dependency, model provider, database table, queue, worker or
  deployment change. No paid calls (C-4: $0).
- Keep the three-column comparison limit (A-012B) and the five display
  verdicts (C-1).
- Do not change a test assertion merely to get green. Where an existing test
  asserts a behaviour the owner now rejects (P0-01 picker), the assertion change
  is an explicit, reviewed acceptance change.
- Every task ends with focused tests → `npm test` → `npx tsc --noEmit` →
  `npm run build`; add `npm run test:e2e` when a flow changes and browser
  screenshots for UI changes.

## Review Focus

These are the input classes most likely to break a person using the product;
each gets a test in the task that owns the code.

1. **An uploaded document with no verifiable plan name.** Expected: it remains
   discoverable and is explained, not dropped from the comparison workspace.
2. **A sentence that mentions a number or a keyword but states a different
   concept** (claim deadline, per-illness deductible, coverage maximum next to
   an age, a definition of "coverage area"). Expected: it is never promoted to
   the neighbouring fact.
3. **A text-bearing but content-free page** ("This page intentionally left
   blank") or a definitions page. Expected: never presented as answer evidence.
4. **A question with only weak/partial retrieval matches.** Expected: explicit
   uncertainty or refusal, never raw passages dressed as an answer.
5. **A selection change after a chat answer.** Expected: the old answer keeps
   its original scope and is visibly separated; the next answer is evaluated
   only against the new scope.

---

# Part A — Read-only audit

## A.0 Environment and baseline

- Branch `integration/m5-m7`, HEAD `de4efe4`; no working-tree changes were made
  during this audit.
- `npm test`: **1533 passed / 22 skipped / 0 failed** (145 files passed,
  13 files skipped). The 22 skipped tests are the real-document and
  unconfigured-provider suites.
- `.env.local` defines embedding keys but **no `LLM_*` keys** (variable names
  inspected only, values never read). With no generation model and embeddings
  configured, `/api/chat` takes `answerQuestionSemantic`, i.e. the
  deterministic retrieval path, not `answerViaLlm`.
- `real-fixtures/` contains only the two generated demo PDFs. The five PDFs used
  in the failing manual run are not in this worktree, and `REAL_PDFS_DIR` is not
  set, so the failures could not be re-run end-to-end here. The static paths
  below are decisive; real-document confirmation is Task 11 and must run on the
  owner's documents outside git.

**Why the suite stayed green:** it tests the *contracts that exist*, not the
product acceptance criteria. Retrieval tests assert that passages are returned;
they do not assert that the returned passages answer the question. Extraction
tests use one hand-picked sentence per case, so overlapping aliases are never
exercised together. Every real-brochure suite is skipped without
`REAL_FIXTURES_DIR`. P0-01 e2e tests use a synthetic one-plan-per-document table
and explicitly assert the disabled 4th checkbox and the two-step swap.

## A.1 P0-01 — Only three plans, no way to reach the rest

### Root causes

1. **The 3-plan limit is downstream and becomes the entire comparison scope.**
   `app/lib/extraction/selection.ts:22` (`MAX_SELECTED_PLANS = 3`),
   `:56-62` (default = alphabetical top 3), `:173-180` (reconcile keeps top 3).
   `app/page.tsx:313-317` builds the compare view from
   `selection.selectedPlanIds`; `app/lib/presentation/adaptive.ts:152-173`
   derives the comparison's documents *only* from those three plans, so
   documents 4–5 contribute zero rows, chat scope and export scope.

2. **The inventory can be smaller than the upload, silently.**
   `app/lib/extraction/verify-table.ts:69-71` uses
   `table.plans ?? attestPlans(...)`: if the model proposed *any* plans,
   deterministic attestation never runs for the documents it omitted. Lines
   `:72-80` then drop a whole plan if any one source citation fails, with no
   record. `app/lib/extraction/plan-identity.ts:267` only attests from page 1,
   so a title on page 2 yields no plan and no explanation.

3. **No replace affordance.** `app/components/PolicyViewControls.tsx:162-166`
   disables every unselected plan once three are selected; the only path is an
   unstated uncheck-then-check. Chips (`:185-247`) reorder but cannot remove.
   The hero counts documents only (`app/page.tsx:475-477`), and Compare is
   disabled with no reason when fewer than two plans exist (`:416`).

4. **Existing tests encode the defect.** `tests/e2e/v1-1-comparison.spec.ts:281-324`
   performs uncheck-then-check; `:326-349` asserts the 4th checkbox is
   disabled; `tests/e2e/v5-frontend.spec.ts:382-395` repeats it.

### Correctability

Yes, inside the existing model. `plan.sources[].documentId` and
`table.documents` already contain everything needed to disclose inventory and
explain absence. No new store or table.

## A.2 P0-02 — Chat returns raw retrieval, including unrelated and blank pages

### Root causes

1. **Raw passages are returned as a successful answer.**
   `app/lib/rag/answer.ts:431-448` (`answerQuestionSemantic`) builds
   `answerText` by concatenating `(${documentId}, page ${page}) ${quote}` for
   the top five semantic chunks and sets `grounding: "explicit"`. The lexical
   paths do the same (`:314-339`, `:343-368`). `app/api/chat/route.ts:232-240`
   degrades an LLM failure into this same raw path. This is the observed output.

2. **Only the best passage is tested for usefulness.** `answer.ts:385-408`
   applies a single top-1 cosine floor (`0.43`); the other four passages are
   never scored for relevance. `SEMANTIC_TOP_K = 16` (`:218`) is cut to five
   unconditionally (`:431-437`). Definitions and a text-bearing blank page can
   therefore ride along.

3. **No page-quality gate in retrieval.** `page-readability.ts` classifies
   pages `read` / `empty` / `unreadable` / `partly-unreadable`, but RAG never
   consults it. `chunks.ts:110` drops only whitespace-only pages; a page reading
   "This page intentionally left blank" still chunks and ranks.

4. **The answer contract has no synthesis fields.** `validateChatResponse`
   (`answer.ts:766-829`) requires only non-empty `answerText` and ≥1 citation.
   The prompt requires every sentence to be copied from the cited passage
   (`:491-502`), so plain-language synthesis is structurally impossible; the
   "verification" checks token containment, not meaning
   (`evidence-verification.ts:437-449`, `:520-527`, `:535-544`).

### Why tests missed it

`tests/unit/semantic-first.test.ts:65-85` asserts that the raw page text *is* an
acceptable `answerText`; the contract test only checks shape. Retrieval evals
measure MRR/recall, not whether an answer answers. No test includes a blank or
definition-only page. The LLM suites require a configured provider and are
skipped locally.

## A.3 P0-03 — Semantic misclassification

The line engine is a per-line regex scan with no governing context except a
tier header ≤10 lines above (`extract.ts:396-399`), and it displays the whole
matched line verbatim (`:502-508`, `:539-544`). Table labels are matched
separately and stripped of parentheticals (`table-facts.ts:54-56`), then every
matching fact receives the cell (`:58-62`, `:198-212`). Nothing arbitrates
overlaps.

Reproduced directly against the regex sources in `fact-list.ts` / the table
anchors (Node, no app code executed):

| Input | Matched as |
| --- | --- |
| "Proof of claim is required to be submitted … within 90 days" | **eligibility** (`fact-list.ts:26`, alias `"required to be"`) |
| "Deductible: $250 per illness or injury" | **annual-deductible** (`:19`), period qualifier `null` (`:83`) |
| "Deductible per covered illness" (table label) | **annual-deductible** (`table-facts.ts:39` anchor `/\bdeductibles?\b/`) |
| "Deductible (per injury)" (table label) | **annual-deductible**; `labelHead` reduces it to "Deductible" (`:54-56`) |
| "Maximum coverage option of $100,000 … over 65 years of age" | **policy-limit + age-limits** (`fact-list.ts:48`, bare `over \d+`) |
| "Coverage maximum options: $50,000 / $100,000 / $250,000 … over 65" | **age-limits only** (`policy-limit` lacks "coverage maximum", `:24`) |
| "GEOGRAPHIC RESTRICTIONS. … service area … coverage area … home country" | **geographic-restrictions** (keyword presence only, `:46`) |

Aggravators:

- `eligibility` is a feeder (`eligibility.ts:23-28`); its row is deleted from
  display (`sections.ts:128`) and its values are flattened into the composite
  `Eligibility for you` (`eligibility.ts:95-143`). A claims deadline therefore
  renders as an eligibility finding and is boosted into the reading brief
  (`adaptive.ts:312-313`).
- There is no fact for claims-filing deadlines or per-illness deductibles, so
  the wrong fact is the only possible home.
- `age-limits` alternates are unanchored, so any benefit sentence containing
  "over 65" becomes an age row.
- `geographic-restrictions` has no `contextField` and no restriction grammar;
  definitions and exclusions match identically.

### Why tests missed it

`tests/unit/extract-fallback-real-doc-patterns.test.ts` uses one sentence per
case and never a sentence that must map to *no* fact; `tests/unit/eligibility.test.ts`
supplies the correct `factName` directly; `care-display.test.ts:64-66,130-143`
and `table-governing-notes.test.ts:31-36` pin verbatim/concatenated display as
correct; the real-document suites (`p2-2a`, `statement-facts-real`,
`table-governing-notes-real`, …) are skipped.

## A.4 P0-04 — Chat history and evidence cross the selected scope

New questions *are* scoped when a selection payload is sent
(`app/api/chat/route.ts:111-178`, `selection-scope.ts:73-151`), and
`tests/unit/chat-selection.test.ts` proves that. The leaks are elsewhere:

1. **Server: exclusion outcomes ignore the selection.**
   `app/api/chat/route.ts:306-312` resolves outcomes over the whole re-derived
   store; `app/lib/evidence/exclusion-outcomes.ts:29-41` iterates every
   registered document with a plan. The chat panel can therefore show
   exclusion checks for plans outside the three currently compared.
2. **Client: history is retained in the same list with only a muted one-line
   label.** `ChatPanel.tsx:320-334`, `:405-416`. When a turn was answered with
   no selection payload (both fields omitted), no historical label is emitted at
   all; `page.tsx:661-663` also passes only the current view's documents for
   filename resolution, so historical citations from other documents fall back
   to raw document ids (`ChatPanel.tsx:130-131`).
3. **No separation on change.** The turns array is never regrouped or collapsed;
   the previous scope's answer remains the most prominent message.

## A.5 P0-05 — Source paragraphs are the user-facing answer

`CellValue` has `display` (full verbatim value) and no claim/conditions fields
(`types.ts:100-110`). `ConditionalValue.tsx:154,178` renders `display` as the
primary clickable value; `AdaptiveResults.tsx:186-203` renders the card and
shows evidence only for non-finding cards; the reading brief is three
`impact()`-ranked facts (`adaptive.ts:304-340`). Table displays concatenate the
row label, column heading, cell and every governing note
(`table-facts.ts:198`). The PDF export repeats `fact.value.display`
(`report/pdf.ts:497-509`).

Consequences: a 419-character geographic paragraph or a 200-character
definition is the headline; status is a smaller note below; source wording is
the default rather than a verification layer.

---

# Part B — Remediation plan

Order is chosen so that evidence correctness (P0-03) lands before the claim
layer (P0-05) and chat (P0-02), and so P0-01 and P0-04 can proceed in parallel
with extraction work. Each task is independently reviewable.

## Task 1: Plan inventory completeness and disclosure data (P0-01)

**Files:**
- Modify: `app/lib/extraction/verify-table.ts:69-80`
- Modify: `app/lib/extraction/types.ts` (optional `planInventory`)
- Modify: `app/api/extract/route.ts:192-208` (return the inventory)
- Test: `tests/unit/plan-inventory.test.ts` (new)

**Interfaces:**
- Produces:
  `type PlanInventoryEntry = { documentId: string; planIds: string[]; reason: "verified-plan" | "no-verified-plan-name" | "plan-source-unverified" }`
- Produces: `verifyComparisonTable(...): ComparisonTable & { planInventory: PlanInventoryEntry[] }`

- [ ] **Step 1: Write the failing test** — five documents; the model proposes
      three plans, omitting `doc-4`/`doc-5`; deterministic attestation can prove
      one plan in `doc-4`; a plan for `doc-5` cites text not on its page.
      Assert `planInventory` has five entries, four plans survive, `doc-5` is
      `plan-source-unverified`, and no document is absent from the inventory.
- [ ] **Step 2: Run it and see it fail** —
      `npx vitest run tests/unit/plan-inventory.test.ts`.
- [ ] **Step 3: Implement** — attest only documents *not already owned* by a
      model-proposed plan; merge attested plans; verify each plan source as
      today; build the inventory from `table.documents`, surviving plans and
      dropped plan sources. Do not infer a plan from a filename, and do not
      generalize the insurer-specific title rule (defect register, M8).
- [ ] **Step 4: Run the test, the existing `plan-identity`,
      `document-ownership`, `extract-verify-boundary` and
      `comparison-schema` tests.**
- [ ] **Step 5: Commit** (local only, when execution is approved).

## Task 2: Replaceable comparison shortlist and visible inventory (P0-01)

**Files:**
- Modify: `app/lib/extraction/selection.ts` (add `replaceSelectedPlan`)
- Modify: `app/components/PolicyViewControls.tsx:154-247`
- Modify: `app/page.tsx:416,472-487,532-543`
- Modify: `app/components/AdaptiveResults.tsx` (inventory notice placement)
- Test: `tests/unit/selection.test.ts`
- Test: `tests/e2e/v1-1-comparison.spec.ts`, `tests/e2e/v5-frontend.spec.ts`
  (assertion changes approved as acceptance changes, not to get green)

**Interfaces:**
- Produces:
  `replaceSelectedPlan(prior, table, outgoingPlanId, incomingPlanId): EffectiveSelection`
  — same length, validates both plans, preserves order position and tiers of
  the surviving plans.

- [ ] **Step 1: Write the failing unit test** — with `[a,b,c]` selected and
      `d` available, `replaceSelectedPlan(..., "b", "d")` yields `[a,d,c]`;
      an unknown plan throws.
- [ ] **Step 2: Write the failing e2e test** — five synthetic plans: the
      interface says "Showing 3 of 5 verified plans"; the 4th checkbox is
      **enabled**; choosing it replaces a selected plan and the columns stay at
      three; a document with no verified plan is listed with
      "No verified plan name was found in this document" and remains readable
      in Understand mode.
- [ ] **Step 3: Run and fail**
      (`npx vitest run tests/unit/selection.test.ts`; `npx playwright test tests/e2e/v1-1-comparison.spec.ts`).
- [ ] **Step 4: Implement** — keep every plan checkbox enabled; a click on an
      unselected plan when three are selected calls `replaceSelectedPlan`
      (replace the last column, announced via a status message); add an explicit
      "Remove from comparison" control per chip (blocked below two with a
      reason); render the count and the `planInventory` explanations.
- [ ] **Step 5: Re-run unit + e2e; capture desktop/mobile, light/dark
      screenshots for owner review.**

## Task 3: Claims-filing deadline is not eligibility (P0-03)

**Files:**
- Modify: `app/lib/extraction/fact-list.ts:26` (remove bare `"required to be"`;
  add `claims-filing-deadline`)
- Modify: `app/lib/extraction/eligibility.ts` (feeder list unchanged; no
  deadline values can reach it)
- Modify: `app/lib/extraction/sections.ts` (one canonical section)
- Modify: `app/lib/evidence/session-evidence.ts:30-43` (provision kind)
- Test: `tests/unit/fact-classification-deadline.test.ts` (new)
- Test: `tests/unit/extract-fallback-real-doc-patterns.test.ts` (extend)

**Interfaces:**
- Produces fact id `claims-filing-deadline` with label
  "Claims filing deadline", matched only by claim-notice/deadline grammar
  (e.g. `proof of claim`, `claim(s) must be (filed|submitted)`, `written notice
  of claim`, `within \d+ days` adjacent to "claim").

- [ ] **Step 1: Write the failing pipeline test** — a page containing
      "Proof of claim is required to be submitted to the Company within 90 days"
      must produce a `claims-filing-deadline` row with `SUPPORTED` and must
      produce **no** `eligibility` value (directly or through the composite).
- [ ] **Step 2: Run and fail** (`npx vitest run tests/unit/fact-classification-deadline.test.ts`).
- [ ] **Step 3: Implement** the fact and remove the generic eligibility alias;
      add the fact to its section and provision-kind map.
- [ ] **Step 4: Run the focused test plus `eligibility`, `sections`,
      `absence` and `m7c-honest-reading` suites.**
- [ ] **Step 5: Commit.**

## Task 4: Per-illness/per-injury deductible is not the annual deductible (P0-03)

**Files:**
- Modify: `app/lib/extraction/fact-list.ts:19` and `:83`
- Modify: `app/lib/extraction/table-facts.ts:38-62`
- Modify: `app/lib/extraction/sections.ts`, `app/lib/evidence/session-evidence.ts`
- Test: `tests/unit/deductible-period.test.ts` (new)

**Interfaces:**
- Produces fact id `per-illness-deductible` with label
  "Deductible per illness, injury or condition".
- Produces `Qualifiers.period` values including `per illness`, `per injury`,
  `per condition`, `per accident`, `per admission`, `per certificate period`.

- [ ] **Step 1: Write failing tests** — line and table cases:

      "Deductible: $250 per illness or injury"   → per-illness-deductible
      "Deductible per covered illness" (label)   → per-illness-deductible
      "Deductible (per injury)" (label)          → per-illness-deductible
      "Annual deductible: $2,000"                → annual-deductible only
      "Deductible options: $500 / $1,000"        → annual-deductible (selectable,
                                                    not purchased — DOM-9)

- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** negative period guards on `annual-deductible`, a
      label-scope check that reads the full label before `labelHead`, and the
      new fact. Do not let a per-period label feed the annual row.
- [ ] **Step 4: Run focused + `fallback-tier-deductible`,
      `plan-tiers`, `table-attribution`, `qualifiers` suites.**
- [ ] **Step 5: Commit.**

## Task 5: Coverage maximum is not an age limit; add governing context (P0-03)

**Files:**
- Modify: `app/lib/extraction/fact-list.ts:24,48`
- Modify: `app/lib/extraction/extract.ts:383-444` (nearest-heading context
  for ambiguous facts)
- Test: `tests/unit/fact-classification-age-limit.test.ts` (new)

**Interfaces:**
- Add optional `FactDefinition.governingHeadings?: RegExp` and
  `FactDefinition.requiresRestriction?: boolean` (used again in Task 6).
- Produces helper `nearestHeading(lines, index): string | null` (heading =
  short, non-empty line before the match; scanning stops at a blank paragraph
  boundary).

- [ ] **Step 1: Write failing tests**

      "Maximum coverage option of $100,000 available for members over 65 years of age."
        → policy-limit (SUPPORTED), NOT age-limits
      "Coverage maximum options: $50,000 / $100,000 / $250,000 available for members over 65."
        → policy-limit, NOT age-limits
      "Age limit: you must be under age 65 to enroll."
        → age-limits only
      "Maximum benefit per illness: $10,000" (table under an Age column)
        → not age-limits (governing heading mismatch withholds)

- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** anchored age grammar
      (`age limit`, `must be (under|over|at least) … age`,
      `(under|over) age \d+`, `\d+ … of age`), add "coverage maximum" /
      "maximum coverage option" to `policy-limit`, and require the age fact's
      governing heading to mention age, eligibility, enrollment or underwriting
      when a heading is present. Fail closed when the heading contradicts.
- [ ] **Step 4: Run focused + `rules-display`, `statement-facts`,
      `table-governing-notes` suites.**
- [ ] **Step 5: Commit.**

## Task 6: Geographic restrictions require a restriction, not a definition (P0-03)

**Files:**
- Modify: `app/lib/extraction/extract.ts` (sentence splitter + restriction
  grammar for `geographic-restrictions` and `international-coverage`)
- Modify: `app/lib/extraction/fact-list.ts:41,46` (no bare keyword acceptance)
- Test: `tests/unit/geographic-restriction.test.ts` (new)

**Interfaces:**
- Produces `restrictionSentence(text): string | null` — returns the first
  sentence containing a closed restriction marker (`not covered`, `only`,
  `limited to`, `outside`, `must`, `does not apply`, `excluded`, `except`),
  else `null`. The returned string must be an exact substring of the page.

- [ ] **Step 1: Write failing tests** — a definition paragraph
      ("coverage area means …") yields no `geographic-restrictions` value; a
      restriction sentence ("Services outside the service area are not covered")
      yields exactly that sentence; a 400-character run is not stored whole.
- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** sentence-level extraction with the restriction
      grammar; keep the exact span for citation; if no restriction sentence is
      present, produce no value (absence is honest).
- [ ] **Step 4: Run focused + `m7c-field-grammars`, `m7c-network-scope`,
      `evidence-verification` suites.**
- [ ] **Step 5: Commit.**

## Task 7: Presentation layer — claim, conditions, status, source wording (P0-05)

**Files:**
- Create: `app/lib/presentation/claim.ts`
- Modify: `app/lib/presentation/adaptive.ts` (`PresentationFact`)
- Modify: `app/components/AdaptiveResults.tsx:186-203`
- Modify: `app/components/ConditionalValue.tsx:142-206`
- Modify: `app/lib/report/pdf.ts:497-525`
- Test: `tests/unit/presentation-claim.test.ts` (new)
- Test: `tests/unit/adaptive-renderer.test.tsx`, `tests/unit/report-pdf.test.ts`

**Interfaces:**
- Produces:
  `describeFact(value: CellValue, factName: string): { claim: string | null; conditions: string[]; status: "supported" | "conditional" | "unconfirmed"; sourceWording: string }`
- `claim` is null when no deterministic template can be grounded; `sourceWording`
  is always the verbatim `value.display` or the cited span.

- [ ] **Step 1: Write the failing test** — a long geographic paragraph yields
      a short claim composed only of verified tokens, `conditions` contains the
      qualifiers, `sourceWording` still contains the full paragraph, and a
      claim with an invented token is rejected (`claim: null`, status
      `unconfirmed`). Reading brief renders the claim, not the paragraph.
- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** deterministic per-family templates (money, period,
      network, age band, limit, restriction). Verify the claim with
      `checkDisplayGrounding` and the negation/exception/network grammars; on
      failure show label + "Cannot be confirmed" + source wording. Keep the
      evidence link on the claim and on the source wording.
- [ ] **Step 4: Run focused + `care-display`, `table-governing-notes`,
      `conditional-value`, `adaptive-presentation` suites.**
- [ ] **Step 5: Screenshots (desktop/mobile, light/dark) for owner review.**
- [ ] **Step 6: Commit.**

> **Approval gate:** this adds a labelled plain-language layer above EC-7's
> verbatim display. Proposed rule text: "A derived claim is a separate,
> clearly labelled layer; it must pass number, negation, exception and network
> verification against the same citations; the verbatim source wording and its
> evidence link remain present." No summarizer may replace source wording.

## Task 8: Retrieval hygiene — exclude blank/definition pages and rank per passage (P0-02)

**Files:**
- Modify: `app/lib/rag/answer.ts` (`retrieve`, `retrieveSemantic`,
  `isSemanticUseful`)
- Modify: `app/lib/rag/selection-scope.ts` (carry readability into `RagDocument`)
- Modify: `app/lib/rag/answer.ts` `RagDocument` type
- Test: `tests/unit/retrieval-hygiene.test.ts` (new)

**Interfaces:**
- `RagDocument` gains optional `readability?: PageReadability[]`.
- Produces `isAnswerEvidence(passage, question, topScore): boolean` — page is
  readable, passage contains a query concept, and score ≥
  `max(SEMANTIC_USEFULNESS_FLOOR, topScore - 0.05)`.

- [ ] **Step 1: Write the failing test** — three pages: a blank marker page, a
      definitions-only page and the geographic-restriction page. Ask "What
      should I verify about geographic restrictions?" Assert the blank page is
      never a passage, the definition page is not the sole evidence, and the
      restriction page survives.
- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** readability filtering, per-passage relevance, a
      five-passage maximum, and a lexical rule requiring at least two distinct
      query terms (or an exact phrase) without cross-heading windows.
- [ ] **Step 4: Run focused + `chunks`, `semantic-first`, `retrieval-context`,
      `m5-overfetch`, `fusion` suites.**
- [ ] **Step 5: Commit.**

## Task 9: Chat answer contract — direct answer, claims, uncertainty (P0-02)

**Files:**
- Modify: `app/lib/rag/answer.ts` (schema, prompt, `answerViaLlm`,
  `answerQuestionSemantic`, `answerQuestion`, validator)
- Modify: `app/api/chat/route.ts`
- Modify: `app/components/ChatPanel.tsx`
- Test: `tests/contract/chat-api.test.ts`, `tests/unit/chat-answer-contract.test.ts` (new),
  `tests/unit/answer-via-llm-shortcircuit.test.ts`

**Interfaces:**
- Extends an answer additively with:
  `claims: Array<{ text: string; citationIndexes: number[]; conditions?: string[]; uncertainty?: string }>`
  and `limitations?: string[]`.
- Produces `validateAnswerClaims(answerText, claims, citations): { ok: boolean; failedClaim?: number }`
  using the existing number, negation, exception and network grammars.

- [ ] **Step 1: Write the failing test** — (a) semantic retrieval with no
      generation model returns `kind: "refusal"` with an explicit
      uncertainty message, never an answer whose `answerText` is raw passages;
      (b) a model answer with one claim whose figure is absent from its cited
      passage fails closed; (c) a plain-English paraphrase whose material
      tokens and markers all verify is accepted with claim-level citations.
- [ ] **Step 2: Run and fail.**
- [ ] **Step 3: Implement** the additive contract and claim validator; change
      the prompt from "copy the source wording" to "answer directly; every
      claim must be supported by the passages you cite"; remove the raw-passage
      answer path (fallbacks return a controlled uncertainty/refusal).
- [ ] **Step 4: Run focused + all chat suites + `chat-api` contract.**
- [ ] **Step 5: UI render — direct answer, claim bullets with page links,
      uncertainty note, source passages collapsed.**
- [ ] **Step 6: Commit.**

> **Approval gate:** `chat-api` v1 extension (additive fields plus a controlled
> uncertainty outcome). Without a generation model the product can produce
> fact-shaped claims deterministically from the extracted grid; open-ended
> questions must return uncertainty. This needs an owner decision on scope.

## Task 10: Chat scope isolation and history separation (P0-04)

**Files:**
- Modify: `app/api/chat/route.ts:297-325`
- Modify: `app/lib/evidence/exclusion-outcomes.ts:29-41` (accept a scope)
- Modify: `app/components/ChatPanel.tsx:85-134,296-378`
- Modify: `app/page.tsx:661-663` (filename map for historical turns)
- Test: `tests/unit/chat-selection.test.ts` (extend)
- Test: `tests/e2e/v1-1-consistency.spec.ts` (extend)

**Interfaces:**
- `resolveExclusionOutcomes(store, authority, question, scope: { planIds: string[]; documentIds: string[] })`
  filters registered documents to the selected plan sources/document.

- [ ] **Step 1: Write the failing route test** — store has two plans; selection
      names plan A; a question naming a service must return outcomes for A
      only.
- [ ] **Step 2: Write the failing e2e test** — ask under selection A, switch to
      B, ask again: B's answer cites only B; A's turn appears under a distinct
      "Earlier questions — different selection" group with its scope label and
      a working evidence link; no A citation appears in B's answer.
- [ ] **Step 3: Run and fail.**
- [ ] **Step 4: Implement** the server scope filter and the client history
      grouping (collapse old-scope turns; keep the full session document map for
      filenames while retrieval stays scoped).
- [ ] **Step 5: Run focused + e2e; screenshots.**
- [ ] **Step 6: Commit.**

## Task 11: Real-document acceptance harness (all P0s)

**Files:**
- Create: `scripts/p0-acceptance.ts` (ids, pages, verdicts and counts only; no
  document text)
- Create: `tests/integration/p0-real-documents.test.ts` (gated by
  `REAL_PDFS_DIR`, `describe.skip` otherwise)
- Modify: `docs/roadmap.md` only at milestone close, not during this task

- [ ] **Step 1: Implement the harness** — run the five PDFs through
      `/api/extract` semantics and a fixed question set; emit JSON/Markdown
      outside git or sanitized.
- [ ] **Step 2: Acceptance assertions** — all five documents present with a
      plan or an explicit reason; annual vs per-illness deductible distinct;
      no claims deadline under eligibility; no coverage maximum under age
      limits; no blank/unrelated page in answer evidence; every claim has a
      resolving citation; chat scope matches the selection.
- [ ] **Step 3: Run against the owner's five PDFs** (`REAL_PDFS_DIR=…`), record
      the report path and PASS/FAIL per criterion; report SKIPPED when absent.
- [ ] **Step 4: Full gate** — `npm test` → `npx tsc --noEmit` →
      `npm run build` → `npm run test:e2e`.
- [ ] **Step 5: Browser journey** with the five real documents (upload → compare
      → replace a plan → ask the geographic question → open each citation →
      switch scope → export), with screenshots.

---

# Part C — Acceptance trace

| Release criterion | Task(s) | Test evidence |
| --- | --- | --- |
| All five documents discoverable | 1, 2 | `plan-inventory`, e2e inventory |
| Select and replace comparison plans | 2 | `selection`, e2e replace |
| Direct, concise chat answers with qualifications | 9 | `chat-answer-contract` |
| Every factual claim has relevant evidence | 7, 9 | claim verification tests |
| Evidence links open the right document/page/passage | 7, 9, 11 | citation/e2e viewer |
| Blank and unrelated pages excluded | 8 | `retrieval-hygiene` |
| Annual vs per-incident deductibles distinguished | 4 | `deductible-period` |
| Claims deadlines not eligibility | 3 | `fact-classification-deadline` |
| Coverage options not confirmed benefits | 4, 5 | DOM-9 tests |
| Document/plan/tier identity isolated | 1, 10 | inventory + chat-scope e2e |
| Missing/ambiguous information is explicit uncertainty | 7, 9 | claim/uncertainty tests |
| Regression tests reproduce each failure | 1–10 | each task's first failing test |
| Real-document browser journey | 11 | report + screenshots |

# Part D — Out of scope / approval gates

- **Not doing:** M8 concept registry, OCR, a new retriever/reranker (D-013),
  LLM extraction, a UI redesign, new dependencies, new stores/tables.
- **Approval needed before execution:**
  1. Changing the P0-01 e2e assertions that currently encode the disabled
     picker (acceptance change, not a green-washing change).
  2. New fact ids (`claims-filing-deadline`, `per-illness-deductible`) and the
     fact-list version bump.
  3. The EC-7 amendment for a verified, labelled claim layer (Task 7).
  4. The additive `chat-api` answer contract and the controlled-uncertainty
     outcome (Task 9).
  5. Any use of a generation model for acceptance (C-4: $0). Without one,
     Task 9 must rely on deterministic grid claims and explicit uncertainty for
     open-ended questions.

# Part E — Risks and open questions

- The five failing PDFs are not available in this worktree; real-document
  reproduction and the final PASS claim depend on the owner pointing
  `REAL_PDFS_DIR` at them.
- M6 labels are not complete, so results can be **Tested**, not **Verified**
  in the `quality.md` §1 sense.
- Generalizing plan-title recognition is an M8 item; this plan discloses
  unproven documents instead of inferring identity from titles or filenames.
- Extending chat with claims is provider-dependent for open-ended questions;
  a local model may fail the strict schema. The deterministic path must remain
  a controlled uncertainty, never raw retrieval.

## Self-review

- **Spec coverage:** each P0 and each release criterion maps to a task in
  Part C. P0-05 is covered by Task 7; P0-02 by Tasks 8–9; P0-04 by Task 10;
  P0-03 by Tasks 3–6; P0-01 by Tasks 1–2.
- **Test gaps addressed:** every task starts with a failing regression that
  reproduces the reported behaviour; real-document suites stay skipped without
  the owner's PDFs.
- **Type consistency:** `PlanInventoryEntry`, `describeFact`,
  `isAnswerEvidence`, `validateAnswerClaims` and `resolveExclusionOutcomes` are
  named once and consumed by later tasks as written.
- **Review Focus:** the five input classes are pinned in Tasks 1, 3–6, 8 and 10.
- **Proportion:** no task rewrites a subsystem; all changes stay inside the
  existing modules.

## Execution handoff

Review Part A first. If the root causes are accepted, choose an execution
method:

- **Subagent-driven** — one fresh implementer and one fresh reviewer per task;
  best when the owner wants independent review of each evidence-contract
  change.
- **Native** — implement the tasks in this session, then one whole-branch
  review; fastest, but less independent.

Recommended: **subagent-driven**, because Tasks 3–9 each touch the evidence
boundary and a second reader is cheap insurance. No implementation starts until
the owner approves the audit and the Part D gates.
