# R0 Baseline — line-overlap retriever (todo 9)

Record-only baseline of the CURRENT line-overlap retriever
(`app/lib/rag/answer.ts` `retrieve()`: per-line token overlap, stopword
filter `len>2`, sort-desc + slice top-3). Nothing was tuned in this todo.
Measured via direct `node evals/run.mjs` (no `npm run eval` script yet —
that is todo 10's job). Rerun is byte-identical (see Determinism).

## Provenance

- git sha: `bd4e999ac6386a4b9d1f3fcd6ce3da910cc976ae`
- branch: `feat/rag-core`
- runner: `evals/run.mjs` sha256 `5a934e063c1c1b76058fd3dcacf6683113dc829ca06cdfa3bd6e1f34dd960d5e`
- retriever source: `app/lib/rag/answer.ts` sha256 `6f440aa2083c07ba02bdea29e1ab2f63c80a82f2d501f483dbc9816d07ec87e1`
- golden-dev.json sha256 `40bd26510a6e75e7cd08918a1f2eaa18470bd2a26e4e4a181a566942b84ecdfc` (FROZEN, scored)
- golden-validation.json sha256 `d401f9d377f376bb7a9f0785c5ebd0b2c0330bd49c22319d1cc3169569929341` (FROZEN, scored)
- golden-test.json sha256 `4224d90c6d936089da8fedf3a793be761f65a34263784aa1f52ea4bcad9a09d5` (FROZEN, UNSCORED — first scored at F1, todo 49)
- corpus (fixture PDFs): plan-a.pdf sha256 `ad7ae3b07306280e305ebcdb3b7140daa74af37452039c144d27f76c46c82103`, plan-b.pdf sha256 `7aeb93b439e34e1f0fce089400aa2be0b4c68dd5d7a28eeb46773eb2ae8e1021`
- chunk config: n/a (R0 is line-based; no chunking — chunk baseline lands in todo 14 with 512/64 config hash)
- retrieval config: line-overlap, `maxPassages=3`, stopwords per `answer.ts:39-41`, token filter `len>2`
- split rule: 30 items = 5 subsets x 6; within each subset sorted by id: first 2 -> dev, next 2 -> validation, last 2 -> test (10 items per partition)
- date: 2026-09-18

## DEV (n=10, answerable=8)

Overall: recall@5=1.0000 recall@10=1.0000 mrr@5=0.8750 mrr@10=0.8750 refusal-accuracy=0.9000 false-refusals=0 false-acceptances=1

| subset | n | answerable | recall@5 | recall@10 | mrr@5 | mrr@10 |
| --- | --- | --- | --- | --- | --- | --- |
| answerable | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| paraphrase | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| multi-doc | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| distractor | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| must-refuse | 2 | 0 | n/a | n/a | n/a | n/a |

## VALIDATION (n=10, answerable=8)

Overall: recall@5=0.7500 recall@10=0.7500 mrr@5=0.6250 mrr@10=0.6250 refusal-accuracy=0.8000 false-refusals=0 false-acceptances=2

| subset | n | answerable | recall@5 | recall@10 | mrr@5 | mrr@10 |
| --- | --- | --- | --- | --- | --- | --- |
| answerable | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| paraphrase | 2 | 2 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| multi-doc | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| distractor | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| must-refuse | 2 | 0 | n/a | n/a | n/a | n/a |

## TEST

10 items FROZEN, UNSCORED until F1 (todo 49). Recorded sha above; never scored here.

## Determinism

Two consecutive `node evals/run.mjs` runs produce byte-identical output
(sha256 `a4834507da2cd69667f0f3c4b5905a8d34fefdf3cafc8c5a7885f2c8e3526d1d` both runs).
Full outputs of both runs are captured in `.omo/evidence/task-9-insurance-simplified-flagship.json` (untracked).

## Anti-overfitting note

Per-subset tables above are mandatory: VALIDATION paraphrase scores 0.0000
across recall/MRR while DEV paraphrase scores 1.0000/0.7500 — a subset-level
drop that an overall average would hide. Future tuning must record per-subset
movement, not averages alone. VALIDATION gates survivor decisions; TEST is
never used for tuning.

## Whole-document prompt size (HISTORICAL reference only)

Whole-document LLM prompting is NOT a runtime fallback (degradation is
hybrid -> lexical-only -> refusal per plan guardrails). Recorded here only as
an R0-era reference point: whole-corpus `wrapDocuments()` prompt (instructions
+ both fixture docs, placeholder question) = 1443 bytes, ~203 whitespace
tokens, sha256 `c6f06fee1c5552b47554725b6f4a63cfa5e5343493518b3441b4fc8425d024ac`.

## Raw runner output (run 1 == run 2)

```
partition=dev n=10 answerable=8
overall recall@5=1.0000 recall@10=1.0000 mrr@5=0.8750 mrr@10=0.8750
overall refusal-accuracy=0.9000 false-refusals=0 false-acceptances=1
  subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=paraphrase n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
partition=validation n=10 answerable=8
overall recall@5=0.7500 recall@10=0.7500 mrr@5=0.6250 mrr@10=0.6250
overall refusal-accuracy=0.8000 false-refusals=0 false-acceptances=2
  subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=paraphrase n=2 answerable=2 recall@5=0.0000 recall@10=0.0000 mrr@5=0.0000 mrr@10=0.0000
  subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
test: 10 items FROZEN, unscored until F1 (todo 49)
```

## R1 note — flattened brochure-table limitation (todo 15, docs only)

Brochure comparison tables arrive flattened by page extraction (header line
naming tiers + one figure per tier per benefit line in the same order), so
positional tier-mapping is a prompt-level workaround in
`app/lib/extraction/extract.ts` EXTRACTION_INSTRUCTIONS, not structure.
R1 chunks (`app/lib/rag/chunks.ts`) preserve page token order verbatim and
do NOT reconstruct table rows — table-aware chunking is follow-up context
for later work (see `docs/RAG-GAP-ANALYSIS.md` Layer 3). No behavior changed
in this todo; todo 14 appends the chunk baseline below as a separate section.

## R1 chunk baseline — chunk-granularity view of the SAME ranker (todo 14)

Measurement only. `retrieve()` ranking in `app/lib/rag/answer.ts` is
UNCHANGED (still line-based at runtime; R2 owns any ranker change). The
harness flag `node evals/run.mjs --granularity=chunk` re-uses the exact same
`tokens()` / overlap-count / sort-desc scoring, only the retrieval unit
changes from lines to page-preserving chunks (plain-node mirror of
`app/lib/rag/chunks.ts` `chunkDocument`, 512/64 whitespace tokens, never
crossing page boundaries).

What the chunk numbers mean vs the line numbers: a line hit needs the exact
expected line ranked top-K; a chunk hit needs any chunk CONTAINING the
expected passage (normalized containment) ranked top-K. Chunk units are
coarser, so chunk scores are an upper-envelope view of the same ranking
behavior, not a new ranker. Refusal is identical by construction (chunk
tokens = union of line tokens, so empty chunk retrieval <=> empty line
retrieval). Default `node evals/run.mjs` output is byte-identical to R0
(sha256 `a4834507da2cd69667f0f3c4b5905a8d34fefdf3cafc8c5a7885f2c8e3526d1d`
before and after this todo; diff empty).

Chunk inventory on the fixture corpus: 4 pages -> 4 chunks (1 per page;
every fixture page is far below the 512-token target, so no page splits and
no 64-token overlap windows materialize here). Chunk identity is
`doc#page#order`; each expected passage maps to the same-doc+page chunk(s)
containing it.

### Provenance

- git sha: `21ae5297e12484985e2543b01b117ccc3ce33711`
- branch: `feat/rag-core`
- runner: `evals/run.mjs` sha256 `3087afe3b61dbef0ce9afaa216560f13ebeb5e2f09abcf48f58dc4b8f0c34d70`
- retriever source: `app/lib/rag/answer.ts` sha256 `6f440aa2083c07ba02bdea29e1ab2f63c80a82f2d501f483dbc9816d07ec87e1` (UNCHANGED from R0)
- chunker source: `app/lib/rag/chunks.ts` sha256 `6c18792d4f94f4f787d33961d53f97ce8f40e1321d104d86ffc2a6c1fdb62787`
- chunk config: target 512 whitespace tokens (`\S+` runs), overlap 64, no cross-page
- golden-dev.json / golden-validation.json / golden-test.json: same frozen shas as R0 above (datasets untouched)
- split rule: same as R0 (stratified, 10 items per partition)
- date: 2026-09-18

### DEV chunks (n=10, answerable=8)

Overall: recall@5=1.0000 recall@10=1.0000 mrr@5=0.9375 mrr@10=0.9375 refusal-accuracy=0.9000 false-refusals=0 false-acceptances=1

| subset | n | answerable | recall@5 | recall@10 | mrr@5 | mrr@10 |
| --- | --- | --- | --- | --- | --- | --- |
| answerable | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| paraphrase | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| multi-doc | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| distractor | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| must-refuse | 2 | 0 | n/a | n/a | n/a | n/a |

Line -> chunk delta (DEV): recall unchanged (1.0000); MRR 0.8750 -> 0.9375,
entirely from paraphrase MRR 0.7500 -> 1.0000 (par-02's expected Plan B
out-of-pocket line outranks its Plan A twin at chunk granularity because the
page-chunk aggregates more query tokens than the single line does). No
ranking code changed — this is the granularity effect being measured.

### VALIDATION chunks (n=10, answerable=8)

Overall: recall@5=0.7500 recall@10=0.7500 mrr@5=0.6250 mrr@10=0.6250 refusal-accuracy=0.8000 false-refusals=0 false-acceptances=2

| subset | n | answerable | recall@5 | recall@10 | mrr@5 | mrr@10 |
| --- | --- | --- | --- | --- | --- | --- |
| answerable | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| paraphrase | 2 | 2 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| multi-doc | 2 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| distractor | 2 | 2 | 1.0000 | 1.0000 | 0.7500 | 0.7500 |
| must-refuse | 2 | 0 | n/a | n/a | n/a | n/a |

Line -> chunk delta (VALIDATION): zero across every cell — the paraphrase
drop (0.0000) and all other per-subset values are identical at both
granularities, so the R0 anti-overfitting note still holds verbatim.

### TEST

10 items FROZEN, UNSCORED (same as R0; first scored at F1, todo 49). The
chunk flag prints the frozen line only and never scores TEST.

### Determinism

Two consecutive `node evals/run.mjs --granularity=chunk` runs produce
byte-identical output (sha256
`7768424dcff803dba2168e0f13503c4aeb186faef98f8fb4b1d98213ee95ae10`
both runs). Full outputs of both runs are captured in
`.omo/evidence/task-14-insurance-simplified-flagship.json` (untracked).

### Raw chunk-runner output (run 1 == run 2)

```
chunkconfig target=512 overlap=64 chunks=4 pages=4
chunk partition=dev n=10 answerable=8
chunk overall recall@5=1.0000 recall@10=1.0000 mrr@5=0.9375 mrr@10=0.9375
chunk overall refusal-accuracy=0.9000 false-refusals=0 false-acceptances=1
  chunk subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  chunk subset=paraphrase n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  chunk subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  chunk subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  chunk subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
chunk partition=validation n=10 answerable=8
chunk overall recall@5=0.7500 recall@10=0.7500 mrr@5=0.6250 mrr@10=0.6250
chunk overall refusal-accuracy=0.8000 false-refusals=0 false-acceptances=2
  chunk subset=answerable n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  chunk subset=paraphrase n=2 answerable=2 recall@5=0.0000 recall@10=0.0000 mrr@5=0.0000 mrr@10=0.0000
  chunk subset=multi-doc n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=1.0000 mrr@10=1.0000
  chunk subset=distractor n=2 answerable=2 recall@5=1.0000 recall@10=1.0000 mrr@5=0.7500 mrr@10=0.7500
  chunk subset=must-refuse n=2 answerable=0 recall@5=n/a recall@10=n/a mrr@5=n/a mrr@10=n/a
chunk test: 10 items FROZEN, unscored until F1 (todo 49)
```
