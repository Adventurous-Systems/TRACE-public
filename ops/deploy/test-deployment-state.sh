#!/usr/bin/env bash
# Deterministic tests for paired nginx/environment activation. No service reloads.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
switcher="$repo_root/ops/deploy/switch-nginx.sh"
rollback="$repo_root/ops/deploy/rollback-nginx.sh"
replenisher="$repo_root/ops/deploy/run-replenish.sh"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
fake_bin="$tmpdir/bin"
mkdir -p "$fake_bin" "$tmpdir/config/nginx" "$tmpdir/state" "$tmpdir/ops"

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$fake_bin/flock"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$fake_bin/nginx"
printf '%s\n' '#!/usr/bin/env bash' 'case "$1" in' '-c) echo 0:600 ;;' '*) /usr/bin/stat "$@" ;;' 'esac' > "$fake_bin/stat"
chmod 755 "$fake_bin/flock" "$fake_bin/nginx" "$fake_bin/stat"
worker_calls="$tmpdir/switch-worker.calls"
printf '%s\n' '#!/usr/bin/env bash' 'echo "$*" >> "$TRACE_TEST_WORKER_CALLS"' > "$fake_bin/switch-worker.sh"
chmod 755 "$fake_bin/switch-worker.sh"
export TRACE_DEPLOY_SWITCH_WORKER="$fake_bin/switch-worker.sh" TRACE_TEST_WORKER_CALLS="$worker_calls"

printf 'old upstream\n' > "$tmpdir/config/nginx/old.conf"
printf 'new upstream\n' > "$tmpdir/config/nginx/new.conf"
printf 'old env\n' > "$tmpdir/config/old.env"
printf 'new env\n' > "$tmpdir/config/new.env"
ln -s "$tmpdir/config/nginx/old.conf" "$tmpdir/config/nginx/active.conf"
ln -s "$tmpdir/config/old.env" "$tmpdir/config/active.env"

env PATH="$fake_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" TRACE_DEPLOY_LOCK_FILE="$tmpdir/deploy.lock" "$switcher" "$tmpdir/config/nginx/active.conf" "$tmpdir/config/nginx/new.conf" "$tmpdir/config/active.env" "$tmpdir/config/new.env"
[[ "$(readlink -f "$tmpdir/config/nginx/active.conf")" == "$tmpdir/config/nginx/new.conf" ]]
[[ "$(readlink -f "$tmpdir/config/active.env")" == "$tmpdir/config/new.env" ]]
[[ "$(cat "$tmpdir/state/active.conf.previous")" == "$tmpdir/config/nginx/old.conf" ]]
[[ "$(cat "$tmpdir/state/active.env.previous")" == "$tmpdir/config/old.env" ]]

env PATH="$fake_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" TRACE_DEPLOY_LOCK_FILE="$tmpdir/deploy.lock" "$rollback" "$tmpdir/config/nginx/active.conf" "$tmpdir/config/active.env"
[[ "$(readlink -f "$tmpdir/config/nginx/active.conf")" == "$tmpdir/config/nginx/old.conf" ]]
[[ "$(readlink -f "$tmpdir/config/active.env")" == "$tmpdir/config/old.env" ]]
# The anchor worker follows the rollback: from the rolled-back env to the restored one.
grep -Fqx "$tmpdir/config/new.env $tmpdir/config/old.env" "$worker_calls"

# --- Nested-lock regression -------------------------------------------------
# deploy-main.sh holds the deploy lock for its entire run and then calls
# switch-nginx.sh (and, on a failed probe, rollback-nginx.sh) directly, both
# of which must skip re-acquiring a lock the caller already holds instead of
# self-conflicting. The faked, unconditionally-succeeding flock above can
# never catch a regression here, because it can never actually conflict with
# anything. Real OS-level flock(2) is not a safe substitute either — verified
# directly in this environment that a child process can acquire a lock its
# own parent still holds, i.e. flock here does not reliably enforce real
# cross-process exclusion, so a test built on it would be no more meaningful
# than the always-succeeding fake. This fakes flock with a marker file
# instead: deterministic regardless of the filesystem's locking support, and
# it only "succeeds" once, exactly like a real exclusive lock that is never
# released mid-test (there is nothing here that should ever release it).
nested_bin="$tmpdir/bin-nested"
mkdir -p "$nested_bin"
cp "$fake_bin/nginx" "$fake_bin/stat" "$nested_bin/"
nested_marker="$tmpdir/nested.lock.held"
printf '%s\n' '#!/usr/bin/env bash' "[[ ! -e '$nested_marker' ]] || exit 1" ": > '$nested_marker'" \
  > "$nested_bin/flock"
chmod 755 "$nested_bin/flock"
: > "$nested_marker" # simulate: the outer deploy-main.sh already holds it

# Held, TRACE_DEPLOY_LOCK_HELD unset: must refuse, same as a human running
# switch-nginx.sh standalone while a real deploy is in progress.
if env PATH="$nested_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" \
     TRACE_DEPLOY_LOCK_FILE="$tmpdir/nested.lock" "$switcher" \
     "$tmpdir/config/nginx/active.conf" "$tmpdir/config/nginx/old.conf" \
     "$tmpdir/config/active.env" "$tmpdir/config/old.env" 2>/dev/null; then
  echo "switch-nginx.sh should have refused a lock genuinely held by another process" >&2
  exit 1
fi

# Held, TRACE_DEPLOY_LOCK_HELD=1 (simulating deploy-main.sh's own nested
# call): must succeed without trying to re-acquire — the marker is still
# present throughout, so this only passes if flock was never invoked at all.
env PATH="$nested_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" \
  TRACE_DEPLOY_LOCK_FILE="$tmpdir/nested.lock" TRACE_DEPLOY_LOCK_HELD=1 "$switcher" \
  "$tmpdir/config/nginx/active.conf" "$tmpdir/config/nginx/new.conf" \
  "$tmpdir/config/active.env" "$tmpdir/config/new.env"
[[ "$(readlink -f "$tmpdir/config/nginx/active.conf")" == "$tmpdir/config/nginx/new.conf" ]]
[[ "$(readlink -f "$tmpdir/config/active.env")" == "$tmpdir/config/new.env" ]]

# rollback-nginx.sh has the identical fix (deploy-main.sh calls it directly
# on a failed post-switch probe) and has never been exercised by any run
# yet, since no probe has failed. state/*.previous still says "old" from the
# switch just above, so this also restores active to "old" for the
# run-replenish assertion below — no separate restore step needed.
: > "$nested_marker" # simulate: the outer deploy-main.sh still holds it

if env PATH="$nested_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" \
     TRACE_DEPLOY_LOCK_FILE="$tmpdir/nested.lock" "$rollback" \
     "$tmpdir/config/nginx/active.conf" "$tmpdir/config/active.env" 2>/dev/null; then
  echo "rollback-nginx.sh should have refused a lock genuinely held by another process" >&2
  exit 1
fi

env PATH="$nested_bin:$PATH" TRACE_DEPLOY_STATE_DIR="$tmpdir/state" \
  TRACE_DEPLOY_LOCK_FILE="$tmpdir/nested.lock" TRACE_DEPLOY_LOCK_HELD=1 "$rollback" \
  "$tmpdir/config/nginx/active.conf" "$tmpdir/config/active.env"
[[ "$(readlink -f "$tmpdir/config/nginx/active.conf")" == "$tmpdir/config/nginx/old.conf" ]]
[[ "$(readlink -f "$tmpdir/config/active.env")" == "$tmpdir/config/old.env" ]]
rm -f "$nested_marker"

cp "$replenisher" "$tmpdir/ops/run-replenish.sh"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" > "$TRACE_REPLENISH_TEST_OUTPUT"' > "$tmpdir/ops/run-ops.sh"
chmod 755 "$tmpdir/ops/run-replenish.sh" "$tmpdir/ops/run-ops.sh"
TRACE_REPLENISH_TEST_OUTPUT="$tmpdir/replenish.args" PATH="$fake_bin:$PATH" TRACE_DEPLOY_CONFIG_DIR="$tmpdir/config" TRACE_DEPLOY_LOCK_FILE="$tmpdir/deploy.lock" "$tmpdir/ops/run-replenish.sh" "$tmpdir/config/active.env"
grep -Fqx "$tmpdir/config/old.env demo-replenish --env demo --target-active 1 --yes" "$tmpdir/replenish.args"


# --- switch-worker.sh -------------------------------------------------------
# Fake docker: logs every compose call; `ps` reports the state in
# $TRACE_TEST_WORKER_STATE (default running).
switcher_worker="$repo_root/ops/deploy/switch-worker.sh"
bash -n "$switcher_worker"
docker_log="$tmpdir/docker.calls"
printf '%s\n' '#!/usr/bin/env bash' 'echo "$*" >> "$TRACE_TEST_DOCKER_LOG"' \
  'if [[ " $* " == *" ps worker "* ]]; then echo "${TRACE_TEST_WORKER_STATE:-running}"; fi' \
  > "$fake_bin/docker"
chmod 755 "$fake_bin/docker"
printf 'COMPOSE_PROJECT_NAME=trace-demo-green\n' > "$tmpdir/config/green.env"
printf 'COMPOSE_PROJECT_NAME=trace-demo-blue\nTRACE_ENABLE_WORKER=1\n' > "$tmpdir/config/blue-on.env"
printf 'COMPOSE_PROJECT_NAME=trace-demo-blue\nTRACE_ENABLE_WORKER=0\n' > "$tmpdir/config/blue-off.env"
run_switch_worker() {
  env PATH="$fake_bin:$PATH" TRACE_DEPLOY_DOCKER="$fake_bin/docker" \
    TRACE_DEPLOY_COMPOSE_FILE="$tmpdir/compose.app.yml" TRACE_DEPLOY_WORKER_WAIT_SLEEP=0 \
    TRACE_TEST_DOCKER_LOG="$docker_log" "$switcher_worker" "$@"
}

# Enabled: start the new slot's worker, then stop the old slot's.
: > "$docker_log"
run_switch_worker "$tmpdir/config/green.env" "$tmpdir/config/blue-on.env" >/dev/null
[[ "$(sed -n 1p "$docker_log")" == "compose --env-file $tmpdir/config/blue-on.env -f $tmpdir/compose.app.yml --profile worker up -d --no-build --pull never worker" ]]
grep -Fqx "compose --env-file $tmpdir/config/green.env -f $tmpdir/compose.app.yml --profile worker rm --stop --force worker" "$docker_log"
start_line="$(grep -n ' up -d ' "$docker_log" | cut -d: -f1)"
stop_line="$(grep -n "green.env .* rm --stop" "$docker_log" | cut -d: -f1)"
(( start_line < stop_line )) || { echo "switch-worker must start the new worker before stopping the old one" >&2; exit 1; }

# Disabled: never start one; remove any from both slots.
: > "$docker_log"
run_switch_worker "$tmpdir/config/green.env" "$tmpdir/config/blue-off.env" >/dev/null
if grep -q ' up -d ' "$docker_log"; then echo "switch-worker must not start a disabled worker" >&2; exit 1; fi
grep -Fqx "compose --env-file $tmpdir/config/blue-off.env -f $tmpdir/compose.app.yml --profile worker rm --stop --force worker" "$docker_log"

# Same slot on both sides (a re-run): never stop the worker it just ensured.
: > "$docker_log"
run_switch_worker "$tmpdir/config/blue-on.env" "$tmpdir/config/blue-on.env" >/dev/null
if grep -q ' rm ' "$docker_log"; then echo "switch-worker must not stop the target slot's own worker" >&2; exit 1; fi

# A worker that never reaches running fails loudly and leaves the old one up.
: > "$docker_log"
if TRACE_TEST_WORKER_STATE=exited run_switch_worker "$tmpdir/config/green.env" "$tmpdir/config/blue-on.env" >/dev/null 2>&1; then
  echo "switch-worker must fail when the new worker does not start" >&2; exit 1
fi
if grep -q "green.env .* rm " "$docker_log"; then echo "a failed start must not stop the old worker" >&2; exit 1; fi

echo "deployment state tests passed"
