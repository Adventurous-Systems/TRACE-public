#!/usr/bin/env bash
set -euo pipefail

# Deploys the exact current public `main` tip to the inactive blue/green slot
# and switches traffic to it, or does nothing if `main` has not moved or only
# changed paths that never affect the running application.
#
# Takes no arguments: it resolves the target SHA itself so the trusted sudoers
# grant that runs this as root can be pinned to zero arguments. Every step
# below invokes an existing, separately reviewed installed primitive; this
# script only sequences them, generates the candidate environment file, and
# decides whether to switch and whether to roll back.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

readonly SOURCE_GIT_URL_DEFAULT='https://github.com/Adventurous-Systems/TRACE-public.git'
readonly PUBLIC_URL_DEFAULT='https://demo.trace.adventurous.systems'

if [[ "${TRACE_DEPLOY_TEST_MODE:-0}" == 1 && "$EUID" != 0 ]]; then
  CONFIG_DIR="${TRACE_DEPLOY_CONFIG_DIR:?TRACE_DEPLOY_CONFIG_DIR is required in test mode}"
  STATE_DIR="${TRACE_DEPLOY_STATE_DIR:?TRACE_DEPLOY_STATE_DIR is required in test mode}"
  RELEASE_ROOT="${TRACE_DEPLOY_RELEASE_ROOT:?TRACE_DEPLOY_RELEASE_ROOT is required in test mode}"
  LOCK_FILE="${TRACE_DEPLOY_LOCK_FILE:?TRACE_DEPLOY_LOCK_FILE is required in test mode}"
  PUBLIC_GIT_URL="${TRACE_PUBLIC_REPOSITORY_URL:?TRACE_PUBLIC_REPOSITORY_URL is required in test mode}"
  PUBLIC_URL="${TRACE_DEPLOY_PUBLIC_URL:-$PUBLIC_URL_DEFAULT}"
  PREPARE_RELEASE="${TRACE_DEPLOY_PREPARE_RELEASE:?required in test mode}"
  VERIFY_RELEASE="${TRACE_DEPLOY_VERIFY_RELEASE:?required in test mode}"
  PREFLIGHT="${TRACE_DEPLOY_PREFLIGHT:?required in test mode}"
  RUN_OPS="${TRACE_DEPLOY_RUN_OPS:?required in test mode}"
  START_CANDIDATE="${TRACE_DEPLOY_START_CANDIDATE:?required in test mode}"
  VERIFY_CANDIDATE="${TRACE_DEPLOY_VERIFY_CANDIDATE:?required in test mode}"
  SWITCH_NGINX="${TRACE_DEPLOY_SWITCH_NGINX:?required in test mode}"
  ROLLBACK_NGINX="${TRACE_DEPLOY_ROLLBACK_NGINX:?required in test mode}"
  PRUNE_RELEASES="${TRACE_DEPLOY_PRUNE_RELEASES:-$SCRIPT_DIR/prune-releases.sh}"
  DOCKER_BIN="${TRACE_DEPLOY_DOCKER:-docker}"
  PROBE_ATTEMPTS="${TRACE_DEPLOY_PROBE_ATTEMPTS:-12}"
  PROBE_SLEEP="${TRACE_DEPLOY_PROBE_SLEEP:-5}"
else
  [[ "$EUID" == 0 ]] || { echo 'This installed deploy command must run as root.' >&2; exit 1; }
  PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  export PATH
  unset TRACE_DEPLOY_TEST_MODE TRACE_DEPLOY_CONFIG_DIR TRACE_DEPLOY_STATE_DIR \
    TRACE_DEPLOY_RELEASE_ROOT TRACE_DEPLOY_LOCK_FILE TRACE_PUBLIC_REPOSITORY_URL \
    TRACE_DEPLOY_PUBLIC_URL
  CONFIG_DIR='/var/lib/trace-demo/config'
  STATE_DIR='/var/lib/trace-demo/state'
  RELEASE_ROOT='/opt/trace-public-demo/releases'
  LOCK_FILE='/run/lock/trace-public-demo-deploy.lock'
  PUBLIC_GIT_URL="$SOURCE_GIT_URL_DEFAULT"
  PUBLIC_URL="$PUBLIC_URL_DEFAULT"
  PREPARE_RELEASE='/usr/local/libexec/trace-demo/prepare-release.sh'
  VERIFY_RELEASE='/usr/local/libexec/trace-demo/verify-release.sh'
  PREFLIGHT='/usr/local/libexec/trace-demo/preflight.sh'
  RUN_OPS='/usr/local/libexec/trace-demo/run-ops.sh'
  START_CANDIDATE='/usr/local/libexec/trace-demo/start-candidate.sh'
  VERIFY_CANDIDATE='/usr/local/libexec/trace-demo/verify-candidate.sh'
  SWITCH_NGINX='/usr/local/libexec/trace-demo/switch-nginx.sh'
  ROLLBACK_NGINX='/usr/local/libexec/trace-demo/rollback-nginx.sh'
  PRUNE_RELEASES='/usr/local/libexec/trace-demo/prune-releases.sh'
  DOCKER_BIN='docker'
  PROBE_ATTEMPTS=12
  PROBE_SLEEP=5
fi
readonly CONFIG_DIR STATE_DIR RELEASE_ROOT LOCK_FILE PUBLIC_GIT_URL PUBLIC_URL
readonly PREPARE_RELEASE VERIFY_RELEASE PREFLIGHT RUN_OPS START_CANDIDATE
readonly VERIFY_CANDIDATE SWITCH_NGINX ROLLBACK_NGINX PRUNE_RELEASES DOCKER_BIN
readonly PROBE_ATTEMPTS PROBE_SLEEP

[[ "$#" == 0 ]] || { echo "Usage: $0" >&2; exit 2; }

fail() { echo "Deploy failed: $*" >&2; exit 1; }
value() { awk -F= -v key="$2" '$1 == key {print substr($0, index($0, "=") + 1)}' "$1" | tail -1; }
log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

for command in awk curl "$DOCKER_BIN" flock git mv readlink; do
  command -v "$command" >/dev/null || fail "missing command: $command"
done

install -d -m 700 "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || fail 'another TRACE public-demo deployment is already running'

ACTIVE_ENV_LINK="$CONFIG_DIR/active.env"
ACTIVE_CONF_LINK="$CONFIG_DIR/nginx/active.conf"
[[ -f "$ACTIVE_ENV_LINK" ]] || fail "active deployment environment is missing: $ACTIVE_ENV_LINK"

remote_line="$(git -c credential.helper= ls-remote --exit-code --refs "$PUBLIC_GIT_URL" refs/heads/main)" \
  || fail 'unable to resolve the public main tip'
target_sha="${remote_line%%$'\t'*}"
[[ "$target_sha" =~ ^[0-9a-f]{40}$ && "$remote_line" == "$target_sha"$'\trefs/heads/main' ]] \
  || fail 'resolved main tip is not a well-formed SHA'

live_env_file="$(readlink -f -- "$ACTIVE_ENV_LINK")"
[[ -f "$live_env_file" ]] || fail "active environment link is invalid: $ACTIVE_ENV_LINK"
live_sha="$(value "$live_env_file" TRACE_RELEASE_SHA)"
[[ "$live_sha" =~ ^[0-9a-f]{40}$ ]] || fail "active environment has no valid release SHA: $live_env_file"

if [[ "$target_sha" == "$live_sha" ]]; then
  log "already deployed: $target_sha"
  exit 0
fi

# --- Relevance filter --------------------------------------------------
# A merge that changes only documentation or repository metadata must not
# redeploy or churn the demo. The default is to deploy: any path not
# explicitly on this list is treated as code and triggers a release. Diffing
# against the currently LIVE sha (not the push's "before") means a run of
# doc-only commits followed by one code commit still deploys correctly.
is_ignored_path() {
  case "$1" in
    docs/*|*.md|LICENSE|.github/*|PUBLIC_MANIFEST.txt|.gitignore|.prettierignore|.gitleaks.toml)
      return 0 ;;
    *) return 1 ;;
  esac
}

relevance_dir="$(mktemp -d "${TMPDIR:-/tmp}/trace-deploy-relevance.XXXXXX")"
relevance_cleanup() { rm -rf -- "$relevance_dir"; }
trap relevance_cleanup EXIT

git -c init.defaultBranch=detached init --quiet "$relevance_dir"
relevance_fetch_ok=1
git -C "$relevance_dir" -c core.hooksPath=/dev/null -c credential.helper= \
  fetch --quiet --no-tags --depth=1 "$PUBLIC_GIT_URL" "$live_sha" \
  && git -C "$relevance_dir" -c core.hooksPath=/dev/null -c credential.helper= \
    fetch --quiet --no-tags --depth=1 "$PUBLIC_GIT_URL" "$target_sha" \
  || relevance_fetch_ok=0

relevant=1
if [[ "$relevance_fetch_ok" == 1 ]]; then
  relevant=0
  while IFS= read -r changed_path; do
    [[ -n "$changed_path" ]] || continue
    if ! is_ignored_path "$changed_path"; then
      relevant=1
      break
    fi
  done < <(git -C "$relevance_dir" diff --name-only "$live_sha" "$target_sha")
else
  log "relevance check could not fetch $live_sha..$target_sha; deploying (fail open)"
fi

relevance_cleanup
trap - EXIT

if [[ "$relevant" == 0 ]]; then
  log "documentation only, skipped: $live_sha -> $target_sha"
  exit 0
fi

# --- Slot selection ------------------------------------------------------
current_project="$(value "$live_env_file" COMPOSE_PROJECT_NAME)"
case "$current_project" in
  trace-demo-green) slot=blue; candidate_api_port=5004; candidate_web_port=5003 ;;
  trace-demo-blue) slot=green; candidate_api_port=5104; candidate_web_port=5103 ;;
  *) fail "unrecognized active Compose project: $current_project" ;;
esac
candidate_project="trace-demo-$slot"

runtime_network="$(value "$live_env_file" TRACE_RUNTIME_NETWORK)"
api_env_file="$(value "$live_env_file" TRACE_API_ENV_FILE)"
web_env_file="$(value "$live_env_file" TRACE_WEB_ENV_FILE)"
[[ -n "$runtime_network" && -n "$api_env_file" && -n "$web_env_file" ]] \
  || fail 'active environment is missing required fields'

log "deploying: live=$live_sha target=$target_sha slot=$slot"

# --- Release preparation --------------------------------------------------
if [[ -d "$RELEASE_ROOT/$target_sha" ]]; then
  "$VERIFY_RELEASE" "$target_sha"
else
  "$PREPARE_RELEASE" "$target_sha"
fi
receipt="$RELEASE_ROOT/$target_sha/images.env"
[[ -f "$receipt" ]] || fail "release receipt is missing after preparation: $receipt"

# --- Free the candidate slot -----------------------------------------------
# The inactive slot may still hold containers from an older generation
# (preflight refuses to start a candidate on an occupied port). The live slot
# is never touched by this, so a failure below always leaves it serving.
stale_containers="$("$DOCKER_BIN" ps -aq --filter "label=com.docker.compose.project=$candidate_project")"
if [[ -n "$stale_containers" ]]; then
  # shellcheck disable=SC2086
  "$DOCKER_BIN" rm -f $stale_containers >/dev/null
fi

# --- Candidate environment file --------------------------------------------
candidate_env="$CONFIG_DIR/$slot-$target_sha.env"
[[ ! -e "$candidate_env" ]] || fail "candidate environment already exists: $candidate_env"
candidate_tmp="$(mktemp "$CONFIG_DIR/.$slot-$target_sha.env.XXXXXX")"
{
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$candidate_project"
  printf 'TRACE_RELEASE_SHA=%s\n' "$target_sha"
  printf 'TRACE_RELEASE_RECEIPT=%s\n' "$receipt"
  printf 'TRACE_RUNTIME_NETWORK=%s\n' "$runtime_network"
  printf 'TRACE_API_ENV_FILE=%s\n' "$api_env_file"
  printf 'TRACE_WEB_ENV_FILE=%s\n' "$web_env_file"
  printf 'TRACE_API_IMAGE=%s\n' "$(value "$receipt" TRACE_API_IMAGE)"
  printf 'TRACE_API_IMAGE_ID=%s\n' "$(value "$receipt" TRACE_API_IMAGE_ID)"
  printf 'TRACE_WEB_IMAGE=%s\n' "$(value "$receipt" TRACE_WEB_IMAGE)"
  printf 'TRACE_WEB_IMAGE_ID=%s\n' "$(value "$receipt" TRACE_WEB_IMAGE_ID)"
  printf 'TRACE_OPS_IMAGE=%s\n' "$(value "$receipt" TRACE_OPS_IMAGE)"
  printf 'TRACE_OPS_IMAGE_ID=%s\n' "$(value "$receipt" TRACE_OPS_IMAGE_ID)"
  printf 'TRACE_API_HOST_PORT=%s\n' "$candidate_api_port"
  printf 'TRACE_WEB_HOST_PORT=%s\n' "$candidate_web_port"
} > "$candidate_tmp"
chmod 600 "$candidate_tmp"
mv -f "$candidate_tmp" "$candidate_env"

# --- Preflight, migrate, verify catalogue integrity -------------------------
"$PREFLIGHT" "$candidate_env"
"$RUN_OPS" "$candidate_env" migrate

if ! "$RUN_OPS" "$candidate_env" demo-verify --env demo; then
  fail 'demo-verify failed on the candidate release; the live slot was not touched. This deployment needs a human: investigate the catalogue drift and run demo-replenish manually (never demo-restore against the buyer demo) before retrying.'
fi

# --- Start and verify the candidate slot, then switch -----------------------
"$START_CANDIDATE" "$candidate_env"
"$VERIFY_CANDIDATE" "$candidate_env"

candidate_conf="$CONFIG_DIR/nginx/$slot.conf"
[[ -f "$candidate_conf" ]] || fail "candidate nginx upstream file is missing: $candidate_conf"

"$SWITCH_NGINX" "$ACTIVE_CONF_LINK" "$candidate_conf" "$ACTIVE_ENV_LINK" "$candidate_env"

# --- Public probes, with rollback on failure --------------------------------
public_ok=0
for attempt in $(seq 1 "$PROBE_ATTEMPTS"); do
  if curl --fail --silent --show-error --max-time 5 "$PUBLIC_URL/" >/dev/null \
    && curl --fail --silent --show-error --max-time 5 "$PUBLIC_URL/api/v1/marketplace/listings" >/dev/null \
    && curl --fail --silent --show-error --max-time 5 "$PUBLIC_URL/health/ready" >/dev/null; then
    public_ok=1
    break
  fi
  sleep "$PROBE_SLEEP"
done

if [[ "$public_ok" != 1 ]]; then
  if "$ROLLBACK_NGINX" "$ACTIVE_CONF_LINK" "$ACTIVE_ENV_LINK"; then
    fail 'public probes failed after switching; rolled back to the previous release'
  else
    fail 'public probes failed after switching, AND the automatic rollback also failed; manual intervention is required now'
  fi
fi

printf '%s sha=%s slot=%s previous=%s result=deployed\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$target_sha" "$slot" "$live_sha" \
  >> "$STATE_DIR/deployments.log"
chmod 600 "$STATE_DIR/deployments.log"

log "deployed: $target_sha (slot=$slot, previous=$live_sha)"

"$PRUNE_RELEASES" || echo 'Release pruning failed; old releases were not removed. This does not affect the live deployment.' >&2
