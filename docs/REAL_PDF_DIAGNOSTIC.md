# P0 Real-Document Diagnostic — Attribution & Plan-Selectability

Date: 2026-10-27
Authorization: Owner-approved P0 diagnostic (see `docs/INSURANCE_ARCHITECTURE_AUDIT.md` §7/§8/§11/§13).
Scope: **Deterministic-engine-only findings.** The LLM extraction path was **not** invoked (no remote inference; owner authorization). Nothing in this report establishes the behavior of the LLM path. Production code, tests, config, dependencies, extraction contracts, C6 safeguards, and the approved UI were not modified.

## 1. Inputs and method

Runner (local-only, read-only reuse of production modules, zero new deps):

```text
scripts/diag-real-pdf-attribution.ts      # run: npx tsx scripts/diag-real-pdf-attribution.ts
```

Authorized real documents (all present locally, never uploaded):

| documentId | File | Pages | Extracted chars |
|---|---|---|---|
| doc-1 | `nonstandard/01_img_patriot_exchange_2026.pdf` | 34 | 157,079 |
| doc-2 | `nonstandard/03_worldtrips_studentsecure.pdf` | 8 | 21,327 |
| doc-3 | `nonstandard/04_seven_corners_travel_medical_usa.pdf` | 4 | 8,982 |

The runner reproduces the exact `/api/extract` value funnel (`app/api/extract/route.ts:124-185`) over the deterministic fallback table (`extractFallback`) and reports each stage:

```text
A  plan candidate attestation        attestPlans()            app/lib/extraction/plan-identity.ts
B  plan source-citation verification verifyEvidenceCitation() route drop-any-failing-source filter
C  plan presence in validated table
D  value mention-attribution         attributePlanScope()     BEFORE the route gate
E  value attribution after the route's hasPlanValueProof() gate (route.ts:158-163)
F  value citation verification + checkDisplayGrounding()      route fail-closed boundary
G  comparison completeness
H  document isolation (alone vs. together)
```

Full raw output (verbatim): `/private/var/folders/th/w8d_t86x75x5fl3thf70mj_w0000gn/T/opencode/diag-output.json` (session temp artifact; re-generable with the runner).

## 2. Extraction-mode discipline

- Engine used: `extractFallback` (deterministic), exactly as the fallback branch of `app/api/extract/route.ts` runs it.
- LLM engine: **SKIPPED**. `LLM_API_KEY`/`LLM_BASE_URL` exist in `.env.local` but owner authorization prohibits remote inference. Production auto-selects the LLM engine when configured (`app/api/extract/route.ts:83-93`), so **live production behavior may differ from every result below**.

## 3. Per-document funnel (each PDF extracted alone)

| Stage / metric | doc-1 Patriot Exchange | doc-2 WorldTrips | doc-3 Seven Corners |
|---|---|---|---|
| A: plan candidates | 1 — `Patriot Exchange ProgramSM` | 1 — `StudentSecure` | 1 — `Travel Medical Including the USA` |
| B: survived source-citation filter | yes (1/1 sources verified) | yes (1/1) | yes (1/1) |
| C: in validated table | yes | yes | yes |
| Value citations checked / verified / failed | 585 / 585 / 0 | 112 / 112 / 0 | 48 / 48 / 0 |
| Values kept (no drop) | 585 | 112 | 48 |
| Values dropped (no verified citation) | 0 | 0 | 0 |
| Display-grounding unsupported | 0 | 0 | 0 |
| Values attributed (mention, pre-gate) | 0 | 2 | 0 |
| Values attributed after route gate (E) | 0 | 0 | 0 |
| Tiered values (`planTier`) | 0 | 8 | 10 |
| Row verdicts | 34 SUPPORTED / 9 NEEDS VERIFICATION / 5 flipped NOT STATED | 28 / 5 / 15 | 15 / 9 / 24 |
| Rows with same-doc/same-scope contradiction pairs (`hasSameScopeContradiction`) | 36 of 48 | 15 of 48 | 3 of 48 |
| Compare mode (page.tsx:416 gate) | disabled — only 1 proven plan | disabled | disabled |

## 4. Trio funnel (all three PDFs together)

| Stage | Result |
|---|---|
| A: candidates | 3 — `Patriot Exchange ProgramSM`, `StudentSecure`, `Travel Medical Including the USA` |
| B: survived | all 3 (every plan source citation verified) |
| C: in table | all 3 |
| Compare mode gate | **enabled=true** — "3 proven plans ≥ 2 (page.tsx:416 gate)" |
| Value citations | checked 745 / verified 745 / **failed 0** |
| Values kept / dropped | 745 / 0 |
| Display-grounding unsupported | 0 |
| Values attributed pre-gate (D) | **2** (both StudentSecure) |
| Values attributed post-gate (E) | **0** |
| Tiered values | 18 (8 doc-2, 10 doc-3, 0 doc-1) |
| Rows with values | 48 |
| Rows comparable across documents (≥2 documents in row) | 34 |
| Rows comparable across plans (≥2 plan-attributed values) | **0** |
| Rows carrying same-scope contradiction pairs | 37 of 48 |

Per-plan attribution (trio):

| Plan | Sources | Stage D mention-attributed | Stage E post-gate | Page-level name signal (cited page contains plan name) |
|---|---|---|---|---|
| Patriot Exchange ProgramSM | doc-1 p1, quote "Patriot Exchange ProgramSM" — verified | 0 | 0 | **0 of 585** |
| StudentSecure | doc-2 p1, quote "Get StudentSecure insurance from WorldTrips, a member of the Tokio Marine HCC group of" — verified | 2 | 0 | 86 of 111 |
| Travel Medical Including the USA | doc-3 p1, quote "Seven Corners Travel Medical Including the USA" — verified | 0 | 0 | 8 of 48 |

## 5. Patriot Exchange failure-stage analysis (measured)

The audit's two [INFERRED] causes for Patriot Exchange being unselectable are **refuted** on real documents with current deterministic code:

- **Cause #1 (regex mismatch on real page text) — REFUTED.** `attestPlans()` attests `Patriot Exchange ProgramSM` from page 1, line 0 (`"Patriot Exchange ProgramSM"`) with the required second line `"Certificate of Insurance"` (pattern `programTitle+certificate`, plan-identity.ts:30-36). The diagnostic mirror reproduces the engine exactly (`consistency: "mirror agrees with attestPlans()"`).
- **Cause #2 (plan source citations dropped) — REFUTED.** The single source citation verifies; the plan survives the route's drop-any-failing-source filter.

The real, measured failure points are downstream, at **value attribution**:

- **Stage D (mention attribution, plan-identity.ts):** `attributePlanScope()` assigns a value to a plan only when the value's *own cited quote* names the plan (word-boundary match). Measured on the Patriot document: **0 of 585** value citations contain "patriot" in the quote, and **0 of 585** cited pages contain "patriot" anywhere. The string appears only on page 1 line 0 (the title) and page 34 line 1 (`"Patriot Exchange GroupSM"` — a near-miss, different entity), and **neither page is ever cited by a value**. So zero values can ever attribute to Patriot Exchange — the attribution never happens, independent of Stage E.
- **Stage E (`hasPlanValueProof`, types.ts:117-128, applied at route.ts:158-163):** even the 2 mention-attributed StudentSecure values are stripped, because the gate demands the artificial literal quote `plan name: X; ${factName}: ${display}` (or `policy name: …`), which real brochures never contain. Result: **0 of 745** trio values are plan-attributed post-gate.

**Net deterministic outcome:** all three plans are proven and the compare-shelf gate is enabled (`PolicyViewControls.tsx:20` renders `table.plans ?? []`, so Patriot Exchange **would appear as selectable**). But with 0 plan-attributed values, every fact renders as `unverified-applicability`, and the adaptive presentation drops comparison-table blocks in that state (`app/lib/presentation/adaptive.ts:462-481` returns null when any selected fact is `unverified-applicability`). The historically reported "full three-plan comparison was not completed" is reproduced as an **empty plan-scoped comparison surface**, not as a missing plan.

**Historical claim "Patriot Exchange did not appear as selectable": NOT reproducible** with the current deterministic engine. Remaining suspects, classified **UNKNOWN** (LLM path skipped per authorization): (a) the LLM engine path (production default when configured), (b) code state at the time of the historical report.

## 6. Attributed vs. unassigned (trio, measured)

| Bucket | Count |
|---|---|
| Values kept with verified citations | 745 |
| Mention-attributed pre-gate | 2 (1.5% of kept) |
| Attributed after route gate | 0 (0%) |
| Unassigned (`unverified-applicability`) | 745 (100%) |

## 7. Document isolation (Stage H)

Per-document value sets alone vs. together — **perfect isolation, 0 contamination**:

| Document | Alone | Together | Only-alone | Only-together | Identical |
|---|---|---|---|---|---|
| doc-1 Patriot | 585 | 585 | 0 | 0 | yes |
| doc-2 WorldTrips | 111 | 111 | 0 | 0 | yes |
| doc-3 Seven Corners | 48 | 48 | 0 | 0 | yes |

Data note: doc-2 `values.kept` is 112 while the isolation set counts 111 — two kept values share an identical `valueSetKey` (dedupe artifact of the isolation probe), not data loss.

## 8. Contradiction observation (verified code reading + measurement)

`app/lib/extraction/extract.ts:512-522` carries the comment that the "single-match-per-document fallback cannot observe" same-scope contradictions. **Measured:** the fallback emits ALL matches per fact, and `hasSameScopeContradiction` (`app/lib/extraction/contradictions.ts`) fires on 36/48 Patriot-alone rows, 15/48 WorldTrips, 3/48 Seven Corners, and **37 of 48 trio rows** — yet those rows are emitted SUPPORTED by the fallback. The comment's stated rationale is stale; the fallback *does* observe these pairs and does not downgrade them. The LLM path has `reconcileLlmTable` for this; the fallback does not. Recorded as an observation — no production change made.

## 9. Baseline comparison (accuracy correction status)

- Historical correction-plan baseline (2026-10-26): 446 value citations checked / 72 failed verification.
- This run: **745 checked / 745 verified / 0 failed**, with 0 grounding-unsupported displays. The real-document citation-accuracy correction appears landed in the deterministic engine.
- **Semantic correctness remains UNVERIFIED**: the pipeline proves quotes exist on claimed pages and displays are grounded in quotes; it does not prove the extracted *value* matches the brochure's meaning. No human ground truth was applied in P0.

## 10. Verified observations vs. unknowns

**Verified (deterministic engine, measured):**
1. All three real PDFs attest exactly one plan each; all sources verify; all 745 value citations verify; isolation is perfect.
2. 100% of facts end plan-unassigned; the cause is the C6 mention contract (Stage D: name-blind citations) plus the Stage E literal-quote gate (`hasPlanValueProof`).
3. Patriot Exchange attests and survives every plan-identity stage; it would be selectable in the deterministic engine.
4. 34 of 48 trio rows are document-comparable; 0 are plan-comparable; 37 carry same-scope contradiction pairs the fallback ignores.
5. Patriot has zero page-level ownership signal on its own cited pages — a page-co-occurrence attribution strategy alone would not rescue it.

**Unknowns:**
1. LLM-path behavior for all of the above (skipped per authorization).
2. Whether the historical "Patriot not selectable" observation came from the LLM engine or older code.
3. Semantic correctness of extracted values (needs human-grounded evaluation).

## 11. Smallest recommended P1 change

**Requires owner approval before implementation** — it touches the comparison-schema v1 proof contract wording ("single-plan documents are NOT proof", plan-identity.ts:4-6 and route.ts:151-157), which is part of the protected evidence contract (AGENTS.md §5).

**Smallest correction:** extend the Stage E proof contract (`hasPlanValueProof` call site, `app/api/extract/route.ts:158-163`) with **document-ownership proof**: when the value's document has exactly one verified proven plan (its source declaration verified on that document), values with verified citations on that document may carry that plan's `planId`. All three authorized documents are single-plan documents, so measured upper bound is 745/745 attributed — making the trio comparison fully plan-scoped.

- Alternatives measured to be insufficient alone: page-level name co-occurrence (0/585 for Patriot), relaxing only the literal-quote gate without a new proof source (2/745 at best).
- Safety shape for the change: keep it fail-closed (ownership proof requires the plan's verified declaration citation on the same document, ≥2 plans on a document ⇒ ownership proof void, values stay unassigned).
- Companion hygiene item (no contract impact): update the stale comment in `extract.ts:512-522` about the fallback's contradiction blindness.
- Separately recommended: a follow-up, separately authorized diagnostic running the LLM engine locally/remaotely to resolve UNKNOWN #2 before trusting any historical LLM-path conclusions.

## 12. Checks run

| Check | Result |
|---|---|
| Runner execution (`npx tsx scripts/diag-real-pdf-attribution.ts`) | exit 0; stderr contains benign unpdf warnings ("Warning: TT: undefined function: 21") |
| Focused vitest (plan-identity, extract-fallback-real-doc-patterns, evidence-ids, tiers, plan-names, qualifiers) | 6 files, **79 passed** |
| Full `npm test` | 98 files passed, 2 skipped; **826 passed**, 6 env-gated skipped (`REAL_PDFS_DIR`/DB-gated integration suites) |
| `npx tsc --noEmit` | clean |
| `git status` | only `scripts/diag-real-pdf-attribution.ts` added + this report; the 77 pre-existing modified tracked files untouched |
