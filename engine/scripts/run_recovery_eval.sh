#!/usr/bin/env bash
# One-shot AI-assisted recovery measurement on the validation SBCs (owner's machine).
#
#   CORPUS_DIR=~/insurance-corpus-private OUT_DIR=~/insurance-eval-out \
#     bash scripts/run_recovery_eval.sh
#
# Needs: Java 17+, the hybrid group (Docling models download on first start), and for
# the model stages: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (Nemotron) and
# ENGINE_ANTHROPIC_API_KEY (Claude), plus the cloud policy below. Sends ONLY the public
# validation corpus. Writes aggregate JSON reports to OUT_DIR (keep it outside git).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CORPUS_DIR:?set CORPUS_DIR to the private corpus checkout}"
: "${OUT_DIR:?set OUT_DIR to a folder outside git}"
mkdir -p "$OUT_DIR"
# P0-05: every paid call is reserved against this cumulative ledger before it is made.
export ENGINE_EVAL_SPEND_LEDGER="${ENGINE_EVAL_SPEND_LEDGER:-$OUT_DIR/spend.jsonl}"
export ENGINE_EVAL_BUDGET_USD="${ENGINE_EVAL_BUDGET_USD:-25}"
# Per-document cap for these runs (D-036 product gate is 0.05; raising it here is an
# evaluation choice the owner records, never "none").
MAX_COST="${MAX_COST_USD_PER_DOC:-0.05}"
export ENGINE_CACHE_DIR="${ENGINE_CACHE_DIR:-$OUT_DIR/cache}"
KEYS="$CORPUS_DIR/answer-keys/sbc_cells.tsv"
uv sync -q --group hybrid

# Cloud policy for THIS run: public corpus only (customer documents stay refused).
export ENGINE_CLOUD_PROVIDERS="${ENGINE_CLOUD_PROVIDERS:-nvidia,anthropic}"
: "${ENGINE_CLOUD_RETENTION_REVIEWED:?record the providers whose retention terms you reviewed, e.g. nvidia,anthropic}"
: "${ENGINE_EVAL_GRANTED_BY:?your name: authorizes sending the public validation PDFs}"
: "${ENGINE_PRICE_NVIDIA_IN:?USD per million input tokens (0 on the free tier)}"
: "${ENGINE_PRICE_NVIDIA_OUT:?}"
: "${ENGINE_PRICE_ANTHROPIC_IN:?USD per million input tokens for ENGINE_ANTHROPIC_MODEL}"
: "${ENGINE_PRICE_ANTHROPIC_OUT:?}"

uv run python -m evaluation.probe_providers | tee "$OUT_DIR/probe.json"
run() {  # name, extra args
  local name=$1; shift
  uv run python -m evaluation.recovery_eval --keys "$KEYS" --pdfs "$CORPUS_DIR" \
    --start-hybrid --stages primary,docling --max-cost-usd "$MAX_COST" \
    --out "$OUT_DIR/$name.json" "$@" >/dev/null
  echo "$name: $(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['correct_keys'],'correct /',d['false_verified'],'false verified / $',d['model_cost_usd'])" "$OUT_DIR/$name.json")"
}
run local
run text --text
run visual --visual
run text_visual --text --visual
# No uncapped run (P0-05). To see what the D-036 gate costs in coverage, rerun with a
# higher MAX_COST_USD_PER_DOC; the cumulative ledger still caps the total.
echo "evaluation spend so far: $(python3 -c "import json,sys
r,s={},{}
for l in open(sys.argv[1]):
    d=json.loads(l); (r if d['kind']=='reserve' else s)[d['id']]=d['usd']
print(round(sum(s.get(k,v) for k,v in r.items()),4))" "$ENGINE_EVAL_SPEND_LEDGER") of \$$ENGINE_EVAL_BUDGET_USD"
