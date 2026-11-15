# P1 Attribution Safety Design Review — Evidence Ownership & Plan Attribution

Date: 2026-10-27
Authorization: Owner-approved design + diagnostic review. **No production code, C6 rules, schemas, providers, tests, or existing reports were modified. No P1 implementation was performed.** No remote inference, uploads, migrations, subagents, commits, pushes, or deployments.
Inputs read: `docs/INSURANCE_ARCHITECTURE_AUDIT.md` (all sections; §6.2/§7/§11/§13 in detail), `docs/REAL_PDF_DIAGNOSTIC.md`, and the attribution code paths cited below.
Method: read-only probes (`npx tsx`) over the three authorized PDFs in `nonstandard/`, using production modules unchanged, plus synthetic documents constructed in-memory to exercise exception handling. Probe artifacts live only in the session temp directory (`p1-probe.ts`, `p1-output.json`); they are not repository files.

Evidence labels: **[VERIFIED]** (measured in this review), **[CODE-VERIFIED]** (source inspected), **[INFERRED]**, **[UNKNOWN]**.

---

## 1. Verified root problem

From P0 (`docs/REAL_PDF_DIAGNOSTIC.md`), re-confirmed here **[VERIFIED]**:

- All three plans attest and survive plan-identity stages; 745/745 value citations verify. Yet **0 of 745 values remain plan-attributed after validation**, so every fact renders `unverified-applicability` and the comparison surface stays empty.
- The deterministic chain that strips attribution has two links:
  1. **Stage D** (`resolveValuePlanId`, `app/lib/extraction/plan-identity.ts:128-139`): a value joins a plan only when its **own cited quote** names exactly one proven plan scoped to that document (word-boundary mention). Real-document value citations are name-blind: Patriot 0/585, Seven Corners 0/48 quotes mention their plan; WorldTrips only 2/112.
  2. **Stage E** (`hasPlanValueProof`, `app/lib/extraction/types.ts:117-128`, applied at `app/api/extract/route.ts:158-163`): any surviving planId is kept **only** when a citation quote literally equals `plan name: X; {fact}: {display}` (or `policy name: …`) — an artificial string real brochures never contain. It stripped the only 2 mention-attributed values.

The C6 safety rule itself is correct — the defect is that **no legitimate upstream ownership signal can ever satisfy it on real documents**. P0 showed page-level name co-occurrence is no rescue (Patriot 0/585 cited pages contain its name).

---

## 2. The existing C6 stack, examined **[CODE-VERIFIED]**

| Layer | Location | Rule |
|---|---|---|
| A. Attestation | `plan-identity.ts:19-59` | Plan proven only by a labelled declaration/title regex (closed set, incl. line-0 `Program℠` + `Certificate of Insurance` pair). Never inferred from filenames or narrative mentions. |
| B. Mention attribution | `plan-identity.ts:95-139` | Value → plan only when its own cited quote names exactly one plan scoped to that document; ambiguous (multi-plan) mentions abstain. |
| C. Route plan survival | `route.ts:97-108` | A plan is dropped entirely if **any** source citation fails verification. |
| D. Stage E gate | `route.ts:147-163` + `types.ts:117-128` | Any planId (claimed or attributed) survives only via the literal labelled-line quote. |
| E. Contradiction guard | `contradictions.ts:70-88` | Same-document + equal planId + equal applicability scope + differing display ⇒ same-scope contradiction. Note: pairs with **different** planIds are never compared (plan-identity.ts:79-81 comment: unattributed is document/unknown scope). |

Preserved rationale for today's strictness (route.ts:151-157): a previous C6 defect let one declared plan absorb example and competitor figures sharing its page. Any P1 change must keep that failure impossible.

---

## 3. Proposed proof model (approach A, hardened)

**Rule: document-ownership proof.** A value may carry `planId` of a verified proven plan when **all** of the following hold:

1. The value's citations verified fail-closed (unchanged route behavior) and all cite the value's own document.
2. The plan survived the route's source-citation filter (Stage B) **and** the plan has at least one verified source citation on this document.
3. **Uniqueness:** exactly one verified proven plan is scoped to this document (multi-plan documents are never resolved by ownership).
4. **Peer coherence (new, measured necessary):** the value's peer group — the row's values from the same document carrying the same planId — contains **no** `hasSameScopeContradiction` pair. A value inside a same-doc same-scope conflict abstains instead of joining a contested group.
5. Mention attribution (layer B) remains **decisive and unchanged**: an explicit unique mention always wins over ownership.
6. `hasPlanValueProof` itself is **untouched**: explicit labelled-line claims keep their existing proof path (T8 below).

Order of evaluation: mention → ownership → abstain. Cleanliness (rule 4) is evaluated on the uniformly attributed peer set (mention + ownership values together) — P0 review found that evaluating it on the unattributed set misses pairs created when a mention-attributed value and an ownership value become peers (they share planId only after attribution).

**Why the peer rule is not optional.** Simulated on the trio with attribution applied unconditionally ("A-all"): 745/745 attributed, but **665 of 745 values would present fact-state `conflicting-evidence`** (`adaptive.ts:201-208` computes state from peers once a value is attributed) across the 37 rows P0 flagged — a conflict flood caused by extraction line-noise, not real disagreements. With the peer rule: **82 attributed, 80 verified-plan, 2 conflicting-evidence, 1 flagged row**. **[VERIFIED]**

---

## 4. Tested against real source passages and synthetic documents **[VERIFIED]**

### 4.1 Real-document simulation (trio, deterministic engine)

| Attribution variant | Attributed | verified-plan | conflicting-evidence | Conflict rows | Plan-comparable rows |
|---|---|---|---|---|---|
| P0 status quo | 0 | 0 | 0 | 0 | 0 |
| A-all (ownership unconditional) | 745 | 80 | **665** | 37 | 34 |
| A dollar-display gate | 43 | 24 | 19 | 6 | 1 |
| A pure-amount gate | 2 | 0 | 2 | 1 | 0 |
| **A + peer-conflict-free rule (recommended)** | **82** | **80** | **2** | **1** | **9** |

Recommended-variant detail **[VERIFIED]**:

- Patriot Exchange ProgramSM: **14 attributed** (0 abstained in-rows) across 7 facts: `premium`, `out-of-pocket-maximum`, `policy-limit`, `eligibility`, `specialist-visit`, `network-rules`, `student-health-center`; 571 values abstain (their doc-1 peer groups are keyword-noise rows).
- StudentSecure: 33 attributed across 18 facts (incl. `annual-deductible`, `emergency-care`, `network`, `dental-coverage`, `emergency-reunion`); 77 abstain; the 2 pre-existing mention values (`international-coverage` marketing lines) keep C6 behavior and surface `conflicting-evidence`.
- Travel Medical Including the USA: 33 attributed across 21 facts (incl. `annual-deductible`, `emergency-care`, `coinsurance`, `hospitalization`, `emergency-evacuation`, `repatriation`); 15 abstain.
- Plan-comparable rows: 9, including one **three-plan** row (`eligibility`) and pairs like `annual-deductible [StudentSecure vs Travel Medical]`.

### 4.2 Synthetic exception tests (in-memory documents, production logic unchanged)

| Case | Construction | Result **[VERIFIED]** |
|---|---|---|
| T1 single-plan doc | 1 declaration + 2 value lines | 2/2 attributed via ownership |
| T2 **two plans in one document** | 2 declarations (Alpha/Beta) + 2 deductible lines | **ABSTAIN both** — ownership void at >1 plan |
| T3 same plan across two PDFs | identical `Policy ID` + `Issuer` declarations in 2 docs | merged into 1 plan; **2/2 attributed** across both documents |
| T4 merged plan, one bad source | 2nd source quote absent from its page | route drops the whole plan → **both documents abstain** (conservative) |
| T5 filename-only identity | filename "Alpha Plan.pdf", no declaration | **0 attested → 0 attributed** (identity never inferred from filenames) |
| T6 near-miss entity | doc whose only "Patriot" text is `underwritten by Patriot Exchange GroupSM` + real title | attests exactly the real title plan; `GroupSM` does **not** attest a second plan |
| T7 rival-plan narrative mention | single-plan doc value quoting a competitor name | attributed to the doc's **own** plan (candidates are document-scoped; rival is not a candidate) |
| T8 labelled-line proof | `Plan name: Alpha Plan; annual-deductible: $500` quote | `hasPlanValueProof === true` — explicit-claim path intact |

### 4.3 Real-passage checks for the exception classes (requirement 4)

- **Optional riders:** the only real rider language found: doc-1 p31 (`Rider: Any exhibit, schedule, attachment, amendment, endorsement, Rider or other document…` — a *definition*) and doc-3 p3 `OPTIONAL COVERAGE` section header. The one optional benefit under that header (`Adventure Activities Up to medical maximum…`) is **not extracted today** (0 matching values) — so no real output is currently misattributed, but under any better engine rule 3-style ownership **would** attribute an optional add-on as plan coverage. This is the strongest argument for keeping an explicit exception: ownership proof must not apply to values whose evidence sits under an optional/rider section heading once extraction can see them (approach B's boundary tool; deferred, see §6). **[VERIFIED + INFERRED]**
- **Alternatives:** 11 values carry ≥2 dollar amounts in one display; inspection shows they are tier-column concatenations the tier-header detector missed (e.g. doc-3 `Dental — Accident $250 $500` = Basic/Choice columns), plus one genuine selectable range (doc-3 deductible `$0 - $5,000 (Choose the option you want.)`, already `selectionStatus: "selectable"`). Multi-amount displays without tier qualifiers produce same-scope peer conflicts → the peer rule abstains them (correct today; tier-split repair is an extraction-precision matter, not attribution).
- **Tier-specific benefits:** 18 tiered values (8 doc-2, 10 doc-3) keep their `planTier` qualifier under attribution; the UI tier shelf (`planTiers`/`documentTiers`) continues to scope them. Tier applicability is **not** established by document ownership alone when the tier qualifier is absent — those values abstain via rule 4 whenever their unsplit tier-columns conflict. **[VERIFIED]**
- **Shared exclusions:** values in `material-exclusions` and exclusion-style rows are the plan's own stated terms; ownership attribution of them is semantically correct (an exclusion belongs to the plan) and the product contract already treats "Not covered" as stated data, never as inferred NO. **[CODE-VERIFIED + INFERRED]**
- **Competitor/example figures:** the historical C6 defect (one plan absorbing example/competitor figures on its page) cannot recur: attribution requires a verified plan source on the document, values stay document-bound, and multi-plan or rival-narrative cases are handled by rules 3/5. **[VERIFIED by T2/T6/T7]**

---

## 5. Contradiction analysis — the 37 reported same-scope pairs (requirement 5) **[VERIFIED]**

Mechanical split of the 37 flagged trio rows (same-doc, same scope, differing display):

| Class | Rows | Finding |
|---|---|---|
| Fully narrative pairs (no benefit value on either side) | 14 | Extraction noise: bare-keyword fact regexes emit prose, TOC entries, definitions as "values" (e.g. `hospitalization` pattern `hospital|inpatient|…` matched 94 lines; `vision-coverage` pattern `vision|optical|eyewear` matched `…Provisions…` via the substring "vision"; `dental-coverage` pattern `dental` matched `Accidental…`/`Incidental…` via the substring "dental"). `fact-list.ts:31,35,36`. |
| Numeric pairs (both sides contain figures) | 23 (293 pairs) | Sampled pairs decompose into: (a) **different benefit subjects sharing one fact row** (e.g. Emergency Medical Evacuation amounts `$250,000`/`$500,000` landing in `emergency-care`; Terrorism `$50,000` max inside `policy-limit`); (b) **differing conditions the scope extractor missed** (doc-1 `$0` injury deductible vs `$500` illness deductible — "injury/illness" not captured in that row's scope signature); (c) **tier-column concatenation** (two tiers' amounts in one display, no `planTier` set). |
| Confirmed genuine same-scope benefit contradiction | 0 found | No sampled pair shows the same benefit subject, same scope, different value. The fallback's SUPPORTED verdict happens to match the observed data — but by mechanism, not by analysis: the comment at `extract.ts:512-522` ("cannot observe") is stale (the fallback emits all matches and *could* observe), while the pairs it does emit are artifacts. |

Residual honesty note: all 293 numeric pairs were categorized by class from the dump; 12 pairs were individually verified line-by-line; an exhaustive pair-by-pair human adjudication was not performed and remains open. **[UNKNOWN at pair level, VERIFIED at class level]**

Under the recommended gate, only **one** row remains flagged: `international-coverage` (doc-2's two marketing-sentence values that C6 mention-attributed — pre-existing behavior, unchanged by P1).

---

## 6. Approach comparison (requirement 6/7)

| Criterion | **A — document-level unique verified identity + explicit exceptions** | **B — verified plan/section/tier ownership boundaries + conservative fallback** |
|---|---|---|
| Measured coverage (trio) | 82 attributed / 9 plan-comparable rows / 1 flagged row | Untestable on this corpus: Patriot's name appears on 0/585 cited pages, so section ownership has no per-section signal to bind; it degenerates to document-title ownership = rule A for single-plan docs. **[VERIFIED]** |
| New machinery | None (reuses verified plan sources + `hasSameScopeContradiction`) | Section/heading parser over unpdf text-layer output — headings are unreliable there (dotted TOC lines, inline `SAMPLE` watermarks observed in extracted displays). **[CODE-VERIFIED]** |
| Handles multi-plan docs | Abstains everything (fail-closed) | Would attribute per section — the only approach that could, but no such document exists in the authorized corpus to validate against. |
| Handles optional riders | Needs the §4.3 exception (future gate) | Natively (section boundary) — but only when extraction emits the section content (it doesn't today). |
| Maintainability | Small, additive, one gate call-site + one helper; semantics match existing vocabulary | New extraction layer (violates "no new framework layers" for no measured gain at V1 scale) |
| Risk | Low: attribution only after full verification; every abstention path is fail-closed | Medium: heading mis-parse silently mis-scopes ownership across sections |

**Recommendation: approach A with the peer-conflict-free rule**, recording B as the designated upgrade path when (a) multi-plan PDFs become a real input class or (b) extraction gains section awareness (P2). This also matches the audit's own sequencing (§11 P1 = generalize identity; section-scoped ownership listed as upstream signal work, [INFERRED] there, now measured unnecessary-first).

---

## 7. Minimum production interfaces and proof-semantics changes (requirement 8)

Design only — nothing changed yet. All are small, additive, and schema-neutral:

1. **`app/api/extract/route.ts:158-163` (Stage E gate — the only behavioral change):**
   `if (!hasPlanValueProof(...) && !ownershipProof(...)) planId = undefined;`
   where `ownershipProof` implements §3 rules 1-4 using `validPlanSources` (already in scope at that point) plus the row's verified values for the peer test. Mention-decisiveness (rule 5) and the `validPlanSources` document-coverage check (route.ts:147-150) are unchanged.
2. **`app/lib/extraction/plan-identity.ts`:** add an exported, pure helper (e.g. `uniqueDocumentPlanId(plans, documentId): string | undefined`) so the route and any future caller share one ownership definition. Existing `attestPlans`/`resolveValuePlanId`/`attributePlanScope` behavior unchanged.
3. **Comment/contract updates (required for honesty, not behavior):** `plan-identity.ts:1-6` and `route.ts:151-157` currently state "single-plan documents are NOT enough" — the owner-approved change of that sentence is the core P1 decision; `types.ts:111-116` doc comment; stale comment at `extract.ts:512-517`.
4. **No changes:** comparison-schema v1 (no new fields — `planId`/`plans` already exist), evidence-verification, evidence IDs, RAG/chat scope, presentation (`adaptive.ts` state logic already consumes planId membership), UI, providers, deps.

**Proof-semantics summary:** today's contract "evidence names the plan" becomes "evidence names the plan, **or** the plan is the unique verified identity of the evidence's own document and the value's peer group is conflict-free". Every other path (claimed planIds, labelled lines, mentions, multi-plan docs, unverifiable citations) behaves exactly as today.

---

## 8. Proposed P1 tests (requirement 9)

**Positive**
1. T1: single-declaration document → every verified-cited value attributed; tiers preserved with `planTier` intact.
2. T3: same plan (policy ID + issuer) across two PDFs → one proven plan, both documents' values attributed.
3. Real-doc regression (extend `scripts/diag-real-pdf-attribution.ts`): trio yields ≥80 verified-plan values, ≥9 plan-comparable rows, ≤1 flagged row, Patriot ≥14 attributed across the 7 measured facts, compare gate enabled.
4. Mention values keep attribution and `hasPlanValueProof` labelled-line claims still pass (T7/T8).

**Negative**
5. T2: two plans declared in one document → 0 attributed values for that document (all abstain).
6. T4: plan with one failing source citation → plan dropped → 0 attributed anywhere.
7. T5: plan name in filename only → nothing attests, nothing attributes.
8. Value whose same-doc peer group has a same-scope contradiction → that value abstains (verified-plan count reflects only conflict-free groups).
9. LLM-claimed planId without a labelled-line quote and without ownership → stripped (existing route behavior preserved).

**Adversarial**
10. T9 (new): phantom mid-document declaration (a sample form line `Plan name: Sample Plan` inside an otherwise single-plan document) → currently attests a second plan → ownership voids → 0 attributed. Pin this; optionally harden attestation to title-context-only declarations (separate owner decision, §10).
11. T6: `Patriot Exchange GroupSM` near-miss must never attest or merge.
12. T7: competitor name inside a value quote must not reassign the value away from the document's own plan.
13. Optional-coverage probe: a document line inside an `OPTIONAL COVERAGE`/rider section, once extracted, must abstain (guard rail test asserting the future exception) — today assert the measured status quo (0 such values extracted).
14. Cross-document contamination: alone-vs-together value-set equality still holds after attribution (P0 Stage H harness).

---

## 9. Estimated improvement supported by evidence **[VERIFIED]**

- Plan-attributed values: **0 → 82 of 745 (11%)** with zero conflict-noise surfaced (vs 745 with 665 false-conflict values for unconditional ownership).
- Verified-plan facts: **0 → 80 values across 37 of 47 rows**; plan-comparable rows **0 → 9** (one is a full three-plan row).
- Patriot Exchange: **0 → 14 attributed values across 7 facts** and remains selectable (compare gate already enabled deterministically).
- Honest remaining gap: 663/745 values (89%) stay unassigned — bounded by extraction line-noise (bare-keyword fact regexes), which is P2's scope, not attribution's.

---

## 10. Deterministic-only conclusions vs. LLM unknowns (requirement 10)

**Applies only to deterministic extraction** (all measurements above): the root-cause chain, funnel counts, contradiction classes, and variant table describe `extractFallback` + the shared route. The route's Stage E gate and plan-survival filter are engine-agnostic, so the proposed gate change would also govern LLM-path output — but its *effect* there is untested.

**Unknowns about the LLM path** (LLM engine skipped per authorization):
1. Whether the historical "Patriot Exchange not selectable" observation reproduces under the LLM engine (`route.ts:83-93` auto-selects it when configured). **[UNKNOWN]**
2. LLM-extracted semantic value accuracy on these brochures (citation verification ≠ semantic correctness; no human ground truth applied). **[UNKNOWN]**
3. How many LLM-emitted planIds exist and would now survive via ownership proof instead of being stripped by the artificial literal quote (P0 showed the gate strips 100% of them on the fallback path; the LLM path's planId volume is unmeasured). **[UNKNOWN]**
4. LLM behavior on multi-plan documents and optional-coverage sections (`reconcileLlmTable` handles contradictions differently from the fallback). **[UNKNOWN]**
5. Whether LLM extraction would emit the `Adventure Activities` optional rider (it is invisible to the regex engine) — the §4.3 exception must exist before that becomes live. **[UNKNOWN]**

---

## 11. Owner approvals required before P1 implementation

1. **Core decision:** adopt document-ownership proof (§3) with the peer-conflict-free rule, replacing the "single-plan documents are NOT proof" sentence in the comparison-schema v1 contract commentary (protected evidence-contract wording; AGENTS.md §5). Without this approval, P1 cannot proceed.
2. Optional hardening (recommended, separate decision): restrict declaration-pattern attestation to title-like context (page-1/top-of-document), closing the phantom-declaration hole (T9).
3. Separate authorization for an LLM-path diagnostic to resolve §10 unknowns 1/3.
4. Accept the recorded abstention profile (82 attributed / 663 abstained) as the P1 end-state, with the remainder deferred to P2 precision work — or explicitly direct further P1 bundling (not recommended: it couples attribution repair to extraction rewrite).

---

## 12. Checks run

| Check | Result |
|---|---|
| Probes (real trio + synthetic T1-T8) | exit 0; outputs in session temp (`p1-output.json`) |
| Production files | **unmodified** (`git status`: no tracked file changed by this review; only this report added) |
| Existing reports | unmodified |
| `npx tsc --noEmit` | clean |
| Full `npm test` | 826 passed, 6 env-gated skipped (unchanged from P0 baseline) |
