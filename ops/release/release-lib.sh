#!/usr/bin/env bash

trace_release_fail() {
  echo "Release validation failed: $*" >&2
  return 1
}

trace_require_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] \
    || trace_release_fail 'release SHA must be exactly 40 lowercase hexadecimal characters'
}

trace_receipt_value() {
  local receipt="$1" key="$2"
  awk -F= -v key="$key" '$1 == key {print substr($0, index($0, "=") + 1)}' "$receipt"
}

trace_validate_receipt() {
  local receipt="$1" release_sha="$2" source_repository="$3"
  local key value count
  local -a keys=(
    TRACE_RELEASE_SHA TRACE_SOURCE_REPOSITORY
    TRACE_SCANNER TRACE_SCANNER_VERSION TRACE_SCANNER_DB_UPDATED_AT
    TRACE_API_IMAGE TRACE_API_IMAGE_ID
    TRACE_API_SBOM_SHA256 TRACE_API_SCAN_SHA256
    TRACE_WEB_IMAGE TRACE_WEB_IMAGE_ID
    TRACE_WEB_SBOM_SHA256 TRACE_WEB_SCAN_SHA256
    TRACE_OPS_IMAGE TRACE_OPS_IMAGE_ID
    TRACE_OPS_SBOM_SHA256 TRACE_OPS_SCAN_SHA256
  )

  trace_require_sha "$release_sha" || return 1
  [[ -f "$receipt" ]] || trace_release_fail "release receipt is missing: $receipt" || return 1

  while IFS='=' read -r key value; do
    [[ -n "$key" && "$key" =~ ^[A-Z0-9_]+$ && -n "$value" ]] \
      || trace_release_fail 'release receipt contains a malformed line' || return 1
    case "$key" in
      TRACE_RELEASE_SHA|TRACE_SOURCE_REPOSITORY|TRACE_SCANNER|TRACE_SCANNER_VERSION|TRACE_SCANNER_DB_UPDATED_AT|\
      TRACE_API_IMAGE|TRACE_API_IMAGE_ID|TRACE_API_SBOM_SHA256|TRACE_API_SCAN_SHA256|\
      TRACE_WEB_IMAGE|TRACE_WEB_IMAGE_ID|TRACE_WEB_SBOM_SHA256|TRACE_WEB_SCAN_SHA256|\
      TRACE_OPS_IMAGE|TRACE_OPS_IMAGE_ID|TRACE_OPS_SBOM_SHA256|TRACE_OPS_SCAN_SHA256) ;;
      *) trace_release_fail "release receipt contains an unexpected key: $key" || return 1 ;;
    esac
  done < "$receipt"

  for key in "${keys[@]}"; do
    count="$(grep -c "^${key}=" "$receipt" || true)"
    [[ "$count" == 1 ]] || trace_release_fail "release receipt must contain exactly one $key" || return 1
  done

  [[ "$(trace_receipt_value "$receipt" TRACE_RELEASE_SHA)" == "$release_sha" ]] \
    || trace_release_fail 'release receipt SHA does not match the requested release' || return 1
  [[ "$(trace_receipt_value "$receipt" TRACE_SOURCE_REPOSITORY)" == "$source_repository" ]] \
    || trace_release_fail 'release receipt source repository is unexpected' || return 1
  [[ "$(trace_receipt_value "$receipt" TRACE_SCANNER)" == trivy ]] \
    || trace_release_fail 'release receipt scanner is unexpected' || return 1
  [[ "$(trace_receipt_value "$receipt" TRACE_SCANNER_VERSION)" == 0.74.0 ]] \
    || trace_release_fail 'release receipt scanner version is unexpected' || return 1
  [[ "$(trace_receipt_value "$receipt" TRACE_SCANNER_DB_UPDATED_AT)" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] \
    || trace_release_fail 'release receipt scanner database timestamp is invalid' || return 1

  for component in API WEB OPS; do
    value="$(trace_receipt_value "$receipt" "TRACE_${component}_IMAGE")"
    [[ "$value" == "trace-demo-${component,,}:$release_sha" ]] \
      || trace_release_fail "release receipt has an invalid ${component} image tag" || return 1
    value="$(trace_receipt_value "$receipt" "TRACE_${component}_IMAGE_ID")"
    [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || trace_release_fail "release receipt has an invalid ${component} image ID" || return 1
    for suffix in SBOM_SHA256 SCAN_SHA256; do
      value="$(trace_receipt_value "$receipt" "TRACE_${component}_${suffix}")"
      [[ "$value" =~ ^[0-9a-f]{64}$ ]] \
        || trace_release_fail "release receipt has an invalid ${component} ${suffix}" || return 1
    done
  done
}

trace_reject_build_secrets() {
  local key
  local -a secret_keys=(
    DATABASE_URL JWT_SECRET DEPLOYER_PRIVATE_KEY WALLET_ENCRYPTION_KEY
    MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_ROOT_USER MINIO_ROOT_PASSWORD
    POSTGRES_PASSWORD REDIS_PASSWORD GITHUB_TOKEN GH_TOKEN TRACE_DEMO_SSH_KEY
  )
  for key in "${secret_keys[@]}"; do
    [[ -z "${!key:-}" ]] \
      || trace_release_fail "secret-bearing build environment is not allowed: $key" || return 1
  done
}

trace_verify_public_source() {
  local source_dir="$1" release_sha="$2"
  local path historical_name private_checkout
  local -a forbidden_paths=(
    .local .agents .claude CLAUDE.md PLAN.md startup.md
    docs/full_audit_9Sept26 packages/db/data/workshop-attendees.csv
    packages/db/scripts/sync-users.ts
  )

  trace_require_sha "$release_sha" || return 1
  [[ -d "$source_dir/.git" ]] || trace_release_fail 'release source is not a Git checkout' || return 1
  [[ "$(git -C "$source_dir" rev-parse HEAD)" == "$release_sha" ]] \
    || trace_release_fail 'release source HEAD does not match the requested SHA' || return 1
  [[ -z "$(git -C "$source_dir" status --porcelain=v1 --untracked-files=all)" ]] \
    || trace_release_fail 'release source contains local modifications or untracked files' || return 1
  [[ -z "$(git -C "$source_dir" ls-files --others --ignored --exclude-standard)" ]] \
    || trace_release_fail 'release source contains ignored files' || return 1
  [[ -z "$(git -C "$source_dir" remote)" ]] \
    || trace_release_fail 'release source retains a Git remote' || return 1
  [[ "$(git -C "$source_dir" config --local --get core.hooksPath || true)" == /dev/null ]] \
    || trace_release_fail 'release source does not disable Git hooks' || return 1
  [[ -z "$(find "$source_dir/.git/hooks" -mindepth 1 -print -quit)" ]] \
    || trace_release_fail 'release source contains Git hook files' || return 1
  [[ -z "$(git -C "$source_dir" ls-files -s \
    | awk '$1 != "100644" && $1 != "100755" {print $4}')" ]] \
    || trace_release_fail 'release source contains a symlink, submodule, or special Git mode' || return 1

  diff -u \
    <(git -C "$source_dir" ls-files | LC_ALL=C sort) \
    <(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$source_dir/PUBLIC_MANIFEST.txt" \
      | grep -v -e '^#' -e '^$' | LC_ALL=C sort) >/dev/null \
    || trace_release_fail 'release source differs from its public manifest' || return 1

  for path in "${forbidden_paths[@]}"; do
    [[ ! -e "$source_dir/$path" ]] \
      || trace_release_fail "forbidden public path is present: $path" || return 1
  done

  historical_name='re''loop'
  private_checkout='/opt/'"TRACE"
  if git -C "$source_dir" grep -I -i -q -e "$historical_name" -- . \
    || git -C "$source_dir" grep -I -q -e "$private_checkout" \
      -e 'BEGIN [A-Z ]*PRIVATE KEY' -- .; then
    trace_release_fail 'release source contains a forbidden confidential pattern'
    return 1
  fi
}
