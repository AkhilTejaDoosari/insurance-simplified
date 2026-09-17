# Tasks: Insurance Plan Comparison

**Input**: Design documents from `/specs/001-insurance-plan-comparison/`
(spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included — required by the constitution (each principle MUST have
regression tests), even though the spec does not explicitly request TDD.

**Organization**: Grouped by user story; each story is independently
implementable and testable after Foundational completes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffold, tooling, and test fixtures

- [X] T001 Scaffold Next.js 15 TypeScript App Router project creating app/, app/components/, app/lib/, tests/ per plan.md structure
- [X] T002 [P] Configure linting and formatting (eslint + prettier) at repository root
- [X] T003 [P] Configure Vitest for unit/contract tests at repository root
- [X] T004 [P] Configure Playwright for end-to-end flows at repository root
- [X] T005 [P] Create sample English PDF fixtures with known values in tests/fixtures/ (agreeing, differing, missing, vague, and qualifier-bearing facts with recorded file/page/quote)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared kernel every user story depends on — verdicts, session
lifecycle, PDF intake, schema validation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Implement closed five-state verdict enum with guards in app/lib/verdicts.ts (only SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED, NEEDS VERIFICATION; any other value rejected)
- [X] T007 Implement server-local temp session store with delete-on-close in app/lib/session.ts (no database, no long-term persistence)
- [X] T008 Implement per-page PDF text extraction with page numbers in app/lib/pdf/extract-pages.ts (reject per-file: non-PDF, unreadable, encrypted, non-English, over 15 MB / 200 pages)
- [X] T009 [P] Implement upload validation for 2–4 English PDFs per set in app/api/upload/route.ts (reject outside range with clear message)
- [X] T010 [P] Implement untrusted-input prompt wrapper (delimited document blocks + task-instructions preamble) in app/lib/llm/safe-prompt.ts
- [X] T011 [P] Contract test rejecting non-enum verdicts in tests/contract/verdict-enum.test.ts
- [X] T012 [P] Unit test for session delete-on-close with no residual state in tests/unit/session.test.ts

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Upload and comparison table (Priority: P1) 🎯 MVP

**Goal**: Upload 2–4 PDFs + context → side-by-side table of ~20–30 facts
with five-state verdicts and page-level citations

**Independent Test**: Upload 2 fixture PDFs and verify a complete table with
one allowed verdict per row, qualifiers intact, and citations present

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T013 [P] [US1] Contract test for comparison-schema v1 in tests/contract/comparison-schema.test.ts (validates contracts/comparison-schema.md shape, closed enum, required evidence)
- [X] T014 [P] [US1] Unit tests for qualifier-bearing fixtures in tests/unit/qualifiers.test.ts ("$250 in-network / $500 out-of-network" never collapses; keys networkTier, period, ageBand, conditions)

### Implementation for User Story 1

- [X] T015 [P] [US1] Create versioned fact list v1 (covering deductible, out-of-pocket maximum, emergency care, prescriptions, pre-existing conditions, eligibility, network) in app/lib/extraction/fact-list.ts
- [X] T016 [US1] Implement extraction path with verdict assignment in app/lib/extraction/extract.ts (context field applied only when documents reference it; vague/partial/qualifier-missing → NEEDS VERIFICATION; context-ruled-out → DOES NOT APPEAR TO FIT; same-document/same-scope contradiction → CONFLICTED while cross-plan differences → SUPPORTED; absent everywhere → NOT STATED; V1 has no document-to-plan identity so different documentIds alone never establish a conflict; depends on T006, T015)
- [X] T017 [US1] Implement extraction endpoint in app/api/extract/route.ts emitting comparison-schema v1 (depends on T008, T016)
- [X] T018 [US1] Build upload UI with context form in app/components/UploadDropzone.tsx (age, country/residency, visa/status if relevant, location, coverage dates)
- [X] T019 [US1] Build comparison table UI in app/components/ComparisonTable.tsx (one column per document + verdict column; CONFLICTED shows both values; NOT STATED rows explicit; depends on T017)
- [X] T020 [US1] Wire entry page routing (upload vs. guided flow) in app/page.tsx (depends on T018, T019)

**Checkpoint**: User Story 1 fully functional and testable independently — MVP

---

## Phase 4: User Story 2 — Cell evidence inspection (Priority: P1)

**Goal**: Clicking any populated cell reveals source document, page, exact quote

**Independent Test**: Click cells (including a CONFLICTED row) and confirm
the evidence panel matches recorded fixtures

- [X] T021 [P] [US2] Integration test for cell→evidence flow in tests/integration/evidence.test.ts (populated cell shows document, page, exact quote; CONFLICTED shows both sources)
- [X] T022 [US2] Build evidence panel in app/components/EvidencePanel.tsx (renders documentId, 1-based page, exact quote; both sides for CONFLICTED; depends on T019)

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 — Chatbot side panel (Priority: P2)

**Goal**: Cited answers from uploaded documents only; fixed refusal when no
evidence exists

**Independent Test**: Ask an answerable and an unanswerable question against
fixtures; verify citations vs. fixed refusal shape

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T023 [P] [US3] Contract test for chat-api v1 answer/refusal shapes in tests/contract/chat-api.test.ts (≥1 citation on answers; fixed refusal text with no claims)
- [X] T024 [P] [US3] Unit test for retrieval-gated refusal in tests/unit/refusal.test.ts (empty retrieval → refusal, never a guess)

### Implementation for User Story 3

- [X] T025 [US3] Implement RAG path (chunk, retrieve over session uploads only, separate prompts v1 — no shared code with extraction) in app/lib/rag/answer.ts (depends on T010)
- [X] T026 [US3] Implement chat endpoint in app/api/chat/route.ts per contracts/chat-api.md (depends on T025)
- [X] T027 [US3] Build chat side panel in app/components/ChatPanel.tsx (renders cited answers and distinct refusal state; depends on T026)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently

---

## Phase 6: User Story 4 — Suggested insurer questions (Priority: P2)

**Goal**: Proactive questions derived from NOT STATED / CONFLICTED /
NEEDS VERIFICATION rows, each tied to its motivating fact

**Independent Test**: Upload fixtures with known gaps and confirm each
suggestion names its fact and documents

- [X] T028 [P] [US4] Unit test for suggestion generation in tests/unit/insurer-questions.test.ts (every suggestion links to ≥1 motivating fact row with triggering verdict)
- [X] T029 [US4] Implement gap-to-question generation in app/lib/extraction/insurer-questions.ts (depends on T016)
- [X] T030 [US4] Build insurer questions UI in app/components/InsurerQuestions.tsx (depends on T029)

**Checkpoint**: User Stories 1–4 all work independently

---

## Phase 7: User Story 5 — Guided no-documents checklist (Priority: P3)

**Goal**: Context collection → checklist of what to look for and which
documents to collect → route back to upload

**Independent Test**: Enter with no documents, provide context, receive an
actionable checklist and a path to upload in under 3 minutes

- [X] T031 [P] [US5] Integration test for guided flow in tests/integration/checklist-flow.test.ts (checklist produced; route back to upload works; advisory-only, no plan recommendation)
- [X] T032 [US5] Build guided checklist flow in app/components/ChecklistFlow.tsx (depends on T020)

**Checkpoint**: All user stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Export, session lifecycle proof, hardening, and full validation

- [X] T033 Implement export endpoint in app/api/export/route.ts emitting export-file v1 with lossless qualifier round-trip (depends on T007, T029)
- [X] T034 [P] Playwright end-to-end suite in tests/e2e/ covering quickstart.md Flows 1–6 (upload→table→evidence→chat→checklist→export→delete-on-close)
- [X] T035 [P] Prompt-injection hardening tests with adversarial fixture text in tests/unit/untrusted-input.test.ts (document text cannot override task instructions; depends on T010)
- [X] T036 Run full quickstart.md validation and fix gaps
- [X] T037 Code cleanup, error-message review, and documentation updates

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–7)**: All depend on Foundational; then proceed in
  parallel (if staffed) or sequentially P1 → P2 → P3
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: After Foundational — no other story dependencies (MVP)
- **US2 (P1)**: After Foundational + US1 table (renders US1 output)
- **US3 (P2)**: After Foundational — independent of US1/US2 at the path
  level; integrates at the page level
- **US4 (P2)**: After Foundational + US1 extraction output
- **US5 (P3)**: After Foundational — standalone flow routing back to upload

### Within Each User Story

- Tests written FIRST and verified FAIL before implementation
- Fact/schema pieces before path logic; path logic before endpoints;
  endpoints before UI components

### Parallel Opportunities

- T002–T005 (Setup tooling/fixtures) run in parallel
- T009–T012 (Foundational validation/tests) run in parallel
- T013 + T014, T015 + T018 (US1 tests, fact list + upload UI) run in parallel
- After Foundational: US3 path work (T023–T025) can parallel US1/US2 UI work
- T034 + T035 (Polish e2e + hardening tests) run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch US1 tests together FIRST (verify FAIL before implementing):
Task: "Contract test for comparison-schema v1 in tests/contract/comparison-schema.test.ts"
Task: "Unit tests for qualifier-bearing fixtures in tests/unit/qualifiers.test.ts"

# Launch independent US1 pieces together:
Task: "Create versioned fact list v1 in app/lib/extraction/fact-list.ts"
Task: "Build upload UI with context form in app/components/UploadDropzone.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Upload 2 fixtures → complete table per quickstart
   Flow 1; run constitution review checklist rows I–III
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → test independently → Deploy/Demo (MVP!)
3. + US2 → evidence clicks → Deploy/Demo
4. + US3 → chat with refusals → Deploy/Demo
5. + US4 → insurer questions → Deploy/Demo
6. + US5 → checklist flow → Deploy/Demo
7. + Polish → export, e2e, hardening → release

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps each task to its user story for traceability
- Constitution principles map to tasks: I → T006/T011/T013; II → T016/T025
  (separate paths); III → T014/T015; IV → T023/T024/T026; V → T025/T031
  (uploads-only corpus, advisory-only checklist)
- Commit after each task or logical group; stop at any checkpoint to
  validate the story independently
