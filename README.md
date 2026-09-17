# Insurance Simplified

Compare 2–4 insurance PDFs side by side with page-level evidence. Every
comparison row carries one of five states — SUPPORTED, DOES NOT APPEAR TO
FIT, NOT STATED, CONFLICTED, NEEDS VERIFICATION — never a bare yes/no.
A chatbot side panel answers questions with citations or explicitly refuses
when no evidence exists. Sessions use server-local temporary storage and are
deleted on close; saving means downloading an export file.

Governance: [.specify/memory/constitution.md](.specify/memory/constitution.md).
Design docs: [specs/001-insurance-plan-comparison/](specs/001-insurance-plan-comparison/).

## Run

```sh
npm install
npm run dev        # http://localhost:3000
```

## Test

```sh
npm test           # Vitest: unit + contract + integration
npm run test:e2e   # Playwright: quickstart Flows 1–6 (needs browsers)
npm run build      # production build
```

## Optional LLM engines

Without credentials the app uses the built-in deterministic extraction and
retrieval. To use an OpenAI-compatible LLM instead (separate extraction and
chat paths are preserved either way):

```sh
LLM_BASE_URL=https://… LLM_API_KEY=… LLM_MODEL=… npm run dev
```

`/api/extract` and `/api/chat` then use the LLM automatically (send
`engine: "fallback"` to force the built-in engine, or `engine: "llm"` to force
the LLM even when it isn't configured — useful for testing).
