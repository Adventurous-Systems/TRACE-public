#!/usr/bin/env bash
# Black-box tests for local-stack.sh. docker, pnpm, node and curl are fakes on
# PATH that log their calls; nothing real is built, started or deleted.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STACK="$repo_root/scripts/local-stack.sh"
bash -n "$STACK"

tmp="$(mktemp -d)"
trap 'pkill -f "fake-long-running-$$" 2>/dev/null || true; [[ -n "${KEEP_TMP:-}" ]] || rm -rf -- "$tmp"' EXIT
bin="$tmp/bin"
log="$tmp/calls.log"
mkdir -p "$bin"
key=0x$(printf 'ab%.0s' {1..32})
registry=0x$(printf 'cd%.0s' {1..20})

cat > "$bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >> "$TEST_LOG"
FAKE
cat > "$bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
echo "pnpm $* | NODE_ENV=${NODE_ENV-unset} TRACE_ENV=${TRACE_ENV-} SIM=${DEMO_SIMULATE_ANCHOR-} REG=${MATERIAL_REGISTRY_ADDRESS-} KEY_OK=$([[ "${DEPLOYER_PRIVATE_KEY-}" == "$TEST_KEY" ]] && echo yes || echo no)" >> "$TEST_LOG"
FAKE
cat > "$bin/node" <<'FAKE'
#!/usr/bin/env bash
echo "node $*" >> "$TEST_LOG"
case "$1" in
  dist/scripts/solo-genesis.js)
    printf '%s' "$TEST_KEY" > "$2/deployer.key"; echo '{}' > "$2/genesis.json"; echo "Deployer 0xabc" ;;
  dist/scripts/chain-deploy-registry.js)
    echo "Chain: vechain:0x00"; echo "MATERIAL_REGISTRY_ADDRESS=$TEST_REGISTRY" ;;
  *) exec -a "fake-long-running-$TEST_PID" sleep 30 ;;
esac
FAKE
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$bin/curl"
chmod 755 "$bin"/*

envfile="$tmp/dot.env"
cat > "$envfile" <<'ENV'
COMPOSE_PROJECT_NAME=trace-test-stack
NODE_ENV=development
DEMO_SIMULATE_ANCHOR=true
DEPLOYER_PRIVATE_KEY=0xfromdotenv
TRACE_ENV=local
THOR_HOST_PORT=18669
POSTGRES_HOST_PORT=15432
ENV

stack() {
  env PATH="$bin:$PATH" TEST_LOG="$log" TEST_KEY="$key" TEST_REGISTRY="$registry" TEST_PID=$$ \
    TRACE_LOCAL_STACK_DIR="$tmp/state" TRACE_LOCAL_ENV_FILE="${ENV_FILE_UNDER_TEST:-$envfile}" \
    "$STACK" "$@"
}
fail() { echo "FAIL: $*" >&2; cat "$log" >&2 2>/dev/null || true; exit 1; }
line_of() { grep -n -- "$1" "$log" | head -1 | cut -d: -f1; }

# Without .env nothing runs.
: > "$log"
if ENV_FILE_UNDER_TEST="$tmp/missing.env" stack up 2>/dev/null; then fail 'up must refuse without .env'; fi
[[ ! -s "$log" ]] || fail 'nothing may run without .env'

# reset refuses without --yes and deletes nothing.
mkdir -p "$tmp/state" && touch "$tmp/state/keep"
if stack reset 2>/dev/null; then fail 'reset must require --yes'; fi
[[ -f "$tmp/state/keep" ]] || fail 'reset without --yes must not delete state'

# up: build, chain identity, containers, registry, seed, then the processes.
: > "$log"
stack up >/dev/null || fail 'up failed'
b=$(line_of 'pnpm build'); g=$(line_of 'solo-genesis'); c=$(line_of 'compose .* up -d --wait')
r=$(line_of 'chain-deploy-registry'); m=$(line_of 'pnpm --filter @trace/db migrate')
s=$(line_of 'demo:restore -- --env local --yes'); a=$(line_of 'node dist/index.js')
[[ -n "$b" && -n "$g" && -n "$c" && -n "$r" && -n "$m" && -n "$s" && -n "$a" ]] || fail 'up skipped a step'
(( b < g && g < c && c < r && r < m && m < s && s < a )) || fail 'up ran its steps out of order'
grep -q 'pnpm build | NODE_ENV=unset' "$log" || fail 'the build must run without NODE_ENV'
grep -q "demo:restore -- --env local --yes | NODE_ENV=production TRACE_ENV=local SIM=false REG=$registry KEY_OK=yes" "$log" \
  || fail 'seeding must see the on-chain API environment, registry included'
grep -q 'node node_modules/next/dist/bin/next start -p 3000' "$log" || fail 'web must start on 3000'

api_env="$tmp/state/api.env"
[[ "$(stat -c %a "$api_env")" == 600 ]] || fail 'api.env must be mode 600'
[[ "$(stat -c %a "$tmp/state")" == 700 ]] || fail 'the state directory must be mode 700'
for want in NODE_ENV=production DEMO_SIMULATE_ANCHOR=false "DEPLOYER_PRIVATE_KEY=$key" \
  "FEE_DELEGATOR_PRIVATE_KEY=$key" "MATERIAL_REGISTRY_ADDRESS=$registry" \
  VECHAIN_NODE_URL=http://localhost:18669 COMPOSE_PROJECT_NAME=trace-test-stack; do
  grep -qxF "$want" "$api_env" || fail "api.env lacks $want"
done
for name in NODE_ENV DEMO_SIMULATE_ANCHOR DEPLOYER_PRIVATE_KEY; do
  [[ $(grep -c "^$name=" "$api_env") == 1 ]] || fail "api.env must set $name exactly once"
done
grep -q "$tmp/state/chain/genesis.json:/genesis.json:ro" "$tmp/state/compose.override.yml" \
  || fail 'thor-solo must use the stack''s own genesis'
[[ "$(stack status)" == *'api: running'* ]] || fail 'status must show the API running'
for name in api worker web; do
  # The recorded PID must be the process itself, or stop leaves it running.
  ps -o args= -p "$(<"$tmp/state/$name.pid")" | grep -q "fake-long-running-$$" \
    || fail "$name.pid must be the $name process, not a wrapper"
done
# up must return even when its output is piped (no process holds the pipe).
stack stop
timeout 20 bash -c 'env "$@" | cat >/dev/null' _ PATH="$bin:$PATH" TEST_LOG="$log" TEST_KEY="$key" \
  TEST_REGISTRY="$registry" TEST_PID=$$ TRACE_LOCAL_STACK_DIR="$tmp/state" TRACE_LOCAL_ENV_FILE="$envfile" \
  "$STACK" start || fail 'start must not hold its output pipe open'

# A second up keeps the chain identity, the registry and the data.
: > "$log"
stack stop
stack up >/dev/null || fail 'second up failed'
! grep -qE 'solo-genesis|chain-deploy-registry|db seed' "$log" || fail 'a second up must not redo one-time steps'
grep -q 'pnpm --filter @trace/db migrate' "$log" || fail 'every up must apply new migrations'
stack stop
[[ "$(stack status)" == *'api: stopped'* ]] || fail 'stop must stop the API'

# reset --yes removes the containers' volumes and the state.
: > "$log"
stack reset --yes || fail 'reset --yes failed'
grep -q 'compose .* down -v' "$log" || fail 'reset must remove the volumes'
[[ ! -e "$tmp/state" ]] || fail 'reset must delete the state directory'

echo "local-stack tests passed"
