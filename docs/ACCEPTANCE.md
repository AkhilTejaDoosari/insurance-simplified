# ACCEPTANCE — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

These are V1 acceptance criteria.

A feature is complete when its observable behavior satisfies the relevant Given/When/Then criteria, not merely when code exists.

---

# 2. Welcome

### A-001 — Document path

**Given** a new visitor  
**When** the Welcome page loads  
**Then** they can clearly choose `I have my documents`.

### A-002 — No-document path

**Given** a new visitor  
**When** the Welcome page loads  
**Then** they can clearly choose `I don't know where to start`.

---

# 3. Intake

### A-003 — Combined intake

**Given** the user has documents  
**When** Page 2 loads  
**Then** document upload and core context appear in the same intake flow.

### A-004 — Document count

**Given** no PDFs or more than 5 PDFs
**When** the user tries to compare  
**Then** comparison does not start and the count problem is clearly shown.
**And** a sixth PDF is rejected without removing the five valid selections.

### A-005 — Core context only

**Given** normal V1 intake  
**Then** the product may ask for age, residency/location, visa/status when relevant, and coverage dates  
**And** it does not require name, phone, or email.

### A-006 — Invalid file

**Given** one invalid/unsupported file among selected files  
**When** validation runs  
**Then** the affected file is identified  
**And** valid selections are not silently discarded.

---

# 4. No-Document Path

### A-007 — Checklist, not discovery

**Given** a user without documents  
**When** they complete guided context  
**Then** the product returns requirements/criteria/documents-to-obtain guidance  
**And** does not claim it searched or ranked insurance plans.

### A-008 — Return to document path

**Given** the user later obtains documents  
**When** they choose to upload them  
**Then** previously supplied relevant context is reused where practical.

---

# 5. Processing

### A-009 — Honest processing

**Given** the user presses `Compare my plans`  
**When** processing is running  
**Then** the UI shows a waiting/progress state  
**And** does not display fabricated completed results.

### A-010 — Durable READY

**Given** a session is marked READY  
**Then** required durable document/page/retrieval state exists outside process-local memory.

### A-011 — Partial result

**Given** one document fails while others succeed  
**When** a useful but incomplete comparison can be shown safely  
**Then** the session is PARTIAL  
**And** the UI names what is incomplete.

---

# 6. Results Workspace

### A-012A — One-document understanding

**Given** one usable PDF
**When** processing succeeds
**Then** the workspace explains important evidenced benefits, costs,
eligibility, exclusions, limitations, and material unknowns
**And** tier-specific facts stay on the correct tier
**And** supporting citations open the original PDF.

### A-012B — Multiple-document comparison

**Given** 2–5 usable PDFs
**When** processing succeeds
**Then** comparable facts are shown side by side across discovered plans and
tiers without assuming one PDF equals one plan.

### A-012 — One core workspace

**Given** processing succeeds  
**When** Page 3 loads  
**Then** comparison, tier selection, section navigation, chat, and evidence access exist within the Results Workspace.

### A-013 — Exact section names

**Status: superseded by A-013A for Phase P2. During Phase P1 these existing
sections may remain as transitional navigation.**

**Then** the comparison provides:

```text
Essentials
Care & Coverage
Rules & Restrictions
Plan Highlights
```

### A-014 — Essentials first

**Status: superseded by A-013A for Phase P2; transitional Phase P1 behavior may
retain Essentials as the default.**

**Given** the Results Workspace first opens  
**Then** `Essentials` is the default comparison section.

### A-013A — Document-specific organization (Phase P2)

**Given** validated comparison facts from the user's documents
**When** the workspace renders
**Then** related facts are grouped semantically and prioritized by importance
and supplied context, with unique features retained
**And** every supported value keeps its qualifiers and verified evidence
**And** absent evidence never becomes a noncoverage or ineligibility claim.

### A-015 — Premium/price

**Given** a source document states a premium/price in supported scope  
**When** comparison facts are extracted  
**Then** the value can appear in the relevant group with evidence.

---

# 7. Plan / Tier

### A-016 — Multi-tier plan

**Given** a plan has Basic/Plus/Pro/Platinum tiers  
**When** results load  
**Then** the user can select one tier or `All tiers`.

### A-017 — Tier integrity

**Given** a fact belongs only to `Pro`  
**When** `Basic` is selected  
**Then** the Pro-specific value is not silently displayed as a Basic value.

### A-018 — Tier switch is view-only

**Given** the user changes the tier selector  
**Then** original documents/evidence are not re-uploaded or mutated.

---

# 8. Evidence States

### A-019 — NOT STATED

**Given** a material fact is absent from the relevant evidence  
**Then** the product may show `NOT STATED`  
**And** must not convert it to `No`, `Not covered`, or `Not eligible`.

### A-020 — Different plans are not conflict

**Given** Plan A deductible is $500 and Plan B deductible is $750  
**Then** the system shows normal differing values  
**And** does not mark them `CONFLICTED`.

### A-021 — True conflict

**Given** incompatible claims about the same fact within the same qualifying source scope  
**Then** the result may be `CONFLICTED` and exposes the evidence.

---

# 9. Missing Context

### A-022 — Ask, do not guess

**Given** a deterministic result requires visa/status not yet supplied  
**Then** the product shows a `NEEDS YOUR INPUT` action rather than guessing.

### A-023 — Inline update

**Given** the user supplies requested missing context  
**Then** the session/documents remain intact  
**And** the affected result is re-evaluated  
**And** the user remains in the Results Workspace.

---

# 10. Chat

### A-024 — Grounded answer

**Given** sufficient session-scoped evidence exists  
**When** the user asks a question  
**Then** the response is grounded in that evidence and includes verified citation(s).

### A-025 — Evidence absent

**Given** sufficient evidence does not exist  
**When** the user asks  
**Then** the product returns an explicit semantic refusal/uncertainty outcome.

### A-026 — Outage is not refusal

**Given** the embedding or generation provider is unavailable  
**When** chat cannot complete  
**Then** the response is a technical retryable error  
**And** not a false `documents do not say` refusal.

---

# 11. Citations / Viewer

### A-027 — Correct page

**Given** a displayed citation  
**When** the user opens it  
**Then** the original authorized PDF opens at the cited page.

### A-028 — Citation verification

**Given** the quoted evidence cannot be verified on the claimed page/document  
**Then** the claim is not presented as a valid supported citation.

---

# 12. Isolation / Security

### A-029 — Session A cannot read Session B

**Given** two sessions A and B  
**When** A supplies B's document/evidence identifier  
**Then** the server does not return B's content.

### A-030 — Retrieval scoped before model

**Given** Session A asks a question  
**Then** only A-authorized chunks may be retrieved before any evidence is sent to the model.

### A-031 — Session ID alone is insufficient

**Given** a valid public session ID without the corresponding anonymous capability  
**Then** protected data is not returned.

---

# 13. Persistence / Restart

### A-032 — Instance replacement

**Given** a READY session  
**When** the Cloud Run process is replaced/restarted  
**Then** the user can reload results from durable state without re-uploading.

---

# 14. Upload Architecture

### A-033 — Direct private upload

**Given** an authorized session  
**When** the browser uploads a PDF  
**Then** it uses narrowly scoped private-storage upload authorization  
**And** never receives a server secret key.

---

# 15. Deletion

### A-034 — Complete deletion

**Given** a session deletion request  
**When** all required cleanup succeeds  
**Then** the session becomes DELETED and normal product access fails.

### A-035 — Partial deletion failure

**Given** required cleanup fails  
**Then** the product does not report complete success  
**And** the session remains retryable in DELETING.

---

# 16. Operations

### A-036 — Health

**Given** the process is alive  
**When** `/api/health` is called  
**Then** it returns a simple healthy response without dependency secrets.

### A-037 — Readiness

**Given** a configured required production dependency is unavailable  
**When** `/api/ready` is called  
**Then** it returns HTTP 503 and a safe failed check.

---

# 17. Secrets

### A-038 — Repository

**Then** no `.env.local`, provider API key, Supabase secret key, or database password is tracked by Git.

### A-039 — Browser bundle

**Then** server secrets are not exposed through `NEXT_PUBLIC_*` variables or rendered client data.

---

# 18. Deployment Smoke

### A-040 — Production proof

**Given** the production Cloud Run revision  
**When** the approved smoke flow runs using representative PDFs  
**Then** upload → compare → tier/sections → chat → citation viewer → restart durability → isolation → delete all pass before V1 is frozen.

---

# 19. Verify & Contact

### A-041 — Fifth section

**Given** processing succeeds  
**When** the Results Workspace loads  
**Then** Verify & Contact is accessible in the Results Workspace; Phase P2 need
not render it as a fixed fifth tab.

### A-042 — CORE all-NOT-STATED remains visible

**Given** every compared plan is silent on a CORE fact  
**When** Essentials renders  
**Then** the row remains visible showing `NOT STATED`.

### A-043 — COMPARATIVE all-NOT-STATED row hidden

**Given** every compared plan is `NOT STATED` for a COMPARATIVE fact  
**When** the workspace renders  
**Then** the entire row is hidden.

### A-044 — COMPARATIVE row visible with evidence

**Given** at least one compared plan has meaningful evidence for a COMPARATIVE fact  
**When** the workspace renders  
**Then** the row is visible with per-plan values.

### A-045 — HIGHLIGHT unsupported rows hidden

**Given** no plan supports a HIGHLIGHT candidate  
**When** Plan Highlights renders  
**Then** the unsupported rows are not rendered.

### A-046 — Verify surfaces unresolved items

**Given** CORE facts are `NOT STATED`, material results are `NEEDS VERIFICATION`, or true `CONFLICTED` results exist  
**When** Verify & Contact renders  
**Then** those items are surfaced as verify-before-enrolling actions.

### A-047 — Contacts grouped by logical plan

**Given** uploaded documents describing plans with stated contact methods  
**When** Verify & Contact renders  
**Then** email, phone, and website values are grouped by logical plan, not by document.

### A-048 — Contacts only from uploaded evidence

**Given** Verify & Contact renders  
**Then** every contact value resolves to evidence in an uploaded document  
**And** no postal address is shown  
**And** no web search or external lookup is used.

### A-049 — No invented contact data

**Given** no contact method was found for a plan in the uploaded documents  
**When** Verify & Contact renders that plan  
**Then** it states that no contact information was found  
**And** it does not invent or display contact data.

---

## Final V1 verification run — 2026-10-22 (feat/rag-core)

Executed pre-commit gate record. Skipped checks are reported as SKIPPED and
never counted as passing.

| Gate | Command | Result |
| --- | --- | --- |
| Unit/contract/integration | `npm test` | 564 passed, 6 skipped (2 files skipped: require live credentials / real PDF fixtures) |
| Typecheck | `npx tsc --noEmit` | pass (exit 0) |
| Production build | `npm run build` | pass (compiled successfully) |
| Playwright E2E | `npm run test:e2e` | 5/5 passed |
| Live chat acceptance | `npx tsx scripts/acceptance-chat-live.ts` | 27/27 PASS (live LLM, no fallback; deductibles four tiers with page 3 citation; F-1/OPT non-guarantee with 2 citations; cross-document $0 vs $0–$5,000 swing citing pages 3,2; premium question refused without invented number) |
| Real PDF export acceptance | `npx tsx scripts/acceptance-pdf-export.ts` | 21/21 PASS (both carriers named, F-1 context, no session-id/capability leakage) |
| Whitespace hygiene | `git diff --check` | pass |

Security verification (documented in docs/SECURITY.md §6.1/§17.1):
- `/api/export` rejects missing/wrong/cross-session/expired capabilities
  (tests/unit/export-auth.test.ts, 5/5).
- Database grants/RLS verified by direct SQL + PostgREST probes;
  `schema_migrations` anon read/update/delete capability confirmed and
  remediation migration **0006 drafted but NOT applied** — pending separate
  human approval.
- Durable session close removes session vectors, objects, DB row, and
  comparison result with fail-closed retryable errors.

Known accepted limitations: no scheduled physical-expiry sweep (opportunistic
on save); legacy local-fallback result files are not wiped at close;
anonymous-migration-ledger hardening pending approval. V1 functional
acceptance is recorded; no production-readiness claim is made from these
development-environment checks alone.
