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
| Checkpoints | `04fd36d` Phase 1 (accepted by owner 2026-11-20 as engineering checkpoint; product acceptance BLOCKED) · `d184c71` identity generalization + legacy read-back · `3d62ef6` Phase 2 · `e3375b2` Phase 2 review fixes (owner accepted Phase 2 as engineering checkpoint 2026-11-20) · Phase 3 (see `git log`) |
| Push / PR | none (not authorized) |
| Recovery refs | `backup/*`, `refs/wip/*`, tag `recovery-pre-ui-2026-09-21` — untouched |
| Recovery/private backups (outside git) | moved by the owner on 2026-11-20 to `~/Repositories/_insurance-simplified-archive/` (checkpoints, private backup, recovery copies). No repository doc pointed at the old location. |
| Real PDFs | `REAL_PDFS_DIR` (PDF corpus) and `REAL_FIXTURES_DIR` (private labels/ground truth) — existing contracts (`docs/quality.md` §2), pointed at the owner's local corpus for probes and real-fixture runs; no new variable. Files stay outside git. |
| Generation model | `.env.local` (int) has `EMBEDDING_*` and `SUPABASE_*` names only, **no `LLM_*`** (names inspected, values not read). Chat runs the semantic/lexical path. |
| Local e2e | Local Supabase stack `supabase-int` (workdir `insurance-simplified-wt/.supabase-int`); env written mode 600 to the session scratchpad, never printed; e2e on `E2E_PORT=3344`. |

## Phase status

| Phase | Tasks | Status |
| --- | --- | --- |
| 0 Investigation | validate audit | Done (see "Audit validation") |
| 1 Inventory and selection | 1–2 | Checkpoint `04fd36d`; owner accepted as engineering checkpoint; e2e assertion change approved |
| 2 Semantic correctness | 3–6 | Checkpoint `e3375b2`; owner accepted as engineering checkpoint |
| 3 Presentation contract | 7 | Checkpoints `5c6efdd`, `1af706d`; owner accepted as engineering checkpoint |
| 4 Chatbot correction | 8–10 | Checkpoints `c57db34`, `2ae2d63`; owner accepted as engineering checkpoint (2026-11-21) |
| 4b Pre-Phase-5 fixes | A-026, doc 02 fixes 1–3, chat speed | Checkpoints `435fca1` … (see "Pre-Phase-5 fixes"); owner review pending |
| 5 Real-document acceptance | 11 | **NO-GO at `d223128`.** Corrected run-14 score 29/40 (earlier "30/40" was a tally error); blind independent re-score agrees on 24/40 correct, 0 wrong, 0 false absence; bar not met. See "Run 14 re-score". Not accepted |

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

## Next atomic step (after Phase 1 — superseded)

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

## Phase 2 independent review (read-only reviewer, range `04fd36d..3d62ef6`)

Verdict before fixes: request changes. All required findings fixed test-first
(15 new regression cases, all red before the fix):

- R1 phantom identities from the generalized title rule. Fixed: page-1
  non-plan context check, page/form/specimen furniture, mostly-digit lines,
  organisation names and generic document descriptions are rejected.
- R2 governed limit heading too broad. Fixed: it requires an overall-limit
  heading and excludes out-of-pocket, visit, per-day and drug maximums. The
  bullet must start with an age band, not a bare digit.
- R3 annual vs per-illness crossover. Fixed: the basis must sit next to
  "deductible"; a line naming the annual/calendar-year deductible stays annual.
- R4 geographic regex. Fixed: "U.S." followed by a space now matches; contact
  lines are excluded; a "Label: The … only" restriction is no longer treated as
  a definition.
- O1 legacy path. Now gated to fact-list v1 results, with a stripped-plans v2
  test.
- O2 geographic table rows. A geographic label head ("Area of Coverage") now
  satisfies the restriction requirement, and unrelated labels are refused.
- Not changed (recorded): O3, where later age bands also cite their earlier
  sibling bullets. The quote is contiguous page text and verifies; this is
  extra context, not a different claim. Nit: the eligibility alias
  "required to be" was removed on purpose (claim-procedure false positives);
  this costs some recall.

Real-PDF effect after the fixes: all five identities verified; the fact counts
are unchanged from the table above.

Checks: `npm test` 1630 passed / 22 skipped / 0 failed; with real fixtures
1752 passed / 1 failed (pre-existing fixture gap) / 42 skipped; `tsc` clean;
`build` green; `test:e2e` 57 passed / 1 skipped.

## Open items after Phase 2 (superseded by the list after Phase 3)

1. Owner: confirm the doc 02 file (its content is the same product as doc 05)
   and the doc 03 file name.
2. Pre-existing insurer-specific title regex (doc 04) is still in
   `plan-identity.ts`. Replacing it needs a generic rule for brochure titles
   without a document-type heading.
3. Residual noise: sub-benefit maximum sentences under policy-limit (from
   the pre-existing aliases); one benefit-specific geographic line; a doc 01
   annual-deductible fragment.
4. Labelled-scorecard fixtures are not on this machine; `eval:extraction`
   is SKIPPED in effect.
5. Phases 3–5 not started. Phase 5 needs the owner-confirmed five PDFs.

## Owner decisions after Phase 2 (2026-11-20)

1. Phase 2 accepted as an engineering checkpoint; product acceptance BLOCKED.
2. Doc 03: the local file (no `_2026` suffix) is the file the owner uploaded.
3. Doc 02: the owner's message offered two choices (file replaced and
   inventory re-run, or file confirmed as uploaded) without selecting one.
   The local file is unchanged since before this work (same size and
   modification date), so it was not replaced; it still holds the same
   product as doc 05. The five-document inventory stays 5/5 verified on the
   current files. Needs an explicit answer before Phase 5.
4. Phase 3 authorized under the same rules.
5. Open items added by the owner: replace the insurer-specific title rule
   with a general one; the residual misfiled lines.
6. Before Phase 4: a one-paragraph proposal for $0 local-model chat answer
   generation, with the production cost.

## Phase 3 — presentation contract (Task 7, P0-05)

Compatibility review (before code):

- `CellValue.display` consumers that render to users: `ConditionalValue`
  (result cards, reading brief, comparison cells — via `AdaptiveResults`),
  the PDF export's live view path (`report/pdf.ts`, `activeView` branch), and
  chat evidence (`session-evidence.ts`, Phase 4 scope, unchanged).
  `ComparisonTable`/`PersonalizedOverview` components are rendered only by
  tests; the export's non-view branch is legacy. Extraction-side consumers
  (contradictions, overview, conditions, eligibility, premium) are unchanged.
- Real-PDF measurement: every display over 200 characters (331 of 1,665) is
  a table cell — `Label • sub-notes (Heading): cell` plus governing notes —
  up to 973 characters. Single-line values are at most 154 characters.
- EC-7 ("displays are verbatim; summarizers never rewrite meaning,
  conditions or exclusions"): the layer composes the claim **only from
  verbatim pieces** and shows every other piece as a condition, so it
  satisfies EC-7 as written. **No rule amendment was made.** A true
  plain-language rewrite would still need the amendment the plan proposed.

Implementation:

- `app/lib/presentation/claim.ts` `describeFact(value, factName)` →
  `{ claim, conditions, status: supported | conditional | unconfirmed,
  sourceWording }`. Table cell: claim = label head + `(heading): cell`;
  conditions = label sub-notes + governing notes, in order. Line: claim = the
  line without its list marker. Every piece must be a substring of the
  display, and the claim must pass `checkDisplayGrounding` (material tokens +
  negation/exception/network grammar) against the value's citations, with
  the conditions counted as shown. Otherwise `claim: null` and the verbatim
  display is shown exactly as before.
- `ConditionalValue`: the claim is the evidence link; the conditions are a
  visible list; the full display is under "Source wording" (omitted where
  the card already lists the cited wording). The multi-amount "purchased
  option unknown" check still reads the full display.
- PDF export (live path): claim headline, each condition, then
  "Source wording: …" and the page sources.
- Tests: `tests/unit/presentation-claim.test.ts` (8; module absent before),
  `tests/unit/presentation-claim-render.test.tsx` (3; all three fail on the
  pre-Phase-3 components/export).
- Real-PDF effect (local probe): 1,665 of 1,665 values get a verified claim
  (385 table cells: 337 conditional, 48 plain); claim length median 107,
  p95 126, max 251 characters (was up to 973).
- Screenshots (desktop/mobile, light/dark) captured locally for owner review;
  not committed.

Checks (Phase 3, before review): `npm test` 1641 passed / 22 skipped / 0
failed; `npx tsc --noEmit` clean; `npm run build` green; `npm run test:e2e`
57 passed / 1 skipped (unchanged); private-data guard ok.

## Phase 3 independent review (read-only reviewer, range `e3375b2..5c6efdd`)

Verdict before fixes: request changes. Fixed test-first (7 new cases, 4 red
before the fix):

- R1 (required): a label sub-note that negates, excepts or scopes the cell
  ("Dental • Not covered for adults") was moved out of the headline, leaving a
  positive claim ("Dental (Copay): $30"); the structural grounding call does
  not run the dropped-marker rule, so it was not caught. Fixed: if any
  sub-note states a marker of the shared negation/exception/network grammar
  (`statesScopingMarker`, `evidence-verification.ts`), the claim keeps the
  whole verbatim label; only governing notes become conditions. The earlier
  Phase 3 tests used "Not subject to Deductible" as a split-out condition —
  that was the flagged behaviour, so their sample sub-notes were changed to
  non-scoping ones ("Copayment: $40", "Referral required"); the negating
  case is now pinned by its own tests.
- R7 (required, tests): added negating/exception/network sub-note cases, a
  label ending in " •", a heading containing ")", "A. Smith …" not stripped,
  and the PDF with a null claim.
- Optional, done: one shared label splitter (`LABEL_NOTE_SEPARATOR` in
  `table-facts.ts`); the vacuous substring guard replaced by an exact
  reconstruction check; uppercase letters are no longer list markers; the
  misleading "conditions count as kept" grounding argument removed.
- Optional, not done (recorded): a table cell containing a line break would
  have its continuation lines listed as conditions (still verbatim and
  visible; none seen in the five PDFs).

Real-PDF effect after the fix: 1,665 of 1,665 values still get a verified
claim; claim length median 110, p95 133, max 267 characters.

Checks (after review fixes): `npm test` 1649 passed / 22 skipped / 0 failed;
with real fixtures 1771 passed / 1 failed (the same pre-existing missing-
brochure gap) / 42 skipped; `tsc` clean; `build` green; `test:e2e` 57 passed /
1 skipped.

## Owner decisions after Phase 3 (2026-11-20)

1. Phase 3 accepted as an engineering checkpoint; product acceptance BLOCKED.
2. Doc 02 replaced with the real product brochure (the earlier duplicate is
   kept outside the five and is ignored). An extra document in the corpus
   folder is for later and not part of the five. Doc 03 confirmed.
3. Chat generation for development: local open-weights model via Ollama, $0,
   no document text leaves the machine; `verifyAnswerClaims` gates every
   sentence and citation; failures become "cannot be confirmed" with cited
   passages. Production budget, outside provider and adapter: deferred to
   deployment, **not approved**.
4. Phase 4 authorized under the same rules.
5. Fix the two pre-existing bugs: PDF export "•" → "?", and the false
   "purchased option unknown" note.

## Doc 02 replacement — re-run (local probe)

- Inventory before any change: docs 01, 03, 04, 05 verified (outputs
  byte-identical to Phase 3); **doc 02 `no-verified-plan-name`**. Its page 1
  is a brochure cover: a short product title on line 1, then a tagline, with
  no document-type heading.
- Fix (decision 2 scope, general): `plan-identity.ts` `coverTitle` — the
  first line of page 1 passes the shared product-title shape (`productTitle`,
  at most 6 words) and the same document names exactly that title as its
  plan ("the <title> [insurance] plan|program|policy") on a line with no
  example/illustration wording. Only for a document no other rule
  identified; cited on page 1. Test: `tests/unit/plan-identity-cover-title.test.ts`
  (13 cases; 3 positives red before the fix). Inventory after: **5/5
  verified**.
- Fact probe, doc 02 (118 values; the old duplicate file had 505):
  - captured: coinsurance in/out-of-network (3), age conditions for
    dependants (2), waiting period (1), material exclusions (8), others.
  - **Not captured (recall gaps):** the deductibles ("Deductible<footnote
    digit> at the student health center $50", "… elsewhere $100" — the
    footnote marker is glued to the word) and "Annual maximum $1,000,000"
    (no policy-limit alias for "annual maximum"). No tables are detected on
    the benefit page.
  - **Misfiled:** policy-limit holds three amount-less "maximum benefit"
    sentence fragments and a newborn-coverage "$500" sentence (the
    pre-existing alias residual, item 3 below); premium holds a newborn
    notice clause ("additional required premium not paid"); waiting-period
    holds a mention ("… exclusion and waiting period"); one age-limits value
    is a sentence fragment.

## Phase 4 — chat correction (Tasks 8–10, P0-02, P0-04)

Reproduction (local probe, doc 02, no generation model, local embeddings):
every reply was retrieved passages joined as `answerText` with
`grounding: "explicit"` (658–12,768 characters); the semantic leg cited the
cover page and the table of contents for "geographic restrictions" and
"deductible"; "space tourism" got five passages. Exclusion outcomes were
resolved over every registered plan regardless of the chat selection; turns
from an earlier selection stayed inline and lost their filename in evidence
links once that document left the scope.

Implementation:

- `rag/answer.ts`: retrieval never answers. `uncertainOutcome` returns the
  additive chat-api v1 refusal `{ refusalText: UNCERTAIN_TEXT, citations }`
  ("This cannot be confirmed from your documents …") when relevant passages
  exist, else the plain refusal. Used by the deterministic, hybrid and
  semantic engines, by `answerViaLlm` when the model cannot answer, and when
  `verifyAnswerClaims` rejects the model's answer (no repair, unverified text
  never shown). `relevantPassages`: a passage must have a line stating a
  concept of the question (question filler words ignored; contents lines never
  count); long passages are narrowed to the verbatim lines around their most
  specific concept line; duplicates dropped; at most three. Contents/index
  passages are kept out of the model prompt. `validateChatResponse` accepts
  refusal citations (validated like answer citations).
- `api/chat/route.ts`: refusal passages are each verified on their page and
  in the chat scope (an unverifiable one is dropped; none left → plain
  refusal), registered with evidence ids, and carry the same re-derived
  related results and exclusion outcomes as answers (TB-3 still holds:
  an altered stored result shows "cannot be confirmed").
- `evidence/exclusion-outcomes.ts`: `resolveExclusionOutcomes` takes a
  required `{ documentIds }` scope; the route passes the chat's scoped
  documents (P0-04).
- `ChatPanel.tsx`: "cannot be confirmed" shows the message and the passages
  collapsed under "Passages to check (N)" with page links; turns from an
  earlier selection are grouped, collapsed and labelled under "Earlier
  questions — different selection (N)" ahead of the current turns; evidence
  links use every session document's filename (`allDocuments`, from
  `page.tsx`).
- Not done (recorded): readability metadata was not carried into
  `RagDocument` — no failing passage came from an unread page; a route-level
  P0-04 test (the scope filter is unit-tested and the route passes the scoped
  ids); a claims array / paraphrase validator (the owner decision keeps
  `verifyAnswerClaims` as the gate).

Tests (red before): `tests/unit/chat-answer-contract.test.ts` (11),
`tests/unit/chat-exclusion-scope.test.ts` (1 of 2),
`tests/unit/chat-panel-p0.test.tsx` (2).

**Acceptance changes (owner-authorized P0-02/P0-04 behaviour; listed for
review):** existing assertions that the deterministic engine returns
`kind: "answer"` now assert the "cannot be confirmed" refusal with the same
citation checks — `tests/contract/chat-api.test.ts` (deterministic grounding),
`tests/unit/refusal.test.ts`, `tests/unit/chat-lexical-questions.test.ts` (3),
`tests/unit/adaptive-retrieval.test.ts`, `tests/unit/semantic-first.test.ts`
(1: semantic-only paraphrase now shows no passage without a model; 2: lexical
fallback passages), `tests/unit/m5-overfetch.test.ts` (question gains the
topic word "deductible"; over-fetch discrimination unchanged),
`tests/unit/m5-chat-schema.test.ts` (cantAnswer with a relevant passage),
`tests/integration/m7b-read-back.test.ts`, `tests/integration/m7b-trust-boundary.ts`
(TB-3: the `kind` line only; the "cannot be confirmed" and no-altered-text
checks are unchanged), `tests/integration/persistence-cutover.test.ts`; two
call sites pass the new required scope (`m7b-trust-boundary.ts`,
`m7b-trust-notices.test.ts`); e2e `flows.spec.ts` (expand "Passages to
check" instead of an inline citation) and `v1-1-consistency.spec.ts` (expand
the earlier-questions group; added: the old answer is hidden after the
selection changes).

Real-PDF effect (doc 02, no model): no raw-passage answers; no cover or
contents passages; "space tourism" → plain refusal; at most three passages of
145–554 characters. Lexical retrieval still misses the footnote-marked
"Deductible<digit>" line (same tokenization gap as extraction); the semantic
leg finds it.

Local generation model (owner decision 3, $0): `qwen3:8b` via Ollama
(`LLM_BASE_URL=http://localhost:11434/v1`, any `LLM_API_KEY`,
`LLM_MODEL=qwen3:8b`; values are local, nothing leaves the machine). Smoke
test on doc 02 (4 questions): 2 verified answers, 1 "cannot be confirmed"
(the model cited a passage it was not given; the gate caught it), 1 refusal
(nonsense); 90–138 s per question, 7.4 GB resident. `llama3.2` 3B: 36–54 s,
but 0 verified answers. Latency is from qwen3's built-in reasoning; turning
it off needs a prompt/adapter change (not made).

Checks: `npm test` 1681 passed / 22 skipped / 0 failed; with real fixtures
1803 passed / 1 failed (pre-existing missing-brochure gap) / 42 skipped;
`tsc` clean; `build` green; `test:e2e` 57 passed / 1 skipped.

## Phase 4 independent review (read-only reviewer, range `10ebe07..c57db34`)

Verdict before fixes: request changes. Fixed test-first (new cases red
before the fix unless noted):

- R1 (required): the contents filter treated dot-leader fee schedules
  ("Annual Deductible ........ 500") as navigation, which could hide a
  material figure behind a false "no supporting evidence". Now a leader line
  is navigation only when its title has no figure, it ends in at most a bare
  page number, and its passage has a contents heading or at least three such
  lines (the bare-number case was red; the `$` case already passed).
- Word forms: 5-letter stems plus shorter forms ("excluded"/"Exclusions",
  "waiting"/"wait"); "applies" is filler; narrowing keeps up to three
  following "except/unless/…" lines.
- Cover title: a "the <title> plan" sentence with comparison wording
  ("unlike", "compare", "other", "another", …) never corroborates.
- Chat panel: a turn asked before any selection is grouped and labelled "All
  documents" once a selection exists; answer citations show the filename.
- Tests: `persistence-cutover` now requires passages before checking them;
  route tests for a dropped unverifiable passage and the all-dropped plain
  refusal (`chat-verify-boundary.test.ts`; these passed on first run — the
  route was already correct).
- **Owner question (not changed):** A-026 says a provider outage is a
  retryable technical error. When the generation model fails, the route has
  always degraded to the retrieval engine; that now reads "cannot be
  confirmed" with passages (before: raw passages as an answer). Options:
  keep, or return the retryable `CHAT_FAILED` error when the model fails.
- Not changed (recorded): the trust-boundary test no longer exercises a
  verified model answer with altered related results at integration level
  (the fallback engine cannot answer); the same attachment code serves both
  outcomes and is covered through the "cannot be confirmed" path.

Real-PDF effect after the fixes: identities 5/5; doc 02 chat outcomes
unchanged from the table above.

Checks (after review fixes): `npm test` 1692 passed / 22 skipped / 0 failed;
with real fixtures 1814 passed / 1 failed (pre-existing missing-brochure gap)
/ 42 skipped; `tsc` clean; `build` green; `test:e2e` 57 passed / 1 skipped.

## Open items (after Phase 3)

1. Doc 02 recall gaps: footnote-marked deductible labels and "annual
   maximum" (owner decision needed: fix before Phase 5, or accept).
2. Replace the pre-existing insurer-specific title rule (doc 04) in
   `plan-identity.ts` with a general rule for brochure titles that have no
   document-type heading (owner-requested).
3. Residual misfiled lines (owner-requested; doc 02 adds the cases listed
   under "Doc 02 replacement"): sub-benefit maximum sentences
   under policy-limit in docs 01, 02, 05 (pre-existing "maximum
   benefit/coverage" aliases); one benefit-specific geographic line; one doc 01
   annual-deductible sentence fragment. Recall gap: no geographic restriction
   captured for docs 03/04.
4. Fixed (owner-requested, `tests/unit/p0-preexisting-display-bugs.test.tsx`,
   both red before): the PDF export keeps every character its font can draw
   ("•", "®", "™", accented letters), uses a compatibility form otherwise,
   "?" only as a last resort; the "purchased option unknown" note counts
   dollar amounts in a table cell's own cell, not in its label/governing
   notes (`valueText` in `presentation/claim.ts`). The overview path was
   checked and never raised this note for table cells (unchanged).
6. Labelled-scorecard fixtures are not on this machine; `eval:extraction`
   is SKIPPED in effect.

## Owner decisions after Phase 4 (2026-11-21)

1. Phase 4 accepted as an engineering checkpoint; product acceptance BLOCKED.
2. A-026: separate the cases. Model/provider failure (timeout, error,
   unparseable output) → retryable `CHAT_FAILED`. Model answered but
   `verifyAnswerClaims` rejected it → "cannot be confirmed" with the cited
   passages. Regression tests for both.
3. Doc 02 fixes before Phase 5, regression-first, general rules only:
   (1) numbered exclusion-list items never filed as benefit values (first);
   (2) deductible and annual maximum missed behind a glued footnote digit;
   (3) smaller items — fix where a general rule handles them, otherwise
   record here with reasons.
4. Chat speed: turn off qwen3's reasoning step in the local adapter if the
   endpoint supports it; keep it off only if the verified-answer pass rate
   does not drop materially.
5. Record the new doc 02 finding (below).

## New doc 02 finding (verification pass, 2026-11-21)

An independent re-run of the inventory and fact probe on the replaced doc 02
(5/5 identities verified, doc 02 "verified-plan", 118 values — matching the
Phase 4 record) found a class the earlier list did not name: **four items of
the numbered exclusions list (page 9) were filed as benefit values** under
emergency care, prescriptions, maternity and dental. Smaller items found at
the same time: a section heading and disclaimers in the exclusions row,
"… means …" definition lines as values, four value-less schedule labels
(primary care, specialist, urgent care, emergency), a legal-assistance line
under referrals, and 14 per-network coinsurance lines duplicated into
network rules. The old duplicate file's counts equal doc 05's on every row.

## Pre-Phase-5 fixes (2026-11-21)

Each unit: failing test first (synthetic text), then the change, then the
five-document probe diffed against the previous unit; every removed or
added value was inspected locally (document text stays outside git).

| Unit | Commit | Rule (general, no insurer/document code) | Tests (red before) |
| --- | --- | --- | --- |
| A-026 | `435fca1` | The route no longer degrades to the retrieval engine when the model call throws; it returns the retryable `CHAT_FAILED`. A rejected answer stays "cannot be confirmed" with passages (already so; now pinned at route level). | `chat-a026-failure.test.ts` (4 of 5 red; the rejection path already passed) |
| Fix 1 | `f5088dc` | A source line inside an enumerated item of an exclusion section (found by the shared C1 scanner `scanExclusionSections`) is never a value of a Coverage or My Costs fact, except the pre-existing-condition rule. Limits & Risks facts and the exclusion inventory are unchanged. | `p0-exclusion-items-not-benefits.test.ts` (5 of 8 red; 3 controls) |
| Fix 2 | `253a6e5`, `2155ec8` | Matchers ignore a footnote marker glued to a label word; quotes/displays stay verbatim. A marker resolves to a later same-page footnote line with the same marker (exactly one), whose text joins the label's meaning, and the value cites that footnote line as a second verified citation. "Deductible <scope> $amount" at line start is a deductible (per-incident/per-visit bases, waivers, credits excluded); "Annual/Overall/… maximum $amount" at line start is the overall limit. | `p0-footnote-labels.test.ts` (8 red) |
| Fix 3 | `c8f3040` | A value-less label/heading (≤5 words, no figure, no "label: value", no stating word) is never a value; a "<Term> means …" line is not a Coverage/My Costs value. Either is **withheld** for verification when it is the document's only statement of the fact (new withheld reasons `label-without-value`, `definition-line`), dropped otherwise. Name-valued facts (`network`) exempt. Exclusion references as contract terms are not exclusions; legal/consular referrals are not referrals; paired in-/out-of-network percentages and coinsurance lines are not network rules. | `p0-doc02-small-items.test.ts` (7 of 10 red; controls) |
| Fix 3 (follow-up) | `47c0837` | Limit wording (maximum, limit, up to, same as, usual, customary, reasonable) states a value; no change on the five documents. | `p0-doc02-small-items.test.ts` (1 red) |
| Truncation guard | `8439fb4`, `c98a209` | The adapter compares the provider's `usage.prompt_tokens` with the prompt length (whitespace collapsed); a long prompt reported at > 8 characters per token was cut and fails closed → `CHAT_FAILED` (A-026). Catches severe front truncation only. | `llm-prompt-truncation.test.ts` (1 red; then 1 red for whitespace), route case in `chat-a026-failure.test.ts` |
| Review fixes | `685f2fc` | See "Pre-Phase-5 independent review". | `p0-review-findings.test.ts` (25 red of 34) |
| Chat speed | `b0e56c9` | Opt-in `LLM_REASONING_EFFORT` (closed set) sent as `reasoning_effort`; unset → body unchanged. Probed locally: Ollama's OpenAI-compatible endpoint honours `"none"` for qwen3 (0 reasoning characters, 10 vs 317 tokens on a trivial prompt); `think: false` is ignored there. | `llm-reasoning-effort.test.ts` (5 of 6 red) |

**Correction recorded:** the first fix-2 commit filed doc 02's two
"Deductible1 …" lines under the annual deductible. The page's footnote 1
reads "Per injury or sickness", so they are per-illness deductibles; the
second fix-2 commit resolves footnotes and files them correctly.

**Owner-directed acceptance change:** two tests in
`tests/unit/chat-route-engine.test.ts` asserted the old "provider failure
degrades to lexical, never a 500" contract; they now assert `CHAT_FAILED`
(retryable) and that the retrieval engine is not consulted. The explicit
`engine: "llm"` request with no model configured is treated the same way.

### Five-document probe, before → after (values per document)

| Doc | Identity | Before | After | Change |
| --- | --- | --- | --- | --- |
| 01 | verified | 471 | 415 | −20 exclusion items (fix 1), −36 headings/labels/fragments/contact lines (fix 3); 1 cell emptied by fix 1 (telehealth: its only mention was exclusion item 9) |
| 02 | verified | 118 | 84 | targets below |
| 03 | verified | 132 | 113 | −20 headings/labels/fragments (fix 3); network name kept; +1 restored by the review fix S2 ("requires …") |
| 04 | verified | 52 | 50 | −2 headings (fix 3) |
| 05 | verified | 505 | 476 | −29 headings/labels/contact lines (fix 3) |

Doc 02, per fact (changed rows): per-illness-deductible 0→2 (both cite
footnote 1), policy-limit 4→5 (annual maximum added), network-rules 14→1,
material-exclusions 8→4, surgery 10→7, emergency-care 5→3, dental 3→2,
maternity 5→4, prescriptions 2→1, specialist 1→0 and urgent care 1→0
(their label lines are withheld for verification), referral 1→0, and
heading/definition lines dropped from AD&D, coverage dates, eligibility,
evacuation, physical therapy, pre-existing, primary care, repatriation and
student health center. No value was added to docs 01, 03, 04, 05. Real
fixture suites: unchanged (only the pre-existing missing-brochure gap).

**Totals:** 1,278 → 1,138 values (baseline `435fca1`, final `685f2fc`;
regenerated after the 2026-11-21 reboot wiped the scratch dumps; the
baseline reproduced exactly). Gross: 144 removed, 4 added (two per-illness
deductibles citing footnote 1, the annual maximum, and one doc 03 line
restored by review fix S2 — net 1,138).

**Audit of the 144 removed values** (every line read locally; attribution
by probing each commit): 27 enumerated exclusion-list items (fix 1; doc 01:
20, doc 02: 7); 95 value-less labels, headings, list sub-headings, contact
lines and wrapped-line fragments; 13 per-network cost-share lines
duplicated from coinsurance; 7 references to exclusions as contract terms;
1 "… means …" definition; 1 legal-assistance referral. None stated an
amount, a coverage status or a condition; 0 unattributed. Cells left with
no value: 4 withheld for verification (`label-without-value`), doc 01
telehealth (only mention was an exclusion item), doc 02 referral (legal
referral; absence correct), doc 01 student-health-center (label dropped
while an unverified structural candidate existed; the row reports
`candidates-withheld`, "a possible source passage was found but could not
be verified").

### Recorded, not fixed (with reasons)

- "exclusions, including a new pre-existing condition exclusion and waiting
  period." (doc 02) stays in material-exclusions, pre-existing and
  waiting-period: a mention of exclusions as a topic in a gap-in-coverage
  warning. No general line rule separates it from a stated exclusion without
  reading the previous line; not changed.
- The schedule's copay column (four labels, then four amounts on separate
  lines) is not paired: pairing by position would infer a table the layout
  reader did not detect. The labels are withheld for verification instead.
- Fix 1: when an exclusion item is a document's only mention of a benefit
  (doc 01 telehealth), the benefit cell has no value; the item stays listed
  under "Exclusions read". No new absence reason was added.
- Fix 2 covers the line engine; table-label matching (`factsForLabel`) does
  not resolve footnotes (no reproduced failure; doc 02's page has no
  detected table). Chat lexical retrieval still tokenizes "Deductible1" as
  one word (semantic leg finds it).
- Residuals from earlier lists: policy-limit "maximum benefit" fragments and
  the newborn "$500" sentence; premium newborn notice clause.
- The withheld rationale text says "a table line"; label/definition lines
  reuse it.

### Pre-Phase-5 independent review (read-only reviewer, range `2ae2d63..8439fb4`)

Verdict before fixes: request changes. A-026 judged faithful to the owner
decision (no weakened assertion). Fixed test-first in `685f2fc`/`c98a209`:

- B1 (blocking): "Deductible for emergency room $250", "Deductible
  (prescription drugs) $50", "Deductible per sickness $100" matched the new
  schedule shape and would have shown as the annual deductible. Now only a
  plan-level scope may sit between label and amount; "sickness" is a
  per-incident basis. **Own assertion corrected** (this session's fix-2
  test): a place-specific "Deductible1 at the student health center" line is
  not the annual deductible.
- S6: any later "2 …" line could resolve as a footnote; now a footnote is a
  line of a note block numbered from 1 without amounts; lookahead values cite
  the footnote; the values check reads the marker-free line.
- S8: read-back kept a per-illness value whose footnote citation failed.
  First tried as general all-or-nothing citations — that broke three
  existing contract tests (`extract-verify-boundary` 12, two plan-binding
  cases), so it was narrowed: `verifyComparisonTable` re-derives a footnoted
  label's footnote from the page and withholds the value unless it is among
  the verified citations.
- S3: "This/That means you pay $300" and definitions carrying a figure are
  kept. S2: figures read on the raw line; more stating words.
- S1: whitespace collapsed before the truncation ratio.
- Recorded, not fixed: S4 (exclusion-reference / per-network excludes drop
  silently instead of withholding), S5 (exclusion spans include
  sentence-mode items and match any occurrence of a quote; no withholding),
  S7 (overall maximum not checked against the heading above it), S1
  partial-cut miss and CJK ratios, nits (legal guardian, docs for the new
  variable). None changed a value on the five documents.

Follow-up review of `685f2fc` (same reviewer): B1, S1 (whitespace), S3 and
S8 confirmed fixed with non-vacuous tests. New findings, fixed test-first
in `b46da71` (9 red before):

- N1 (blocking): the note-block rule rejected notes containing amounts, so
  a marked deductible whose footnote was not recognised fell back to its
  marker-free text and showed as a SUPPORTED annual deductible. Now a
  basis-dependent fact (deductibles, plan limit, out-of-pocket maximum)
  withholds such a line (`footnote-unresolved`); notes may state amounts.
- N2: a numbered run directly under a heading is a list, not a note block.
- N3: the label check strips a marker only when it resolved to a footnote.
- N4: ALL-CAPS lines are headings unless they state coverage; number words,
  "full" and "before" count only in value phrases.
- S7 (reviewer: block Phase 5 otherwise): an overall-maximum line directly
  under a value-less line naming a Coverage benefit is that benefit's
  sub-limit.
- Patterns match the marker-free or the footnote-substituted reading;
  guards always read the footnote-substituted line.
- **Own assertions updated (this session's fix-2 tests, per N1):** a marked
  deductible or annual maximum with no footnote on the page is now asserted
  withheld instead of filed.

No change on the five documents (1,138 values; withheld 1/2/2/0/4).
Reviewer's residual assessment: S4/S5 (silent drops) do not block, but
Phase 5 should record every NOT STATED row with its source page; S1
partial cut / CJK do not block for five English documents.

### Chat benchmark — local qwen3:8b (historical; superseded by the cloud-only decision)

Same eight questions on doc 02 (deductible, geographic restrictions,
nonsense "space tourism", annual maximum, out-of-network coinsurance,
pre-existing, ER copay, maternity), `answerViaLlm` with local embeddings and
in-memory retrieval.

1. **Context-truncation finding (root cause).** Ollama served qwen3:8b with
   a 4,096-token context; every ≈7,500-token chat prompt was cut to 2,050
   tokens from the front (`truncating input prompt limit=2050 prompt≈7,500
   keep=4`, 8 of 8 calls). The model never saw the instructions or the
   question; result 0/8 verified, every failure `stage=llm-cantAnswer`;
   `verifyAnswerClaims` never ran. Evidence of the earlier 2-of-4 smoke test
   is unreliable for the same reason. This motivated the truncation guard.
2. **16k context, reasoning ON (partial, interrupted by a reboot, then
   stopped by the owner's cloud-only decision; OFF never ran):** prompts
   intact (7,500–7,514 tokens, 0 truncation warnings). Deductible: verified
   (76 s; verbatim "Deductible1 … $50 / … $100", omits that footnote 1 makes
   them per-illness). Geographic: verified by `verifyAnswerClaims` (233 s)
   but one citation misquotes the page (";" → ".") and fails
   `verifyEvidenceCitation`; the route would fail it closed to a plain
   refusal **without passages**. Space tourism: refusal (6.5 s, no model
   call). Annual maximum: verified (161 s). Out-of-network coinsurance:
   verified (167 s). Pre-existing: "cannot be confirmed" (168 s; the model
   stated the right schedule line, then added an unsupported paraphrase;
   `verifyAnswerClaims` rejected it; the fallback passages missed the page 3
   line). ER copay: verified (120 s). Maternity: verified (155 s).
   Latencies of questions 2 and 4–5 are inflated by concurrent test runs.
3. **Findings kept for the cloud provider:** `verifyAnswerClaims` accepts a
   punctuation-level misquote that `verifyEvidenceCitation` rejects; a
   route-level citation failure returns a plain refusal instead of "cannot
   be confirmed" with passages; the reasoning-effort decision is moot.

## Owner decision (2026-11-21, after the benchmark): cloud-only inference

Ollama/local models are no longer used by the app (supersedes the
local-model chat decision). LLM: NVIDIA Nemotron 3 Ultra via
build.nvidia.com's free OpenAI-compatible endpoint through the existing
adapter (40 requests/min; public test brochures only — the free endpoint
logs usage). Embeddings: D-012, Cloudflare Workers AI, same
Qwen3-Embedding-0.6B 1024-d model, identity and dimension verified before
switching. No silent local fallback (A-026). Per-request token limits and a
usage log. $0; any paid run needs approval. Then the eight-question
benchmark on Nemotron and, if supported by the diagnosis, the grid-first
path; then cleanup (Ollama out of docker-compose and docs, CI check).
Step 2 (audit, report before changing anything) is the current step.

### Checkpoint commits (pre-Phase-5, all local, none pushed)

`435fca1` A-026 · `f5088dc` fix 1 · `253a6e5`, `2155ec8` fix 2 · `c8f3040`,
`47c0837` fix 3 · `b0e56c9` reasoning-effort option (now moot) · `8439fb4`,
`c98a209` truncation guard · `685f2fc` review fixes · `b46da71` follow-up
review fixes · this ledger update.

### Gates at `b46da71`

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm test` | 1,791 passed / 22 skipped / 0 failed |
| real-PDF (`REAL_PDFS_DIR`, `REAL_FIXTURES_DIR` = owner's local corpus) | 1,913 passed / **1 failed** / 42 skipped — the failure is the documented gap: `real-pdf-evidence.test.ts` needs two brochures not on this machine (unchanged since `04fd36d`) |
| `npm run build` | exit 0 (ESLint "failed to patch" warning, not a failure) |
| `npm run test:e2e` (local Supabase stack, port 3344) | 57 passed / 1 skipped (baseline 57/1) |
| private-data guard | ok on every commit |

## Owner decisions 2026-11-21 (after the audit) — implemented

| Decision | Commit | Evidence |
| --- | --- | --- |
| 1 Extraction/grouping deterministic; no LLM call with LLM_* set | `3217ba5` | `extraction-no-llm.test.ts` (red before); real routes: 0 provider calls during extract. EXTRACTION_ENGINE=llm server opt-in only. Owner-directed assertion changes: 2 in `extract-route-engine.test.ts`. |
| 2 Keyword fallback kept, logged | `ca2470b` | `keyword-fallback-log.test.ts` |
| 5 Grid-first chat | `9b2ca2f`, `ee56e9e`, `5824721` | `grid-first.test.ts`, `grid-first-route.test.ts` (TB-3, stale fingerprint, selection) |
| 6 One strict citation rule; refusals keep passages | `75d759a` | `verifier-alignment.test.ts`; owner-directed change: `chat-verify-boundary` #15 |
| Verifier holes found in review | `19b2694`, `ee56e9e`, `5824721`, `18d0caa` | figures exact and from the covering line; negation/qualifier parity; no short-sentence skip; word-level coverage. Own assertion reversed (`verifier-alignment`: short uncovered sentence now rejected). |
| Usage log + token caps | `896283c` | `llm-usage-log.test.ts` |
| Policy-limit wrapped fragments | `e72d173`, `5d5788a` | doc 02 −4 fragments (1,138 → 1,134); code guard (RegExp modifiers throw on Node 20); all 149 patterns compile in `node:20-alpine` (v20.20.2) |
| 7 Phase 5: record the source page for every NOT STATED row | — | Phase 5 requirement, not started |

Nemotron (`nvidia/nemotron-3-ultra-550b-a55b`, reasoning_effort none, 2 s
throttle, keyword retrieval because the local embedding model is no longer
on disk): doc 02, eight questions through the real routes at `18d0caa` —
deductible, annual maximum, pre-existing (grid-first, exact wording; every
rephrase rejected), coinsurance, ER copay (retrieval + model) verified;
maternity "cannot be confirmed" with passages; geographic refusal (model
declined); space tourism refusal. 0.9–3.2 s each, 0 failures. With
reasoning on, reasoning tokens exhausted the 1,024/512 caps (2 CHAT_FAILED).

Open: KodeKloud LLM block still active in `.env.local` (last block wins);
Cloudflare credentials; local embedding model absent (semantic leg
untested); figure swap between labels on one line (reviewer should-fix);
"deductible for X" style concepts beyond prepositions; maternity and
geographic not answered; pre-existing grid answer includes a residual
warning line.

Gates at `18d0caa`: tsc clean; npm test 1,866/22 skipped; real-PDF 1,988
passed / 1 failed (documented missing-brochure gap) / 42 skipped; build 0;
e2e 57/1 skipped. At `5d5788a`: full suite 1,868 passed on Node 22.

## Pre-Phase-5 items 1–5 (2026-11-22)

Resumed at `610a2da`; nothing was done after the usage-limit reset.

| Item | Commit | Result |
| --- | --- | --- |
| 1 Cloudflare embeddings | probe (outside git); `62e6ba5` | `@cf/qwen/qwen3-embedding-0.6b`, 1024 dims, unit vectors; cosine to 40 stored `qwen3-embedding:0.6b` vectors min 0.99946 / median 0.99965 → no mixed-vector risk. Cloudflare rejects some 32-text batches (HTTP 400, 3030 "input too big"); the adapter now halves a rejected batch (`embeddings-batch-split.test.ts`). `.env.local` names the key `CLOUDFARE_API_KEY` (typo) and has no `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`; probes mapped them in the child process only. |
| 2 Swapped figures (BLOCKING) | `a376299`, `19a03fc`, `1c61cf5`, `b04c22b`, `e3897f4` | Figure–label binding in `coveringQuote`. Four review rounds found 9 + 10 + 5 + 1 further swaps; all are tests (`figure-label-binding.test.ts`, 72 cases). Reviewer final verdict: requirement met. Recorded exceptions: an all-lower-case line ("plan a $10 plan b $30"); label-first inheritance drops a column heading ("Specialist $500"); fail-closed refusals on ambiguous lines ("… $300 after deductible", "Plan pays 80% … Plan pays 80%"). |
| 3 Maternity / geographic diagnosis | `18eefc1` | Not retrieval. Grid-first: maternity/ER/coinsurance rows are NEEDS VERIFICATION (correct fallback); no geographic concept and the row is NOT STATED. Model path: the prompt asked for a plan-label line (filename words) even with one document — uncoverable, rejected; fixed in the prompt. Geographic: home-country lines were in the prompt 3/3 runs and the model refused; a relevance rule was added. Maternity still rejected: the model joins a wrapped multi-line figure sentence (a verifier rule, not changed — owner decision). |
| 4 Decision 7 | record outside git | 83 NOT STATED rows, each with its pages; 13 have fact vocabulary on a page, 12 honest on review, **1 defect: doc 02 geographic-restrictions is stated (p4, p9 item 12) but NOT STATED** (restriction on a wrapped line / under the exclusions heading). |
| 5 Ollama cleanup | `681c9e2`, `19a03fc` | Removed from docker-compose, architecture, roadmap; D-012 amended (rule change per owner decision). `scripts/check-no-local-inference.sh` in CI (fails on hit and on grep error). |

Eight questions × five documents (Nemotron, Cloudflare embeddings, ≥2 s between provider calls of each kind, < 30/min), run at `e3897f4`: verified 5/8 (doc 01), 5/8 (02), 3/8 (03), 1/8 (04), 2/8 (05) = 16/40; "space tourism" refused on all five. Replaying every captured model answer through the pre-binding verifier (`610a2da`): the binding caused exactly one refusal — doc 04's verbatim range line "$0 - $5,000" — fixed by reading a range as one value; every other refusal is also rejected by the old verifier (model variance; plan-name label lines still added on docs 04/05; citations not verbatim on docs 03/04; meta sentences). With that fix the replayed count is 17/40.

Range review (`52e22c2`) found one swap (one end of a range); fixed in `0ab68dc` — a line with a range is always bound. Replay of all 40 captured answers at `0ab68dc`: no refusal that the pre-binding verifier would have accepted. Gates at `0ab68dc`: `tsc` clean; `npm test` 1,952 passed / 22 skipped; build 0; `test:e2e` 57 passed / 1 skipped. At `e3897f4`: real-PDF 2,068 passed / 1 failed (documented missing-brochure gap) / 42 skipped; build 0; guard ok. `test:e2e` 57 passed / 1 skipped at `62e6ba5` (verifier-only changes since).

## Owner decisions 2026-11-22 (second round) — implemented

| Decision | Commits | Evidence |
| --- | --- | --- |
| 1 Quote across line breaks (whitespace only) | `af2aa82`, review fixes `fde4348`, `3da9b3c`, `f58f6f5` | `verbatim-span-across-lines.test.ts`: exact words/figures/punctuation/case; joins only wrapped continuation lines; never inside a number; the span must be a whole sentence on the page (a cited two-line excerpt cannot stitch table rows); keeps every marker; figure binding on the block |
| Citation by reference | `3c51c19`, `fde4348`, `f58f6f5`, `dd1be6b` | passages tagged `[Page N] passage P#` with numbered lines; model returns ids + line ranges; server fills quotes; bad reference = rejected answer; plan-name header lines stripped only when exactly a verified in-scope plan name in a one-document answer. Owner-directed assertion changes: retrieval-prompt (2), chat-prompt-framing (3); mock outputs converted (`tests/helpers/chat-refs.ts`) |
| 2 Blocker 2: never "not in your documents" after the model | `65d1634`, `fde4348` | rejected answer → its cited passages; model refusal → relevant passages (small topic vocabulary) else cannot-be-confirmed without passages; route keeps cannot-be-confirmed when no passage verifies (owner-directed change: `chat-verify-boundary`) |
| 2 Blocker 1: restriction on a wrapped line | `ca3f226`, `fde4348` | sentence read for facts with required markers; five-document diff +5 / −0 (doc 02 p4 target; doc 03 p6, p7 real; doc 05 p25, p26 benefit-specific, recorded) |
| 3 `.env.local` names | — | names correct; `EMBEDDING_BASE_URL` contains literal `<` `>` around the account id → Cloudflare 404 (30 failures in one run); the benchmark launcher removed them in the child env only; owner to fix the file |

Independent review: five rounds on this range (B1–B3, N1–N2, two label-line holes, bracket qualifiers); final verdict APPROVE (`f58f6f5`); its last should-fix done in `dd1be6b`. Recorded: label inheritance can drop a column heading; the single-line rule ignores a condition on the next line (pre-existing).

Scoring at `dd1be6b` (answerability key from the documents first: 34 answerable, 6 not stated; per-question table outside git):

| Doc | Verified | Correct outcome | Wrong | Cannot be confirmed on an answerable fact | Verified, not an answer |
| --- | --- | --- | --- | --- | --- |
| 01 | 5 | 3 | 1 | 2 | 2 |
| 02 | 6 | 6 | 0 | 2 | 0 |
| 03 | 4 | 5 | 0 | 3 | 0 |
| 04 | 3 | 4 | 0 | 3 | 1 |
| 05 | 3 | 4 | 0 | 4 | 0 |
| Total | 21 | 22/40 | 1 | 14 | 3 |

False "not in your documents": 0. The wrong outcome (doc 01 ER) is a verified verbatim fragment of a wrapped table cell whose next line carries the word that gives it meaning — the recorded single-line-rule defect, now observed on a real document.

Gates at `dd1be6b`: `tsc` clean; `npm test` 2,013 passed / 22 skipped; real-PDF 2,135 passed / 1 failed (documented missing-brochure gap) / 42 skipped; build 0; `test:e2e` 57 passed / 1 skipped; guard ok.

## Owner decisions 2026-11-22 (third round) — implemented

Resumed at `613d17b`. The previous benchmark answer key and per-question
scores were in the session scratchpad and were lost in a reboot (nothing to
move). The key was rebuilt from the five documents (34 answerable, 6 not
stated — the same split as before) and saved, with every run, in the private
archive `~/Repositories/_insurance-simplified-archive/p0-benchmark-2026-11-22/`
(mode 700, outside git). Question wording was not recoverable; the eight
topics are the same. Harness: `.p0probe/bench.test.ts` (git-excluded) drives
the real extract and chat routes in-process; provider calls spaced ≥ 2.1 s
apart across all hosts (< 30/min).

| Decision | Commits | Evidence |
| --- | --- | --- |
| 1 Misleading fragment (blocking) | `e5c95d2`, review fixes `f299ff6`, `02e8fd5`, `5341f2f`, `9b80539`, `f04aa73` | `misleading-fragment.test.ts` (5 red before); mirror rule (a line whose sentence began above); the continuation must follow the line directly in the answer, every word and figure; continuation openings: lower case, amount, %, number + unit word, bare number, spelled number, qualifier word; a line ending in a lower-case function word continues; backwards, a qualifier line runs on unless it continues the row above. The span path and the fragment rules share these rules |
| 2 Rejection log | `e171aa9` | `rejection-reasons.test.ts`: closed reason codes; the log carries code + sentence position only (operations.md: no document text, quotes or questions); the sentence goes only to the opt-in `onRejection` callback (benchmark harness; no production caller) |
| 2 Grid-first diagnosis and widening | `e171aa9`, `f299ff6` | fallback reason logged (code only). On the five documents grid-first answered 4 of 35 concept questions: coinsurance rows (5/5) and doc 02 ER/maternity are NEEDS VERIFICATION by extraction safety rules (whose share a % is; uncertain care rules) — **not widened**; tier columns of one plan (docs 03, 04) need the user's tier — **not widened** (review B3 of the grid work); unattributed values of a single-plan document now join its plan (`ownerOf`, widened, safe); values with no known owner in a multi-plan table fall back (S3); line fragments now fail the verbatim gate (decision 1) |
| 2 Relevance | `e171aa9`, `02e8fd5`, `5341f2f` | `answer-relevance.test.ts`: a verified answer must contain every non-generic 4+-letter word of the question (topic words may be answered by their vocabulary); else "cannot be confirmed" |
| 2 General rules for common causes | `fa2958d` | `answer-rate-rules.test.ts`, `definition-is-any.test.ts`, `filename-header.test.ts`: figure sentence checked against the line holding its figures; identical sentence/line is figure-bound; "<term> is any / is defined as / refers to" is a definition line (five-document diff: one doc 04 value withheld, nothing else); one-document answer's file-name header line stripped |

Verification tightened along the way (independent review, five rounds,
final verdict APPROVE at `f04aa73`): one-line coverage keeps word order
(pre-existing inversion hole); `$` and `%` are part of a figure
(pre-existing); the unordered whole-quote coverage path is removed (a
sentence over several lines verifies only as verbatim wording across line
breaks). Recorded, not changed (reviewer: not misleading): the answer may put
a full stop between a line and its continuation ("… are covered. If
admitted."); a qualifier line that continues the row above does not block the
next sentence. Dropped: a rule for one-line sentences containing ";" (a
two-column line has no general sentence end).

**Test changes (review/owner-directed, listed for owner review):**
`semantic-first.test.ts` (1b) fixture is now an on-topic page (relevance
rule); its assertions unchanged and lexical-empty now asserted.
`grid-first.test.ts` "B1: a rephrase that reverses or drops a condition": the
kept-condition rephrase is in source order; a reordered rephrase is asserted
to fall back to the exact wording (word-order rule). Own new assertions
corrected during the work: `answer-relevance` (passages may contain the
off-topic line; the answer text may not), `review-third-round` (a figure-led
whole sentence is fail-closed, not asserted to verify).

### Benchmark — 8 questions × 5 documents (Nemotron, Cloudflare embeddings)

Semantic retrieval confirmed: the `semantic` leg on every model-path question
(not one lexical fallback); 0 CHAT_FAILED. Per-question table outside git.

| Run | Verified | Correct | Wrong / misleading | Cannot be confirmed (answerable) | False "not in documents" |
| --- | --- | --- | --- | --- | --- |
| `dd1be6b` (previous) | 21 | 22/40 | 1 | 14 | 0 |
| `e171aa9` (decision 1 + diagnostics) | 19 | 23/40 | 2 (doc 02 pre-existing: a line starting mid-sentence; doc 04 pre-existing: a definition) | 15 | 0 |
| `f04aa73` (final) | 17 | **21/40** | **0** (2 flagged: doc 03 maximum and ER copay are verbatim four-tier rows without tier labels — nothing false, not counted correct) | 17 | **0** |

Final-run causes of the 17 "cannot be confirmed" on answerable facts:
verbatim sentence across lines rejected by the span rules 8 (2 of them start
after a "LABEL:" prefix on the same line); answer without its column label
(off-topic) 3; wrapped table label with a capitalised second line 2; model
paraphrase 1; two-column line 1; age-band row with a figure-led next line
(fragment rule) 1; bad citation reference 1.

**GO/NO-GO for Phase 5: NO-GO** — 0 wrong ✓, 0 false absence ✓, correct
21/40 < 30 ✗.

Gates at `f04aa73`: `tsc` clean; `npm test` 2,101 passed / 22 skipped / 0
failed; real-PDF 2,223 passed / 1 failed (documented missing-brochure gap) /
42 skipped; `npm run build` 0; `test:e2e` 57 passed / 1 skipped (local
Supabase `supabase-int`, port 3344); private-data guard ok on every commit.

## Owner decisions 2026-11-22 (4) — citation completion — implemented

| Item | Commits | Evidence |
| --- | --- | --- |
| Server-side citation completion | `4ccd625`, review fixes `ad24293` | `app/lib/evidence/citation-unit.ts`; `citation-completion.test.ts` (logged shapes, red before). Each model-referenced citation is expanded before verification and shown as completed: prose → whole lines of its sentence (continuation rules; a same-line topic "LABEL:" prefix included); table row → its label, cells, column headings, section heading and header line as further verbatim citations (each unique on its page; a repeating cell is cited by its unique row line, else omitted). Never across a sentence end; a line ending in a value is not joined to a next line stating its own amount |
| Verification against the unit | `4ccd625`, `ad24293` | a span may start after a same-line topic label; never after a scope label (plan, option, rider, tier, class, group, age, network/provider, limitation/exclusion list, single-letter or numbered name) — and a one-line answer that leaves such a label out is rejected (pre-existing hole); markers and figure binding are checked on the sentence span; an initialism ("U.S.") does not end an answer sentence; geographic topic vocabulary adds "region" |
| Grid-first tier rows | `4ccd625`, `ad24293` | `grid-tier-rows.test.ts`: one plan's tiers shown when every value is a table cell whose claim names its tier as a whole word (column heading cited); table-cell claims gated structurally (describeFact), line values by verifyAnswerClaims; a row with an empty cell gives no tier answer (pinned) |

Independent review of the completion range: first round request changes
(B1 scope labels dropped; S1 repeating cells; S2 pin; two nits) — fixed in
`ad24293`. Second round: S1, S2 and nits confirmed; **BLOCKING, open,
owner decision needed** (pre-existing, not introduced by completion):

- **B1′** one-line coverage lets an answer skip non-marker words, so a
  scope named any way other than the listed words is dropped ("Under the
  Gold plan maternity is covered." → "Maternity is covered.";
  "Gold:"/"Employee:" labels; "… for employees" dropped).
- **B4** a table-row line lets an answer drop a column's value and so its
  plan ("Ambulance $0 Up to $500" → "Ambulance Up to $500").

Strict fix prepared but **not applied** (patch in the private archive,
`option-whole-clause.patch`): a sentence covered by one line states that
clause's every word (articles, list marker, ALL-CAPS topic heading aside).
It changes 27 existing accepted assertions (figure-binding suites: one
labelled value from a multi-value line; reordered forms) — an
authoritative-behaviour change, so stopped for the owner. Replayed on the
run-9 answers it rejects 3 of 18 verified model answers (doc 01 deductible,
doc 01 and doc 05 pre-existing; all correct today) → 26/40.

### Benchmark at `ad24293` (run 9; same 40 questions, semantic leg on every model-path question, 0 CHAT_FAILED)

| Doc | Verified | Correct | Wrong / misleading | Not correct (unlabelled tiers) | Cannot be confirmed (answerable) |
| --- | --- | --- | --- | --- | --- |
| 01 | 5 | 6 (5 + space refusal) | 0 | 0 | 2 |
| 02 | 6 | 7 | 0 | 0 | 1 |
| 03 | 6 | 6 | 0 | 1 (overall maximum, model path) | 1 |
| 04 | 3 | 5 (incl. maternity NOT STATED, space) | 0 | 0 | 3 |
| 05 | 4 | 5 | 0 | 0 | 3 |
| Total | 24 | **29/40** | **0** | 1 | 10 |

False "not in your documents": 0. Remaining causes (10): answer without its
column label (off-topic) 3; wrapped table label with a capitalised second
line 2; figure row omitted from a wrapped sentence 1 (correct rejection);
paraphrase 1; definition list 1; two-column line 1; bad reference 1.

**GO/NO-GO: NO-GO** — 29/40 < 30, and the independent review has an open
BLOCKING (B1′/B4) awaiting the owner's decision.

Gates at `ad24293`: `tsc` clean; `npm test` 2,126 passed / 22 skipped / 0
failed; real-PDF 2,248 passed / 1 failed (documented missing-brochure gap) /
42 skipped; build 0; `test:e2e` 57 passed / 1 skipped; guard ok. Local
Supabase stack stopped after the run.

## Owner decisions 2026-11-22 (5) and (6) — implemented

| Decision | Commits | Evidence |
| --- | --- | --- |
| (5) 1 One-line coverage by whole segments (closes B1′/B4) | `1a9652c`, review fixes `02d276b`, `1bc4e2e` | `segment-coverage.test.ts`: a sentence covered by one line omits only articles, a list marker, an allow-listed ALL-CAPS topic heading that the sentence repeats, and whole sibling label+value segments; a value inherits a label only with its own unit words; a shared header stays; word forms exact or plural. Scope labels (plan, tier, rider, group, age, network, limitation; ALL-CAPS plan names) are never dropped on either path |
| (5) 2 Server-rendered table answers | `6c0811b`, review fixes `02d276b`, `1bc4e2e` | `table-rendered-answer.test.ts`: a model citation on a detected table row → the server writes "label — SECTION (column header): cell" for each cell plus governing footnotes (exact marker); every piece cited verbatim and unique, else cannot be confirmed; prose cited with a row (anything but an allow-listed ALL-CAPS heading) → cannot be confirmed; model wording never used for table values |
| (6) Watermark artifacts at extraction | `ab93907`, review fixes `5454ea2`, `929c0d7` | `watermark-removal.test.ts`; `app/lib/pdf/watermarks.ts`: an item that is, in full, a named overlay phrase (sample, specimen, draft, for inquiry purposes only, not for distribution, confidential), drawn rotated or ≥ 2× the page's median size, on ≥ 60% (≥ 3) pages, is removed before page text is joined (spans stay consistent); table cells and page-1 title lines protected; counts only recorded/logged. **Narrower than "detect any repeated text"** — the reviewer showed repetition/geometry alone removes negations, Yes/No cells, conditions and column headings |
| (6) Third replay loss | `58dad12` | general fragment-rule bug, fixed: the rules now check page lines that are occurrences of the cited line itself (whole-line equality unless the quote edge is mid-line, at a word boundary; not placed once → fail-closed). **Rule change to note:** a copy of the same line elsewhere on the page no longer blocks an answer from the complete cited line |

Changed assertions (owner-directed, rule 1): figure-label-binding "$300
specialist." → "Copays: $300 specialist." (header required);
verifier-alignment bare "$1,000,000." → rejected. Own controls from these
rounds updated when the reviewer tightened them (heading must be repeated).

Replay of run 9's 18 verified model answers through rule 1: 3 lost — two
from the glued "SAMPLE" watermark (fixed by (6)), one from the fragment-rule
occurrence bug (fixed by `58dad12`).

Five-document extraction diff (watermark removal): docs 02–04 byte-identical;
docs 01/05 lose 68/78 overlay items; facts 1,232 → 1,231 (watermark text gone
from displays; one doc 01 p19 mid-sentence fragment value no longer
extracted — root cause not isolated within the time box; no fact lost).

Independent review: rule 1/2 — three rounds to APPROVE (`1bc4e2e`);
watermark/fragment — three rounds to APPROVE (`929c0d7`).

### Benchmark at `929c0d7` (run 13)

| Doc | Verified (all correct) | Correct | Wrong | Cannot be confirmed (answerable) |
| --- | --- | --- | --- | --- |
| 01 | 5 | 6 | 0 | 2 |
| 02 | 6 | 7 | 0 | 1 |
| 03 | 6 | 6 | 0 | 1 |
| 04 | 3 | 5 | 0 | 3 |
| 05 | 3 | 5 | 0 | 4 |
| Total | 23 | **29/40** | **0** | 11 |

False "not in your documents": 0. Gained vs run 9: doc 03 maximum (tier
names), doc 04 ER (both plans), doc 01 pre-existing (watermark). Lost:
doc 05 pre-existing (model wrote a different, non-verbatim sentence), doc 04
out-of-network coinsurance and doc 05 ER (table rendering uncitable).
Causes of the 11: table row uncitable 6 (5 = a repeated cell/label/header
whose row line also repeats → no unique citation; 1 undetermined); wrapped
table label 1; model omitted the row's figures 1; definition list 1;
age-band maximum without label (off-topic) 1; non-verbatim sentence 1.

**GO/NO-GO: NO-GO** — 0 wrong ✓, 0 false absence ✓, 29/40 < 30.

Gates at `929c0d7`: `tsc` clean; `npm test` 2,201 passed / 22 skipped / 0
failed; real-PDF 2,323 passed / 1 failed (documented missing-brochure gap) /
42 skipped; build 0; `test:e2e` 57 passed / 1 skipped; guard ok. Local
Supabase stack stopped; Docker Desktop stopped.

## Owner decision 2026-11-22 (7) — table-row span citation — implemented

Resumed at `f0349ae` (decision (6) found already implemented and reviewed; no
rework). Guardrails as given: one contiguous verbatim span on one page, the
row label through its last cell, never across rows; if not unique, it must
include its section heading; still not unique → cannot be confirmed; the
server-rendered answer is unchanged; regression-first with a duplicate row
under two sections.

| Item | Commits | Evidence |
| --- | --- | --- |
| Row span as a fallback citation | `ca46603`, review fixes `d223128` | `app/lib/evidence/citation-unit.ts` `rowSpanCitation`; `table-row-span-citation.test.ts` (14; 4 red before `ca46603`, 5 more red before `d223128`). Used only when a label, cell or section is not fully citable on its own; pieces citable today are unchanged. Only whitespace may lie between the row's own pieces (and its own section heading when the span starts there) — no other row, section heading, column header or footnote. A piece with no page spans is never covered. The section span is possible only for the first row under a heading (a later row would cross a row) → otherwise cannot be confirmed |
| Uniqueness as the verifier judges it | `d223128` | `isUniqueOnPage` (`evidence-verification.ts`, same normalisation as `verifyEvidenceCitation`'s exact rule), used by the span and by single-piece citations (`textsOf`); can only remove a citation that would later fail verification |
| Duplicate row under two sections | `ca46603` | each section's row renders and cites only its own section; the bare repeated row line selects no row; end to end, an out-of-network claim cited by the ambiguous line is refused |

Independent review (read-only, the agent that did not write the code): round
1 REQUEST CHANGES — B1 (the span could enclose another section's heading or a
footnote → value seen under the wrong section), S1 (a cell with no spans
covered by a span not containing it), S2 (raw vs normalised uniqueness), S3
(partly citable pieces); all fixed in `d223128` with the reviewer's probes as
regressions. Round 2 **APPROVE**. Open nits (recorded, not fixed): N-a a
section span after the row's last cell would be cut off (detector-error case;
nothing misattributed); N-b pre-existing — a column heading or footnote with
some spans uncited still passes (the "fewer cites than spans" rule could
apply there too). Expected limitation (N3): a repeated row that is not the
first under its heading is always "cannot be confirmed".

Replay of run 13's five table-uncitable answers through the new code (no
model calls): 3 render with all citations unique (doc 01 coinsurance, doc 04
maximum, doc 05 coinsurance); doc 05 ER stays uncitable (a repeated column
heading — outside this decision); doc 04 coinsurance not replayable from the
stored log.

### Benchmark at `d223128` (run 14; same 40 questions, same model and 2.1 s throttle; 39 model calls, 118 embedding calls, 0 CHAT_FAILED)

| Doc | Correct | Wrong | Flagged (not counted) | Cannot be confirmed (answerable) |
| --- | --- | --- | --- | --- |
| 01 | 7 | 0 | 0 | 1 |
| 02 | 7 | 0 | 0 | 1 |
| 03 | 6 | 0 | 0 | 1 |
| 04 | 5 | 0 | 0 | 3 |
| 05 | 5 | 0 | 1 | 2 |
| Total | **30/40** | **0** | 1 | 8 |

False "not in your documents": 0. Gained vs run 13: doc 01 out-of-network
coinsurance and doc 04 annual maximum (both via the row span). Lost: doc 04
geographic restrictions (the model wrote a different sentence; rejected by
the figure-sentence rule — run-to-run model variance, not this change).

**Flagged, owner ruling needed — doc 05 out-of-network coinsurance.** The
figures and column are correct, but the table detector assigned the row
above (the deductible label and its options) to this row's *section
heading*; the section span therefore cites that text and the rendered label
repeats it before each coinsurance line. Nothing stated is false; it is not
counted correct (same convention as run 13's unlabelled tier rows). If the
owner rules it misleading, the run has 1 wrong → NO-GO. Root cause is
section assignment in `layout-tables.ts`, not the span rule (the span holds
only the row's own pieces as detected). Not fixed: the stopping rule forbids
further verifier/citation changes this round.

Pre-existing, unchanged answers (doc 03 deductible and ER copay) render the
table's general note and header line as extra lines; counted as in run 13.

**GO/NO-GO:** bar met on count — 30/40 ≥ 30 ✓, 0 wrong ✓, 0 false absence ✓
— at the minimum, with ±1 model variance seen between runs and the doc 05
ruling open. Stopping rule ("still under 30") not triggered, so the
second-model run was not made.

Gates at `d223128`: `tsc` clean; `npm test` 2,215 passed / 22 skipped / 0
failed; real-PDF 2,337 passed / 1 failed (documented missing-brochure gap) /
42 skipped; build 0; `test:e2e` 57 passed / 1 skipped (local Supabase
`supabase-int`, port 3344); private-data guard ok on every commit. Local
Supabase stack stopped; Docker Desktop stopped. Nothing pushed.

## Run 14 re-score and blind independent review (owner request 2026-11-23)

**Correction.** The run-14 table above mis-tallied two rows: doc 03 summed to 7
(the geographic answer was neither counted nor listed; it is INCOMPLETE — a
true restriction, not the key's essentials) and doc 05 counted 5 correct where
only 4 are (deductible, area, space tourism, maternity). Corrected implementer
score: **29/40 correct**, 0 wrong, 1 incomplete, 1 flagged, 9 cannot be
confirmed, 0 false absence. The 30/40 and "bar met" claims above are
withdrawn. Run 13's table has the same doc 05 over-count (row sums to 9), so
its 29/40 is also suspect; not re-scored here.

**Blind review.** An independent reviewer scored all 40 answers from a packet
holding only the question, the key and the shown answer/refusal. Not reading
anything else was an instruction, not enforced by a sandbox. Implementer scores
were written to the session scratchpad at 13:38:26, before the review (13:39:02),
and copied unchanged to the archive after it (13:39:30).

**Correction 2026-11-24.** An earlier version of this section said the scores
were already in the archive before the review returned, and called the key "the
owner's key"; the reviewer was told the same. The key is the one rebuilt from
the documents on 2026-11-22 after the original was lost (its own note), before
run 1 was recorded. The reviewer is independent of the scores, not of the key.

| | Correct | Wrong | Incomplete | Flagged | Cannot be confirmed | False absence |
| --- | --- | --- | --- | --- | --- | --- |
| Implementer | 29 | 0 | 1 | 1 | 9 | 0 |
| Blind reviewer | 24 | 0 | 2 | 5 | 9 | 0 |

Agreement: wrong (0), false absence (0), the 9 cannot-be-confirmed items, all
6 not-stated refusals, doc 03 geographic INCOMPLETE, doc 05 out-of-network
coinsurance FLAGGED (reviewer: mislabelled, not misleading on the figure).

Disagreements (5), all implementer CORRECT vs reviewer:
- doc 01 pre-existing → INCOMPLETE (key also names acute-onset rules).
- doc 03 deductible, ER copay, maternity → FLAGGED (stray table header row and
  repeated general note between tier lines; "garbled, not misleading"). The
  doc 03 ER $100 tier figure was checked against the page: correct.
- doc 04 deductible → FLAGGED (schedule intro paragraph and plan taglines
  between the two plan rows).

**Agreed score 24/40 → NO-GO** (bar 30). Even resolving every disagreement and
the doc 05 flag in the app's favour gives 30, exactly at the bar. The dominant
loss is 9 answerable questions refused as "cannot be confirmed"; the second is
table-answer noise (header/note lines rendered as rows), which the reviewer
flags on 4 answers. Stopping rule: the trigger ("under 30/40 with 0 wrong")
is met on the corrected score; the second-model run awaits owner go-ahead
(provider calls).

Archive (private, outside git): `questions.json` (exact 8 wordings, sha256
`abf09a117c1e25f6…`, and all 40 document/question pairs, sha256
`154790b6f134a5ef…`; identical in runs 1, 7, 9, 13, 14),
`blind/run14-packet.json`, `blind/run14-score-implementer.json`,
`blind/run14-review.json`, `blind/run14-compare.json`.

## Next atomic step

Owner decision: (a) run the same 40 questions once on the second, stronger
model per decision (7)'s stopping rule, and/or (b) rule on the five scoring
disagreements and on whether table-answer noise lines count against an
answer. No further verifier/citation changes this round.

## Generalization to unseen documents (owner task 2026-11-25, branch `gen/unseen-docs`)

Branch from `9126b22` (the exception rule there is committed but not approved
by its reviewer; that work stays paused). Dev set: three SBCs and one student
plan. Held-out set: two SBCs, scored only by a separate agent; the implementer
reads none of their text. Regression set: the five benchmark documents.
Baselines and scorecards are private (outside git).

**Fix 1 — SBC plan identity.** `app/lib/extraction/sbc.ts` reads the federal
header block; the plan is the name printed on the "Coverage for:" line, or the
only other line of the block. Abstains on wrapped, generic, sample or competing
names and on a second SBC in the file. Dev: 3 of 3 SBC names verified (was 0).
Regression set: 0 differences. Unit suite 2,511 passed / 22 skipped (real-PDF
suites SKIPPED without `REAL_PDFS_DIR`), types and build clean.
