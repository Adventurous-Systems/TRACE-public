#!/usr/bin/env bash
set -euo pipefail

# Scan one exact local release image. Reports are retained inside the immutable
# release directory and their hashes are bound into images.env by prepare-release.

IMAGE="${1:-}"
EXPECTED_ID="${2:-}"
OUTPUT_DIR="${3:-}"
TRIVY_BIN="${TRACE_TRIVY_BIN:-/usr/local/bin/trivy}"

fail() { echo "Image scan failed: $*" >&2; exit 1; }

[[ -n "$IMAGE" && "$EXPECTED_ID" =~ ^sha256:[0-9a-f]{64}$ && -n "$OUTPUT_DIR" ]] \
  || fail 'usage: scan-image.sh <image-tag> <image-id> <output-dir>'
[[ -x "$TRIVY_BIN" ]] || fail "trusted Trivy binary is missing: $TRIVY_BIN"
for command in docker jq mkdir sha256sum; do
  command -v "$command" >/dev/null || fail "missing command: $command"
done

actual_id="$(docker image inspect "$IMAGE" --format '{{.Id}}')"
[[ "$actual_id" == "$EXPECTED_ID" ]] || fail 'image ID does not match the release receipt'

version_json="$($TRIVY_BIN version --format json)"
version="$(jq -r '.Version // empty' <<<"$version_json")"
db_updated_at="$(jq -r '.VulnerabilityDB.UpdatedAt // empty' <<<"$version_json")"
[[ "$version" == 0.74.0 ]] || fail "unexpected Trivy version: ${version:-missing}"
[[ "$db_updated_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] \
  || fail 'Trivy vulnerability database timestamp is missing'

umask 077
mkdir -p "$OUTPUT_DIR"
sbom="$OUTPUT_DIR/sbom.cdx.json"
report="$OUTPUT_DIR/scan.json"
metadata="$OUTPUT_DIR/metadata.env"

$TRIVY_BIN image --scanners vuln --format cyclonedx --output "$sbom" "$IMAGE"
$TRIVY_BIN image --scanners vuln --format json --output "$report" "$IMAGE"

finding_count="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$report")"
[[ "$finding_count" == 0 ]] || fail "$IMAGE has $finding_count HIGH/CRITICAL vulnerability finding(s)"

{
  printf 'TRACE_SCANNER=trivy\n'
  printf 'TRACE_SCANNER_VERSION=%s\n' "$version"
  printf 'TRACE_SCANNER_DB_UPDATED_AT=%s\n' "$db_updated_at"
  printf 'TRACE_IMAGE_ID=%s\n' "$actual_id"
  printf 'TRACE_SBOM_SHA256=%s\n' "$(sha256sum "$sbom" | awk '{print $1}')"
  printf 'TRACE_SCAN_SHA256=%s\n' "$(sha256sum "$report" | awk '{print $1}')"
} > "$metadata"
chmod 400 "$sbom" "$report" "$metadata"

echo "Image scan passed: $IMAGE ($actual_id)"
