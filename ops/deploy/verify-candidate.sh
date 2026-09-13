#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:-/etc/trace-demo}"
COMPOSE_FILE="${TRACE_DEPLOY_COMPOSE_FILE:-$CONFIG_DIR/compose.app.yml}"

if [[ -z "$DEPLOY_ENV" || ! -f "$DEPLOY_ENV" ]]; then
  echo "Usage: $0 <candidate-deploy.env>" >&2
  exit 2
fi

api_binding="$(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" port api 3001 | head -1)"
web_binding="$(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" port web 3000 | head -1)"
api_port="${api_binding##*:}"
web_port="${web_binding##*:}"
api="http://127.0.0.1:$api_port"
web="http://127.0.0.1:$web_port"

curl --fail --silent --show-error "$api/health" >/dev/null
curl --fail --silent --show-error "$api/api/v1/marketplace/listings" >/dev/null
curl --fail --silent --show-error "$web/" >/dev/null

auth_body="$(mktemp)"
trap 'rm -f "$auth_body"' EXIT
auth_status="$(curl --silent --output "$auth_body" --write-out '%{http_code}' \
  --request POST "$api/api/v1/auth/login" \
  --header 'content-type: application/json' \
  --data '{"email":"invalid@example.com","password":"invalid-password"}')"
[[ "$auth_status" == "403" ]] || {
  echo "Read-only boundary failed; login response: HTTP $auth_status" >&2
  exit 1
}

echo "Candidate read-only verification passed at API port $api_port and web port $web_port."
