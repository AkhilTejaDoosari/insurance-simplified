# Insurance Simplified — Approved V5 UI Implementation Contract

**Status:** Design approved by product owner; engineering implementation **not yet authorized by this document alone**.

**Visual source:** `docs/design/insurance_simplified_page2_dual_experience_updated.html` for Page 2; approved V4/V5 Page 1 remains locked (the owner's approved local copy). The HTML is an **offline visual/interaction prototype**, not insurance processing code. Resolve any differences with the owner before deviating from the approved design. Do not treat its example policies, chat messages, contacts, or sample numbers as factual data.

## 1. Scope and non-goals

Adapt the approved **V4 Page 1** and **V5 Page 2** experience into the **existing Next.js + TypeScript** app, reusing current upload, extraction, evidence viewer, chat, sessions, and PDF export. Make **minimal UI and presentation-layer changes**. No backend rebuild, new AI providers, migrations, infrastructure, added dependencies, or unrelated architecture changes. Preserve current uncommitted work; no resets, rebases, commits, pushes, or deployment without separate approval.

**Page 1 is visually locked.** Preserve its original shield logo (no white rectangle or pasted-on square), approved red/blue/green/neutral identity, balanced use of color, rounded corners, typography, spacing, and responsive flow. The only approved copy refinement is a natural-language headline: **“Understand what your insurance actually covers.”** Verify this phrasing with the owner before any other wording change. Do not add a sidebar or extra onboarding pages.

## 2. Page 1 — single start experience

- Present personal context and the two routes in one responsive screen: **I have documents** and **I don't have documents**.
- Keep the intake fields that the real eligibility logic requires; do not silently omit country/residency, age, location, coverage dates, or visa/status where relevant. Progressive disclosure is acceptable if accessible and visible before analysis.
- Documents route: drag/drop or choose **1–5 PDFs**, show filenames and removal/replacement, safely reject a sixth, and preserve the existing session/capability security behavior.
- No-documents route: provide specific requirements guidance and decision questions; do **not** manufacture insurance products, rankings, pricing, or eligibility.
- The logo navigates to the start without silently losing a still-valid session. Preserve existing light/dark theme, keyboard access, and mobile layout.

## 3. Page 2 — two distinct reading modes, one upload session

**New locked interaction:** The mode toggle offers **Understand one policy** and **Compare policies**. Upload up to five documents once. In Understand mode a labeled document selector lists every currently uploaded eligible PDF; choosing any one immediately switches the entire individual reading, evidence context and chat scope without re-uploading. This does not implicitly assign an unverified planId to that document. Compare mode permits a selected shortlist of up to three proven plans, draggable and keyboard reorderable. Keep each mode’s independent selection when switching back and forth, and preserve the same valid session and context. An individual report export reflects the active document, while comparison export reflects selected plans, tiers and order; reuse the existing authorized export mechanism and report BLOCKED rather than claiming a mode-specific export if unsupported.

**About view:** Include a compact, accessible About panel reachable from Page 2, explaining what the application does, the two modes, its limits and why uncertain facts require verification. The About panel is informational and must not change selections or processing. It is not a new onboarding flow.

## 3A. Page 2 — locked results composition

The **results/report is the primary surface**. No dashboard sidebar, separate Documents/Evidence/Chat pages, or unnecessary route changes.

1. **Summary first:** up to **three meaningful evidence-grounded findings** ordered by user impact (eligibility, costs, material exclusions/risks). Missing information remains explicit and must not be mistaken for a denial.
2. **One document or comparison:** the layout adapts to the actual eligible uploaded source(s), with **up to three selected plans side by side**. The prototype's 1/2/3 buttons are a demonstration; real selectors must honor uploaded documents, verified plan identities, source/tier scope, and existing maximum-three comparison rules. A PDF is not always the same as a plan; a single PDF may contain multiple plans/tiers.
3. **Dynamic table:** render real extracted field categories, with up to three verified plan columns, source links, qualifiers, exclusions, and expandable details. Don't hard-code the mockup rows or pretend every PDF exposes the same fields. Keep the established five-section organization where it helps customers, while making reading continuous and uncluttered.
4. **Reordering:** draggable columns; accessible left/right buttons for keyboard users; **A–Z reset**. The same order applies to summary where relevant, table, contacts, and PDF export. Reordering never changes underlying plan identity, selection, or tier.
5. **Chat on demand:** initially closed. A visible button opens a right-hand panel, approximately **75% results / 25% chat on sufficiently wide desktop screens**. Closing it restores full table width. On narrow screens use a usable drawer/overlay, not a squeezed quarter-width column. Preserve selected-plan/tier scope, citation links, stale-response cancellation, and capability-gated sessions. Chat must not infer facts from illustration content.
6. **Contacts at bottom:** aligned with currently displayed plan order; show phone, website, claims/support only when genuinely extracted and source-backed. Otherwise show a helpful **“Contact information not verified”** state; never invent numbers/links.
7. **Export Report:** an explicit PDF **download** action using the existing protected export pipeline and **one immutable snapshot** of the current selected plans, tier choices, and column order. No new independent extraction. The reference HTML's export button is a placeholder, not the implementation.
8. **Evidence access:** source citations open the correct original uploaded PDF and page. Preserve accessible focus and clear back/close behaviors.

## 4. Non-negotiable evidence and insurance safeguards

- Preserve **C6** fail-closed plan/value attribution, citation verification, document identity proofs, tier/option qualifiers, session ownership, and export capabilities.
- **Known V1.1 defect to correct in the presentation layer:** the overview excludes unassigned values while the comparison sometimes places those same values in document-associated plan columns. **Unassigned evidence must NOT appear as a confirmed benefit/cost in a plan-specific column.** Surface safety-important unassigned facts in a separately identified **document evidence / applicability needs verification** area, retaining citations; do not silently drop material exclusions or risks.
- Distinguish **NOT STATED**, **NOT COVERED**, **UNVERIFIED APPLICABILITY**, and **CONFLICTING EVIDENCE**.
- Available deductibles, limits, and tier choices are not automatically purchased/selected values. Never strip the age, network, residency, date, or plan-tier conditions from a claim.
- Do not solve comparison sparsity by assigning all facts from a brochure to its title or by weakening the proof contract. Local real-brochure review remains limited; **160/160 emitted citation checks do not prove semantic accuracy**, and plan association was sparse. Never label the prototype production/customer-validated.
- External transmission of the two previously locally authorized brochures is **not** approved; do not enable external LLM, telemetry, storage, or database processing for those documents without separate approval.

## 5. Design fidelity and behavior

- **Only the approved V5 HTML** governs visual structure, the original logo treatment, palette, radii, interaction feel, responsive behaviors, and overall density. Adapt CSS responsibly to existing components; don't copy mock sample records into production.
- Prioritize whitespace that improves scanning, not oversized empty hero panels. Use the available desktop width. Small screens must permit safe table horizontal scrolling or another equivalent legible presentation.
- Focus styles, labels, contrast, tab order, drag-and-drop alternatives, screen-reader names, error states, and reduced-motion support are required.
- Copy should be plain, calm, specific, and human—not promotional AI clichés, fabricated certainty, or repeated “verified” badges.

## 6. Implementation approach

1. **Preserve current state:** inspect branch/worktree, preserve uncommitted changes, confirm recoverable backup is durable (the previous backup was in a temporary `/private/var/.../T/` location). Never overwrite the backup or store credentials/documents in it.
2. **Map current components to screens**; list files to adjust and the existing service paths to reuse. Do not create another broad architecture roadmap.
3. Implement **Page 1 fidelity** with only the approved copy correction and functional wiring; verify visually and avoid changing its locked composition.
4. Implement **Page 2** summary/table reorder/conditional chat/contacts/export and the unassigned-fact presentation correction, in minimal components.
5. Use real existing data structures and permissions. Treat the HTML's fake records, exported PDF notice, and demo chatbot responses as demonstration-only.
6. Validate desktop/mobile, light/dark, one/two/three-plan presentation, upload limit, reorder/reset, chat show/hide, source viewer, session retention, and PDF export. Run focused tests, relevant Playwright, TypeScript, build, and diff checks; don't claim unrun tests passed.
7. Capture **before/after screenshots** and compare against HTML at desktop and mobile sizes. Present the running experience for **human visual approval** before declaring design implementation complete.

## 7. Acceptance checklist

- [ ] Page 1 matches approved design; wording changed only as agreed.
- [ ] Both intake paths work, without extra pages or fabricated product recommendations.
- [ ] 1–5 uploaded PDFs handled safely; sixth rejected; valid session preserved.
- [ ] Summary shows at most three relevant, evidence-grounded insights.
- [ ] Understand mode offers any uploaded document by selector, switches the entire single-document reading/evidence/chat scope, and does not re-upload or assign unsupported planId.
- [ ] Compare mode handles up to three selected verified plans, retains reorder independently, and switching modes retains the session.
- [ ] About information is reachable and dismissible without changing selections.
- [ ] 1–3 plan comparisons are dynamic and accurately scoped; single-document view works.
- [ ] Column drag/reorder, keyboard controls, A–Z reset, and export order agree.
- [ ] Chat is closed by default, opens on request, uses ~75/25 split on wide desktop, and remains usable on mobile.
- [ ] Plan contacts are source-backed, shown at bottom, and follow display order.
- [ ] Export Report downloads a real PDF using current snapshot and access control.
- [ ] Overview/table/chat/export never portray unassigned document facts as verified plan facts.
- [ ] Citations navigate to original pages; important unassigned risks remain discoverable.
- [ ] Existing C6/verification/security contracts and architecture are unchanged.
- [ ] Tests, build, accessibility checks, and desktop/mobile visual comparison are reported truthfully.
- [ ] Owner visually signs off; customer/production release remains unapproved.

## 8. Agent completion report

Provide: exact files changed, before/after screenshots, working local URL, functional demo steps, test commands/results, regressions/blockers, evidence-attribution safety outcome, and a clear **READY FOR DESIGN REVIEW / NOT READY** verdict. Stop for owner approval. Do not deploy.
