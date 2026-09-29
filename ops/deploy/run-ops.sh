#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${1:-}"
OPERATION="${2:-}"
shift 2 || true

[[ -f "$DEPLOY_ENV" ]] || { echo "Usage: $0 <candidate-deploy.env> <migrate|seed|seed-products|demo-restore|demo-verify|demo-replenish|demo-trim-active|demo-correct-catalogue|chain-deploy-registry> [args]" >&2; exit 2; }
value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
# Host paths are fixed; test-run-ops.sh may override them only as a non-root
# user (the same guard deploy-main.sh uses), never in the installed root path.
RELEASE_ROOT='/opt/trace-public-demo/releases'
release_verifier='/usr/local/libexec/trace-demo/verify-release.sh'
DOCKER_BIN=docker
if [[ "${TRACE_DEPLOY_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  RELEASE_ROOT="${TRACE_DEPLOY_RELEASE_ROOT:?required in test mode}"
  release_verifier="${TRACE_DEPLOY_VERIFY_RELEASE:?required in test mode}"
  DOCKER_BIN="${TRACE_DEPLOY_DOCKER:?required in test mode}"
fi
# Database operations run in the release's operations image. Chain operations
# need the chain SDK, which only the API image carries; its entrypoint is not
# `node`, so the interpreter is passed explicitly.
image_kind=OPS
interpreter=()
case "$OPERATION" in
  migrate) script=dist/scripts/migrate.js ;;
  seed) script=dist/scripts/seed.js ;;
  seed-products) script=dist/scripts/seed-products.js ;;
  demo-restore) script=dist/scripts/demo-restore.js ;;
  demo-verify) script=dist/scripts/demo-restore.js; set -- --verify "$@" ;;
  demo-replenish) script=dist/scripts/demo-replenish.js ;;
  demo-trim-active) script=dist/scripts/demo-trim-active.js ;;
  demo-correct-catalogue) script=dist/scripts/demo-correct-catalogue.js ;;
  chain-deploy-registry) script=dist/scripts/chain-deploy-registry.js; image_kind=API; interpreter=(node) ;;
  *) echo "Unsupported operation: $OPERATION" >&2; exit 2 ;;
esac

api_env="$(value "$DEPLOY_ENV" TRACE_API_ENV_FILE)"
network="$(value "$DEPLOY_ENV" TRACE_RUNTIME_NETWORK)"
image="$(value "$DEPLOY_ENV" "TRACE_${image_kind}_IMAGE")"
release_sha="$(value "$DEPLOY_ENV" TRACE_RELEASE_SHA)"
release_receipt="$(value "$DEPLOY_ENV" TRACE_RELEASE_RECEIPT)"
expected_id="$(value "$DEPLOY_ENV" "TRACE_${image_kind}_IMAGE_ID")"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Release SHA is invalid' >&2; exit 1; }
[[ "$release_receipt" == "$RELEASE_ROOT/$release_sha/images.env" ]] \
  || { echo 'Release receipt path is invalid' >&2; exit 1; }
[[ -x "$release_verifier" ]] || { echo 'Trusted release verifier is missing' >&2; exit 1; }
"$release_verifier" "$release_sha"
image_name="trace-demo-$(tr '[:upper:]' '[:lower:]' <<<"$image_kind")"
[[ "$image" == "$image_name:$release_sha" ]] || { echo 'Operations image tag does not match the release SHA' >&2; exit 1; }
[[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Operations image ID is invalid' >&2; exit 1; }
[[ "$(value "$release_receipt" "TRACE_${image_kind}_IMAGE")" == "$image" ]] \
  || { echo 'Operations image tag does not match the immutable release receipt' >&2; exit 1; }
[[ "$(value "$release_receipt" "TRACE_${image_kind}_IMAGE_ID")" == "$expected_id" ]] \
  || { echo 'Operations image ID does not match the immutable release receipt' >&2; exit 1; }
[[ "$("$DOCKER_BIN" image inspect "$image" --format '{{.Id}}')" == "$expected_id" ]] \
  || { echo 'Operations image ID does not match the trusted release record' >&2; exit 1; }

exec "$DOCKER_BIN" run --rm --init --network "$network" --env-file "$api_env" \
  --read-only --tmpfs /tmp:size=64m,mode=1777 --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 --memory 768m --cpus 1 \
  "$image" "${interpreter[@]}" "$script" "$@"
