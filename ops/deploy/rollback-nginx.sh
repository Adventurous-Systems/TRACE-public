#!/usr/bin/env bash
set -euo pipefail

ACTIVE_LINK="${1:-}"
STATE_DIR="${TRACE_DEPLOY_STATE_DIR:-/var/lib/trace-deploy}"
STATE_FILE="$STATE_DIR/$(basename "$ACTIVE_LINK").previous"

if [[ -z "$ACTIVE_LINK" || ! -f "$STATE_FILE" ]]; then
  echo "Usage: $0 <active-upstream-symlink>" >&2
  exit 2
fi

previous="$(cat "$STATE_FILE")"
current="$(readlink -f "$ACTIVE_LINK")"
[[ -f "$previous" ]] || { echo "Recorded previous upstream is missing: $previous" >&2; exit 1; }
[[ -f "$current" ]] || { echo "Current upstream link is invalid" >&2; exit 1; }

temporary="${ACTIVE_LINK}.rollback"
ln -sfn "$previous" "$temporary"
mv -Tf "$temporary" "$ACTIVE_LINK"

if ! nginx -t; then
  ln -sfn "$current" "$temporary"
  mv -Tf "$temporary" "$ACTIVE_LINK"
  nginx -t
  echo "Recorded rollback configuration is invalid; current upstream was restored." >&2
  exit 1
fi

nginx -s reload
echo "Nginx rolled back to $previous"
