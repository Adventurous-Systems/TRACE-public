#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:-/var/lib/trace-demo/config}"
COMPOSE_FILE="${TRACE_DEPLOY_COMPOSE_FILE:-$CONFIG_DIR/compose.app.yml}"

"${TRACE_DEPLOY_PREFLIGHT:-/usr/local/libexec/trace-demo/preflight.sh}" "$DEPLOY_ENV"
docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" up -d --no-build --pull never api web

for attempt in $(seq 1 36); do
  api_health="$(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" ps api --format json | grep -o '"Health":"[^"]*"' || true)"
  web_health="$(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" ps web --format json | grep -o '"Health":"[^"]*"' || true)"
  echo "attempt $attempt: api=${api_health:-unknown} web=${web_health:-unknown}"
  if [[ "$api_health" == '"Health":"healthy"' && "$web_health" == '"Health":"healthy"' ]]; then
    echo "Candidate containers are healthy. The active nginx route was not changed."
    exit 0
  fi
  sleep 5
done

docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" logs --tail 100 api web
echo "Candidate did not become healthy; nginx was not changed." >&2
exit 1
