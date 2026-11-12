# Real-Document Accuracy Correction Implementation Plan

> **For agentic workers:** Execute natively in this session; no subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local deterministic extractor emit only evidence-verifiable, correctly scoped facts for the authorized WorldTrips and Seven Corners brochures, without changing citation or C6 security boundaries.

**Architecture:** Keep work inside the existing Next.js deterministic extraction and identity modules. Preserve `verifyEvidenceCitation` fail-closed behavior; improve or suppress parser candidates before they reach the existing validator. Recognize names only from explicit source title/identity text, never filenames, and do not infer value-to-plan ownership from document identity alone.

**Tech Stack:** TypeScript, Vitest, existing `unpdf` local parser and current deterministic evidence verifier; no new dependencies or provider calls.

**Spec:** Owner authorization in this conversation; governing contracts in `docs/PRODUCT.md`, `docs/DOMAIN.md`, `docs/SECURITY.md`, `docs/ACCEPTANCE.md`, and `docs/ARCHITECTURE.md`.

## Global Constraints

- Local PDF processing only; never call external model, API, telemetry, or cloud service with source content.
- Keep original-page evidence, citation verification, fail-closed ambiguity behavior, and C6 attribution requirements unchanged.
- Do not infer plan names from filenames or assign values based on document identity, page position, or nearby headings alone.
- Preserve `NOT STATED`, qualifiers, currency/percentage/age scope, and plan/tier attribution; unsupported facts remain absent or unresolved.
- Do not add dependencies, migrations, providers, infrastructure, commits, pushes, or deployments.
- Preserve all existing uncommitted work; no unrelated refactoring.

## Review Focus

- Repeated short table fragments must remain unverified unless a unique contiguous source span can be cited.
- Tier-column parsing must not distribute unrelated tokens or partial values across tiers.
- Broad fact-keyword matches must not become claims unless the source line has a supported fact/value relation.
- Official document/product titles may be confirmed from source text, but title evidence alone must not assign every document value to a plan.
- One-document extraction must be identical whether invoked alone or alongside the other authorized document.

## Baseline and Acceptance Criteria

Reproduced baseline using the unchanged `verifyEvidenceCitation` function:

| Run | Citation checks | Verified | Failed |
| --- | ---: | ---: | ---: |
| WorldTrips alone | 362 | 294 | 68 |
| Seven Corners alone | 84 | 80 | 4 |
| Both documents | 446 | 374 | 72 |

All 72 failures are ambiguous repeated spans on their claimed source pages. Wrong-page matches: 0; normalization/layout mismatches: 0; verifier false negatives: 0. The verifier is correctly failing closed. This is the citation-span baseline, not a claim that all 446 extracted fact labels or values are semantically correct.

Acceptance is based on correctness, not matching a target pass count:

- Zero values may be emitted as `SUPPORTED` when the unchanged verifier cannot produce a unique original-page quote for them.
- Every supported material display token and qualifier must be grounded in its own canonical source evidence; otherwise the candidate is omitted or left unresolved.
- Repeated/ambiguous evidence may be retained only as unresolved; it must not be made to pass by weakening citation rules.
- Source identity must be supported by source text that explicitly identifies the product; a carrier mention or filename alone is insufficient. Tier names remain separate from product names.
- Running either document alone or both together must produce identical facts for each document, with no cross-document evidence or qualifier contamination.
- Report before/after citation and value counts per document and combined, categorized by failure cause, including candidates safely rejected. No real PDF text or personal information is committed in tests.

---

### Task 1: Pin extraction defects with document-derived regressions

**Files:**
- Test: `tests/unit/extract-fallback-real-doc-patterns.test.ts` (or the existing extraction test file if that is the established placement)

**Interfaces:**
- Consumes: `extractFallback`, `verifyEvidenceCitation`, current page text shape.
- Produces: isolated regressions for repeated table labels, tier rows, irrelevant keyword-only lines, and separate-vs-combined documents.

- [ ] Add compact, non-personal source-pattern cases (not full PDF text or PDFs) that demonstrate: keyword-only prose does not become a numeric fact; repeated ambiguous fragments are not supported; a table's amount and tier stay together only when source structure proves it; unknown/unsupported values remain absent; and the same document's values are unchanged when processed alone or with another document.
- [ ] Run the focused test and confirm each new assertion fails for the current parser for the expected extraction/scoping reason.

### Task 2: Correct deterministic candidate parsing

**Files:**
- Modify: `app/lib/extraction/extract.ts`
- Test: Task 1 regressions

**Interfaces:**
- Consumes: existing `FACTS`, tier parsing, `verifyEvidenceCitation` contract.
- Produces: existing `extractFallback` output shape, with fewer unsafe candidates and only source-contiguous evidence.

- [ ] Implement the smallest parser correction that rejects keyword-only matches and prevents positional token guessing for tier values when the source does not prove column/value alignment.
- [ ] Preserve full qualifying source spans when uniquely locatable; if uniqueness or fact/value relation cannot be established, omit/downgrade the candidate rather than weakening verification.
- [ ] Run the focused tests and verify unique original-page citations and material displays for all newly accepted cases.

### Task 3: Confirm only source-supported product identities

**Files:**
- Modify only if required: `app/lib/extraction/plan-identity.ts`
- Test: `tests/unit/plan-identity.test.ts` or the existing plan-name test file

**Interfaces:**
- Consumes: source page text and current `attestPlans` contract.
- Produces: verified product identity only when source text explicitly identifies the product (not merely the carrier or brochure type); otherwise unconfirmed. Tier names stay distinct. No new value-to-plan attribution rule.

- [ ] Add tests for the authorized documents' title patterns using short non-personal text cases; assert filename-only titles are unconfirmed and source titles can be evidenced.
- [ ] Keep a fact unassigned unless its own citation satisfies the existing C6 plan attribution proof.
- [ ] Do not change identity recognition if doing so requires loosening C6 attribution; report the blocker instead.

### Task 4: Local-only acceptance and regression verification

**Files:**
- No new runtime/provider integration files; use tests and a local ephemeral command for the authorized PDFs.

**Interfaces:**
- Consumes: corrected deterministic extractor and existing verifier.
- Produces: per-document and combined counts, verified source identity, fact/tier/document attribution and citation outcome.

- [ ] Re-run the exact baseline and report before/after counts per document and combined, including ambiguity classifications and safely rejected candidates; only call a value supported when its unique original-page quote supports the display and qualifiers.
- [ ] Run the PDFs independently and together; assert no cross-document contamination and report all unconfirmed plan/value attribution.
- [ ] Run focused tests first, then `npm test`, `npx tsc --noEmit`, and `npm run build`; run E2E only if the corrected behavior can be exercised locally without external providers.
- [ ] Inspect the final diff and stop for owner review; do not commit.
