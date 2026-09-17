#!/usr/bin/env bash
# Tests release retention: keeps the active release, every release a
# *.env.previous rollback pointer still refers to, every release a running
# container is using, and the two most recently prepared releases, and
# removes everything else.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PRUNE="$repo_root/ops/deploy/prune-releases.sh"
bash -n "$PRUNE"

tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT

config_dir="$tmpdir/config"
state_dir="$tmpdir/state"
release_root="$tmpdir/releases"
fake_bin="$tmpdir/bin"
mkdir -p "$config_dir" "$state_dir" "$release_root" "$fake_bin"

# Five fake releases, oldest to newest, each with a distinct mtime.
sha_active='1111111111111111111111111111111111111111'
sha_previous='2222222222222222222222222222222222222222'
sha_running='3333333333333333333333333333333333333333'
sha_recent1='4444444444444444444444444444444444444444'
sha_recent2='5555555555555555555555555555555555555555'
sha_stale='6666666666666666666666666666666666666666'

epoch=1700000000
for sha in "$sha_stale" "$sha_running" "$sha_previous" "$sha_active" "$sha_recent1" "$sha_recent2"; do
  mkdir -p "$release_root/$sha"
  echo receipt > "$release_root/$sha/images.env"
  touch -d "@$epoch" "$release_root/$sha"
  epoch=$((epoch + 60))
done
# sha_recent1 and sha_recent2 are the two most recent by construction above.

cat > "$config_dir/active.env" <<ENV
TRACE_RELEASE_SHA=$sha_active
ENV

printf '%s\n' "$config_dir/previous-pointer.env" > "$state_dir/active.env.previous"
cat > "$config_dir/previous-pointer.env" <<ENV
TRACE_RELEASE_SHA=$sha_previous
ENV

write_fake() {
  local path="$1"
  shift
  printf '%s\n' "$@" > "$path"
  chmod 755 "$path"
}

# Reports one running container on the "running" slot's release, so that SHA
# is protected even though it is neither active nor the recorded previous.
write_fake "$fake_bin/docker" \
  '#!/usr/bin/env bash' \
  'case "$1" in' \
  '  ps)' \
  '    if [[ "$*" == *"label=com.docker.compose.project"* ]]; then' \
  "      printf 'trace-demo-api:%s\\n' '$sha_running'" \
  "      printf 'trace-demo-web:%s\\n' '$sha_running'" \
  '    fi' \
  '    exit 0 ;;' \
  '  image) exit 0 ;;' \
  '  *) exit 0 ;;' \
  'esac'

env -i \
  PATH="$fake_bin:/usr/bin:/bin" \
  TRACE_DEPLOY_TEST_MODE=1 \
  TRACE_DEPLOY_CONFIG_DIR="$config_dir" \
  TRACE_DEPLOY_STATE_DIR="$state_dir" \
  TRACE_DEPLOY_RELEASE_ROOT="$release_root" \
  TRACE_DEPLOY_DOCKER="$fake_bin/docker" \
  TRACE_DEPLOY_PRUNE_KEEP_RECENT=2 \
  "$PRUNE" > "$tmpdir/prune.out"

fail_message() { echo "FAIL: $*" >&2; cat "$tmpdir/prune.out" >&2; exit 1; }

for sha in "$sha_active" "$sha_previous" "$sha_running" "$sha_recent1" "$sha_recent2"; do
  [[ -d "$release_root/$sha" ]] || fail_message "protected release was removed: $sha"
done
[[ ! -d "$release_root/$sha_stale" ]] || fail_message 'stale, unprotected release was not removed'

echo 'All prune-releases tests passed.'
