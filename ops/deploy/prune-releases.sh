#!/usr/bin/env bash
set -euo pipefail

# Removes old immutable source releases and their images once they are no
# longer needed, so unattended deployment does not grow
# /opt/trace-public-demo/releases without bound. Always keeps: the release
# `active.env` currently points at, every release any `*.env.previous`
# rollback pointer refers to, every release a running container is using, and
# the two most recently prepared releases regardless of the above.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

if [[ "${TRACE_DEPLOY_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:?TRACE_DEPLOY_CONFIG_DIR is required in test mode}"
  STATE_DIR="${TRACE_DEPLOY_STATE_DIR:?TRACE_DEPLOY_STATE_DIR is required in test mode}"
  RELEASE_ROOT="${TRACE_DEPLOY_RELEASE_ROOT:?TRACE_DEPLOY_RELEASE_ROOT is required in test mode}"
  DOCKER_BIN="${TRACE_DEPLOY_DOCKER:-docker}"
  KEEP_RECENT="${TRACE_DEPLOY_PRUNE_KEEP_RECENT:-2}"
else
  [[ "$EUID" == 0 ]] || { echo 'This installed prune command must run as root.' >&2; exit 1; }
  PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  export PATH
  unset TRACE_DEPLOY_TEST_MODE TRACE_DEPLOY_CONFIG_DIR TRACE_DEPLOY_STATE_DIR TRACE_DEPLOY_RELEASE_ROOT
  CONFIG_DIR='/var/lib/trace-demo/config'
  STATE_DIR='/var/lib/trace-demo/state'
  RELEASE_ROOT='/opt/trace-public-demo/releases'
  DOCKER_BIN='docker'
  KEEP_RECENT=2
fi
readonly CONFIG_DIR STATE_DIR RELEASE_ROOT DOCKER_BIN KEEP_RECENT
readonly SHA_RE='^[0-9a-f]{40}$'

[[ "$#" == 0 ]] || { echo "Usage: $0" >&2; exit 2; }

value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }

[[ -d "$RELEASE_ROOT" ]] || exit 0

declare -A protected=()

if [[ -e "$CONFIG_DIR/active.env" ]]; then
  active_env_file="$(readlink -f -- "$CONFIG_DIR/active.env" 2>/dev/null || true)"
  if [[ -n "$active_env_file" && -f "$active_env_file" ]]; then
    active_sha="$(value "$active_env_file" TRACE_RELEASE_SHA)"
    [[ "$active_sha" =~ $SHA_RE ]] && protected["$active_sha"]=1
  fi
fi

if [[ -d "$STATE_DIR" ]]; then
  while IFS= read -r -d '' previous_file; do
    previous_env_file="$(cat "$previous_file" 2>/dev/null || true)"
    [[ -n "$previous_env_file" && -f "$previous_env_file" ]] || continue
    previous_sha="$(value "$previous_env_file" TRACE_RELEASE_SHA)"
    [[ "$previous_sha" =~ $SHA_RE ]] && protected["$previous_sha"]=1
  done < <(find "$STATE_DIR" -maxdepth 1 -name '*.env.previous' -print0 2>/dev/null)
fi

while IFS= read -r running_sha; do
  [[ "$running_sha" =~ $SHA_RE ]] && protected["$running_sha"]=1
done < <("$DOCKER_BIN" ps --filter 'label=com.docker.compose.project' --format '{{.Image}}' 2>/dev/null \
  | sed -n 's/^trace-demo-\(api\|web\|ops\):\([0-9a-f]\{40\}\)$/\2/p')

mapfile -t releases_by_age < <(
  find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null \
    | awk '$2 ~ /^[0-9a-f]{40}$/' | sort -rn | awk '{print $2}'
)

kept_recent=0
for sha in "${releases_by_age[@]}"; do
  [[ "$kept_recent" -lt "$KEEP_RECENT" ]] || break
  protected["$sha"]=1
  kept_recent=$((kept_recent + 1))
done

removed=0
for sha in "${releases_by_age[@]}"; do
  [[ "$sha" =~ $SHA_RE ]] || continue
  [[ -n "${protected[$sha]:-}" ]] && continue
  release_dir="$RELEASE_ROOT/$sha"
  chmod -R u+w "$release_dir" 2>/dev/null || true
  rm -rf -- "$release_dir"
  for component in api web ops; do
    "$DOCKER_BIN" image rm "trace-demo-$component:$sha" >/dev/null 2>&1 || true
  done
  removed=$((removed + 1))
  echo "Pruned release: $sha"
done

"$DOCKER_BIN" image prune -f >/dev/null 2>&1 || true
echo "Pruned $removed release(s); kept ${#protected[@]} protected release(s)."
