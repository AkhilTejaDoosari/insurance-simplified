# Decisions — why the rules are what they are

Status: Authoritative decision log · Format unchanged since V1 (D-001…D-026
keep their original wording as history). The **current rule** always lives in
the owning document (`product`, `architecture`, `evidence-core`, `experience`,
`quality`, `operations`); a decision explains why. Add new entries at the end with **Status: Proposed** until the owner accepts them;
mark replaced entries "superseded by D-0xx" instead of editing them.

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

**Status: superseded by D-024 for V1 grouping; retained as decision history.**

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

No local model runtime in any environment (owner decision 2026-11-21,
cloud-only inference; replaces "local development may use Ollama"). The
Cloudflare model `@cf/qwen/qwen3-embedding-0.6b` matched the stored
`qwen3-embedding:0.6b` vectors (cosine ≥ 0.99) before the switch, so stored
vectors stay valid.

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

---

# D-024 — One-to-Five Documents and Evidence-Grounded Organization

**Decision:** An owner-approved V1 product revision supersedes the former
2–4-document minimum and D-007's mandatory fixed sections. One PDF gets a
document-specific insurance explanation, including internal tier comparison
when relevant; 2–5 PDFs get a side-by-side comparison. The owner has approved
a maximum of five PDFs per session. AI may organize and
rank validated facts into document-specific groups, retain unique features,
and use supplied context to prioritize, but cannot create facts, evidence,
eligibility outcomes, or coverage from missing information. Verify & Contact
remains available as a capability; it need not be a fixed tab.

**Rollout:** Phase P1 implements 1–5 PDFs and one-PDF understanding. Phase P2
implements dynamic organization only after separate human approval. During
Phase P1, existing fixed sections may remain as a transitional UI.

**Revisit when:** real-PDF or user-testing evidence shows group organization
conceals decision-relevant facts or breaks tier/evidence integrity.

# D-025 — Server-side comparison result persistence (0005)

**Decision:** Validated comparison results are persisted server-side in a
`comparison_results` table (migration 0005) keyed by session with a 30-day
`expires_at`, consumed by PDF export by loading the stored record (never
recomputed), and deleted on session close alongside vectors, objects, and the
session row. The browser never receives result rows.

**Rejection considered:** recomputing results at export time or keeping them
only in temp memory — rejected because export must reproduce exactly the
validated evidence that was shown to the user.

**Limitations accepted:** physical expiry deletion is opportunistic (runs on
the next save in any session; no scheduler in V1); legacy local-fallback
result files are not wiped at close time. Supabase backup windows mean
deletion is not immediate physical erasure.

**Revisit when:** a scheduler/queue is approved, or results become
user-owned (longer lifetime, authenticated identity).

# D-026 — Verified schema_migrations exposure; 0006 remediation applied (dev DB)

**Decision:** A direct-SQL + PostgREST audit (2026-10-22) of the development
database confirmed `schema_migrations` has RLS disabled and is readable,
updatable, and deletable by the anon role through PostgREST (verified with
zero-match capability probes; INSERT is privilege-granted though not
live-proven). `TRUNCATE/REFERENCES/TRIGGER` grants to `anon`/`authenticated`
exist on all public tables but are not reachable via PostgREST verbs; the
data plane (`documents/pages/chunks/sessions/comparison_results`) stays
RLS-protected for those roles (anon reads verified empty).

Smallest-safe remediation migration 0006 was applied to the development
database (2026-10-23, UTC) and verified in place:

```sql
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY schema_migrations_select_service ON schema_migrations
  FOR SELECT TO service_role USING (true);
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
```

Rollback (`0006_schema_migrations_lock.down.sql`): disable RLS on
`schema_migrations`, drop the service-SELECT policy, re-grant the three
privileges. Impact: direct psql/postgres-role migration execution is
unaffected (owner bypasses RLS); tmpdir/session runtime queries do not touch
`schema_migrations`.

**Status:** APPLIED to the development database (2026-10-23, UTC) under the
owner's follow-on approval and verified there: RLS enforced, service-role-only
SELECT policy, anon/authenticated row writes proven inert (RLS deny +
privilege denial), revoked `TRUNCATE/REFERENCES/TRIGGER`, ledger intact
(0001–0006). Not part of the V1 commit — the two 0006 files ship as their own
dedicated local security-migration commit. No production rollout has been
decided or performed.

# D-027 — Import ADR-003.2 as the evidence-core contract (component level)

**Status: Proposed (awaiting owner approval)**

**Decision (proposed from the owner's 2026-11-15 cleanup instructions):** ADR-003, ADR-003.1 and ADR-003.2
(owner design records kept in Claude Docs: ADR-003
`https://claude.ai/artifact/Jyg3m5Er2tmsTC3waRcPDf`, ADR-003.1
`https://claude.ai/artifact/9pw2oWrj347rchbwTtpgLn`, ADR-003.2
`https://claude.ai/artifact/4SmeLVYaYHSeaRqvVjpqvf`) define the target Verified
Evidence Core. The architecture is frozen at the component and responsibility
level and summarized in `evidence-core.md` §4. The ADR reference
implementation is **not** production code and never counts as implemented.
The authoritative-exclusion source-binding regression and the three R3
trust-boundary probes become required application acceptance tests TB-1..TB-4.
**Revisit when:** an application test proves a contract element unworkable on
real documents.

# D-028 — Retrieval stores are benchmark-dependent; pgvector improved in place

**Status: Proposed (awaiting owner approval)**

**Decision (proposed from the owner's 2026-11-15 cleanup instructions):** keep Postgres + pgvector. FAISS,
Qdrant, Milvus, Weaviate and other stores are not adopted and are reconsidered
only if FILT-1/RET-1 (`quality.md` §4) show a gap pgvector cannot close.
Making the semantic leg exact per session is a correctness fix compatible with
D-013; enabling hybrid search or a reranker still requires RET-1 evidence and a
D-013 revision.
**Revisit when:** RET-1 or FILT-1 results are available.

# D-029 — Staged release gates: limited pilot, then general release

**Status: Proposed (awaiting owner approval)**

**Decision (proposed from the owner's 2026-11-15 cleanup instructions):** zero S1 errors on ≥30 held-out
documents permits a clearly labelled limited pilot (95 % bound ≤ 9.5 %);
general release requires ≥60 held-out documents (95 % bound ≤ 5 %). Both need
≥10 held-out documents per supported family. Details in `quality.md` §6.
**Revisit when:** the supported document families change.

# D-030 — Structure first; no inferred line ownership

**Status: Proposed (awaiting owner approval)**

**Decision (proposed; from the 2026-11-14 engineering recovery):** plan and
scope attribution comes from document structure (layout tables, closed-grammar
statements) or a labelled plan/fact/value record. The earlier lexical
evidence binder was removed. Governing notes are attached verbatim or the claim
is withheld.
**Revisit when:** a structure-free method shows zero S1 on the validation split
with better recall.

# D-031 — One documentation set and one roadmap

**Status: Proposed (awaiting owner approval)**

**Decision (proposed from the owner's 2026-11-15 cleanup instructions):** eight authoritative documents in
`docs/` plus `AGENTS.md`/`CLAUDE.md`/`README.md`; one roadmap
(`docs/roadmap.md`) replaces PLAN phases, V1.1 milestones, spec-kit and agent
plans; history lives in `docs/archive/` and is not authoritative. Health V1
is finished before auto, pet or home.
**Revisit when:** a document grows past what one reader can hold, or a second
insurance domain is approved.

# D-032 — Per-session storage keys for PDF bytes

**Status: Accepted (owner, 2026-11-20)**

**Decision:** original PDF bytes are stored under a session-scoped key
`sessions/<sessionId>/documents/<documentId>/<aa>/<sha256>.pdf`
(`app/lib/storage/objects.ts` `sessionObjectKeyFor`), never a shared
content-addressed key. Legacy `docs/<aa>/<sha256>.pdf` keys are read-only.

**Why:** object-level authorization (operations.md SEC-2, SEC-5): deleting one
session must never remove another session's copy of the same PDF, and a key
must carry its session scope so access checks cannot be bypassed.

**Evidence:** `tests/integration/persistence-cutover.test.ts` asserts the key
contains the session id, that two sessions uploading byte-identical content get
different keys, and that deleting one session leaves the other's bytes intact
(stricter than the previous shared-key assertion). It runs only with durable
persistence and embeddings configured.
