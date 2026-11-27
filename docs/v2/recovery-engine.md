# V2 document recovery engine — multi-engine, verification-governed (WP4)

Status: **Implemented (local), Tested on synthetic PDFs; scored on the 17 validation SBCs for
the local stages. Model stages built and tested with fakes only — not yet measured on real
pages (no provider keys in the build workspace; needs the owner run below).**
Owner direction 2026-11-27: hybrid multi-engine; AI proposes, the verification engine decides.

## 1. Principle

Every engine — parser or model — only **proposes** table cells ("page p, row L, column H
reads V"). `app/reconcile/verify.py` alone decides what is verified: the value, the row label
and a single-column header must be printed in the PDF's own text layer, in the same row band
and column strip (ruling lines), on this page or, for continued tables, the previous one.
Agreement between engines, model confidence and vote counts are recorded but never count as
evidence. A model proposal goes through exactly the same function as a parser cell
(`reconcile(..., candidates=...)`). The original PDF is never modified and is the only
source of truth.

"Verified" here is D-034 **key 1** (structure proven by code). Key 2 (a judge model of a
different family confirming meaning) is WP8 and is not part of this engine.

## 2. Pipeline (`engine/app/recovery/`)

| Stage | Engine | Runs on | Code |
|---|---|---|---|
| 0 | PDF geometry: words + ruling lines (pdfplumber as a PDF object reader, not a table parser) | every page, once | `reconcile/layout.py` |
| 1 | OpenDataLoader native (Java), in the parser sandbox | every page | `parsing/opendataloader.py`, `recovery/engines.py` |
| 2 | Docling **through OpenDataLoader's hybrid backend** (`hybrid="docling-fast"`, `hybrid_mode="full"`, `--pages`) | gap pages only | `DoclingViaOpenDataLoader` |
| 3 | pdfplumber table finder | gap pages; **off by default** (see §4) | `PdfplumberTables` |
| 4 | Nemotron 3 Ultra (text only) | remaining gap pages | `providers/nvidia.py`, `_text_stage` |
| 5 | Claude (original page-subset PDF) | remaining gap pages | `providers/anthropic.py`, `_visual_stage` |
| 6 | Reconcile all candidates; link governing text; explicit unresolved states | — | `pipeline.py`, `restrictions.py` |

**Gap detection** (`recovery/gaps.py`, the routing signal): a row a proposer saw whose value
cells are not all verified; a conflict; a ruled page where no reader found a table; a cell
that continues onto the next page (next page becomes context); an image-only page
(`no_text_layer` — never routed to models, because nothing on it can be verified against a
text layer; it stays an explicit unresolved state).

**Reuse of OpenDataLoader's Docling integration.** OpenDataLoader 2.5 already ships the
routing: a Docling backend server (`opendataloader-pdf-hybrid`: TableFormer *accurate*, OCR
optional), a launcher bound to 127.0.0.1, page ranges, per-page triage and a JSON output
identical to its native one. The engine does not drive Docling itself: it asks OpenDataLoader
for exactly the pages verification could not settle, with OpenDataLoader's own triage
bypassed (`full`) because our triage comes from verification gaps, and Java fallback off so
a Docling failure is reported as one. Both passes go through one converter
(`document_from_odl`) and the same grid rules. Security: the backend has no authentication;
the CLI default binds 0.0.0.0, so it must be started through `HybridServer` (127.0.0.1).

**Cross-page context.** Each model call gets its target pages plus the previous page (header
of a continued table) and the next page where a cell continues. The verifier already checks
headers on the previous page and refuses cells that continue onto the next page. Footnote
markers (†, ‡, §, \*) on a verified value or its row label are linked to the one line that
starts with the marker on the same page or the first following page that defines it
(ambiguous → nothing attached). Same-row "Limitations, Exceptions…" cells are attached to the
row's verified values when both are verified.

**What models receive.** Nemotron: the page's own text-layer words laid out by position, with
drawn column rules marked `|` (`context.layout_text`), plus parser tables labelled as
unverified hints and the row labels still missing values. Claude: a new PDF holding only the
target and context pages (pdfium, no source metadata), so it reads the original page images
and text — never only parser output. Both return one strict JSON schema
(`recovery/proposals.py`); off-schema output is rejected whole. Prompts require exact
copying and allow omission; the document is declared data, not instructions.

**Nemotron capability (verified from the model card; endpoint probe pending).** Model id
`nvidia/nemotron-3-ultra-550b-a55b`, OpenAI-compatible endpoint, text input and output only.
The engine's Nemotron client accepts strings only, so an image cannot be sent to it.
`uv run python -m evaluation.probe_providers` checks the configured endpoint (model listed,
`json_schema` vs `json_object` support, image refusal) without sending any document.

## 3. Operations

* **Caching** (`recovery/cache.py`): key = document SHA-256 + stage + engine + engine/model
  version + prompt version + page set + request digest. Directory `ENGINE_CACHE_DIR`; unset →
  no cache. The cache holds derived document data: same privacy boundary as the PDFs.
* **Limits** (`RunLimits`): whole-run seconds, Docling pages, model calls and pages per call,
  page characters, output tokens, and the **D-036 per-document cost cap ($0.05)**. With a cap,
  a provider without a configured price (`ENGINE_PRICE_<PROVIDER>_IN/_OUT`) is not called.
* **Retries**: 408/409/429/5xx/529 with `retry-after`, bounded attempts; NVIDIA calls spaced
  1.6 s (40 rpm free tier). Errors carry status and reason only, never bodies.
* **Failure handling**: any failed, refused, timed-out or off-schema stage adds nothing, is
  recorded in the ledger, and the run continues with what is verified (fail-closed).
* **Cost tracking**: per call — tokens, seconds, USD from configured prices, bytes of
  document content disclosed.
* **Modularity**: each engine is a Protocol (`DocumentReader`, `PageReader`, `TextModel`,
  `VisualModel`); replacing one is one adapter.

## 4. Measured (validation SBCs: 17 documents, 149 pages, 454 keyed cells, keys v1.1 DRAFT)

Same keys, scorer and verifier as R6. Docling output replayed from the private corpus CI run
(same TableFormer-accurate configuration; Hugging Face is unreachable from the build
workspace); OpenDataLoader also run live here (identical result).

| Configuration | Correct keys | False verified | Pages through Docling |
|---|---|---|---|
| R6 baseline: 3 readers on every page | 348 | 0 | 149 |
| OpenDataLoader only | 344 | 0 | 0 |
| **OpenDataLoader → Docling on gap pages** | **348** | **0** | **77** |
| … → + pdfplumber tables on gap pages | 348 | 0 | 77 |

* Progressive routing keeps the full baseline coverage with Docling on 52 % of pages (Docling
  is the slow engine: ~60 s/document on CPU).
* **pdfplumber as a table reader adds no keyed coverage** (+13 unkeyed verified cells, +1
  strictly matched restriction): stage off by default. pdfplumber stays where it is measurably essential —
  as the independent text and coordinate source for verification (stage 0).
* Governing text: 110 correct keys carry a restriction in the keys; for 60 the attached text
  matches the key strictly. The rest are mostly keys written as paraphrases of the printed
  cell (not string-matchable) — precision of attachment needs a key-side review, not claimed.
* Ceiling for AI recovery under the unchanged verifier: 437 keys are correctly proposed by
  some reader (oracle union); 89 of them fail verification mainly because the reader's header
  is wrong (`header_is_a_value` 22, `header_is_part_of_a_longer_cell` 18,
  `header_not_above_value_column` 15, continued-table header 11). These are the cases a model
  copying the printed header can recover; 17 keys no reader proposed at all.
* Model stages: plumbing tested with fakes (correct proposal verified; wrong value, column,
  row, spanning header, partial cell, and two models agreeing on a wrong cell all rejected).
  **Coverage gain and false-verified count on real pages: not measured yet.**
  Volume: 77 gap pages → ~41 Nemotron calls (~1 M characters in total) for the 17 SBCs.

## 4b. After the 2026-11-27 review (part 2)

| Module | Role | Gate |
|---|---|---|
| `recovery/clauses.py` | prose clauses (Q&A answers, headed paragraphs) | own verifier; never a way around table rules |
| `recovery/semantic.py` | key 2: code reading + judge of another family | judge alone never confirms |
| `recovery/governing.py` | context elsewhere in the document (web RAG mirror) | ranking is never evidence |
| `recovery/visual.py` | scanned pages | `review_required`, never verified |
| `recovery/coverage.py` | printed amounts by state | `not_stated` only on proven absence |
| `recovery/present.py` | engine facts → contract `Fact` | contract validators (two keys) |

Measured on the 17 SBCs: 395/454 correct keys, 0 false verified; 0 facts presentable
until the judge runs. Progress record: `implementation-progress.md`.

## 5. Owner actions

1. **Run the AI-assisted measurement** (17 pinned public validation SBCs only):
   `bash engine/scripts/run_model_eval_mac.sh ~/Repositories/insurance-corpus-private`
   (`--local-only` first for a free setup check). It finds the configuration in the
   existing env files (`evaluation/eval_env.py`, names only, agreed endpoints only),
   reuses the reader artifacts (fingerprint-checked), probes both providers without
   tokens or secrets, then scores `local → +Nemotron → +Claude visual → +judge` with the
   $25 cumulative ledger, stopping on any false verified fact. Acceptance: correct keys
   up, **false verified stays 0**, including among facts presentable to users.
   Claude may run through the KodeKey gateway (Anthropic Messages format required; the
   probe checks JSON-schema output and PDF input). Documents then pass through
   KodeKloud, so the retention record must name `kodekey`; the model stays Opus 5.5 and
   the ledger still counts Opus 5.5 list prices.
2. **Approvals needed before any real customer document is sent to a cloud model**
   (`ENGINE_CLOUD_CUSTOMER_DOCUMENTS=approved` is the switch; the policy refuses until then):
   * provider retention/training terms reviewed and recorded per provider (Anthropic API
     account terms; NVIDIA API Trial Terms) — names in `ENGINE_CLOUD_RETENTION_REVIEWED`;
   * NVIDIA's free build.nvidia.com trial is a development-only gateway (D-036): customer
     documents are refused there **by code** until a production Nemotron endpoint exists
     (`ENGINE_CLOUD_DEVELOPMENT_ONLY`);
   * user-facing consent/disclosure text for cloud processing (operations.md §2 currently
     forbids sending locally-authorized PDFs to external LLMs without separate approval);
   * per-document authorization at upload (`CloudAuthorization`, WP5 jobs) — a session id
     is never authorization;
   * D-036 budget: the visual stage will likely exceed $0.05/document with Claude on every
     gap page; decide the cap or the model after the measurement.
3. Approve the new runtime dependencies: `opendataloader-pdf` (Apache-2.0; needs a JRE — added
   to the engine image as `default-jre-headless`), explicit `pypdfium2` (already present via
   pdfplumber); optional group `hybrid` (Docling backend + models).
