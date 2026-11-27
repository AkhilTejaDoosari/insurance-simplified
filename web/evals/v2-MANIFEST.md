# EVAL V2 Manifest (P2 todos 54-55) — FROZEN 2026-09-19

Fresh 60-case eval set over the plan-a/plan-b fixture corpus. New questions
throughout (no reuse of golden wording); every answerable anchor is a verbatim
full-line substring of the claimed doc/page, machine-verified
(`node /tmp/verify-v2.mjs` → VERIFY PASS: 52/52 anchors resolve, 52/52 expected
passages hit in top-10 lexical retrieval, 8/8 must-refuse retrieval-clean).

## Files (sha256)

- `evals/v2-dev.json`: `40262577a04d1d45fb200c573ea8d321f59209d5c5966dc7134cc5e1a14a7ec2` (36 items)
- `evals/v2-validation.json`: `a3738f822a39f7ffc7c8f8b0fb4967460091c71b0b8cc72b00aec378111f8b8b` (12 items)
- `evals/v2-test.json`: `64717e4dd12f764341447680254eec4a728fd1689b3cabbb08ec4d962b318bb8` (12 items)

Total: 60 items (52 answerable + 8 must-refuse). Any later change = versioned
files + re-baseline; never edit in place.

## Category counts per partition

| category    | dev | validation | test | total | minimum |
|-------------|-----|------------|------|-------|---------|
| direct      | 7   | 2          | 3    | 12    | 12      |
| paraphrase  | 7   | 2          | 3    | 12    | 12      |
| exact-term  | 6   | 2          | 2    | 10    | 10      |
| multi-doc   | 6   | 2          | 2    | 10    | 10      |
| exclusion   | 5   | 2          | 1    | 8     | 8       |
| must-refuse | 5   | 2          | 1    | 8     | 8       |
| total       | 36  | 12         | 12   | 60    | 60      |

Categories: `direct` (straight factual), `paraphrase` (semantic rewording),
`exact-term` (F-1, dollar amounts, plan names, waiting-period, network name),
`multi-doc` (cross-plan comparison), `exclusion` (conflict / authority /
version / disambiguation, answerable), `must-refuse` (NOT STATED /
needs-external, `mustRefuse:true`, no expected passages).

## Item shape

V2 mirrors the golden shape (`id`, `question`, `subset`, `expected[{doc,page,passage}]`
or `mustRefuse:true`) plus `category` (6-way taxonomy above),
`grounding` (`explicit` for direct/exact-term, `related` otherwise), and
`chunkKeys` (deterministic `doc#page#order`; fixtures yield 1 chunk/page at
512/64 without crossing pages, so order is always 0).

Subset mapping (runner-compatible): direct→`answerable`, paraphrase→`paraphrase`,
exact-term→`answerable`, multi-doc→`multi-doc`, exclusion→`distractor`,
must-refuse→`must-refuse`.

## Scoring

`npm run eval -- --eval=v2` scores V2 DEV + VALIDATION only via the existing
line-overlap retriever mirror. There is intentionally NO V2 TEST scoring path.

**V2 TEST MUST NOT BE SCORED until P2 FINAL AUDIT (todo 65).**
