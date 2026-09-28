#!/usr/bin/env bash
# Move the anchor worker from one deployment slot to another.
#
# Only the live slot's worker may consume the shared anchor queue, so the
# worker follows traffic: deploy-main.sh calls this after the post-switch
# public probes pass, and rollback-nginx.sh calls it after a rollback.
#
#   switch-worker.sh <from-deploy.env> <to-deploy.env>
#
# The worker runs only when the target deploy env sets TRACE_ENABLE_WORKER=1
# (the Compose `worker` profile in compose.app.yml). It is started before the
# old one is stopped; a brief overlap is safe because each anchor job is
# locked to one worker and the registry rejects duplicate registrations.
# Idempotent: running it again with the same arguments changes nothing.
set -euo pipefail

FROM_ENV="${1:-}"
TO_ENV="${2:-}"
CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:-/var/lib/trace-demo/config}"
COMPOSE_FILE="${TRACE_DEPLOY_COMPOSE_FILE:-$CONFIG_DIR/compose.app.yml}"
DOCKER_BIN="${TRACE_DEPLOY_DOCKER:-docker}"
WAIT_SLEEP="${TRACE_DEPLOY_WORKER_WAIT_SLEEP:-5}"

if [[ -z "$FROM_ENV" || -z "$TO_ENV" || ! -f "$FROM_ENV" || ! -f "$TO_ENV" ]]; then
  echo "Usage: $0 <from-deploy.env> <to-deploy.env>" >&2
  exit 2
fi
for env_file in "$FROM_ENV" "$TO_ENV"; do
  [[ "$(stat -c '%u:%a' "$env_file")" == 0:600 ]] \
    || { echo "Deployment environment must be root-owned mode 600: $env_file" >&2; exit 1; }
done

value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
compose() {
  local env_file="$1"
  shift
  "$DOCKER_BIN" compose --env-file "$env_file" -f "$COMPOSE_FILE" --profile worker "$@"
}

from_real="$(readlink -f "$FROM_ENV")"
to_real="$(readlink -f "$TO_ENV")"

if [[ "$(value "$TO_ENV" TRACE_ENABLE_WORKER)" == 1 ]]; then
  compose "$TO_ENV" up -d --no-build --pull never worker
  for attempt in $(seq 1 12); do
    state="$(compose "$TO_ENV" ps worker --format '{{.State}}' || true)"
    [[ "$state" == running ]] && break
    if [[ "$attempt" == 12 ]]; then
      compose "$TO_ENV" logs --tail 50 worker || true
      echo "Anchor worker for $(value "$TO_ENV" COMPOSE_PROJECT_NAME) is not running (state: ${state:-none})" >&2
      exit 1
    fi
    sleep "$WAIT_SLEEP"
  done
  echo "Anchor worker running in $(value "$TO_ENV" COMPOSE_PROJECT_NAME)."
else
  # Worker disabled for the target slot: make sure none is left running there.
  compose "$TO_ENV" rm --stop --force worker >/dev/null
  echo "Anchor worker disabled for $(value "$TO_ENV" COMPOSE_PROJECT_NAME)."
fi

if [[ "$from_real" != "$to_real" \
  && "$(value "$FROM_ENV" COMPOSE_PROJECT_NAME)" != "$(value "$TO_ENV" COMPOSE_PROJECT_NAME)" ]]; then
  compose "$FROM_ENV" rm --stop --force worker >/dev/null
  echo "Anchor worker stopped in $(value "$FROM_ENV" COMPOSE_PROJECT_NAME)."
fi
