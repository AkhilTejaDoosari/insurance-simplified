# Insurance Simplified

Understand one health-insurance PDF, or compare up to five, with every material
claim traced to its page in the original document. Unknown, conditional and
conflicting information stays visible; the chat answers with verified
citations or explicitly refuses.

Next.js 15 · React 19 · TypeScript · Supabase Postgres + pgvector + private
Storage · pdf.js · Vitest · Playwright. Target runtime: Google Cloud Run.

## Where things are

| Need | Go to |
| --- | --- |
| What is built, what is next | [`docs/roadmap.md`](docs/roadmap.md) |
| Product requirements and UX | [`docs/product.md`](docs/product.md), [`docs/experience.md`](docs/experience.md) |
| Architecture and code map | [`docs/architecture.md`](docs/architecture.md) |
| Evidence core (trust boundary) | [`docs/evidence-core.md`](docs/evidence-core.md) |
| Tests, benchmarks, release gates | [`docs/quality.md`](docs/quality.md) |
| Security, deployment, operations | [`docs/operations.md`](docs/operations.md) |
| Decision log | [`docs/decisions.md`](docs/decisions.md) |
| Agent rules | [`AGENTS.md`](AGENTS.md) (Claude Code: [`CLAUDE.md`](CLAUDE.md)) |
| History (not authoritative) | [`docs/archive/`](docs/archive/README.md) |

```text
app/        Next.js routes, components and app/lib (extraction, evidence, rag, pdf, storage)
db/         SQL migrations and reference schema
tests/      unit · contract · integration · e2e · fixtures (synthetic PDFs)
evals/      retrieval/chat evaluation harness and frozen datasets
scripts/    fixture generation, acceptance runners, real-PDF extraction evaluation
docs/       the eight authoritative documents, Page 2 design prototype, archive
```

## Run

```sh
npm install
npm run dev        # http://localhost:3333
```

Configuration names are listed in `docs/operations.md` §3; keep values in
`.env.local` (git-ignored). Without LLM credentials the app uses the built-in
deterministic extraction and retrieval. With `LLM_BASE_URL`, `LLM_API_KEY` and
`LLM_MODEL` set, `/api/extract` and `/api/chat` use the configured
OpenAI-compatible model (send `engine: "fallback"` to force the built-in engine).

## Test

```sh
npm test               # Vitest: unit + contract + integration
npx tsc --noEmit       # types
npm run build          # production build
npm run test:e2e       # Playwright (needs browsers)
npm run eval           # retrieval/chat evaluation
REAL_PDFS_DIR=… npm run eval:extraction   # real-PDF extraction scorecard (local corpus only)
```

Real insurance PDFs are never committed; suites that need them or live
credentials report SKIPPED when they are absent.
