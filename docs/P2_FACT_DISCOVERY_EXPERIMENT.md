# P2 Fact-Discovery Experiment (offline, bounded) — Report

Status: **experiment complete, NOT implemented in production.** This document reports a bounded, offline
evaluation authorized by the owner after P1 Controlled Evidence Ownership was accepted. No production code,
schema, C6 attribution semantics, presentation, chat, or UI behavior was changed. Nothing here is deployed or
wired into the request path.

## 1. Question

Does evidence-constrained **open-vocabulary** fact discovery beat the existing fixed 43-fact regex inventory
(`app/lib/extraction/fact-list.ts`) on real PDFs — finding the right facts, staying inside the attribution and
evidence contracts, and adding coverage the fixed inventory structurally cannot have?

## 2. Method

- **Corpus:** exactly the three authorized PDFs in `nonstandard/` (gitignored):
  - `doc-1` — Patriot Exchange (PEP Group, EPSWN) certificate, 34 pages
  - `doc-2` — WorldTrips StudentSecure benefits/narrative, 8 pages
  - `doc-3` — Seven Corners Travel Medical schedule, 4 pages
- **Ground truth** (`scripts/p2-experiment/ground-truth.ts`): 62 fixtures built by manual inspection of the
  dumped per-page PDF text — each records document, page, verbatim span, kind, expected concept,
  plan/tier applicability, and expected handling (display vs withhold).
  - `doc-1` ×21, `doc-2` ×19, `doc-3` ×22
  - kinds: coverage facts, deductible/limit facts, exclusions/restrictions, eligibility, tier-dependent
    values, one optional rider (Adventure Activities), narrative passages expected to be withheld
    (marketing prose, definitions, conditions boilerplate), and P1's known false positives
    (gt-217 Provider Referrals, gt-319 "130+ languages", gt-118 premium condition).
  - aggregate: 53 display / 8 withhold / 1 optional.
- **Baseline** (`baseline` mode): the full production deterministic funnel reproduced by the runner —
  `extractFallback` → `validateTable` → `attestPlans` → `attributePlanScope` → Stage E with
  `resolveRowPlanIds`, stripping the pre-gate planId exactly like production.
- **Experimental prototype** (`prototype` mode): an open-vocabulary candidate-fact prototype
  (`scripts/p2-experiment/discovery.ts`) that discovers concepts from section structure, labels, and value
  tokens rather than a fixed fact list, then attributes strictly through the production C6 helpers
  (`attestPlans` + `resolveRowPlanIds`) and verifies every candidate's evidence span fail-closed through the
  production verifier (`verifyEvidenceCitation`).
- **Adjudication:** a fixture counts as discovered only when a final candidate's verified evidence quote
  overlaps the fixture's verbatim span AND the candidate's concept key is compatible with the expected
  concept (light stemming + spelling canon + exact/containment/significant-token-overlap/head-token rules;
  fully generic vocabulary such as `maximum`/`limit`/`coverage` alone never satisfies the match).

**Honest limitation — stated up front:** local inference was unavailable for generation in this environment
(Ollama serves only `qwen3-embedding:0.6b`; no instruct model). Per the authorized fallback, the prototype is
**deterministic rule-based** candidate discovery. It demonstrates that open-vocabulary *candidate
generation + validation* is feasible under the evidence contract, but it does **not** demonstrate model
reasoning, and **full LLM-based open-vocabulary fact discovery remains untested** in this experiment. The
prototype's label heuristics (including a small `LABEL_CANON` canonicalization table and a small seed-phrase
list for narrative-prose facts) are part of the prototype, not a new fixed inventory — but they are still
hand-written rules, and the comparison below should be read with that in mind.

## 3. Results on the same 62 fixtures

| Measure | Baseline (production funnel) | Prototype (open vocabulary, rules-only) |
|---|---|---|
| Display fixtures extracted into the right row/concept | **22 / 53 (41.5%)** | **52 / 53 (98.1%)** |
| Withhold fixtures correctly withheld | 1 / 8 | 8 / 8 |
| Optional rider handled correctly (not attributed to base plan) | 1 / 1 | 1 / 1 |
| Unsupported attributions | **3** | **0** |
| Duplicate-value flags (indistinguishable duplicates) | gt-202 ×4, gt-214 ×3, gt-311, gt-312 | 0 |
| Wrong-row/wrong-concept cases | gt-107, gt-110, gt-112, gt-308, gt-310, gt-312 | gt-303 (1, accepted — see §6) |
| Display fixtures missed | ~24 | 1 (gt-303) |

Definitions: "extracted into the right row" = the fixture's verbatim span is covered by a final value's
verified evidence, and the fact row is the inventory row expected for that concept (baseline) or the
candidate's concept key is compatible with the expected concept (prototype). "Unsupported attribution" = a
candidate/value carrying a planId whose attest evidence does not verify, or a withhold fixture being
attributed at all.

## 4. Attribution

- **Prototype:** 303 candidates produced; **235 (77.6%) carry a planId proven through the production C6
  funnel** (`attestPlans` mentions + `resolveRowPlanIds`); the remaining 68 abstain (declared, unassigned).
  **0 unsupported attributions** — every planId on every candidate traces to attest evidence that verifies.
- **Baseline:** Stage E proved 3 attributions that the ground truth does not support (gt-118 premium
  condition, gt-217 Provider Referrals, gt-319 130+ languages) — i.e., the fixed inventory matched regex
  shapes inside narrative/condition prose that should be withheld.

## 5. Evidence verification (the hidden failure mode)

Every prototype candidate is verified by the production fail-closed verifier (unique normalized verbatim
span on the cited page). Findings:

- **257 of 303 candidates verified on their own window; 46 required minimal widening** (24
  `widened-evidence-window`, 22 `forward-continuation` lines) and **all 46 then verified** — repeated
  identical tier-column lines (doc-3 "70 to 79 years old: $50,000; $100,000" appears twice; doc-2 wrapped
  per-column cells) fail a naive unique-span check and were silently dropped before widening was added.
- **Anything that could not verify was dropped, never repaired.** The verifier remains the load-bearing
  guarantee; discovery only proposes candidates and widens their evidence window within tight, flagged
  bounds (upward depth ≤ 6 lines + one forward continuation line, each flagged in `uncertainty`).
- Production cross-check: 745/745 kept-value citations still verify (P1 numbers unchanged).

## 6. False positives and residual wrong-concept cases

- **gt-303 (doc-3, page 2 — accepted, honest FP example).** The corpus's one real deterministic-failure
  shape: wrapped coinurance prose ("We pay 80% of the first / $10,000 in covered / expenses, then 100% to
  the medical maximum.") splits value tokens across line boundaries; the prototype derives garbage keys
  (`we-pay`, `expenses-then-100-to-the-medical-maximum`). The baseline fails the same passage differently
  (tier-splitting produces wrong-row values). This is deliberately kept as the demonstrated boundary of
  rule-based tier splitting on wrapped prose.
- **Prototype candidate noise:** 192 unique concept keys; ~51 overlap the inventory; curated review finds
  **~40 genuinely new concepts** (§7) and **~100 fragment/garbage keys**; per-candidate, a heuristic
  classification marks **~24% of the 303 candidates as garbage-keyed** — concentrated in doc-3 wrapped
  prose and doc-2 marketing pages. In production this noise would be *visible and filterable* (declared
  candidates with uncertainty flags), unlike the baseline's misclassification, which looked correct.
- **Withheld content:** all 8 narrative fixtures (PPACA notice, marketing prose, definitions, conditions
  boilerplate, Provider Referrals, 130+ languages) were correctly withheld — no candidate mentions carried
  them into display.

## 7. Genuinely new concepts discovered (outside the fixed inventory)

Representative open-vocabulary discoveries the 43-fact inventory cannot express:

- **AD&D schedule**: accidental death & dismemberment, principal-sum loss schedule (1 hand/foot/eye combos,
  loss of limbs, sight of both eyes)
- **Organized sports**: intercollegiate/interscholastic/intramural/club sports limits ($7,500/$5,000 per
  injury or illness)
- **Walk-in clinic** ($20 copay, not subject to deductible)
- **Vaccinations** ($150, enumerated covered vaccines, SMART = No coverage)
- **Adventure Activities** rider (the corpus's one optional rider, discovered unassigned)
- **Trip interruption** and **loss of checked baggage**
- **Natural disaster evacuation/repatriation**; **return of mortal remains**; **local burial/cremation at
  place of death**; **emergency medical reunion**; **repatriation for medical treatment**
- **Dental care family**: emergency dental treatment, dental accident, sudden relief of pain, treatment due
  to unexpected pain to sound natural teeth
- **Nursery care of newborn**; **therapeutic termination of pregnancy**; **maternity care for a covered
  pregnancy**; **maternity and newborn care**
- **Intensive care**, **laboratory**, **radiology/x-ray**, **pre-admission testing**,
  **outpatient surgical/hospital facility**, **extended care facility upon direct transfer**
- **Copay qualifiers**: emergency-room copay, physician office visit copay, urgent care center copay,
  student health center copay, hospital inpatient copay
- **Menu/option facts**: medical maximum options (age bands 14–69 / 70–79 / 80+ with Basic/Choice tiers),
  deductible options (selectable)
- **Tier-scoped variants**: in-network vs out-of-PPO-network coinsurance inside/outside the US (the doc-3
  four-column shape)
- **Status/governance seeds**: PPACA status, limited-benefit-policy status, declaration-referenced values,
  J1 extension period, cancellation/refund policy, treatment window, assist-contact requirement
- **Eligibility**: "who can buy" intro-page requirements, extension-of-benefits-to-home-country,
  economic-sanctions exclusion, personal liability / third-person injury / third-person property

## 8. Recommended P2 production design (for approval — not implemented)

1. **Hybrid pipeline, two candidate sources, one validation funnel.** Keep the fixed inventory as a
   high-precision "known-fact" extractor, and add an open-vocabulary candidate layer (the discovery
   prototype) whose candidates flow through the same deterministic validators, C6 attribution
   (`attestPlans`/`resolveRowPlanIds`), and fail-closed evidence verification. Unknown-key candidates are
   displayed as declared/abstaining facts until verified — never invented, never auto-attributed.
2. **Evidence widening must be bounded and flagged** exactly as in the prototype (upward ≤ 6 lines + one
   forward continuation, flags `widened-evidence-window` / `forward-continuation`).
3. **Concept-key normalization layer:** a small canonicalization table + compatibility rules map
   open-vocabulary keys onto the display/comparable grouping; fully generic tokens never match.
4. **Withhold by default outside benefits/eligibility/declared sections.** Narrative sections (marketing,
   definitions, provisions, TOC, exclusions) only surface through explicit, flagged seed phrases — or, in
   the LLM design, through model-candidates that still pass the same verification funnel.
5. **The LLM layer is the actual P2 goal and remains untested.** Recommended next experiment (owner
   decision required): run an instruct LLM over the same three PDFs, constrained to (a) emit candidates
   with verbatim spans + plan/tier qualifiers, (b) pass every span through `verifyEvidenceCitation`, and
   (c) attribute only via `attestPlans`. Score it against the same 62 fixtures. Only evidence from such an
   evaluation can justify enabling a new retrieval/discovery strategy (AGENTS §15).
6. **No new infrastructure.** The prototype needs no new providers, queues, or storage; a production P2
   would live in the same Cloud Run/Next.js app with the same Supabase + pgvector owners.

## 9. Files changed (experiment only)

- `scripts/p2-experiment/ground-truth.ts` (new) — 62 ground-truth fixtures
- `scripts/p2-experiment/discovery.ts` (new) — open-vocabulary candidate prototype (rules-only)
- `scripts/p2-experiment/run-p2-eval.ts` (new) — evaluation runner (baseline + prototype modes, adjudicators,
  duplicate detector, candidate inventory dump)
- `docs/P2_FACT_DISCOVERY_EXPERIMENT.md` (this file)
- Session temp: dumped PDF page text, baseline/prototype verdict files, ledger (`p2-ledger.md`)

No production file was modified; nothing staged or committed; all 77 pre-existing modified tracked files
preserved.

## 10. Checks

- `npx tsc --noEmit` — clean (exit 0)
- `npm test` — **862 passed | 6 skipped** (unchanged; no test expectations modified)
- `git status` — 77 modified tracked files (unchanged) + untracked experiment files only
- Provider note: no remote LLM inference was performed or attempted; local generation inference was
  unavailable (no instruct model in Ollama), so provider integration is untested and reported as SKIPPED,
  not PASS.

## 11. Remaining unknowns

1. **LLM-based open-vocabulary discovery** — the core P2 hypothesis is untested without an instruct model;
   the 98.1% display number measures deterministic structure parsing, not model judgment.
2. **Wrapped-prose tier splitting** (gt-303 family) — needs either a sentence-joining pre-pass or the LLM
   layer; deterministic fixes are speculative.
3. **Generalization beyond three PDFs** — heuristics (tail-length rules, lettered-header forms, tier vocab)
   were tuned on this corpus; a larger corpus would expose overfitting.
4. **Noise-reduction policy** — the ~24% garbage-key candidate rate is acceptable offline but needs a
   production admission rule (e.g., minimum label quality / verified-span requirement before display).
5. **Concept-key stability for downstream grouping** — P2 dynamic grouping (Phase approval required) needs
   stable keys; fragment keys must never reach grouping.

## 12. Decision requested

Owner approval is required before any P2 production refactor (architecture/product rules: AGENTS §2, §11).
The single next action: review §8 and decide whether (a) to run the LLM-layer experiment first, (b) to
implement the hybrid deterministic pipeline as designed, or (c) to keep the fixed inventory and stop.

============================================================
HUMAN TERMINAL
============================================================

PHASE:
P2 Fact-Discovery Experiment (offline evaluation only)

DONE:
- 62-fixture ground-truth eval set built by manual inspection (doc-1 ×21, doc-2 ×19, doc-3 ×22;
  53 display / 8 withhold / 1 optional; all 8 required kinds covered)
- Production funnel reproduced and scored as baseline: display 22/53, withhold 1/8, optional 1/1,
  3 unsupported attributions, 6 wrong-row cases, duplicate-value flags
- Open-vocabulary candidate prototype built and scored: display 52/53, withhold 8/8, optional 1/1,
  0 unsupported attributions, 0 duplicates, 1 accepted FP (gt-303)
- Evidence verification validated end-to-end through the production fail-closed verifier
  (257/303 verified as-is, 46/46 verified after minimal flagged widening, 0 fabricated)
- ~40 genuinely new concepts outside the fixed inventory catalogued
- Recommended P2 production design written (hybrid pipeline; LLM layer flagged as the untested core)

FILES CHANGED:
- scripts/p2-experiment/ground-truth.ts (new)
- scripts/p2-experiment/discovery.ts (new)
- scripts/p2-experiment/run-p2-eval.ts (new)
- docs/P2_FACT_DISCOVERY_EXPERIMENT.md (new, this deliverable)

CHECKS:
- npx tsc --noEmit: clean
- npm test: 862 passed | 6 skipped (unchanged)
- git status: 77 modified tracked files preserved; nothing staged or committed
- LLM provider integration: SKIPPED (no instruct model available locally; no remote inference authorized)

ARCHITECTURE DIFF:
NONE (experiment code is outside the production execution path; no provider, queue, storage,
or attribution change was made)

RISKS / OPEN ITEMS:
- The prototype is rules-only: 98.1% display recall reflects deterministic parsing, not model
  reasoning; full LLM open-vocabulary discovery remains untested
- ~24% of prototype candidates are garbage-keyed (heuristic estimate), concentrated in wrapped prose
- Heuristics tuned on three PDFs; generalization unknown
- gt-303 (wrapped coinurance prose) accepted as a demonstrated deterministic boundary

NEXT ACTION:
Owner reviews docs/P2_FACT_DISCOVERY_EXPERIMENT.md §8 and chooses: run the LLM-layer experiment first,
implement the hybrid deterministic pipeline, or stop at the fixed inventory.

STOPPED FOR HUMAN APPROVAL
============================================================
