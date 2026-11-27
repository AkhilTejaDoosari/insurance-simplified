#!/usr/bin/env bash
# Private-data guard: fails if any tracked or staged file is
#   - a PDF outside web/tests/fixtures/ or engine/tests/fixtures/ (only synthetic
#     fixtures may be committed),
#   - under real-fixtures/, nonstandard/ or SBCs/ at any depth (licensed real
#     documents and real-document test data),
#   - an env file other than .env.example, or key material (.pem, .key, .p12), or
#   - text containing an API key or private key (NVIDIA, Anthropic, OpenAI, Supabase,
#     AWS, JWT-shaped tokens). Matches are reported by path only, never printed.
# Runs in CI and, locally, as a pre-commit hook. Prints offending paths only.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The index holds every tracked file and every staged addition/rename/copy.
bad=$(git ls-files | grep -E -i \
  -e '(^|/)(real-fixtures|nonstandard|sbcs)/' \
  -e '\.pdf$' \
  -e '(^|/)\.env($|\.)' \
  -e '\.(pem|key|p12|pfx)$' \
  | grep -v -E '^(web|engine)/tests/fixtures/.+\.pdf$' \
  | grep -v -E '(^|/)\.env\.example$' || true)
secrets=$(git grep -l -I -E \
  -e 'nvapi-[A-Za-z0-9_-]{20,}' -e 'sk-ant-[A-Za-z0-9_-]{20,}' -e 'sk-[A-Za-z0-9]{32,}' \
  -e 'sb_secret_[A-Za-z0-9]{10,}' -e 'AKIA[0-9A-Z]{16}' \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY' \
  -e 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' \
  -- . ':!*package-lock.json' ':!*uv.lock' || true)
if [ -n "$secrets" ]; then
  bad="${bad:+$bad
}$secrets"
fi

if [ -n "$bad" ]; then
  echo "check-private-data: private files, real documents or secrets must not be committed:" >&2
  printf '%s\n' "$bad" | sed 's/^/  /' >&2
  echo "Unstage them (git rm --cached <path>); keep documents in REAL_PDFS_DIR / REAL_FIXTURES_DIR and keys in .env.local." >&2
  exit 1
fi

echo "check-private-data: ok"
