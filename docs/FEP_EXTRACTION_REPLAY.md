# FEP Blue Focus — Controlled Sonnet Extraction and Replay

**Date:** 2026-10-27
**Verdict:** **FAIL** — the one-shot response was complete and contained source-supported candidates, but its structure did not satisfy the current extraction contract; zero facts reached schema validation/C6. Phase 2 implementation is recorded below; Phase 4 replay remains unapproved and was not run.
**Scope:** One document-content request over original PDF pages 1, 17, and 31. No retries, database/Storage access, or application changes.

## Run provenance

- **Source:** `FEP-Blue-Focus-Brochure-2027-10-23.pdf`, 140 pages.
- **SHA-256:** `9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f4`.
- **Selected original pages:** 1, 17, 31. The local source record retains a 140-page index with only these pages populated, preserving citation page numbers.
- **Model identity:** configured and response model both `claude-sonnet-5-5`; HTTP 200.
- **Prompt version:** `fep-blue-focus-5-facts-v1`; bounded to at most three fact rows plus an optional plan identity; `max_tokens=3000`; no retry logic.
- **Completion:** `finish_reason=stop`, not truncated.
- **Usage:** 2,915 prompt tokens + 2,236 completion tokens = **5,151 total**.
- **Private capture:** exact provider envelope saved in Git-ignored `nonstandard/fep-sonnet-replay-run/provider-response.raw.json`; source selection, hash, prompt/model/finish/usage metadata saved beside it. Diagnostic files are mode `0600`; containing directory is `0700`.

## Phase 1 — source-backed contract difference

The authoritative saved input is the exact content in `provider-response.raw.json`; source facts below are checked against `source-pages.json`, which retains original PDF numbering. Contract references are the production prompt in `app/lib/extraction/extract.ts:547-563`, the v1 validator/types in `app/lib/extraction/types.ts:73-109,154-285`, and `specs/001-insurance-plan-comparison/contracts/comparison-schema.md:8-15,28-39,104-151`.

| Field / occurrence | Saved response | Production requirement | Meaning / safety assessment | Phase 2 disposition candidate |
|---|---|---|---|---|
| `rows[].verdict` — 3/3 rows | Missing from deductible, OOP maximum, and network-rules rows. | Required closed-enum verdict on every row; prompt requires one of five named verdicts. (`types.ts:196-205`; schema contract §Verdict/Rules.) | Verdict carries approved evidence semantics; it cannot be inferred merely from presence of values. | Reject each affected row; do not default to `SUPPORTED`, `NOT STATED`, or `NEEDS VERIFICATION`. |
| `values[].documentId` — 5/5 values | Missing; each value has citations naming `fep-blue-focus-2027-diagnostic`. | Required document ID on each value; every evidence document must equal the value document and belong to the input set. (`extract.ts:551`; `types.ts:206-211,278-280`.) | In this one-document capture the citations identify one supplied document unambiguously. In a multi-document input, multiple/unknown citation IDs are not safe to infer. | Derive only when all candidate evidence citations name exactly one ID that exists in the supplied input set; reject explicit mismatches and ambiguous/unknown IDs. Preserve that ID on the value. |
| Plan `sources` — 1 plan | Plan has `evidence:[{documentId,page,quote}]`, not `sources`; quote is page 1 `FEP® Blue Focus`, while `name` is `FEP Blue Focus`. | A plan needs at least one `sources` citation; plan name must occur in source quote; route verifies each source. (`types.ts:100-109,171-190`; `route.ts:99-111`.) | Citation occurrence is verified, but the exact quote does not satisfy the validator’s literal name-in-quote rule. `attestPlans` does not recognize this title; it uses first-page title/declaration forms only (`plan-identity.ts:25-73`). | Reject the malformed plan claim. Do not alias/rewrite its source, name, or attestation proof in this phase. No plan identity is available to C6. |
| `rows[].planId` — 3 occurrences | `fep-blue-focus-2027` appears on each row; values have no `planId`. | Plan relationship belongs on a value and is accepted only with a known plan source plus plan/value evidence proof (`types.ts:206-212,272-277`; `plan-identity.ts:306-354`). The extraction prompt’s row shape does not include row-level `planId` (`extract.ts:551`). | This is an unsupported row-level association; it must not become value ownership by propagation. | Reject the row-level attribution claim; retain facts only as unassigned if their other requirements pass. |
| `qualifiers.enrollment` — 4 occurrences | Self Only on `$1,000` deductible and `$11,000` OOP; Self Plus One and Self and Family on `$2,000` deductible and `$22,000` OOP. | Not in the schema or allowed prompt vocabulary. (`comparison-schema.md:118-120`; `extract.ts:553-554`; `types.ts:9-35`.) | **Material in all four cases:** enrollment changes deductible/OOP values. Page 17 states the deductible split; page 31 states the OOP split. The saved value citations omit the enrollment text, although it is in surrounding source-page text. | Do not map into `conditions` or infer wider citations; reject/quarantine candidates carrying it unless the unchanged candidate evidence itself supports a permitted field without loss. |
| `qualifiers.network` — 3 occurrences | “Preferred providers” on both OOP values; “Preferred facilities” on the network-rules value. | Not a recognized key; production uses `networkTier` (and prompt requests that key). (`extract.ts:553-554`; `types.ts:9-35`.) | **Material in all three cases:** network determines the OOP scope and whether inpatient facilities satisfy the stated restriction. Page 31 contains the relevant Preferred-provider/facility text. The OOP quotes mention Preferred but do not fully establish every display scope; the facility quote establishes Preferred facilities. | Do not rename mechanically to `networkTier`; no proof-contract relaxation. Reject/quarantine the candidate if its full meaning cannot be represented with a known, evidence-attested qualifier. |
| `qualifiers.expenseTypes` — 2 occurrences | Deductible plus eligible coinsurance/copayment amounts, on both OOP values. | Not a supported schema/prompt key. | **Material in both cases:** it limits which expenses the OOP amount covers. Page 31 names those expense types, but the saved short citations quote only the amount and Preferred services. | Reject/quarantine unless a permitted existing representation can preserve and evidence this scope without changing schema or manufacturing a citation. |
| `qualifiers.serviceType` — 1 occurrence | “Inpatient facility care” on the network-rules value. | Not a supported schema/prompt key. | **Material:** it limits the Preferred-facility requirement to inpatient facility care. The saved citation says “You must use Preferred facilities…” but omits the preceding “Inpatient facility care” label. | Reject/quarantine this candidate; do not fold the service scope into a broader network qualifier. |
| `qualifiers.exceptions` — 1 occurrence | “See Section 3” on the network-rules value. | Not a supported schema/prompt key. | **Material:** the source explicitly says exceptions exist, so omitting this condition could overstate the restriction. The saved citation omits the exception sentence. | Reject/quarantine this candidate; do not discard the exception or manufacture a broader citation. |

There are **11** unknown-key occurrences: `enrollment` 4, `network` 3, `expenseTypes` 2, `serviceType` 1, and `exceptions` 1. All affect value scope/applicability. The previous report’s “ten” count was incorrect; the saved response/replay shape contains `enrollment` on both deductible candidates and both OOP candidates.

The supported `period: "calendar year"` on the Self Only deductible is not an unknown key and is supported by its page-17 citation. The `$2,000` deductible candidate omits that period qualifier; do not copy it across from the peer candidate without attaching source evidence. The PDF’s larger page context states it, but the saved candidate citation is only `"deductible is now $2,000"`.

### Phase 1 classification

| Requirement | Status | Evidence |
|---|---|---|
| JSON response capture / exact saved bytes | **EXISTS** | Raw response and metadata are present in the private ignored run directory. |
| Strict row/value/document validation | **EXISTS** | `validateTable` enforces verdict, document membership, plan source, and evidence relationships. |
| Missing `documentId` recovery | **MISSING** | Existing cleanup compares evidence IDs with `value.documentId` and drops mismatches (`extract.ts:637-696`); it does not derive IDs from unambiguous citations. |
| Unknown qualifier preservation/rejection | **CONFLICT** | `normalizeLlmTable` filters through a known-key list, silently discarding other qualifier keys (`extract.ts:577-635`). |
| Missing verdict row handling | **MISSING** | Validator rejects missing verdict; no row-level quarantine precedes validation. |
| Malformed plan-source handling | **EXISTS** | Validator requires `sources`; route verifies them; page-1 attestation remains conservative. |
| C6 / plan attribution | **EXISTS** | Existing `resolveRowPlanIds` requires verified plan coverage and applicability/peer guards; this must remain unchanged. |

No schema, evidence-proof, product-semantic, or C6 change is justified by this phase. A narrow pre-validation quarantine/identity-reconciliation layer appears feasible within the existing schema, but its exact diagnostics and row-preservation behavior need owner review before implementation.

## Measured pipeline outcome

| Stage | Result |
|---|---|
| Provider response / JSON content parse | Complete; 3 rows, 5 value candidates, plus one proposed plan identity. JSON parsed successfully. |
| Normalization | Ran. Eleven unsupported qualifier keys across four candidates were discarded by the existing normalizer rather than rejected as candidates (see below). |
| Evidence-less candidate handling | **5/5 values dropped.** Each value omitted its required `documentId`; its evidence cited `fep-blue-focus-2027-diagnostic`, so `dropEvidenceLessValues` logged a cross-document mismatch against value `undefined`, then dropped the now evidence-less value. |
| Unsupported-period candidate rejection | **0 candidates reached this gate.** It is not evidence that unsupported periods are accepted or rejected in this run. The sole `period: "calendar year"` claim is source-supported. |
| Schema validation | **Failed:** `Invalid comparison table: plan sources required`. The plan object used `evidence` instead of required `sources`. Rows also omitted required `verdict`; values omitted required `documentId`; `planId` was put on rows rather than values. |
| Citation verification, independent pre-schema check | **5/5 value citations verified** as occurring on the cited original pages; **1/1 proposed plan citation verified** on page 1. These are occurrence checks, not proof that the cited passage establishes every meaning or qualifier. |
| Source plan attestation | **0 plans** from `attestPlans` on this document. Its current title/declaration recognizer does not recognize the brochure’s `FEP® Blue Focus` title as a page-1 attestation. The model-proposed name and source quote are mechanically verifiable, but the malformed plan object did not enter the route’s validated plan path. |
| Plan/tier/qualifier attribution and C6 | **Not reached; 0 attributed values / 0 C6 survivors.** No validated table exists. |
| Final usable facts | **0**. |

## Every value candidate and disposition

All five candidates were discarded at evidence/document ownership cleanup because `value.documentId` was absent while each citation named the diagnostic document ID. Although the citations independently verify, the existing pipeline does not infer a value’s document from its citation.

| Fact | Candidate | Citation | Source check / status |
|---|---|---:|---|
| `annual-deductible` | Self Only `$1,000`, “calendar year” | 17 | Source page says Self Only calendar year deductible is $1,000. Citation quote verifies. Candidate dropped for missing `documentId`. |
| `annual-deductible` | Self Plus One and Self and Family `$2,000` | 17 | Source page says those enrollment types have a $2,000 deductible. Citation quote verifies. Candidate dropped for missing `documentId`. The response omitted the applicable calendar-year qualifier on this value. |
| `out-of-pocket-maximum` | Self Only `$11,000`, Preferred providers | 31 | Source page states the Self Only Preferred Provider maximum is $11,000 and describes included cost types. Citation quote verifies. Candidate dropped for missing `documentId`. |
| `out-of-pocket-maximum` | Self Plus One and Self and Family `$22,000`, Preferred provider services | 31 | Source page states $22,000 for these enrollment types’ Preferred provider services. Citation quote verifies. Candidate dropped for missing `documentId`. |
| `network-rules` | Inpatient care requires Preferred facilities, subject to Section 3 exceptions | 31 | Exact restriction and exception reference are present on page 31. Citation quote verifies. Candidate dropped for missing `documentId`. |

The response proposed `FEP Blue Focus`, citing `FEP® Blue Focus` on page 1. That source text supports the identity semantically and the citation occurrence check passes, but the plan object supplied `evidence` instead of required `sources`; schema validation failed before plan verification/attribution.

## Qualifier safety finding

The response emitted eleven keys outside the current supported qualifier vocabulary (`planTier`, `networkTier`, `period`, `ageBand`, `conditions`, `currency`): `enrollment` (4 occurrences), `network` (3), `expenseTypes` (2), `serviceType` (1), and `exceptions` (1). The current `normalizeLlmTable` removes unknown qualifier keys before schema validation; it does not reject those candidates. Thus this run did **not** silently accept them as validated facts, because all values later dropped and the table failed, but the qualifier cleanup itself silently discarded potentially material enrollment/scope qualifiers. This behavior is a concrete contract gap against the instruction to preserve/reject unsupported qualifiers; it should not be described as successful qualifier rejection.

The supported `period: "calendar year"` on the Self Only deductible is present in the page 17 evidence context. No unsupported-period rejection was observed, and no unsupported-period qualifier is claimed to have survived.

## Comparison and interpretation

The earlier evaluation’s FEP result was reported as 47 rows / 23 values and failed schema validation at `annual-deductible.qualifiers.period`, before citation and attribution gates. This controlled run used an intentionally small output but failed earlier at structural compatibility (`plans[].sources` required), after the cleanup stage had already dropped all five values for missing `documentId`. Consequently, this experiment does **not** establish that the earlier period fix enables FEP facts to survive. It establishes that Sonnet 5.5 returned source-supported candidates and verifiable citations, but did not follow several required output-shape constraints.

## Smallest justified next engineering change

Historical Phase 1 recommendation; superseded by the Phase 2 approval and implementation summary below. No FEP-specific plan-title recognition was added.

## Phase 2 — approved fail-closed contract repair

### Implementation

`prepareLlmOutput` in `app/lib/extraction/extract.ts` now runs before qualifier normalization:

- Missing value `documentId` is filled only when all evidence entries provide exactly one shared ID and it is present in the actual input document set. Unknown, missing, conflicting, or explicit mismatched identities quarantine that value; filenames and plan names are not consulted.
- Rows with absent verdicts are dropped, without inventing a verdict. A valid independent row survives.
- Unsupported row-level `planId` is removed, with `ROW_LEVEL_PLAN_ID_UNSUPPORTED`; valid otherwise-supported values remain unassigned.
- Malformed/missing `plans[].sources` entries are removed with `MALFORMED_PLAN_SOURCES`; no `evidence` to `sources` rewrite or source fabrication occurs. Existing `validateTable`, route citation verification, plan attestation, and C6 code remain unchanged.
- Unknown qualifier keys are detected before normalization. Their candidate is quarantined with `UNKNOWN_QUALIFIER_KEY`; known material qualifiers that fail existing `sourcedQualifiers` evidence checks are quarantined with `UNSUPPORTED_QUALIFIER_EVIDENCE`.
- A candidate quarantine changes a populated row to `NEEDS VERIFICATION` and puts the reason code in its rationale. Empty `NEEDS VERIFICATION` rows remain unresolved through reconciliation and are not changed to `NOT STATED`.
- Missing candidate evidence is quarantined with `MISSING_VALUE_EVIDENCE`; identity failures use `AMBIGUOUS_VALUE_DOCUMENT_ID`, `UNKNOWN_EVIDENCE_DOCUMENT_ID`, `UNKNOWN_VALUE_DOCUMENT_ID`, or `VALUE_DOCUMENT_ID_MISMATCH`.

Rejection reason codes are also aggregated into a safe diagnostic warning. They are not a new schema field. Valid independent candidates/rows remain eligible for the unchanged schema and evidence gates.

### Before / after contract behavior

| Saved-response feature | Before | After Phase 2 preparation |
|---|---|---|
| 3 rows missing verdict | Table validation failed at first malformed row. | All missing-verdict rows are rejected as `MISSING_ROW_VERDICT`; no verdict is created. |
| 5 values missing document ID | Evidence cleanup discarded candidate citations, then values were dropped. | A value ID is derived only from its own unambiguous supplied citation identity; otherwise candidate is quarantined. |
| 11 unknown qualifier occurrences | Keys passed through normalization inconsistently / could be removed by later known-field filtering, losing scope. | Every unknown-key candidate is quarantined before normalization; its material qualifier is not presented as a benefit. |
| `plans[].evidence` and row `planId` | Schema/plan identity contract mismatch. | Malformed plan dropped; row-level claim removed; no plan ownership propagated. |
| Candidate rejected for extraction contract | Existing evidence-less cleanup could convert emptied rows to `NOT STATED`. | Contract rejection remains `NEEDS VERIFICATION` where a row is retained; rejection is not treated as noncoverage. |

### Regression and safety checks

Focused tests in `tests/unit/extract-normalize.test.ts` cover one-document identity derivation, ambiguous and unknown identity, explicit mismatch, missing verdict with a valid peer row, all five named unknown qualifier keys, supported versus unsupported condition evidence, malformed plan sources, and row-level plan ID removal. Existing `tests/unit/document-ownership.test.ts` covers plan ownership and C6 safeguards; the protected implementation was not changed.

Phase 2 did **not** replay the saved response. No remote provider call, PDF transmission, or saved-response modification was made. Phase 3/4 remain outside this approval.

### Current disposition

- **Implementation:** partial — the narrow repair and regression coverage are implemented; requested full validation is not wholly green because TypeScript reports local replay-run script type errors (`pageCount` omitted in `nonstandard/fep-sonnet-replay-run/replay-saved.ts` and `run-once.ts`). Those diagnostic scripts were not changed.
- **Verification:** focused extraction/evidence/schema/C6 suite: 78 passed. Full `npm test`: 99 files passed, 2 skipped; 877 tests passed, 6 skipped. `git diff --check`: see final check status in the phase terminal.
- **Preserved:** valid independent candidates with supported qualifier evidence; existing normalization, comparison schema, citation verification, plan attestation, evidence semantics, and C6 gates.
- **Rejected/quarantined:** missing-verdict rows, ambiguous/unknown/mismatched identities, missing evidence, unknown qualifier candidates, unsupported known material qualifiers, malformed plan sources, unsupported row-level plan associations.
- **Further approval:** required before Phase 3 (broader regression suite expansion) or Phase 4 (exact saved-response replay). No schema/proof/product-semantic change was made.

## Phase 2 — TypeScript verification closure

The two prior compiler errors had the same cause: both offline diagnostic runners constructed the session/extraction document fixture with `documentId`, `filename`, and a sparse `pages` array, but omitted required `pageCount`. The contracts require `pageCount` separately from `pages.length` (`ExtractInputDocument` in `app/lib/extraction/extract.ts`; `SessionDocumentLike` in `app/lib/evidence-verification.ts`).

Both scripts now set `pageCount: source.pageCount` from the source metadata (`source-pages.json` says 140), while retaining the 140-slot page array and placing selected text at its original 1-based page offsets. No count is computed from the sparse array. Document ID, source pages, raw provider response, and private artifacts were not changed. `run-once.ts` was not executed.

Closure checks:

- `npx tsc --noEmit`: **PASS**.
- `npm test`: **PASS** — 99 files passed, 2 skipped; 877 tests passed, 6 skipped.
- Focused unknown-qualifier, malformed-plan, plan-identity and C6 tests: **PASS** — 82 tests passed. Unknown qualifiers and unsupported plan claims remain fail-closed.
- `git diff --check`: **PASS**.
- Application code changed for this closure: **NONE**.

Phase 3 and Phase 4 were not started. Stop for owner review.

## Phase 4 — exact saved-response replay

**Authorization:** Owner-approved Phase 4. Replay ran locally and in-memory against `provider-response.raw.json`; no provider request was made. The previous `replay-saved.ts` was not executed because it does not invoke the Phase 2 `prepareLlmOutput` stage and writes a replay artifact. The current functions were called directly; no diagnostic artifact or test fixture was changed.

### Input integrity and parsing

- Saved provider envelope SHA-256: `a3bb133d21a1177401dea2faf9350007f6a56498a67e071e15dccdbc6be9a9d7` (computed for this replay; no prior response-file digest was present in metadata for comparison).
- Raw source PDF SHA-256: `9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f4`, matching both `source-pages.json` and `metadata.json`.
- Configured, metadata, and envelope model identities all match: `claude-sonnet-5-5`; saved finish reason is `stop`.
- Saved content JSON parsed successfully. Source metadata declares 140 PDF pages and selected original pages `[1, 17, 31]`. Replay constructed 140 page slots and inserted each selected page at `pageNumber - 1`; page numbering was not compacted or inferred from the sparse array.

### Stage funnel and counts

Exact pipeline exercised: JSON parse → `prepareLlmOutput` → `normalizeLlmTable` → `dropEvidenceLessValues` → `reconcileLlmTable` → `rejectUnsupportedPeriodCandidates` → `validateTable` → independent citation checks → `attestPlans` → `resolveRowPlanIds` (C6).

| Stage / measure | Result |
|---|---|
| Raw rows / value candidates / proposed plan | 3 / 5 / 1 |
| Rows rejected at preparation | 3, all `MISSING_ROW_VERDICT` (annual deductible, out-of-pocket maximum, network rules) |
| Value candidates accepted | **0** |
| Value candidates rejected | **5**, because all belonged to the three rejected rows; none reached per-value normalization or schema validation |
| Candidate-level quarantines after row handling | **0**; no row reached that stage |
| Plan claims | 1 rejected at preparation for malformed sources |
| Rows/values after preparation and normalization | 0 / 0 |
| Schema validation | **Passed on an empty row set**; this is not a validated-facts result |
| Materially supported facts / benefits | **0** |

### Rejection codes and fields blocked upstream

Observed `prepareLlmOutput` rejection codes, all at **pre-normalization preparation**:

| Code | Count | Affected input |
|---|---:|---|
| `MISSING_ROW_VERDICT` | 3 | Each of the three rows; their five nested values were consequently rejected with their parent rows. |
| `MALFORMED_PLAN_SOURCES` | 1 | The sole proposed plan uses `plans[].evidence` and has no required `sources`; it was removed, not rewritten. |

The raw rows also carried 3 unsupported row-level `planId` claims, 5 missing value `documentId` fields, and 11 unknown qualifier occurrences (`enrollment` ×4, `network` ×3, `expenseTypes` ×2, `serviceType` ×1, `exceptions` ×1). Those claims did **not** receive separate `ROW_LEVEL_PLAN_ID_UNSUPPORTED`, identity, or `UNKNOWN_QUALIFIER_KEY` codes in this exact run: preparation rejects each row immediately for its absent verdict, before inspecting its nested values or row-level plan ID. Thus all affected candidates and qualifiers were safely prevented from acceptance, but this replay does not count them as individually quarantined by those later checks. No missing-document-ID derivation was exercised in the exact replay.

The saved values’ five citations all name the same known input document ID, so the approved derivation precondition is met in principle; no conflicting/unknown/explicitly mismatched value identity occurs in the saved input. The existing focused tests separately exercise derivation from one known citation identity and fail-closed ambiguous, unknown, and explicit mismatched identities.

### Citation occurrence, plan attestation, and C6

- Value citations: **5/5** independently verified as occurring on the selected original pages.
- Proposed-plan citation: **1/1** independently verified as occurring on original page 1.
- These are occurrence/provenance results only; they do not make an unvalidated value or malformed plan valid.
- `attestPlans` found **0** plans. In particular, the title `FEP® Blue Focus` does not meet the current first-page attestation recognizer’s accepted patterns.
- C6 assignments: **0**; there were no validated values to attribute and no source-attested plan. No unassigned fact was represented as a verified plan benefit.

### Semantic review and outcome

The source pages contain deductible and out-of-pocket enrollment distinctions and a Preferred-facility restriction with explicit exceptions. The raw response’s qualifiers preserve materially relevant scope, but its cited excerpts do not uniformly establish all of that scope; mechanical quote occurrence is not semantic proof. Those five candidates are rejected upstream for missing verdicts, and the malformed plan claim is rejected for missing `sources`. The replay creates no replacement facts, plan identity, or citations.

**Phase 4 verdict: FAIL for usable validated facts; PASS for fail-closed behavior.** Remaining incompatibilities are the three missing row verdicts, five missing value document IDs (not reached for derivation in this replay), eleven unknown material qualifier occurrences (blocked with their rows, not individually dispositioned), three row-level plan IDs (blocked with their rows), and the malformed plan source structure. Source attestation and C6 yield no plan or attributed value.

### Phase 4 checks

- Focused extraction/evidence/schema/plan-identity/C6 regression tests: **99 passed** across 6 files.
- `npx tsc --noEmit`: **PASS**.
- `git diff --check`: **PASS**.
- No provider call, PDF transmission, saved-response change, script/fixture/production/schema/UI edit, database write, or generated replay artifact.

**Files changed for Phase 4:** `docs/FEP_EXTRACTION_REPLAY.md` only. Stop for owner review; no subsequent phase is started.

## Phase 5 — schema-compliant LLM output contract

### Contract audit

The production prompt already listed the five verdict enum values and had a row/value shape containing `verdict` and `values[].documentId`; these requirements were **present but under-emphasized/ignored** in the saved response (three verdicts and five value IDs were absent). The prompt required exact quotations and 1-based evidence pages, but did not state that pages must retain original PDF indexes when only selected pages are sent.

Requirements missing or ambiguous in the old prompt:

- No plan object example or exact `plans[].sources` shape; it did not forbid `plans[].evidence` or explain when a plan may be asserted.
- No explicit prohibition on row-level `planId` or safe value-level plan association.
- Its short qualifier list omitted the supported premium fields (`ageMin`, `ageMax`, `amount`, `frequency`) and currency behavior introduced by the existing types/prompt; premium instructions separately named four of these. It did not say that concepts such as enrollment, service scope, included expenses, and exceptions must not be dropped or mapped to invented keys.
- `display` was required to retain qualifiers, but evidence was not explicitly required to establish the value and its full scope together. No instruction said to abstain when schema/evidence cannot safely preserve that scope.
- It did not distinguish `NOT STATED` from extraction/schema uncertainty or require a context-field rationale for `DOES NOT APPEAR TO FIT`.

No protected schema change was needed. Existing `conditions` and `networkTier` can carry some source-supported scope; anything that cannot be represented and evidenced safely must remain unresolved.

### Prompt changes

Only `EXTRACTION_INSTRUCTIONS` in `app/lib/extraction/extract.ts` changed. It now explicitly requires the closed verdict enum, each value’s own matching document ID, exact evidence tied to original 1-based PDF pages, optional plans in the existing `sources` shape, source-declared plan identity, and no row-level `planId`. It limits output to recognized qualifier fields, names unsupported source concepts as non-keys, preserves scope in display/recognized qualifiers and supporting citations, and requires `NEEDS VERIFICATION` rather than an unconditional or `NOT STATED` claim when safe representation is impossible. It also clarifies context-field rationale and multi-document plan identification requirements.

### Regression tests and verification

- Added a prompt-contract test that captures the actual production prompt and checks required verdicts, identity, page numbering, `sources`, plan-ID prohibition, allowed qualifiers, scope concepts, and unresolved semantics.
- Added validator tests for a valid synthetic scoped value with a source-backed plan `sources` object, and invalid payloads missing verdict, value identity, or plan sources. Validator behavior was not changed.
- Focused tests: **97 passed** (5 files), including extraction prompt, schema, document ownership/C6, plan identity, and citation verification tests.
- `npm test`: **PASS** — 99 files passed, 2 skipped; 880 tests passed, 6 skipped.
- `npx tsc --noEmit`: **PASS**.
- `git diff --check`: **PASS**.
- No model call, PDF transmission, schema/validator/C6/citation/UI change, dependency, or architecture change.

### Limitations

Prompt compliance has not been measured against another model response; Phase 4’s exact saved response was not altered or replayed again. Some material source constructs may still not fit the approved qualifier vocabulary; the prompt now directs those candidates to unresolved output rather than lossy normalization. Further output-quality claims require separate evaluation authorization.

**Phase 5 files changed:** `app/lib/extraction/extract.ts`, `tests/unit/extract-normalize.test.ts`, `tests/contract/comparison-schema.test.ts`, and this report. Stop for owner review.

## Safety / files

- Exactly **one** document-content LLM request was made; no retry or identity probe.
- No PDF was uploaded beyond that single request’s selected-page text; no application code/schema/prompt contract, UI, provider, infrastructure, or database files were changed.
- No dependencies, commits, pushes, deployments, destructive operations, or subagents.
- Report authored: `docs/FEP_EXTRACTION_REPLAY.md`.
- Private ignored diagnostics: `nonstandard/fep-sonnet-replay-run/` (source pages, request runner, exact response envelope, metadata, replay-only script/results).

## Phase 6 — live acceptance blocked before request

**Status: NOT RUN; no Phase 6 document-content request was sent.** The local runtime configuration was safely checked: `LLM_MODEL=claude-sonnet-5-5`, and both base URL and key are configured (secret values were not displayed). The requested PDF hash matches the recorded source (`9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f4`); the selected-page record retains original document page count 140 and pages 1, 17, and 31.

The required execution constraints cannot be met by the existing production extraction call path without changing code or bypassing the production client:

- `extractViaLlm` calls `completeJson` without request options. `completeJson` may retry retryable HTTP statuses up to three attempts (`app/lib/llm/client.ts:14-16, 31-52`), so it cannot guarantee at most one outbound request.
- The client request body has no response-token bound (`app/lib/llm/client.ts:33-45`). Adding an ad-hoc direct HTTP call, monkey-patching, or editing the client/prompt to impose one would violate the requested use of the existing production call path and the no-code/prompt-edit constraint.
- The Phase 5 production prompt itself enumerates the production fact list (`app/lib/extraction/extract.ts:547-550`) and has no five-candidate cap; the client call also exposes no request-time cap. Sending a different or augmented evaluation prompt would not test the exact production prompt.

**Phase 6 results:** model configured identity verified locally; actual response model, prompt sent/hash, completion status, token usage, JSON parsing, pipeline stage counts, citation/semantic results, plan identity, and C6 attribution are **not available** because no request was made. No Phase 6 response/metadata artifact was created. Phase 4 results remain historical and are not reused as Phase 6 evidence.

**Resolution required:** owner authorization for a narrowly scoped production-client change (one-attempt mode and explicit output-token bound, without changing prompt text), or a revised acceptance procedure that permits an alternate one-shot transport. Until that decision, live acceptance remains blocked. No production files were changed for Phase 6; this report records the blocker only.

## Phase 6A — bounded LLM client controls

### Implementation

Added optional `maxAttempts` and `maxTokens` controls to the existing `completeJson` client. `maxAttempts` overrides the retry loop's attempt ceiling; `maxTokens` is sent as the OpenAI-compatible Chat Completions `max_tokens` request field. Both values must be positive integers. With options omitted, the existing three-attempt retry budget and request body remain unchanged (no `max_tokens` field is sent). Response parsing, exact structured-envelope checks, provider `finish_reason: "length"` error, malformed-JSON error, and secret-free error messages were left intact. No call sites, extraction prompt/schema, validation, C6, or UI were changed.

The provider-compatible field is grounded in the OpenAI Chat Completions request reference and the repository's prior successful Phase 4 request: `nonstandard/fep-sonnet-replay-run/run-once.ts` sent `max_tokens: 3000` to the configured OpenAI-compatible `/chat/completions` endpoint, which returned HTTP 200. That historical response completed below the limit, so it confirms request acceptance, not an observed length-truncation boundary. No LLM call was made in Phase 6A; runtime enforcement at a reached limit remains untested under this phase's no-call constraint.

### Tests and checks

- Focused client tests verify unchanged default retry behavior/no default token field, one-attempt behavior on a retryable error, and transmission of `max_tokens` when requested. Existing tests in the same file cover provider length termination, malformed JSON, valid JSON, exact structured-envelope unwrapping, and invalid-envelope rejection.
- Focused tests: **26 passed** (`tests/unit/llm-client-retry.test.ts`). The new control tests failed before implementation for the expected reasons (three calls instead of one; absent request token field), then passed after the client change.
- `npm test`: **PASS** — 99 files passed, 2 skipped; 882 tests passed, 6 skipped.
- `npx tsc --noEmit`: **PASS**.
- `git diff --check`: **PASS**.
- No provider call, PDF transmission, dependency, schema/prompt/UI change, migration, infrastructure change, commit, push, deployment, or destructive Git operation.

**Phase 6A files changed:** `app/lib/llm/client.ts`, `tests/unit/llm-client-retry.test.ts`, and this report. The Phase 6 live acceptance itself remains unrun and needs its own authorized execution after these controls are reviewed.

## Phase 6B — one-shot live FEP acceptance

**Status: FAIL / INCOMPLETE; no replay performed.** Preflight confirmed the configured model `claude-sonnet-5-5`, source PDF SHA-256 `9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f`, 140-page source identity, and selected original pages `[1, 17, 31]`. A no-network test captured the exact prompt generated through `extractViaLlm` and verified its Phase 5 contract and the selected-page text. Prompt SHA-256: `5f13a23cd1857969c9cc91acc9ffacdd2d1739d8ce6495883e81ac275ec022b0`.

The live harness invoked the production extraction path with `completeJson` wrapped to pass `maxAttempts: 1` and `maxTokens: 6000`; the intercepted request body was checked for model `claude-sonnet-5-5` and `max_tokens: 6000`, and a guard rejects a second fetch. **One outbound fetch was initiated.** The Vitest diagnostic timed out at its default 5,000 ms before that fetch resolved. It captured no provider response; HTTP status, returned model, finish reason, and token usage are unknown. No raw response file exists. Because the authorized request limit was one, no retry or second attempt was made.

Accordingly, no response JSON was parsed and no candidate entered normalization/schema validation, citation verification, plan attestation, or C6. Raw/accepted/rejected candidate counts, reason codes, citation results, plan identity, C6 attribution, and semantic accuracy are unavailable—not zero-valued acceptance results. Phase 4's prior output is not substituted for this run. No claim of safe fact promotion or acceptance is made.

Private ignored diagnostics in `nonstandard/fep-sonnet-replay-run/phase6b-live/` contain the preflight metadata and a metadata record of the single attempted request (both mode `0600`; directory mode `0700`). The response is not represented as captured. No production code, prompt, schema, database, frontend, provider configuration, or dependency was changed; no additional PDF content was sent after the single attempted call.

**Phase 6B next step:** stop for owner review. Any follow-up live attempt requires explicit new authorization because the one-call allowance for this run has been consumed; before that, adjust only the private diagnostic runner's timeout/capture handling, without changing the production pipeline.

## Phase 6C — diagnostic harness reliability

**Date:** 2026-10-28. **No provider request or PDF transmission was made.**

### Timeout and original-response diagnosis

The exact five-second limit was Vitest's default `testTimeout` for non-browser tests (`node_modules/vitest/dist/chunks/coverage.DfSpMS-b.js` resolves it to `5e3`); the Phase 6B private config had not overridden it. The observed error was emitted by Vitest: `Test timed out in 5000ms.` This is a test-framework timeout, not a timeout configured by `completeJson`: the production client calls `fetch` without an `AbortSignal` or client timeout. Its retry control is separate; the private wrapper passed `maxAttempts: 1`.

The original request's fate cannot be determined from local evidence. The harness awaited `realFetch` before cloning/reading the response or writing either response bytes or metadata. Thus a response that had not arrived by the framework deadline was not captured. No signal from the test timeout was wired to the fetch, so the harness did not explicitly abort it. The runner process is no longer active, but no process/provider logs establish whether the request later completed remotely, whether runner teardown closed its socket, or whether the provider itself timed out. Provider-side timeout and process termination as the cause are therefore **unknown**, not inferred from the Vitest message.

The Phase 6B-specific directory contains no raw response artifact. A complete response does exist in the parent replay directory, but its existing metadata identifies it as the earlier `fep-blue-focus-5-facts-v1` response (HTTP 200, `finish_reason=stop`), not the timed-out Phase 6B request. It was already replayed there and its existing replay record is retained unchanged. It was not substituted or attributed to Phase 6B. No other local logs or response files matching this run were found.

### Private harness changes and local verification

- Added `capture.ts` to the ignored Phase 6B directory. It enforces a 120-second diagnostic fetch/body timeout with an `AbortController`; atomically writes exact response bytes before metadata, both mode `0600`; and reports distinct `diagnostic_timeout`, `transport_error`, local `capture_error`, provider HTTP error/provider HTTP timeout (408/504), and generation truncation outcomes. If no response/usage is available, metadata says `UNKNOWN` and `responseComplete: false`.
- Added mocked delayed-response checks for exact-byte persistence, model/finish/usage metadata, source-page/prompt identity preservation, abort-on-timeout, transport failure, HTTP 503, and `finish_reason=length`. The main diagnostic Vitest test timeout is now 150 seconds, above the explicit 120-second fetch budget; production client defaults are untouched, and the one-attempt wrapper remains in place.
- Ran the private harness with `PHASE6B_LIVE` unset (mock/preflight mode): **2 test files passed, 5 tests passed**. Mock fetches used a local fake URL and no network provider. `capture.test.ts` used an 80 ms simulated response delay and a 20 ms simulated timeout. No LLM request or PDF transmission occurred.

**Production code changed:** none. **Prompt, schema, C6, validation, UI, database, cloud, and dependencies changed:** none. The previous private response and replay artifacts were preserved. These checks establish local capture behavior, not provider latency or provider-side timeout behavior. The 120-second budget follows the repository's documented 60-second initial generation guidance with a bounded diagnostic margin; actual latency for the missing Phase 6B response remains unmeasured.

**Phase 6C recommendation:** harness is locally ready for an explicitly authorized controlled retest. This phase does not authorize that request; stop for owner review.

## Phase 6D — controlled live FEP acceptance

**Date:** 2026-10-28. **Acceptance: FAIL — generation truncated.** Exactly one live model inference request was made; there was no retry or second inference request. The configured and returned model identities were both `claude-sonnet-5-5`. The existing Phase 5 production extraction prompt was invoked through `extractViaLlm`; prompt SHA-256 was `5f13a23cd1857969c9cc91acc9ffacdd2d1739d8ce6495883e81ac275ec022b0`. The source was `FEP-Blue-Focus-Brochure-2027-10-23.pdf`, SHA-256 `9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f4`, page count 140, with only original pages 1, 17, and 31 populated in the source record. The request used `maxAttempts: 1` and `maxTokens: 6000`.

The provider returned HTTP 200 in about 33.2 seconds, within the configured 120-second diagnostic timeout. A complete 27,573-byte HTTP response body was captured at `nonstandard/fep-sonnet-replay-run/phase6d-live/provider-response.raw.json`; its SHA-256 is `c5992e5e5f027219bd66441000062815bb6a5f99971b28398f49c14e6a183afa`. Metadata and response artifacts are mode `0600` inside a mode `0700` ignored directory. Provider usage: 6,686 prompt tokens, 6,000 completion tokens, 12,686 total. `finish_reason` was `length` at the requested output-token limit.

**Stop stage:** the generation was incomplete. The existing client recognized `finish_reason=length` and rejected it as incomplete before parsing the generated extraction JSON. The harness marked the run `INCOMPLETE` and stopped. It did not parse candidates, normalize, validate schema, verify citations, attest plan identity, perform C6 attribution, or assess semantic accuracy. Raw candidate count is **UNKNOWN / not parsed**; validated candidates: **0 reached validation**; quarantined candidates: **UNKNOWN / not parsed**. Citations verified: **none (verification not run)**. Plan identity and C6 survival: **not evaluated**. Semantic/qualifier review: **not run**, as required for truncation; no partial output was promoted.

**Capture-order limitation:** the exact response bytes were preserved, but the current capture helper extracts envelope metadata (including `finish_reason` and usage) before atomically writing the raw response. Thus this run did not satisfy the stricter “persist bytes before any parsing” ordering, although it did persist the complete body before extraction-content parsing or validation. This is a harness issue for owner review; no additional request was made to address it.

The full mocked harness suite also ran during this invocation: 2 test files, 5 tests passed. The original Phase 6B diagnostic artifacts and earlier saved provider response remain untouched. Private Phase 6D artifacts are in the separate ignored `nonstandard/fep-sonnet-replay-run/phase6d-live/` directory. No production code, prompt, schema, provider configuration, UI, database, cloud resource, or dependency was changed.

For artifact isolation, this phase changed only the ignored harness test output paths in `phase6b-live/phase6b.test.ts` and `phase6b-live/capture.test.ts` to write under the new Phase 6D directory; no earlier Phase 6B/6C artifacts were overwritten.

**Phase 6D next step:** stop for owner review. A further inference request is not authorized by this run; the incomplete response must not be retried or treated as acceptance evidence.
