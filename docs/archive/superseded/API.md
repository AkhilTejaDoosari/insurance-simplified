# API — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines the V1 application-operation contracts.

The exact route names may preserve compatible existing routes to minimize churn, but the semantics, authorization, errors, idempotency, and response behavior below are the contract.

OpenCode must audit existing routes before renaming anything.

---

## 2. General Rules

All protected operations:

```text
request
→ resolve authorized session capability
→ validate session scope
→ perform operation
```

A caller-supplied `sessionId` is never sufficient authorization by itself.

JSON errors use:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Safe user-facing message",
    "requestId": "opaque-request-id"
  }
}
```

Never return stack traces, provider secrets, SQL details, or raw internal errors to the browser.

---

## 3. Error Taxonomy

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Request shape or required value invalid |
| 401 | `SESSION_AUTH_REQUIRED` | Anonymous session capability missing/invalid |
| 404 | `NOT_FOUND` | Resource unavailable within authorized scope |
| 409 | `STATE_CONFLICT` | Operation invalid for current lifecycle state |
| 413 | `FILE_TOO_LARGE` | Upload exceeds configured limit |
| 415 | `UNSUPPORTED_FILE` | File is not an accepted PDF |
| 422 | `UNPROCESSABLE_DOCUMENT` | PDF accepted but cannot be safely processed |
| 429 | `RATE_LIMITED` | Provider/application limit reached |
| 500 | `INTERNAL_ERROR` | Unexpected application defect |
| 503 | `DEPENDENCY_UNAVAILABLE` | Required database/storage/AI dependency unavailable |

Technical dependency failure must not be converted into `NOT STATED` or a chat refusal.

---

# 4. Session Operations

## 4.1 Create Session

Logical operation:

```text
POST /api/sessions
```

Request:

```json
{
  "context": {
    "age": "optional",
    "countryOrResidency": "optional",
    "state": "optional",
    "city": "optional",
    "zip": "optional",
    "visaOrStatus": "optional",
    "coverageStart": "optional",
    "coverageEnd": "optional"
  }
}
```

Response:

```json
{
  "sessionId": "opaque-id",
  "status": "DRAFT"
}
```

The server establishes the anonymous session authorization capability separately from the public session ID.

---

## 4.2 Update Context

```text
PATCH /api/sessions/:sessionId/context
```

Request includes only changed approved context fields.

Response returns:

```json
{
  "sessionId": "...",
  "context": {},
  "affectedFacts": ["optional-fact-keys"]
}
```

Behavior:

- preserve documents;
- persist context;
- recompute only affected deterministic evaluations where practical;
- do not require a new session.

Idempotent for the same final context.

---

# 5. Upload Operations

## 5.1 Request Upload Authorization

```text
POST /api/sessions/:sessionId/uploads/authorize
```

Request:

```json
{
  "files": [
    {
      "filename": "plan.pdf",
      "mimeType": "application/pdf",
      "byteSize": 123456,
      "sha256": "optional-client-hash"
    }
  ]
}
```

Server validates:

- authorized session;
- 1–5 document product boundary (one document for understanding, 2–5 for comparison);
- file count;
- allowed MIME/type intent;
- size limit;
- target object key ownership.

Response contains narrowly scoped, short-lived upload instructions.

The browser never receives a Supabase secret/service key.

---

## 5.2 Register Uploaded Document

```text
POST /api/sessions/:sessionId/documents
```

Request identifies the uploaded object and expected metadata.

The server verifies the durable object before registering it.

Response:

```json
{
  "documentId": "...",
  "filename": "...",
  "status": "REGISTERED"
}
```

Idempotency:

Repeating registration for the same authorized object/hash must not create duplicate logical documents.

---

# 6. Compare / Processing

## 6.1 Start or Re-run Comparison

Logical operation:

```text
POST /api/sessions/:sessionId/compare
```

Preconditions:

- authorized session;
- 1–5 usable registered documents;
- required core context present.

Behavior:

```text
PROCESSING
→ extract pages
→ identify plan/tier structure
→ extract facts/evidence
→ chunk
→ embed
→ persist
→ evaluate
→ READY / PARTIAL / FAILED
```

Response may either wait for completion under the V1 synchronous model or return a processing representation that the UI can poll if the current implementation requires it without adding a queue/worker.

OpenCode may not introduce asynchronous infrastructure without approval.

---

## 6.2 Get Results

```text
GET /api/sessions/:sessionId/results
```

Response includes:

- session status;
- documents;
- discovered plans/tiers;
- grouped comparison facts;
- verdicts;
- evidence references;
- missing context requirements.

One-document results explain evidenced costs, benefits, eligibility rules,
exclusions, limitations, and material unknowns; multiple-tier results may
compare tiers internally. For 2–5 documents, the result compares validated
facts across plans and tiers. In Phase P2, derived group labels/order may be
document-specific; fact/evidence identity and authorization do not change.

The response must not include evidence belonging to another session.

---

# 7. Chat

## Ask Question

Logical operation:

```text
POST /api/sessions/:sessionId/chat
```

Request:

```json
{
  "question": "What is the emergency room copay?"
}
```

Response — grounded answer:

```json
{
  "kind": "answer",
  "answerText": "...",
  "citations": [
    {
      "documentId": "...",
      "page": 5,
      "quote": "...",
      "evidenceId": "..."
    }
  ]
}
```

Response — semantic refusal:

```json
{
  "kind": "refusal",
  "refusalText": "The uploaded documents do not provide enough evidence to answer that."
}
```

A provider outage returns an HTTP technical error, not a semantic refusal.

---

# 8. Evidence / Document Access

## Original PDF

Logical operation:

```text
GET /api/sessions/:sessionId/documents/:documentId/raw
```

Requirements:

- session authorized;
- document belongs to session;
- content served safely as PDF;
- no path traversal or arbitrary object-key access.

Existing evidence-viewer URLs may remain if they preserve the same authorization and citation contract.

---

# 9. Delete Session

```text
DELETE /api/sessions/:sessionId
```

Behavior:

```text
mark DELETING
→ cleanup derived rows/vectors
→ delete private PDF objects
→ remove/tombstone metadata
→ DELETED
```

Response on complete success:

```json
{
  "deleted": true
}
```

If required cleanup fails:

```text
503
session remains DELETING
retry is safe
```

Deletion is idempotent.

Deleting an already deleted session returns success or an equivalent safe idempotent response.

---

# 10. Health Operations

## Liveness

```text
GET /api/health
```

Answers only:

> Is this process alive enough to serve HTTP?

No external dependency checks.

Expected healthy response:

```json
{
  "ok": true
}
```

---

## Readiness

```text
GET /api/ready
```

Checks the dependencies required to serve configured production behavior.

Safe response shape:

```json
{
  "ready": true,
  "checks": {
    "supabase": "reachable",
    "storage": "reachable",
    "pgvector": "reachable",
    "embeddings": "reachable",
    "llm": "reachable"
  }
}
```

Readiness is true only when every required check is `reachable`; missing
configuration and failed probes return HTTP 503. Database/vector and storage
checks are non-mutating. Embedding and generation checks use authenticated
model-list endpoints, not inference requests; provider inference is verified by
separate synthetic integration probes.

Do not expose credentials, hostnames, model tokens, or raw provider errors.

---

# 11. Pagination

V1 session data is deliberately small:

```text
1–5 documents
small plan/tier sets
one comparison workspace
```

Pagination is not required for the core V1 comparison contract.

If chat history later grows enough to require pagination, use cursor-based pagination.

Do not add pagination machinery to routes that cannot meaningfully exceed V1 bounds.

---

# 12. Versioning

There is no external public API consumer in V1.

Therefore:

- do not add `/v1` route duplication merely for appearance;
- breaking contract changes still require updating this file and tests;
- introduce formal external API versioning only before an external consumer depends on the contract.

---

# 13. Existing Route Compatibility

The current repository already contains routes such as upload, extract, chat, document, and export.

OpenCode must classify each as:

```text
EXISTS
PARTIAL
MISSING
CONFLICTS WITH TARGET
```

Prefer adapting an existing correct route over creating a parallel duplicate route tree.

The contract matters more than cosmetic naming.
