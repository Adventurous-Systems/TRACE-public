#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/auth-smoke.sh https://trace-staging.adventurous.systems
# Optional:
#   AUTH_TEST_EMAIL=user@example.com AUTH_TEST_PASSWORD=secret bash scripts/auth-smoke.sh https://trace-staging.adventurous.systems

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/auth-smoke.sh <base-url>"
  exit 1
fi

BASE_URL="${1%/}"

echo "[1/4] Checking login page..."
LOGIN_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/login")"
echo "  /login -> HTTP ${LOGIN_STATUS}"
if [[ "${LOGIN_STATUS}" != "200" ]]; then
  echo "ERROR: /login did not return 200"
  exit 1
fi

echo "[2/4] Checking invalid auth request reaches API (expect 400/401 JSON)..."
INVALID_BODY="$(curl -sS -X POST "${BASE_URL}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  --data '{"email":"invalid@example.com","password":"wrong-password"}')"

if echo "${INVALID_BODY}" | grep -q '"success":false'; then
  echo "  /api/v1/auth/login returned JSON error as expected"
else
  echo "ERROR: /api/v1/auth/login did not return expected API JSON"
  echo "${INVALID_BODY}" | head -c 300
  echo
  exit 1
fi

if [[ -n "${AUTH_TEST_EMAIL:-}" && -n "${AUTH_TEST_PASSWORD:-}" ]]; then
  echo "[3/4] Checking valid login..."
  LOGIN_JSON="$(curl -sS -X POST "${BASE_URL}/api/v1/auth/login" \
    -H 'content-type: application/json' \
    --data "{\"email\":\"${AUTH_TEST_EMAIL}\",\"password\":\"${AUTH_TEST_PASSWORD}\"}")"

  if ! echo "${LOGIN_JSON}" | grep -q '"success":true'; then
    echo "ERROR: valid login failed"
    echo "${LOGIN_JSON}" | head -c 300
    echo
    exit 1
  fi

  TOKEN="$(echo "${LOGIN_JSON}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [[ -z "${TOKEN}" ]]; then
    echo "ERROR: could not extract token from login response"
    exit 1
  fi

  echo "[4/4] Checking /api/v1/auth/me with token..."
  ME_JSON="$(curl -sS "${BASE_URL}/api/v1/auth/me" -H "authorization: Bearer ${TOKEN}")"
  if ! echo "${ME_JSON}" | grep -q '"success":true'; then
    echo "ERROR: /api/v1/auth/me failed"
    echo "${ME_JSON}" | head -c 300
    echo
    exit 1
  fi
  echo "  /api/v1/auth/me passed"
else
  echo "[3/4] Skipping valid login check (set AUTH_TEST_EMAIL and AUTH_TEST_PASSWORD)"
  echo "[4/4] Skipping /api/v1/auth/me token check (no token available)"
fi

echo "Auth smoke checks passed for ${BASE_URL}"
