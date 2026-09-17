# Feature Specification: Insurance Plan Comparison

**Feature Branch**: `001-insurance-plan-comparison`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Build Insurance Simplified. A user uploads 2-4 insurance documents (PDFs) and provides basic context (age, country/residency, visa/status if relevant, location, coverage dates) — only using a context field if the uploaded documents make it relevant. The system extracts ~20-30 comparable facts per set of documents (deductible, out-of-pocket maximum, emergency care coverage, prescriptions, pre-existing conditions, eligibility, network) with exact page-level citations. It displays a side-by-side comparison table where each cell can be clicked to reveal its source page and exact quote. Different values across different plans are normal comparison data and stay SUPPORTED. When one plan contradicts itself on a fact under the same scope, it flags this as CONFLICTED and shows both contradicting values with their sources. When a fact isn't mentioned anywhere, it's flagged NOT STATED. A chatbot side panel lets the user ask questions about the uploaded plans and receives answers with citations, or an explicit refusal if no evidence exists. The system also proactively suggests questions the user should ask their insurer based on gaps or ambiguities it found. If the user has no documents yet, a guided flow collects their context and produces a checklist of what to look for and which documents to collect, then routes them back to upload once they have them."

## Clarifications

### Session 2026-09-16

- Q: How long should uploaded insurance documents and their extracted data be kept after the comparison is done? → A: Keep only for the active session and delete on close unless the user explicitly saves (Option B).
- Q: When should a comparison row use DOES NOT APPEAR TO FIT instead of the other verdict states? → A: When the user's context (e.g. age, location, visa status) rules the fact out for them (Option B).
- Q: Which document and interface languages must the first version support? → A: English documents and interface only (Option A).
- Q: What does explicitly saving a comparison mean when there are no accounts? → A: Downloadable export file the user keeps themselves (Option A).
- Q: When should a fact be marked NEEDS VERIFICATION rather than SUPPORTED? → A: When the statement is vague, partial, or missing qualifiers (Option A).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload documents and view comparison table (Priority: P1)

A user with 2–4 insurance PDFs uploads them, provides basic context (age,
country/residency, visa/status if relevant, location, coverage dates), and
receives a side-by-side comparison table of ~20–30 comparable facts
(deductible, out-of-pocket maximum, emergency care, prescriptions,
pre-existing conditions, eligibility, network, and similar) with exact
page-level citations. Each row carries one of the five verdict states
(SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED,
NEEDS VERIFICATION) — never a bare yes/no.

**Why this priority**: This is the core value of the product. Without
extraction plus the comparison table, nothing else functions.

**Independent Test**: Can be fully tested by uploading 2 sample PDFs with
context and verifying a complete table of comparable facts appears with
verdicts and citations. Delivers standalone comparison value without chat.

**Acceptance Scenarios**:

1. **Given** a user has 2 valid PDFs and basic context, **When** they complete
   upload, **Then** the system extracts comparable facts and displays a
   side-by-side table with one of the five verdict states per row and
   page-level citations.
2. **Given** one plan makes two incompatible claims about a fact under the
    same scope (same document, same qualifiers), **When** the table renders,
    **Then** that row is flagged CONFLICTED and shows both contradicting
    values with their sources.
3. **Given** a fact is mentioned in no uploaded document, **When** the table
   renders, **Then** that row is flagged NOT STATED.
4. **Given** a fact value carries qualifiers (e.g. in-network vs.
   out-of-network amounts), **When** displayed, **Then** all qualifiers are
   preserved exactly as stated, never collapsed to a single number.

---

### User Story 2 - Inspect evidence behind any cell (Priority: P1)

A user clicks any comparison-table cell to reveal the source document, page
reference, and exact quote the value was drawn from, so they can verify
accuracy themselves.

**Why this priority**: Trust in the comparison depends entirely on
verifiability. Citations are a constitutional non-negotiable.

**Independent Test**: Can be fully tested by clicking cells in a completed
table and confirming the evidence panel shows document, page, and exact
quote. Delivers verification value independently of chat.

**Acceptance Scenarios**:

1. **Given** a completed comparison table, **When** the user clicks any
   populated cell, **Then** an evidence view shows the source document, page
   reference, and exact quote.
2. **Given** a CONFLICTED row, **When** the user inspects evidence, **Then**
    both contradicting values appear, each with its own source and quote.

---

### User Story 3 - Ask questions in chatbot side panel (Priority: P2)

A user asks free-form questions about the uploaded plans in a chatbot side
panel and receives answers grounded in the documents with citations, or an
explicit refusal when no supporting evidence exists.

**Why this priority**: Q&A explains and explores the comparison, but it
depends on Story 1 output existing first.

**Independent Test**: Can be fully tested by asking questions against an
uploaded document set and confirming cited answers plus refusal behavior.
Delivers explanation value on top of the table.

**Acceptance Scenarios**:

1. **Given** uploaded documents contain the answer, **When** the user asks a
   question, **Then** the chatbot answers using only document evidence and
   includes citations.
2. **Given** no uploaded document contains supporting evidence, **When** the
   user asks a question, **Then** the chatbot explicitly refuses, stating the
   documents contain no supporting evidence, rather than guessing.

---

### User Story 4 - Receive suggested insurer questions (Priority: P2)

A user views proactively suggested questions they should ask their insurer,
generated from gaps, ambiguities, or genuine same-plan/same-scope
contradictions found in their documents.

**Why this priority**: Turns detected uncertainty into actionable next steps;
depends on extraction results from Story 1.

**Independent Test**: Can be fully tested by uploading documents with known
gaps and confirming the suggested-questions list references those gaps.
Delivers guidance value independently of the chatbot.

**Acceptance Scenarios**:

1. **Given** the comparison contains NOT STATED, CONFLICTED, or
   NEEDS VERIFICATION rows, **When** the user views suggestions, **Then** the
   system lists concrete questions tied to those specific gaps.
2. **Given** a suggested question, **When** the user reads it, **Then** it
   references which fact and document(s) motivated it.

---

### User Story 5 - Guided no-documents checklist flow (Priority: P3)

A user with no documents yet walks through a guided flow: they provide their
context and receive a checklist of what to look for and which documents to
collect, then are routed back to upload once they have them.

**Why this priority**: Onboards users who arrive empty-handed; valuable but
not required for the core comparison loop.

**Independent Test**: Can be fully tested by entering the flow with no
documents, providing context, and receiving a checklist plus a path back to
upload. Delivers onboarding value standalone.

**Acceptance Scenarios**:

1. **Given** a user with no documents, **When** they enter the guided flow and
   provide context, **Then** the system produces a checklist of what to look
   for and which documents to collect.
2. **Given** the user completes the checklist flow, **When** they indicate
   they have documents, **Then** the system routes them to the upload step.

---

### Edge Cases

- What happens when a user uploads fewer than 2 or more than 4 documents?
  System rejects with a clear message stating the 2–4 document requirement.
- What happens when an uploaded file is not a readable PDF (scanned image
  without text, corrupted, encrypted, or wrong type)? System reports which
  file failed and why, and does not produce a partial silent comparison.
- How does the system handle a context field the documents never reference
  (e.g. visa status in a domestic plan)? It ignores that field for verdicts
  and does not fabricate relevance.
- How does the system handle vague, partial, or qualifier-missing facts? It
  assigns NEEDS VERIFICATION with the ambiguous evidence shown, never a
  bare guess or SUPPORTED.
- What happens when the chatbot retrieves nothing relevant? It refuses
  explicitly rather than answering from general knowledge.
- What happens when extraction finds zero comparable facts? System reports
  failure with reasons instead of rendering an empty table.
- What happens when the user closes the session without explicitly saving?
  All uploaded documents and extracted data are deleted. Saving means
  downloading an export file; there is no server-side saved state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept 2–4 English PDF document uploads per
  comparison set and reject sets outside that range with a clear message.
- **FR-002**: System MUST collect basic user context (age, country/residency,
  visa/status if relevant, location, coverage dates) alongside uploads.
- **FR-003**: System MUST use a context field in verdicts only when the
  uploaded documents make it relevant; otherwise it MUST ignore it.
- **FR-004**: System MUST extract ~20–30 comparable facts per document set
  covering at minimum deductible, out-of-pocket maximum, emergency care
  coverage, prescriptions, pre-existing conditions, eligibility, and network.
- **FR-005**: Every comparison row MUST carry exactly one of five states —
  SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED,
  NEEDS VERIFICATION — and MUST NOT use a bare yes/no. DOES NOT APPEAR TO
  FIT applies when the user's context (e.g. age, location, visa status) rules
  the fact out for them, even if a document states it.
- **FR-006**: Every extracted fact value MUST preserve all qualifiers exactly
  as stated (network tier, time period, age band, conditions) and MUST NOT
  collapse them (e.g. "$250 in-network / $500 out-of-network" never becomes
  "$250").
- **FR-007**: Every populated comparison cell MUST link to its evidence:
  source document, page-level reference, and exact quote.
- **FR-008**: System MUST display a side-by-side comparison table with one
  column per uploaded document plus a fact row label and verdict column.
- **FR-009**: Clicking any populated cell MUST reveal its source document,
  page reference, and exact quote.
- **FR-010**: When a single plan makes two incompatible claims about a fact
  under the same scope (same document, same qualifiers such as planTier,
  networkTier, period, ageBand, and conditions), the system MUST flag the row
  CONFLICTED and show each contradicting value with its own source. Different
  values across different plans are normal comparison data and MUST be
  SUPPORTED, never CONFLICTED.
- **FR-011**: When a fact appears in no uploaded document, the system MUST
  flag it NOT STATED.
- **FR-012**: System MUST provide a chatbot side panel that answers questions
  exclusively from uploaded-document evidence with citations.
- **FR-013**: Chatbot MUST explicitly refuse (stating no supporting evidence
  exists in the documents) when retrieval finds nothing relevant, and MUST
  NOT guess or use outside knowledge.
- **FR-014**: Fact extraction and RAG-based Q&A MUST run as separate paths;
  extraction builds the comparison table and RAG only explains/answers — they
  MUST NOT be merged into a single model call.
- **FR-015**: System MUST generate suggested insurer questions derived from
  detected gaps (NOT STATED), genuine same-scope contradictions
  (CONFLICTED), and ambiguities
  (NEEDS VERIFICATION), each tied to its motivating fact.
- **FR-016**: System MUST provide a guided no-documents flow that collects
  context and produces a checklist of what to look for and which documents to
  collect, then routes the user back to upload.
- **FR-017**: System MUST NOT recommend external plans, rank insurers, or
  consult any insurer/plan database; it compares only uploaded documents.
- **FR-018**: System MUST report unreadable or invalid uploads per file (which
  file, why it failed) and MUST NOT silently produce partial comparisons.
- **FR-019**: System MUST retain uploaded documents and extracted data only
  for the active session and delete them on session close, unless the user
  explicitly saves the comparison as a downloadable export file they keep
  themselves.

### Key Entities

- **Uploaded Document**: A user-supplied PDF; attributes include document ID,
  filename, page count, and processing status.
- **User Context**: Basic background (age, country/residency, visa/status if
  relevant, location, coverage dates); used only when documents make a field
  relevant.
- **Comparable Fact**: A named comparison dimension (e.g. deductible);
  attributes include fact name, per-document value with qualifiers, and
  page-level evidence.
- **Comparison Verdict**: Exactly one of the five states per row, with
  supporting evidence or stated absence of evidence. SUPPORTED means the
  fact has cited, usable evidence — different values across different plans
  stay SUPPORTED. CONFLICTED means one plan contradicts itself under the
  same scope. DOES NOT APPEAR TO FIT
  means the user's context rules the fact out for them; NEEDS VERIFICATION
  means the statement is vague, partial, or missing qualifiers.
- **Evidence Citation**: Source document ID, page/section reference, and exact
  quote backing a cell value or chat answer.
- **Chat Exchange**: A user question plus the cited answer or explicit
  refusal, scoped to the current document set.
- **Insurer Question**: A suggested follow-up question tied to a specific gap,
  genuine same-scope contradiction, or ambiguity in the comparison.
- **Collection Checklist**: Guidance output of the no-documents flow listing
  what to look for and which documents to collect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can go from upload of 2–4 PDFs to a complete comparison
  table in under 5 minutes.
- **SC-002**: 100% of populated comparison cells reveal source document, page
  reference, and exact quote on click.
- **SC-003**: 100% of comparison rows carry exactly one of the five allowed
  verdict states; zero rows show a bare yes/no.
- **SC-004**: 90% of test users successfully verify at least one table value
  against its cited source on first attempt.
- **SC-005**: 100% of chatbot questions with no supporting evidence receive an
  explicit refusal rather than a guessed answer (measured on an
  evidence-absence test set).
- **SC-006**: Users with no documents reach an actionable collection checklist
  in under 3 minutes.

## Assumptions

- Users upload text-extractable English PDFs; non-English documents are out
  of scope for this version. Scanned images without text layers are reported
  as unreadable rather than OCR-processed.
- The ~20–30 fact list is a target range; exact count varies with document
  content, but the seven named categories are always attempted.
- One comparison session equals one document set (2–4 PDFs); uploads and
  extracted data are deleted on session close unless the user downloads an
  export file. Cross-session history and accounts are otherwise out of scope
  for this feature.
- No external insurer data, plan recommendations, or rankings are in scope;
  the system compares uploads only, per the constitution.
- Guided checklist output is advisory text, not professional insurance advice;
  the system suggests what to ask and collect, not what to buy.
