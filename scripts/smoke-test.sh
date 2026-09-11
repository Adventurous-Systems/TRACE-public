#!/usr/bin/env bash
#
# TRACE end-to-end smoke test.
#
# Drives the full workshop flow against a running API and asserts every stage:
#   signup → access request → admin approval → passport → photo upload → QR/public
#   view → listing → offer → transaction lifecycle → quality report → feedback.
#
# Usage:
#   scripts/smoke-test.sh                         # defaults to http://localhost:3001
#   API_BASE=https://staging.example.com scripts/smoke-test.sh
#
# Env:
#   API_BASE   Base origin. Endpoints are <API_BASE>/api/v1/... (nginx routes /api/* → Fastify).
#   Seeded credentials are overridable via *_EMAIL / *_PASS (see defaults below).
#
# Requires: curl, python3. Exits non-zero on the first failed assertion.
# Creates test data and deletes it from the DB only if DB_CLEANUP=1 and psql is reachable;
# otherwise the rows are left in place (safe — they are clearly tagged "smoke-test").

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
API="${API_BASE%/}/api/v1"

PLATFORM_EMAIL="${PLATFORM_EMAIL:-platform@trace.eco}"
: "${PLATFORM_PASS:?PLATFORM_PASS is required}"
STAFF_EMAIL="${STAFF_EMAIL:-staff@stirlingreuse.com}"
: "${STAFF_PASS:?STAFF_PASS is required}"
BUYER_EMAIL="${BUYER_EMAIL:-buyer@example.com}"
: "${BUYER_PASS:?BUYER_PASS is required}"
INSPECTOR_EMAIL="${INSPECTOR_EMAIL:-inspector@trace.eco}"
: "${INSPECTOR_PASS:?INSPECTOR_PASS is required}"

TS="$(date +%s)"
PASS=0
FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────

c_green=$'\e[32m'; c_red=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'

# jq-free JSON field extractor: jget '<json>' "['data']['token']"
jget() { python3 -c "import sys,json;d=json.loads(sys.argv[1]);print(eval('d'+sys.argv[2]))" "$1" "$2" 2>/dev/null || true; }

ok()   { PASS=$((PASS+1)); printf "  %s✓%s %s\n" "$c_green" "$c_off" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  %s✗ %s%s\n" "$c_red" "$1" "$c_off"; }
step() { printf "\n%s──%s %s\n" "$c_dim" "$c_off" "$1"; }

# assert_status <expected> <method> <path> [curl args...]
assert_status() {
  local exp="$1" method="$2" path="$3"; shift 3
  local code
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X "$method" "$API$path" "$@")
  if [ "$code" = "$exp" ]; then ok "$method $path → $code"; else bad "$method $path → $code (expected $exp)"; fi
}

login() { # login <email> <pass> → echoes token
  curl -s -m 15 -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])"
}

# ── tiny 1x1 PNG for the photo-upload step ─────────────────────────────────────
IMG="$(mktemp /tmp/trace-smoke-XXXX.png)"
trap 'rm -f "$IMG"' EXIT
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$IMG"

echo "TRACE smoke test → $API_BASE"

# ── 0. API up ──────────────────────────────────────────────────────────────────
step "Health"
HEALTH=$(curl -s -m 10 "$API_BASE/health" || true)
[ "$(jget "$HEALTH" "['data']['status']")" = "ok" ] && ok "health ok, db=$(jget "$HEALTH" "['data']['db']")" || { bad "health check failed: $HEALTH"; exit 1; }

# ── 1. Buyer signup ─────────────────────────────────────────────────────────────
step "Buyer signup + access request"
REG=$(curl -s -m 15 -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"smoke+$TS@test.com\",\"password\":\"SmokeTest1234!\",\"name\":\"Smoke Test\"}")
NEW_TOKEN=$(jget "$REG" "['data']['token']")
[ -n "$NEW_TOKEN" ] && ok "registered (role=$(jget "$REG" "['data']['user']['role']"))" || bad "signup failed: $REG"

AR=$(curl -s -m 15 -X POST "$API/access-requests" -H "Authorization: Bearer $NEW_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"requestedRole":"hub_staff","organisationName":"Smoke Test Hub","notes":"smoke test"}')
AR_ID=$(jget "$AR" "['data']['id']")
[ -n "$AR_ID" ] && ok "access request submitted ($AR_ID)" || bad "access request failed: $AR"

# ── 2. Platform admin approves ──────────────────────────────────────────────────
step "Platform admin approves (NOTE: route requires platform_admin, not hub_admin)"
PLAT_TOKEN=$(login "$PLATFORM_EMAIL" "$PLATFORM_PASS")
APP=$(curl -s -m 15 -X POST "$API/access-requests/$AR_ID/approve" -H "Authorization: Bearer $PLAT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"hub_staff","organisationName":"Smoke Test Hub","reviewNotes":"smoke approve"}')
[ "$(jget "$APP" "['success']")" = "True" ] && ok "approved" || bad "approve failed: $APP"

# ── 3. Hub staff creates passport + photo ───────────────────────────────────────
step "Hub staff: passport + photo + public view"
STAFF_TOKEN=$(login "$STAFF_EMAIL" "$STAFF_PASS")
P=$(curl -s -m 15 -X POST "$API/passports" -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"productName":"Smoke Test Beam","categoryL1":"structural-timber","conditionGrade":"B","conditionNotes":"smoke test"}')
PID=$(jget "$P" "['data']['id']")
[ -n "$PID" ] && ok "passport created ($PID)" || { bad "passport create failed: $P"; }

PH=$(curl -s -m 30 -X POST "$API/passports/$PID/photos" -H "Authorization: Bearer $STAFF_TOKEN" \
  -F "file=@$IMG;type=image/png")
[ "$(jget "$PH" "['success']")" = "True" ] && ok "photo uploaded" || bad "photo upload failed: $PH"

QR_URL=$(jget "$P" "['data']['qrCodeUrl']")
assert_status 200 GET "/passports/$PID"
assert_status 200 GET "/passports/$PID/verify"
if [ -n "$QR_URL" ]; then
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$QR_URL")
  [ "$code" = "200" ] && ok "QR asset resolves ($QR_URL)" || bad "QR asset $code: $QR_URL"
fi

# ── 4. Listing ───────────────────────────────────────────────────────────────────
step "Listing"
L=$(curl -s -m 15 -X POST "$API/marketplace/listings" -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"passportId\":\"$PID\",\"pricePence\":45000,\"currency\":\"GBP\",\"quantity\":1,\"shippingOptions\":[{\"method\":\"collection\"}]}")
LID=$(jget "$L" "['data']['id']")
[ "$(jget "$L" "['data']['status']")" = "active" ] && ok "listing active ($LID)" || bad "listing failed: $L"

# ── 5. Offer → transaction → lifecycle ────────────────────────────────────────────
step "Buyer offer → transaction (offer creates tx directly; no seller-accept step)"
BUYER_TOKEN=$(login "$BUYER_EMAIL" "$BUYER_PASS")
OF=$(curl -s -m 15 -X POST "$API/marketplace/offers" -H "Authorization: Bearer $BUYER_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"listingId\":\"$LID\",\"offerPence\":45000,\"notes\":\"smoke offer\"}")
TXID=$(jget "$OF" "['data']['id']")
[ "$(jget "$OF" "['data']['status']")" = "pending" ] && ok "transaction created (pending, $TXID)" || bad "offer failed: $OF"

CD=$(curl -s -m 15 -X PATCH "$API/marketplace/transactions/$TXID" -H "Authorization: Bearer $BUYER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"action":"confirm_delivery","notes":"received"}')
[ "$(jget "$CD" "['data']['status']")" = "confirmed" ] && ok "delivery confirmed" || bad "confirm_delivery failed: $CD"

# ── 6. Quality report ──────────────────────────────────────────────────────────────
step "Inspector quality report"
INSP_TOKEN=$(login "$INSPECTOR_EMAIL" "$INSPECTOR_PASS")
QR2=$(curl -s -m 15 -X POST "$API/quality/reports" -H "Authorization: Bearer $INSP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"passportId\":\"$PID\",\"structuralScore\":8,\"aestheticScore\":7,\"environmentalScore\":9,\"overallGrade\":\"B\",\"reportNotes\":\"smoke inspection\"}")
[ "$(jget "$QR2" "['data']['overallGrade']")" = "B" ] && ok "quality report submitted" || bad "quality report failed: $QR2"

# ── 7. Feedback ─────────────────────────────────────────────────────────────────────
step "Feedback submit + admin list"
FB=$(curl -s -m 15 -X POST "$API/feedback" -H 'Content-Type: application/json' \
  -d '{"rating":5,"category":"general","message":"smoke-test feedback","pageUrl":"'"$API_BASE"'/dashboard"}')
FBID=$(jget "$FB" "['data']['id']")
[ -n "$FBID" ] && ok "feedback submitted ($FBID)" || bad "feedback submit failed: $FB"

LISTED=$(curl -s -m 15 "$API/feedback" -H "Authorization: Bearer $PLAT_TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(any(x['id']=='$FBID' for x in d['data']))" 2>/dev/null || echo False)
[ "$LISTED" = "True" ] && ok "feedback appears in admin list" || bad "feedback not in admin list"

# ── optional DB cleanup ───────────────────────────────────────────────────────────
if [ "${DB_CLEANUP:-0}" = "1" ] && [ -n "${PGURL:-}" ]; then
  step "DB cleanup"
  psql "$PGURL" -q -c "DELETE FROM material_passports WHERE id='$PID';
    DELETE FROM beta_access_requests WHERE organisation_name='Smoke Test Hub';
    DELETE FROM feedback_submissions WHERE message='smoke-test feedback';
    DELETE FROM users WHERE email LIKE 'smoke+%';
    DELETE FROM organisations WHERE name='Smoke Test Hub';" && ok "test rows removed" || bad "cleanup failed"
fi

# ── summary ─────────────────────────────────────────────────────────────────────────
printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
