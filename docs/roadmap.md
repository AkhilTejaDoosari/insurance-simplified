# Roadmap and status — the single plan

Status: Authoritative · Created 2026-11-15. Replaces `PLAN.md` phases, V1.1
milestones, spec-kit `specs/001`, `docs/superpowers/plans`, the "Next" list in
`ENGINEERING_STATE.md`, and the local `.omo/plans` (all archived or local-only).
Numbering continues from the closed V1.1 milestones, so the next milestone is M4.

Status words follow `quality.md` §1 (Not started · Partial · Implemented ·
Tested · Verified). Update this file at every milestone close.

**Current milestones: M5 (complete except RET-1), M6 (tooling done; labels pending), M7 (code complete for the trust core; acceptance needs labelled splits) — on `integration/m5-m7`.** M4 closed 2026-11-19.
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
| Cloudflare production embeddings (D-012) | Partial | Unchanged OpenAI-compatible adapter (`app/lib/rag/embeddings.ts`) against `@cf/qwen/qwen3-embedding-0.6b`: 1024 dims, cosine ≥ 0.9994 to 40 stored vectors (local probe outside the test suite, 2026-11-22 — not Tested evidence); no automated test or deployment config yet. No local runtime (`scripts/check-no-local-inference.sh`) |
| `/api/health`, `/api/ready` | Implemented | Container port aligned at 3333 (M4 task 1; `tests/contract/container-port.test.ts`) |
| CI | Tested (GitHub) | `.github/workflows/ci.yml`: private-data guard, unit/contract/integration, types, build, e2e against a local Supabase stack — green in CI run [44615419523](https://github.com/AkhilTejaDoosari/insurance-simplified/actions/runs/44615419523) at `aaba221` |
| Production deployment | Not started | Never deployed |
| Trust-boundary tests TB-1..TB-4 | Not started (listed as todo) | `tests/integration/trust-boundary.test.ts` — 4 `it.todo`, exact §5 text (`86e7919`); made real in M7 |

**Completed history.** V1 (PLAN phases 0, 1 and 3; 2026-09 → 2026-10-22,
gate record in the archived `ACCEPTANCE.md`) · V1.1 M1 foundation, M2 meaning,
M3 overview (accepted) · P2 document generalization (layout tables, statement
claims, governing notes, viewer-authorization fix, claim-evaluation tooling;
committed as WIP `15f8cc2`; **independent code review not yet performed**).

## 2. Milestones

Each milestone ends with the report in `AGENTS.md` and stops for owner
approval. Do not start the next milestone automatically.

### M4 — Baseline integrity and CI · *closed 2026-11-19*

- **Objective:** a trustworthy, continuously checked baseline before new
  capability work.
- **Responsibilities:**
  Evidence labels: **Tested — CI** = the task's tests ran green in CI run [44615419523](https://github.com/AkhilTejaDoosari/insurance-simplified/actions/runs/44615419523) at `aaba221` (1196 passed / 16 skipped / 4 todo; e2e 55 passed / 1 skipped). **Tested locally** = only local runs. Nothing below is *Verified* in the `quality.md` §1 sense (that level needs a real-document evaluation run; CI runs no real documents and reports those suites SKIPPED).

  1. **Tested — CI** (`d7af28b`): container listener, exposed/published port and compose health probe aligned at 3333; `tests/contract/container-port.test.ts` fails on the old mismatch, passes after. **Tested locally:** tracked-files-only `docker build` and the compose health probe in the container (not in CI); re-run at `8986f45` on 2026-11-19: `git archive HEAD | docker build` succeeds and the compose probe (`wget --spider http://localhost:3333/api/health`) passes in the container (`{"ok":true}`).
  2. **Tested — CI** (`e4a65a7`): upload requires durable configuration and successful persistence before populating the cache; session/storage failures return retryable 503 even if cleanup fails (D-018). `tests/unit/upload-durability-failure.test.ts` (5 regressions). The durable success path is exercised by the e2e job against local Supabase.
  3. **Tested — CI** (`7e8dd6f`): uploaded filenames and raw errors excluded from upload logs and timing metadata; 4 log-capture regressions in `tests/unit/upload-durability-failure.test.ts` › "never records an uploaded filename in logs or timings (%s)".
  4. **Tested — CI** (`65e77c5`, `3a05b05`): `llm/safe-prompt.ts` and the chat path (`buildRetrievalPrompt`) use fresh collision-checked frame tokens and JSON-quoted ids/filenames; `tests/unit/safe-prompt-framing.test.ts` (5) and `tests/unit/chat-prompt-framing.test.ts` (4). Framing protects source boundaries only; outputs still rely on citation verification.
  5. **Tested — CI** (`c592ed5`, `b1bf619`, `e7b7da5`, `60bf06d`, `aaba221`, action bump in the M4 close-out commit): workflow green on GitHub. The e2e job starts a local Supabase stack (`scripts/e2e-local-supabase.sh`; owner-approved option A), applies `db/migrations`, creates a private bucket; `playwright.config.ts` passes Supabase env only for a localhost URL and blanks every provider credential (`tests/unit/e2e-provider-env.test.ts`). The earlier "known red" e2e state is resolved without a guard bypass. Action-version bump (checkout v7, setup-node v7, setup-cli v3) is **Tested locally** (YAML + actionlint) until the next CI run.
  6. **Implemented, Tested — CI as todo** (`86e7919`): `tests/integration/trust-boundary.test.ts` lists TB-1..TB-4 as `it.todo` with the exact §5 text; CI reports 4 todo. Not satisfied — made real in M7.
  7. **Implemented** (documentation follow-up; `REAL_FIXTURES_DIR` added in `48b4423`): `.env.example` tracked, names only, empty values. No automated test.
  8. **Review performed, findings recorded below; independence not yet accepted by the owner.** A read-only review of `f538a96..15f8cc2` was run in the 2026-11-19 session by an agent that did not write that diff (it later implemented the M4 follow-ups). Findings:
     - H — real brochure text committed in experiment labels/gold provisions → **resolved** `48b4423` (moved to `REAL_FIXTURES_DIR`).
     - M — line engine skips table-owned lines; when the table claim is then dropped the fact can show NOT STATED although stated (`extraction/extract.ts`) → open.
     - M — structural claims are not checked for same-scope contradictions among themselves (`extraction/plan-identity.ts`, Stage E path A) → open.
     - M — common words in the column-tier list yield a guessed `planTier` (`extraction/table-facts.ts`) → open.
     - M — real-PDF suites read `nonstandard/` and named real files → **resolved** `48b4423`.
     - L — evidence restored from a persisted result is not re-verified against stored pages; a cached session is not re-checked for DB deletion (`session-store.ts`) → open.
     - L — durability tests omit partial-document restore and chat-minted citations → open.

  Additional M4 work (owner-requested, 2026-11-19): real-document text, labels, file names and insurer/product names moved out of the tracked tree (`48b4423`, `c14a0ec`; real suites SKIPPED without `REAL_FIXTURES_DIR`, 1343 passed with it — **Tested locally**); private-data guard `scripts/check-private-data.sh` (`b1bf619`, **Tested — CI**); insurer-specific plan-title regex recorded as a defect in `evidence-core.md` §6. Earlier history and other branches still contain the removed text (no history rewrite).
- **Depends on:** nothing.
- **Files/contracts:** `Dockerfile`, `docker-compose.yml`, `.gitignore`, `.env.example`, `app/api/upload/route.ts`, `app/lib/llm/safe-prompt.ts`, `operations.md` §§1–4.
- **Required tests:** upload route returns 503 (not tmpdir success) when the durable store is down; log-capture test proves no filename; injection test with a forged delimiter; `docker build` + container health check passes.
- **Acceptance:** all four defects closed with tests; CI file runs green locally (`act` optional); TB tests listed as todo; `.env.example` tracked with no values; review findings recorded.
- **Completion evidence:** command output for the default gate + `docker build`; commit hash.

**Status (2026-11-19):** tasks 1–5 Tested — CI (CI run [44615419523](https://github.com/AkhilTejaDoosari/insurance-simplified/actions/runs/44615419523) at `aaba221`); 6 Implemented (todo in CI); 7 Implemented; 8 review recorded, independence pending. No paid API calls approved or intended; one unplanned batch of embedding-provider calls occurred during the first local e2e run (2026-11-19) before `60bf06d` blanked `EMBEDDING_*` — owner to check provider usage. No deployment; no state-ownership or session-auth change.

**Closed (owner, 2026-11-19):** container build + health re-run at `8986f45` pass; the four defect-register rows are closed in `evidence-core.md` §6; review findings #2 (silent table-claim drop), #3 (same-scope contradiction) and #4 (tier-word guessing) are assigned to M7; the two low findings stay open in the review list above. The owner closed M4 on the review as recorded and set the defaults C-1 (five display verdicts, one mapping table), C-2 (keep semantic-only) and C-4 ($0) for M5–M7.

### M5–M7 status on `integration/m5-m7` (2026-11-20)

Levels per `quality.md` §1. "CI" = ran green on GitHub for the integration head; "local" = this machine only (Node 24 and Node 20 in Docker, e2e against local Supabase).

**Integration close-out (2026-11-20, takeover session).** `m7/proposer` (agent H, `1521464`) and `m7/surfaces` (agent I, `60be7cc`) are both merged into `integration/m5-m7`; the surfaces consumer's one stub (`read-back.ts` `rederive` returned null) is now bound to the producer's `rederiveSurfaces`, so export and chat re-derive stored surfaces instead of rendering every entry as "cannot be confirmed". `tests/integration/m7i-read-back-wiring.test.ts` fails if the stub returns, and a missing exclusion section now reaches the surface as an **unknown** inventory (never silence, never a coverage claim) instead of being dropped when the sealed list is empty (`tests/integration/m7i-surfaces-empty-states.test.ts`). Read-only security review of the M7 diff (`467ab59..HEAD`): no new dependencies, no document text or filenames in logs, no dynamic-code or HTML-injection sinks in changed code, no raw SQL, session capability checks unchanged, `scripts/check-private-data.sh` clean; no finding required a change. M7 is **code-complete for the merged surfaces/proposer work**, not accepted: acceptance still needs M6 labels.

**M5 — complete except RET-1.** FILT-1 **Tested** (1,000 seeded sessions, k=5/10/40 complete, 0 foreign chunks; old HNSW path returned 0.4–2.4 % of true top-k when forced) — migration `0007_exact_session_match` filters by session before exact ranking; over-fetch 40 per leg (`fusion.ts` `CANDIDATES_PER_LEG`); chat answers schema-constrained. `npm run eval`: no metric moved (frozen v2 validation MRR@10 0.8500; records in `evals/runs/m5-*`). FILT-1/pgvector suites run in the CI e2e job from this commit on. RET-1 waits for M6 questions (plan recorded in agent-A report: 12 configs, decide on validation restriction recall@10 ≥ +5 pts). D-013 unchanged (C-2).

**M6 — tooling done.** Manifest builder, split tool and labelling guide (`quality.md` §5.1–5.2); `evals/manifests/corpus-v1.json`: 12 documents (5 SBC, 7 nonstandard, 190 pages), dev split, open (not frozen); ids only, mapping outside git. **Implemented** (tooling Tested by `m6e-*`). Labels and ~150 questions: not started (owner PDFs/labels).

**M7 — code complete for the trust core; acceptance needs labelled splits.**
- **Tested:** TB-1..TB-4 pass in `tests/integration/trust-boundary.test.ts`, each failing when its guard is removed; session registry, sealed provision store, issued resolutions on comparison view, chat and export; AT-PERSIST by re-derivation; exclusion inventory (EC-13) and applicability resolver (materiality map `health-materiality@1`, owner-reviewable); C4 authority + AT-AUTH-ORDER as a library; honest absence with per-page readability (Node 20 image probe fixed); strict LLM output + runtime validator; negation/exception/network grammars; review findings #2, #3, #4 and both lows fixed; C-1 mapping table in `evidence-core.md` §3.
- **Not met:** "zero S1 on dev and validation splits" — no labels and no validation split yet. Real-document scorecard (3 local brochures) unchanged vs `m4-baseline` (display-span recall 0.491, in-inventory 0.634): no regression, no measured gain.
- **Left (code):** a provision proposer that seals exclusions and plan-attributed values from real documents (exclusions are sealed now; the line engine still rarely attributes a *value* to a proven plan, so most values display as document evidence and exclusion questions can resolve "undetermined"); wiring C4 authority into a surface (library only); exclusion outcomes outside chat.
- **Owner (labels):** labels + validation/held-out PDFs (M6); stale object-key contract (`evidence-core.md` §6) needs approval to change a test assertion.
- **Demo note (2026-11-20):** the local walkthrough uses the built-in deterministic reader (the only local model, llama3.2, fails the strict extraction schema: it invents documents/plans, so `/api/extract` correctly quarantines its output; no paid API used). With that reader, plan identity is proven from a `Plan name:` line and the exclusion inventory is complete, but values stay unattributed — the comparison shows them under "document evidence — applicability needs verification", and chat with a selected plan correctly refuses (the existing boundary test `tests/unit/adaptive-selection.test.ts` forbids feeding unassigned costs as a selected plan benefit). Grounded chat is demonstrated on a session with no proven plan, where document-scope answers carry verified citations. Demo PDFs are generated by `npm run gen-demo-fixtures` into git-ignored `real-fixtures/demo/`.

Checks at the integration head (2026-11-20, after both M7 merges and the read-back wiring): `npm test` **1533 passed / 22 skipped / 0 failed** on Node 24 and the same counts in a clean `node:20` container; `npx tsc --noEmit` clean; `npm run build` green; `docker build` (tracked files, node:20-alpine) + `/api/health` `{"ok":true}`; `npm run test:e2e` **55 passed / 1 skipped** against the local Supabase stack; live Supabase suites run with local embeddings — `persistence-cutover` (D-032) passed with 1 skipped, `m5-filt1` 4 passed / 1 skipped (k=5/10/40 all 100 % complete, 0 foreign, p95 ≤ 7.2 ms), `postgres-vector` 3 passed / 1 skipped. The 22 skipped tests are the real-document and unconfigured-provider suites (`REAL_PDFS_DIR` / live credentials absent) — reported as SKIPPED, not passed.

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
- **Responsibilities:** direct signed upload (A-033); Cloudflare embeddings adapter (D-012) with dimension check; observability per `operations.md` §6; deletion and log-scan tests; Cloud Run deploy after the cost gate (owner approval); production smoke (A-040); held-out run against `quality.md` §6; comprehension test (UX-25); Doc A acceptance case if the PDF is available.
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
| C-1 | Verdict model | **Decided 2026-11-19:** keep five display verdicts; one mapping table (`evidence-core.md` §3) | — |
| C-2 | D-013 semantic-only retrieval | **Decided 2026-11-19:** keep until RET-1; exact per-session fix proceeds now | RET-1 only |
| C-4 | Budget for paid LLM evaluation, hosted OCR, annotation (D-020) | **Decided 2026-11-19:** $0 (local models only) until revisited; spending rule in `operations.md` §4 | M6, M10, live acceptance scripts |
| C-5 | Keep D-016 (no queue/worker) | Keep unless measured p95 exceeds the request budget | M11 |
| ADJ-1 | Doc A pre-certification note (83 pending claims) | Owner adjudication | M7 scoring |
| D-027…D-031 | Accept or amend the proposed decisions | Owner review | Nothing in M4 |
