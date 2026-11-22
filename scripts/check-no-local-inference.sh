#!/usr/bin/env bash
# Owner decision 2026-11-21: inference is cloud-only (LLM via the adapter,
# embeddings via Cloudflare Workers AI, D-012). No app runtime path may name
# a local Ollama runtime or its default port. Historical records (evals/runs,
# evals/BASELINE.md, docs/archive, docs/plans) and test fixtures are not
# runtime paths and are not scanned.
set -euo pipefail
cd "$(dirname "$0")/.."
RUNTIME_PATHS=(app Dockerfile docker-compose.yml next.config.mjs)
existing=()
for p in "${RUNTIME_PATHS[@]}"; do [ -e "$p" ] && existing+=("$p"); done
if hits=$(grep -rniE 'ollama|:11434\b' "${existing[@]}"); then
  echo "check-no-local-inference: FAILED — local inference referenced in a runtime path:" >&2
  echo "$hits" | cut -c1-200 >&2
  exit 1
fi
echo "check-no-local-inference: ok"
