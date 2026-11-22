#!/usr/bin/env bash
# Owner decision 2026-11-21: inference is cloud-only (LLM via the adapter,
# embeddings via Cloudflare Workers AI, D-012). No app runtime path may name
# a local Ollama runtime or its default port.
# Scanned: the code and config the app runs or ships with. Deliberately NOT
# scanned: historical records (evals/runs, evals/BASELINE.md, docs/archive,
# docs/plans), dev/eval tooling (evals/run.mjs, scripts/p2-experiment) and
# test fixtures that use a dummy local URL — none is a runtime path.
set -euo pipefail
cd "$(dirname "$0")/.."
RUNTIME_PATHS=(app db Dockerfile docker-compose.yml next.config.mjs package.json)
existing=()
for p in "${RUNTIME_PATHS[@]}"; do [ -e "$p" ] && existing+=("$p"); done
rc=0
hits=$(grep -rniE 'ollama|:11434\b' "${existing[@]}") || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "check-no-local-inference: FAILED — local inference referenced in a runtime path:" >&2
  echo "$hits" | cut -c1-200 >&2
  exit 1
elif [ "$rc" -ne 1 ]; then
  echo "check-no-local-inference: FAILED — grep error (exit $rc)" >&2
  exit "$rc"
fi
echo "check-no-local-inference: ok"
