#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=release-lib.sh
source "$SCRIPT_DIR/release-lib.sh"

readonly SOURCE_REPOSITORY='https://github.com/Adventurous-Systems/TRACE-public'
if [[ "${TRACE_RELEASE_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  RELEASE_ROOT="${TRACE_RELEASE_ROOT:?TRACE_RELEASE_ROOT is required in test mode}"
  PUBLIC_SOURCE_LABEL="${TRACE_PUBLIC_SOURCE_LABEL:-$SOURCE_REPOSITORY}"
else
  PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  export PATH
  unset TRACE_RELEASE_TEST_MODE TRACE_RELEASE_ROOT TRACE_PUBLIC_SOURCE_LABEL
  RELEASE_ROOT='/opt/trace-public-demo/releases'
  PUBLIC_SOURCE_LABEL="$SOURCE_REPOSITORY"
fi
readonly RELEASE_ROOT PUBLIC_SOURCE_LABEL

[[ "$#" == 1 ]] || { echo "Usage: $0 <full-lowercase-40-character-sha>" >&2; exit 2; }
release_sha="$1"
trace_require_sha "$release_sha"
require_read_only() {
  local path="$1" mode digit
  mode="$(stat -c '%a' "$path")"
  mode="${mode: -3}"
  [[ "$mode" =~ ^[0-7]{3}$ ]] || trace_release_fail "mode is invalid: $path"
  for digit in "${mode:0:1}" "${mode:1:1}" "${mode:2:1}"; do
    [[ "$digit" =~ [2367] ]] && trace_release_fail "must be read-only: $path"
  done
  return 0
}

release_dir="$RELEASE_ROOT/$release_sha"
source_dir="$release_dir/source"
receipt="$release_dir/images.env"

[[ -d "$release_dir" ]] || trace_release_fail "release directory is missing: $release_dir"
require_read_only "$source_dir"
if [[ "${TRACE_RELEASE_TEST_MODE:-0}" != 1 || "$EUID" == 0 ]]; then
  [[ "$(stat -c '%u:%g' "$release_dir")" == 0:0 ]] \
    || trace_release_fail 'release directory must be owned by root'
  [[ "$(stat -c '%u:%g:%a' "$receipt")" == 0:0:400 ]] \
    || trace_release_fail 'release receipt must be root-owned with mode 400'
fi

trace_verify_public_source "$source_dir" "$release_sha"
command -v sha256sum >/dev/null || trace_release_fail 'missing sha256sum'
trace_validate_receipt "$receipt" "$release_sha" "$PUBLIC_SOURCE_LABEL"

for component in api web ops; do
  upper="${component^^}"
  image="$(trace_receipt_value "$receipt" "TRACE_${upper}_IMAGE")"
  expected_id="$(trace_receipt_value "$receipt" "TRACE_${upper}_IMAGE_ID")"
  actual_id="$(docker image inspect "$image" --format '{{.Id}}')"
  revision="$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  source_label="$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.source" }}')"
  configured_user="$(docker image inspect "$image" --format '{{.Config.User}}')"
  expected_user=node
  [[ "$component" == web ]] && expected_user=nextjs
  [[ "$actual_id" == "$expected_id" ]] || trace_release_fail "image ID mismatch for $image"
  [[ "$revision" == "$release_sha" ]] || trace_release_fail "revision label mismatch for $image"
  [[ "$source_label" == "$PUBLIC_SOURCE_LABEL" ]] || trace_release_fail "source label mismatch for $image"
  [[ "$configured_user" == "$expected_user" ]] || trace_release_fail "configured user mismatch for $image"
  scan_dir="$release_dir/scans/$component"
  sbom="$scan_dir/sbom.cdx.json"
  report="$scan_dir/scan.json"
  metadata="$scan_dir/metadata.env"
  [[ -f "$sbom" && -f "$report" && -f "$metadata" ]] \
    || trace_release_fail "scan artifacts are missing for $component"
  require_read_only "$sbom"; require_read_only "$report"; require_read_only "$metadata"
  [[ "$(sha256sum "$sbom" | awk '{print $1}')" == "$(trace_receipt_value "$receipt" "TRACE_${upper}_SBOM_SHA256")" ]] \
    || trace_release_fail "SBOM hash mismatch for $component"
done

echo "Source release verification passed: $release_sha"
