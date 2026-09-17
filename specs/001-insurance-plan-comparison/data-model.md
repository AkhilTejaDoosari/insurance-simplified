# Data Model: Insurance Plan Comparison

**Date**: 2026-09-16 | **Spec**: [spec.md](spec.md) | **Contracts**: [contracts/](contracts/)

All entities are session-scoped and memory-only (deleted on session close
unless exported). Field types are logical; see contracts for wire schemas.

## Uploaded Document

A user-supplied PDF accepted into the comparison set.

- `documentId`: unique within session (e.g. `doc-1`)
- `filename`: original filename as uploaded
- `pageCount`: number of extractable pages
- `status`: `ready` | `rejected`
- `rejectionReason` (when rejected): `too-many-files` | `not-pdf` |
  `unreadable` | `encrypted` | `non-english` | `over-size-limit` |
  `over-page-limit`
- Relationships: parent of Evidence Citations; member of exactly one
  Comparison Session (2–4 documents)

## User Context

Basic background collected at upload; each field applies to verdicts only
when documents reference it.

- `age`, `countryOrResidency`, `visaOrStatus` (optional),
  `location`, `coverageDates`
- Rule: an unused field MUST NOT influence any verdict (FR-003)

## Comparable Fact

One named comparison dimension (e.g. deductible, out-of-pocket maximum,
emergency care, prescriptions, pre-existing conditions, eligibility,
network; ~20–30 per set).

- `factName`: canonical label from the versioned fact list v1
- `values`: one per document — `{ documentId, display, qualifiers, evidence }`
- `qualifiers`: `{ networkTier?, period?, ageBand?, conditions? }` — rendered
  verbatim, never collapsed (FR-006)
- `verdict`: exactly one Comparison Verdict
- Validation: every populated value requires ≥1 Evidence Citation; a fact
  with values in no document is NOT STATED

## Comparison Verdict (closed enum)

Exactly one of: `SUPPORTED` | `DOES NOT APPEAR TO FIT` | `NOT STATED` |
`CONFLICTED` | `NEEDS VERIFICATION`. No other value is representable.

- `SUPPORTED`: the fact has cited, usable evidence. Different values across
  different documents/plans are normal comparison data and stay SUPPORTED.
- `DOES NOT APPEAR TO FIT`: user context rules the fact out for them
- `NOT STATED`: no uploaded document mentions the fact (only when there are
  no supported values for that fact at all)
- `CONFLICTED`: one plan contradicts itself under the same scope — same
  document, same fact, same qualifiers scope, two incompatible claims each
  with its own evidence. Row shows each contradicting value with its source.
  Cross-plan differences are SUPPORTED, never CONFLICTED.
- `NEEDS VERIFICATION`: statement vague, partial, or missing qualifiers;
  only when the source statement itself cannot safely support a concrete
  interpretation
- Transitions: verdicts are computed per extraction run; re-extraction
  replaces the full table (no partial updates)

## Evidence Citation

Proof backing one cell value or chat answer.

- `documentId`, `page` (1-based page number), `quote` (exact source text)
- Validation: `page` within the document's pageCount; `quote` non-empty and
  traceable to the extracted page text

## Chat Exchange

One side-panel round, scoped to the session's documents.

- `question`: user free text
- `kind`: `answer` | `refusal`
- `answerText` + `citations[]` (when answer; ≥1 citation required)
- `refusalText`: fixed shape stating no supporting evidence exists (when
  refusal; no generated claims allowed)
- Rule: corpus is the session uploads only — no outside knowledge (FR-017)

## Insurer Question

Suggested follow-up derived from a gap, genuine same-scope contradiction,
or ambiguity.

- `questionText`: concrete question for the insurer
- `motivatingFact`: fact name + triggering verdict (NOT STATED, CONFLICTED,
  or NEEDS VERIFICATION) + involved document IDs
- Validation: every suggestion links to ≥1 motivating fact row

## Collection Checklist (no-documents flow)

Guidance output when the user arrives without documents.

- `contextUsed`: the context fields collected in the guided flow
- `whatToLookFor[]`: checklist items naming facts/coverage to check
- `documentsToCollect[]`: document types to obtain
- `nextStep`: route back to upload once documents are in hand
- Rule: advisory text only — never a plan recommendation (FR-017)
