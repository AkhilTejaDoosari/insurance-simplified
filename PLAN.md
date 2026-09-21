# PLAN — Insurance Simplified V1 Completion

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This is the master implementation plan.

The architecture is already decided.

OpenCode's job is:

```text
inspect current repo
→ compare it to locked contracts
→ implement the smallest missing delta
→ prove it
→ stop at the phase boundary
```

OpenCode does not redesign the product or architecture.

---

# 2. Global Execution Rules

For every phase:

1. read `AGENTS.md`;
2. read the relevant locked design files;
3. inspect current code before editing;
4. classify requirements as `EXISTS / PARTIAL / MISSING / CONFLICT`;
5. prefer adapting existing implementation over parallel rewrites;
6. make the smallest coherent changes;
7. add/update tests;
8. run focused tests first;
9. run the phase regression gate;
10. report architecture diff;
11. stop for human approval.

No push, PR, merge, deploy, billing change, or secret mutation without explicit approval.

---

# 3. Phase 0 — Read-Only Delta Audit

## Objective

Understand the actual local branch before implementation.

## No Code Changes

Audit:

```text
git status
branch / HEAD
tracked + untracked files
existing docs
existing routes
existing persistence
existing migrations
existing RAG adapters
existing upload path
existing session state
existing UI
existing Docker/Cloud Run artifacts
existing tests
existing env variable names (never print values)
```

Create a matrix:

```text
TARGET REQUIREMENT | EXISTS | PARTIAL | MISSING | CONFLICT | FILES
```

Special checks:

- cross-request state still in tmpdir/memory?
- direct signed upload exists?
- anonymous capability exists?
- premium/price fact exists?
- four approved comparison sections exist?
- true 3-page navigation exists?
- Cloudflare embedding adapter exists/configured?
- Cloud Run deployment artifacts exist?
- readiness/liveness exist?
- production secrets/config clean?
- local-only uncommitted work that must be preserved?

## Exit Gate

No implementation until the audit is reviewed.

---

# 4. Phase 1 — Durable Session / Security Boundary

## Objective

Make the production session restart-safe and explicitly authorized.

## Scope

- durable session/context state;
- durable evidence/results needed across requests;
- remove cross-request dependence on process-local temp state;
- anonymous high-entropy session capability;
- server-side scope enforcement;
- deletion lifecycle;
- no UI redesign.

## Must Preserve

- citation contract;
- existing PDF viewer;
- existing deterministic evidence verification;
- existing RAG quality behavior.

## Exit Gate

Prove:

```text
restart-safe session
Session A/B isolation
session ID alone insufficient
delete retry-safe
no secret regression
```

---

# 5. Phase 2 — Direct Private PDF Upload

## Objective

Move PDF bytes to the approved browser → private Supabase Storage path.

## Scope

- signed/narrow upload authorization;
- generated object keys;
- server-side registration;
- PDF validation;
- duplicate/idempotent registration;
- existing document processing consumes durable object.

## Must Not

- expose Supabase secret key;
- trust client object paths;
- bypass 2–4 document product rule;
- break original-PDF evidence links.

## Exit Gate

Upload smoke + invalid type/size/scope tests pass.

---

# 6. Phase 3 — Product / Results Workspace Alignment

## Objective

Align current UI to `USER_FLOWS.md` without rewriting working components.

## Scope

### Page 1

```text
Welcome
I have my documents
I don't know where to start
```

### Page 2

Combined document + core-context intake.

### Page 3

One Results Workspace containing:

```text
comparison
tier selection
Essentials
Care & Coverage
Rules & Restrictions
Plan Highlights
chat
evidence access
```

### Comparison gaps

- add premium/price fact if current extraction lacks it;
- preserve plan/tier distinction;
- add contextual `NEEDS YOUR INPUT` behavior;
- ask only missing context;
- update only affected evaluation where practical.

## Must Preserve

- Quiet Ledger direction;
- compact comparison;
- evidence viewer contract;
- citation links;
- no endless report.

## Exit Gate

E2E covers the 3-page happy path and tier/section/missing-context interactions.

---

# 7. Phase 4 — Production Embedding Cutover

## Objective

Use the approved managed production embedding provider.

## Production Target

```text
Cloudflare Workers AI
Qwen3 Embedding 0.6B
1024 dimensions
```

## Scope

- reuse existing embedding provider seam;
- Cloudflare-compatible adapter/config;
- dimension validation;
- provider timeout/retry;
- no null-vector READY ingestion;
- keep local Ollama option for development.

## Must Not

- replace pgvector;
- add another vector DB;
- enable RRF/BM25/FTS/reranker without approval.

## Exit Gate

Provider integration test + pgvector retrieval + held-out regression pass.

---

# 8. Phase 5 — Cloud Run Runtime Closure

## Objective

Make the Dockerized application production-runnable on Cloud Run.

## Scope

- Docker clean build;
- `.dockerignore`;
- runtime env contract;
- server-only secrets;
- `/api/health`;
- `/api/ready`;
- stateless filesystem assumptions;
- Cloud Run config documentation;
- rollback-ready revisions.

## Cost Gate

Before actual deploy:

```text
verify current Cloud Run billing/free-tier
verify Cloudflare free-tier behavior
verify Supabase limits
configure budget alert
obtain explicit approval for any billing exposure
```

Creating config is not permission to deploy.

---

# 9. Phase 6 — Reliability / Observability Closure

## Objective

Prove failures are visible and diagnosable.

## Scope

- dependency timeouts;
- bounded retries;
- structured logging;
- request IDs;
- per-stage timing;
- safe provider error mapping;
- readiness behavior;
- metrics derivable from logs;
- no sensitive document/context logging.

## Exit Gate

Failure-injection tests distinguish:

```text
semantic refusal
validation error
dependency outage
application defect
```

---

# 10. Phase 7 — CI / Release Gate

## Objective

Make the repository reproducibly verifiable.

## Required validation

```text
npm ci
npm test
npx tsc --noEmit
npm run build
npm run test:e2e
docker build
```

CI should run safe/hermetic checks automatically.

Production/provider smoke remains an explicitly authorized stage.

No remote deployment until human approval.

---

# 11. Phase 8 — Production Deployment / Smoke

## Requires Explicit Human Approval

Deploy approved image/revision to Cloud Run.

Run representative real-document smoke:

```text
Welcome
→ Intake
→ direct upload
→ Compare
→ Results
→ tier selection
→ all four sections
→ one supported chat answer
→ one refusal
→ citation viewer
→ restart durability
→ A/B isolation
→ deletion
```

Capture:

```text
processing latency
embedding latency
retrieval latency
generation latency
chat total latency
failure/refusal behavior
provider usage/cost where available
```

Rollback immediately if trust/security invariants fail.

---

# 12. Phase 9 — V1 Freeze

## Objective

Stop building and turn the proven system into the flagship artifact.

Tasks:

- rerun full regression;
- rerun pre-code gate as final architecture diff;
- ensure `ARCHITECTURE.md` matches reality;
- update README;
- record production measurements;
- record known limitations;
- write `PROJECT_STORY.md`;
- finalize resume bullets;
- capture architecture/screenshots;
- tag/freeze V1 after explicit approval.

No extra features are added during freeze.

---

# 13. Human Terminal Report Format

After each phase OpenCode must end with:

```text
============================================================
HUMAN TERMINAL
============================================================

PHASE:
<name>

DONE:
- ...

FILES CHANGED:
- ...

CHECKS:
- unit:
- integration:
- typecheck:
- build:
- e2e:
- docker:

ARCHITECTURE DIFF:
NONE
or
<requires human approval>

RISKS / OPEN ITEMS:
- ...

NEXT ACTION:
<one action>

STOPPED FOR HUMAN APPROVAL
============================================================
```

A phase is not silently continued into the next phase.
