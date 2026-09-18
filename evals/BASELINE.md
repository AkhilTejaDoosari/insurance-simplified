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
