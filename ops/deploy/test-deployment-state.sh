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

cp "$replenisher" "$tmpdir/ops/run-replenish.sh"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" > "$TRACE_REPLENISH_TEST_OUTPUT"' > "$tmpdir/ops/run-ops.sh"
chmod 755 "$tmpdir/ops/run-replenish.sh" "$tmpdir/ops/run-ops.sh"
TRACE_REPLENISH_TEST_OUTPUT="$tmpdir/replenish.args" PATH="$fake_bin:$PATH" TRACE_DEPLOY_CONFIG_DIR="$tmpdir/config" TRACE_DEPLOY_LOCK_FILE="$tmpdir/deploy.lock" "$tmpdir/ops/run-replenish.sh" "$tmpdir/config/active.env"
grep -Fqx "$tmpdir/config/old.env demo-replenish --env demo --target-active 3 --yes" "$tmpdir/replenish.args"

echo "deployment state tests passed"