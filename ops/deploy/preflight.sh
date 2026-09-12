#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/compose.app.yml"

if [[ -z "$DEPLOY_ENV" || ! -f "$DEPLOY_ENV" ]]; then
  echo "Usage: $0 <candidate-deploy.env>" >&2
  exit 2
fi

for command in docker curl ss; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done

docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" config --quiet
runtime_env="$(awk -F= '$1 == "TRACE_ENV_FILE" {print substr($0, index($0, "=") + 1)}' "$DEPLOY_ENV" | tail -1)"
runtime_network="$(awk -F= '$1 == "TRACE_RUNTIME_NETWORK" {print substr($0, index($0, "=") + 1)}' "$DEPLOY_ENV" | tail -1)"

[[ -n "$runtime_env" && -f "$runtime_env" ]] || { echo "Runtime environment file is missing" >&2; exit 1; }
[[ "$(stat -c '%a' "$runtime_env")" == "600" ]] || { echo "Runtime environment file must have mode 600" >&2; exit 1; }
docker network inspect "$runtime_network" >/dev/null

while IFS= read -r image; do
  docker image inspect "$image" >/dev/null || { echo "Image is not present: $image" >&2; exit 1; }
  [[ "$image" == *@sha256:* ]] || { echo "Image is not pinned by digest: $image" >&2; exit 1; }
done < <(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" config --images | sort -u)

for key in TRACE_API_HOST_PORT TRACE_WEB_HOST_PORT; do
  port="$(awk -F= -v key="$key" '$1 == key {print $2}' "$DEPLOY_ENV" | tail -1)"
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "$key must be a numeric port" >&2; exit 1; }
  if ss -H -ltn "sport = :$port" | grep -q .; then
    echo "Candidate port is already in use: $port" >&2
    exit 1
  fi
done

echo "Candidate preflight passed. No services were changed."
