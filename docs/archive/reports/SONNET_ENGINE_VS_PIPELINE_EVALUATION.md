# Sonnet Engine vs. Pipeline Evaluation

**Date:** 2026-10-27
**Mode:** Bounded diagnostic; no production changes
**Current verdict:** **PARTIAL Sonnet evaluation.** The initial runtime issue was corrected in local `.env.local`; KodeKey's authenticated model catalog and the response model both confirm `claude-sonnet-5-5`. Bounded document evaluation was then run. Direct FEMA and health outputs parsed; direct FEP output repeatedly truncated. Application FEMA completed citation checks; FEP failed qualifier validation; health failed strict JSON parsing. See the authoritative resumed-evaluation addendum below. The initial stop record is retained as history.

## 1. Executive verdict

This diagnostic cannot attribute the unseen-document failures to Sonnet reasoning, because the active application model is not Sonnet. The configured model name and endpoint response both identify `gpt-oss-120b`. Therefore the direct-model and LLM-backed application phases were stopped before document inference, as required by the model-identity gate.

The prior local-only baseline remains useful evidence about PDF readability and deterministic extraction/application behavior, but it is **not a Sonnet benchmark**. It found readable text layers in all three documents, a deterministic FEP qualifier-validation failure, poor semantic precision/noisy fact rows, and missed plan/fact discovery. Citation mechanics verified quoted spans but did not establish that the facts or their applicability were correct.

**Recommendation: INSUFFICIENT EVIDENCE.** First make the approved runtime configuration select the intended Sonnet 5.5 model and verify the response model with a harmless probe; then repeat the bounded diagnostic. This report does not change configuration or production behavior.

## 2. Runtime model configuration and endpoint check

The extraction route selects the LLM path when explicitly requested or when `isLlmConfigured()` sees `LLM_API_KEY` and `LLM_BASE_URL`; `completeJson()` sends `LLM_MODEL` (defaulting to `default`) in an OpenAI-compatible `/chat/completions` request with `response_format: { type: "json_object" }`. The local environment had all three variable names present; values other than the model identifier and probe metadata are intentionally omitted.

| Check | Observed result |
|---|---|
| Effective `LLM_MODEL` | `gpt-oss-120b` |
| Harmless endpoint probe HTTP status | 200 |
| Response `model` | `gpt-oss-120b` |
| Sonnet 5.5 selected/echoed | **No** |
| Endpoint protocol compatibility | **Partial:** chat-completions request accepted; JSON-object response-format field was sent |
| Valid JSON probe result | **No:** deliberately small 32-token output cap yielded content that did not parse as the requested JSON |
| Reported usage | 103 prompt tokens; 32 completion tokens; 135 total; 0 reasoning tokens; provider-reported cost `0.00003465` (provider units not established) |
| Probe elapsed time | 913 ms, single request |

The probe did not contain documents, personal data, credentials in logs, or the private endpoint value. The client source can parse ordinary JSON content and also has a strict compatibility path for a particular nested answer envelope. This probe does **not** establish usable extraction-schema support because the returned content was truncated/invalid JSON. It also does not establish Sonnet endpoint compatibility: it established only that the configured endpoint accepted this request shape for the model it actually selected.

**Model identity status for this requested benchmark: UNKNOWN / NOT VERIFIED.** The verified runtime selection is a different model. No claim about Sonnet quality is made.

## 3. Documents and evaluation sample

The requested repository-root inputs were present and unchanged:

1. `fema-nfip-protect-the-life-youve-built-brochure-09-2022.pdf`
2. `FEP-Blue-Focus-Brochure-2027-10-23.pdf`
3. `Health Insurance Brochure DIGITAL.pdf`

The existing `docs/UNSEEN_DOCUMENT_GENERALIZATION.md` records local text extraction of 8/8, 140/140, and 13/13 non-empty pages respectively, with 6,772, 449,180, and 38,638 extracted characters. Those counts are reused as the prior offline baseline, not newly measured in this diagnostic. It manually classified FEMA as program-level NFIP information, FEP as one actual FEP Blue Focus plan with three enrollment configurations, and the health guide as educational material with no selected plan identity.

No new representative passage set or direct-model gold sample was created: without verified Sonnet selection, choosing and sending excerpts would violate the model-identity gate. The eight labeled targets in the prior unseen-document report are the only existing small gold sample; they are independently source-inspected, not model-generated.

## 4. Direct Sonnet extraction results

**Status: BLOCKED before document inference.** No evaluation prompt version or experimental candidate schema was executed. No PDF passage was sent to any model. Direct Sonnet candidate counts, correctness, recall, qualifiers, citations, abstention, latency, and usage are all **not measured**.

## 5. Application extraction results

**Status: BLOCKED for the requested Sonnet-backed application run.** `app/api/extract/route.ts` would auto-select LLM extraction with the present key/base-URL configuration; its `extractViaLlm()` uses the same effective `LLM_MODEL`. Running it would evaluate `gpt-oss-120b`, not Sonnet. No LLM extraction call or app endpoint invocation was made.

Local code trace of the existing LLM path (not an execution result):

1. Route selects LLM or deterministic fallback.
2. `extractViaLlm()` wraps each document page as a delimited untrusted data block and includes extraction instructions plus user context.
3. `completeJson()` sends a chat-completions request with JSON-object response format.
4. `normalizeLlmTable()` → `dropEvidenceLessValues()` → `reconcileLlmTable()` → `validateTable()` → condition binding/personalization and eligibility-row handling.
5. Route verifies plan-source citations, performs plan mention attribution, verifies each value citation and display grounding, resolves row plan IDs through `resolveRowPlanIds()` (C6/ownership gate), then continues to the response/presentation flow.

This is a static source trace. Runtime candidate counts and stage-specific rejection reasons for these PDFs are **not measured**. The prior FEP `nextAnnual` failure belongs to the deterministic baseline's validation path; it is not evidence of an LLM failure.

## 6. Stage-by-stage funnel (available evidence)

| Stage | Prior local deterministic baseline | Requested Sonnet run |
|---|---|---|
| PDF parsing | All pages readable in prior measured run | Not re-run for this diagnostic |
| Text normalization / context selection | Existing extraction used full parsed page text for baseline; no direct prompt passages measured | Blocked |
| Model input/output | No model calls in prior baseline | Blocked; 0 document calls |
| Schema validation | FEMA and health baseline completed; FEP rejected at `prescriptions.period = annual` because evidence had `nextAnnual` | Blocked |
| Qualifier parsing | FEMA waiting-period “typically” qualification was lost in displayed output; FEP annual mismatch above | Blocked |
| Citation verification | FEMA 7/7 and health 107/107 mechanically verified; FEP not reached | Blocked |
| Plan identity / C6 | Existing recognizer found 0 plans across this corpus, missing the real FEP plan | Blocked |
| Fact grouping / comparison eligibility | Noise/misclassification and missing expected targets; no meaningfully comparable verified plan pair | Blocked |

No per-stage entering/surviving candidate counts are available for a Sonnet or app-LLM run. “Blocked” is not scored as zero accuracy.

## 7. Model mistakes versus engineering mistakes

**Model mistakes:** none can be assessed; Sonnet did not receive document text. The harmless probe's invalid JSON under a 32-token cap is a probe-shaping outcome, not an extraction-quality result.

**Observed deterministic/application issues from the prior report:**

- The FEP deterministic output failed schema validation on an evidence-tokenization mismatch (`annual` qualifier versus source text containing `nextAnnual`). This is an application validation/normalization failure before citation or C6 stages.
- The plan recognizer missed FEP Blue Focus, a real plan identity; the three enrollment codes must remain configurations of that one plan, not separate plans.
- FEMA and guide outputs included semantically wrong keyword matches despite mechanically valid citations; displayed waiting-period qualification was weakened.
- Fact discovery missed the FEMA limits/contents option and labeled FEP facts. The guide's two rule-prototype outputs were educational definition fragments incorrectly categorized as benefits.

These findings locate deterministic-engine problems; they do not prove the cause of any Sonnet-path behavior.

## 8. Citation and C6 outcomes

Prior offline measurements only:

- Deterministic baseline: 114/114 citations verified over the two documents that completed (FEMA 7/7; health guide 107/107); FEP citation stage blocked by validation.
- P2 rules prototype: 2/2 citations verified, while both candidates were semantically miscategorized definitions.
- The existing citation verifier spot checks in the prior report accepted valid quotes 3/3, rejected wrong-page citations 3/3, and rejected invented quotes 3/3.
- Existing plan recognizer: 0 identities attested on the three documents, including failure to find the real FEP plan. C6 attribution recall is therefore not a meaningful passing score.

These figures measure citation occurrence/provenance, not fact meaning or applicability. No Sonnet citation or C6 outcome was measured.

## 9. Accuracy scorecard and baseline comparison

The prior independently labeled sample comprises eight targets. Strict baseline recall was 1/8: the health guide Part D program-level cap matched the target; other targets were missed or not safely represented. The P2 deterministic rules prototype scored 0/8. This denominator is a deliberately small sample, not corpus recall. Full semantic precision was not measured.

| Requested measure | Prior offline evidence | Sonnet / app-LLM |
|---|---|---|
| Document classification | Manual source classification available; engine classification not reliably produced | Not measured |
| Plan identity precision | 0 identities attested; FEP actual plan missed; no phantom identity observed | Not measured |
| Fact discovery recall | Baseline 1/8; rules prototype 0/8 | Not measured |
| Fact semantic correctness | Baseline precision not exhaustively reviewed; prototype 0/2 on its two emitted categories | Not measured |
| Qualifier preservation | FEMA “typically” lost; FEP schema validation failed | Not measured |
| Citation correctness | Prior completed baseline 114/114 mechanically verified; not semantic correctness | Not measured |
| Unsupported plan attributions | None from the prior unseen-document baseline, but no identities were attested | Not measured |
| Abstention correctness | No pair of verified comparable plans; no comparison should be asserted | Not measured |
| Schema validity | FEMA/health baseline completed; FEP failed validation | Not measured |
| Latency / actual usage | Prior local baseline: FEMA 18 ms, FEP 336 ms to validation failure, guide 41 ms; not model latency | One harmless probe only: 913 ms; 103/32 tokens; not an extraction benchmark |

## 10. Mixed-document evaluation

**Sonnet mixed run: BLOCKED.** There was no isolated Sonnet run to precede a combined run. Prior deterministic P2 candidate isolation was exact for that run (FEMA 0/0, FEP 0/0, health 2/2 alone versus together), but its two health candidates were both wrong-category definition fragments. Prior full mixed deterministic baseline stopped at the FEP validation error. Browser/session-level validation was not performed and remains **BLOCKED**.

Manual source review supports the constraints: FEMA limits remain program-level; FEP enrollment choices are not separate plans; educational guide examples are not benefits; and the three documents do not establish a meaningfully comparable pair of verified plans. No V5/browser display acceptance is claimed.

## 11. Generalization limits

- This diagnostic did not test Sonnet 5.5 at all; a different model was configured and echoed by the endpoint.
- The prior baseline used only three PDFs and eight labeled targets; it does not generalize to other carriers, layouts, scanned PDFs, or versions.
- No direct candidate schema, prompt-version result, or model-generated candidate was evaluated.
- Provider usage is available only for the harmless probe; its reported cost lacks verified unit/pricing interpretation.
- No browser or live session was exercised.
- Existing repository changes were extensive before this task. They were preserved and were not treated as part of this evaluation.

## 12. Three highest-ROI engineering improvements (recommendations only)

1. **Correct and verify the effective model selection.** Ensure the approved runtime config explicitly names Sonnet 5.5 and that a harmless probe's returned model confirms it before any document inference. Do not infer model identity from a dashboard setting.
2. **Add a focused FEP qualifier regression at the validation boundary.** Preserve meaningful source token boundaries or avoid producing an unsupported annual qualifier; retain fail-closed validation.
3. **Improve plan identity and scope independently of value extraction.** Source-verify FEP Blue Focus as one plan while retaining Self Only / Self Plus One / Self and Family as qualifiers/configurations; continue using C6 evidence gates.

These are diagnostic recommendations, not authorized implementation work. No P2 or presentation redesign is proposed.

## 13. Smallest recommended next implementation/diagnostic slice

No production implementation is justified by this benchmark. The smallest next slice is a **configuration correction and harmless identity-only probe**, followed by owner confirmation that the response model is Sonnet 5.5. After that gate passes, run the already authorized bounded three-document evaluation with versioned direct prompt/schema, separate app-path calls, and independently checked labels. Do not sweep the 140-page FEP PDF through repeated full-context calls.

## 14. Exact files changed

- `docs/SONNET_ENGINE_VS_PIPELINE_EVALUATION.md` — this diagnostic report only.

No production code, prompt, schema, configuration, test, database, Storage object, or PDF was changed. No document content was transmitted. No commits, pushes, deployments, or destructive operations were performed.

## 15. Outstanding unknowns

- Whether the owner's KodeKey dashboard/runtime is intended to select Sonnet 5.5 while local `LLM_MODEL` selects `gpt-oss-120b`.
- Exact Sonnet model identifier and whether the configured endpoint supports its required response semantics.
- Sonnet's document classification, open-vocabulary fact discovery, qualifier preservation, abstention, citation quality, C6-compatible attribution, latency, and usage on these PDFs.
- Whether the application extraction schema/validation would reject or correctly preserve Sonnet candidates.
- Browser/session V5 behavior with the mixed documents.

============================================================
HUMAN TERMINAL
============================================================

PHASE:
Sonnet 5.5 real-document engine diagnostic — runtime gate and local baseline review

DONE:
- Read the required diagnostic reports and inspected the active provider/extraction path.
- Ran one harmless endpoint probe; effective and echoed model was `gpt-oss-120b`, not Sonnet 5.5.
- Stopped before sending any PDF content or invoking LLM extraction.
- Recorded prior offline baseline results and clearly separated them from Sonnet measurements.

FILES CHANGED:
- `docs/SONNET_ENGINE_VS_PIPELINE_EVALUATION.md`

CHECKS:
- Harmless chat-completions probe: HTTP 200; response model `gpt-oss-120b`; JSON content invalid under the deliberate 32-token cap; usage 103 input / 32 output tokens; 913 ms.
- No document inference, application extraction, browser test, or production test suite run.

ARCHITECTURE DIFF:
NONE

RISKS / OPEN ITEMS:
- Sonnet 5.5 identity is unverified; the configured runtime selects another model.
- Direct/app Sonnet accuracy, schema, citation/C6 outcomes, and mixed/browser behavior remain unmeasured/blocked.
- Pre-existing uncommitted repository files were preserved.

NEXT ACTION:
Owner verifies/corrects the approved runtime model configuration and confirms Sonnet 5.5 with a harmless identity probe before authorizing the document-evaluation phase.

STOPPED FOR OWNER REVIEW
============================================================

## Addendum — Correct Sonnet runtime and resumed evaluation

**Addendum date:** 2026-10-27. This addendum is the current result and supersedes the initial-stop status above. It does not claim that all requested evaluation cases completed.

### Runtime configuration and identity — VERIFIED

- Environment-loading precedence was checked against Next.js documentation: shell `process.env` overrides `.env.development.local`, then `.env.local`, `.env.development`, and `.env`. The current shell had no `LLM_MODEL`, `LLM_BASE_URL`, or `LLM_API_KEY` overrides; only `.env.local` defined these names among the checked files.
- Before correction, `.env.local` selected `gpt-oss-120b`. The authenticated KodeKey `/models` catalog returned the exact supported ID **`claude-sonnet-5-5`**. This is a provider-catalog result, not an assumed Anthropic ID or alias mapping.
- The catalog request returned HTTP 200, establishing that the rotated key is accepted. Only `LLM_MODEL` was changed in `.env.local` to `claude-sonnet-5-5`; other entries were preserved and file mode remains **0600**.
- A harmless chat-completions probe using that exact ID returned HTTP 200, valid JSON, and response model `claude-sonnet-5-5` (identity exact; no alias). Probe usage: 34 prompt + 12 completion = 46 tokens; elapsed 1,295 ms.
- The app's request shape (`response_format: {type:"json_object"}`) was accepted. The successful identity probe establishes basic JSON mode for this probe, but not consistent JSON-only behavior for longer extraction responses.

### Documents, sampled passages, and bounded call plan

The exact three authorized PDFs were read locally with the existing `extractPages` utility. The FEP document was **not** sent in full: its app/direct evaluation used only representative original pages 1, 5 (one initial direct/app sample), 10, 17, 31, 35, and 38; later FEP calls used pages 1, 10, 17, 31, 35, and 38. Blank page slots preserved original 1-based citation numbering in the application runner. FEMA (8 pages) and the health guide (selected pages 1, 3, 4, 5, and 12) were sampled from the complete documents. No personal profile data was supplied; application calls used empty synthetic context.

Direct calls used prompt version `insurance-open-vocab-sonnet-realpdf-v1`, a temporary candidate shape with document identity/type, optional plan identity, unconstrained concept, value/units/conditions, qualifiers, exact quote/page, statement role, and confidence/uncertainty. Calls were isolated by document; no combined-document run was made. Output caps were applied, and malformed/truncated results were not retried identically. The direct schema/output summaries below intentionally omit document quote payloads.

### Direct model results — PARTIAL

| Document | Direct result | Accuracy observations |
|---|---|---|
| FEMA | A focused direct run parsed **8 candidates** and 2 abstentions. Candidate topics covered program-vs-policy scope, building/contents maximums by property type, contents-only coverage, and the waiting period. **8/8 cited passages verified** against the cited original pages. It emitted no individual plan identity. | Classification/scope and required topics were represented. All 8 citations were mechanically verified. Fine-grained numeric/value correctness was not adjudicated from stored output, so strict fact-semantic score and labeled-target recall remain **not scored**. |
| FEP Blue Focus | Three bounded direct responses were attempted with decreasing candidate scopes/output caps; all ended with provider `finish_reason=length` and invalid/incomplete JSON. No candidates were accepted or scored. | Plan identity, enrollment, deductible/OOP, network, service/exclusion/prior-approval and table/footnote understanding remain **unmeasured**. This is an output-completion/format failure, not proof of incorrect reasoning. |
| Health guide | Parsed **8 candidates** and 3 abstentions. It classified the source as an educational Medicare/Medicaid/commercial guide, emitted no plan identity, included a deductible definition as a definition, and treated program-level Medicare statements as general guidance. **8/8 cited passages verified**. | The named candidates included the Part D annual cap, Medicare conditional OOP information, and a deductible definition. No independently adjudicated numeric semantic score was produced; Medicare examples/Medicaid target coverage is incomplete or unscored. |

**Direct summary:** 16 parsed candidates across FEMA and health; 16/16 citations mechanically verified. FEP direct schema yield 0 because three bounded responses were truncated. Citation verification does not establish semantic correctness. The direct run does not support a reliable overall accuracy percentage.

### Application extraction and stage funnel

The existing `extractViaLlm()` pathway was invoked per document with the same selected page sets where possible and empty synthetic context. The production schema/prompt were unchanged. Application response caps were injected only by a temporary out-of-repository diagnostic wrapper; no production code was edited.

| Document | Entered app model response | Raw model output | App validation / downstream | Result |
|---|---|---|---|---|
| FEMA | `claude-sonnet-5-5`; one sampled call | 47 rows / 8 values; valid response | 48 validated rows / 8 values. 8/8 citations verified; 0 citation failures; 0 display-grounding unsupported; 0 verified plans; 0 Stage-E/C6-attributed values. | **Completed to validation and citation/C6 checks.** Fact-level semantic correctness was not independently scored; target recall is unscored. |
| FEP | `claude-sonnet-5-5`; selected pages only | One initial response was truncated and failed JSON parsing. An adjusted bounded call returned 47 rows / 23 values as JSON. | **Stopped at `validateTable`:** `row annual-deductible: qualifiers.period not supported by evidence`. No validated table reached citation verification, plan verification, or C6. | **Fail-closed schema rejection.** No evidence that this is the earlier deterministic `prescriptions/nextAnnual` failure; here the rejected row was `annual-deductible`. The model asserted a period the validator could not find in its citation evidence. |
| Health guide | `claude-sonnet-5-5`; selected pages only | Provider returned HTTP 200 and `finish_reason=stop`, but message content was Markdown-fenced rather than plain JSON. | `completeJson()` failed at strict `JSON.parse` (`Unexpected token '`'`). No parsed table was available; 0 rows/values reached normalization, schema validation, citation verification, or C6. | **Stopped at response-format parsing.** No retry or fence-stripping was performed. |

### Accuracy, citation, attribution, and mixed-document scorecard

- **Document classification:** direct FEMA and health classifications were directionally correct (2/2 parsed documents); FEP classification unscored due to invalid output. This is a tiny sample, not a general accuracy estimate.
- **Fact discovery:** direct FEMA produced 8 candidates spanning its four requested target areas; health produced 8 relevant candidate topics. Exact labeled-target recall is **not scored** because emitted values/conditions were not retained for independent item-by-item adjudication. FEP: no usable direct candidates. Application: FEMA 8 values, but no target-by-target semantic score; FEP/health stopped before a usable validated table.
- **Plan/tier attribution:** parsed direct FEMA/health outputs correctly proposed no individual plan identity (0 unsupported identity claims in those outputs). FEP actual plan identity/enrollment variants could not be assessed. App FEMA attested 0 plans and Stage-E attributed 0 values; FEP never reached plan/C6; health never parsed. No unsupported plan attribution was observed in completed app output, but useful FEP plan recall is **unmeasured**.
- **Citation verification:** direct parsed candidates **16/16** citations verified (FEMA 8/8; health 8/8). App FEMA **8/8** verified, with 0 failures and 0 grounding-unsupported displays. App FEP and health citation gates were not reached. These are source-occurrence checks, not semantic correctness.
- **Qualifiers/conditions:** FEMA direct retained a “typical” waiting-period condition and property-type qualifiers in candidate metadata; numeric correctness remains unscored. App FEP's annual-period assertion was rejected before citations. Enrollment, network, exception, table-footnote, conditional-cost and service qualifiers on FEP remain unmeasured. Health's direct general-guidance/definition roles were distinguished in parsed output; app behavior unavailable.
- **Schema validity:** direct FEMA/health JSON parsed; direct FEP 0/3 attempts parsed. App FEMA passed validation; app FEP failed `annual-deductible.qualifiers.period`; app health failed JSON parsing before schema validation.
- **Mixed run / V5 display:** not run. No cross-document contamination, comparison eligibility, browser/session behavior, or V5 display claim is made. The documents do not represent a verified comparable plan pair based on existing manual ground truth.

### Model failures vs. engineering failures

**Observed model/endpoint-output limitations:** repeated direct FEP responses were too long for the imposed output caps and ended with `finish_reason=length`; health application output included Markdown fences despite JSON-only/JSON-object request. FEP app output included a period qualifier unsupported by its evidence and was correctly rejected. The model's semantic accuracy on FEP remains unknown because the direct output was incomplete and app output failed validation.

**Observed application behavior:** strict JSON parsing failed closed on the fenced health response; schema validation failed closed on FEP's unsupported period; FEMA's validated values continued through citation, grounding, and plan-attribution gates. The FEP/health validators did not silently coerce or suppress failures. Those guardrails are functioning as designed, though model/application output-contract compatibility is inadequate in these samples.

### Actual usage and latency

All values below are provider-reported. Token totals for rows marked unavailable were not captured by the temporary runner; no estimate is substituted. `/models` catalog lookup uses no generation tokens.

| Request | Input tokens | Output tokens | Total | Elapsed |
|---|---:|---:|---:|---:|
| Harmless identity probe | 34 | 12 | 46 | 1.295 s |
| Direct FEMA initial broad attempt (invalid JSON) | unavailable | capped at 3,200; actual unavailable | unavailable | unavailable |
| Direct FEMA focused parsed run | 3,298 | 2,620 | 5,918 | 15.310 s |
| Direct FEP broad attempt (truncated) | 7,402 | 5,000 | 12,402 | 17.9 s |
| Direct FEP narrower attempt (truncated) | 7,488 | 3,500 | 10,988 | unavailable |
| Direct FEP focused attempt (truncated) | 6,245 | 3,000 | 9,245 | 17.094 s |
| Direct health parsed run | 5,894 | 2,748 | 8,642 | unavailable |
| App FEMA completed run | unavailable | unavailable | unavailable | 19.990 s |
| App FEP initial truncated/parse-failed run | unavailable | capped at 5,000; actual unavailable | unavailable | 30.603 s |
| App FEP adjusted run; schema failure | 9,990 | 8,868 | 18,858 | 44.547 s |
| App health fenced-output run | 7,611 | 6,361 | 13,972 | 34.869 s |

Known provider-reported total across fully metered requests (including probe): **80,071 tokens**. Three requests lack input/output token totals; elapsed-time telemetry is also missing for several other requests. This is not total experiment usage. Provider-reported cost was not captured consistently for this evaluation; no cost estimate is made.

### Main limitations and recommended minimum correction

**Main model limitations:** FEP responses did not fit the bounded output budget; the model did not reliably honor JSON-only output in the application call; the app-bound FEP output asserted a period not evidenced by its quote. These are observations in small samples, not broad model-quality claims.

**Main engine limitations:** fixed inventory extraction exposes model candidates only through a brittle all-or-nothing JSON/schema boundary; one unsupported qualifier rejects the entire FEP table, and a Markdown fence prevents health results from entering any validation stage. Citation/C6 behavior is consequently unavailable for those two app documents. FEMA's application output had mechanically clean evidence but no attested identity and no fact-level semantic score.

**Recommended minimum correction (not implemented):** keep schema/evidence validation fail-closed. Before any production prompt/schema change, add a narrowly scoped regression/evaluation slice for (1) bounded JSON-only completion and provider-reported truncation/fence handling, and (2) a period qualifier only when the exact cited source supports it. Preserve rejected output and stage diagnostics without logging source quotes. Then rerun only the affected selected FEP/health passages. Do not weaken qualifier evidence or citation/C6 contracts.

### Files, configuration, and status

- Repository report updated: `docs/SONNET_ENGINE_VS_PIPELINE_EVALUATION.md`.
- Authorized local config correction: `.env.local`, only `LLM_MODEL` changed to catalog-listed `claude-sonnet-5-5`; mode remains 0600. Credential itself was neither changed nor exposed by this agent.
- Temporary runner: `/private/var/folders/th/w8d_t86x75x5fl3thf70mj_w0000gn/T/sonnet-eval.ts`; outside repository and not a production artifact.
- No production source, prompt, schema, test, provider, migration, database, Storage object, or PDF changed. No subagents, commits, pushes, or deployments.
- Outstanding: no complete direct FEP result; no validated app health result; no semantic adjudication of all candidate values; no mixed/browser run; incomplete token totals for three calls and missing elapsed times for additional calls.

============================================================
FINAL HUMAN TERMINAL
============================================================

MODEL IDENTITY:
VERIFIED — KodeKey catalog and chat response both identify `claude-sonnet-5-5`; rotated key accepted; `.env.local` mode 0600.

DIRECT SONNET RESULTS:
PARTIAL — FEMA 8 candidates / 8 citations verified; health 8 / 8; three selected-page FEP attempts truncated and unusable.

APPLICATION PIPELINE RESULTS:
PARTIAL — FEMA: 8 values validated and 8/8 citations verified. FEP: 23 raw values rejected at qualifier validation. Health: response failed strict JSON parsing before schema validation.

MODEL FAILURES:
FEP direct output truncated under three bounded candidate/output attempts; health app response was Markdown-fenced; FEP app output included unsupported annual period qualifier. Broad semantic accuracy remains unscored.

ENGINE FAILURES:
FEP qualifier mismatch blocks all later stages; health strict JSON parser rejects fenced output. Fail-closed validation preserved. FEMA had no verified plan identity and no C6-attributed values.

VERIFIED FACTS:
Direct 16/16 cited passages verified (FEMA 8/8, health 8/8); app FEMA 8/8 citations verified. Numeric/semantic accuracy and strict target recall were not fully adjudicated.

UNSUPPORTED CLAIMS:
No unsupported plan identity in parsed direct FEMA/health output. No FEP/C6 conclusion can be made. No mixed-document/browser/V5 comparison result.

TOKEN USAGE:
80,071 known provider-reported tokens including probe; three requests lack token totals, and elapsed time is missing for additional calls. See request-level table above. No reliable total cost.

NEXT ENGINEERING STEP:
Owner reviews the bounded results; if approved, authorize a minimal structured-output/qualifier-evidence regression slice. Do not weaken citations, qualifiers, or C6.

FILES CHANGED:
`docs/SONNET_ENGINE_VS_PIPELINE_EVALUATION.md`; `.env.local` (`LLM_MODEL` only; authorized local setting).

STATUS:
Evaluation partial; stopped for owner review. No production code changed.
============================================================
