# P2 Local Adapter Safety Proof

**Status:** Local-only experimental proof; stopped for owner review. No model call, provider request, or PDF transmission was made. The adapter reads the exact saved compact response and selected original-page text only. It is not imported by `app/` and does not alter production behavior.

## Result

The gate promoted **0 of 8** real candidates. It accepted both synthetic positive candidates whose value, subject, citation, and representable scope passed the existing evidence and schema checks. Unknown, unsupported, ambiguous, incomplete, and schema-unrepresentable claims fail closed with distinct diagnostic statuses.

## Eight saved candidates

| #   | Candidate                                                               | Disposition | Reason                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Self Only annual deductible, $1,000                                     | Unmappable  | Enrollment scope has no lossless v1 schema field.                                                                                       |
| 2   | Self Plus One / Self and Family deductible, $2,000                      | Unmappable  | Enrollment scope has no lossless v1 schema field; the evidence also references a separate page for the amount context.                  |
| 3   | Self Only Preferred catastrophic maximum, $11,000                       | Unsupported | Includes a broad exclusion list that the cited amount evidence does not establish as complete. The adapter rejects the whole candidate. |
| 4   | Self Plus One / Self and Family Preferred catastrophic maximum, $22,000 | Unmappable  | Enrollment, provider/network semantics, and family-member exception cannot all be represented losslessly.                               |
| 5   | Preferred maternity-facility copayment, $3,000 per pregnancy            | Unmappable  | Network/facility and service scope have no safe mapping in the current v1 schema for this open concept.                                 |
| 6   | Tier 3 specialty-drug share, $600 maximum                               | Unmappable  | Enrollment, drug tier, network/program, and service scope are not representable without changing meaning.                               |
| 7   | Tier 3 specialty-drug share, $1,700 maximum                             | Unmappable  | Same schema gaps as #6; the evidence also combines multiple amounts and supply bands.                                                   |
| 8   | Who may enroll                                                          | Unmappable  | Eligibility concept and its exception cannot be losslessly represented by the current comparison-value schema.                          |

These experimental dispositions differ from the earlier evidence review's claim-completeness audit (`7 INCOMPLETE`, `1 UNSUPPORTED`): this adapter adds the separate `unmappable` classification and stops on schema gaps before attempting to assert semantic completeness. No candidate is promoted under either classification.

## Evidence and mapping checks

- The replay has **11/11 mechanically verified citation quotes** against their claimed page in the selected-page source text. Failed citation verification rejects a candidate; successful verification canonicalizes to the source span.
- Citation occurrence does **not** prove semantic applicability, amount-to-subject binding, completeness of an exception list, or authority of the page. The adapter is deliberately a narrow contract, not a semantic classifier.
- The only production-schema mapping allowlisted in this proof is the exact `deductible` concept to `Annual deductible`, with source-bound period/currency/frequency/age-band/conditions qualifiers when represented. Unsupported open concepts are not guessed into a row name.
- Synthetic positive 1: `$1,000 calendar year deductible` with a source passage naming the annual deductible and amount; accepted through `validateTable` with canonical evidence.
- Synthetic positive 2: same value with source-attested `period: calendar year`; accepted and the period is retained.
- Synthetic negative cases reject a missing required enrollment qualifier (incomplete), enrollment scope that cannot be represented (unmappable), unsupported exception scope (unmappable), exclusion assertions (unsupported), unknown scope keys, amount/citation mismatch, wrong-page citation, unknown document identity, phantom title, and competing explicitly declared plan titles.

## Plan identity and C6

- Experimental title recognition accepts `FEP Blue Focus` only because a matching title line is present in the first-page source text; it tolerates the registered mark in `FEP® Blue Focus`. It rejects phantom/non-title mentions and conflicting first-page declarations. This helper is diagnostic only and never mints a `ProvenPlan`.
- Unchanged production `attestPlans` recognizes **0** plans from these pages because the source title is not in the production helper's explicit declaration format. No production attestation change was made.
- The C6 ownership helper is unchanged. A numeric deductible citation with no production-attested plan resolves to `undefined`; there is no plan ID, plan ownership, or attribution based on a number-only quote.

## Schema gaps requiring owner approval

Before these values can be represented without loss, an owner-approved schema/design decision would be needed for enrollment category, general service/benefit subject, provider/facility/program scope, drug tier distinct from plan tier, exclusions, exceptions, and eligibility/“who may enroll” claims. Some current fields (`period`, `currency`, `frequency`, `ageBand`, `conditions`, `networkTier`) exist, but name similarity alone is insufficient: the adapter must prove exact semantic fit and evidence support before using them. No schema change is proposed or made here.

## Verification

- Adapter unit tests: **9 passed in the original local replay run**. The committed unit tests are self-contained synthetic cases and do not require local response/PDF artifacts.
- Full test suite: **891 passed, 6 skipped** in the original local replay run; skipped integration tests require configured external services and are not counted as passes. Snapshot validation is rerun after candidate selection.
- Typecheck and formatting are recorded in the final terminal below.
- The runner is `npx tsx scripts/p2-experiment/p2-local-adapter-safety-proof.ts`.

## Files added

- `scripts/p2-experiment/compact-adapter.ts`
- `scripts/p2-experiment/p2-local-adapter-safety-proof.ts`
- `tests/unit/p2-local-adapter.test.ts`
- `docs/P2_LOCAL_ADAPTER_SAFETY_PROOF.md`
- `docs/superpowers/plans/2026-10-28-p2-local-adapter-safety-proof.md`

Production modules and the saved source/response fixtures were not modified.
