# USER FLOWS — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This document defines the complete V1 user journey for Insurance Simplified.

V1 intentionally keeps navigation small.

The primary document-based experience consists of three pages:

1. Welcome
2. Intake
3. Results Workspace

The Results Workspace is the core product.

Understanding, comparing, asking questions, supplying additional context,
and verifying evidence happen inside that workspace rather than on separate pages.

---

# 2. Primary Navigation

```text
PAGE 1 — WELCOME
│
├── I have my documents
│        ↓
│
│   PAGE 2 — INTAKE
│   Documents + required context
│        ↓
│      Compare
│        ↓
│     Processing
│        ↓
│
│   PAGE 3 — RESULTS WORKSPACE
│
└── I don't know where to start
         ↓
    PAGE 2 — GUIDED INTAKE
         ↓
    Requirements / document checklist
         ↓
    Research externally
         ↓
    Return with documents
         ↓
    Document Intake
         ↓
    PAGE 3 — RESULTS WORKSPACE
```

---

# 3. Page 1 — Welcome

## Purpose

Explain Insurance Simplified in plain language and let the user choose the
correct starting path.

The page should feel helpful rather than corporate or sales-oriented.

## Core Message

Insurance documents contain many details, but only some materially affect a
person's decision.

Insurance Simplified helps the user:

- identify those differences;
- compare them across plans;
- understand uncertainty;
- ask questions;
- verify important claims against the original documents.

## Primary Actions

### I have my documents

For a user who already has 2–4 insurance PDFs.

Leads to:

`Page 2 — Document Intake`

### I don't know where to start

For a user who does not yet have suitable insurance documents.

Leads to:

`Page 2 — Guided Intake`

---

# 4. Page 2A — Document Intake

## Purpose

Collect everything required to begin a meaningful document comparison in one
place.

The page combines:

- document upload;
- essential user context;
- one primary Compare action.

The user should not have to complete separate upload and profile pages.

---

## 4.1 Documents

The user provides:

- minimum 2 PDF documents;
- maximum 4 PDF documents.

Documents may represent different insurance products.

A document may also contain multiple tiers of the same product, such as:

- Basic;
- Plus;
- Pro;
- Platinum.

Tier discovery happens during processing.

The user does not have to manually split a multi-tier source PDF.

---

## 4.2 Core User Context

Ask only for information that may materially affect eligibility,
coverage interpretation, requirements, or comparison.

Core inputs may include:

- age;
- country / residency;
- state when applicable;
- city;
- ZIP / postal code;
- visa or immigration status when relevant;
- desired coverage start date;
- desired coverage end date.

Additional fields may be introduced only when justified by an actual comparison
or eligibility requirement.

Do not request information merely because it could be useful someday.

---

## 4.3 Information Not Required

V1 does not require:

- name;
- phone number;
- email address;
- unrelated personal profile information.

If a value cannot influence the V1 comparison, it should not be collected.

---

## 4.4 Compare Action

Primary CTA:

`Compare my plans`

The action is available when the minimum required documents and core context are
present.

After the user selects Compare:

```text
documents + context
        ↓
processing
        ↓
Page 3 — Results Workspace
```

---

## 4.5 Intake Validation

The page must clearly identify:

- too few documents;
- too many documents;
- unsupported file types;
- oversized documents;
- unreadable PDFs;
- missing required context.

A problem with one field or document must not silently remove valid information
already supplied by the user.

---

# 5. Page 2B — Guided Intake

## Purpose

Help a user who does not yet have suitable insurance documents understand what
they should collect.

This path does not perform insurance-plan discovery.

## User Supplies

Relevant context such as:

- age;
- country / residency;
- visa or status when applicable;
- location;
- coverage period;
- other information required by known requirements.

## Product Produces

A clear summary of:

- relevant insurance requirements;
- important criteria to look for;
- eligibility questions that may matter;
- documents the user should obtain;
- information still unknown.

## External Research

The product clearly tells the user that plan discovery happens elsewhere.

The user may obtain documents from:

- insurer sources;
- school or employer resources;
- brokers;
- search engines;
- other research tools.

Insurance Simplified must not imply that it searched these sources itself.

## Return Path

Once the user obtains suitable documents:

```text
Guided Intake
     ↓
I have my documents
     ↓
Document Intake
     ↓
Compare
     ↓
Results Workspace
```

Previously supplied context should be reused where appropriate.

---

# 6. Processing Transition

Processing is a transition between Intake and the Results Workspace, not a
separate destination page.

The user should see an understandable progress state while the system:

```text
reads documents
→ identifies plan/tier structure
→ extracts comparison facts
→ prepares evidence
→ prepares semantic retrieval
→ builds the comparison
```

The UI should communicate progress in user language rather than infrastructure
terminology.

If processing fails, no fabricated or incomplete result may be presented as a
complete comparison.

---

# 7. Page 3 — Results Workspace

## Purpose

This page is the core value of Insurance Simplified.

Its job is not merely to display extracted document facts.

Its job is to reduce a large number of insurance details into an understandable,
prioritized comparison while preserving access to the underlying evidence.

The user should be able to:

- compare plans;
- select plan tiers;
- move between groups of related information;
- identify the highest-impact differences first;
- see missing or uncertain information;
- provide additional context when needed;
- ask free-form questions;
- verify important claims;
- surface unresolved items before enrolling;
- find plan contact information taken from the uploaded documents.

All of these happen inside one workspace.

---

# 8. Results Workspace Layout

Conceptually:

```text
┌──────────────────────────────────────────────────────┬──────────────────┐
│ PLAN COMPARISON                                      │ ASK YOUR PLANS   │
│                                                      │                  │
│ Plan A      Plan B      Plan C                       │ Chat history     │
│ [Tier ▼]    [Tier ▼]    [Tier ▼]                     │                  │
│                                                      │ cited answers    │
│ Essentials | Care & Coverage | Rules & Restrictions  │                  │
│ | Plan Highlights                                    │ question input   │
│                                                      │                  │
│ Comparison table                                     │                  │
│                                                      │                  │
└──────────────────────────────────────────────────────┴──────────────────┘
```

The comparison is the primary workspace.

Chat is a persistent supporting tool.

---

# 9. Plan and Tier Selection

A plan/product may contain multiple tiers.

Examples:

```text
Plan A
├── Basic
├── Plus
├── Pro
└── Platinum
```

Each multi-tier plan has a tier selector.

Options include:

```text
All tiers
Basic
Plus
Pro
Platinum
```

If the user chooses one tier, the comparison displays that tier.

If the user chooses All tiers, the interface may display all available tiers
for that plan.

Tier selection must not destroy or reprocess the user's underlying documents.

It changes the comparison view.

---

# 10. Comparison Prioritization

Insurance documents contain more facts than a user can reasonably process at
once.

The comparison therefore groups information by decision importance and meaning.

V1 uses four horizontally selectable sections.

---

## 10.1 Essentials

This is the default and highest-priority section.

It answers:

> Can this plan reasonably work for me, and what are the major financial or
> eligibility constraints?

Examples include:

- premium / price when stated;
- annual deductible;
- out-of-pocket maximum;
- provider network;
- general eligibility;
- student / visa eligibility when applicable;
- coverage period;
- important pre-existing-condition rules.

---

## 10.2 Care & Coverage

This section answers:

> What does the plan actually provide when I need healthcare?

Examples include:

- primary care;
- specialist care;
- emergency care;
- hospitalization;
- prescription drugs;
- urgent care;
- mental / behavioral health;
- maternity;
- preventive care;
- laboratory / imaging;
- ambulance;
- dental;
- vision.

---

## 10.3 Rules & Restrictions

This section answers:

> What conditions could prevent me from using the coverage the way I expect?

Examples include:

- referrals;
- preauthorization;
- waiting periods;
- age limits;
- network restrictions;
- geographic restrictions;
- international coverage;
- important exclusions;
- eligibility conditions;
- other usage restrictions.

---

## 10.4 Plan Highlights

This section answers:

> What is unusual or unique about this plan that does not belong in the main
> comparison?

Examples include:

- unique benefits;
- special allowances;
- telehealth or wellness benefits;
- travel-related benefits;
- plan-specific extras;
- unusual limits;
- lower-priority differences;
- plan-specific advantages or restrictions.

This section intentionally comes last because these items normally carry less
decision weight than the Essentials.

---

# 11. Comparison Rows

For each comparison item, the workspace may display:

```text
What matters
Status
Plan A
Plan B
Plan C
```

Values should remain concise enough to compare horizontally.

Long explanations should not turn the table into a report.

Where necessary, the user may open additional detail.

---

# 12. Evidence States

The comparison must preserve explicit uncertainty.

Supported V1 states include:

```text
SUPPORTED
DOES NOT APPEAR TO FIT
NOT STATED
CONFLICTED
NEEDS VERIFICATION
```

A missing value is not automatically a negative result.

Different documents containing different values are not automatically a
conflict.

Evidence-state meaning is defined elsewhere in the product/domain contracts and
must remain consistent throughout the interface.

---

# 13. Additional User Information

Some plan facts cannot be evaluated correctly using only the initial context.

When additional user context is genuinely required, the table should not guess.

Instead, the affected item may display:

```text
NEEDS YOUR INPUT

[Add information]
```

Selecting Add information opens a compact contextual input experience such as a
drawer, popover, or modal.

The product asks only for the missing information required by that comparison.

Example:

```text
Student eligibility

We need your visa/status to evaluate this requirement.

Visa / status
[F-1 ▼]

[Apply]
```

After the information is supplied:

- preserve the current documents;
- preserve the current comparison location;
- reevaluate the affected rule or comparison;
- update the result.

The user should not restart the entire intake flow.

---

# 14. Chat

Chat appears beside the comparison workspace.

It is not a separate page.

## Purpose

Allow the user to ask questions that:

- are already represented somewhere in the comparison but were difficult to
  find;
- require a clearer explanation;
- are not part of the predefined comparison rows;
- require evidence from another part of the uploaded documents.

## Grounded Answer

The system retrieves relevant evidence from the user's uploaded documents and
answers from that evidence.

A supported answer includes source citations.

## Insufficient Evidence

If the uploaded documents do not support an answer, the chat must say so.

It must not invent an insurance fact merely to provide a response.

---

# 15. Evidence Verification

Evidence verification is part of the Results Workspace rather than another
navigation page.

A user may select an evidence-backed value or citation.

The product opens the original source PDF at the relevant page and, when
possible, identifies the supporting passage.

Conceptually:

```text
comparison value / chat claim
        ↓
citation
        ↓
original PDF
        ↓
page
        ↓
supporting evidence
```

The user must be able to verify important claims independently.

---

# 15B. Verify & Contact

Verify & Contact is the fifth Results Workspace section, alongside the four
comparison sections.

It has two responsibilities.

## Verify before enrolling

Surface actionable unresolved items:

- CORE facts that are NOT STATED;
- material NEEDS VERIFICATION results;
- true CONFLICTED results (incompatible claims about the same fact within
  the same relevant plan/source scope — normal differences between plans
  are not conflicts).

## Contact the plan

For each logical plan, show document-derived contact methods:

- email;
- phone;
- website.

Contacts come only from the uploaded documents and are grouped by logical
plan (a plan may be described by multiple documents).

Do not show empty contact fields individually.

If no contact method was found for a plan:

```text
No contact information found in the uploaded documents.
```

Do not show postal addresses.

Do not use web search or external lookup.

Do not invent contact information.

Every displayed contact value must retain its source document and
page/evidence reference.

---

# 16. Results Success Criteria

The Results Workspace succeeds when the user can answer:

```text
Which differences matter most?

What will these plans cost or require?

What care is covered?

What restrictions could affect me?

Which tier am I comparing?

What information is missing?

What requires my additional context?

What is unusual about each plan?

Where did this answer come from?

What should I verify before making a decision?

How do I contact each plan?
```

The product does not need to declare one plan the winner.

The purpose is to turn complex insurance documents into a prioritized,
evidence-grounded comparison the user can understand and verify.

---

# 17. Failure and Partial States

If one document or one comparison fact cannot be processed:

- preserve successful work where safe;
- identify what is incomplete;
- never represent partial processing as complete;
- allow retry where appropriate;
- keep unsupported claims explicitly unresolved.

A dependency failure must not produce fabricated comparison values.

---

# 18. Back Navigation

Back navigation must preserve valid work.

Examples:

```text
Results → Intake
documents remain attached where possible

Guided Intake → Document Intake
previously collected context is reused

Evidence Viewer → Results
the user returns to the same section and tier selection
```

Destructive actions must be explicit.

---

# 19. V1 Navigation Boundary

V1 does not require separate pages for:

- Understand;
- Compare;
- Ask;
- Verify;
- plan details;
- evidence reports.

These are capabilities of the Results Workspace.

The intended top-level navigation remains deliberately small:

```text
Welcome
   ↓
Intake
   ↓
Results Workspace
```

The no-document path branches from Welcome and rejoins the document path once
the user has suitable documents.
