#!/usr/bin/env bash
set -euo pipefail

ACTIVE_LINK="${1:-}"
CANDIDATE="${2:-}"
STATE_DIR="${TRACE_DEPLOY_STATE_DIR:-/var/lib/trace-deploy}"

if [[ -z "$ACTIVE_LINK" || -z "$CANDIDATE" || ! -f "$CANDIDATE" ]]; then
  echo "Usage: $0 <active-upstream-symlink> <candidate-upstream-file>" >&2
  exit 2
fi

previous="$(readlink -f "$ACTIVE_LINK")"
[[ -n "$previous" && -f "$previous" ]] || { echo "Active upstream link is invalid" >&2; exit 1; }

install -d -m 700 "$STATE_DIR"
state_file="$STATE_DIR/$(basename "$ACTIVE_LINK").previous"
printf '%s\n' "$previous" > "$state_file"
chmod 600 "$state_file"

temporary="${ACTIVE_LINK}.new"
ln -sfn "$CANDIDATE" "$temporary"
mv -Tf "$temporary" "$ACTIVE_LINK"

if ! nginx -t; then
  ln -sfn "$previous" "$temporary"
  mv -Tf "$temporary" "$ACTIVE_LINK"
  nginx -t
  echo "Candidate nginx configuration was rejected; the previous upstream was restored." >&2
  exit 1
fi

if ! nginx -s reload; then
  ln -sfn "$previous" "$temporary"
  mv -Tf "$temporary" "$ACTIVE_LINK"
  nginx -t
  nginx -s reload || true
  echo "Nginx reload failed; the previous upstream link was restored." >&2
  exit 1
fi

echo "Nginx now uses $CANDIDATE. Previous upstream: $previous"
