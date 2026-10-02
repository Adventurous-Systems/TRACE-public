#!/usr/bin/env bash
# Black-box tests for run-ops.sh: which release image each operation runs in,
# the exact container command, and the image-identity checks. Docker and the
# release verifier are fakes; nothing is executed.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RUN_OPS="$repo_root/ops/deploy/run-ops.sh"
bash -n "$RUN_OPS"

tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
sha=0123456789abcdef0123456789abcdef01234567
ops_id="sha256:$(printf 'a%.0s' {1..64})"
api_id="sha256:$(printf 'b%.0s' {1..64})"
releases="$tmpdir/releases"
mkdir -p "$releases/$sha"
cat > "$releases/$sha/images.env" <<ENV
TRACE_API_IMAGE=trace-demo-api:$sha
TRACE_API_IMAGE_ID=$api_id
TRACE_OPS_IMAGE=trace-demo-ops:$sha
TRACE_OPS_IMAGE_ID=$ops_id
ENV
deploy_env="$tmpdir/candidate.env"
cat > "$deploy_env" <<ENV
TRACE_RELEASE_SHA=$sha
TRACE_RELEASE_RECEIPT=$releases/$sha/images.env
TRACE_API_ENV_FILE=$tmpdir/api.env
TRACE_RUNTIME_NETWORK=trace-demo-data_default
TRACE_API_IMAGE=trace-demo-api:$sha
TRACE_API_IMAGE_ID=$api_id
TRACE_OPS_IMAGE=trace-demo-ops:$sha
TRACE_OPS_IMAGE_ID=$ops_id
ENV

docker_log="$tmpdir/docker.log"
cat > "$tmpdir/docker" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >> "$TRACE_TEST_DOCKER_LOG"
if [[ "$1" == image && "$2" == inspect ]]; then
  case "$3" in
    trace-demo-ops:*) echo "${TRACE_TEST_OPS_ID:?}" ;;
    trace-demo-api:*) echo "${TRACE_TEST_API_ID:?}" ;;
  esac
fi
FAKE
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$tmpdir/verify-release.sh"
chmod 755 "$tmpdir/docker" "$tmpdir/verify-release.sh"

run_ops() {
  : > "$docker_log"
  env TRACE_DEPLOY_TEST_MODE=1 TRACE_DEPLOY_RELEASE_ROOT="$releases" \
    TRACE_DEPLOY_VERIFY_RELEASE="$tmpdir/verify-release.sh" TRACE_DEPLOY_DOCKER="$tmpdir/docker" \
    TRACE_TEST_DOCKER_LOG="$docker_log" TRACE_TEST_OPS_ID="${ops_id_actual:-$ops_id}" \
    TRACE_TEST_API_ID="$api_id" "$RUN_OPS" "$deploy_env" "$@"
}
fail() { echo "FAIL: $*" >&2; cat "$docker_log" >&2 || true; exit 1; }
run_line() { grep '^run ' "$docker_log" || true; }

# Database operations run the operations image with its node entrypoint:
# no interpreter token may appear before the script.
run_ops migrate
[[ "$(run_line)" == *" trace-demo-ops:$sha dist/scripts/migrate.js" ]] || fail 'migrate command line'
run_ops demo-verify --env demo
[[ "$(run_line)" == *" trace-demo-ops:$sha dist/scripts/demo-restore.js --verify --env demo" ]] \
  || fail 'demo-verify command line'
run_ops demo-correct-catalogue --env demo --dry-run
[[ "$(run_line)" == *" trace-demo-ops:$sha dist/scripts/demo-correct-catalogue.js --env demo --dry-run" ]] \
  || fail 'demo-correct-catalogue command line'
run_ops demo-check-invariants --env demo
[[ "$(run_line)" == *" trace-demo-ops:$sha dist/scripts/check-invariants.js --env demo" ]] \
  || fail 'demo-check-invariants command line'

# Chain operations run the API image, which needs `node` passed explicitly.
run_ops chain-deploy-registry --force
[[ "$(run_line)" == *" trace-demo-api:$sha node dist/scripts/chain-deploy-registry.js --force" ]] \
  || fail 'chain-deploy-registry command line'
grep -q "^image inspect trace-demo-api:$sha " "$docker_log" || fail 'API image identity must be checked'

# An image whose ID differs from the release record never runs.
if ops_id_actual="sha256:$(printf 'c%.0s' {1..64})" run_ops migrate 2>/dev/null; then
  fail 'a mismatched operations image ID must be refused'
fi
[[ -z "$(run_line)" ]] || fail 'nothing may run after an image identity mismatch'

# Unknown operations are refused.
if run_ops rm-rf 2>/dev/null; then fail 'unknown operations must be refused'; fi

echo "run-ops tests passed"
