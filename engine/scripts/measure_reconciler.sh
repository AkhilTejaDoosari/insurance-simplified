#!/usr/bin/env bash
# Score the reconciler at the working tree and at a baseline ref, on the stored reader
# outputs (no re-extraction). Prints aggregate JSON only; per-key TSVs go to $OUT (private).
#
#   KEYS=…/answer-keys/sbc_cells.tsv PDFS=…/validation READERS=…/reader-output \
#   OUT=…/runs BASE=a3d1c2e engine/scripts/measure_reconciler.sh
set -euo pipefail
: "${KEYS:?answer-key TSV}" "${PDFS:?validation PDF dir}" "${READERS:?dir with <reader>/<sha>.json}"
OUT="${OUT:-$(mktemp -d)}"; BASE="${BASE:-a3d1c2e}"
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"
run() {  # $1 = label, $2 = engine dir
  echo "== $1"
  (cd "$2" && uv run -q python -m evaluation.score_keys --keys "$KEYS" --pdfs "$PDFS" \
      --readers "$READERS" --out "$OUT/$1-keys.tsv" | python3 -c \
      'import json,sys; r=json.load(sys.stdin)["reconciled"]; print({k:r[k] for k in ("correct_keys","false_verified","verified_precision","critical_recall","conflicts")})')
  (cd "$2" && uv run -q python -m evaluation.attribute_misses --keys "$KEYS" \
      --pdfs "$PDFS" --readers "$READERS" --out "$OUT/$1-misses.tsv")
}
WT="$(mktemp -d)/base"
git -C "$ENGINE" worktree add -q --detach "$WT" "$BASE"
trap 'git -C "$ENGINE" worktree remove --force "$WT"' EXIT
# the baseline predates the attribution tool: give it a copy so misses are classed by
# the baseline's own verifier, not by the working tree's
cp "$ENGINE/evaluation/attribute_misses.py" "$WT/engine/evaluation/"
run "base-$BASE" "$WT/engine"
run "head" "$ENGINE"
echo "per-key files: $OUT"
