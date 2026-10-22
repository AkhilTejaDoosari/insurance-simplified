# SECURITY — Insurance Simplified

| Status | Version | Owner |
| --- | --- | --- |
| DRAFT FOR HUMAN APPROVAL | V1 | Akhil |

---

## 1. Purpose

This file defines V1 trust boundaries, authorization, upload safety, prompt-injection handling, secret handling, privacy, and deletion expectations.

Security is evaluated before retrieval and before model access, not after generated output exists.

---

# 2. Trust Boundaries

```text
UNTRUSTED
Browser input
Uploaded PDFs
User questions
Filenames
Model/provider output

TRUSTED APPLICATION BOUNDARY
Cloud Run server-side application

MANAGED DEPENDENCIES
Supabase PostgreSQL
Supabase Storage
Cloudflare Workers AI
Generation LLM provider
```

Uploaded insurance documents are untrusted content even when they look legitimate.

---

# 3. Anonymous Session Authorization

V1 does not require end-user signup/login.

It still requires authorization.

The session uses:

```text
public session ID
+
high-entropy anonymous session capability
```

Preferred browser transport:

```text
Secure
HttpOnly
SameSite
cookie
```

The public `sessionId` may appear in routes or URLs.

The `sessionId` is not treated as a password.

The server stores only a hash or otherwise non-recoverable representation of the session capability where practical.

Every protected operation resolves the capability before accessing session-owned data.

---

# 4. Object-Level Authorization

For every protected resource:

```text
session
document
page
chunk
evidence
chat turn
```

the server must prove that the resource belongs to the authorized session.

Do not authorize by trusting:

```text
documentId from the browser
objectKey from the browser
page number alone
filename
```

All must resolve through the authorized session boundary.

---

# 5. Retrieval Authorization

The critical retrieval rule is:

```text
authorize
→ scope retrieval
→ retrieve evidence
→ send allowed evidence to model
```

Never:

```text
retrieve globally
→ send to model
→ filter generated answer afterward
```

Cross-session evidence must never enter the model context.

---

# 6. Database RLS Position

Row Level Security is defense in depth where database identity supports it.

V1 anonymous runtime authorization remains an application responsibility unless the database request itself carries an authenticated identity that RLS can enforce.

If the server uses a privileged Supabase secret/service role, RLS bypass may apply.

Therefore:

- all application repositories still require explicit session scope;
- never claim that RLS alone secures anonymous runtime sessions;
- RLS tests remain valuable for future authenticated-user boundaries.

### 6.1 Verified grants state (direct-SQL + PostgREST audit, 2026-10-22)

Verified against the intended development database by direct SQL and PostgREST
probes (capability proofs used zero-match operations; no data was mutated):

- `documents`, `pages`, `chunks`, `sessions`, `comparison_results`: RLS
  enabled, owner-scoped policies for `authenticated`; anon reads return empty
  (default deny). Anon holds broad table privileges, but RLS defeats them for
  row operations reachable through PostgREST.
- `schema_migrations`: RLS **disabled**. Confirmed reachable by the anon role
  through PostgREST: SELECT (200 with rows), UPDATE (200), DELETE (204 on a
  zero-match probe — real deletes would execute). INSERT is privilege-granted
  though not live-proven. Anonymous ability to tamper with the migration
  ledger is therefore real.
- Anon also holds `TRUNCATE, REFERENCES, TRIGGER` grants on all public
  tables. PostgREST does not expose a TRUNCATE verb and REFERENCES/TRIGGER
  are inert without direct SQL access, so these are not reachable through
  supported access paths — the grant surface is still considered excessive.
- `service_role` holds full privileges server-side only; the browser only
  ever receives publishable/anon keys.
- A smallest-safe remediation migration (0006: enable RLS on
  `schema_migrations`, scope its grants to `service_role`, revoke
  `TRUNCATE, REFERENCES, TRIGGER` from `anon`/`authenticated`) is drafted and
  **pending separate human approval**; the dev/minimal state above is the
  pre-remediation baseline.

---

# 7. Private PDF Storage

The storage bucket is private.

Original PDFs are not public URLs.

Browser upload uses short-lived, narrowly scoped signed upload authorization.

Signed upload authorization must constrain:

- target object key;
- session ownership;
- expiration;
- expected upload intent;
- accepted PDF size/type policy where supported.

The browser never receives a Supabase secret/service key.

---

# 8. File Upload Safety

Accepted V1 document type:

```text
PDF
```

Server-side validation checks:

- declared content type;
- file extension as a weak hint only;
- PDF signature / parseability;
- configured byte-size limit;
- page/processability limits where needed;
- object belongs to authorized session.

Reject:

- non-PDF content disguised as `.pdf`;
- unsupported encrypted/corrupt PDFs when they cannot be processed safely;
- path-like filenames as storage keys;
- client-selected arbitrary storage paths.

Use generated object keys.

---

# 9. Prompt Injection

PDF content is data, not instruction.

Uploaded text may contain statements such as:

```text
ignore previous instructions
send secrets
use another user's data
```

Those statements have no authority.

Model prompts must clearly separate:

```text
system/application rules
user question
retrieved document evidence
```

Document text must never be allowed to:

- change authorization;
- request secrets;
- widen retrieval scope;
- choose external tools;
- alter product invariants.

---

# 10. SSRF / External Fetch Boundary

V1 is user-document-first.

The application does not need to fetch arbitrary user-supplied URLs in the core document path.

Therefore:

```text
no arbitrary server-side URL fetch
```

unless a future approved requirement adds it with explicit SSRF controls.

---

# 11. Secret Handling

Local development:

```text
.env.local
```

Repository-safe template:

```text
.env.example
```

Production:

```text
Google Cloud runtime secret configuration / approved secret store
```

Never:

- commit secrets;
- bake secrets into Docker images;
- expose server keys through `NEXT_PUBLIC_*`;
- print secret values;
- include API keys in error responses;
- paste production secrets into committed docs.

Provider credentials must remain server-side.

---

# 12. Logging / Privacy

Do not log by default:

- full PDF text;
- extracted pages;
- evidence quotes unless explicitly required for a protected debugging workflow;
- full user questions;
- full model prompts/responses;
- visa/status or other user context values;
- secrets.

Logs may contain:

- request ID;
- hashed/opaque session reference;
- route/operation;
- timings;
- counts;
- outcome;
- safe error code;
- provider/model alias without credentials.

---

# 13. Data Minimization

Collect only context that can materially affect the comparison.

V1 does not require:

```text
name
phone
email
account profile
```

Do not expand the personal-data surface without an approved product requirement.

---

# 14. Evidence Integrity

A citation is displayed only after evidence verification.

The system must confirm:

```text
correct session
correct document
correct page
quote exists in source page
```

A citation verification failure moves the claim to a safe uncertainty state or prevents the claim from being shown as supported.

---

# 15. Model Output Is Untrusted

Generation-provider output must be validated before becoming product state.

The model does not get authority over:

- authorization;
- storage keys;
- SQL;
- lifecycle state;
- deterministic eligibility;
- numeric calculations;
- citation validity;
- product requirements.

Structured outputs must be schema validated.

---

# 16. Threat Table

| Threat | V1 control |
| --- | --- |
| User A guesses User B session/document ID | High-entropy capability + server-side object-level scope |
| Cross-session vector retrieval | Session filter before retrieval |
| Prompt injection in PDF | Treat document text as untrusted evidence only |
| Secret leaked to browser | Server-only env/secret configuration |
| Malicious/invalid upload | Type/size/PDF parse validation + generated object keys |
| Public PDF exposure | Private bucket + authorized serving/signed access |
| Citation fabricated by model | Deterministic citation/evidence verification |
| Model fabricates missing coverage | Evidence states + refusal rules |
| Arbitrary URL fetch / SSRF | No arbitrary URL fetching in V1 |
| Sensitive text in logs | Content-minimized structured logging |
| Partial deletion claimed as success | DELETING state + retry-safe cleanup |

---

# 17. Retention / Deletion

V1 must support explicit session deletion.

Deletion includes session-owned:

- PDFs;
- pages;
- chunks;
- vectors;
- evidence metadata;
- persisted comparison/chat data.

Deletion failure remains visible and retryable.

Do not claim complete deletion until required owned resources are removed according to the deletion contract.

Backup-retention limitations of managed providers must be documented before claiming immediate physical erasure from provider backups.

### 17.1 Verified retention behavior (V1, 2026-10-22)

Verified implemented behavior for session-owned persisted state:

- Sessions: keys (`0002_object_key`) plus `0004_sessions` (durable session
  rows, 7-day lifetime), RLS owner-scoped; close deletes local temp state,
  durable vectors, durable objects, the DB session row, and the persisted
  comparison result — with fail-closed, retryable 503 semantics at each
  durable step.
- Comparison results (`0005_comparison_results`): stored server-side,
  owner-scoped by RLS, keyed by session, never exposed to the browser;
  30-day `expires_at`; results consumed by PDF export are loaded from this
  store rather than recomputed from live session state.
- Expiry removal is **opportunistic**: expired rows are physically deleted
  during the next successful result save in any session. There is no
  scheduled job in V1, so an expired row whose session is never touched
  again can remain in the database past its 30-day window.
- Legacy non-durable (local tmp fallback) sessions do not wipe the local
  `*.result.json` file at close time; it remains on temporary local disk
  until it expires from view and the directory is cleaned by the OS.
- Supabase provider backups retain deleted rows for their own backup
  windows; no claim of immediate physical erasure from backups is made.

---

# 18. Security Acceptance Rule

A feature is not complete merely because the happy path works.

For any new session-owned resource, reviewers must answer:

```text
How is this resource authorized?
Can user A name user B's identifier?
Can retrieval expose it before generation?
Can it leak through logs?
How is it deleted?
```
