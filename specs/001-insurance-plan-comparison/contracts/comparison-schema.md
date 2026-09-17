# Contract: Comparison Table Payload v1

**Owner**: extraction path (`POST /api/extract`) | **Schema version**: `v1`

The comparison table payload. Producers (extraction) and consumers (table
UI, export) MUST validate against this shape.

## Verdict enum (closed)

```text
"SUPPORTED" | "DOES NOT APPEAR TO FIT" | "NOT STATED" | "CONFLICTED" | "NEEDS VERIFICATION"
```

Any other value — including yes/no, true/false, match/no-match — MUST be
rejected by validation. Contract tests assert rejection.

## Table payload

```jsonc
{
  "schemaVersion": "v1",
  "factListVersion": "v1",
  "documents": [
    { "documentId": "doc-1", "filename": "plan-a.pdf", "pageCount": 42 },
    { "documentId": "doc-2", "filename": "plan-b.pdf", "pageCount": 30 },
    { "documentId": "doc-3", "filename": "brochure.pdf", "pageCount": 12 }
  ],
  "rows": [
    {
      "factName": "annual-deductible",
      "verdict": "SUPPORTED",
      "values": [
        {
          "documentId": "doc-1",
          "display": "$250 in-network / $500 out-of-network",
          "qualifiers": { "networkTier": "in-network / out-of-network" },
          "evidence": [{ "documentId": "doc-1", "page": 7, "quote": "<exact source text>" }]
        }
      ]
    },
    {
      "factName": "out-of-pocket-maximum",
      "verdict": "SUPPORTED",
      "values": [
        {
          "documentId": "doc-3",
          "display": "$0 to $2,500",
          "qualifiers": { "planTier": "Lite" },
          "evidence": [{ "documentId": "doc-3", "page": 2, "quote": "<exact source text>" }]
        },
        {
          "documentId": "doc-3",
          "display": "$0 to $25,000",
          "qualifiers": { "planTier": "Platinum" },
          "evidence": [{ "documentId": "doc-3", "page": 2, "quote": "<exact source text>" }]
        }
      ]
    },
    {
      "factName": "maternity-coverage",
      "verdict": "NOT STATED",
      "values": []
    },
    {
      "factName": "emergency-copay",
      "verdict": "SUPPORTED",
      "values": [
        {
          "documentId": "doc-1",
          "display": "$100 copay, waived if admitted",
          "qualifiers": { "conditions": "waived if admitted" },
          "evidence": [{ "documentId": "doc-1", "page": 12, "quote": "<exact source text>" }]
        },
        {
          "documentId": "doc-2",
          "display": "$250 copay",
          "qualifiers": {},
          "evidence": [{ "documentId": "doc-2", "page": 9, "quote": "<exact source text>" }]
        }
      ]
    },
    {
      "factName": "urgent-care",
      "verdict": "CONFLICTED",
      "values": [
        {
          "documentId": "doc-1",
          "display": "$25 copay",
          "qualifiers": {},
          "evidence": [{ "documentId": "doc-1", "page": 4, "quote": "<exact source text>" }]
        },
        {
          "documentId": "doc-1",
          "display": "$50 copay",
          "qualifiers": {},
          "evidence": [{ "documentId": "doc-1", "page": 9, "quote": "<exact source text>" }]
        }
      ]
    }
  ]
}
```

## Rules

- One row per comparable fact; exactly one verdict per row (FR-005).
- Every populated value carries ≥1 evidence entry with document ID,
  1-based page, and exact quote (FR-007).
- `display` MUST include all qualifiers verbatim; `qualifiers` map keys:
  `networkTier`, `period`, `ageBand`, `conditions`, `planTier` (FR-006).
- `planTier` names the plan tier/option a value belongs to when a single
  document describes several (e.g. `"Lite"`, `"Plus"`, `"Platinum"`). Such a
  document contributes one value **per tier** to the row — never one display
  string with the tiers' figures concatenated. A value with no `planTier`
  applies to the whole document. Differences between tiers, documents, or
  scopes are normal comparison data (`SUPPORTED`); they are never a
  `CONFLICTED` condition.
- `SUPPORTED` means the fact has cited, usable evidence. Different values
  across different documents/plans are normal and remain `SUPPORTED`
  (e.g. doc-1 deductible `$250` vs. doc-2 deductible `$500`).
- `NOT STATED` rows have empty `values`, and apply only when there are no
  supported values for that fact at all.
- `CONFLICTED` is reserved for a genuine same-document/same-scope
  contradiction — same documentId, same fact, same qualifiers scope
  (`planTier`, `networkTier`, `period`, `ageBand`, `conditions` all equal),
  two incompatible claims each with its own evidence — and shows each
  contradicting value with its own evidence (FR-010). Two values from
  different documentIds are never sufficient for `CONFLICTED`, and neither
  are values scoped to different tiers (Lite vs. Platinum) or network tiers
  (in-network vs. out-of-network) merely because the figures differ.
- V1 scope note: the schema carries no document-to-plan identity, so V1
  confirms `CONFLICTED` only within one documentId and never infers that
  two uploaded documents describe the same plan. Detecting conflicts
  across documents that belong to one plan is a future plan-identity
  capability, not V1 behavior.
- `NEEDS VERIFICATION` applies only when the source statement itself is
  vague, partial, ambiguous, or cannot safely support a concrete
  interpretation — never merely because different plans structure a benefit
  differently.
- `DOES NOT APPEAR TO FIT` requires the context field that ruled the fact
  out to be named in the row's rationale.
- Payloads declaring a different `schemaVersion` MUST be rejected.
