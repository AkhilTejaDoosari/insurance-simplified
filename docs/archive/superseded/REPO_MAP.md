# REPOSITORY MAP — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file tells contributors and AI coding tools where each responsibility belongs.

The goal is not to force a cosmetic folder rewrite.

OpenCode must reuse established directories when they already represent the same responsibility and must not create duplicate parallel architectures.

---

# 2. Root

```text
PRODUCT.md
USER_FLOWS.md
DOMAIN.md
ARCHITECTURE.md
DATA_MODEL.md
API.md
SECURITY.md
RELIABILITY.md
OBSERVABILITY.md
DEPLOYMENT.md
REPO_MAP.md
DECISIONS.md
ACCEPTANCE.md
PLAN.md
AGENTS.md

README.md
package.json
Dockerfile
.dockerignore
next.config.*
tsconfig.json
vitest.config.*
playwright.config.*
```

The 15 design/execution files are human-owned project contracts.

---

# 3. Application Routes

Target conceptual structure:

```text
app/
├── page.tsx                         # Page 1: Welcome
├── intake/
│   └── page.tsx                     # Page 2: document/guided intake
├── results/
│   └── [sessionId]/
│       └── page.tsx                 # Page 3: results workspace
├── view/
│   └── [sessionId]/...              # PDF evidence viewer
└── api/
    ├── health/
    ├── ready/
    ├── sessions/
    ├── upload or uploads/
    ├── document or documents/
    ├── extract/compare/
    └── chat/
```

Exact route names may preserve existing compatible routes.

Do not create a second API path merely because this map uses different labels.

---

# 4. Components

Current repository already has components such as upload, context input, comparison table, chat, evidence viewer, checklist, and verdict badge.

Target responsibility grouping:

```text
app/components/
├── intake/          # upload + core context + no-doc guided intake
├── comparison/      # sections, table, tier picker, context-needed UI
├── chat/            # chat panel / turns / citations
├── evidence/        # PDF evidence viewer and citation surfaces
└── shared/          # genuinely reusable product UI only
```

Do not mass-move files only for neatness.

Create a subfolder when new work makes the responsibility clearer or when touching/moving the existing files is justified.

---

# 5. Application Logic

Target conceptual map:

```text
app/lib/
├── domain/          # enums/invariants/types with no provider logic
├── extraction/      # fact extraction, sections, tier discovery
├── rag/             # chunking, retrieval, grounding, answer verification
├── persistence/     # session/document/page/chunk/evidence repositories
├── providers/       # Supabase, embeddings, LLM adapters
├── security/        # anonymous session capability + scope guards
├── observability/   # structured logging / timing helpers
├── pdf/             # parsing / source-page handling
└── checklist/       # no-document requirement/checklist logic
```

Existing modules may remain in their current paths when the responsibility is already clear.

The rule is:

```text
one responsibility
one obvious home
no duplicate abstraction layers
```

---

# 6. Provider Adapters

External providers must sit behind narrow adapters.

Examples:

```text
EmbeddingProvider
GenerationProvider
StorageRepository
DatabaseRepository
```

Business/domain logic must not be scattered with provider-specific HTTP code.

Cloudflare-specific details belong in the embedding adapter, not in comparison logic.

Supabase-specific storage details belong in persistence/provider code, not UI components.

---

# 7. Database / Migrations

Use the migration directory already established by the current branch.

Conceptually:

```text
db/migrations/
```

or the existing equivalent.

Rules:

- one canonical migration root;
- ordered committed migrations;
- no duplicate Supabase migration directory if another path already owns migrations.

---

# 8. Tests

Existing test groups are preserved:

```text
tests/
├── unit/
├── contract/
├── integration/
├── e2e/
└── fixtures/
```

Placement rule:

### Unit

Pure rules, transforms, chunking, verdict logic, helpers.

### Contract

API shapes, evidence/citation contracts, provider adapter contracts.

### Integration

Supabase persistence, storage, pgvector, provider-boundary behavior.

### E2E

Human-visible flows:

```text
Welcome
→ Intake
→ Compare
→ Results
→ Chat
→ Verify
```

### Fixtures

Synthetic or approved representative documents/data.

Do not put real secrets or private user documents into fixtures.

---

# 9. Scripts

Operational scripts belong under:

```text
scripts/
```

Examples:

```text
fixture generation
evaluation
migration verification
production smoke helper
```

A script that mutates cloud resources must require explicit invocation and must not run as a hidden side effect of normal tests.

---

# 10. CI

Target:

```text
.github/workflows/
├── ci.yml
└── deploy.yml       # only when deployment is explicitly approved
```

Do not create deployment automation before the deployment phase is approved.

---

# 11. OpenCode Files

Root:

```text
AGENTS.md
```

Project-local OpenCode configuration may live in:

```text
.opencode/
```

only when needed.

Do not create many specialist agent files unless a repeated workflow genuinely benefits from them.

`AGENTS.md` remains the primary AI execution contract.

---

# 12. Environment Files

```text
.env.example   # committed names/placeholders
.env.local     # local real values; ignored
```

No other secret-bearing env files should be committed.

---

# 13. Dependency Direction

Preferred logical direction:

```text
UI / API
   ↓
application/domain services
   ↓
repository/provider interfaces
   ↓
Supabase / Cloudflare / LLM implementations
```

Avoid:

```text
UI component
→ direct database SQL
→ direct Cloudflare HTTP
→ direct LLM HTTP
```

---

# 14. New Feature Rule

Before adding a file, answer:

```text
What responsibility does this file own?
Which existing layer owns that responsibility?
Is there already a file/module that should be extended instead?
```

OpenCode must prefer the smallest coherent change over creating a new framework inside the repository.
