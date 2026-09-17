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

echo "deployment state tests passed"