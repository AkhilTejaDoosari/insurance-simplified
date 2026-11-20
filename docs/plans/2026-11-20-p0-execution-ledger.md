# P0 execution ledger — canonical handover record

Status: working record, not an authoritative rule. One ledger for the P0
acceptance remediation; update it at every phase boundary and after every
completed implementation unit. **It is guidance, not proof:** a receiving agent
must verify `git status`, `git log`, the diff and the test results itself.

Plan: `docs/plans/2026-11-20-p0-acceptance-remediation.md` (DeepSeek audit,
copied unchanged from the untracked file in the `integration/m5-m7` worktree).

## Where the work lives

| Item | Value |
| --- | --- |
| Worktree | `insurance-simplified-wt/p0` (separate from `int`, where an OpenCode session and `next dev :3333` were running) |
| Branch | `p0/acceptance-remediation`, branched from `integration/m5-m7` @ `de4efe4` |
| Checkpoints | `04fd36d` Phase 1 (accepted by owner 2026-11-20 as engineering checkpoint; product acceptance BLOCKED) · `d184c71` identity generalization + legacy read-back · Phase 2 commit (see `git log`) |
| Push / PR | none (not authorized) |
| Recovery refs | `backup/*`, `refs/wip/*`, tag `recovery-pre-ui-2026-09-21` — untouched |
| Real PDFs | `REAL_PDFS_DIR` (PDF corpus) — **unset**; `REAL_FIXTURES_DIR` (private labels/ground truth) — **unset**. Both are existing contracts (`docs/quality.md` §2); no new variable. |
| Generation model | `.env.local` (int) has `EMBEDDING_*` and `SUPABASE_*` names only, **no `LLM_*`** (names inspected, values not read). Chat runs the semantic/lexical path. |
| Local e2e | Local Supabase stack `supabase-int` (workdir `insurance-simplified-wt/.supabase-int`); env written mode 600 to the session scratchpad, never printed; e2e on `E2E_PORT=3344`. |

## Phase status

| Phase | Tasks | Status |
| --- | --- | --- |
| 0 Investigation | validate audit | Done (see "Audit validation") |
| 1 Inventory and selection | 1–2 | Checkpoint `04fd36d`; owner accepted as engineering checkpoint; e2e assertion change approved |
| 2 Semantic correctness | 3–6 | Authorized 2026-11-20 (new fact ids + fact-list version); in progress |
| 3 Presentation contract | 7 | Not started — EC-7 amendment approved in principle; compatibility review pending |
| 4 Chatbot correction | 8–10 | Not started — chat-api extension approved in principle; C-4 synthesis proposal pending |
| 5 Real-document acceptance | 11 | BLOCKED — the five PDFs are not available (`REAL_PDFS_DIR` unset) |

## Audit validation (at `de4efe4`)

Baseline: `npm test` 1533 passed / 22 skipped / 0 failed (reproduced in this worktree).

| Finding | Verdict | Note |
| --- | --- | --- |
| P0-01 alphabetical top-3 default (`selection.ts:56-62`) | Confirmed, **not the observed cause** | Picker iterates `table.plans` only. Three columns = three proven plans: the two other PDFs had no verified identity and were invisible in Compare. The cap is latent (bites at ≥4 plans). |
| P0-01 `table.plans ?? attestPlans` (`verify-table.ts:69`) | Confirmed | Only on the LLM path; the observed run used the deterministic reader, where attestation already ran. |
| P0-01 silent drop of unverified plan (`verify-table.ts:72-80`) | Confirmed | |
| P0-01 page-1-only attestation (`plan-identity.ts:267`) | Confirmed | Plus the title shapes are narrow and one is insurer-specific (defect register). Most likely why 2 of 5 PDFs had no plan — **inferred, not reproduced** (PDFs absent). |
| P0-01 disabled 4th checkbox; tests encode it | Confirmed | `PolicyViewControls.tsx:162-166`; `v1-1-comparison.spec.ts:326-349`; `v5-frontend.spec.ts:388`. |
| P0-02 raw top-5 passages as `answerText`, `grounding: "explicit"` (`answer.ts:431-448`) | Confirmed | LLM-failure fallback reaches it (`route.ts:232-240`). |
| P0-02 top-1-only usefulness gate (`answer.ts:385-408`) | Confirmed | |
| P0-02 no readability gate in RAG; whitespace-only page filter only | Confirmed | `page-readability.ts` not imported under `app/lib/rag`. |
| P0-03 classification table | Confirmed from source | `fact-list.ts` eligibility alias `required to be`; bare `deductible\s*[:$]`; unanchored `over \d+`; geographic keywords only; `table-facts.ts` `LABEL_ANCHORS` + `labelHead` strips "(per injury)". Not yet executed as tests (Phase 2). |
| P0-04 exclusion outcomes over every registered plan (`exclusion-outcomes.ts:29-41`, `route.ts:306-312`) | Confirmed | |
| P0-05 `CellValue.display` only; verbatim primary rendering | Confirmed | |

## Phase 1 — completed units

### Task 1: complete plan inventory (P0-01)

- `verifyComparisonTable` verifies proposed plans, then attests **only documents not owned by a verified proposed plan** (idempotent, so `read-back.ts`'s exact plan equality holds for results produced after this change).
- New server-derived `ComparisonTable.planInventory` (one entry per uploaded document: `verified-plan` | `no-verified-plan-name` | `plan-source-unverified`). Not persisted; clients use `planInventoryOf(table)`, which always rebuilds from `documents` + verified `plans`.
- Identity is never inferred (no filename, no new title rule).
- Known edge: a session stored **before** this change on the LLM path, where the model omitted a document that has an attestable declaration, re-derives an extra plan on read-back → plans no longer equal → read-back drops plan identities (fail-closed, no wrong data). Not reachable on the deterministic path.

### Task 2: replaceable comparison selection (P0-01)

- `replaceSelectedPlan` / `removeSelectedPlan`; cap stays `MAX_SELECTED_PLANS = 3`, minimum 2.
- Picker: unselected plans are never disabled; at the cap a check replaces the last column (announced in a live region); each chip has "Replace with…" and "Remove" (disabled below two with a visible reason); "N of M verified plans · K uploaded documents"; unresolved documents listed with reason and "Read this document on its own" (switches to Understand mode, no reupload).
- Compare button explains why it is disabled; hero shows the verified-plan count.
- **Acceptance change (owner-directed):** the two e2e assertions that a 4th plan is disabled now assert it is enabled and replaces a column; the three-column cap remains asserted.

## Checks (Phase 1)

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/plan-inventory.test.ts` on original `verify-table.ts` | 3 failed (regression detected) |
| same, after change | 6 passed |
| `npx vitest run tests/unit/selection.test.ts` | 18 passed (4 new, failed first) |
| identity/contract/read-back suites | 103 passed |
| `npm test` (after review fixes) | 1548 passed / 22 skipped / 0 failed |
| `npx tsc --noEmit` | clean |
| `npm run build` | green |
| `E2E_PORT=3344 npx playwright test v1-1-comparison v5-frontend` | 19 passed |
| full `npm run test:e2e` (after review fixes) | 57 passed / 1 skipped (baseline 55/1) |
| Real-document suites | SKIPPED (22) — `REAL_PDFS_DIR`/`REAL_FIXTURES_DIR` unset |

## Phase 1 review (independent, read-only reviewer)

Verdict before fixes: request changes. None of the findings weakened a trust guarantee. Resolution:

- Legacy read-back drift. **Corrected scope:** it is not reachable on the deterministic path that the owner's sessions used (pinned by a test). It is reachable only for LLM-path results stored before this change, and there it fails closed (pinned by a test). **Owner decision:** accept it, or ask for a versioned legacy path (a rule change).
- `plan-source-unverified` reason is not persisted. It is **live-only**: after a reload the document shows "No plan name could be verified", which is still true. Persisting it would add a stored-payload field; deferred.
- Same-name plans from different documents looked identical. **Fixed**: the picker, chips and Replace list now append the source filename when names collide (`plan-picker-inventory.test.tsx`).
- The Remove reason was unreachable by keyboard. **Fixed**: `aria-disabled` plus a guarded handler.
- `aria-describedby` pointed at an element that was not rendered. **Fixed**.
- Open (minor): when a multi-source proposed plan fails, every document it cited gets the "proposed but unverified" reason. A double live region is a nit.

Screenshots (synthetic data, owner review): session scratchpad `shots/p0-phase1-compare-{desktop,mobile}-{light,dark}.png`.

## Open decisions for the owner

1. Approve the Phase 1 acceptance change to the two e2e assertions.
2. Identity discovery beyond page 1 / beyond the current title shapes, so the
   owner's other two PDFs can become comparable plans without insurer-specific
   rules (this is the defect-register item scheduled for M8). Phase 1 only
   discloses them.
3. Authorize Phase 2 (new fact ids `claims-filing-deadline`,
   `per-illness-deductible`; fact-list version bump).
4. Provide the five PDFs via `REAL_PDFS_DIR` for Phase 5.

## Next atomic step

Owner review of Phase 1 (screenshots + this ledger). If authorized, Phase 2
Task 3: failing pipeline test for "Proof of claim … within 90 days" → no
eligibility value.

## Owner decisions (2026-11-20, after Phase 1)

1. e2e assertion change approved; keep 3-plan cap and explicit replacement controls.
2. Generalizable plan-name recognition beyond page 1 approved (not deferred to M8). Must reproduce on the original PDFs first; no insurer-specific or filename-based identity.
3. Silent loss of plan identity on legacy read-back rejected: implement a bounded compatibility correction or an explicit re-analysis-required state; preserve verification and original data.
4. Phase 2 (Tasks 3–6) authorized, including fact ids and fact-list version.
5. Use `REAL_PDFS_DIR` / `REAL_FIXTURES_DIR`; missing fixtures remain an explicit acceptance blocker.

Real PDFs: four of the five owner files exist with the exact names under the
git-ignored `nonstandard/` of the main checkout (the `REAL_PDFS_DIR` root per
`quality.md`). Doc 03 exists under a slightly different file name: **identity
with the uploaded file is unconfirmed** until the owner confirms or supplies it.

## Decision 2 — plan-name recognition (reproduced, then fixed)

Reproduction (local probe outside git, `REAL_PDFS_DIR` = main checkout root):
before the change, doc 02 and doc 05 → `no-verified-plan-name`, doc 01/03/04
verified — exactly the owner's Compare screen (3 plans).

Cause: both documents open with "<product title>" on line 1 of page 1 and
"Certificate of Insurance" on line 2; the only recognizer for that shape
required the title to end in "Program". Page-1-only was **not** the cause for
any of the five documents, so it was left unchanged (no reproduced failure).

Fix: `plan-identity.ts` `documentTypeTitle` — first line of page 1 followed by
a generic insurance document-type heading (Certificate of Insurance/Coverage,
Description/Evidence of Coverage, Policy Wording/Document, Summary Plan
Description). Abstains for generic headings, legal entities, illustrative
titles, sentences, >10 words. No insurer names, no filenames. Subsumes the
Program rule. After: all five documents `verified-plan`.

**Finding for the owner:** the local file for doc 02 does not contain the
product its filename names; it is a certificate of the same product as doc 05
(98.7% text-identical; doc 05 carries a SAMPLE watermark). Filename→content
details are in the private session notes, not in git. Files 02 and 05 become
two separate plans with the same name (picker shows the filename). Please
confirm whether the file you uploaded is the same.

Still open: the insurer-specific title regex (defect register, doc 04)
remains; its brochure has no document-type heading, so no generic rule from
this change covers it. Not changed.

## Decision 3 — legacy sessions keep identities

`read-back.ts`: if default re-verification yields different plans than stored,
re-verify the stored identity set exactly as stored (`attestUnowned: false`;
every source re-verified on its page; nothing new trusted). If equal, seal and
issue as normal; documents today's rule could identify get inventory status
`reanalysis-available` with a visible message. If a stored plan no longer
verifies, identities are still withheld (tamper test).
Tests: `tests/unit/legacy-read-back-identity.test.ts` (2 failed before, 3 pass).

## Real-fixture runs

`REAL_PDFS_DIR=<main checkout> REAL_FIXTURES_DIR=<main checkout>/real-fixtures npm test`:
all real suites pass except `real-pdf-evidence.test.ts`, which needs two
other brochures (named in that test) not present on this
machine (fails identically at `04fd36d`; fixture gap, not a regression).
Doc 03's local file name differs from the uploaded name (identity with upload unconfirmed).

## Phase 2 — semantic correctness (Tasks 3–6)

Mechanism (no new component): `FactDefinition` gained optional, data-driven
guards applied by the existing line engine (`findAllMatchesWithHeaders`) and
table-label matcher (`factsForLabel`): `excludePatterns` (states a different
concept), `requiredPatterns` (e.g. a restriction marker), `governedPatterns`
(bullet value valid only under a matching governing heading; the evidence
quote spans heading → line), `matchFullLabel` + `labelHeadPattern` (basis read
from the full table label). A line ending on a dangling basis ("… for each")
is guarded together with the next line. `FACT_LIST_VERSION` v1 → v2. New facts
`per-illness-deductible` (My Costs, cost_share) and `claims-filing-deadline`
(Limits & Risks, requirement). Period qualifier now records per-illness/
per-injury/per-accident and per-certificate-period bases.

Regression suite: `tests/unit/p0-semantic-classification.test.ts` (51 cases,
synthetic text; 30 fail on the pre-Phase-2 code, the other 21 are controls and
negatives that guard against over-correction).

Real-document effect (local probe, five owner PDFs; counts only):

| Fact | Before | After | Note |
| --- | --- | --- | --- |
| eligibility | 13 values, 3 were claim/legal-action clauses | 10, none claim-related | remaining include termination/void-if-ineligible clauses (eligibility-related, kept) |
| claims-filing-deadline | — | 3 (docs 01, 02, 05) | the stated proof-of-claim submission deadline |
| annual-deductible | 14 | 9 | per-illness table cells, a per-visit ER deductible and a property-damage deductible removed |
| per-illness-deductible | — | 2 (doc 01, In-/Out-of-Network kept separate) | a benefit's own per-occurrence deductible is not taken |
| age-limits | 4 (2 were age-banded coverage maximums) | 3, all real age conditions | |
| policy-limit | 6 | 13 | overall maximum (doc 01) and age-banded maximum options (docs 02, 05, selectable, heading cited) added; sub-benefit "Maximum Limit" bullets rejected |
| geographic-restrictions | 83 (mostly mentions/definitions) | 8 | area-of-coverage restriction and home-country charges exclusion kept |
| international-coverage | 70 | 0 (NOT STATED) | no line stated a restriction; absence is honest |

Known residuals (not introduced here): policy-limit still holds two sub-benefit
maximum sentences in docs 01, 02 and 05 (AD&D, reunion) via the
pre-existing "maximum benefit/coverage" aliases; one geographic line is a
benefit-specific "applies only to … flight" condition; one annual-deductible
value in doc 01 is a sentence fragment. Docs 03/04 have no geographic
restriction captured (recall gap; honest absence).

Checks (Phase 2): `npm test` 1615 passed / 22 skipped / 0 failed; with
`REAL_PDFS_DIR`/`REAL_FIXTURES_DIR` 1737 passed / 1 failed (pre-existing
fixture gap, see above) / 42 skipped; `npx tsc --noEmit` clean; `npm run build`
green; `npm run test:e2e` 57 passed / 1 skipped. `npm run eval:extraction`:
SKIPPED in effect — its labelled brochures are not on this machine (all
metrics 0/0).
