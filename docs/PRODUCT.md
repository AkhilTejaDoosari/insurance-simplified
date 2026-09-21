# PRODUCT — Insurance Simplified

| Status | Version | Owner | Product type |
| --- | --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil | Evidence-grounded insurance-document understanding and comparison |

---

## 1. Primary Actor

A person trying to understand and compare health insurance options from dense,
inconsistent plan documents.

The product is especially useful when the person must evaluate plans under
personal eligibility constraints such as age, country/residency, visa/status,
location, and coverage dates.

The V1 experience is designed for an individual user, not a team or organization.

---

## 2. Primary Job

Help me understand the insurance documents I have, compare the differences that
matter, identify anything I should verify before enrolling, and show me the
source evidence for important claims.

If I do not yet have plan documents, help me understand what requirements matter
for my situation and what documents I need to obtain before I can compare plans.

---

## 3. Trigger

The user opens Insurance Simplified when they:

- have two to four insurance plan documents and are struggling to understand or
  compare them; OR
- need insurance coverage but do not yet know what information or documents they
  should collect before evaluating plans.

---

## 4. V1 Entry Paths

### Path A — I have plan documents

User provides:

- 2–4 insurance PDFs
- relevant personal context needed for eligibility or comparison, such as:
  - age
  - country / residency
  - visa or status when applicable
  - location
  - desired coverage dates
  - other comparison needs explicitly requested by the product

The product then helps the user:

Understand → Compare → Check fit / eligibility → Ask questions → Verify evidence.

### Path B — I do not have plan documents yet

User provides relevant personal context.

The product then:

1. identifies the requirements or criteria that appear relevant;
2. produces a clear checklist of what to look for;
3. explains what plan documents the user should obtain;
4. tells the user to research plan options externally;
5. invites the user to return with plan documents and continue through Path A.

Path B does NOT discover, rank, recommend, or pretend to search available
insurance plans in V1.

---

## 5. Inputs

### Required for Path A

- 2–4 PDF plan documents
- minimum personal context required for the requested comparison

### Required for Path B

- enough personal context to produce a useful requirements checklist

### Source documents may include

- certificates
- summaries of benefits / coverage documents
- brochures
- policy or plan documents
- other user-supplied insurance PDFs

Documents may be incomplete, inconsistent, duplicated, poorly formatted,
contradictory, or missing information.

The system must handle those conditions explicitly rather than assuming the
documents are complete or correct.

---

## 6. Outputs

### For users with documents

The user receives:

- understandable plan summaries;
- a compact side-by-side comparison of high-impact differences;
- deeper comparison categories when requested;
- eligibility / fit indicators supported by available evidence;
- explicit unknown, conflicting, or insufficient-evidence states;
- grounded answers to free-form questions;
- citations linked to the original document and page;
- a "Verify Before Enrolling" view for unresolved or important items.

### For users without documents

The user receives:

- a summary of relevant requirements;
- a checklist of criteria to evaluate;
- a list of documents or evidence they should obtain;
- guidance on what they still need to research elsewhere;
- a clear path back into the document-based comparison flow.

---

## 7. Definition of Success

V1 is successful when a user can:

1. identify the major differences between the uploaded plans;
2. understand which differences may matter for their stated context;
3. distinguish verified information from missing, conflicting, or uncertain
   information;
4. open the original source page for an important claim and verify it themselves;
5. ask a question and receive either an evidence-grounded answer or an explicit
   refusal / uncertainty state when sufficient evidence does not exist.

For the no-document path, success means the user leaves knowing:

- what requirements appear relevant;
- what criteria to evaluate;
- what documents to obtain next.

Success does NOT require the product to choose an insurance plan for the user.

---

## 8. Trust Rules

These rules override convenience, UI polish, and feature completeness.

### Evidence

No material insurance coverage claim may be presented as verified without
traceable supporting evidence from the user's source documents.

### Unknowns

Missing evidence must remain explicit.

The system must not convert:

NOT STATED
INSUFFICIENT EVIDENCE
UNKNOWN

into an assumed answer.

### Conflicts

Contradictory source evidence must remain visible.

The system must not silently choose whichever statement is easiest to present.

### Citations

A displayed citation must resolve to evidence actually present in the supplied
document and must point the user back to the original source.

### Numeric and Rule-Based Decisions

Eligibility checks, requirement checks, scenario calculations, and other
deterministic numeric decisions must not depend solely on free-form LLM
reasoning.

### Retrieval Isolation

Evidence belonging to one user/session must not be exposed to another
user/session or supplied to the model during retrieval.

### Uploaded Documents

Uploaded documents are untrusted input.

Instructions contained inside an uploaded document must never gain authority
over system instructions, permissions, secrets, or other users' data.

### No-Document Honesty

When the system does not have plan documents, it must not pretend that it has
searched, discovered, evaluated, or compared available plans.

---

## 9. Explicit V1 Non-Goals

### Market-wide plan discovery

V1 does not crawl insurers, maintain a plan catalog, or search the insurance
market.

Reason:
The product is user-document-first. Discovery would introduce a separate data
acquisition, freshness, legal, scheduling, and ranking problem.

### Purchasing or enrollment

V1 does not purchase, enroll in, or submit an insurance application.

Reason:
That would introduce financial, identity, compliance, transaction, and support
responsibilities outside the product's current job.

### Medical advice

V1 does not diagnose conditions, recommend treatment, or provide medical advice.

Reason:
The product explains insurance evidence, not healthcare decisions.

### Claims assistance

V1 does not submit, adjudicate, negotiate, or manage insurance claims.

### Insurer recommendation engine

V1 does not decide which carrier or plan a user should purchase.

It may expose evidence, differences, requirements, trade-offs, and unresolved
issues so the user can make their own decision.

### Multi-user workspaces

V1 does not support teams, shared workspaces, brokers managing multiple clients,
or collaborative plan reviews.

### Mobile-first experience

V1 is desktop/laptop-first.

Responsive behavior may exist, but mobile-specific product optimization is not a
V1 requirement.

---

## 10. Product Constraints

### Evidence-first

Preserving source provenance is more important than producing an answer.

### Small comparison set

V1 compares 2–4 user-provided documents at a time.

### Desktop-first

The main product experience is optimized for a desktop/laptop comparison
workflow.

### Solo-build scope

The architecture should remain understandable and operable by one builder.

### Cost

The flagship should be capable of operating within the approved zero-new-spend
or free-tier constraints during portfolio/demo usage.

A paid dependency must not be introduced silently.

### AI Role

AI may explain, extract, summarize, classify, and generate grounded language
within defined boundaries.

AI is not the source of truth for:

- source evidence;
- access control;
- numeric calculations;
- deterministic eligibility rules;
- document ownership;
- citations;
- product requirements.

---

## 11. What This Product Is Not

Insurance Simplified is not:

- an insurance marketplace;
- an insurance carrier;
- a broker;
- an enrollment portal;
- a medical-advice service;
- a generic "chat with PDF" application.

It is an evidence-grounded decision-support system for understanding and
comparing insurance documents.

---

## 12. Product Promise

The product does not promise:

"We will tell you which insurance plan is best."

The product promises:

"We will help you understand what your documents actually say, compare the
differences that matter, show you what is uncertain, and let you verify the
evidence yourself."
