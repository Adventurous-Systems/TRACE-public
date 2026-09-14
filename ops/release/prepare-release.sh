#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=release-lib.sh
source "$SCRIPT_DIR/release-lib.sh"

readonly SOURCE_REPOSITORY='https://github.com/Adventurous-Systems/TRACE-public'
readonly SOURCE_GIT_URL='https://github.com/Adventurous-Systems/TRACE-public.git'

if [[ "${TRACE_RELEASE_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  RELEASE_ROOT="${TRACE_RELEASE_ROOT:?TRACE_RELEASE_ROOT is required in test mode}"
  PUBLIC_GIT_URL="${TRACE_PUBLIC_REPOSITORY_URL:?TRACE_PUBLIC_REPOSITORY_URL is required in test mode}"
  PUBLIC_SOURCE_LABEL="${TRACE_PUBLIC_SOURCE_LABEL:-$SOURCE_REPOSITORY}"
  LOCK_FILE="$RELEASE_ROOT/.prepare.lock"
else
  [[ "$EUID" == 0 ]] || { echo 'This installed release command must run as root.' >&2; exit 1; }
  PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  export PATH
  unset TRACE_RELEASE_TEST_MODE TRACE_RELEASE_ROOT TRACE_PUBLIC_REPOSITORY_URL TRACE_PUBLIC_SOURCE_LABEL
  RELEASE_ROOT='/opt/trace-public-demo/releases'
  PUBLIC_GIT_URL="$SOURCE_GIT_URL"
  PUBLIC_SOURCE_LABEL="$SOURCE_REPOSITORY"
  LOCK_FILE='/run/lock/trace-public-demo-release.lock'
fi
readonly RELEASE_ROOT PUBLIC_GIT_URL PUBLIC_SOURCE_LABEL LOCK_FILE

usage() {
  echo "Usage: $0 <full-lowercase-40-character-main-sha>" >&2
  exit 2
}

[[ "$#" == 1 ]] || usage
release_sha="$1"
trace_require_sha "$release_sha" || usage
trace_reject_build_secrets

for command in awk cmp diff docker find flock git grep install mv sed sort stat; do
  command -v "$command" >/dev/null || trace_release_fail "missing command: $command"
done

if [[ "${TRACE_RELEASE_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  install -d -m 700 "$RELEASE_ROOT"
else
  install -d -o root -g root -m 750 "$RELEASE_ROOT"
fi

exec 9>"$LOCK_FILE"
flock -n 9 || trace_release_fail 'another source release preparation is already running'

remote_line="$(git -c credential.helper= ls-remote --exit-code --refs "$PUBLIC_GIT_URL" refs/heads/main)"
remote_sha="${remote_line%%$'\t'*}"
[[ "$remote_sha" == "$release_sha" && "$remote_line" == "$release_sha"$'\trefs/heads/main' ]] \
  || trace_release_fail 'requested SHA is not the exact current public main tip'

release_dir="$RELEASE_ROOT/$release_sha"
[[ ! -e "$release_dir" ]] || trace_release_fail "release already exists: $release_dir"
work_dir="$(mktemp -d "$RELEASE_ROOT/.prepare-${release_sha}.XXXXXX")"
source_dir="$work_dir/source"
receipt="$work_dir/images.env"
docker_config="$work_dir/.docker-client"
declare -a built_tags=()
completed=0

cleanup() {
  local status=$?
  if [[ "$completed" != 1 ]]; then
    local tag
    for tag in "${built_tags[@]}"; do
      docker image rm "$tag" >/dev/null 2>&1 || true
    done
    case "$work_dir" in
      "$RELEASE_ROOT"/.prepare-"$release_sha".*) rm -rf -- "$work_dir" ;;
      *) echo 'Refusing to remove unexpected temporary release path.' >&2 ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

install -d -m 700 "$source_dir" "$docker_config"
git -c init.defaultBranch=detached init --quiet "$source_dir"
git -C "$source_dir" -c core.hooksPath=/dev/null -c credential.helper= \
  fetch --quiet --no-tags --depth=1 "$PUBLIC_GIT_URL" refs/heads/main
[[ "$(git -C "$source_dir" rev-parse FETCH_HEAD)" == "$release_sha" ]] \
  || trace_release_fail 'fetched main commit does not match the requested SHA'
git -C "$source_dir" -c core.hooksPath=/dev/null checkout --quiet --detach FETCH_HEAD
git -C "$source_dir" config --local core.hooksPath /dev/null
git -C "$source_dir" config --local --unset-all credential.helper >/dev/null 2>&1 || true
find "$source_dir/.git/hooks" -mindepth 1 -type f -delete
trace_verify_public_source "$source_dir" "$release_sha"

api_id=pending
web_id=pending
ops_id=pending
write_receipt() {
  local temporary="$receipt.tmp"
  {
    printf 'TRACE_RELEASE_SHA=%s\n' "$release_sha"
    printf 'TRACE_SOURCE_REPOSITORY=%s\n' "$PUBLIC_SOURCE_LABEL"
    printf 'TRACE_API_IMAGE=trace-demo-api:%s\n' "$release_sha"
    printf 'TRACE_API_IMAGE_ID=%s\n' "$api_id"
    printf 'TRACE_WEB_IMAGE=trace-demo-web:%s\n' "$release_sha"
    printf 'TRACE_WEB_IMAGE_ID=%s\n' "$web_id"
    printf 'TRACE_OPS_IMAGE=trace-demo-ops:%s\n' "$release_sha"
    printf 'TRACE_OPS_IMAGE_ID=%s\n' "$ops_id"
  } > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$receipt"
}
write_receipt

for component in api web ops; do
  tag="trace-demo-$component:$release_sha"
  docker image inspect "$tag" >/dev/null 2>&1 \
    && trace_release_fail "refusing to replace existing release image tag: $tag"

  if [[ "${TRACE_RELEASE_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
    docker build --file "$source_dir/Dockerfile.$component" \
      --label "org.opencontainers.image.source=$PUBLIC_SOURCE_LABEL" \
      --label "org.opencontainers.image.revision=$release_sha" \
      --tag "$tag" "$source_dir"
  else
    env -i PATH="$PATH" HOME=/nonexistent DOCKER_CONFIG="$docker_config" DOCKER_BUILDKIT=1 \
      docker build --file "$source_dir/Dockerfile.$component" \
      --label "org.opencontainers.image.source=$PUBLIC_SOURCE_LABEL" \
      --label "org.opencontainers.image.revision=$release_sha" \
      --tag "$tag" "$source_dir"
  fi
  built_tags+=("$tag")

  image_id="$(docker image inspect "$tag" --format '{{.Id}}')"
  revision="$(docker image inspect "$tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  source_label="$(docker image inspect "$tag" --format '{{ index .Config.Labels "org.opencontainers.image.source" }}')"
  configured_user="$(docker image inspect "$tag" --format '{{.Config.User}}')"
  expected_user=node
  [[ "$component" == web ]] && expected_user=nextjs
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || trace_release_fail "invalid image ID for $tag"
  [[ "$revision" == "$release_sha" ]] || trace_release_fail "revision label mismatch for $tag"
  [[ "$source_label" == "$PUBLIC_SOURCE_LABEL" ]] || trace_release_fail "source label mismatch for $tag"
  [[ "$configured_user" == "$expected_user" ]] || trace_release_fail "configured user mismatch for $tag"

  case "$component" in
    api) api_id="$image_id" ;;
    web) web_id="$image_id" ;;
    ops) ops_id="$image_id" ;;
  esac
  write_receipt
done

trace_validate_receipt "$receipt" "$release_sha" "$PUBLIC_SOURCE_LABEL"
trace_verify_public_source "$source_dir" "$release_sha"
remote_line="$(git -c credential.helper= ls-remote --exit-code --refs "$PUBLIC_GIT_URL" refs/heads/main)"
[[ "$remote_line" == "$release_sha"$'\trefs/heads/main' ]] \
  || trace_release_fail 'public main changed while the release was being built'

find "$docker_config" -depth -delete
chmod -R a-w "$source_dir"
chmod 400 "$receipt"
chmod 550 "$work_dir"
mv "$work_dir" "$release_dir"
completed=1
trap - EXIT INT TERM
echo "Prepared immutable source release: $release_dir"
