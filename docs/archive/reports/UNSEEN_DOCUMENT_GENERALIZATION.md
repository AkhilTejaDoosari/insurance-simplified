# Unseen Document Generalization — Offline Acceptance Report

**Date:** 2026-10-27
**Mode:** Diagnostic only; no production changes
**Verdict:** **FAIL** — the measured engines do not generalize sufficiently to these three unseen documents.

## 1. Executive verdict

All three exact repository PDFs were readable as text-layer PDFs. Manual source inspection correctly classified their roles, but the extraction engines did not reliably produce that understanding:

- The deterministic baseline completed on FEMA and the educational guide, but returned substantial semantic noise. It failed on FEP Blue Focus during schema validation before the result could be used.
- The offline P2 rules prototype found **0** candidates in FEMA, **0** in FEP Blue Focus, and **2** candidates in the health-education guide. Both candidates were definition fragments incorrectly categorized as benefits.
- The P1 identity recognizer attested **0 plans** across the corpus. This is correct for the FEMA program brochure and educational guide, but misses the real FEP Blue Focus plan.
- Verified citations establish that quoted text occurs on the cited page; they do **not** establish that the quotation is the right insurance fact, category, qualifier, plan, or enrollment option.
- Candidate-level P2 isolation was exact for this run. The baseline all-three mixed run and browser-level comparison acceptance were blocked; no live service or upload flow was exercised.

No prior P2 corpus score is reused or compared as if measured here. The earlier 62-fixture / three-travel-PDF experiment is not this benchmark.

## 2. Environment and engines

### Test documents and readability

The exact root files were processed locally with the existing `extractPages` utility (`unpdf`, text layer, `mergePages: false`). They were extracted sequentially, not concurrently. The FEP input was 2,068,164 bytes, below the utility's 20 MiB limit, and its 140 pages were below the 200-page limit. No PDF text was sent externally.

| Exact file | Bytes | Extracted pages | Non-empty pages | Extracted text characters | Readability |
|---|---:|---:|---:|---:|---|
| `fema-nfip-protect-the-life-youve-built-brochure-09-2022.pdf` | 1,822,727 | 8 | 8 | 6,772 | PASS |
| `FEP-Blue-Focus-Brochure-2027-10-23.pdf` | 2,068,164 | 140 | 140 | 449,180 | PASS |
| `Health Insurance Brochure DIGITAL.pdf` | 2,194,523 | 13 | 13 | 38,638 | PASS |

### Engines used

- **Deterministic baseline:** existing `extractFallback` → `validateTable` → `attestPlans` → fail-closed citation verification / display grounding → production `resolveRowPlanIds` Stage E behavior. Read-only reproduction; no LLM branch.
- **P2 prototype:** existing `discoverCandidates` from `scripts/p2-experiment/discovery.ts`, invoked independently per document and together. This is the existing **deterministic rule-based prototype**, not an LLM. It uses the existing evidence verifier and plan-attribution helper. New document IDs (`fema`, `fep`, `health`) were used so the original `doc-1`/`doc-2`/`doc-3` tier special cases did not fire.
- **LLM:** **SKIPPED**. Remote inference was prohibited; no local generation inference was used.
- **UI/browser:** **SKIPPED / BLOCKED** by the no-live-services/no-upload-flow rule.

## 3. Manual classification and plan discovery

Original PDF page numbers below are 1-based page indices into each exact PDF, not printed page labels where those differ.

| Document | Manual classification and source basis | Verified plan identities | Tiers / enrollment configurations | Legitimately selectable comparison? |
|---|---|---|---|---|
| FEMA NFIP brochure | Program-level flood-insurance brochure and educational reference. Page 1 names the National Flood Insurance Program and says FEMA oversees it. Page 5 presents maximum available building/contents limits by property type. | No individual policy or purchased policy identity is established. NFIP is a program, not a user's selected contract. | Page 4 says contents-only coverage can be purchased with building coverage or by itself for a renter. Page 5 limits are maximums available by property type, not the reader's purchased limits. | **No.** An agent may help a person purchase a policy, but this brochure does not identify an individual's policy or a second comparable plan. |
| FEP Blue Focus 2027 | Actual federal employee health-benefit plan brochure. Page 1 names “Blue Cross® and Blue Shield® Service Benefit Plan” / “FEP® Blue Focus,” identifies a fee-for-service plan with PPO, sponsor/administrator, and eligible enrollees. Page 5 says the brochure is the official statement of benefits under contract CS 1039. | **FEP Blue Focus** is manually source-verified as one actual plan. The existing recognizer attested **none**. | Page 1 lists enrollment codes 131 Self Only, 133 Self Plus One, 132 Self and Family. Page 10 defines who is covered under each. These are enrollment configurations of one plan, not three products/plan identities. | **No.** One actual plan is present, but this document provides no second plan to compare. Do not treat the three enrollment configurations as separate insurance products. |
| Health Insurance guide | Educational reference: page 1 calls itself “A Patient’s Guide for 2026,” describes an overview of Medicare, Medicaid, and commercial coverage, and says it is not exhaustive and varies by health plan/patient/setting. | No particular plan is identified. Medicare Parts A–D are described as program components; they are not four independently selectable plans in this document. | No selected plan or plan tier. Medigap and Medicare Advantage are mentioned as coverage types, not as specific purchased products in this guide. | **No.** It is not a plan brochure and has no verified selectable plan. |

**Plan discovery result: FAIL.** The no-plan outcomes for FEMA and the educational guide avoid phantom plans, but missing FEP Blue Focus means the engine fails on a real plan. No comparison plan should be invented from program limits, Medicare parts, or FEP enrollment configurations.

## 4. Baseline versus P2 prototype — measured results

Times are local elapsed milliseconds from this diagnostic run, after per-document text extraction. They are single-run measurements, not a benchmark of production latency or an improvement estimate. The baseline timing for FEP ends at its validation failure.

| Document / run | Deterministic baseline | P2 rules prototype |
|---|---|---|
| FEMA alone | **PASS to completion:** 5 populated rows, 7 values; 7/7 evidence citations verified; 0 grounding failures; 0 attributed plan values; 18 ms | **0** candidates, 0 concepts, 0 plan IDs; 6 ms |
| FEP alone | **FAIL:** `validateTable` throws `Invalid comparison table: row prescriptions: qualifiers.period not supported by evidence`; 336 ms. No validated table reaches citation / attribution gates. | **0** candidates, 0 concepts, 0 plan IDs; 181 ms |
| Health guide alone | **PASS to completion:** 24 populated rows, 107 values; 107/107 citations verified; 0 grounding failures; 0 attributed plan values; 41 ms | **2** candidates / concepts, both on PDF p.12; 2/2 cited spans verified; 0 plan IDs; 23 ms |
| All three together | **FAIL / blocked:** same FEP prescriptions-period validation error; 349 ms. No full mixed baseline comparison is available. | **2** candidates total (both assigned to `health`), 205 ms |

The P2 prototype's 2 outputs were:

1. PDF p.12: `Medicare: A government health insurance program that provides coverage for individuals aged 65 years or` — `category: benefit`, no qualifier.
2. PDF p.12: `older and for those younger than 65 years who have certain disabilities.` — `category: benefit`, `label-from-value-line` uncertainty.

These are fragments of an educational definition, not benefits of a particular plan. Both citations verify, but their concept/category/applicability are incorrect. **Sample semantic category precision for these two and only these two prototype outputs: 0/2.** This tiny count is not a general-population precision estimate.

### Manually labeled fact-target sample

The following eight source targets were selected before interpreting engine outcomes. A target counts as found only if an emitted fact has matching source evidence **and** the expected concept and material qualifier/applicability. Citations alone do not count as a correct fact.

| Target | Manual source truth | Baseline | P2 prototype |
|---|---|---|---|
| FEMA limits — p.5 | “You can purchase … up to the maximum amount … available” by property type; $250,000 building / $100,000 contents for single-family home. Available program caps, not a user's purchased limits. | Missed these limits. | Missed. |
| FEMA contents option — p.4 | Contents-only can be purchased with building coverage or by itself if renter. Conditional selectable coverage, not a purchased option. | Missed. | Missed. |
| FEMA waiting period — p.6 | Source describes a **typical** 30-day waiting period before a policy goes into effect. General program guidance, not proof of a particular policy's selected/effective terms. | Two duplicate `waiting-period` values; display omits “typically.” Correct topic match, but duplicate and qualification loss make it unsafe as a policy-specific assertion. | Missed. |
| FEP plan identity — p.1 / p.5 | FEP Blue Focus is an actual plan; contract and issuer context are present. | No result: validated baseline aborts on FEP. | Missed; no plan attested/candidate emitted. |
| FEP enrollment identity — p.1 / p.10 | Self Only, Self Plus One, Self and Family are enrollment types under the same plan, with different covered-member scope. | No validated result. | Missed; no candidates. |
| FEP deductible / OOP limits — p.17 / p.31 | Self Only deductible $1,000 vs Self Plus One/Family $2,000; preferred catastrophic OOP maximum $11,000 vs $22,000. Scope is enrollment-specific. | No validated result. Raw pre-validation extraction did not produce the p.17 deductible as a final value; the OOP row contains title/TOC fragments and cut-off enrollment text. Not counted as successful extraction. | Missed; no candidates. |
| Health conditional OOP — p.3 | Guide says no yearly OOP limit under Original Medicare **unless** Medigap or Medicare Advantage (Part C). Educational/program-level conditional statement, not a plan value. | No correctly scoped out-of-pocket-maximum value in the validated output. | Missed. |
| Health Part D cap — p.4 | 2026 Part D out-of-pocket drug cap of $2,100/year; educational account of a program-level rule, not a chosen plan. | Matched under `prescriptions` with verified evidence, but mixed in a broad prescription row; no plan attribution. Correct source phrase does not make it an individual plan benefit. | Missed. |

On that deliberately small target set, strict sample recall was **baseline 1/8** (the Part D passage only) and **P2 0/8**. This is sample recall only, not corpus recall. Baseline precision is **not measured**: the 114 accepted values across FEMA and the guide were not exhaustively hand-labeled. FEP contributes no validated baseline output. The prototype's two emitted candidates were exhaustively reviewed above, but that does not support a broader precision claim.

## 5. Representative correct facts and misclassifications

### Source-backed facts the engines handled or exposed

- **FEMA, PDF p.5:** the source says the reader “can purchase” flood insurance “up to the maximum amount” shown by property type; single-family home building $250,000 and contents $100,000. Neither engine emitted this distinction. Do not report either number as an individual's limit.
- **FEP, PDF p.17:** the source explicitly states the 2027 Self Only deductible is $1,000 and Self Plus One / Self and Family deductible is $2,000. This is a real plan fact with enrollment applicability. It did not emerge as a validated baseline result, and P2 emitted no candidate.
- **FEP, PDF p.17:** the source states preferred-provider catastrophic OOP maximums of $11,000 for Self Only and $22,000 for Self Plus One / Self and Family. The raw fallback output contained fragments but not a usable validated enrollment-specific fact.
- **Health guide, PDF p.4:** the baseline extracted the source's 2026 “$2,100 cap” under Medicare Part D in the `prescriptions` row. The quote is source-backed, but must remain a guide/program-level statement, not an individual's plan limit.
- **Health guide, PDF p.12:** the baseline extracted the definition “Deductible: A dollar amount that you must pay each year before your plan will provide coverage.” This is an educational definition, not a specific plan deductible. P2 instead emitted the separate Medicare definition as a `benefit`.

### False positives, missed concepts, and wrong qualifiers

- **FEMA baseline noise:** “specialists to help you with questions about flood mapping and insurance” and a scheduled specialist contact were placed in `specialist-visit`; a homeowners-insurance exclusion sentence was placed in `material-exclusions`; a page-navigation sentence was placed in `age-limits` and `eligibility-for-you`. Citations verify, but concepts are wrong. These account for the 7/7 citation-verified FEMA values; 7/7 is not 7 correct facts.
- **FEMA misses:** the maximum-limit table, the building/contents distinction, the contents-only purchase option, and purchase/effective-policy context were not represented. The general 30-day waiting-period text was duplicated and its “typically” qualifier disappeared from the displayed value.
- **FEP baseline failure:** raw `extractFallback` creates a `prescriptions` value with qualifier `period: annual`, while the evidence quote contains `nextAnnual` (the extracted text has the line boundary collapsed). `validateTable` cannot find an `annual/yearly` token in that quote and throws. This occurs before final citation verification or plan attribution. Do not count raw values as production-path results.
- **FEP missed identity/configuration:** the first-page title format is not recognized by the current plan attestor. The actual three enrollment codes therefore cannot be attached to a verified plan. The three enrollment codes must not become three plans.
- **Health guide baseline noise:** broad keyword rows turn educational, general descriptions, definitions, table-of-contents fragments, and referrals into benefit/cost/eligibility candidates. Examples include `Part A: Hospital insurance` as hospitalization, plan-term definitions as comparison facts, and generic Medicaid eligibility prose as user-specific eligibility. The 107 verified values include substantial such noise; a full semantic precision score was not measured.
- **P2 categorization:** both outputs are definition fragments categorized as `benefit`; one has a broken value-line label. No flood-insurance concept or FEP benefit concept generalized.
- **Rejected citations from extraction:** the prototype runner does not expose a count of candidates rejected before emission, so a rejection total is **not available**. No failed citation is counted as a verified fact.

## 6. Citation and applicability accuracy

- Deterministic baseline, successful documents only: **114/114** value citations verified (FEMA 7/7; health guide 107/107); **0** citations failed and **0** display-grounding failures. These are mechanical citation/grounding outcomes, not semantic accuracy.
- FEP baseline: citation-stage totals are **BLOCKED** because schema validation fails first.
- P2 prototype: its two emitted candidates had **2/2** citations verified. Verification proves those definition fragments occur on PDF p.12; it does not correct the false benefit category.
- Direct fail-closed spot checks: for each of the three documents, one valid passage verified (**3/3**); the same passage cited to a different page was rejected (**3/3**); an invented quotation on the correct page was rejected (**3/3**). This confirms the existing verifier behavior on these examples only.
- Plan attribution: the recognizer attested **0** identities in all three documents. Thus no result was incorrectly attributed to a recognized plan, but the real FEP Blue Focus plan and its values were left undiscovered/unassigned. Meaningful plan-attribution recall is **BLOCKED**, not a pass.

## 7. Mixed-document test

- **P2 candidate isolation: PASS for this run.** Each document was processed alone and in the combined run; exact candidate-set comparison was FEMA 0 vs 0, FEP 0 vs 0, health guide 2 vs 2, with 0 candidates appearing/disappearing across the runs. Both combined-run candidates retained `documentId: health`. This checks candidate-level document identity isolation, not general security isolation.
- **Deterministic baseline mixed run: BLOCKED.** The combined funnel stops on the same FEP validator error, so no valid all-three comparison table or complete baseline alone-vs-together value-set check exists.
- **Comparison suitability: PASS (manual decision not to compare).** No pair is a meaningfully comparable verified plan set: FEMA is a program brochure, the health guide is educational, and FEP contributes one actual plan with no peer. A flood-vs-medical comparison or invented plan selection would be misleading.
- **Browser-level acceptance: BLOCKED.** The comparison renderer could not be exercised without a live upload/service path. No browser upload, remote service, or live model call was run.

## 8. FEP 140-page processing

The exact FEP PDF was read successfully as **140/140 non-empty pages**, 449,180 extracted characters, from a 2.07 MB file. It was processed sequentially under the existing PDF extractor's 20 MiB / 200-page bounds; this was bounded whole-file text extraction, **not** a claim of streaming PDF parsing. Extraction took 871 ms in the measured local run.

- Deterministic baseline completed extraction/regex work but failed `validateTable` after 336 ms on the `prescriptions.period = annual` / `nextAnnual` evidence mismatch. There is no validated result to score.
- P2 rules prototype completed in 181 ms but emitted **0** candidates and **0** concepts. The current section/label heuristics did not understand this 140-page federal plan brochure.
- Direct source inspection verified actual identity and benefits on PDF pages 1, 5, 10, 17, 31, 35, and 38. The extraction failure is not because the PDF was unreadable or over the existing bounds.
- Peak memory was not instrumented; no memory-usage claim is made.

## 9. Latency and failure analysis

| Operation | FEMA | FEP 140 pages | Health guide | All three |
|---|---:|---:|---:|---:|
| PDF text extraction, sequential | 189 ms | 871 ms | 99 ms | Not summed / not a concurrent run |
| Deterministic baseline funnel | 18 ms | 336 ms, validation failure | 41 ms | 349 ms, validation failure |
| P2 rules prototype | 6 ms | 181 ms, zero candidates | 23 ms | 205 ms, two candidates |

The primary baseline failure is a qualifier tokenization/normalization mismatch, not a provider failure. The primary P2 failure is coverage of document structure and concept classification. All elapsed times are one local run and should not be used as latency targets or as evidence that one engine is faster in general.

## 10. Generalization verdict and limitations

**FAIL — new-concept generalization is not demonstrated.** The candidate prototype did not discover the FEMA limits or conditional contents option, or any FEP plan fact. Its only two outputs were miscategorized educational-definition fragments. The baseline did extract one relevant Part D program-level cap among the eight manually labeled targets, but it also produced false positives and could not process the FEP document through validation.

The test set is three documents, one run per engine; the labeled sample is intentionally small. It cannot establish performance on other insurers, programs, document layouts, OCR/scanned PDFs, or other versions. The rule-based P2 prototype is not an LLM evaluation, and neither this report nor its timings establish LLM-path behavior.

## 11. Smallest recommended production improvements

These are recommendations only; no fix is implemented here.

1. **Fix the FEP validation blocker without weakening validation.** Preserve the line boundary when tokenizing `next Annual Coordinated Election`, or avoid deriving an `annual` qualifier from a token concatenation that the source evidence cannot prove. Add a focused regression using this exact source shape before assessing any FEP extraction quality.
2. **Generalize first-page plan identity proof behind deterministic source verification.** Recognize a named product in title/declaration context such as FEP Blue Focus, while keeping the evidence and C6 gates fail-closed. Keep Self Only / Self Plus One / Self and Family as qualifiers/configurations, not plan identities.
3. **Make document role and scope explicit in discovery candidates.** Distinguish a program-level brochure, educational guide, actual plan document, and unresolved source; carry conditional/program-level scope. Do not promote educational definitions or NFIP maximum available limits into a user's purchased benefits.
4. **Extend the local gold set before enabling extraction changes.** Include these exact held-out documents and balanced examples of property-type caps, enrollment configurations, conditional benefits, exclusions, examples, definitions, and ambiguous statements. Score concept, applicability, category, and citation separately.

No architecture or production changes are authorized or made by this diagnostic report.

## 12. Remaining LLM-path unknowns

- Whether an LLM would recognize the FEP title and preserve the three enrollment configurations without asserting three plans.
- Whether it would distinguish program-level FEMA limits and educational Medicare statements from an individual's selected coverage.
- Whether it would extract FEP cost-sharing and exceptions with correct enrollment, network, and conditional qualifiers.
- Whether model candidates would reduce or increase false positives, concept noise, and validator failures under the same fail-closed evidence/grounding/C6 checks.
- Latency, token use, and failure behavior are unmeasured. No remote inference was attempted and no local generation model was used.

## 13. Files changed and checks performed

**Repository file authored:** `docs/UNSEEN_DOCUMENT_GENERALIZATION.md` only.
**Application code, prompts, schemas, C6 attribution, RAG, frontend, and existing tests changed:** NONE.
The three PDFs and all pre-existing uncommitted repository files were preserved. Temporary diagnostic scripts/output were kept outside the repository under the approved OpenCode temp directory. No commit, network request, upload, migration, deployment, or destructive Git operation was performed.

Checks performed:

- `file` on the three exact PDFs — all recognized as PDFs.
- Existing `extractPages` utility on all three — 8/8, 140/140, and 13/13 non-empty pages; PASS.
- Local deterministic baseline and P2 prototype runs individually and together — outcomes and failures recorded above.
- Manual inspection of representative source passages by original PDF page — completed.
- Citation verifier spot checks — valid citations 3/3; wrong-page rejections 3/3; invented-quote rejections 3/3.
- Browser/E2E upload acceptance — **BLOCKED / intentionally not run** under the no-live-services rule.
- Full unit/type/build test suite — not run; no application source or test files were changed.

### Acceptance summary

| Area | Verdict |
|---|---|
| PDF readability / document classification | **PASS** (manual classification; all text layers readable) |
| Engine document classification | **FAIL** (no classification output; P2 miscategorizes educational definitions) |
| Plan discovery | **FAIL** (FEP Blue Focus missed; no phantom FEMA/guide plan) |
| Evidence citation mechanics | **PASS** on measured verifier checks; semantic correctness remains separate |
| Evidence / plan applicability attribution | **BLOCKED** for useful plan attribution; FEP baseline fails before gate and no plan is attested |
| New-concept generalization | **FAIL** |
| Mixed P2 candidate isolation | **PASS** for this run |
| Full mixed baseline / browser comparison acceptance | **BLOCKED** |
| LLM extraction path | **BLOCKED / SKIPPED** |
