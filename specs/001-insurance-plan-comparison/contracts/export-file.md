# Contract: Export File v1

**Owner**: export path (`GET /api/export`) | **Schema version**: `v1`

The sole save mechanism (clarify session 2026-09-16): a file the user
downloads and keeps. No server-side saved state exists.

## Format

JSON document, UTF-8, downloaded with filename
`insurance-comparison-<date>.json`.

```jsonc
{
  "schemaVersion": "v1",
  "exportedAt": "<ISO-8601 timestamp>",
  "factListVersion": "v1",
  "userContext": { "age": "<…>", "countryOrResidency": "<…>", "location": "<…>", "coverageDates": "<…>" },
  "comparisonTable": "<full comparison-schema v1 payload>",
  "insurerQuestions": [
    {
      "questionText": "<concrete question for the insurer>",
      "motivatingFact": "<fact name>",
      "triggeringVerdict": "NOT STATED | CONFLICTED | NEEDS VERIFICATION",
      "documentIds": ["doc-1", "doc-2"]
    }
  ]
}
```

## Rules

- Export MUST round-trip qualifiers losslessly (re-import displays values
  identical to the live table).
- `userContext` includes only fields the user provided; unused fields stay
  as given, marked as not applied to verdicts.
- Every `insurerQuestions` entry links to ≥1 motivating fact row
  (FR-015).
- Consumers MUST reject files with a different `schemaVersion`.
