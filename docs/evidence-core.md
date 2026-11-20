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
| EC-10 | **Absence is honest.** A miss is "not found in the pages read", never "not covered"; unreadable pages are reported, not silently skipped. *(Tested: per-page readability record, `extraction/absence.ts`, rendering in view-model/UI/export; OCR still M10.)* |
| EC-11 | **Session scope first.** Retrieval and verification read only the authorized session's documents. |
| EC-12 | **Original PDF stays the authority.** The viewer opens the user's original PDF at the cited page; generated text never replaces it. |
| EC-13 | **Exclusion source binding** (kit id INV-EC-09). Exclusion inventories and "exclusion sections read" state come only from sealed exclusion provisions and page-coverage records; no caller can declare them. Full text and tests in §5. *(Tested: `app/lib/evidence/exclusions/inventory.ts`, TB-2/TB-4.)* |

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

**Verdict layers rule.** Three layers stay separate and are never merged:
internal provision/applicability statuses (evidence core), displayed verdicts
(UI vocabulary), and navigation groups (the five containers). A status is
mapped to a verdict in one place only; grouping never changes a verdict; and
a missing item is never shown as "No", "Not covered", "Not eligible" or
"Excluded" on any layer.

**Mapping (C-1, decided 2026-11-19).** The five display verdicts stay. Internal
outcome statuses map to them in exactly one place,
`app/lib/evidence/verdict-mapping.ts` (`OUTCOME_TO_VERDICT`); unknown values
fall to NEEDS VERIFICATION. Applicability statuses are never mapped directly.

| Internal outcome | Display verdict |
| --- | --- |
| verified | SUPPORTED |
| conditional | NEEDS VERIFICATION *(conservative default; owner-reviewable)* |
| exclusion_applies | DOES NOT APPEAR TO FIT |
| undetermined | NEEDS VERIFICATION |
| not_found_in_read_pages | NOT STATED (rendered "Not found in the pages read", naming unread pages) |
| discovered_unverified | NEEDS VERIFICATION |
| conflict | CONFLICTED |
| cannot_be_confirmed | NEEDS VERIFICATION (shown as "cannot be confirmed") |

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
`tests/integration/trust-boundary.test.ts` against application code and pass
before V1 can claim the evidence core (roadmap M7). They are not satisfied by
the reference implementation. Numbering matches the owner's test template
(kit v2/v2.1). `INV-EC-09` below is the kit's invariant id; in this document
it is EC-13 (unrelated to EC-9 above).

> **Source binding (INV-EC-09).** The inventory's exclusion list and each document's "exclusion sections read" state are derived from sealed exclusion provisions and ingestion page-coverage records for that document version. No caller, API input or registry write can declare them. An exclusion present in a document's verified evidence can never be missing from that document's inventory. The ADR-003.2 reference registry accepts caller-declared exclusion ids and completeness flags, so it does not meet this; the application must.
>
> | ID | Attack | Must hold |
> |---|---|---|
> | TB-1 | Provision with plan-name and period evidence not bound to real source blocks | Persisting it is refused; nothing is stored |
> | TB-2 | Caller-built "not applicable" assessment for an exclusion that names the service | Conclusion is never covered |
> | TB-3 | Resolution altered after issue, shown on comparison view, chat answer and export | Each surface shows "cannot be confirmed" |
> | TB-4 | Exclusion coverage declared complete with an empty or partial exclusion list, while verified evidence contains an exclusion naming the service | Conclusion is never covered; the inventory equals the sealed exclusion provisions |
>
> Each test must also fail when its guard is removed.

Origin: TB-1 = R3-1, TB-2 = R3-2, TB-3 = R3-3 (ADR-003.2 Amendment 3);
TB-4 = the authoritative-exclusion source-binding regression, which the
reference contract does not meet. **Current state (2026-11-20, `integration/m5-m7`):
all four pass against application code** (`app/lib/evidence/**`); each was
shown to fail when its guard is removed (TB-1 plan-name and period span checks;
TB-2 proposal guard; TB-3 row render gate and exclusion-outcome gate; TB-4
caller inventory, missing-coverage-as-complete and partial-list guards).
AT-PERSIST is met by re-derivation (no durable seal key);
AT-C4/AT-AUTH-ORDER pass as a library (`app/lib/evidence/authority/`), not
yet wired into a surface.

Supporting acceptance tests named in ADR-003.2 and to be ported with their
components: AT-C4 / AT-AUTH-ORDER (authority cases, acyclic order per scope),
AT-PERSIST (authority survives persistence only via re-derivation or seal).

## 6. Defect register (application, confirmed at `15f8cc2`)

Kept separate from reference-contract defects, which are never claimed to exist
in the app until an application test fails.

| Area | Evidence | Milestone |
| --- | --- | --- |
| ~~Absence reported from a regex miss~~ | Closed (M7, agent C): NOT STATED carries "not found in the pages read" with pages read/unread; dropped candidates are NEEDS VERIFICATION with the source line (`m7c-honest-reading`) | M7 ✓ |
| ~~Claim checks digits only~~ | Closed (M7): negation, exception and network grammars (`m7c-field-grammars`, `m7c-network-scope`) | M7 ✓ |
| ~~No schema enforcement on LLM output~~ | Closed (M7): json_schema requests + runtime validator, prototype-key safe (`m7c-llm-schema`); chat uses it too (`m5-chat-schema`) | M7 ✓ |
| ~~Forgeable document delimiter~~ | Closed `65e77c5`, `3a05b05`: collision-checked per-call frames (`safe-prompt-framing`, `chat-prompt-framing` tests) | M4 ✓ |
| ~~Non-durable fallback~~ | Closed `e4a65a7`: upload requires durable storage, else retryable 503 (`upload-durability-failure` tests) | M4 ✓ |
| ~~Filenames in logs~~ | Closed `7e8dd6f`: no filenames in upload logs/timings (`upload-durability-failure` log-capture tests) | M4 ✓ |
| ~~Health check misses the server~~ | Closed `d7af28b`: aligned at 3333 (`container-port` test; container probe re-run at `8986f45`) | M4 ✓ |
| Partly scanned PDFs may lose pages silently | Now reported, not silent: per-page readability (incl. Node 20 image probe) marks unreadable/partly read pages and absence names them. OCR of those pages remains | M10 |
| Fixed 48-fact vocabulary drives rows and absence | `extraction/fact-list.ts` | M8 |
| Row verdicts shared across documents | An unstructured line in one PDF can mark another PDF's claims needs-verification (conservative) | M8 |
| Stale object-key contract | `docs/architecture.md` (PDF bytes row) and `tests/integration/persistence-cutover.test.ts:63,121` still describe the legacy shared key `docs/<aa>/<sha>.pdf`; code uses the session-scoped key (`sessions/<sid>/documents/<doc>/…`, SEC-2/SEC-5). Test skips unless live embeddings are configured; changing its assertion needs owner approval | M7 |
| Insurer-specific plan-title rule | `extraction/plan-identity.ts` attests a plan from one named insurer's title line (`namedInsurerTitle`); no general rule covers "<carrier> <product>" titles, and generalizing it risks attesting carrier or competitor mentions. Its test lives in `REAL_FIXTURES_DIR` (`plan-identity-insurer-title`). | M8 |

Open owner adjudications (from the 2026-11-14 recovery; documents named in
`REAL_FIXTURES_DIR`): Doc A p3 general pre-certification penalty note (83
Doc A claims flagged `pending`); Doc D "changes" section statements kept
although that section disclaims being an official statement of benefits;
document-level disclaimers are not yet attached to row claims.
