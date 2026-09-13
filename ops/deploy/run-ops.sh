#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
OPERATION="${2:-}"
shift 2 || true

[[ -f "$DEPLOY_ENV" ]] || { echo "Usage: $0 <candidate-deploy.env> <migrate|seed|seed-products|demo-restore|demo-verify> [args]" >&2; exit 2; }
value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
case "$OPERATION" in
  migrate) script=dist/scripts/migrate.js ;;
  seed) script=dist/scripts/seed.js ;;
  seed-products) script=dist/scripts/seed-products.js ;;
  demo-restore) script=dist/scripts/demo-restore.js ;;
  demo-verify) script=dist/scripts/demo-restore.js; set -- --verify "$@" ;;
  *) echo "Unsupported operation: $OPERATION" >&2; exit 2 ;;
esac

api_env="$(value "$DEPLOY_ENV" TRACE_API_ENV_FILE)"
network="$(value "$DEPLOY_ENV" TRACE_RUNTIME_NETWORK)"
image="$(value "$DEPLOY_ENV" TRACE_OPS_IMAGE)"
[[ "$image" == *@sha256:* ]] || { echo 'Operations image must be pinned by digest' >&2; exit 1; }

exec docker run --rm --init --network "$network" --env-file "$api_env" \
  --read-only --tmpfs /tmp:size=64m,mode=1777 --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 --memory 768m --cpus 1 \
  "$image" "$script" "$@"
