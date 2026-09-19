#!/bin/sh
# Smoke test for a local deployment (see docs/DEPLOY.md).
# Usage: BASE_URL=http://localhost:3000 PDF_A=./a.pdf PDF_B=./b.pdf sh scripts/smoke-deploy.sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
PDF_A="${PDF_A:-./a.pdf}"
PDF_B="${PDF_B:-./b.pdf}"

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
pass() { echo "SMOKE PASS: $1"; }

echo "== 1/4 health =="
HEALTH="$(curl -sS "$BASE_URL/api/health")" || fail "health endpoint unreachable"
echo "$HEALTH" | grep -q '"ok":true' || fail "health not ok: $HEALTH"
pass "health $HEALTH"

echo "== 2/4 upload =="
[ -f "$PDF_A" ] || fail "missing PDF_A ($PDF_A); set PDF_A=/path/to/a.pdf"
[ -f "$PDF_B" ] || fail "missing PDF_B ($PDF_B); set PDF_B=/path/to/b.pdf"
UPLOAD="$(curl -sS -X POST "$BASE_URL/api/upload" \
  -F "documents=@$PDF_A" -F "documents=@$PDF_B")" || fail "upload unreachable"
SESSION_ID="$(echo "$UPLOAD" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
[ -n "$SESSION_ID" ] || fail "no sessionId in upload response: $UPLOAD"
pass "upload session $SESSION_ID"

echo "== 3/4 chat (grounded) =="
CHAT="$(curl -sS -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"question\":\"What is the deductible?\"}")" \
  || fail "chat unreachable"
echo "$CHAT" | grep -q '"kind":"answer"' || fail "expected answer, got: $CHAT"
echo "$CHAT" | grep -q '"citations"' || fail "answer missing citations: $CHAT"
pass "chat answered with citations"

echo "== 4/4 chat (refusal — no supporting evidence) =="
REFUSAL="$(curl -sS -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"question\":\"What is the Martian colony evacuation copay for zebras?\"}")" \
  || fail "refusal chat unreachable"
echo "$REFUSAL" | grep -q '"kind":"refusal"' || fail "expected refusal, got: $REFUSAL"
pass "refusal returned for evidence-absent question"

echo "ALL SMOKE TESTS PASSED"
