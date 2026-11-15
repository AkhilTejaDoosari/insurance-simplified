# Operations — security, privacy, deployment, reliability, observability

Status: Authoritative · Consolidated 2026-11-15 from `SECURITY`, `DEPLOYMENT`,
`RELIABILITY` and `OBSERVABILITY` (all in `docs/archive/superseded/`; the
SQL-level grant audit of 2026-10-22 is preserved verbatim in
`SECURITY.md` §6.1 there and summarized in `decisions.md` D-026).

## 1. Security

**Trust boundaries.** Untrusted: browser input, uploaded PDFs, filenames, user
questions, model output. Trusted: the server-side application. Managed
dependencies: Supabase (Postgres, Storage), embedding and generation providers.

| ID | Rule |
| --- | --- |
| SEC-1 | **Anonymous session capability.** No sign-up in V1 (D-015). Each session has a public id plus a high-entropy capability (accepted from a cookie, `Authorization: Bearer` or `x-session-capability`; preferred transport is a Secure, HttpOnly, SameSite cookie); only a hash is stored where practical. Every protected operation verifies the capability before touching session data. A session id alone is never authorization. |
| SEC-2 | **Object-level authorization.** Session, document, page, chunk, evidence, chat and export resources are proven to belong to the authorized session. Never trust a browser-supplied document id, object key, page number or filename. Unauthorized ≡ unknown (no existence leak). |
| SEC-3 | **Scope before retrieval.** authorize → scope → retrieve → send allowed evidence to the model. Never retrieve globally and filter answers afterwards. |
| SEC-4 | **RLS is defense in depth only.** The server uses a privileged key, so application-level scope is mandatory; never claim RLS alone protects anonymous sessions. |
| SEC-5 | **Private storage.** Private bucket, generated object keys, no public URLs; signed upload authorization (target) constrained by key, session, expiry and intent. The browser never receives a service/secret key. |
| SEC-6 | **Upload validation.** PDF only: content type, signature/parseability, size and page limits; extension is a weak hint; reject disguised, unprocessable encrypted/corrupt files and path-like names. |
| SEC-7 | **Prompt injection.** Document text is data. Prompts separate system rules, user question and document evidence with an unforgeable delimiter; document text can never change authorization, request secrets, widen scope, choose tools or alter invariants. |
| SEC-8 | **Model output is untrusted.** Schema-validated before becoming state; no authority over authorization, keys, SQL, lifecycle, eligibility, numbers, citations or requirements. |
| SEC-9 | **No arbitrary server-side URL fetch** (no SSRF surface) unless a future approved requirement adds controls. |
| SEC-10 | **Secrets.** `.env.local` locally (git-ignored); runtime secret configuration in production. Never commit, bake into images, expose via `NEXT_PUBLIC_*`, print, or return in errors. |
| SEC-11 | **Minimization.** Only context that changes the result; no name, phone or email. |
| SEC-12 | **Citations shown only after verification** of session, document, page and quote. |

New session-owned data must answer, before merge: How is it authorized? Can
session A name session B's identifier? Is scope applied before retrieval? Can
it leak through logs? How is it deleted?

**Threats → controls:** guessed ids → capability + object scope; cross-session
retrieval → filter before retrieval; PDF injection → untrusted-evidence framing;
secret in browser → server-only config; malicious upload → validation +
generated keys; public PDF → private bucket; fabricated citation → deterministic
verification; fabricated coverage → evidence states and refusal; sensitive logs
→ content-minimized logging; partial deletion claimed as success → DELETING
state with retry.

## 2. Privacy, retention and deletion

- Never log PDF text, page text, evidence quotes, full questions, prompts,
  model responses, visa/status or other context values, filenames, keys, DB
  URLs or signed URLs. Log lengths, counts, hashes and opaque session refs.
- Deletion covers PDFs, pages, chunks, vectors, evidence metadata and persisted
  results. Order: mark DELETING → derived rows/vectors → storage objects →
  remaining metadata → DELETED. Any failure leaves DELETING with a retryable
  error and the identifiers needed to finish.
- Verified V1 behaviour: sessions have a 7-day lifetime; comparison results a
  30-day `expires_at`; close removes local temp state, vectors, objects, the
  session row and the stored result with fail-closed retryable 503s.
- Accepted limitations: expiry deletion is opportunistic (on the next save; no
  scheduler); legacy tmp-fallback `*.result.json` files are not wiped at close;
  provider backups retain deleted rows for their own windows — no claim of
  immediate physical erasure.
- Third-party document handling: real PDFs that were authorized only for local
  processing must not be sent to an external LLM, telemetry, storage or
  database without separate owner approval.

## 3. Configuration

Server variables (names only; values never in git): `APP_ENV`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `LLM_BASE_URL`,
`LLM_API_KEY`, `LLM_MODEL`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`,
`EMBEDDING_MODEL`, `EMBEDDING_DIMENSION=1024`, `LOG_LEVEL`. Only values the
browser truly needs may be `NEXT_PUBLIC_*`. Migration credentials are
operator-only. Without LLM credentials the app runs the deterministic engine
(`engine: "fallback"`); see `README.md`.

Coding-tool credentials (Claude, OpenCode, …) are never runtime configuration.

## 4. Deployment (Google Cloud Run)

- **Image:** clean-checkout Docker build; excludes `.env*`, `.git`, agent
  caches and host-only files; starts the production Next.js server on the
  configured port. *Known defect (M4):* the Dockerfile exposes 3000 while
  `npm start` serves 3333.
- **Initial service:** min 0 / max 1 instance; smallest CPU/memory and a
  request timeout proven by real-PDF smoke runs; changes only from measurement.
- **Release path:** commit → tests → image (immutable tag/digest traceable to a
  commit) → new revision with no/limited traffic → `/api/ready` → smoke →
  traffic. Rollback = previous known-good revision, no rebuild; DB changes stay
  backward-compatible through the rollout window; migrations never run
  destructively on startup.
- **Production smoke (A-040):** Welcome → session → upload 1–5 PDFs (one-PDF
  explanation and multi-PDF comparison) → context → READY/PARTIAL honestly →
  reload from durable state → tier selection → document-specific groups →
  citation opens the right page → one cited chat answer → one refusal →
  new instance keeps state → A cannot read B → delete succeeds or stays
  retryable. Capture stage timings.
- **Cost gate:** budget alerts are warnings, not caps. Before the first deploy
  verify Cloud Run, Cloudflare and Supabase free-tier terms, set a budget alert,
  keep max instances low. Any non-zero billing exposure needs explicit owner
  approval (D-020).
- **Approval boundary:** creating deployment files is not permission to deploy,
  push, change cloud resources, enable billing or rotate secrets.
- **CI target:** on PRs and main run `npm ci`, `npm test`, `npx tsc --noEmit`,
  `npm run build`, Docker build; provider and production smoke tests are
  separate, explicitly authorized stages. No auto-deploy.

## 5. Reliability

| Dependency | If unavailable |
| --- | --- |
| Postgres / Storage | Protected durable operations return 503; readiness fails |
| Embedding provider | Ingestion never marks READY with missing vectors; chat cannot pretend success |
| Generation provider | Deterministic results still render; generation features return a retryable technical error, never NOT STATED or a fabricated answer |
| Local filesystem | Request-scoped temp only; loss destroys nothing authoritative |

- Timeouts are configuration (starting points: DB 5 s, storage 15 s,
  embedding 30 s, generation 60 s, each request below the Cloud Run timeout).
- Retry only idempotent operations, a small bounded number of times with
  exponential backoff and jitter; never retry validation, authorization,
  unsupported files, NOT STATED or semantic refusals.
- Idempotent: document registration (hash key), comparison re-run, context
  update, session deletion — no duplicate documents, chunks, evidence or
  citations.
- Failure classes stay distinct in UI, metrics and retry: REFUSAL ·
  VALIDATION FAILURE · DEPENDENCY FAILURE · APPLICATION DEFECT.
- `/api/health`: liveness only, no provider calls. `/api/ready`: configured
  dependencies; 503 with booleans only on failure.
- No Redis, queue, worker, Kafka, Kubernetes or lock service without a
  measured failure and a decision record.

## 6. Observability

- Structured JSON logs with `request_id` (and `trace_id` when available),
  `operation`, `route`, `http_status`, `duration_ms`, `session_ref_hash`,
  `document_count`, `outcome`, `error_code`; dependency calls add provider,
  model alias, duration, retry count; retrieval adds strategy, top_k,
  retrieved/useful counts; generation adds answer kind and token counts.
- Stable events: `session.created`, `context.updated`, `document.registered`,
  `document.ready|failed`, `comparison.started|ready|partial|failed`,
  `retrieval.completed`, `chat.answered|refused|failed`,
  `citation.verified|failed`, `session.deletion_started|deleted|deletion_failed`,
  `readiness.failed`.
- Per-stage timings: storage read, PDF extraction, fact extraction, chunking,
  embedding, persistence, retrieval, generation, citation verification,
  end-to-end compare and chat.
- Alerts: readiness failing; any citation-verification failure; unexpected
  scope failures; accumulating deletion failures; 5xx/503 and provider failure
  spikes; p95 above target; cost alerts before public traffic.
- No observability vendor that stores prompts, document context or responses
  without a privacy review and a decision record (Langfuse etc. deferred).
