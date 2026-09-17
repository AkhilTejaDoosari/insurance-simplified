# Contract: Chat Q&A API v1

**Owner**: RAG path (`POST /api/chat`) | **Schema version**: `v1`

The chatbot side panel answers exclusively from the session's uploaded
documents. Retrieval corpus = session uploads only.

## Request

```jsonc
{
  "schemaVersion": "v1",
  "sessionId": "<active session>",
  "question": "<user free text>"
}
```

## Answer response (evidence found)

```jsonc
{
  "schemaVersion": "v1",
  "kind": "answer",
  "answerText": "<grounded in cited passages>",
  "citations": [
    { "documentId": "doc-1", "page": 7, "quote": "<exact source text>", "evidenceId": "ev-<opaque session-bound id>" }
  ]
}
```

Rules: ≥1 citation required; every citation carries a session-bound opaque
`evidenceId` resolving server-side to its exact passage (citation URLs use
the same app-owned viewer as comparison values); every substantive claim
MUST trace to a cited passage; no outside knowledge (FR-012, FR-017).

## Refusal response (no supporting evidence)

```jsonc
{
  "schemaVersion": "v1",
  "kind": "refusal",
  "refusalText": "The uploaded documents contain no supporting evidence for this question."
}
```

Rules: fixed text shape, no model-generated claims, empty `citations`
(FR-013). Clients render refusals distinctly from answers.

## Rejections

- Unknown/expired `sessionId` → error (sessions are memory-only).
- Question referencing documents outside the session → refusal, never
  retrieval from any other source.
