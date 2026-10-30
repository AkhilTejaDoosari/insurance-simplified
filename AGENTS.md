# AGENTS — Insurance Simplified

This file is the execution contract for OpenCode and other AI coding tools working in this repository.

AI implements the approved system.

AI does not silently redesign the approved system.

---

# 1. Read Before Editing

Before any implementation task, read the relevant human-owned sources of truth:

```text
docs/PRODUCT.md
docs/USER_FLOWS.md
docs/DOMAIN.md
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/API.md
docs/SECURITY.md
docs/RELIABILITY.md
docs/OBSERVABILITY.md
docs/DEPLOYMENT.md
docs/REPO_MAP.md
docs/DECISIONS.md
docs/ACCEPTANCE.md
PLAN.md
```
When documents conflict:

1. stop;
2. report the conflict;
3. do not choose an architecture/product interpretation silently.

---

# 2. Architecture Rule

If a proposed change would add/remove/change a box or arrow in `ARCHITECTURE.md`, it requires explicit human approval.

Examples requiring approval:

```text
add Redis
add queue/worker
add second database
add Pinecone/Qdrant
add Kubernetes
change Cloud Run target
change state ownership
change anonymous-session authorization model
add a public endpoint with new trust implications
move work to background infrastructure
add a load-bearing provider
change the user-visible top-level flow
weaken validation/authorization
```

Do not hide architecture changes inside a refactor.

---

# 3. Locked V1 Runtime Components

Approved:

```text
Browser
Google Cloud Run / Dockerized Next.js application
Supabase PostgreSQL
Supabase pgvector
Supabase private Storage
Cloudflare Workers AI embeddings
configured generation LLM provider
```

Not approved for V1:

```text
Redis
Kafka
separate queue
separate worker service
Kubernetes
Pinecone
Qdrant
second application database
production Ollama
Starkwolf/Hetzner deployment
market crawler
plan catalog
microservice split
```

---

# 4. Product Rules That Must Not Drift

Preserve:

```text
Welcome → Intake → Results Workspace

1–5 user documents: one PDF explains its terms and may compare tiers;
2–5 PDFs compare plans and tiers

no-document path = checklist/guidance, not plan discovery

document-specific, AI-organized groups over stable structured facts and evidence;
no mandatory fixed comparison sections

AI may discover and rank relevant factors, but cannot invent coverage,
eligibility, qualifiers, or evidence

plan != document
plan may have multiple tiers

NOT STATED != NO

different plan values != CONFLICTED

missing context → ask user, never guess

supported material claim → verified source evidence

session scope before retrieval/model

no automatic plan winner required
```

The previous 2–4 minimum and mandatory four-section layout were superseded
by the owner's approved V1 product revision. The owner has since approved a
maximum of five PDFs per session. Phase P1 implements the one-PDF path; Phase
P2 (dynamic grouping) requires separate phase approval.

---

# 5. Evidence Contract Is Protected

Do not weaken or bypass:

- page provenance;
- citation verification;
- original PDF viewer;
- evidence IDs;
- fail-closed ambiguous/wrong-page citation behavior;
- material-value verification rules.

If an implementation change would break existing evidence links or change their semantics, stop and report it.

---

# 6. Inspect Before Implementing

For every PLAN phase:

```text
1. inspect current code
2. inspect git status
3. identify existing compatible implementation
4. classify:
   EXISTS
   PARTIAL
   MISSING
   CONFLICT
5. implement only the smallest missing delta
```

Do not replace working code merely because another design is cleaner.

---

# 7. Current Repository Is Evidence, Not Authority Over the Locked Design

Existing code may predate the final product/architecture decisions.

Therefore:

```text
code differs from locked docs
→ report the delta
→ change code if the phase authorizes it
```

Do not silently rewrite locked docs to justify existing code.

Human-owned docs change only with explicit approval.

---

# 8. No Secret Exposure

Never print, echo, commit, summarize, or paste real values from:

```text
.env.local
API keys
database passwords
Supabase secret/service keys
signed URLs
session capabilities
```

You may inspect variable names without exposing values.

`.env.local` is local-only and gitignored.

`.env.example` contains safe placeholders only.

---

# 9. Environment Rule

Coding-tool/provider credentials are not application runtime dependencies.

Do not add OpenCode, Claude, Gemini coding credentials/models to application runtime env merely because they were used to write code.

Runtime env is defined by `DEPLOYMENT.md`.

---

# 10. Git / Remote Safety

Without explicit human approval, do not:

```text
git push
open a PR
merge a PR
force push
delete a branch
create a release/tag
deploy
change cloud resources
enable billing
rotate production secrets
```

Local commits are allowed only when the user/phase explicitly authorizes them.

Before staging, inspect the exact file list.

Never stage unrelated `.omo`, `.opencode`, logs, evidence, secrets, or experimental files accidentally.

---

# 11. Phase Discipline

Execute `PLAN.md` one phase at a time.

Do not continue into the next phase automatically.

At the end of each phase:

- run required checks;
- report files changed;
- report architecture diff;
- report unresolved risks;
- stop for approval.

---

# 12. Test Expectations

Use the cheapest useful tests first.

Typical gate:

```text
focused unit/contract tests
npm test
npx tsc --noEmit
npm run build
npm run test:e2e when flow changed
docker build when runtime/deployment changed
```

Provider integration tests must clearly state when they were skipped because credentials/services were unavailable.

Do not convert skipped tests into PASS.

---

# 13. Security Expectations

Any new session-owned data path must answer:

```text
How is session authorization enforced?
Can another session name this identifier?
Is scope applied before retrieval?
Can content enter logs?
How is it deleted?
```

Never use a caller-supplied session/document ID as authorization by itself.

---

# 14. Persistence Expectations

Production Cloud Run is stateless compute.

Allowed:

```text
request-scoped temp file
request-scoped memory
```

Not allowed as authoritative cross-request state:

```text
/tmp
module-global map
process memory
local JSON file
```

If a later request needs it, persist it in the approved durable owner.

---

# 15. AI / Provider Expectations

Use provider adapters.

Do not scatter provider-specific fetch calls through UI/domain logic.

Production embeddings:

```text
Cloudflare Workers AI
approved Qwen3 embedding model
1024 dimensions
```

Local development may use Ollama behind the same interface.

Do not enable a new retrieval strategy because it sounds better.

Evaluation evidence is required.

---

# 16. Code Quality

Prefer:

```text
small functions
explicit types
existing conventions
clear failure states
boring code
minimal dependencies
```

Avoid:

```text
new framework layers
generic abstractions with one implementation
large speculative refactors
new dependencies for trivial helpers
duplicate state ownership
magic fallbacks
```

---

# 17. Human Terminal

Every implementation phase ends with:

```text
============================================================
HUMAN TERMINAL
============================================================

PHASE:
...

DONE:
- ...

FILES CHANGED:
- ...

CHECKS:
- ...

ARCHITECTURE DIFF:
NONE
or
REQUIRES APPROVAL: ...

RISKS / OPEN ITEMS:
- ...

NEXT ACTION:
...

STOPPED FOR HUMAN APPROVAL
============================================================
```

The output must tell the human what happened and the single next action.

---

# 18. Stop Conditions

Stop immediately and ask for approval if:

```text
locked docs conflict
architecture change is needed
security model must change
database ownership must change
a paid dependency appears necessary
a destructive migration is required
a production secret/cloud mutation is required
evidence/citation guarantees would weaken
the requested phase cannot be completed without entering a later phase
```

Do not solve these conditions by inventing a workaround that changes the system.
