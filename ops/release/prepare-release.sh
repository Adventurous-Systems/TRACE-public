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
  IMAGE_SCANNER="${TRACE_IMAGE_SCANNER:?TRACE_IMAGE_SCANNER is required in test mode}"
else
  [[ "$EUID" == 0 ]] || { echo 'This installed release command must run as root.' >&2; exit 1; }
  PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  export PATH
  unset TRACE_RELEASE_TEST_MODE TRACE_RELEASE_ROOT TRACE_PUBLIC_REPOSITORY_URL TRACE_PUBLIC_SOURCE_LABEL
  RELEASE_ROOT='/opt/trace-public-demo/releases'
  PUBLIC_GIT_URL="$SOURCE_GIT_URL"
  PUBLIC_SOURCE_LABEL="$SOURCE_REPOSITORY"
  LOCK_FILE='/run/lock/trace-public-demo-release.lock'
  IMAGE_SCANNER="$SCRIPT_DIR/scan-image.sh"
fi
readonly RELEASE_ROOT PUBLIC_GIT_URL PUBLIC_SOURCE_LABEL LOCK_FILE IMAGE_SCANNER

usage() {
  echo "Usage: $0 <full-lowercase-40-character-main-sha>" >&2
  exit 2
}

[[ "$#" == 1 ]] || usage
release_sha="$1"
trace_require_sha "$release_sha" || usage
trace_reject_build_secrets

[[ -x "$IMAGE_SCANNER" ]] || trace_release_fail "trusted image scanner is missing: $IMAGE_SCANNER"
for command in awk cmp diff docker find flock git grep install jq mv sed sha256sum sort stat; do
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
scan_root="$work_dir/scans"
scanner=unscanned
scanner_version=unscanned
scanner_db_updated_at=unscanned
api_sbom_hash=unscanned
api_scan_hash=unscanned
web_sbom_hash=unscanned
web_scan_hash=unscanned
ops_sbom_hash=unscanned
ops_scan_hash=unscanned
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

install -d -m 700 "$source_dir" "$docker_config" "$scan_root"
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
    printf 'TRACE_SCANNER=%s\n' "$scanner"
    printf 'TRACE_SCANNER_VERSION=%s\n' "$scanner_version"
    printf 'TRACE_SCANNER_DB_UPDATED_AT=%s\n' "$scanner_db_updated_at"
    printf 'TRACE_API_IMAGE=trace-demo-api:%s\n' "$release_sha"
    printf 'TRACE_API_IMAGE_ID=%s\n' "$api_id"
    printf 'TRACE_API_SBOM_SHA256=%s\n' "$api_sbom_hash"
    printf 'TRACE_API_SCAN_SHA256=%s\n' "$api_scan_hash"
    printf 'TRACE_WEB_IMAGE=trace-demo-web:%s\n' "$release_sha"
    printf 'TRACE_WEB_IMAGE_ID=%s\n' "$web_id"
    printf 'TRACE_WEB_SBOM_SHA256=%s\n' "$web_sbom_hash"
    printf 'TRACE_WEB_SCAN_SHA256=%s\n' "$web_scan_hash"
    printf 'TRACE_OPS_IMAGE=trace-demo-ops:%s\n' "$release_sha"
    printf 'TRACE_OPS_IMAGE_ID=%s\n' "$ops_id"
    printf 'TRACE_OPS_SBOM_SHA256=%s\n' "$ops_sbom_hash"
    printf 'TRACE_OPS_SCAN_SHA256=%s\n' "$ops_scan_hash"
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

  scan_dir="$scan_root/$component"
  "$IMAGE_SCANNER" "$tag" "$image_id" "$scan_dir"
  scan_value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1"; }
  scan_metadata="$scan_dir/metadata.env"
  [[ -f "$scan_dir/sbom.cdx.json" && -f "$scan_dir/scan.json" && -f "$scan_metadata" ]] \
    || trace_release_fail "scanner did not create complete artifacts for $component"
  component_scanner="$(scan_value "$scan_metadata" TRACE_SCANNER)"
  component_version="$(scan_value "$scan_metadata" TRACE_SCANNER_VERSION)"
  component_db_updated_at="$(scan_value "$scan_metadata" TRACE_SCANNER_DB_UPDATED_AT)"
  component_image_id="$(scan_value "$scan_metadata" TRACE_IMAGE_ID)"
  component_sbom_hash="$(scan_value "$scan_metadata" TRACE_SBOM_SHA256)"
  component_scan_hash="$(scan_value "$scan_metadata" TRACE_SCAN_SHA256)"
  [[ "$component_scanner" == trivy && "$component_version" == 0.74.0 && "$component_db_updated_at" =~ ^[0-9]{4}- ]] \
    || trace_release_fail "scanner metadata is invalid for $component"
  [[ "$component_image_id" == "$image_id" ]] || trace_release_fail "scanner image ID does not match for $component"
  [[ "$component_sbom_hash" == "$(sha256sum "$scan_dir/sbom.cdx.json" | awk '{print $1}')" ]] \
    || trace_release_fail "scanner SBOM hash does not match for $component"
  [[ "$component_scan_hash" == "$(sha256sum "$scan_dir/scan.json" | awk '{print $1}')" ]] \
    || trace_release_fail "scanner report hash does not match for $component"
  [[ "$scanner" == unscanned || ( "$scanner" == "$component_scanner" && "$scanner_version" == "$component_version" && "$scanner_db_updated_at" == "$component_db_updated_at" ) ]] \
    || trace_release_fail 'scanner metadata differs between component images'
  scanner="$component_scanner"; scanner_version="$component_version"; scanner_db_updated_at="$component_db_updated_at"

  case "$component" in
    api) api_id="$image_id"; api_sbom_hash="$component_sbom_hash"; api_scan_hash="$component_scan_hash" ;;
    web) web_id="$image_id"; web_sbom_hash="$component_sbom_hash"; web_scan_hash="$component_scan_hash" ;;
    ops) ops_id="$image_id"; ops_sbom_hash="$component_sbom_hash"; ops_scan_hash="$component_scan_hash" ;;
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
