#!/usr/bin/env bash
# Black-box tests for local-stack.sh. docker, pnpm, node and curl are fakes on
# PATH that log their calls; nothing real is built, started or deleted.
set -Eeuo pipefail
# Never exit silently: name the line and command that failed.
trap 'echo "FAIL: line $LINENO: $BASH_COMMAND" >&2' ERR

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
echo "pnpm $* | NODE_ENV=${NODE_ENV-unset} TRACE_ENV=${TRACE_ENV-} SIM=${DEMO_SIMULATE_ANCHOR-} REG=${MATERIAL_REGISTRY_ADDRESS-} DB=${DATABASE_URL##*/} CURATED=${E2E_CURATED_ONLY-} KEY_OK=$([[ "${DEPLOYER_PRIVATE_KEY-}" == "$TEST_KEY" ]] && echo yes || echo no)" >> "$TEST_LOG"
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
# git: a fixed commit, a clean tree, and a worktree that is just a directory.
cat > "$bin/git" <<'FAKE'
#!/usr/bin/env bash
echo "git $*" >> "$TEST_LOG"
case "$*" in
  *rev-parse*) echo abc123def456 ;;
  *'worktree add'*) mkdir -p "$6" ;;
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
line_of() { grep -n -- "$1" "$log" | head -1 | cut -d: -f1 || true; }

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
# The processes start in the background and log their own start
# asynchronously; wait for all three before reading the call order.
for _ in $(seq 1 50); do
  [[ $(grep -cE '^node (dist/index.js|dist/worker.js|node_modules/next)' "$log") -ge 3 ]] && break
  sleep 0.1
done
b=$(line_of 'pnpm build'); g=$(line_of 'solo-genesis'); c=$(line_of 'compose .* up -d --wait')
r=$(line_of 'chain-deploy-registry'); m=$(line_of 'pnpm --filter @trace/db migrate')
s=$(line_of 'demo:restore -- --env local --yes'); a=$(line_of 'node dist/index.js')
[[ -n "$b" && -n "$g" && -n "$c" && -n "$r" && -n "$m" && -n "$s" && -n "$a" ]] || fail 'up skipped a step'
(( b < g && g < c && c < r && r < m && m < s && s < a )) || fail 'up ran its steps out of order'
grep -q 'pnpm build | NODE_ENV=unset' "$log" || fail 'the build must run without NODE_ENV'
grep -q "demo:restore -- --env local --yes | NODE_ENV=production TRACE_ENV=local SIM=false REG=$registry .* KEY_OK=yes" "$log" \
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
  pid=$(<"$tmp/state/$name.pid")
  for _ in $(seq 1 50); do
    ps -o args= -p "$pid" | grep -q "fake-long-running-$$" && break
    sleep 0.1
  done
  ps -o args= -p "$pid" | grep -q "fake-long-running-$$" \
    || fail "$name.pid must be the $name process, not a wrapper"
done
# up must return even when its output is piped (no process holds the pipe).
stack stop
timeout 20 bash -c 'env "$@" | cat >/dev/null' _ PATH="$bin:$PATH" TEST_LOG="$log" TEST_KEY="$key" \
  TEST_REGISTRY="$registry" TEST_PID=$$ TRACE_LOCAL_STACK_DIR="$tmp/state" TRACE_LOCAL_ENV_FILE="$envfile" \
  "$STACK" start || fail 'start must not hold its output pipe open'

# status names the commit the stack was built from.
[[ "$(stack status)" == *'built from: abc123def456'* ]] || fail 'status must name the built commit'

# check runs the read-only invariant check against the stack's database.
: > "$log"
stack check >/dev/null || fail 'check failed'
grep -q 'check:invariants -- --env local | NODE_ENV=production' "$log" || fail 'check must use the stack environment'

# rehearse runs every part, keeps each log, and never stops at a failing one.
: > "$log"
summary=$(stack rehearse) || fail 'rehearse failed'
for part in restore-before invariants-before tests e2e-suite journeys-and-probes explore invariants-after upgrade; do
  [[ "$summary" == *"- $part: passed"* ]] || fail "rehearse must run and report $part"
done
grep -q 'pnpm -s rehearse | .* CURATED=1 ' "$log" || fail 'journeys must run against the stack as the curated-only demo'
grep -q 'pnpm test | .* DB=trace_test ' "$log" || fail 'tests must use trace_test'
grep -q 'migrate | .* DB=trace_upgrade ' "$log" || fail 'the upgrade must run in its scratch database'
grep -q 'demo:replenish -- --env local --yes | .* DB=trace_upgrade ' "$log" \
  || fail 'the upgrade must prove the previous release works on the new schema'
! grep -q 'demo:restore .* DB=trace_upgrade' "$log" || fail 'the upgrade rehearsal must not restore'
grep -q 'docker compose .* psql .* drop database if exists trace_upgrade' "$log" || fail 'the scratch database must be dropped'
evidence=$(ls -d "$tmp/state/rehearsal"/abc123def456-*)
[[ -s "$evidence/summary.md" && -f "$evidence/upgrade.log" ]] || fail 'rehearse must keep its evidence'
# A failing part is reported and the rest still run.
cat > "$bin/pnpm.fail" <<'FAKE'
#!/usr/bin/env bash
[[ "$*" == *check:invariants* ]] && exit 1
exec "$(dirname "$0")/pnpm.real" "$@"
FAKE
chmod 755 "$bin/pnpm.fail"; mv "$bin/pnpm" "$bin/pnpm.real"; mv "$bin/pnpm.fail" "$bin/pnpm"
summary=$(stack rehearse) || fail 'rehearse must not fail when a part does'
[[ "$summary" == *'invariants-before: FAILED'* && "$summary" == *'- explore: passed'* ]] \
  || fail 'a failing part must be reported without stopping the rest'
mv "$bin/pnpm.real" "$bin/pnpm"

# A second up keeps the chain identity, the registry and the data.
: > "$log"
stack stop
stack up >/dev/null || fail 'second up failed'
! grep -qE 'solo-genesis|chain-deploy-registry|db seed' "$log" || fail 'a second up must not redo one-time steps'
grep -q 'pnpm --filter @trace/db migrate' "$log" || fail 'every up must apply new migrations'
: > "$log"
stack rebuild >/dev/null || fail 'rebuild failed'
grep -q 'pnpm --filter @trace/db migrate' "$log" || fail 'rebuild must apply new migrations'
stack stop
[[ "$(stack status)" == *'api: stopped'* ]] || fail 'stop must stop the API'

# reset --yes removes the containers' volumes and the state.
: > "$log"
stack reset --yes || fail 'reset --yes failed'
grep -q 'compose .* down -v' "$log" || fail 'reset must remove the volumes'
[[ ! -e "$tmp/state/api.env" && ! -e "$tmp/state/chain" ]] || fail 'reset must delete the stack state'
[[ -s "$evidence/summary.md" ]] || fail 'reset must keep rehearsal evidence'
[[ "$(ls -A "$tmp/state")" == rehearsal ]] || fail 'reset must leave nothing but the evidence'

echo "local-stack tests passed"
