#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SCAN="$SCRIPT_DIR/scan-image.sh"
TEST_ROOT="$(mktemp -d /tmp/trace-scan-image.XXXXXX)"

cleanup() {
  case "$TEST_ROOT" in
    /tmp/trace-scan-image.*) rm -rf -- "$TEST_ROOT" ;;
    *) echo 'Refusing to remove unexpected test directory.' >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

fake_bin="$TEST_ROOT/bin"
mkdir -p "$fake_bin"

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' '[[ "${1:-} ${2:-}" == "image inspect" ]] || exit 2'
  printf '%s\n' '[[ "${3:-}" == trace-demo-api:test ]] || exit 2'
  printf '%s\n' '[[ "${4:-}" == --format && "${5:-}" == "{{.Id}}" ]] || exit 2'
  printf '%s\n' "printf 'sha256:%064d\\n' 1"
} > "$fake_bin/docker"
chmod 755 "$fake_bin/docker"

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' 'if [[ "${1:-}" == version ]]; then'
  printf '%s\n' '  [[ "${HOME:-}" == /root ]] || { printf "{\"Version\":\"0.74.0\"}\n"; exit 0; }'
  printf '%s\n' '  printf "{\"Version\":\"0.74.0\",\"VulnerabilityDB\":{\"UpdatedAt\":\"2026-09-15T00:00:00Z\"}}\n"'
  printf '%s\n' '  exit 0'
  printf '%s\n' 'fi'
  printf '%s\n' 'output=""; format=""'
  printf '%s\n' 'while [[ "$#" -gt 0 ]]; do'
  printf '%s\n' '  case "$1" in'
  printf '%s\n' '    --format) format="$2"; shift 2 ;;'
  printf '%s\n' '    --output) output="$2"; shift 2 ;;'
  printf '%s\n' '    *) shift ;;'
  printf '%s\n' '  esac'
  printf '%s\n' 'done'
  printf '%s\n' '[[ -n "$output" ]] || exit 2'
  printf '%s\n' 'case "$format" in'
  printf '%s\n' '  cyclonedx) printf "{\"bomFormat\":\"CycloneDX\"}\n" > "$output" ;;'
  printf '%s\n' '  json) printf "{\"Results\":[]}\n" > "$output" ;;'
  printf '%s\n' '  *) exit 2 ;;'
  printf '%s\n' 'esac'
} > "$fake_bin/trivy"
chmod 755 "$fake_bin/trivy"

output_dir="$TEST_ROOT/output"
env -u HOME PATH="$fake_bin:$PATH" TRACE_TRIVY_BIN="$fake_bin/trivy" \
  "$SCAN" trace-demo-api:test "sha256:$(printf '%064d' 1)" "$output_dir"

test "$(awk -F= '$1 == "TRACE_SCANNER_DB_UPDATED_AT" {print $2}' "$output_dir/metadata.env")" = \
  2026-09-15T00:00:00Z
echo 'All scan-image tests passed.'
