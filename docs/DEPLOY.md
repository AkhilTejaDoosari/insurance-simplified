# Deployment (local artifacts only)

> Status: artifacts only — this project has NOT been deployed anywhere.
> Langfuse is adapter-present only, NOT active (no-op unless credentials
> are provided). No remote infrastructure has been touched.

## 1. Build & run locally with Docker

```sh
docker build -t insurance-simplified .
docker run -p 3000:3000 insurance-simplified
# or
docker compose up --build
```

Health: `GET /api/health` → `{ ok: true, checks: { db: "reachable" | "unconfigured" } }`.
The endpoint exposes no debug info (no versions, no error details).

## 2. Environment contract

| Variable | Required | Purpose | Default behavior when unset |
|---|---|---|---|
| `LLM_BASE_URL` | No | OpenAI-compatible LLM endpoint for extract + chat | Deterministic fallback engine |
| `LLM_API_KEY` | No | API key for `LLM_BASE_URL` | Deterministic fallback engine |
| `LLM_MODEL` | No | Model name sent to the LLM endpoint | `default` |
| `EMBEDDING_BASE_URL` | No | Embedding endpoint for semantic retrieval | Lexical line-overlap retrieval |
| `EMBEDDING_API_KEY` | No | API key for the embedding endpoint | Lexical line-overlap retrieval |
| `EMBEDDING_MODEL` | No | Embedding model name | `default` |
| `SUPABASE_URL` | No | External Supabase project URL (placeholder) | Sessions stay server-local; `/api/health` reports `unconfigured` |
| `SUPABASE_ANON_KEY` | No | Anon key for the reachability probe | Sessions stay server-local; `/api/health` reports `unconfigured` |
| `LANGFUSE_PUBLIC_KEY` | No | Enables the Langfuse-compatible trace adapter | Adapter no-op (traces stay in-memory only) |
| `LANGFUSE_SECRET_KEY` | No | Enables the Langfuse-compatible trace adapter | Adapter no-op (traces stay in-memory only) |
| `LANGFUSE_HOST` | No | Langfuse host URL | Unused unless both keys are set |

Notes:

- Tracing is sanitized metadata only (ids, pages, scores, latencies, counts).
  Raw user text, prompts, document text, and keys are never recorded
  (type-level: no such fields exist on `TraceEvent`).
- Trace cost fields report `UNKNOWN` / `NOT MEASURED` unless the provider
  reports usage + pricing.
- Do NOT claim Langfuse is active: the adapter exists but is a no-op
  unless `LANGFUSE_PUBLIC_KEY` **and** `LANGFUSE_SECRET_KEY` are set.

## 3. Migration procedure (`db/migrations`)

`db/migrations/` holds ordered SQL migrations (`NNN_description.sql`).
There are no migrations yet — sessions are server-local and Supabase is an
external placeholder.

When migrations exist, apply in filename order against the target database:

```sh
# example (Supabase / Postgres), run from the repo root:
for f in $(ls db/migrations/*.sql | sort); do
  echo "applying $f"
  psql "$DATABASE_URL" -f "$f"
done
```

Record applied migrations in your deployment log before starting the app.

## 4. Backup & recovery

- Sessions are server-local temporary storage, deleted on session close.
  Saving means the user downloads an export file — there is no server-side
  saved state to back up.
- If an external Supabase database is attached later: enable Supabase
  automatic daily backups (dashboard → Database → Backups) and test restore
  to a staging project before relying on it.
- Uploaded PDFs live only in memory/temp for the active session; no
  document backup is needed or retained.

## 5. HTTPS note

`npm start` / `docker compose up` serve plain HTTP for local use only.
Terminate TLS in front of the app in any shared environment (reverse proxy
such as Caddy, nginx, or Traefik, or your platform's managed HTTPS).
Never expose the container directly to the public internet over HTTP.

## 6. Smoke test

```sh
BASE_URL=http://localhost:3000 PDF_A=./a.pdf PDF_B=./b.pdf sh scripts/smoke-deploy.sh
```

The script checks, in order:

1. `GET /api/health` returns `{"ok":true,...}`
2. `POST /api/upload` (2 PDFs, `documents` fields) returns a `sessionId`
3. `POST /api/chat` with a grounded question returns `kind: "answer"` + citations
4. `POST /api/chat` with an evidence-absent question returns `kind: "refusal"`
