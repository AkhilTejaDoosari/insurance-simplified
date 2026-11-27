# Evaluation data (V2)

Only manifests live here: document hashes, types and splits. The PDFs, their
text, answer keys, URLs and insurer names stay outside git
(`REAL_PDFS_DIR`, `REAL_FIXTURES_DIR`).

| File | What |
|---|---|
| `manifests/corpus-v2.json` | Written by `engine/evaluation/corpus.py` when the owner fetches the corpus: one entry per PDF (`sha256`, `type`, `split`, `multi_level`). |

## Build the corpus (owner's machine)

```sh
cd engine
REAL_PDFS_DIR=~/insurance-corpus REAL_FIXTURES_DIR=~/insurance-fixtures \
  uv run python -m evaluation.corpus fetch --candidates ~/corpus-v2-candidates.csv
```

- The candidate list is kept privately (claude.ai project, `claude/corpus-v2-candidates.md`).
- Splits are assigned by insurer family with the seed fixed in `corpus.py`.
  Families that tuned the pre-V2 app stay in validation.
- `blind-a/` and `blind-b/` are written read-only with a `SEALED.txt` note.
  Opening a blind file moves it to validation.
- The command prints any document it couldn't fetch (with its HTTP code or
  connection error) and any split below the minimum (5 per type per split; a
  multi-level document in validation for student and travel plans). Fix
  shortfalls by adding candidates, then rerun. Files already on disk and
  splits already in the manifest never move.
- Optional `template` column: documents with different family names that
  share one layout get the same value, so they are grouped together. If an
  earlier run put one layout group in both validation and a blind batch, the
  command prints `OVERLAP` (a count, no names); rerun with
  `--resolve-overlap` to move that group's blind files into validation —
  the only direction that keeps the blind batches honest.
