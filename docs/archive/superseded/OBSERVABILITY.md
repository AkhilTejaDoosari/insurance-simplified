# OBSERVABILITY — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines what the product must record so we can answer:

- what failed;
- where time was spent;
- whether retrieval worked;
- whether the model answered or refused;
- whether citations verified;
- whether costs/usage are moving unexpectedly.

V1 uses the platform's existing logging/monitoring capabilities before adding a separate observability vendor.

---

# 2. Logging Principles

Logs are structured JSON.

Every request log should be linkable by:

```text
request_id
trace_id when available
```

Use an opaque or hashed session reference.

Do not log the raw session capability.

---

# 3. Required Common Fields

Where applicable:

```text
timestamp
severity
request_id
trace_id
operation
route
http_status
duration_ms
session_ref_hash
document_count
outcome
error_code
```

Dependency calls add:

```text
dependency
provider
model_alias
dependency_duration_ms
retry_count
```

Retrieval adds:

```text
retrieval_strategy
top_k
retrieved_count
useful_count
```

Generation adds:

```text
answer_kind
input_tokens when provider reports them
output_tokens when provider reports them
estimated_cost when deterministically available
```

---

# 4. Privacy Rules

Do not emit into normal logs:

```text
full PDF text
page text
evidence quotes
full user questions
full prompts
full model responses
visa/status values
exact personal context
API keys
database URLs
signed URLs
```

For debugging, log lengths/counts/hashes rather than content.

---

# 5. Core Events

Emit explicit events for:

```text
session.created
context.updated
upload.authorized
document.registered
document.processing_started
document.ready
document.failed
comparison.started
comparison.ready
comparison.partial
comparison.failed
retrieval.completed
chat.answered
chat.refused
chat.failed
citation.verified
citation.failed
session.deletion_started
session.deleted
session.deletion_failed
readiness.failed
```

Event names remain stable.

---

# 6. Latency Measurements

Capture separate timings for:

```text
upload authorization
storage read
PDF extraction
fact extraction
chunking
embedding
database persistence
retrieval
generation
citation verification
end-to-end compare
end-to-end chat
```

Do not report only one total latency number; the purpose is to identify the bottleneck.

---

# 7. RAG Quality Measurements

Production telemetry is not the same as the offline evaluation suite.

Record safe aggregate signals such as:

```text
retrieved_count
useful_count
answer vs refusal
citation_count
citation_verification_failures
```

Offline quality evaluation continues to use controlled DEV / VAL / TEST datasets and metrics such as:

```text
Recall@K
MRR
refusal accuracy
false accept / false refusal
```

Do not leak evaluation answers into production traces.

---

# 8. Metrics

Minimum operational metrics:

```text
request count by route/outcome
5xx count/rate
503 count/rate
compare processing duration
chat duration
embedding duration/failure count
generation duration/failure count
storage failure count
database failure count
documents processed
sessions READY/PARTIAL/FAILED
chat answer/refusal/failure counts
citation verification failure count
deletion failure count
readiness failure count
```

Cost/usage where available:

```text
embedding requests
embedding units/tokens if exposed
LLM input/output tokens
estimated provider cost
Cloud Run request/runtime usage from platform metrics
```

---

# 9. Tracing

A user request should be traceable across application steps.

Conceptual spans:

```text
HTTP request
├── authorize session
├── database
├── storage
├── extract
├── embed
├── retrieve
├── generate
└── verify citations
```

Use Cloud Run / Google Cloud tracing support or standard OpenTelemetry only if it can be added without introducing another paid dependency.

Structured logs remain sufficient for V1 if full tracing is not available.

---

# 10. Alerts

Initial alerts / checks:

### Critical

```text
readiness failing continuously
citation verification failures > 0
unexpected authorization/scope failure pattern
deletion failures accumulating
```

### Operational

```text
5xx/503 spike
embedding provider failure spike
generation provider failure spike
compare p95 materially above target
chat p95 materially above target
```

### Cost

Configure provider/platform budget and usage alerts before public demo traffic.

A budget alert is not a hard spending cap.

---

# 11. Dashboard Questions

A useful dashboard must answer:

```text
Is the app serving?
Are dependencies healthy?
How many sessions reach READY?
Where does compare time go?
Where does chat time go?
Are embeddings failing?
Are generations failing?
Are citations verifying?
Are users being refused because of evidence or because of outages?
Is usage/cost increasing unexpectedly?
```

Do not create dashboards that exist only to look sophisticated.

---

# 12. No Default External Prompt Logging

Do not enable an observability integration that stores full prompts, document context, or model responses by default.

Any future Langfuse or equivalent integration requires a privacy review and explicit decision in `DECISIONS.md`.
