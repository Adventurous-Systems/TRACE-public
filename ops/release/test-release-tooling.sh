#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PREPARE="$SCRIPT_DIR/prepare-release.sh"
VERIFY="$SCRIPT_DIR/verify-release.sh"
TEST_ROOT="$(mktemp -d /tmp/trace-release-tooling.XXXXXX)"

cleanup() {
  case "$TEST_ROOT" in
    /tmp/trace-release-tooling.*) chmod -R u+w "$TEST_ROOT" 2>/dev/null || true; rm -rf -- "$TEST_ROOT" ;;
    *) echo 'Refusing to remove unexpected test directory.' >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

expect_failure() {
  local label="$1"
  shift
  if "$@" >"$TEST_ROOT/failure.out" 2>&1; then
    echo "Expected failure did not occur: $label" >&2
    exit 1
  fi
  printf 'ok - %s\n' "$label"
}

fixture="$TEST_ROOT/fixture"
remote="$TEST_ROOT/public.git"
releases="$TEST_ROOT/releases"
fake_bin="$TEST_ROOT/bin"
fake_state="$TEST_ROOT/docker-state"
mkdir -p "$fixture" "$fake_bin" "$fake_state"

git -C "$fixture" init --quiet --initial-branch=main
git -C "$fixture" config user.name 'Release Test'
git -C "$fixture" config user.email 'release-test@example.invalid'
for component in api web ops; do
  printf 'FROM scratch\n' > "$fixture/Dockerfile.$component"
done
printf 'committed\n' > "$fixture/committed.txt"
printf '/opt/trace-public-demo/releases/<sha>\n' > "$fixture/public-deployment-path.txt"
printf '%s\n' \
  Dockerfile.api Dockerfile.ops Dockerfile.web PUBLIC_MANIFEST.txt committed.txt \
  public-deployment-path.txt \
  > "$fixture/PUBLIC_MANIFEST.txt"
git -C "$fixture" add .
git -C "$fixture" commit --quiet -m 'Public fixture'
git clone --quiet --bare "$fixture" "$remote"
git -C "$fixture" remote add origin "$remote"
release_sha="$(git -C "$fixture" rev-parse HEAD)"
printf 'must-not-deploy\n' > "$fixture/working-tree-only.txt"

cat > "$fake_bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
state="${TRACE_FAKE_DOCKER_STATE:?}"
state_file() { printf '%s/%s\n' "$state" "${1//[:\/]/_}"; }

if [[ "${1:-} ${2:-}" == 'image inspect' ]]; then
  image="${3:-}"
  file="$(state_file "$image")"
  [[ -f "$file" ]] || exit 1
  format=''
  [[ "${4:-}" == --format ]] && format="${5:-}"
  case "$format" in
    '') exit 0 ;;
    '{{.Id}}') sed -n 's/^ID=//p' "$file" ;;
    *org.opencontainers.image.revision*) sed -n 's/^REVISION=//p' "$file" ;;
    *org.opencontainers.image.source*) sed -n 's/^SOURCE=//p' "$file" ;;
    '{{.Config.User}}') sed -n 's/^USER=//p' "$file" ;;
    *) echo "Unsupported inspect format: $format" >&2; exit 2 ;;
  esac
  exit 0
fi

if [[ "${1:-}" == build ]]; then
  shift
  tag=''
  revision=''
  source_label=''
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --file) shift 2 ;;
      --tag) tag="$2"; shift 2 ;;
      --label)
        case "$2" in
          org.opencontainers.image.revision=*) revision="${2#*=}" ;;
          org.opencontainers.image.source=*) source_label="${2#*=}" ;;
        esac
        shift 2
        ;;
      *) shift ;;
    esac
  done
  component="${tag#trace-demo-}"
  component="${component%%:*}"
  [[ "${TRACE_FAKE_FAIL_COMPONENT:-}" != "$component" ]] || exit 42
  case "$component" in
    api) digit=a; user=node ;;
    web) digit=b; user=nextjs ;;
    ops) digit=c; user=node ;;
    *) exit 2 ;;
  esac
  file="$(state_file "$tag")"
  {
    printf 'ID=sha256:%064s\n' "$digit" | tr ' ' "$digit"
    printf 'REVISION=%s\nSOURCE=%s\nUSER=%s\n' "$revision" "$source_label" "$user"
  } > "$file"
  printf '%s\n' "$component" >> "$state/build-order"
  exit 0
fi

if [[ "${1:-} ${2:-}" == 'image rm' ]]; then
  rm -f -- "$(state_file "${3:-}")"
  exit 0
fi

echo "Unsupported fake Docker invocation: $*" >&2
exit 2
FAKE_DOCKER
chmod 755 "$fake_bin/docker"

common_env=(
  TRACE_RELEASE_TEST_MODE=1
  TRACE_RELEASE_ROOT="$releases"
  TRACE_PUBLIC_REPOSITORY_URL="file://$remote"
  TRACE_PUBLIC_SOURCE_LABEL=https://example.invalid/public
  TRACE_FAKE_DOCKER_STATE="$fake_state"
  PATH="$fake_bin:$PATH"
)

expect_failure 'floating branch name is rejected' env -i "${common_env[@]}" "$PREPARE" main
expect_failure 'uppercase SHA is rejected' env -i "${common_env[@]}" "$PREPARE" "${release_sha^^}"
expect_failure 'secret-bearing build environment is rejected' \
  env -i "${common_env[@]}" JWT_SECRET=not-for-build "$PREPARE" "$release_sha"

env -i "${common_env[@]}" "$PREPARE" "$release_sha"
release_dir="$releases/$release_sha"
receipt="$release_dir/images.env"
test -d "$release_dir/source"
test ! -e "$release_dir/source/working-tree-only.txt"
test "$(find "$release_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort | paste -sd, -)" = images.env,source
test "$(git -C "$release_dir/source" rev-parse HEAD)" = "$release_sha"
test -z "$(git -C "$release_dir/source" remote)"
test "$(git -C "$release_dir/source" config --local --get core.hooksPath)" = /dev/null
test -z "$(find "$release_dir/source/.git/hooks" -mindepth 1 -print -quit)"
test "$(stat -c '%a' "$receipt")" = 400
test "$(paste -sd, "$fake_state/build-order")" = api,web,ops
grep -q 'env -i PATH=' "$PREPARE"
env -i "${common_env[@]}" "$VERIFY" "$release_sha"
printf 'ok - exact remote SHA creates a clean immutable release\n'

chmod u+w "$release_dir"
chmod u+w "$receipt"
cp "$receipt" "$TEST_ROOT/images.env.good"
sed -i 's/^TRACE_API_IMAGE=.*/TRACE_API_IMAGE=trace-demo-api:changed/' "$receipt"
expect_failure 'changed release tag is rejected' env -i "${common_env[@]}" "$VERIFY" "$release_sha"
cp "$TEST_ROOT/images.env.good" "$receipt"
chmod 400 "$receipt"

api_state="$fake_state/trace-demo-api_$release_sha"
cp "$api_state" "$TEST_ROOT/api-state.good"
sed -i 's/^ID=.*/ID=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd/' "$api_state"
expect_failure 'image ID mismatch is rejected' env -i "${common_env[@]}" "$VERIFY" "$release_sha"
cp "$TEST_ROOT/api-state.good" "$api_state"

chmod u+w "$release_dir/source/committed.txt"
printf 'dirty\n' >> "$release_dir/source/committed.txt"
expect_failure 'dirty release source is rejected' env -i "${common_env[@]}" "$VERIFY" "$release_sha"

printf 'second\n' >> "$fixture/committed.txt"
git -C "$fixture" add committed.txt
git -C "$fixture" commit --quiet -m 'Second public fixture'
git -C "$fixture" push --quiet origin main
second_sha="$(git -C "$fixture" rev-parse HEAD)"
expect_failure 'failed sequential build leaves no release or image tag' \
  env -i "${common_env[@]}" TRACE_FAKE_FAIL_COMPONENT=web "$PREPARE" "$second_sha"
test ! -e "$releases/$second_sha"
test ! -e "$fake_state/trace-demo-api_$second_sha"

printf '/opt/%s\n' TRACE > "$fixture/private-checkout-path.txt"
printf 'private-checkout-path.txt\n' >> "$fixture/PUBLIC_MANIFEST.txt"
git -C "$fixture" add PUBLIC_MANIFEST.txt private-checkout-path.txt
git -C "$fixture" commit --quiet -m 'Add forbidden private checkout path'
git -C "$fixture" push --quiet origin staging
private_path_sha="$(git -C "$fixture" rev-parse HEAD)"
expect_failure 'exact private checkout path is rejected' \
  env -i "${common_env[@]}" "$PREPARE" "$private_path_sha"
test ! -e "$releases/$private_path_sha"
test ! -e "$fake_state/trace-demo-api_$private_path_sha"

printf 'All source release tooling tests passed.\n'
