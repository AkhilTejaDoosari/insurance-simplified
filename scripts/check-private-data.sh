#!/usr/bin/env bash
# Private-data guard: fails if any tracked or staged file is
#   - a PDF outside tests/fixtures/ (only synthetic fixtures may be committed), or
#   - under real-fixtures/, nonstandard/ or SBCs/ (licensed real documents and
#     real-document test data).
# Runs in CI and, locally, as a pre-commit hook. Prints offending paths only.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The index holds every tracked file and every staged addition/rename/copy.
bad=$(git ls-files | grep -E -i \
  -e '^(real-fixtures|nonstandard|sbcs)/' \
  -e '\.pdf$' \
  | grep -v -E '^tests/fixtures/.+\.pdf$' || true)

if [ -n "$bad" ]; then
  echo "check-private-data: private or real-document files must not be committed:" >&2
  printf '%s\n' "$bad" | sed 's/^/  /' >&2
  echo "Unstage them (git rm --cached <path>); keep them in REAL_PDFS_DIR / REAL_FIXTURES_DIR." >&2
  exit 1
fi

echo "check-private-data: ok"
