#!/usr/bin/env bash
# Model + semantic-judge measurement on the 17 public validation SBCs (owner's Mac).
#
#   bash engine/scripts/run_model_eval_mac.sh [--local-only] [CORPUS_DIR]
#
# --local-only: free setup check - documents, reader artifacts and the baseline stage,
# no provider call and no configuration needed.
#
# One pass, stage by stage, each scored before the next starts:
#   local     existing reader artifacts only (must reproduce 395/454, 0 false verified)
#   text      + Nemotron on gap pages and pages with printed amounts nobody proposed
#   visual    + Claude on the pages still open after Nemotron
#   judged    + key 2: Claude judges parser/Nemotron facts, Nemotron judges Claude's
# Model replies are cached, so a later stage pays only for what it adds. Every paid
# call is reserved against the cumulative $25 evaluation ledger before it is sent.
# It stops on: missing configuration, a failed provider probe, a document outside the
# pinned public validation set, a baseline that does not reproduce, a false verified
# fact, or a budget that cannot cover the next stage.
#
# Works with macOS's bash 3.2. Needs: uv, git, python3; Java 17+ only when the reader
# cache must be rebuilt. Writes aggregates to OUT_DIR (default ~/insurance-eval-out);
# the reader cache and model cache there hold derived document data - keep it out of git.
set -euo pipefail

ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ENGINE/.." && pwd)"
LOCAL_ONLY=0
if [ "${1:-}" = "--local-only" ]; then LOCAL_ONLY=1; shift; fi
CORPUS_DIR="${1:-${CORPUS_DIR:-}}"
if [ -z "$CORPUS_DIR" ]; then
  for c in "$REPO/../insurance-corpus-private" "$HOME/Repositories/insurance-corpus-private"; do
    if [ -f "$c/answer-keys/sbc_cells.tsv" ]; then CORPUS_DIR="$(cd "$c" && pwd)"; break; fi
  done
fi
[ -n "$CORPUS_DIR" ] && [ -f "$CORPUS_DIR/answer-keys/sbc_cells.tsv" ] || {
  echo "CORPUS_DIR not found: pass the insurance-corpus-private checkout as the first argument"; exit 2; }
OUT_DIR="${OUT_DIR:-$HOME/insurance-eval-out}"
READERS_DIR="${READERS_DIR:-$OUT_DIR/readers}"
KEYS="$CORPUS_DIR/answer-keys/sbc_cells.tsv"
mkdir -p "$OUT_DIR"
cd "$ENGINE"

say() { printf '\n== %s\n' "$*"; }
for tool in uv git python3; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool"; exit 2; }
done

# ---------------------------------------------------------------- 1. environment
say "Environment"
uv sync -q
if [ "$LOCAL_ONLY" = 0 ]; then
  uv run -q python -m evaluation.eval_env --repo "$REPO" --emit "$OUT_DIR/eval.env"
  # shellcheck disable=SC1091
  . "$OUT_DIR/eval.env"
  trap 'rm -f "$OUT_DIR/eval.env"' EXIT  # credentials stay in this process only
else
  echo "local-only: no provider configuration used"
fi
export ENGINE_EVAL_SPEND_LEDGER="${ENGINE_EVAL_SPEND_LEDGER:-$OUT_DIR/spend.jsonl}"  # cumulative
export ENGINE_EVAL_BUDGET_USD=25
export ENGINE_CACHE_DIR="$OUT_DIR/model-cache"
unset ENGINE_CLOUD_CUSTOMER_DOCUMENTS  # customer documents stay refused
# Per-document cap for this measurement. One worst-case Claude reservation at Opus 5.5
# list prices is ~$1.27, above the $0.05 D-036 product gate; that gate is decided after
# this run. The $25 cumulative ledger is the binding limit.
MAX_COST="${MAX_COST_USD_PER_DOC:-3.00}"

# ---------------------------------------------- 2. authorized documents only (pinned)
say "Documents"
ALLOWED="4631bb99233f29485f58369b3d3fd11161c54a8781d7cfb2c7bf41e3ca318b70
54772ac356c5bd9e26a866b9e3d2c8edb8e88b5c82c06485acc8af851576c145
63e72b0cc6c24f6bf065a72b7a1d777f038fdf15f9db4a9544cb38831a9e7a7a
85c5ad0dc254d6b028fa87608a56555cdd22db5dd455dee9230b7d7d4b597c29
89c61550e5ad06062a2926f776102644b4cace05906f7c99667b7f994f05feb9
8b4043c4fc1766a4854515af25bb31df81fc492d8fbb3ff8ef2fa72885e9dfd1
9cda3657fb271eed265f9a4fb7d841b4bc099691da014ae53ca459496b287a09
b2ee39c5f3b77cf382e53241ddd701b6eaade93d3a471c1bf36bfd1f992d1e32
b4bd2d272512f4313fb0b2a7a7519d4026ae188199c305f56345cd6dee7a61a9
b6f371ca86c00c7320c82c3c132481adca806fdd0b4fe7cec6c45de29b70f7e5
b7c1486c82ed29bbcfc0669693411b7328dffeb1dd75e66cc2c7be197382eacb
c2ea19994f9589ba013131b3b3b0a9b5fbde537807ac8d1f478afd0f37033221
cf828d8ae86e73c75af2baf026b132f2d148de1f4b260b135721b3f8c1c2d4da
d049e7b2bda37f4e0c1d8b6b2165e836014c83558e79ba130443fb74a6e9e02a
dbd77c91c4b123777d4453b58eb2e46772ab35b7636b93b4fccdaf2b2cf3fbd4
ef887f57da1434debd35184347e06ec97ae009c8347b24adab52a127b0caec8d
f7a68cbca80b661ee2fd1703858cf56c3fa3bd2c977f0219e9db12cb25b34a67"
for prefix in $(cut -f1 "$KEYS" | tail -n +2 | sort -u); do
  match=$(printf '%s\n' "$ALLOWED" | grep "^$prefix" || true)
  [ -n "$match" ] || { echo "keyed document $prefix is not in the pinned public validation set"; exit 3; }
  pdf="$CORPUS_DIR/$match.pdf"
  [ -f "$pdf" ] || { echo "missing $match.pdf"; exit 3; }
  [ "$(shasum -a 256 "$pdf" | cut -d' ' -f1)" = "$match" ] || { echo "$match.pdf content changed"; exit 3; }
done
echo "17 pinned public validation SBCs, hashes verified"

# ------------------------------------------------- 3. existing extraction artifacts
say "Reader artifacts"
FINGERPRINT="d592bbf7b47172bfdc391165c1eb82f9153b6fe8675beb90c5b4e4031a1941e1"
fingerprint() { (cd "$READERS_DIR" && LC_ALL=C find . -name '*.json' | LC_ALL=C sort |
  xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1); }
if [ ! -d "$READERS_DIR/opendataloader" ]; then
  # Docling output: the corpus's published CI artifacts (Docling is not run again);
  # OpenDataLoader and pdfplumber are deterministic and take about a minute here.
  command -v java >/dev/null || { echo "Java 17+ is needed once to rebuild the reader cache (brew install openjdk@17)"; exit 2; }
  tmp="$(mktemp -d)"
  git -C "$CORPUS_DIR" fetch -q --depth=1 origin parser-out/docling
  git -C "$CORPUS_DIR" archive FETCH_HEAD docling-out | tar -x -C "$tmp"
  uv run -q python -m evaluation.build_reader_cache --keys "$KEYS" --pdfs "$CORPUS_DIR" \
    --docling-json "$tmp/docling-out" --out "$READERS_DIR"
  rm -rf "$tmp"
fi
if [ "$(fingerprint)" = "$FINGERPRINT" ]; then
  echo "reader cache is byte-identical to the measured artifacts"
else
  echo "note: reader cache differs from the measured fingerprint (OS/Java build); the baseline check decides"
fi

# ------------------------------------------------------------------- 4. providers
if [ "$LOCAL_ONLY" = 0 ]; then
say "Provider check (no document content, no secrets)"
uv run -q python -m evaluation.probe_providers > "$OUT_DIR/probe.json" || {
  cat "$OUT_DIR/probe.json"; echo "a provider is not reachable or the model is not available"; exit 4; }
cat "$OUT_DIR/probe.json"
if python3 -c "import json,sys;d=json.load(open(sys.argv[1]))['nvidia'];sys.exit(0 if d.get('structured_json_schema') is True else 1)" "$OUT_DIR/probe.json"; then
  export NEMOTRON_STRUCTURED=json_schema
else
  export NEMOTRON_STRUCTURED=json_object
fi
fi

# ------------------------------------------------------------------ 5. budget
committed() { python3 - "$ENGINE_EVAL_SPEND_LEDGER" <<'PY'
import json, os, sys
r, s = {}, {}
p = sys.argv[1]
if os.path.exists(p):
    for line in open(p):
        if line.strip():
            d = json.loads(line); (r if d["kind"] == "reserve" else s)[d["id"]] = d["usd"]
print(round(sum(s.get(k, v) for k, v in r.items()) + sum(v for k, v in s.items() if k not in r), 4))
PY
}
need() {  # $1 stage ceiling in USD
  left=$(python3 -c "print(round(25 - $(committed), 4))")
  python3 -c "import sys; sys.exit(0 if $left >= $1 else 1)" || {
    echo "budget: \$$left left of \$25, stage needs up to \$$1 - stopping"; exit 5; }
  echo "budget: \$$(committed) committed, \$$left left (stage ceiling \$$1)"
}

# ------------------------------------------------------------------- 6. stages
STAGES=""
run() {  # name, ceiling USD, extra args
  local name=$1 ceiling=$2; shift 2
  say "Stage $name"
  need "$ceiling"
  local t0; t0=$(date +%s)
  uv run -q python -m evaluation.recovery_eval --keys "$KEYS" --pdfs "$CORPUS_DIR" \
    --readers "$READERS_DIR" --stages primary,docling --max-cost-usd "$MAX_COST" \
    --out "$OUT_DIR/$name.json" "$@" > /dev/null 2> "$OUT_DIR/$name.log"
  echo $(( $(date +%s) - t0 )) > "$OUT_DIR/$name.wall"
  STAGES="$STAGES $name"
  # shellcheck disable=SC2086
  uv run -q python -m evaluation.compare_runs "$OUT_DIR" $STAGES || {
    echo "stopped after $name: false verified facts"; exit 6; }
}

run local 0
python3 - "$OUT_DIR/local.json" <<'PY' || { echo "baseline did not reproduce 395/454 with 0 false verified - stopping before any paid call"; exit 7; }
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if d["correct_keys_with_clauses"] == 395 and d["false_verified_with_clauses"] == 0 else 1)
PY
if [ "$LOCAL_ONLY" = 1 ]; then
  echo; echo "local-only check passed: baseline reproduced, nothing sent to any provider."; exit 0
fi
run text   1  --text --route-missed
run visual 12 --text --route-missed --visual
run judged 10 --text --route-missed --visual --judge anthropic --alt-judge nvidia

# ------------------------------------------------------------------- 7. summary
say "Summary"
{
  echo "# Model and judge measurement - $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "17 public validation SBCs, keys v1.1 DRAFT, frozen scorer. Aggregates only."
  echo
  # shellcheck disable=SC2086
  uv run -q python -m evaluation.compare_runs "$OUT_DIR" $STAGES
  echo
  echo "Cumulative evaluation spend: \$$(committed) of \$25 (ledger: $ENGINE_EVAL_SPEND_LEDGER)"
} | tee "$OUT_DIR/summary.md"
echo
echo "Done. Share $OUT_DIR/summary.md and the stage JSON reports (aggregates, no document text)."
