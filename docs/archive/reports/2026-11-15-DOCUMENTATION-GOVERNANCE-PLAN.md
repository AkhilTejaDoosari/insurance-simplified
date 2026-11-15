# Insurance Simplified — Documentation and Implementation Governance Plan

Nov 15, 2026 · @Akhil Teja Doosari

## Recommendation in brief

**The repository does not need more documents. It needs one authority per subject and one plan.** Today it has about 57 Markdown files, around 15,000 lines, and **six overlapping planning systems**:

1. `PLAN.md` phases;
2. V1.1 milestones M1–M6 in `docs/V1_1_REVIEW_PACKAGE.md`;
3. spec-kit `specs/001` and its constitution;
4. `docs/superpowers/plans/`;
5. the "Next" list in `docs/ENGINEERING_STATE.md`;
6. the ADR-003.x and feasibility-review sequences, which live outside the repository.

Several "locked" or "draft for approval" documents are stale. An agent following `AGENTS.md` must read **14 documents** before any task, and the file is written for OpenCode, not Claude Code.

**Proposed system, in five parts:**

- **Eleven living documents**, one per responsibility. Each contains rules with stable IDs, never history.
- **Short ADRs** for *why* a rule changed.
- **A single roadmap** whose milestones name exactly which documents and IDs they touch.
- **A status file** whose "verified" claims must cite a test or evaluation run at a commit.
- **About 70 lines of agent instructions** that route Claude to the right documents instead of restating them.

Tests remain the evidence. Requirement and invariant IDs appear in test names, so a small script can show which approved rules have no test.

## What this plan is based on

**I inspected** the GitHub repository at `15f8cc2` (2026-11-14), the newest commit on any branch: every Markdown file, `AGENTS.md`, `PLAN.md`, `docs/DECISIONS.md`, the spec-kit constitution and `docs/ENGINEERING_STATE.md`.

**A correction to my earlier statements.** `15f8cc2` ("wip: preserve P2 document generalization for architecture audit") adds 5,637 lines over `f538a96`. It *contains* the work of the three 2026-11-14 recovery sessions that `ENGINEERING_STATE.md` describes:

- the viewer-authorization fix and its tests;
- the governing table notes (`table-notes.ts`);
- the claim-inventory, gold-provision and completeness-audit tooling.

**So most of the recovery work *is* visible.** What remains unseen:

1. any local change made after `15f8cc2`;
2. the `refs/wip/*` snapshots, which are not pushed (`git ls-remote` shows none);
3. the local real-PDF corpus at `~/Documents/insurance-simplified-preserved`.

Until those are reconciled, statements about them stay marked **unverified**.

Nothing was modified, installed, committed or pushed.

## Choosing the approach

The goal is a solo developer with one implementation agent. Two things matter most:

- **Context cost per task.** How much must Claude read to act correctly?
- **Drift cost.** How many places must change when a rule changes?

| Approach | Strength | Failure mode seen in this repo | Use it for |
| --- | --- | --- | --- |
| A few comprehensive documents | Easy to find | 800–1,700-line files (`ARCHITECTURE.md`, `V1_1_REVIEW_PACKAGE.md`) go stale silently and are expensive to load | Nothing |
| Many small topic files | Cheap to load | 57 files whose rules overlap: verdict states in the constitution, `DOMAIN.md` and ADR-003.1 | Only where a subject has its own owner and change rhythm |
| ADRs | Record *why*, permanently | Treated as current rules, so an old ADR contradicts the docs | Rationale and history only; never the current rule |
| Executable specifications and tests | Cannot drift unnoticed | Can't express product intent or priorities | **The evidence** of every invariant and acceptance criterion |
| Milestone documents | Focus | Multiply into competing plans (six today) | One roadmap file, one section per milestone |
| Agent instruction files | Behaviour | 430-line `AGENTS.md` that restates the docs | A short router plus non-negotiable safety rules |

**Chosen:** about a dozen responsibility documents, each with stable rule IDs. ADRs hold history. Tests carry the IDs. One roadmap, one status file, one short agent file.

**Rejected:**

- **Spec-kit per feature** (`specs/NNN`): it duplicates requirements per feature and already went stale on 2026-09-19.
- **Generated documentation sites:** no value for one developer.
- **Keeping both `PLAN.md` and V1.1 milestones:** that is the current source of drift.

**One improvement worth making: ID-tagged tests.** Each approved rule gets an ID such as `REQ-COMP-04` or `INV-EC-07`. Tests include the ID in their name, for example `it("[INV-EC-07] refuses a forged applicability record", …)`. A 40-line script (`npm run trace`) lists:

- approved IDs without a test;
- tests citing unknown or retired IDs;
- the commit at which each ID's tests last passed.

This replaces hand-maintained traceability tables, which always drift, and lets `status.md` show *verified* only with evidence.

## 1. Recommended directory tree

```text
AGENTS.md                      # ~70 lines: safety rules, routing table, working protocol (tool-neutral)
CLAUDE.md                      # 2 lines: "@AGENTS.md" plus Claude Code specifics
README.md                      # run, test, links (exists)
DESIGN.md                      # visual design system (exists; owned by frontend.md)
docs/
  README.md                    # one-page map: which document owns what, plus the authority rules
  product.md                   # vision, users, V1 scope and non-goals, journeys, REQ-* with acceptance criteria
  architecture.md              # components, boundaries, data flow, data model summary, repo map
  subsystems/
    ingestion.md               # PDF reading, OCR, layout, page coverage, document registry   (ING-*)
    evidence-core.md           # candidates, verifier, store, assessments, resolutions, rendering (INV-EC-*)
    retrieval-chat.md          # chunking, hybrid retrieval, reranking, grounded answers       (RET-*, CHAT-*)
    frontend.md                # view model, renderers, dashboard rules, citations UI           (UI-*)
  security.md                  # authorization, privacy, deletion, logging, threats           (SEC-*)
  quality.md                   # test strategy, datasets, benchmarks, release gates           (GATE-*, BENCH-*)
  operations.md                # deploy, configuration, runbooks, troubleshooting
  roadmap.md                   # milestones: goal, IDs, docs to read, entry and exit, out of scope
  status.md                    # living: active milestone, capability status, deltas, open questions
  decisions/
    README.md                  # ADR index plus statuses
    0001-....md …              # imported D-001..D-023, then ADR-003.x, then new ones
  archive/                     # historical reports and superseded docs, each with a banner
tests/…                        # unchanged; test names carry IDs
scripts/trace.ts               # ID ↔ test traceability (proposal; needs approval)
.claude/commands/milestone.md  # optional: the working protocol as a slash command
```

**Why these splits, and no more.**

- **Evidence core** gets its own document because it is the product's trust boundary and changes on a different rhythm from the UI.
- **Ingestion and retrieval** are separate because they have different inputs, failure modes and benchmarks.
- **Security** stays separate because deletion and authorization rules must be found in one place.
- **Merged:**
  - `DOMAIN.md` goes into `product.md` (insurance meaning) and `evidence-core.md` (statuses);
  - `DATA_MODEL.md` and `REPO_MAP.md` go into `architecture.md`;
  - `API.md` goes into `architecture.md` (the endpoint table) and the subsystem docs (contracts);
  - `RELIABILITY.md`, `OBSERVABILITY.md` and `DEPLOYMENT.md` go into `operations.md`;
  - `ACCEPTANCE.md` is split, with product acceptance under each `REQ-*` in `product.md` and release gates in `quality.md`.

## 2. Purpose and ownership of every document

Owner is always **Akhil (approver)**. Claude proposes changes; only an approved change makes a rule authoritative.

| Document | Source of truth for | Must contain | Must not contain | Changes when |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | How the agent works | Safety rules, a routing table (subject to document), the working protocol, stop conditions, the report template | Product or architecture rules | The workflow changes |
| `docs/README.md` | The documentation map | Owner per subject; authority rules | Rules themselves | A document is added or removed |
| `product.md` | *What* and *for whom* | Users, V1 scope and non-goals, journeys, `REQ-*` each with acceptance criteria | Implementation detail | Scope changes (ADR required) |
| `architecture.md` | Component boundaries | Components, responsibilities, data flow, data model summary, file ownership map | Subsystem invariants | A boundary moves (ADR required) |
| `subsystems/*.md` | Subsystem contracts | Responsibilities, inputs and outputs, data contracts, `INV-*` invariants, failure cases, dependencies, source files, required tests, non-goals | Code listings longer than about 15 lines; history | A contract changes |
| `security.md` | Security and privacy rules | Authorization model, data lifecycle and deletion, logging rules, threat list, `SEC-*` |  | Any data-handling change |
| `quality.md` | How we know it works | Test layers, datasets and splits, benchmark definitions, statistics, `GATE-*` release gates | Results history (that goes to `status.md` or `archive/`) | Gates or datasets change |
| `operations.md` | Running it | Environments, configuration keys, deploy steps, health checks, runbooks | Secrets | Infrastructure changes |
| `roadmap.md` | Order of work | Milestones with goal, IDs in scope, documents to read, entry and exit criteria, dependencies, out of scope | Rules (link to the IDs instead) | Milestone planning (approval) |
| `status.md` | What is true now | Active milestone; status per ID (from `trace` plus evaluation runs); deltas; open questions; last verified commit | Plans or rules | Every milestone close, and any discovered delta |
| `decisions/NNNN-*.md` | Why | Context, decision, consequences, status, supersedes or superseded-by | The current rule text (link to it) | Never edited after acceptance, except its status line |
| `archive/*` | History | The original text plus a banner |  | Never |

## 3. Existing documents: retain, consolidate, supersede, archive

**Nothing is deleted.** "Archive" means `git mv` to `docs/archive/` with a banner naming the document that replaces it, so history and blame are kept. Consolidation copies *current, approved* rules into the new document. The old file stays in place with a "Superseded by" banner until you approve archiving it.

| Existing (lines, last change) | Action | Destination | Notes |
| --- | --- | --- | --- |
| `README.md` (40, 2026-10-22) | **Retain** |  | Add a docs link |
| `DESIGN.md` (66, 2026-10-30) | **Retain** | Referenced by `frontend.md` | The visual system is its own subject |
| `AGENTS.md` (430, 2026-10-30) | **Rewrite to about 70 lines** | Rules move to their owning documents | Written for OpenCode; requires reading 14 files |
| `PLAN.md` (483, 2026-10-30) | **Consolidate, then archive** | `roadmap.md` | Its "Owner-approved V1 product revision" section goes to `product.md` |
| `docs/PRODUCT.md` (360, draft) | **Consolidate** | `product.md` | Still "DRAFT FOR HUMAN APPROVAL" |
| `docs/USER_FLOWS.md` (797) | **Consolidate** | `product.md` journeys | Trim to journeys plus `REQ-*` |
| `docs/ACCEPTANCE.md` (447, draft) | **Split** | A-001… become `REQ-*` acceptance criteria in `product.md`; gates go to `quality.md` | Keep the A-IDs as aliases so old references resolve |
| `docs/DOMAIN.md` (493) | **Split** | `product.md` (insurance meaning) and `evidence-core.md` (statuses) | Conflicts with ADR-003.1 statuses, see section 8 |
| `docs/ARCHITECTURE.md` (852, "LOCKED V1", 2026-09-21) | **Consolidate** | `architecture.md` | **Stale**: predates layout tables, statement claims and the read-through cache (`ENGINEERING_STATE.md` gap 5) |
| `docs/DATA_MODEL.md` (564), `docs/API.md` (471), `docs/REPO_MAP.md` (324) | **Consolidate** | `architecture.md` and the subsystem contracts | `REPO_MAP` dated 2026-09-21: stale |
| `docs/SECURITY.md` (452) | **Consolidate** | `security.md` | Add the logging and deletion findings |
| `docs/DEPLOYMENT.md`, `RELIABILITY.md`, `OBSERVABILITY.md` (974 total) | **Consolidate** | `operations.md`, with SLOs in `quality.md` | Fix the port and health-check mismatch there |
| `docs/DECISIONS.md` (D-001…D-023) | **Convert** | `decisions/0001–0023`, one file each, statuses preserved | Several need new decisions (section 8) |
| `.specify/memory/constitution.md` | **Supersede** | Principles become `INV-*` in `evidence-core.md`; the five-state rule needs a decision | Spec-kit is not used after 2026-09-19 |
| `.specify/templates/*`, `specs/001-*` (all 2026-09-16 to 09-19) | **Archive** | `docs/archive/spec-kit/` | Their contracts (`chat-api`, `comparison-schema`) are checked against tests first; anything still true moves to the subsystem documents |
| `docs/V1_1_REVIEW_PACKAGE.md` (1,737) | **Consolidate, then archive** | Product direction to `product.md`; M4–M6 to `roadmap.md` | M1–M3 "independently accepted and closed" is recorded in `status.md` |
| `docs/design/IMPLEMENTATION-CONTRACT.md` (88) | **Consolidate** | `frontend.md` (UI-\*) | Its acceptance checklist becomes UI-\* criteria |
| `docs/ENGINEERING_STATE.md` (217, 2026-11-14) | **Becomes `status.md`** | Measurements and open adjudications move to `status.md`; the architecture table moves to `subsystems/ingestion.md` | Says "all work uncommitted", which is stale: the work is in `15f8cc2` |
| `docs/EXTRACTION_QUALITY_BASELINE.md`, `evals/BASELINE.md`, `evals/v2-MANIFEST.md` | **Retain as dataset records** | Referenced from `quality.md` | Results, not rules |
| `docs/RAG-GAP-ANALYSIS.md` (2026-09-17) | **Archive** |  | **Stale**: says there is no vector infrastructure, which is now false |
| `docs/INSURANCE_ARCHITECTURE_AUDIT.md`, `P1_*`, `P2_*`, `REAL_PDF_DIAGNOSTIC.md`, `FEP_EXTRACTION_REPLAY.md`, `SONNET_ENGINE_VS_PIPELINE_EVALUATION.md`, `UNSEEN_DOCUMENT_GENERALIZATION.md`, `evals/AUDIT-LEDGER.md`, `evals/PRODUCTION-RAG-AUDIT.md` | **Archive** | `docs/archive/reports/` | Research and history. Any still-valid finding becomes a `status.md` delta or an ADR |
| `docs/superpowers/plans/*` (3) | **Archive** | `docs/archive/plans/` | Completed or abandoned plans |
| `db/README.md`, `tests/fixtures/README.md` | **Retain** |  | Local to their folders |
| ADR-003, ADR-003.1, ADR-003.2 and the feasibility review (Claude docs, outside the repository) | **Import** | `decisions/0024-evidence-core-contract.md` (ADR-003.2 as the accepted decision, with links to 003 and 003.1 as history); the feasibility review to `archive/reports/` | The reference-contract ZIPs are *not* imported as implementation (see section 8) |

## 4. Authority and cross-reference rules

These rules live in `docs/README.md`. `AGENTS.md` links to them and does not repeat them.

**A1. One home per rule.** Every rule has exactly one ID and one owning document (the table in section 2). Anywhere else, a rule is *referenced* as `See INV-EC-07 (evidence-core.md)`, never restated. A sentence that paraphrases a rule elsewhere is a defect.

**A2. Three kinds of truth, never mixed:**

| Kind | Where | Wins when |
| --- | --- | --- |
| What *should* be | Living documents (`product`, `architecture`, `subsystems`, `security`, `quality`, `operations`) | Always, for intent |
| What *is* | Code plus tests at a commit; `status.md` cites them | Always, for implementation claims |
| *Why* | ADRs | Never as a current rule |

A conflict between "should" and "is" is a **delta**. It is recorded in `status.md`, never resolved silently.

**A3. Document status header.** Every living document starts with a single line:

`Status: Approved | Draft · Last approved: <date> · Verified against: <commit>`

Only **Approved** content binds the agent. Draft text inside an approved document goes in a block marked `> PROPOSED (ADR-NNNN)`.

**A4. ADR lifecycle.**

1. `Proposed`, then `Accepted` or `Rejected`.
2. An accepted ADR is applied by editing the owning document **in the same change**, and the edit cites the ADR.
3. When a decision is replaced, the old ADR is marked `Superseded by NNNN`. Its body is never edited.

Because the current rule always lives in the living document, **an old ADR can never override a newer decision**: ADRs are not read as rules.

**A5. Precedence when documents conflict:**

1. `security.md`
2. `subsystems/evidence-core.md`
3. `product.md`
4. other living documents

Then the agent **stops and reports**; it does not choose (as `AGENTS.md` already requires).

**A6. Implementation evidence contradicts the plan.** The agent records a delta with evidence (the failing test, the measurement, the file and line). It proposes either a code fix inside the milestone, or an ADR changing the rule. It never edits an Approved rule to match code without approval.

**A7. Historical material** lives only in `docs/archive/`. Each file opens with:

`> ARCHIVED <date>. Not authoritative. Superseded by <doc#ID>.`

The agent does not read the archive unless a milestone names it.

**A8. ID scheme.** `<KIND>-<AREA>-<NN>`:

| Kind | Meaning | Area codes |
| --- | --- | --- |
| `REQ` | Product requirement | `UP` (upload), `OV` (overview), `COMP` (compare), `CHAT`, `REP` (report), `ELIG` (eligibility) |
| `INV` | Subsystem invariant | `ING`, `EC`, `RET`, `UI` |
| `SEC` | Security rule |  |
| `GATE` | Release gate |  |
| `BENCH` | Benchmark |  |

- IDs are never reused. A retired ID stays listed as `Retired → <replacement>`.
- Old A-001… and D-001… IDs stay as aliases.

## 5. Status and acceptance tracking

**Requirement entry format.** One per ID, in its owning document:

```text
### REQ-COMP-04  Incompatible scopes are never ranked against each other
Rule: … (one to three sentences)
Acceptance: … (observable, testable conditions)
Tests: required layer(s): unit | integration | e2e | eval
Milestone: M3
```

**Status values in `status.md`.** Exactly these:

| Status | Means | Required evidence |
| --- | --- | --- |
| Not started | No code |  |
| Partial | Some acceptance conditions met | Which conditions, plus file paths |
| Implemented | Code complete | At least one passing test tagged with the ID, at commit X |
| Verified | Acceptance met on real data where the requirement needs it | Evaluation run id plus metrics against the gate, at commit X |
| Delta | Code contradicts the rule | Evidence, plus a link to the proposed fix or ADR |

- **Implemented and Verified are never set by hand without evidence.** `npm run trace` supplies the test evidence; evaluation runs supply the rest.
- ADRs and reference ZIPs **never** count as evidence (your constraint).

**From requirement to milestone to test.** Each milestone in `roadmap.md` lists the IDs it must bring to Implemented or Verified. Its exit criterion is "all listed IDs at the target status, and every gate in scope green". Requirements with no milestone are visible as unscheduled.

## 6. Claude Code working protocol

**Agent files.**

- **One** tool-neutral `AGENTS.md`, about 70 lines.
- A two-line `CLAUDE.md` that imports it (`@AGENTS.md`), so Claude Code and any other tool share one file.
- **No** per-milestone instruction files: each milestone's section in `roadmap.md` *is* its instruction.
- Optional: `.claude/commands/milestone.md` turns the protocol below into one command, `/milestone`, so you don't retype it.

**`AGENTS.md` outline:**

1. **Safety (non-negotiable):**
   - no secrets in output, logs or commits;
   - no paid API calls, installs, pushes or deploys without approval in the current session;
   - never commit PDFs, `.env*` or corpus files;
   - the repository is public, so use `recovery_snapshot.sh` before any push of recovered work;
   - never edit tests' assertions to pass.
2. **Routing table:** subject → owning document (copied from `docs/README.md`; the only intentional duplicate, kept in sync by the link check).
3. **The working protocol** (below).
4. **Stop conditions:**
   - a document conflict;
   - a needed change outside the milestone;
   - an approved rule that looks wrong;
   - a red test you cannot explain;
   - any step needing money or a push.
5. **Completion report template.**

**Working protocol (one milestone at a time):**

| Step | Claude does | Reads | Output |
| --- | --- | --- | --- |
| 1. Orient | Read `status.md` → active milestone; then its section in `roadmap.md` | 2 files | Milestone id, IDs in scope |
| 2. Load | Read **only** the documents and IDs the milestone lists, plus `security.md` headings | Usually 2–4 sections, not whole files |  |
| 3. Inspect | Run `git status` and the relevant tests; read the files named in the subsystem docs; run `npm run trace` for the IDs in scope | Code and tests | Current state per ID; any deltas |
| 4. Plan | A bounded plan: IDs, files, tests to add, risks, what is out of scope |  | **Stop for your approval** unless the milestone is pre-approved |
| 5. Implement | Smallest change set; tests first for each ID |  | Code and tagged tests |
| 6. Verify | The milestone's checks: unit, integration, e2e, eval as listed; `trace`; build |  | Raw results |
| 7. Report | The template: IDs with status and evidence, files changed, test output summary, deltas found, risks |  | Report |
| 8. Sync docs | Update `status.md` (always); update the owning document **only** for approved rule changes; propose an ADR for anything else |  | Doc diff |
| 9. Stop | No work beyond the exit criteria |  | Waits for the next instruction |

**Roadmap milestone template** (each one fits on a screen):

```text
## M3 — Exclusion applicability (Approved)
Goal: …
IDs: INV-EC-10..14, REQ-OV-06, REQ-COMP-05
Read: subsystems/evidence-core.md §Applicability; security.md §Logging
Entry: M2 exit met; corpus labels for exclusions exist
Exit: listed IDs Implemented; GATE-S1-dev = 0; trace clean; npm run build
Out of scope: OCR, UI redesign
Depends on: M2
```

**Why this keeps context small.** A typical task reads `status.md` (one page), one roadmap section, and two to four document sections, a few thousand tokens. Today it is 14 files of 300 to 850 lines each.

## 7. Keeping documentation in sync with code and tests

1. **CI** (none exists today; add it in the first milestone):
   - `vitest` (unit, contract, integration);
   - `tsc`;
   - `npm run trace` (fails on an ID in `Implemented` without a passing tagged test, and on tests citing unknown IDs);
   - a Markdown link and anchor check over `docs/`.
2. **Same-change rule.** A commit that changes behaviour covered by an ID must touch either a tagged test, or `status.md` with a delta. A commit that changes an Approved rule must cite an Accepted ADR.
3. **Milestone close.** `status.md` gets the commit, the trace output summary and any evaluation-run ids. Each document touched gets its `Verified against:` commit updated.
4. **Drift sweep, monthly or per release.** Claude runs `trace`, lists documents whose `Verified against:` commit is older than the files they own, and opens deltas. It reports; it does not rewrite.
5. **Evaluation results** are files (`evals/runs/<date>-<id>.json`, without document text), referenced from `status.md`. Results are never pasted into the rule documents.

## 8. Reconciliation, corrections and safe migration

### Reconciliation so far

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Most 2026-11-14 recovery work **is** in `15f8cc2` | `git diff f538a96 15f8cc2`: 68 files, +5,637; `table-notes.ts`, viewer-authorization tests and claim tooling present | My feasibility review said the recovery tree was unseen. Correct that to "post-`15f8cc2` local changes are unseen" |
| `ENGINEERING_STATE.md` says "all work uncommitted" | The same file is inside `15f8cc2` | Stale line; fix while creating `status.md` |
| Real-document evaluation is larger than my review stated | A six-document scored corpus with 22 hand-written gold provisions, and a 15-PDF layout corpus (`ENGINEERING_STATE.md`; `scripts/p2-experiment/*`) | Correct the feasibility review. It is still below the release gate |
| "Independent review required before any commit" | `ENGINEERING_STATE.md` says it was "NOT PERFORMED" for the code diff; my audit was architectural | **Unverified.** A code review of the recovery diff stays an open item |
| Open owner adjudications | IMG pre-certification note (83 claims pending); FEP Section 2 statements | Move to `status.md` open questions |
| `refs/wip/*` snapshots | Not on GitHub | Preserved only locally; must be kept by the snapshot step |

### Contradictions that need your decision

| # | Conflict | Proposal |
| --- | --- | --- |
| C-1 | **Verdict model.** The constitution's "Five-State Comparison Verdicts (NON-NEGOTIABLE)" and `DOMAIN.md` versus the ADR-003.1 provision and outcome statuses | ADR: keep the five user-facing verdicts as the *display* layer; map the richer internal statuses onto them. One mapping table in `evidence-core.md` |
| C-2 | **D-013 (semantic pgvector is the production default)** versus the feasibility review (hybrid plus a reranker) | Keep D-013 until benchmark RET-1 runs; then an ADR, either way. Fix exact per-session search now: that does not contradict D-013 |
| C-3 | **D-007 (five result sections)** versus registry-driven sections | Compatible: every registry concept is assigned to one of the five sections. Confirm |
| C-4 | **D-020 (zero new spend)** versus hosted OCR, LLM-path evaluation and the corpus build | Set an explicit budget, or decide "open-source only" |
| C-5 | **D-016 (no queue or worker in V1)** versus possible background processing | Keep; revisit only if measured p95 processing exceeds the request budget |
| C-6 | **Six milestone schemes**, with a name clash: "M1" means V1.1 M1 *and* ADR-003 M1 | One `roadmap.md`. Record V1.1 M1–M3 as done; replace all other schemes. New ids continue from M4 |

### Correction: 30 held-out documents versus the 59-document gate

The feasibility review's benchmark plan has **30 held-out documents**. Its V1 gate requires zero S1 errors on **at least 59**. With zero failures in *n* documents, the 95% upper bound on the per-document S1 rate is 1 − 0.05^(1/n):

| Held-out *n* | Upper bound with 0 failures |
| --- | --- |
| 30 | 9.5% |
| 59 | 4.95% |
| 60 | 4.9% |

**Option A.** 60 held-out documents (a corpus of about 100) and claim at most 5% at V1. Roughly 5 to 6 weeks of labelling **\[Estimate\]**.

**Option B (recommended): staged.**

- **V1 limited release** gate: zero S1 on 30 held-out documents, stated publicly as "no incorrect verified claims in 30 unseen documents; 95% bound ≤ 9.5%".
- **V1 general release** gate: grow the held-out set to at least 60 before claiming at most 5%.
- Both keep at least 10 held-out documents per supported family (ADR-003.1).

Whichever you choose goes into `quality.md` as `GATE-S1-*`. The feasibility review gets a correction note.

### Safe migration plan

Each step is local and reversible. Nothing is pushed until you approve, and only after the snapshot scan.

1. **Reconcile the local tree.**
   - Run `recovery_snapshot.sh` and attach the zip.
   - Also send the output of `git log --oneline 15f8cc2..HEAD` and `git for-each-ref --format='%(refname)' refs/wip` (names only).
   - I list post-`15f8cc2` changes and mark every statement about them verified or unverified.
2. **Create branch `docs/governance` from your local HEAD**, not from GitHub, so no local work is overwritten. The full snapshot stays untouched outside the repository.
3. **Skeleton (Draft):**
   - `docs/README.md`;
   - `status.md` (from `ENGINEERING_STATE.md` plus the capability table, every item "unverified" unless it has test evidence);
   - `roadmap.md` (mapped milestones);
   - `decisions/0001–0023` (D-001…D-023 verbatim, statuses kept);
   - `decisions/0024` (ADR-003.2).
4. **Consolidate one living document at a time, as Draft.** Each lists its source documents at the bottom. New rule IDs are assigned with A- and D- aliases. **No rule changes meaning during consolidation.** Anything that would is listed for decision instead.
5. **Rewrite `AGENTS.md`** to about 70 lines and add `CLAUDE.md`. The old file goes to `archive/AGENTS-2026-10-30.md`.
6. **Your review**, document by document, then Approved.
7. **Archive** with `git mv` and banners, only after step 6.
8. **First implementation milestone (M4):**
   - CI;
   - the `trace` script;
   - tagging existing tests with IDs where they already prove a rule;
   - the trust-boundary tests.

**Effort:** steps 3 to 5 take about 2 to 3 working sessions **\[Estimate\]**. Most text is moved, not written.

**Public-repository note.** These documents contain no document text or secrets. Existing committed text already names insurers and a local path (`~/Documents/insurance-simplified-preserved`). That is low risk, but the path can be removed in `status.md`.

## 9. What needs your approval before I create anything

**Required to start (steps 1 to 5 of the migration):**

| # | Decision | My recommendation |
| --- | --- | --- |
| P1 | The directory tree and the document list (sections 1 and 2) | Approve as proposed |
| P2 | The authority rules A1–A8 and the status values (sections 4 and 5) | Approve |
| P3 | The `AGENTS.md` rewrite (about 70 lines, tool-neutral) plus a two-line `CLAUDE.md`; the old `AGENTS.md` archived | Approve |
| P4 | Run `recovery_snapshot.sh` and send the zip plus the two `git` outputs (step 1) | Needed before any document is marked authoritative |
| P5 | Permission to create branch `docs/governance` from your **local** HEAD and commit Draft documents **locally** (no push) | Approve. Otherwise I deliver the files for you to commit |
| P6 | Milestone scheme: one `roadmap.md`, with V1.1 M1–M3 recorded as done and new milestones from M4 | Approve |

**Required before documents become Approved (step 6):**

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | C-1, the verdict model: five display verdicts with internal statuses mapped onto them | Approve as an ADR |
| D2 | Held-out sizing: Option A (60 documents) or Option B (staged 30, then 60) | Option B |
| D3 | C-4, the budget: a figure for paid LLM evaluation, hosted OCR and annotation; or "open-source only" | Your call |
| D4 | ADR-003.2 imported as Accepted at the component and responsibility level, with the reference-contract tests kept **outside** the application as a specification only | Accept. They become tagged application tests as each milestone implements them |
| D5 | C-2, C-3, C-5: keep D-013 until RET-1; five sections hold registry concepts; keep D-016 | Approve |

**Can wait until the archive step (step 7):**

- Archive `specs/001`, `.specify/`, the P1/P2 reports, `RAG-GAP-ANALYSIS.md`, `docs/superpowers/plans/` and `V1_1_REVIEW_PACKAGE.md`, each with `git mv` and a banner.
- Whether to add the optional `/milestone` command.

**What I will not do without a further explicit instruction:**

- push;
- delete anything;
- change any rule's meaning while consolidating;
- mark anything Implemented or Verified without test or evaluation evidence;
- start implementation milestones.
