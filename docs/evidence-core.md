# Verified Evidence Core — extraction and verification contracts

Status: Authoritative · Consolidated 2026-11-15 from `ENGINEERING_STATE`
(architecture table and recovery sessions), `DOMAIN` (evidence states),
the spec-kit constitution, `SECURITY` §14, and ADR-003 / ADR-003.1 / ADR-003.2
(owner's design records, kept outside the repository; links in
`decisions.md` D-027).

The evidence core is the product's trust boundary. Everything the user sees as
a fact passes through it. When this document and any other conflict, this one
and `operations.md` (security) win, and the agent stops and reports.

## 1. Invariants

| ID | Invariant |
| --- | --- |
| EC-1 | **No verified claim without verified evidence.** Every value shown as a plan fact carries an evidence id resolving to session → document → page → exact source span that re-verifies against the stored page text. |
| EC-2 | **Fail closed.** Ambiguous, wrong-page, non-unique or unverifiable evidence withholds the value (or downgrades it to needs-verification); it never guesses. |
| EC-3 | **Structure first, lines never inferred.** Plan ownership and scope come from document structure (table headings, declared statements) or a labelled plan/fact/value record — never from proximity or mention inference. |
| EC-4 | **Scope travels with the claim.** Plan tier, network tier and conditions are part of the claim and are kept only when literally stated in the claim's own evidence (`scopedQualifiers()` is the single contract used by extraction, presentation, overview, export and enrollment gate). |
| EC-5 | **Governing context is attached or the claim is withheld.** Footnotes, table notes, section preambles, "subject to" text, and exemptions that govern a cell are appended verbatim and cited; a claim whose governing context cannot be read completely is withheld. |
| EC-6 | **Examples and hypotheticals never become facts.** Framing (example, illustration, hypothetical, sample, scenario, another plan) governs until it ends. |
| EC-7 | **Displays are verbatim.** Unstructured line values display their cited text; summarizers may only affect verdicts, never rewrite meaning, conditions or exclusions. |
| EC-8 | **One verification pipeline.** `app/lib/extraction/verify-table.ts` is the single boundary used by `/api/extract` and the evaluation harness. |
| EC-9 | **LLM output is a proposal.** Model-proposed values, anchors or scopes are kept only if they re-derive exactly from the session document; otherwise they are dropped. |
| EC-10 | **Absence is honest.** A miss is "not found in the pages read", never "not covered"; unreadable pages are reported, not silently skipped. *(Partial: see defect register.)* |
| EC-11 | **Session scope first.** Retrieval and verification read only the authorized session's documents. |
| EC-12 | **Original PDF stays the authority.** The viewer opens the user's original PDF at the cited page; generated text never replaces it. |

## 2. Pipeline (as implemented)

| Layer | Module | Contract |
| --- | --- | --- |
| Page text | `app/lib/pdf/extract-pages.ts` | pdf.js text per page with provenance; scanned/image-only PDFs are rejected by `ingestion/quality-gate.ts` (no OCR). |
| Layout | `app/lib/pdf/layout-tables.ts`, `extraction/table-notes.ts` | Positioned items (same join as page text) → header-anchored tables with exact page-text spans. Fail-closed geometry: distinct headings; unmodeled column ⇒ row withheld; ≥60 % value-bearing cells; rotated watermark text excluded; footnotes, preambles and general notes recorded with spans. |
| Table claims | `extraction/table-facts.ts` | Fact from the label; scope from the heading; display `Label (Heading): cell` + governing notes; anchor `{page, table, row, column, label}`. |
| Statement claims | `extraction/statement-facts.ts` | Closed grammar (e.g. "For <categories> contracts, the [network] deductible is <$amount>"); whole sentence or nothing; governing region = the statement's section. |
| Anchor check | `extraction/claim-anchors.ts` | Re-derive from the session document; exact match of display, scope, label, evidence — or drop. |
| Attribution | `extraction/plan-identity.ts` (`resolveRowPlanIds`) | Single verified plan + anchor + abstention-language, rival-plan and other-declaration guards + pairwise contradiction check. |
| Verification boundary | `extraction/verify-table.ts`, `evidence-verification.ts` | Quote/span checks; numeric tokens must match. |
| Verdicts | `app/lib/verdicts.ts` | Display vocabulary below. |

## 3. Verdict vocabulary

**Current (display, enforced by `tests/contract/verdict-enum.test.ts`):**
`SUPPORTED · DOES NOT APPEAR TO FIT · NOT STATED · CONFLICTED · NEEDS VERIFICATION`.
A bare yes/no is forbidden.

**Target (ADR-003.1/003.2):** richer internal provision and outcome statuses —
verified, conditional, exclusion applies, undetermined ("cannot be confirmed"),
not found in read pages, discovered-unverified, conflict — with applicability
statuses `unrelated · not_applicable_verified · not_applicable_conditional ·
applies_verified · unresolved_material`.

**Open decision (C-1, `decisions.md`):** the proposal is to keep the five
display verdicts and map internal statuses onto them in one table here. Until
the owner accepts it, do not change the display vocabulary.

## 4. Target contract (ADR-003.2) — design only, not production

The architecture is frozen at the component and responsibility level. The
ADR's reference implementation and its red/regression suites are a
**specification**, not application code; nothing from them counts as
implemented until it exists under `app/` with passing tests here.

| Component | Responsibility |
| --- | --- |
| C1 Candidate proposer + verifier | Per-section proposals typed by provision kind; validated against known block ids; verifier **seals** provisions. |
| C2 Exclusion applicability resolver | Versioned materiality map; carve-outs and express overrides; any unclassified, circumstantial, unmapped or overlapping case → `unresolved_material`. A coverage answer always considers **every** exclusion in the plan's inventory, retrieved or not. |
| C3 Eligibility | AND/OR/NOT criteria tree evaluated with dates against user context; unknowns stay unknown. |
| C4 Authority | Supersession only with a resolved proof (identity, period, basis, scope) citing verified evidence from both documents; otherwise `conflicts_with`. |
| Session registry | Document identity (sha256, family, verified plan name/issuer/number/period) bound to exact source spans. |
| Provision store | `ProvisionStore(sessionId, registry)` accepts only provisions that were sealed and unchanged, carry admissible evidence, cite the registered document bytes, are scoped to that document's verified plan, and have a real period inside the document's period. |
| Issued resolutions | Only resolver-issued, unaltered assessments carry authority; rendering takes `Issued<Resolution>` and re-checks hashes, else shows "cannot be confirmed". Authority is in-process: anything read back from the database is re-derived or carries a store-side seal (AT-PERSIST). |

Domain-specific parts (concept registry, provision kinds, materiality map,
family expectations such as SBC) are **adapter data**, kept outside the
verifier, store and renderers so other insurance domains can be added later.

## 5. Required trust-boundary acceptance tests

These four are **required application acceptance tests**. They must exist in
`tests/` against application code and pass before V1 can claim the evidence
core (roadmap M7). They are not satisfied by the reference implementation.

| ID | Test | Current state |
| --- | --- | --- |
| TB-1 | **Authoritative-exclusion source binding.** An exclusion may enter a plan's authoritative exclusion inventory — and so block or qualify a "covered" answer — only when it is bound to verified source blocks of that plan's registered document. An unbound, foreign-document or fabricated exclusion record is refused; an applying exclusion can never be dropped because retrieval missed it. | **Unresolved regression** — no exclusion inventory or applicability code exists in `app/lib`. Exact scenario wording to be confirmed with the owner from ADR-003.2 when the test is written. |
| TB-2 | **Scope identity bound to real source blocks (R3-1).** Plan name and period come from exact spans of the document's own admissible blocks with the registered bytes; the store accepts only the registry-issued scope; scope dimensions are bound to a block of the candidate's document. | Not in application code (current plan identity: `plan-identity.ts`, different mechanism). |
| TB-3 | **Only resolver-issued assessments carry authority (R3-2).** A forged or altered applicability record is ignored and forces `undetermined`; it can never clear an exclusion; a verified `applies` still wins. | Not in application code. |
| TB-4 | **Rendering trusts only an unaltered resolver result for that exact provision (R3-3).** Otherwise the fixed "cannot be confirmed" text is shown. | Not in application code. |

Supporting acceptance tests named in ADR-003.2 and to be ported with their
components: AT-C4 / AT-AUTH-ORDER (authority cases, acyclic order per scope),
AT-PERSIST (authority survives persistence only via re-derivation or seal).

## 6. Defect register (application, confirmed at `15f8cc2`)

Kept separate from reference-contract defects, which are never claimed to exist
in the app until an application test fails.

| Area | Evidence | Milestone |
| --- | --- | --- |
| Absence reported from a regex miss | `extraction/extract.ts` emits NOT STATED on pattern miss and when values are dropped for missing evidence | M7 |
| Claim checks digits only | `evidence-verification.ts` skips tokens without a digit | M7 |
| No schema enforcement on LLM output | `llm/client.ts` uses `response_format: json_object` | M7 |
| Forgeable document delimiter | `llm/safe-prompt.ts` closes untrusted text with a plain `>>>` | M4 |
| Non-durable fallback | `api/upload/route.ts` falls back to tmpdir session files | M4 |
| Filenames in logs | `api/upload/route.ts` logs `file.name` | M4 |
| Health check misses the server | Dockerfile/compose expect port 3000; `npm start` serves 3333 | M4 |
| Partly scanned PDFs may lose pages silently | Quality gate checks total characters only | M10 |
| Fixed 48-fact vocabulary drives rows and absence | `extraction/fact-list.ts` | M8 |
| Row verdicts shared across documents | An unstructured line in one PDF can mark another PDF's claims needs-verification (conservative) | M8 |

Open owner adjudications (from the 2026-11-14 recovery): IMG p3
"All other Treatments & supplies: 50 % reduction … if Pre-certification
requirements are not met" (83 IMG claims flagged `pending`); FEP Section 2
statements kept although the section says it is "not an official statement of
benefits"; document-level disclaimers are not yet attached to row claims.
