# Product — requirements and user experience

Status: Authoritative · Consolidated 2026-11-15 from `PRODUCT`, `USER_FLOWS`,
`DOMAIN`, `ACCEPTANCE`, `PLAN` (V1 revision) and `V1_1_REVIEW_PACKAGE` (now in
`docs/archive/superseded/`). Requirement IDs `A-0xx` and `UX-xx` are unchanged
so existing tests and commits still resolve.

## 1. What the product is

An evidence-grounded decision-support tool for **health insurance documents**.
A person uploads the plan PDFs they already have and gets an understanding of
what those documents actually say, a comparison of the differences that matter,
a clear list of what is uncertain, and a one-click path to the source page of
every material claim.

**Promise:** "We help you understand what your documents say, compare the
differences that matter, show you what is uncertain, and let you verify the
evidence yourself." We never promise to pick the best plan.

**Primary user:** an individual (students and international students are the
sharpest case) evaluating plans against personal constraints: age,
residency/country, visa/status, location, coverage dates. Desktop-first.

**V1 is health insurance only.** Auto, pet, home and renters come after V1
(see `roadmap.md`, "After V1").

### Non-goals (V1)

Market-wide plan discovery or catalogs · purchasing or enrollment · medical
advice · claims assistance · choosing a plan or insurer for the user ·
multi-user workspaces · mobile-first optimization · a generic "chat with PDF".

## 2. Journey

`Welcome → Intake → Results Workspace` (D-002). Understand, compare, ask and
verify are capabilities of the workspace, not separate pages.

| Path | Input | Output |
| --- | --- | --- |
| **A — I have documents** | 1–5 PDFs + core context | One PDF: a document-specific explanation, comparing its tiers where present. 2–5 PDFs: side-by-side comparison of plans and tiers. |
| **B — I don't know where to start** | Context only | Requirements checklist, criteria to evaluate, documents to obtain, and a path back to Path A. **Never** discovers, ranks or pretends to search plans. |

Core context: age, residency/location, visa/status where relevant, coverage
dates. Never name, phone or email (D-004). Context needed later is requested
inline as `NEEDS YOUR INPUT`; intake is never restarted (D-008).

### Workspace composition (V1.1, approved)

1. **Personalized overview first:** at most three distinct, evidence-grounded,
   high-impact findings (applicability conflicts and material costs first),
   plus key costs and at most three verification actions. No invented
   upsides, winners or suitability scores.
2. **At most five top-level containers:** My Fit · My Costs · Coverage ·
   Limits & Risks · Evidence & Actions. Containers are navigation, not a
   limit on information: document-specific groups nest inside them, and no
   validated fact is dropped to fit them. Empty or purely repetitive groups are
   hidden; repeated "not stated" messages are consolidated.
3. **Dynamic comparison table** below the containers (rules in `experience.md`).
4. **Evidence & Actions** holds verify-before-enrolling items and plan
   contacts (phone, email, website only, grouped by logical plan, only from the
   uploaded documents).
5. **Chat on demand** and **PDF export**, both bound to the same selection.

Up to **three** source-proven plans are shown side by side; when documents
prove more, the user picks which three. Non-selected plans stay in the
inventory, never silently dropped or merged.

## 3. Domain rules

These are the insurance-meaning rules every layer must obey.

| ID | Rule |
| --- | --- |
| DOM-1 | **A document is not a plan.** One PDF may describe several plans or tiers; several PDFs may describe one plan. Plans join only on corroborated identity. |
| DOM-2 | **A plan may have tiers.** Tier selection changes the view, never the evidence. A tier-specific value never appears under another tier. |
| DOM-3 | **NOT STATED ≠ NO.** Absence never becomes "not covered", "not eligible" or "no". |
| DOM-4 | **Different plan values are not a conflict.** CONFLICTED means incompatible claims about the same fact in the same plan/tier/network/condition scope. |
| DOM-5 | **Missing context → ask, never guess.** |
| DOM-6 | **A supported material claim requires verified source evidence** (document, page, quote). |
| DOM-7 | **SUPPORTED ≠ recommended**, and no automatic winner is required. |
| DOM-8 | **Deterministic decisions stay deterministic.** Eligibility, numeric comparison, conflict logic and citation validity never depend solely on free-form LLM output (D-014). |
| DOM-9 | **Selectable is not purchased.** An available deductible or option is not the user's deductible; a maximum is not a guaranteed payout; a network percentage is not the total paid; a brochure is not proof of purchased coverage. |
| DOM-10 | **Qualifiers travel with values.** Network, tier, age band, period and condition qualifiers are never collapsed ("$250 in-network / $500 out-of-network" never becomes "$250"). |
| DOM-11 | **An apparent conflict is not ineligibility.** It is surfaced as a potential conflict to verify. |
| DOM-12 | **Organization is derived, not insurance truth.** AI may group, rank and surface unique features; it may never create coverage, eligibility, qualifiers or evidence. |
| DOM-13 | **Examples are not coverage.** Illustrations, hypotheticals and "coverage examples" never become plan facts. |

Information types kept distinct in every surface: **documented fact** (with
evidence) · **personalized interpretation** (fact + user context via
deterministic logic) · **unresolved question**.

Session lifecycle: `DRAFT → PROCESSING → READY | PARTIAL | FAILED`, and
`DELETING → DELETED`. PARTIAL only when the UI can name exactly what is
incomplete; otherwise FAILED.

## 4. Trust rules (override convenience and polish)

- No material coverage claim is shown as verified without traceable evidence.
- Unknown, insufficient and conflicting states stay visible; never resolved by
  picking the easiest statement.
- A citation resolves to evidence actually present on the cited page of the
  user's document and opens the original PDF there.
- Uploaded documents are untrusted input; their text has no authority over
  instructions, permissions, secrets or other sessions.
- One session's evidence is never exposed to another session or to the model
  during another session's retrieval.
- Without documents, the product never implies it searched or compared plans.
- Paid dependencies are never introduced silently (D-020).

## 5. Acceptance criteria

Each criterion is observable behaviour. Status lives in `roadmap.md`.

**Welcome & intake**
- A-001/A-002 Both entry paths are clearly offered on Welcome.
- A-003 Document upload and core context are one intake flow.
- A-004 0 or >5 PDFs cannot start a comparison; a sixth PDF is rejected without removing the five valid ones (UX-27).
- A-005 Only core context is requested; never name, phone or email.
- A-006 An invalid file is identified; valid selections are kept.
- A-007 Path B returns requirements/criteria/documents guidance and never claims to have searched plans. A-008 Context is reused when the user returns with documents.

**Processing**
- A-009 Progress is shown honestly; no fabricated results.
- A-010 READY implies required document/page/retrieval state is durable.
- A-011 One failed document among several yields PARTIAL naming what is incomplete.

**Results**
- A-012A One PDF: evidenced benefits, costs, eligibility, exclusions, limitations and material unknowns; tier facts on the right tier; citations open the PDF (UX-01, UX-05).
- A-012B 2–5 PDFs: comparable facts side by side across discovered plans/tiers, never assuming one PDF = one plan (UX-02–04, UX-26, UX-28–30).
- A-012 Comparison, tier selection, navigation, chat and evidence live in one workspace.
- A-013A Facts are grouped by meaning and prioritized by importance and context, unique features kept, qualifiers and evidence intact, absence never turned into noncoverage. (A-013/A-014 fixed section names are retired.)
- A-015 A stated premium appears with evidence; a missing premium shows not-stated plus quote-required guidance (UX-13).
- UX-31 Changing the shortlist or replacing a PDF invalidates stale selections and keeps unaffected context. UX-32 Empty groups hidden; repeated missing fields summarized. UX-33 At most three upfront insights. UX-35 Logo returns to intake without destroying valid context.

**Plans and tiers**
- A-016 A multi-tier plan offers one tier or All tiers. A-017 A Pro-only value never shows under Basic. A-018 Tier switching never re-uploads or mutates evidence.
- UX-06 One tier shows its facts plus verified shared facts. UX-07 All tiers keeps every value attributed. UX-08 Selections persist across containers. UX-09 One plan's tier choice never changes another's.
- UX-10 Age-banded maximums explain the applicable band. UX-11 Network percentages show their conditions. UX-12 Purchased deductible is never assumed.

**Evidence states**
- A-019 NOT STATED never becomes No / Not covered / Not eligible.
- A-020 Different plan values are normal differences. A-021 CONFLICTED only for same-scope incompatible claims, with evidence (UX-19, UX-34).
- UX-14 Explicit exclusions are shown as excluded with evidence. UX-15 A residence conflict is prominent. UX-16 No guaranteed eligibility claim on insufficient evidence. UX-17/UX-18 Equivalent concepts align without erasing qualifiers; different currencies or bases are not compared as equal.

**Missing context**
- A-022 A result needing unsupplied context shows NEEDS YOUR INPUT. A-023 Supplying it re-evaluates in place; session and documents stay intact.

**Chat**
- A-024 Grounded answers carry verified citations. A-025 Insufficient evidence gives an explicit refusal (UX-20). A-026 A provider outage is a retryable technical error, never a "documents don't say" refusal. UX-21 Tier-scoped questions stay scoped.

**Citations, isolation, persistence** (enforced per `operations.md`)
- A-027 Citations open the authorized PDF at the cited page. A-028 Unverifiable quotes are never shown as supported.
- A-029 Session A cannot read B's content by naming B's identifiers. A-030 Retrieval is scoped before any evidence reaches the model. A-031 A session ID without its capability returns nothing protected.
- A-032 A READY session survives instance restart without re-upload. A-033 Browser uploads use narrowly scoped private-storage authorization and never see a server secret.
- A-034 Complete deletion → DELETED and access fails. A-035 Partial deletion failure stays DELETING and retryable.
- A-036 `/api/health` is a simple liveness answer. A-037 `/api/ready` returns 503 with a safe failed check when a required dependency is down.
- A-038 No secrets tracked by git. A-039 No server secret reaches the browser bundle.
- A-040 The production smoke flow passes before V1 is frozen (`operations.md` §4).

**Verify & contacts**
- A-041 Verify & Contact is reachable in the workspace (inside Evidence & Actions).
- A-042 A CORE fact silent in every plan stays visible as NOT STATED. A-043 A COMPARATIVE row silent everywhere is hidden. A-044 A COMPARATIVE row with any evidence is shown. A-045 Unsupported HIGHLIGHT rows are not rendered (D-023).
- A-046 NOT STATED core facts, NEEDS VERIFICATION and true conflicts become verify-before-enrolling actions.
- A-047 Contacts are grouped by logical plan. A-048 Every contact resolves to uploaded evidence; no postal address; no lookup. A-049 No contact found → "Contact information not verified"; nothing invented.

**Consistency and export**
- For any selection, overview, table, chat and export never contradict each other on the same validated fact. Export is one immutable snapshot of the selection; no second AI interpretation; All-tiers export keeps tier attribution (UX-22).

**Accessibility and comprehension**
- UX-23 Narrow laptop widths stay legible. UX-24 Containers, selectors, details and evidence are keyboard operable.
- UX-25 Comprehension gate: a first-time user correctly answers the five
  questions — can I use this; what might I pay; what is covered or excluded;
  how do the plans differ; what must I confirm — without material false
  assumptions. Recorded as human evidence, never as an automated pass.

**Real-document acceptance case (Doc A, a student travel-medical plan; identity in `REAL_FIXTURES_DIR`):** age 25, F-1 STEM
OPT, US residence, Cleveland OH, 2026-10-23 → 2026-10-31. Expected: residence
conflict prominent; no final eligibility claim; deductibles shown as
selectable; age and network qualifiers kept; missing premium unknown; specific
verification questions; every material statement cited. **Blocked** until an
authorized copy of that PDF is available locally.
