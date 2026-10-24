# Insurance Simplified — V1.1 Product & Design Specification

**Status:** Approved for implementation planning; implementation not authorized

**Project:** Insurance Simplified

**Version:** V1.1 — Customer Understanding Experience

**Baseline:** V1 commit `2d85daf`

**Branch:** `feat/rag-core`

**Date:** October 23, 2026

---

## A. V1 Baseline — What We Already Built

Insurance Simplified V1 is a working document-first insurance understanding and comparison prototype.

Verified capabilities include:

- Uploading 1–4 user-provided insurance PDFs.

- Understanding one PDF without requiring another document.

- Comparing multiple insurance documents and available plan tiers.

- Extracting structured insurance facts with original-page evidence.

- Presenting document-specific information groups.

- Collecting minimal user context: age, residence, location, visa/status, and coverage dates.

- Providing document-grounded chatbot answers with citation verification.

- Displaying missing or unresolved information.

- Downloading a PDF report from validated results.

- Using existing session authorization, database persistence, and security protections.

**V1.1 must reuse these capabilities.**

The goal is not to replace the extraction pipeline, redesign the infrastructure, or rebuild the application.

### Product problem

V1 successfully organizes insurance information, but real-world testing showed that organized information is not always understandable information.

Users still encounter unexplained values, excessive navigation, buried eligibility risks, ambiguous deductible choices, and lengthy reports.

**V1.1 must bridge the gap between extracted facts and informed customer understanding.**

---

## B. Confirmed Customer Problems

The following issues were observed during the IMG Patriot America Plus customer walkthrough and its downloaded report.

| Problem | Customer impact | Priority |

|---|---|---|

| Nine top-level navigation sections | Excessive navigation and cognitive load | P1 |

| No personalized overview | Important conclusions are not immediately visible | P1 |

| Potential country-of-residence conflict buried in a table | User may misunderstand whether coverage applies | P0 |

| Out-of-pocket values displayed as `$0 / $500 / $0` | Applicable amount is unclear | P0 |

| Service benefits displayed as `100% / 90% / 100%` | Network-dependent reimbursement conditions are unclear | P0 |

| Deductible options presented without purchased-option confirmation | User might mistake an available deductible for their actual deductible | P0 |

| Multiple age-related coverage maximums shown together | User must interpret which age band applies | P1 |

| Eligibility shown as “Not stated” | User receives uncertainty without a useful explanation | P1 |

| Repeated phone numbers, websites, and network labels | Unnecessary clutter | P2 |

| Exported report repeats extracted information | User still performs interpretation manually | P1 |

| Source references do not always explain conditions beside values | Users must investigate evidence to understand basic meaning | P1 |

| Last exported report page contains little useful content | Poor document presentation | P2 |

These are confirmed presentation and understanding problems, not proof that all underlying extracted facts are incorrect.

Other issues, especially cross-document tier synchronization, still require targeted testing.

---

## C. V1.1 Product Goals and Scope

### Primary goal

Enable a first-time customer to understand an insurance policy, compare available choices, and identify unresolved questions without independently interpreting the entire original PDF.

### Customer success questions

The user must be able to answer:

1. Can I use this insurance in my situation, or what remains unconfirmed?

2. What might I pay, and which costs depend on selected options or conditions?

3. What important medical services are covered or excluded?

4. How do the selected insurance plans or tiers meaningfully differ?

5. What must I confirm before buying or relying on coverage?

### Locked experience

**Personalized overview → Documented upsides / potential conflicts / unknowns → Key financial facts → Maximum five navigation sections → Dynamic comparison table → Expandable evidence.**

### Scope

V1.1 includes:

- Simplifying the existing results interface.

- Making conditional insurance values understandable.

- Connecting user context to validated policy facts.

- Maintaining independent tier selection for each uploaded document.

- Keeping chatbot, summary, table, and export consistent.

- Improving the downloadable report.

- Preserving all validated information and citations.

### Non-goals

V1.1 does not introduce:

- An external insurance plan marketplace.

- Automatic purchasing or enrollment.

- Guaranteed eligibility determination.

- Automated best-plan selection.

- A new AI model or infrastructure service.

- A new database unless a demonstrated contract gap makes it unavoidable.

- Automatic browsing for missing insurance facts.

---

## D. Personalized Overview

### Purpose

The first visible result should answer:

**“What are the most important things I need to know about this insurance?”**

The user should not need to open multiple tabs to discover critical restrictions.

### Single-policy wireframe

**IMG Patriot America Plus**

*Review required — possible coverage applicability conflict*

**Potential coverage conflict**

The brochure excludes coverage in the insured person's country of residence. Your supplied country of residence is the United States, and your requested coverage location is Cleveland, Ohio.

The application cannot conclusively determine eligibility from these facts alone.

**Action:** Confirm whether the policy applies to your circumstances before relying on it.

**Key facts**

| Item | Display |

|---|---|

| Annual deductible | $0–$2,500 selectable options; actual selection unknown |

| Premium | Not stated in the uploaded brochure |

| ER-specific deductible | $250; applicable conditions must be checked |

| Personal eligibility | Unconfirmed |

| Coverage period requested | October 23–31, 2026 |

**Documented upsides**

Show meaningful benefits supported by evidence, such as documented emergency evacuation benefits, without assuming suitability.

**Potential conflicts**

Show eligibility, residence, geographical, age, date, or plan-condition mismatches requiring attention.

**Important unknowns**

Show missing premium, unspecified selected deductible, uncertain eligibility, or missing policy declaration.

### Overview rules

- Prioritize coverage applicability and material financial risks.

- Show no more than a small set of high-impact findings initially.

- Every factual claim must retain a source reference.

- Distinguish document facts from personalized interpretations.

- A potential conflict is not automatically confirmed ineligibility.

- Do not claim that an insurance product is the user's best option.

- When information is insufficient, explain exactly what is missing.

- Recompute overview content when the selected policy or tier changes.

- Do not invent upsides merely to fill a card.

---

## E. Maximum Five Navigation Sections

The results workspace must have no more than five top-level sections.

| Section | Purpose | Typical information |

|---|---|---|

| **1. My Fit** | Can this coverage apply to me? | Eligibility, age, residency, location, visa/status, dates, personal conflicts |

| **2. My Costs** | What might I pay? | Premium, deductible, copay, coinsurance, OOP maximum, conditional costs |

| **3. Coverage** | What services are included? | Hospitalization, emergency care, dental, treatment, specialized benefits |

| **4. Limits & Risks** | What could restrict coverage? | Exclusions, waiting periods, policy limits, sublimits, geographical restrictions |

| **5. Evidence & Actions** | What is confirmed and what must I verify? | Sources, conflicting facts, unknowns, insurer contacts, enrollment questions |

### Dynamic table behavior

The existing comparison table remains below the navigation.

Selecting **My Costs** shows cost-related rows.

Selecting **Coverage** shows coverage-related rows.

Selecting **My Fit** shows eligibility and applicability rows.

The table updates without navigating to a separate page.

### Information grouping rules

Five sections are navigation containers, not a limit of five categories of insurance information.

AI-discovered document-specific topics can become expandable subgroups within those containers.

Examples:

- Coverage → Emergency Services → Emergency Evacuation

- Coverage → Rehabilitation → Physical Therapy

- My Costs → Emergency Costs → ER Deductible

- Limits & Risks → Geographic Restrictions → Country of Residence

Do not discard validated facts merely to satisfy the five-section limit.

Show high-impact information first, followed by **Show more details**.

Avoid duplicating rows unless the same fact serves a different, clearly explained purpose.

If a section contains no applicable information, it may be omitted or show a meaningful empty state. Never imply absence of coverage merely because a section has no extracted facts.

---

## F. Single-PDF Experience

One PDF must deliver a complete understanding experience without requiring another uploaded document.

### Layout

**Personalized overview**

**Five navigation sections maximum**

**Existing dynamic table**

| What matters | Selected policy / tier |

|---|---|

| Annual deductible | Verified selected-tier amount or labeled available options |

| Hospitalization | Verified coverage with network conditions |

| Emergency room | Verified cost and relevant conditions |

| Eligibility | Evidence-based status or unresolved question |

### Requirements

- Use two primary table columns: factor and policy/tier.

- Preserve clickable original-page citations.

- Display plain-language explanations alongside material conditions.

- Allow expandable detail for complex benefits.

- Support multiple tiers within one document.

- Keep policy-wide facts distinct from tier-specific facts.

- Never substitute one tier's benefit for another.

- Treat the original PDF as evidence, not automatically as a single plan.

A document may describe one plan, multiple plans, several tiers, or a shared policy framework. The representation must reflect actual document evidence.

---

## G. Two-to-Four-PDF Comparison Experience

The overall interface must remain consistent regardless of document count.

### Three-document wireframe

**Compare your insurance options**

**Overview:** Key differences, potential conflicts, unknowns, and meaningful tradeoffs.

**Navigation:** My Fit | My Costs | Coverage | Limits & Risks | Evidence & Actions

**Selected section: My Costs**

| What matters | IMG Patriot | WorldTrips | Seven Corners |

|---|---|---|---|

| Tier selector | Independently selected | Independently selected | Independently selected |

| Deductible | Selected option or labeled choices | Selected-tier deductible | Selected option or labeled choices |

| Premium | Verified value or unknown | Verified value or unknown | Verified value or unknown |

| Cost conditions | Policy-specific | Tier-specific | Policy-specific |

| Evidence | Source link | Source link | Source link |

The table values above describe the intended structure, not new assertions about the uploaded plans.

### Comparison rules

- Use one shared factor column.

- Use independent columns for selected plan/tier views.

- Compare equivalent insurance concepts across documents.

- Preserve insurer-specific terminology when necessary.

- Preserve material qualifiers.

- Show missing information honestly.

- Do not equate “Not stated” with “Not covered.”

- Do not merge distinct benefits simply because their names look similar.

- Do not present different currencies, payment frequencies, deductibles, or reimbursement bases as directly comparable without explanation.

- Preserve the factor column and readable plan headers during horizontal scrolling.

- Do not compress four plans into unreadable columns.

- Allow expandable, source-linked details within cells.

### Important distinction

**Document count is not plan count.**

The system must distinguish:

- Uploaded source document.

- Insurance product.

- Plan.

- Tier.

- Benefit.

- Applicability condition.

One document may contribute evidence to several plan/tier views. A plan may also be supported by multiple uploaded documents.

---

## H. Independent Tier Selection

### Requirement

Every displayed plan with validated tiers must support independent tier filtering.

### Available selector states

- **All tiers**

- **One specific tier**

Tier names must come from actual uploaded evidence.

### Behavior

A selection under one insurer must not change another insurer's selection.

Selections must persist while switching between the five navigation sections.

### Specific-tier mode

Display:

- Facts explicitly applicable to that tier.

- Verified shared policy-wide facts applicable to that tier.

- Relevant conditions and evidence.

- Unknowns for information not established for that tier.

### All-tiers mode

Display all validated tiers without merging incompatible values into ambiguous cells.

If appropriate, show a compact summary followed by individually labeled tier details.

### Synchronization contract

A tier-selection change must update:

1. Personalized overview.

2. Upsides, potential conflicts, and unknowns.

3. Key financial facts.

4. Dynamic comparison table.

5. Expandable evidence.

6. Tier-specific chatbot context.

7. Downloadable PDF report.

All dependent views must refer to the same effective selection.

### Safety cases

- Shared policy fact must not disappear unnecessarily.

- Unknown tier-specific value must remain unknown.

- Conflicting values must preserve their source and scope.

- Switching tabs must not reset selections unexpectedly.

- Changing one plan's tier must not overwrite another plan's state.

- All-tiers mode must not claim a single value applies to every tier unless evidence supports that conclusion.

---

## I. Interpretation and Evidence Safety

### Three information types

**1. Documented fact**

A source-supported policy statement with its original-page evidence.

**2. Personalized interpretation**

A conclusion drawn from validated facts and supplied user context using controlled, explainable logic.

**3. Unresolved question**

An issue that cannot be established because evidence is missing, conflicting, conditional, or incomplete.

### Information states

The interface must distinguish:

- Covered, with applicable conditions.

- Not covered, when explicitly supported.

- Not stated in the uploaded evidence.

- Needs verification.

- Potential conflict.

- Selectable option.

- Selected or purchased option, when established.

- Conflicting evidence.

### Conditional numbers

A material number must retain the conditions required for correct understanding.

Examples:

Instead of `100% / 90% / 100%`, display each percentage alongside its documented network or other applicability condition.

Instead of `$0 / $500 / $0`, identify the precise deductible or maximum type and the context associated with each amount. If the relationship cannot be established, show an unresolved question rather than inventing labels.

Instead of showing all age-dependent maximums equally, prioritize the age-appropriate documented band when user context and evidence permit.

### Protected rules

- AI cannot invent benefits, premiums, eligibility, or evidence.

- Citation verification remains fail-closed.

- Source-page links must remain valid.

- Material costs and limits require verifiable evidence.

- A selectable deductible is not a purchased deductible.

- A maximum limit is not guaranteed payment.

- A network reimbursement percentage is not necessarily the total amount paid by the insurer.

- An apparent conflict is not automatically a definitive rejection.

- A brochure is not automatically proof of purchased coverage.

Preserve existing session authorization, privacy, deterministic eligibility rules, and evidence verification.

---

## J. Chatbot and PDF Export Consistency

### Chatbot

The chatbot must understand the active selection context.

For tier-specific questions:

- Use the selected plan/tier scope.

- Preserve document-wide applicable facts.

- Avoid mixing other tiers' values.

- Cite relevant source pages.

- Refuse unsupported claims rather than invent them.

If the user asks explicitly about another tier or all tiers, the answer may address that broader scope only when it is unambiguous and adequately supported.

### PDF export

The downloaded report must reflect the same validated data and selection displayed in the UI.

Recommended report order:

1. Personalized overview.

2. Important upsides, conflicts, and unknowns.

3. Key financial facts.

4. Selected plans and tiers.

5. Five-section detailed comparison.

6. Evidence and specific verification questions.

Avoid generating a second independent AI interpretation during export.

Avoid unnecessary pages, repeated values, redundant contacts, and empty trailing pages.

Keep source citations and meaningful conditions next to the facts they support.

If the UI is in All-tiers mode, the PDF must preserve tier attribution rather than flattening all tiers into one apparent policy.

### Consistency acceptance rule

For any selected tier, the summary, table, chatbot answer, and exported PDF must not contradict one another concerning the same validated material fact.

---

## K. Responsive UX, Accessibility, and States

### Desktop

- Personalized overview above the comparison.

- Five or fewer navigation sections.

- Clear plan/tier selectors.

- Readable table widths.

- Sticky factor labels when horizontally scrolling.

- Evidence accessible without losing comparison context.

### Mobile and narrow screens

- Preserve readable values.

- Allow controlled horizontal scrolling or an equivalent accessible comparison presentation.

- Keep plan identities understandable.

- Do not squeeze three or four plans into narrow unreadable cells.

- Maintain accessible controls and keyboard navigation.

### Accessibility

- Do not rely on color alone for coverage or verification status.

- Use meaningful labels for warnings and information states.

- Provide accessible names for tier selectors.

- Support keyboard navigation and visible focus indicators.

- Maintain readable text contrast.

- Use appropriately structured tables or equivalent accessible relationships.

### Loading and errors

Distinguish:

- Upload in progress.

- Extraction in progress.

- Comparison preparation.

- Chatbot answer generation.

- Unsupported or failed extraction.

- Missing facts.

- Evidence-verification failure.

- Provider unavailable.

Do not show an apparently completed insurance determination when the underlying analysis has failed.

---

## L. Architecture and Repository Impact

### Architecture decision

**No new infrastructure is required for V1.1 by default.**

Retain:

- Next.js application.

- Existing extraction and structured-fact pipeline.

- Existing AI and embedding provider abstraction.

- Existing database and private document storage.

- Existing deterministic comparison and eligibility logic.

- Existing source evidence model.

- Existing session security.

- Existing PDF export implementation.

### Integration areas to inspect

The following paths are identified in the V1 repository review and must be rechecked against the actual repository before implementation:

| File / component | Expected work |

|---|---|

| `app/page.tsx` | Personalized overview placement and unified selection state |

| `app/components/ComparisonTable.tsx` | Five-section filtering, conditional labels, tier-aware columns |

| `app/components/ContextInputs.tsx` | Verify context inputs support meaningful interpretation |

| `app/components/VerifyContact.tsx` | Consolidate next steps and contact presentation |

| `app/lib/rag/answer.ts` | Verify chatbot respects active selection and evidence constraints |

| `app/lib/llm/safe-prompt.ts` | Inspect existing safety behavior; change only if required |

| Existing PDF report implementation | Synchronize export with selected tiers and customer summary |

| Existing comparison and presentation-group logic | Map validated facts into five top-level navigation groups |

| Existing tests | Add behavior-focused regressions and customer acceptance scenarios |

These are candidate change areas, not authorization to modify every file.

The implementation agent must verify exact paths and existing ownership before editing.

### Architecture constraints

- Prefer presentation-level derivation from existing validated facts.

- Add only necessary structured data for condition clarity if existing contracts are inadequate.

- Preserve compatibility with existing result persistence.

- Do not introduce a new AI provider, queue, crawler, or database by default.

- Any migration or protected evidence-contract change requires separate review.

- Avoid re-running already-completed V1 development phases.

---

## M. Prioritized Implementation Plan

### Phase 1 — Correct information meaning

**Priority: P0**

- Distinguish conditional cost values.

- Preserve tier, age, network, and selected-option qualifiers.

- Correct confusing repeated values.

- Surface critical applicability conflicts.

- Separate facts, interpretations, and unknowns.

**Completion:** High-risk values are understandable without inventing information.

### Phase 2 — Personalized overview

**Priority: P1**

- Add compact overview.

- Add documented upsides.

- Add potential conflicts.

- Add important unknowns.

- Add key costs and verification actions.

**Completion:** User understands important policy considerations before exploring the detailed table.

### Phase 3 — Five-section interface

**Priority: P1**

- Map existing facts into five maximum navigation groups.

- Retain document-specific expandable subgroups.

- Keep the existing dynamically changing table.

- Preserve full evidence access.

**Completion:** No validated fact disappears and the navigation is materially simpler.

### Phase 4 — Multi-document and tier behavior

**Priority: P1**

- Verify independent tier selectors.

- Synchronize selections with summary, table, evidence, chatbot, and export.

- Improve comparative labels and cross-policy factor alignment.

- Ensure three- and four-document layouts remain readable.

**Completion:** Changing a tier never mixes or misrepresents policies.

### Phase 5 — Export, accessibility, and customer validation

**Priority: P1/P2**

- Improve PDF summary structure.

- Remove repeated or redundant presentation.

- Verify responsive behavior.

- Run customer-comprehension tests.

- Regression-test existing V1 contracts.

**Completion:** User can answer all five customer success questions accurately.

### Implementation discipline

These phases are the V1.1 experience roadmap, not the historical V1 P1/P2 phases.

Implement only after this specification is approved.

Keep V1 frozen as a recovery checkpoint.

Do not add unrelated improvements while working on the experience.

---

## N. Customer Acceptance Tests

| ID | Scenario | Expected outcome |

|---|---|---|

| UX-01 | Upload one PDF | Personalized overview and two-column detail table |

| UX-02 | Upload two PDFs | Shared-factor comparison with separate plan columns |

| UX-03 | Upload three PDFs | Readable comparison and independent selectors |

| UX-04 | Upload four PDFs | No clipped or misaligned material information |

| UX-05 | Single PDF with several tiers | Validated tier selector appears |

| UX-06 | Select one tier | Only applicable tier-specific and shared facts appear |

| UX-07 | Select All tiers | Every value remains attributed to its actual tier |

| UX-08 | Switch sections | Current tier selections remain active |

| UX-09 | Select a tier in PDF A | PDF B's selection remains unchanged |

| UX-10 | Age-dependent maximums | Applicable age band is clearly explained |

| UX-11 | Network-dependent percentages | Each percentage is associated with its conditions |

| UX-12 | Selectable deductible options | Unknown purchased deductible is not assumed |

| UX-13 | Missing premium | Not stated and quote-required guidance appears |

| UX-14 | Explicit exclusion | Correctly identified as excluded, with evidence |

| UX-15 | Residence conflict | Potential conflict is prominently surfaced |

| UX-16 | Insufficient eligibility evidence | No guaranteed eligibility/ineligibility claim |

| UX-17 | Equivalent benefits across insurers | Comparison aligns concepts without erasing qualifiers |

| UX-18 | Different currencies or payment bases | Values are not falsely compared as equivalent |

| UX-19 | Conflicting source documents | Conflict remains explicit and traceable |

| UX-20 | Unsupported chatbot question | Evidence-based refusal |

| UX-21 | Selected-tier chatbot question | Answer remains scoped and cited |

| UX-22 | Change tier and download PDF | Export reflects current selection and supporting facts |

| UX-23 | Narrow laptop viewport | Comparison remains legible and aligned |

| UX-24 | Keyboard navigation | Tabs, selectors, details, and evidence remain operable |

| UX-25 | Customer understanding | First-time user accurately answers all five core questions |

### IMG real-document acceptance case

Context:

- Age 25.

- F-1 STEM OPT.

- Residence: United States.

- Requested location: Cleveland, Ohio.

- Requested dates: October 23–31, 2026.

Expected:

- Potential country-of-residence conflict appears prominently.

- No unsupported final eligibility determination.

- Selectable deductibles remain explicitly selectable.

- Age-dependent maximums retain age qualifiers.

- Network-dependent percentages retain network qualifiers.

- Missing premium remains unknown.

- Questions to verify are specific and actionable.

- Every material statement remains linked to supporting evidence.

### User-comprehension gate

Ask a first-time test user to explain:

1. Potential eligibility or coverage concerns.

2. Their likely costs and unresolved cost choices.

3. Important covered and excluded services.

4. Significant differences between selected policies.

5. Questions they need answered before buying.

The test passes only when the user can answer without making material false assumptions. Record failures and improve the presentation instead of treating navigation or visual appearance alone as success.

---

## O. Risks, Non-Goals, and Known Unknowns

### Risks

- Source documents may omit required eligibility or pricing information.

- Similar benefit names across insurers may not represent equivalent coverage.

- A selected tier may share some document-wide facts but differ on other conditions.

- Personalized explanations can become misleading if evidence qualifications are omitted.

- Long tables may remain difficult to read with four documents.

- Live LLM outputs may vary; deterministic and evidence safeguards remain necessary.

- An attractive summary can create false confidence unless uncertainty is displayed prominently.

### Items requiring implementation-time verification

- Exact current tier-selection state ownership.

- Actual chatbot handling of active tier selection.

- Existing export behavior when UI selection changes.

- Existing responsive table behavior.

- Actual data representation of conditions and qualifiers.

- Current handling of contradictory evidence.

Do not assume these are confirmed bugs until tested.

### Deferred improvements

- Automatic plan winner.

- Automatic enrollment.

- Live external pricing.

- Marketplace discovery.

- Expanded recommendation models.

- New infrastructure.

- Unrelated backend refactors.

### Historical-spec conflicts

Older V1 documentation may describe unrestricted AI-generated navigation or defer dynamic grouping to historical phases.

V1.1 intentionally introduces a new presentation decision: a maximum of five stable top-level sections with dynamic document-specific subgroups.

This supersedes the older navigation presentation choice for V1.1 while preserving the original validated-fact and evidence architecture.

The revised product decision must be recorded in canonical documentation after approval.

---

## P. Review Checklist and Approval Boundary

### Product decisions

- [ ] Personalized overview is placed before detailed facts.

- [ ] Maximum five top-level sections.

- [ ] Existing dynamic table is retained.

- [ ] One PDF produces a complete understanding experience.

- [ ] Two to four PDFs use shared-factor comparison columns.

- [ ] Multiple tiers remain independently selectable.

- [ ] All-tiers mode never merges incompatible values.

- [ ] Tier changes synchronize overview, table, evidence, chatbot, and export.

- [ ] Material numbers retain their conditions.

- [ ] Document facts, interpretations, and unknowns remain distinct.

- [ ] Important coverage conflicts are prominent.

- [ ] No unsupported eligibility or recommendation claims.

- [ ] All verified evidence and source pages are preserved.

- [ ] No infrastructure redesign is required by default.

- [ ] Customer-comprehension criteria determine V1.1 success.

---

## Q. Visual Design System and Brand Identity

**Status:** Approved V1.1 design direction

**Design name:** Adaptive Medical Minimal

### Q.1 Brand identity

Product name: Insurance Simplified

Approved logo:

`public/insurance-simplified-logo.png`

The logo combines:

- Blue document: insurance information and source documents.

- Red shield/checkmark: protection, clarity, and evidence-backed understanding.

- Insurance Simplified wordmark: charcoal and red.

The checkmark represents clarity and verification, not guaranteed insurance coverage or eligibility.

Use the approved logo unchanged. Do not replace it with a generic medical cross or generate another logo.

Create an appropriately sized icon-only variant for favicon and small-screen use during implementation. Preserve the original master asset.

### Q.2 Automatic light and dark themes

The application must automatically follow the user's operating-system appearance through `prefers-color-scheme`.

Light theme:

- Clean white and soft-neutral backgrounds.

- Charcoal typography.

- Subtle borders and shadows.

- Restrained red branding and blue interactive highlights.

Dark theme:

- Deep charcoal backgrounds.

- Slightly elevated dark surfaces.

- Clear light typography.

- Adjusted accent and status colors for accessible contrast.

Do not simply invert light-mode colors.

No manual theme switch is required for V1.1.

### Q.3 Color responsibilities

Brand red:

- Logo and selected branding details.

- Not every button, card, or highlight.

Interactive blue:

- Active navigation.

- Selected tabs and comparison columns.

- Focus indicators.

- Informational emphasis and links.

Positive green:

- Evidence-backed positive findings.

- Never indicate guaranteed coverage without evidence.

Caution amber:

- Potential eligibility conflicts.

- Review-required states.

- Conditional situations requiring confirmation.

Critical red:

- Confirmed serious errors or explicit exclusions.

- Avoid using red for ordinary missing information.

Neutral gray:

- Missing information.

- Unknown or not-stated values.

- Secondary text and supporting content.

Every status must include a meaningful text label or icon; color alone is insufficient.

### Q.4 Proposed semantic CSS tokens

Use semantic CSS variables rather than hardcoding colors throughout components.

Light theme:

- Background: #F7F8FA

- Surface: #FFFFFF

- Elevated surface: #FFFFFF

- Primary text: #171B24

- Secondary text: #667085

- Border: #E1E5EB

- Brand red: #CF3043

- Interactive blue: #315EDB

- Selected blue surface: #EFF4FF

- Positive: #25845D

- Caution: #BA771C

- Critical: #C92D42

Dark theme:

- Background: #111318

- Surface: #1D2028

- Elevated surface: #292D36

- Primary text: #F7F8FA

- Secondary text: #AAB2C0

- Border: #373D48

- Brand red: #ED4658

- Interactive blue: #547CF5

- Selected blue surface: #222F4D

- Positive: #79D7BB

- Caution: #F3BB61

- Critical: #FF6878

These are proposed implementation tokens. Validate contrast for text, controls, and status states before finalizing.

### Q.5 Layout and visual hierarchy

The results screen must present:

1. Product header with approved logo.

2. Personalized insurance overview.

3. Critical applicability concerns, documented upsides, and unknowns.

4. Key financial summary cards.

5. Maximum five navigation sections.

6. Existing dynamic comparison table.

7. Expandable details and evidence.

Use consistent typography, spacing, borders, corner radii, and component heights.

Prioritize readability and comprehension over decorative effects.

Avoid excessive gradients, neon effects, unnecessary animation, and visually cluttered cards.

### Q.6 Navigation experience

Preserve Welcome → Intake → Results.

Provide:

- Clear primary actions.

- Understandable back navigation.

- Visible upload/extraction progress.

- Clear document count and selected plans.

- Persistent independent tier selectors.

- Consistent navigation between the five sections.

- Easy access to source evidence.

- Clearly identified downloadable PDF action.

The interface should minimize unnecessary clicks and prevent users from losing their current context.

### Q.7 Comparison table design

Keep the existing dynamically changing comparison table.

Requirements:

- Stable factor column.

- Readable minimum column widths.

- Independent tier selector for each relevant plan.

- Horizontal scrolling for multiple plans when necessary.

- Clearly visible selected-plan context.

- Subtle blue emphasis for active selections when useful.

- Conditional values explained in place.

- Expandable details instead of repeated raw values.

- Original-page evidence available on demand.

- Clearly distinguish verified facts, exclusions, uncertainty, and potential conflicts.

Do not use bright red or colored backgrounds for entire ordinary table columns.

### Q.8 Responsive behavior

Desktop:

- Spacious overview.

- Clear multi-column comparison.

- Sticky factor labels when scrolling.

Tablet:

- Adapt summary cards.

- Preserve independent plan selection.

- Keep comparisons readable.

Mobile:

- Stack overview cards.

- Provide usable section navigation.

- Use accessible horizontal comparison or equivalent focused-plan presentation.

- Preserve source links and tier filters.

- Avoid clipped or overlapping information.

### Q.9 Accessibility

- Support keyboard navigation.

- Provide visible focus indicators.

- Maintain WCAG AA contrast targets.

- Use semantic headings and accessible table relationships.

- Do not communicate status through color alone.

- Support reduced-motion preferences.

- Ensure interactive elements remain usable on touchscreens.

### Q.10 Loading, empty, and failure states

Create visually consistent states for:

- Document upload.

- Text extraction.

- Insurance analysis.

- Chatbot generation.

- Missing evidence.

- Unavailable provider.

- Export failure.

- Session expiration.

Do not display a completed insurance assessment when processing has failed.

### Q.11 Logo integration points

During V1.1 implementation, integrate approved branding into:

- Application header.

- Welcome screen.

- Intake flow.

- Results workspace.

- Favicon and browser icon.

- Downloadable PDF report.

The logo must work against both light and dark surfaces. If its white background creates a visible square in dark mode, prepare an appropriate transparent or dark-compatible presentation without redesigning the original mark.

### Q.12 Visual acceptance criteria

V1.1 passes visual review when:

- Light and dark modes follow system settings.

- Branding remains consistent across all screens.

- Logo looks sharp on desktop and mobile.

- All five navigation sections remain usable.

- One to four document comparisons remain legible.

- Tier selectors remain aligned and functional.

- Critical facts are more prominent than secondary details.

- Conditional numbers are understandable.

- Status colors are natural and accurate.

- No important facts are hidden due to responsive layout.

- Keyboard navigation, contrast, and focus states are verified.

- The product looks polished without sacrificing evidence accuracy.

### Q.13 Scope boundary

This section defines visual and navigation requirements only.

It does not authorize:

- Rebuilding the V1 architecture.

- Replacing providers.

- Adding infrastructure.

- Removing evidence or security guarantees.

- Introducing unrelated features.

The visual design must be implemented alongside the approved V1.1 user-experience improvements, not as an independent redesign.

---

## R. Final Implementation Contracts and Approval Gate

**Status:** Approved product-design clarifications for V1.1 planning.

This section resolves implementation ambiguities identified during the final product review. It supplements Sections A–Q without replacing their requirements.

### R.1 Document, Plan, and Tier Identity

The following entities are distinct:

- **Document:** An uploaded PDF containing insurance evidence.

- **Product/Plan:** An insurance offering identified from supported document evidence.

- **Tier:** A documented variation within a particular plan.

- **Selected view:** The exact plan/tier combination currently being evaluated.

A single PDF may contain multiple plans, and a plan may have multiple tiers. Multiple PDFs may also provide evidence for the same plan.

**Selection hierarchy:**

Document → Plan → Tier

Users select the relevant plan first when multiple plans exist, then choose a tier when documented tiers are available.

Do not automatically assume one PDF equals one plan.

If plan identity or tier attribution cannot be established reliably, preserve the ambiguity and request clarification rather than inventing the relationship.

### R.2 Unified Selection-State Contract

The application must maintain one consistent effective selection state for the current comparison.

The state must identify:

- Uploaded document and supported plan identity.

- Selected tier or All-tiers mode for each displayed plan.

- Active one-of-five navigation section.

- Validated comparison-result version or fingerprint where available.

Changing a tier or plan must update every dependent view consistently:

1. Personalized overview.

2. Upsides, potential conflicts, and unknowns.

3. Summary metrics.

4. Dynamic comparison table.

5. Evidence details.

6. Tier-specific chatbot scope.

7. Downloadable PDF export.

**State transitions:**

- Switching navigation sections preserves plan and tier selections.

- Changing a plan invalidates a tier selection that does not belong to the new plan.

- Removing a document removes its associated selection and dependent views.

- Returning from results to intake preserves valid inputs and selections when appropriate.

- Replacing or reprocessing a document invalidates stale selections and dependent results.

- A pending response generated for a previous selection must not overwrite the current selection's results.

- Selection changes must not modify the underlying verified insurance facts.

The implementation may reuse existing state management. No new state-management framework is required.

### R.3 Personalized Interpretation Safety

Every material personalized finding must be traceable to:

- Validated source facts.

- Original document and page evidence.

- Relevant user-context inputs.

- Applicable age, geographical, date, network, plan, or tier conditions.

- The rule or controlled derivation used.

- The appropriate uncertainty status.

A potential conflict must not automatically become a definitive eligibility rejection.

If evidence or applicability conditions are insufficient, the system must display an unresolved question.

A user should be able to understand both **what the document says** and **why that matters to their circumstances**.

Never fabricate missing coverage, premiums, eligibility, deductibles, exclusions, or evidence.

### R.4 All-Tiers Presentation Contract

All-tiers mode does not mean merging all tier values into a single insurance policy.

Each displayed comparison column represents a clearly identified plan view.

Within that view:

- Specific-tier mode shows the selected tier's facts and applicable shared facts.

- All-tiers mode shows a compact summary with clearly labeled tier-specific values.

- Expandable tier details are permitted within the plan column.

- Mutually exclusive values must remain distinguishable.

- Shared policy-wide facts must retain their applicable scope.

- Unknown tier-specific values remain unknown.

Switching between specific-tier and All-tiers mode must not unexpectedly change the number of top-level comparison columns.

An explicit user action may open an expanded tier comparison, provided plan identity and source attribution remain clear.

### R.5 Zero-Document and Back-Navigation Contract

Preserve the existing Welcome → Intake → Results journey.

**Zero-document path:**

- Offer guided insurance-requirement preparation.

- Do not fabricate insurance plans.

- Do not automatically search a marketplace.

- Clearly explain that document-specific assessment requires relevant source evidence.

**Back navigation:**

- Allow users to return to intake without unexpectedly losing their entered context.

- Preserve valid document selections when possible.

- Clearly indicate when uploaded documents or derived results must be reprocessed.

- Avoid presenting stale comparisons as current.

Browser navigation and application navigation must maintain consistent session and selection behavior.

### R.6 PDF Export Snapshot Contract

Each PDF export must represent one immutable snapshot of:

- The validated comparison result.

- Active plan/tier selections.

- Relevant user context.

- Personalized findings derived from those validated facts.

- Evidence references.

Changing a tier while an export is being generated must not produce a report combining old and new selections.

The export must either complete using the captured snapshot or clearly fail. It must never silently mix selection states.

The PDF must not perform an independent second LLM extraction or unsupported interpretation.

The exported findings and material values must match the selected UI state represented by that snapshot.

### R.7 Logo and Adaptive Theme Contract

**Approved brand asset:**

\\`public/insurance-simplified-logo.png\\`

Preserve the original asset unchanged.

**Light theme:**

Use the approved logo with white or compatible neutral surfaces.

**Dark theme:**

Provide a dark-compatible presentation that avoids displaying an awkward white rectangle around the logo.

An icon-only version may be prepared for favicon, browser tab, and compact layouts.

Do not redesign the logo, replace it with a generic medical cross, or change its established meaning.

**Theme behavior:**

- Follow the user's system appearance using \\`prefers-color-scheme\\`.

- Maintain accessible semantic color tokens for both light and dark modes.

- Keep red as a restrained brand accent.

- Use blue naturally for selected or informational UI states.

- Reserve green, amber, red, and neutral status styling for their established meanings.

- Do not rely on color alone to communicate important insurance information.

### R.8 Visual Implementation Order

The visual design must be implemented together with the functional user experience rather than as a separate full redesign afterward.

Recommended sequence:

1. Establish shared light/dark semantic tokens and core interface styles.

2. Integrate approved branding and consistent navigation.

3. Build the personalized overview and conditional-value presentation.

4. Implement the maximum-five-section interface and dynamic table.

5. Verify independent plan/tier selection and state synchronization.

6. Synchronize chatbot and PDF export behavior.

7. Validate responsive design, accessibility, and customer comprehension.

8. Perform final visual refinement after the functional acceptance checks pass.

Retain existing styling infrastructure wherever practical.

Do not add a new CSS framework or component library unless the current repository demonstrably cannot meet the requirements.

### R.9 Final V1.1 Acceptance and Approval

The implementation plan must include acceptance checks for:

- One PDF and multiple tiers.

- Two, three, and four PDF comparisons.

- Multiple plans within one PDF.

- Independent plan and tier selections.

- All-tiers mode.

- Preserved state across navigation.

- Safe invalidation of stale selection-dependent output.

- Conditional costs and eligibility conflicts.

- Missing and contradictory information.

- Tier-scoped chatbot answers.

- Exact-state PDF export.

- System light and dark modes.

- Responsive comparison layouts.

- Accessible navigation and status indicators.

- Consistent approved logo use.

- The five customer-understanding questions from Section C.

**Implementation boundaries:**

- V1 remains the frozen recovery checkpoint.

- Existing evidence, authorization, and deterministic evaluation contracts remain protected.

- No new infrastructure is required by default.

- No database migration is authorized by this specification.

- No implementation begins automatically after planning.

**Product review verdict:** APPROVED FOR IMPLEMENTATION PLANNING.

**Implementation authorization:** NOT YET GRANTED.

The next step is for Prometheus to inspect the repository and create an implementation plan based on Sections A–R.

The plan must be reviewed before Atlas or Sisyphus begins application implementation.

**END OF V1.1 PRODUCT & DESIGN SPECIFICATION — APPROVED FOR PLANNING ONLY.**
