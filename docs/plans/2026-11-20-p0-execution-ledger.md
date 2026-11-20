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
| 4 Chatbot correction | 8–10 | Authorized 2026-11-20; local Ollama model for development ($0); see "Phase 4" |
| 5 Real-document acceptance | 11 | Not started — the five files are confirmed (doc 02 replaced, doc 03 confirmed) |

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

## Next atomic step

Phase 4 independent review (read-only), fixes test-first, screenshots of the
chat panel, then the owner report. Phase 5 (real-document acceptance) only
after owner authorization.
