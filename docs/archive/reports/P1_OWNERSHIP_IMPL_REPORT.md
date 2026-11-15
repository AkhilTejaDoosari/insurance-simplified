# P1 Controlled Evidence Ownership — Implementation Report

Owner-approved scope: `docs/P1_ATTRIBUTION_DESIGN_REVIEW.md` (§3 proof model, §8 tests, §11 approvals).
Status: **implemented, verified, stopped for owner approval before P2.**

---

## 1. Proof semantics (exact, as implemented)

A value may now carry a `planId` at the extract route's Stage E gate **without** the
labelled `Plan/Fact/Value` line, only through the production helper
`resolveRowPlanIds(factName, values, plans, documents)` in
`app/lib/extraction/plan-identity.ts`. Per input value, in order:

1. **Claimed path (C6, unchanged).** A `value.planId` covered by a route-survived
   verified plan is kept **only** when its evidence contains the labelled
   plan/fact/value line (`hasPlanValueProof` — byte-for-byte unchanged contract).
   A failed claim is *not* evidence; the value falls through to the ownership
   evaluation like any unclaimed value.

2. **Mention-decisive path.** A value whose verified `planId` came from mention
   attribution (its own evidence names exactly one plan scoped to its document)
   keeps that planId when the provision passes the applicability guards and its
   peer group is conflict-free — **even on a multi-plan document**. This is owner
   requirement 8's "fail-closed *unless existing stronger proof is present*"; the
   mention is that stronger proof.

3. **Ownership path (values with no planId).** ALL must hold, else abstain:
   - **Unique document plan**: `uniqueDocumentPlanId` — exactly one verified plan
     identity covers the value's own document (multi-plan documents → abstain).
   - **Provision applicability**: `ownershipProvisionApplicable` — the display and
     cited quotes contain no abstention language (`OWNERSHIP_ABSTENTION_PATTERN`:
     riders, optional, add-ons, upgrades, endorsements, examples, illustrations,
     samples, for-instance, suppose, hypotheticals, alternatives, competitors,
     comparable-plan figures, shared provisions, marketing "offers") AND the
     display is not long digitless narrative (narrative guard: no digit and ≥ 45
     chars = marketing/definition/boilerplate prose → abstain; short digitless
     benefit labels stay attributable). The genuine selectable deductible-option
     menu ("Choose the option you want.") deliberately does **not** match any
     guard — deductible options stay attributable with their qualifiers
     (`selectionStatus: "selectable"`, owner requirement 3).
   - **No rival mention**: the value's text must not name another *verified*
     plan (`mentionsOtherVerifiedPlan`). A mention of the owning plan is fine.
   - **Document-scope void**: no page of the value's document may declare a plan
     other than the owner (`documentDeclaresOtherPlan`). This is document-level,
     not page-level: because page-1 attestation hardening no longer attests
     mid-document declarations, a later-page declaration would otherwise create
     an invisible second plan and let its page's values misattribute. A document
     with any such declaration voids ownership for **all** its values (fail-closed,
     restores design-review T9 semantics). Re-declaring the owning plan is fine.
   - **Conflict-free peer group**: the value's same-document peer group —
     evaluated on the *uniform* assignment (claimed/mention values included, so a
     contested group is detected even when some members claim proof) — must
     contain no same-scope contradiction (`hasSameScopeContradiction`, unchanged).

4. **Everything else abstains** (`planId: undefined`) → shared/unassigned data;
   never NOT- fabrication, never a plan winner.

Unchanged by design: all qualifiers preserved (tier, deductible-option,
eligibility, date, network, period); the mention-based attribution pathway
(`attributePlanScope` / `resolveValuePlanId` untouched); all C6 fail-closed
behavior; citation verification; page provenance; evidence IDs; original PDF
viewer; presentation conflict states. All 21 C6 contract tests in
`tests/unit/plan-identity.test.ts` remain 100% green **untouched**.

`validateTable` interaction (verified, not changed): `validateTable`
(`types.ts:272-275`) throws on engine-claimed planIds lacking labelled-line
proof, but the route builds `verified` without re-validation, so ownership-
assigned planIds cannot trigger it; the types.ts check continues to guard only
raw engine claims.

## 2. Attestation hardening (phantom identity rejection)

`attestPlans` now attests plan identities **only from a document's first page**
(title/declaration patterns unchanged otherwise). Measured before hardening: all
three authorized real PDFs attest on page 1 (Patriot Exchange ProgramSM, Get
StudentSecure, Seven Corners Travel Medical) — zero corpus cost. Known
fail-closed limitation: a plan declared only on a later page attests nothing at
all (reported, acceptable); a phantom declaration landing exactly on page 1
still attests, but the multi-plan void / document-scope void then abstains the
document's values instead of misattributing them.

## 3. Changed files

| File | Change |
|---|---|
| `app/lib/extraction/plan-identity.ts` | Header comment updated; page-1 attestation restriction; `OWNERSHIP_ABSTENTION_PATTERN`; `NARRATIVE_MIN_LENGTH`/`DIGIT_RE` narrative guard; `ownershipProvisionApplicable`; `uniqueDocumentPlanId`; `DECLARATION_NAME_RE`/`declarationNamesOnPage`; `mentionsOtherVerifiedPlan`; `documentDeclaresOtherPlan`; `resolveRowPlanIds`. Mention/claim attribution logic untouched. |
| `app/api/extract/route.ts` | Stage E gate restructured into two phases: (1) verify citations + display grounding per value; (2) `resolveRowPlanIds` over verified values. Removed `validPlanSources` (coverage now checked inside the helper). Imports updated. Comment-only changes elsewhere. |
| `app/lib/extraction/types.ts` | Doc comment of `hasPlanValueProof` updated to describe the ownership pathway (comment-only). |
| `app/lib/extraction/extract.ts` | Stale comment about single-match fallback corrected (comment-only). |
| `scripts/diag-real-pdf-attribution.ts` | Route mirror updated to two-phase Stage E semantics using production `resolveRowPlanIds`; per-plan gated buckets now count ownership attributions; stage labels updated. |
| `tests/unit/document-ownership.test.ts` | **New** — 34 tests covering the proof semantics (unique-plan, merged-plan, guards, phantom titles, rival mention, document-scope void, peer conflicts, immutability, document isolation). |
| `tests/unit/extract-route-engine.test.ts` | 2 tests updated (old Stage E pins on unique-plan docs, now ownership-keep) + 2 multi-plan counterparts added preserving the original C6 meaning. |
| `tests/unit/plan-identity.test.ts` | **Untouched** (21 C6 contract tests, all green). |

## 4. Attributed values (real-PDF regression, deterministic engine)

Harness: `npx tsx scripts/diag-real-pdf-attribution.ts` over the three
authorized PDFs (`nonstandard/`, gitignored). Funnel:

```
kept values:                 745   (745/745 citations verified, 0 dropped,
                                    0 grounding-unsupported)
attributed (Stage E):         62    (pre-gate mention-attributed: 2 → both
                                    abstain at Stage E)
abstained:                   683
tiered values:                18
conflicting-evidence rows:     0    (presentation conflict flags)
plan-comparable rows:          7
document isolation:            identical (585/111/48 alone == together)
compare mode:                  enabled (3 proven plans ≥ 2)
```

Per plan (all source-backed: every value's citation verified against its page,
every plan attested on page 1 and source-verified):

| Plan | Attributed values | Distinct facts |
|---|---|---|
| IMG Patriot Exchange ProgramSM | 12 | 7 — premium, out-of-pocket-maximum, policy-limit (2), eligibility, specialist-visit, network-rules (5), student-health-center |
| WorldTrips StudentSecure | 33 | 18 — annual-deductible (4), dental-coverage (6), student-health-center (5), eligibility (2), age-limits (2), ad-and-d (2), chiropractic, emergency-care, emergency-reunion, maternity-coverage, mental-health, network, network-rules, physical-therapy, preventive-care, referral-requirement, vision-coverage, waiting-period |
| Seven Corners Travel Medical (USA) | 17 | 14 — annual-deductible, ambulance, chiropractic, coinsurance, eligibility, eligibility-for-you, emergency-care (3), emergency-evacuation (2), incidental-trip, physical-therapy, political-evacuation, pre-existing-conditions, primary-care-visit, urgent-care |

The two StudentSecure marketing mention values abstain at Stage E (guards +
peer conflict), so the route's outcome is 0 conflicting rows.

## 5. Comparison rows genuinely supported (plan-comparable, ≥ 2 plans)

`annual-deductible`, `emergency-care`, `eligibility`, `network-rules`,
`physical-therapy`, `chiropractic`, `student-health-center`.

Note: 34 rows are comparable *across documents* (same facts visible from each
document); only the 7 above are attributable to ≥ 2 verified plans. This is the
honest V1 surface: each row still shows per-document values and evidence; the
plan-attributed subset is what compare-mode can rank without fabricating scope.

## 6. False-positive attribution analysis

**Plan-scope false positives: 0.** No attributed value names another verified
plan, cites a page/document declaring another plan, uses abstention language, or
belongs to a multi-plan document. All 62 are the owning plan's own provisions
per their cited passages (manual review of the full 62-value dump).

**Fact-row noise (known, reported, NOT silently accepted):** ~14 attributed
values carry plan-true text in the *wrong fact row* — e.g. emergency-care
amounts matching `emergency-care`'s bare-keyword regex from adjacent benefit
lines, political-evacuation assistance prose in `political-evacuation`
("interpreters available in 130+ languages…" — the digit "130+" survives the
narrative guard), "No waiting period stated" in `waiting-period`. These are
extraction-regex noise from `app/lib/extraction/fact-list.ts` (bare-keyword
fact regexes), a pre-existing extraction-layer issue now *visible* because the
values are plan-attributed. P2 scope; do not widen the ownership guards to hide
it (that would also hide correct values).

**Borderline cases kept attributable (with reasoning):**
- doc-3 `Deductible Options (You pay) $0 - $5,000 (Choose the option you
  want.)` — genuine selectable option menu (owner requirement 3); carries
  `selectionStatus: "selectable"`.
- doc-1 premium line ("timely paid applicable Premium for at least thirty (30)
  days…") — premium-payment eligibility condition, plan-specific, cited, no
  guard language.
- doc-3 eligibility prose ("Travelers must be non-U.S. residents who are 14
  days of age or older…") — digit-bearing, plan-specific eligibility rule.

## 7. Test results

```
npm test:              862 passed | 6 skipped (868)
  baseline before P1:  826 passed | 6 skipped
  added by P1:         +36 (34 document-ownership + 2 route counterparts)
  pre-existing tests changed in meaning: only the 2 flagged route pins
  skipped:             the same 6 env-gated tests (LLM-key / embedding-service
                       gated) as before; none newly skipped
npx tsc --noEmit:      clean
```

Skipped tests were NOT converted to PASS; they skip because remote LLM /
embedding credentials must not be exercised (AGENTS.md §9/§15).

The exact real-PDF regression lives in the diag script (not vitest) because
`nonstandard/` is gitignored/untracked by design.

## 8. LLM-path unknowns (explicitly not measured)

The route auto-selects `extractViaLlm` when LLM env is configured
(`route.ts:83-93`); LLM keys exist locally but remote inference is prohibited
in this environment. Therefore **unmeasured**: (a) Stage E's effect on
LLM-emitted planIds (the same `resolveRowPlanIds` gate applies — claimed paths
keep labelled-line proof, ownership path resolves the rest, fail-closed); (b)
whether the LLM emits the `Plan/Fact/Value` proof line at a different rate; (c)
LLM-side marketing-prose emission rates. The deterministic fallback path is the
only measured path; the LLM path degrades fail-closed (abstain), never
misattributes by design of the gate order.

## 9. Risks / open items

- A phantom declaration landing exactly on page 1 still attests a plan identity
  (attestation is a title/declaration-pattern match, not a semantic judge);
  such a document becomes "multi-plan" or document-void, and all its values
  abstain — fail-closed, but plan discovery is polluted until P2's fact
  registry.
- Legitimate plans declared only on page 2+ lose attestation entirely
  (fail-closed limitation; owner acknowledged in design review).
- Fact-row regex noise is now plan-visible (P2 scope).
- ~10 attributed values are tier-table lines with inline tier labels
  ("Budget/Select/Elite" columns flattened into one display string). Plan-scope
  is correct; tier *parsing* remains the existing qualifier pipeline's job.
- No schema migration, no frontend changes, no provider/infra changes.

## 10. Approvals honored

- No commits, pushes, PRs, deployments, or destructive git operations.
- All 77 pre-existing modified tracked files preserved untouched.
- No new runtime dependencies; no environment changes; no locked-doc edits.
- Implementation halts here — **P2 (dynamic fact registry / grouping) requires
  separate owner approval** per design review §11.
