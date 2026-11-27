#!/usr/bin/env bash
# Remove local clutter from the repository folder (owner's Mac). Dry run by default.
#
#   bash scripts/clean_local.sh            # list what would be removed
#   bash scripts/clean_local.sh --apply    # move it to ~/.Trash/insurance-simplified-<time>/
#
# Only untracked or git-ignored paths on a fixed list are touched: local agent and tool
# state (.omo, .opencode, .gitnexus/GitNexus, .specify), stale V1 Spec Kit specs/, audit
# output folders, build and test leftovers, logs, and older .env.local backups (the
# newest backup is kept). Everything is moved to the Trash, not deleted.
#
# Never touched: .env.local / engine/.env.local / web/.env.local, real-document folders
# (SBCs/, nonstandard/, real-fixtures/), node_modules/ and .venv/, .git/, .claude/, and
# anything git tracks. Other untracked top-level items are listed for you, not moved.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

CANDIDATES=".omo .opencode .gitnexus GitNexus gitnexus .specify specs audit audits .audit
complete-audit full-audit .playwright-mcp test-results playwright-report coverage .next
.next-e2e out dist build .debug-journal.md web/.next web/.next-e2e web/test-results
web/playwright-report web/coverage engine/.pytest_cache engine/.mypy_cache engine/.ruff_cache
engine/htmlcov"
PROTECTED=".env.local engine/.env.local web/.env.local SBCs nonstandard real-fixtures
node_modules web/node_modules .venv engine/.venv .git .claude"

is_tracked() { [ -n "$(git ls-files -- "$1" | head -1)" ]; }
targets=""
for p in $CANDIDATES; do
  [ -e "$p" ] || continue
  if is_tracked "$p"; then echo "  keep (tracked by git): $p"; continue; fi
  targets="$targets $p"
done
for f in *.log web/*.log engine/*.log llm-test-output*.json web/llm-test-output*.json; do
  [ -e "$f" ] && ! is_tracked "$f" && targets="$targets $f"
done
# older env backups hold old keys: keep only the newest one
backups=$(ls -1t .env.local.bak-* 2>/dev/null | tail -n +2 || true)
for b in $backups; do targets="$targets $b"; done

echo "== would move to the Trash:"
if [ -z "${targets// /}" ]; then echo "  nothing"; else
  for t in $targets; do printf '  %-45s %s\n' "$t" "$(du -sh "$t" 2>/dev/null | cut -f1)"; done
fi

echo "== other untracked top-level items (not touched - tell Claude if any should go):"
git ls-files --others --directory --exclude-standard -- . | awk -F/ '{print $1}' | sort -u | while read -r item; do
  case " $(echo $CANDIDATES $PROTECTED) " in *" $item "*) continue ;; esac
  echo "  $item"
done
git ls-files --others --ignored --exclude-standard --directory -- . | grep -E '^[^/]+/?$' | sed 's#/$##' | sort -u | while read -r item; do
  case " $(echo $CANDIDATES $PROTECTED) " in *" $item "*) continue ;; esac
  case "$item" in .env.local.bak-*|*.log|llm-test-output*) continue ;; esac
  echo "  (ignored) $item"
done

if [ "$APPLY" = 0 ]; then echo; echo "dry run: nothing moved. Run with --apply to move the list above to the Trash."; exit 0; fi
[ -z "${targets// /}" ] && exit 0
dest="$HOME/.Trash/insurance-simplified-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest"
for t in $targets; do
  mkdir -p "$dest/$(dirname "$t")"
  mv "$t" "$dest/$t"
done
echo "moved to $dest (empty the Trash to delete; the env backups there still hold keys)"
