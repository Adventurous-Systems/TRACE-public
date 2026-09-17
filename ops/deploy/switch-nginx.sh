#!/usr/bin/env bash
set -euo pipefail

ACTIVE_LINK="${1:-}"
CANDIDATE="${2:-}"
ACTIVE_ENV_LINK="${3:-}"
CANDIDATE_ENV="${4:-}"
STATE_DIR="${TRACE_DEPLOY_STATE_DIR:-/var/lib/trace-demo/state}"
LOCK_FILE="${TRACE_DEPLOY_LOCK_FILE:-/run/lock/trace-public-demo-deploy.lock}"

if [[ -z "$ACTIVE_LINK" || -z "$CANDIDATE" || -z "$ACTIVE_ENV_LINK" || -z "$CANDIDATE_ENV" || ! -f "$CANDIDATE" || ! -f "$CANDIDATE_ENV" ]]; then
  echo "Usage: $0 <active-upstream-symlink> <candidate-upstream-file> <active-env-symlink> <candidate-env-file>" >&2
  exit 2
fi
[[ "$(stat -c '%u:%a' "$CANDIDATE_ENV")" == 0:600 ]] || { echo "Candidate environment must be root-owned mode 600" >&2; exit 1; }
previous_upstream="$(readlink -f "$ACTIVE_LINK")"
previous_env="$(readlink -f "$ACTIVE_ENV_LINK")"
[[ -f "$previous_upstream" && -f "$previous_env" ]] || { echo "Active deployment links are invalid" >&2; exit 1; }

install -d -m 700 "$STATE_DIR"
# TRACE_DEPLOY_LOCK_HELD=1 means a caller (deploy-main.sh) already holds this
# same lock for the duration of its own run. Re-acquiring it here would be a
# guaranteed self-conflict: flock's exclusivity is per open file description,
# not per process tree, so a fresh exec+flock in this script never observes
# an ancestor's already-held lock on the same file as "ours" — it just fails.
# Run standalone (a human invoking this directly, e.g. for a manual switch or
# the documented rollback procedure), the variable is unset and this script
# takes the lock itself, exactly as before.
if [[ "${TRACE_DEPLOY_LOCK_HELD:-0}" != 1 ]]; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "Another TRACE public-demo deployment is running" >&2; exit 1; }
fi
upstream_state="$STATE_DIR/$(basename "$ACTIVE_LINK").previous"
env_state="$STATE_DIR/$(basename "$ACTIVE_ENV_LINK").previous"
printf '%s\n' "$previous_upstream" > "$upstream_state"
printf '%s\n' "$previous_env" > "$env_state"
chmod 600 "$upstream_state" "$env_state"

switch_link() {
  local link="$1" target="$2" suffix="$3"
  local temporary="${link}.${suffix}"
  ln -sfn "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}
restore_previous() {
  switch_link "$ACTIVE_LINK" "$previous_upstream" restore
  switch_link "$ACTIVE_ENV_LINK" "$previous_env" restore
}

switch_link "$ACTIVE_LINK" "$CANDIDATE" new
switch_link "$ACTIVE_ENV_LINK" "$CANDIDATE_ENV" new
if ! nginx -t; then
  restore_previous
  nginx -t
  echo "Candidate nginx configuration was rejected; the previous deployment pair was restored." >&2
  exit 1
fi
if ! nginx -s reload; then
  restore_previous
  nginx -t
  nginx -s reload || true
  echo "Nginx reload failed; the previous deployment pair was restored." >&2
  exit 1
fi
echo "Nginx now uses $CANDIDATE and $CANDIDATE_ENV."
