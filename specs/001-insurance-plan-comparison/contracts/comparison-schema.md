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
  "documents": [{ "documentId": "doc-1", "filename": "plan-a.pdf", "pageCount": 42 }],
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
      "factName": "maternity-coverage",
      "verdict": "NOT STATED",
      "values": []
    },
    {
      "factName": "emergency-copay",
      "verdict": "CONFLICTED",
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
    }
  ]
}
```

## Rules

- One row per comparable fact; exactly one verdict per row (FR-005).
- Every populated value carries ≥1 evidence entry with document ID,
  1-based page, and exact quote (FR-007).
- `display` MUST include all qualifiers verbatim; `qualifiers` map keys:
  `networkTier`, `period`, `ageBand`, `conditions` (FR-006).
- `NOT STATED` rows have empty `values`.
- `CONFLICTED` rows show each disagreeing value with its own evidence
  (FR-010).
- `DOES NOT APPEAR TO FIT` requires the context field that ruled the fact
  out to be named in the row's rationale.
- Payloads declaring a different `schemaVersion` MUST be rejected.
