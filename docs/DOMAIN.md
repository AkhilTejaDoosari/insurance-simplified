# DOMAIN — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines the core product vocabulary and the invariants that must remain true regardless of UI, database, cloud provider, or implementation details.

Think of it as:

**important nouns + relationships + rules that must never silently break**

---

## 2. Core Nouns

### Comparison Session

One active insurance-comparison workspace.

It contains the user's context, uploaded documents, comparison results, evidence, and chat activity.

### User Context

Only information that can materially affect eligibility, requirements, or comparison.

Examples:

- age;
- country / residency;
- state;
- city;
- ZIP / postal code;
- visa or immigration status when relevant;
- coverage start and end dates.

User Context is not a profile.

V1 does not require the user's name, phone number, or email address.

### Insurance Document

An original user-supplied PDF.

Examples:

- policy;
- certificate;
- Summary of Benefits and Coverage;
- brochure;
- benefit schedule.

The document is evidence.

It is not automatically the same thing as a plan.

### Plan

A logical insurance product described by one or more source documents.

### Tier

A variation inside a plan.

Example:

```text
Plan
├── Basic
├── Plus
├── Pro
└── Platinum
```

A plan may have one or multiple tiers.

### Comparison Fact

One thing the product knows how to compare across plans.

Examples:

- premium / price;
- deductible;
- out-of-pocket maximum;
- provider network;
- emergency coverage;
- prescription coverage;
- pre-existing-condition rules.

### Evidence

The actual source text from an uploaded document that supports a fact or answer.

Evidence must remain traceable to the original document and page.

### Citation

A user-facing link from a displayed claim or answer back to its supporting evidence.

### Question

A free-form question asked by the user about the uploaded documents.

### Answer

A grounded response supported by evidence from the current comparison session.

If sufficient evidence does not exist, the valid outcome is a refusal or uncertainty state.

---

## 3. Core Relationships

```text
Comparison Session
    │
    ├── User Context
    │
    ├── 1–4 Insurance Documents
    │       │
    │       ├── Pages
    │       └── Plans
    │              └── Tiers
    │
    ├── Comparison Facts
    │       └── Evidence
    │
    └── Questions
            └── Answers
                   └── Citations
```

---

# 4. Invariants

These rules must remain true throughout V1.

## 4.1 A document is not automatically a plan

One document may describe:

- one plan;
- multiple plans;
- one plan with multiple tiers.

Do not assume:

```text
1 PDF = 1 Plan
```

---

## 4.2 A plan may contain multiple tiers

A plan may include:

```text
Basic
Plus
Pro
Platinum
```

Tier-specific facts must remain attached to the correct tier.

A value belonging to one tier must not silently appear under another tier.

---

## 4.3 Tier selection changes the view, not the evidence

Choosing:

```text
All tiers
Pro
Plus
Basic
```

changes what the user sees in the comparison.

It does not change:

- the original PDF;
- the underlying extracted evidence;
- the plan identity.

---

## 4.4 The original PDF remains the source evidence

Extracted text, chunks, vectors, summaries, and generated answers are derived representations.

They do not replace the original uploaded document.

The user must always be able to trace an important supported claim back to the original source.

---

## 4.5 A supported claim requires evidence

A material insurance claim must not be shown as supported unless qualifying source evidence exists.

No evidence means the product must use an uncertainty or refusal state.

---

## 4.6 NOT STATED does not mean NO

If a source does not state something, the product must not convert absence into a negative claim.

```text
NOT STATED
≠
NOT COVERED
≠
NOT ELIGIBLE
≠
NO
```

---

## 4.7 Different plan values are not a conflict

Example:

```text
Plan A deductible = $500
Plan B deductible = $750
```

This is normal comparison data.

It is not `CONFLICTED`.

`CONFLICTED` is reserved for incompatible claims about the same fact within the same relevant source scope.

---

## 4.8 Missing user context must not be guessed

If a fact cannot be evaluated without additional user information:

```text
missing context
→ ask user
→ reevaluate affected result
```

Do not invent a value.

Example:

```text
Student eligibility requires visa/status
→ NEEDS YOUR INPUT
```

---

## 4.9 Context fields must earn their place

The product should collect only information that can materially affect the comparison.

If a field does not influence:

- eligibility;
- requirements;
- coverage interpretation;
- comparison;

it should not be collected in V1.

---

## 4.10 Session isolation is mandatory

Evidence belonging to one comparison session must never be retrieved, displayed, or sent to a model while serving another session.

Isolation must happen before retrieval, not after generation.

---

## 4.11 Citations must resolve to real evidence

A citation is valid only when the supporting evidence exists in:

- the claimed document;
- the claimed page.

If the evidence cannot be confirmed, the citation must not be presented as valid.

---

## 4.12 Missing evidence must remain explicit

The product must preserve uncertainty.

Supported V1 evidence states include:

```text
SUPPORTED
DOES NOT APPEAR TO FIT
NOT STATED
CONFLICTED
NEEDS VERIFICATION
```

The system must not silently upgrade uncertainty into certainty.

---

## 4.13 SUPPORTED does not mean recommended

`SUPPORTED` means:

> the displayed statement is supported by evidence.

It does not mean:

- best;
- recommended;
- cheapest;
- safest;
- right for everyone.

---

## 4.14 The product does not need to declare a winner

Insurance Simplified provides evidence-grounded comparison and decision support.

It does not need to automatically choose one plan as the winner.

---

## 4.15 Numeric and rule-based decisions must remain deterministic

Eligibility checks, requirement checks, and numeric comparisons must not depend only on unconstrained LLM reasoning.

AI may explain results.

AI is not the sole authority for deterministic product rules.

---

## 4.16 The no-document path does not discover plans

When the user has no documents, the product may:

- collect context;
- explain relevant requirements;
- provide a checklist;
- tell the user what documents to obtain.

It must not pretend to search, rank, or discover insurance plans in V1.

---

## 4.17 Plan contact information is plan-scoped, document-evidenced

Contact information (email, phone, website) belongs to a logical plan, which
may be described by multiple documents.

A displayed contact value is valid only when supporting evidence exists in an
uploaded document, with the source document and page traceable exactly like
any other citation.

Contact information is never invented, searched, or looked up externally.

---

## 4.18 Organization is derived, not insurance truth

One PDF can be understood on its own or compared across its tiers. For 2–4
PDFs, comparable facts can be grouped across plans and tiers. AI-generated
group labels and ordering refer only to stable, validated fact/evidence IDs.
Unique supported features and missing/uncertain facts remain visible where
decision-relevant. Grouping never upgrades an unsupported claim to SUPPORTED.

---

# 5. Minimal Lifecycle

## Comparison Session

```text
DRAFT
  ↓
PROCESSING
  ↓
READY / PARTIAL / FAILED
```

### DRAFT

Documents and context are still being supplied.

### PROCESSING

The system is preparing the comparison.

### READY

The comparison is usable.

### PARTIAL

Some useful results exist, but something is incomplete or unresolved.

The user must be told what is missing.

### FAILED

A safe usable comparison could not be produced.

The product must not fabricate a result.

---

## Insurance Document

```text
REGISTERED
    ↓
PROCESSING
    ↓
READY / FAILED
```

A document must not be marked `READY` merely because upload succeeded.

It must be usable for the comparison flow.

---

## Question

```text
SUBMITTED
    ↓
RETRIEVING
    ↓
ANSWERED / REFUSED / FAILED
```

`REFUSED` is a valid product outcome when the documents do not contain enough evidence.

It is different from a technical `FAILED` state.

---

# 6. Domain Boundary

V1 includes:

```text
Comparison Session
User Context
Insurance Document
Plan
Tier
Comparison Fact
Evidence
Citation
Question
Answer / Refusal
```

V1 intentionally does not include:

```text
Insurance marketplace
Plan catalog
Broker
Enrollment transaction
Payment
Claim processing
Medical diagnosis
Team workspace
Automatic plan winner
```

Those concepts are outside the current product responsibility.
