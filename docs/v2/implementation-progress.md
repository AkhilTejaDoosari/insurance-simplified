# V2 implementation progress — extraction accuracy workstream

Concise running record. One entry per session; newest first. Benchmark numbers come only
from `engine/evaluation/score_keys.py` (frozen, sha256 `f338608f…cce4f37c`) on the private
keys; nothing here is a held-out result.

## Workstream order (owner, 2026-11-27)
1. Reuse the existing reader outputs for the 37 validation PDFs (no re-extraction).
2. Fix known verifier deficiencies.
3. Measure each fix against the answer keys (critical recall up, false verified stays 0).
4. Attribute what is still missed: reading gap vs verifier rule vs semantic gap.
5. Add Nemotron (text) and Claude (page image) recovery one step at a time, only for the
   classes step 4 shows a model can fix; model output is a candidate, the verifier decides.
6. External repos (RAGFlow, Docling, LlamaIndex, OpenContracts, Haystack, SureEV) only as
   targeted source reads for a named unresolved problem.

## Baseline (R6, 2026-11-27, keys v1.1 draft, 17 validation SBCs)
Critical recall 348/454 · false verified 0 · oracle union of readers 437/454 · restrictions
attached 0/141. So: 89 keys are a verifier gap (a reader read them), 17 are a reading gap.

## Session 2026-11-27 (f) — WP5 started: the app calls the engine

Owner: Nemotron free tier measured unusable (in ~2 h: 15 calls, 12 timeouts at 547 s,
1 output cut off, 2 ok); "make it exist first"; go-ahead for WP5.

**Done:** engine `POST /v1/extract` (service token; PDF body ≤ 25 MB; OpenDataLoader +
pdfplumber in the sandbox; no cloud model; nothing stored) returns contract facts plus
the exact printed words and column of each, and open items ("check page N").
Couldn't-confirm facts now carry their evidence span (no value: nothing interpreted);
each printed cell has its own fact id (columns had collided). Web adapter
`app/lib/engine/client.ts`, used by `/api/extract` when `ENGINE_URL` and
`ENGINE_SERVICE_TOKEN` are set; only two-key facts map to SUPPORTED, everything else
to NEEDS VERIFICATION (`not_covered` too, pending an owner decision); the existing
verification/seal/render gates still run on the result.

**Verified:** engine pytest 198 passed / 1 skipped, ruff, mypy; contract regenerated;
web 1,466 passed / 22 skipped (DB suites SKIPPED: no database here), tsc, build. Real
SBCs through the HTTP route: 6 pages in 7 s, 97/97 facts with exact quotes; 64/64 on a
second. **Not done:** jobs table + worker, PDF bytes from durable storage (extract
reads the local copy, so it works in one local process, not across serverless
instances), browser e2e, the judge run (until then every fact shows "needs
verification" with its printed quote and page).

**Then — WP11 step 1 (owner: "start the UI"):** the locked palette as the app's tokens,
light only (`color-scheme: only light`; dark-mode CSS and the theme toggle removed), the
red/blue/green header stripe, the cobalt-underlined marker in the PDF viewer. Finding:
the locked pair signal #CF3043 on #FDE9EB is 4.34:1, below the AA the same doc requires;
"not covered" text uses #B42536 (5.53:1) pending owner confirmation. Two e2e tests that
required a dark page now assert the light-only rule (D-038). e2e on the two touched
specs: 2 passed, 4 failed — the same 4 fail on the commit before (pre-existing: mocked
upload/compare flows). Web unit 1,466 passed / 22 skipped, tsc, build. Screenshots
(desktop, phone) sent to the owner. Fonts and the results layout not started.

**Then — results screen V2 (owner: "this is not our design"):** the V1 render gates drop
every engine fact (they only accept V1 claim proofs), so engine results now reach the
browser beside the table: the route registers each printed quote as session evidence
and returns `engine.documents`; `ResultsV2` renders them (sidebar, ≤5 columns, groups,
badges, printed words, page links into the existing viewer, counts, confirmed gauge,
open lines, contacts). **Evidence fix:** the shown quote for a multi-line cell took in
the neighbouring column's words (page-text span); it is now only the words inside the
cell (`box_text`), or the clause's verified text. Not built: match % (needs WP9), the
importance filter (needs WP7), cross-document label matching (WP7: rows group only on
identical printed label + column), reload keeps only the V1 view (engine facts are not
persisted yet). Engine 199 passed; web 1,469 passed / 22 skipped; build; e2e unchanged.

## Session 2026-11-27 (e) — first real model run, interrupted; runner made faster

Owner's first run on the Mac: setup, probes (NVIDIA and Claude through KodeKey, PDF input
accepted) and the local stage passed (395/454, 0 false verified, $0). The Nemotron text stage
ran one document at a time with no terminal output, about 12 min per document (5/17 after an
hour), and was stopped for travel. Finished replies are in the model cache; nothing charged.

**Added:** per-call progress lines (stage, provider, page numbers, status, seconds, tokens,
cost; never document text), shown in the terminal and the stage log; `--jobs` (script
default `EVAL_JOBS=4`) to run documents concurrently, since model stages wait on the
provider. **Verified here:** `--jobs 1` and `--jobs 4` give identical reports on the 17 SBCs
(395/0) apart from timings; the spend ledger never exceeds its cap under 8 concurrent
reservers. pytest 186 passed, 1 skipped. **Not yet measured:** any model stage result.

**Then (owner: "hard way", KodeKey meters tokens):** a Claude token allowance
(`ENGINE_EVAL_CLAUDE_TOKEN_CAP`, cumulative file-locked ledger, reserve worst case per
attempt, settle to reported usage; Nemotron not metered; Claude stages refuse to run
without it). Script order: local → Nemotron **and** the Claude judge on the local facts
at the same time → Claude page-image pilot on 3 documents → projection of the rest from
measured tokens (stops if it does not fit) → visual → judged. Judge batches put
reader-found facts first, so the final stage reuses the earlier judge replies (test fails
without it). Script control flow dry-run with a stand-in `uv` (no cap / fits / does not
fit). Local baseline unchanged (395/0). pytest 195 passed, 1 skipped.

## Session 2026-11-27 (d) — model and judge measurement, prepared

Owner approved the push (branch only) and real model + judge measurements on the
existing artifacts, $25 cumulative cap. This workspace has no provider keys and no
route to build.nvidia.com, so the run is the owner's: `engine/scripts/run_model_eval_mac.sh`.

**Added:** `evaluation/eval_env.py` (finds the configuration in existing env files;
refuses non-NVIDIA gateways for Nemotron and other models; never prints a value; the
privacy declarations must be given); Claude probe through the Models API (no tokens);
a Nemotron judge for facts Claude proposed (the same-family rule otherwise blocks them);
presentable-fact correctness metrics; `evaluation/compare_runs.py` (before/after table,
exit 1 on any false verified fact). The script pins the 17 public validation SHA-256s,
checks the reader cache fingerprint, requires the baseline (395/0) before any paid call,
and checks the remaining ledger before every stage.

**Verified here:** `--local-only` end to end (baseline 395/454, 0 false verified, 1,144
couldn't confirm, cache byte-identical after a rebuild from the corpus's Docling output);
missing configuration and a failing probe both stop before any stage. pytest 175 passed.

## Session 2026-11-27 (c) — remediation part 2: prose, key 2, visual, governing context

Owner (2026-11-27): part 1 accepted subject to code review; R6 kept. Priorities: prose
clauses, key 2, visual review states, targeted model recovery on existing artifacts,
governing context via the existing RAG approach, incremental measurement.

**Done** (all on `integration/recovery-r7`, local commits)
- **P0-01 prose clauses** (`recovery/clauses.py`): own representation and verifier.
  Failure-driven: 55 of 80 SBC "Important Questions" answers were missed because
  "Answers" sits in a dark header band with no rule under it. Ruled Q&A: whole anchor
  cell → whole adjacent cell, single value cell per row (benefit rows stay table facts),
  column only when printed on the header row; unruled: heading line → whole block.
  Reader table cells never verify as prose on unruled pages.
- **Key 2** (`recovery/semantic.py`): code reading from printed words (kind, number,
  basis, tier, level, negation, conditions; compound cells per qualifier) + a judge of
  another family that can only confirm/reject fields; strict batch parsing; the judge
  alone never confirms. `presentable_as_verified` = key 1 + key 2 + no open conditions.
- **P0-03 scanned pages** (`recovery/visual.py`): visual proposals → `review_required`
  items with page/model/prompt/image-hash provenance; never verified.
- **Model recovery prep**: proposals v2 with prose clauses; opt-in routing of pages
  with unproposed printed amounts; `evaluation/build_reader_cache.py` (existing
  artifacts, byte-identical cache); run script replays `READERS_DIR`; `--judge`.
- **P1-01 governing context** (`recovery/governing.py`): mirrors web RAG chunk/BM25/RRF
  (k=60), structural second leg, no embeddings; in-document references located,
  external ones labelled, exclusion matches go to the judge only (measured over-flagging).
- **Contract output** (`recovery/present.py`): engine facts → `schemas.facts.Fact`;
  the contract validators enforce both keys.

**Measured** (17 validation SBCs, keys v1.1 DRAFT, local stages, no model calls):

| Metric | Part 1 | Now |
|---|---|---|
| Correct keys (table + clause) / false verified | 348 / 0 | **395 / 0** |
| Clause facts: correct / false / unkeyed | — | 47 / 0 / 22 |
| Of the 30 previously unflagged missed keys | — | 12 recovered |
| Verified facts passing the code reading (key 2, layer 1) | — | 1,041 / 1,153 |
| Facts presentable / contract VERIFIED | 0 | 0 (judge not run) |
| Open conditions: governing unverified / xref unresolved / external | 293 / 192 / — | 293 / 94 / 86 |

**Checks:** ruff, format, mypy strict, pytest 168 passed / 1 skipped, licenses ok.
`docker build engine` SKIPPED (no Docker in the build workspace).

**Blocked on the owner:** model measurements (no provider keys here): run
`run_recovery_eval.sh` with `READERS_DIR` (cache from `build_reader_cache`); judge
runs show how many facts become presentable. Student/travel keys still missing (P1-02):
the unruled prose path is tested only on synthetic pages.

## Session 2026-11-27 (b) — independent review remediation, part 1

Review (2026-11-27): architecture approved, production integration not approved; P0-01…05,
P1-01…02 required. Branch `integration/recovery-r7` (base `afa56c5`).

**Done**
- **Consolidated** R7 patch + recovery-engine patch (only overlap: this doc's round 4).
- **R7 measured** on rebuilt reader outputs (Docling from the private-corpus cache,
  OpenDataLoader + pdfplumber run locally; no re-extraction of Docling). R6 reproduced:
  348/454, 0 false verified. R7 348/0, R7b 348/0, R8 170/**36 false verified** - all
  rejected under the pre-set rule; verifier stays R6. Details: `parser-evaluation.md` 4a.
- **P0-05 budget**: CLI cap reaches `RunLimits`; pre-call worst-case reservation against
  the document cap and a cumulative file-locked spend ledger ($25 default); retries and
  post-billing rejections charged; uncapped paid calls refused; no uncapped run in
  `run_recovery_eval.sh`.
- **P0-04 open conditions**: `VerifiedFact.open_conditions` + `semantic_confirmed`
  (key 2, unset); `presentable_as_verified` is false for every fact today.
  "Why This Matters" is governing text; group-label footnote markers linked.
- **P0-02 coverage**: every printed amount is verified / rejected / conflicting /
  not_extracted / unresolved, independent of parsers; `not_stated` only on proven absence.

**Measured** (17 validation SBCs, keys v1.1 DRAFT, local stages only, no model calls):

| Metric | Value |
|---|---|
| Correct keyed facts / false verified (keyed) | 348 / 0 |
| Verified facts with no key (correctness not measured) | 1,145 |
| Restricted correct keys (92): attached+matching / flagged open / attached, not matching key text / silent | 61 / 16 / 13 / 2 (was silent 28) |
| Facts presentable as fully verified | 0 (key 2 not built) |
| Printed amount-lines: verified / rejected / not_extracted / conflicting / unresolved | 731 / 337 / 86 / 8 / 6 |
| Missed keys on a flagged line | 76 / 106 (30 unflagged: mostly text answers without an amount) |

"0 false verified" covers keyed facts only; the 1,145 unkeyed verified facts are not shown
to be correct.

**Checks:** ruff, ruff format, mypy strict, pytest 126 passed / 1 skipped.

**Open (next session, in review order):** P0-01 prose-clause evidence path (also covers
the 30 unflagged text answers); P0-03 visual proposals with visual provenance, kept
review-required; then targeted Nemotron/Claude runs under the ledger; P1-01 governing
context via existing RAG; P1-02 student/travel fixtures. Key-side review: 2 restriction
cells are annotations ("Nested table inside the Answers cell").

## Session 2026-11-27 (a)

**Done**
- `evaluation/attribute_misses.py`: puts every missed key into one class
  (`no_reader_bound`, `verified_not_fact`, or the blocking verifier reason). Separate
  module, so the frozen scorer is untouched. Test: `tests/test_attribute_misses.py`.
- **R7** (`app/reconcile/verify.py::_leads_header_cell`): R6 rejected a header element
  shorter than 60 % of its printed cell. That also rejected the common case of a reader
  keeping only the first line of a two-line header ("Network Provider" of "Network
  Provider (You will pay the least)"). R7 accepts the short element only when it opens a
  ruled cell that holds no amount and is the topmost cell of its column strip; the fact's
  header is still the full printed cell. A word opening a data cell stays rejected.
  Tests: two new cases in `tests/test_reconcile.py`, both fail on the R6 code and pass now.

**Checks:** ruff, mypy strict, pytest 78 passed (75 before).

**Decision:** R7 stays on its branch until scored on the keys. Adopt only if false
verified stays 0 and critical recall rises; otherwise revert and record the result.

**Blocker:** this session could not read `insurance-corpus-private` (access to the repo
was refused), so R7 is not measured yet and nothing was pushed.

**Next task:** run `attribute_misses` and `score_keys` at R6 and at R7 on the stored reader
outputs; record both rows in `parser-evaluation.md` round 4; then fix the largest
remaining verifier class (expected candidates: `verified_not_fact` from the R3
row/column agreement rule, `cell_continues_on_next_page` from R4).
