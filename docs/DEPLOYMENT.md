# DEPLOYMENT — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines environments, build/release stages, runtime configuration, secret handling, rollout, rollback, and production smoke testing.

Target production platform:

```text
Google Cloud Run
```

Durable services:

```text
Supabase PostgreSQL / pgvector
Supabase private Storage
Cloudflare Workers AI embeddings
configured generation LLM provider
```

---

# 2. Environments

## Local

May use:

```text
Next.js dev server or Docker
Supabase development project
local Ollama embeddings where useful
configured development generation provider
.env.local
```

## Production

Uses:

```text
Docker container
Google Cloud Run
Supabase
Cloudflare Workers AI
production generation provider configuration
platform/runtime secrets
```

Production must not depend on the developer laptop or local Ollama.

---

# 3. Runtime Configuration Contract

Safe names belong in `.env.example`.

Local real values belong in `.env.local`.

Expected server configuration includes:

```text
APP_ENV=

SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=

LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=

EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_DIMENSION=1024

LOG_LEVEL=
```

Only variables truly required by the browser may use `NEXT_PUBLIC_*`.

Server secrets must never use `NEXT_PUBLIC_*`.

Operator-only database migration URLs should not be injected into the running app unless the runtime truly needs them.

---

# 4. Build Stages

Required pre-deploy validation:

```text
npm ci
npm test
npx tsc --noEmit
npm run build
npm run test:e2e
docker build
```

Where external-provider tests require credentials, CI must clearly separate:

```text
hermetic required tests
provider integration tests
production smoke tests
```

A skipped provider test must not be mistaken for a passing provider test.

---

# 5. Container Contract

The Docker image must:

- build from a clean checkout;
- not include `.env.local`;
- not include `.git`;
- not include OpenCode/agent caches;
- not depend on host-only files;
- start the production Next.js server;
- expose the configured application port;
- include only runtime-required files.

`.dockerignore` must exclude development/secrets/artifact noise.

---

# 6. Cloud Run Initial Configuration

Start conservative for portfolio/demo usage:

```text
min instances: 0
max instances: 1 initially
CPU/memory: smallest setting that passes real PDF smoke tests reliably
request timeout: sufficient for V1 synchronous processing, measured rather than guessed
```

Changes to CPU, memory, concurrency, timeout, or max instances must be based on measured behavior.

Cloud Run instances are disposable.

No cross-request state may depend on local disk.

---

# 7. Image / Release Path

Preferred release flow:

```text
source commit
→ tests
→ Docker build
→ container registry approved for Cloud Run
→ Cloud Run revision
→ readiness/smoke
→ traffic
```

Do not deploy an image that cannot be traced back to a Git commit.

Use immutable image digests/tags for releases.

---

# 8. Database Migration Stage

Migrations run before application code that requires the new schema.

Rules:

```text
expand first
deploy compatible code
backfill/verify
contract later
```

Migration credentials are operator/CI secrets.

The application image must not automatically perform destructive schema migration on every startup.

---

# 9. Secrets

Production secrets are injected at runtime using the approved Google Cloud secret/runtime configuration.

Never:

```text
commit secret values
copy .env.local into image
put secret values in Dockerfile
put server secrets in NEXT_PUBLIC variables
echo secrets in CI logs
```

Secret rotation must be possible without rebuilding source code.

---

# 10. Health / Readiness

Cloud Run liveness target:

```text
/api/health
```

Readiness/dependency target:

```text
/api/ready
```

A deployment is not considered production-ready until `/api/ready` succeeds with the production configuration.

---

# 11. Deployment Strategy

V1 uses Cloud Run revisions.

Preferred rollout:

```text
deploy new revision with no/limited traffic where possible
→ run readiness
→ run smoke
→ move traffic
```

Do not introduce Kubernetes-style deployment machinery.

---

# 12. Rollback

Rollback target:

```text
previous known-good Cloud Run revision
```

Rollback must not require rebuilding the old image.

Database changes must remain backward-compatible during the rollout window so application rollback remains possible.

---

# 13. Production Smoke Test

Use real representative PDFs.

Minimum smoke:

```text
1. Welcome loads
2. Create anonymous session
3. Upload 2–4 PDFs through target upload path
4. Core context accepted
5. Compare reaches READY/PARTIAL honestly
6. Results workspace loads from durable state
7. Tier selection works
8. Essentials / Care & Coverage / Rules & Restrictions / Plan Highlights work
9. Evidence-backed value opens correct source page
10. Chat answers one known question with verified citation
11. Chat refuses one unsupported question
12. Restart/new Cloud Run instance does not lose session state
13. Session A cannot retrieve Session B evidence
14. Delete session succeeds or remains honestly retryable
```

Capture timings for the production-proof report.

---

# 14. CI/CD Target

V1 target:

```text
Pull request:
test + typecheck + build + Docker build

Main:
same validation

Deployment:
manual/approved workflow until production behavior is proven
```

Do not auto-deploy every commit before rollback and smoke checks are trustworthy.

---

# 15. Cost Gate

The project has a zero-new-spend / free-tier preference.

Important:

```text
Google Cloud budget alerts are warnings, not hard spending caps.
```

Before the first production deployment:

- verify current Cloud Run billing/free-tier conditions;
- set a budget alert;
- keep max instances conservative;
- verify Cloudflare Workers AI free-tier behavior;
- verify Supabase project limits;
- confirm no accidental paid add-on is enabled.

If deployment requires accepting non-zero billing exposure, stop and obtain explicit human approval.

---

# 16. Deployment Approval Boundary

Creating deployment files is not permission to deploy.

OpenCode must not:

```text
deploy
push
open/merge a PR
change cloud resources
enable billing
rotate production secrets
```

without explicit human approval for that action.
