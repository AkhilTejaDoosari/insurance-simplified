#!/usr/bin/env bash
# Dependency license policy (one-way door #7): copyleft licenses that would bind
# the service (GPL family incl. AGPL/LGPL, SSPL) need an owner decision first.
# PyMuPDF is AGPL: it may be evaluated, but not shipped, until that decision.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run pip-licenses --from=mixed --partial-match \
  --ignore-packages insurance-simplified-engine \
  --fail-on="GPL;SSPL;Commons Clause" >/dev/null
echo "engine licenses: ok"
