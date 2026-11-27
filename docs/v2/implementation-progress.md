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
