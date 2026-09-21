# External Dependency Register (P3-HIJ)

Compact register of REAL runtime externals. Verified against code on 2026-09-19.
Timeouts below are what the code actually sets — where no timeout exists it
says NOT SET (nothing invented). Reliability core is the in-app degradation
**semantic → lexical → refusal** (app/lib/rag/answer.ts) — this file documents
it, it does not redesign it.

Retry rule (global, both retrying clients): retryable = HTTP
408/409/429/500/502/503/504 only (`RETRYABLE` set in app/lib/llm/client.ts and
app/lib/rag/embeddings.ts). **Permanent 4xx / auth / input failures
(400/401/403/404/422, malformed responses, dimension mismatch) are NEVER
retried** — they surface immediately as the skip/degrade signal.

| Dependency | Responsibility | Timeout | Retryable failures | Retry policy | Degraded behavior | User-visible effect | Data-loss possible? | Required or optional |
|---|---|---|---|---|---|---|---|---|
| LLM provider (OpenAI-compatible `POST /chat/completions`, `LLM_BASE_URL` + `LLM_API_KEY`) — app/lib/llm/client.ts | Chat answers (`answerViaLlm`), extraction (`extractViaLlm`) | NOT SET (plain `fetch`, no `AbortSignal`) | 408/409/429/500/502/503/504 only | Max 3 attempts; base 1500ms exponential (`1500 * 2^(attempt-1)`), `Retry-After` honored when present | Chat: LLM failure → semantic → lexical → fixed refusal (stays HTTP 200 success). Extract: NO degradation — throws (`503` if message starts with "LLM", else `500`) | Chat: answer from weaker leg or refusal text. Extract: error response with fallback hint | No (deterministic fallback recomputes; nothing persisted) | Optional (unconfigured → built-in engine) |
| Embedding provider (Ollama-compatible `POST /embeddings`, `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY`) — app/lib/rag/embeddings.ts | Semantic retrieval vectors (`embedTexts`, batch 32) | NOT SET (plain `fetch`, no `AbortSignal`) | 408/409/429/500/502/503/504 only | Max 3 attempts; base 1500ms exponential, `Retry-After` honored | Any error / unconfigured / dimension mismatch → lexical line-overlap leg; both empty → fixed refusal | Same answers, weaker ranking; or refusal when nothing matches | No (vectors are per-session, recomputed) | Optional (unconfigured → lexical path) |
| Supabase / Postgres (PostgREST + `match_chunks` RPC, `SUPABASE_URL` + `SUPABASE_SECRET_KEY`) — app/lib/rag/postgres-vector.ts, postgres-fts.ts | Persistent vector store, first-choice semantic leg when configured (errors fall back to in-memory, then lexical) | NOT SET (plain `fetch`, no `AbortSignal`, no retry loop — throws on first non-OK) | None retried (single attempt) | No retries | Unconfigured → `PostgresUnconfiguredError` → SKIP; in-memory cosine index remains the runtime | None (persistence is opt-in; read path unaffected) | No (rows are a regenerable cache — hash-diff re-embed restores them) | Optional |
| Supabase reachability probe — app/api/health/route.ts (`SUPABASE_URL` + `SUPABASE_ANON_KEY`) | Liveness signal for `/api/health` | 3000ms (`AbortController` + `setTimeout`) | None retried (single attempt) | No retries | Any error/timeout → reports `db: "unconfigured"` (indistinguishable from unset — probe failure and absent credentials share one status) | Health JSON only; never blocks chat/upload/extract | No | Optional |
| Tracing sink (Langfuse-compatible adapter, `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`) — app/lib/observability/trace.ts | Observability metadata only (ids/pages/counts/latencies; no user text, prompts, doc text, or keys by type construction) | N/A (no network export implemented — forwards to the in-memory sink only) | N/A | N/A (emit never throws, never retried) | Keys absent → adapter no-op; traces stay in-memory only. Emit is wrapped in try/catch at every call site — tracing never breaks a response | None | No | Optional |

Non-externals (stated so they are not mistaken for dependencies):

- **Object storage bucket: NONE.** Document bytes live in server-local tmpdir
  sessions (`app/lib/session.ts`, deleted on close); chunk cache is tmpdir-backed
  (`app/lib/rag/chunks.ts`). Saving = downloading an export file. No S3/GCS/Supabase
  Storage calls exist in `app/`.
- **No vendor SDKs**: `package.json` has no `pg`, no Supabase SDK, no LLM SDK —
  all externals are plain `fetch`.
