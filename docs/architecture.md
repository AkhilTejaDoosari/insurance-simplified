# Architecture — components, boundaries, data, code map

Status: Authoritative · Consolidated 2026-11-15 from `ARCHITECTURE` (locked V1),
`DATA_MODEL`, `API`, `REPO_MAP` (now in `docs/archive/superseded/`).
Where the archived documents described *target* routes or tables that the code
does not have, this document says so explicitly instead of repeating them.

**Change rule:** adding, removing or re-pointing any box or arrow below,
changing state ownership, the session-authorization model, the deployment
topology, or moving synchronous work to background infrastructure is an
architecture change and needs explicit owner approval and a `decisions.md`
entry (D-021).

## 1. Components (approved V1 runtime)

```text
Browser ──HTTPS──► Next.js app (Docker, Google Cloud Run, stateless)
                      ├─► Supabase PostgreSQL + pgvector   structured state, page text, chunks, vectors
                      ├─► Supabase private Storage         original PDF bytes
                      ├─► Embedding provider               Cloudflare Workers AI, Qwen3-Embedding-0.6B, 1024-d (prod)
                      └─► Generation LLM provider          extraction / grounded language, behind an adapter
```

| Component | Owns | Never owns |
| --- | --- | --- |
| Browser | Temporary UI state (active container, selected tiers, column order, chat open) | Documents, facts, evidence, authorization, citations |
| Next.js app | All behaviour: routes, upload authorization, PDF reading, extraction, verification, deterministic rules, retrieval, chat orchestration, session lifecycle, deletion, health | Durable state (all of it lives in Supabase) |
| PostgreSQL | Sessions, documents, pages, chunks, comparison results, ownership scope, lifecycle | PDF bytes |
| pgvector | Derived, rebuildable semantic index over chunks | Document truth |
| Storage | Original PDF bytes (private bucket) | Metadata |
| Embedding provider | Inference only | Any state |
| Generation LLM | Language tasks inside the evidence contract | Authorization, truth, citations, numbers, eligibility, requirements |

Development may use local Ollama embeddings behind the same adapter and vector
contract. Coding tools (Claude Code, OpenCode, …) are never runtime components.

**Not V1 components** (D-016, D-017): Redis, Kafka, queues, separate workers,
Kubernetes, Pinecone, Qdrant, Milvus, Weaviate, FAISS, a second application
database, production Ollama, crawlers or plan catalogs, microservices. Each may
be proposed only with measured evidence that the approved set cannot meet a
requirement (see `quality.md` §4 for the benchmarks that decide retrieval).

## 2. Request flows

**Upload and processing.** Browser sends PDFs → app validates session and file
→ bytes stored privately → page text extracted with provenance → layout tables,
plan identity and tiers → claims extracted and verified (`evidence-core.md`) →
page-bounded chunks embedded and stored → session READY / PARTIAL / FAILED.
Temporary files are request-scoped only.

*Target (A-033, D-011), not yet built:* the browser uploads bytes directly to
private Storage with a narrowly scoped signed authorization, and the app
registers the object. Today bytes pass through `POST /api/upload`.

**Chat.** Authorize session → embed question → session-scoped retrieval →
usefulness floor (refuse if insufficient) → generate grounded answer → verify
every quote on its page → respond. Authorization and scoping happen **before**
any evidence reaches the model; never retrieve globally and filter afterwards.

**Context update.** `NEEDS YOUR INPUT` → persist context → recompute the
affected deterministic result → same workspace, same session.

**No-document path.** Context → deterministic checklist logic → checklist. No
crawling, catalog or search index.

## 3. State ownership and persistence

Every durable item has exactly one owner. Cloud Run memory and `/tmp` are never
authoritative for anything a later request needs (D-018).

| State | Owner |
| --- | --- |
| PDF bytes | Storage (object key `docs/<aa>/<sha256>.pdf`) |
| Session, capability hash, context, lifecycle | `sessions` (0004) |
| Document metadata, page text | `documents`, `pages` (0001) |
| Chunks, FTS vector, embedding | `chunks` (0001) |
| Validated comparison result (export source) | `comparison_results` (0005), 30-day expiry |
| UI selections | Browser |

Migrations (`db/migrations/`, append-only, expand → backfill → contract):
`0001_init` (documents, pages, chunks, `match_chunks`, `fts_search_chunks`,
global HNSW + GIN indexes, migration ledger) · `0002_object_key` · `0003_rls`
(owner-scoped RLS) · `0004_sessions` · `0005_comparison_results` (+down) ·
`0006_schema_migrations_lock` (+down; applied to the dev DB, D-026).
`db/schema.sql` is the reference schema; `db/README.md` explains applying it.

*Archived target tables* (`plan_products`, `plan_tiers`, `fact_observations`,
`evidence_spans`, `chat_turns`, …) do **not** exist. Plans, tiers, facts and
evidence currently live inside the validated comparison-result JSON. Any new
table needs a milestone that justifies it with a real query path.

**Session cache.** `app/lib/session-store.ts` keeps a tmpdir copy as a cache
only. A miss rebuilds from Postgres + Storage after capability verification;
tables are recomputed and attached only if page text is identical.

**Rebuildable:** chunks, embeddings, vector index, derived views.
**Not disposable:** PDF bytes, verified page text, ownership scope, evidence
identity needed by retained citations.

## 4. HTTP surface (as implemented)

| Route | Purpose |
| --- | --- |
| `POST /api/sessions` | Create a session with an anonymous capability |
| `POST /api/upload` / `DELETE /api/upload` | Validate and store 1–5 PDFs / close and delete the session (vectors, objects, row, result) |
| `POST /api/extract` | Build and verify the comparison result (deterministic engine, or LLM engine when configured) |
| `POST /api/chat` | Grounded question answering with citation verification or refusal |
| `POST /api/export` | PDF report from the stored validated result (never recomputed) |
| `GET /api/document/[sessionId]/[documentId]/[filename]` | Authorized original-PDF bytes |
| `/view/[sessionId]/[documentId]/[filename]` | Evidence viewer page (capability-checked before any read) |
| `GET /api/health` / `GET /api/ready` | Liveness / dependency readiness |

Every protected route resolves the session capability first; a caller-supplied
session or document ID is never authorization by itself. Errors use
`{ error: { code, message, requestId } }` with codes `VALIDATION_ERROR` 400,
`SESSION_AUTH_REQUIRED` 401, `NOT_FOUND` 404, `STATE_CONFLICT` 409,
`FILE_TOO_LARGE` 413, `UNSUPPORTED_FILE` 415, `UNPROCESSABLE_DOCUMENT` 422,
`RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `DEPENDENCY_UNAVAILABLE` 503. No stack
traces, SQL or provider errors reach the browser. A dependency failure is never
converted into NOT STATED or a refusal.

## 5. Code map

```text
app/
  page.tsx, layout.tsx, globals.css   Welcome/Intake/Results shell; design tokens
  components/                         React UI (WelcomePage, UploadDropzone, ContextInputs,
                                      PersonalizedOverview, ComparisonTable, ConditionalValue,
                                      PolicyViewControls, VerifyContact, ChatPanel,
                                      PdfEvidenceViewer, ChecklistFlow, …)
  api/                                Route handlers listed in §4
  view/                               Evidence viewer route
  lib/
    session*.ts, session-store.ts     Capability auth, durable session + cache
    storage/objects.ts                Private object store adapter
    comparison-result-db.ts           comparison_results persistence
    pdf/                              pdf.js page text + layout tables (provenance)
    ingestion/                        Quality gate, lifecycle
    extraction/                       Facts, table/statement claims, anchors, plan identity,
                                      tiers, qualifiers, eligibility, contradictions,
                                      overview/selection/workspace groups, verify-table boundary
    evidence-verification.ts,
    evidence-ids.ts, citation.ts      Citation and quote verification
    verdicts.ts                       Verdict vocabulary
    rag/                              Chunks, embeddings, postgres-vector + in-memory cosine,
                                      fusion (RRF), answer assembly, refusal floor
    llm/                              OpenAI-compatible client, safe prompt framing
    presentation/, report/            Adaptive presentation, PDF export
    observability/                    Request tracing and per-stage timing
db/                                   Migrations, reference schema
tests/{unit,contract,integration,e2e,fixtures}
evals/                                Retrieval/chat eval harness and frozen datasets
scripts/                              Fixture generation, acceptance runners,
                                      p2-experiment/ real-PDF extraction evaluation
```

Dependency direction: `components → lib` and `api → lib`; `lib` never imports
from `components` or `api`. Provider-specific calls stay inside `lib/llm`,
`lib/rag` embedding adapters and `lib/storage` (D-019).
