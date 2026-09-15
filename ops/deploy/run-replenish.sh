#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:-/var/lib/trace-demo/config}"
ENV_LINK="${1:-$CONFIG_DIR/active.env}"
LOCK_FILE="${TRACE_DEPLOY_LOCK_FILE:-/run/lock/trace-public-demo-deploy.lock}"

[[ -e "$ENV_LINK" ]] || { echo "Active deployment environment is missing: $ENV_LINK" >&2; exit 1; }
exec 9>"$LOCK_FILE"
flock -w 300 9 || { echo 'Timed out waiting for TRACE public-demo deployment lock' >&2; exit 1; }
ENV_FILE="$(readlink -f -- "$ENV_LINK")"
[[ -f "$ENV_FILE" ]] || { echo "Active deployment environment is not a regular file: $ENV_LINK" >&2; exit 1; }
[[ "$(stat -c '%u:%a' "$ENV_FILE")" == 0:600 ]] || { echo 'Active deployment environment must be root-owned mode 600' >&2; exit 1; }

exec "$SCRIPT_DIR/run-ops.sh" "$ENV_FILE" demo-replenish --env demo --target-active 1 --yes
