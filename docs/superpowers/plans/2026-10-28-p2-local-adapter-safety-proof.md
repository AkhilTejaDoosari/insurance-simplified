# P2 Local Adapter Safety Proof Implementation Plan

> **For agentic workers:** Implement this bounded experiment natively in this session; keep every new executable artifact outside `app/` and preserve all pre-existing work.

**Goal:** Prove a compact candidate adapter can map only complete evidence-backed facts into existing schema fields, while classifying all other saved FEP values without qualifier loss.

**Architecture:** Add an offline adapter under the existing `scripts/p2-experiment/` experimental area. It consumes the saved compact response, verifies and canonicalizes original-page citations with the production verifier, validates a conservative experimental title candidate without modifying production `attestPlans`, and only emits values after allowlist, evidence-dimension, qualifier, and existing schema checks. C6 remains the unchanged production `resolveRowPlanIds` gate.

**Tech Stack:** Existing TypeScript, Vitest, production evidence/schema/plan helpers; no new dependencies or provider calls.

**Spec:** `docs/P2_EVIDENCE_SUFFICIENCY_REVIEW.md` and this user authorization.

## Global Constraints

- No model calls or PDF transmission.
- No production schema, validators, prompts, attestation, C6, UI, or architecture changes.
- No new providers/dependencies, subagents, commits, pushes, deployments, migrations, or destructive Git commands.
- Preserve all existing uncommitted work.
- No unsafe promotion; missing/unsupported material scope is never silently dropped.

## Review Focus

- A citation valid on the wrong page/document must fail before mapping.
- Any unsupported/unknown compact scope key must fail closed.
- A candidate may map only exact concept/qualifier allowlist entries.
- Competing or phantom title mentions must not be treated as plan identity.
- No number-only evidence or unrecognized FEP title may yield plan ownership through C6.

---

### Task 1: Contract tests for offline adapter

**Files:**

- Create: `tests/unit/p2-local-adapter.test.ts`
- Test saved response at `nonstandard/p2-compact-spike/live-proof-2026-10-28/provider-response.raw.json` and source pages manifest.

**Interfaces:**

- Proposed module: `scripts/p2-experiment/compact-adapter.ts`
- `evaluateCompactResponse(payload, documents, options)` returns per-value disposition (`complete`, `incomplete`, `unsupported`, or `unmappable`) plus promotion candidates.

- [ ] Test eight real values produce zero promotions and explain each disposition.
- [ ] Test positive synthetic evidence-backed cases through existing schema/citation checks.
- [ ] Test missing enrollment, unsupported exception, competing plan names, wrong-page citations, malformed identities, and unknown qualifiers fail closed.
- [ ] Test FEP title candidate recognition is source/title-context based and rejects buried phantom/competing names; production `attestPlans` stays unchanged.
- [ ] Run the focused test and confirm expected RED before implementation.

### Task 2: Minimal experimental adapter

**Files:**

- Create: `scripts/p2-experiment/compact-adapter.ts`
- Create: `scripts/p2-experiment/p2-local-adapter-safety-proof.ts`

- [ ] Verify compact shape, manifest ownership, page citations, and canonical source quotes.
- [ ] Require explicit typed evidence dimensions and allowlisted concept/field mappings; reject incomplete, unsupported, and unmappable claims distinctly.
- [ ] Preserve all scope keys; reject if any key lacks an exact safe production representation.
- [ ] Derive plan candidates only from conservative first-page title evidence for diagnostics; accept production plans only from unchanged `attestPlans`.
- [ ] Produce no `planId` unless unchanged C6 resolves it from a legitimate verified plan; amount citations alone never assign ownership.

### Task 3: Proof report and verification

**Files:**

- Create: `docs/P2_LOCAL_ADAPTER_SAFETY_PROOF.md`

- [ ] Run focused tests, full unit suite, typecheck, and formatting checks.
- [ ] Record all 8 dispositions, synthetic positives/negatives, citation counts, title recognition, C6 result, schema gaps, and exact files changed.
- [ ] Confirm production files and prior artifacts remain untouched; stop for owner review.
