#!/usr/bin/env bash
# Black-box tests for the auto-deploy orchestrator: exercises the real script
# against a local Git fixture (for the main-tip resolution and relevance
# diff) and fake stand-ins for every other installed primitive it calls, in
# the same style as test-deployment-state.sh.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEPLOY="$repo_root/ops/deploy/deploy-main.sh"
bash -n "$DEPLOY"

pass_count=0
fail_message() { echo "FAIL: $*" >&2; exit 1; }
expect_success() {
  local description="$1"
  shift
  if "$@" >/tmp/test-deploy-main.out 2>&1; then
    pass_count=$((pass_count + 1))
  else
    cat /tmp/test-deploy-main.out >&2
    fail_message "$description (expected success, got failure)"
  fi
}
expect_failure() {
  local description="$1"
  shift
  if "$@" >/tmp/test-deploy-main.out 2>&1; then
    cat /tmp/test-deploy-main.out >&2
    fail_message "$description (expected failure, got success)"
  else
    pass_count=$((pass_count + 1))
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
TRACE_TEST_ENV_EXTRA=()

# --- Git fixture: a local "public repository" with a linear history -------
origin="$tmpdir/origin.git"
work="$tmpdir/work"
git init --quiet --bare "$origin"
git init --quiet --initial-branch=main "$work"
git -C "$work" config user.email test@example.com
git -C "$work" config user.name Test
git -C "$work" remote add origin "$origin"

commit() {
  local message="$1"
  shift
  for spec in "$@"; do
    local path="${spec%%=*}" content="${spec#*=}"
    mkdir -p "$work/$(dirname "$path")"
    printf '%s\n' "$content" > "$work/$path"
    git -C "$work" add "$path"
  done
  git -C "$work" commit --quiet -m "$message"
  git -C "$work" rev-parse HEAD
}
push_main() { git -C "$work" push --quiet origin main; }

baseline_sha="$(commit 'baseline' 'package.json={}' 'README.md=hello')"
push_main

# --- Fake installed primitives ---------------------------------------------
fake_bin="$tmpdir/bin"
calls_log="$tmpdir/calls.log"
mkdir -p "$fake_bin"
: > "$calls_log"

release_root="$tmpdir/releases"
mkdir -p "$release_root"

write_fake() {
  local path="$1"
  shift
  printf '%s\n' "$@" > "$path"
  chmod 755 "$path"
}

write_fake "$fake_bin/flock" '#!/usr/bin/env bash' 'exit 0'

write_fake "$fake_bin/prepare-release.sh" \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'echo "prepare-release $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'sha="$1"' \
  'dir="$TRACE_TEST_RELEASE_ROOT/$sha"' \
  'mkdir -p "$dir"' \
  '{' \
  '  printf "TRACE_RELEASE_SHA=%s\n" "$sha"' \
  '  printf "TRACE_API_IMAGE=trace-demo-api:%s\n" "$sha"' \
  '  printf "TRACE_API_IMAGE_ID=sha256:%040d\n" 1' \
  '  printf "TRACE_WEB_IMAGE=trace-demo-web:%s\n" "$sha"' \
  '  printf "TRACE_WEB_IMAGE_ID=sha256:%040d\n" 2' \
  '  printf "TRACE_OPS_IMAGE=trace-demo-ops:%s\n" "$sha"' \
  '  printf "TRACE_OPS_IMAGE_ID=sha256:%040d\n" 3' \
  '} > "$dir/images.env"'

write_fake "$fake_bin/verify-release.sh" \
  '#!/usr/bin/env bash' \
  'echo "verify-release $*" >> "$TRACE_TEST_CALLS_LOG"'

write_fake "$fake_bin/preflight.sh" \
  '#!/usr/bin/env bash' \
  'echo "preflight $*" >> "$TRACE_TEST_CALLS_LOG"'

write_fake "$fake_bin/run-ops.sh" \
  '#!/usr/bin/env bash' \
  'echo "run-ops $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'op="$2"' \
  'if [[ "$op" == demo-verify && "${TRACE_TEST_DEMO_VERIFY_FAIL:-0}" == 1 ]]; then exit 1; fi' \
  'exit 0'

write_fake "$fake_bin/start-candidate.sh" \
  '#!/usr/bin/env bash' \
  'echo "start-candidate $*" >> "$TRACE_TEST_CALLS_LOG"'

write_fake "$fake_bin/verify-candidate.sh" \
  '#!/usr/bin/env bash' \
  'echo "verify-candidate $*" >> "$TRACE_TEST_CALLS_LOG"'

write_fake "$fake_bin/switch-nginx.sh" \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'echo "switch-nginx $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'active_conf="$1"; candidate_conf="$2"; active_env="$3"; candidate_env="$4"' \
  'state_dir="$TRACE_TEST_STATE_DIR"' \
  'mkdir -p "$state_dir"' \
  'readlink -f "$active_conf" > "$state_dir/$(basename "$active_conf").previous"' \
  'readlink -f "$active_env" > "$state_dir/$(basename "$active_env").previous"' \
  'ln -sfn "$candidate_conf" "$active_conf"' \
  'ln -sfn "$candidate_env" "$active_env"'

write_fake "$fake_bin/rollback-nginx.sh" \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'echo "rollback-nginx $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'active_conf="$1"; active_env="$2"' \
  'state_dir="$TRACE_TEST_STATE_DIR"' \
  'ln -sfn "$(cat "$state_dir/$(basename "$active_conf").previous")" "$active_conf"' \
  'ln -sfn "$(cat "$state_dir/$(basename "$active_env").previous")" "$active_env"'

write_fake "$fake_bin/prune-releases.sh" \
  '#!/usr/bin/env bash' \
  'echo "prune-releases $*" >> "$TRACE_TEST_CALLS_LOG"'

write_fake "$fake_bin/docker" \
  '#!/usr/bin/env bash' \
  'echo "docker $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'case "$1" in' \
  '  ps) exit 0 ;;' \
  '  rm) exit 0 ;;' \
  '  image) exit 0 ;;' \
  '  *) exit 0 ;;' \
  'esac'

write_fake "$fake_bin/curl" \
  '#!/usr/bin/env bash' \
  'echo "curl $*" >> "$TRACE_TEST_CALLS_LOG"' \
  'if [[ "${TRACE_TEST_PUBLIC_PROBE_FAIL:-0}" == 1 ]]; then exit 1; fi' \
  'exit 0'

# --- Config/state fixture ---------------------------------------------------
setup_config() {
  local config_dir="$1" active_slot="$2" active_sha="$3"
  rm -rf "$config_dir"
  mkdir -p "$config_dir/nginx"
  cat > "$config_dir/$active_slot-$active_sha.env" <<ENV
COMPOSE_PROJECT_NAME=trace-demo-$active_slot
TRACE_RELEASE_SHA=$active_sha
TRACE_RUNTIME_NETWORK=trace-demo-data_default
TRACE_API_ENV_FILE=$tmpdir/secrets/api.env
TRACE_WEB_ENV_FILE=$tmpdir/secrets/web.env
ENV
  ln -sfn "$config_dir/$active_slot-$active_sha.env" "$config_dir/active.env"
  printf 'active upstream: %s\n' "$active_slot" > "$config_dir/nginx/$active_slot.conf"
  printf 'candidate upstream: %s\n' "$([[ "$active_slot" == blue ]] && echo green || echo blue)" \
    > "$config_dir/nginx/$([[ "$active_slot" == blue ]] && echo green || echo blue).conf"
  ln -sfn "$config_dir/nginx/$active_slot.conf" "$config_dir/nginx/active.conf"
}

run_deploy() {
  local config_dir="$1" state_dir="$2"
  shift 2
  env -i \
    PATH="$fake_bin:/usr/bin:/bin" \
    TRACE_DEPLOY_TEST_MODE=1 \
    TRACE_DEPLOY_CONFIG_DIR="$config_dir" \
    TRACE_DEPLOY_STATE_DIR="$state_dir" \
    TRACE_DEPLOY_RELEASE_ROOT="$release_root" \
    TRACE_DEPLOY_LOCK_FILE="$tmpdir/deploy.lock" \
    TRACE_PUBLIC_REPOSITORY_URL="$origin" \
    TRACE_DEPLOY_PUBLIC_URL="http://demo.invalid" \
    TRACE_DEPLOY_PREPARE_RELEASE="$fake_bin/prepare-release.sh" \
    TRACE_DEPLOY_VERIFY_RELEASE="$fake_bin/verify-release.sh" \
    TRACE_DEPLOY_PREFLIGHT="$fake_bin/preflight.sh" \
    TRACE_DEPLOY_RUN_OPS="$fake_bin/run-ops.sh" \
    TRACE_DEPLOY_START_CANDIDATE="$fake_bin/start-candidate.sh" \
    TRACE_DEPLOY_VERIFY_CANDIDATE="$fake_bin/verify-candidate.sh" \
    TRACE_DEPLOY_SWITCH_NGINX="$fake_bin/switch-nginx.sh" \
    TRACE_DEPLOY_ROLLBACK_NGINX="$fake_bin/rollback-nginx.sh" \
    TRACE_DEPLOY_PRUNE_RELEASES="$fake_bin/prune-releases.sh" \
    TRACE_DEPLOY_DOCKER="$fake_bin/docker" \
    TRACE_DEPLOY_PROBE_ATTEMPTS=2 \
    TRACE_DEPLOY_PROBE_SLEEP=0 \
    TRACE_TEST_CALLS_LOG="$calls_log" \
    TRACE_TEST_RELEASE_ROOT="$release_root" \
    TRACE_TEST_STATE_DIR="$state_dir" \
    "${TRACE_TEST_ENV_EXTRA[@]}" \
    "$DEPLOY" "$@"
}

# --- Test 1: already deployed, nothing happens ------------------------------
config1="$tmpdir/config1"; state1="$tmpdir/state1"
setup_config "$config1" green "$baseline_sha"
: > "$calls_log"
expect_success 'already-deployed is a no-op' run_deploy "$config1" "$state1"
[[ ! -s "$calls_log" ]] || fail_message 'already-deployed must not invoke any primitive'

# --- Test 2: docs-only change is skipped ------------------------------------
docs_sha="$(commit 'docs only' 'docs/notes.md=updated' 'README.md=updated too')"
push_main
config2="$tmpdir/config2"; state2="$tmpdir/state2"
setup_config "$config2" green "$baseline_sha"
: > "$calls_log"
expect_success 'docs-only change is skipped' run_deploy "$config2" "$state2"
[[ ! -s "$calls_log" ]] || fail_message 'docs-only change must not invoke any primitive'
[[ "$(readlink -f "$config2/active.env")" == "$config2/green-$baseline_sha.env" ]] \
  || fail_message 'docs-only change must not move active.env'

# --- Test 3: a real code change deploys, picks the inactive slot ------------
code_sha="$(commit 'feature' 'packages/api/src/index.ts=export {}')"
push_main
config3="$tmpdir/config3"; state3="$tmpdir/state3"
setup_config "$config3" green "$docs_sha"
: > "$calls_log"
expect_success 'a code change on main deploys' run_deploy "$config3" "$state3"
grep -q "^prepare-release $code_sha\$" "$calls_log" || fail_message 'expected prepare-release call'
grep -q "^preflight $config3/blue-$code_sha.env\$" "$calls_log" \
  || fail_message 'expected the inactive (blue) slot to be prepared'
grep -q '^run-ops .* migrate$' "$calls_log" || fail_message 'expected a migrate call'
grep -q '^run-ops .* demo-verify --env demo$' "$calls_log" || fail_message 'expected a demo-verify call'
grep -q "^switch-nginx $config3/nginx/active.conf $config3/nginx/blue.conf $config3/active.env $config3/blue-$code_sha.env\$" "$calls_log" \
  || fail_message 'expected switch-nginx with the blue candidate pair'
grep -q '^prune-releases $' "$calls_log" || fail_message 'expected prune-releases to run after a successful deploy'
[[ "$(readlink -f "$config3/active.env")" == "$config3/blue-$code_sha.env" ]] \
  || fail_message 'active.env must point at the new blue candidate after switching'
grep -q "sha=$code_sha slot=blue previous=$docs_sha result=deployed" "$state3/deployments.log" \
  || fail_message 'expected a deployment log line'

# --- Test 4: demo-verify failure aborts before start/switch -----------------
config4="$tmpdir/config4"; state4="$tmpdir/state4"
setup_config "$config4" green "$docs_sha"
: > "$calls_log"
TRACE_TEST_ENV_EXTRA=(TRACE_TEST_DEMO_VERIFY_FAIL=1)
expect_failure 'a failing demo-verify aborts the deploy' run_deploy "$config4" "$state4"
TRACE_TEST_ENV_EXTRA=()
grep -q '^start-candidate' "$calls_log" && fail_message 'must not start the candidate after demo-verify fails'
grep -q '^switch-nginx' "$calls_log" && fail_message 'must not switch nginx after demo-verify fails'
[[ "$(readlink -f "$config4/active.env")" == "$config4/green-$docs_sha.env" ]] \
  || fail_message 'the live slot must be untouched after a demo-verify failure'

# --- Test 5: a public-probe failure after switching triggers rollback -------
config5="$tmpdir/config5"; state5="$tmpdir/state5"
setup_config "$config5" green "$docs_sha"
: > "$calls_log"
TRACE_TEST_ENV_EXTRA=(TRACE_TEST_PUBLIC_PROBE_FAIL=1)
expect_failure 'a failing public probe rolls back' run_deploy "$config5" "$state5"
TRACE_TEST_ENV_EXTRA=()
grep -q '^switch-nginx' "$calls_log" || fail_message 'expected switch-nginx to have run before the probe'
grep -q '^rollback-nginx' "$calls_log" || fail_message 'expected rollback-nginx after the probe failed'
[[ "$(readlink -f "$config5/active.env")" == "$config5/green-$docs_sha.env" ]] \
  || fail_message 'active.env must be restored to the previous slot after rollback'
[[ "$(readlink -f "$config5/nginx/active.conf")" == "$config5/nginx/green.conf" ]] \
  || fail_message 'active.conf must be restored to the previous slot after rollback'

# --- Test 6: slot selection flips the other way when blue is active --------
config6="$tmpdir/config6"; state6="$tmpdir/state6"
setup_config "$config6" blue "$docs_sha"
: > "$calls_log"
expect_success 'deploying from an active blue slot picks green' run_deploy "$config6" "$state6"
grep -q "^preflight $config6/green-$code_sha.env\$" "$calls_log" \
  || fail_message 'expected the inactive (green) slot to be prepared'

echo "All $pass_count deploy-main tests passed."
