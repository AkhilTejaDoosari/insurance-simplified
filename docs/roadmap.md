# Roadmap and status — the single plan

Status: Authoritative · Created 2026-11-15. Replaces `PLAN.md` phases, V1.1
milestones, spec-kit `specs/001`, `docs/superpowers/plans`, the "Next" list in
`ENGINEERING_STATE.md`, and the local `.omo/plans` (all archived or local-only).
Numbering continues from the closed V1.1 milestones, so the next milestone is M4.

Status words follow `quality.md` §1 (Not started · Partial · Implemented ·
Tested · Verified). Update this file at every milestone close.

**Current milestone: M4 — Baseline integrity and CI.**
**Priority: finish health-insurance V1 before any other insurance domain.**

## 1. Where things stand (verified against `15f8cc2`, 2026-11-15)

| Capability | Status | Evidence / gap |
| --- | --- | --- |
| Welcome → Intake → Results, both entry paths | Tested | `tests/e2e/flows.spec.ts`, `checklist-flow.test.ts` |
| 1–5 PDF upload, sixth rejected | Tested | `api/upload/route.ts` (`MAX_FILES = 5`), e2e |
| Anonymous capability, object-level auth, session isolation | Tested | `session-capability.test.ts`, `rls-isolation.test.ts`, `viewer-authorization.test.ts`, `citation-route.test.ts` |
| Durable sessions (Postgres + Storage), restart-safe reload | Tested (mocks) | Live Supabase suite not run since 2026-10-22 |
| Native-text PDF reading with page provenance and layout tables | Tested | `layout-tables.ts`; byte-identical join on 15/15 corpus PDFs |
| Plan identity, tiers, structural table/statement claims with governing notes | Tested; real-PDF scored on 6 docs only | 193 verified-plan claims: 189 correct, 4 concept-adjacent, 0 incorrect; gold 15/22 fully correct. Not Verified (corpus too small) |
| Citation verification, original-PDF viewer | Tested | `evidence-verification.ts`, e2e real-table journey |
| Personalized overview, conditional values, selection (V1.1 M1–M3) | Tested | Accepted and closed 2026-10; `tests/e2e/v1-1-*.spec.ts` |
| Five containers and ≤3-plan picker (V1.1 M4) | Partial | `workspace-groups.ts` present; milestone never accepted |
| Grounded chat with refusal | Tested on synthetic eval | Semantic-only; selection evidence = ~8 answerable questions (D-013 under review) |
| PDF export from stored result | Tested | `export-auth`, `export-pdf`, `report-pdf` tests |
| Exclusion inventory and applicability | Not started | Design only (ADR-003.2) |
| Honest absence ("not found in read pages"), per-page coverage | Not started | NOT STATED derived from regex misses |
| Concept registry / schema-driven dashboard | Not started | Fixed 48-fact list |
| Plan grouping across documents | Not started | Each document treated as its own plan |
| OCR | Not started | Scanned PDFs rejected |
| Direct signed upload (A-033) | Not started | Bytes pass through `/api/upload` |
| Cloudflare production embeddings (D-012) | Not started | OpenAI-compatible adapter; Ollama locally |
| `/api/health`, `/api/ready` | Implemented | Container port aligned at 3333 (M4 task 1; `tests/contract/container-port.test.ts`) |
| CI | Not started | No workflow in the repository |
| Production deployment | Not started | Never deployed |
| Trust-boundary tests TB-1..TB-4 | Not started | Specified in `evidence-core.md` §5 |

**Completed history.** V1 (PLAN phases 0, 1 and 3; 2026-09 → 2026-10-22,
gate record in the archived `ACCEPTANCE.md`) · V1.1 M1 foundation, M2 meaning,
M3 overview (accepted) · P2 document generalization (layout tables, statement
claims, governing notes, viewer-authorization fix, claim-evaluation tooling;
committed as WIP `15f8cc2`; **independent code review not yet performed**).

## 2. Milestones

Each milestone ends with the report in `AGENTS.md` and stops for owner
approval. Do not start the next milestone automatically.

### M4 — Baseline integrity and CI · *current*

- **Objective:** a trustworthy, continuously checked baseline before new
  capability work.
- **Responsibilities:**
  1. **Tested:** container listener, exposed/published port and compose health probe aligned at 3333; `tests/contract/container-port.test.ts` fails on the old mismatch and passes after the fix. Full suite: 1325 passed / 8 skipped; types, build, tracked-files-only Docker build and exact compose health probe in the container pass.
  2. **Tested:** upload requires durable configuration and successful persistence before populating the existing cache; session/storage failures return retryable 503 even if cleanup fails (D-018). Five regressions in `tests/unit/upload-durability-failure.test.ts` failed before the fix and pass after; existing capability assertions preserved. Full suite: 1330 passed / 8 skipped; types, build, tracked-files-only Docker build and container health pass.
  3. **Tested:** uploaded filenames and raw errors are excluded from upload logs and timing metadata; request/document ids, byte counts and classified reasons remain. Four log-capture regressions in `tests/unit/upload-durability-failure.test.ts` failed before the fix and pass after. Full suite: 1334 passed / 8 skipped; types, build, tracked-files-only Docker build and container health pass.
  4. Replace the plain `>>>` document delimiter in `llm/safe-prompt.ts` with an unforgeable framing.
  5. Add CI (`.github/workflows/ci.yml`): `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run build`; e2e as a separate job. Committed locally; pushing needs owner approval.
  6. Add `tests/integration/trust-boundary.test.ts` with TB-1..TB-4 (`evidence-core.md` §5) as `it.todo` entries carrying the specification text (made real in M7).
   7. **Implemented (documentation follow-up):** `.env.example` is allowed by `.gitignore` and lists only names read by the code, with empty values (`operations.md` §3).
  8. Independent code review of the `f538a96..15f8cc2` diff using the reviewer brief in the archived `ENGINEERING_STATE.md`; record findings here.
- **Depends on:** nothing.
- **Files/contracts:** `Dockerfile`, `docker-compose.yml`, `.gitignore`, `.env.example`, `app/api/upload/route.ts`, `app/lib/llm/safe-prompt.ts`, `operations.md` §§1–4.
- **Required tests:** upload route returns 503 (not tmpdir success) when the durable store is down; log-capture test proves no filename; injection test with a forged delimiter; `docker build` + container health check passes.
- **Acceptance:** all four defects closed with tests; CI file runs green locally (`act` optional); TB tests listed as todo; `.env.example` tracked with no values; review findings recorded.
- **Completion evidence:** command output for the default gate + `docker build`; commit hash.

### M5 — Retrieval correctness

- **Objective:** session retrieval is complete and the chat retriever is chosen on evidence.
- **Responsibilities:** FILT-1 test (1,000 seeded sessions, assert complete top-k); make the semantic leg exact per session (filter by session documents first, or iterative scan after confirming pgvector ≥ 0.8); over-fetch candidates (30–50 per leg). Run RET-1 once M6 has questions; only then propose a D-013 revision (hybrid and/or reranker).
- **Depends on:** M4; RET-1 depends on M6.
- **Files/contracts:** `app/lib/rag/{postgres-vector,postgres-fts,fusion,answer}.ts`, `db/migrations/` (new migration only if needed, expand-only), `quality.md` §4.
- **Required tests:** FILT-1; existing `postgres-vector.test.ts`, chat contract tests; `npm run eval`.
- **Acceptance:** FILT-1 passes; no regression on frozen v2 validation metrics; RET-1 report with a decision proposal.
- **Completion evidence:** FILT-1 output, eval run files, decision entry if D-013 changes.

### M6 — Evaluation corpus and labels (runs alongside M5–M7)

- **Objective:** enough labelled real documents to make decisions and run release gates.
- **Responsibilities:** assemble the corpus in `quality.md` §5 outside git; define splits by document; write labels and ~150 questions; extend `scripts/p2-experiment` scoring to the new labels; store run summaries (no document text) under `evals/runs/`.
- **Depends on:** nothing technical; owner supplies lawfully obtained PDFs.
- **Acceptance:** dev/validation/held-out splits frozen with manifests (sha256 per file); labelling guide written into `quality.md`.
- **Completion evidence:** manifest files committed; labels stored outside git or sanitized.

### M7 — Verified Evidence Core in the application

- **Objective:** coverage conclusions are provably bound to the plan's own evidence, including exclusions.
- **Responsibilities:** honest absence (per-page readability and "not found in read pages"); strict structured LLM outputs + runtime validator; field grammars beyond digits (qualifiers, negation); session registry and sealed provision store; exclusion inventory and applicability resolver; issued resolutions on every rendering surface; verdict mapping per C-1 once decided.
- **Depends on:** M4; owner decision C-1; M6 dev split for tuning.
- **Files/contracts:** `evidence-core.md` (all), `app/lib/extraction/*`, `evidence-verification.ts`, `llm/client.ts`, `verdicts.ts`.
- **Required tests:** TB-1..TB-4 pass in the app (no longer todo); AT-C4/AT-AUTH-ORDER, AT-PERSIST; existing verdict-enum and contract tests unchanged or changed only with an approved decision.
- **Acceptance:** zero S1 on the dev and validation splits; defect-register rows for M7 closed.
- **Completion evidence:** test output, `claim-inventory`/`provision-score` runs before and after.

### M8 — Concept registry and schema-driven workspace

- **Objective:** a dynamic dashboard that works on unseen documents without code changes, inside the five containers.
- **Responsibilities:** versioned concept registry for SBCs plus 1–2 student-plan families (15–20 priority concepts each); server view model; renderers by provision kind; regex engine demoted to a fallback proposer; plan grouping by verified identity; eligibility tree with dates; ≤3-plan picker; hide empty/redundant groups (V1.1 M4 scope).
- **Depends on:** M7.
- **Files/contracts:** `experience.md` §§1–2, `product.md` A-012*/A-013A/A-016–A-018/UX-*, `extraction/{fact-list,workspace-groups,selection,eligibility}.ts`, `components/ComparisonTable.tsx`.
- **Required tests:** unit tests per renderer and view-model rule; an expected item with no evidence produces one unknown item and zero benefit rows (`experience.md` §1); e2e UX-01..UX-12, UX-26..UX-35; visual screenshots desktop/mobile, light/dark.
- **Acceptance:** verified recall of priority concepts ≥80 % on validation; plan grouping 100 % on validation sessions; owner visual sign-off.
- **Completion evidence:** test output, eval run, screenshots.

### M9 — Grounded chat and consistency

- **Objective:** chat and export never contradict the verified grid.
- **Responsibilities:** grid-first answers with scope labels; tier-scoped chat; stale-response control; immutable export snapshot (V1.1 M5 scope).
- **Depends on:** M7, M8; retrieval choice from M5.
- **Required tests:** chat contract tests, UX-20/21/22, consistency e2e (overview = table = chat = export for the same fact), chat eval set with refusal precision.
- **Acceptance:** 0 unsupported material claims and ≥90 % refusal precision on the validation chat set.

### M10 — Page coverage and OCR

- **Objective:** scanned and partly scanned documents are either read or honestly reported.
- **Responsibilities:** per-page unreadable detection and warning (if not already done in M7); OCR-1 benchmark; integrate the winner only after approval (a Python service or paid OCR is an architecture/cost decision).
- **Depends on:** M6 scanned slice.
- **Acceptance:** no page silently dropped on the scanned slice; OCR decision recorded.

### M11 — Release (limited pilot → general release)

- **Objective:** a deployed, measured, honestly scoped health-insurance V1.
- **Responsibilities:** direct signed upload (A-033); Cloudflare embeddings adapter (D-012) with dimension check; observability per `operations.md` §6; deletion and log-scan tests; Cloud Run deploy after the cost gate (owner approval); production smoke (A-040); held-out run against `quality.md` §6; comprehension test (UX-25); IMG acceptance case if the PDF is available.
- **Depends on:** M5–M10.
- **Acceptance:** limited-pilot gates met → pilot labelled as limited; general release only after the ≥60-document held-out gate.
- **Completion evidence:** held-out evaluation report, smoke timings, deployed revision id.

## 3. After V1

Only after general release: domain adapters for auto, pet, home and renters
(new concepts, value types such as split liability limits, scope dimensions
such as vehicle/driver/pet, and authority rules for declarations + endorsements).
The evidence core, store, renderers and chat contract are domain-independent
by design; no plugin system is built before a second domain is approved.

## 4. Open owner decisions

| # | Decision | Proposal | Blocks |
| --- | --- | --- | --- |
| C-1 | Verdict model | Keep five display verdicts; map ADR-003.1 statuses onto them | M7 |
| C-2 | D-013 semantic-only retrieval | Keep until RET-1; exact per-session fix proceeds now | M5 |
| C-4 | Budget for paid LLM evaluation, hosted OCR, annotation (D-020) | Owner approval required; spending rule in `operations.md` §4 | M6, M10, live acceptance scripts |
| C-5 | Keep D-016 (no queue/worker) | Keep unless measured p95 exceeds the request budget | M11 |
| ADJ-1 | IMG pre-certification note (83 pending claims) | Owner adjudication | M7 scoring |
| D-027…D-031 | Accept or amend the proposed decisions | Owner review | Nothing in M4 |
