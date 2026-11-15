# Experience — dynamic dashboard, comparison, grounded chat, design system

Status: Authoritative · Consolidated 2026-11-15 from `V1_1_REVIEW_PACKAGE`
(sections D–K, Q), `USER_FLOWS`, `UI-IMPLEMENTATION-CONTRACT`, `DESIGN.md`
and the 2026-11-15 feasibility review §4 (all in `docs/archive/`).
Product-level requirements and their IDs live in `product.md`; this document
defines how the surfaces behave.

## 1. Dashboard model (target, roadmap M8)

The dashboard is **schema-driven**: the server builds a view model from
verified provisions; the frontend renders whatever the view model contains and
never knows concept names.

1. **Concept registry (versioned data, JSON in the repo):** id, label,
   category (cost · coverage · exclusion · eligibility · administrative),
   provision kind, aliases per document family, priority per user context,
   families expected to state it. Every result records the registry version.
   Unknown concepts get a provisional id and stay **discovered, unverified**.
2. **View model:** containers → rows → cells. Each cell: value, scope key,
   conclusion, evidence ids, conditions.
3. **Renderers by provision kind, not by concept:** money with network tiers ·
   percentage · limit · yes/no with conditions · verbatim text · eligibility
   checklist. No JSON-Schema form libraries. TanStack Table only if grouping
   and faceting outgrow hand-written sorting (requires approval as a dependency).

Today the rows come from the fixed 48-fact list (`extraction/fact-list.ts`)
projected by `presentation/adaptive.ts` and `extraction/workspace-groups.ts`.
That is adaptive presentation over a fixed vocabulary; replacing it is M8.

**Row budget:** default to the context's priority set (≈12–20 rows); collapse
the rest into categories with counts; in compare mode show differing rows
first; never create a row for a concept found in no plan. Visibility classes
CORE / COMPARATIVE / HIGHLIGHT apply (D-023, A-042–A-045).

**Cell display contract**

| Conclusion | Display |
| --- | --- |
| Verified | Value + citation chip opening the PDF at the highlighted span |
| Conditional | Value + condition badge; condition text on expand |
| Exclusion applies | Warning with both quotes |
| Undetermined | "Cannot be confirmed" + reason |
| Not found in read pages | Grey, with "expected in this document type?" hint |
| Discovered, unverified | Separate collapsed "Mentioned but not verified" section, never mixed with verified rows |
| Conflict | Both values with sources |

Unassigned document evidence never appears as a confirmed value in a plan
column; safety-relevant unassigned facts go to a separately labelled
"needs verification" area with citations.

## 2. Comparison

- One shared factor column; one column per selected plan view (max three
  visible); sticky factor column and readable headers with accessible
  horizontal scroll.
- Cells are keyed by full scope (plan, tier, network, period, cost-share
  role). Incompatible scopes are shown side by side with a scope label, never
  ranked as better/worse.
- Equivalent concepts align across insurers without erasing qualifiers or
  insurer terminology; distinct benefits with similar names are not merged;
  different currencies, frequencies or reimbursement bases are not presented as
  directly comparable.
- Columns are reorderable (drag + keyboard left/right + A–Z reset); order
  applies to overview, table, contacts and export, and never changes plan
  identity, selection or tier.

**Tier selection.** Every plan with validated tiers has its own selector
(All tiers / one tier; names only from evidence). Selections are independent
per plan, persist across containers, and update — as one effective selection —
the overview, findings, key costs, table, evidence, chat scope and export. A
specific tier shows its facts plus verified shared facts; unknown tier values
stay unknown. All-tiers never merges incompatible values or claims a value
applies to every tier without evidence. Stale responses never overwrite a newer
selection.

**Two reading modes on one upload** (approved V5 design): *Understand one
policy* (selector over every uploaded PDF; switching changes the whole reading,
evidence and chat scope without re-upload and without assigning an unproven
plan id) and *Compare policies* (shortlist of up to three proven plans). Each
mode keeps its own selection. An About panel explains purpose, modes and limits.

## 3. Grounded chat (target, roadmap M9)

Current: semantic retrieval scoped to the session → cosine usefulness floor
0.43 → generation → every quote verified on its page, or explicit refusal
(`app/lib/rag/answer.ts`). Provider outage is a retryable error (A-026).

Target rules:
- Answers about coverage, costs and eligibility read the **verified grid
  first** (provisions + issued resolutions, including every applicable
  exclusion); retrieval only adds supporting text.
- Chat uses the active plan/tier scope, keeps document-wide facts, never mixes
  other tiers' values, and widens scope only when asked and unambiguous.
- Comparison questions are answered from the grid with scope labels.
- Never infer facts from illustration content; never paraphrase conditions or
  exclusions freely. Plain-language explanation, if added, is a separate,
  labelled layer generated from verified fields with a fixed template per
  concept.
- Retrieval changes follow `quality.md` §4 (RET-1, FILT-1); D-013 stands until
  then.

Chat is closed by default; opens as a right panel (~75 % results / 25 % chat on
wide desktop), a drawer on narrow screens.

## 4. Export

One immutable snapshot of the current selection through the protected export
pipeline, loaded from `comparison_results` (D-025) — never recomputed, never a
second AI interpretation. Order: overview → upsides/conflicts/unknowns → key
costs → selected plans and tiers → detailed comparison → evidence and
verification questions. Keep citations and conditions next to facts; keep tier
attribution in All-tiers mode; no repeated values, redundant contacts or empty
trailing pages.

## 5. Design system ("Adaptive Medical Minimal")

Quiet, evidence-first reading; restrained brand red, blue interactive controls;
the original PDF page one click away. Visual source of truth for Page 2:
`docs/design/insurance_simplified_page2_dual_experience_updated.html`
(offline prototype — its sample data is not real). The master logo
(`public/insurance-simplified-logo.png`) is never modified; the icon is a
derived crop.

- **Tokens** live in `app/globals.css`. Light: background #F7F8FA, surface
  #FFFFFF, ink #171B24, line #E1E5EB, interactive #315EDB, brand red #CF3043.
  Dark (`prefers-color-scheme`): background #111318, surface #1D2028, ink
  #F7F8FA, line #373D48, interactive #98AFFF, brand red #ED4658. `--ok-*`
  supported positives, `--warn-*` potential conflicts, `--bad-*` exclusions and
  errors, `--none-*` unknown / not stated. Status text is mandatory; color is
  never the only signal.
- **Type:** Instrument Sans with system fallbacks; root 15px/1.5; headings
  1.75 / 1.2 / 1 / 0.9 rem; tabular numerals for values; sentence-case labels.
- **Layout:** 4px rhythm (8–28px steps); content max 1440px; 24px gutter;
  results grid + chat rail, one column under 900px; tables own horizontal
  scroll.
- **Components:** `.card`, `.panel`, `.btn`, `.input`/`.select` (inline
  `role="alert"` errors), `.comparison`/`.table`, `.verdict` badge (verdicts
  never replace source links).
- **Motion:** 120ms hover; respect reduced motion; loading, retryable error and
  unknown insurance states are visually distinct.
- **Accessibility:** keyboard-reachable controls, labelled tier selectors, live
  status, visible focus, sufficient contrast in both themes, drag-and-drop
  alternatives; evidence links name fact, source and page.
- **Copy:** plain, calm, specific; no promotional AI phrasing, fabricated
  certainty or repeated "verified" badges.
- **Accepted debt:** horizontal table scroll and document-centred columns
  until the M8 workspace lands.

UI changes end with desktop and mobile screenshots, light and dark, for owner
visual approval before being called complete.
