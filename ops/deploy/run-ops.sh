#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
OPERATION="${2:-}"
shift 2 || true

[[ -f "$DEPLOY_ENV" ]] || { echo "Usage: $0 <candidate-deploy.env> <migrate|seed|seed-products|demo-restore|demo-verify|demo-replenish|demo-trim-active> [args]" >&2; exit 2; }
value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
case "$OPERATION" in
  migrate) script=dist/scripts/migrate.js ;;
  seed) script=dist/scripts/seed.js ;;
  seed-products) script=dist/scripts/seed-products.js ;;
  demo-restore) script=dist/scripts/demo-restore.js ;;
  demo-verify) script=dist/scripts/demo-restore.js; set -- --verify "$@" ;;
  demo-replenish) script=dist/scripts/demo-replenish.js ;;
  demo-trim-active) script=dist/scripts/demo-trim-active.js ;;
  *) echo "Unsupported operation: $OPERATION" >&2; exit 2 ;;
esac

api_env="$(value "$DEPLOY_ENV" TRACE_API_ENV_FILE)"
network="$(value "$DEPLOY_ENV" TRACE_RUNTIME_NETWORK)"
image="$(value "$DEPLOY_ENV" TRACE_OPS_IMAGE)"
release_sha="$(value "$DEPLOY_ENV" TRACE_RELEASE_SHA)"
release_receipt="$(value "$DEPLOY_ENV" TRACE_RELEASE_RECEIPT)"
expected_id="$(value "$DEPLOY_ENV" TRACE_OPS_IMAGE_ID)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Release SHA is invalid' >&2; exit 1; }
[[ "$release_receipt" == "/opt/trace-public-demo/releases/$release_sha/images.env" ]] \
  || { echo 'Release receipt path is invalid' >&2; exit 1; }
release_verifier='/usr/local/libexec/trace-demo/verify-release.sh'
[[ -x "$release_verifier" ]] || { echo 'Trusted release verifier is missing' >&2; exit 1; }
"$release_verifier" "$release_sha"
[[ "$image" == "trace-demo-ops:$release_sha" ]] || { echo 'Operations image tag does not match the release SHA' >&2; exit 1; }
[[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Operations image ID is invalid' >&2; exit 1; }
[[ "$(value "$release_receipt" TRACE_OPS_IMAGE)" == "$image" ]] \
  || { echo 'Operations image tag does not match the immutable release receipt' >&2; exit 1; }
[[ "$(value "$release_receipt" TRACE_OPS_IMAGE_ID)" == "$expected_id" ]] \
  || { echo 'Operations image ID does not match the immutable release receipt' >&2; exit 1; }
[[ "$(docker image inspect "$image" --format '{{.Id}}')" == "$expected_id" ]] \
  || { echo 'Operations image ID does not match the trusted release record' >&2; exit 1; }

exec docker run --rm --init --network "$network" --env-file "$api_env" \
  --read-only --tmpfs /tmp:size=64m,mode=1777 --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 --memory 768m --cpus 1 \
  "$image" "$script" "$@"
