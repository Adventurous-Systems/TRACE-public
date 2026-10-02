#!/usr/bin/env bash
# Run the whole demo on this machine, anchoring on a local Thor Solo chain, for
# manual testing before a milestone is released.
#
#   pnpm stack up          build, start the containers, seed, deploy the registry, start
#   pnpm stack start|stop|restart|status
#   pnpm stack rebuild     build again, apply new migrations, restart the API, worker and web
#   pnpm stack logs <api|worker|web>
#   pnpm stack restore     put the curated demo data back (demo:restore, local only)
#   pnpm stack test        run the unit and integration tests against trace_test
#   pnpm stack reset --yes stop everything and delete all local stack data
#
# Web on http://localhost:3000, API on http://localhost:3001. The persona
# passwords are the DEMO_*_PASSWORD values in .env (see `pnpm env:init`).
#
# Everything it generates lives in .local-stack/ (gitignored): a chain identity
# of its own (deployer key and genesis, never reused anywhere else), the API
# environment, logs and PIDs. .env stays the source of the local credentials.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE="${TRACE_LOCAL_STACK_DIR:-$repo_root/.local-stack}"
ENV_FILE="${TRACE_LOCAL_ENV_FILE:-$repo_root/.env}"
API_ENV="$STATE/api.env"
WEB_PORT=3000
API_PORT=3001
NETWORK_LABEL='Local rehearsal chain (VeChain Thor Solo)'

die() { echo "local-stack: $*" >&2; exit 1; }
say() { echo "==> $*"; }

need_env_file() {
  [[ -f "$ENV_FILE" ]] || die "no $ENV_FILE; run 'pnpm env:init' first"
}

env_value() { awk -F= -v key="$1" '$1 == key {print substr($0, index($0, "=") + 1)}' "$ENV_FILE" | tail -1; }

compose() {
  local args=(-f "$repo_root/docker-compose.yml")
  [[ -f "$STATE/compose.override.yml" ]] && args+=(-f "$STATE/compose.override.yml")
  (cd "$repo_root" && docker compose --env-file "$ENV_FILE" "${args[@]}" "$@")
}

# The chain identity is created once and kept: replacing the key of a chain
# that already holds anchors strands them. `reset` removes both together.
ensure_chain_identity() {
  if [[ ! -f "$STATE/chain/deployer.key" ]]; then
    say 'creating a local chain identity'
    install -d -m 700 "$STATE/chain"
    (cd "$repo_root/packages/api" && node dist/scripts/solo-genesis.js "$STATE/chain") >/dev/null
  fi
  {
    echo 'services:'
    if [[ -n "${TRACE_LOCAL_MINIO_IMAGE:-}" ]]; then
      # For hosts that cannot pull the pinned MinIO mirror.
      echo '  minio:'
      echo "    image: $TRACE_LOCAL_MINIO_IMAGE"
    fi
    echo '  thor-solo:'
    echo '    volumes:'
    echo '      - thor-data:/home/thor'
    echo "      - $STATE/chain/genesis.json:/genesis.json:ro"
  } > "$STATE/compose.override.yml"
}

# api.env = .env with the settings of an on-chain demo deployment. Rewritten
# on every start, so a change to .env is picked up.
write_api_env() {
  need_env_file
  [[ -f "$STATE/chain/deployer.key" ]] || die 'no chain identity; run: pnpm stack up'
  local key registry='' thor_port
  key=$(<"$STATE/chain/deployer.key")
  [[ -f "$STATE/registry.env" ]] && registry=$(<"$STATE/registry.env")
  thor_port=$(env_value THOR_HOST_PORT)
  local -a overrides=(
    "NODE_ENV=production"
    "TRACE_ENV=local"
    "TRACE_DEPLOYMENT_PROFILE=public_buyer_demo"
    "DEMO_SIMULATE_ANCHOR=false"
    "ANCHOR_WORKER_ENABLED=false"
    "CHAIN_KIND=vechain"
    "CHAIN_NETWORK_LABEL=\"$NETWORK_LABEL\""
    "VECHAIN_NODE_URL=http://localhost:${thor_port:-8669}"
    "FEE_DELEGATION_REQUIRED=true"
    "DEPLOYER_PRIVATE_KEY=$key"
    "FEE_DELEGATOR_PRIVATE_KEY=$key"
    "MINIO_PUBLIC_READ=true"
    "API_PORT=$API_PORT"
    "WEB_URL=http://localhost:$WEB_PORT"
    "API_URL=http://localhost:$API_PORT"
    "MATERIAL_REGISTRY_ADDRESS=$registry"
  )
  local names
  names=$(printf '%s\n' "${overrides[@]}" | cut -d= -f1 | paste -sd'|')
  umask 077
  {
    grep -vE "^($names)=" "$ENV_FILE" || true
    echo '# ── local-stack overrides ──'
    printf '%s\n' "${overrides[@]}"
  } > "$API_ENV.tmp"
  mv "$API_ENV.tmp" "$API_ENV"
}

load_api_env() { set -a; # shellcheck disable=SC1090
  source "$API_ENV"; set +a; }

build() {
  say 'building (pnpm build)'
  # .env sets NODE_ENV=development, which breaks Next's production build.
  (cd "$repo_root" && env -u NODE_ENV pnpm build >"$STATE/build.log" 2>&1) \
    || die "build failed; see $STATE/build.log (did you run 'pnpm install'?)"
}

deploy_registry() {
  [[ -s "$STATE/registry.env" ]] && return 0
  say 'deploying MaterialRegistry to the local chain'
  local out
  out=$( (load_api_env; cd "$repo_root/packages/api" && node dist/scripts/chain-deploy-registry.js) ) \
    || die 'registry deployment failed'
  grep -oE 'MATERIAL_REGISTRY_ADDRESS=0x[0-9a-fA-F]{40}' <<<"$out" | cut -d= -f2 > "$STATE/registry.env"
  [[ -s "$STATE/registry.env" ]] || die 'registry deployment printed no address'
  write_api_env
}

migrate() {
  say 'applying database migrations'
  (load_api_env; cd "$repo_root" && pnpm --filter @trace/db migrate) >"$STATE/migrate.log" 2>&1 \
    || die "migration failed; see $STATE/migrate.log"
}

seed_once() {
  [[ -f "$STATE/seeded" ]] && return 0
  say 'seeding the local database'
  (load_api_env; cd "$repo_root" \
    && pnpm --filter @trace/db seed \
    && pnpm --filter @trace/db seed:products \
    && pnpm --filter @trace/db demo:restore -- --env local --yes) >"$STATE/seed.log" 2>&1 \
    || die "seeding failed; see $STATE/seed.log"
  touch "$STATE/seeded"
}

start_one() {
  local name=$1 dir=$2; shift 2
  local pidfile="$STATE/$name.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(<"$pidfile")" 2>/dev/null; then return 0; fi
  # exec, so the recorded PID is the process itself and stop kills exactly it.
  # Only the nohup command is backgrounded (not a subshell around it), and it
  # holds no inherited stdout, so the caller's pipe closes when `up` finishes.
  (
    load_api_env
    cd "$dir" || exit 1
    nohup bash -c 'exec "$@"' _ "$@" >"$STATE/$name.log" 2>&1 </dev/null &
    echo $! >"$pidfile"
  )
}

start() {
  write_api_env
  start_one api "$repo_root/packages/api" node dist/index.js
  start_one worker "$repo_root/packages/api" node dist/worker.js
  start_one web "$repo_root/packages/web" node node_modules/next/dist/bin/next start -p "$WEB_PORT"
  say 'waiting for the API and web'
  local i
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$API_PORT/health/ready" \
      && curl -sf -o /dev/null "http://localhost:$WEB_PORT/"; then
      say "ready: web http://localhost:$WEB_PORT, API http://localhost:$API_PORT"
      return 0
    fi
    sleep 2
  done
  die "not ready after 120 s; see $STATE/{api,worker,web}.log"
}

stop() {
  local name pidfile
  for name in web worker api; do
    pidfile="$STATE/$name.pid"
    [[ -f "$pidfile" ]] || continue
    local pid i
    pid=$(<"$pidfile")
    kill "$pid" 2>/dev/null || true
    # Wait for it to exit, so a restart finds its port free.
    for i in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    rm -f "$pidfile"
  done
}

status() {
  local name pidfile
  for name in api worker web; do
    pidfile="$STATE/$name.pid"
    if [[ -f "$pidfile" ]] && kill -0 "$(<"$pidfile")" 2>/dev/null; then
      echo "$name: running (pid $(<"$pidfile"))"
    else
      echo "$name: stopped"
    fi
  done
  [[ -s "$STATE/registry.env" ]] && echo "registry: $(<"$STATE/registry.env")"
  return 0
}

run_tests() {
  need_env_file
  local user='trace' port redis_port
  port=$(env_value POSTGRES_HOST_PORT)
  redis_port=$(env_value REDIS_HOST_PORT)
  local url="postgresql://$user:$user@localhost:${port:-5432}/trace_test"
  if ! compose exec -T postgres psql -U "$user" -d trace -tAc \
    "select 1 from pg_database where datname = 'trace_test'" | grep -q 1; then
    say 'creating the trace_test database'
    compose exec -T postgres psql -U "$user" -d trace -c 'create database trace_test' >/dev/null
  fi
  # Tests never share the manual-testing database or Redis database.
  (set -a; # shellcheck disable=SC1090
   source "$ENV_FILE"; set +a
   export DATABASE_URL="$url" REDIS_URL="redis://localhost:${redis_port:-6379}/1" TRACE_ENV=local
   cd "$repo_root"
   pnpm --filter @trace/db migrate >/dev/null
   pnpm --filter @trace/db seed >/dev/null
   pnpm test)
}

command="${1:-}"
shift || true
mkdir -p "$STATE"
chmod 700 "$STATE"
case "$command" in
  up)
    need_env_file
    build
    ensure_chain_identity
    say 'starting postgres, redis, minio and thor-solo'
    if ! compose up -d --wait --wait-timeout 180 postgres redis minio thor-solo >"$STATE/compose.log" 2>&1; then
      grep -q unauthorized "$STATE/compose.log" \
        && echo 'The MinIO mirror needs a registry login (docs/operations/minio-image-mirror.md), or set TRACE_LOCAL_MINIO_IMAGE to a local MinIO image.' >&2
      die "containers did not become healthy; see $STATE/compose.log"
    fi
    write_api_env
    deploy_registry
    migrate
    seed_once
    start ;;
  start) ensure_chain_identity; start ;;
  stop) stop ;;
  restart) stop; start ;;
  rebuild) build; write_api_env; migrate; stop; start ;;
  status) status ;;
  logs)
    case "${1:-}" in api|worker|web) tail -n 100 -f "$STATE/$1.log" ;; *) die 'usage: logs <api|worker|web>' ;; esac ;;
  restore)
    write_api_env
    (load_api_env; cd "$repo_root" && pnpm --filter @trace/db demo:restore -- --env local --yes) ;;
  test) run_tests ;;
  reset)
    [[ "${1:-}" == --yes ]] || die 'reset deletes the local database, chain and files; pass --yes'
    stop
    [[ -f "$STATE/compose.override.yml" ]] && compose down -v >/dev/null 2>&1 || true
    rm -rf -- "${STATE:?}" ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [[ -z "$command" ]] || exit 2 ;;
esac
