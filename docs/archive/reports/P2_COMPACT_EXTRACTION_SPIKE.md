# P2 Compact Extraction Spike

**Status:** Offline structural spike complete and a separately authorized live proof is appended below; neither changed production behavior. The offline spike made no provider request or PDF transmission. The live proof made one bounded request over only the selected page text. Phase 6D's incomplete content was inspected only for structural counts and was not parsed into candidate facts.

## 1. Truncation and output-budget findings

Phase 6D used the existing Phase 5 extraction prompt with `max_tokens: 6000`. The provider returned HTTP 200, `finish_reason=length`, and exactly 6,000 completion tokens (6,686 prompt; 12,686 total). The client stopped the response before extraction JSON parsing. This establishes the immediate truncation condition: generation reached the configured output-token ceiling.

The captured content prefix is 8,604 UTF-8 bytes and does not end in complete JSON. Structural-only counting of that prefix found:

- 26 `factName` and 26 `verdict` fields;
- 17 empty `values` arrays paired with 17 `NOT STATED` verdicts;
- 13 `qualifiers` objects and 13 `evidence` arrays;
- no repeated `rationale` fields;
- an ending inside a citation object.

This is consistent with substantial repeated fixed-row overhead, including a verdict and row/value scaffolding for facts with no values. It does **not** prove fixed rows were the sole cause of truncation: the run did not complete, and there was no compact-prompt counterfactual. Citation quote payloads and supported-value detail also consume output. The captured-prefix counts are not counts of a complete response.

The repeated empty rows and verdicts can be omitted in a sparse candidate representation. Citation page and quote, document identity, plan proposal evidence, and any explicit scope/condition must remain. No citation or qualifier is removed from a populated fact.

## 2. Minimal experimental candidate shape

The isolated validator in `nonstandard/p2-compact-spike/compact-candidate.ts` accepts this compact envelope:

```json
{
  "v": 1,
  "docs": [{ "d": "doc-1", "role": "plan", "e": [[1, "source quote"]] }],
  "plans": [{ "d": "doc-1", "name": "Plan name", "e": [[1, "source quote"]] }],
  "facts": [
    {
      "d": "doc-1",
      "concept": "open-vocabulary-concept",
      "values": [
        {
          "value": "concise source value",
          "scope": {
            "enrollment": "Self Only",
            "network": "Preferred",
            "exceptions": "..."
          },
          "e": [[17, "verbatim source quote"]]
        }
      ]
    }
  ],
  "unresolved": [
    {
      "d": "doc-1",
      "concept": "...",
      "reason": "...",
      "e": [[31, "optional evidence"]]
    }
  ]
}
```

`e` entries are `[1-based original page, quote]` tuples, scoped by `d`. The document role vocabulary in the spike is `plan`, `program`, `educational`, and `unknown`. Scope is sparse and open to the listed keys: enrollment, network, tier, period, ageBand, currency, frequency, service, conditions, exclusions, and exceptions. Unknown keys fail closed rather than being silently discarded. An unresolved item may omit evidence when it records an abstention rather than a supported claim. Missing facts are omitted; `NOT STATED` is not a candidate value or synthesized row.

The validator is structural only. It checks envelope shape, document identity against the supplied manifest, page bounds, non-empty citation tuples, known scope keys, and basic plan-name/evidence consistency. It does not establish that a quote occurs on a page or that the quote semantically supports the value. Production citation verification and plan attestation remain mandatory.

## 3. Local validation and compatibility

Isolated test command:

```text
npx vitest run --config nonstandard/p2-compact-spike/vitest.config.ts
```

Latest run: **3 test files passed; 10 tests passed.** Coverage includes:

- valid compact candidate structure and enrollment-separated values;
- preservation of conditions/exceptions and unresolved/abstention states;
- rejection of unknown scope keys, missing/unknown/conflicting document identity, missing/invalid citations, unsupported plan-name assertions, and plan proposals on non-plan documents;
- rejection of `NOT STATED` as a value without synthesizing absent facts;
- source-backed citation verification using the earlier, complete saved response and source-page record. That saved response is a different prompt run and is not attributed to Phase 6D;
- synthetic conversion through the unchanged `validateTable`, `verifyEvidenceCitation`, `attestPlans`, and `resolveRowPlanIds` (the existing C6 plan-attribution gate). Both enrollment values survive citation/schema checks and receive the attested plan scope; an exception citation is also verified;
- a deliberately unsupported enrollment qualifier from the earlier saved response is rejected by the existing production schema validator rather than promoted.

`npx tsc --noEmit` was also attempted. After correcting type errors in the spike files, it remains blocked by an error outside this spike at `nonstandard/fep-sonnet-replay-run/phase6b-live/phase6b.test.ts:121` (`response` is not narrowed on a response/transport-error union). No code in that diagnostic path was changed for this spike.

This demonstrates a local compatibility seam, not production readiness. The compact validator does not call or modify production validators. An adapter would need to preserve document IDs, original pages, exact quotes, value scopes, and abstentions, then pass only supported representations through existing verification and attribution gates.

## 4. Serialized output-size comparison

Compared UTF-8 bytes of `JSON.stringify` output for equivalent synthetic content: one document, one source-backed plan proposal, three supported concepts, the same three values/citations/scopes (including enrollment, network, and an exception), and no model-generated text. The fixed-shape fixture contains 26 rows, with the 3 populated rows plus 23 empty `NOT STATED` rows; 26 reflects the observed Phase 6D captured-prefix row count, not a claim about its eventual total. The compact fixture carries the same three populated facts and omits empty rows.

| Representation       |                  Serialized bytes |
| -------------------- | --------------------------------: |
| Fixed 26-row fixture |                             2,915 |
| Compact fixture      |                               968 |
| Difference           | 1,947 fewer bytes (66.8% smaller) |

This is a deterministic serialization comparison of hand-built fixtures only. It is **not** a tokenizer measurement, a model output measurement, or a claim that a live model will save 66.8% of output tokens. The fixtures and calculation are in `nonstandard/p2-compact-spike/size-comparison.test.ts`.

## 5. Production integration boundary

No integration was made. A future, separately approved experiment could replace only the extraction prompt/output contract at the provider-response boundary, after complete-response/finish-reason handling and before production normalization/`validateTable`. The compact payload must first be structurally validated; then source citations must pass the existing canonical page verifier, plans must pass existing attestation, and any values entering the current result path must pass the unchanged schema and C6 attribution gates. No incomplete generation may enter this boundary.

There is a material compatibility decision: open-vocabulary concepts and sparse absence do not map losslessly to the current fixed fact-name/row schema. A converter must not invent `NOT STATED` rows or discard unknown facts. Whether P2 consumes compact candidates directly or supports only a controlled subset through a v1 adapter is unresolved and requires owner approval. Dynamic grouping / a changed user-visible path is outside this spike and requires separate phase approval. No production prompt, schema, C6 logic, API, UI, data ownership, or architecture changed.

## 6. Risks and unresolved decisions

- Structural validation cannot prove evidence support; exact quote verification and semantic qualifier review remain required.
- The spike's plan-name check is a substring check, not identity attestation. Existing plan attestation remains authoritative.
- Scope vocabulary and normalization rules need an owner decision before any prompt contract is standardized; this spike rejects unknown keys rather than losing qualifiers.
- Open concepts do not fit the closed production fact-name list without a deliberate adapter/consumer decision.
- The 26-row Phase 6D count is only a count in the incomplete prefix. The byte comparison models that observed shape and is not a reconstructed full response.
- Truncation at the configured ceiling is confirmed; the relative contribution of row repetition versus evidence/value content is not isolated.
- The earlier complete saved response is used only as a separate, source-backed local citation fixture; it is not evidence of Phase 6D acceptance.

## 7. Smallest next live experiment

Original recommendation (subsequently authorized and executed in the appended live-proof phase): use one no-retry compact-output request on the same FEP source identity and selected pages, persist response bytes before parsing, and stop short of production promotion. No additional request is authorized by this report.

## Human terminal

```text
PHASE: Compact extraction spike
TRUNCATION ROOT CAUSE: Generation reached the configured 6,000 completion-token ceiling (`finish_reason=length`). Fixed-row repetition is a supported output-burden hypothesis, not an isolated sole cause.
COMPACT FORMAT: Sparse document/role, plan/evidence, open-vocabulary fact/value/scope/evidence, and unresolved/abstention candidate; absent facts omitted.
LOCAL VALIDATION: 3 isolated test files passed; 10 tests passed. No provider call or PDF transmission.
OUTPUT SIZE COMPARISON: 2,915 bytes fixed fixture vs 968 compact (66.8% fewer serialized bytes; not a token-savings claim).
PRODUCTION CODE CHANGED: None.
FILES CHANGED: docs/P2_COMPACT_EXTRACTION_SPIKE.md; ignored local spike files under nonstandard/p2-compact-spike/.
NEXT LIVE TEST: Completed below under the separately authorized Compact Sonnet live proof phase.
STATUS: Offline spike complete; live proof appended below; stopped for owner review.
```

## Phase 2 — compact Sonnet live proof

**Authorization:** Owner-approved one-shot live proof. Exactly one document-content model request was sent; the fetch guard and `maxAttempts: 1` prevented any retry. No other provider request or PDF upload occurred. The request sent extracted text for original PDF pages 1, 17, and 31 only; no other page text was included.

### Preflight and capture

- Fixed the Phase 6B diagnostic fixture's TypeScript union narrowing with a final `"response" in capture` guard. `npx tsc --noEmit` passed before the remote request.
- Ran the existing private response-capture mocked tests: **4 passed**. Mock output was redirected to the new spike-only `nonstandard/p2-compact-spike/capture-mocks/` directory so earlier Phase 6B/6D artifacts were not overwritten.
- Changed the private capture helper to persist exact response bytes before parsing envelope metadata, as required for this run. The live response directory and its files are mode `0700` and `0600`, respectively.
- Configured model and returned model: `claude-sonnet-5-5` / `claude-sonnet-5-5`.
- Source PDF SHA-256: `9841e6ebcf6b67ad3d1e16346818e2b7fbcd22ca5ca9bbe2b06962d8533527f4` (matched local source manifest). Page count: 140. Selected original pages: `[1, 17, 31]`.
- Prompt SHA-256: `4c4f63715fddc4d41e1fcfebda75729f277e0e929452248f3d365d7c042e9173`.
- Complete raw response: 18,259 bytes; SHA-256 `be215afceb484ae991fbf745a18137367d6d5c7636e731f15abf6ff0385b6f09`.

### Response and compact candidates

- HTTP status: 200; response body fully captured before content parsing; `finish_reason=stop`.
- Usage: 3,098 prompt tokens; 3,396 completion tokens of the 4,000-token limit; 6,494 total. Elapsed time: 20,114 ms.
- The compact JSON parsed successfully. It contained 1 document-role candidate, 1 plan proposal, **5 fact concepts** (8 scoped values), and 0 unresolved entries. No empty predefined rows were emitted.
- The compact validator accepted all five fact concepts, but rejected the plan proposal with `PLAN_NAME_NOT_IN_EVIDENCE`: proposed `FEP Blue Focus` is not a literal substring of either cited source quote (`FEP® Blue Focus` / `131 FEPBlue Focus - Self Only`).
- Existing `verifyEvidenceCitation` confirmed occurrence of **14/14** quotes across document, plan, and fact candidates. This establishes occurrence only, not that every quote supports its associated scope.
- Existing `attestPlans` returned **0** plans. Manual page-1 review confirms the brochure title names `FEP® Blue Focus`, but the production attestor did not recognize it. C6 was not invoked.

### Semantic review and verdict

At least one material value is correctly identified: the Self Only calendar-year deductible is `$1,000`, with enrollment and period scope matching its page-17 statement. However, page 17 explicitly says its change descriptions are **not** the official statement of benefits; the response omitted that caveat. It is therefore not ready for production promotion.

The remaining output is mixed. The `$2,000` deductible citation omits the enrollment wording and its `calendar year` scope is not established by that quote. The OOP values appear in the source, but the response failed to cite the complete page-31 maximum passages; its broad exclusion list is paired with a truncated penalty quote, and the family-member exception is not supported by its cited page. Maternity and pharmacy amounts match the change text, but the page-17 disclaimer is missing; the pharmacy and enrollment-eligibility citations also omit material introductory/exception wording. No individual enrollment or coverage assertion was observed.

The response omitted the explicit page-31 inpatient Preferred-facility requirement and its Section 3 exceptions, the overseas-care exception, and the full official OOP maximum/exclusion context. Thus material network/exception scope was not comprehensively preserved, and occurrence-verified citations must not be mistaken for semantic validation.

**Acceptance: PARTIAL.** Compact generation completed under the output limit and produced five useful open-vocabulary fact concepts, including at least one materially correct source-supported value. It did not meet the complete success criteria: the plan candidate fails the spike validator, the production attestor recognizes no plan, several material qualifiers lack supporting citation context, and network exceptions were missed. No candidates were promoted. Production mapping remains **BLOCKED**: no coercion through `validateTable`, no qualifier dropping, no fabricated verdicts, and no C6 invocation.

Private run artifacts are in `nonstandard/p2-compact-spike/live-proof-2026-10-28/` (`provider-response.raw.json`, `metadata.json`, `analysis.json`, and `semantic-review.json`). They include the complete capture and structural/semantic disposition; no earlier response or artifact was changed.

### Live proof human terminal

```text
PHASE: Compact Sonnet live proof
MODEL IDENTITY: Configured and returned claude-sonnet-5-5
REQUEST COUNT: 1; retries disabled
RESPONSE COMPLETE: Yes; exact body captured before content interpretation; HTTP 200
FINISH REASON: stop
TOKEN USAGE: 3,098 prompt / 3,396 completion (4,000 limit) / 6,494 total; 20,114 ms
COMPACT CANDIDATES: 5 fact concepts / 8 scoped values; 1 plan proposal rejected by compact validator; 0 unresolved
CITATIONS VERIFIED: 14/14 occurrence checks; semantic support is not 14/14
SEMANTICALLY CORRECT FACTS: At least 1 clearly correct value (Self Only $1,000 calendar-year deductible); page-17 non-official-change-section caveat omitted, so not promotion-ready
PLAN IDENTITY: Page-1 title supports FEP® Blue Focus; returned name failed literal compact check; production attestPlans found 0
QUALIFIER PRESERVATION: Partial; several citation contexts omit enrollment/eligibility conditions; OOP exclusions/exception scope is unsupported; inpatient/overseas network exceptions omitted
PRODUCTION MAPPING: BLOCKED; validateTable/C6 not run on compact candidates
ACCEPTANCE: PARTIAL
REMAINING LIMITATIONS: No end-to-end evidence of production readiness; citation occurrence does not prove semantic support; no candidate promoted
FILES CHANGED: docs/P2_COMPACT_EXTRACTION_SPIKE.md; ignored Phase 6B capture fixture/helper; ignored compact spike runner and private artifacts
NEXT RECOMMENDATION: Owner review the partial result; consider a separately authorized follow-up focused on complete page-31 network/OOP scope and exact source-attested plan naming
```
