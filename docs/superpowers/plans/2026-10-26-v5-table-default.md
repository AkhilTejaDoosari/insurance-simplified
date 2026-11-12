# V5 Table-Default Comparison Implementation Plan

> **For agentic workers:** Execute natively in this session; no subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved V5 side-by-side table the sole comparison visualization while preserving the existing one-policy reading, verified selection, evidence, chat, and export behavior.

**Architecture:** Keep the work in the existing presentation model and React results components. Remove chart, timeline, and duplicate comparison-matrix blocks; retain evidence-driven fact grouping and the existing selected-plan/tier state and server authorization paths.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Playwright; no new dependencies.

**Spec:** Owner-approved task in this conversation; `AGENTS.md`; `docs/design/IMPLEMENTATION-CONTRACT.md`; `docs/design/insurance_simplified_v5_page2.html`; `docs/design/insurance_simplified_page2_dual_experience_updated.html`.

## Global Constraints

- Page 1 is locked; do not change it.
- Preserve existing adaptive, evidence-driven fact selection; do not rebuild extraction, attribution, citation verification, or security.
- Comparison uses two or three selected, verified plans; one-policy mode remains a document-specific reading, not a comparison table.
- Preserve drag, keyboard reorder, A–Z reset, hide/restore/replace, plan/tier selection, and matching order in table, contacts, chat, and export.
- Never show unassigned evidence as a verified plan benefit; keep missing, excluded, and unverified-applicability states distinct.
- No new dependencies, providers, migrations, infrastructure, subagents, commits, pushes, or deployments; preserve all existing uncommitted work.
- Stop after checks and a real comparison screenshot for owner visual approval.

## Review Focus

- A verified fact with unknown or conflicting applicability must remain visible with its state in the table, without a duplicate “Questions still open” fact list.
- A document-only fact must not enter a plan cell or comparison summary as a confirmed benefit; its source remains expandable and verifiable.
- A one-policy reading must remain usable when no plan attribution is verified; no comparison table or empty comparison section is forced into that mode.
- Hiding and restoring a plan must preserve other plan order and tier selections; replacing a selected plan must keep the comparison at no more than three plans.
- A changed plan/tier/order selection must reach chat and export consistently; no stale response or export may silently reuse the prior selection.

---

### Task 1: Make the presentation model table-only and compact

**Files:**
- Modify: `app/lib/presentation/adaptive.ts`
- Modify: `app/components/AdaptiveResults.tsx`
- Modify: `app/lib/report/pdf.ts`
- Test: `tests/unit/adaptive-presentation.test.ts`
- Test: `tests/unit/adaptive-renderer.test.tsx`

**Interfaces:**
- Consumes: validated `RegisteredComparisonTable`, active `ActiveView`, and existing verified plan/tier selection.
- Produces: existing `PresentationSpec` with findings, document-specific groups, one `comparison-table` in compare mode, evidence disclosure, context questions, and contacts; no chart, timeline, or second comparison-matrix block.

- [ ] Add regressions that compare-mode specs contain no `bar-chart`, `timeline`, `coverage-matrix`, or `proportion-chart`, and that an uncertain fact is not duplicated in a second unresolved-fact block.
- [ ] Run `npx vitest run tests/unit/adaptive-presentation.test.ts tests/unit/adaptive-renderer.test.tsx` and confirm the new assertions fail against the current output.
- [ ] Remove chart/timeline/matrix generation and rendering; keep the single dynamic table as the only comparison visualization. Keep compact unresolved-question output only for actual context questions or a genuinely empty result. In understand mode, show unassigned document facts once in the readable groups with their explicit applicability warning; in compare mode, retain them only in expandable document-evidence disclosure.
- [ ] Update report rendering only as required by the presentation-block type change; do not alter export authorization or selection snapshot semantics.
- [ ] Run the focused unit tests and verify existing evidence IDs, citations, unknown states, and adaptive group selection remain covered.

### Task 2: Pin comparison controls and visual acceptance

**Files:**
- Modify: `tests/e2e/v5-frontend.spec.ts`
- Modify only if required by a failing acceptance test: `app/page.tsx`, `app/components/PolicyViewControls.tsx`, or `app/components/AdaptiveResults.tsx`

**Interfaces:**
- Consumes: existing results workspace, verified plan picker, tier selector, `selectionPayload`, and protected export route.
- Produces: browser proof for one/two/three displayed-plan states, one-policy document switching, hide/restore/replace, drag and keyboard order, A–Z reset, scoped chat/export, and a final desktop comparison screenshot.

- [ ] Add Playwright assertions for the one-policy selector switching among uploaded PDFs without re-upload; compare mode with two and three verified plan columns; and no chart, timeline, or second comparison table.
- [ ] Add Playwright assertions for hide/restore/replace, column drag, keyboard reorder, A–Z reset, and order consistency in the table and contacts.
- [ ] Assert the active selected plan/tier/order snapshot is the same in chat and export; retain the existing session authorization and evidence-link behavior.
- [ ] Run the focused V5 Playwright spec and capture a real synthetic-fixture desktop comparison screenshot without changing Page 1 or using real customer documents.

### Task 3: Phase verification

**Files:**
- No additional files unless a focused check exposes a scoped defect.

- [ ] Run focused unit tests, relevant Playwright tests, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [ ] Inspect the exact changed-file list and diff; confirm no extraction, attribution, authorization, citation, Page 1, dependency, migration, or infrastructure change.
- [ ] Report test results, screenshot path, pre-existing work preserved, architecture diff, remaining blockers, and stop for owner visual approval.
