# Research: Insurance Plan Comparison

**Date**: 2026-09-16 | **Spec**: [spec.md](spec.md)

All Technical Context items were greenfield defaults (no prior stack); each
decision below records rationale and alternatives. No NEEDS CLARIFICATION
remains from the spec (clarify session resolved 5/5).

## Decision 1: Single Next.js TypeScript app (UI + API routes)

- **Decision**: One Next.js 15 (App Router) TypeScript project serving the UI
  and the server paths (upload, extraction, chat, export) from API routes.
- **Rationale**: One language and one deploy minimize moving parts for a
  session-scoped app; API routes keep LLM keys and PDF parsing server-side
  while the comparison table, evidence panel, chat, and checklist stay in
  React. Matches the plan's performance goals without a split deploy.
- **Alternatives considered**: Separate Python backend + SPA frontend —
  rejected: two deploys and cross-service session handling for traffic that
  is inherently single-user and short-lived.

## Decision 2: Server-side per-page PDF text extraction

- **Decision**: Extract text per page server-side (pdfjs-dist/unpdf class of
  library), preserving page numbers as the citation unit; non-text,
  encrypted, or corrupt files fail per-file with a stated reason (FR-018).
- **Rationale**: Page-level citations are constitutional; extraction must
  therefore be page-addressable before any LLM sees the text. Server-side
  parsing keeps heavy PDFs off the client.
- **Alternatives considered**: Client-side parsing — rejected (large PDFs on
  mobile, citation integrity harder to guarantee); OCR for scans — rejected
  per spec assumption (reported unreadable, not OCR-processed).

## Decision 3: Two separate LLM paths (extraction vs. RAG)

- **Decision**: `lib/extraction/` (fact schema + verdict prompts v1) and
  `lib/rag/` (chunk/retrieve + chat prompts v1) share no prompt, schema, or
  call helper; each emits versioned, schema-validated JSON.
- **Rationale**: Direct implementation of constitution principle II; separate
  schemas also make contract tests independent per path.
- **Alternatives considered**: Single "analyze then chat" call — rejected
  explicitly by the constitution.

## Decision 4: Closed five-state verdict enum with guards

- **Decision**: `lib/verdicts.ts` exports the five states as a closed union;
  any other value fails schema validation and build-time tests.
- **Rationale**: Implements principle I and SC-003 (100% of rows carry an
  allowed state); guards make violations unrepresentable rather than
  merely discouraged.
- **Alternatives considered**: Free-text verdict labels — rejected (violates
  the constitution's forbidden bare yes/no class).

## Decision 5: Qualifier-preserving fact shape

- **Decision**: Each fact value stores `display` text plus a structured
  `qualifiers` map (network tier, period, age band, conditions); the table
  renders qualifiers verbatim and round-trips them into the export file.
- **Rationale**: Implements principle III; structured qualifiers allow
  fixtures to assert "$250 in-network / $500 out-of-network" never collapses.
- **Alternatives considered**: Plain-string values — rejected (collapse risk
  undetectable by tests).

## Decision 6: Retrieval-gated chat with fixed refusal shape

- **Decision**: The chat route retrieves passages first; zero relevant
  passages returns the fixed refusal payload ("no supporting evidence in
  the uploaded documents") with no model-generated content.
- **Rationale**: Implements principle IV and SC-005; a fixed shape makes the
  evidence-absence test set deterministic.
- **Alternatives considered**: Model-written refusals — rejected
  (non-deterministic, harder to assert in tests).

## Decision 7: Server-local temp sessions + downloadable export

- **Decision**: Sessions live in a server-local temporary directory, deleted
  on close; saving is a generated export file (comparison JSON v1) the user
  downloads and keeps.
- **Rationale**: Direct implementation of clarify outcomes (session-only,
  export-only save) with zero long-term retention surface. File-backed
  (rather than module-memory) so state is shared across routes in dev,
  production, and multi-worker servers — verified after dev-mode module
  isolation dropped cross-route in-memory state.
- **Alternatives considered**: Module-memory store — rejected (not shared
  across routes in dev); database-backed history/accounts — rejected
  (contradicts spec assumptions and the privacy posture).

## Decision 8: English-only v1, per-file caps of 15 MB / 200 pages

- **Decision**: Accept English PDFs only (non-English rejected with a clear
  message); default caps of 15 MB and 200 pages per file, reported per-file
  on violation.
- **Rationale**: English-only was clarified; caps resolve the outstanding
  low-impact scale item with generous defaults that bound the 5-minute
  extraction budget (SC-001).
- **Alternatives considered**: Unlimited size — rejected (unbounded latency
  risk against SC-001); lower caps — rejected (real plan PDFs are long).

## Decision 9: Uploads as untrusted input

- **Decision**: PDF text is treated as data, never instructions: extraction
  and RAG prompts wrap document content in delimited blocks with an
  explicit "follow only these task instructions" preamble; tool outputs are
  schema-validated before display.
- **Rationale**: Required by the constitution's Additional Constraints
  (prompt-injection hardening) for a system that feeds user files to an LLM.
- **Alternatives considered**: No special handling — rejected (jailbreak via
  crafted PDF text would be a trust-critical failure for cited output).

## Decision 10: Vitest + Playwright testing split

- **Decision**: Vitest for enum guards, qualifier fixtures, refusal shape,
  and schema validation; Playwright for the five quickstart end-to-end flows.
- **Rationale**: Fast deterministic unit/contract layer plus browser proof of
  the clickable-evidence and session lifecycle behaviors the constitution
  demands be verified at runtime.
- **Alternatives considered**: Unit-tests-only — rejected (evidence click,
  delete-on-close, and checklist routing are browser behaviors).
