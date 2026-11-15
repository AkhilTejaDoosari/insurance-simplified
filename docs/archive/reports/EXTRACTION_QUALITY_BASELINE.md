# Extraction Quality Baseline — Deterministic Engine (2026-11-12)

Recorded at `9d6acbf` (feat/p2-document-generalization), deterministic fallback
engine only. No LLM, network, DB, or storage path was exercised.

## Command

```bash
REAL_PDFS_DIR=<folder with FEP / FEMA / health-guide PDFs> npm run eval:extraction
# optional: -- --out <path.json>   (default test-results/extraction-scorecard.json, gitignored)
```

- `scripts/p2-experiment/scorecard.ts` extends the existing P2 harness. It reuses
  `runBaselineFunnel` (a mirror of the production `/api/extract` funnel),
  `valuesOverlappingSpan` / `adjudicateBaseline`, and the 62 brochure spans in
  `ground-truth.ts`.
- `scripts/p2-experiment/ground-truth-real.ts` adds: document role and plan
  identity labels for all six documents; 9 value-level gold targets (figure,
  concept rows, required enrollment/network qualifiers, source pages); and
  5 noise spans.
- If `REAL_PDFS_DIR` is unset, FEP, FEMA and the health guide are reported as
  `SKIPPED`. The three brochures under `nonstandard/` still run.
- The output is deterministic. Two consecutive runs produced identical JSON,
  apart from the timestamp and timing fields.
- Cross-check: the brochure numbers match `run-p2-eval.ts baseline` exactly
  (22/53 display, 1/8 withhold + 1/1 optional, 3 unsupported attributions).

Sessions: the three brochures are extracted together, as in the existing harness.
FEP, FEMA and the health guide are each extracted alone (the P1 one-PDF path).

## Scorecard

| Measure | Result | Kind |
|---|---|---|
| Document role (proxy: plan doc ⇔ ≥1 verified plan) | 6/6 | measured, weak proxy |
| Plan identity (exact attested names) | 6/6 | measured |
| Concept recall — brochure display spans | 22/53 (41.5%); 22/41 in-inventory | measured recall |
| Concept recall — value targets | 6/9; **critical 2/5** | measured recall |
| Value correct — value targets | 5/9 (5/6 when concept found) | measured |
| Value correct — brochure spans with figures | 10/10 | measured (small n) |
| Qualifiers complete (structured) — value targets | **0/9** | measured |
| Qualifiers complete — brochure spans | — | NOT CALCULABLE: `applicability` is free text |
| Precision — corpus-wide | — | NOT CALCULABLE: emitted values are not exhaustively labeled |
| Precision — FEP `annual-deductible` row (exhaustive gold) | **0/1** | measured, row-scoped |
| Precision — FEP `out-of-pocket-maximum` row (exhaustive gold) | **2/17 (11.8%)** | measured, row-scoped |
| Withhold/optional spans handled | 2/9 | measured |
| Noise targets suppressed | 3/5 | measured |
| TOC / definition heuristic flags | FEP 93 / 4; IMG 14 / 25; health 0 / 6 | heuristic lower bound, not labels |
| Citations mechanically verified | 2,395/2,395 | measured (mechanical only) |
| Citations semantically tie figure + qualifiers (targets) | 5/6 | measured |
| Cross-document plan attributions | 0 | measured, exhaustive |
| Withhold spans attributed to a plan | 3 (gt-118, gt-217, gt-319) | measured |
| Plan-value targets correctly attributed | **0/6** (6 abstain, 0 wrong) | measured |

Emitted volume per document: FEP 1,536 values (188 duplicated across rows; 3
attributed); IMG 585; StudentSecure 112; Seven Corners 48; FEMA 7; health guide 107.

### FEP gold targets (manually verifiable)

| Target | Source (PDF page) | Result |
|---|---|---|
| Deductible, **Self Only = $1,000** | p17, p36 (also Section 5 headers) | **missed**: no value anywhere |
| Deductible, **Self Plus One / Self and Family = $2,000** | p17, p36 | **wrong row**: `age-limits` and `eligibility-for-you` |
| Preferred OOP max, **Self Only = $11,000** | p17, p31, p135 | found; enrollment/network appear only in display text (qualifiers `{}`); abstained |
| Preferred OOP max, **Self Plus One / Self and Family = $22,000** | p17, p31, p135 | found as the fragment "and Family contracts…$22,000". "Self Plus One" is lost, and the citation does not tie the figure to the categories; abstained |
| Maternity Preferred-facility copay $3,000 | p17 | found; no structured qualifier |
| Precertification penalty $500 | p31 | right row, **wrong value**: display rewritten without $500 |

## Three highest-impact measured failures

1. **Core cost-share facts are missed or put in the wrong row.** Critical
   target recall is 2/5, and brochure display recall is 41.5%.
   - FEP's $1,000 deductible never matches the `annual-deductible` pattern.
     The source says "calendar year deductible is now $1,000" and "deductibles:".
   - The $2,000 line lands in `age-limits` because `age \d+` matches inside
     "p**age 27**".
   - The $500 precert value loses its figure.
   - The FEMA program-limit table is missed entirely.
   - 31 of 53 brochure display spans are missed or wrong-row; 12 of those
     concepts are outside the 43-fact inventory.
2. **Enrollment and network scope is separated from the figure.**
   Structured qualifiers are complete for 0/9 targets. Line-scoped matching
   cuts FEP enrollment categories away from their amounts: the $22,000 value
   loses "Self Plus One", and "typically" drops off FEMA's waiting period.
   The enrollment-scope gate therefore abstains on every FEP plan value (0/6
   attributed). That is safe, but the user gets no plan-attributed
   deductible or out-of-pocket maximum.
3. **Keyword-per-line matching emits noise as facts.**
   - FEP emits 1,536 values. Row-scoped precision is 0/1 for the deductible
     row and 2/17 for the out-of-pocket row.
   - The table-of-contents entry on p4 is emitted under both
     `out-of-pocket-maximum` and `coinsurance`.
   - The health guide's glossary definition of "Deductible" is emitted as
     `annual-deductible`.
   - 7 of 9 withhold/optional brochure spans are mishandled, and 3 are
     attributed to a plan.
   - Every citation passes mechanical verification (2,395/2,395), so citation
     verification does not catch semantic noise.

## Limits of this baseline

- The role metric is a proxy: the engine emits no document role, so
  "program brochure" and "educational guide" cannot be told apart.
- The value targets are a small, manually chosen set (n=9). They are not a
  corpus recall estimate.
- Row-scoped precision is reported only where the gold set is exhaustive (the
  FEP deductible and out-of-pocket rows).
- The FEP source internally pairs "$1,000 per person" with Self Plus One (p29,
  p116) and "$2,000 per Self Plus One enrollment" (p17, p36). The targets use
  the per-enrollment statement.
