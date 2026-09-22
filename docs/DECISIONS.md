# DECISIONS — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file is the V1 architecture/product decision index.

Each accepted decision includes a revisit trigger.

A revisit trigger is evidence that earns the right to reopen the decision.

---

# D-001 — User-Document-First Product

**Decision:** V1 works from user-supplied insurance documents.

**Not included:** market-wide plan discovery/catalog crawling.

**Why:** evidence freshness, trust, provenance, and comparison are already the core product problem.

**Revisit when:** plan discovery becomes an explicit product requirement with a defined source/freshness/legal model.

---

# D-002 — Three-Page Primary Journey

**Decision:**

```text
Welcome
→ Intake
→ Results Workspace
```

Understand, Compare, Ask, and Verify are capabilities of the Results Workspace, not separate top-level pages.

**Revisit when:** usability evidence shows the workspace is too dense to remain one coherent task surface.

---

# D-003 — Two Entry Paths

**Decision:**

```text
I have my documents
I don't know where to start
```

The no-document path produces requirements/checklist guidance only.

**Revisit when:** approved product scope includes external plan discovery.

---

# D-004 — Minimal User Context

**Decision:** collect only context that can materially affect eligibility/requirements/comparison.

No name, phone, or email in V1.

**Revisit when:** a concrete feature requires identity/contact data and privacy impact is reviewed.

---

# D-005 — Evidence Is the Trust Boundary

**Decision:** no material supported insurance claim without traceable source evidence.

**Revisit when:** never for V1; this is a product trust rule.

---

# D-006 — Plan and Tier Are Separate Concepts

**Decision:** a document is not automatically a plan, and a plan may contain multiple tiers.

Tier selection changes presentation scope, not source evidence.

**Revisit when:** source documents prove the current model cannot represent real plan structures.

---

# D-007 — Five Results Sections

**Decision:**

```text
Essentials
Care & Coverage
Rules & Restrictions
Plan Highlights
Verify & Contact
```

Essentials is the default/highest-priority section.

Verify & Contact surfaces unresolved items and plan contact information
inside the workspace; it is not a separate page.

**Revisit when:** user testing shows a different grouping measurably improves comprehension.

---

# D-008 — Missing Context Is Requested Inline

**Decision:** when a result needs information not collected initially, show `NEEDS YOUR INPUT` and ask only for the missing context.

Do not restart intake.

**Revisit when:** the number of late context prompts becomes frequent enough to justify moving a field into the core intake.

---

# D-009 — Supabase Owns Durable State

**Decision:**

```text
PostgreSQL = structured state
Storage = original PDF bytes
pgvector = derived semantic index
```

**Rejected:** second database, separate vector DB.

**Revisit when:** measured query/scale/availability requirements exceed the current service.

---

# D-010 — Google Cloud Run Is Production Compute

**Decision:** deploy one Dockerized Next.js application to Cloud Run as stateless compute.

**Rejected:** Starkwolf/Hetzner for this flagship, Kubernetes, multiple microservices.

**Revisit when:** measured workload requires a different execution model or the cost constraint invalidates Cloud Run.

---

# D-011 — Direct Private PDF Upload

**Decision:** browser uploads PDF bytes directly to private Supabase Storage using narrowly scoped authorization; Cloud Run controls intent/registration.

**Rejected:** routing all large PDF bytes through the application by default.

**Revisit when:** security/product constraints require server-mediated byte streaming.

---

# D-012 — Managed Production Embeddings

**Decision:** production embeddings use Cloudflare Workers AI with the approved Qwen3 embedding model and 1024-dimension contract.

Local development may use Ollama behind the same adapter.

**Revisit when:** provider quality, availability, model availability, privacy, or cost changes materially.

---

# D-013 — Semantic pgvector Retrieval Is the Production Default

**Decision:** session-scoped semantic retrieval is the default production retrieval path.

**Not enabled by default:** BM25, FTS, RRF, reranker.

**Why:** evaluation did not justify extra production complexity.

**Revisit when:** held-out evaluation shows a measurable retrieval gap that a candidate method improves.

---

# D-014 — Deterministic Truth Outside the LLM

**Decision:** eligibility checks, numeric calculations, conflict logic, citation verification, and other deterministic rules do not rely solely on unconstrained LLM output.

**Revisit when:** never as a blanket removal; individual rules may evolve with tests.

---

# D-015 — Anonymous V1 Session Boundary

**Decision:** no end-user auth UI in V1.

Each comparison is protected by an anonymous high-entropy session capability and server-side object-level scope.

**Revisit when:** saved accounts, cross-device history, teams, or authenticated ownership become product requirements.

---

# D-016 — No Queue / Separate Worker in V1

**Decision:** processing remains inside the approved Cloud Run application topology.

**Rejected for now:** queue and separate worker service.

**Revisit when measured behavior proves that work must survive independently of the request, requires durable retry ownership, or cannot reliably fit the chosen execution model.

---

# D-017 — No Redis / Kubernetes / Second Vector DB

**Decision:** these are not V1 components.

**Revisit when:** a measured bottleneck/failure creates a responsibility that cannot be solved cleanly with the approved components.

---

# D-018 — Production State Must Survive Instance Loss

**Decision:** anything needed by a future request is durable outside Cloud Run local memory/filesystem.

**Revisit when:** never for production cross-request state.

---

# D-019 — Provider-Neutral LLM / Embedding Seams

**Decision:** provider-specific details stay behind adapters.

**Why:** local and production providers may differ without changing domain logic.

**Revisit when:** a provider-specific capability becomes a deliberate product dependency and is approved as such.

---

# D-020 — Zero-New-Spend Preference

**Decision:** prefer free-tier/zero-new-spend operation for portfolio/demo usage.

No AI coding tool may silently introduce a paid service.

**Revisit when:** the owner explicitly approves a paid dependency or billing exposure.

---

# D-021 — AI Implements, Human Owns Architecture

**Decision:** OpenCode may make local implementation decisions but may not silently add/remove boxes/arrows, change state ownership, auth model, deployment topology, or product flow.

**Revisit when:** never as an implicit AI decision; architecture changes require human approval.

---

# D-022 — Citation/Evidence Contract Is Protected

**Decision:** original-document page evidence and deterministic citation verification remain a protected product contract.

**Revisit when:** a replacement preserves or improves verifiability and is explicitly approved.

---

# D-023 — Row Visibility Classes and Derived Verify & Contact

**Decision:** comparison rows carry a visibility class:

```text
CORE: always visible; all-plans-silent renders NOT STATED
COMPARATIVE: visible when at least one plan has evidence; hidden when all plans are NOT STATED
HIGHLIGHT: visible only when supported; never renders NOT STATED
```

NOT STATED is never globally suppressed: CORE rows keep showing it.

Verify & Contact is derived from existing session/plan/document/fact/evidence
state. No new service, table, or persistence architecture is introduced for it.

Plan contacts (email, phone, website only) come exclusively from uploaded
documents, are grouped by logical plan rather than by document, and keep
source document/page evidence. Nothing is invented, searched, or looked up
externally.

Conflict keeps its locked meaning: incompatible claims about the same fact
within the same relevant plan/source scope. Normal cross-plan differences
are not conflicts.

**Revisit when:** visibility hiding is shown to conceal decision-relevant
absences, or contact evidence cannot be represented in existing state.
