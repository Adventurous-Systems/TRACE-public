#!/usr/bin/env bash
set -euo pipefail

ACTIVE_LINK="${1:-}"
ACTIVE_ENV_LINK="${2:-}"
STATE_DIR="${TRACE_DEPLOY_STATE_DIR:-/var/lib/trace-demo/state}"
LOCK_FILE="${TRACE_DEPLOY_LOCK_FILE:-/run/lock/trace-public-demo-deploy.lock}"

upstream_state="$STATE_DIR/$(basename "$ACTIVE_LINK").previous"
env_state="$STATE_DIR/$(basename "$ACTIVE_ENV_LINK").previous"
if [[ -z "$ACTIVE_LINK" || -z "$ACTIVE_ENV_LINK" || ! -f "$upstream_state" || ! -f "$env_state" ]]; then
  echo "Usage: $0 <active-upstream-symlink> <active-env-symlink>" >&2
  exit 2
fi
previous_upstream="$(cat "$upstream_state")"
previous_env="$(cat "$env_state")"
current_upstream="$(readlink -f "$ACTIVE_LINK")"
current_env="$(readlink -f "$ACTIVE_ENV_LINK")"
[[ -f "$previous_upstream" && -f "$previous_env" && -f "$current_upstream" && -f "$current_env" ]] || { echo "Rollback deployment pair is invalid" >&2; exit 1; }

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another TRACE public-demo deployment is running" >&2; exit 1; }
switch_link() {
  local link="$1" target="$2" suffix="$3"
  local temporary="${link}.${suffix}"
  ln -sfn "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}
restore_current() {
  switch_link "$ACTIVE_LINK" "$current_upstream" current
  switch_link "$ACTIVE_ENV_LINK" "$current_env" current
}

switch_link "$ACTIVE_LINK" "$previous_upstream" rollback
switch_link "$ACTIVE_ENV_LINK" "$previous_env" rollback
if ! nginx -t; then
  restore_current
  nginx -t
  echo "Recorded rollback configuration is invalid; current deployment pair was restored." >&2
  exit 1
fi
if ! nginx -s reload; then
  restore_current
  nginx -t
  nginx -s reload || true
  echo "Nginx rollback reload failed; current deployment pair was restored." >&2
  exit 1
fi
echo "Nginx and active environment rolled back."
