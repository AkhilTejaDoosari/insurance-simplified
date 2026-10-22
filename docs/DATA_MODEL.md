# DATA MODEL — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines the V1 durable data model.

It answers:

- what must be persisted;
- what is authoritative;
- what is derived and rebuildable;
- how sessions, documents, pages, chunks, plans, tiers, facts, evidence, and chat relate;
- which keys, constraints, and indexes protect the product invariants.

This is a logical target model. OpenCode must first audit the existing schema and reuse compatible tables and migrations rather than creating duplicates.

---

## 2. Source-of-Truth Map

| Data | Source of truth |
| --- | --- |
| Original PDF bytes | Supabase Storage |
| Session metadata / context | PostgreSQL |
| Document metadata | PostgreSQL |
| Extracted page text | PostgreSQL |
| Plan / tier structure | PostgreSQL when persisted |
| Comparison observations | PostgreSQL |
| Evidence metadata | PostgreSQL |
| Chunk text / metadata | PostgreSQL |
| Embeddings | pgvector; derived and rebuildable |
| Chat history | PostgreSQL if retained across requests |
| UI tab / open drawer | Browser unless persistence is explicitly required |

A generated summary, LLM answer, or vector is never the source of truth for the original insurance document.

---

## 3. Identifier Rule

Keep existing stable opaque identifiers where they already work.

Do not rewrite IDs to UUIDs purely for style.

Requirements:

- session IDs must be high entropy and non-sequential;
- document IDs must be stable within a session;
- chunk IDs remain deterministic from source content and chunk boundaries where the existing implementation already provides this;
- evidence IDs remain stable enough for citation links within the retained session.

The session identifier itself is not sufficient authorization. Anonymous session authorization is defined in `SECURITY.md`.

---

## 4. Target Tables

### 4.1 `sessions`

One row per Comparison Session.

Logical fields:

```text
id
status
context_json
capability_hash
created_at
updated_at
deleted_at
```

`status` is one of:

```text
DRAFT
PROCESSING
READY
PARTIAL
FAILED
DELETING
DELETED
```

`context_json` contains only approved V1 context such as age, residency, state, city, ZIP/postal code, visa/status, and coverage dates.

The application may normalize individual context fields later only when querying or constraints justify it.

---

### 4.2 `documents`

One row per uploaded source PDF.

Logical fields:

```text
id
session_id
filename
mime_type
byte_size
sha256
object_key
page_count
status
created_at
updated_at
```

`status` is one of:

```text
REGISTERED
PROCESSING
READY
FAILED
DELETING
DELETED
```

Constraints:

- every document belongs to exactly one session;
- `object_key` is unique;
- file metadata must describe the durable object actually stored;
- normal document sessions contain 1–4 active documents;
- duplicate detection may use `(session_id, sha256)`.

---

### 4.3 `pages`

One row per extracted PDF page.

Logical fields:

```text
id
document_id
page_number
text
text_hash
created_at
```

Constraints:

```text
unique(document_id, page_number)
page_number >= 1
```

Page text is durable extracted source material used to rebuild chunks and verify citations.

---

### 4.4 `chunks`

One row per deterministic page-bounded retrieval chunk.

Logical fields:

```text
id
session_id
document_id
page_number
chunk_index
start_offset
end_offset
text
text_hash
token_count
embedding
embedding_model
created_at
```

Rules:

- a chunk belongs to one document and one source page / page-bounded source region;
- chunk IDs remain deterministic;
- chunk text must preserve enough provenance to return to the original page;
- production-ready semantic chunks must have the expected embedding dimension;
- production ingestion must not silently mark a document READY after storing missing/null embeddings when semantic retrieval is required.

`embedding` uses pgvector with the locked production dimension:

```text
vector(1024)
```

---

### 4.5 `plan_products`

A logical insurance product discovered from the uploaded evidence.

Logical fields:

```text
id
session_id
display_name
normalized_name
created_at
```

A document is not automatically a plan.

One document may describe one or multiple products.

---

### 4.6 `plan_tiers`

A variation within a plan.

Logical fields:

```text
id
plan_id
label
sort_order
created_at
```

Examples:

```text
Basic
Plus
Pro
Platinum
```

Constraint:

```text
unique(plan_id, label)
```

Tier-specific facts must stay attached to the correct tier.

---

### 4.7 `plan_sources`

Join relation between plans and documents when plan identity is persisted separately from document identity.

Logical fields:

```text
plan_id
document_id
```

Constraint:

```text
unique(plan_id, document_id)
```

Do not introduce this table if the existing implementation already has an equivalent reliable mapping.

---

### 4.8 `fact_observations`

One extracted/evaluated value for a known comparison fact in a particular plan/tier scope.

Logical fields:

```text
id
session_id
fact_key
plan_id
tier_id
display_value
normalized_value_json
verdict
qualifiers_json
rationale
created_at
updated_at
```

`verdict` uses the locked V1 values:

```text
SUPPORTED
DOES NOT APPEAR TO FIT
NOT STATED
CONFLICTED
NEEDS VERIFICATION
```

Rules:

- `tier_id` may be null for tier-agnostic values;
- `plan_id` may be null only when the fact genuinely applies at document/session scope;
- different plans having different values is not `CONFLICTED`;
- `NOT STATED` must never be stored as an invented negative value.

---

### 4.9 `evidence_spans`

Verified source evidence.

Logical fields:

```text
id
session_id
document_id
page_number
quote
quote_hash
start_offset
end_offset
created_at
```

Offsets are optional when exact reliable offsets are unavailable.

Required invariant:

```text
(document_id, page_number, quote)
```

must correspond to text that can be verified against the source page.

---

### 4.10 `fact_evidence`

Many-to-many link between a fact observation and the evidence supporting it.

Logical fields:

```text
fact_observation_id
evidence_id
position
```

Constraint:

```text
unique(fact_observation_id, evidence_id)
```

---

### 4.11 `chat_turns`

Persist only if the product keeps chat history across reloads/requests.

Logical fields:

```text
id
session_id
question
outcome
answer_text
created_at
```

`outcome`:

```text
ANSWERED
REFUSED
FAILED
```

A technical failure must never be persisted/presented as a semantic refusal.

---

### 4.12 `chat_citations`

Links an answered chat turn to verified evidence.

Logical fields:

```text
chat_turn_id
evidence_id
position
```

Only `ANSWERED` turns may have material claim citations.

### 4.13 `comparison_results`

Validated result payload persistence (migration `0005_comparison_results`).

One row per session once extraction validation has succeeded:

```text
session_id
status
document_fingerprint
result_json
created_at
updated_at
expires_at
```

- `status` is `READY` or `EXPIRED`.
- `result_json` holds the exact validated result that the UI and PDF export
  render; export loads this record rather than recomputing.
- `document_fingerprint` guards stale reuse across different document sets.
- `expires_at` is 30 days after creation; expired rows are treated as absent
  and are physically removed opportunistically during the next successful
  save in any session (no scheduled job in V1).
- Server-only data: RLS owner-scoped, never sent to the browser, and deleted
  on session close together with vectors, objects, and the session row.

---

## 5. Derived Data That Does Not Need Its Own Table

Unless measured needs justify persistence, V1 may derive these from authoritative rows:

- document-specific group labels and ordering (derived from validated facts);
- active tier selection;
- active comparison tab;
- requirements checklist;
- “needs your input” prompts;
- display formatting;
- plan-highlight ordering.

Do not create a table merely because an object exists in the UI.

---

## 6. Indexes

Required or justified indexes include:

```text
documents(session_id)
pages(document_id, page_number)
chunks(session_id)
chunks(document_id, page_number)
fact_observations(session_id, fact_key)
evidence_spans(session_id, document_id, page_number)
chat_turns(session_id, created_at)
```

Semantic search requires the existing pgvector similarity index compatible with the chosen distance metric.

Do not add duplicate vector indexes.

Every index must correspond to an actual query path.

---

## 7. Tenancy / Scope Rule

Every session-owned table must be scopeable from the session boundary.

A query that can return user document data must have a path equivalent to:

```text
WHERE session_id = :authorized_session
```

or an equivalent parent relationship that guarantees the same restriction.

No retrieval operation may begin from an unscoped global chunk set.

---

## 8. Migration Strategy

Migrations are append-only and committed.

Rules:

- never edit an already-applied production migration;
- prefer expand → migrate/backfill → contract;
- avoid destructive in-place renames;
- add nullable/new structures before making them required;
- backfill and verify before tightening constraints;
- keep rollback/recovery considerations in the migration notes.

OpenCode must reuse the existing migration directory. It must not create a second migration system.

---

## 9. Deletion Order

Deletion must be retry-safe.

Target order:

```text
1. mark session/document DELETING
2. delete derived rows / vectors that can be retried safely
3. delete original private storage objects
4. delete or tombstone remaining metadata last
5. mark DELETED only after required cleanup succeeds
```

If cleanup fails:

```text
DELETING remains visible
→ retry is possible
→ do not claim success
```

---

## 10. Rebuild Rule

The following should be rebuildable from durable source data:

```text
chunks
embeddings
vector index
derived comparison views
```

The following are not treated as disposable derived data:

```text
original PDF bytes
verified source page text
session ownership/scope
evidence identity required by retained citations
```

---

## 11. Data-Minimization Rule

Do not add fields for:

- name;
- email;
- phone;
- unrelated profile data;

unless a future approved product requirement earns them a place.

Do not store full model prompts/responses merely for debugging unless a reviewed observability/privacy decision explicitly allows it.
