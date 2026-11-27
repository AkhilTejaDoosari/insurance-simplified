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
