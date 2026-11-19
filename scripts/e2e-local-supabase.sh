#!/usr/bin/env bash
# Start a LOCAL Supabase stack (Docker) for the Playwright e2e run, apply the
# db/migrations in order, create the storage bucket, and export the env the
# app's durable-upload path needs. Never touches a hosted project.
#
#   scripts/e2e-local-supabase.sh            # start + migrate + bucket
#   scripts/e2e-local-supabase.sh stop       # stop and discard the stack
#
# In GitHub Actions the variables are appended to $GITHUB_ENV (values masked);
# locally they are written to $WORKDIR/e2e.env (mode 600) to `source` before
# `npm run test:e2e`. Values are never printed.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WORKDIR="${E2E_SUPABASE_WORKDIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/insurance-e2e}"
BUCKET="${E2E_STORAGE_BUCKET:-e2e-documents}"

if [ "${1:-}" = "stop" ]; then
  supabase stop --no-backup --workdir "$WORKDIR"
  exit 0
fi

mkdir -p "$WORKDIR"
if [ ! -f "$WORKDIR/supabase/config.toml" ]; then
  (cd "$WORKDIR" && supabase init --force >/dev/null)
fi
PROJECT_ID=$(sed -n 's/^project_id = "\(.*\)"$/\1/p' "$WORKDIR/supabase/config.toml")

# Only what the upload path uses: Postgres, PostgREST, Auth (auth.users is
# referenced by the RLS migrations), Storage and the Kong gateway.
supabase start --workdir "$WORKDIR" \
  -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

status_env=$(supabase status --workdir "$WORKDIR" -o env)
read_var() { printf '%s\n' "$status_env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -n1; }
API_URL=$(read_var API_URL)
SERVICE_KEY=$(read_var SERVICE_ROLE_KEY)
if [ -z "$API_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "e2e-local-supabase: could not read API_URL / SERVICE_ROLE_KEY from supabase status" >&2
  exit 1
fi

# Migrations in order, forward files only (*.down.sql are rollbacks).
DB_CONTAINER="supabase_db_${PROJECT_ID}"
for f in $(ls "$ROOT"/db/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  echo "applying $(basename "$f")"
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres < "$f"
done
docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"

# Private bucket (idempotent: 409/400 "already exists" is fine).
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/storage/v1/bucket" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "content-type: application/json" \
  -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}")
case "$code" in
  200|201|400|409) echo "storage bucket ready ($code)";;
  *) echo "e2e-local-supabase: bucket create failed (HTTP $code)" >&2; exit 1;;
esac

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "::add-mask::$SERVICE_KEY"
  {
    echo "SUPABASE_URL=$API_URL"
    echo "SUPABASE_SECRET_KEY=$SERVICE_KEY"
    echo "SUPABASE_STORAGE_BUCKET=$BUCKET"
  } >> "$GITHUB_ENV"
  echo "e2e-local-supabase: exported SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET"
else
  umask 077
  {
    echo "export SUPABASE_URL=$API_URL"
    echo "export SUPABASE_SECRET_KEY=$SERVICE_KEY"
    echo "export SUPABASE_STORAGE_BUCKET=$BUCKET"
  } > "$WORKDIR/e2e.env"
  echo "e2e-local-supabase: wrote $WORKDIR/e2e.env (source it, then npm run test:e2e)"
fi
