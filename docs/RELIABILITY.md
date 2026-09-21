# RELIABILITY — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines dependency behavior, timeouts, retries, degradation, lifecycle handling, and initial service-level targets.

Reliability means failing visibly and safely instead of returning a confident wrong result.

---

# 2. Dependency Register

| Dependency | Used for | If unavailable |
| --- | --- | --- |
| Supabase PostgreSQL | durable structured state, retrieval metadata | protected durable operations fail with `503`; readiness fails |
| Supabase Storage | original PDFs | upload/view/process operations requiring bytes fail with `503`; readiness fails |
| Cloudflare Workers AI | production embeddings | production ingestion does not silently store null vectors; chat semantic retrieval cannot pretend success |
| Generation LLM provider | structured extraction/explanation/chat generation | deterministic features may continue where possible; generation-dependent operation returns technical unavailable |
| Cloud Run local filesystem | request-scoped temporary files only | loss must not destroy authoritative state |

---

# 3. Initial Timeout Budgets

These are starting defaults and must be validated with production measurements.

| Operation | Initial timeout guidance |
| --- | ---: |
| DB query / RPC | 5 s |
| Storage metadata/read initiation | 15 s |
| Embedding request | 30 s |
| Generation request | 60 s |
| Single API request overall | bounded below Cloud Run configured request timeout |

Timeout values are configuration, not scattered magic numbers.

Do not extend timeouts merely to hide a slow architecture.

---

# 4. Retry Rules

Retry only operations that are idempotent or explicitly made retry-safe.

Safe retry examples:

- read/query;
- embedding request with the same input;
- generation request only when duplicate generation has no side effect;
- signed-upload authorization creation;
- document registration using a stable object/hash idempotency key;
- deletion cleanup steps.

Use:

```text
small bounded retry count
+
exponential backoff
+
jitter where practical
```

Do not retry:

- validation errors;
- authorization failures;
- unsupported files;
- deterministic `NOT STATED`;
- semantic refusals.

---

# 5. Ingestion Failure Rule

Production must not silently turn:

```text
embedding provider unavailable
```

into:

```text
document READY with missing vectors
```

If semantic retrieval is required for the configured production mode:

```text
dependency unavailable
→ document/session remains PROCESSING/PARTIAL/FAILED
→ retryable technical outcome
```

No fake success.

---

# 6. Retrieval Degradation

Preferred production retrieval:

```text
session-scoped semantic pgvector retrieval
```

A lexical fallback may remain only if it:

- reads durable session-scoped source data;
- is already tested;
- cannot cross session boundaries;
- produces the same refusal/citation guarantees.

Do not enable BM25, FTS, RRF, or reranking in production merely as a degradation mechanism unless separately approved.

If no safe fallback is available:

```text
technical failure
→ 503
```

not:

```text
"No answer found"
```

---

# 7. Generation Degradation

If the generation provider is unavailable:

- comparison facts already produced deterministically may still render;
- source evidence remains viewable;
- chat/generation-dependent behavior returns a retryable technical error;
- never convert provider failure into `NOT STATED`;
- never fabricate a local answer.

---

# 8. Partial Processing

If some documents succeed and one fails:

- successful durable work may be preserved;
- session becomes `PARTIAL` only when the UI can accurately identify what is incomplete;
- the failed document is named safely to the user;
- the product does not present the comparison as complete.

If the remaining result would be misleading, use `FAILED` instead of `PARTIAL`.

---

# 9. Idempotency

Required retry-safe operations:

```text
document registration
comparison re-run for the same source/config version
context update
session deletion
```

Repeated execution must not create duplicate documents, chunks, evidence, or chat citations.

---

# 10. Deletion Reliability

Deletion order:

```text
DELETING
→ derived rows/vectors
→ storage objects
→ remaining metadata
→ DELETED
```

If any required cleanup fails:

```text
remain DELETING
return retryable error
preserve identifiers required for retry
```

Never delete the only metadata needed to finish cleanup before the cleanup itself succeeds.

---

# 11. Process-Restart Rule

A Cloud Run instance may stop at any time.

After restart, the product must still be able to recover:

- session context;
- documents;
- page text;
- chunks/vectors;
- evidence;
- comparison state needed by future requests.

Anything cross-request must not exist only in `/tmp`, memory, or a module-global map.

---

# 12. Liveness and Readiness

## `/api/health`

Liveness only.

No provider calls.

If the process can serve HTTP:

```json
{"ok": true}
```

## `/api/ready`

Dependency readiness for configured production behavior.

A configured required dependency being unreachable returns:

```text
HTTP 503
```

Responses expose booleans/status only, not secrets or raw provider errors.

---

# 13. Initial V1 SLO Targets

These are starting product targets, not claims of measured production performance.

### Correctness

```text
cross-session evidence exposure: 0 tolerated
displayed invalid citations: 0 tolerated
supported material claims without evidence: 0 tolerated
```

### Ready-session UX

```text
results workspace load from durable state:
p95 target < 2 s excluding large PDF rendering
```

### Chat

```text
grounded answer/refusal:
p95 target < 15 s under healthy providers
```

### Compare processing

```text
2–4 normal portfolio PDFs:
p95 target < 120 s
```

First production measurements may revise latency targets, but not the correctness invariants.

---

# 14. Failure Classification

Keep these distinct:

```text
REFUSAL
documents do not contain enough evidence

VALIDATION FAILURE
user input/document invalid

DEPENDENCY FAILURE
provider/database/storage unavailable

APPLICATION DEFECT
unexpected code failure
```

They require different UI messages, metrics, and retry behavior.

---

# 15. No Unjustified Reliability Components

V1 intentionally has no:

```text
Redis
queue
separate worker
Kafka
Kubernetes
distributed lock service
```

If production measurement shows a concrete failure mode that cannot be solved inside the approved architecture, create an ADR with the measured evidence before adding infrastructure.
