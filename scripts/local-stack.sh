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
#   pnpm stack check       check the data invariants of the stack's database (read-only)
#   pnpm stack upgrade [ref]  rehearse the upgrade from a release (default origin/main)
#   pnpm stack rehearse    the whole rehearsal: tests, journeys, probes, checks, upgrade
#   pnpm stack reset --yes stop everything and delete all local stack data (rehearsal evidence is kept)
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
    # Stored files live in the stack's own directory; with no nginx in front,
    # the API serves them at /minio/, the path a deployment's nginx uses.
    "STORAGE_DIR=$STATE/objects"
    "STORAGE_SERVE=true"
    "STORAGE_PUBLIC_URL=http://localhost:$API_PORT/minio"
    # One rehearsal makes more requests in a minute than a visitor's limit.
    "RATE_LIMIT_MAX=5000"
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

# The commit of the working tree, marked when it has uncommitted changes.
current_sha() {
  local sha
  sha=$(git -C "$repo_root" rev-parse --short=12 HEAD 2>/dev/null) || { echo unknown; return 0; }
  [[ -z "$(git -C "$repo_root" status --porcelain 2>/dev/null)" ]] || sha+="-dirty"
  echo "$sha"
}

build() {
  say 'building (pnpm build)'
  # .env sets NODE_ENV=development, which breaks Next's production build.
  (cd "$repo_root" && env -u NODE_ENV pnpm build >"$STATE/build.log" 2>&1) \
    || die "build failed; see $STATE/build.log (did you run 'pnpm install'?)"
  # What the running stack was built from; every rehearsal report names it.
  current_sha > "$STATE/built-sha"
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
  mkdir -p "$STATE/objects"
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
  [[ -s "$STATE/built-sha" ]] && echo "built from: $(<"$STATE/built-sha")"
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

check_invariants() {
  (load_api_env; cd "$repo_root" && pnpm -s --filter @trace/db check:invariants -- --env local "$@")
}

# storage-import into the upgrade rehearsal's own store, from MinIO directly.
upgrade_storage_import() {
  local url=$1 objects=$2 minio_port=$3
  (set -a; # shellcheck disable=SC1090
   source "$ENV_FILE"; set +a
   export DATABASE_URL="$url" TRACE_ENV=local STORAGE_DIR="$objects" \
     STORAGE_PUBLIC_URL="http://localhost:$API_PORT/minio"
   cd "$repo_root" && pnpm -s --filter @trace/db storage:import -- --env local --yes \
     --origin "http://localhost:${minio_port:-19000}") 2>&1 | sed 's/^/    /'
}

# Every file a passport refers to has a ledger row (and so a file on disk).
upgrade_storage_check() {
  local db=$1 missing
  missing=$(compose exec -T postgres psql -U trace -d "$db" -tA -c "
    with refs as (
      select qr_code_url as u from material_passports where qr_code_url is not null
      union
      select jsonb_array_elements_text(coalesce(condition_photos, '[]'::jsonb)) from material_passports
    )
    select count(*) from refs where refs.u like '%/minio/%' and not exists (
      select 1 from stored_objects s where refs.u like '%/minio/' || s.bucket || '/' || s.key)")
  echo "    /minio/ files referenced but not in the file store: $missing"
  [[ "$missing" == 0 ]]
}

# Build the given release in a scratch worktree and database, give it orders
# in every state the old model could leave, then apply this checkout's
# migrations to it and check the result. Nothing here touches the stack's own
# database.
upgrade_rehearsal() {
  need_env_file
  local base="${1:-origin/main}" db='trace_upgrade' user='trace' port work="$STATE/upgrade-base"
  port=$(env_value POSTGRES_HOST_PORT)
  local url="postgresql://$user:$user@localhost:${port:-5432}/$db"
  local fixtures="$repo_root/packages/db/scripts/upgrade-fixtures"
  local -a psql=(compose exec -T postgres psql -U "$user" -v ON_ERROR_STOP=1 -q)
  local failed=0

  say "upgrade rehearsal: $base → $(current_sha)"
  # The previous release stores its files in MinIO (R4), with URLs shaped as
  # a deployment's: <origin>/minio/<bucket>/<key>.
  compose up -d --wait --wait-timeout 120 minio >>"$STATE/compose.log" 2>&1 \
    || die "MinIO did not become healthy; see $STATE/compose.log"
  local minio_port objects="$STATE/upgrade-objects"
  minio_port=$(env_value MINIO_HOST_PORT)
  local -a old_release_env=(
    "MINIO_PUBLIC_URL=http://localhost:$API_PORT/minio" "MINIO_PUBLIC_READ=true"
  )
  rm -rf -- "${objects:?}"
  mkdir -p "$objects"
  "${psql[@]}" -d trace -c "drop database if exists $db" >/dev/null
  "${psql[@]}" -d trace -c "create database $db" >/dev/null
  git -C "$repo_root" worktree remove --force "$work" >/dev/null 2>&1 || true
  rm -rf -- "${work:?}"
  git -C "$repo_root" worktree add --detach "$work" "$base" >/dev/null 2>&1 \
    || die "cannot check out $base"

  say "building and seeding $base"
  (set -a; # shellcheck disable=SC1090
   source "$ENV_FILE"; set +a
   export DATABASE_URL="$url" TRACE_ENV=local "${old_release_env[@]}"
   cd "$work"
   pnpm install --frozen-lockfile --prefer-offline \
     && pnpm --filter @trace/core --filter @trace/db build \
     && pnpm --filter @trace/db migrate \
     && pnpm --filter @trace/db seed \
     && pnpm --filter @trace/db seed:products) >"$STATE/upgrade-base.log" 2>&1 \
    || die "building or seeding $base failed; see $STATE/upgrade-base.log"

  say "adding data as $base can leave it"
  "${psql[@]}" -d "$db" -tA < "$fixtures/before.sql" | sed 's/^/    /'

  local round
  for round in 1 2; do
    say "applying this checkout's migrations (run $round of 2)"
    (set -a; # shellcheck disable=SC1090
     source "$ENV_FILE"; set +a
     export DATABASE_URL="$url" TRACE_ENV=local
     cd "$repo_root"
     pnpm --filter @trace/db migrate >/dev/null \
       && pnpm -s --filter @trace/db check:invariants -- --env local) || failed=1
  done

  say 'checking what the migrations did with that data'
  "${psql[@]}" -d "$db" -tA < "$fixtures/after.sql" | sed 's/^/    /' || failed=1

  # What a deployment runs once after the deploy: copy the old release's files
  # out of MinIO into the file store, recording each.
  say "copying the $base release's files out of MinIO (storage-import)"
  upgrade_storage_import "$url" "$objects" "$minio_port" || failed=1
  upgrade_storage_check "$db" || failed=1

  # The previous release serves traffic while a deploy migrates, and is the
  # rollback target afterwards, so it must still work on the new schema.
  # Replenishment makes it create lots, the write most likely to break.
  say "the $base release creating lots on the new schema"
  if (set -a; # shellcheck disable=SC1090
      source "$ENV_FILE"; set +a
      export DATABASE_URL="$url" TRACE_ENV=local "${old_release_env[@]}"
      cd "$work" && pnpm --filter @trace/db demo:replenish -- --env local --yes) \
      >"$STATE/upgrade-old-release.log" 2>&1; then
    (set -a; # shellcheck disable=SC1090
     source "$ENV_FILE"; set +a
     export DATABASE_URL="$url" TRACE_ENV=local
     cd "$repo_root" && pnpm -s --filter @trace/db check:invariants -- --env local) || failed=1
    # A rollback window: what the old release stored in MinIO is picked up by
    # running the import again.
    say 'storage-import again, for the files the old release just stored'
    upgrade_storage_import "$url" "$objects" "$minio_port" || failed=1
    upgrade_storage_check "$db" || failed=1
  else
    echo "    the $base release failed on the new schema; see $STATE/upgrade-old-release.log"
    failed=1
  fi

  say 'lots and orders after the upgrade'
  "${psql[@]}" -d "$db" -c "select left(p.product_name, 38) as lot, l.status as listing, l.quantity as qty, l.quantity_available as avail, coalesce(t.status, '-') as \"order\", t.quantity as order_qty, t.amount_pence as pence, p.status as passport from listings l join material_passports p on p.id = l.passport_id left join transactions t on t.listing_id = l.id where p.custom_attributes->>'seedSource' is not null order by 1, l.created_at"

  git -C "$repo_root" worktree remove --force "$work" >/dev/null 2>&1 || true
  "${psql[@]}" -d trace -c "drop database if exists $db" >/dev/null
  rm -rf -- "${objects:?}"
  return "$failed"
}

# Every part of a milestone rehearsal, in one run. Each part's output is kept
# and a failing part never stops the rest: the point is the full picture.
rehearse() {
  need_env_file
  [[ -s "$STATE/built-sha" ]] || die 'the stack has not been built; run: pnpm stack up'
  local sha out
  sha=$(<"$STATE/built-sha")
  out="$STATE/rehearsal/$sha-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$out"
  : > "$out/summary.md"
  [[ "$sha" == "$(current_sha)" ]] \
    || echo "- **Warning:** the stack was built from $sha, but the checkout is now $(current_sha)." >> "$out/summary.md"

  part() {
    local name=$1; shift
    say "$name"
    # A subshell, so a part that gives up (die) ends only itself.
    if ("$@") >"$out/$name.log" 2>&1; then
      echo "- $name: passed" >> "$out/summary.md"
    else
      echo "- **$name: FAILED** (see $name.log)" >> "$out/summary.md"
      echo "    $name FAILED; see $out/$name.log"
    fi
  }
  e2e() {
    (load_api_env
     export E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_API_URL="http://localhost:$API_PORT"
     export E2E_CURATED_ONLY=1 REHEARSAL_OUT="$out/evidence" REHEARSAL_COMMIT="$sha"
     # The time-limit probes move a deadline into the past; no API can.
     export REHEARSAL_PSQL="docker compose --env-file $ENV_FILE -f $repo_root/docker-compose.yml exec -T postgres psql -U trace -d trace -tAc"
     cd "$repo_root/packages/e2e" && "$@")
  }
  restore_data() {
    (load_api_env; cd "$repo_root" && pnpm --filter @trace/db demo:restore -- --env local --yes)
  }

  part restore-before restore_data
  part invariants-before check_invariants
  part tests run_tests
  part e2e-suite e2e pnpm exec playwright test --reporter=list
  # The suite leaves its own orders on curated lots; the journeys start clean.
  part restore-before-journeys restore_data
  part journeys-and-probes e2e pnpm -s rehearse
  part explore e2e pnpm -s explore
  cp "$repo_root"/packages/e2e/qa-report.* "$out/" 2>/dev/null || true
  part invariants-after check_invariants
  part upgrade upgrade_rehearsal

  echo
  echo "Rehearsal of $sha:"
  cat "$out/summary.md"
  echo
  echo "Evidence: $out (journeys and probes: evidence/report.md)"
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
    say 'starting postgres, redis and thor-solo'
    compose up -d --wait --wait-timeout 180 postgres redis thor-solo >"$STATE/compose.log" 2>&1 \
      || die "containers did not become healthy; see $STATE/compose.log"
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
  check) check_invariants "$@" ;;
  upgrade) upgrade_rehearsal "$@" ;;
  rehearse) rehearse ;;
  reset)
    [[ "${1:-}" == --yes ]] || die 'reset deletes the local database, chain and files; pass --yes'
    stop
    [[ -f "$STATE/compose.override.yml" ]] && compose down -v >/dev/null 2>&1 || true
    # Rehearsal evidence outlives the stack it was gathered on: a round starts
    # from a reset, and its findings refer back to earlier rounds.
    kept=''
    if [[ -d "$STATE/rehearsal" ]]; then
      kept=$(mktemp -d "${STATE%/*}/.local-stack-rehearsal.XXXXXX")
      mv "$STATE/rehearsal" "$kept/rehearsal"
    fi
    rm -rf -- "${STATE:?}"
    if [[ -n "$kept" ]]; then
      mkdir -p "$STATE" && chmod 700 "$STATE"
      mv "$kept/rehearsal" "$STATE/rehearsal" && rmdir "$kept"
    fi ;;
  *) sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [[ -z "$command" ]] || exit 2 ;;
esac
