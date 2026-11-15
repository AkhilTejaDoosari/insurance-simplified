# Engineering State (living document)

Single active engineering record. Historical reports in `docs/` are references,
not competing plans. Update at each checkpoint.

Last update: 2026-11-14 (session checkpoint after 6 cycles) · branch
`feat/p2-document-generalization` · base `f538a96` · **all work uncommitted**.
The previous blocked C6/evidence-binding WIP (incl. untracked files) is preserved
as commit `refs/wip/c6-snapshot-2026-11-14` (not on any branch).

## Product goal (unchanged)

Upload 1–5 insurance PDFs → evidence-cited understanding/comparison. Every
material verified claim must be the plan's, with its tier/network/condition
scope, traceable to page + source text. Unknown/ambiguous → withheld.

## Architecture decision (2026-11-14): structure first, lines never inferred

| Layer | Module | Rule |
|---|---|---|
| Layout | `app/lib/pdf/layout-tables.ts` | Positioned pdf.js items (same join as page text — byte-identical on 15/15 corpus PDFs) → header-anchored tables with exact page-text spans. Fail-closed geometry: distinct headings; bounded last column (unmodeled column ⇒ row withheld); row whose values start after column 1 withheld; unplaceable cell ⇒ neighbour rows withheld; ≥60% value-bearing cells; labels need words. |
| Table claims | `app/lib/extraction/table-facts.ts` | Fact from the LABEL head; scope from the HEADING (`planTier`/`networkTier`/`conditions`); display `Label (Heading): cell` verbatim; evidence = row span + header span; `anchor {page,table,row,column,label}`. |
| Statement claims | `app/lib/extraction/statement-facts.ts` | Closed grammar: `For <declared enrollment categories> contracts, the/your [network] <deductible|out-of-pocket maximum> is [now] <$amount> [(see page N)].` — whole sentence or no claim; `anchor {page,start,end}`. |
| Anchor verification | `claim-anchors.ts` | Re-derive the claim from the session document; exact match of display, scope, label, evidence — or the value is dropped. |
| Boundary | `app/lib/extraction/verify-table.ts` | ONE verification pipeline used by `/api/extract` and the eval harness. |
| Stage E | `plan-identity.ts resolveRowPlanIds` | Structural claims: ownership (single verified plan) + anchor + abstention-language + rival-plan + other-declaration guards + pairwise contradiction with unstructured readings. Line values: ONLY the labelled plan/fact/value record (C6). No inferred ownership, no mention inference. |
| Displays | `extract.ts` | Unstructured line values display their cited text verbatim; summarizers only affect verdicts. |
| Sessions | `app/lib/session-store.ts` | tmpdir session = cache. Miss ⇒ rebuild from Postgres (sessions/documents/pages) + object bytes (tables recomputed, attached only if text identical) + comparison result (evidence registry). Only after capability verification. |

Replaced/removed: the WIP lexical evidence binder (`evidence-binding.ts` + its
unit tests) — structure was already lost in the text it parsed. Kept from the
WIP: `noise-shapes.ts` TOC/glossary display filter and its adversarial
route/mention tests (assertions updated to the new attribution policy).

## Measurements (deterministic engine; identical inputs; full corpus present)

| Measure | Baseline (WIP on f538a96) | Now |
|---|---|---|
| Verified-plan claims, adjudicated (`claim-labels.ts`) | 40: ~10 correct / ~30 incorrect | **175: 171 correct / 4 concept-adjacent / 0 incorrect / 0 unlabelled** |
| FEP plan-value targets attributed with full scope | 0/6 | **4/6** (deductible ×2, OOP ×2) |
| Value targets, value correct | 5/9 (scorecard at f538a96) / 7/9 (WIP) | 8/9 (8/8 where concept found) |
| Structured qualifiers complete (targets) | 0/9 | 4/9 |
| Non-verbatim line displays | 111 | **0** |
| Brochure concept recall (53 spans) | 22/53 | 26/53 |
| Withhold spans attributed | 1 | 0 |
| Cross-document attributions | 0 | 0 |
| Citations mechanically verified | all | all |
| Unit tests | 1184 pass | 1224 pass, 8 skipped (binder unit tests removed with module) |
| Browser e2e | 54 pass | **55 pass** (+ real-PDF journey: upload → verified tier claim → original page 4, unique highlight) |
| Upload extraction latency (FEP 140 pp) | 498 ms | 409 ms |

Precision thresholds are NOT yet set: labels cover only claims the engine
emits on 6 documents (3 tuned + FEP/FEMA/health). Recall is not exhaustively
labelled. Do not quote a production-quality percentage from these numbers.

Held-out layout audit (never tuned): FEMA, ISO Med, Patriot travel tables read
correctly; SBC (Limitations column), FEP section-5 tables, GMI, health-guide
prose yield no table (withheld, not misread).

## Known gaps (priority order)

1. **Recall on unseen structures**: SBC 4-column format, FEMA-style
   transposed tables (concept in heading, scope in row), FEP Section 5
   "Benefit Description | You Pay" tables, FEP p31-style prose
   ("…is $11,000 when you use Preferred providers").
2. **LLM extraction path unevaluated** (paid calls need owner approval). It
   still rewrites model displays through the care/rules/coinsurance
   interpreters; structural anchors from the LLM are dropped unless they
   re-derive exactly.
3. **Presentation**: multi-amount cells show "Your purchased option is
   unknown" for network-conditional pairs (selectionStatus heuristic);
   concept grouping: "Therapeutic Termination of Pregnancy" under Maternity.
4. **Live durability** is unit-tested with mocks; the live Supabase
   integration suite was not run (no credentials used this session).
5. Owner-approved doc updates needed: `ARCHITECTURE.md` (layout/statement
   claims, read-through session cache), `DATA_MODEL.md` (`CellValue.anchor`,
   `SessionDocument.tables`), `DECISIONS.md` (line-inference removal).

## Independent review — REQUIRED BEFORE ANY COMMIT

NOT PERFORMED. OpenCode is installed but calls an external LLM provider
(possible cost) and must not edit this tree concurrently: owner approval
required. Reviewer brief:

- Objective: no incorrect verified claims; structure-bound scope; fail closed.
- Diff: `git diff` + untracked files listed by `git status` (exclude the
  course ZIP).
- Reproduce: `npx vitest run`; `REAL_PDFS_DIR=~/Documents/insurance-simplified-preserved npm run eval:extraction`;
  `npx playwright test`; `npm run build`.
- Attack: forged/LLM-supplied anchors; tables with merged/empty/unmodeled
  columns; headers repeated per page; statements with trailing conditions,
  abbreviations, negation; session rehydration with tampered page text or
  foreign-scoped documents; viewer route without capability.

## Review-blocker recovery (2026-11-14, second session)

Independent review: BLOCK. Six-cycle tree preserved at
`refs/wip/six-cycle-snapshot-2026-11-14`. Four blockers closed, uncommitted:

1. **Viewer authorization leak** (`app/view/.../page.tsx`): a cache hit was
   returned before any capability check (filename, page count, cited passage,
   document links). Now every session read in the page and its metadata goes
   through `authorizedViewerSession` (capability verified for THIS session
   first, cache hit or durable restore alike); unauthorized ≡ unknown session.
   Tests: `viewer-authorization.test.ts` (7), PDF-bytes cases in
   `citation-route.test.ts` (3), browser `viewer-authorization.spec.ts`.
2. **Structural qualifiers erased downstream**: one contract,
   `scopedQualifiers()` (qualifier-evidence.ts), used by extraction,
   presentation (`indexFacts`), overview, ConditionalValue, PDF report and the
   enrollment gate. Anchored claims keep planTier/networkTier/conditions only
   when literally stated in their own display; derived qualifiers and
   unstructured values keep the lexical rule. Unchanged real-PDF FEP test
   passes. Also: `conditionBindingKnown` judges a table claim by its cell
   text (label amounts are conditions), removing false cross-document
   NEEDS VERIFICATION.
3. **Incomplete table provisions**: rotated text (watermarks) excluded from
   layout geometry; bullet/lowercase/"(" label paragraphs continue across
   paragraph spacing; completeness guard withholds a row when a dropped line
   sits in its extent, a continuation line directly below it cannot be read,
   or a continuation-shaped orphan block follows it. Independent raw-line
   audit (`completeness-audit.ts`): 0 attributed rows missing source text.
4. **Contextual prose safety**: statement claims require clean context —
   6-line lookback (crossing to the previous page) without example /
   illustration / hypothetical / not-this-plan framing, and no modifying next
   sentence. Part of anchor re-verification.

| Measure (identical inputs, 6 docs) | Six-cycle tree | Now |
|---|---|---|
| Attributed values | 175 | 193 (kept 163, lost 12, new 30) |
| Complete & correct (vs full source provision) | 159 | 189 |
| Missing material qualifier | 12 (IMG urgent care, walk-in, reunion, interfacility) | 0 |
| Concept-adjacent / wrong concept / incorrect | 4 / 0 / 0 | 4 / 0 / 0 |
| Presentation: verified-plan / needs-verification | 91 / 84 | 134 / 59 |
| FEP targets attributed with full scope | 4/6 | 4/6 |
| Unit / browser tests | 1224 / 55 | 1266 / 56 (57 was a miscount) |

Lost 12 = the four truncated IMG provisions (superseded by complete
versions). New 30 = those 12 complete + 18 recovered complete IMG rows
(Room & Board, ICU, Bedside Visit, Political Evacuation, Repatriation for
Medical Treatment), each checked against the full source lines.

Remaining: row verdicts are shared across documents (an unstructured line in
one PDF can mark another PDF's claims needs-verification — conservative, not
over-claiming); multi-amount cells with "otherwise" conditions stay
needs-verification; correct rows withheld by the completeness guard (e.g.
IMG Teladoc/Hospital Emergency Room, Seven Corners Incidental Trips/Acute
Onset/Dental Sudden Relief, WorldTrips Personal Liability); FEP maternity
copay and precert penalty unattributed; the real-PDF ellipsis test needs
`patriot-exchange-brochure.pdf` and `OPTima_26_27_A.pdf`, absent from the
preserved corpus (FAILS as misconfigured — not a pass).

## Governing-context recovery (2026-11-14, third session)

Independent review: BLOCK (hypothetical prose verified; table claims verified
without governing footnotes). Recovery tree preserved at
`refs/wip/recovery-snapshot-2026-11-14`. Two cycles, uncommitted.

1. **Prose governing context** (`statement-facts.ts`): the fixed 6-line window
   is replaced by source structure. Region = the statement's section (back to
   the nearest numbered major heading, across pages, or document start).
   Governing = non-bullet lines, the statement's own line/bullet, ":" lead-ins;
   sibling bullets never govern; quoted text is a mention. Framing (example,
   hypothetical, illustration, sample, scenario, not-this/another plan) governs
   until "End of example" or the section ends. Dangling conditions before,
   modifiers after, dangling sibling-bullet conditions, and — when only
   headers/footers follow on the page — the next page's first sentence all
   withhold. Case-insensitive. 31 new tests; the old heuristic fails 17.
2. **Governing table notes** (`layout-tables.ts`, new `table-notes.ts`,
   `table-facts.ts`): the layout records footnote blocks (geometric extent,
   must read identically in stream order, must end a sentence), each row's
   section-heading run, a preamble above the header (table-wide when it says
   "shown below", otherwise the heading of rows before the first in-body
   section), an unmarked general restriction note below tables on the page,
   and spans of unread text. A claim's display is the cell followed by every
   governing note verbatim, each cited; otherwise it is withheld. Markers
   resolve to exactly one complete footnote on the page; exceptions must name
   a governed row exactly (exempt row keeps the note, which states the
   exemption); continued tables whose governing section is on the previous
   page are withheld; an independent raw-text marker audit withholds a table
   with an unaccounted marker. Bulleted provisions elsewhere in the document
   that name a row's benefit exactly ("• Interfacility Ambulance Transfer: No
   coverage if Pre-certification requirements are not met.") are carried and
   cited on their page. Fix: italic (skewed, horizontal-baseline) text was
   wrongly dropped from layout geometry with rotated watermarks.

Evaluation contract: `claim-inventory.ts` (actual emissions of a tree, full
six-document corpus required, exit 2 otherwise) → `claim-diff.ts` (two
inventories; superseded ≠ lost+new; presentation states; label tallies) →
`provision-score.ts` against hand-written `gold-provisions.ts` (concept,
value, scope, restrictions, polarity, evidence, presentation).

| Measure (6 docs) | Six-cycle | Recovery | Now |
|---|---|---|---|
| Verified-plan claims | 175 | 193 | 193 |
| Labelled correct / missing-qualifier / concept-adjacent | 58 / 115 / 2 | 58 / 133 / 2 | 189 / 0 / 4 |
| Gold (22): fully correct / correct-not-presented / incomplete / missing | 3 / 2 / 15 / 2 | 3 / 2 / 15 / 2 | 15 / 5 / 0 / 2 |
| Presentation verified / both / needs-verification | 87 / 8 / 80 | 129 / 10 / 54 | 129 / 10 / 54 |

Recovery → now: 0 lost, 0 new, 141 superseded (same cell, notes added), 52
unchanged. Open owner adjudication: IMG p3 "All other Treatments & supplies:
50% reduction … if Pre-certification requirements are not met" (83 IMG claims
flagged `pending`); the brochure does not say which services need
pre-certification. Missing gold facts: FEP maternity facility copay, IMG
pre-certification penalty as its own fact. Correct but needs-verification:
FEP deductible statements ×2, Seven Corners hospital ×2, IMG urgent care.
Document-level disclaimers (e.g. Seven Corners "brief summary … plan document
will prevail") are not attached to row claims. FEP Section 2 says it "is not
an official statement of benefits"; its statements are kept (section titled
"Changes to our FEPBlue Focus") — owner decision recorded here.

## Next

1. Owner: approve (or run) the independent review; then local checkpoint commit.
2. SBC table model (unmodeled-column notes appended to cells instead of withholding).
3. FEP Section 5 tables and p31 prose form; label FEP claims exhaustively for
   one section to set a real precision/recall threshold.
4. LLM path evaluation with an approved budget.
