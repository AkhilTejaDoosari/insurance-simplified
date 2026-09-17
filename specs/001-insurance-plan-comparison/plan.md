# Implementation Plan: Insurance Plan Comparison

**Branch**: `001-insurance-plan-comparison` | **Date**: 2026-09-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-insurance-plan-comparison/spec.md`

## Summary

Build Insurance Simplified as a single-deploy web app: users upload 2–4
English PDFs plus basic context, receive a side-by-side comparison table of
~20–30 qualifier-preserving facts with page-level citations and five-state
verdicts, inspect evidence per cell, ask cited questions in a chat side panel
(with mandatory refusal on no evidence), get insurer questions derived from
gaps, or — with no documents — complete a guided checklist flow ending back
at upload. Extraction and RAG run as separate server-side paths; all session
data is memory-only with a downloadable export as the sole save mechanism.
See [research.md](research.md) for stack rationale.

## Technical Context

**Language/Version**: TypeScript 5.x throughout (app + tests)

**Primary Dependencies**: Next.js 15 (App Router, single deploy);
server-side per-page PDF text extraction (pdfjs-dist/unpdf class of
library); server-side LLM API calls with JSON-schema-constrained outputs
(vendor-neutral); Vitest for unit/contract tests; Playwright for
end-to-end validation

**Storage**: No database. Sessions live in a server-local temporary
directory, deleted on close (see `app/lib/session.ts`). Sole persistence
is a client-downloaded export file (see
[contracts/export-file.md](contracts/export-file.md))

**Testing**: Vitest (verdict enum, qualifier fixtures, refusal logic,
schema validation) + Playwright (upload→table→evidence→chat→checklist
flows, per [quickstart.md](quickstart.md))

**Target Platform**: Modern desktop and mobile browsers

**Project Type**: Web application (single Next.js project: UI + API routes)

**Performance Goals**: Upload of 2–4 PDFs to complete comparison table in
under 5 minutes (SC-001); no-documents flow to checklist in under 3 minutes
(SC-006)

**Constraints**: Session-only retention with delete-on-close (FR-019);
English-only v1 (FR-001); 2–4 PDFs per set (FR-001); per-file default caps
of 15 MB / 200 pages (see research.md); five-state verdict vocabulary only
(FR-005); qualifiers preserved losslessly (FR-006); no external plan data
or recommendations (FR-017)

**Scale/Scope**: Single-user sessions; ~20–30 facts × up to 4 documents per
comparison; one document set per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Five-state verdicts**: comparison-schema defines a closed 5-value
  enum; no yes/no field exists. Contract tests assert rejection of any other
  value. PASS.
- **II. Extraction/RAG separation**: two independent server paths
  (`lib/extraction/` vs `lib/rag/`) with separate prompts and schemas; no
  shared call. Review checklist item in quickstart. PASS.
- **III. Qualifier preservation**: fact values carry a qualifiers structure;
  display layer renders qualifiers verbatim; qualifier-bearing fixtures in
  Vitest. PASS.
- **IV. Evidence-grounded answers + refusal**: chat path requires retrieved
  passages before answering; empty retrieval returns the refusal shape
  (contracts/chat-api.md). Evidence-absence test set per SC-005. PASS.
- **V. Uploads-only scope**: no external data source, plan database, or
  recommendation logic anywhere in design; RAG corpus is the session's
  uploads only. PASS.
- **Additional constraints**: every cell/answer carries document ID + page +
  quote; schemas versioned (`v1`); uploads treated as untrusted input
  (prompt-injection hardening noted in research.md). PASS.
- **Workflow**: spec → clarify (done, 5 sessions recorded) → plan → tasks;
  per-principle regression tests listed in quickstart. PASS.

No gate violations. No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/001-insurance-plan-comparison/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Single Next.js project (to be created during implementation):

```text
app/
├── page.tsx                  # entry: upload vs. guided-flow router
├── compare/page.tsx          # comparison table + evidence panel
├── api/
│   ├── upload/route.ts       # PDF intake + validation (2–4, English, caps)
│   ├── extract/route.ts      # extraction path → comparison table payload
│   ├── chat/route.ts         # RAG path → cited answers / refusals
│   └── export/route.ts       # downloadable export file
├── components/
│   ├── UploadDropzone.tsx
│   ├── ComparisonTable.tsx     # values link straight to citation viewer
│   ├── ChatPanel.tsx
│   ├── InsurerQuestions.tsx
│   └── ChecklistFlow.tsx
├── view/[sessionId]/[documentId]/[filename]/page.tsx  # app-owned citation viewer
└── lib/
    ├── extraction/           # fact schema, verdict assignment, prompts v1
    ├── rag/                  # chunking, retrieval, chat prompts v1
    ├── verdicts.ts           # closed five-state enum + guards
    ├── citation.ts           # citation page resolution + passage locating
    ├── document-url.ts       # citation viewer / source-page URL builders
    ├── evidence-ids.ts       # session-bound opaque evidence IDs
    └── session.ts            # in-memory session store + delete-on-close

tests/
├── contract/                 # schema + enum + refusal-shape tests
├── integration/              # extract→table→evidence→chat flows
└── unit/                     # qualifier fixtures, verdict mapping
```

**Structure Decision**: Single-project web app. One language, one deploy,
and session-only storage keep the constitution's separation and privacy
rules enforceable in code review; no backend/frontend split is warranted
for session-scoped traffic.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally left empty.
