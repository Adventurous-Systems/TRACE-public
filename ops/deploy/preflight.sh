#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:-/etc/trace-demo}"
COMPOSE_FILE="${TRACE_DEPLOY_COMPOSE_FILE:-$CONFIG_DIR/compose.app.yml}"

fail() { echo "Preflight failed: $*" >&2; exit 1; }
value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
secure_file() {
  local path="$1" label="$2"
  [[ -f "$path" ]] || fail "$label file is missing: $path"
  [[ "$(stat -c '%a' "$path")" == "600" ]] || fail "$label must have mode 600"
  [[ "$(stat -c '%u' "$path")" == "0" ]] || fail "$label must be owned by root"
}

[[ -n "$DEPLOY_ENV" && -f "$DEPLOY_ENV" ]] || { echo "Usage: $0 <candidate-deploy.env>" >&2; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || fail "trusted Compose file is missing: $COMPOSE_FILE"
for command in awk curl df docker grep ss stat; do
  command -v "$command" >/dev/null || fail "missing command: $command"
done

secure_file "$DEPLOY_ENV" 'candidate environment'
api_env="$(value "$DEPLOY_ENV" TRACE_API_ENV_FILE)"
web_env="$(value "$DEPLOY_ENV" TRACE_WEB_ENV_FILE)"
runtime_network="$(value "$DEPLOY_ENV" TRACE_RUNTIME_NETWORK)"
release_sha="$(value "$DEPLOY_ENV" TRACE_RELEASE_SHA)"
ops_image="$(value "$DEPLOY_ENV" TRACE_OPS_IMAGE)"
secure_file "$api_env" 'API environment'
secure_file "$web_env" 'web environment'
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'TRACE_RELEASE_SHA must be a full lowercase commit SHA'
[[ "$(value "$api_env" TRACE_ENV)" == 'demo' ]] || fail 'API TRACE_ENV must be demo'
[[ "$(value "$api_env" TRACE_DEPLOYMENT_PROFILE)" == 'public_showcase' ]] || fail 'API profile must be public_showcase'
[[ "$(value "$web_env" TRACE_DEPLOYMENT_PROFILE)" == 'public_showcase' ]] || fail 'web profile must be public_showcase'

docker network inspect "$runtime_network" >/dev/null 2>&1 || fail "runtime network is missing: $runtime_network"
docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" config --quiet

while IFS='=' read -r key _; do
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  case "$key" in
    NODE_ENV|TRACE_DEPLOYMENT_PROFILE|UMAMI_ENABLED|UMAMI_WEBSITE_ID|PORT|HOSTNAME) ;;
    *) fail "web environment contains a non-public key: $key" ;;
  esac
done < "$web_env"

images="$(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE" config --images)"$'\n'"$ops_image"
while IFS= read -r image; do
  [[ -n "$image" ]] || continue
  [[ "$image" == *@sha256:* ]] || fail "image is not pinned by digest: $image"
  docker image inspect "$image" >/dev/null 2>&1 || fail "image is not present: $image"
  revision="$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$revision" == "$release_sha" ]] || fail "image revision mismatch for $image"
done < <(printf '%s\n' "$images" | sort -u)

for key in TRACE_API_HOST_PORT TRACE_WEB_HOST_PORT; do
  port="$(value "$DEPLOY_ENV" "$key")"
  [[ "$port" =~ ^[0-9]+$ ]] || fail "$key must be a numeric port"
  if ss -H -ltn "sport = :$port" | grep -q .; then
    fail "candidate port is already in use: $port"
  fi
done

free_kb="$(df -Pk /var/lib/docker | awk 'NR == 2 {print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ && "$free_kb" -ge 8388608 ]] || fail 'Docker storage has less than 8 GiB free'

echo 'Candidate preflight passed. No services were changed.'
